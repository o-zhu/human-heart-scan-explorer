import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {FineSectionStore,FINE_SECTION_CACHE} from '../public/fine-section-store.js';
import {FineVolumeBackend} from '../public/ultra-volume-backend.js';
import {planFinePlane} from '../public/ultra-volume-core.js';
import {UltraVolumeSource} from '../public/ultra-volume.js';

const sha=a=>createHash('sha256').update(a).digest('hex');
const plane={center:[0,0,0],right:[1,0,0],up:[0,1,0],normal:[0,0,1],width:.75,height:.75};
const raw=Uint8Array.from({length:729},(_,i)=>(i*31+Math.floor(i/9)*7)%256),compressed=gzipSync(raw);
const manifest={schemaVersion:1,version:'fixture-one',codec:'gzip-u8-zyx-positive-halo',brickSize:8,storedEdge:9,decodedBrickBytes:729,
 sourceShapeXYZ:[9,9,9],sourceOriginXYZ:[0,0,0],fullDimensionsXYZ:[9,9,9],sourceSpacingUm:1000,longestMm:8,
 brickCountsXYZ:[1,1,1],assetBaseUrl:'/fine/',blocks:{0:{path:'0.gz',bytes:compressed.length,sha256:sha(compressed),rawSha256:sha(raw)}}};
const plan=planFinePlane(manifest,plane),pixels=Uint8Array.from({length:plan.width*plan.height},(_,i)=>(i*31)%256);
const result=(p=plane,data=pixels)=>({data,width:plan.width,height:plan.height,plane:p,spacingUm:1000,sourceSpacingUm:1000,spacingUmXY:plan.spacingUmXY,complete:true,cleaned:true});

function storage(){
 const entries=new Map(),names=[];
 const key=r=>typeof r==='string'?r:r.url;
 const cache={async match(r){return entries.get(key(r))?.clone();},async put(r,response){entries.set(key(r),response.clone());},async delete(r){return entries.delete(key(r));},async keys(){return [...entries.keys()].map(url=>new Request(url));}};
 return {entries,names,cache,async open(name){names.push(name);return cache;}};
}
const makeStore=(cache,source=manifest,options={})=>new FineSectionStore(source,{baseUrl:'https://heart.test/',cacheStorage:cache,...options});

test('a completed exact plane reopens byte-for-byte with no brick transport or decoding',async()=>{
 const disk=storage(),firstStore=makeStore(disk);let fetches=0;
 const first=new FineVolumeBackend(manifest,{baseUrl:'https://heart.test/',sectionStore:firstStore,fetcher:async()=>{fetches++;return new Response(compressed);}});
 const sampled=await first.samplePlane(plane,{exactRaster:true,persistSection:true});
 assert.equal(fetches,1);await firstStore.writeQueue;
 const secondStore=makeStore(disk),second=new FineVolumeBackend(manifest,{baseUrl:'https://heart.test/',sectionStore:secondStore,fetcher:()=>{throw new Error('A saved section must not fetch source bricks.');}});
 const loaded=await second.samplePlane(plane,{exactRaster:true,persistSection:true});
 assert.equal(loaded.savedSection,true);assert.deepEqual(loaded.data,sampled.data);assert.deepEqual(loaded.plane,plane);
 assert.equal(second.getStatus().networkBytes,0);assert.equal(second.getStatus().decodedBytes,0);assert.equal(secondStore.hits,1);
 assert.ok(disk.names.every(n=>n===FINE_SECTION_CACHE));
});

test('donor/source, changed blocks, spacing, crop and even sub-key-precision plane changes miss',async()=>{
 const disk=storage(),store=makeStore(disk);store.save(result(),plan);await store.writeQueue;
 for(const updated of [{...manifest,datasetId:'another-donor'},{...manifest,sourceMaskSha256:'different-mask'},
  {...manifest,blocks:{0:{...manifest.blocks[0],rawSha256:'0'.repeat(64)}}},{...manifest,sourceSpacingUm:1001},
  {...manifest,brickCountsXYZ:[2,1,1]},{...manifest,schemaVersion:2}]){
  assert.equal(await makeStore(disk,updated).get(plane,plan),null);
 }
 for(const p of [{...plane,center:[1e-10,0,0]},{...plane,width:.76},{...plane,right:[-1,0,0]},
  {...plane,up:[0,-1,0]},{...plane,center:[0,0,.1]}])assert.equal(await store.get(p,planFinePlane(manifest,p)),null);
 assert.equal(await store.get(plane,planFinePlane(manifest,plane,{spacingUm:2000})),null);
});

test('asynchronous saving owns a bounded copy before the result is transferred to the UI',async()=>{
 const disk=storage(),store=makeStore(disk),data=pixels.slice(),expected=data.slice();
 assert.equal(store.save(result(plane,data),plan),true);
 structuredClone(data.buffer,{transfer:[data.buffer]});assert.equal(data.byteLength,0);
 await store.writeQueue;assert.equal(store.pendingBytes,0);
 assert.deepEqual((await store.get(plane,plan)).data,expected);
});

