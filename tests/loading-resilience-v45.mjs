import test from 'node:test';
import assert from 'node:assert/strict';
import {ActiveLoadWatchdog,withAbort,progressFetch} from '../public/load-watchdog.js';
import {VolumeLoader} from '../public/volume-loader.js';

class Clock{
 time=0;serial=0;jobs=new Map();
 now=()=>this.time;
 schedule=(fn,delay)=>{const id=++this.serial;this.jobs.set(id,{fn,at:this.time+delay});return id;};
 cancel=id=>this.jobs.delete(id);
 advance(ms){
  const target=this.time+ms;let count=0;
  while(true){
   const next=[...this.jobs].filter(([,job])=>job.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];
   if(!next)break;assert.ok(++count<10000,'The watchdog must not schedule an unbounded timer loop.');
   const [id,job]=next;this.jobs.delete(id);this.time=job.at;job.fn();
  }
  this.time=target;
 }
 options(extra={}){return {now:this.now,schedule:this.schedule,cancel:this.cancel,...extra};}
}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function trackedAbort(){
 const controller=new AbortController(),listeners=new Set(),signal={
  get aborted(){return controller.signal.aborted;},get reason(){return controller.signal.reason;},
  addEventListener(type,listener,options){listeners.add(listener);controller.signal.addEventListener(type,listener,options);},
  removeEventListener(type,listener){listeners.delete(listener);controller.signal.removeEventListener(type,listener);},
 };
 return {controller,signal,listeners};
}

test('watchdog ends an idle preparation at its deadline and emits only one timeout',()=>{
 const clock=new Clock(),errors=[],watchdog=new ActiveLoadWatchdog(clock.options({idleMs:50,totalMs:300,onTimeout:error=>errors.push(error)}));
 clock.advance(49);assert.equal(errors.length,0);clock.advance(1);
 assert.equal(errors.length,1);assert.equal(errors[0].name,'TimeoutError');assert.match(errors[0].message,/stopped responding/i);
 assert.equal(watchdog.closed,true);assert.equal(clock.jobs.size,0);clock.advance(10000);assert.equal(errors.length,1);
});

test('real progress restarts the idle window without resetting the cumulative budget',()=>{
 const clock=new Clock(),errors=[],watchdog=new ActiveLoadWatchdog(clock.options({idleMs:50,totalMs:150,onTimeout:error=>errors.push(error)}));
 for(let i=0;i<3;i++){clock.advance(40);watchdog.progress();assert.equal(errors.length,0);}
 clock.advance(29);assert.equal(errors.length,0);clock.advance(1);
 assert.equal(errors.length,1);assert.equal(errors[0].name,'TimeoutError');assert.match(errors[0].message,/time budget/i);
 assert.equal(clock.jobs.size,0);
});

test('progress received before an idle deadline earns a full new idle interval',()=>{
 const clock=new Clock(),errors=[],watchdog=new ActiveLoadWatchdog(clock.options({idleMs:50,totalMs:300,onTimeout:error=>errors.push(error)}));
 clock.advance(40);watchdog.progress();clock.advance(49);assert.equal(errors.length,0);
 clock.advance(1);assert.equal(errors.length,1);assert.equal(clock.time,90);assert.match(errors[0].message,/stopped responding/i);
});

test('lab pauses consume neither idle nor total preparation time',()=>{
 const clock=new Clock(),errors=[],watchdog=new ActiveLoadWatchdog(clock.options({idleMs:50,totalMs:80,onTimeout:error=>errors.push(error)}));
 clock.advance(20);watchdog.setActive(false);watchdog.setActive(false);assert.equal(clock.jobs.size,0);
 clock.advance(600000);assert.equal(errors.length,0);watchdog.setActive(true);watchdog.setActive(true);
 clock.advance(29);assert.equal(errors.length,0);watchdog.progress();
 clock.advance(30);assert.equal(errors.length,0);clock.advance(1);
 assert.equal(errors.length,1);assert.match(errors[0].message,/time budget/i);assert.equal(clock.time,600080);
});

