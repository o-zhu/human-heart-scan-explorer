import test from 'node:test';
import assert from 'node:assert/strict';
import {ScanActivity} from '../public/download-priority.js';
import {HostedSectionStore,UltraSections} from '../public/hosted-ultra.js';
import {EncodedSectionCache,SectionImageBackend,SectionTransport} from '../public/ultra-prefetch.js';
import {VolumeLoader} from '../public/volume-loader.js';
import {UltraVolumeSource} from '../public/ultra-volume.js';
import {planFinePlane} from '../public/ultra-volume-core.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate,label='condition'){
  for(let i=0;i<1600;i++){if(predicate())return;await tick();}
  throw new Error(`Timed out: ${label}`);
}
function clock(){
  let time=0,sequence=0;const timers=new Map();
  return {now:()=>time,setTimer:(fn,delay)=>{const id=++sequence;timers.set(id,{fn,at:time+delay});return id;},
    clearTimer:id=>timers.delete(id),advance:ms=>{
      const end=time+ms;
      for(;;){const next=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;
        time=next[1].at;timers.delete(next[0]);next[1].fn();}
      time=end;
    }};
}
class Disk {
  constructor(){this.values=new Map();this.keyReads=0;this.matches=0;this.puts=0;}
  url(value){return typeof value==='string'?value:value.url;}
  async keys(){this.keyReads++;return [...this.values.keys()].map(url=>({url}));}
  async match(value){this.matches++;return this.values.get(this.url(value))?.clone();}
  async put(url,response){this.puts++;this.values.set(this.url(url),response.clone());}
  async delete(value){return this.values.delete(this.url(value));}
}
function manifest(){
  return {schemaVersion:2,cropped:true,sliceCounts:[4,4,4],imageDimensionsXYZ:[13,13,13],sourceIndexStep:4,
    sourceWindow:[14640,23545],compressionLossless:true,assetBaseUrl:'https://scan.example/api/ultra/v4/',
    slices:Object.fromEntries([...'xyz'].map(axis=>[axis,Array.from({length:4},(_,i)=>({
      path:`${axis}/${i}.webp`,bytes:256,crop:[2,4,3,3],sha256:`${axis}${i}`.padEnd(64,'a')}))]))};
}
function harness({activity,now,collectionDelay=0,...options}={}){
  const disk=new Disk(),jobs=[],decodes=[];let store;
  const backend=new SectionImageBackend({cacheOptions:{cacheStorage:{open:async()=>disk},storageManager:null},
    onStats:stats=>store?.receiveTransportStats(stats),
    fetchImpl:(url,init)=>new Promise((resolve,reject)=>{
      const job={url,init,done:false,aborted:false};jobs.push(job);
      const abort=()=>{if(job.done)return;job.done=true;job.aborted=true;reject(new DOMException('cancelled','AbortError'));};
      job.finish=()=>{if(job.done)return;job.done=true;init.signal.removeEventListener('abort',abort);resolve(new Response(new Uint8Array(256)));};
      init.signal.addEventListener('abort',abort,{once:true});if(init.signal.aborted)abort();
    }),decodeImpl:async()=>{decodes.push(true);return new Uint8Array(9).fill(73);}});
  store=new HostedSectionStore({manifest:manifest(),loader:(r,o)=>backend.load(r,o),
    collectionConfigurator:(entries,opts)=>backend.configureCollection(entries,opts),autoDownloadCollection:true,
    idleDelay:1e6,visibility:()=>true,activity,now,collectionDelay,...options});
  return {store,disk,jobs,decodes,backend,close:()=>{store.dispose();backend.dispose();activity?.dispose();}};
}

