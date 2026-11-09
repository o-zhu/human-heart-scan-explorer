/** Native CPU extraction from the actual production volume-loader output. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {ResidentSectionSource} from '../public/resident-sections.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(!isMainThread){
 globalThis.self={DecompressionStream,postMessage:(message,transfers)=>parentPort.postMessage(message,transfers)};
 globalThis.fetch=async url=>{
  const file=path.resolve(root,'public','.'+new URL(url).pathname);
  assert(file.startsWith(path.join(root,'public')+path.sep));
  const bytes=new Uint8Array(fs.readFileSync(file));let offset=0;
  return new Response(new ReadableStream({pull(controller){
   if(offset===bytes.length){controller.close();return;}
   const end=Math.min(offset+65536,bytes.length);controller.enqueue(bytes.subarray(offset,end));offset=end;
  }}));
 };
 await import('../public/volume-loader-worker.js');
 await self.onmessage({data:{level:workerData.level,original:false,gpuCrop:false,acceleration:false,baseUrl:'https://local-validation/'}});
}else{
 const results=[];
 for(const [donor,manifestPath]of [
  ['ladaf-2021-17','assets/manifest.json'],
  ['s-20-29','assets/donors/s-20-29/manifest.json'],
  ['s-20-28','assets/donors/s-20-28/manifest.json']
 ])for(const levelName of ['low','high']){
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'public',manifestPath))),level=manifest.levels[levelName];
  for(const part of level.parts)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'public',part.url))).digest('hex'),part.sha256);
  const worker=new Worker(new URL(import.meta.url),{workerData:{level}});
  const loaded=await new Promise((resolve,reject)=>{worker.on('error',reject);worker.on('message',message=>{if(message.type==='ready')resolve(message);else if(message.type==='error')reject(new Error(message.message));});});
  await worker.terminate();const data=new Uint8Array(loaded.data);let offset=0;
  for(const part of level.parts){assert.equal(crypto.createHash('sha256').update(data.subarray(offset,offset+part.uncompressedBytes)).digest('hex'),part.rawSha256);offset+=part.uncompressedBytes;}
  assert.equal(offset,data.length);
  const source=new ResidentSectionSource();source.setVolume(data,level);
  const donorResults=[];
  for(let axis=0;axis<3;axis++){
   const count=level.dimensions[axis],samples=[];let last;
   // Long jumps and reversals defeat the tiny cache; half the requests sit
   // between source planes, as they do while the initial coarse volume is used.
   const positions=Array.from({length:68},(_,step)=>{
    const reverse=step>=34,index=(reverse?67-step:step)*17%(count-2)+1;
    return (index+(step%2?.41:0))/(count-1);
   });
   for(let step=0;step<positions.length;step++){
    const started=performance.now();last=source.get(axis,positions[step],Math.round(positions[step]*474));const elapsed=performance.now()-started;
    if(step>=20)samples.push(elapsed);
   }
   const sorted=[...samples].sort((a,b)=>a-b);
   donorResults.push({axis:['x','y','z'][axis],dimensions:[last.width,last.height],pixels:last.data.length,
    medianMilliseconds:sorted[Math.floor(sorted.length/2)],p95Milliseconds:sorted[Math.floor(sorted.length*.95)],maximumMilliseconds:sorted.at(-1),samplesMilliseconds:samples,
    retainedEntries:source.cache.size,retainedBytes:source.cacheBytes});
  }
  source.dispose();results.push({donor,level:levelName,sourceDimensions:level.dimensions,encodedAndDecodedSourceHashesVerified:true,results:donorResults});
 }
 const report={date:'2026-11-05',scope:'Warmed Node CPU resident-section extraction, including new output arrays and bounded cache bookkeeping, over real source-verified production-loader volumes. Requests jump and reverse; half are fractional along the section normal. Excludes source loading, color conversion, browser Canvas, GPU and end-to-end input latency.',node:process.version,results};
 const destination=path.join(root,'docs/resident-sections-v16');fs.mkdirSync(destination,{recursive:true});fs.writeFileSync(path.join(destination,'benchmark.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(results.map(item=>({donor:item.donor,level:item.level,axes:item.results.map(result=>({axis:result.axis,medianMs:+result.medianMilliseconds.toFixed(3),p95Ms:+result.p95Milliseconds.toFixed(3),maxMs:+result.maximumMilliseconds.toFixed(3),retainedBytes:result.retainedBytes}))})),null,2));
}
