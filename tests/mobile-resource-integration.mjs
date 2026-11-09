import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {getDeviceResourcePolicy} from '../public/device-resources.js';
import {UltraVolumeSource} from '../public/ultra-volume.js';
import {FineVolumeBackend,fineTransferPolicy} from '../public/ultra-volume-backend.js';
import {HostedSectionStore} from '../public/hosted-ultra.js';
import {renderOutputPixelBudget} from '../public/renderer.js';

const MiB=1024*1024;
const mobile=getDeviceResourcePolicy({navigator:{userAgent:'Mozilla/5.0 Macintosh',platform:'MacIntel',maxTouchPoints:5}});
const desktop=getDeviceResourcePolicy({navigator:{userAgent:'Macintosh',platform:'MacIntel',maxTouchPoints:0,deviceMemory:8,hardwareConcurrency:8}});
const manifest={schemaVersion:1,codec:'gzip-u8-zyx-positive-halo',storedEdge:2,brickSize:1,decodedBrickBytes:8,assetBaseUrl:'/fine/',blocks:{}};
const plane={center:[0,0,0],right:[1,0,0],up:[0,1,0],width:.1,height:.1};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

test('desktop-style iPad policy travels from Window into the fine worker',async()=>{
 let worker;const sent=[];
 const source=new UltraVolumeSource({resourcePolicy:mobile,activity:null,fetcher:async()=>Response.json(manifest),
  workerFactory:()=>worker={terminate(){},postMessage(message){sent.push(message);if(message.type==='init')queueMicrotask(()=>worker.onmessage({data:{type:'ready'}}));}}});
 try{await source.init();assert.equal(source.limit,16*MiB);assert.equal(sent[0].resourcePolicy,mobile);assert.equal(sent[0].resourcePolicy.appleTouch,true);}
 finally{source.destroy();}
});

test('fine worker applies the Window budget despite missing worker touch capabilities',async()=>{
 const previousSelf=globalThis.self,originalSample=FineVolumeBackend.prototype.samplePlane,seen=[];
 globalThis.self={postMessage:message=>seen.push(message)};
 FineVolumeBackend.prototype.samplePlane=async function(){
  assert.equal(this.limit,64*MiB);assert.equal(this.preparedLimit,16*MiB);
  assert.deepEqual(this.transferPolicy,{foreground:4,background:1});
  return {data:new Uint8Array([1]),width:1,height:1,plane,complete:true};
 };
 try{
  await import('../public/ultra-volume-worker.js?mobile-budget-test');
  await self.onmessage({data:{type:'init',manifest,baseUrl:'https://heart.example/',resourcePolicy:mobile}});
  await self.onmessage({data:{type:'sample',id:1,plane}});
  assert.deepEqual(seen.map(message=>message.type),['ready','result']);
  assert.equal(seen[1].stats.decodedLimit,64*MiB);
 }finally{FineVolumeBackend.prototype.samplePlane=originalSample;if(previousSelf===undefined)delete globalThis.self;else globalThis.self=previousSelf;}
});

test('protected bricks and oversize results cannot silently exceed retained memory budgets',()=>{
 const policy={...mobile,fineBrickBytes:8,resultCacheBytes:8};
 const backend=new FineVolumeBackend(manifest,{baseUrl:'https://heart.example/',resourcePolicy:policy});
 const release=backend.protect([{id:'a'},{id:'b'},{id:'c'}]);
 for(const id of ['a','b','c'])backend.remember(id,new Uint8Array(4));
 assert.equal(backend.bytes,8);assert.equal(backend.cache.size,2);
 const huge=new Uint8Array(9);assert.equal(backend.remember('huge',huge),huge);assert.equal(backend.cache.has('huge'),false);assert.equal(backend.bytes,8);release();
 const source=new UltraVolumeSource({resourcePolicy:policy,activity:null});
 try{source.remember('first',{data:new Uint8Array(4)});source.remember('large',{data:huge});assert.equal(source.bytes,4);assert.equal(source.results.has('large'),false);}
 finally{source.destroy();}
});

test('a prepared raster larger than cache budget is still returned without retaining an extra owner',async()=>{
 const bytes=new Uint8Array([1,2,3,4]);
 const record={id:'test',plane,width:2,height:2,url:'./test.webp',bytes:4,sha256:sha(bytes),pixelSha256:sha(bytes),spacingUmXY:[79.4,79.4]};
 const backend=new FineVolumeBackend({...manifest,preparedPlanes:[record]},{baseUrl:'https://heart.example/',resourcePolicy:{...mobile,preparedPlaneBytes:3},fetcher:async()=>new Response(bytes),decodePrepared:async()=>bytes.slice()});
 const result=await backend.samplePlane(plane);
 assert.deepEqual(result.data,bytes);assert.equal(backend.preparedBytes,0);assert.equal(backend.prepared.size,0);
});

test('hosted section cache and foreground/background slots follow mobile resource policy',()=>{
 const store=new HostedSectionStore({resourcePolicy:mobile,loader:async()=>{},activity:null,autoDownloadCollection:false});
 try{assert.equal(store.decodedLimit,32*MiB);assert.equal(store.maxConcurrency,2);assert.equal(store.policy().speculative,1);}
 finally{store.dispose();}
 assert.deepEqual(fineTransferPolicy({resourcePolicy:mobile,connection:{}}),{foreground:4,background:1});
 assert.deepEqual(fineTransferPolicy({resourcePolicy:mobile,connection:{saveData:true}}),{foreground:2,background:1});
 assert.deepEqual(fineTransferPolicy({resourcePolicy:desktop,connection:{}}),{foreground:12,background:3});
});

test('mobile output remains bounded for every viewer and quality, while desktop detail is retained',()=>{
 for(const profile of ['interactive','reconstruction'])for(const fine of [false,true])for(const quality of ['auto','high']){
  assert.equal(renderOutputPixelBudget(quality,profile,fine,mobile),1000000);
 }
 assert.equal(renderOutputPixelBudget('low','reconstruction',true,mobile),450000);
 assert.equal(renderOutputPixelBudget('high','reconstruction',true,desktop),8000000);
 assert.equal(renderOutputPixelBudget('auto','reconstruction',false,desktop),4000000);
});
