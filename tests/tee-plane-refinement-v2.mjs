import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateTeeRefinements,applyTeeRefinements,TEE_REFINEMENT_DATASET} from '../public/tee-view-refinement.js';
import {EchoModule} from '../public/echo.js';
import {buildTeeAtlasFrames,atlasContextProbePose} from '../public/tee-atlas-geometry.js';
import {TEE_ATLAS_VIEWS} from '../public/tee-atlas-data.js';
import {createTeeContextModel} from '../public/tee-context-geometry.js';
import {dot,cross} from '../public/planes.js';
import {rotateVector} from '../public/probe-geometry.js';

const source=JSON.parse(readFileSync(new URL('../public/assets/echo-planes.json',import.meta.url)));
const original=Object.fromEntries(Object.entries(source.frames).map(([id,f])=>[id,{...f.world,displayMirrorX:f.displayMirrorX===true,displayRotate180:f.displayRotate180===true}]));
const frames=buildTeeAtlasFrames(original,TEE_ATLAS_VIEWS),before=JSON.stringify(frames);
const sample={datasetId:TEE_REFINEMENT_DATASET,views:{me4c:{frame:{center:[.1,.02,-.03],right:[1,0,0],up:[0,1,0],normal:[0,0,1],width:.8,height:.9},status:'refined',summary:'Fixture',remainingLimits:['Specimen is fixed.'],search:{candidatesEvaluated:42}}}};
const catalog=validateTeeRefinements(sample);

test('reviewed sections replace only the matching donor and keep originals reversible',()=>{
 const fitted=applyTeeRefinements(frames,catalog,{datasetId:TEE_REFINEMENT_DATASET});
 assert.deepEqual(fitted.me4c.center,sample.views.me4c.frame.center);
 assert.equal(fitted.me4c.atlasDerived,true,'A moved plane cannot use a prepared image for the old plane');
 assert.equal(fitted.me4c.displayMirrorX,false);assert.equal(fitted.me4c.displayRotate180,false);
 assert.equal(fitted.a4c,frames.a4c);assert.equal(fitted.daosax,frames.daosax);
 assert.equal(JSON.stringify(frames),before);
 assert.deepEqual(applyTeeRefinements(frames,catalog,{datasetId:TEE_REFINEMENT_DATASET,useRefinement:false}),frames);
 assert.deepEqual(applyTeeRefinements(frames,catalog,{datasetId:'1773963465'}),frames);
 assert.deepEqual(applyTeeRefinements(frames,catalog,{datasetId:TEE_REFINEMENT_DATASET,geometricComparisonOnly:true}),frames);
 fitted.me4c.center[0]=99;assert.equal(catalog.views.me4c.frame.center[0],.1);
});

test('invalid orientation, wrong donor, and unacquired aortic targets are rejected',()=>{
 const corrupt=fn=>{const x=structuredClone(sample);fn(x);return()=>validateTeeRefinements(x);};
 assert.throws(corrupt(x=>x.datasetId='1773963465'));
 assert.throws(corrupt(x=>x.views.me4c.frame.normal=[0,0,-1]));
 assert.throws(corrupt(x=>x.views.me4c.frame.up=[1,0,0]));
 assert.throws(corrupt(x=>x.views.me4c.frame.center[0]=NaN));
 assert.throws(corrupt(x=>x.views.me4c.frame.displayMirrorX=true));
 assert.throws(corrupt(x=>x.views.daosax=x.views.me4c));
});

test('late review loading preserves a manually adjusted plane',async()=>{
 let resolve;const oldFetch=globalThis.fetch;
 globalThis.fetch=()=>new Promise(r=>resolve=r);
 const fixture=(active,restoredReviewedPending=false)=>({donor:{datasetId:TEE_REFINEMENT_DATASET},state:{mode:'tee',preset:'me4c',planeReference:'refined',offsetMm:0,rotationDeg:0,tiltDeg:0,flip:false},active,destroyed:false,restoredReviewedPending,setPlaneReview(c){this.catalog=c;}});
 const echoes=[fixture(true),fixture(false),fixture(true,true),fixture(false,true)],pending=echoes.map(e=>EchoModule.prototype.loadPlaneReview.call(e));
 try{
  for(const echo of echoes)echo.state.offsetMm=6.2;
  resolve({ok:true,json:async()=>structuredClone(sample)});await Promise.all(pending);
  for(const [i,echo] of echoes.entries()){
   assert.equal(echo.state.planeReference,i<2?'previous':'refined');assert.equal(echo.state.offsetMm,6.2);assert.ok(echo.catalog);
  }
  const edited=fixture(true,true);EchoModule.prototype.holdCurrentPlaneReference.call(edited);
  assert.equal(edited.state.planeReference,'previous');assert.equal(edited.restoredReviewedPending,false);
 }finally{globalThis.fetch=oldFetch;}
});

