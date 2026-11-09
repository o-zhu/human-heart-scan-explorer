/** Full collection orchestration tests using actual store/cache/backend modules. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {HostedSectionStore} from '../public/hosted-ultra.js';
import {SectionImageBackend,EncodedSectionCache,SectionTransport} from '../public/ultra-prefetch.js';
const MIB=1024*1024,results=[];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(condition,label='condition'){for(let i=0;i<1200;i++){if(condition())return;await tick();}throw new Error(`Timed out: ${label}`);}
async function test(name,body){const start=performance.now();await body();results.push({name,passed:true,durationMs:Math.round(performance.now()-start)});console.log(`PASS ${name}`);}
function manifest(){
 const m={schemaVersion:2,cropped:true,sliceCounts:[4,4,4],imageDimensionsXYZ:[13,15,17],sourceIndexStep:4,
  sourceWindow:[14640,23545],compressionLossless:true,assetBaseUrl:'https://scan.example.test/api/ultra/v4/',slices:{}};
 for(const axis of 'xyz')m.slices[axis]=Array.from({length:4},(_,i)=>({path:`${axis}/${i}.webp`,bytes:256,crop:[2,4,3,3],sha256:`${axis}${i}`.padEnd(64,'a')}));
 m.slices.z[3]={path:'z/3.webp',empty:true,bytes:0,crop:[0,0,1,1]};return m;
}
class FakeCache {
 constructor(){this.data=new Map();this.failWrites=false;this.puts=0;this.deletes=0;}
 url(value){return typeof value==='string'?value:value.url;}
 async keys(){return [...this.data.keys()].map(url=>({url}));}
 async match(url){return this.data.get(this.url(url))?.clone();}
 async put(url,response){if(this.failWrites){const error=new Error('quota');error.name='QuotaExceededError';throw error;}this.puts++;this.data.set(this.url(url),response.clone());}
 async delete(url){this.deletes++;return this.data.delete(this.url(url));}
}
function makeStore({disk=new FakeCache(),fetchImpl,storageManager={estimate:async()=>({quota:100*MIB,usage:0})},auto=true,...options}={}){
 const fetches=[],decodes=[];let store;
 const backend=new SectionImageBackend({onStats:stats=>store?.receiveTransportStats(stats),cacheOptions:{cacheStorage:{open:async()=>disk},storageManager},
  fetchImpl:async(url,init)=>{fetches.push({url,init});return fetchImpl?fetchImpl(url,init):new Response(new Uint8Array(256));},
  decodeImpl:async(blob,width,height)=>{decodes.push({size:blob.size,width,height});return new Uint8Array(width*height).fill(73);}});
 store=new HostedSectionStore({manifest:manifest(),loader:(request,opts)=>backend.load(request,opts),
  collectionConfigurator:(entries,opts)=>backend.configureCollection(entries,opts),autoDownloadCollection:auto,
  idleDelay:1e6,collectionDelay:0,visibility:()=>true,...options});
 return {store,backend,disk,fetches,decodes,close:()=>store.dispose()};
}
function controlled(){
 const jobs=[];return {jobs,fetcher:(url,init)=>new Promise((resolve,reject)=>{
  const job={url,priority:init.priority,done:false,aborted:false};jobs.push(job);
  const abort=()=>{if(job.done)return;job.done=true;job.aborted=true;reject(new DOMException('cancelled','AbortError'));};
  init.signal.addEventListener('abort',abort,{once:true});
  job.finish=()=>{if(job.done)return;job.done=true;init.signal.removeEventListener('abort',abort);resolve(new Response(new Uint8Array(256)));};
  if(init.signal.aborted)abort();
 })};
}
await test('Automatic preparation visits every nonempty record, without decoding the collection',async()=>{
 const h=makeStore();try{
  h.store.pauseBackground(true);await until(()=>h.store.getCollectionStatus().complete,'full collection');
  const status=h.store.getStatus().collection;
  assert.equal(status.totalFiles,11);assert.equal(status.completedFiles,11);assert.equal(status.completedBytes,11*256);
  assert.equal(status.totalSections,12);assert.equal(status.emptySections,1);assert.equal(status.totalBytes,11*256);
  assert.equal(h.fetches.length,11);assert.equal(h.decodes.length,0);assert.equal(h.store.cacheBytes,0);
  assert(h.fetches.every(f=>f.init.priority==='low'));assert.equal(h.disk.data.size,11);
  assert.equal(h.store.getStatus().paused,true);assert.equal(status.state,'complete');
  const count=h.fetches.length;for(let i=0;i<30;i++)await tick();assert.equal(h.fetches.length,count);
 }finally{h.close();}
});
await test('A new session inventories committed files and resumes with no repeated download',async()=>{
 const disk=new FakeCache(),first=makeStore({disk});try{await until(()=>first.store.getCollectionStatus().complete);}finally{first.close();}
 const second=makeStore({disk,fetchImpl:()=>{throw new Error('must not fetch a completed file');}});try{
  await until(()=>second.store.getCollectionStatus().complete);assert.equal(second.fetches.length,0);assert.equal(second.decodes.length,0);
  assert.equal(second.store.getCollectionStatus().completedFiles,11);assert.equal(second.store.cacheBytes,0);
  const value=await second.store.load(0,2);assert.equal(value.data[0],73);assert.equal(value.spacingUm,79.4);
  assert.deepEqual(value.crop,[2,4,3,3]);assert.equal(value.sourceIndex,8);assert.equal(second.fetches.length,0);assert.equal(second.decodes.length,1);
 }finally{second.close();}
});
await test('Idle preparation uses one slot; current and nearby sections preempt it',async()=>{
 const net=controlled(),h=makeStore({fetchImpl:net.fetcher});try{
  await until(()=>net.jobs.length===1);assert(net.jobs.every(job=>job.priority==='low'));assert.equal(h.store.active.size,1);
  h.store.setFocus(2,2,{positions:[3,3,2]});await until(()=>net.jobs[0].aborted);
  await until(()=>net.jobs.length>=3);assert(net.jobs.slice(1).some(job=>job.url.includes('/z/2.webp')&&job.priority==='high'));
  assert(net.jobs.slice(1).some(job=>job.url.includes('/z/1.webp')));assert(h.store.active.size<=3);
 }finally{h.close();}
});
await test('An urgent selected slice preempts a collection fetch on a one-slot connection',async()=>{
 const net=controlled(),h=makeStore({fetchImpl:net.fetcher,maxConcurrency:1});try{
  await until(()=>net.jobs.length===1);assert.equal(net.jobs[0].priority,'low');
  const current=h.store.load(2,2);await until(()=>net.jobs.length>=2);
  assert.equal(net.jobs[0].aborted,true);const selected=net.jobs.find(j=>j.url.includes('/z/2.webp'));
  assert(selected);assert.equal(selected.priority,'high');selected.finish();const result=await current;
  assert.equal(result.data[0],73);assert.equal(h.store.getStatus().preempted,1);
  h.store.pauseCollectionDownload();assert.equal(h.store.getCollectionStatus().reason,'user');
 }finally{h.close();}
});
await test('A foreground consumer joins an encoded collection fetch and decodes it without refetching',async()=>{
 const net=controlled(),h=makeStore({fetchImpl:net.fetcher,maxConcurrency:1});try{
  await until(()=>net.jobs.length===1);const original=net.jobs[0],current=h.store.load(0,0);
  await tick();assert.equal(net.jobs.filter(j=>j.url===original.url).length,1);assert.equal(original.aborted,false);
  original.finish();const result=await current;h.store.pauseCollectionDownload();
  assert.equal(result.data[0],73);assert.equal(net.jobs.filter(j=>j.url===original.url).length,1);
  assert.equal(h.decodes.length,1);assert.equal(h.store.getCollectionStatus().completedFiles,1);
 }finally{h.close();}
});
await test('Explicit pause cancels pending collection work and resume retains committed progress',async()=>{
 const net=controlled(),h=makeStore({fetchImpl:net.fetcher,maxConcurrency:1});try{
  await until(()=>net.jobs.length===1);net.jobs[0].finish();await until(()=>h.store.getCollectionStatus().completedFiles===1&&net.jobs.length>=2);
  h.store.pauseCollectionDownload();const started=net.jobs.length;await tick();assert(net.jobs.at(-1).aborted);
  for(let i=0;i<10;i++)await tick();assert.equal(net.jobs.length,started);assert.equal(h.store.getCollectionStatus().completedFiles,1);
  await h.store.resumeCollectionDownload();await until(()=>net.jobs.length>started);
  assert.equal(net.jobs.filter(j=>j.url===net.jobs[0].url).length,1);assert.equal(h.store.getCollectionStatus().completedFiles,1);
  h.store.pauseCollectionDownload();
 }finally{h.close();}
});
await test('Pausing neighbor warming in Echo or Probe leaves collection preparation running',async()=>{
 const net=controlled(),h=makeStore({fetchImpl:net.fetcher,maxConcurrency:1});try{
  await until(()=>net.jobs.length===1);h.store.pauseBackground(true);await tick();
  assert.equal(net.jobs[0].aborted,false);net.jobs[0].finish();await until(()=>net.jobs.length===2);
  assert.equal(h.store.getStatus().paused,true);assert.equal(h.store.getCollectionStatus().state,'downloading');
 }finally{h.close();}
});
await test('Quota estimate blocks the full download, keeps current images usable, and can resume',async()=>{
 let quota=1024;const h=makeStore({storageManager:{estimate:async()=>({quota,usage:0})}});try{
  await until(()=>h.store.getCollectionStatus().state==='blocked');assert.equal(h.store.getCollectionStatus().reason,'quota');assert.equal(h.fetches.length,0);
  const current=await h.store.load(0,0);assert.equal(current.data[0],73);await until(()=>h.store.getCollectionStatus().completedFiles===1);
  quota=100*MIB;await h.store.resumeCollectionDownload();await until(()=>h.store.getCollectionStatus().complete);
  assert.equal(h.fetches.filter(f=>f.url.includes('/x/0.webp')).length,1);assert.equal(h.fetches.length,11);
 }finally{h.close();}
});
await test('A real Cache.put quota failure pauses rather than evicting/re-downloading completed files',async()=>{
 const disk=new FakeCache(),net=controlled(),h=makeStore({disk,fetchImpl:net.fetcher,maxConcurrency:1});try{
  await until(()=>net.jobs.length===1);net.jobs[0].finish();await until(()=>h.store.getCollectionStatus().completedFiles===1&&net.jobs.length>=2);
  disk.failWrites=true;net.jobs[1].finish();await until(()=>h.store.getCollectionStatus().state==='blocked');
  assert.equal(h.store.getCollectionStatus().reason,'quota');assert.equal(h.store.getCollectionStatus().completedFiles,1);
  assert.equal(disk.deletes,0);const before=net.jobs.length;
  for(let i=0;i<10;i++)await tick();assert.equal(net.jobs.length,before);
  disk.failWrites=false;await h.store.resumeCollectionDownload();await until(()=>h.store.getCollectionStatus().completedFiles>=2);
  assert.equal(net.jobs.filter(j=>j.url===net.jobs[0].url).length,1);
  assert.equal(net.jobs.filter(j=>j.url===net.jobs[1].url).length,1);
 }finally{h.close();}
});
await test('Storage denial avoids a throwaway full download and preserves decoded foreground loading',async()=>{
 let store,fetches=0;const backend=new SectionImageBackend({cacheOptions:{cacheStorage:{open:async()=>{throw new Error('denied');}}},
  onStats:stats=>store?.receiveTransportStats(stats),fetchImpl:async()=>{fetches++;return new Response(new Uint8Array(256));},decodeImpl:async()=>new Uint8Array(9)});
 store=new HostedSectionStore({manifest:manifest(),loader:(r,o)=>backend.load(r,o),collectionConfigurator:(e,o)=>backend.configureCollection(e,o),autoDownloadCollection:true});
 try{await until(()=>store.getCollectionStatus().state==='blocked');assert.equal(store.getCollectionStatus().reason,'storage-unavailable');assert.equal(fetches,0);
  const image=await store.load(0,0);assert.equal(image.data.length,9);assert.equal(fetches,1);
 }finally{store.dispose();}
});
await test('Save-data pauses automatic preparation and explicit Resume permits one low-priority task',async()=>{
 const net=controlled(),h=makeStore({fetchImpl:net.fetcher,connection:{saveData:true,effectiveType:'4g'}});try{
  await until(()=>h.store.getCollectionStatus().reason==='save-data');assert.equal(net.jobs.length,0);
  await h.store.resumeCollectionDownload();await until(()=>net.jobs.length===1);assert.equal(net.jobs[0].priority,'low');assert.equal(h.store.active.size,1);
 }finally{h.close();}
});
await test('Hidden-page pause resumes automatically when the page becomes visible',async()=>{
 let visible=false;const net=controlled(),h=makeStore({fetchImpl:net.fetcher,maxConcurrency:1,visibility:()=>visible});try{
  await until(()=>h.store.getCollectionStatus().reason==='hidden');assert.equal(net.jobs.length,0);
  visible=true;h.store.onPolicyChange();await until(()=>net.jobs.length===1);
  visible=false;h.store.onPolicyChange();await until(()=>net.jobs[0].aborted);assert.equal(h.store.getCollectionStatus().reason,'hidden');
 }finally{h.close();}
});
await test('Network failures retry finitely while other collection files finish',async()=>{
 let now=0,fail=true;const h=makeStore({now:()=>now,fetchImpl:async url=>{if(url.includes('/x/0.webp')&&fail)throw new Error('offline fixture');return new Response(new Uint8Array(256));}});
 try{
  await until(()=>h.store.getCollectionStatus().completedFiles===10);await until(()=>h.store.getCollectionStatus().state==='waiting');
  now=5001;h.store.schedulePump();await until(()=>h.fetches.filter(f=>f.url.includes('/x/0.webp')).length===2);
  now=30002;h.store.schedulePump();await until(()=>h.store.getCollectionStatus().state==='partial');assert.equal(h.store.getCollectionStatus().failedFiles,1);
  const finished=h.fetches.filter(f=>!f.url.includes('/x/0.webp')).length;assert.equal(finished,10);
  fail=false;await h.store.resumeCollectionDownload();await until(()=>h.store.getCollectionStatus().complete);
  assert.equal(h.fetches.filter(f=>!f.url.includes('/x/0.webp')).length,10);
 }finally{h.close();}
});
await test('Persistent budget covers the complete real manifest and protects its entries from LRU eviction',async()=>{
 const real=JSON.parse(await readFile(new URL('../public/assets/ultra-sections/manifest.json',import.meta.url),'utf8'));
 const entries=Object.values(real.slices).flat().filter(r=>!r.empty).map(r=>({url:`https://scan.example.test/${r.path}?v=${r.sha256.slice(0,16)}`,bytes:r.bytes}));
 const disk=new FakeCache(),cache=new EncodedSectionCache({cacheStorage:{open:async()=>disk},storageManager:{estimate:async()=>({quota:2e9,usage:0})}});
 const summary=await cache.configureCollection(entries);
 assert.equal(entries.length,1096);assert.equal(summary.totalBytes,507669042);assert(summary.persistentLimit>=summary.totalBytes+32*MIB);
 assert.equal(summary.storageReason,null);assert.equal(cache.expected.size,1096);
 const small=new EncodedSectionCache({memoryLimit:20,diskLimit:30,cacheStorage:{open:async()=>new FakeCache()},storageManager:null});
 await small.configureCollection([{url:'https://scan.example.test/a',bytes:20},{url:'https://scan.example.test/b',bytes:20}]);
 small.diskLimit=40;assert(await small.put('https://scan.example.test/a',new Blob([new Uint8Array(20)])));
 assert(await small.put('https://scan.example.test/b',new Blob([new Uint8Array(20)])));
 assert.equal(small.diskEntries.size,2);assert.equal(small.diskBytes,40);assert.equal(small.memoryBytes,20);
});
await test('Actual worker protocol configures and stores encoded collection files without image decoding',async()=>{
 const names=['self','caches','fetch','createImageBitmap','OffscreenCanvas'],saved=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 try{
  const disk=new FakeCache(),messages=[];let fetches=0;
  globalThis.caches={open:async()=>disk};globalThis.self={postMessage:(message,transfer)=>messages.push({message,transfer})};
  globalThis.fetch=async()=>{fetches++;return new Response(new Uint8Array(256));};
  globalThis.createImageBitmap=()=>{throw new Error('collection must not decode images');};
  globalThis.OffscreenCanvas=class{constructor(){throw new Error('collection must not allocate a canvas');}};
  await import('../public/ultra-cache-worker.js?collection-v7');
  const url='https://scan.example.test/api/ultra/v4/x/0.webp?v=fixture';
  await self.onmessage({data:{type:'configure-collection',id:1,request:{entries:[{url,bytes:256}],retry:false}}});
  assert.deepEqual(messages.find(item=>item.message.id===1&&item.message.type==='result').message.result.persistedUrls,[]);
  await self.onmessage({data:{type:'load',id:2,request:{url,record:{bytes:256,crop:[2,4,3,3]},priority:100,decode:false}}});
  const loaded=messages.find(item=>item.message.id===2&&item.message.type==='result');
  assert.equal(loaded.message.result.encodedOnly,true);assert.equal(loaded.message.result.persisted,true);assert.equal(loaded.message.result.data,undefined);assert.equal(loaded.transfer,undefined);
  await self.onmessage({data:{type:'configure-collection',id:3,request:{entries:[{url,bytes:256}],retry:false}}});
  assert.deepEqual(messages.find(item=>item.message.id===3&&item.message.type==='result').message.result.persistedUrls,[url]);assert.equal(fetches,1);
  assert(messages.some(item=>item.message.type==='stats'&&item.message.stats.persistedUrl===url));
 }finally{for(const [name,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}}
});
await test('Disposing during worker storage inventory cannot start a fallback operation',async()=>{
 const savedWorker=Object.getOwnPropertyDescriptor(globalThis,'Worker'),savedCanvas=Object.getOwnPropertyDescriptor(globalThis,'OffscreenCanvas');let worker;
 try{
  globalThis.OffscreenCanvas=class{};globalThis.Worker=class{constructor(){worker=this;}postMessage(message){this.message=message;}terminate(){this.terminated=true;}};
  const transport=new SectionTransport(),pending=transport.configureCollection([{url:'https://scan.example.test/one',bytes:1}]).catch(error=>error);
  assert.equal(worker.message.type,'configure-collection');transport.dispose();assert.equal((await pending).name,'AbortError');
  assert.equal(worker.terminated,true);assert.equal(transport.fallback,undefined);
 }finally{if(savedWorker)Object.defineProperty(globalThis,'Worker',savedWorker);else delete globalThis.Worker;if(savedCanvas)Object.defineProperty(globalThis,'OffscreenCanvas',savedCanvas);else delete globalThis.OffscreenCanvas;}
});
const report={schemaVersion:1,verifiedAt:new Date().toISOString(),passed:results.length,failed:0,
 scope:'Actual JavaScript orchestration/cache/backend modules, deterministic network/Cache Storage/quota fixtures; no browser automation or full-pack network transfer.',tests:results};
await writeFile(new URL('../docs/ultra-collection-v7-verification.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:results.length,failed:0}));
