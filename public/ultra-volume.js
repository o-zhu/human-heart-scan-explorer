import {checkFineAbort,fineAbort,finePlaneKey,sameFinePlane,reusableFineSection,fineSourceExtent,orientFineSection} from './ultra-volume-core.js';
import {scanActivity} from './download-priority.js';
import {getDeviceResourcePolicy} from './device-resources.js';
import {withAbort} from './load-watchdog.js';
/** One shared fine-volume worker, separate from the lightweight 3D surface volume. */
export class UltraVolumeSource {
 constructor({fetcher=(...args)=>fetch(...args),workerFactory=url=>new Worker(url,{type:'module'}),
              manifestUrl='./assets/ultra-volume-v7.json',cacheName,activity=scanActivity,resourcePolicy=getDeviceResourcePolicy()}={}){
  this.resourcePolicy=resourcePolicy;
  this.fetcher=fetcher;this.workerFactory=workerFactory;this.jobs=new Map();this.serial=0;this.results=new Map();this.bytes=0;this.limit=resourcePolicy.resultCacheBytes;this.destroyed=false;this.generation=0;
  this.manifestUrl=new URL(manifestUrl,import.meta.url);this.cacheName=cacheName;this.activity=activity;
 }
 async init(){
  if(this.destroyed)throw fineAbort();if(this.ready)return this.ready;
  if(!globalThis.crypto?.subtle?.digest)throw new Error('Verified fine detail requires HTTPS or localhost. Open the secure site to load Ultra detail.');
  const generation=++this.generation,controller=new AbortController();this.initController=controller;let worker;
  const checkAlive=()=>{if(this.destroyed||this.generation!==generation)throw fineAbort();if(controller.signal.aborted)throw controller.signal.reason;};
  const timeout=setTimeout(()=>{const error=new Error('Fine-detail initialization stopped responding. Retry the view.');error.name='TimeoutError';controller.abort(error);},30000);
  this.ready=(async()=>{
   const response=await withAbort(this.fetcher(this.manifestUrl,{cache:'force-cache',signal:controller.signal,priority:'high'}),controller.signal);checkAlive();
   if(!response.ok)throw new Error('The fine volume metadata is unavailable.');this.manifest=await withAbort(response.json(),controller.signal);checkAlive();
   worker=this.workerFactory(new URL('./ultra-volume-worker.js',import.meta.url));this.worker=worker;
   worker.onmessage=({data:m})=>{
    if(this.destroyed||this.generation!==generation)return;
    if(m.type==='ready'){this.workerReady?.();return;}
    const job=this.jobs.get(m.id);if(!job)return;
    if(m.type==='progress'){try{job.onProgress?.(m.progress);}catch{}return;}
    this.jobs.delete(m.id);job.signal?.removeEventListener('abort',job.abort);
    if(m.type==='warmed'){this.stats=m.stats;job.resolve(m.result);}
    else if(m.type==='miss'){this.stats=m.stats;job.resolve(null);}
    else if(m.type==='result'){
     const result={...m.result,data:new Uint8Array(m.result.data)};this.stats=m.stats;
     if(!job.signal?.aborted){this.remember(job.key,result);job.resolve(result);}else job.reject(fineAbort());
    }else{const error=new Error(m.message||'Fine volume sampling failed.');error.name=m.name||'Error';job.reject(error);}
   };
   worker.onerror=()=>{if(this.generation!==generation)return;const error=new Error('The fine scan worker could not run.');for(const job of this.jobs.values()){job.signal?.removeEventListener('abort',job.abort);job.reject(error);}this.jobs.clear();this.workerFailed?.(error);worker.terminate();this.worker=null;this.ready=null;};
   // Resolve on Window: iPadOS workers do not expose the touch information that
   // distinguishes an iPad's desktop-style user agent from a desktop Mac.
   await withAbort(new Promise((resolve,reject)=>{this.workerReady=resolve;this.workerFailed=reject;worker.postMessage({type:'init',manifest:this.manifest,baseUrl:import.meta.url,cacheName:this.cacheName,resourcePolicy:this.resourcePolicy});}),controller.signal);checkAlive();
   return this.manifest;
  })().catch(error=>{worker?.terminate();if(this.generation===generation){this.ready=null;this.worker=null;this.workerReady=null;this.workerFailed=null;}throw error;}).finally(()=>clearTimeout(timeout));return this.ready;
 }
 remember(key,result){
  const old=this.results.get(key);if(old)this.bytes-=old.data.byteLength;this.results.delete(key);
  if(result.data.byteLength>this.limit)return;
  this.results.set(key,result);this.bytes+=result.data.byteLength;
  while(this.bytes>this.limit){const first=this.results.keys().next().value;this.bytes-=this.results.get(first).data.byteLength;this.results.delete(first);}
 }
 async samplePlane(plane,{signal,onProgress,spacingUm,exactRaster=false,persistSection=false,residentOnly=false,priority,retainTransfers=priority==='interactive'}={}){
  checkFineAbort(signal);
  if(!residentOnly)this.cancelWarm();
  const release=(!residentOnly&&this.activity?.beginForeground('fine-plane'))||(()=>{});
  try{
   await this.init();checkFineAbort(signal);if(this.destroyed)throw fineAbort();
   spacingUm??=this.manifest.sourceSpacingUm||79.4;
   const prefix=finePlaneKey(plane)+'|',key=prefix+spacingUm;
   // A native prepared plane already in RAM also serves a screen-resolution
   // movement request. Do not throw it away merely because the requested
   // output spacing changed from "settled" to "moving".
   let cachedKey=key,cached=this.results.get(key);
   // A prior free-probe request can cache a larger coplanar image under this
   // request key. Atlas views require the returned image's actual rectangle.
   const matchesRaster=value=>!!value?.plane&&sameFinePlane(value.plane,plane,1e-8);
   if(exactRaster&&cached&&!matchesRaster(cached))cached=null;
   const extent=fineSourceExtent(this.manifest);
   for(const [candidate,value] of this.results)if(value.spacingUm<=spacingUm+.04&&(exactRaster?matchesRaster(value):(candidate.startsWith(prefix)||reusableFineSection(value.plane,plane,extent)))&&(!cached||value.spacingUm<cached.spacingUm)){cached=value;cachedKey=candidate;}
   if(cached){this.results.delete(cachedKey);this.results.set(cachedKey,cached);try{onProgress?.({ready:1,total:1,phase:'complete',local:true,resident:true,reused:true});}catch{}return cachedKey.startsWith(prefix)?cached:{...cached,plane:orientFineSection(cached.plane,plane),reusedSection:true};}
   return await new Promise((resolve,reject)=>{
    const id=++this.serial,abort=()=>{this.worker?.postMessage({type:'cancel',id});this.jobs.delete(id);signal?.removeEventListener('abort',abort);reject(fineAbort());};
    signal?.addEventListener('abort',abort,{once:true});this.jobs.set(id,{key,signal,onProgress,resolve,reject,abort});
    if(signal?.aborted){abort();return;}
    try{this.worker.postMessage({type:'sample',id,plane,spacingUm,exactRaster,persistSection,residentOnly,retainTransfers});}
    catch(error){this.jobs.delete(id);signal?.removeEventListener('abort',abort);reject(error);}
   });
  }finally{release();}
 }
 async sampleResidentPlane(plane,options={}){if(!this.ready||this.destroyed)return null;return this.samplePlane(plane,{...options,residentOnly:true});}
 async warmPlane(plane,{signal,localOnly=true,paddingMm=3,retainTransfers=false,currentPlane=false}={}){
  await this.init();checkFineAbort(signal);if(this.destroyed)throw fineAbort();
  return new Promise((resolve,reject)=>{
   const id=++this.serial,abort=()=>{this.worker?.postMessage({type:'cancel',id});this.jobs.delete(id);signal?.removeEventListener('abort',abort);reject(fineAbort());};
   signal?.addEventListener('abort',abort,{once:true});this.jobs.set(id,{signal,resolve,reject,abort});
   if(signal?.aborted){abort();return;}
   try{this.worker.postMessage({type:'warm',id,plane,localOnly,paddingMm,retainTransfers,currentPlane});}catch(error){this.jobs.delete(id);signal?.removeEventListener('abort',abort);reject(error);}
  });
 }
 scheduleWarmPlane(plane){
  this.cancelWarm();if(this.destroyed)return;
  const generation=this.warmGeneration;let running=false,complete=false,network=false;
  const run=async(localOnly)=>{
   if(running||complete||this.destroyed||generation!==this.warmGeneration)return;
   running=true;network=!localOnly;const controller=new AbortController();this.warmController=controller;
   try{await this.warmPlane(plane,{signal:controller.signal,localOnly});if(!localOnly)complete=true;}
   catch(error){if(error.name!=='AbortError')complete=true;}
   finally{
    running=false;if(this.warmController===controller)this.warmController=null;
    if(generation===this.warmGeneration){if(complete){this.warmUnsubscribe?.();this.warmUnsubscribe=null;}else if(this.activity?.getState().allowBackground)void run(false);}
   }
  };
  // Existing local bricks may be decoded without downloading anything. Optional
  // network warming starts only while the viewer is quiet, and stops immediately
  // for a gesture or foreground request. It never blocks the prepared first view.
  void run(true);
  this.warmUnsubscribe=this.activity?.subscribe(state=>{
   if(generation!==this.warmGeneration)return;
   if(!state.allowBackground&&running&&network)this.warmController?.abort();
   else if(state.allowBackground)void run(false);
  });
 }
 cancelWarm(){this.warmGeneration=(this.warmGeneration||0)+1;this.warmUnsubscribe?.();this.warmUnsubscribe=null;this.warmController?.abort();this.warmController=null;}
 getStatus(){return {...this.stats,resultBytes:this.bytes,active:this.jobs.size,sourceSpacingUm:this.manifest?.sourceSpacingUm};}
 destroy(){this.destroyed=true;this.cancelWarm();this.generation++;this.initController?.abort();this.workerFailed?.(fineAbort());for(const job of [...this.jobs.values()])job.abort();this.worker?.terminate();this.worker=null;this.workerReady=null;this.workerFailed=null;this.results.clear();this.bytes=0;this.ready=null;}
}
export const ultraVolume=new UltraVolumeSource();