test('Initial preview and detailed-volume work finish before any optional cache inventory/download',async()=>{
  const time=clock(),activity=new ScanActivity({...time}),h=harness({activity,now:time.now});
  let worker;const loader=new VolumeLoader({activity,workerFactory:()=>worker={postMessage(){},terminate(){}}});
  try{
    await tick();assert.equal(h.store.getCollectionStatus().reason,'loading-viewer');assert.equal(h.jobs.length,0);assert.equal(h.disk.keyReads,0);
    const loading=loader.load({dimensions:[1,1,1]});activity.setViewerReady(true);time.advance(5000);await tick();
    assert.equal(h.store.getCollectionStatus().reason,'foreground');assert.equal(h.jobs.length,0);assert.equal(h.disk.keyReads,0);
    worker.onmessage({data:{type:'ready',data:new Uint8Array([1]).buffer,stats:{}}});await loading;
    time.advance(1799);await tick();assert.equal(h.jobs.length,0);assert.equal(h.disk.keyReads,0);
    time.advance(1);await until(()=>h.jobs.length===1,'one idle transfer');
    assert.equal(h.disk.keyReads,1);assert.equal(h.jobs[0].init.priority,'low');assert.equal(h.store.active.size,1);
  }finally{loader.cancel();h.close();}
});

test('Dragging cancels bulk work immediately; a requested slice stays usable and idle download resumes',async()=>{
  const time=clock(),activity=new ScanActivity({...time,ready:true}),h=harness({activity,now:time.now});
  try{
    await until(()=>h.jobs.length===1);const first=h.jobs[0];activity.beginGesture(9);
    await until(()=>first.aborted);assert.equal(h.store.getCollectionStatus().reason,'interaction');
    const selected=h.store.load(2,2);await until(()=>h.jobs.some(j=>j.url.includes('/z/2.webp')));
    const job=h.jobs.find(j=>j.url.includes('/z/2.webp'));assert.equal(job.init.priority,'high');job.finish();
    const image=await selected;assert.equal(image.data[0],73);assert.equal(h.decodes.length,1);
    const count=h.jobs.length;time.advance(10000);await tick();assert.equal(h.jobs.length,count);
    activity.endGesture(9);time.advance(1799);await tick();assert.equal(h.jobs.length,count);
    time.advance(1);await until(()=>h.jobs.length>count);assert.equal(h.jobs.at(-1).init.priority,'low');
    assert.equal(h.disk.keyReads,1,'resuming does not repeat inventory');
  }finally{h.close();}
});

test('Foreground selection joins the same in-flight bulk image instead of restarting it',async()=>{
  const time=clock(),activity=new ScanActivity({...time,ready:true}),h=harness({activity,now:time.now});
  try{
    await until(()=>h.jobs.length===1);const first=h.jobs[0],selected=h.store.load(0,0);await tick();
    assert.equal(first.aborted,false);assert.equal(h.jobs.length,1);assert.equal(activity.getState().foregroundCount,1);
    first.finish();assert.equal((await selected).data[0],73);await tick();
    assert.equal(h.jobs.filter(j=>j.url===first.url).length,1);assert.equal(h.decodes.length,1);
    assert.equal(h.store.getCollectionStatus().completedFiles,1);assert.equal(activity.getState().foregroundCount,0);
  }finally{h.close();}
});

test('Bulk transfers are single-file and leave a scheduling gap between completed files',async()=>{
  const h=harness({activity:null,collectionDelay:45});
  try{
    await until(()=>h.jobs.length===1);for(let i=0;i<10;i++)await tick();assert.equal(h.jobs.length,1);
    h.jobs[0].finish();await until(()=>h.store.getCollectionStatus().completedFiles===1);await tick();
    assert.equal(h.jobs.length,1);assert.equal(h.store.active.size,0);
    await new Promise(resolve=>setTimeout(resolve,65));await until(()=>h.jobs.length===2);
    assert.equal(h.store.active.size,1);assert.equal(h.decodes.length,0);
  }finally{h.close();}
});

