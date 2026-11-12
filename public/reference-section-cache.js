/** Optional, exact measured R8 reference sections. A miss leaves the existing
 * fine-volume path in charge; this module never changes a requested plane.
 * sourceKey is the production FineSectionStore.identity() fingerprint.
 */
import {validFinePlane,sameFinePlane} from './ultra-volume-core.js';
import {withAbort} from './load-watchdog.js';

export const REFERENCE_SECTION_KIND='heart-reference-sections-v57';
const MiB=1024*1024,MAX_PIXELS=12*MiB,MAX_ENCODED=MAX_PIXELS+128*1024;
const MAX_MANIFEST=512*1024,MAX_AXIS=8192,MAX_VIEWS=56;
const HASH=/^[a-f0-9]{64}$/,ID=/^[a-z0-9][a-z0-9_-]{0,63}$/;
const sourceFields=['donorId','datasetId','sourceKey','sourceMaskSha256','sourceSpacingUm','longestMm'];
const abortError=()=>new DOMException('The reference section request was superseded.','AbortError');
const checkAbort=signal=>{if(signal?.aborted)throw signal.reason||abortError();};
const integrity=message=>Object.assign(new Error(message),{name:'ReferenceSectionIntegrityError'});
const freeze=value=>{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;};
const integer=(value,max)=>Number.isSafeInteger(value)&&value>0&&value<=max;
const sourceCopy=source=>Object.fromEntries(sourceFields.map(key=>[key,source?.[key]]));
function validSource(source){
 return ID.test(source?.donorId||'')&&typeof source.datasetId==='string'&&source.datasetId.length>0&&source.datasetId.length<=80&&
  HASH.test(source.sourceKey||'')&&HASH.test(source.sourceMaskSha256||'')&&
  Number.isFinite(source.sourceSpacingUm)&&source.sourceSpacingUm>0&&
  Number.isFinite(source.longestMm)&&source.longestMm>0;
}
const equalSource=(a,b)=>sourceFields.every(key=>a?.[key]===b?.[key]);
async function digest(bytes,signal){
 if(!globalThis.crypto?.subtle?.digest)throw new Error('Verified reference sections require a secure connection.');
 const value=await withAbort(crypto.subtle.digest('SHA-256',bytes),signal);checkAbort(signal);
 return Array.from(new Uint8Array(value),n=>n.toString(16).padStart(2,'0')).join('');
}
async function readBytes(response,{maximum,expected,signal}){
 if(!response.ok){void response.body?.cancel().catch(()=>{});throw new Error(`Reference section returned ${response.status}.`);}
 const declared=Number(response.headers.get('content-length'));
 if(declared>maximum){void response.body?.cancel().catch(()=>{});throw integrity('Reference section exceeds its byte limit.');}
 const reader=response.body?.getReader();if(!reader)throw integrity('Reference section response has no data.');
 const output=expected===undefined?null:new Uint8Array(expected),chunks=[];let length=0;
 try{
  while(true){
   checkAbort(signal);const {done,value}=await withAbort(reader.read(),signal);if(done)break;
   length+=value.byteLength;
   if(length>maximum||(expected!==undefined&&length>expected))throw integrity('Reference section exceeds its declared size.');
   if(output)output.set(value,length-value.byteLength);else chunks.push(value);
  }
  if(expected!==undefined&&length!==expected)throw integrity('Reference section is incomplete.');
  if(output)return output;
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
 }catch(error){void reader.cancel(error).catch(()=>{});throw error;}
 finally{try{reader.releaseLock();}catch{}}
}
async function timed(controller,timeoutMs,operation){
 const timer=setTimeout(()=>controller.abort(Object.assign(new Error('Reference section loading timed out.'),{name:'TimeoutError'})),timeoutMs);
 try{return await withAbort(operation(controller.signal),controller.signal);}
 finally{clearTimeout(timer);}
}

