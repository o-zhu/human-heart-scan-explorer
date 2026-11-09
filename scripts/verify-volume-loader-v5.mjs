import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(!isMainThread){
 globalThis.self={DecompressionStream,postMessage:(m,t)=>parentPort.postMessage(m,t)};
 globalThis.fetch=async url=>{
  const target=new URL(url),file=path.resolve(root,'public','.'+target.pathname);
  assert.ok(file.startsWith(path.join(root,'public')+path.sep));
  let bytes=new Uint8Array(fs.readFileSync(file));if(workerData.decodedHTTP)bytes=new Uint8Array(zlib.gunzipSync(bytes));
  let offset=0,first=true;
  return new Response(new ReadableStream({pull(controller){
   if(offset>=bytes.length){controller.close();return;}
   const length=first&&workerData.shortFirstChunk?1:65536;first=false;
   controller.enqueue(bytes.subarray(offset,offset+length));offset+=length;
  }}));
 };
 await import('../public/volume-loader-worker.js');
 await self.onmessage({data:{level:workerData.level,original:workerData.original,gpuCrop:true,acceleration:workerData.acceleration!==false,baseUrl:'https://local-validation/'}});
}else{
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'public/assets/manifest.json'))),results=[];
 for(const test of [{key:'low',shortFirstChunk:true},{key:'high'},{key:'high',acceleration:false},{key:'low',decodedHTTP:true},{key:'low',original:true}]){
  const level=manifest.levels[test.key],worker=new Worker(new URL(import.meta.url),{workerData:{...test,level}});
  const result=await new Promise((resolve,reject)=>{worker.on('error',reject);worker.on('message',m=>{if(m.type==='ready')resolve(m);else if(m.type==='error')reject(new Error(m.message));});});
  await worker.terminate();
  const bytes=new Uint8Array(result.data),parts=test.original?level.originalParts:level.parts;let offset=0;
  for(const part of parts){const chunk=bytes.subarray(offset,offset+part.uncompressedBytes);assert.equal(crypto.createHash('sha256').update(chunk).digest('hex'),part.rawSha256);offset+=part.uncompressedBytes;}
  assert.equal(offset,bytes.length);if(test.acceleration===false)assert.equal(result.acceleration,null);else assert.ok(result.acceleration.maxima instanceof Uint8Array);
  const crop=result.gpuCrop;
  if(test.original)assert.equal(crop,null);else{
   assert.ok(crop);const [nx,ny]=level.dimensions,[cx,cy,cz]=crop.dimensions,[ox,oy,oz]=crop.offset;
   for(let z=0;z<cz;z++)for(let y=0;y<cy;y++){
    const source=ox+nx*(y+oy+ny*(z+oz)),destination=cx*(y+cy*z);
    assert.deepEqual(crop.data.subarray(destination,destination+cx),bytes.subarray(source,source+cx));
   }
   for(let z=0;z<cz;z++)for(let y=0;y<cy;y++)for(const x of [0,cx-1])assert.equal(crop.data[x+cx*(y+cy*z)],0);
   for(let z=0;z<cz;z++)for(const y of [0,cy-1])for(let x=0;x<cx;x++)assert.equal(crop.data[x+cx*(y+cy*z)],0);
   for(const z of [0,cz-1])for(let y=0;y<cy;y++)for(let x=0;x<cx;x++)assert.equal(crop.data[x+cx*(y+cy*z)],0);
  }
  results.push({...test,...result.stats,decodedSHA256Verified:true,gpuCropVerified:!test.original,gpuCropDimensions:crop?.dimensions||null});
 }
 fs.writeFileSync(path.join(root,'docs/volume-loader-validation-v5.json'),JSON.stringify({passed:true,execution:'Actual browser worker module in Node worker threads with bounded local Fetch responses; not a browser interaction test',cases:results},null,2)+'\n');
 console.log(JSON.stringify({passed:true,cases:results}));
}
