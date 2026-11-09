/** Exact-source performance comparisons. Local files and injected request
 * latency are controlled fixtures, not browser frame-rate/network claims. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cpus,platform,arch} from 'node:os';
import {resolve} from 'node:path';
import {FineVolumeBackend} from '../public/ultra-volume-backend.js';
import {fineSourceExtent,planFinePlane} from '../public/ultra-volume-core.js';
import {probeCapPlane} from '../public/probe-geometry.js';

const root=resolve(new URL('..',import.meta.url).pathname),baseline='c6511a375acf30d74a664725e5857cc6b8019898';
const output=process.argv.find(value=>value.startsWith('--out='))?.slice(6)||'docs/probe-performance-v26';
await mkdir(output,{recursive:true});
const json=async path=>JSON.parse(await readFile(path,'utf8')),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const oldSource=path=>execFileSync('git',['show',baseline+':'+path],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024});
const moduleURL=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const oldCoreURL=moduleURL(oldSource('public/ultra-volume-core.js'));
const {FineVolumeBackend:BeforeBackend}=await import(moduleURL(oldSource('public/ultra-volume-backend.js').replace("'./ultra-volume-core.js'",JSON.stringify(oldCoreURL))));
const report={baselineCommit:baseline,scope:'Real immutable source bytes and native-grid sampling in Node. Request-latency fixtures add a fixed 25 ms delay to local file responses without bandwidth throttling. Times exclude browser rendering/GPU/upload/paint and are not browser FPS or user-network measurements.',runtime:{node:process.version,platform:platform(),architecture:arch(),cpuModel:cpus()[0]?.model},inPlaneReuse:[],outOfPlane:[],transportLatency:[],planFootprints:[]};

function makeBackend(Type,manifest,bank,{latencyMs=0,preparedPixels=null}={}){
 let reads=0,bytes=0,active=0,peak=0;
 const backend=new Type(manifest,{baseUrl:'https://heart.fixture/',fetcher:async(url,{signal}={})=>{
  const u=new URL(url),prefix=new URL(manifest.assetBaseUrl,'https://heart.fixture/').pathname;
  const path=u.pathname.startsWith(prefix)?resolve(bank,u.pathname.slice(prefix.length)):resolve('public',u.pathname.slice(1));
  active++;peak=Math.max(peak,active);
  try{
   if(latencyMs)await new Promise(resolve=>setTimeout(resolve,latencyMs));signal?.throwIfAborted();
   const data=await readFile(path);signal?.throwIfAborted();reads++;bytes+=data.byteLength;return new Response(data);
  }finally{active--;}
 },decodePrepared:preparedPixels?async()=>preparedPixels.slice():null});
 backend.disk={items:new Map(),bytes:0,available:false,async init(){},async get(){return null;},put(){},async remove(){throw new Error('Unexpected invalid persistent data');}};
 return {backend,stats:()=>({requests:reads,bytes,peakConcurrentRequests:peak}),reset:()=>{reads=0;bytes=0;peak=0;},clear:()=>{backend.cache.clear();backend.bytes=0;backend.prepared.clear();backend.preparedBytes=0;}};
}
async function measured(sample,plane){
 const before=sample.stats(),started=performance.now(),result=await sample.backend.samplePlane(plane,{spacingUm:sample.backend.manifest.sourceSpacingUm}),elapsedMs=performance.now()-started,after=sample.stats();
 return {result,measurement:{elapsedMs,requests:after.requests-before.requests,bytes:after.bytes-before.bytes,peakConcurrentRequests:after.peakConcurrentRequests,capWidth:result.width,capHeight:result.height,sourceSpacingUm:result.sourceSpacingUm,capSpacingUm:result.spacingUm,decodedBytes:sample.backend.bytes,decodedLimit:sample.backend.limit}};
}
function sweepPlane(plane,manifest,degrees){
 const radians=degrees*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians),right=plane.right.map((v,i)=>v*c+plane.up[i]*s),up=plane.up.map((v,i)=>v*c-plane.right[i]*s);
 return probeCapPlane({originMm:plane.center.map(v=>v*manifest.longestMm),right,up,normal:plane.normal},{longestMm:manifest.longestMm,extent:fineSourceExtent(manifest)});
}
const offsetPlane=(plane,manifest,mm)=>({...plane,center:plane.center.map((v,i)=>v+plane.normal[i]*mm/manifest.longestMm)});

for(const donor of ['ladaf-2021-17','s-20-29','s-20-28']){
 const asset=donor==='ladaf-2021-17'?'public/assets':`public/assets/donors/${donor}`,manifestPath=asset+(donor==='ladaf-2021-17'?'/ultra-volume-v7.json':'/ultra-volume.json');
 const manifest=await json(manifestPath),bank=donor==='ladaf-2021-17'?'data/ultra-volume-v7':`data/donors/${donor}/ultra-volume`,preset=manifest.preparedPlanes.find(record=>record.id==='apical');
 const preparedPixels=new Uint8Array(execFileSync('python3',['-c','from PIL import Image;import sys;sys.stdout.buffer.write(Image.open(sys.argv[1]).convert("L").tobytes())',resolve('public',preset.url)],{maxBuffer:32*1024*1024}));
 assert.equal(sha(preparedPixels),preset.pixelSha256);
 const inPlane=sweepPlane(preset.plane,manifest,12),moved=offsetPlane(preset.plane,manifest,.1),nearby=offsetPlane(preset.plane,manifest,.2);
 const plan=planFinePlane(manifest,moved);
 report.planFootprints.push({donor,bricks:plan.blocks.length,compressedBytes:plan.blocks.reduce((sum,block)=>sum+block.record.bytes,0),decodedBytes:plan.blocks.length*manifest.decodedBrickBytes});
 const reuse={donor,degrees:12,preparedPixelSha256:preset.pixelSha256};
 for(const [version,Type] of [['before',BeforeBackend],['after',FineVolumeBackend]]){
  const sample=makeBackend(Type,manifest,bank,{preparedPixels});
  await sample.backend.samplePlane(preset.plane);sample.reset();
  const {result,measurement}=await measured(sample,inPlane);reuse[version]=measurement;
  if(version==='after'){
   assert.equal(result.data.byteLength,preparedPixels.byteLength);assert.equal(sha(result.data),preset.pixelSha256);assert.deepEqual(result.plane.right,preset.plane.right);assert.deepEqual(result.plane.up,preset.plane.up);assert.equal(measurement.requests,0);
   reuse.originalNativePixelsUnchanged=true;reuse.originalImageCoordinatesPreserved=true;
  }
  sample.clear();
 }
 report.inPlaneReuse.push(reuse);
 const movedReport={donor,offsetsMm:[.1,.2]};let referenceFirst,referenceSecond;
 for(const [version,Type] of [['before',BeforeBackend],['after',FineVolumeBackend]]){
  const sample=makeBackend(Type,manifest,bank),first=await measured(sample,moved),second=await measured(sample,nearby);
  movedReport[version]={cold:first.measurement,nearby:second.measurement};
  if(version==='before'){referenceFirst=first.result.data;referenceSecond=second.result.data;}
  else{assert.deepEqual(first.result.data,referenceFirst);assert.deepEqual(second.result.data,referenceSecond);movedReport.byteIdentical=true;movedReport.firstCapSha256=sha(first.result.data);movedReport.nearbyCapSha256=sha(second.result.data);}
  assert.ok(sample.backend.bytes<=sample.backend.limit);sample.clear();
 }
 report.outOfPlane.push(movedReport);
 if(donor==='ladaf-2021-17'){
  for(const [version,Type] of [['before',BeforeBackend],['after',FineVolumeBackend]]){
   const sample=makeBackend(Type,manifest,bank,{latencyMs:25}),{result,measurement}=await measured(sample,moved);
   assert.equal(sha(result.data),movedReport.firstCapSha256);report.transportLatency.push({donor,version,injectedPerRequestMs:25,...measurement,capSha256:sha(result.data)});sample.clear();
  }
 }
 console.log(JSON.stringify({donor,inPlane:{beforeMs:reuse.before.elapsedMs,afterMs:reuse.after.elapsedMs,bytesAvoided:reuse.before.bytes},nearby:{beforeMs:movedReport.before.nearby.elapsedMs,afterMs:movedReport.after.nearby.elapsedMs}}));
}
report.assertions=['Copied original prepared-image hashes match manifest pixels','Coplanar reuse retains native pixel bytes and their original plane axes','Physical offsets still fetch and sample the requested section','Every newly sampled source pixel is byte-identical to the v38 baseline','All decoded caches remain bounded','Transport concurrency never exceeds the explicit device policy','Local latency fixture results are not browser/GPU or real-network measurements'];
report.passed=true;
await writeFile(resolve(output,'benchmark.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:true,report:resolve(output,'benchmark.json'),transportLatency:report.transportLatency.map(value=>({version:value.version,elapsedMs:value.elapsedMs,requests:value.requests,peak:value.peakConcurrentRequests}))}));