function normalizeRecord(record,source,manifestUrl){
 if(!record||!['gzip-r8','gzip-r8-delta-v1'].includes(record.codec)||record.cleaned!==true||
    !integer(record.width,MAX_AXIS)||!integer(record.height,MAX_AXIS)||record.width<2||record.height<2||
    !integer(record.decodedBytes,MAX_PIXELS)||record.decodedBytes!==record.width*record.height||
    !integer(record.bytes,MAX_ENCODED)||!HASH.test(record.sha256||'')||!HASH.test(record.pixelSha256||'')||
    record.sourceSpacingUm!==source.sourceSpacingUm)throw integrity('Invalid reference section metadata.');
 let plane,url;try{plane=validFinePlane(record.plane);url=new URL(record.url,manifestUrl);}catch{throw integrity('Invalid reference section plane or URL.');}
 if(!['http:','https:'].includes(url.protocol)||typeof record.url!=='string'||!record.url)throw integrity('Invalid reference section URL.');
 const width=Math.ceil(plane.width*source.longestMm*1000/source.sourceSpacingUm)+1;
 const height=Math.ceil(plane.height*source.longestMm*1000/source.sourceSpacingUm)+1;
 const spacing=[plane.width*source.longestMm*1000/(width-1),plane.height*source.longestMm*1000/(height-1)];
 if(record.width!==width||record.height!==height||!Array.isArray(record.spacingUmXY)||record.spacingUmXY.length!==2||
    record.spacingUmXY.some((value,i)=>!Number.isFinite(value)||Math.abs(value-spacing[i])>1e-6))throw integrity('Reference pixels do not match the exact physical raster.');
 return freeze({codec:record.codec,url:url.href,bytes:record.bytes,sha256:record.sha256,pixelSha256:record.pixelSha256,
  decodedBytes:record.decodedBytes,width,height,spacingUmXY:spacing,spacingUm:Math.max(...spacing),
  sourceSpacingUm:source.sourceSpacingUm,cleaned:true,plane});
}
function normalizeManifest(input,expectedSource,manifestUrl){
 if(input?.schemaVersion!==1||input.kind!==REFERENCE_SECTION_KIND||!validSource(input.source)||
    !equalSource(input.source,expectedSource)||!Array.isArray(input.views)||input.views.length>MAX_VIEWS)throw integrity('Reference sections belong to a different source or cleanup revision.');
 const source=freeze(sourceCopy(input.source)),views=new Map();
 for(const item of input.views){
  if(!ID.test(item?.viewId||'')||!['tte','tee'].includes(item.mode)||views.has(item.viewId))throw integrity('Invalid reference view identity.');
  const outside=item.outsideScan===true;
  if(outside&&(item.ct||item.face))throw integrity('An outside-scan view cannot contain measured reference pixels.');
  const view={viewId:item.viewId,mode:item.mode,outsideScan:outside};
  for(const role of ['ct','face'])view[role]=item[role]?normalizeRecord(item[role],source,manifestUrl):null;
  views.set(item.viewId,freeze(view));
 }
 return {source,views};
}

/** Immutable per-donor manifest; bounded decoded LRU and at most two transfers.
 * expectedSource is generated from the active donor's immutable fine manifest,
 * so identifying the source does not initialize or download a 3D volume.
 *
 * match/load request: {viewId, role:'ct'|'face', plane, sourceKey,
 *                     cleanupEnabled:true, modified:false, planeReference?}.
 * A caller must still check its current view token before displaying a result.
 */
