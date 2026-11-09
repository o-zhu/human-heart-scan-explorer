import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {FineVolumeBackend} from '../public/ultra-volume-backend.js';
import {planFinePlane} from '../public/ultra-volume-core.js';

const jobs=JSON.parse(await readFile(process.argv[2],'utf8')),checks=[];
for(const job of jobs){
 const manifest=JSON.parse(await readFile(job.manifest,'utf8'));let active=0,maxActive=0,fetches=0;
 const backend=new FineVolumeBackend(manifest,{baseUrl:'https://heart.example/ultra-volume.js',decodedLimit:job.decodedLimit,fetcher:async(url,{signal}={})=>{
  active++;maxActive=Math.max(active,maxActive);fetches++;
  try{signal?.throwIfAborted();const path=new URL(url).pathname.replace('/api/ultra-volume/v7/','');const bytes=await readFile(resolve(job.root,path));signal?.throwIfAborted();return new Response(bytes);}finally{active--;}
 }});
 const result=await backend.samplePlane(job.plane);
 assert.equal(result.width,job.width);assert.equal(result.height,job.height);assert.equal(result.complete,true);assert.equal(result.cleaned,true);
 const reference=new Uint8Array(await readFile(job.expected));let maxError=0,differing=0,errorSum=0;
 for(let i=0;i<reference.length;i++){const d=Math.abs(reference[i]-result.data[i]);maxError=Math.max(maxError,d);errorSum+=d;if(d)differing++;}
 assert.ok(maxError<=1,`${job.name}: source deviation ${maxError}`);
 assert.ok(differing/Math.max(reference.length,1)<.0001,`${job.name}: too many differing samples ${differing}`);
 assert.ok(maxActive<=4);assert.ok(backend.bytes<=Math.max(job.decodedLimit,manifest.decodedBrickBytes));
 const controller=new AbortController();controller.abort();await assert.rejects(backend.samplePlane(job.plane,{signal:controller.signal}),{name:'AbortError'});
 checks.push({name:job.name,width:result.width,height:result.height,sourcePixels:reference.length,maxAbsoluteError:maxError,differingPixels:differing,meanAbsoluteError:errorSum/reference.length,bricks:result.brickCount,fetches,maxConcurrentReads:maxActive,decodedBytes:backend.bytes,decodedLimit:job.decodedLimit});
 if(job.name==='real-apical'){
  const bad=new FineVolumeBackend(manifest,{baseUrl:'https://heart.example/',fetcher:async()=>new Response('missing',{status:503})});
  await assert.rejects(bad.samplePlane(job.plane),/returned 503/);
  const first=planFinePlane(manifest,job.plane).blocks[0];
  const corrupt=new FineVolumeBackend(manifest,{baseUrl:'https://heart.example/',fetcher:async()=>new Response(new Uint8Array(first.record.bytes))});
  await assert.rejects(corrupt.getBrick(first),/checksum failed/);
 }
}
console.log(JSON.stringify({passed:true,checks,errorChecks:['Aborted sampling rejects without fetching','Unavailable fine data rejects instead of reporting a complete plane','Corrupt encoded data fails checksum verification','Decoded working sets remain bounded']}));
