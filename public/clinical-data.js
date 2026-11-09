import {getDeviceResourcePolicy} from './device-resources.js';

export function validateClinicalManifest(manifest){
 if(!Array.isArray(manifest.series)||!manifest.series.length)throw new Error('No clinical series is available.');
 const ids=new Set();
 for(const series of manifest.series){
  if(!series.id||ids.has(series.id))throw new Error('Clinical series identity is invalid.');ids.add(series.id);
  if(!Array.isArray(series.dimensions)||series.dimensions.length!==3||series.dimensions.some(n=>!Number.isInteger(n)||n<2))throw new Error('Clinical dimensions are invalid.');
  if(!Array.isArray(series.spacingMm)||series.spacingMm.length!==3||series.spacingMm.some(n=>!Number.isFinite(n)||n<=0))throw new Error('Clinical physical scale is invalid.');
  if(!Array.isArray(series.frames)||!series.frames.length)throw new Error('Clinical series has no measured frames.');
  const count=series.dimensions.reduce((a,b)=>a*b,1);
  for(const frame of series.frames)if(!frame.url||frame.decodedBytes!==count||!Number.isInteger(frame.index)||!/^[a-f0-9]{64}$/.test(frame.sha256||''))throw new Error('Clinical frame inventory is invalid.');
 }
 return manifest;
}

export function snapSectionPosition(position,count){
 return Math.round(Math.max(0,Math.min(1,Number(position)||0))*(count-1))/(count-1);
}

/** One physical decoder; selected frames outrank the small neighbor runway. */
export class ClinicalFrameStore{
 constructor({maxBytes,workerFactory,resourcePolicy=getDeviceResourcePolicy()}={}){
  this.resourcePolicy=resourcePolicy;this.maxBytes=maxBytes??resourcePolicy.clinicalFrameBytes;
  this.workerFactory=workerFactory||(()=>new Worker(new URL('./clinical-volume-worker.js',import.meta.url),{type:'module'}));
  this.cache=new Map();this.cacheBytes=0;this.queue=[];this.active=null;
 }
 cached(frame){const key=frame.sha256,item=this.cache.get(key);if(item){this.cache.delete(key);this.cache.set(key,item);}return item?.data||null;}
 load(frame,{priority=true}={}){
  if(priority)this.queue=this.queue.filter(item=>{if(!item.priority||item.frame.sha256===frame.sha256)return true;item.reject(new DOMException('A newer phase was requested.','AbortError'));return false;});
  const cached=this.cached(frame);if(cached)return Promise.resolve(cached);
  if(this.active?.frame.sha256===frame.sha256){this.active.priority||=priority;return this.active.promise;}
  let item=this.queue.find(item=>item.frame.sha256===frame.sha256);
  if(item){item.priority||=priority;this.queue.sort((a,b)=>Number(b.priority)-Number(a.priority));return item.promise;}
  if(priority&&this.active&&!this.active.priority){this.active.worker.terminate();this.active.reject(new DOMException('Selected frame has priority.','AbortError'));this.active=null;}
  item={frame,priority};item.promise=new Promise((resolve,reject)=>{item.resolve=resolve;item.reject=reject;});
  this.queue.push(item);this.queue.sort((a,b)=>Number(b.priority)-Number(a.priority));this.pump();return item.promise;
 }
 pump(){
  if(this.active||!this.queue.length)return;
  const item=this.active=this.queue.shift(),worker=item.worker=this.workerFactory();
  const finish=error=>{worker.terminate();if(this.active!==item)return;this.active=null;if(error)item.reject(error);this.pump();};
  worker.onmessage=event=>{
   if(this.active!==item)return;
   if(event.data.error){finish(new Error(event.data.error));return;}
   const data=new Uint8Array(event.data.buffer);
   const previous=this.cache.get(item.frame.sha256);if(previous)this.cacheBytes-=previous.data.byteLength;this.cache.delete(item.frame.sha256);
   // A selected source frame may be displayed without retaining an oversized
   // duplicate in the replay cache. Never change its measured source voxels.
   if(data.byteLength<=this.maxBytes){this.cache.set(item.frame.sha256,{data});this.cacheBytes+=data.byteLength;}
   while(this.cacheBytes>this.maxBytes){const key=this.cache.keys().next().value;this.cacheBytes-=this.cache.get(key).data.byteLength;this.cache.delete(key);}
   item.resolve(data);finish();
  };
  worker.onerror=()=>finish(new Error('The clinical frame decoder could not start.'));
  worker.postMessage({...item.frame,url:new URL(item.frame.url,globalThis.location?.href||'http://localhost/').href,priority:item.priority?'high':'low'});
 }
 warm(series,index){
  // Keep a short runway; mobile warms only the next frame, and only when a
  // pair can fit within its cache budget. Active selection still takes priority.
  const offsets=this.resourcePolicy.constrained?[1]:[1,2,-1,-2];
  const indices=offsets.map(i=>(index+i+series.frames.length)%series.frames.length)
   .filter(i=>!this.resourcePolicy.constrained||series.frames[i].decodedBytes<=this.maxBytes/2);
  const allowed=new Set(indices.map(i=>series.frames[i].sha256));
  this.queue=this.queue.filter(item=>{if(item.priority||allowed.has(item.frame.sha256))return true;item.reject(new DOMException('Superseded neighbor.','AbortError'));return false;});
  for(const i of new Set(indices))void this.load(series.frames[i],{priority:false}).catch(()=>{});
 }
 dispose(){
  this.active?.worker.terminate();this.active?.reject(new DOMException('Source changed.','AbortError'));this.active=null;
  for(const item of this.queue)item.reject(new DOMException('Source changed.','AbortError'));this.queue=[];this.cache.clear();this.cacheBytes=0;
 }
}