export class ReferenceSectionCache{
 constructor({manifestUrl,expectedSource,manifestSha256=null,fetcher=(...args)=>globalThis.fetch(...args),
              maxBytes=24*MiB,timeoutMs=20000,maxConcurrent=2}={}){
  if(!validSource(expectedSource))throw new TypeError('Reference sections need an exact expected source identity.');
  this.manifestUrl=new URL(manifestUrl,import.meta.url).href;
  if(!['http:','https:'].includes(new URL(this.manifestUrl).protocol))throw new TypeError('Reference sections need an HTTP(S) manifest URL.');
  if(manifestSha256!==null&&!HASH.test(manifestSha256))throw new TypeError('Invalid reference manifest checksum.');
  this.expectedSource=freeze(sourceCopy(expectedSource));this.manifestSha256=manifestSha256;this.fetcher=fetcher;
  this.maxBytes=Math.max(0,Math.min(32*MiB,Number.isFinite(maxBytes)?Math.floor(maxBytes):24*MiB));
  this.timeoutMs=Math.max(1,Math.min(60000,Number.isFinite(timeoutMs)?timeoutMs:20000));
  this.maxConcurrent=Math.max(1,Math.min(2,Math.floor(maxConcurrent)||2));
  this.entries=new Map();this.jobs=new Map();this.queue=[];this.running=new Set();
  this.bytes=0;this.serial=0;this.generation=0;this.destroyed=false;this.views=null;this.source=null;this.initTask=null;
 }
 async init({signal}={}){
  checkAbort(signal);if(this.destroyed)throw abortError();if(this.views)return this.source;
  if(!this.initTask){
   const generation=this.generation,controller=new AbortController(),task={controller};
   this.initTask=task;
   task.promise=timed(controller,this.timeoutMs,async taskSignal=>{
    const response=await withAbort(this.fetcher(this.manifestUrl,{signal:taskSignal,cache:'force-cache',credentials:'same-origin',priority:'high'}),taskSignal);
    const bytes=await readBytes(response,{maximum:MAX_MANIFEST,signal:taskSignal});
    if(this.manifestSha256&&await digest(bytes,taskSignal)!==this.manifestSha256)throw integrity('Reference manifest checksum failed.');
    let parsed;try{parsed=JSON.parse(new TextDecoder().decode(bytes));}catch{throw integrity('Invalid reference manifest JSON.');}
    const normalized=normalizeManifest(parsed,this.expectedSource,this.manifestUrl);checkAbort(taskSignal);
    if(this.destroyed||generation!==this.generation)throw abortError();
    this.source=normalized.source;this.views=normalized.views;return this.source;
   }).finally(()=>{if(this.initTask===task)this.initTask=null;});
  }
  // One caller aborting optional initialization cannot poison another caller's
  // retry. The shared bounded transfer is canceled by pause/destroy or timeout.
  return withAbort(this.initTask.promise,signal);
 }
 match(request={}){
  if(this.destroyed||!this.views||request.sourceKey!==this.expectedSource.sourceKey||
     request.cleanupEnabled!==true||request.modified!==false||
     (request.planeReference!==undefined&&request.planeReference!=='refined')||
     (request.donorId!==undefined&&request.donorId!==this.expectedSource.donorId)||
     !['ct','face'].includes(request.role))return null;
  const view=this.views.get(request.viewId),record=view?.[request.role];
  if(!record||view.outsideScan||(request.mode!==undefined&&request.mode!==view.mode))return null;
  let plane;try{plane=validFinePlane(request.plane);}catch{return null;}
  return sameFinePlane(record.plane,plane,1e-8)?record:null;
 }
 async load(request,{signal,priority=0}={}){
  checkAbort(signal);if(this.destroyed)throw abortError();const generation=this.generation;
  await this.init({signal});checkAbort(signal);
  if(this.destroyed||generation!==this.generation)throw abortError();
  const record=this.match(request);if(!record)return null;
  const plane=validFinePlane(request.plane);
  const key=[this.expectedSource.sourceKey,record.codec,record.sha256,record.pixelSha256,record.width,record.height].join('|');
  let pixels=this.entries.get(key)?.data;
  if(pixels){const entry=this.entries.get(key);this.entries.delete(key);this.entries.set(key,entry);}
  else{
   let job=this.jobs.get(key);
   if(!job){
    job={key,record,controller:new AbortController(),generation,priority:priority===0?0:1,serial:++this.serial,consumers:0,settled:false};
    job.promise=new Promise((resolve,reject)=>{job.resolve=resolve;job.reject=reject;});
    this.jobs.set(key,job);this.queue.push(job);
   }else job.priority=Math.min(job.priority,priority===0?0:1);
   job.consumers++;
   this.pump();
   // Repeated navigation cannot accumulate unbounded optional requests.
   const queued=this.queue.filter(item=>item!==job).sort((a,b)=>b.priority-a.priority||a.serial-b.serial);
   while(this.queue.length>4&&queued.length)this.cancel(queued.shift());
   try{pixels=await withAbort(job.promise,signal);}
   finally{job.consumers--;if(job.consumers===0&&!job.settled)this.cancel(job);}
  }
  checkAbort(signal);
  if(this.destroyed||generation!==this.generation||this.match(request)!==record)throw abortError();
  return {data:pixels,width:record.width,height:record.height,plane,
   spacingUmXY:[...record.spacingUmXY],spacingUm:record.spacingUm,sourceSpacingUm:record.sourceSpacingUm,
   complete:true,cleaned:true,preparedReference:true,sourceKey:this.expectedSource.sourceKey,
   viewId:request.viewId,role:request.role,encodedBytes:record.bytes,pixelSha256:record.pixelSha256,
   source:`Measured ${record.sourceSpacingUm} µm volume · exact prepared reference section`};
 }
 cancel(job){
  if(!job||job.settled)return;
  job.settled=true;job.controller.abort(abortError());this.queue=this.queue.filter(item=>item!==job);
  if(this.jobs.get(job.key)===job)this.jobs.delete(job.key);job.reject(abortError());
 }
 pump(){
  this.queue.sort((a,b)=>a.priority-b.priority||b.serial-a.serial);
  while(!this.destroyed&&this.running.size<this.maxConcurrent&&this.queue.length){
   const job=this.queue.shift();if(job.settled)continue;this.running.add(job);
   timed(job.controller,this.timeoutMs,async signal=>{
    const response=await withAbort(this.fetcher(job.record.url,{signal,cache:'force-cache',credentials:'same-origin',priority:job.priority===0?'high':'low'}),signal);
    const encoded=await readBytes(response,{maximum:MAX_ENCODED,expected:job.record.bytes,signal});
    if(await digest(encoded,signal)!==job.record.sha256)throw integrity('Compressed reference section checksum failed.');
    if(typeof DecompressionStream!=='function')throw new Error('This browser cannot decode optional reference sections.');
    const responseRaw=new Response(new Blob([encoded]).stream().pipeThrough(new DecompressionStream('gzip')));
    const data=await readBytes(responseRaw,{maximum:job.record.decodedBytes,expected:job.record.decodedBytes,signal});
    checkAbort(signal);
    if(job.record.codec==='gzip-r8-delta-v1'){
     // Each row starts with its original first pixel. Uint8 modulo addition
     // reconstructs the exact measured R8 bytes without a second raster.
     const width=job.record.width;
     for(let row=0;row<data.length;row+=width){
      for(let x=1;x<width;x++)data[row+x]=(data[row+x]+data[row+x-1])&255;
     }
    }
    checkAbort(signal);
    if(await digest(data,signal)!==job.record.pixelSha256)throw integrity('Decoded reference section checksum failed.');
    checkAbort(signal);if(this.destroyed||job.generation!==this.generation)throw abortError();return data;
   }).then(data=>{
    if(job.settled)return;
    if(data.byteLength<=this.maxBytes){
     const old=this.entries.get(job.key);if(old)this.bytes-=old.data.byteLength;
     this.entries.delete(job.key);this.entries.set(job.key,{data});this.bytes+=data.byteLength;
     while(this.bytes>this.maxBytes){const key=this.entries.keys().next().value;this.bytes-=this.entries.get(key).data.byteLength;this.entries.delete(key);}
    }
    job.settled=true;job.resolve(data);
   }).catch(error=>{if(!job.settled){job.settled=true;job.reject(error);}})
    .finally(()=>{this.running.delete(job);if(this.jobs.get(job.key)===job)this.jobs.delete(job.key);this.pump();});
  }
 }
 pause(){
  this.generation++;const task=this.initTask;this.initTask=null;task?.controller.abort(abortError());
  for(const job of [...this.jobs.values()])this.cancel(job);
 }
 clear(){this.pause();this.entries.clear();this.bytes=0;}
 destroy(){this.clear();this.destroyed=true;this.views=null;this.source=null;}
 getStatus(){return {manifestReady:!!this.views,decodedBytes:this.bytes,decodedLimit:this.maxBytes,cachedSections:this.entries.size,activeTransfers:this.running.size,queuedTransfers:this.queue.length};}
}
