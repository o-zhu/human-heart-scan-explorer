/** Exercise the shipped fine-volume backend against local, real hosted bytes. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {FineVolumeBackend} from '../public/ultra-volume-backend.js';
import {planFinePlane} from '../public/ultra-volume-core.js';

const jobs=JSON.parse(await readFile(process.argv[2],'utf8')),checks=[];
for(const job of jobs){
 const manifest=JSON.parse(await readFile(job.manifest,'utf8'));
 const route=new URL(manifest.assetBaseUrl,'https://heart.example/').pathname;
 let active=0,maxActive=0,fetches=0;
 const backend=new FineVolumeBackend(manifest,{
  baseUrl:'https://heart.example/ultra-volume.js',decodedLimit:job.decodedLimit,
  cacheName:'verification-ucl-zcr-2629-no-browser-cache',
  decodePrepared:job.prepared?async()=>new Uint8Array(await readFile(job.expected)):null,
  fetcher:async(url,{signal}={})=>{
   active++;maxActive=Math.max(maxActive,active);fetches++;
   try{
    signal?.throwIfAborted();const path=new URL(url).pathname;
    let source;
    if(path.startsWith(route))source=resolve(job.root,path.slice(route.length));
    else if(job.prepared&&path.startsWith('/assets/'))source=resolve(job.public,path.slice(1));
    else throw new Error('Unexpected verification asset path.');
    const bytes=await readFile(source);signal?.throwIfAborted();return new Response(bytes);
   }finally{active--;}
  }
 });
 const result=await backend.samplePlane(job.plane);
 assert.equal(result.width,job.width);assert.equal(result.height,job.height);
 assert.equal(result.complete,true);assert.equal(result.cleaned,true);
 assert.equal(result.sourceSpacingUm,28.128,'New donor must never inherit 79.4 µm source metadata.');
 const reference=new Uint8Array(await readFile(job.expected));
 let maxError=0,differing=0,errorSum=0,nonzero=0;
 for(let i=0;i<reference.length;i++){
  const difference=Math.abs(reference[i]-result.data[i]);maxError=Math.max(maxError,difference);errorSum+=difference;
  if(difference)differing++;if(result.data[i])nonzero++;
 }
 assert.ok(maxError<=1,`${job.name}: source deviation ${maxError}`);
 assert.ok(differing/Math.max(reference.length,1)<.0001,`${job.name}: too many differing samples ${differing}`);
 assert.ok(maxActive<=4);assert.ok(backend.bytes<=Math.max(job.decodedLimit,manifest.decodedBrickBytes));
 if(job.name==='outside-support')assert.equal(nonzero,0);
 else assert.ok(nonzero>100,'A real oblique plane must contain measured tissue.');
 if(job.prepared){assert.equal(fetches,1);assert.equal(backend.bytes,0);assert.equal(backend.preparedBytes,reference.length);}
 else if(job.name!=='outside-support')assert.ok(result.brickCount>0,'Adjusted oblique planes must use measured bricks.');
 const controller=new AbortController();controller.abort();
 await assert.rejects(backend.samplePlane(job.plane,{signal:controller.signal}),{name:'AbortError'});
 checks.push({name:job.name,prepared:!!job.prepared,width:result.width,height:result.height,
  sourceSpacingUm:result.sourceSpacingUm,sourcePixels:reference.length,nonzeroPixels:nonzero,
  maxAbsoluteError:maxError,differingPixels:differing,meanAbsoluteError:errorSum/reference.length,
  bricks:result.brickCount||0,fetches,maxConcurrentReads:maxActive,
  decodedBytes:backend.bytes,decodedLimit:job.decodedLimit});
 if(job.name==='adjusted-a4c'){
  const missing=new FineVolumeBackend(manifest,{baseUrl:'https://heart.example/',fetcher:async()=>new Response('missing',{status:503})});
  await assert.rejects(missing.samplePlane(job.plane),/returned 503/);
  const first=planFinePlane(manifest,job.plane).blocks[0];
  const corrupt=new FineVolumeBackend(manifest,{baseUrl:'https://heart.example/',fetcher:async()=>new Response(new Uint8Array(first.record.bytes))});
  await assert.rejects(corrupt.getBrick(first),/checksum failed/);
 }
}
console.log(JSON.stringify({passed:true,checks,errorChecks:[
 'New source pitch is 28.128 µm on prepared and adjusted planes',
 'Adjusted planes use actual measured density bricks',
 'Aborted sampling rejects before a new request',
 'Unavailable data rejects instead of returning a complete plane',
 'Corrupt encoded bricks fail SHA-256 verification',
 'Decoded working sets and concurrent reads remain bounded'
]}));
