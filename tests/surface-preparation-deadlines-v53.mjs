import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {inflateCompactBlock} from '../public/compact-surface-codec.js';

const packed=new Uint8Array(gzipSync(Uint8Array.of(1,2,3,4)));
const never=()=>new Promise(()=>{});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const sleep=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};

async function withReader(reader,operation){
 const original=Object.getOwnPropertyDescriptor(globalThis,'Blob');
 class ControlledBlob{stream(){return {pipeThrough:()=>({getReader:()=>reader})};}}
 Object.defineProperty(globalThis,'Blob',{configurable:true,writable:true,value:ControlledBlob});
 try{return await operation();}finally{Object.defineProperty(globalThis,'Blob',original);}
}

test('stalled decompressor output has a preparation deadline and never awaits hanging cancellation',{timeout:2000},async()=>{
 let reads=0,cancelled=0,released=0;const progress=[];
 const reader={read(){return ++reads===1?Promise.resolve({value:Uint8Array.of(1),done:false}):never();},cancel(){cancelled++;return never();},releaseLock(){released++;}};
 await withReader(reader,async()=>{
  await assert.rejects(inflateCompactBlock(packed,4,async()=>{},count=>progress.push(count),{timeoutMs:25}),error=>error.resourceFailure===true&&/decompress a block/.test(error.message));
 });
 assert.deepEqual(progress,[1]);assert.equal(cancelled,1);assert.equal(released,1);
});

test('actual output keeps a slow decompressor alive while empty output does not',{timeout:2000},async()=>{
 let offset=0;
 await withReader({async read(){await sleep(15);return offset<4?{value:Uint8Array.of(++offset),done:false}:{done:true};},cancel:async()=>{},releaseLock(){}},async()=>{
  const start=performance.now(),bytes=await inflateCompactBlock(packed,4,async()=>{},()=>{},{timeoutMs:30});
  assert.deepEqual(bytes,Uint8Array.of(1,2,3,4));assert.ok(performance.now()-start>30);
 });
 let reads=0;
 await withReader({read(){reads++;return Promise.resolve({value:new Uint8Array(),done:false});},cancel:never,releaseLock(){}},async()=>{
  await assert.rejects(inflateCompactBlock(packed,4,async()=>{},()=>assert.fail('Empty output is not progress.'),{timeoutMs:20}),error=>error.resourceFailure===true);
 });
 assert.ok(reads>1,'The idle deadline survives multiple empty reads.');
});

test('workspace pause excludes suspended time from decompression deadline and preserves current output',{timeout:2000},async()=>{
 const first=deferred(),resume=deferred(),entered=deferred();let paused=false,reads=0;
 const reader={read(){reads++;entered.resolve();return reads===1?first.promise:Promise.resolve({done:true});},cancel:never,releaseLock(){}};
 await withReader(reader,async()=>{
  const pending=inflateCompactBlock(packed,4,async()=>{if(paused)await resume.promise;},()=>{},{timeoutMs:20,isPaused:()=>paused});
  await entered.promise;paused=true;await sleep(60);first.resolve({value:Uint8Array.of(1,2,3,4),done:false});await tick();assert.equal(reads,1);
  paused=false;resume.resolve();assert.deepEqual(await pending,Uint8Array.of(1,2,3,4));assert.equal(reads,2);
 });
});

test('explicit cancellation settles pending output even when stream cleanup throws',{timeout:2000},async()=>{
 const entered=deferred(),controller=new AbortController();let cancelled=0,released=0;
 const reader={read(){entered.resolve();return never();},cancel(){cancelled++;throw new Error('Native cancel failed');},releaseLock(){released++;throw new Error('Native release failed');}};
 await withReader(reader,async()=>{
  const pending=inflateCompactBlock(packed,4,async()=>{},()=>{},{signal:controller.signal});await entered.promise;
  const reason=new DOMException('New surface selected','AbortError');controller.abort(reason);
  await assert.rejects(pending,error=>error===reason);
 });
 assert.equal(cancelled,1);assert.equal(released,1);
});

test('real gzip retains exact checks and rejects malformed sizes without relaxing integrity',async()=>{
 assert.deepEqual(await inflateCompactBlock(packed,4),Uint8Array.of(1,2,3,4));
 await assert.rejects(inflateCompactBlock(packed,3),/exceeds its manifest/);
 await assert.rejects(inflateCompactBlock(packed,5),/length did not match/);
});
