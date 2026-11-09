/** Deterministic scheduler workload, not a browser/FPS benchmark. */
import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {HostedSectionStore as CurrentStore} from '../public/hosted-ultra.js';

const baseline='b77382f7c400b29c82651d75b32e85c6e6bfbefe';
const publicUrl=new URL('../public/',import.meta.url);
const source=execFileSync('git',['show',`${baseline}:public/hosted-ultra.js`],{encoding:'utf8'})
  .replaceAll("'./ultra-prefetch.js'",JSON.stringify(new URL('ultra-prefetch.js',publicUrl).href))
  .replaceAll("'./download-priority.js'",JSON.stringify(new URL('download-priority.js',publicUrl).href))
  .replaceAll('import.meta.url',JSON.stringify(new URL('hosted-ultra.js',publicUrl).href));
const {HostedSectionStore:PreviousStore}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const manifest={schemaVersion:2,cropped:true,spacingUm:79.4,sliceCounts:[160,160,160],imageDimensionsXYZ:[637,637,637],
  sourceIndexStep:4,sourceWindow:[14640,23545],compressionLossless:true,assetBaseUrl:'https://scan.example/ultra/',
  slices:Object.fromEntries([...'xyz'].map(axis=>[axis,Array.from({length:160},(_,index)=>({path:`${axis}/${index}.webp`,bytes:400000,crop:[0,0,128,128]}))]))};
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
async function workload(Store,{stepMs,decodeMs=30}){
  let now=0,maxActive=0;const jobs=[],events=[];
  const state={viewerReady:true,allowPrefetch:true,allowBackground:true};
  const activity={getState:()=>state,subscribe:()=>()=>{},beginForeground:()=>()=>{}};
  const store=new Store({manifest,manifestUrl:'https://scan.example/manifest.json',activity,idleDelay:1e6,
    now:()=>now,autoDownloadCollection:false,visibility:()=>true,
    loader:(request,{signal,onProgress})=>new Promise((resolve,reject)=>{
      const job={request,done:false,resolve,reject,due:now+decodeMs};jobs.push(job);onProgress({stage:'decode'});
      maxActive=Math.max(maxActive,jobs.filter(j=>!j.done).length);
      signal.addEventListener('abort',()=>{job.done=true;reject(new DOMException('cancelled','AbortError'));},{once:true});
    })});
  store.metrics.persistentAvailable=true;
  for(const entry of store.collectionEntries)store.collectionDone.add(entry.key);
  for(let axis=0;axis<3;axis++)store.remember({key:`ultra:${axis}:32`,axis,index:32,data:new Uint8Array(128*128)});
  const advance=async target=>{
    while(now<target){
      now++;
      for(const job of jobs)if(!job.done&&job.due<=now){job.done=true;job.resolve({data:new Uint8Array(128*128).fill(job.request.index),encodedCacheHit:true,receivedBytes:0});}
      await flush();
    }
  };
  try{
    store.setFocus(0,32,{positions:[32,32,32]});await flush();await advance(200);
    state.allowPrefetch=false;state.allowBackground=false;store.plan(false);await flush();
    let previous;
    for(let step=0;step<64;step++){
      await advance(200+step*stepMs);
      const index=33+step,event={index,immediate:store.has(0,index),at:now};events.push(event);
      previous?.abort();previous=new AbortController();
      store.setFocus(0,index,{positions:[index,32,32]});
      void store.load(0,index,{signal:previous.signal}).then(()=>{event.readyAt=now;},()=>{event.cancelled=true;});
      await flush();
    }
    await advance(now+decodeMs*2);
    const immediate=events.filter(e=>e.immediate).length;
    return {steps:events.length,immediatelyDecoded:immediate,waitingForDecode:events.length-immediate,
      immediatePercent:Number((immediate/events.length*100).toFixed(1)),maxConcurrentTasks:maxActive,
      networkPermittedJobsDuringInput:jobs.filter(job=>job.due>200+decodeMs&&!job.request.localOnly).length,
      decodedCacheBytes:store.cacheBytes,decodedLimit:store.decodedLimit,
      finalExactIndex:store.cached(0,96)?.index??null,finalExactSample:store.cached(0,96)?.data[0]??null};
  }finally{store.dispose();}
}
const results=[];
for(const stepMs of [16,20,24])results.push({stepMs,decodeMs:30,before:await workload(PreviousStore,{stepMs}),after:await workload(CurrentStore,{stepMs})});
const report={schemaVersion:1,baselineCommit:baseline,kind:'deterministic scheduler fixture',
  description:'Fully downloaded images; native decode requests use a fixed 30 ms asynchronous completion. 200 ms initial warmup followed by 64 forward scroll selections. No browser, GPU, network, WebP codec, or human perception is measured.',
  results};
await writeFile(new URL('../docs/ultra-runway-v15-benchmark.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
