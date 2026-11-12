import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,webcrypto} from 'node:crypto';
import vm from 'node:vm';
import {gzipSync} from 'node:zlib';

const worker=await readFile(new URL('../public/fine-surface-worker.js',import.meta.url),'utf8');
const hash=b=>createHash('sha256').update(b).digest('hex');
const raw=Buffer.alloc(84),header=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
[0x314d4648,1,3,3,32,52,72,0].forEach((v,i)=>header.setUint32(i*4,v,true));
[0,1,2].forEach((v,i)=>header.setUint32(72+i*4,v,true));
const packed=gzipSync(raw),split=Math.floor(packed.length/2),chunks=[packed.subarray(0,split),packed.subarray(split)];
const parts=chunks.map((b,i)=>({url:'part'+i,sha256:hash(b),compressedBytes:b.length}));
const metadata={parts,compressedBytes:packed.length,sha256:hash(packed),expectedBytes:raw.length,decodedSha256:hash(raw)};
async function run(data=metadata,alter=(b)=>b){
 const calls=[],messages=[];let active=0,maxActive=0;
 const context=vm.createContext({self:{postMessage:m=>messages.push(m)},crypto:webcrypto,setTimeout,clearTimeout,DOMException,
 fetch:async(url,options)=>{calls.push(url);active++;maxActive=Math.max(maxActive,active);assert.equal(options.priority,'low');const response=new Response(alter(chunks[Number(url.slice(-1))],url));active--;return response;},
 Response,Blob,DecompressionStream,AbortController,Uint8Array,Uint32Array,DataView,Error});
 vm.runInContext(worker,context);await context.self.onmessage({data});
 return {result:messages.at(-1),messages,calls,maxActive};
}
async function runSingle(body=packed,data={},environment={}){
 const calls=[],messages=[];
 const context=vm.createContext({self:{postMessage:m=>messages.push(m)},crypto:webcrypto,setTimeout,clearTimeout,DOMException,
  fetch:async(url,options)=>{calls.push(url);assert.equal(options.priority,'low');return new Response(typeof body==='function'?body():body);},
  Response,Blob,DecompressionStream,AbortController,Uint8Array,Uint32Array,DataView,Error,...environment});
 vm.runInContext(worker,context);
 await context.self.onmessage({data:{url:'single',compressedBytes:packed.length,sha256:hash(packed),expectedBytes:raw.length,decodedSha256:hash(raw),...data}});
 return {result:messages.at(-1),messages,calls};
}

test('verified transport parts reconstruct the exact welded HFM and expose progress',async()=>{
 const {result,messages,calls,maxActive}=await run();assert.equal(result.error,undefined);
 assert.equal(hash(new Uint8Array(result.buffer)),hash(raw));assert.deepEqual(calls,['part0','part1']);assert.equal(maxActive,1);
 assert.ok(messages.some(m=>m.phase==='download'&&m.loadedBytes===packed.length));assert.ok(messages.some(m=>m.phase==='decode'));
 assert.deepEqual(messages.filter(m=>m.stage==='verify-part').map(m=>m.verifiedParts),[1,2]);
});

test('single-file and legacy transfers report real download, inflate and verification work',async()=>{
 for(const compressedBytes of [packed.length,undefined]){
  const {result,messages}=await runSingle(packed,{compressedBytes});
  assert.equal(result.error,undefined);assert.equal(hash(new Uint8Array(result.buffer)),hash(raw));
  assert.ok(messages.some(m=>m.phase==='download'&&m.loadedBytes===packed.length));
  assert.ok(messages.some(m=>m.stage==='inflate'&&m.loadedBytes===raw.length));
  assert.ok(messages.some(m=>m.phase==='decode'&&m.stage==='verify-surface'));
  assert.ok(messages.some(m=>m.stage==='validate-indices'));
 }
});

test('slow sub-percent chunks refresh progress while fast tiny chunks are throttled',async()=>{
 for(const interval of [150,0]){
  let clock=0;
  const body=()=>{let next=0;return new ReadableStream({pull(controller){if(next===12)controller.close();else controller.enqueue(Uint8Array.of(++next));}},{highWaterMark:0});};
  const {result,messages}=await runSingle(body,{compressedBytes:1000000},{Date:{now:()=>{clock+=interval;return clock;}},setTimeout:(callback,delay)=>setTimeout(callback,delay===20000?delay:0)});
  assert.match(result.error,/length/);assert.equal(result.buffer,undefined);
  // The intentionally short fixture now recovers three times. Verify the
  // original progress-throttle contract within its first physical transfer.
  const reconnect=messages.findIndex(m=>m.stage==='reconnect');
  const progress=messages.slice(0,reconnect<0?undefined:reconnect).filter(m=>m.phase==='download'&&m.stage==='download');
  assert.equal(progress.length,interval?12:1);
  assert.equal(progress[0].loadedBytes,1);
  if(interval)assert.equal(progress.at(-1).loadedBytes,12);
 }
});

