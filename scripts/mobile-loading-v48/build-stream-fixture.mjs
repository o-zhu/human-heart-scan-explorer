/** Test-only complete compact transport from preserved original Ultra geometry.
 * The production seam-corrected normal files are not in the checkout. This
 * fixture quantizes original source normals and is NEVER a deployment asset.
 * Usage: node this-file.mjs /absolute/temp/output /absolute/meshopt_encoder.js
 */
import assert from 'node:assert/strict';
import {readFile,mkdir,open,writeFile} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGunzip,gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {MeshoptDecoder} from '../../public/vendor/meshopt-decoder-0.23.js';

const [outputArg,encoderPath]=process.argv.slice(2);
if(!outputArg||!encoderPath)throw new Error('Supply temporary output and installed meshoptimizer0.23 encoder paths.');
const output=resolve(outputArg),publicRoot=new URL('../../public/',import.meta.url),original=JSON.parse(await readFile(new URL('assets/fine-surface-v23/manifest.json',publicRoot))).lods[0];
const canonical=JSON.parse(await readFile(new URL('assets/display-compact-v29/mesh-manifest.json',publicRoot))),encoder=createRequire(import.meta.url)(resolve(encoderPath));
await Promise.all([encoder.ready,MeshoptDecoder.ready]);await mkdir(output,{recursive:true});
const originalPath=join(output,'original.hfm'),sourceHash=createHash('sha256');let sourceBytes=0;
await pipeline(Readable.from((async function*(){for(const part of original.parts){const hash=createHash('sha256');let count=0;for await(const chunk of createReadStream(new URL(part.url,publicRoot))){hash.update(chunk);count+=chunk.length;yield chunk;}assert.equal(count,part.compressedBytes);assert.equal(hash.digest('hex'),part.sha256);}})()),createGunzip(),new Transform({transform(bytes,encoding,done){sourceHash.update(bytes);sourceBytes+=bytes.length;done(null,bytes);}}),createWriteStream(originalPath));
assert.equal(sourceBytes,original.decodedBytes);assert.equal(sourceHash.digest('hex'),original.decodedSha256);
const source=await open(originalPath,'r'),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=async(offset,length)=>{const bytes=Buffer.alloc(length);let used=0;while(used<length){const result=await source.read(bytes,used,length-used,offset+used);if(!result.bytesRead)throw new Error('Incomplete fixture source');used+=result.bytesRead;}return bytes;};
const full=createHash('sha256'),positionHash=createHash('sha256'),indexHash=createHash('sha256'),normalHash=createHash('sha256');
const header=await read(0,32);full.update(header);let cursor=32;const parts=[];
try{
 for(const descriptor of canonical.parts){
  const {kind,start,count}=descriptor,unit=kind===3?12:6,base=canonical.header[kind===1?4:kind===2?5:6],offset=base+start*unit;
  if(offset>cursor)full.update(await read(cursor,offset-cursor));
  const input=await read(offset,count*unit);let body,auxiliary=0,bits=0,decoded=input;
  if(kind===1){
   const scalars=count*3;body=Buffer.alloc(count*6);
   for(let i=0;i<scalars;i++){const delta=(input.readUInt16LE(i*2)-(i<3?0:input.readUInt16LE((i-3)*2)))&65535;body[i]=delta&255;body[i+scalars]=delta>>>8;}
   positionHash.update(input);
  }else if(kind===2){
   bits=12;body=Buffer.alloc(count*3);decoded=Buffer.alloc(count*6);
   for(let i=0;i<count;i++){
    let x=input.readInt16LE(i*6),y=input.readInt16LE(i*6+2),z=input.readInt16LE(i*6+4),code;
    const norm=Math.abs(x)+Math.abs(y)+Math.abs(z);
    if(!norm)code=0xffffff;
    else{
     x/=norm;y/=norm;z/=norm;
     if(z<0){const tx=(1-Math.abs(y))*(x<0?-1:1),ty=(1-Math.abs(x))*(y<0?-1:1);x=tx;y=ty;}
     code=(Math.floor(x*2047+.5)+2047)|((Math.floor(y*2047+.5)+2047)<<12);
    }
    body[i]=code&255;body[i+count]=code>>>8&255;body[i+count*2]=code>>>16&255;
    if(code===0xffffff)continue;
    x=((code&4095)-2047)/2047;y=((code>>>12)-2047)/2047;z=1-Math.abs(x)-Math.abs(y);
    if(z<0){const tx=(1-Math.abs(y))*(x<0?-1:1),ty=(1-Math.abs(x))*(y<0?-1:1);x=tx;y=ty;}
    const factor=32767/Math.sqrt(x*x+y*y+z*z);
    decoded.writeInt16LE(Math.floor(x*factor+.5),i*6);decoded.writeInt16LE(Math.floor(y*factor+.5),i*6+2);decoded.writeInt16LE(Math.floor(z*factor+.5),i*6+4);
   }
   normalHash.update(decoded);
  }else{
   const encoded=encoder.encodeIndexBuffer(input,count*3,4),restored=new Uint8Array(input.length);MeshoptDecoder.decodeIndexBuffer(restored,count*3,4,encoded);
   const view=new DataView(restored.buffer),rotations=Buffer.alloc(Math.ceil(count/4));
   for(let i=0;i<count;i++){
    const actual=[view.getUint32(i*12,true),view.getUint32(i*12+4,true),view.getUint32(i*12+8,true)],expected=[input.readUInt32LE(i*12),input.readUInt32LE(i*12+4),input.readUInt32LE(i*12+8)];
    const rotation=[0,1,2].find(rotate=>actual.every((value,index)=>value===expected[(index+rotate)%3]));
    assert.notEqual(rotation,undefined);rotations[i>>>2]|=rotation<<((i&3)*2);
   }
   auxiliary=encoded.length;body=Buffer.concat([encoded,rotations]);indexHash.update(input);
  }
  full.update(decoded);cursor=offset+input.length;
  const blockHeader=Buffer.alloc(24);[0x31434648,kind,start,count,auxiliary,bits].forEach((value,index)=>blockHeader.writeUInt32LE(value,index*4));
  const payload=Buffer.concat([blockHeader,body]),packed=gzipSync(payload,{level:6}),path=descriptor.path;
  await writeFile(join(output,path),packed);parts.push({path,kind,start,count,compressedBytes:packed.length,payloadBytes:payload.length,sha256:hash(packed),payloadSha256:hash(payload)});
 }
 assert.equal(cursor,original.decodedBytes);assert.equal(positionHash.digest('hex'),canonical.positionSha256);assert.equal(indexHash.digest('hex'),canonical.indexSha256);
 const manifest={...canonical,fixtureOnly:true,fixtureScope:'Original Ultra coordinates/topology with oct12 original source normals; not the production seam-corrected shading transport.',decodedSha256:full.digest('hex'),shadingInputSha256:canonical.sourceNormalSha256,decodedNormalSha256:normalHash.digest('hex'),shadingCorrection:'TEST ONLY: original source normals, oct12 encoding',compressedBytes:parts.reduce((sum,part)=>sum+part.compressedBytes,0),parts};
 await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 console.log(JSON.stringify({output,parts:parts.length,compressedBytes:manifest.compressedBytes,decodedBytes:manifest.decodedBytes,decodedSha256:manifest.decodedSha256,fixtureOnly:true}));
}finally{await source.close();}
