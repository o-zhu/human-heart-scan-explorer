import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {TEE_ATLAS_VIEWS as views} from '../public/tee-atlas-data.js';
import {buildTeeAtlasFrames,atlasContextProbePose,atlasProbeFocusPoints,TeeAtlasOverlay} from '../public/tee-atlas-geometry.js';
import {validateTeeRefinements,applyTeeRefinements} from '../public/tee-view-refinement.js';
import {createTeeContextModel,teeContextToLocal,teeContextCamera} from '../public/tee-context-geometry.js';
import {createProbeMeshes,probeModelMatrix} from '../public/probe-scene.js';
import {rotateVector} from '../public/probe-geometry.js';
import {dot,cross} from '../public/planes.js';

const json=path=>JSON.parse(readFileSync(new URL(path,import.meta.url)));
const raw=json('../public/assets/echo-planes.json'),referenceMm=168.0104;
const source=Object.fromEntries(Object.entries(raw.frames).map(([id,f])=>[id,{...f.world,displayMirrorX:!!f.displayMirrorX,displayRotate180:!!f.displayRotate180}]));
const flow=Object.fromEntries(json('../public/assets/flow-views-v5.json').presets.map(p=>[p.id,p.world]));
const catalog=validateTeeRefinements(json('../public/assets/tee-atlas/plane-fit-v2.json'));
const frames=applyTeeRefinements(buildTeeAtlasFrames(source,views,{flowFrames:flow}),catalog,{datasetId:'1659197537'});
const context=createTeeContextModel({frames:source,referenceMm,donorId:'1659197537'});
const initialFrames=JSON.stringify(frames),initialTract=JSON.stringify(context.tractSamples),initialInterior=JSON.stringify(context.gastricInteriorSamples);
const poses=Object.fromEntries(views.map(v=>[v.id,atlasContextProbePose(frames[v.id],v,referenceMm,context)]));
const sub=(a,b)=>a.map((x,i)=>x-b[i]);
const near=(a,b,t=1e-6)=>assert.ok(Math.abs(a-b)<=t,`${a} differs from ${b}`);
const vectorNear=(a,b,t=1e-6)=>a.forEach((x,i)=>near(x,b[i],t));
const finite=p=>assert.ok(Array.isArray(p)&&p.length===3&&p.every(Number.isFinite));
const report={scope:'Actual production atlas probe poses, authored-tract containment and overlay invocation. No measured patient depth, clinical registration, collision certification, browser rendering or frame-rate claim.',checks:[],views:views.map(v=>({id:v.id,aseNumber:v.aseNumber,pose:poses[v.id]}))};

test('all 28 actual presets have finite mechanically consistent probes without changing reviewed source frames',()=>{
 for(const v of views){
  const p=poses[v.id],fit=p.contextFit;
  for(const a of [p.originMm,p.beam,p.right,p.normal,p.instrument.shaft,p.instrument.right,p.targetMm,...p.shaftPoints])finite(a);
  for(const a of [p.beam,p.right,p.normal,p.instrument.shaft,p.instrument.right])near(Math.hypot(...a),1);
  near(dot(p.beam,p.right),0);near(dot(p.instrument.shaft,p.beam),0);near(dot(p.instrument.right,p.beam),0);
  vectorNear(rotateVector(p.instrument.right,p.beam,p.multiplaneDeg*Math.PI/180),p.right);
  vectorNear(cross(p.beam,p.right),p.normal);
  assert.ok(p.multiplaneDeg>=v.angleRange[0]&&p.multiplaneDeg<=v.angleRange[1]);
  assert.ok(p.sectorDepthMm>0&&p.shaftPoints.length>25);assert.ok(fit.shaftBendDeg<=90+1e-6);
  assert.equal(fit.registered,false);assert.equal(fit.clinicalDepthMeasured,false);assert.ok(fit.levelLabel);assert.ok(Number.isFinite(fit.insertionCm));
  assert.equal(fit.resolved,!fit.estimated);
 }
 assert.equal(JSON.stringify(frames),initialFrames);assert.equal(JSON.stringify(context.tractSamples),initialTract);assert.equal(JSON.stringify(context.gastricInteriorSamples),initialInterior);
 report.checks.push('All 28 production poses are finite, orthonormal, electronically consistent and explicitly unregistered; source frames and authored anatomy remain unchanged.');
});

