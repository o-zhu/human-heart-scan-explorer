import test from 'node:test';
import assert from 'node:assert/strict';
import {VolumeRenderer} from '../public/renderer.js';
import {FineSurfacePass} from '../public/fine-surface.js';
import {activeCoronaryField,validateCoronaryField} from '../public/coronary-rendering.js';
import {pickVolume} from '../public/volume-picking.js';

function fixture(){
 const d=[9,9,9],data=new Uint8Array(729).fill(255),derived=new Uint8Array(729);
 for(let z=0;z<9;z++)for(let y=4;y<9;y++)for(let x=0;x<9;x++)derived[x+9*(y+9*z)]=255;
 const meta={donorId:'ladaf-2021-17',dimensions:d,extent:[1,1,1],threshold:.5,sourceSpacingUm:317.6,rawSha256:'a'.repeat(64)};
 const renderer=Object.assign(Object.create(VolumeRenderer.prototype),{
  donorId:meta.donorId,coronaryWorkspace:'reconstruction',data,dimensions:d,extent:[1,1,1],
  settings:{mode:0,threshold:.28,clipAxis:-1,clipPosition:.5,clipFlip:0,cleanupEnabled:true,showPlanes:0,coronaryReveal:false},
  canvas:{getBoundingClientRect:()=>({width:100,height:100})},
  basis:()=>({eye:[0,0,2],forward:[0,0,-1],right:[1,0,0],up:[0,1,0]}),
  coronaryField:{data:derived,meta,texture:{id:'prior'}},cap:null,
 });
 return {renderer,data,derived,meta};
}

test('prepared field is restricted to matching donor/extent and Reconstruction or Echo surface views',()=>{
 const {renderer:r}=fixture();assert.equal(activeCoronaryField(r),null);
 r.settings.coronaryReveal=true;assert.equal(activeCoronaryField(r),r.coronaryField);
 r.coronaryWorkspace='echo';assert.equal(activeCoronaryField(r),r.coronaryField);
 for(const workspace of ['probe','tee','clinical',undefined]){r.coronaryWorkspace=workspace;assert.equal(activeCoronaryField(r),null);}
 r.coronaryWorkspace='reconstruction';r.settings.mode=1;assert.equal(activeCoronaryField(r),null);
 r.settings.mode=0;r.donorId='s-20-29';assert.equal(activeCoronaryField(r),null);
 r.donorId='ladaf-2021-17';r.extent=[1,.99,1];assert.equal(activeCoronaryField(r),null);
});

test('first-intersection picking follows the visible prepared surface and restores the original hit',()=>{
 const {renderer:r,data}=fixture(),before=data.slice();
 const initial=pickVolume(r,.5,.5);assert(initial.world[2]>.49);
 r.settings.coronaryReveal=true;const prepared=pickVolume(r,.5,.5);
 assert(prepared.world[2]>.05&&prepared.world[2]<.08);
 assert.equal(prepared.method,'prepared-coronary-surface');assert.equal(prepared.value,1,'Readout retains original source value.');
 assert.equal(prepared.labelId,initial.labelId);
 r.settings.coronaryReveal=false;assert.deepEqual(pickVolume(r,.5,.5),initial);assert.deepEqual(data,before);
});

test('a source CT cut face is retained even where the prepared surface suppresses covering tissue',()=>{
 const {renderer:r}=fixture();r.settings.coronaryReveal=true;r.settings.clipAxis=3;
 r.settings.oblique={normal:[0,0,1],center:[0,0,.25],right:[1,0,0],up:[0,1,0],width:1,height:1};
 const hit=pickVolume(r,.5,.5);assert.equal(hit.cutFace,true);assert.equal(hit.value,1);assert.equal(hit.world[2],.25);
 r.cap={width:2,height:2,data:new Uint8Array(4).fill(180),cleaned:true,plane:r.settings.oblique};
 assert.equal(pickVolume(r,.5,.5).value,180/255);
});

test('finalized mesh yields without discarding its preference or geometry',()=>{
 const {renderer:r}=fixture(),pass={enabled:true,manifest:{threshold:.28,extent:[1,1,1]}};
 assert.equal(FineSurfacePass.prototype.activeFor.call(pass,r),true);
 r.settings.coronaryReveal=true;assert.equal(FineSurfacePass.prototype.activeFor.call(pass,r),false);
 assert.equal(pass.enabled,true);assert.equal(r.settings.threshold,.28);
 r.settings.coronaryReveal=false;assert.equal(FineSurfacePass.prototype.activeFor.call(pass,r),true);
});

test('invalid identity, shape or physical extent is rejected before allocating a texture',()=>{
 const {renderer:r,derived,meta}=fixture();
 for(const patch of [{donorId:'s-20-28'},{dimensions:[9,9,8]},{extent:[1,.99,1]},{threshold:NaN}]){
  assert.throws(()=>validateCoronaryField(r,derived,{...meta,...patch}));
 }
 assert.throws(()=>validateCoronaryField(r,new Uint8Array(20),meta));
});

test('GL upload commits atomically and failed allocation preserves the complete prior view',()=>{
 const {renderer:r,derived,meta}=fixture(),previous=r.coronaryField,deleted=[];
 const source=r.data,cap=r.cap,settings=structuredClone(r.settings);let error=1285;
 r.gl={MAX_3D_TEXTURE_SIZE:1,NO_ERROR:0,TEXTURE0:0,TEXTURE_3D:3,UNPACK_ALIGNMENT:4,
  getParameter:()=>2048,createTexture:()=>({id:'next'}),activeTexture(){},bindTexture(){},pixelStorei(){},
  texParameteri(){},texImage3D(){},getError:()=>error,deleteTexture:t=>deleted.push(t)};
 assert.throws(()=>r.setCoronaryData(derived.slice(),meta),/could not prepare/);
 assert.equal(r.coronaryField,previous);assert.deepEqual(deleted,[{id:'next'}]);
 error=0;r.setCoronaryData(derived.slice(),meta);
 assert.notEqual(r.coronaryField,previous);assert.equal(deleted[1],previous.texture);
 assert.equal(r.data,source);assert.equal(r.cap,cap);assert.deepEqual(r.settings,settings);
});
