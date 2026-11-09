import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {FineVolumeBackend,fineTransferPolicy} from '../public/ultra-volume-backend.js';
import {UltraVolumeSource} from '../public/ultra-volume.js';
import {sameFineSection,reusableFineSection,planFinePlane} from '../public/ultra-volume-core.js';
import {validFineProbeSlice,createProbePlaneSampler,computeProbeFrame} from '../public/probe-acoustics.js';
import {probeCapPlane,volumeGeometry,sanitizeProbeState} from '../public/probe-geometry.js';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const plane={center:[0,0,0],right:[1,0,0],up:[0,1,0],normal:[0,0,1],width:1.01,height:1.01};
const angle=Math.PI/4,rotated={...plane,right:[Math.cos(angle),Math.sin(angle),0],up:[-Math.sin(angle),Math.cos(angle),0],width:Math.SQRT2+.01,height:Math.SQRT2+.01};
const fullExtent=[1,1,1];

test('coplanarity distinguishes a new direction from a new physical section',()=>{
 assert.equal(sameFineSection(plane,rotated),true);
 assert.equal(sameFineSection(plane,{...rotated,center:[0,0,.00001]}),false,'A parallel shifted section is different');
 assert.equal(sameFineSection(plane,{...rotated,up:[-Math.sin(angle),Math.cos(angle),.001]}),false,'An out-of-plane tilt is different');
 assert.equal(reusableFineSection(plane,rotated),false,'Rotated corners do not fit without an independent source-box coverage proof');
 assert.equal(reusableFineSection(plane,rotated,fullExtent),true);
 assert.equal(reusableFineSection({...plane,width:.5},rotated,fullExtent),false,'A cropped image cannot cover the full source');
 assert.equal(reusableFineSection({...plane,center:[.3,0,0]},rotated,fullExtent),false,'Coverage must include both sides of the source');
 assert.equal(reusableFineSection(plane,{...rotated,width:.5,height:.5}),true,'A genuinely contained section needs no full-volume assumption');
});

test('prepared native pixels serve in-plane sweeps in their original coordinates, without any brick fetch',async()=>{
 const pixels=new Uint8Array([10,20,30,40]);let reads=0,decodes=0;
 const record={id:'native',plane,width:2,height:2,url:'./native.webp',bytes:4,sha256:sha(pixels),pixelSha256:sha(pixels),spacingUmXY:[79.4,79.4]};
 const manifest={schemaVersion:1,codec:'gzip-u8-zyx-positive-halo',storedEdge:2,brickSize:1,decodedBrickBytes:8,assetBaseUrl:'/fine/',fullDimensionsXYZ:[3,3,3],sourceSpacingUm:79.4,preparedPlanes:[record]};
 const backend=new FineVolumeBackend(manifest,{baseUrl:'https://heart.example/',fetcher:async url=>{assert.equal(new URL(url).pathname,'/native.webp');reads++;return new Response(pixels);},decodePrepared:async bytes=>{decodes++;return bytes.slice();}});
 const first=await backend.samplePlane(plane),sweep=await backend.samplePlane(rotated);
 assert.equal(reads,1);assert.equal(decodes,1);assert.equal(sweep.data,first.data);assert.deepEqual(sweep.plane.right,plane.right);assert.deepEqual(sweep.plane.up,plane.up);
 assert.notDeepEqual(sweep.plane.right,rotated.right);assert.equal(sweep.spacingUm,79.4);assert.equal(sweep.preparedPlaneId,'native');
 assert.equal(validFineProbeSlice(sweep,rotated,79.4,{extent:fullExtent}),true);
 assert.equal(validFineProbeSlice(sweep,{...rotated,center:[0,0,.001]},79.4,{extent:fullExtent}),false);
 assert.equal(validFineProbeSlice({...sweep,plane:{...sweep.plane,width:.3}},rotated,79.4,{extent:fullExtent}),false);
 const sample=createProbePlaneSampler(sweep,{geometry:{longestMm:100,extent:fullExtent}},true);
 assert.equal(sample(0,0,0),25);assert.ok(sample(-25,25,0)<sample(25,-25,0),'Source landmarks retain their world positions');
});

