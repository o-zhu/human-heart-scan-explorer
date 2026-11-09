import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {UltraVolumeSource} from '../public/ultra-volume.js';
import {FineVolumeBackend} from '../public/ultra-volume-backend.js';
const defer=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};};
const tick=()=>new Promise(r=>setImmediate(r));
const plane={center:[0,0,0],right:[1,0,0],up:[0,1,0],width:.1,height:.1};
const sha=data=>createHash('sha256').update(data).digest('hex');

test('Destroy during metadata cannot create an orphan worker',async()=>{
 const pending=defer();let workers=0;
 const source=new UltraVolumeSource({fetcher:()=>pending.promise,workerFactory:()=>{workers++;return {};}});
 const sampling=source.samplePlane(plane);source.destroy();pending.resolve(new Response('{}'));
 await assert.rejects(sampling,{name:'AbortError'});assert.equal(workers,0);
});
test('Destroy during worker startup settles pending callers',async()=>{
 let stopped=0,started=defer();const worker={terminate(){stopped++;},postMessage(){started.resolve();}};
 const source=new UltraVolumeSource({fetcher:async()=>new Response('{}'),workerFactory:()=>worker});
 const sampling=source.samplePlane(plane);await started.promise;source.destroy();
 await assert.rejects(sampling,{name:'AbortError'});assert.ok(stopped>0);
});
test('Concurrent prepared loads account for the retained image once',async()=>{
 const bytes=new Uint8Array([1,2,3,4]),gate=defer();let decodes=0;
 const record={id:'test',plane,width:2,height:2,url:'./test.webp',bytes:4,sha256:sha(bytes),pixelSha256:sha(bytes),spacingUmXY:[79.4,79.4]};
 const manifest={schemaVersion:1,codec:'gzip-u8-zyx-positive-halo',storedEdge:2,brickSize:1,decodedBrickBytes:8,assetBaseUrl:'/fine/',preparedPlanes:[record]};
 const backend=new FineVolumeBackend(manifest,{baseUrl:'https://heart.example/',fetcher:async()=>new Response(bytes),decodePrepared:async()=>{decodes++;if(decodes===2)gate.resolve();await gate.promise;return bytes.slice();}});
 await Promise.all([backend.samplePlane(plane),backend.samplePlane(plane)]);
 assert.equal(backend.prepared.size,1);assert.equal(backend.preparedBytes,4);
});
test('Canceled decoding cannot populate the prepared cache',async()=>{
 const bytes=new Uint8Array([1,2,3,4]),controller=new AbortController();
 const record={id:'test',plane,width:2,height:2,url:'./test.webp',bytes:4,sha256:sha(bytes),pixelSha256:sha(bytes)};
 const manifest={schemaVersion:1,codec:'gzip-u8-zyx-positive-halo',storedEdge:2,brickSize:1,decodedBrickBytes:8,assetBaseUrl:'/fine/',preparedPlanes:[record]};
 const backend=new FineVolumeBackend(manifest,{baseUrl:'https://heart.example/',fetcher:async()=>new Response(bytes),decodePrepared:async()=>{controller.abort();return bytes;}});
 await assert.rejects(backend.samplePlane(plane,{signal:controller.signal}),{name:'AbortError'});assert.equal(backend.preparedBytes,0);
});
test('Late canceled worker output cannot replace the newer completed plane',async()=>{
 const requests=[];let worker;
 const source=new UltraVolumeSource({fetcher:async()=>new Response('{}'),workerFactory:()=>worker={terminate(){},postMessage(m){requests.push(m);if(m.type==='init')queueMicrotask(()=>worker.onmessage({data:{type:'ready'}}));}}});
 const a=new AbortController(),first=source.samplePlane(plane,{signal:a.signal});await tick();a.abort();await assert.rejects(first,{name:'AbortError'});
 const shifted={...plane,center:[.01,0,0]},second=source.samplePlane(shifted);await tick();const samples=requests.filter(m=>m.type==='sample');
 const send=(id,value,p)=>worker.onmessage({data:{type:'result',id,result:{data:new Uint8Array([value]).buffer,width:1,height:1,plane:p,complete:true}}});
 send(samples[1].id,9,shifted);const current=await second;send(samples[0].id,3,plane);
 assert.equal(current.data[0],9);assert.equal(source.results.size,1);assert.equal(source.getStatus().active,0);source.destroy();
});
