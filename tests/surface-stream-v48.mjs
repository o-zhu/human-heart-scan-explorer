/** Real worker transfers and byte identities; no physical-device memory claim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gzipSync,gunzipSync} from 'node:zlib';
import {Worker} from 'node:worker_threads';
import {SurfaceSha256} from '../public/surface-sha256.js';
import {SurfaceStreamVerifier,SURFACE_TRANSFER_BYTES} from '../public/surface-stream.js';
import {decodeCompactBlock,decodeCompactBlockBytes,streamCompactSurface} from '../public/compact-surface-codec.js';
import {MeshoptDecoder} from '../public/vendor/meshopt-decoder-0.23.js';

const native=bytes=>createHash('sha256').update(bytes).digest('hex');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(vertices=9){
 const positionOffset=36,normalOffset=Math.ceil((positionOffset+vertices*6+3)/4)*4,indexOffset=Math.ceil((normalOffset+vertices*6+3)/4)*4;
 const raw=new Uint8Array(indexOffset+vertices*4),header=new DataView(raw.buffer);
 [0x314d4648,1,vertices,vertices,positionOffset,normalOffset,indexOffset,0].forEach((value,index)=>header.setUint32(index*4,value,true));
 for(let i=32;i<raw.length;i++)raw[i]=(i*37+(i>>>7))&255;
 for(let i=0;i<vertices;i++)header.setUint32(indexOffset+i*4,i,true);
 const flags=Uint8Array.from({length:vertices},(_,i)=>Math.floor(i/3)%2?255:0);
 return {raw,flags,layout:{vertexCount:vertices,indexCount:vertices,positionOffset,normalOffset,indexOffset},options:{expectedBytes:raw.length,decodedSha256:native(raw),debrisFlags:flags}};
}

test('incremental SHA keeps exact identities across arbitrary boundaries and detached inputs',()=>{
 for(const length of [0,1,55,56,63,64,65,127,128,129,10000,2*1024*1024+37]){
  const raw=Uint8Array.from({length},(_,i)=>(i*17+(i>>>8))&255),hash=new SurfaceSha256();
  let offset=0,step=1;
  while(offset<raw.length){const chunk=raw.slice(offset,Math.min(offset+step,raw.length));offset+=chunk.length;hash.update(chunk);structuredClone(chunk,{transfer:[chunk.buffer]});assert.equal(chunk.length,0);step=step%127+1;}
  assert.equal(hash.digest(),native(raw));assert.equal(hash.digest(),native(raw));
  assert.throws(()=>hash.update(new Uint8Array()),/already completed/);
  assert.equal(hash.state.byteLength+hash.words.byteLength+hash.tail.byteLength,416);
 }
});

test('bounded surface chunks reproduce exact padded HFM attributes with one awaited transfer',async()=>{
 const {raw,flags,layout,options}=fixture(600003),hashes=Object.fromEntries(['position','normal','index'].map(kind=>[kind,createHash('sha256')]));
 const offsets={position:0,normal:0,index:0};let active=0,maxActive=0,chunks=0,started=false;
 const sink=new SurfaceStreamVerifier({...options,positionSha256:native(raw.subarray(layout.positionOffset,layout.positionOffset+layout.vertexCount*6)),indexSha256:native(raw.subarray(layout.indexOffset)),
  onStart:async found=>{assert.deepEqual(Object.fromEntries(Object.keys(layout).map(key=>[key,found[key]])),layout);started=true;},
  onChunk:async({kind,byteOffset,bytes})=>{
   assert.equal(started,true);assert.equal(byteOffset,offsets[kind]);assert.ok(bytes.length<=SURFACE_TRANSFER_BYTES);
   assert.equal(bytes.length%(kind==='index'?12:6),0);offsets[kind]+=bytes.length;hashes[kind].update(bytes);chunks++;
   active++;maxActive=Math.max(maxActive,active);const received=structuredClone(bytes,{transfer:[bytes.buffer]});assert.equal(bytes.length,0);assert.ok(received.length>0);await tick();active--;
   const returned=structuredClone(received.buffer,{transfer:[received.buffer]});assert.equal(received.byteLength,0);return returned;
  }});
 for(let start=0;start<raw.length;start+=65533)await sink.write(raw.subarray(start,start+65533));
 const result=await sink.finish();assert.equal(result.debrisValidated,true);assert.equal(result.trianglesChecked,layout.indexCount/3);
 assert.equal(result.geometrySourceSha256,options.decodedSha256);assert.equal(maxActive,1);assert.ok(chunks>3);
 assert.equal(hashes.position.digest('hex'),native(raw.subarray(layout.positionOffset,layout.positionOffset+layout.vertexCount*6)));
 assert.equal(hashes.normal.digest('hex'),native(raw.subarray(layout.normalOffset,layout.normalOffset+layout.vertexCount*6)));
 assert.equal(hashes.index.digest('hex'),native(raw.subarray(layout.indexOffset)));
 assert.equal(flags.length,layout.vertexCount);assert.equal(sink.chunk,null);assert.equal(sink.recycled,null);
 await assert.rejects(sink.finish(),/already closed/);
});

test('truncation, overflow, checksum, topology and nonuniform cleanup never complete staged geometry',async()=>{
 const original=fixture();
 for(const variant of ['short','long','checksum','position','index','range','flags']){
  const raw=original.raw.slice(),flags=original.flags.slice(),options={...original.options,debrisFlags:flags};
  if(variant==='checksum')options.decodedSha256='0'.repeat(64);
  if(variant==='position')options.positionSha256='0'.repeat(64);
  if(variant==='index')options.indexSha256='0'.repeat(64);
  if(variant==='range')new DataView(raw.buffer).setUint32(original.layout.indexOffset,original.layout.vertexCount,true);
  if(variant==='flags')flags[0]=255;
  const sink=new SurfaceStreamVerifier(options);
  await assert.rejects(async()=>{await sink.write(variant==='short'?raw.subarray(0,-1):variant==='long'?new Uint8Array(raw.length+1):raw);await sink.finish();});
  assert.equal(sink.completed,false);
 }
 for(const flags of [Uint8Array.of(0),Uint8Array.from(original.flags,()=>12)]){
  const sink=new SurfaceStreamVerifier({...original.options,debrisFlags:flags});await assert.rejects(sink.write(original.raw),/debris filter/);assert.equal(sink.completed,false);
 }
 const sink=new SurfaceStreamVerifier({...original.options,onChunk:async()=>{throw new Error('GPU allocation rejected');}});
 await assert.rejects(sink.write(original.raw),/GPU allocation/);assert.equal(sink.completed,false);assert.equal(sink.chunk,null);
});

test('independent compact position and normal blocks match the old whole-buffer destination at nonzero starts',()=>{
 for(const kind of [1,2]){
  const start=7,count=29,body=new Uint8Array(count*(kind===1?6:3));for(let i=0;i<body.length;i++)body[i]=(i*11)&255;
  const payload=new Uint8Array(24+body.length),header=new DataView(payload.buffer);
  [0x31434648,kind,start,count,0,kind===1?0:12].forEach((value,index)=>header.setUint32(index*4,value,true));payload.set(body,24);
  const descriptor={kind,start,count},layout={vertexCount:100,indexCount:3,positionOffset:32,normalOffset:632,indexOffset:1232};
  const reference=new Uint8Array(1244);decodeCompactBlock(payload,descriptor,reference,layout);
  const result=decodeCompactBlockBytes(payload,descriptor,layout),offset=(kind===1?layout.positionOffset:layout.normalOffset)+start*6;
  assert.deepEqual(result,reference.subarray(offset,offset+count*6));
 }
});

test('independent compact index blocks preserve original triangle corner order and reject bad rotations or ranges',async()=>{
 await MeshoptDecoder.ready;
 // Produced with the existing meshoptimizer0.23 encoder from these explicit
 // indices. Face4 needs a two-corner rotation after meshopt decoding.
 const indices=new Uint32Array([5,2,7,2,1,5,4,5,8,1,2,0,8,3,4,0,6,7,4,8,9]);
 const encoded=Uint8Array.of(225,255,255,255,80,47,255,127,255,10,5,10,243,9,1,95,6,8,9,247,5,12,6,0,118,135,86,103,120,169,134,101,137,104,152,1,105,0,0);
 const payload=new Uint8Array(24+encoded.length+2),header=new DataView(payload.buffer),descriptor={kind:3,start:17,count:7};
 [0x31434648,3,17,7,encoded.length,0].forEach((value,index)=>header.setUint32(index*4,value,true));payload.set(encoded,24);payload[payload.length-1]=2;
 const layout={vertexCount:10,indexCount:72,positionOffset:32,normalOffset:96,indexOffset:160},reference=new Uint8Array(448);
 decodeCompactBlock(payload,descriptor,reference,layout);const output=decodeCompactBlockBytes(payload,descriptor,layout);
 assert.deepEqual(new Uint32Array(output.buffer),indices);assert.deepEqual(output,reference.subarray(364));
 const corrupt=payload.slice();corrupt[corrupt.length-1]=3;
 assert.throws(()=>decodeCompactBlockBytes(corrupt,descriptor,layout),/triangle/);
 assert.throws(()=>decodeCompactBlockBytes(payload,descriptor,{...layout,vertexCount:9}),/triangle/);
 assert.throws(()=>decodeCompactBlockBytes(payload.subarray(0,-1),descriptor,layout),/topology/);
});

test('compact stream rejects reordered blocks and impersonated identities before allocating geometry or downloading',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../public/assets/display-compact-v29/mesh-manifest.json',import.meta.url)));
 let downloads=0,starts=0;
 const options={loadPart:async()=>{downloads++;throw new Error('Unexpected download');},onStart:async()=>{starts++;}};
 const parts=[...manifest.parts];[parts[9],parts[10]]=[parts[10],parts[9]];
 await assert.rejects(streamCompactSurface({...manifest,parts},options),/stream order/);
 for(const key of ['sourceDecodedSha256','positionSha256','indexSha256'])await assert.rejects(streamCompactSurface({...manifest,[key]:'0'.repeat(64)},options),/source geometry/);
 assert.equal(downloads,0);assert.equal(starts,0);
});

const workerURL=new URL('../public/fine-surface-worker.js',import.meta.url);
const harness=`import {parentPort,workerData} from 'node:worker_threads';
import {createReadStream} from 'node:fs';import {Readable} from 'node:stream';import {webcrypto} from 'node:crypto';
Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true});
for(const name of ['ArrayBuffer','Uint8Array','Uint8ClampedArray','Uint16Array','Int16Array','Uint32Array','Int32Array','Float32Array','Float64Array']){const Original=globalThis[name],unit=Original.BYTES_PER_ELEMENT||1;globalThis[name]=new Proxy(Original,{construct(target,args){if(typeof args[0]==='number'&&args[0]*unit>64*1024*1024)throw new RangeError('Test rejected a monolithic allocation');return Reflect.construct(target,args);}});}
globalThis.self={postMessage:(message,transfers)=>parentPort.postMessage({...message,testArrayBufferBytes:process.memoryUsage().arrayBuffers},transfers)};
globalThis.fetch=async(url,{signal})=>{parentPort.postMessage({type:'test-fetch',url});signal?.throwIfAborted();return new Response(Readable.toWeb(createReadStream(new URL(url),{highWaterMark:65536,signal})));};
await import(${JSON.stringify(workerURL.href)});parentPort.on('message',data=>void self.onmessage({data}));parentPort.postMessage({type:'ready'});`;
function workerHarness({retainTransfers=true}={}){
 const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(harness)),{workerData:{}}),messages=[],waiters=[];
 worker.on('message',message=>{messages.push(retainTransfers?message:{...message,buffer:undefined});for(const waiter of [...waiters])if(waiter.predicate(message)){waiters.splice(waiters.indexOf(waiter),1);waiter.resolve(message);}});
 worker.on('error',error=>{for(const waiter of waiters.splice(0))waiter.reject(error);});
 const waitFor=predicate=>{const found=messages.find(predicate);return found?Promise.resolve(found):new Promise((resolve,reject)=>waiters.push({predicate,resolve,reject}));};
 return {worker,messages,waitFor};
}
function recycleChunk(worker,message){
 const buffer=message.buffer;
 worker.postMessage({type:'surface-ack',sequence:message.sequence,buffer},[buffer]);
 assert.equal(buffer.byteLength,0,'The acknowledged input detaches immediately on the receiving thread.');
}
async function workerFixture(){
 const source=fixture(600003),packed=gzipSync(source.raw),directory=await mkdtemp(join(tmpdir(),'heart-stream-v48-'));
 const split=Math.floor(packed.length/2),parts=[];
 for(const [index,bytes]of [packed.subarray(0,split),packed.subarray(split)].entries()){
  const file=join(directory,'part-'+index+'.gz');await writeFile(file,bytes);parts.push({url:pathToFileURL(file).href,compressedBytes:bytes.length,sha256:native(bytes)});
 }
 return {...source,directory,request:{streamSurface:true,debrisFlags:source.flags,parts,compressedBytes:packed.length,sha256:native(packed),expectedBytes:source.raw.length,decodedSha256:native(source.raw),boundedSurfaceHash:true}};
}

test('real worker requires matching acknowledgements, pauses without a second chunk, and returns detached flags only at commit',{timeout:15000},async()=>{
 const source=await workerFixture(),h=workerHarness();
 try{
  await h.waitFor(m=>m.type==='ready');h.worker.postMessage(source.request,[source.flags.buffer]);assert.equal(source.flags.length,0);
  const start=await h.waitFor(m=>m.type==='surface-start');assert.equal(start.sequence,0);
  h.worker.postMessage({type:'surface-ack',sequence:99});await tick();assert.equal(h.messages.some(m=>m.type==='surface-chunk'),false);
  h.worker.postMessage({type:'surface-ack',sequence:0});const first=await h.waitFor(m=>m.type==='surface-chunk');
  h.worker.postMessage({type:'workspace-priority',paused:true});recycleChunk(h.worker,first);await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(h.messages.filter(m=>m.type==='surface-chunk').length,1);assert.equal(h.messages.some(m=>m.type==='surface-complete'),false);
  h.worker.postMessage({type:'workspace-priority',paused:false});
  let sequence=first.sequence+1;
  for(;;){
   const message=await h.waitFor(m=>m.type==='surface-complete'||m.error||m.type==='surface-chunk'&&m.sequence===sequence);
   if(message.error)throw new Error(message.error);if(message.type==='surface-complete'){assert.equal(message.debrisValidated,true);assert.equal(message.debrisFlags.length,source.layout.vertexCount);assert.equal(message.geometrySourceSha256,source.request.decodedSha256);break;}
   assert.ok(message.buffer.byteLength<=SURFACE_TRANSFER_BYTES);assert.equal(message.byteOffset%(message.kind==='index'?12:6),0);recycleChunk(h.worker,message);sequence++;
  }
  assert.equal(h.messages.filter(m=>m.type==='surface-start').length,1);assert.equal(h.messages.filter(m=>m.type==='surface-complete').length,1);
  assert.ok(h.messages.some(m=>m.stage==='verify-final'&&m.final===true));
 }finally{await h.worker.terminate();await rm(source.directory,{recursive:true,force:true});}
});

test('a GPU rejection stops the stream with resource classification and no completion',{timeout:15000},async()=>{
 const source=await workerFixture(),h=workerHarness();
 try{
  await h.waitFor(m=>m.type==='ready');h.worker.postMessage(source.request,[source.flags.buffer]);const start=await h.waitFor(m=>m.type==='surface-start');
  h.worker.postMessage({type:'surface-ack',sequence:start.sequence,error:'The graphics allocation failed.',resourceFailure:true});
  const failed=await h.waitFor(m=>m.error);assert.equal(failed.resourceFailure,true);assert.equal(h.messages.some(m=>m.type==='surface-complete'),false);
 }finally{await h.worker.terminate();await rm(source.directory,{recursive:true,force:true});}
});

test('a returned credit buffer must belong to the exact outstanding transfer',{timeout:15000},async()=>{
 const source=await workerFixture(),h=workerHarness();
 try{
  await h.waitFor(m=>m.type==='ready');h.worker.postMessage(source.request,[source.flags.buffer]);const start=await h.waitFor(m=>m.type==='surface-start');h.worker.postMessage({type:'surface-ack',sequence:start.sequence});
  const chunk=await h.waitFor(m=>m.type==='surface-chunk'),wrong=new ArrayBuffer(12);
  h.worker.postMessage({type:'surface-ack',sequence:chunk.sequence,buffer:wrong},[wrong]);
  const failed=await h.waitFor(m=>m.error);assert.match(failed.error,/returned surface buffer/);assert.equal(h.messages.some(m=>m.type==='surface-complete'),false);
 }finally{await h.worker.terminate();await rm(source.directory,{recursive:true,force:true});}
});

test('cancelling a real worker with a transferred chunk cannot publish a late surface',{timeout:15000},async()=>{
 const source=await workerFixture(),h=workerHarness();
 try{
  await h.waitFor(m=>m.type==='ready');h.worker.postMessage(source.request,[source.flags.buffer]);const start=await h.waitFor(m=>m.type==='surface-start');h.worker.postMessage({type:'surface-ack',sequence:start.sequence});
  await h.waitFor(m=>m.type==='surface-chunk');await h.worker.terminate();assert.equal(h.messages.some(m=>m.type==='surface-complete'),false);
 }finally{await h.worker.terminate();await rm(source.directory,{recursive:true,force:true});}
});

if(process.env.HEART_SURFACE_STREAM_LARGE==='1')test('the actual preserved Ultra transfers all original geometry and cleanup with whole-model allocations forbidden',{timeout:120000},async()=>{
 const publicRoot=new URL('../public/',import.meta.url),manifest=JSON.parse(await readFile(new URL('assets/fine-surface-v23/manifest.json',publicRoot))),lod=manifest.lods[0];
 const debris=JSON.parse(await readFile(new URL('assets/cleanup-v26/debris-manifest.json',publicRoot))).profiles.find(profile=>profile.lodId==='gentle');
 const packedFlags=await readFile(new URL(debris.vertexFlags.url,publicRoot));assert.equal(native(packedFlags),debris.vertexFlags.sha256);
 const flags=new Uint8Array(gunzipSync(packedFlags));assert.equal(native(flags),debris.vertexFlags.decodedSha256);
 const h=workerHarness({retainTransfers:false}),hashes=Object.fromEntries(['position','normal','index'].map(kind=>[kind,createHash('sha256')])),counts={position:0,normal:0,index:0};let peak=0,chunkCount=0;
 try{
  await h.waitFor(m=>m.type==='ready');
  const started=performance.now(),result=await new Promise((resolve,reject)=>{
   h.worker.on('message',message=>{
    peak=Math.max(peak,message.testArrayBufferBytes||0);
    if(message.error){reject(new Error(message.error));return;}
    if(message.type==='surface-start')h.worker.postMessage({type:'surface-ack',sequence:message.sequence});
    else if(message.type==='surface-chunk'){
     try{assert.equal(message.byteOffset,counts[message.kind]);assert.ok(message.buffer.byteLength<=SURFACE_TRANSFER_BYTES);hashes[message.kind].update(new Uint8Array(message.buffer));counts[message.kind]+=message.buffer.byteLength;chunkCount++;recycleChunk(h.worker,message);}catch(error){reject(error);}
    }else if(message.type==='surface-complete')resolve(message);
   });
   h.worker.postMessage({streamSurface:true,debrisFlags:flags,parts:lod.parts.map(part=>({...part,url:new URL(part.url,publicRoot).href})),compressedBytes:lod.compressedBytes,sha256:lod.sha256,expectedBytes:lod.decodedBytes,decodedSha256:lod.decodedSha256,boundedSurfaceHash:true},[flags.buffer]);
  });
  assert.equal(result.geometrySourceSha256,lod.decodedSha256);assert.equal(result.trianglesChecked,23618685);assert.equal(result.debrisValidated,true);
  assert.equal(native(result.debrisFlags),debris.vertexFlags.decodedSha256);assert.equal(counts.position,12837189*6);assert.equal(counts.normal,12837189*6);assert.equal(counts.index,70856055*4);
  const identities=Object.fromEntries(Object.entries(hashes).map(([kind,hash])=>[kind,hash.digest('hex')]));
  assert.equal(identities.position,'9d43742c2a518e7efe05ece46e6740800472ef3d0161d52d80f95b1db448bd5e');assert.equal(identities.index,'871fa8ec2f06c6db6ab1e9064f51f5f0fefb89e969082725e9a19f56307a21e4');
  assert.equal(identities.normal,'78b721a43572a2ff38f163c844d0b7371af1da78d18cc984db3b7a77932c496f');
  const receipt={scope:'Unmodified production worker in Node; original immutable Ultra and exact cleanup. Direct JS ArrayBuffer/numeric typed-array allocations over64MiB forbidden. Not physical iPad/WebGL memory.',decodedBytes:lod.decodedBytes,geometrySourceSha256:result.geometrySourceSha256,trianglesChecked:result.trianglesChecked,counts,identities,chunkCount,maxTransferBytes:result.maxTransferBytes,recycledAcknowledgements:true,maxDirectJSAllocationBytes:64*1024*1024,trackedWorkerArrayBufferPeakBytes:peak,milliseconds:performance.now()-started};
  console.log(JSON.stringify(receipt));if(process.env.HEART_SURFACE_STREAM_EVIDENCE)await writeFile(process.env.HEART_SURFACE_STREAM_EVIDENCE,JSON.stringify(receipt,null,2)+'\n');
 }finally{await h.worker.terminate();}
});

if(process.env.HEART_SURFACE_STREAM_COMPACT)test('a complete32-block compact fixture preserves actual Ultra topology under the bounded worker path',{timeout:120000},async()=>{
 const directory=process.env.HEART_SURFACE_STREAM_COMPACT,compact=JSON.parse(await readFile(join(directory,'manifest.json')));
 assert.equal(compact.fixtureOnly,true,'The test fixture is explicitly distinguished from production shading assets.');
 compact.parts=compact.parts.map(part=>({...part,url:pathToFileURL(join(directory,part.path)).href}));
 const publicRoot=new URL('../public/',import.meta.url),debris=JSON.parse(await readFile(new URL('assets/cleanup-v26/debris-manifest.json',publicRoot))).profiles.find(profile=>profile.lodId==='gentle');
 const flags=new Uint8Array(gunzipSync(await readFile(new URL(debris.vertexFlags.url,publicRoot))));assert.equal(native(flags),debris.vertexFlags.decodedSha256);
 const h=workerHarness({retainTransfers:false}),hashes=Object.fromEntries(['position','normal','index'].map(kind=>[kind,createHash('sha256')])),counts={position:0,normal:0,index:0};
 const completeHash=createHash('sha256'),header=Buffer.alloc(32);compact.header.forEach((value,index)=>header.writeUInt32LE(value,index*4));completeHash.update(header);
 let cursor=32,peak=0,chunkCount=0;
 try{
  await h.waitFor(m=>m.type==='ready');
  const started=performance.now(),result=await new Promise((resolve,reject)=>{
   h.worker.on('message',message=>{
    peak=Math.max(peak,message.testArrayBufferBytes||0);
    if(message.error){reject(new Error(message.error));return;}
    if(message.type==='surface-start')h.worker.postMessage({type:'surface-ack',sequence:message.sequence});
    else if(message.type==='surface-chunk'){
     try{
      assert.equal(message.byteOffset,counts[message.kind]);assert.ok(message.buffer.byteLength<=SURFACE_TRANSFER_BYTES);
      const base=compact.header[message.kind==='position'?4:message.kind==='normal'?5:6],absolute=base+message.byteOffset;
      assert.ok(absolute>=cursor);if(absolute>cursor)completeHash.update(Buffer.alloc(absolute-cursor));
      const bytes=new Uint8Array(message.buffer);completeHash.update(bytes);hashes[message.kind].update(bytes);cursor=absolute+bytes.length;counts[message.kind]+=bytes.length;chunkCount++;
      recycleChunk(h.worker,message);
     }catch(error){reject(error);}
    }else if(message.type==='surface-complete')resolve(message);
   });
   h.worker.postMessage({streamSurface:true,debrisFlags:flags,compact,expectedBytes:compact.decodedBytes,decodedSha256:compact.decodedSha256,boundedSurfaceHash:true},[flags.buffer]);
  });
  assert.equal(result.geometrySourceSha256,compact.sourceDecodedSha256);assert.equal(result.trianglesChecked,23618685);assert.equal(result.debrisValidated,true);assert.equal(cursor,compact.decodedBytes);
  assert.equal(native(result.debrisFlags),debris.vertexFlags.decodedSha256);assert.equal(completeHash.digest('hex'),compact.decodedSha256);
  const identities=Object.fromEntries(Object.entries(hashes).map(([kind,hash])=>[kind,hash.digest('hex')]));
  assert.equal(identities.position,compact.positionSha256);assert.equal(identities.index,compact.indexSha256);assert.equal(identities.normal,compact.decodedNormalSha256);
  assert.equal(result.maxDecodedBlockBytes,25165824);
  const receipt={scope:'Unmodified production compact worker with complete32-block test-only transport: actual Ultra coordinates/topology, oct12 original source normals. Production seam-corrected normal blocks are not locally available. Not physical iPad/WebGL memory.',fixtureOnly:true,decodedBytes:compact.decodedBytes,decodedSha256:compact.decodedSha256,geometrySourceSha256:result.geometrySourceSha256,trianglesChecked:result.trianglesChecked,counts,identities,chunkCount,maxTransferBytes:result.maxTransferBytes,maxDecodedBlockBytes:result.maxDecodedBlockBytes,recycledAcknowledgements:true,maxDirectJSAllocationBytes:64*1024*1024,trackedWorkerArrayBufferPeakBytes:peak,milliseconds:performance.now()-started};
  console.log(JSON.stringify(receipt));if(process.env.HEART_SURFACE_STREAM_COMPACT_EVIDENCE)await writeFile(process.env.HEART_SURFACE_STREAM_COMPACT_EVIDENCE,JSON.stringify(receipt,null,2)+'\n');
 }finally{await h.worker.terminate();}
});
