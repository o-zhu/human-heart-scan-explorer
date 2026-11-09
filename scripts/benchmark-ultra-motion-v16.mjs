/** Replays production cancellation semantics with real crop metadata and a fixed codec delay. */
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {HostedSectionStore as CurrentStore} from '../public/hosted-ultra.js';
import {SectionImageBackend as CurrentBackend} from '../public/ultra-prefetch.js';

const baseline='6ee683ee505b36e212e1b0f12a987a863d71ddf4';
const publicUrl=new URL('../public/',import.meta.url);
const moduleUrl=source=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const oldBackendSource=execFileSync('git',['show',`${baseline}:public/ultra-prefetch.js`],{encoding:'utf8'})
 .replaceAll('import.meta.url',JSON.stringify(new URL('ultra-prefetch.js',publicUrl).href));
const oldBackendUrl=moduleUrl(oldBackendSource);
const {SectionImageBackend:PreviousBackend}=await import(oldBackendUrl);
const oldStoreSource=execFileSync('git',['show',`${baseline}:public/hosted-ultra.js`],{encoding:'utf8'})
 .replaceAll("'./ultra-prefetch.js'",JSON.stringify(oldBackendUrl))
 .replaceAll("'./download-priority.js'",JSON.stringify(new URL('download-priority.js',publicUrl).href))
 .replaceAll('import.meta.url',JSON.stringify(new URL('hosted-ultra.js',publicUrl).href));
const {HostedSectionStore:PreviousStore}=await import(moduleUrl(oldStoreSource));
const donorSources=[
 ['ladaf-2021-17','../public/assets/ultra-sections/manifest.json'],
 ['s-20-29','../data/donors/s-20-29/ultra-sections/manifest.json'],
 ['s-20-28','../data/donors/s-20-28/ultra-sections/manifest.json']
];
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};

async function workload(Store,Backend,manifest,{stepMs,codecMs=40}){
 let now=0,nativeActive=0,maxNative=0,maxPixels=0,network=0;
 const native=[],selections=[],state={viewerReady:true,allowPrefetch:true,allowBackground:true,allowLocalPrefetch:true};
 const activity={getState:()=>state,subscribe:()=>()=>{},beginForeground:()=>()=>{}};
 const backend=new Backend({decodeConcurrency:2,cacheOptions:{cacheStorage:null},
  fetchImpl:()=>{network++;throw new Error('This fixture uses only downloaded images.');},
  decodeImpl:(blob,width,height,signal)=>new Promise(resolve=>{
   const job={index:blob.index,width,height,due:now+codecMs,signal,resolve,done:false};
   native.push(job);nativeActive++;maxNative=Math.max(maxNative,nativeActive);
   maxPixels=Math.max(maxPixels,native.filter(job=>!job.done).reduce((sum,job)=>sum+job.width*job.height,0));
  })});
 // Metadata is real, but compressed data/codec cost are deliberately modeled.
 // The browser's transport rejects a cancelled caller before the physical
 // bitmap codec returns. Reproducing that distinction is essential here.
 backend.cache.get=async url=>{
  const match=new URL(url).pathname.match(/\/([xyz])\/(\d+)\.webp$/);
  if(!match)throw new Error('Unexpected image URL in fixture.');
  const index=+match[2],record=manifest.slices[match[1]][index];
  return {blob:{size:record.bytes,index},cache:'persistent'};
 };
 const store=new Store({manifest,manifestUrl:'https://scan.example/manifest.json',activity,now:()=>now,
  autoDownloadCollection:false,idleDelay:1e6,visibility:()=>true,
  loader:(request,options)=>new Promise((resolve,reject)=>{
   const abort=()=>reject(new DOMException('cancelled transport','AbortError'));
   options.signal.addEventListener('abort',abort,{once:true});
   backend.load(request,options).then(resolve,reject).finally(()=>options.signal.removeEventListener('abort',abort));
  })});
 store.metrics.persistentAvailable=true;
 for(const entry of store.collectionEntries)store.collectionDone.add(entry.key);
 for(let axis=0;axis<3;axis++){
  const index=210,record=manifest.slices['xyz'[axis]][index];
  store.remember({key:`ultra:${axis}:${index}`,axis,index,data:new Uint8Array(record.crop[2]*record.crop[3]).fill(index)});
 }
 const advance=async target=>{
  while(now<target){
   now++;
   for(const job of native)if(!job.done&&job.due<=now){
    job.done=true;nativeActive--;job.resolve(new Uint8Array(job.width*job.height).fill(job.index&255));
   }
   await flush();
  }
 };
 let latest,controller;
 try{
  store.setFocus(1,210,{positions:[210,210,210]});await flush();await advance(200);
  state.allowPrefetch=false;state.allowBackground=false;store.plan(false);
  let index=210,direction=1;
  const strides=[3,5,7,4,8,5,3,6,4,7];
  for(let step=0;step<64;step++){
   await advance(200+step*stepMs);
   if(step===31)direction=-1;
   const stride=strides[step%strides.length];
   if(index+direction*stride>350||index+direction*stride<140)direction*=-1;
   index+=direction*stride;
   const selection={index,at:now,decodedAtSelection:store.has(1,index)};selections.push(selection);
   controller?.abort();controller=new AbortController();
   store.setFocus(1,index,{positions:[210,index,210]});
   latest=store.load(1,index,{signal:controller.signal}).then(result=>{
    selection.readyAt=now;selection.sample=result.data[0];return result;
   },error=>{selection.error=error.name;return null;});
   await flush();
  }
  const stoppedAt=now;
  await advance(now+codecMs*4);const final=await latest;
  return {selectionCount:selections.length,stepMs,codecMs,
   decodedAtSelection:selections.filter(s=>s.decodedAtSelection).length,
   exactRequestsCompleted:selections.filter(s=>s.readyAt!==undefined).length,
   nativeJobsStarted:native.length,cancelledAfterNativeStart:native.filter(job=>job.signal.aborted).length,
   maxPhysicalNativeJobs:maxNative,maxConcurrentNativePixels:maxPixels,
   decodedCacheBytes:store.cacheBytes,decodedLimit:store.decodedLimit,networkRequests:network,
   finalIndex:final?.index??null,expectedFinalIndex:index,finalSample:final?.data[0]??null,
   finalExactWaitMs:selections.at(-1).readyAt-stoppedAt};
 }finally{
  controller?.abort();store.dispose();backend.dispose();
  for(const job of native)if(!job.done){job.done=true;job.resolve(new Uint8Array(job.width*job.height));}
  await flush();
 }
}

const results=[];
for(const [donor,path] of donorSources){
 const manifest=JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
 for(const stepMs of [8,16])results.push({donor,stepMs,
  before:await workload(PreviousStore,PreviousBackend,manifest,{stepMs}),
  after:await workload(CurrentStore,CurrentBackend,manifest,{stepMs})});
}
const report={schemaVersion:1,baselineCommit:baseline,
 scope:'Deterministic worker-transport/codec scheduling fixture with real donor crop dimensions, 3–8-section strides, direction reversals, fully downloaded images, and a fixed 40 ms non-cancellable native decode. Not browser timing, WebP codec measurement, GPU FPS, or end-to-end perceived responsiveness.',
 results};
await mkdir(new URL('../docs/ultra-motion-v16/',import.meta.url),{recursive:true});
await writeFile(new URL('../docs/ultra-motion-v16/benchmark.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
