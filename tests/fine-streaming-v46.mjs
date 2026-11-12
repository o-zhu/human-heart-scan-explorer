import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {FineBrickQueue} from '../public/fine-brick-queue.js';
import {FineVolumeBackend} from '../public/ultra-volume-backend.js';
import {UltraVolumeSource} from '../public/ultra-volume.js';
import {planFinePlane} from '../public/ultra-volume-core.js';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const abort=()=>new DOMException('New plane','AbortError');
const plane={center:[0,0,0],right:[1,0,0],up:[0,1,0],normal:[0,0,1],width:1,height:1};
function fixture(){
 const manifest={schemaVersion:1,codec:'gzip-u8-zyx-positive-halo',brickSize:2,storedEdge:3,decodedBrickBytes:27,assetBaseUrl:'/fine/',sourceSpacingUm:1000,longestMm:7,fullDimensionsXYZ:[8,2,8],sourceShapeXYZ:[8,2,8],sourceOriginXYZ:[0,0,0],brickCountsXYZ:[4,1,4],blocks:{}},bytes=new Map();
 for(let id=0;id<16;id++){const raw=Uint8Array.from({length:27},(_,i)=>(i*13+id*5)%256),encoded=gzipSync(raw),path=`${id}.gz`;manifest.blocks[String(id)]={path,bytes:encoded.length,sha256:sha(encoded),rawSha256:sha(raw)};bytes.set(`/fine/${path}`,encoded);}
 return {manifest,bytes};
}
test('superseded consumers share started work while queued obsolete transfers are removed',async()=>{
 const queue=new FineBrickQueue({limit:2}),starts=[],complete=new Map();
 const load=key=>signal=>new Promise((resolve,reject)=>{starts.push(key);complete.set(key,resolve);signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
 const old=new AbortController(),first=queue.request('a',load('a'),{signal:old.signal,retainOnAbort:true}),second=queue.request('b',load('b'),{signal:old.signal,retainOnAbort:true}),obsolete=queue.request('obsolete',load('obsolete'),{signal:old.signal,retainOnAbort:true});
 const errors=Promise.allSettled([first,second,obsolete]);await delay(0);old.abort(abort());await errors;
 const successor=queue.request('a',load('duplicate'));
 const newest=queue.request('new',load('new'));
 assert.deepEqual(starts,['a','b']);complete.get('a')(11);assert.equal(await successor,11);await delay(0);
 assert.deepEqual(starts,['a','b','new']);complete.get('new')(22);complete.get('b')(33);assert.equal(await newest,22);await delay(0);
 assert.equal(queue.active,0);assert.equal(queue.items.size,0);assert.equal(queue.peak,2);assert.equal(queue.shared,1);
});
test('one canceled subscriber cannot cancel another plane sharing its source brick',async()=>{
 const queue=new FineBrickQueue({limit:1});let finish,physicalSignal;
 const a=new AbortController(),first=queue.request('shared',signal=>{physicalSignal=signal;return new Promise(resolve=>finish=resolve);},{signal:a.signal});
 const next=queue.request('shared',()=>assert.fail('Duplicate physical read'));await delay(0);a.abort(abort());await assert.rejects(first,{name:'AbortError'});assert.equal(physicalSignal.aborted,false);finish(42);assert.equal(await next,42);assert.equal(queue.active,0);
});
test('stalled headers or decodes time out once, retry once and release all work',async()=>{
 const queue=new FineBrickQueue({limit:1,timeoutMs:12,retries:1});let attempts=0;
 await assert.rejects(queue.request('stalled',()=>{attempts++;return new Promise(()=>{});}),{name:'TimeoutError'});
 assert.equal(attempts,2);assert.equal(queue.active,0);assert.equal(queue.items.size,0);assert.equal(queue.timeouts,2);
 const value=await queue.request('recovered',()=>Promise.resolve(7));assert.equal(value,7);
});
test('successor planes reuse partial source transfers; pixels match an independent serial sample',async()=>{
 const {manifest,bytes}=fixture();let starts=0,networkActive=0,peak=0;
 const backend=new FineVolumeBackend(manifest,{baseUrl:'https://heart.example/',transferPolicy:{foreground:4,background:1},fetcher:async(url,{signal})=>{
  starts++;networkActive++;peak=Math.max(peak,networkActive);
  try{await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,15);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason);},{once:true});});return new Response(bytes.get(new URL(url).pathname));}finally{networkActive--;}
 }});
 const a=new AbortController(),old=backend.samplePlane(plane,{signal:a.signal,retainTransfers:true});const oldFailure=assert.rejects(old,{name:'AbortError'});await delay(4);a.abort(abort());await oldFailure;
 const current=await backend.samplePlane(plane,{retainTransfers:true});
 const reference=new FineVolumeBackend(manifest,{baseUrl:'https://heart.example/',transferPolicy:{foreground:1,background:1},fetcher:async url=>new Response(bytes.get(new URL(url).pathname))});
 assert.deepEqual(current.data,(await reference.samplePlane(plane)).data);assert.equal(starts,16,'Each source block transfers only once despite interrupted first pose');assert.equal(peak,4);assert.equal(backend.getStatus().activeBrickTransfers,0);assert.ok(backend.getStatus().sharedBrickTransfers>0);assert.equal(backend.protectedBlocks.size,0);
});
test('cache-only live sampling never downloads missing bricks and never emits partial fine pixels',async()=>{
 const {manifest,bytes}=fixture();let reads=0;
 const backend=new FineVolumeBackend(manifest,{baseUrl:'https://heart.example/',fetcher:async url=>{reads++;return new Response(bytes.get(new URL(url).pathname));}});
 assert.equal(await backend.samplePlane(plane,{residentOnly:true}),null);assert.equal(reads,0);
 const complete=await backend.samplePlane(plane);const downloaded=reads;
 const cached=await backend.samplePlane(plane,{residentOnly:true});assert.deepEqual(cached.data,complete.data);assert.equal(reads,downloaded);
 const first=planFinePlane(manifest,plane).blocks[0];backend.bytes-=backend.cache.get(first.id).byteLength;backend.cache.delete(first.id);
 assert.equal(await backend.samplePlane(plane,{residentOnly:true}),null);assert.equal(reads,downloaded);
 await backend.samplePlane(plane);const refilled=reads;
 const evicted=await backend.samplePlane(plane,{residentOnly:true,onProgress:progress=>{if(progress.ready===0&&backend.cache.has(first.id)){backend.bytes-=backend.cache.get(first.id).byteLength;backend.cache.delete(first.id);}}});
 assert.equal(evicted,null);assert.equal(reads,refilled,'Eviction during a cache-only sample cannot silently start a network read');assert.equal(backend.protectedBlocks.size,0);
});
test('a stalled response body fails instead of leaving Loading Fine Plane forever',async()=>{
 const {manifest}=fixture();let cancelled=0;
 const backend=new FineVolumeBackend(manifest,{baseUrl:'https://heart.example/',transferTimeoutMs:10,transferPolicy:{foreground:1,background:1},fetcher:async()=>new Response(new ReadableStream({cancel(){cancelled++;}}))});
 await assert.rejects(backend.samplePlane(plane,{retainTransfers:true}),{name:'TimeoutError'});assert.equal(backend.protectedBlocks.size,0);assert.equal(backend.getStatus().activeBrickTransfers,0);assert.equal(cancelled,2);
});

