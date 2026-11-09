import {checkFineAbort,validFinePlane,sameFinePlane} from './ultra-volume-core.js';

const MiB=1024*1024;
export const FINE_SECTION_CACHE='heart-exact-sections-v40';
// A versioned interpolation identity is deliberately separate from a view name.
// Changed planes, source blocks or sampling code must never inherit old pixels.
const SAMPLER='trilinear-u8-positive-halo-v1';
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
const textBytes=value=>new TextEncoder().encode(JSON.stringify(value));
const boundedInteger=(n,max)=>Number.isSafeInteger(n)&&n>0&&n<=max;

async function readBounded(response,maximum,signal){
 const reader=response.body?.getReader();if(!reader)throw new Error('Missing saved section data.');
 const chunks=[];let length=0;
 try{
  while(true){checkFineAbort(signal);const {done,value}=await reader.read();if(done)break;
   length+=value.byteLength;if(length>maximum)throw new Error('Saved section exceeds its byte budget.');chunks.push(value);
  }
  const out=new Uint8Array(length);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.byteLength;}return out;
 }catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
}

/** Optional, bounded device-local storage of complete measured 2D reformats.
 * A hit needs no 3D brick decoding. Storage denial/corruption is just a miss;
 * it can never block the ordinary verified source path or alter its pixels.
 */