test('Overlapping current-view jobs release independently, including cancellation and worker errors',async()=>{
  const time=clock(),activity=new ScanActivity({...time,ready:true});let worker;
  const media=activity.beginForeground('video'),loader=new VolumeLoader({activity,workerFactory:()=>worker={postMessage(){},terminate(){}}});
  try{
    const loading=loader.load({dimensions:[1,1,1]});assert.equal(activity.getState().foregroundCount,2);
    loader.cancel();await assert.rejects(loading,{name:'AbortError'});assert.equal(activity.getState().foregroundCount,1);
    media();media();assert.equal(activity.getState().foregroundCount,0);
    const failing=loader.load({dimensions:[1,1,1]});worker.onerror({message:'fixture worker error'});
    await assert.rejects(failing,/fixture worker error/);assert.equal(activity.getState().foregroundCount,0);
    time.advance(1800);assert.equal(activity.getState().allowBackground,true);
  }finally{loader.cancel();activity.dispose();}
});

test('A disk-cached selected slice does not start or wait for a paused collection inventory',async()=>{
  const disk=new Disk(),url='https://scan.example/x/0.webp?v=immutable';
  await disk.put(url,new Response(new Uint8Array(256),{headers:{'x-heart-cache-bytes':'256'}}));
  const backend=new SectionImageBackend({cacheOptions:{cacheStorage:{open:async()=>disk},storageManager:null},
    fetchImpl:()=>{throw new Error('cached current slice must not fetch');},decodeImpl:async()=>new Uint8Array(9).fill(41)});
  backend.setBackgroundEnabled(false);
  const inventory=backend.configureCollection([{url,bytes:256}]);
  try{
    const selected=await backend.load({url,record:{bytes:256,crop:[0,0,3,3]},priority:0});
    assert.equal(selected.data[0],41);assert.equal(disk.keyReads,0);assert.equal(disk.matches,1);
    backend.setBackgroundEnabled(true);const status=await inventory;
    assert.deepEqual(status.persistedUrls,[url]);assert.equal(disk.keyReads,1);assert.equal(disk.matches,1);
  }finally{backend.dispose();}
});

test('Resume inventory uses immutable manifest keys, and a damaged selected entry is repaired',async()=>{
  const disk=new Disk(),entries=Array.from({length:96},(_,i)=>({url:`https://scan.example/${i}.webp?v=immutable-${i}`,bytes:256}));
  for(const entry of entries)await disk.put(entry.url,new Response(new Uint8Array(entry===entries[3]?2:256)));
  let fetches=0;const backend=new SectionImageBackend({cacheOptions:{cacheStorage:{open:async()=>disk},storageManager:null},
    fetchImpl:async()=>{fetches++;return new Response(new Uint8Array(256));},decodeImpl:async()=>new Uint8Array(9)});
  try{
    const status=await backend.configureCollection(entries);assert.equal(status.persistedUrls.length,96);
    assert.equal(disk.keyReads,1);assert.equal(disk.matches,0,'inventory does not open 96 responses');
    await backend.configureCollection(entries);assert.equal(disk.keyReads,1);
    await backend.load({url:entries[3].url,record:{bytes:256,crop:[0,0,3,3]},priority:0});
    assert.equal(fetches,1);assert.equal(disk.matches,1);assert.equal(backend.cache.memoryBytes,256);
  }finally{backend.dispose();}
});

test('Donor manifests retain their spacing and source-specific transport cache names',async()=>{
  const m={...manifest(),spacingUm:28.128,sourceScale:'s2'};let fetched;
  const store=new HostedSectionStore({manifestUrl:'https://scan.example/young/manifest.json',activity:null,autoDownloadCollection:false,
    fetchImpl:async url=>{fetched=url.href;return {ok:true,json:async()=>m};},loader:async()=>({data:new Uint8Array(9)})});
  try{
    const ultra=new UltraSections(store);await ultra.init();const image=await ultra.load(0,1);
    assert.equal(fetched,'https://scan.example/young/manifest.json');assert.equal(image.spacingUm,28.128);
    assert.equal(ultra.estimate(0,1).spacingUm,28.128);assert.equal(image.sourceIndex,4);
  }finally{store.dispose();}
  const opened=[],disks=new Map();const cacheStorage={open:async name=>{opened.push(name);if(!disks.has(name))disks.set(name,new Disk());return disks.get(name);}};
  const a=new SectionTransport({backendOptions:{cacheOptions:{cacheName:'donor-a',cacheStorage,storageManager:null}}});
  const b=new SectionTransport({backendOptions:{cacheOptions:{cacheName:'donor-b',cacheStorage,storageManager:null}}});
  try{await a.configureCollection([]);await b.configureCollection([]);assert.deepEqual(opened,['donor-a','donor-b']);}
  finally{a.dispose();b.dispose();}
});

