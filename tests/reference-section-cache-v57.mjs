/** Exact source-bound R8 reference sections, including stale/network failures. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {ReferenceSectionCache,REFERENCE_SECTION_KIND} from '../public/reference-section-cache.js';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const source={donorId:'test-donor',datasetId:'42',sourceKey:'1'.repeat(64),sourceMaskSha256:'2'.repeat(64),sourceSpacingUm:1000,longestMm:8};
const basePlane={center:[0,0,0],right:[1,0,0],up:[0,1,0],normal:[0,0,1],width:.5,height:.5};
const raw=Uint8Array.from({length:25},(_,i)=>(i*11+128)%256);
const manifestUrl='https://heart.test/reference/donor.json';
const deltaRows=(pixels,width)=>Uint8Array.from(pixels,(value,i)=>(value-(i%width?pixels[i-1]:0))&255);

function fixture({count=1,codec='gzip-r8',pixels:input=raw,cacheOptions={},changeManifest,fetchAsset,fetchManifest}={}){
 const assets=new Map();
 const views=Array.from({length:count},(_,i)=>{
  const plane={...structuredClone(basePlane),center:[i*.01,0,0]};
  const pixels=Uint8Array.from(input,value=>(value+i)%256),stored=codec==='gzip-r8-delta-v1'?deltaRows(pixels,5):pixels;
  const encoded=new Uint8Array(gzipSync(stored));
  const url=`https://heart.test/reference/section-${i}.r8.gz`;assets.set(url,{encoded,pixels});
  const record={codec,url,bytes:encoded.length,sha256:sha(encoded),pixelSha256:sha(pixels),
   decodedBytes:pixels.length,width:5,height:5,spacingUmXY:[1000,1000],sourceSpacingUm:1000,cleaned:true,plane};
  return {viewId:`view-${i}`,mode:i%2?'tee':'tte',outsideScan:false,ct:record,face:structuredClone(record)};
 });
 views.push({viewId:'outside',mode:'tee',outsideScan:true,ct:null,face:null});
 const manifest={schemaVersion:1,kind:REFERENCE_SECTION_KIND,source:structuredClone(source),views};
 changeManifest?.(manifest,assets);
 const calls=[];
 const cache=new ReferenceSectionCache({manifestUrl,expectedSource:source,fetcher:async(url,options)=>{
  calls.push({url,options});
  if(url===manifestUrl)return fetchManifest?fetchManifest(manifest,calls):Response.json(manifest);
  const asset=assets.get(url);return fetchAsset?fetchAsset(url,options,asset,calls):new Response(asset?.encoded,{status:asset?200:404});
 },...cacheOptions});
 const request=(i=0,extra={})=>({viewId:`view-${i}`,role:'ct',plane:structuredClone(views[i].ct.plane),
  sourceKey:source.sourceKey,cleanupEnabled:true,modified:false,planeReference:'refined',...extra});
 return {cache,manifest,assets,calls,request,assetCalls:()=>calls.filter(call=>call.url!==manifestUrl)};
}

test('lossless raw R8 preserves every measured byte and its exact physical raster',async()=>{
 const f=fixture();
 try{
  const request=f.request(),result=await f.cache.load(request);
  assert.deepEqual(result.data,raw);assert.deepEqual(result.plane,basePlane);
  assert.notEqual(result.plane,request.plane);assert.notEqual(result.plane.center,request.plane.center);
  assert.deepEqual(result.spacingUmXY,[1000,1000]);
  assert.equal(result.sourceSpacingUm,source.sourceSpacingUm);assert.equal(result.sourceKey,source.sourceKey);
  assert.equal(result.complete,true);assert.equal(result.cleaned,true);assert.equal(result.preparedReference,true);
  assert.equal(result.width*result.height,result.data.length);
  const face=await f.cache.load(f.request(0,{role:'face'}));
  assert.equal(face.data,result.data,'Identical CT/full-face payloads share one bounded decoded entry.');
  assert.equal(f.assetCalls().length,1);assert.equal(f.cache.getStatus().decodedBytes,25);
 }finally{f.cache.destroy();}
});

test('row-delta gzip reconstructs exact multirow pixels with wraparound and row resets',async()=>{
 const pixels=Uint8Array.of(0,255,0,128,127,255,0,255,0,1,1,1,1,1,1,200,199,198,0,255,37,0,255,254,0);
 const f=fixture({codec:'gzip-r8-delta-v1',pixels});
 try{
  await f.cache.init();
  assert.equal(f.cache.match(f.request()).codec,'gzip-r8-delta-v1');
  const result=await f.cache.load(f.request());
  assert.deepEqual(result.data,pixels);assert.equal(sha(result.data),result.pixelSha256);
  assert.deepEqual(result.plane,basePlane);assert.deepEqual(result.spacingUmXY,[1000,1000]);
  assert.equal(result.width,5);assert.equal(result.height,5);
  const face=await f.cache.load(f.request(0,{role:'face'}));
  assert.equal(face.data,result.data);assert.equal(f.assetCalls().length,1);
  assert.equal(f.cache.getStatus().decodedBytes,pixels.length);
 }finally{f.cache.destroy();}
});

test('corrupt row-delta bytes fail the reconstructed pixel checksum even with a valid transport checksum',async()=>{
 const f=fixture({codec:'gzip-r8-delta-v1',changeManifest:(manifest,assets)=>{
  const record=manifest.views[0].ct,delta=deltaRows(raw,record.width);delta[record.width+2]^=1;
  const encoded=new Uint8Array(gzipSync(delta));
  record.bytes=encoded.length;record.sha256=sha(encoded);assets.set(record.url,{encoded});
 }});
 try{
  await assert.rejects(f.cache.load(f.request()),/Decoded reference section checksum failed/);
  assert.equal(f.cache.getStatus().decodedBytes,0);assert.equal(f.cache.getStatus().cachedSections,0);
 }finally{f.cache.destroy();}
});

test('unknown, moved, reversed, modified, wrong-donor and uncleaned requests do not fetch an asset',async()=>{
 const f=fixture();
 try{
  await f.cache.init();
  const requests=[
   {viewId:'missing'},{viewId:'outside',mode:'tee'},{sourceKey:'3'.repeat(64)},
   {cleanupEnabled:false},{cleanupEnabled:undefined},{modified:true},{modified:undefined},
   {planeReference:'canonical'},{donorId:'different-donor'},{mode:'tee'},{role:'unknown'},
   {plane:{...basePlane,center:[.000001,0,0]}},
   {plane:{...basePlane,right:[-1,0,0]}},
   {plane:{...basePlane,width:basePlane.width+5e-8}},
   {plane:{...basePlane,up:[0,0,1]}}
  ];
  for(const difference of requests){
   assert.equal(f.cache.match(f.request(0,difference)),null,JSON.stringify(difference));
   assert.equal(await f.cache.load(f.request(0,difference)),null,JSON.stringify(difference));
  }
  assert.equal(f.assetCalls().length,0);
  const retainedHalf=await f.cache.load(f.request(0,{plane:{...basePlane,normal:[0,0,-1]}}));
  assert.deepEqual(retainedHalf.data,raw,'Retained-half direction does not change measured pixel positions.');
  assert.deepEqual(retainedHalf.plane.normal,[0,0,-1]);
 }finally{f.cache.destroy();}
});

test('manifest validation binds donor, source, cleanup, physical dimensions and outside-scan coverage',async()=>{
 const mutations=[
  m=>m.source.sourceKey='4'.repeat(64),m=>m.source.sourceMaskSha256='5'.repeat(64),
  m=>m.source.donorId='another',m=>m.source.datasetId='43',
  m=>m.source.sourceSpacingUm=500,m=>m.source.longestMm=7,
  m=>m.views[0].ct.width=6,m=>m.views[0].ct.spacingUmXY=[999,1000],
  m=>m.views[0].ct.cleaned=false,m=>m.views[0].ct.codec='image/png',
  m=>m.views[0].ct.decodedBytes=12*1024*1024+1,
  m=>m.views[0].ct.url='javascript:alert(1)',
  m=>m.views[0].ct.plane.right=[2,0,0],
  m=>m.views[1].ct=structuredClone(m.views[0].ct),
  m=>m.views.push(structuredClone(m.views[0])),
  m=>m.views=Array.from({length:57},()=>structuredClone(m.views[0]))
 ];
 for(const changeManifest of mutations){
  const f=fixture({changeManifest});
  try{
   await assert.rejects(f.cache.init(),{name:'ReferenceSectionIntegrityError'});
   assert.equal(f.cache.getStatus().manifestReady,false);assert.equal(f.assetCalls().length,0);
  }finally{f.cache.destroy();}
 }
});

test('manifest pins and bounded metadata reject changed or excessive responses and allow a later retry',async()=>{
 let fail=true;
 const f=fixture({fetchManifest:manifest=>fail?new Response('x'.repeat(512*1024+1)):Response.json(manifest)});
 try{
  await assert.rejects(f.cache.init(),{name:'ReferenceSectionIntegrityError'});
  fail=false;await f.cache.init();assert.equal(f.cache.getStatus().manifestReady,true);
 }finally{f.cache.destroy();}
 const mismatch=fixture({cacheOptions:{manifestSha256:'f'.repeat(64)}});
 try{await assert.rejects(mismatch.cache.init(),/manifest checksum failed/);}finally{mismatch.cache.destroy();}
 const pinned=fixture();pinned.cache.manifestSha256=sha(new TextEncoder().encode(JSON.stringify(pinned.manifest)));
 try{await pinned.cache.init();assert.equal(pinned.cache.getStatus().manifestReady,true);}finally{pinned.cache.destroy();}
});

test('encoded digest, decoded digest, truncation and gzip expansion cannot publish corrupt R8 data',async()=>{
 const failures=[
  {fetchAsset:(_url,_options,asset)=>new Response(Uint8Array.from(asset.encoded,(n,i)=>i===15?n^1:n))},
  {changeManifest:m=>m.views[0].ct.pixelSha256='f'.repeat(64)},
  {fetchAsset:(_url,_options,asset)=>new Response(asset.encoded.subarray(0,-1))},
  {fetchAsset:(_url,_options,asset)=>new Response(new Uint8Array(asset.encoded.length+1))},
  {fetchAsset:(_url,_options,asset)=>new Response(asset.pixels)},
  {changeManifest:(m,assets)=>{
   const r=m.views[0].ct,encoded=new Uint8Array(gzipSync(new Uint8Array(250000)));
   r.bytes=encoded.length;r.sha256=sha(encoded);assets.set(r.url,{encoded});
  }}
 ];
 for(const options of failures){
  const f=fixture(options);
  try{
   await assert.rejects(f.cache.load(f.request()),{name:'ReferenceSectionIntegrityError'});
   assert.equal(f.cache.getStatus().decodedBytes,0);assert.equal(f.cache.getStatus().cachedSections,0);
  }finally{f.cache.destroy();}
 }
});

test('a missing optional asset fails without poisoning a subsequent exact request',async()=>{
 let fail=true;
 const f=fixture({fetchAsset:(_url,_options,asset)=>new Response(fail?null:asset.encoded,{status:fail?404:200})});
 try{
  await assert.rejects(f.cache.load(f.request()),/returned 404/);
  await tick();fail=false;
  assert.deepEqual((await f.cache.load(f.request())).data,raw);assert.equal(f.assetCalls().length,2);
 }finally{f.cache.destroy();}
});

test('one canceled subscriber cannot cancel another subscriber to the same physical payload',async()=>{
 const pending=deferred();let transport;
 const f=fixture({fetchAsset:(_url,options)=>{transport=options.signal;return pending.promise;}});
 try{
  await f.cache.init();const a=new AbortController();
  const first=f.cache.load(f.request(),{signal:a.signal});
  const firstRejected=assert.rejects(first,{name:'AbortError'});
  const second=f.cache.load(f.request(0,{role:'face'}));await tick();
  assert.equal(f.assetCalls().length,1);a.abort();await firstRejected;
  assert.equal(transport.aborted,false);
  pending.resolve(new Response(f.assets.values().next().value.encoded));
  assert.deepEqual((await second).data,raw);assert.equal(f.cache.getStatus().decodedBytes,25);
 }finally{f.cache.destroy();}
});

test('last subscriber cancellation aborts transport and a late response cannot enter the decoded cache',async()=>{
 const pending=deferred();let transport,delayed=true;
 const f=fixture({fetchAsset:(_url,options,asset)=>{transport=options.signal;return delayed?pending.promise:new Response(asset.encoded);}});
 try{
  await f.cache.init();const controller=new AbortController();
  const first=f.cache.load(f.request(),{signal:controller.signal});
  const rejected=assert.rejects(first,{name:'AbortError'});await tick();controller.abort();await rejected;
  assert.equal(transport.aborted,true);pending.resolve(new Response(f.assets.values().next().value.encoded));await tick();
  assert.equal(f.cache.getStatus().decodedBytes,0);delayed=false;
  assert.deepEqual((await f.cache.load(f.request())).data,raw);
 }finally{f.cache.destroy();}
});

test('pause invalidates ready-cache requests before their asynchronous continuation and permits resume',async()=>{
 const f=fixture();
 try{
  await f.cache.load(f.request());
  const pending=f.cache.load(f.request()),rejected=assert.rejects(pending,{name:'AbortError'});
  f.cache.pause();await rejected;
  assert.deepEqual((await f.cache.load(f.request())).data,raw);assert.equal(f.assetCalls().length,1);
  f.cache.clear();assert.equal(f.cache.getStatus().decodedBytes,0);
  f.cache.destroy();await assert.rejects(f.cache.load(f.request()),{name:'AbortError'});
 }finally{f.cache.destroy();}
});

test('paused metadata initialization can restart immediately and old metadata cannot commit',async()=>{
 const old=deferred();let call=0;
 const f=fixture({fetchManifest:manifest=>++call===1?old.promise:Response.json(manifest)});
 try{
  const initial=f.cache.init(),rejected=assert.rejects(initial,{name:'AbortError'});
  f.cache.pause();await f.cache.init();await rejected;
  old.resolve(Response.json({...f.manifest,source:{...source,sourceKey:'f'.repeat(64)}}));await tick();
  assert.equal(f.cache.getStatus().manifestReady,true);assert.equal(f.cache.source.sourceKey,source.sourceKey);
 }finally{f.cache.destroy();}
});

test('one aborted metadata subscriber leaves a shared initialization useful to other callers',async()=>{
 const pending=deferred(),f=fixture({fetchManifest:()=>pending.promise}),controller=new AbortController();
 try{
  const first=f.cache.init({signal:controller.signal}),rejected=assert.rejects(first,{name:'AbortError'});
  const second=f.cache.init();controller.abort();await rejected;
  pending.resolve(Response.json(f.manifest));assert.equal((await second).sourceKey,source.sourceKey);
  assert.equal(f.calls.length,1);
 }finally{f.cache.destroy();}
});

test('metadata and pixel deadlines settle stalled promises and permit a later retry',async()=>{
 let fail=true;
 const manifest=fixture({cacheOptions:{timeoutMs:15},fetchManifest:m=>fail?new Promise(()=>{}):Response.json(m)});
 try{
  await assert.rejects(manifest.cache.init(),{name:'TimeoutError'});fail=false;manifest.cache.timeoutMs=2000;
  await manifest.cache.init();assert.equal(manifest.cache.getStatus().manifestReady,true);
 }finally{manifest.cache.destroy();}
 fail=true;
 const pixel=fixture({cacheOptions:{timeoutMs:15},fetchAsset:(_url,_options,asset)=>fail?new Promise(()=>{}):new Response(asset.encoded)});
 try{
  await assert.rejects(pixel.cache.load(pixel.request()),{name:'TimeoutError'});await tick();fail=false;pixel.cache.timeoutMs=2000;
  assert.deepEqual((await pixel.cache.load(pixel.request())).data,raw);
 }finally{pixel.cache.destroy();}
});

test('the decoded LRU remains within its byte budget and preserves recently used sections',async()=>{
 const f=fixture({count:3,cacheOptions:{maxBytes:50}});
 try{
  await f.cache.load(f.request(0));await f.cache.load(f.request(1));await f.cache.load(f.request(0));
  await f.cache.load(f.request(2));await tick();
  assert.equal(f.cache.getStatus().decodedBytes,50);assert.equal(f.cache.getStatus().cachedSections,2);
  await f.cache.load(f.request(0));assert.equal(f.assetCalls().length,3);
  await f.cache.load(f.request(1));assert.equal(f.assetCalls().length,4);
  assert.equal(f.cache.getStatus().decodedBytes,50);
 }finally{f.cache.destroy();}
 const bounded=fixture({cacheOptions:{maxBytes:1024*1024*1024}});
 assert.equal(bounded.cache.getStatus().decodedLimit,32*1024*1024);bounded.cache.destroy();
});

test('bounded transfer queue gives the newest foreground view priority without speculative fan-out',async()=>{
 const pending=new Map();
 const f=fixture({count:9,cacheOptions:{maxConcurrent:1},fetchAsset:(url)=>{
  const promise=deferred();pending.set(url,promise);return promise.promise;
 }});
 const results=[];
 try{
  await f.cache.init();
  for(let i=0;i<8;i++)results.push(f.cache.load(f.request(i),{priority:1}).catch(error=>error));
  await tick();assert.equal(f.cache.getStatus().activeTransfers,1);assert.equal(f.cache.getStatus().queuedTransfers,4);
  results.push(f.cache.load(f.request(8),{priority:0}).catch(error=>error));await tick();
  assert.equal(f.cache.getStatus().queuedTransfers,4);assert.equal(f.assetCalls().length,1);
  const firstUrl=f.assetCalls()[0].url;pending.get(firstUrl).resolve(new Response(f.assets.get(firstUrl).encoded));
  await results[0];await tick();assert.equal(f.assetCalls()[1].url,f.manifest.views[8].ct.url);
  f.cache.destroy();await Promise.all(results);
 }finally{f.cache.destroy();}
});