export class FineSectionStore{
 constructor(manifest,{baseUrl,cacheStorage=globalThis.caches,resourcePolicy={},limit,maxEntryBytes}={}){
  this.manifest=manifest;this.cacheStorage=cacheStorage;this.baseUrl=baseUrl||import.meta.url;
  this.limit=limit??(resourcePolicy.constrained?32:96)*MiB;
  this.maxEntryBytes=Math.min(maxEntryBytes??(resourcePolicy.constrained?4:12)*MiB,12*MiB);
  this.pendingBytes=0;this.hits=0;this.writes=0;this.available=!!cacheStorage;
  this.writeQueue=Promise.resolve();
 }
 async identity(){
  if(!this.identityPromise){
   const m=this.manifest;
   this.identityPromise=digest(textBytes({sampler:SAMPLER,schemaVersion:m.schemaVersion,version:m.version,datasetId:m.datasetId,specimen:m.specimen,
    sourceSpacingUm:m.sourceSpacingUm,sourceOriginXYZ:m.sourceOriginXYZ,sourceShapeXYZ:m.sourceShapeXYZ,
    fullDimensionsXYZ:m.fullDimensionsXYZ,longestMm:m.longestMm,sourceMaskSha256:m.sourceMaskSha256,
    sourceWindow:m.sourceWindow,codec:m.codec,brickSize:m.brickSize,brickCountsXYZ:m.brickCountsXYZ,storedEdge:m.storedEdge,emptyValue:m.emptyValue,
    blocks:Object.entries(m.blocks).map(([id,b])=>[id,b.rawSha256])}));
  }
  return this.identityPromise;
 }
 async descriptor(plane,plan){
  const source=await this.identity(),p=validFinePlane(plane);
  const raster={center:p.center,right:p.right,up:p.up,width:p.width,height:p.height};
  const key=await digest(textBytes({source,plane:raster,width:plan.width,height:plan.height,spacingUmXY:plan.spacingUmXY}));
  return {source,plane:raster,key,width:plan.width,height:plan.height,spacingUmXY:plan.spacingUmXY,
   url:new URL('/__heart-local-sections-v40/'+key,this.baseUrl).href};
 }
 async open(){
  if(!this.available)return null;
  try{return await (this.cachePromise??=this.cacheStorage.open(FINE_SECTION_CACHE));}
  catch{this.available=false;return null;}
 }
 async trim(cache,reserve=0,exclude=null){
  const entries=[];let total=0;
  for(const request of await cache.keys()){
   if(request.url===exclude)continue;
   const entry=await cache.match(request);let meta;
   try{meta=entry&&JSON.parse(entry.headers.get('x-heart-section')||'null');}catch{}
   if(!meta||!boundedInteger(meta.bytes,12*MiB+65536)){await cache.delete(request);continue;}
   entries.push({request,bytes:meta.bytes});total+=meta.bytes;
  }
  for(const entry of entries){if(total+reserve<=this.limit)break;await cache.delete(entry.request);total-=entry.bytes;}
 }
 async get(plane,plan,{signal}={}){
  checkFineAbort(signal);if(!this.available)return null;
  let cache,descriptor;
  try{
   descriptor=await this.descriptor(plane,plan);checkFineAbort(signal);
   cache=await this.open();if(!cache)return null;
   const response=await cache.match(descriptor.url);checkFineAbort(signal);if(!response)return null;
   const meta=JSON.parse(response.headers.get('x-heart-section')||'null');
   if(!meta||meta.version!==1||meta.source!==descriptor.source||meta.key!==descriptor.key||
     meta.width!==plan.width||meta.height!==plan.height||!sameFinePlane(meta.plane,descriptor.plane,1e-12)||
     !boundedInteger(meta.bytes,this.maxEntryBytes+65536)||!boundedInteger(meta.decodedBytes,this.maxEntryBytes)||
     meta.decodedBytes!==plan.width*plan.height||!['gzip','raw'].includes(meta.codec)||
     !/^[a-f0-9]{64}$/.test(meta.pixelSha256))throw new Error('Saved section identity mismatch.');
   let bytes=await readBounded(response,meta.bytes,signal);
   if(bytes.byteLength!==meta.bytes)throw new Error('Incomplete saved section.');
   if(meta.codec==='gzip'){
    if(typeof DecompressionStream!=='function')return null;
    bytes=await readBounded(new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))),meta.decodedBytes,signal);
   }
   if(bytes.byteLength!==meta.decodedBytes||await digest(bytes)!==meta.pixelSha256)throw new Error('Saved section checksum mismatch.');
   checkFineAbort(signal);this.hits++;
   return {data:bytes,width:plan.width,height:plan.height,plane:validFinePlane(plane),spacingUm:Math.max(...plan.spacingUmXY),
    spacingUmXY:[...plan.spacingUmXY],sourceSpacingUm:this.manifest.sourceSpacingUm,complete:true,cleaned:true,
    savedSection:true,encodedBytes:meta.bytes,source:'Exact measured section · saved on this device'};
  }catch(error){
   if(error.name==='AbortError')throw error;
   if(cache&&descriptor)await cache.delete(descriptor.url).catch(()=>{});
   return null;
  }
 }
 save(result,plan){
  const size=result?.data?.byteLength||0;
  if(!this.available||!result?.complete||!result?.cleaned||!size||size!==result.width*result.height||
    size>this.maxEntryBytes||this.pendingBytes+size>this.maxEntryBytes)return false;
  // The worker transfers its result immediately; keep just one bounded copy
  // for asynchronous compression, never a detached/transferred source buffer.
  const pixels=result.data.slice(),plane=validFinePlane(result.plane);
  const dimensions={width:plan.width,height:plan.height,spacingUmXY:[...plan.spacingUmXY]};
  this.pendingBytes+=size;
  this.writeQueue=this.writeQueue.then(async()=>{
   const cache=await this.open();if(!cache)return;
   const descriptor=await this.descriptor(plane,dimensions);
   const pixelSha256=await digest(pixels);let body=pixels,codec='raw';
   if(typeof CompressionStream==='function'){
    const compressed=await readBounded(new Response(new Blob([pixels]).stream().pipeThrough(new CompressionStream('gzip'))),size+65536);
    if(compressed.length<pixels.length){body=compressed;codec='gzip';}
   }
   if(body.byteLength>this.limit)return;
   const commit=async()=>{
    // Count all donors/tabs. The shared lock serializes the budget check and
    // write across workers. The post-write trim also bounds older browsers
    // without Web Locks after simultaneous writes settle.
    await this.trim(cache,body.byteLength,descriptor.url);
    const meta={version:1,...descriptor,url:undefined,bytes:body.byteLength,decodedBytes:size,codec,pixelSha256};
    await cache.put(descriptor.url,new Response(body,{headers:{'content-type':'application/octet-stream',
     'content-length':String(body.byteLength),'x-heart-section':JSON.stringify(meta)}}));
    await this.trim(cache);this.writes++;
   };
   const locks=globalThis.navigator?.locks;
   if(locks?.request)await locks.request(FINE_SECTION_CACHE,commit);else await commit();
  }).catch(()=>{ /* A quota/storage error must not affect source rendering. */ })
   .finally(()=>{this.pendingBytes-=size;});
  return true;
 }
 getStatus(){return {savedSectionHits:this.hits,savedSectionWrites:this.writes,savedSectionPendingBytes:this.pendingBytes,savedSectionLimit:this.limit};}
}
