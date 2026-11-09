import {decodeN5, decodeBloscBlock, parseN5Header} from './n5-source.js';
import {makeUltraPlan, copyUltraSection} from './ultra-plan.js';

const MiB = 1024 * 1024;
const CACHE_NAME = 'heart-ladaf-2021-17-n5-s2-v1';
let manifest, support, active;
const memory = new Map();
let memoryBytes = 0;
const recentBytes = new Map();
let recentSize = 0;
let diskPromise;
let diskBytes = 0;
const diskEntries = new Map();
let diskQueue = Promise.resolve();

function abortError() { return new DOMException('Ultra detail request cancelled.', 'AbortError'); }
function cacheMiss() { const error = new Error('This ultra section has not been downloaded yet.'); error.name = 'CacheMissError'; return error; }
function check(signal) { if(signal?.aborted) throw abortError(); }
function memoryGet(key) {
  const value = memory.get(key);
  if(value){ memory.delete(key); memory.set(key,value); }
  return value;
}
function memoryPut(key,value) {
  if(memory.has(key)) memoryBytes -= memory.get(key).data.length;
  memory.delete(key);memory.set(key,value);memoryBytes += value.data.length;
  const limit = (manifest.memoryCacheMiB || 64) * MiB;
  while(memoryBytes > limit && memory.size > 1){
    const key = memory.keys().next().value;
    memoryBytes -= memory.get(key).data.length;memory.delete(key);
  }
}
function cacheRequest(url,range) {
  const key = new URL(url);
  key.searchParams.set('heart-explorer-cache-range',range || 'full');
  return key.href;
}
async function disk() {
  if(!diskPromise) diskPromise = (async()=>{
    if(!globalThis.caches) return null;
    try {
      const result = await caches.open(CACHE_NAME);
      for(const request of await result.keys()) {
        const response = await result.match(request);
        const n = Number(response?.headers.get('x-heart-cache-bytes') || 0);
        diskEntries.set(request.url,n);diskBytes += n;
      }
      return result;
    } catch { return null; }
  })();
  return diskPromise;
}
async function cachedBytes(url,range) {
  const key = cacheRequest(url,range);
  if(recentBytes.has(key)) {
    const value=recentBytes.get(key);recentBytes.delete(key);recentBytes.set(key,value);return value;
  }
  try {
    const storage = await disk();
    const response = storage && await storage.match(key);
    if(response) return new Uint8Array(await response.arrayBuffer());
  } catch { /* A disabled or full browser cache must not block source loading. */ }
  return null;
}
async function hasCachedBytes(url,range) {
  const key=cacheRequest(url,range);
  if(recentBytes.has(key))return true;
  try { return Boolean((await disk()) && diskEntries.has(key)); } catch{return false;}
}
function saveBytes(url,range,bytes) {
  const key=cacheRequest(url,range);
  if(recentBytes.has(key))recentSize -= recentBytes.get(key).length;
  recentBytes.delete(key);recentBytes.set(key,bytes);recentSize += bytes.length;
  while(recentSize > 12*MiB && recentBytes.size > 1) {
    const oldest=recentBytes.keys().next().value;
    recentSize -= recentBytes.get(oldest).length;recentBytes.delete(oldest);
  }
  // Serialize quota accounting, but do not hold up the visible section while
  // the browser persists reusable public source blocks.
  diskQueue = diskQueue.then(async()=>{
    const storage=await disk();if(!storage)return;
    const limit=(manifest.diskCacheMiB || 128)*MiB;
    if(bytes.length > limit)return;
    if(diskEntries.has(key)){
      diskBytes-=diskEntries.get(key);diskEntries.delete(key);await storage.delete(key);
    }
    while(diskBytes+bytes.length > limit && diskEntries.size){
      const oldest=diskEntries.keys().next().value;
      diskBytes-=diskEntries.get(oldest);diskEntries.delete(oldest);await storage.delete(oldest);
    }
    await storage.put(key,new Response(bytes,{headers:{'Content-Type':'application/octet-stream','x-heart-cache-bytes':String(bytes.length)}}));
    diskEntries.set(key,bytes.length);diskBytes+=bytes.length;
  }).catch(()=>{});
}
async function sourceBytes(url,range,job,{persist=true}={}) {
  check(job.signal);
  const existing=await cachedBytes(url,range);
  if(existing){job.cachedBytes+=existing.length;return {bytes:existing,whole:!range,cached:true};}
  if(job.cacheOnly)throw cacheMiss();
  const controller=new AbortController();
  const relay=()=>controller.abort();job.signal.addEventListener('abort',relay,{once:true});
  const timer=setTimeout(()=>controller.abort(),60000);
  try {
    const response=await fetch(url,{mode:'cors',credentials:'omit',signal:controller.signal,
      headers:range?{Range:`bytes=${range}`}:{}});
    if(!response.ok)throw new Error(`The public scan returned HTTP ${response.status}.`);
    if(range && response.status!==206 && response.status!==200)throw new Error('The source did not return the requested scan byte range.');
    const bytes=new Uint8Array(await response.arrayBuffer());
    check(job.signal);
    job.receivedBytes+=bytes.length;
    const whole=response.status===200;
    if(persist||whole)saveBytes(url,whole?'':range,bytes);
    return {bytes,whole,cached:false};
  } catch(error) {
    if(job.signal.aborted)throw abortError();
    if(error.name==='AbortError')throw new Error('The public source timed out. The detailed cutaway remains available; try ultra detail again.');
    throw error;
  } finally { clearTimeout(timer);job.signal.removeEventListener('abort',relay); }
}
function chunkUrl(coord) {return `${manifest.sourceHttp}${manifest.sourceScale}/${coord.join('/')}`;}
function fullKey(coord) {return `full:${coord.join(':')}`;}
function partKey(coord,index) {return `part:${coord.join(':')}:${index}`;}
async function fullChunk(coord,job) {
  const key=fullKey(coord),found=memoryGet(key);if(found){job.memoryHits++;return found;}
  const response=await sourceBytes(chunkUrl(coord),'',job);
  check(job.signal);const decoded=await decodeN5(response.bytes);check(job.signal);memoryPut(key,decoded);return decoded;
}
async function sourceSubBlocks(plan,coord,job) {
  const key=fullKey(coord),found=memoryGet(key);if(found){job.memoryHits++;return [found];}
  const mask=plan.maskByKey[coord.join(':')]??15;
  const wanted=[0,1,2,3].filter(i=>mask&(1<<i));
  const resident=wanted.map(i=>memoryGet(partKey(coord,i)));
  // The decoded blocks already include dimensions and byte offsets. Their
  // small compressed headers may have left the separate byte-cache LRU; that
  // must not turn a complete in-memory section into another network request.
  if(resident.every(Boolean)){job.memoryHits+=resident.length;return resident;}
  const url=chunkUrl(coord);
  const full=await cachedBytes(url,'');
  if(full){job.cachedBytes+=full.length;const decoded=await decodeN5(full);check(job.signal);memoryPut(key,decoded);return [decoded];}
  if(plan.axis!==2 && mask===15)return [await fullChunk(coord,job)];
  const response=await sourceBytes(url,'0-255',job);
  if(response.whole){const decoded=await decodeN5(response.bytes);check(job.signal);memoryPut(key,decoded);return [decoded];}
  const header=parseN5Header(response.bytes);
  if(header.uncompressed || header.blockBytes!==1048576 || header.count!==4 ||
      header.dimensions.some(n=>n!==128))return [await fullChunk(coord,job)];
  const blocks=[];
  const missing=[];
  for(const i of wanted){
    const subKey=partKey(coord,i),cached=memoryGet(subKey);
    if(cached){job.memoryHits++;blocks.push(cached);continue;}
    const range=`${16+header.offsets[i]}-${16+header.blockEnds[i]-1}`;
    const cachedPayload=await cachedBytes(url,range);
    if(cachedPayload){
      job.cachedBytes+=cachedPayload.length;const decoded=await decodeBloscBlock(response.bytes,i,cachedPayload);
      check(job.signal);memoryPut(subKey,decoded);blocks.push(decoded);
    }else missing.push({i,start:16+header.offsets[i],end:16+header.blockEnds[i]});
  }
  // Adjacent compressed sub-blocks share one HTTP request. Cache each piece
  // independently so another section can reuse any subset without download.
  missing.sort((a,b)=>a.start-b.start);
  const groups=[];
  for(const item of missing){
    const group=groups.at(-1);
    if(group && group.end===item.start){group.end=item.end;group.items.push(item);}
    else groups.push({start:item.start,end:item.end,items:[item]});
  }
  for(const group of groups){
    const range=`${group.start}-${group.end-1}`;
    const part=await sourceBytes(url,range,job,{persist:false});check(job.signal);
    if(part.whole){const decoded=await decodeN5(part.bytes);memoryPut(key,decoded);return [decoded];}
    for(const item of group.items){
      const payload=part.bytes.slice(item.start-group.start,item.end-group.start);
      saveBytes(url,`${item.start}-${item.end-1}`,payload);
      const decoded=await decodeBloscBlock(response.bytes,item.i,payload);check(job.signal);
      memoryPut(partKey(coord,item.i),decoded);blocks.push(decoded);
    }
  }
  return blocks;
}
async function allCached(plan) {
  for(const coord of plan.blocks){
    const key=fullKey(coord),url=chunkUrl(coord);
    if(memory.has(key))continue;
    const mask=plan.maskByKey[coord.join(':')]??15;
    if([0,1,2,3].filter(i=>mask&(1<<i)).every(i=>memory.has(partKey(coord,i))))continue;
    if(await hasCachedBytes(url,''))continue;
    if(plan.axis!==2 && mask===15)return false;
    const headerBytes=await cachedBytes(url,'0-255');if(!headerBytes)return false;
    let header;try{header=parseN5Header(headerBytes);}catch{return false;}
    if(header.uncompressed || header.blockBytes!==1048576 || header.count!==4 || header.dimensions.some(n=>n!==128))return false;
    for(let i=0;i<4;i++){
      if(!(mask&(1<<i)))continue;
      if(memory.has(partKey(coord,i)))continue;
      if(!await hasCachedBytes(url,`${16+header.offsets[i]}-${16+header.blockEnds[i]-1}`))return false;
    }
  }
  return true;
}
function report(job,stage='loading') {
  if(active!==job)return;
  postMessage({type:'progress',id:job.id,progress:{stage,completed:job.completed,loaded:job.completed,total:job.plan.blocks.length,
    receivedBytes:job.receivedBytes,bytes:job.receivedBytes,cachedBytes:job.cachedBytes,memoryHits:job.memoryHits,
    estimatedBytes:job.plan.estimatedBytes,spacingUm:79.4}});
}
async function load(message) {
  if(active)active.controller.abort();
  const controller=new AbortController();
  const job={id:message.id,controller,signal:controller.signal,cacheOnly:Boolean(message.cacheOnly),
    plan:makeUltraPlan(message.axis,message.index,manifest,support),completed:0,receivedBytes:0,cachedBytes:0,memoryHits:0};
  active=job;
  try {
    if(job.cacheOnly && !await allCached(job.plan))throw cacheMiss();
    check(job.signal);report(job);
    const data=new Uint8Array(job.plan.width*job.plan.height);
    let next=0;
    const consume=async()=>{
      while(next<job.plan.blocks.length){
        check(job.signal);const coord=job.plan.blocks[next++];
        const decoded=await sourceSubBlocks(job.plan,coord,job);
        check(job.signal);
        for(const block of decoded)copyUltraSection(job.plan,coord,block,data,manifest.sourceWindow);
        job.completed++;report(job);
      }
    };
    await Promise.all(Array.from({length:Math.min(manifest.maxConcurrency||5,job.plan.blocks.length)},consume));
    check(job.signal);report(job,'ready');
    const result={data,width:job.plan.width,height:job.plan.height,axis:job.plan.axis,index:job.plan.index,
      sourceIndex:job.plan.sourceIndex,key:job.plan.key,spacingUm:79.4,source:'N5 s2',
      sourceDtype:'uint16',displayDtype:'uint8',jpegCompression:false,
      blocks:job.plan.blocks.length,receivedBytes:job.receivedBytes,cachedBytes:job.cachedBytes,
      supportRestricted:Boolean(support),sourceWindow:manifest.sourceWindow};
    postMessage({type:'result',id:job.id,result},[data.buffer]);
  } catch(error) {
    controller.abort();
    postMessage({type:'error',id:job.id,name:error.name||'Error',message:error.message||'Ultra detail could not load.'});
  } finally {if(active===job)active=null;}
}
self.onmessage=event=>{
  const message=event.data;
  if(message.type==='configure'){manifest=message.manifest;support=message.support;return;}
  if(message.type==='cancel'){if(active?.id===message.id)active.controller.abort();return;}
  if(message.type==='load'){load(message);return;}
  if(message.type==='cache-status'){
    allCached(makeUltraPlan(message.axis,message.index,manifest,support))
      .then(cached=>postMessage({type:'cache-status',id:message.id,cached}))
      .catch(()=>postMessage({type:'cache-status',id:message.id,cached:false}));
  }
};
