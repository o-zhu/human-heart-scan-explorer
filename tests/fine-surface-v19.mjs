/** Asset integrity and actual worker decoding, without browser automation. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {webcrypto,createHash} from 'node:crypto';
import {gunzipSync,gzipSync} from 'node:zlib';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('public/assets/fine-surface-v19/manifest.json',root),'utf8'));
const worker=await readFile(new URL('public/fine-surface-worker.js',root),'utf8');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const asset=lod=>readFile(new URL('public/'+lod.url.replace(/^\.\//,''),root));

async function decode(bytes,metadata={}){
 let result,fetchOptions;
 const context=vm.createContext({self:{postMessage(message){result=message;}},crypto:webcrypto,setTimeout,clearTimeout,DOMException,
  fetch:async(_url,options)=>{fetchOptions=options;return new Response(bytes);},
  Response,Blob,DecompressionStream,AbortController,Uint8Array,Uint32Array,DataView,Error});
 vm.runInContext(worker,context,{filename:'fine-surface-worker.js'});
 // This VM fixture exercises the native-digest transport path. The real ESM
 // worker's bounded digest, priority and cancellation have v47 integration tests.
 await context.self.onmessage({data:{url:'https://example.test/verified-fine-surface.hfm.gz',boundedSurfaceHash:false,...metadata}});
 return {result,fetchOptions};
}

test('both actual HFM1 levels decode and match their measured asset inventory',async()=>{
 assert.equal(manifest.donorId,'ladaf-2021-17');assert.equal(manifest.format,'HFM1');
 assert.equal(manifest.sourceSpacingUm,79.4);assert.equal(manifest.lods.length,2);
 let total=0;
 for(const lod of manifest.lods){
  const packed=await asset(lod);total+=packed.byteLength;
  assert.equal(packed.byteLength,lod.compressedBytes);assert.equal(sha(packed),lod.sha256);
  const raw=gunzipSync(packed);assert.equal(raw.byteLength,lod.decodedBytes);assert.equal(sha(raw),lod.decodedSha256);
  const {result,fetchOptions}=await decode(packed,{sha256:lod.sha256,expectedBytes:lod.decodedBytes});
  assert.equal(result.error,undefined);assert.equal(result.vertexCount,lod.vertices);assert.equal(result.indexCount,lod.triangles*3);
  assert.equal(sha(new Uint8Array(result.buffer)),lod.decodedSha256);assert.equal(fetchOptions.priority,'low');
  const indices=new Uint32Array(result.buffer,result.indexOffset,result.indexCount);
  for(const index of indices)assert.ok(index<result.vertexCount);
 }
 assert.ok(total<25_000_000,'Fine surface package exceeds the reserved hosting budget.');
});

test('worker rejects a corrupted transfer before decoding or installing geometry',async()=>{
 const lod=manifest.lods[0],packed=await asset(lod);packed[Math.floor(packed.length/2)]^=1;
 const {result}=await decode(packed,{sha256:lod.sha256,expectedBytes:lod.decodedBytes});
 assert.match(result.error,/checksum/);assert.equal(result.buffer,undefined);
});

test('worker rejects inconsistent buffer layout and out-of-range triangle indices',async()=>{
 const lod=manifest.lods[0],original=gunzipSync(await asset(lod));
 for(const kind of ['offset','index','version','length']){
  const raw=Buffer.from(original),header=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
  if(kind==='offset')header.setUint32(20,header.getUint32(16,true)+2,true);
  if(kind==='index')header.setUint32(header.getUint32(24,true),header.getUint32(8,true),true);
  if(kind==='version')header.setUint32(4,9,true);
  const packed=gzipSync(raw),{result}=await decode(packed,{sha256:sha(packed),expectedBytes:raw.length+(kind==='length'?1:0)});
  assert.match(result.error,/layout|index|format|length/);assert.equal(result.buffer,undefined);
 }
});
