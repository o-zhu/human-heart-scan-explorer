import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,webcrypto} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import vm from 'node:vm';

const source=await readFile(new URL('../public/fine-surface-worker.js',import.meta.url),'utf8');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const raw=new Uint8Array(84),header=new DataView(raw.buffer);
[0x314d4648,1,3,3,32,52,72,0].forEach((value,index)=>header.setUint32(index*4,value,true));
[0,1,2].forEach((value,index)=>header.setUint32(72+index*4,value,true));
const packed=new Uint8Array(gzipSync(raw));
const request={url:'surface',compressedBytes:packed.length,sha256:hash(packed),expectedBytes:raw.length,decodedSha256:hash(raw)};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

class Clock{
 time=0;next=1;jobs=new Map();
 setTimeout=(callback,delay=0)=>{const id=this.next++;this.jobs.set(id,{at:this.time+Math.max(0,delay),callback});return id;};
 clearTimeout=id=>this.jobs.delete(id);
 advance(milliseconds){
  const end=this.time+milliseconds;
  for(let count=0;;count++){
   assert.ok(count<10000,'Timer work must remain bounded.');
   const next=[...this.jobs.entries()].filter(([,job])=>job.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
   if(!next)break;
   this.time=next[1].at;this.jobs.delete(next[0]);next[1].callback();
  }
  this.time=end;
 }
}
function harness(fetcher,data=request){
 const clock=new Clock(),calls=[],messages=[];
 const context=vm.createContext({
  self:{postMessage:message=>messages.push(message)},crypto:webcrypto,Response,ReadableStream,Blob,DecompressionStream,
  AbortController,DOMException,Uint8Array,Uint32Array,DataView,ArrayBuffer,Error,TypeError,
  setTimeout:clock.setTimeout,clearTimeout:clock.clearTimeout,performance:{now:()=>clock.time},
  fetch:(url,options)=>{calls.push({url,...options});return fetcher(url,options,calls.length);},
 });
 vm.runInContext(source,context,{filename:'fine-surface-worker.js'});
 const done=context.self.onmessage({data});
 return {clock,calls,messages,done,context,pause:value=>context.self.onmessage({data:{type:'workspace-priority',paused:value}})};
}
async function until(predicate,message='Expected worker state was not reached.'){
 for(let i=0;i<100;i++){if(predicate())return;await tick();}
 assert.fail(message);
}
const recoveries=h=>h.messages.filter(message=>message.stage==='reconnect');
const assertComplete=h=>{
 const result=h.messages.at(-1);assert.equal(result.error,undefined);
 assert.equal(hash(new Uint8Array(result.buffer)),hash(raw));assert.equal(h.clock.jobs.size,0);
};
async function advance(h,milliseconds){h.clock.advance(milliseconds);await tick();}

test('stalled headers reconnect after 20 seconds and abandon a late response safely',{timeout:5000},async()=>{
 let late,cancelled=false;
 const h=harness((_url,_options,attempt)=>attempt===1?new Promise(resolve=>{late=resolve;}):new Response(packed));
 await until(()=>h.calls.length===1);
 await advance(h,19999);assert.equal(recoveries(h).length,0);
 await advance(h,1);await until(()=>recoveries(h).length===1);
 assert.equal(h.calls[0].signal.aborted,true);
 assert.deepEqual(JSON.parse(JSON.stringify(recoveries(h)[0])),{type:'progress',phase:'download',stage:'reconnect',retryAttempt:1,maxRetries:3,retryDelayMs:1000});
 await advance(h,1000);await h.done;assertComplete(h);assert.equal(h.calls.length,2);
 late(new Response(new ReadableStream({cancel(){cancelled=true;}})));
 await until(()=>cancelled);assert.equal(h.messages.filter(message=>message.buffer).length,1);
});

test('a partial body and a hanging cancellation cannot strand reconnect',{timeout:5000},async()=>{
 let reads=0,cancelled=0,released=0;
 const reader={read(){return ++reads===1?Promise.resolve({value:packed.subarray(0,5),done:false}):new Promise(()=>{});},cancel(){cancelled++;return new Promise(()=>{});},releaseLock(){released++;}};
 const h=harness((_url,_options,attempt)=>attempt===1?{ok:true,status:200,body:{getReader:()=>reader,cancel(){return new Promise(()=>{});}}}:new Response(packed));
 await until(()=>reads===2);
 await advance(h,20000);await until(()=>recoveries(h).length===1);
 assert.ok(cancelled>0);assert.ok(released>0);
 await advance(h,1000);await h.done;assertComplete(h);
 assert.equal(h.calls.length,2);
 assert.equal(h.messages.some(message=>message.stage==='download'&&message.loadedBytes===5),true);
});

test('slow continuous nonempty bytes refresh the idle clock but empty chunks do not',{timeout:5000},async()=>{
 let controller;
 const h=harness(()=>new Response(new ReadableStream({start(value){controller=value;}},{highWaterMark:0})));
 await until(()=>controller);
 const cuts=[0,Math.floor(packed.length/3),Math.floor(2*packed.length/3),packed.length];
 for(let i=0;i<3;i++){
  await advance(h,19000);controller.enqueue(packed.subarray(cuts[i],cuts[i+1]));await tick();
  assert.equal(recoveries(h).length,0);
 }
 controller.close();await h.done;assertComplete(h);
 assert.ok(h.clock.time>20000);assert.equal(h.calls.length,1);

 let empty;
 const stalled=harness((_url,_options,attempt)=>attempt===1?new Response(new ReadableStream({start(value){empty=value;}},{highWaterMark:0})):new Response(packed));
 await until(()=>empty);await advance(stalled,19000);empty.enqueue(new Uint8Array());await tick();
 assert.equal(stalled.messages.some(message=>message.stage==='download'),false);
 await advance(stalled,1000);await until(()=>recoveries(stalled).length===1);
 await advance(stalled,1000);await stalled.done;assertComplete(stalled);
});

test('a short EOF retries only the unfinished part and retains verified earlier parts',{timeout:5000},async()=>{
 const split=Math.floor(packed.length/2),chunks=[packed.subarray(0,split),packed.subarray(split)];
 const parts=chunks.map((bytes,index)=>({url:'part'+index,compressedBytes:bytes.length,sha256:hash(bytes)}));
 const seen=new Map();
 const h=harness(url=>{
  const count=(seen.get(url)||0)+1;seen.set(url,count);
  const bytes=chunks[Number(url.slice(-1))];return new Response(url==='part1'&&count===1?bytes.subarray(0,3):bytes);
 },{...request,url:undefined,parts});
 await until(()=>recoveries(h).length===1);await advance(h,1000);await h.done;assertComplete(h);
 assert.deepEqual(h.calls.map(call=>call.url),['part0','part1','part1']);
 assert.deepEqual(h.messages.filter(message=>message.stage==='verify-part').map(message=>message.verifiedParts),[1,2]);
});

test('fetch and body network errors plus transient statuses recover; nontransient failures do not',{timeout:5000},async()=>{
 const failures=[
  ()=>{throw new TypeError('Failed to fetch');},
  ()=>new Response(new ReadableStream({start(controller){controller.error(new TypeError('Connection reset'));}})),
  ...[408,429,500,502,503,504,599].map(status=>()=>new Response(null,{status})),
 ];
 for(const failure of failures){
  const h=harness((_url,_options,attempt)=>attempt===1?failure():new Response(packed));
  await until(()=>recoveries(h).length===1);await advance(h,1000);await h.done;assertComplete(h);assert.equal(h.calls.length,2);
 }
 for(const failure of [()=>new Response(null,{status:404}),()=>new Response(Uint8Array.from([...packed,0])),()=>{throw new RangeError('Allocation failed');},()=>{throw new TypeError('Array buffer allocation failed');}]){
  const h=harness(failure);await h.done;
  assert.ok(h.messages.at(-1).error);assert.equal(h.messages.at(-1).buffer,undefined);assert.equal(h.calls.length,1);assert.equal(recoveries(h).length,0);assert.equal(h.clock.jobs.size,0);
 }
 const corrupt=harness(()=>new Response(packed),{...request,sha256:'0'.repeat(64)});await corrupt.done;
 assert.match(corrupt.messages.at(-1).error,/checksum/);assert.equal(corrupt.calls.length,1);assert.equal(recoveries(corrupt).length,0);
 const malformed=harness(()=>assert.fail('Malformed metadata must not fetch'),{...request,compressedBytes:-1});await malformed.done;assert.equal(malformed.calls.length,0);
});

test('one global three-recovery budget prevents an endless sequence of failing parts',{timeout:5000},async()=>{
 const split=Math.floor(packed.length/2),chunks=[packed.subarray(0,split),packed.subarray(split)];
 const parts=chunks.map((bytes,index)=>({url:'part'+index,compressedBytes:bytes.length,sha256:hash(bytes)}));
 let firstAttempts=0;
 const h=harness(url=>{
  if(url==='part0'&&++firstAttempts===3)return new Response(chunks[0]);
  throw new TypeError('Network unavailable');
 },{...request,url:undefined,parts});
 for(const [index,delay]of [1000,2000,4000].entries()){
  await until(()=>recoveries(h).length===index+1);await advance(h,delay);
 }
 await h.done;
 assert.deepEqual(recoveries(h).map(message=>message.retryAttempt),[1,2,3]);
 assert.deepEqual(h.calls.map(call=>call.url),['part0','part0','part0','part1','part1']);
 assert.equal(h.messages.at(-1).networkFailure,true);assert.equal(h.messages.at(-1).buffer,undefined);assert.match(h.messages.at(-1).error,/3 recovery attempts/);assert.equal(h.clock.jobs.size,0);
});

test('repeated body stalls exhaust recovery in finite time',{timeout:5000},async()=>{
 const h=harness(()=>new Response(new ReadableStream({start(controller){controller.enqueue(packed.subarray(0,4));}})));
 for(let attempt=0;attempt<4;attempt++){
  await until(()=>h.calls.length===attempt+1);await tick();await advance(h,20000);
  if(attempt<3){await until(()=>recoveries(h).length===attempt+1);await advance(h,1000*2**attempt);}
 }
 await h.done;assert.equal(h.calls.length,4);assert.equal(h.messages.at(-1).networkFailure,true);assert.equal(h.clock.jobs.size,0);
});

test('workspace pauses interrupt even an uncooperative fetch without spending recovery budget',{timeout:5000},async()=>{
 const h=harness((_url,_options,attempt)=>attempt===1?new Promise(()=>{}):new Response(packed));
 await until(()=>h.calls.length===1);await h.pause(true);await tick();
 await advance(h,200000);assert.equal(h.calls.length,1);assert.equal(recoveries(h).length,0);assert.equal(h.clock.jobs.size,0);
 await h.pause(false);await h.done;assertComplete(h);assert.equal(h.calls.length,2);assert.equal(recoveries(h).length,0);
});

test('a pause during backoff suspends the retry and does not consume another recovery',{timeout:5000},async()=>{
 const h=harness((_url,_options,attempt)=>attempt===1?Promise.reject(new TypeError('Offline')):new Response(packed));
 await until(()=>recoveries(h).length===1);await h.pause(true);await tick();await advance(h,200000);
 assert.equal(h.calls.length,1);assert.equal(h.clock.jobs.size,0);
 await h.pause(false);await tick();await advance(h,1000);await h.done;assertComplete(h);
 assert.equal(h.calls.length,2);assert.equal(recoveries(h).length,1);
});

test('outer cancellation settles a blocked transport without retrying or waiting for cleanup',{timeout:5000},async()=>{
 const h=harness(()=>assert.fail('The initial worker request is intentionally invalid'),{expectedBytes:-1});await h.done;
 const controller=new AbortController();h.context.parentSignal=controller.signal;h.context.fetch=()=>new Promise(()=>{});
 const pending=vm.runInContext('activeDownload(signal => fetchSurface("blocked", signal, () => null), parentSignal)',h.context);
 await tick();const reason=new Error('Donor changed');controller.abort(reason);
 await assert.rejects(pending,error=>error===reason);assert.equal(recoveries(h).length,0);assert.equal(h.clock.jobs.size,0);
});

test('pausing completed-body verification retains one hash operation and never repeats its download',{timeout:5000},async()=>{
 let releaseHash,hashCalls=0;
 const h=harness(()=>new Response(packed));
 const digest=webcrypto.subtle.digest.bind(webcrypto.subtle);
 h.context.crypto={subtle:{digest:async(algorithm,bytes)=>{
  hashCalls++;
  if(hashCalls===1)await new Promise(resolve=>{releaseHash=resolve;});
  return digest(algorithm,bytes);
 }}};
 await until(()=>releaseHash);await h.pause(true);await tick();
 assert.equal(h.clock.jobs.size,0,'The network idle deadline ends before verification.');
 await h.pause(false);await tick();assert.equal(h.calls.length,1);assert.equal(hashCalls,1);
 releaseHash();await h.done;assertComplete(h);assert.equal(h.calls.length,1);assert.equal(hashCalls,2);assert.equal(recoveries(h).length,0);
});

test('a pause cannot turn a corrupt checksum into a retryable transport error',{timeout:5000},async()=>{
 let releaseHash;
 const h=harness(()=>new Response(packed),{...request,sha256:'0'.repeat(64)});
 const digest=webcrypto.subtle.digest.bind(webcrypto.subtle);
 h.context.crypto={subtle:{digest:async(algorithm,bytes)=>{await new Promise(resolve=>{releaseHash=resolve;});return digest(algorithm,bytes);}}};
 await until(()=>releaseHash);await h.pause(true);releaseHash();await h.done;
 assert.match(h.messages.at(-1).error,/checksum/);assert.equal(h.calls.length,1);assert.equal(recoveries(h).length,0);assert.equal(h.clock.jobs.size,0);
});