test('the main fine cache returns a coplanar native image without another worker request',async()=>{
 let worker;const sent=[];
 const source=new UltraVolumeSource({activity:null,fetcher:async()=>new Response(JSON.stringify({sourceSpacingUm:79.4,fullDimensionsXYZ:[3,3,3]})),workerFactory:()=>worker={terminate(){},postMessage(message){sent.push(message);if(message.type==='init')queueMicrotask(()=>worker.onmessage({data:{type:'ready'}}));}}});
 const initial=source.samplePlane(plane);await tick();const request=sent.find(message=>message.type==='sample');
 const pixels=new Uint8Array([1,2,3,4]);worker.onmessage({data:{type:'result',id:request.id,result:{data:pixels.buffer,width:2,height:2,plane,spacingUm:79.4,sourceSpacingUm:79.4,complete:true,cleaned:true}}});
 const first=await initial,reused=await source.samplePlane(rotated);
 assert.equal(reused.data,first.data);assert.equal(sent.filter(message=>message.type==='sample').length,1);assert.deepEqual(reused.plane.right,plane.right);assert.equal(source.results.size,1);
 const controller=new AbortController(),moved=source.samplePlane({...rotated,center:[0,0,.001]},{signal:controller.signal});await tick();assert.equal(sent.filter(message=>message.type==='sample').length,2);controller.abort();await assert.rejects(moved,{name:'AbortError'});source.destroy();
});

test('an insecure context reports the integrity requirement before downloading fine data',async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');let fetches=0,workers=0;
 const source=new UltraVolumeSource({activity:null,fetcher:async()=>{fetches++;return new Response('{}');},workerFactory:()=>{workers++;return {};}});
 try{
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:{}});
  await assert.rejects(source.samplePlane(plane),/requires HTTPS or localhost/);assert.equal(fetches,0);assert.equal(workers,0);
 }finally{Object.defineProperty(globalThis,'crypto',descriptor);source.destroy();}
});

test('the acoustic frame uses the accepted pose with the cached image coordinate frame',async()=>{
 const meta={dimensions:[65,65,65],spacingUm:1000},geometry=volumeGeometry(meta),state=sanitizeProbeState({depthMm:100,originMm:[0,60,0],contactLocked:false}),pose={originMm:[0,60,0],right:[1,0,0],beam:[0,-1,0],up:[0,1,0],normal:[0,0,1]},original=probeCapPlane(pose,geometry);
 const turned={...pose,right:[Math.cos(angle),Math.sin(angle),0],beam:[Math.sin(angle),-Math.cos(angle),0],up:[-Math.sin(angle),Math.cos(angle),0]};
 const data=Uint8Array.from({length:129*129},(_,i)=>Math.round((i%129)/128*255));
 const fineSlice={data,width:129,height:129,plane:original,spacingUm:79.4,sourceSpacingUm:79.4,complete:true,cleaned:true};
 const source={data:new Uint8Array(1),dimensions:meta.dimensions,meta,geometry};
 const frame=await computeProbeFrame(source,{id:1,version:1,workKey:'sweep',pose:turned,state,fineSlice,fineSpacingUm:79.4,width:640,beams:64,samples:320});
 assert.equal(frame.cap,data);assert.equal(frame.plane,original);assert.equal(frame.pose,turned);assert.equal(frame.workKey,'sweep');assert.equal(frame.fine,true);assert.ok(frame.stats.tissueFraction>0);
});

function brickFixture(){
 const manifest={schemaVersion:1,codec:'gzip-u8-zyx-positive-halo',brickSize:2,storedEdge:3,decodedBrickBytes:27,assetBaseUrl:'/fine/',sourceSpacingUm:1000,longestMm:7,fullDimensionsXYZ:[8,2,8],sourceShapeXYZ:[8,2,8],sourceOriginXYZ:[0,0,0],brickCountsXYZ:[4,1,4],blocks:{}};
 const bytes=new Map();
 for(let id=0;id<16;id++){
  const raw=new Uint8Array(27).fill(25+id*5),encoded=gzipSync(raw),path=`${id}.gz`;
  manifest.blocks[String(id)]={path,bytes:encoded.length,sha256:sha(encoded),rawSha256:sha(raw)};bytes.set(`/fine/${path}`,encoded);
 }
 const cut={...plane,width:1,height:1};return {manifest,bytes,plane:cut};
}

