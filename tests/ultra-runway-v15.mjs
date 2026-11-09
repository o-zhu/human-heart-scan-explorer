/** Local decode runway, foreground priority and bounded surface reuse; no browser automation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {HostedSectionStore} from '../public/hosted-ultra.js';
import {SectionImageBackend,SectionImageDecoder} from '../public/ultra-prefetch.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate,label) {
  for (let i=0;i<1000;i++) { if (predicate()) return; await tick(); }
  throw new Error(`Timed out: ${label}`);
}
function manifest({width=64,height=64,count=96}={}) {
  return {schemaVersion:2,cropped:true,spacingUm:79.4,sliceCounts:[count,count,count],
    imageDimensionsXYZ:[width,height,count*4],sourceIndexStep:4,sourceWindow:[14640,23545],compressionLossless:true,
    assetBaseUrl:'https://scan.example/ultra/',slices:Object.fromEntries([...'xyz'].map(axis=>[axis,
      Array.from({length:count},(_,index)=>({path:`${axis}/${index}.webp`,bytes:4096,crop:[0,0,width,height]}))]))};
}
function harness({activeInput=true,connection,decodedLimit=96*1024*1024}={}) {
  const jobs=[],m=manifest(),state={viewerReady:true,allowPrefetch:!activeInput,allowBackground:!activeInput};
  const activity={getState:()=>state,subscribe:()=>()=>{},beginForeground:()=>()=>{}};
  const store=new HostedSectionStore({manifest:m,manifestUrl:'https://scan.example/manifest.json',activity,
    connection,decodedLimit,idleDelay:1e6,autoDownloadCollection:false,visibility:()=>true,
    loader:(request,{signal,onProgress})=>new Promise((resolve,reject)=>{
      const job={request,resolve,reject};jobs.push(job);onProgress({stage:'decode'});
      signal.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true});
    })});
  store.metrics.persistentAvailable=true;
  for(const entry of store.collectionEntries)store.collectionDone.add(entry.key);
  for(let axis=0;axis<3;axis++)store.remember({key:`ultra:${axis}:32`,axis,index:32,data:new Uint8Array(4096)});
  store.setFocus(0,32,{positions:[32,32,32]});
  const finish=job=>job.resolve({data:new Uint8Array(4096).fill(job.request.index),encodedCacheHit:true,receivedBytes:0});
  return {store,jobs,state,finish,close(){store.dispose();for(const job of jobs)finish(job);}};
}

test('Two disk-only neighbors decode during input, while the selected face retains its own task slot',async()=>{
  const h=harness();try{
    await until(()=>h.jobs.length===2,'two local decodes');
    assert(h.jobs.every(job=>job.request.localOnly));
    assert.deepEqual(h.jobs.map(job=>job.request.index),[33,31]);
    assert.equal(h.store.active.size,2);
    const selected=h.store.load(2,80);
    await until(()=>h.jobs.length===3,'selected face starts without waiting for either neighbor');
    assert.equal(h.jobs[2].request.axis,2);assert.equal(h.jobs[2].request.index,80);
    assert.equal(h.jobs[2].request.priority,0);assert.equal(h.jobs[2].request.localOnly,false);
    assert.equal(h.store.active.size,3);
    h.finish(h.jobs[2]);assert.equal((await selected).data[0],80);
  }finally{h.close();}
});

test('A finished download gets the same directional decode runway before idle and throughout a scroll',async()=>{
  const h=harness({activeInput:false});try{
    const neighbors=[...h.store.wanted.values()].filter(item=>item.kind==='neighbor');
    assert.equal(neighbors.length,14);
    for(let index=33;index<=44;index++)assert.equal(h.store.wanted.get(`ultra:0:${index}`).localOnly,true);
    assert(h.store.wanted.has('ultra:0:31'));assert(h.store.wanted.has('ultra:0:30'));
    h.state.allowPrefetch=false;h.state.allowBackground=false;h.store.plan(false);
    assert.equal([...h.store.wanted.values()].filter(item=>item.kind==='neighbor').length,14);
    await until(()=>h.jobs.length===2,'local runway starts');
    assert(h.jobs.every(job=>job.request.localOnly));
  }finally{h.close();}
});

test('Slow-network and save-data policies constrain transfers without serializing downloaded neighbors',async()=>{
  for(const connection of [{effectiveType:'2g'},{saveData:true}]){
    const h=harness({connection});try{
      await until(()=>h.jobs.length===2,'two stored-image jobs on a restricted connection');
      assert.equal(h.store.policy().concurrency,1);assert.equal(h.store.policy().taskConcurrency,3);
      assert(h.jobs.every(job=>job.request.localOnly));
      const first=h.store.load(2,80),second=h.store.load(2,81);
      await until(()=>h.jobs.length===3,'one foreground request');
      // Both local tasks are already decoding, so only the reserved slot is used.
      assert.equal(h.jobs[2].request.index,80);assert.equal(h.store.active.size,3);
      h.finish(h.jobs[2]);await first;
      await until(()=>h.jobs.length===4,'next foreground request');
      assert.equal(h.jobs[3].request.index,81);h.finish(h.jobs[3]);await second;
    }finally{h.close();}
  }
});

test('A selected face preempts an occupied transfer slot even when local task slots are free',async()=>{
  for(const connection of [{effectiveType:'2g'},{saveData:true}]){
    const jobs=[],store=new HostedSectionStore({manifest:manifest(),manifestUrl:'https://scan.example/manifest.json',
      connection,autoDownloadCollection:false,visibility:()=>true,
      loader:(request,{signal,onProgress})=>new Promise((resolve,reject)=>{
        jobs.push({request,signal,resolve});onProgress({stage:'loading'});
        signal.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true});
      })});
    store.metrics.persistentAvailable=true;
    const otherController=new AbortController();let other,selected;
    try{
      other=store.load(1,2,{priority:30,signal:otherController.signal}).catch(error=>{if(error.name!=='AbortError')throw error;});
      await until(()=>jobs.length===1,'lower-priority card transfer');
      assert.equal(store.policy().taskConcurrency,3);assert.equal(store.policy().concurrency,1);
      selected=store.load(0,3,{priority:0});
      await until(()=>jobs.some(job=>job.request.axis===0),'selected transfer preempts the lower-priority card');
      assert.equal(jobs[0].signal.aborted,true);assert.equal(store.metrics.preempted,1);
      const current=jobs.find(job=>job.request.axis===0);
      assert.equal(current.request.priority,0);assert.equal(current.signal.aborted,false);
      current.resolve({data:new Uint8Array(4096).fill(83),receivedBytes:4096});
      assert.equal((await selected).data[0],83);
    }finally{otherController.abort();store.dispose();for(const job of jobs)job.resolve({data:new Uint8Array(4096)});await other;}
  }
});

test('The local runway obeys the decoded-byte budget, and local misses remain network-free',async()=>{
  const h=harness({decodedLimit:8*4096});try{
    const planned=[...h.store.wanted.values()].filter(item=>item.kind==='neighbor');
    assert.equal(planned.length,5);assert(planned.length*4096<=h.store.decodedLimit*.7);
    const jobsHandled=new Set();
    for(let round=0;round<100;round++){
      await tick();
      for(const job of h.jobs)if(!jobsHandled.has(job)){
        jobsHandled.add(job);const error=new Error('not stored');error.name='CacheMissError';job.reject(error);
      }
      if(!h.store.active.size&&!h.store.pending.size)break;
    }
    assert(h.jobs.length<=5);assert(h.jobs.every(job=>job.request.localOnly));
    assert(h.store.localMissUntil.has('ultra:0:33'));assert(h.store.cacheBytes<=h.store.decodedLimit);
  }finally{h.close();}
});

test('Low-memory devices keep one local decode, and optional warming waits for a usable viewer',async()=>{
  const navigator=globalThis.navigator,previous=Object.getOwnPropertyDescriptor(navigator,'deviceMemory');
  Object.defineProperty(navigator,'deviceMemory',{value:2,configurable:true});
  const h=harness();try{
    h.state.viewerReady=false;h.store.plan(false);
    await tick();assert.equal(h.jobs.length,0);
    assert.equal(h.store.policy().localSpeculative,0);
    h.state.viewerReady=true;h.store.plan(false);
    await until(()=>h.jobs.length===1,'one local decode on a low-memory device');
    assert.equal(h.store.policy().localSpeculative,1);assert.equal(h.store.active.size,1);
  }finally{
    h.close();if(previous)Object.defineProperty(navigator,'deviceMemory',previous);else delete navigator.deviceMemory;
  }
});

test('An incomplete collection keeps bounded near-neighbor downloads and a network-free farther runway',()=>{
  const h=harness({activeInput:false});try{
    h.store.collectionDone.clear();h.store.plan(false);
    assert.equal(h.store.wanted.get('ultra:0:33').localOnly,false,'The nearer network plan must not be overwritten by local-only warming.');
    assert.equal(h.store.wanted.get('ultra:0:35').localOnly,false);
    assert.equal(h.store.wanted.get('ultra:0:36').localOnly,true);
    assert.equal(h.store.wanted.get('ultra:0:44').localOnly,true);
    h.state.allowPrefetch=false;h.store.plan(false);
    assert([...h.store.wanted.values()].filter(item=>item.kind==='neighbor').every(item=>item.localOnly));
  }finally{h.close();}
});

function mockDecodeSurface() {
  const previous={bitmap:globalThis.createImageBitmap,canvas:globalThis.OffscreenCanvas,document:globalThis.document};
  const counts={canvases:0,contexts:0,resizes:0,clears:0,closes:0},surfaces=[];
  class Surface {
    constructor(width,height){this.w=width;this.h=height;counts.canvases++;surfaces.push(this);}
    get width(){return this.w;}set width(value){this.w=value;counts.resizes++;}
    get height(){return this.h;}set height(value){this.h=value;counts.resizes++;}
    getContext(){counts.contexts++;return {clearRect(){counts.clears++;},drawImage:bitmap=>{this.value=bitmap.value;},
      getImageData:(_x,_y,width,height)=>{const data=new Uint8Array(width*height*4);for(let i=0;i<data.length;i+=4){data[i]=this.value;data[i+1]=13;data[i+2]=17;data[i+3]=255;}return {data};}};}
  }
  globalThis.OffscreenCanvas=Surface;
  globalThis.createImageBitmap=async blob=>({width:blob.width,height:blob.height,value:blob.value,close(){counts.closes++;}});
  return {counts,surfaces,restore(){
    if(previous.bitmap===undefined)delete globalThis.createImageBitmap;else globalThis.createImageBitmap=previous.bitmap;
    if(previous.canvas===undefined)delete globalThis.OffscreenCanvas;else globalThis.OffscreenCanvas=previous.canvas;
    if(previous.document===undefined)delete globalThis.document;else globalThis.document=previous.document;
  }};
}

test('Repeated native images reuse one decoder surface and preserve every grayscale sample',async()=>{
  const env=mockDecodeSurface(),decoder=new SectionImageDecoder();try{
    for(let index=0;index<32;index++){
      const width=32-index%3,height=48-index%5,value=index*7;
      const data=await decoder.decode({width,height,value},width,height);
      assert.equal(data.length,width*height);assert(data.every(pixel=>pixel===value));
    }
    assert.equal(env.counts.canvases,1);assert.equal(env.counts.contexts,1);
    assert.equal(env.counts.resizes,0);assert.equal(env.counts.clears,31);assert.equal(env.counts.closes,32);
    decoder.dispose();assert.equal(env.surfaces[0].width,1);assert.equal(env.surfaces[0].height,1);
  }finally{decoder.dispose();env.restore();}
});

test('Surface growth retains its byte bound; an oversized or disposed surface is released',async()=>{
  const env=mockDecodeSurface(),decoder=new SectionImageDecoder({surfaceLimit:512});try{
    await decoder.decode({width:8,height:8,value:20},8,8);
    await decoder.decode({width:8,height:12,value:30},8,12);
    assert.equal(env.counts.canvases,1);assert.equal(env.counts.resizes,1);
    await decoder.decode({width:16,height:16,value:40},16,16);
    assert.equal(decoder.surface,null);assert.equal(env.surfaces[0].width,1);assert.equal(env.surfaces[0].height,1);
    await decoder.decode({width:8,height:8,value:50},8,8);assert.equal(env.counts.canvases,2);
    decoder.dispose();await assert.rejects(()=>decoder.decode({width:8,height:8,value:60},8,8),{name:'AbortError'});
  }finally{decoder.dispose();env.restore();}
});

test('Overlapping compatibility decodes lease independent surfaces without mixing image values',async()=>{
  const env=mockDecodeSurface(),decoder=new SectionImageDecoder();globalThis.document={};try{
    const width=1024,height=1024;
    const images=await Promise.all([71,149].map(value=>decoder.decode({width,height,value},width,height)));
    assert(images[0].every(pixel=>pixel===71));assert(images[1].every(pixel=>pixel===149));
    assert.equal(env.counts.canvases,2);assert.equal(env.counts.closes,2);
    assert.equal(env.surfaces.filter(surface=>surface.width>1).length,1,'At most one surface is retained.');
  }finally{decoder.dispose();env.restore();}
});

test('The production backend retains the decoder per worker and releases it on dispose',()=>{
  const backend=new SectionImageBackend({cacheOptions:{cacheStorage:null}});
  assert(backend.decoder instanceof SectionImageDecoder);
  backend.dispose();assert.equal(backend.decoder.disposed,true);
});
