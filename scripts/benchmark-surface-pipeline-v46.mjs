/** Controlled pipeline experiment, not a browser/network or whole-heart load benchmark.
 * Real SHA-256 and gzip decoding; a stated synthetic transfer delay per block.
 */
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {verifiedSurfaceParts} from '../public/surface-transport-pipeline.js';
import {inflateCompactBlock} from '../public/compact-surface-codec.js';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const raw=new Uint8Array(2*1024*1024);let state=0x19a53647;
for(let i=0;i<raw.length;i++){state^=state<<13;state^=state>>>17;state^=state<<5;raw[i]=state&255;}
const bytes=new Uint8Array(gzipSync(raw)),expected=digest(raw),packedHash=digest(bytes);
const parts=Array.from({length:8},(_,id)=>({id,compressedBytes:bytes.length,payloadBytes:raw.length,sha256:packedHash}));
const results={serial:[],lookahead:[]};
for(let repetition=0;repetition<3;repetition++)for(const lookahead of [false,true]){
 const start=performance.now();let decoded=0;
 for await(const block of verifiedSurfaceParts(parts,{lookahead,hash:digest,loadPart:async(_part,progress)=>{
  await sleep(18);progress(bytes.length);return bytes.slice();
 }})){
  const output=await inflateCompactBlock(block.packed,block.part.payloadBytes);if(digest(output)!==expected)throw new Error('Decoded identity changed.');decoded++;
 }
 if(decoded!==parts.length)throw new Error('The complete sequence was not consumed.');
 results[lookahead?'lookahead':'serial'].push(Number((performance.now()-start).toFixed(3)));
}
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
console.log(JSON.stringify({scope:'controlled synthetic transport; real 2 MiB gzip and SHA-256; not browser/GPU or whole-heart loading',blocks:parts.length,decodedBytesPerBlock:raw.length,packedBytesPerBlock:bytes.length,simulatedTransferDelayMs:18,rounds:3,milliseconds:results,medianMilliseconds:{serial:median(results.serial),lookahead:median(results.lookahead)},decodedIdentity:expected},null,2));