test('corruption is discarded and a source reformat repairs the saved section',async()=>{
 const disk=storage(),store=makeStore(disk);store.save(result(),plan);await store.writeQueue;
 const [key,response]=[...disk.entries][0],headers=new Headers(response.headers);
 const corrupt=new Uint8Array(await response.arrayBuffer());corrupt[0]^=0xff;disk.entries.set(key,new Response(corrupt,{headers}));
 assert.equal(await store.get(plane,plan),null);assert.equal(disk.entries.size,0);
 let fetches=0;const backend=new FineVolumeBackend(manifest,{baseUrl:'https://heart.test/',sectionStore:store,fetcher:async()=>{fetches++;return new Response(compressed);}});
 await backend.samplePlane(plane,{exactRaster:true,persistSection:true});await store.writeQueue;
 assert.equal(fetches,1);assert.equal(disk.entries.size,1);
});

test('incomplete, oversized and simultaneous pending copies stay inside the memory ceiling',async()=>{
 const disk=storage(),store=makeStore(disk,manifest,{maxEntryBytes:pixels.length});
 assert.equal(store.save({...result(),complete:false},plan),false);
 assert.equal(store.save({...result(),cleaned:false},plan),false);
 assert.equal(store.save({...result(),data:new Uint8Array(pixels.length+1)},plan),false);
 assert.equal(store.save(result(),plan),true);assert.equal(store.save(result(),plan),false);
 assert.equal(store.pendingBytes,pixels.length);await store.writeQueue;assert.equal(store.pendingBytes,0);
 assert.equal(makeStore(disk,manifest,{resourcePolicy:{constrained:true}}).maxEntryBytes,4*1024*1024);
});

test('encoded storage is bounded across different planes and donors',async()=>{
 const disk=storage(),store=makeStore(disk,manifest,{limit:pixels.length+2});
 store.save(result(),plan);await store.writeQueue;
 const shifted={...plane,center:[.1,0,0]},other=makeStore(disk,{...manifest,datasetId:'second'},{limit:pixels.length+2});
 other.save(result(shifted),plan);await other.writeQueue;
 assert.equal(disk.entries.size,1);assert.equal(await store.get(plane,plan),null);
 assert.deepEqual((await other.get(shifted,plan)).data,pixels);
});

test('simultaneous store instances trim their shared budget after both writes settle',async()=>{
 const disk=storage(),options={limit:pixels.length+2};
 const a=makeStore(disk,manifest,options),b=makeStore(disk,{...manifest,datasetId:'second'},options);
 a.save(result(),plan);b.save(result({...plane,center:[.1,0,0]}),plan);
 await Promise.all([a.writeQueue,b.writeQueue]);
 const bytes=[...disk.entries.values()].reduce((sum,response)=>sum+JSON.parse(response.headers.get('x-heart-section')).bytes,0);
 assert.ok(bytes<=options.limit);assert.ok(disk.entries.size<=1);
});

test('storage refusal, quota exhaustion and malformed cache metadata cannot block a section',async()=>{
 const denied=makeStore({async open(){throw new Error('Denied');}});assert.equal(await denied.get(plane,plan),null);
 const disk=storage(),store=makeStore(disk);disk.cache.put=async()=>{throw new Error('Quota');};
 assert.equal(store.save(result(),plan),true);await store.writeQueue;assert.equal(store.pendingBytes,0);assert.equal(store.writes,0);
 const malformed=storage();malformed.entries.set('https://heart.test/old',new Response('bad',{headers:{'x-heart-section':'bad JSON'}}));
 const valid=makeStore(malformed);valid.save(result(),plan);await valid.writeQueue;assert.equal(valid.writes,1);assert.equal(malformed.entries.size,1);
});

test('aborted reads reject and moving/free-probe sections never opt into persistent writes',async()=>{
 const store=makeStore(storage()),controller=new AbortController();controller.abort();
 await assert.rejects(store.get(plane,plan,{signal:controller.signal}),{name:'AbortError'});
 let gets=0,saves=0;const sectionStore={get(){gets++;throw new Error('Unexpected read');},save(){saves++;},getStatus(){return {};}};
 const backend=new FineVolumeBackend(manifest,{baseUrl:'https://heart.test/',sectionStore,fetcher:async()=>new Response(compressed)});
 await backend.samplePlane(plane);await backend.samplePlane(plane,{exactRaster:true});
 await backend.samplePlane(plane,{persistSection:true});assert.equal(gets,0);assert.equal(saves,0);
});

test('the Window service forwards explicit persistence intent without changing free-probe defaults',async()=>{
 const messages=[];let worker;
 const source=new UltraVolumeSource({activity:null,fetcher:async()=>Response.json(manifest),workerFactory:()=>worker={terminate(){},postMessage(m){messages.push(m);if(m.type==='init')queueMicrotask(()=>worker.onmessage({data:{type:'ready'}}));else if(m.type==='sample')queueMicrotask(()=>worker.onmessage({data:{type:'result',id:m.id,result:{...result(m.plane),data:pixels.slice().buffer}}}));}}});
 try{
  await source.samplePlane(plane,{exactRaster:true,persistSection:true});
  await source.samplePlane({...plane,center:[0,0,.2]});
  assert.deepEqual(messages.filter(m=>m.type==='sample').map(m=>m.persistSection),[true,false]);
 }finally{source.destroy();}
});