test('closing a completed watchdog removes its timer and makes subsequent notifications inert',()=>{
 const clock=new Clock(),errors=[],watchdog=new ActiveLoadWatchdog(clock.options({idleMs:20,totalMs:40,onTimeout:error=>errors.push(error)}));
 clock.advance(5);watchdog.close();watchdog.close();watchdog.progress();watchdog.setActive(false);watchdog.setActive(true);
 assert.equal(clock.jobs.size,0);clock.advance(1000);assert.deepEqual(errors,[]);
});

test('withAbort retains successful values and errors and removes abort listeners',async()=>{
 const success=trackedAbort(),value={bytes:new Uint8Array([1,2,3])};
 assert.equal(await withAbort(Promise.resolve(value),success.signal),value);assert.equal(success.listeners.size,0);
 const failure=trackedAbort(),error=new Error('Decode failed');
 await assert.rejects(withAbort(Promise.reject(error),failure.signal),actual=>actual===error);assert.equal(failure.listeners.size,0);
 assert.equal(await withAbort(value),value);
});

test('cancellation settles a stage which ignores AbortSignal and rejects any late result',async()=>{
 const {controller,signal,listeners}=trackedAbort(),operation=deferred(),reason=new DOMException('User selected the interactive volume.','AbortError');
 let committed=false;const result=withAbort(operation.promise,signal).then(value=>{committed=true;return value;});
 controller.abort(reason);await assert.rejects(result,error=>error===reason);assert.equal(listeners.size,0);
 operation.resolve({largePreparedSurface:true});await flush();assert.equal(committed,false);
});

test('already aborted stages reject immediately and late source failures are observed',async()=>{
 const {controller,signal,listeners}=trackedAbort(),operation=deferred(),reason=new Error('Load deadline exceeded');
 controller.abort(reason);await assert.rejects(withAbort(operation.promise,signal),error=>error===reason);assert.equal(listeners.size,0);
 operation.reject(new Error('Late worker failure'));await flush();
});

test('progressFetch preserves response bytes and metadata while forwarding backpressure instead of buffering the body',async()=>{
 const chunks=[new Uint8Array([0,255,11]),new Uint8Array([17,23]),new Uint8Array([31,47,59,61])],before=chunks.map(chunk=>[...chunk]);
 let pulls=0,index=0,progress=0,captured;
 const source=new ReadableStream({pull(controller){pulls++;if(index<chunks.length)controller.enqueue(chunks[index++]);else controller.close();}},{highWaterMark:0});
 const original=new Response(source,{status:201,statusText:'Created',headers:{'content-type':'application/octet-stream','content-length':'9','etag':'exact-source'}});
 const wrappedFetch=progressFetch(()=>progress++,(...args)=>{captured=args;return Promise.resolve(original);});
 const options={cache:'force-cache',headers:{'x-fixture':'unchanged'}},response=await wrappedFetch('/source.bin',options);
 await flush();assert.deepEqual(captured,['/source.bin',options]);assert.equal(captured[1],options);
 assert.ok(pulls<=1,'The wrapper may prefetch one chunk, not the full response.');
 assert.equal(response.status,201);assert.equal(response.statusText,'Created');assert.equal(response.headers.get('content-type'),'application/octet-stream');assert.equal(response.headers.get('content-length'),'9');assert.equal(response.headers.get('etag'),'exact-source');
 const reader=response.body.getReader(),output=[];
 for(const chunk of chunks){const received=await reader.read();assert.equal(received.done,false);assert.equal(received.value,chunk,'Chunks pass through without a whole-response copy.');output.push(...received.value);}
 assert.equal((await reader.read()).done,true);reader.releaseLock();
 assert.deepEqual(output,before.flat());assert.deepEqual(chunks.map(chunk=>[...chunk]),before);assert.equal(progress,1+chunks.length);assert.equal(original.body.locked,false);
});

