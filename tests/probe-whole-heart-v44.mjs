/** Actual whole-heart overview assets and bounded, cancellable decoding.
 * Uses only local bytes through the public fetchImpl seam; no network or WebGL.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync,gzipSync} from 'node:zlib';
import {loadWholeHeartOverview} from '../public/probe-overview.js';

const publicRoot=new URL('../public/',import.meta.url);
const manifestUrl=new URL('assets/probe-heart-v44/manifest.json',publicRoot);
const manifest=JSON.parse(await readFile(manifestUrl,'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const urlFor=spec=>new URL(spec.lod.url,publicRoot);
const assets=new Map(await Promise.all(manifest.donors.map(async spec=>[urlFor(spec).href,await readFile(urlFor(spec))])));
const reference=manifest.donors.find(spec=>spec.donorId==='s-20-29');
const originalRaw=gunzipSync(assets.get(urlFor(reference).href));

function localFetch({metadata=manifest,replacement,bodyFactory}={}){
 const requests=[];
 return {requests,fetchImpl:async(url,options={})=>{
  options.signal?.throwIfAborted();
  const href=new URL(url).href;
  requests.push({href,signal:options.signal});
  if(href===manifestUrl.href)return new Response(JSON.stringify(metadata),{headers:{'Content-Type':'application/json'}});
  const spec=metadata.donors.find(item=>urlFor(item).href===href);
  assert.ok(spec,`Unexpected fetch outside the supplied local asset set: ${href}`);
  const bytes=replacement||assets.get(href);
  return new Response(bodyFactory?bodyFactory(bytes,options.signal):bytes);
 }};
}

function editedMetadata(edit){
 const metadata=structuredClone(manifest),spec=metadata.donors.find(item=>item.donorId===reference.donorId);
 edit(spec);
 return {metadata,spec};
}

function changedMesh(edit){
 const raw=Buffer.from(originalRaw);
 const {metadata,spec}=editedMetadata(()=>{});
 const modified=edit(raw,spec)||raw,packed=gzipSync(modified);
 Object.assign(spec.lod,{compressedBytes:packed.length,decodedBytes:modified.length,sha256:sha(packed),decodedSha256:sha(modified)});
 return {metadata,spec,replacement:packed};
}

function countedStream(bytes,{chunkSize=65536}={}){
 const status={cancelled:false,pulls:0};let at=0;
 const stream=new ReadableStream({
  pull(controller){status.pulls++;if(at===bytes.length){controller.close();return;}const end=Math.min(bytes.length,at+chunkSize);controller.enqueue(bytes.subarray(at,end));at=end;},
  cancel(){status.cancelled=true;},
 },{highWaterMark:0});
 return {stream,status};
}

for(const spec of manifest.donors)test(`actual ${spec.donorId} HFM decodes into exact indexed world-mm geometry`,async()=>{
 const packed=assets.get(urlFor(spec).href),raw=gunzipSync(packed),lod=spec.lod;
 assert.equal(packed.length,lod.compressedBytes);assert.equal(sha(packed),lod.sha256);
 assert.equal(raw.length,lod.decodedBytes);assert.equal(sha(raw),lod.decodedSha256);
 const sourceBefore=sha(packed),adapter=localFetch();let yields=0;
 const model=await loadWholeHeartOverview(spec.donorId,spec.referenceMm,{fetchImpl:adapter.fetchImpl,yieldControl:async()=>{yields++;}});
 assert.equal(model.kind,'prepared-whole-heart');assert.equal(model.triangles,lod.triangles);
 assert.equal(model.vertices.length,lod.vertexCount*6);assert.equal(model.indices.length,lod.indexCount);
 assert.ok(model.vertices.byteLength+model.indices.byteLength<12*1024*1024);
 assert.equal(model.source.donorId,spec.donorId);assert.equal(model.decodedSha256,lod.decodedSha256);
 assert.deepEqual(model.bounds.min,spec.bounds.min.map(v=>v*spec.referenceMm));
 assert.deepEqual(model.bounds.max,spec.bounds.max.map(v=>v*spec.referenceMm));
 assert.deepEqual(model.bounds.center,[0,0,0]);assert.ok(yields>0);
 // Decode independently with Buffer's explicit little-endian readers. Exact
 // float32 agreement checks every output vertex, axis, normal and index.
 const nv=raw.readUInt32LE(8),ni=raw.readUInt32LE(12),po=raw.readUInt32LE(16),no=raw.readUInt32LE(20),io=raw.readUInt32LE(24);
 const expected=new Float32Array(nv*6);
 for(let i=0;i<nv;i++)for(let axis=0;axis<3;axis++){
  const coordinate=raw.readUInt16LE(po+(i*3+axis)*2),normal=raw.readInt16LE(no+(i*3+axis)*2);
  expected[i*6+axis]=(spec.bounds.min[axis]+coordinate/65535*(spec.bounds.max[axis]-spec.bounds.min[axis]))*spec.referenceMm;
  expected[i*6+axis+3]=Math.max(-1,normal/32767);
 }
 assert.equal(sha(new Uint8Array(model.vertices.buffer)),sha(new Uint8Array(expected.buffer)));
 assert.equal(sha(new Uint8Array(model.indices.buffer)),sha(raw.subarray(io,io+ni*4)));
 assert.equal(sha(packed),sourceBefore,'Loader must leave compressed source data unchanged.');
 assert.equal(adapter.requests.length,2,'Exactly one manifest and one prepared surface are fetched; no second volume.');
});

test('corrupt compressed bytes are rejected before any geometry conversion',async()=>{
 const replacement=Buffer.from(assets.get(urlFor(reference).href));replacement[replacement.length>>1]^=1;
 const adapter=localFetch({replacement});let yields=0;
 await assert.rejects(loadWholeHeartOverview(reference.donorId,reference.referenceMm,{fetchImpl:adapter.fetchImpl,yieldControl:async()=>{yields++;}}),/transport checksum mismatch/);
 assert.equal(yields,0);
});

test('decoded identity is verified independently of the valid compressed checksum',async()=>{
 const edited=editedMetadata(spec=>{spec.lod.decodedSha256='0'.repeat(64);}),adapter=localFetch(edited);let yields=0;
 await assert.rejects(loadWholeHeartOverview(reference.donorId,reference.referenceMm,{fetchImpl:adapter.fetchImpl,yieldControl:async()=>{yields++;}}),/decoded checksum mismatch/);
 assert.equal(yields,0);
});

test('cancellation before loading makes no asset request',async()=>{
 const controller=new AbortController(),reason=new DOMException('Donor was replaced.','AbortError');controller.abort(reason);
 const adapter=localFetch();
 await assert.rejects(loadWholeHeartOverview(reference.donorId,reference.referenceMm,{fetchImpl:adapter.fetchImpl,signal:controller.signal}),error=>error===reason);
 assert.equal(adapter.requests.length,0);
});

test('cancellation during vertex conversion stops obsolete geometry at the first yield',async()=>{
 const controller=new AbortController(),reason=new DOMException('Donor was replaced.','AbortError'),adapter=localFetch();let yields=0;
 await assert.rejects(loadWholeHeartOverview(reference.donorId,reference.referenceMm,{fetchImpl:adapter.fetchImpl,signal:controller.signal,yieldControl:async()=>{yields++;controller.abort(reason);}}),error=>error===reason);
 assert.equal(yields,1);assert.equal(adapter.requests.length,2);
 assert.ok(adapter.requests.every(request=>request.signal===controller.signal));
});

test('checksum-consistent malformed HFM triangle index is rejected',async()=>{
 const edited=changedMesh(raw=>{const count=raw.readUInt32LE(8),io=raw.readUInt32LE(24);raw.writeUInt32LE(count,io);});
 const adapter=localFetch(edited);
 await assert.rejects(loadWholeHeartOverview(reference.donorId,reference.referenceMm,{fetchImpl:adapter.fetchImpl,yieldControl:async()=>{}}),/invalid index/);
});

for(const [field,value] of [['compressedBytes',8*1024*1024+1],['decodedBytes',48*1024*1024+1]])test(`${field} over budget is rejected before the asset fetch`,async()=>{
 const edited=editedMetadata(spec=>{spec.lod[field]=value;}),adapter=localFetch(edited);
 await assert.rejects(loadWholeHeartOverview(reference.donorId,reference.referenceMm,{fetchImpl:adapter.fetchImpl}),/surface budget/);
 assert.equal(adapter.requests.length,1);
});

test('stream exceeding its declared compressed size is stopped and cancelled',async()=>{
 const edited=editedMetadata(spec=>{spec.lod.compressedBytes=1024;});let tracking;
 const adapter=localFetch({...edited,bodyFactory:bytes=>{tracking=countedStream(bytes);return tracking.stream;}});
 await assert.rejects(loadWholeHeartOverview(reference.donorId,reference.referenceMm,{fetchImpl:adapter.fetchImpl}),/length mismatch/);
 assert.equal(tracking.status.cancelled,true);assert.equal(tracking.status.pulls,1);
});

test('a truncated compressed stream cannot be installed',async()=>{
 const original=assets.get(urlFor(reference).href),adapter=localFetch({replacement:original.subarray(0,original.length-1)});
 await assert.rejects(loadWholeHeartOverview(reference.donorId,reference.referenceMm,{fetchImpl:adapter.fetchImpl}),/incomplete/);
});

test('gzip output exceeding its declared decoded size is rejected within the allocation bound',async()=>{
 const edited=editedMetadata(spec=>{spec.lod.decodedBytes-=1;}),adapter=localFetch(edited);
 await assert.rejects(loadWholeHeartOverview(reference.donorId,reference.referenceMm,{fetchImpl:adapter.fetchImpl}),/length mismatch/);
});

test('empty mesh and inverted bounds are rejected before their payload is requested',async()=>{
 for(const edit of [spec=>{spec.lod.indexCount=0;spec.lod.triangles=0;},spec=>{spec.bounds.min[0]=spec.bounds.max[0];}]){
  const adapter=localFetch(editedMetadata(edit));
  await assert.rejects(loadWholeHeartOverview(reference.donorId,reference.referenceMm,{fetchImpl:adapter.fetchImpl}),/surface budget|bounds are invalid/);
  assert.equal(adapter.requests.length,1);
 }
});
