import {checkFineAbort,fineAbort,validFinePlane,sameFinePlane,reusableFineSection,fineSourceExtent,orientFineSection,planFinePlane,sampleFineBrick} from './ultra-volume-core.js';
import {getDeviceResourcePolicy} from './device-resources.js';
import {FineSectionStore} from './fine-section-store.js';
import {FineBrickQueue} from './fine-brick-queue.js';
import {withAbort} from './load-watchdog.js';
const MiB=1024*1024;
// Timer nesting adds a minimum delay for every brick in browsers. Yield only
// after a bounded CPU budget, using an event task rather than hundreds of timers.
const yields=[];let channel;
const tick=()=>new Promise(resolve=>{
 if(typeof MessageChannel!=='function'){setTimeout(resolve,0);return;}
 if(!channel){channel=new MessageChannel();channel.port1.onmessage=()=>{yields.shift()?.();if(!yields.length){channel.port1.unref?.();channel.port2.unref?.();}};}
 channel.port1.ref?.();channel.port2.ref?.();yields.push(resolve);channel.port2.postMessage(0);
});
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
const safe=(fn,value)=>{try{fn?.(value);}catch{}};
async function runFineTasks(count,run,signal){
 const controller=new AbortController(),abort=()=>controller.abort(signal?.reason);signal?.addEventListener('abort',abort,{once:true});
 if(signal?.aborted)controller.abort();
 const tasks=Array.from({length:count},()=>run(controller.signal));
 try{await Promise.all(tasks);}catch(error){controller.abort(error);await Promise.allSettled(tasks);throw error;}
 finally{signal?.removeEventListener('abort',abort);}
}

/** Small independent bricks benefit from overlapping round trips. Keep this
 * bounded, respect reduced-data/slow connections, and reserve most slots for
 * the requested plane rather than speculative neighboring data. */
export function fineTransferPolicy({memory,connection=globalThis.navigator?.connection,
 resourcePolicy=getDeviceResourcePolicy(memory===undefined?{}:{navigator:{deviceMemory:memory}})}={}){
 const type=connection?.effectiveType,restricted=connection?.saveData||type==='slow-2g'||type==='2g';
 const reported=memory??resourcePolicy.reportedMemoryGiB;
 const memorySlots=reported===null||reported===undefined?12:reported<4?4:reported<8?8:12;
 const foreground=Math.min(resourcePolicy.fineForeground,restricted?2:type==='3g'?4:memorySlots);
 return {foreground,background:restricted?1:Math.min(resourcePolicy.fineBackground,Math.max(1,Math.floor(foreground/3)))};
}

/** Independent, bounded cache; it never evicts the complete X/Y/Z image collection. */
class BrickDisk {
 constructor(manifest,base,cacheName){this.manifest=manifest;this.base=base;this.cacheName=cacheName||manifest.cacheName||'heart-ultra-volume-v7';this.bytes=0;this.items=new Map();this.available=true;this.limit=384*MiB;this.writeQueue=Promise.resolve();this.pendingBytes=0;}
 async init(){
  if(this.ready)return this.ready;
  this.ready=(async()=>{
   if(!globalThis.caches){this.available=false;return;}
   try{
    this.cache=await caches.open(this.cacheName);
    const byPath=new Map(Object.values(this.manifest.blocks).map(r=>[new URL(r.path,this.base).pathname,r]));
    for(const request of await this.cache.keys()){
     const record=byPath.get(new URL(request.url).pathname);
     if(!record||!request.url.includes(record.sha256.slice(0,16))){await this.cache.delete(request);continue;}
     this.items.set(request.url,record.bytes);this.bytes+=record.bytes;
    }
   }catch{this.available=false;}
  })();return this.ready;
 }
 async get(url){await this.init();if(!this.available||!this.items.has(url))return null;try{const response=await this.cache.match(url);if(!response){const size=this.items.get(url)||0;this.items.delete(url);this.bytes-=size;return null;}const size=this.items.get(url);if(size){this.items.delete(url);this.items.set(url,size);}return new Uint8Array(await response.arrayBuffer());}catch{this.available=false;return null;}}
 put(url,bytes){
  if(!this.available||this.pendingBytes+bytes.byteLength>8*MiB)return;
  this.pendingBytes+=bytes.byteLength;
  this.writeQueue=this.writeQueue.then(async()=>{
   await this.init();if(!this.available||this.items.has(url))return;
   while(this.bytes+bytes.byteLength>this.limit&&this.items.size){const [old,size]=this.items.entries().next().value;await this.cache.delete(old);this.items.delete(old);this.bytes-=size;}
   await this.cache.put(url,new Response(bytes,{headers:{'content-type':'application/gzip','content-length':String(bytes.byteLength)}}));
   this.items.set(url,bytes.byteLength);this.bytes+=bytes.byteLength;
  }).catch(()=>{this.available=false;}).finally(()=>{this.pendingBytes-=bytes.byteLength;});
 }
 async remove(url){try{await this.init();if(this.cache)await this.cache.delete(url);const n=this.items.get(url)||0;this.items.delete(url);this.bytes-=n;}catch{}}
}