test('reviewed preset cannot warm a cached texture from the previous plane',async()=>{
 const fitted=applyTeeRefinements(frames,catalog,{datasetId:TEE_REFINEMENT_DATASET});let reads=0;
 const echo={active:true,renderer:{settings:{cleanupEnabled:true}},frames:fitted,presetTextures:{me4c:{url:'old-four-chamber.png'}},loadPresetTexture(){reads++;return Promise.resolve({});}};
 assert.equal(await EchoModule.prototype.warmPreset.call(echo,'me4c'),null);assert.equal(reads,0);
});

test('production review supplies all acquired TEE targets without silently adding thoracic anatomy',()=>{
 const actual=validateTeeRefinements(JSON.parse(readFileSync(new URL('../public/assets/tee-atlas/plane-fit-v2.json',import.meta.url))));
 assert.deepEqual(Object.keys(actual.views).sort(),TEE_ATLAS_VIEWS.filter(v=>v.aseNumber<25).map(v=>v.id).sort());
 for(const [id,item] of Object.entries(actual.views)){
  assert.ok(item.summary?.length>20,id);assert.ok(item.remainingLimits.length>0,id);
  assert.ok(item.search.candidatesEvaluated>100,id);
  assert.ok(['refined','retained','limited'].includes(item.status),id);
 }
});

test('resolved context fits remain in CT while independent estimates retain explicit nonregistration',()=>{
 const actual=validateTeeRefinements(JSON.parse(readFileSync(new URL('../public/assets/tee-atlas/plane-fit-v2.json',import.meta.url))));
 const fitted=applyTeeRefinements(frames,actual,{datasetId:TEE_REFINEMENT_DATASET}),referenceMm=168.0104;
 const context=createTeeContextModel({frames:original,referenceMm,donorId:TEE_REFINEMENT_DATASET});
 const immutable=JSON.stringify(context.tractSamples);let fittedCount=0,estimatedCount=0;
 const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
 for(const view of TEE_ATLAS_VIEWS){
  const f=fitted[view.id],p=atlasContextProbePose(f,view,referenceMm,context);
  near(dot(p.beam,p.normal),0);near(dot(p.right,p.normal),0);near(dot(p.beam,p.right),0);
  const electronic=rotateVector(p.instrument.right,p.beam,p.multiplaneDeg*Math.PI/180);
  electronic.forEach((x,i)=>near(x,p.right[i]));
  assert.ok(p.shaftPoints.every(q=>q.length===3&&q.every(Number.isFinite)),view.id);
  assert.ok(p.contextFit.shaftBendDeg<=90+1e-6,view.id);
  assert.equal(p.contextFit.registered,false);
  if(p.contextFit.resolved){
   fittedCount++;assert.equal(p.contextFit.estimated,false);
   near(Math.abs(dot(p.normal,f.normal||cross(f.right,f.up))),1);
   near(dot(p.originMm.map((x,i)=>x-f.center[i]*referenceMm),p.normal),0);
   assert.ok(p.contextFit.distanceMm<=p.contextFit.projectionLimitMm+1e-6,view.id);assert.ok(view.aseNumber<25);
   if(view.id==='deeptg5c'){assert.ok(p.contextFit.approachAngleDeg<=40);assert.ok(p.contextFit.nearFieldMm>=20);}
  }else{
   estimatedCount++;assert.equal(p.contextFit.estimated,true);assert.ok(p.contextFit.reason);
   const candidates=view.group==='tg'?context.gastricInteriorSamples:context.tractSamples;
   assert.ok(candidates.some(s=>s.pointMm.every((x,i)=>Math.abs(x-p.contextFit.headCenterMm[i])<1e-6)),view.id+' head must remain inside its actual model tract.');
   near(Math.abs(dot(p.originMm.map((x,i)=>x-f.center[i]*referenceMm),f.normal||cross(f.right,f.up))),p.contextFit.distanceMm);
  }
 }
 assert.ok(fittedCount>=12);assert.ok(estimatedCount>=4);assert.equal(fittedCount+estimatedCount,28);assert.equal(JSON.stringify(context.tractSamples),immutable);
});