test('missing SHA-256 and missing or unusable gzip support fail before large work',async()=>{
 for(const crypto of [undefined,{}, {subtle:{}}]){
  const {result,calls}=await runSingle(packed,{}, {crypto});
  assert.match(result.error,/SHA-256/);assert.equal(result.buffer,undefined);assert.equal(calls.length,0);
 }
 for(const DecompressionStream of [undefined,class{constructor(){throw new Error('unsupported format');}}]){
  let reads=0,cancelled=false;
  const body=new ReadableStream({pull(controller){reads++;controller.enqueue(reads===1?packed.subarray(0,2):packed.subarray(2));},cancel(){cancelled=true;}},{highWaterMark:0});
  const {result}=await runSingle(body,{}, {DecompressionStream});
  assert.match(result.error,/cannot decompress gzip/);assert.equal(result.buffer,undefined);
  assert.equal(reads,1,'Only the gzip header is needed to reject unsupported decompression.');assert.equal(cancelled,true);
 }
 const {result}=await runSingle(raw,{compressedBytes:raw.length,sha256:hash(raw)},{DecompressionStream:undefined});
 assert.equal(result.error,undefined,'An uncompressed HFM does not need gzip support.');
 assert.equal(hash(new Uint8Array(result.buffer)),hash(raw));
});

test('bad part, full checksum, decoded checksum, and oversized streams never install geometry',async()=>{
 for(const changes of [{parts:[parts[0],{...parts[1],sha256:'0'.repeat(64)}]},{sha256:'0'.repeat(64)},{decodedSha256:'0'.repeat(64)}]){
  const {result}=await run({...metadata,...changes});assert.match(result.error,/checksum/);assert.equal(result.buffer,undefined);
 }
 const {result}=await run(metadata,b=>Buffer.concat([b,Buffer.from([0])]));assert.match(result.error,/length/);assert.equal(result.buffer,undefined);
});

test('actual allocation failures are distinguished from retryable transport failures',async()=>{
 const guarded=new Proxy(Uint8Array,{construct(target,args){if(args[0]===raw.length)throw new RangeError('Array buffer allocation failed');return Reflect.construct(target,args);}});
 const {result}=await runSingle(packed,{}, {Uint8Array:guarded});
 assert.match(result.error,/allocation failed/);assert.equal(result.resourceFailure,true);assert.equal(result.buffer,undefined);
 const corrupt=await runSingle(packed,{sha256:'0'.repeat(64)});assert.equal(corrupt.result.resourceFailure,undefined);
});

test('invalid multipart declarations are rejected before fetching',async()=>{
 for(const changes of [{compressedBytes:packed.length+1},{expectedBytes:undefined},{expectedBytes:513*1024*1024},{parts:[]},{parts:[{...parts[0],compressedBytes:33*1024*1024}]}]){
  const {result,calls}=await run({...metadata,...changes});assert.ok(result.error);assert.equal(result.buffer,undefined);assert.equal(calls.length,0);
 }
});

test('a legacy response without packed-size metadata is cancelled at the streaming cap',async()=>{
 let reads=0,cancelled=false;const messages=[],chunk=new Uint8Array(1024*1024);
 const stream=new ReadableStream({pull(controller){reads++;controller.enqueue(chunk);},cancel(){cancelled=true;}});
 const context=vm.createContext({self:{postMessage:m=>messages.push(m)},crypto:webcrypto,setTimeout,clearTimeout,DOMException,
  fetch:async()=>new Response(stream),Response,Blob,DecompressionStream,AbortController,Uint8Array,Uint32Array,DataView,Error});
 vm.runInContext(worker,context);await context.self.onmessage({data:{url:'legacy',expectedBytes:raw.length}});
 assert.match(messages.at(-1).error,/exceeds the supported size/);assert.equal(messages.at(-1).buffer,undefined);
 assert.equal(cancelled,true);assert.ok(reads<=258,'The unbounded response is cancelled at 256 MiB plus the stream prefetch chunk.');
});

