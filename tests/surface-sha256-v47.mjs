/** Exact identities and bounded large-buffer verification; no browser memory claim. */
import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {dirname} from 'node:path';
import {Readable} from 'node:stream';
import {createGunzip,gunzipSync} from 'node:zlib';
import {Worker} from 'node:worker_threads';
import {sha256Surface,SURFACE_HASH_WORKING_BYTES} from '../public/surface-sha256.js';

const publicRoot=new URL('../public/',import.meta.url),native=bytes=>createHash('sha256').update(bytes).digest('hex');
const receipt={version:1,scope:'Node standard vectors, actual source identities, tracked ArrayBuffer bytes and unmodified worker lifecycle; not a physical iPad or browser peak-memory measurement.',cases:[],assets:[]};
function check(name,fn){test(name,async()=>{const start=performance.now();try{await fn();receipt.cases.push({name,passed:true,milliseconds:performance.now()-start});}catch(error){receipt.cases.push({name,passed:false,error:error.message});throw error;}});}
after(async()=>{if(process.env.HEART_MOBILE_FIDELITY_EVIDENCE){const path=process.env.HEART_MOBILE_FIDELITY_EVIDENCE;await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify({...receipt,passed:receipt.cases.every(c=>c.passed),createdAt:new Date().toISOString()},null,2)+'\n');}});

check('SHA-256 standard vectors, block padding boundaries and nonzero byte offsets match independent native hashes',async()=>{
 for(const [input,expected]of [
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc','ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq','248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
  ['a'.repeat(1000000),'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'],
 ])assert.equal(await sha256Surface(new TextEncoder().encode(input)),expected);
 let seed=47;
 for(const length of [...Array.from({length:130},(_,i)=>i),1024*1024-1,1024*1024,1024*1024+1,2*1024*1024+67]){
  const all=new Uint8Array(length+9),bytes=all.subarray(7,length+7);
  for(let i=0;i<bytes.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;bytes[i]=seed>>>24;}
  assert.equal(await sha256Surface(bytes),native(bytes),'length '+length);assert.equal(all[6],0);assert.equal(all.at(-1),0);
 }
 assert.equal(SURFACE_HASH_WORKING_BYTES,416);
});

check('bounded hashing yields to workspace priority and cancellation never returns an identity',async()=>{
 const input=new Uint8Array(2*1024*1024+3),progress=[];let resume,reached;
 const reachedGate=new Promise(resolve=>{reached=resolve;}),gate=new Promise(resolve=>{resume=resolve;});
 const pending=sha256Surface(input,{chunkBytes:64*1024,waitForWorkspace:()=>progress.length===1?(reached(),gate):Promise.resolve(),onProgress:count=>progress.push(count)});
 await reachedGate;assert.deepEqual(progress,[64*1024]);await new Promise(resolve=>setTimeout(resolve,10));assert.deepEqual(progress,[64*1024]);
 resume();assert.equal(await pending,native(input));assert.equal(progress.at(-1),input.length);
 assert.ok(progress.every((n,i)=>i===0||n>=progress[i-1]&&n-progress[i-1]<=64*1024));
 const abort=new AbortController(),canceled=[];
 await assert.rejects(sha256Surface(input,{signal:abort.signal,onProgress:n=>{canceled.push(n);abort.abort();}}),{name:'AbortError'});assert.equal(canceled.length,1);
 for(const chunkBytes of [0,63,65,3*1024*1024])await assert.rejects(sha256Surface(input,{chunkBytes}),/work budget/);
});

check('the actual Compact Detail decoded source retains its pinned SHA-256 with bounded working storage',async()=>{
 const manifest=JSON.parse(await readFile(new URL('assets/fine-surface-v19/manifest.json',publicRoot))),lod=manifest.lods.find(l=>l.id==='detail');
 const bytes=gunzipSync(await readFile(new URL(lod.url,publicRoot)));assert.equal(bytes.length,lod.decodedBytes);
 const expected=native(bytes);assert.equal(expected,lod.decodedSha256);
 const before=process.memoryUsage().arrayBuffers;let peak=before,updates=0;const started=performance.now();
 const actual=await sha256Surface(bytes,{onProgress:()=>{updates++;peak=Math.max(peak,process.memoryUsage().arrayBuffers);}});
 assert.equal(actual,expected);assert.ok(updates>30);assert.ok(peak-before<1024*1024,'Hashing must not allocate an input-sized ArrayBuffer.');
 receipt.assets.push({id:lod.id,inputBytes:bytes.length,sha256:actual,milliseconds:performance.now()-started,progressUpdates:updates,trackedArrayBufferIncreaseBytes:peak-before,algorithmWorkingBytes:SURFACE_HASH_WORKING_BYTES});
});