test('canceling a streamed response cancels its source and releases the reader',async()=>{
 let canceled,pulls=0;
 const source=new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array([pulls]));},cancel(reason){canceled=reason;}},{highWaterMark:0});
 const original=new Response(source),response=await progressFetch(()=>{},async()=>original)('/asset');
 const reader=response.body.getReader();await reader.read();const reason=new Error('Superseded donor');await reader.cancel(reason);await flush();
 assert.equal(canceled,reason);assert.equal(original.body.locked,false);const stopped=pulls;await flush();assert.equal(pulls,stopped);
});

test('source stream errors propagate and unsuccessful or bodyless responses remain untouched',async()=>{
 const error=new Error('Connection reset'),original=new Response(new ReadableStream({start(controller){controller.error(error);}}));
 const failedStream=await progressFetch(()=>{},async()=>original)('/asset');await assert.rejects(failedStream.arrayBuffer(),actual=>actual===error);assert.equal(original.body.locked,false);
 for(const response of [new Response('Retry later',{status:503}),new Response(null,{status:204})]){
  let progress=0;assert.equal(await progressFetch(()=>progress++,async()=>response)('/asset'),response);assert.equal(response.bodyUsed,false);assert.equal(progress,1);
 }
});

function volumeHarness({idleMs=50,totalMs=150,workerFailure=null,postFailure=null}={}){
 const clock=new Clock(),workers=[],watchdogs=[];let active=0,starts=0,releases=0;
 const activity={beginForeground(kind){assert.equal(kind,'volume');active++;starts++;let released=false;return()=>{assert.equal(released,false,'Each volume request releases foreground priority exactly once.');released=true;active--;releases++;};}};
 const loader=new VolumeLoader({activity,workerFactory:()=>{
  if(workerFailure)throw workerFailure;
  const worker={terminated:0,postMessage(message){this.request=message;if(postFailure)throw postFailure;},terminate(){this.terminated++;},send(data){this.onmessage?.({data});}};
  workers.push(worker);return worker;
 },watchdogFactory:options=>{const watchdog=new ActiveLoadWatchdog(clock.options({...options,idleMs,totalMs}));watchdogs.push(watchdog);return watchdog;}});
 return {clock,workers,watchdogs,loader,get active(){return active;},get starts(){return starts;},get releases(){return releases;}};
}

test('a stalled volume worker times out, releases foreground priority, ignores late delivery and allows a fresh retry',async()=>{
 const h=volumeHarness(),progress=[];const first=h.loader.load({url:'/first.gz'},{onProgress:value=>progress.push(value)}),worker=h.workers[0];
 const failure=assert.rejects(first,error=>error.name==='TimeoutError'&&/scan/i.test(error.message));
 h.clock.advance(49);assert.equal(worker.terminated,0);assert.equal(h.active,1);h.clock.advance(1);await failure;
 assert.equal(worker.terminated,1);assert.equal(h.active,0);assert.equal(h.releases,1);assert.equal(h.loader.pending,null);assert.equal(h.loader.worker,null);assert.equal(h.loader.watchdog,null);assert.equal(h.clock.jobs.size,0);
 worker.send({type:'progress',received:999});worker.send({type:'ready',data:new Uint8Array([99]).buffer});assert.deepEqual(progress,[]);
 const retry=h.loader.load({url:'/retry.gz'}),next=h.workers[1];assert.equal(h.active,1);
 next.send({type:'ready',data:new Uint8Array([4,8,15,16,23,42]).buffer});assert.deepEqual([...(await retry).data],[4,8,15,16,23,42]);
 assert.equal(next.terminated,1);assert.equal(h.active,0);assert.equal(h.starts,2);assert.equal(h.releases,2);assert.equal(h.clock.jobs.size,0);
});

test('volume progress extends the idle deadline but cannot evade the total worker budget',async()=>{
 const h=volumeHarness(),seen=[],loading=h.loader.load({url:'/slow.gz'},{onProgress:progress=>seen.push(progress.received)}),worker=h.workers[0];
 const failure=assert.rejects(loading,error=>error.name==='TimeoutError');
 for(const received of [10,20,30]){h.clock.advance(40);worker.send({type:'progress',received});assert.equal(worker.terminated,0);}
 h.clock.advance(29);assert.equal(worker.terminated,0);h.clock.advance(1);await failure;
 assert.deepEqual(seen,[10,20,30]);assert.equal(worker.terminated,1);assert.equal(h.active,0);assert.equal(h.clock.time,150);assert.equal(h.clock.jobs.size,0);
});

