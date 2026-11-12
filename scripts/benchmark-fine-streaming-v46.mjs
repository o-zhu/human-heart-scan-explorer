/** Controlled transport benchmark, not a browser/network speed measurement.
 * Usage: node scripts/benchmark-fine-streaming-v46.mjs --baseline-ref COMMIT
 * or --baseline-file /absolute/previous-ultra-volume-backend.js
 */
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {FineVolumeBackend} from '../public/ultra-volume-backend.js';
const args=process.argv.slice(2),arg=name=>args[args.indexOf(name)+1];
let previous=args.includes('--baseline-file')?await readFile(arg('--baseline-file'),'utf8'):execFileSync('git',['show',`${arg('--baseline-ref')}:public/ultra-volume-backend.js`],{encoding:'utf8'});
previous=previous.replace(/from '(\.\/[^']+)'/g,(_,file)=>`from '${new URL('../public/'+file.slice(2),import.meta.url)}'`);
const {FineVolumeBackend:Previous}=await import('data:text/javascript;base64,'+Buffer.from(previous).toString('base64'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const B=32,E=B+1,dimensions=[128,128,128],spacing=79.4;
const manifest={schemaVersion:1,codec:'gzip-u8-zyx-positive-halo',brickSize:B,storedEdge:E,decodedBrickBytes:E**3,assetBaseUrl:'/fine/',sourceSpacingUm:spacing,longestMm:127*spacing/1000,fullDimensionsXYZ:dimensions,sourceShapeXYZ:dimensions,sourceOriginXYZ:[0,0,0],brickCountsXYZ:[4,4,4],blocks:{}};
const payloads=new Map();
for(let id=0;id<64;id++){
 const bx=id%4,by=Math.floor(id/4)%4,bz=Math.floor(id/16);
 const raw=Uint8Array.from({length:E**3},(_,i)=>{const x=i%E+bx*B,y=Math.floor(i/E)%E+by*B,z=Math.floor(i/(E*E))+bz*B;return (x*7+y*3+z*5+Math.round(8*Math.sin(x*.21)*Math.cos(y*.18)))&255;});
 const data=gzipSync(raw),path=`${id}.gz`;manifest.blocks[id]={path,bytes:data.length,sha256:sha(data),rawSha256:sha(raw)};payloads.set(`/fine/${path}`,data);
}
function transport(){
 const stats={requests:0,completed:0,aborted:0,receivedBytes:0,active:0,peak:0};
 return {stats,fetcher:async(url,{signal})=>{
  const bytes=payloads.get(new URL(url).pathname),cut=Math.ceil(bytes.length/2);stats.requests++;stats.active++;stats.peak=Math.max(stats.peak,stats.active);let done=false,first,second;
  return new Response(new ReadableStream({start(controller){
   const finish=aborted=>{if(done)return;done=true;clearTimeout(first);clearTimeout(second);stats.active--;stats[aborted?'aborted':'completed']++;signal.removeEventListener('abort',cancel);};
   const cancel=()=>{if(done)return;finish(true);controller.error(signal.reason||new DOMException('Aborted','AbortError'));};
   first=setTimeout(()=>{if(done)return;controller.enqueue(bytes.subarray(0,cut));stats.receivedBytes+=cut;},25);
   second=setTimeout(()=>{if(done)return;controller.enqueue(bytes.subarray(cut));stats.receivedBytes+=bytes.length-cut;finish(false);controller.close();},110);
   signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
  }}));
 }};
}
function plane(n){return {center:[0,0,.010+n*.001],right:[1,0,0],up:[0,1,0],normal:[0,0,1],width:1,height:1};}
async function run(Backend,retainTransfers){
 const network=transport(),backend=new Backend(manifest,{baseUrl:'https://heart.example/',transferPolicy:{foreground:4,background:1},fetcher:network.fetcher});
 let prior,failures=[];
 for(let n=0;n<8;n++){
  prior?.abort();const controller=new AbortController();prior=controller;
  failures.push(backend.samplePlane(plane(n),{signal:controller.signal,retainTransfers}).catch(error=>{assert.equal(error.name,'AbortError');}));
  await delay(40);
 }
 prior.abort();await Promise.all(failures);const started=performance.now();
 const result=await backend.samplePlane(plane(8),{retainTransfers}),settledMs=performance.now()-started;
 assert.equal(network.stats.active,0);return {result,stats:{...network.stats,settledMs:Number(settledMs.toFixed(1)),decodedBytes:backend.bytes,finalPixels:result.data.length,pixelSha256:sha(result.data)}};
}
const before=await run(Previous,false),after=await run(FineVolumeBackend,true);assert.deepEqual(after.result.data,before.result.data);
console.log(JSON.stringify({method:{moves:8,moveIntervalMs:40,firstChunkMs:25,completeBlockMs:110,concurrency:4,brickSize:32,sourceSpacingUm:79.4,fixture:'synthetic measured scalar volume; delayed two-chunk HTTP body',baselineRef:args.includes('--baseline-ref')?arg('--baseline-ref'):null},before:before.stats,after:after.stats,reduction:{requestsPercent:Number(((1-after.stats.requests/before.stats.requests)*100).toFixed(1)),receivedBytesPercent:Number(((1-after.stats.receivedBytes/before.stats.receivedBytes)*100).toFixed(1)),settledWaitPercent:Number(((1-after.stats.settledMs/before.stats.settledMs)*100).toFixed(1))},pixelsIdentical:true},null,2));