const workerURL=new URL('../public/fine-surface-worker.js',import.meta.url);
const harness=`import {parentPort,workerData} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
const digest=webcrypto.subtle.digest.bind(webcrypto.subtle);let pausedOnce=false;
Object.defineProperty(globalThis,'crypto',{value:{subtle:{digest:(algorithm,bytes)=>{if(bytes.byteLength>8*1024*1024)throw new Error('A large input reached native Web Crypto.');return digest(algorithm,bytes);}}},configurable:true});
globalThis.self={postMessage:(message,transfers)=>{
 parentPort.postMessage(message,transfers);
 if(workerData.pauseHash&&!pausedOnce&&message.phase==='decode'&&message.stage==='verify-surface'&&message.loadedBytes<message.totalBytes){pausedOnce=true;void self.onmessage({data:{type:'workspace-priority',paused:true}});parentPort.postMessage({type:'hash-paused'});}
}};
globalThis.fetch=async(url,{signal})=>{signal?.throwIfAborted();return new Response(await readFile(new URL(url)));};
await import(${JSON.stringify(workerURL.href)});
parentPort.on('message',data=>void self.onmessage({data}));parentPort.postMessage({type:'ready'});`;

check('the production worker verifies a real surface without large native digest inputs and resumes its paused hash',async()=>{
 const manifest=JSON.parse(await readFile(new URL('assets/fine-surface-v19/manifest.json',publicRoot))),lod=manifest.lods[0];
 const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(harness)),{workerData:{pauseHash:true}}),messages=[];let resumed=false;
 try{
  const result=await new Promise((resolve,reject)=>{
   worker.on('error',reject);worker.on('message',message=>{
    messages.push(message);
    if(message.type==='ready')worker.postMessage({url:new URL(lod.url,publicRoot).href,compressedBytes:lod.compressedBytes,expectedBytes:lod.decodedBytes,sha256:lod.sha256,decodedSha256:lod.decodedSha256,boundedSurfaceHash:true});
    else if(message.type==='hash-paused')setTimeout(()=>{try{assert.equal(messages.some(m=>m.buffer),false);resumed=true;worker.postMessage({type:'workspace-priority',paused:false});}catch(error){reject(error);}},25);
    else if(message.error)reject(new Error(message.error));else if(message.buffer)resolve(message);
   });
  });
  assert.equal(resumed,true);assert.equal(result.geometrySourceSha256,lod.decodedSha256);assert.equal(native(new Uint8Array(result.buffer)),lod.decodedSha256);
 }finally{await worker.terminate();}
});

check('terminating the actual worker during bounded verification cannot publish late geometry',async()=>{
 const manifest=JSON.parse(await readFile(new URL('assets/fine-surface-v19/manifest.json',publicRoot))),lod=manifest.lods[0];
 const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(harness)),{workerData:{pauseHash:true}}),messages=[];
 try{
  await new Promise((resolve,reject)=>{worker.on('error',reject);worker.on('message',message=>{
   messages.push(message);if(message.type==='ready')worker.postMessage({url:new URL(lod.url,publicRoot).href,compressedBytes:lod.compressedBytes,expectedBytes:lod.decodedBytes,sha256:lod.sha256,decodedSha256:lod.decodedSha256,boundedSurfaceHash:true});
   else if(message.type==='hash-paused')resolve();else if(message.error)reject(new Error(message.error));
  });});
  await worker.terminate();assert.equal(messages.some(m=>m.buffer),false);
 }finally{await worker.terminate();}
});

if(process.env.HEART_SURFACE_SHA_LARGE==='1')check('all 437 MB of the preserved original Ultra match their pinned identity using bounded verification',async()=>{
 const manifest=JSON.parse(await readFile(new URL('assets/fine-surface-v23/manifest.json',publicRoot))),lod=manifest.lods[0],bytes=new Uint8Array(lod.decodedBytes),sourceHash=createHash('sha256');let used=0;
 const packed=Readable.from((async function*(){for(const part of lod.parts)yield*createReadStream(new URL(part.url,publicRoot),{highWaterMark:256*1024});})());
 for await(const chunk of packed.pipe(createGunzip())){assert.ok(used+chunk.length<=bytes.length);bytes.set(chunk,used);sourceHash.update(chunk);used+=chunk.length;}
 assert.equal(used,lod.decodedBytes);assert.equal(sourceHash.digest('hex'),lod.decodedSha256);
 globalThis.gc?.();const before=process.memoryUsage().arrayBuffers;let peak=before,updates=0;const started=performance.now();
 const actual=await sha256Surface(bytes,{onProgress:()=>{updates++;peak=Math.max(peak,process.memoryUsage().arrayBuffers);}});
 assert.equal(actual,lod.decodedSha256);assert.ok(updates>400);assert.ok(peak-before<1024*1024,'Verification must not create another full Ultra ArrayBuffer.');
 receipt.assets.push({id:lod.id,inputBytes:bytes.length,sha256:actual,milliseconds:performance.now()-started,progressUpdates:updates,trackedArrayBufferIncreaseBytes:peak-before,algorithmWorkingBytes:SURFACE_HASH_WORKING_BYTES});
});
