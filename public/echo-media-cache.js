/** Selected-only, bounded MP4 delivery for hosts without HTTP byte ranges. */
export const ECHO_MEDIA_CACHE_BYTES = 8 * 1024 * 1024;
export const ECHO_MEDIA_MAX_CLIP_BYTES = 4 * 1024 * 1024;
const abortError = () => new DOMException('The selected movie changed.', 'AbortError');

export class EchoMediaCache {
 constructor({maxBytes=ECHO_MEDIA_CACHE_BYTES,maxClipBytes=ECHO_MEDIA_MAX_CLIP_BYTES,
  fetcher=(...args)=>fetch(...args),createURL=blob=>URL.createObjectURL(blob),revokeURL=url=>URL.revokeObjectURL(url)}={}){
  this.maxBytes=Math.min(maxBytes,ECHO_MEDIA_CACHE_BYTES);this.maxClipBytes=Math.min(maxClipBytes,ECHO_MEDIA_MAX_CLIP_BYTES,this.maxBytes);
  this.fetcher=fetcher;this.createURL=createURL;this.revokeURL=revokeURL;
  this.entries=new Map();this.bytes=0;this.activeKey=null;this.pending=null;this.destroyed=false;
 }
 key(clip){return `${clip.url}|${clip.bytes}|${clip.sha256||''}`;}
 validate(clip){
  if(!/^\.\/assets\/echo-media-v[67]\/(tte|tee)-[a-z0-9_]+\.mp4$/.test(clip?.url||'')||
   !Number.isSafeInteger(clip?.bytes)||clip.bytes<=0||clip.bytes>this.maxClipBytes)
   throw new Error('This reference movie is not in the supported local media collection.');
 }
 peek(clip){
  const key=this.key(clip),entry=this.entries.get(key);
  if(entry){this.entries.delete(key);this.entries.set(key,entry);}return entry||null;
 }
 /** The caller must detach the old video source before releasing its pin. */
 setActive(entry){
  if(entry&&this.entries.get(entry.key)!==entry)throw new Error('The movie is no longer cached.');
  this.activeKey=entry?.key||null;
 }
 cancel(){const job=this.pending;this.pending=null;if(job)job.controller.abort();}
 trim(incoming){
  for(const [key,entry] of this.entries){
   if(this.bytes+incoming<=this.maxBytes)break;
   if(key===this.activeKey)continue;
   this.entries.delete(key);this.bytes-=entry.bytes;this.revokeURL(entry.url);
  }
  if(this.bytes+incoming>this.maxBytes)throw new Error('The reference movie cache is full.');
 }
 load(clip,{onProgress}={}){
  if(this.destroyed)return Promise.reject(abortError());
  try{this.validate(clip);}catch(error){return Promise.reject(error);}
  const key=this.key(clip);
  if(this.pending?.key===key){this.pending.onProgress=onProgress;return this.pending.promise;}
  this.cancel();
  const cached=this.peek(clip);
  if(cached){onProgress?.(cached.bytes,cached.bytes);return Promise.resolve(cached);}
  const job={key,clip,onProgress,controller:new AbortController()};this.pending=job;
  job.promise=this.fetchMovie(job).finally(()=>{if(this.pending===job)this.pending=null;});return job.promise;
 }
 check(job){if(this.destroyed||this.pending!==job||job.controller.signal.aborted)throw abortError();}
 async fetchMovie(job){
  const {clip}=job;let reader,response,complete=false;
  try{
   this.check(job);job.onProgress?.(0,clip.bytes);
   response=await this.fetcher(clip.url,{signal:job.controller.signal,cache:'force-cache',credentials:'same-origin'});
   this.check(job);
   if(response.status!==200)throw new Error(`Reference movie returned ${response.status}.`);
   const length=response.headers.get('content-length');
   if(length!==null&&(!/^\d+$/.test(length)||Number(length)!==clip.bytes))throw new Error('The reference movie size does not match its catalog.');
   if(!response.body?.getReader)throw new Error('The reference movie response has no readable body.');
   reader=response.body.getReader();
   // One selected transfer, a maximum 4 MiB input buffer, and at most 8 MiB
   // retained object URLs. No other movie is requested speculatively.
   const data=new Uint8Array(clip.bytes);let offset=0;
   while(true){
    this.check(job);const {value,done}=await reader.read();this.check(job);
    if(done)break;
    if(offset+value.byteLength>data.length)throw new Error('The reference movie exceeds its catalog size.');
    data.set(value,offset);offset+=value.byteLength;job.onProgress?.(offset,clip.bytes);
   }
   if(offset!==data.length)throw new Error('The reference movie download was incomplete.');
   if(clip.sha256&&globalThis.crypto?.subtle){
    const digest=await crypto.subtle.digest('SHA-256',data);this.check(job);
    const hash=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
    if(hash!==clip.sha256)throw new Error('The reference movie checksum does not match its catalog.');
   }
   this.check(job);this.trim(clip.bytes);
   const entry={key:job.key,id:clip.id,sourceUrl:clip.url,bytes:clip.bytes,url:this.createURL(new Blob([data],{type:'video/mp4'}))};
   this.entries.set(job.key,entry);this.bytes+=entry.bytes;complete=true;return entry;
  }finally{
   if(!complete){
    job.controller.abort();
    const cancellation=reader?reader.cancel():response?.body?.cancel();
    if(cancellation)await cancellation.catch(()=>{});
   }
   reader?.releaseLock();
  }
 }
 destroy(){
  this.destroyed=true;this.cancel();this.activeKey=null;
  for(const entry of this.entries.values())this.revokeURL(entry.url);
  this.entries.clear();this.bytes=0;
 }
}
