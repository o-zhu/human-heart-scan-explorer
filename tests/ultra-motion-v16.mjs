/** Rapid skipped-section gestures and physically bounded decoding; no browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ScanActivity} from '../public/download-priority.js';
import {HostedSectionStore} from '../public/hosted-ultra.js';
import {SectionDecodeQueue,SectionImageBackend} from '../public/ultra-prefetch.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate,label){
 for(let i=0;i<1000;i++){if(predicate())return;await tick();}
 throw new Error(`Timed out: ${label}`);
}
const donors=await Promise.all([
 '../public/assets/ultra-sections/manifest.json',
 '../data/donors/s-20-29/ultra-sections/manifest.json',
 '../data/donors/s-20-28/ultra-sections/manifest.json'
].map(async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'))));

function storedHarness({manifest=donors[1],activity,now=()=>performance.now()}={}){
 const jobs=[];
 const store=new HostedSectionStore({manifest,activity,now,autoDownloadCollection:false,idleDelay:1e6,visibility:()=>true,
  loader:(request,{signal,onProgress})=>new Promise((resolve,reject)=>{
   jobs.push({request,signal,resolve,reject});onProgress({stage:'decode'});
   signal.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true});
  })});
 store.metrics.persistentAvailable=true;
 for(const entry of store.collectionEntries)store.collectionDone.add(entry.key);
 for(let axis=0;axis<3;axis++){
  const index=210,record=store.record(axis,index);
  store.remember({key:`ultra:${axis}:${index}`,axis,index,data:new Uint8Array(record.crop[2]*record.crop[3])});
 }
 return {store,jobs,close(){store.dispose();}};
}

test('Stored neighbor decodes yield to volume, cleanup, anatomy and module startup, while selected sections remain allowed',async()=>{
 for(const kind of ['volume','cleanup','anatomy','module:probe','fine-plane']){
  const activity=new ScanActivity({ready:true}),release=activity.beginForeground(kind),h=storedHarness({activity});
  try{
   assert.equal(activity.getState().allowLocalPrefetch,false);
   h.store.setFocus(1,210,{positions:[210,210,210]});await tick();
   assert.equal(h.jobs.length,0,'Downloaded neighbors cannot compete with expensive foreground startup.');
   assert.equal(h.store.policy().localSpeculative,0);
   const current=h.store.load(1,211);await until(()=>h.jobs.length===1,'explicit selected face');
   assert.equal(h.jobs[0].request.priority,0);assert.equal(h.jobs[0].request.index,211);
   const record=h.store.record(1,211);h.jobs[0].resolve({data:new Uint8Array(record.crop[2]*record.crop[3]),encodedCacheHit:true});
   await current;
   release();activity.beginGesture('wheel');h.store.plan(false);
   await until(()=>h.jobs.length>1,'local preparation resumes after heavy foreground finishes');
   assert.equal(activity.getState().allowLocalPrefetch,true);
   assert(h.jobs.slice(1).every(job=>job.request.localOnly));
  }finally{release();h.close();activity.dispose();}
 }
});

test('A section foreground lease permits local preparation, but an overlapping volume lease closes it independently',()=>{
 const activity=new ScanActivity({ready:true}),section=activity.beginForeground('section');
 assert.equal(activity.getState().allowPrefetch,false);
 assert.equal(activity.getState().allowLocalPrefetch,true);
 const volume=activity.beginForeground('volume');assert.equal(activity.getState().allowLocalPrefetch,false);
 section();assert.equal(activity.getState().allowLocalPrefetch,false);
 volume();assert.equal(activity.getState().allowLocalPrefetch,true);activity.dispose();
});

test('Rapid multi-section strides and reversals prepare sampled positions, keep native crop sizes, and drop obsolete recent work',()=>{
 for(const manifest of donors){
  let now=0;const activity=new ScanActivity({ready:true,now:()=>now}),h=storedHarness({manifest,activity,now:()=>now});
  try{
   activity.beginGesture('wheel');h.store.setFocus(1,210,{positions:[210,210,210]});
   now=16;h.store.setFocus(1,215,{positions:[210,215,210]});
   assert.equal(h.store.policy().rapid,true);assert.equal(h.store.policy().localSpeculative,1);
   assert.equal(h.store.focus.stride,5);assert.equal(h.store.recentFocus.length,0);
   let neighbors=[...h.store.wanted.values()].filter(item=>item.kind==='neighbor').sort((a,b)=>a.priority-b.priority);
   assert.equal(neighbors[0].index,225,'Predict past the codec interval instead of preparing every skipped neighbor.');
   assert(neighbors.length<=5);assert(neighbors.every(item=>item.localOnly));
   const bytes=neighbors.reduce((total,item)=>{const r=h.store.record(item.axis,item.index);return total+r.crop[2]*r.crop[3];},0);
   assert(bytes>5e6,'This fixture uses actual million-pixel donor crops.');assert(bytes<=h.store.decodedLimit*.7);
   now=17;h.store.setFocus(1,215,{positions:[210,215,210]});
   assert.equal(h.store.focus.changedAt,16,'Repeated focus synchronization cannot erase the measured input interval.');
   now=32;h.store.setFocus(1,208,{positions:[210,208,210]});
   neighbors=[...h.store.wanted.values()].filter(item=>item.kind==='neighbor').sort((a,b)=>a.priority-b.priority);
   assert.equal(h.store.focus.direction,-1);assert.equal(neighbors[0].index,194);
   assert.equal(h.store.recentFocus.length,0);assert.equal(h.store.policy().speculative,0);
   now=250;h.store.plan(true);
   assert.equal(h.store.policy().rapid,false);
   assert.equal([...h.store.wanted.values()].filter(item=>item.kind==='neighbor'&&item.axis===1).length,14,'Quiet browsing returns to broad adjacent preparation.');
  }finally{h.close();activity.dispose();}
 }
});

test('Cancelled callers do not release physical decoder slots until the native operation finishes',async()=>{
 const queue=new SectionDecodeQueue({concurrency:2}),native=[],controllers=[],results=[];
 let physical=0,maxPhysical=0;
 const request=(index,priority=0)=>{
  const controller=new AbortController();controllers.push(controller);
  const result=queue.run(()=>new Promise(resolve=>{
   physical++;maxPhysical=Math.max(maxPhysical,physical);
   native.push({index,finish(){physical--;resolve(index);}});
  }),{signal:controller.signal,priority}).then(value=>({value}),error=>({error:error.name}));
  results.push(result);return controller;
 };
 try{
  const first=request(1,6),second=request(2,7);await until(()=>native.length===2,'two physical decode jobs');
  first.abort();second.abort();
  let previous;
  for(let index=3;index<=64;index++){previous?.abort();previous=request(index);await tick();}
  assert.equal(native.length,2,'Do not start 62 native decodes after their UI tasks were cancelled.');
  assert.equal(queue.active.size,2);assert.equal(queue.pending.length,1);
  native[0].finish();await until(()=>native.length===3,'latest selected image enters the released physical slot');
  assert.equal(native[2].index,64);assert.equal(maxPhysical,2);
  native[1].finish();native[2].finish();
  const settled=await Promise.all(results);
  assert(settled.slice(0,-1).every(result=>result.error==='AbortError'));
  assert.equal(settled.at(-1).value,64);await tick();
  assert.equal(queue.pending.length,0);assert.equal(queue.active.size,0);
 }finally{for(const controller of controllers)controller.abort();queue.dispose();}
});

test('Already-running native neighbors finish into the bounded cache for reversals after the focus skips past them',async()=>{
 let now=0;const activity=new ScanActivity({ready:true,now:()=>now}),h=storedHarness({activity,now:()=>now});
 try{
  activity.beginGesture('wheel');h.store.setFocus(1,210,{positions:[210,210,210]});
  await until(()=>h.jobs.length===2,'two nearby native decodes');
  const old=h.jobs.slice();assert.deepEqual(old.map(job=>job.request.index),[211,209]);
  now=16;h.store.setFocus(1,220,{positions:[210,220,210]});await tick();
  assert(old.every(job=>!job.signal.aborted),'Do not throw away non-cancellable native work already paid for.');
  for(const job of old){const r=job.request.record;job.resolve({data:new Uint8Array(r.crop[2]*r.crop[3]).fill(job.request.index),encodedCacheHit:true});}
  await until(()=>h.store.has(1,211)&&h.store.has(1,209),'completed pixels retained for reversal');
  assert.equal(h.store.focus.index,220);assert.equal(h.store.cached(1,209).data[0],209);assert(h.store.cacheBytes<=h.store.decodedLimit);
 }finally{h.close();activity.dispose();}
});

test('Selected decoding outranks queued neighbors, and disposing never starts a cancelled queued image',async()=>{
 const queue=new SectionDecodeQueue({concurrency:1}),started=[];
 const start=(id,priority)=>queue.run(()=>new Promise(resolve=>started.push({id,resolve})),{priority}).catch(error=>error.name);
 const first=start('busy',5),near=start('neighbor',6),far=start('farther',10),selected=start('selected',0);
 await until(()=>started.length===1,'first decode');started[0].resolve('busy');assert.equal(await first,'busy');
 await until(()=>started.length===2,'selected decode');assert.equal(started[1].id,'selected');
 queue.dispose();assert.equal(await selected,'AbortError');assert.equal(await near,'AbortError');assert.equal(await far,'AbortError');
 started[1].resolve('discarded');await tick();assert.equal(started.length,2);assert.equal(queue.active.size,0);
});

test('The real image backend bounds obsolete asynchronous native work and reports queued versus decoding stages',async()=>{
 const native=[],progress=[],backend=new SectionImageBackend({decodeConcurrency:1,cacheOptions:{cacheStorage:null},
  fetchImpl:()=>{throw new Error('No network is permitted in the stored-image test.');},
  decodeImpl:async(blob,width,height)=>new Promise(resolve=>native.push({blob,width,height,resolve}))});
 const record=donors[1].slices.y[255],imageBytes=record.crop[2]*record.crop[3];
 const firstController=new AbortController(),lastController=new AbortController();
 backend.cache.get=async()=>({blob:{size:record.bytes},cache:'persistent'});
 try{
  const first=backend.load({url:'https://scan.example/one.webp',record,priority:8},{signal:firstController.signal}).catch(error=>error.name);
  await until(()=>native.length===1,'initial native decode');firstController.abort();assert.equal(await first,'AbortError');
  const last=backend.load({url:'https://scan.example/last.webp',record,priority:0},{signal:lastController.signal,onProgress:p=>progress.push(p.stage)});
  await until(()=>progress.includes('decode-queued'),'latest image waiting for physical capacity');
  assert.equal(progress.includes('decode'),false);assert.equal(native.length,1);
  native[0].resolve(new Uint8Array(imageBytes));
  await until(()=>native.length===2,'latest native image starts');assert.equal(progress.includes('decode'),true);
  const pixels=new Uint8Array(imageBytes).fill(173);native[1].resolve(pixels);
  const result=await last;assert.equal(result.data,pixels);assert.equal(result.data.byteLength,imageBytes);
  assert(result.data.every(value=>value===173));
 }finally{firstController.abort();lastController.abort();backend.dispose();}
});

test('The compatibility decoder uses one physical job when document exists even without device-memory reporting',()=>{
 const previous=globalThis.document;globalThis.document={};
 try{
  const backend=new SectionImageBackend({cacheOptions:{cacheStorage:null}});
  assert.equal(backend.decodeQueue.concurrency,1);backend.dispose();
  assert.equal(backend.decodeQueue.disposed,true);assert.equal(backend.decoder.disposed,true);
 }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