test('parallel foreground and quiet warming retain source pixels and respect distinct limits',async()=>{
 const fixture=brickFixture();let active=0,peak=0,reads=0;
 const backend=new FineVolumeBackend(fixture.manifest,{baseUrl:'https://heart.example/',transferPolicy:{foreground:12,background:3},fetcher:async(url,{signal})=>{
  active++;peak=Math.max(peak,active);reads++;
  try{await new Promise(resolve=>setTimeout(resolve,4));signal.throwIfAborted();return new Response(fixture.bytes.get(new URL(url).pathname));}finally{active--;}
 }});
 const fast=await backend.samplePlane(fixture.plane);assert.ok(peak>4&&peak<=12);assert.equal(reads,16);assert.equal(backend.protectedBlocks.size,0);
 const serial=new FineVolumeBackend(fixture.manifest,{baseUrl:'https://heart.example/',transferPolicy:{foreground:1,background:1},fetcher:async url=>new Response(fixture.bytes.get(new URL(url).pathname))});
 const reference=await serial.samplePlane(fixture.plane);assert.deepEqual(fast.data,reference.data);assert.ok(backend.bytes<=backend.limit);
 backend.cache.clear();backend.bytes=0;peak=0;reads=0;
 await backend.warmPlane(fixture.plane,{localOnly:false,paddingMm:0});assert.ok(peak>1&&peak<=3);assert.equal(reads,16);
 const warmReads=reads;await backend.samplePlane(fixture.plane);assert.equal(reads,warmReads,'Warmed source does not fetch again');
});

test('failed brick verification cancels sibling loads and releases the active-plane reservation',async()=>{
 const fixture=brickFixture();let active=0,aborted=0;
 const backend=new FineVolumeBackend(fixture.manifest,{baseUrl:'https://heart.example/',fetcher:async(url,{signal})=>{
  active++;try{
   if(new URL(url).pathname.endsWith('/5.gz'))return new Response('bad',{status:503});
   await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,20);signal.addEventListener('abort',()=>{clearTimeout(timer);aborted++;reject(new DOMException('Stopped','AbortError'));},{once:true});});
   return new Response(fixture.bytes.get(new URL(url).pathname));
  }finally{active--;}
 }});
 await assert.rejects(backend.samplePlane(fixture.plane),/returned 503/);assert.equal(active,0);assert.ok(aborted>0);assert.equal(backend.protectedBlocks.size,0);
});

test('active source blocks survive unrelated cache pressure while the memory bound stays strict',()=>{
 const {manifest,plane:cut}=brickFixture(),backend=new FineVolumeBackend(manifest,{baseUrl:'https://heart.example/',decodedLimit:27*3}),plan=planFinePlane(manifest,cut),a=plan.blocks[0],b=plan.blocks[1],c=plan.blocks[2];
 backend.remember(a.id,new Uint8Array(27));backend.remember(b.id,new Uint8Array(27));backend.remember('unrelated',new Uint8Array(27));
 const release=backend.protect([a,b]);backend.remember(c.id,new Uint8Array(27));assert.ok(backend.cache.has(a.id)&&backend.cache.has(b.id));assert.equal(backend.cache.has('unrelated'),false);assert.ok(backend.bytes<=backend.limit);release();assert.equal(backend.protectedBlocks.size,0);
 assert.deepEqual(fineTransferPolicy({memory:8,connection:{}}),{foreground:12,background:3});
 assert.deepEqual(fineTransferPolicy({memory:2,connection:{}}),{foreground:2,background:1});
 assert.deepEqual(fineTransferPolicy({memory:8,connection:{saveData:true}}),{foreground:2,background:1});
 assert.deepEqual(fineTransferPolicy({memory:8,connection:{effectiveType:'3g'}}),{foreground:4,background:1});
});
