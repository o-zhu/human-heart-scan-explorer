/** Deterministic integration tests of the actual store, transport, decoder and worker. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {HostedSectionStore,UltraSections} from '../public/hosted-ultra.js';
import {SectionDetail} from '../public/section-detail.js';
import {EncodedSectionCache,SectionImageBackend,SectionTransport,decodeSectionImage} from '../public/ultra-prefetch.js';
const MIB=1024*1024, results=[];
const flush=async(n=30)=>{for(let i=0;i<n;i++)await Promise.resolve();};
const key=(a,i)=>`${a}:${i}`;
function manifest(count=101,bytes=1000){
 return {schemaVersion:2,cropped:true,sliceCounts:[count,count,count],imageDimensionsXYZ:[801,801,1001],
  sourceIndexStep:4,sourceWindow:[1000,18000],compressionLossless:true,format:'webp',assetBaseUrl:'https://scan.example.test/api/ultra/v4/',
  slices:Object.fromEntries(['x','y','z'].map((axis,a)=>[axis,Array.from({length:count},(_,i)=>({
   path:`${axis}/${String(i).padStart(4,'0')}.webp`,crop:[4,6,5,7],bytes,
   sha256:`${a}${i}`.padEnd(64,'a'),sourceDisplaySha256:`source-${a}-${i}`}))]))};
}
function harness(options={}){
 const jobs=[];
 const loader=(request,{signal,onProgress})=>new Promise((resolve,reject)=>{
  const job={...request,signal,aborted:false,done:false};jobs.push(job);
  const abort=()=>{if(job.done)return;job.done=true;job.aborted=true;reject(new DOMException('cancelled','AbortError'));};
  signal.addEventListener('abort',abort,{once:true});
  job.finish=()=>{if(job.done)return;job.done=true;signal.removeEventListener('abort',abort);
   onProgress?.({stage:'decode'});resolve({data:Uint8Array.from({length:request.record.crop[2]*request.record.crop[3]},(_,i)=>i%256),receivedBytes:request.record.bytes});};
  job.fail=()=>{if(job.done)return;job.done=true;signal.removeEventListener('abort',abort);reject(new Error('fixture network failure'));};
  onProgress?.({stage:'loading',receivedBytes:0,estimatedBytes:request.record.bytes});
  if(signal.aborted)abort();
 });
 const store=new HostedSectionStore({loader,manifest:manifest(),idleDelay:1e6,visibility:()=>true,...options});
 return {store,jobs,find:(a,i)=>jobs.find(j=>j.axis===a&&j.index===i&&!j.done),close:()=>store.dispose()};
}
async function test(name,body){
 const start=performance.now();await body();results.push({name,passed:true,durationMs:Math.round(performance.now()-start)});
 console.log(`PASS ${name}`);
}
await test('Current face precedes directional neighbors and inactive cards',async()=>{
 const h=harness();try{
  h.store.setFocus(0,50,{positions:[50,40,60],direction:1});await flush();
  assert.deepEqual(h.jobs.map(j=>key(j.axis,j.index)),['0:50','0:51','0:49']);
  assert.deepEqual(h.jobs.map(j=>j.priority),[0,6,7]);
  assert.equal(h.store.pending.get('ultra:1:40').priority,25);
  assert.equal(h.store.pending.get('ultra:0:52').priority,8);
  h.store.setFocus(0,49,{positions:[49,40,60]});await flush();
  assert.equal(h.store.getStatus().focus.direction,-1);
  assert.equal(h.store.wanted.get('ultra:0:48').priority,6);
  assert(h.store.active.size<=3);
 }finally{h.close();await flush();}
});
await test('Shared requests and fast scroll reversal do not duplicate current decode',async()=>{
 const h=harness();try{
  h.store.setFocus(0,50,{positions:[50,40,60]});await flush();
  const ultra=new UltraSections(h.store);await ultra.init();
  const a=new AbortController(),b=new AbortController();
  const first=ultra.load(0,50,{signal:a.signal}).catch(e=>e),second=ultra.load(0,50,{signal:b.signal}).catch(e=>e);await flush();
  h.store.setFocus(0,70,{positions:[70,40,60]});a.abort();b.abort();await flush();
  h.store.setFocus(0,50,{positions:[50,40,60]});const current=ultra.load(0,50);await flush();
  assert.equal(h.jobs.filter(j=>j.axis===0&&j.index===50).length,1);
  assert.equal(h.find(0,50).aborted,false);h.find(0,50).finish();
  const result=await current;assert.equal((await first).name,'AbortError');assert.equal((await second).name,'AbortError');
  assert.equal(result,ultra.cached(0,50));assert.equal(result.sourceIndex,200);
  assert.deepEqual(result.crop,[4,6,5,7]);assert.deepEqual(result.sourceWindow,[1000,18000]);
  assert.equal(result.fullWidth,801);assert.equal(result.fullHeight,1001);assert.equal(result.spacingUm,79.4);
  assert.equal(result.sourceDisplaySha256,'source-0-50');
  const before=h.jobs.length;assert.equal(await ultra.load(0,50),result);assert.equal(h.jobs.length,before);
 }finally{h.close();await flush();}
});
await test('Cancelling a stale cap cannot cancel a card sharing its transfer',async()=>{
 const h=harness();try{
  h.store.pauseBackground();const detail=new SectionDetail(h.store);await detail.init();
  const controller=new AbortController(),events=[];
  const stale=h.store.load(0,60,{signal:controller.signal,onProgress:e=>events.push(e.stage)}).catch(e=>e);
  const card=detail.load(0,60,{priority:30});await flush();
  assert.equal(h.jobs.length,1);controller.abort();await flush();
  const count=events.length;assert.equal(h.find(0,60).aborted,false);h.find(0,60).finish();
  const result=await card;assert.equal((await stale).name,'AbortError');assert.equal(events.length,count);
  assert.equal(result.width,3);assert.equal(result.height,4);assert.equal(result.spacingUm,158.8);
  assert.deepEqual(result.crop,[2,3,3,4]);assert.deepEqual([...result.data],[0,2,4,10,12,14,20,22,24,30,32,34]);
  assert.equal(result.sourceIndex,240);assert.equal(h.store.cached(0,60).data.length,35);
 }finally{h.close();await flush();}
});
await test('Focused slice preempts lower-priority transfers when slots are occupied',async()=>{
 const h=harness();try{
  const p=[h.store.load(1,10,{priority:30}),h.store.load(1,11,{priority:30}),h.store.load(2,12,{priority:30})].map(p=>p.catch(e=>e));
  await flush();assert.equal(h.jobs.length,3);
  h.store.setFocus(0,70,{positions:[70,10,12]});await flush();
  assert(h.jobs.slice(0,3).some(j=>j.aborted));assert(h.find(0,70));
  assert.equal(h.store.getStatus().preempted,1);assert(h.store.active.size<=3);
  h.close();await Promise.all(p);
 }finally{h.close();await flush();}
});
await test('Pausing cancels speculative work but preserves an explicit current request',async()=>{
 const h=harness();try{
  h.store.setFocus(0,50,{positions:[50,40,60]});const current=h.store.load(0,50);await flush();
  h.store.pauseBackground();await flush();assert.equal(h.store.wanted.size,0);
  assert.equal(h.store.active.size,1);assert(h.jobs.filter(j=>j.index!==50).every(j=>j.aborted));
  h.find(0,50).finish();await current;await flush();const count=h.jobs.length;
  await flush();assert.equal(h.jobs.length,count);assert.equal(h.store.getStatus().paused,true);
  h.store.setFocus(0,51,{positions:[51,40,60]});await flush();assert(h.find(0,51));assert.equal(h.store.getStatus().paused,false);
 }finally{h.close();await flush();}
});
await test('Save-data and slow connections constrain speculative work',async()=>{
 const saved=harness({connection:{saveData:true,effectiveType:'4g'}});
 const slow=harness({connection:{saveData:false,effectiveType:'3g',downlink:0.8}});
 try{
  saved.store.setFocus(0,50,{positions:[50,40,60]});await flush();assert.equal(saved.jobs.length,1);
  saved.find(0,50).finish();await flush();assert.equal(saved.jobs.length,1);
  assert.equal(saved.store.getStatus().plannedNeighbors,0);assert.equal(saved.store.getStatus().saveData,true);
  const card=saved.store.load(1,40,{priority:30});await flush();assert(saved.find(1,40));saved.find(1,40).finish();await card;
  slow.store.setFocus(0,50,{positions:[50,40,60]});await flush();assert.equal(slow.jobs.length,1);
  slow.find(0,50).finish();await flush();assert.equal(slow.jobs.length,2);assert(slow.find(0,51));
  assert.equal(slow.store.getStatus().plannedNeighbors,1);assert.equal(slow.store.active.size,1);
 }finally{saved.close();slow.close();await flush();}
});
await test('Hidden tab stops background transfers and visibility restores the window',async()=>{
 let visible=true;const h=harness({visibility:()=>visible});try{
  h.store.setFocus(0,50,{positions:[50,40,60]});await flush();assert(h.jobs.length>0);
  visible=false;h.store.onPolicyChange();await flush();assert.equal(h.store.active.size,0);assert.equal(h.store.pending.size,0);
  visible=true;h.store.onPolicyChange();await flush();assert(h.find(0,50));
 }finally{h.close();await flush();}
});
await test('Decoded cache has a hard byte budget and keeps the selected face',async()=>{
 const store=new HostedSectionStore({manifest:manifest(),decodedLimit:70,connection:{saveData:true},idleDelay:1e6,
  loader:async request=>({data:new Uint8Array(35).fill(request.index),receivedBytes:1000})});
 try{
  store.setFocus(0,50,{positions:[50,40,60]});await flush();
  await store.load(0,51);await store.load(0,52);assert.equal(store.cacheBytes,70);
  assert(store.has(0,50));assert(!store.has(0,51));assert(store.has(0,52));
  await assert.rejects(store.load(0,51,{cacheOnly:true}),{name:'CacheMissError'});
  assert.equal((await store.load(0,50,{cacheOnly:true})).data[0],50);
  store.decodedLimit=20;store.cache.clear();store.cacheBytes=0;await store.load(0,55);assert.equal(store.cacheBytes,0);
 }finally{store.dispose();await flush();}
});
await test('Neighborhood plan is local, byte-limited and never walks the full volume',async()=>{
 let calls=0;const store=new HostedSectionStore({manifest:manifest(1001,956458),idleDelay:1e6,
  loader:async()=>{calls++;return {data:new Uint8Array(35),receivedBytes:956458};}});
 try{
  store.setFocus(0,500,{positions:[500,501,502]});store.plan(true);await flush(200);
  const neighbors=[...store.wanted.values()].filter(item=>item.kind==='neighbor'&&item.axis===0);
  assert(neighbors.reduce((sum,item)=>sum+store.record(item.axis,item.index).bytes,0)<=10*MIB);
  assert(store.wanted.size<25);assert(calls<25);assert.equal(store.pending.size,0);
  const before=calls;await flush(200);assert.equal(calls,before);
  assert([...store.wanted.values()].every(item=>item.axis!==0||Math.abs(item.index-500)<=8));
 }finally{store.dispose();await flush();}
});
await test('Whole-organ focus warms current cards without selecting an arbitrary cap',async()=>{
 const h=harness();try{
  h.store.setFocus(-1,null,{positions:[12,34,56]});await flush();
  assert.equal(h.store.getStatus().focus,null);
  assert.deepEqual(h.jobs.map(j=>key(j.axis,j.index)),['0:12','1:34']);
  h.find(0,12).finish();await flush();assert(h.find(2,56));
 }finally{h.close();await flush();}
});
await test('Background errors back off, explicit retry works, and observers cannot strand loads',async()=>{
 const h=harness();try{
  const events=[];h.store.subscribe(event=>events.push(event));h.store.subscribe(()=>{throw new Error('fixture UI listener');});
  h.store.setFocus(0,50,{positions:[50,40,60]});await flush();h.find(0,50).fail();await flush();
  h.store.plan(true);await flush();assert.equal(h.jobs.filter(j=>j.axis===0&&j.index===50).length,1);
  const p=h.store.load(0,50,{onProgress:()=>{throw new Error('fixture progress');}});await flush();
  h.find(0,50).finish();await p;assert(events.some(e=>e.type==='error'&&e.index===50));assert(events.some(e=>e.type==='ready'&&e.index===50));
 }finally{h.close();await flush();}
});
await test('Pause and consumer cancellation also work during initial metadata loading',async()=>{
 let release;let fetches=0;let imageLoads=0;
 const store=new HostedSectionStore({fetchImpl:()=>{fetches++;return new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>manifest()});});},
  loader:async()=>{imageLoads++;return {data:new Uint8Array(35)};},idleDelay:1e6});
 try{
  store.setFocus(0,50,{positions:[50,40,60]});
  const ultra=new UltraSections(store),cancelled=ultra.load(0,50).catch(error=>error);
  ultra.cancel();store.pauseBackground();release();await flush();
  assert.equal((await cancelled).name,'AbortError');assert.equal(fetches,1);assert.equal(imageLoads,0);
  assert.equal(store.getStatus().paused,true);assert.equal(store.pending.size,0);
 }finally{store.dispose();await flush();}
});
await test('Empty source records retain exact registration without a network fetch',async()=>{
 const source=manifest();source.slices.x[0]={path:'x/0000.webp',empty:true,crop:[0,0,1,1],bytes:0,sourceDisplaySha256:'empty-source'};
 const h=harness({manifest:source});try{
  const result=await h.store.load(0,0);assert.equal(h.jobs.length,0);assert.equal(result.data.length,1);
  assert.equal(result.empty,true);assert.equal(result.blocks,0);assert.equal(result.sourceIndex,0);assert.equal(result.fullHeight,1001);
 }finally{h.close();await flush();}
});

class FakeCache {
 constructor(){this.data=new Map();}
 url(request){return typeof request==='string'?request:request.url;}
 async keys(){return [...this.data.keys()].map(url=>({url}));}
 async match(request){return this.data.get(this.url(request))?.clone();}
 async put(request,response){this.data.set(this.url(request),response.clone());}
 async delete(request){return this.data.delete(this.url(request));}
}
async function drained(cache){for(let i=0;i<1000&&(cache.draining||cache.writes.size);i++)await new Promise(resolve=>setImmediate(resolve));assert(!cache.draining&&!cache.writes.size);}
await test('Encoded memory and persistent caches evict by byte budget',async()=>{
 const disk=new FakeCache(),cache=new EncodedSectionCache({memoryLimit:20,diskLimit:30,cacheStorage:{open:async()=>disk}});
 const url=id=>`https://scan.example.test/${id}.webp`,blob=new Blob([new Uint8Array(10)]);
 for(const id of ['a','b','c']){cache.put(url(id),blob);await drained(cache);}
 assert.equal(cache.memoryBytes,20);assert.equal(cache.diskBytes,30);assert.equal((await cache.get(url('a'))).cache,'persistent');
 cache.put(url('d'),blob);await drained(cache);assert.equal(cache.diskBytes,30);assert.equal(cache.memoryBytes,20);
 assert(await disk.match(url('a')));assert.equal(await disk.match(url('b')),undefined);
 for(let i=0;i<10;i++)cache.put(url(i),blob);
 assert(cache.writeBytes<=30);await drained(cache);assert(cache.diskBytes<=30);assert(cache.memoryBytes<=20);
 const reopened=new EncodedSectionCache({memoryLimit:20,diskLimit:20,cacheStorage:{open:async()=>disk}});
 await reopened.inventory();assert(reopened.diskBytes<=20);assert(disk.data.size<=2);
});
await test('Persistent-cache denial falls back to bounded memory without failing images',async()=>{
 const cache=new EncodedSectionCache({memoryLimit:8,diskLimit:16,cacheStorage:{open:async()=>{throw new Error('storage blocked');}}});
 cache.put('https://scan.example.test/a',new Blob([new Uint8Array(8)]));await drained(cache);
 assert.equal(cache.stats().persistentAvailable,false);assert.equal((await cache.get('https://scan.example.test/a')).cache,'encoded-memory');
 assert.equal(await cache.get('https://scan.example.test/missing'),null);assert.equal(cache.memoryBytes,8);
});
await test('Actual fetch backend streams exact bytes, reuses encoded cache and rejects truncation',async()=>{
 let fetches=0,decodes=0;const progress=[];let requestOptions;
 const source=Uint8Array.from({length:40},(_,i)=>i),record={crop:[0,0,5,7],bytes:40};
 const backend=new SectionImageBackend({cacheOptions:{diskLimit:0},fetchImpl:async(url,options)=>{
  fetches++;requestOptions=options;return new Response(source,{headers:{'Content-Type':'image/webp'}});
 },decodeImpl:async(blob,width,height)=>{decodes++;assert.equal(blob.size,40);assert.equal(width,5);assert.equal(height,7);return source.slice(0,35);}});
 const request={url:'https://scan.example.test/test.webp?v=fixture',record,priority:0};
 const a=await backend.load(request,{onProgress:p=>progress.push(p.stage)}),b=await backend.load(request);
 assert.equal(fetches,1);assert.equal(decodes,2);assert.equal(requestOptions.priority,'high');
 assert.equal(a.receivedBytes,40);assert.equal(b.receivedBytes,0);assert.equal(b.encodedCacheHit,true);assert.deepEqual([...a.data],[...source.slice(0,35)]);
 assert(progress.includes('loading')&&progress.includes('decode'));
 const bad=new SectionImageBackend({cacheOptions:{diskLimit:0},fetchImpl:async()=>new Response(new Uint8Array(39)),decodeImpl:()=>{throw new Error('must not decode');}});
 await assert.rejects(bad.load(request),/incomplete/);assert.equal(bad.cache.memoryBytes,0);
 const signal=new AbortController();signal.abort();await assert.rejects(backend.load(request,{signal:signal.signal}),{name:'AbortError'});
});
function imageMocks(){
 const saved={createImageBitmap:globalThis.createImageBitmap,OffscreenCanvas:globalThis.OffscreenCanvas,Worker:globalThis.Worker,self:globalThis.self,fetch:globalThis.fetch};
 let closed=0;const rgba=Uint8ClampedArray.from({length:140},(_,i)=>i%4===0?(Math.floor(i/4)*7)%256:255);
 globalThis.createImageBitmap=async()=>({width:5,height:7,close:()=>closed++});
 globalThis.OffscreenCanvas=class{constructor(w,h){this.width=w;this.height=h;}getContext(){return {drawImage(){},getImageData(){return {data:rgba};}};}};
 return {rgba,closed:()=>closed,restore(){for(const[name,value]of Object.entries(saved)){if(value===undefined)delete globalThis[name];else globalThis[name]=value;}}};
}
await test('Decoder preserves every grayscale sample and releases bitmap resources',async()=>{
 const mocks=imageMocks();try{
  const result=await decodeSectionImage(new Blob(['fixture']),5,7);
  assert.deepEqual([...result],Array.from({length:35},(_,i)=>(i*7)%256));assert.equal(mocks.closed(),1);
  await assert.rejects(decodeSectionImage(new Blob(['fixture']),7,5),/crop size/);assert.equal(mocks.closed(),2);
 }finally{mocks.restore();}
});
await test('Unavailable Worker falls back to the same exact-image backend',async()=>{
 const mocks=imageMocks();try{
  globalThis.Worker=class{constructor(){throw new Error('CSP blocks worker');}};
  const stats=[],transport=new SectionTransport({onStats:s=>stats.push(s),backendOptions:{cacheOptions:{diskLimit:0},fetchImpl:async()=>new Response(new Uint8Array(40))}});
  const result=await transport.load({url:'https://scan.example.test/fallback.webp',record:{crop:[0,0,5,7],bytes:40},priority:0});
  assert.deepEqual([...result.data],Array.from({length:35},(_,i)=>(i*7)%256));assert(stats.some(s=>s.decodeWorker===false));transport.dispose();
 }finally{mocks.restore();}
});
await test('Actual module worker returns transferred pixels and forwards progress',async()=>{
 const mocks=imageMocks();try{
  const messages=[];globalThis.self={postMessage:(message,transfer)=>messages.push({message,transfer})};
  globalThis.fetch=async()=>new Response(new Uint8Array(40));
  await import('../public/ultra-cache-worker.js');
  await globalThis.self.onmessage({data:{type:'load',id:7,request:{url:'https://scan.example.test/worker.webp',record:{crop:[0,0,5,7],bytes:40},priority:0}}});
  const result=messages.find(item=>item.message.type==='result');assert(result);assert.equal(result.message.id,7);
  assert.equal(result.transfer[0],result.message.result.data);assert.deepEqual([...new Uint8Array(result.message.result.data)],Array.from({length:35},(_,i)=>(i*7)%256));
  assert(messages.some(item=>item.message.type==='progress'&&item.message.progress.stage==='decode'));
 }finally{mocks.restore();}
});

const report={schemaVersion:1,verifiedAt:new Date().toISOString(),passed:results.length,failed:0,
 scope:'Actual JavaScript module tests with deterministic network, storage, worker and pixel mocks. No browser or live-network timing benchmark.',
 limits:{decodedCacheBytes:48*MIB,encodedMemoryBytes:12*MIB,persistentEncodedBytes:96*MIB,queuedPersistentWriteBytes:16*MIB,
   normalActiveTasks:3,normalSpeculativeTasks:2,currentAxisSpeculativeByteBudget:10*MIB,slowAxisSpeculativeByteBudget:2*MIB},tests:results};
await writeFile(new URL('../docs/ultra-prefetch-v6-verification.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,failed:0,report:'docs/ultra-prefetch-v6-verification.json'}));
