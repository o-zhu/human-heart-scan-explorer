import test from 'node:test';
import assert from 'node:assert/strict';
import {ResidentSectionSource} from '../public/resident-sections.js';
import {orthogonalFrame,worldToSource} from '../public/planes.js';
import {croppedSectionFrame} from '../public/section-layout.js';

function fixture(dimensions=[7,9,11],spacingUm=[310,320,330]){
 const [nx,ny,nz]=dimensions,data=new Uint8Array(nx*ny*nz);
 for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++)data[x+nx*(y+ny*z)]=(23*x+17*y+9*z)%256;
 return {data,meta:{dimensions,spacingUm}};
}
function expected(data,dimensions,axis,position,x,y){
 const p=Math.max(0,Math.min(1,position)),coordinate=p*(dimensions[axis]-1),lo=Math.floor(coordinate),hi=Math.min(lo+1,dimensions[axis]-1),f=coordinate-lo;
 const xyz=axis===0?[0,x,y]:axis===1?[x,0,y]:[x,y,0];
 const sample=index=>{xyz[axis]=index;return data[xyz[0]+dimensions[0]*(xyz[1]+dimensions[1]*xyz[2])];};
 const a=sample(lo),b=sample(hi);return Math.round(a*(1-f)+b*f);
}

test('resident XYZ sections preserve native source order and interpolate only along the requested normal',()=>{
 const source=new ResidentSectionSource(),{data,meta}=fixture(),original=data.slice();source.setVolume(data,meta);
 for(let axis=0;axis<3;axis++)for(const position of [-.1,0,.071,.35,.5,.825,1,1.1]){
  const result=source.get(axis,position,Math.round(Math.max(0,Math.min(1,position))*474));
  const width=axis===0?meta.dimensions[1]:meta.dimensions[0],height=axis===2?meta.dimensions[1]:meta.dimensions[2];
  assert.deepEqual([result.width,result.height],[width,height]);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)assert.equal(result.data[x+width*y],expected(data,meta.dimensions,axis,position,x,y),`axis${axis} @${position}, pixel${x},${y}`);
  assert.equal(result.position,Math.max(0,Math.min(1,position)));assert.equal(result.preview,true);assert.equal(result.resident,true);
  assert.equal(result.cleaned,false,'Support masking still follows the shared renderer setting.');
  assert.equal(result.data.length,width*height);
 }
 assert.deepEqual(data,original,'Sampling never writes into the resident measured volume.');
});

test('source-aligned requests retain every measured byte without rounding loss',()=>{
 const source=new ResidentSectionSource(),{data,meta}=fixture();source.setVolume(data,meta);
 for(let axis=0;axis<3;axis++)for(let index=0;index<meta.dimensions[axis];index++){
  const section=source.get(axis,index/(meta.dimensions[axis]-1),index);
  for(let y=0;y<section.height;y++)for(let x=0;x<section.width;x++)assert.equal(section.data[x+section.width*y],expected(data,meta.dimensions,axis,index/(meta.dimensions[axis]-1),x,y));
 }
});

test('the section frame stays at the requested physical plane with the original scan orientation',()=>{
 const source=new ResidentSectionSource(),{data,meta}=fixture(),extent=[.9,1,.8];source.setVolume(data,meta);
 for(let axis=0;axis<3;axis++)for(const position of [.2,.5,.9]){
  const section=source.get(axis,position,318),base=orthogonalFrame(axis,position,extent),frame=croppedSectionFrame(base,section);
  assert.deepEqual(frame,base,'A full resident raster retains the measured volume frame.');
  for(const [u,v]of [[0,0],[1,0],[0,1],[1,1],[.5,.5]]){
   const world=frame.center.map((value,i)=>value+(u-.5)*frame.width*frame.right[i]+(.5-v)*frame.height*frame.up[i]);
   const normalized=worldToSource(world,extent),expectedCoordinates=axis===0?[position,u,v]:axis===1?[u,position,v]:[u,v,position];
   normalized.forEach((value,i)=>assert(Math.abs(value-expectedCoordinates[i])<1e-12));
  }
  assert.equal(section.index,318,'A requested Ultra-grid index is separate from resident source resolution.');
  assert.deepEqual(section.inPlaneSpacingUm,axis===0?[320,330]:axis===1?[310,330]:[310,320]);
  assert.equal(section.normalSpacingUm,meta.spacingUm[axis]);
 }
});

test('fast skips and reversals always return the current plane without mutating a displayed earlier section',()=>{
 const source=new ResidentSectionSource(),{data,meta}=fixture([17,19,23],317.6);source.setVolume(data,meta);
 const first=source.get(1,.25,119),firstBytes=first.data.slice();
 const indices=[120,129,147,184,225,278,301,270,201,99,41,4,474,210,211,212,180,181];
 for(const axis of [1,0,2,1])for(const index of indices){
  const section=source.get(axis,index/474,index);
  assert.equal(section.index,index);assert.equal(section.position,index/474);
  assert.equal(section.data[0],expected(data,meta.dimensions,axis,index/474,0,0));
  assert.equal(section.data.at(-1),expected(data,meta.dimensions,axis,index/474,section.width-1,section.height-1));
  assert(source.cache.size<=6);assert(source.cacheBytes<=source.maxBytes);
  for(let a=0;a<3;a++)assert([...source.cache.values()].filter(item=>item.axis===a).length<=2);
 }
 assert.deepEqual(first.data,firstBytes,'An evicted result can still be safely referenced by a queued GPU frame or CT card.');
});

test('nearby exact requests reuse bounded cached arrays and changed source volumes invalidate them',()=>{
 const source=new ResidentSectionSource(),low=fixture([5,5,5],635.2),high=fixture([9,9,9],317.6);
 assert.equal(source.get(0,.5),null,'No synthetic image is invented before a source volume exists.');
 source.setVolume(low.data,low.meta);const a=source.get(0,.5,4),b=source.get(0,.75,6);
 assert.equal(source.get(0,.5,4),a);assert.equal(source.get(0,.75,6),b);
 source.setVolume(low.data,low.meta);assert.equal(source.get(0,.5,4),a,'Unchanged resident data needs no cache invalidation.');
 source.setVolume(high.data,high.meta);const updated=source.get(0,.5,4);
 assert.notEqual(updated.key,a.key);assert.notEqual(updated.data,a.data);assert.equal(updated.spacingUm,317.6);assert.equal(updated.width,9);
 source.dispose();assert.equal(source.get(0,.5),null);assert.equal(source.cache.size,0);assert.equal(source.cacheBytes,0);
});

test('a strict memory limit never retains an oversized raster, and invalid sources fail explicitly',()=>{
 const {data,meta}=fixture(),source=new ResidentSectionSource({maxBytes:20});source.setVolume(data,meta);
 assert.equal(source.get(0,.3).data.length,99);assert.equal(source.cache.size,0);assert.equal(source.cacheBytes,0);
 assert.throws(()=>source.get(3,.5),RangeError);assert.throws(()=>source.get(0,NaN),RangeError);assert.throws(()=>source.get(0,.5,-1),RangeError);
 assert.throws(()=>source.setVolume(data,{dimensions:[7,9,12],spacingUm:317.6}),TypeError);
 assert.throws(()=>source.setVolume(new Uint16Array(data),meta),TypeError);
 assert.equal(source.data,data,'Invalid replacements leave the accepted source intact.');
});
