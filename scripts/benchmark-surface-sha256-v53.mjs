/** Reproducible Node timing, exact native identities; never a device benchmark. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {createGunzip} from 'node:zlib';
import {dirname} from 'node:path';
import assert from 'node:assert/strict';
import * as accelerated from '../public/surface-sha256.js';
import * as fallback from '../public/surface-sha256.js?javascript-benchmark';

assert.equal(await accelerated.initializeSurfaceHash(),true,'This benchmark requires the optional Wasm backend.');
const scope='Node scalar SHA-256 CPU timing with fixed bounded input storage; not browser, GPU, Safari or iPad loading time.';
const constructors={javascript:fallback.SurfaceSha256,wasm:accelerated.SurfaceSha256};
const source=new Uint8Array(2*1024*1024-8);for(let i=0;i<source.length;i++)source[i]=(i*73+(i>>>8))&255;
const syntheticBytes=96*1024*1024+71,native=createHash('sha256');
for(let offset=0;offset<syntheticBytes;offset+=source.length)native.update(source.subarray(0,Math.min(source.length,syntheticBytes-offset)));
const expected=native.digest('hex');
function sample(Hash){
 const hash=new Hash(),start=performance.now();
 for(let offset=0;offset<syntheticBytes;offset+=source.length)hash.update(source.subarray(0,Math.min(source.length,syntheticBytes-offset)));
 const actual=hash.digest(),milliseconds=performance.now()-start;assert.equal(actual,expected);
 return {milliseconds,MiBPerSecond:syntheticBytes/1048576/(milliseconds/1000)};
}
sample(constructors.javascript);sample(constructors.wasm);
const samples={javascript:[],wasm:[]};
for(let round=0;round<3;round++)for(const [name,Hash]of Object.entries(constructors))samples[name].push(sample(Hash));
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const javascriptMs=median(samples.javascript.map(item=>item.milliseconds)),wasmMs=median(samples.wasm.map(item=>item.milliseconds));
const receipt={scope,node:process.version,architecture:process.arch,
 synthetic:{bytes:syntheticBytes,inputChunkBytes:source.length,sha256:expected,samples,medianMilliseconds:{javascript:javascriptMs,wasm:wasmMs},speedup:javascriptMs/wasmMs},
 memory:{perHashJavascriptBytes:accelerated.SURFACE_HASH_WORKING_BYTES,sharedWasmBytes:accelerated.SURFACE_HASH_ACCELERATOR_BYTES,maximumWasmInputCopyBytes:64512}};

if(process.argv.includes('--geometry')){
 const root=new URL('../public/',import.meta.url);
 const manifest=JSON.parse(await readFile(new URL('assets/fine-surface-v23/manifest.json',root))),lod=manifest.lods.find(item=>item.id==='gentle');
 const compact=JSON.parse(await readFile(new URL('assets/display-compact-v29/surface-manifest.json',root))).lods.find(item=>item.id==='gentle').compactTransport;
 const expectedHashes={complete:lod.decodedSha256,position:compact.positionSha256,index:compact.indexSha256};
 const nativeHashes=Object.fromEntries(Object.keys(expectedHashes).map(key=>[key,createHash('sha256')]));
 const hashes=Object.fromEntries(Object.entries(constructors).map(([name,Hash])=>[name,Object.fromEntries(Object.keys(expectedHashes).map(key=>[key,new Hash()]))]));
 const timings={javascript:0,wasm:0},counts={complete:0,position:0,index:0};let offset=0,ranges,maxSourceChunkBytes=0;
 const packed=Readable.from((async function*(){for(const part of lod.parts)yield*createReadStream(new URL(part.url,root),{highWaterMark:256*1024});})());
 for await(const chunk of packed.pipe(createGunzip({chunkSize:256*1024}))){
  maxSourceChunkBytes=Math.max(maxSourceChunkBytes,chunk.length);
  if(!ranges){
   assert.ok(chunk.length>=32);const h=new DataView(chunk.buffer,chunk.byteOffset,chunk.byteLength),nv=h.getUint32(8,true),ni=h.getUint32(12,true);
   ranges={complete:[0,lod.decodedBytes],position:[h.getUint32(16,true),h.getUint32(16,true)+nv*6],index:[h.getUint32(24,true),h.getUint32(24,true)+ni*4]};
  }
  for(const [kind,[start,end]]of Object.entries(ranges)){
   const lo=Math.max(offset,start)-offset,hi=Math.min(offset+chunk.length,end)-offset;if(hi<=lo)continue;
   const bytes=chunk.subarray(lo,hi);nativeHashes[kind].update(bytes);counts[kind]+=bytes.length;
   for(const [name,group]of Object.entries(hashes)){const start=performance.now();group[kind].update(bytes);timings[name]+=performance.now()-start;}
  }
  offset+=chunk.length;
 }
 assert.equal(offset,lod.decodedBytes);
 for(const [kind,expected]of Object.entries(expectedHashes)){
  assert.equal(nativeHashes[kind].digest('hex'),expected,kind+' native');
  for(const [name,group]of Object.entries(hashes)){const start=performance.now();const actual=group[kind].digest();timings[name]+=performance.now()-start;assert.equal(actual,expected,kind+' '+name);}
 }
 receipt.originalGeometry={decodedBytes:lod.decodedBytes,hashedBytes:Object.values(counts).reduce((a,b)=>a+b,0),counts,identities:expectedHashes,maxSourceChunkBytes,
  hashCpuMilliseconds:timings,speedup:timings.javascript/timings.wasm,wholeDecodedBufferAllocated:false};
}
receipt.createdAt=new Date().toISOString();
const outputIndex=process.argv.indexOf('--output');if(outputIndex>=0){const path=process.argv[outputIndex+1];await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(receipt,null,2)+'\n');}
console.log(JSON.stringify(receipt,null,2));
