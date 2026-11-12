/** Bounded scalar acceleration must retain every source identity and fallback. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {SurfaceSha256,initializeSurfaceHash,sha256Surface,SURFACE_HASH_WORKING_BYTES,SURFACE_HASH_ACCELERATOR_BYTES} from '../public/surface-sha256.js';

const native=bytes=>createHash('sha256').update(bytes).digest('hex');
const fresh=name=>import(new URL('../public/surface-sha256.js?'+name,import.meta.url));
const beforeInitialization=new SurfaceSha256();
assert.equal(await initializeSurfaceHash(),true);

function pattern(length,offset=0){
 const storage=new Uint8Array(length+offset+5),bytes=storage.subarray(offset,offset+length);
 let seed=53;for(let i=0;i<bytes.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;bytes[i]=seed>>>24;}
 return bytes;
}
function incremental(Hash,bytes,sizes=[193,1,63,65537,64,3,64512]){
 const hash=new Hash();let offset=0,index=0;
 while(offset<bytes.length){const end=Math.min(bytes.length,offset+sizes[index++%sizes.length]);hash.update(bytes.subarray(offset,end));offset=end;}
 const actual=hash.digest();assert.equal(hash.digest(),actual);assert.throws(()=>hash.update(new Uint8Array()),/already completed/);return actual;
}

test('accelerated hashes retain standard vectors, padding boundaries and offset byte views',async()=>{
 const fallback=await fresh('uninitialized-fallback');
 for(const input of ['', 'abc','abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq','a'.repeat(1_000_000)]){
  const bytes=new TextEncoder().encode(input),expected=native(bytes);
  assert.equal(incremental(SurfaceSha256,bytes),expected);assert.equal(incremental(fallback.SurfaceSha256,bytes),expected);
 }
 for(const length of [...Array.from({length:130},(_,i)=>i),64511,64512,64513,65535,65536,65537,2*1024*1024-8,2*1024*1024+71]){
  const bytes=pattern(length,7),expected=native(bytes),copy=bytes.slice();
  assert.equal(incremental(SurfaceSha256,bytes),expected,'length '+length);
  assert.equal(incremental(fallback.SurfaceSha256,bytes),expected,'JS length '+length);
  assert.deepEqual(bytes,copy);
 }
 beforeInitialization.update(new TextEncoder().encode('abc'));assert.equal(beforeInitialization.digest(),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('interleaved hashes own their states and input ownership may transfer immediately',()=>{
 const inputs=[pattern(470111,3),pattern(260003,5),pattern(190009,7)],hashes=inputs.map(()=>new SurfaceSha256()),expected=inputs.map(native);
 for(let offset=0;offset<470111;offset+=65521)for(let i=0;i<inputs.length;i++)if(offset<inputs[i].length)hashes[i].update(inputs[i].subarray(offset,offset+65521));
 inputs.forEach(input=>structuredClone(input.buffer,{transfer:[input.buffer]}));
 hashes.forEach((hash,index)=>assert.equal(hash.digest(),expected[index]));
 assert.equal(SURFACE_HASH_WORKING_BYTES,416);assert.equal(SURFACE_HASH_ACCELERATOR_BYTES,65536);
});

test('the embedded module has no imports, one fixed memory page and bounded input',async()=>{
 const source=await readFile(new URL('../public/surface-sha256.js',import.meta.url),'utf8');
 const region=source.match(/const surfaceHashWasmBase64=([\s\S]*?);/)[1];
 const binary=Buffer.from([...region.matchAll(/'([^']+)'/g)].map(match=>match[1]).join(''),'base64');
 const module=new WebAssembly.Module(binary),instance=new WebAssembly.Instance(module);
 assert.deepEqual(WebAssembly.Module.imports(module),[]);
 assert.equal(instance.exports.memory.buffer.byteLength,65536);
 assert.throws(()=>instance.exports.memory.grow(1),RangeError);
 assert.equal(instance.exports.memory.buffer.byteLength,65536);
 for(const count of [1,63,64513,65536,-64])assert.throws(()=>instance.exports.compress(count),WebAssembly.RuntimeError);
});

test('unsupported engines, CSP rejection and a failed module self-check preserve JS hashing',async()=>{
 const original=globalThis.WebAssembly,bytes=pattern(120011,5),expected=native(bytes);
 const scenarios=[
  ['unsupported',undefined],
  ['csp',{instantiate:()=>Promise.reject(new original.CompileError('CSP disallowed Wasm compilation'))}],
  ['self-check',{instantiate:async()=>({instance:{exports:{memory:new original.Memory({initial:1,maximum:1}),compress:()=>{}}}})}],
 ];
 try{
  for(const [name,engine]of scenarios){
   globalThis.WebAssembly=engine;const module=await fresh(name);
   assert.equal(await module.initializeSurfaceHash(),false);assert.equal(incremental(module.SurfaceSha256,bytes),expected);
   assert.equal(await module.sha256Surface(bytes),expected);
  }
 }finally{globalThis.WebAssembly=original;}
});

test('a compiler that never settles has a finite setup deadline and ignores a late result',async()=>{
 const original=globalThis.WebAssembly;let finish,binary;
 try{
  globalThis.WebAssembly={instantiate:input=>{binary=input;return new Promise(resolve=>{finish=resolve;});}};
  const module=await fresh('compilation-timeout');
  assert.equal(await module.initializeSurfaceHash({timeoutMs:5}),false);
  finish(await original.instantiate(binary));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(await module.initializeSurfaceHash(),false);
  const bytes=pattern(129997);assert.equal(incremental(module.SurfaceSha256,bytes),native(bytes));
 }finally{globalThis.WebAssembly=original;}
});

test('a mid-update accelerator failure replays the whole uncommitted span in JS',async()=>{
 const original=globalThis.WebAssembly;let calls=0;
 try{
  globalThis.WebAssembly={instantiate:async binary=>{
   const {instance}=await original.instantiate(binary);
   return {instance:{exports:{memory:instance.exports.memory,compress:count=>{
    if(++calls===3)throw new original.RuntimeError('Controlled compressor failure');
    return instance.exports.compress(count);
   }}}};
  }};
  const module=await fresh('runtime-fallback');assert.equal(await module.initializeSurfaceHash(),true);
  const first=new module.SurfaceSha256(),second=new module.SurfaceSha256(),bytes=pattern(64512*3+17,9);
  first.update(bytes.subarray(0,5));first.update(bytes.subarray(5));
  assert.equal(first.digest(),native(bytes));assert.equal(await module.initializeSurfaceHash(),false);
  second.update(bytes);assert.equal(second.digest(),native(bytes));
 }finally{globalThis.WebAssembly=original;}
});

test('the asynchronous helper preserves progress, workspace pauses and cancellation',async()=>{
 const input=pattern(2*1024*1024+3),progress=[];let resume,reached;
 const gate=new Promise(resolve=>{resume=resolve;}),paused=new Promise(resolve=>{reached=resolve;});
 const pending=sha256Surface(input,{chunkBytes:65536,waitForWorkspace:()=>progress.length===1?(reached(),gate):Promise.resolve(),onProgress:count=>progress.push(count)});
 await paused;assert.deepEqual(progress,[65536]);resume();assert.equal(await pending,native(input));assert.equal(progress.at(-1),input.length);
 const cancel=new AbortController();
 await assert.rejects(sha256Surface(input,{signal:cancel.signal,onProgress:()=>cancel.abort()}),{name:'AbortError'});
});

test('a streamed input crossing the 32-bit bit-length boundary keeps the exact digest',()=>{
 const input=pattern(1024*1024),expected=createHash('sha256'),actual=new SurfaceSha256();
 for(let i=0;i<512;i++){actual.update(input);expected.update(input);}
 actual.update(input.subarray(0,71));expected.update(input.subarray(0,71));
 assert.equal(actual.digest(),expected.digest('hex'));
});
