import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {verifiedSurfaceParts} from '../public/surface-transport-pipeline.js';
import {inflateCompactBlock} from '../public/compact-surface-codec.js';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const raw=Array.from({length:4},(_,i)=>Uint8Array.from({length:96*1024+i*43},(_,j)=>(j*29+(j>>>7)+i*71)&255));
const packed=raw.map(bytes=>new Uint8Array(gzipSync(bytes)));
const parts=packed.map((bytes,i)=>({id:i,compressedBytes:bytes.length,sha256:digest(bytes),payloadBytes:raw[i].length}));

test('lookahead overlaps the next download with current decoding, retaining at most one future block',async()=>{
 const starts=[],progress=[];
 const stream=verifiedSurfaceParts(parts,{lookahead:true,hash:digest,onProgress:p=>progress.push(p),loadPart:async(part,report)=>{
  starts.push(part.id);report(Math.floor(part.compressedBytes/2));await tick();report(part.compressedBytes);return packed[part.id];
 }});
 const first=await stream.next();await tick();
 assert.deepEqual(starts,[0,1],'The next transport is already under way before the consumer decodes its current block.');
 await tick();assert.deepEqual(starts,[0,1],'A stalled decoder cannot cause unbounded prefetch.');
 assert.equal(digest(await inflateCompactBlock(first.value.packed,parts[0].payloadBytes)),digest(raw[0]));
 for(let index=1;index<parts.length;index++){
  const {value,done}=await stream.next();assert.equal(done,false);assert.equal(value.part.id,index);
  assert.equal(digest(await inflateCompactBlock(value.packed,value.part.payloadBytes)),digest(raw[index]));
 }
 assert.equal((await stream.next()).done,true);
 assert.equal(progress.at(-1).loadedBytes,parts.reduce((n,p)=>n+p.compressedBytes,0));
 assert.equal(progress.at(-1).verifiedParts,parts.length);
 assert.ok(progress.every((p,i)=>p.loadedBytes>=(progress[i-1]?.loadedBytes||0)&&p.loadedBytes<=p.totalBytes));
});

test('the conservative path starts no future transfer while the current block is consumed',async()=>{
 const starts=[];
 const stream=verifiedSurfaceParts(parts,{lookahead:false,hash:digest,loadPart:async p=>{starts.push(p.id);return packed[p.id];}});
 const first=await stream.next();await tick();assert.deepEqual(starts,[0]);
 assert.equal(digest(first.value.packed),parts[0].sha256);
 await stream.next();await tick();assert.deepEqual(starts,[0,1]);
 await stream.return();await tick();assert.deepEqual(starts,[0,1]);
});

test('lab priority prevents a queued lookahead transfer from starting until resumed',async()=>{
 let paused=false,resume;
 const gate=new Promise(resolve=>{resume=resolve;}),starts=[];
 const stream=verifiedSurfaceParts(parts,{lookahead:true,hash:digest,waitForWorkspace:async()=>{if(paused)await gate;},loadPart:async p=>{
  starts.push(p.id);if(p.id===0)paused=true;return packed[p.id];
 }});
 await stream.next();await tick();assert.deepEqual(starts,[0]);
 paused=false;resume();await tick();assert.deepEqual(starts,[0,1]);
 await stream.return();await tick();assert.deepEqual(starts,[0,1]);
});

test('corrupt lookahead never reaches the decoder and its early failure is handled',async()=>{
 const starts=[];
 const stream=verifiedSurfaceParts(parts,{lookahead:true,hash:digest,loadPart:async p=>{
  starts.push(p.id);const bytes=packed[p.id].slice();if(p.id===1)bytes[0]^=1;return bytes;
 }});
 const first=await stream.next();assert.equal(first.value.part.id,0);await tick();
 await assert.rejects(stream.next(),/checksum did not match/);
 assert.deepEqual(starts,[0,1]);
 assert.equal((await stream.next()).done,true);
});

test('returning a paused pipeline prevents its abandoned lookahead from starting after resume',async()=>{
 let paused=false,resume;
 const gate=new Promise(resolve=>{resume=resolve;}),starts=[];
 const stream=verifiedSurfaceParts(parts,{lookahead:true,hash:digest,waitForWorkspace:async()=>{if(paused)await gate;},loadPart:async p=>{
  starts.push(p.id);if(p.id===0)paused=true;return packed[p.id];
 }});
 await stream.next();await tick();assert.deepEqual(starts,[0]);
 await stream.return();paused=false;resume();await tick();
 assert.deepEqual(starts,[0],'Closing during the priority gate cancels the pending future request.');
 assert.equal((await stream.next()).done,true);
});

test('restarted downloads cannot regress progress or count transfer bytes twice',async()=>{
 const progress=[];
 for await(const _block of verifiedSurfaceParts(parts,{lookahead:true,hash:digest,onProgress:p=>progress.push(p),loadPart:async(p,report)=>{
  report(Math.floor(p.compressedBytes*.7));report(Math.floor(p.compressedBytes*.2));report(p.compressedBytes);return packed[p.id];
 }})){}
 assert.ok(progress.every((p,i)=>p.loadedBytes>=(progress[i-1]?.loadedBytes||0)&&p.loadedBytes<=p.totalBytes));
 assert.equal(progress.at(-1).loadedBytes,progress.at(-1).totalBytes);
});

test('truncated block rejection does not begin another speculative transfer',async()=>{
 const starts=[];
 const stream=verifiedSurfaceParts(parts,{lookahead:true,hash:digest,loadPart:async p=>{starts.push(p.id);return packed[p.id].subarray(1);}});
 await assert.rejects(stream.next(),/download length did not match/);
 assert.deepEqual(starts,[0]);
});
