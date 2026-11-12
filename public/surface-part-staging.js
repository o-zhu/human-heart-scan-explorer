/** Optional disk staging for the compact surface's independent verified parts.
 * Download finishes before geometry preparation when OPFS is available. A
 * disabled/full/stalled store falls back to the bounded streaming path, keeping
 * completed parts where possible. No complete compressed or decoded mesh lives
 * in JavaScript memory, and this temporary store never authorizes publication.
 */
import {verifiedSurfaceParts} from './surface-transport-pipeline.js';

const PREFIX='heart-surface-stage-';
const PART_LIMIT=8*1024*1024,TOTAL_LIMIT=256*1024*1024;
const STORAGE_TIMEOUT_MS=10000,CLEANUP_TIMEOUT_MS=3000;
const validId=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(id);
const now=()=>globalThis.performance?.now?.()??Date.now();
const aborted=signal=>signal?.throwIfAborted();
const resourceFailure=error=>error?.resourceFailure===true||error?.name==='RangeError'||/out of memory|allocation failed|could not allocate|array buffer allocation/i.test(error?.message||'');
const storageFailure=()=>Object.assign(new Error('Temporary surface storage did not respond.'),{storageTimeout:true});
const bestEffort=operation=>{try{Promise.resolve(operation()).catch(()=>{});}catch{}};

/** Bound native storage promises, including browsers that ignore cancellation.
 * Active workers can pause this deadline. A throttled timer never counts the
 * whole hidden interval as active work. Late handles are explicitly abandoned.
 */
function storageOperation(operation,{signal,timeoutMs=STORAGE_TIMEOUT_MS,isPaused,onLate}={}){
 aborted(signal);
 return new Promise((resolve,reject)=>{
  let settled=false,timer,remaining=timeoutMs,last=now(),wasPaused=!!isPaused?.();
  const finish=(callback,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);callback(value);};
  const cancel=()=>finish(reject,signal.reason||new DOMException('Surface preparation was canceled.','AbortError'));
  const poll=()=>{
   const time=now(),paused=!!isPaused?.(),elapsed=time-last;last=time;
   if(!paused&&!wasPaused)remaining-=isPaused?Math.min(1000,Math.max(0,elapsed)):Math.max(0,elapsed);
   wasPaused=paused;
   if(remaining<=0){finish(reject,storageFailure());return;}
   timer=setTimeout(poll,isPaused?Math.min(250,remaining):remaining);
  };
  timer=setTimeout(poll,isPaused?Math.min(250,remaining):remaining);
  signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
  Promise.resolve().then(()=>{aborted(signal);return operation();}).then(value=>{
   if(settled){if(onLate)bestEffort(()=>onLate(value));return;}
   finish(resolve,value);
  },error=>finish(reject,error));
 });
}

/** Safe from either the controller or worker. A terminated worker cannot run
 * finally, so its controller also removes this exact job's private directory.
 * Cleanup is optional, finite, and never removes another job or volume cache.
 */
export async function cleanupSurfaceStaging(stagingId,{storage=globalThis.navigator?.storage,timeoutMs=CLEANUP_TIMEOUT_MS,afterTermination=false,retryDelayMs=100}={}){
 if(!validId(stagingId)||typeof storage?.getDirectory!=='function'||!Number.isFinite(timeoutMs)||timeoutMs<=0)return false;
 const end=now()+timeoutMs,remaining=()=>Math.max(0,end-now()),name=PREFIX+stagingId;
 let root;
 try{root=await storageOperation(()=>storage.getDirectory(),{timeoutMs,onLate:late=>late.removeEntry(name,{recursive:true})});}
 catch{return false;}
 const delay=Number.isFinite(retryDelayMs)&&retryDelayMs>0?retryDelayMs:100;
 const delays=afterTermination?[0,delay,delay*3,delay*6]:[0];
 let cleaned=false;
 for(const wait of delays){
  if(wait){
   if(wait>=remaining())return cleaned;
   await new Promise(resolve=>setTimeout(resolve,wait));
  }
  const budget=remaining();if(budget<=0)return cleaned;
  try{
   await storageOperation(()=>root.removeEntry(name,{recursive:true}),{timeoutMs:budget,
    onLate:()=>root.removeEntry(name,{recursive:true})});
   cleaned=true;
  }catch(error){
   cleaned=error?.name==='NotFoundError';
   if(error?.storageTimeout)return false;
  }
  // A terminated worker can leave a native lock briefly, or a directory
  // creation can finish after this first NotFound. Recheck this exact job only.
 }
 return cleaned;
}

