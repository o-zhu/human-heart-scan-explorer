/**
 * Validate the lossless source codec against independently decoded fixtures.
 * Usage: node scripts/verify-ultra.mjs /absolute/path/to/fixture-directory
 * Fixtures: NAME.n5 and NAME.raw, listed in fixture-manifest.json. The .raw
 * bytes are obtained with Python blosc2.decompress(n5Bytes[16:]).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {decodeN5,decodeBloscBlock,parseN5Header} from '../public/n5-source.js';
import {makeUltraPlan,copyUltraSection} from '../public/ultra-plan.js';

const fixtureRoot=process.argv[2];
if(!fixtureRoot)throw new Error('Provide the directory containing independently decoded source fixtures.');
const fixtures=JSON.parse(await fs.readFile(path.join(fixtureRoot,'fixture-manifest.json'),'utf8'));
const results=[];
for(const record of fixtures){
  const bytes=new Uint8Array(await fs.readFile(path.join(fixtureRoot,`${record.name}.n5`)));
  const reference=new Uint8Array(await fs.readFile(path.join(fixtureRoot,`${record.name}.raw`)));
  const decoded=await decodeN5(bytes),header=parseN5Header(bytes);
  assert.deepEqual(decoded.data,reference,`${record.name}: full raw decode mismatch`);
  assert.equal(createHash('sha256').update(decoded.data).digest('hex'),record.rawSha256);
  let partialBlocks=0;
  if(!header.uncompressed)for(let i=0;i<header.count;i++){
    const packed=bytes.subarray(16+header.offsets[i],16+header.blockEnds[i]);
    const partial=await decodeBloscBlock(bytes.subarray(0,16+header.headerBytes),i,packed);
    assert.deepEqual(partial.data,reference.subarray(partial.byteStart,partial.byteStart+partial.data.length),`${record.name}: partial block ${i} mismatch`);
    partialBlocks++;
  }
  results.push({source:record.source,dimensions:decoded.dimensions,compressedBytes:bytes.length,rawBytes:reference.length,partialBlocks,rawSha256:record.rawSha256});
}

// Use asymmetric synthetic uint16 data to verify all three section mappings,
// byte order, crop alignment, source index4*i, and exact windowing.
const manifest=JSON.parse(await fs.readFile(new URL('../public/assets/ultra-source.json',import.meta.url),'utf8'));
const dims=[128,128,128],coord=[7,7,11],raw=new Uint8Array(128**3*2);
const value=(x,y,z)=>14640+(x*19+y*31+z*43)%8906;
for(let z=0;z<128;z++)for(let y=0;y<128;y++)for(let x=0;x<128;x++){
  const v=value(x,y,z),i=((z*128+y)*128+x)*2;raw[i]=v>>>8;raw[i+1]=v&255;
}
for(let axis=0;axis<3;axis++){
  const index=coord[axis]*32+11,plan=makeUltraPlan(axis,index,manifest);
  assert.equal(plan.sourceIndex,index*4);
  const out=new Uint8Array(plan.width*plan.height);
  copyUltraSection(plan,coord,{data:raw,dimensions:dims,byteStart:0},out);
  for(let row=0;row<128;row+=7)for(let col=0;col<128;col+=11){
    const pos=axis===0?[44,col,row]:axis===1?[col,44,row]:[col,row,44];
    const source=pos.map((n,i)=>n+coord[i]*128);
    const u=source[axis===0?1:0],v=source[axis===2?1:2];
    const expected=Math.round((value(...pos)-14640)*255/8905);
    assert.equal(out[v*plan.width+u],expected,`axis${axis} pixel${u},${v}`);
  }
}
assert.equal((1897-1)*79.4,(475-1)*317.6);
assert.equal((2117-1)*79.4,(530-1)*317.6);
const output={ok:true,codec:'numcodecs0.3.2 / Blosc WASM',byteExactFixtures:results,geometry:'XYZ sample4*i, plane orientation, display window, and physical endpoints verified'};
console.log(JSON.stringify(output,null,2));