export class FineVolumeBackend {
 constructor(manifest,{baseUrl,fetcher=(...args)=>fetch(...args),decodedLimit,decodePrepared=null,cacheName,sectionStore,resourcePolicy=getDeviceResourcePolicy(),transferPolicy=fineTransferPolicy({resourcePolicy}),transferTimeoutMs=20000}={}){
  if(manifest.schemaVersion!==1||manifest.codec!=='gzip-u8-zyx-positive-halo'||manifest.storedEdge!==manifest.brickSize+1||manifest.decodedBrickBytes!==manifest.storedEdge**3)throw new Error('Unsupported fine volume metadata.');
  this.manifest=manifest;this.base=new URL(manifest.assetBaseUrl,baseUrl||import.meta.url);this.pageBase=baseUrl||import.meta.url;
  // Desktops may retain a complete oblique plane (120–227 MiB of bricks).
  // Constrained devices sample the same source through a smaller working cache.
  // Window passes its policy so an iPad worker cannot be mistaken for a Mac.
  this.resourcePolicy=resourcePolicy;
  this.fetcher=fetcher;this.cache=new Map();this.bytes=0;this.limit=decodedLimit??resourcePolicy.fineBrickBytes;this.prepared=new Map();this.preparedBytes=0;this.preparedLimit=resourcePolicy.preparedPlaneBytes;
  this.disk=new BrickDisk(manifest,this.base,cacheName);this.decodePrepared=decodePrepared;this.networkBytes=0;
  this.sectionStore=sectionStore||new FineSectionStore(manifest,{baseUrl:baseUrl||import.meta.url,resourcePolicy});
  this.decodedHits=0;this.diskHits=0;this.protectedBlocks=new Map();
  this.transferPolicy={foreground:Math.max(1,Math.min(12,Math.floor(transferPolicy.foreground)||4)),background:Math.max(1,Math.min(3,Math.floor(transferPolicy.background)||1))};
  this.transferTimeoutMs=transferTimeoutMs;this.brickQueue=new FineBrickQueue({limit:this.transferPolicy.foreground,timeoutMs:transferTimeoutMs});
 }
 remember(id,data){
  const old=this.cache.get(id);if(old)this.bytes-=old.byteLength;this.cache.delete(id);
  if(data.byteLength>this.limit)return data;
  this.cache.set(id,data);this.bytes+=data.byteLength;
  while(this.bytes>this.limit){
   // Neighbor warming must not evict the beginning of the active plane. If a
   // plane itself exceeds the device budget, retain the strict byte limit.
   let first;for(const key of this.cache.keys())if(!this.protectedBlocks.has(key)){first=key;break;}
   first??=this.cache.keys().next().value;
   this.bytes-=this.cache.get(first).byteLength;this.cache.delete(first);
  }
  return data;
 }
 protect(blocks){
  for(const block of blocks)this.protectedBlocks.set(block.id,(this.protectedBlocks.get(block.id)||0)+1);
  return ()=>{for(const block of blocks){const count=this.protectedBlocks.get(block.id)||0;if(count<=1)this.protectedBlocks.delete(block.id);else this.protectedBlocks.set(block.id,count-1);}};
 }
 async readBody(response,expected,signal){
  if(!response.ok){await response.body?.cancel().catch(()=>{});throw new Error(`Fine scan data returned ${response.status}.`);}
  const reader=response.body?.getReader();if(!reader)throw new Error('The fine scan response has no data.');
  const bytes=new Uint8Array(expected);let offset=0;
  try{while(true){checkFineAbort(signal);const {done,value}=await withAbort(reader.read(),signal);if(done)break;if(offset+value.length>expected)throw new Error('Fine scan asset exceeds its manifest size.');bytes.set(value,offset);offset+=value.length;}
   if(offset!==expected)throw new Error('The fine scan download was incomplete.');return bytes;
  }catch(error){void reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 }
 async getBrick(block,signal,{localOnly=false,residentOnly=false,priority='high',retainOnAbort=false}={}){
  checkFineAbort(signal);const cached=this.cache.get(block.id);if(cached){this.cache.delete(block.id);this.cache.set(block.id,cached);this.decodedHits++;return cached;}
  if(residentOnly)return null;
  return this.brickQueue.request(`${block.id}:${localOnly?'local':'source'}`,taskSignal=>this.loadBrick(block,taskSignal,{localOnly,priority}),{signal,priority,retainOnAbort});
 }
 async loadBrick(block,signal,{localOnly=false,priority='high'}={}){
  checkFineAbort(signal);const cached=this.cache.get(block.id);if(cached)return cached;
  const r=block.record,url=new URL(r.path,this.base);url.searchParams.set('v',r.sha256.slice(0,16));const key=url.href;
  let encoded=await this.disk.get(key),fromDisk=!!encoded;checkFineAbort(signal);
  if(encoded&&(encoded.byteLength!==r.bytes||await hash(encoded)!==r.sha256)){await this.disk.remove(key);encoded=null;fromDisk=false;}
  if(!encoded&&localOnly)return null;
  if(!encoded){const response=await this.fetcher(key,{signal,cache:'force-cache',credentials:'same-origin',priority});encoded=await this.readBody(response,r.bytes,signal);checkFineAbort(signal);if(await hash(encoded)!==r.sha256)throw new Error('Fine scan checksum failed.');this.networkBytes+=encoded.byteLength;}else this.diskHits++;
  checkFineAbort(signal);
  const stream=new Blob([encoded]).stream().pipeThrough(new DecompressionStream('gzip'));
  const data=await this.readBody(new Response(stream),this.manifest.decodedBrickBytes,signal);checkFineAbort(signal);
  if(await hash(data)!==r.rawSha256)throw new Error('Decoded fine scan checksum failed.');
  checkFineAbort(signal);
  if(!fromDisk)this.disk.put(key,encoded);
  return this.remember(block.id,data);
 }
 async preparedPlane(record,plane,{signal,onProgress}={}){
  let result=this.prepared.get(record.id);if(result){this.prepared.delete(record.id);this.prepared.set(record.id,result);safe(onProgress,{ready:1,total:1,phase:'complete',local:true,bytes:0});return {...result,plane};}
  safe(onProgress,{ready:0,total:1,phase:'prepared',local:false,bytes:0});
  const url=new URL(record.url,this.pageBase),response=await this.fetcher(url,{signal,cache:'force-cache',credentials:'same-origin',priority:'high'});
  const encoded=await this.readBody(response,record.bytes,signal);checkFineAbort(signal);
  if(await hash(encoded)!==record.sha256)throw new Error('Prepared fine scan checksum failed.');
  let data;
  if(this.decodePrepared)data=await this.decodePrepared(encoded,record,signal);
  else{
   const bitmap=await createImageBitmap(new Blob([encoded],{type:'image/webp'}));
   const canvas=new OffscreenCanvas(record.width,record.height),context=canvas.getContext('2d',{willReadFrequently:true});
   try{checkFineAbort(signal);context.drawImage(bitmap,0,0);}finally{bitmap.close();}
   const rgba=context.getImageData(0,0,record.width,record.height).data;data=new Uint8Array(record.width*record.height);
   for(let i=0;i<data.length;i++){data[i]=rgba[i*4];if(i&&i%1048576===0){await tick();checkFineAbort(signal);}}
  }
  if(await hash(data)!==record.pixelSha256)throw new Error('Prepared fine scan pixels failed validation.');
  checkFineAbort(signal);
  const sourceSpacingUm=this.manifest.sourceSpacingUm||79.4;
  result={data,width:record.width,height:record.height,plane,spacingUm:Math.max(...(record.spacingUmXY||[sourceSpacingUm])),sourceSpacingUm,spacingUmXY:record.spacingUmXY,complete:true,cleaned:true,preparedPlaneId:record.id,source:`Measured ${sourceSpacingUm} µm volume · prepared probe plane`};
  const previous=this.prepared.get(record.id);if(previous)this.preparedBytes-=previous.data.byteLength;
  this.prepared.delete(record.id);
  if(data.byteLength<=this.preparedLimit){this.prepared.set(record.id,result);this.preparedBytes+=data.byteLength;}
  while(this.preparedBytes>this.preparedLimit){const first=this.prepared.keys().next().value;this.preparedBytes-=this.prepared.get(first).data.byteLength;this.prepared.delete(first);}
  safe(onProgress,{ready:1,total:1,phase:'complete',bytes:record.bytes});return result;
 }
 async boundedPreparedPlane(record,plane,{signal,onProgress}={}){
  const controller=new AbortController(),abort=()=>controller.abort(signal?.reason||fineAbort());
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const timer=setTimeout(()=>{const error=new Error('The prepared fine plane stopped responding. Move the probe or retry the view.');error.name='TimeoutError';controller.abort(error);},this.transferTimeoutMs);
  try{return await withAbort(this.preparedPlane(record,plane,{signal:controller.signal,onProgress}),controller.signal);}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 }
 async samplePlane(input,{signal,onProgress,spacingUm=this.manifest.sourceSpacingUm||79.4,exactRaster=false,persistSection=false,residentOnly=false,retainTransfers=false}={}){
  checkFineAbort(signal);const plane=validFinePlane(input);
  const preset=this.manifest.preparedPlanes?.find(p=>sameFinePlane(p.plane,plane,exactRaster?1e-8:1e-7))||(!exactRaster&&this.manifest.preparedPlanes?.find(p=>reusableFineSection(p.plane,plane,fineSourceExtent(this.manifest))));
  // The original raster remains in its original coordinate frame. A sweep
  // inside this plane therefore reuses native pixels without another download,
  // second resampling pass, or a false claim that an old image is a new section.
  // Exact-raster consumers instead sample source bricks when axes/crop differ.
  if(preset&&(!residentOnly||this.prepared.has(preset.id)))return this.boundedPreparedPlane(preset,orientFineSection(preset.plane,plane),{signal,onProgress});
  const started=performance.now(),plan=planFinePlane(this.manifest,plane,{spacingUm});
  if(exactRaster&&persistSection){
   const saved=await this.sectionStore.get(plane,plan,{signal});checkFineAbort(signal);
   if(saved){safe(onProgress,{ready:1,total:1,phase:'complete',local:true,savedSection:true,bytes:0});return saved;}
  }
  const resident=plan.blocks.every(block=>this.cache.has(block.id));
  if(residentOnly&&!resident)return null;
  const out=new Uint8Array(plan.width*plan.height);
  if(!resident)await this.disk.init();checkFineAbort(signal);
  const local=resident||plan.blocks.every(block=>{if(this.cache.has(block.id))return true;const url=new URL(block.record.path,this.base);url.searchParams.set('v',block.record.sha256.slice(0,16));return this.disk.items.has(url.href);});
  // Start cold reads first. While they wait on transport/decompression, other
  // slots can sample resident blocks instead of delaying the first round trip
  // until the already-cached center of the image has been traversed.
  const blocks=[...plan.blocks.filter(block=>!this.cache.has(block.id)),...plan.blocks.filter(block=>this.cache.has(block.id))],release=this.protect(plan.blocks);
  let index=0,ready=0,completedBytes=0,lastYield=performance.now(),lastProgress=0;
  safe(onProgress,{ready,total:plan.blocks.length,phase:resident?'sampling':'bricks',local,resident,bytes:0});
  const run=async taskSignal=>{while(index<blocks.length){checkFineAbort(taskSignal);const block=blocks[index++],data=await this.getBrick(block,taskSignal,{retainOnAbort:retainTransfers,residentOnly});checkFineAbort(taskSignal);if(!data){const error=new Error('The moving fine plane left the resident cache.');error.name='FineCacheMiss';throw error;}sampleFineBrick(plan,block,data,out);ready++;completedBytes+=block.record.bytes;
   const now=performance.now();if(now-lastProgress>75||ready===plan.blocks.length){lastProgress=now;safe(onProgress,{ready,total:plan.blocks.length,phase:resident?'sampling':'bricks',local,resident,bytes:completedBytes});}
   if(now-lastYield>8){lastYield=now;await tick();}
  }};
  try{await runFineTasks(Math.min(this.transferPolicy.foreground,blocks.length),run,signal);checkFineAbort(signal);}catch(error){if(residentOnly&&error.name==='FineCacheMiss')return null;throw error;}finally{release();}
  safe(onProgress,{ready,total:plan.blocks.length,phase:'complete',local:true,resident:true,bytes:completedBytes});
  const sourceSpacingUm=this.manifest.sourceSpacingUm||79.4;
  const result={data:out,width:plan.width,height:plan.height,plane,spacingUm:Math.max(...plan.spacingUmXY),sourceSpacingUm,spacingUmXY:plan.spacingUmXY,complete:true,cleaned:true,source:`Measured ${sourceSpacingUm} µm volume · trilinear reformat`,brickCount:plan.blocks.length,sourceElapsedMs:performance.now()-started};
  if(exactRaster&&persistSection)this.sectionStore.save(result,plan);
  return result;
 }
 async warmPlane(input,{signal,localOnly=true,paddingMm=3,retainTransfers=false,currentPlane=false}={}){
  checkFineAbort(signal);const plane=validFinePlane(input),plans=[planFinePlane(this.manifest,plane,{spacingUm:Math.max(this.manifest.sourceSpacingUm,500)})];
  if(plane.normal&&paddingMm>0)for(const sign of [-1,1])plans.push(planFinePlane(this.manifest,{...plane,center:plane.center.map((v,i)=>v+plane.normal[i]*sign*paddingMm/this.manifest.longestMm)},{spacingUm:Math.max(this.manifest.sourceSpacingUm,500)}));
  const blocks=new Map();for(const block of plans[0].blocks)blocks.set(block.id,block);
  // Alternate the two sides of the current plane rather than spending the
  // entire remaining cache budget on the first direction of possible motion.
  for(let n=0;n<Math.max(0,...plans.slice(1).map(plan=>plan.blocks.length));n++)for(const plan of plans.slice(1)){const block=plan.blocks[n];if(block&&!blocks.has(block.id))blocks.set(block.id,block);}
  // Never prefetch more than the bounded residency budget can retain. Warm the
  // current plane first, then its small neighboring slab. A separate low
  // concurrency limit and immediate cancellation keep this subordinate to input.
  let ready=0,checked=0,index=0,lastYield=performance.now();const maximum=Math.floor(this.limit/this.manifest.decodedBrickBytes),queue=[...blocks.values()];
  if(!localOnly)queue.length=Math.min(queue.length,maximum);
  const run=async taskSignal=>{while(index<queue.length){
   checkFineAbort(taskSignal);if(ready>=maximum)break;const block=queue[index++];
   if(await this.getBrick(block,taskSignal,{localOnly,priority:currentPlane?'high':'low',retainOnAbort:retainTransfers}))ready++;checked++;
   if(performance.now()-lastYield>6){await tick();lastYield=performance.now();}
  }};
  await runFineTasks(Math.min(currentPlane?this.transferPolicy.foreground:this.transferPolicy.background,queue.length),run,signal);
  return {ready,checked,localOnly,...this.getStatus()};
 }
 getStatus(){return {decodedBytes:this.bytes,decodedLimit:this.limit,decodedHits:this.decodedHits,diskHits:this.diskHits,preparedBytes:this.preparedBytes,persistentBytes:this.disk.bytes,persistentAvailable:this.disk.available,networkBytes:this.networkBytes,transferPolicy:{...this.transferPolicy},...this.brickQueue.getStatus(),...this.sectionStore.getStatus()};}
}