class PartStore{
 constructor(stagingId,storage,options){this.id=stagingId;this.storage=storage;this.options=options;this.directory=null;this.files=new Map();this.closed=false;}
 cleanup(){return cleanupSurfaceStaging(this.id,{storage:this.storage,timeoutMs:this.options.cleanupTimeoutMs});}
 run(operation,onLate){return storageOperation(operation,{...this.options,onLate});}
 async discard(index){
  if(this.closed)return this.cleanup();
  this.files.delete(index);
  try{await this.run(()=>this.directory.removeEntry('part-'+index));}catch{}
 }
 async open(){
  const root=await this.run(()=>this.storage.getDirectory());
  this.directory=await this.run(()=>root.getDirectoryHandle(PREFIX+this.id,{create:true}),()=>this.cleanup());
  // Test the asynchronous API before fetching. Synchronous file operations
  // cannot be raced against a deadline, so older engines use bounded streaming.
  const first=await this.run(()=>this.directory.getFileHandle('part-0',{create:true}),()=>this.cleanup());
  if(typeof first.createWritable!=='function')throw new Error('Asynchronous temporary surface storage is unavailable.');
  this.files.set(0,first);
 }
 async write(index,bytes){
  if(this.closed)throw new Error('Temporary surface storage is closed.');
  const file=this.files.get(index)||await this.run(()=>this.directory.getFileHandle('part-'+index,{create:true}),()=>this.discard(index));
  this.files.set(index,file);
  let writer;
  const abandon=late=>{
   bestEffort(async()=>{try{await late.abort();}finally{await this.discard(index);}});
   bestEffort(()=>this.discard(index));
  };
  try{
   writer=await this.run(()=>file.createWritable(),abandon);
   await this.run(()=>writer.write(bytes),()=>this.discard(index));
   await this.run(()=>writer.close(),()=>this.discard(index));
  }catch(error){
   if(writer)abandon(writer);
   throw error;
  }
 }
 async read(index,expected){
  if(this.closed)throw new Error('Temporary surface storage is closed.');
  const file=await this.run(()=>this.files.get(index).getFile());
  if(file.size!==expected)throw new Error('Temporary surface part length did not match.');
  const buffer=await this.run(()=>file.arrayBuffer());
  if(buffer.byteLength!==expected)throw new Error('Temporary surface part length did not match.');
  return new Uint8Array(buffer);
 }
 async close(){this.closed=true;this.files.clear();return this.cleanup();}
}

/** Return a loadPart adapter for the existing verified decoder. Normal staged
 * reads still get their compressed SHA checked before use. On storage failure,
 * earlier disk parts and at most one not-yet-stored block are retained; later
 * parts download serially as the existing decoder asks for them.
 */
export async function prepareSurfaceParts(parts,{stagingId,loadPart,hash,waitForWorkspace=async()=>{},onProgress=()=>{},storage=globalThis.navigator?.storage,signal,isPaused,timeoutMs=STORAGE_TIMEOUT_MS,cleanupTimeoutMs=CLEANUP_TIMEOUT_MS}={}){
 if(!Array.isArray(parts)||!parts.length||parts.length>512||typeof loadPart!=='function'||typeof hash!=='function')throw new Error('Invalid surface staging transport.');
 let totalBytes=0;
 for(const part of parts){
  if(!Number.isInteger(part?.compressedBytes)||part.compressedBytes<1||part.compressedBytes>PART_LIMIT||!/^[a-f0-9]{64}$/.test(part.sha256||''))throw new Error('Invalid surface staging part.');
  totalBytes+=part.compressedBytes;
 }
 if(totalBytes>TOTAL_LIMIT)throw new Error('Invalid surface staging length.');
 let store=null,staged=0,pending=null,sequential=false,fallbackReported=false,closed=false,closing,readsDisabled=false,downloadCompleted=false;
 const current=()=>{aborted(signal);if(closed)throw new DOMException('Surface preparation was canceled.','AbortError');};
 const wait=async()=>{current();await waitForWorkspace(signal);current();};
 const fallback=()=>{sequential=false;if(!fallbackReported){fallbackReported=true;onProgress({phase:'download',stage:'streaming-fallback',sequential:false});}};
 const close=()=>{closed=true;pending=null;return closing??=store?store.close():Promise.resolve();};
 try{
  await wait();
  if(validId(stagingId)&&typeof storage?.getDirectory==='function'){
   store=new PartStore(stagingId,storage,{signal,isPaused,timeoutMs,cleanupTimeoutMs});
   try{await store.open();}
   catch(error){aborted(signal);if(resourceFailure(error))throw error;await store.close();store=null;}
  }
  if(store){
   onProgress({phase:'download',stage:'download-start',sequential:true});
   const transport=verifiedSurfaceParts(parts,{loadPart,hash,waitForWorkspace:wait,lookahead:false,onProgress});
   for await(const block of transport){
    await wait();
    try{await store.write(staged,block.packed);}
    catch(error){
     aborted(signal);if(resourceFailure(error))throw error;
     // Keep this already verified block when disk fills. Combined with one
     // disk read, fallback holds at most two manifest-bounded packed blocks.
     pending={part:block.part,packed:block.packed};block.packed=null;fallback();break;
    }
    block.packed=null;staged++;
    await wait();
    onProgress({phase:'download',stage:'stage-part',stagedParts:staged,totalParts:parts.length});
   }
   if(staged===parts.length){
    sequential=true;downloadCompleted=true;
    onProgress({phase:'decode',stage:'download-complete',sequential:true,downloadedBytes:totalBytes,downloadTotalBytes:totalBytes});
   }
  }else fallback();
  return {
   get sequential(){return sequential;},
   async loadPart(part,progress){
    await wait();
    const index=parts.indexOf(part);
    if(index<0)throw new Error('Unexpected staged surface part.');
    if(index<staged&&!readsDisabled){
     let bytes;
     try{bytes=await store.read(index,part.compressedBytes);}
     catch(error){
      current();if(resourceFailure(error))throw error;
      // A hung storage backend must not spend another deadline on every part.
      // Ordinary eviction/corruption still recovers just its affected file.
      if(error?.storageTimeout)readsDisabled=true;
      fallback();
     }
     if(bytes){
      // Disk data is not trusted simply because the downloaded input passed.
      // A damaged/evicted part is fetched again, still through normal recovery.
      if(await hash(bytes)===part.sha256){await wait();return bytes;}
      current();
      bytes=null;fallback();
     }
    }else if(pending?.part===part){const bytes=pending.packed;pending=null;return bytes;}
    await wait();
    if(downloadCompleted)onProgress({phase:'download',stage:'restore-start',sequential:false,part:index+1,totalParts:parts.length});
    const bytes=await loadPart(part,progress);current();return bytes;
   },
   close,
  };
 }catch(error){await close();throw error;}
}