test('completed volume preparation preserves the original data and metadata and closes the watchdog',async()=>{
 const h=volumeHarness(),level={url:'/source.gz',dimensions:[2,2,1]},loading=h.loader.load(level,{original:true,gpuCrop:true,acceleration:false,onProgress:()=>{throw new Error('An optional status widget failed.');}}),worker=h.workers[0];
 assert.equal(worker.request.level,level);assert.equal(worker.request.original,true);assert.equal(worker.request.gpuCrop,true);assert.equal(worker.request.acceleration,false);
 h.clock.advance(45);worker.send({type:'progress',received:4});h.clock.advance(45);assert.equal(worker.terminated,0);
 const data=new Uint8Array([0,64,128,255]).buffer,acceleration={dimensions:[1,1,1]},gpuCrop={origin:[1,2,3]},stats={decodedBytes:4};
 worker.send({type:'ready',data,acceleration,gpuCrop,stats});const result=await loading;
 assert.equal(result.data.buffer,data);assert.deepEqual([...result.data],[0,64,128,255]);assert.equal(result.acceleration,acceleration);assert.equal(result.gpuCrop,gpuCrop);assert.equal(result.stats,stats);assert.equal(result.original,true);
 assert.equal(h.active,0);assert.equal(worker.terminated,1);assert.equal(h.clock.jobs.size,0);h.clock.advance(10000);assert.equal(worker.terminated,1);
});

test('superseding and canceling volume requests close their timers without allowing stale workers to finish the new load',async()=>{
 const h=volumeHarness(),first=h.loader.load({url:'/a.gz'}),a=h.workers[0],superseded=assert.rejects(first,error=>error.name==='AbortError');
 h.clock.advance(20);const second=h.loader.load({url:'/b.gz'}),b=h.workers[1];await superseded;
 assert.equal(a.terminated,1);assert.equal(h.active,1);assert.equal(h.loader.worker,b);assert.equal(h.watchdogs[0].closed,true);
 a.send({type:'ready',data:new Uint8Array([99]).buffer});a.onerror({message:'Late worker failure'});a.onmessageerror();assert.equal(h.loader.worker,b);assert.equal(b.terminated,0);
 const canceled=assert.rejects(second,error=>error.name==='AbortError');h.loader.cancel();await canceled;
 assert.equal(b.terminated,1);assert.equal(h.active,0);assert.equal(h.releases,2);assert.equal(h.loader.pending,null);assert.equal(h.clock.jobs.size,0);
 h.clock.advance(10000);assert.equal(b.terminated,1);
});

test('worker startup, transfer, decode and protocol failures release the volume slot and timers',async()=>{
 for(const kind of ['startup','post','runtime','transfer','decode','protocol']){
  const expected=new Error(kind+' failure'),h=volumeHarness({workerFailure:kind==='startup'?expected:null,postFailure:kind==='post'?expected:null});
  const loading=h.loader.load({url:'/bad.gz'}),worker=h.workers[0],failed=assert.rejects(loading,error=>kind==='startup'||kind==='post'?error===expected:error instanceof Error);
  if(kind==='runtime')worker.onerror({message:'Worker crashed'});
  if(kind==='transfer')worker.onmessageerror();
  if(kind==='decode')worker.send({type:'error',message:'Invalid compressed scan'});
  if(kind==='protocol')worker.send({type:'ready',data:null});
  await failed;assert.equal(h.active,0,kind);assert.equal(h.releases,1,kind);assert.equal(h.loader.pending,null,kind);assert.equal(h.loader.worker,null,kind);assert.equal(h.clock.jobs.size,0,kind);
  if(worker)assert.equal(worker.terminated,1,kind);h.clock.advance(10000);
 }
});
