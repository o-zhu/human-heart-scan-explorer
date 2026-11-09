/** Exact atlas rasters coexist with the free-probe coplanar reuse contract. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {UltraVolumeSource} from '../public/ultra-volume.js';
import {FineVolumeBackend} from '../public/ultra-volume-backend.js';
import {finePlaneKey,sameFinePlane,reusableFineSection,fineSourceExtent,validFinePlane} from '../public/ultra-volume-core.js';
import {EchoModule} from '../public/echo.js';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const broad={center:[0,0,0],right:[1,0,0],up:[0,1,0],normal:[0,0,1],width:1,height:1};
const requested={center:[.0625,.0625,0],right:[-1,0,0],up:[0,-1,0],normal:[0,0,1],width:.5,height:.5};
const scalar=(x,y,z)=>30+7*x+5*y+3*z;
const brick=new Uint8Array(9**3);
for(let z=0;z<9;z++)for(let y=0;y<9;y++)for(let x=0;x<9;x++)brick[x+9*(y+9*z)]=scalar(x,y,z);
const encoded=new Uint8Array(gzipSync(brick));
const preparedBytes=new Uint8Array([11,22,33,44]),preparedPixels=new Uint8Array(9*9);
for(let row=0;row<9;row++)for(let col=0;col<9;col++)preparedPixels[row*9+col]=scalar(col,4,8-row);
const record={id:'broad',plane:broad,width:9,height:9,url:'./prepared.webp',bytes:preparedBytes.length,
 sha256:sha(preparedBytes),pixelSha256:sha(preparedPixels),spacingUmXY:[1000,1000]};
const manifest={schemaVersion:1,codec:'gzip-u8-zyx-positive-halo',brickSize:8,storedEdge:9,decodedBrickBytes:9**3,
 sourceShapeXYZ:[9,9,9],sourceOriginXYZ:[0,0,0],fullDimensionsXYZ:[9,9,9],sourceSpacingUm:1000,longestMm:8,
 brickCountsXYZ:[1,1,1],assetBaseUrl:'/fine/',blocks:{0:{path:'0.gz',bytes:encoded.length,sha256:sha(encoded),rawSha256:sha(brick)}},preparedPlanes:[record]};
const result=(plane=requested,value=110)=>({data:new Uint8Array(25).fill(value),width:5,height:5,plane:structuredClone(plane),spacingUm:1000,sourceSpacingUm:1000,complete:true,cleaned:true});

function backendFixture(){
 const calls=[];
 const backend=new FineVolumeBackend(manifest,{baseUrl:'https://test/',
  fetcher:async url=>{calls.push(new URL(url).pathname);return new Response(new URL(url).pathname==='/prepared.webp'?preparedBytes:encoded);},
  decodePrepared:async()=>preparedPixels.slice(),
 });
 return {backend,calls};
}

test('the production TG midpapillary plane has an intentionally reusable but different prepared raster',()=>{
 const m=JSON.parse(readFileSync(new URL('../public/assets/ultra-volume-v7.json',import.meta.url)));
 const frame=JSON.parse(readFileSync(new URL('../public/assets/tee-atlas/plane-fit-v2.json',import.meta.url))).views.tgpapillary.frame;
 const plane=EchoModule.prototype.getPlane.call({frames:{tgpapillary:frame},state:{offsetMm:0,rotationDeg:0,tiltDeg:0},longestMm:168.0104,frameKey:()=>'tgpapillary'});
 const prepared=m.preparedPlanes.find(p=>p.id==='short-axis');
 const raster=Object.fromEntries(['center','right','up','normal','width','height'].map(key=>[key,plane[key]]));
 assert.deepEqual(validFinePlane(plane),raster,'The backend must not silently normalize or reorient any physical raster field; acquisition metadata is not part of the canonical sampler plane');
 assert.equal(reusableFineSection(prepared.plane,plane,fineSourceExtent(m)),true);
 assert.equal(sameFinePlane(prepared.plane,plane,1e-8),false);
});

test('the backend preserves free-probe reuse but genuinely resamples an exact shifted and reversed crop',async()=>{
 const {backend,calls}=backendFixture();
 const reused=await backend.samplePlane(requested);
 assert.equal(reused.preparedPlaneId,'broad');assert.deepEqual(reused.plane,broad);
 assert.deepEqual(reused.data,preparedPixels);assert.deepEqual(calls,['/prepared.webp']);
 const exact=await backend.samplePlane(requested,{exactRaster:true});
 assert.equal(exact.preparedPlaneId,undefined);assert.deepEqual(exact.plane,requested);
 assert.equal(exact.width,5);assert.equal(exact.height,5);assert.equal(exact.brickCount,1);
 for(let row=0;row<5;row++)for(let col=0;col<5;col++){
  assert.equal(exact.data[row*5+col],Math.round(scalar(6.5-col,4,2.5+row)),'New pixels must come from the requested source positions');
 }
 assert.deepEqual(calls,['/prepared.webp','/fine/0.gz']);
 const preparedExact=await backend.samplePlane(broad,{exactRaster:true});
 assert.equal(preparedExact.preparedPlaneId,'broad');assert.deepEqual(preparedExact.data,preparedPixels);
 assert.equal(calls.length,2,'An identical prepared raster remains reusable');
});

test('exact backend matching uses the stricter 1e-8 raster tolerance',async()=>{
 const {backend}=backendFixture(),near={...broad,width:broad.width+5e-8};
 assert.equal(sameFinePlane(broad,near),true);assert.equal(sameFinePlane(broad,near,1e-8),false);
 const exact=await backend.samplePlane(near,{exactRaster:true});
 assert.equal(exact.preparedPlaneId,undefined);assert.deepEqual(exact.plane,near);
});

function serviceFixture(){
 const messages=[];let worker;
 const source=new UltraVolumeSource({activity:null,fetcher:async()=>Response.json(manifest),workerFactory:()=>worker={
  terminate(){},postMessage(message){messages.push(message);if(message.type==='init')queueMicrotask(()=>worker.onmessage({data:{type:'ready'}}));},
 }});
 const samples=()=>messages.filter(m=>m.type==='sample');
 const finish=(message,value)=>worker.onmessage({data:{type:'result',id:message.id,result:{...value,data:value.data.slice().buffer}}});
 return {source,samples,finish};
}

test('an exact service request rejects a coplanar image even under its direct cache key',async()=>{
 const e=serviceFixture();
 try{
  const first=e.source.samplePlane(requested);await tick();
  assert.equal(e.samples()[0].exactRaster,false);
  e.finish(e.samples()[0],result(broad,91));const old=await first;
  assert.equal(e.source.results.get(finePlaneKey(requested)+'|1000'),old,'Free-probe reuse can populate this exact request key with a broader image');
  e.source.remember(finePlaneKey(broad)+'|1000',old);
  const exactPending=e.source.samplePlane(requested,{exactRaster:true});await tick();
  assert.equal(e.samples().length,2,'Neither direct-key nor alternate coplanar cache entries may satisfy an exact raster');
  assert.equal(e.samples()[1].exactRaster,true);
  e.finish(e.samples()[1],result(requested,173));const exact=await exactPending;
  assert.deepEqual(exact.plane,requested);assert.equal(exact.data[0],173);
  const local=await e.source.samplePlane(requested,{exactRaster:true,spacingUm:2000});
  assert.equal(e.samples().length,2,'An identical, finer cached raster serves a coarser request');
  assert.equal(local.data,exact.data);assert.deepEqual(local.plane,requested);
  const free=await e.source.samplePlane({...requested,center:[-.03,.02,0],width:.4,height:.4});
  assert.equal(e.samples().length,2,'Default free-probe requests retain coplanar reuse');
  assert.deepEqual(free.plane,broad);assert.equal(free.data,old.data);
 }finally{e.source.destroy();}
});

test('the actual worker forwards exact-raster intent and leaves default reuse disabled only when requested',async()=>{
 const previousSelf=globalThis.self,originalSample=FineVolumeBackend.prototype.samplePlane,seen=[];
 globalThis.self={postMessage(){}};
 FineVolumeBackend.prototype.samplePlane=async function(plane,options){seen.push(options.exactRaster);return result(plane);};
 try{
  await import('../public/ultra-volume-worker.js?exact-raster-regression');
  await self.onmessage({data:{type:'init',manifest,baseUrl:'https://test/'}});
  await self.onmessage({data:{type:'sample',id:1,plane:requested,exactRaster:true}});
  await self.onmessage({data:{type:'sample',id:2,plane:requested}});
  assert.deepEqual(seen,[true,false]);
 }finally{FineVolumeBackend.prototype.samplePlane=originalSample;if(previousSelf===undefined)delete globalThis.self;else globalThis.self=previousSelf;}
});