test('lab priority aborts only the unfinished part and resumes without re-fetching verified parts',async()=>{
 const calls=[],messages=[];let interrupted=false,startedSecond;
 const secondStarted=new Promise(resolve=>startedSecond=resolve);
 const context=vm.createContext({self:{postMessage:m=>messages.push(m)},crypto:webcrypto,setTimeout,clearTimeout,DOMException,
  fetch:async(url,{signal})=>{
   calls.push(url);
   if(url==='part1'&&!interrupted){
    startedSecond();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{interrupted=true;reject(new Error('Interrupted for active lab'));},{once:true}));
   }
   return new Response(chunks[Number(url.slice(-1))]);
  },Response,Blob,DecompressionStream,AbortController,Uint8Array,Uint32Array,DataView,Error});
 vm.runInContext(worker,context);
 const completed=context.self.onmessage({data:metadata});await secondStarted;
 await context.self.onmessage({data:{type:'workspace-priority',paused:true}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(calls,['part0','part1']);assert.equal(messages.some(m=>m.buffer),false);
 await context.self.onmessage({data:{type:'workspace-priority',paused:false}});await completed;
 assert.deepEqual(calls,['part0','part1','part1']);assert.equal(hash(new Uint8Array(messages.at(-1).buffer)),hash(raw));
});

test('a hidden reconstruction starts paused and yields all transfer capacity to the active lab',async()=>{
 const calls=[],messages=[];
 const context=vm.createContext({self:{postMessage:m=>messages.push(m)},crypto:webcrypto,setTimeout,clearTimeout,DOMException,
  fetch:async url=>{calls.push(url);return new Response(chunks[Number(url.slice(-1))]);},
  Response,Blob,DecompressionStream,AbortController,Uint8Array,Uint32Array,DataView,Error});
 vm.runInContext(worker,context);const completed=context.self.onmessage({data:{...metadata,paused:true}});
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,[]);
 await context.self.onmessage({data:{type:'workspace-priority',paused:false}});await completed;
 assert.equal(hash(new Uint8Array(messages.at(-1).buffer)),hash(raw));
});

test('workspace priority during decompression holds completed geometry until reconstruction resumes',async()=>{
 const calls=[],messages=[];let beganDecode,pausedOnce=false;
 const decodeStarted=new Promise(resolve=>beganDecode=resolve);
 const context=vm.createContext({self:{postMessage:m=>{
  messages.push(m);
  if(m.phase==='decode'&&!pausedOnce){pausedOnce=true;queueMicrotask(()=>{context.self.onmessage({data:{type:'workspace-priority',paused:true}});beganDecode();});}
 }},crypto:webcrypto,setTimeout,clearTimeout,DOMException,
  fetch:async url=>{calls.push(url);return new Response(chunks[Number(url.slice(-1))]);},
  Response,Blob,DecompressionStream,AbortController,Uint8Array,Uint32Array,DataView,Error});
 vm.runInContext(worker,context);const completed=context.self.onmessage({data:metadata});
 await decodeStarted;await new Promise(resolve=>setImmediate(resolve));
 assert.equal(messages.some(m=>m.buffer||m.error),false);
 await context.self.onmessage({data:{type:'workspace-priority',paused:false}});await completed;
 assert.deepEqual(calls,['part0','part1']);assert.equal(hash(new Uint8Array(messages.at(-1).buffer)),hash(raw));
});

test('decoded-stream chunks stop being consumed while paused and retain all prior bytes',async()=>{
 const messages=[],decodedChunks=[raw.subarray(0,32),raw.subarray(32,64),raw.subarray(64)];let reads=0,pausedDuringRead;
 const pausedRead=new Promise(resolve=>pausedDuringRead=resolve);
 const reader={
  async read(){
   const i=reads++;
   if(i===1)queueMicrotask(()=>{context.self.onmessage({data:{type:'workspace-priority',paused:true}});pausedDuringRead();});
   return i<decodedChunks.length?{value:decodedChunks[i],done:false}:{done:true};
  },async cancel(){},releaseLock(){}
 };
 const context=vm.createContext({self:{postMessage:m=>messages.push(m)},crypto:webcrypto,setTimeout,clearTimeout,DOMException,
  fetch:async url=>new Response(chunks[Number(url.slice(-1))]),Response,
  Blob:class{stream(){return {pipeThrough:()=>({getReader:()=>reader})};}},DecompressionStream:class{},
  AbortController,Uint8Array,Uint32Array,DataView,Error});
 vm.runInContext(worker,context);const completed=context.self.onmessage({data:metadata});
 await pausedRead;await new Promise(resolve=>setImmediate(resolve));
 assert.equal(reads,2,'No further decoded chunk is requested while the lab has priority.');
 assert.equal(messages.some(m=>m.buffer||m.error),false);
 await context.self.onmessage({data:{type:'workspace-priority',paused:false}});await completed;
 assert.equal(reads,4);assert.equal(hash(new Uint8Array(messages.at(-1).buffer)),hash(raw));
 assert.deepEqual(messages.filter(m=>m.stage==='inflate'&&m.loadedBytes>0).map(m=>m.loadedBytes),[32,64,84]);
});
