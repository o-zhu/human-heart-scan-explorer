/** Pure frame/texture/camera contracts. No browser, GPU, or anatomy-validation claims. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 MAIN_VIEW_REVIEW_VERSION,MAIN_VIEW_REVIEW_DATASET,
 validateMainViewReview,applyMainViewReview,reviewedStartingCamera,sameStartingRaster,
} from '../public/main-view-review.js';
import {flowPlane} from '../public/flow-plane.js';
import {add,mul,dot,cross,norm} from '../public/planes.js';

const source=JSON.parse(readFileSync(new URL('../public/assets/flow-views-v5.json',import.meta.url)));
const donor={datasetId:MAIN_VIEW_REVIEW_DATASET,specimen:'LADAF-2021-17'};
const bounds={min:[-.39,-.48,-.36],max:[.41,.47,.43]};
const sample=()=>({
 datasetId:MAIN_VIEW_REVIEW_DATASET,specimen:donor.specimen,version:MAIN_VIEW_REVIEW_VERSION,
 views:Object.fromEntries(source.presets.map(p=>[p.id,{
  world:structuredClone(p.world),fitBounds:structuredClone(bounds),
  overviewTarget:[.015,.01,.025],cameraOffset:{right:.27,up:.12},
  status:'partial',summary:'Fixture regional source review; this is not clinical validation.',
  remainingLimits:['Regional tissue labels do not identify individual valve leaflets.'],
 }])),
});
const corners=box=>Array.from({length:8},(_,mask)=>box.min.map((v,i)=>(mask>>i)&1?box.max[i]:v));

test('a new physical sampling rectangle cannot reuse old measured pixels',()=>{
 const input=sample(),item=input.views['rv-outflow'];
 item.world.center=add(item.world.center,mul(item.world.normal,.012));
 item.world.target=add(item.world.target,mul(item.world.normal,.012));
 const catalog=validateMainViewReview(input),before=JSON.stringify(source.presets);
 const result=applyMainViewReview(source.presets,catalog,donor);
 const changed=result.find(p=>p.id==='rv-outflow');
 assert.equal(changed.texture,undefined);
 assert.equal(changed.reviewVersion,MAIN_VIEW_REVIEW_VERSION);
 assert.notDeepEqual(changed.world.center,source.presets.find(p=>p.id==='rv-outflow').world.center);
 for(const p of result.filter(p=>p.id!=='rv-outflow'))assert.equal(p.texture,source.presets.find(x=>x.id===p.id).texture);
 assert.equal(JSON.stringify(source.presets),before);
 changed.world.center[0]=9;
 assert.notEqual(catalog.views['rv-outflow'].world.center[0],9,'Runtime transforms must not mutate catalog frames');
});

test('camera, target, and retained-half changes preserve an identical sampling rectangle',()=>{
 const input=sample(),id='lv-outflow',item=input.views[id];
 item.world.target=add(item.world.target,mul(item.world.right,.035));
 item.flip=!source.presets.find(p=>p.id===id).flip;
 item.cameraDistance=1.3;item.closeDistance=.63;
 const result=applyMainViewReview(source.presets,validateMainViewReview(input),donor).find(p=>p.id===id);
 const original=source.presets.find(p=>p.id===id);
 assert.equal(result.texture,original.texture);
 assert.equal(sameStartingRaster(result.world,original.world),true);
 const currentPlane=flowPlane(result,{offsetMm:0,rotationDeg:0,tiltDeg:0},168.0104);
 assert.equal(sameStartingRaster(currentPlane,original.world),true);
 assert.notDeepEqual(result.world.target,original.world.target);
});

test('donor gating preserves original comparison frames and textures',()=>{
 const catalog=validateMainViewReview(sample());
 for(const other of [{...donor,datasetId:'1773963465'},{...donor,geometricComparisonOnly:true}]){
  assert.equal(applyMainViewReview(source.presets,catalog,other),source.presets);
 }
 assert.equal(applyMainViewReview(source.presets,null,donor),source.presets);
 assert.equal(applyMainViewReview(source.presets,{...catalog,datasetId:'other'},donor),source.presets);
});

test('invalid source identity, orientation, target, and support bounds fail before use',()=>{
 const bad=fn=>{const x=sample();fn(x);return()=>validateMainViewReview(x);};
 assert.throws(bad(x=>x.datasetId='1773963465'));
 assert.throws(bad(x=>x.specimen='Other donor'));
 assert.throws(bad(x=>x.version='unknown-review'));
 assert.throws(bad(x=>delete x.views['ra-inflow']));
 assert.throws(bad(x=>x.views['rv-outflow'].world.normal=x.views['rv-outflow'].world.normal.map(v=>-v)));
 assert.throws(bad(x=>x.views['rv-outflow'].world.up=[...x.views['rv-outflow'].world.right]));
 assert.throws(bad(x=>x.views['rv-outflow'].world.target=add(x.views['rv-outflow'].world.target,mul(x.views['rv-outflow'].world.normal,.02))));
 assert.throws(bad(x=>x.views['rv-outflow'].world.center[0]=NaN));
 assert.throws(bad(x=>x.views['rv-outflow'].world.width=0));
 assert.throws(bad(x=>x.views['rv-outflow'].fitBounds.max[0]=x.views['rv-outflow'].fitBounds.min[0]));
});

test('fine-plane identity rejects moved, rotated, mirrored, or differently cropped rasters',()=>{
 const plane=structuredClone(source.presets[0].world);
 assert.equal(sameStartingRaster(plane,structuredClone(plane)),true);
 assert.equal(sameStartingRaster(undefined,plane),false);
 for(const key of ['center','right','up']){
  const moved=structuredClone(plane);moved[key][0]+=.001;
  assert.equal(sameStartingRaster(moved,plane),false,key);
 }
 for(const key of ['width','height']){
  const crop=structuredClone(plane);crop[key]+=.001;
  assert.equal(sameStartingRaster(crop,plane),false,key);
 }
 const reversed=structuredClone(plane);reversed.right=reversed.right.map(v=>-v);
 assert.equal(sameStartingRaster(reversed,plane),false);
});

test('overview and face-slice framing contain the retained 3D bounds at narrow and wide aspects',()=>{
 const presets=applyMainViewReview(source.presets,validateMainViewReview(sample()),donor);
 for(const p of presets){
  const plane=flowPlane(p,{offsetMm:0,rotationDeg:0,tiltDeg:0},168.0104);
  for(const aspect of [.35,.55,1,1.6,2.2])for(const view of ['overview','section'])for(const flip of [false,true]){
   const camera=reviewedStartingCamera(p,plane,{aspect,view,flip});
   const forward=mul(camera.normal,-1),right=norm(cross(forward,camera.up));
   assert.ok(Number.isFinite(camera.distance)&&camera.distance>0);
   assert.ok(Math.abs(dot(camera.normal,camera.up))<1e-9);
   for(const point of corners(p.fitBounds)){
    const q=point.map((v,i)=>v-camera.target[i]),depth=camera.distance+dot(q,forward);
    assert.ok(depth>0,`${p.id} ${view} aspect ${aspect}: support behind eye`);
    const x=dot(q,right)/(.32*aspect*depth),y=dot(q,camera.up)/(.32*depth);
    assert.ok(Math.abs(x)<=.84+1e-9,`${p.id} ${view} aspect ${aspect}: horizontal crop`);
    assert.ok(Math.abs(y)<=.76+1e-9,`${p.id} ${view} aspect ${aspect}: vertical crop`);
   }
  }
 }
});

test('close framing keeps the anatomical target and explicit close distance',()=>{
 const presets=applyMainViewReview(source.presets,validateMainViewReview(sample()),donor);
 for(const p of presets){
  const plane=flowPlane(p,{offsetMm:2,rotationDeg:5,tiltDeg:-3},168.0104);
  const camera=reviewedStartingCamera(p,plane,{view:'close',aspect:.5,flip:true});
  assert.deepEqual(camera.target,plane.target);
  assert.equal(camera.distance,p.closeDistance);
 }
});

test('production support extrema fit every starting pose, including the opposite retained half',()=>{
 const catalog=validateMainViewReview(JSON.parse(readFileSync(new URL('../public/assets/main-view-qc-v3.json',import.meta.url))));
 const proof=JSON.parse(readFileSync(new URL('../docs/main-view-qc-v3/support-hulls.json',import.meta.url)));
 const presets=applyMainViewReview(source.presets,catalog,donor);
 const poses=[['overview','overview',false],['section','section',false],['flippedOverview','overview',true],['flippedSection','section',true]];
 for(const p of presets){
  const plane=flowPlane(p,{offsetMm:0,rotationDeg:0,tiltDeg:0},168.0104);
  for(const [key,view,flipped] of poses){
   const flip=Boolean(p.flip)!==flipped,points=p.fitPoints[key],checked=proof[p.id].poses[key];
   assert.equal(points.length,checked.criticalVertices,`${p.id} ${key}: proof/catalog count`);
   assert.ok(checked.fullHullVertices>=points.length);
   assert.deepEqual(checked.exactSupportVerifiedAspects,[.2,8]);
   for(const point of points){
    const delta=point.map((v,i)=>v-plane.center[i]);
    assert.ok(dot(delta,plane.normal)*(flip?-1:1)<=2e-8,`${p.id} ${key}: point from wrong retained half`);
   }
   for(const aspect of [.2,.45,1,2,8]){
    const camera=reviewedStartingCamera(p,plane,{view,flip,aspect});
    const forward=mul(camera.normal,-1),right=norm(cross(forward,camera.up));
    for(const [actual,expected] of [[camera.normal,checked.cameraNormal],[camera.up,checked.cameraUp],[right,checked.cameraRight]]){
     assert.ok(actual.every((x,i)=>Math.abs(x-expected[i])<1e-8),`${p.id} ${key}: source proof camera basis`);
    }
    for(const point of points){
     const q=point.map((v,i)=>v-camera.target[i]),depth=camera.distance+dot(q,forward);
     assert.ok(depth>0,`${p.id} ${key}: support behind eye`);
     assert.ok(Math.abs(dot(q,right)/(.32*aspect*depth))<=.84+1e-9,`${p.id} ${key}: horizontal crop at ${aspect}`);
     assert.ok(Math.abs(dot(q,camera.up)/(.32*depth))<=.76+1e-9,`${p.id} ${key}: vertical crop at ${aspect}`);
    }
   }
  }
 }
});
