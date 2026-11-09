import assert from 'node:assert/strict';
import test from 'node:test';
import {pickVolume} from '../public/volume-picking.js';
import {LocalSurfaceRefinementController} from '../public/local-surface-refinement.js';

function fixture(){
 const plane={center:[0,0,0],normal:[0,0,1],right:[1,0,0],up:[0,1,0],width:1,height:1};
 return {
  data:new Uint8Array(8),dimensions:[2,2,2],extent:[1,1,1],
  settings:{mode:0,threshold:.28,clipAxis:3,oblique:plane,clipFlip:0,cleanupEnabled:true,lumenCleanupEnabled:true},
  cap:{data:new Uint8Array(4).fill(255),width:2,height:2,plane,cleaned:true},
  cleanup:{dimensions:[1,1,1],data:new Uint8Array(1)},
  basis:()=>({eye:[0,0,2],forward:[0,0,-1],right:[1,0,0],up:[0,1,0]}),
  canvas:{getBoundingClientRect:()=>({width:100,height:100})},
 };
}
const pick=renderer=>pickVolume(renderer,.5,.5);
function assertCap(renderer){const hit=pick(renderer);assert.equal(hit?.cutFace,true);assert.deepEqual(hit.world,[0,0,0]);assert.equal(hit.value,1);}

test('a prepared fine cut face remains pickable where coarse support has no voxel',()=>{
 const renderer=fixture(),source=renderer.data.slice(),capSource=renderer.cap.data.slice(),support=renderer.cleanup.data.slice();
 assertCap(renderer);
 for(const cleaned of [false,undefined]){renderer.cap.cleaned=cleaned;assert.equal(pick(renderer),null,'A raw cap must still use coarse support.');}
 renderer.settings.cleanupEnabled=false;assertCap(renderer);
 assert.deepEqual(renderer.data,source);assert.deepEqual(renderer.cap.data,capSource);assert.deepEqual(renderer.cleanup.data,support);
 const fallback=fixture();fallback.cap=null;fallback.data.fill(255);
 assert.equal(pick(fallback),null,'The source-volume fallback must still use coarse support.');
});

test('reviewed packed lumen exclusions still remove a prepared cap independently of coarse support',()=>{
 const renderer=fixture(),source=renderer.cap.data.slice();
 renderer.lumenCleanup={extent:[1,1,1],fullDimensionsXYZ:[3,3,3],bitPacked:true,masks:[{
  dimensionsXYZ:[1,1,1],storageDimensionsXYZ:[1,1,1],lowerFullFineXYZ:[1,1,1],data:new Uint8Array([1]),
 }]};
 for(const cleanupEnabled of [true,false]){renderer.settings.cleanupEnabled=cleanupEnabled;assert.equal(pick(renderer),null);}
 renderer.settings.lumenCleanupEnabled=false;assertCap(renderer);
 assert.deepEqual(renderer.cap.data,source,'Picking must not edit the measured cap.');
});

test('the real local exclusion sampler also removes a prepared cap and restores it when inactive',()=>{
 const renderer=fixture(),source=renderer.cap.data.slice();let active=true;
 renderer.localSurfaceRefinement=Object.assign(Object.create(LocalSurfaceRefinementController.prototype),{
  renderer,active:()=>active,current:{pieces:[{mask:{
   dimensionsXYZ:[1,1,1],storageDimensionsXYZ:[1,1,1],lowerFullFineXYZ:[948,948,1058],data:new Uint8Array([1]),
  }}]},
 });
 for(const cleanupEnabled of [true,false]){renderer.settings.cleanupEnabled=cleanupEnabled;assert.equal(pick(renderer),null);}
 active=false;assertCap(renderer);
 assert.deepEqual(renderer.cap.data,source,'Picking must not edit the measured cap.');
});