test('Fine sampling holds foreground priority through worker initialization and cancellation',async()=>{
  const time=clock(),activity=new ScanActivity({...time,ready:true}),requests=[];let worker,requestedUrl;
  const source=new UltraVolumeSource({activity,manifestUrl:'https://scan.example/young/fine.json',cacheName:'young-fine',
    fetcher:async url=>{requestedUrl=url.href;return new Response(JSON.stringify({sourceSpacingUm:28.128}));},
    workerFactory:()=>worker={terminate(){},postMessage(m){requests.push(m);if(m.type==='init')queueMicrotask(()=>worker.onmessage({data:{type:'ready'}}));}}});
  const plane={center:[0,0,0],right:[1,0,0],up:[0,1,0],width:.1,height:.1},controller=new AbortController();
  try{
    const sampling=source.samplePlane(plane,{signal:controller.signal});assert.equal(activity.getState().foregroundCount,1);
    await until(()=>requests.some(r=>r.type==='sample'));
    assert.equal(requestedUrl,'https://scan.example/young/fine.json');assert.equal(requests.find(r=>r.type==='init').cacheName,'young-fine');
    assert.equal(requests.find(r=>r.type==='sample').spacingUm,28.128);
    controller.abort();await assert.rejects(sampling,{name:'AbortError'});assert.equal(activity.getState().foregroundCount,0);
    time.advance(1800);assert.equal(activity.getState().allowBackground,true);
  }finally{source.destroy();activity.dispose();}
});

test('Input observers are passive and a lost focus cannot leave background work paused forever',()=>{
  const time=clock(),handlers=new Map(),options=[];
  const document={visibilityState:'visible',addEventListener(type,fn,opts){handlers.set(type,fn);options.push(opts);},removeEventListener(){}};
  const window={addEventListener(type,fn,opts){handlers.set(type,fn);options.push(opts);},removeEventListener(){}};
  const activity=new ScanActivity({...time,ready:true,document,window});
  try{
    assert(options.every(o=>o.passive===true));handlers.get('pointerdown')({pointerId:1});time.advance(4000);
    assert.equal(activity.getState().allowBackground,false);handlers.get('blur')();time.advance(1800);
    assert.equal(activity.getState().allowBackground,true);
    handlers.get('wheel')({});assert.equal(activity.getState().allowBackground,false);time.advance(180);
    assert.equal(activity.getState().allowPrefetch,true);assert.equal(activity.getState().allowBackground,false);
    time.advance(1620);assert.equal(activity.getState().allowBackground,true);
  }finally{activity.dispose();}
});

test('Fine plane sizing defaults to the selected donor native display spacing',()=>{
  const plane={center:[0,0,0],right:[1,0,0],up:[0,1,0],width:1,height:1};
  const m={sourceSpacingUm:28.128,longestMm:28.128,fullDimensionsXYZ:[1001,1001,1001],sourceOriginXYZ:[0,0,0],
    sourceShapeXYZ:[1001,1001,1001],brickSize:64,storedEdge:65,brickCountsXYZ:[16,16,16],blocks:{}};
  const plan=planFinePlane(m,plane);assert.equal(plan.width,1001);assert.equal(plan.height,1001);
  assert(Math.abs(plan.spacingUmXY[0]-28.128)<1e-9);
});