test('every previously missing acquired probe stays at a real esophageal or gastric interior sample',()=>{
 const missing=['merpv','mervinout','memodbicaval','mepv','melaa','tgbasalsax','tgrvbasal','tgrvinout','deeptg5c','tg2c'];
 for(const id of missing){
  const p=poses[id],v=views.find(v=>v.id===id),fit=p.contextFit,samples=v.group==='tg'?context.gastricInteriorSamples:context.tractSamples;
  assert.equal(fit.estimated,true,id);assert.equal(fit.resolved,false,id);assert.equal(fit.mode,'tract-estimate');
  const s=samples.find(s=>s.pointMm.every((x,i)=>Math.abs(x-fit.headCenterMm[i])<1e-7));
  assert.ok(s,id+' must use a real interior sample, not a head projected out of its organ.');
  assert.equal(s.level,id==='deeptg5c'?'deep-tg':v.group==='tg'?'tg':'me');
  vectorNear(p.originMm,fit.headCenterMm.map((x,i)=>x+3*p.beam[i]));
  near(Math.abs(dot(sub(p.originMm,frames[id].center.map(x=>x*referenceMm)),frames[id].normal)),fit.distanceMm);
  const actualAngle=Math.acos(Math.max(0,Math.min(1,Math.abs(dot(p.normal,frames[id].normal)))))*180/Math.PI;
  near(actualAngle,fit.normalAngleDeg);assert.match(fit.reason,/independent/);
 }
 assert.ok(missing.some(id=>poses[id].contextFit.distanceMm>20),'Real disagreement must not be zeroed to imply a fictitious CT match.');
 report.checks.push('All ten formerly hidden acquired probes remain in their intended modeled organ. Plane offset and angle disagreement are retained rather than silently projecting the probe through a wall.');
});

test('resolved estimates retain exact CT-plane coincidence and existing acceptance limits',()=>{
 for(const v of views){const p=poses[v.id],f=frames[v.id],fit=p.contextFit;if(!fit.resolved)continue;
  assert.equal(fit.mode,'ct-plane-estimate');assert.equal(fit.estimated,false);
  near(Math.abs(dot(p.normal,f.normal)),1);near(dot(sub(p.originMm,f.center.map(x=>x*referenceMm)),f.normal),0);
  assert.ok(fit.distanceMm<=fit.projectionLimitMm+1e-6);assert.ok(v.aseNumber<25);
 }
 report.checks.push('Every retained tight geometric fit still lies in its original measured CT plane and satisfies the unchanged projection limits.');
});

test('aortic pairs use meaningful lower or upper esophageal locations and only electronic angle changes between their views',()=>{
 for(const pair of [['daosax','daolax'],['uearchlax','uearchsax']]){
  const [a,b]=pair.map(id=>poses[id]);
  vectorNear(a.originMm,b.originMm);vectorNear(a.beam,b.beam);vectorNear(a.instrument.shaft,b.instrument.shaft);vectorNear(a.instrument.right,b.instrument.right);
  assert.ok(Math.abs(dot(a.normal,b.normal))<.3,'Paired electronic sections should be substantially different.');
  for(const id of pair){
   const p=poses[id],fit=p.contextFit;
   assert.equal(frames[id].outsideScan,true);assert.equal(fit.mode,'outside-scan-estimate');assert.equal(fit.outsideScan,true);assert.equal(fit.resolved,false);assert.equal(fit.estimated,true);
   assert.equal(fit.targetKind,'illustrative aortic target');
   if(id.startsWith('dao')){assert.equal(fit.level,'le');assert.ok(dot(p.beam,context.frame.left)>.7);assert.ok(dot(p.beam,context.frame.posterior)>.4);}
   else{assert.equal(fit.level,'ue');assert.ok(dot(p.beam,context.frame.anterior)>.95);}
  }
 }
 const upper=teeContextToLocal(poses.uearchlax.originMm,context.frame),lower=teeContextToLocal(poses.daosax.originMm,context.frame);
 assert.ok(upper[1]-lower[1]>80);
 report.checks.push('Descending-aortic pairs share a lower-esophageal, left/posterior-facing mechanical pose; arch pairs share an upper-esophageal, anterior-facing pose. Only the electronic plane changes within each pair.');
});

test('deep transgastric position is distinct from the ordinary gastric starts and aims superiorly',()=>{
 const p=poses.deeptg5c,deep=teeContextToLocal(p.contextFit.headCenterMm,context.frame);
 assert.equal(p.contextFit.level,'deep-tg');assert.ok(dot(p.beam,context.frame.superior)>.6);
 for(const id of ['tgbasalsax','tgrvbasal','tgrvinout','tg2c']){
  assert.ok(p.contextFit.insertionCm>poses[id].contextFit.insertionCm);
  assert.ok(deep[1]<teeContextToLocal(poses[id].contextFit.headCenterMm,context.frame)[1]-5);
 }
 report.checks.push('Deep TG is advanced below the ordinary gastric estimates and faces superiorly; it remains explicitly independent of an ideal registered Doppler axis.');
});