test('prepared planes have the same bounded failure behavior as brick transfers',async()=>{
 const {manifest}=fixture(),pixels=new Uint8Array(4);
 manifest.preparedPlanes=[{id:'prepared',plane,width:2,height:2,url:'/prepared.webp',bytes:4,sha256:sha(pixels),pixelSha256:sha(pixels)}];
 const backend=new FineVolumeBackend(manifest,{baseUrl:'https://heart.example/',transferTimeoutMs:10,fetcher:()=>new Promise(()=>{})});
 await assert.rejects(backend.samplePlane(plane),{name:'TimeoutError'});assert.equal(backend.prepared.size,0);
});

test('Window cache-only requests settle on worker misses without caching fake fine pixels',async()=>{
 let worker;const sent=[];
 const source=new UltraVolumeSource({activity:null,fetcher:async()=>new Response('{}'),workerFactory:()=>worker={terminate(){},postMessage(message){sent.push(message);if(message.type==='init')queueMicrotask(()=>worker.onmessage({data:{type:'ready'}}));}}});
 assert.equal(await source.sampleResidentPlane(plane),null);assert.equal(sent.length,0,'Motion does not start a fresh metadata transfer');
 await source.init();const request=source.sampleResidentPlane(plane);await delay(0);const sample=sent.find(x=>x.type==='sample');assert.equal(sample.residentOnly,true);
 worker.onmessage({data:{type:'miss',id:sample.id,stats:{decodedBytes:0}}});assert.equal(await request,null);assert.equal(source.results.size,0);assert.equal(source.jobs.size,0);source.destroy();
});
