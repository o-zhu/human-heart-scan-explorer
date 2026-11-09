/** Source/frame/tissue-callout contracts. No browser, GPU, or clinical-validation claims. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {
 TEE_REGIONAL_REVIEW_ID,TEE_REGIONAL_REVIEW_DATASET,
 validateTeeRegionalReview,reviewedTeeEvidence,paintTeeTissueAnchors,teeReviewStatusText,
} from '../public/tee-view-review.js';
import {TEE_ATLAS_VIEWS} from '../public/tee-atlas-data.js';
import {buildTeeAtlasFrames} from '../public/tee-atlas-geometry.js';
import {validateTeeRefinements,applyTeeRefinements} from '../public/tee-view-refinement.js';
import {EchoModule,sampleEchoPreview} from '../public/echo.js';

const json=relative=>JSON.parse(readFileSync(new URL(relative,import.meta.url)));
const publicFile=url=>new URL('../public/'+url.replace(/^\.\//,''),import.meta.url);
const production=json('../public/assets/tee-atlas/regional-review-v3.json');
const catalog=validateTeeRegionalReview(production);
const donor={datasetId:TEE_REGIONAL_REVIEW_DATASET,geometricComparisonOnly:false};
const starting=json('../public/assets/echo-planes.json');
const originals=Object.fromEntries(Object.entries(starting.frames).map(([id,f])=>[id,{
 ...f.world,displayMirrorX:f.displayMirrorX===true,displayRotate180:f.displayRotate180===true,
}]));
const fitted=applyTeeRefinements(buildTeeAtlasFrames(originals,TEE_ATLAS_VIEWS),
 validateTeeRefinements(json('../public/assets/tee-atlas/plane-fit-v2.json')),donor);
const stateFor=id=>({mode:'tee',preset:id,planeReference:'refined',offsetMm:0,rotationDeg:0,tiltDeg:0,flip:false});
const currentPlane=(id,state=stateFor(id))=>EchoModule.prototype.getPlane.call({
 state,frames:fitted,longestMm:168.0104,frameKey:()=>id,
});
const evidence=(id,options={})=>reviewedTeeEvidence(catalog,{
 id,donor,state:stateFor(id),plane:currentPlane(id),outsideScan:!!fitted[id]?.outsideScan,...options,
});

test('production review accounts for all 28 named targets with conservative support categories',()=>{
 assert.equal(catalog.id,TEE_REGIONAL_REVIEW_ID);
 assert.equal(catalog.clinicalRegistrationValidated,false);assert.equal(catalog.expertValidated,false);
 assert.deepEqual(Object.keys(catalog.views).sort(),TEE_ATLAS_VIEWS.map(v=>v.id).sort());
 const counts={supported:0,partial:0,unsupported:0,outside:0};
 let anchors=0,anchoredViews=0;
 for(const view of TEE_ATLAS_VIEWS){
  const item=catalog.views[view.id];counts[item.status]++;
  assert.equal(item.aseNumber,view.aseNumber);assert.ok(item.remainingLimits.length>0);
  assert.ok(teeReviewStatusText(item.status).length>8);
  if(item.regionAnchors.length){anchors+=item.regionAnchors.length;anchoredViews++;}
 }
 assert.deepEqual(counts,{supported:13,partial:7,unsupported:4,outside:4});
 assert.equal(anchors,20);assert.equal(anchoredViews,8);
 for(const id of ['merpv','mepv','melaa','bicaval'])assert.equal(catalog.views[id].status,'unsupported');
 assert.equal(catalog.views.tgpapillary.status,'partial');
 assert.match(catalog.views.tgpapillary.summary,/belong to RV/);
 assert.match(catalog.views.tgpapillary.summary,/paired LV papillary muscles are not confirmed/);
});

test('all 24 acquired production sections match the exact displayed reviewed raster',()=>{
 const before=JSON.stringify(catalog);
 for(const view of TEE_ATLAS_VIEWS.filter(v=>v.aseNumber<25)){
  assert.equal(evidence(view.id),catalog.views[view.id],view.id);
  assert.equal(evidence(view.id,{state:{...stateFor(view.id),flip:true}}),catalog.views[view.id],`${view.id}: flipping retains the measured plane`);
 }
 assert.equal(JSON.stringify(catalog),before);
});

test('previous, adjusted, other-donor, and unrelated-module sections inherit no reviewed findings or anchors',()=>{
 for(const view of TEE_ATLAS_VIEWS.filter(v=>v.aseNumber<25)){
  const id=view.id,state=stateFor(id);
  for(const changed of [{planeReference:'previous'},{offsetMm:.1},{rotationDeg:1},{tiltDeg:-1},{mode:'tte'}]){
   assert.equal(evidence(id,{state:{...state,...changed}}),null,`${id}: ${JSON.stringify(changed)}`);
  }
  assert.equal(evidence(id,{donor:{...donor,datasetId:'1773963465'}}),null);
  assert.equal(evidence(id,{donor:{...donor,geometricComparisonOnly:true}}),null);
  assert.equal(evidence(id,{plane:null}),null);
 }
});

test('a mismatched sample plane cannot display the reviewed tissue anchors',()=>{
 for(const view of TEE_ATLAS_VIEWS.filter(v=>v.aseNumber<25)){
  const id=view.id;
  for(const key of ['center','right','up','normal']){
   const plane=structuredClone(currentPlane(id));plane[key][0]+=.001;
   assert.equal(evidence(id,{plane}),null,`${id}: mismatched ${key}`);
  }
  for(const key of ['width','height']){
   const plane=structuredClone(currentPlane(id));plane[key]+=.001;
   assert.equal(evidence(id,{plane}),null,`${id}: mismatched ${key}`);
  }
 }
});

test('outside-scan targets have no tissue anchors and require the explicit outside-scan state',()=>{
 for(const view of TEE_ATLAS_VIEWS.filter(v=>v.aseNumber>=25)){
  assert.equal(evidence(view.id),catalog.views[view.id]);
  assert.deepEqual(evidence(view.id).regionAnchors,[]);
  assert.equal(evidence(view.id,{outsideScan:false}),null);
  assert.equal(evidence(view.id,{donor:{...donor,datasetId:'other'}}),null);
 }
});

test('invalid support, source, validation claims, and source-tissue anchors are rejected',()=>{
 const bad=fn=>{const x=structuredClone(production);fn(x);return()=>validateTeeRegionalReview(x);};
 assert.throws(bad(x=>x.id='other'));
 assert.throws(bad(x=>x.datasetId='1773963465'));
 assert.throws(bad(x=>x.clinicalRegistrationValidated=true));
 assert.throws(bad(x=>delete x.clinicalRegistrationValidated));
 assert.throws(bad(x=>x.expertValidated=true));
 assert.throws(bad(x=>delete x.views.me4c));
 assert.throws(bad(x=>x.views.me4c.status='validated'));
 assert.throws(bad(x=>x.views.me4c.status='outside'));
 assert.throws(bad(x=>x.views.daosax.status='supported'));
 assert.throws(bad(x=>x.views.me4c.aseNumber=1));
 assert.throws(bad(x=>delete x.views.me4c.reviewedFrame));
 assert.throws(bad(x=>x.views.me4c.reviewedFrame.center[0]=NaN));
 assert.throws(bad(x=>x.views.me4c.reviewedFrame.width=0));
 for(const id of [0,7,1.5])assert.throws(bad(x=>x.views.me4c.regionAnchors[0].regionId=id));
 for(const value of [0,256,NaN])assert.throws(bad(x=>x.views.me4c.regionAnchors[0].sourceValue=value));
 assert.throws(bad(x=>x.views.me4c.regionAnchors[0].normalizedXY[0]=-0.01));
 assert.throws(bad(x=>x.views.me4c.regionAnchors[0].normalizedXY[1]=1.01));
 assert.throws(bad(x=>x.views.me4c.regionAnchors[0].world[0]+=.01));
 assert.throws(bad(x=>x.views.me4c.regionAnchors[0].text=null));
 assert.throws(bad(x=>x.views.daosax.regionAnchors=[structuredClone(x.views.me4c.regionAnchors[0])]));
});

test('all 20 shipped callouts land on measured source tissue with the stated v17 regional identity',()=>{
 const labelsManifest=json('../public/assets/anatomy/manifest.json');
 const labels=gunzipSync(readFileSync(publicFile(labelsManifest.volumeUrl)));
 const source=gunzipSync(readFileSync(publicFile(catalog.source.url)));
 const sourceManifest=json('../public/assets/manifest.json').levels.high;
 const part=sourceManifest.parts.find(p=>p.url===catalog.source.url);
 assert.ok(part,'Reviewed bank must be present in the source manifest');
 if(part.predictor==='delta-z'){
  const slice=sourceManifest.dimensions[0]*sourceManifest.dimensions[1];
  for(let i=slice;i<source.length;i++)source[i]=(source[i]+source[i-slice])&255;
 }else assert.ok(!part.predictor,'Unsupported source predictor');
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 assert.equal(labelsManifest.revision,catalog.labelRevision);
 assert.equal(hash(labels),catalog.labelDecodedSha256);
 assert.equal(hash(source),catalog.source.decodedSha256);
 const [nx,ny,nz]=catalog.source.dimensionsXYZ,[lx,ly,lz]=labelsManifest.dimensions;
 assert.equal(source.length,nx*ny*nz);assert.equal(labels.length,lx*ly*lz);
 const longest=Math.max(nx-1,ny-1,nz-1);
 const intensity=p=>{
  const lo=p.map(Math.floor),t=p.map((v,i)=>v-lo[i]);let value=0;
  for(let z=0;z<2;z++)for(let y=0;y<2;y++)for(let x=0;x<2;x++){
   const weight=(x?t[0]:1-t[0])*(y?t[1]:1-t[1])*(z?t[2]:1-t[2]);
   value+=source[((lo[2]+z)*ny+lo[1]+y)*nx+lo[0]+x]*weight;
  }
  return value;
 };
 for(const [id,item] of Object.entries(catalog.views))for(const anchor of item.regionAnchors){
  const p=[anchor.world[0]*longest+(nx-1)/2,(ny-1)/2-anchor.world[2]*longest,anchor.world[1]*longest+(nz-1)/2];
  assert.ok(p.every((v,i)=>v>0&&v<catalog.source.dimensionsXYZ[i]-1),id);
  const q=p.map((v,i)=>Math.round(v/(catalog.source.dimensionsXYZ[i]-1)*(labelsManifest.dimensions[i]-1)));
  assert.equal(labels[(q[2]*ly+q[1])*lx+q[0]],anchor.regionId,`${id}: ${anchor.text}`);
  const value=intensity(p);
  assert.ok(value>65,`${id}: callout must not label a dark cavity as tissue`);
  assert.ok(Math.abs(value-anchor.sourceValue)<=1,`${id}: source scalar changed`);
 }
});

class RecordingContext{
 constructor(){this.points=[];this.labels=[];}
 save(){}restore(){}beginPath(){}moveTo(){}lineTo(){}stroke(){}fillRect(){}strokeRect(){}fill(){}
 measureText(text){return{width:text.length*7};}
 arc(x,y){this.points.push([x,y]);}
 fillText(text,x,y){this.labels.push({text,x,y});}
}
test('tissue callout positions mirror with the same horizontal flip as the CT raster',()=>{
 const width=601,height=733;
 for(const item of Object.values(catalog.views).filter(v=>v.regionAnchors.length)){
  const normal=new RecordingContext(),flipped=new RecordingContext();
  paintTeeTissueAnchors(normal,item.regionAnchors,width,height);
  paintTeeTissueAnchors(flipped,item.regionAnchors,width,height,{flip:true});
  assert.equal(normal.points.length,item.regionAnchors.length);
  item.regionAnchors.forEach((anchor,i)=>{
   assert.ok(Math.abs(normal.points[i][0]+flipped.points[i][0]-width)<1e-9);
   assert.equal(normal.points[i][1],flipped.points[i][1]);
   const sourceX=anchor.normalizedXY[0]*(width-1)+.5,sourceY=anchor.normalizedXY[1]*(height-1)+.5;
   assert.ok(Math.abs(normal.points[i][0]-sourceX)<=.5);
   assert.ok(Math.abs(normal.points[i][1]-sourceY)<=.5);
   assert.equal(flipped.labels[i].text,normal.labels[i].text);
  });
 }
 const sample={data:new Uint8Array([10,20,30,40,50,60,70,80]),width:4,height:2,plane:catalog.views.me4c.reviewedFrame};
 const ordinary=sampleEchoPreview(sample,{extent:[1,1,1],maxSize:4});
 const mirrored=sampleEchoPreview(sample,{extent:[1,1,1],maxSize:4,flip:true});
 for(let row=0;row<ordinary.height;row++)for(let col=0;col<ordinary.width;col++){
  assert.equal(ordinary.intensity[row*ordinary.width+col],mirrored.intensity[row*ordinary.width+ordinary.width-1-col]);
 }
});