test('camera support contains the complete actual production head and nearby shaft without requiring the full proximal tube',()=>{
 const heads=createProbeMeshes('tee').filter((_,i)=>i!==2);
 for(const v of views){const pose=poses[v.id],points=atlasProbeFocusPoints(pose),m=probeModelMatrix(pose.instrument,.6);
  assert.ok(points.length>=10);points.forEach(finite);
  const basis=[pose.instrument.right,pose.instrument.shaft,pose.beam];
  const support=basis.map(axis=>{const q=points.map(p=>dot(sub(p,pose.originMm),axis));return [Math.min(...q),Math.max(...q)];});
  for(const head of heads)for(let i=0;i<head.vertices.length;i+=6){
   const [x,y,z]=head.vertices.slice(i,i+3),p=[m[0]*x+m[4]*y+m[8]*z+m[12],m[1]*x+m[5]*y+m[9]*z+m[13],m[2]*x+m[6]*y+m[10]*z+m[14]];
   basis.forEach((axis,k)=>{const q=dot(sub(p,pose.originMm),axis);assert.ok(q>=support[k][0]-1e-5&&q<=support[k][1]+1e-5);});
  }
 }
 report.checks.push('Compact framing support contains every vertex of the production transducer head and its nearby shaft, without forcing a close-up to include the entire proximal esophagus.');
});

test('real overlay invokes probe rendering for every estimate and draws independent sectors differently from strict fits',()=>{
 const basis=teeContextCamera(context,1),calls=[],strokes=[],ctx={setTransform(){},clearRect(){},setLineDash(d){this.dash=[...d];},beginPath(){},moveTo(){},lineTo(){},closePath(){},fill(){},stroke(){strokes.push({color:this.strokeStyle,dash:[...(this.dash||[])]});}};
 const overlay={renderer:{canvas:{getBoundingClientRect:()=>({width:700,height:700})},camera:{yaw:0,pitch:0,roll:0,distance:3,pan:[0,0,0]},basis:()=>basis,contextFrameRevision:1},meshCanvas:{style:{}},guideCanvas:{style:{},getContext:()=>ctx},mount:{hidden:false},scene:{sharedDepth:true,render:p=>calls.push(p)},running:false};
 overlay.draw=()=>TeeAtlasOverlay.prototype.draw.call(overlay);
 for(const v of views){
  TeeAtlasOverlay.prototype.set.call(overlay,{plane:frames[v.id],view:v,referenceMm,contextModel:context});
  assert.ok(overlay.pose?.originMm,'Caption pose must exist before the canvas is visible.');
  overlay.running=true;strokes.length=0;overlay.draw();overlay.running=false;
  const rendered=calls.at(-1);assert.equal(rendered.showProbe,true,v.id);assert.equal(rendered.pose.contextFit.mode,poses[v.id].contextFit.mode);assert.ok(rendered.probeLabel.includes(String(v.angleDefault)));
  assert.equal(overlay.meshCanvas.hidden,true,'Shared-depth geometry is drawn in the heart canvas, not an x-ray overlay.');
  if(poses[v.id].contextFit.estimated)assert.ok(strokes.some(s=>s.color==='rgba(227,181,117,.65)'&&s.dash.length));
  else assert.ok(strokes.some(s=>s.color==='rgba(147,218,187,.7)'&&!s.dash.length));
 }
 const before=calls.length;TeeAtlasOverlay.prototype.set.call(overlay,{plane:frames.melaa,view:views.find(v=>v.id==='melaa'),referenceMm,contextModel:context,showProbe:false,showSector:false,showContext:false});overlay.running=true;overlay.draw();
 assert.equal(calls.length,before+1);assert.equal(calls.at(-1).showProbe,false);assert.equal(calls.at(-1).showContext,false);assert.equal(overlay.guideCanvas.hidden,true);
 report.checks.push('Actual atlas overlay sends all 28 probes to the shared-depth scene, uses amber dashed independent fans, and respects explicit probe/sector/context switches. Pose metadata is available before any canvas draw.');
});

test('comparison donors keep their own scale and geometric frame',()=>{
 for(const id of ['s-20-28','s-20-29']){
  const raw=json(`../public/assets/donors/${id}/echo-planes.json`),base=Object.fromEntries(Object.entries(raw.frames).map(([key,f])=>[key,f.world]));
  const built=buildTeeAtlasFrames(base,views,{geometricComparisonOnly:true}),model=createTeeContextModel({frames:base,referenceMm:raw.referenceMm,donorId:id});
  assert.deepEqual(model.frame.landmarksMm,{});
  for(const v of views){const p=atlasContextProbePose(built[v.id],v,model.referenceMm,model);finite(p.originMm);assert.equal(p.referenceMm,model.referenceMm);assert.equal(p.contextFit.registered,false);}
 }
 report.checks.push('Both comparison donors produce finite geometric estimates from their own scale and frame without importing LADAF tissue landmarks.');
});

test.after(()=>{
 const output=process.argv.find(x=>x.startsWith('--report='))?.slice('--report='.length);
 if(output){mkdirSync(output.slice(0,output.lastIndexOf('/')),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n');}
});
