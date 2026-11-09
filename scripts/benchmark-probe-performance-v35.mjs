/** Actual production computation with immutable donor pixels. These are Node
 * CPU/local-source measurements, not Safari, GPU, paint or network timings. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {cpus,platform,arch} from 'node:os';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {computeProbeFrame,probeFrameQuality} from '../public/probe-acoustics.js';
import {probePose,probeCapPlane,volumeGeometry,rescaleProbeState,sanitizeProbeState,initializeProbeEntry} from '../public/probe-geometry.js';
import {FineVolumeBackend} from '../public/ultra-volume-backend.js';

const root=resolve(new URL('..',import.meta.url).pathname),baseline='c3c55fe3b1320ab02a5e8edec5b87fcfd5cf5de0';
const output=process.argv.find(arg=>arg.startsWith('--out='))?.slice(6)||'docs/probe-performance-v35';
await mkdir(output,{recursive:true});
const json=async path=>JSON.parse(await readFile(path,'utf8')),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
let oldSource=execFileSync('git',['show',baseline+':public/probe-acoustics.js'],{cwd:root,encoding:'utf8',maxBuffer:1024*1024});
for(const name of ['probe-geometry','ultra-volume-core'])oldSource=oldSource.replace(`'./${name}.js'`,JSON.stringify(pathToFileURL(resolve(root,`public/${name}.js`)).href));
const {computeProbeFrame:beforeFrame,probeFrameQuality:beforeQuality}=await import('data:text/javascript;base64,'+Buffer.from(oldSource).toString('base64'));
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const report={baselineCommit:baseline,scope:'Production acoustic/cap computation on all three real donor datasets, plus native versus screen-sized real LADAF fine-source reformats. Timings exclude browser paint, GPU upload/draw and actual network latency. Input uses a 384 px maximum live output and no fine downloads; the quiet pose refines after 190 ms. No browser FPS claim.',runtime:{node:process.version,platform:platform(),architecture:arch(),cpuModel:cpus()[0]?.model},frames:[],sourceExtraction:null};

async function residentVolume(meta){
 const data=new Uint8Array(meta.dimensions.reduce((a,b)=>a*b,1)),[nx,ny]=meta.dimensions;let offset=0;
 for(const part of meta.parts){
  const encoded=await readFile(resolve('public',part.url));assert.equal(sha(encoded),part.sha256);
  const bytes=new Uint8Array(gunzipSync(encoded));
  if(part.predictor==='delta-z')for(let i=nx*ny;i<bytes.length;i++)bytes[i]=(bytes[i]+bytes[i-nx*ny])&255;
  else if(part.predictor==='delta-x')for(let row=0;row<bytes.length;row+=nx)for(let x=1;x<nx;x++)bytes[row+x]=(bytes[row+x]+bytes[row+x-1])&255;
  else assert.ok(!part.predictor||part.predictor==='none');
  assert.equal(sha(bytes),part.rawSha256);data.set(bytes,offset);offset+=bytes.length;
 }
 assert.equal(offset,data.length);return data;
}

async function measureFrame(compute,source,request){
 const samples=[],capTimes=[],acousticTimes=[];let frame;
 for(let n=0;n<5;n++){
  frame=await compute(source,request);
  if(n){samples.push(frame.stats.elapsedMs);if(Number.isFinite(frame.stats.capElapsedMs))capTimes.push(frame.stats.capElapsedMs);if(Number.isFinite(frame.stats.acousticElapsedMs))acousticTimes.push(frame.stats.acousticElapsedMs);}
 }
 return {frame,measurement:{medianMs:median(samples),samplesMs:samples,...(capTimes.length?{medianCapMs:median(capTimes),medianAcousticMs:median(acousticTimes)}:{}),width:frame.width,height:frame.height,cap:[frame.capWidth,frame.capHeight],capBytes:frame.cap.byteLength,returnedPixelBytes:frame.cap.byteLength+frame.ct.byteLength+frame.ultrasound.byteLength,beams:frame.stats.beams,radialSamples:frame.stats.radialSamples,sourceSpacingUm:frame.stats.sourceSpacingUm,capSpacingUm:frame.capSpacingUm}};
}

for(const donor of ['ladaf-2021-17','s-20-29','s-20-28']){
 const dir=donor==='ladaf-2021-17'?'public/assets':`public/assets/donors/${donor}`,meta=(await json(dir+'/manifest.json')).levels.high,geometry=volumeGeometry(meta),frames=(await json(dir+'/echo-planes.json')).frames;
 const sourceFrame={...(frames.a4c.world||frames.a4c),referenceMm:geometry.longestMm},state=initializeProbeEntry(rescaleProbeState(sanitizeProbeState(),geometry.longestMm),sourceFrame),pose=probePose(state,sourceFrame);
 const fineManifest=await json(dir+(donor==='ladaf-2021-17'?'/ultra-volume-v7.json':'/ultra-volume.json')),record=fineManifest.preparedPlanes.find(item=>item.id==='apical');
 const pixels=new Uint8Array(execFileSync('python3',['-c','from PIL import Image;import sys;sys.stdout.buffer.write(Image.open(sys.argv[1]).convert("L").tobytes())',resolve('public',record.url)],{maxBuffer:32*1024*1024}));
 assert.equal(sha(pixels),record.pixelSha256);
 const fineSlice={...record,data:pixels,spacingUm:Math.max(...record.spacingUmXY),sourceSpacingUm:fineManifest.sourceSpacingUm,complete:true,cleaned:true};
 const source={data:await residentVolume(meta),dimensions:meta.dimensions,meta,geometry},common={state,pose,fineSpacingUm:fineManifest.sourceSpacingUm,cleanupEnabled:true};
 const before=await measureFrame(beforeFrame,source,{...common,...beforeQuality(state,800),fineSlice,fast:true});
 const oldPreview=await measureFrame(beforeFrame,source,{...common,...beforeQuality(state,800),fast:true});
 const live=await measureFrame(computeProbeFrame,source,{...common,...probeFrameQuality(state,800,true),fast:true});
 const settled=await measureFrame(computeProbeFrame,source,{...common,...probeFrameQuality(state,800,false),fineSlice,fast:false});
 const cachedSlice={data:settled.frame.cap,width:settled.frame.capWidth,height:settled.frame.capHeight,plane:settled.frame.plane,sourceSpacingUm:fineManifest.sourceSpacingUm,spacingUm:settled.frame.capSpacingUm,spacingUmXY:settled.frame.capSpacingUmXY,complete:true,cleaned:true};
 const reused=await measureFrame(computeProbeFrame,source,{...common,...probeFrameQuality(state,800,true),fineSlice:cachedSlice,fast:true});
 for(const current of [live.frame,settled.frame,reused.frame]){assert.equal(current.pose,pose);assert.equal(current.state,state);assert.ok(current.capSpacingUm>0);}
 assert.deepEqual(settled.frame.plane,record.plane);assert.equal(sha(pixels),record.pixelSha256);assert.ok(live.frame.width<=384&&live.frame.capWidth<=448&&live.frame.capHeight<=448);assert.ok(settled.frame.capWidth<=1280&&settled.frame.capHeight<=1280);
 report.frames.push({donor,preparedPixelSha256:record.pixelSha256,oldNativeMotion:before.measurement,oldResidentPreview:oldPreview.measurement,liveResident:live.measurement,liveCachedFine:reused.measurement,settledFine:settled.measurement,motionFineSourceRequests:0,capTextureReduction:before.measurement.capBytes/live.measurement.capBytes});
 console.log(JSON.stringify({donor,oldNativeMs:before.measurement.medianMs,oldPreviewMs:oldPreview.measurement.medianMs,liveMs:live.measurement.medianMs,reusedMs:reused.measurement.medianMs,settledMs:settled.measurement.medianMs,capByteReduction:before.measurement.capBytes/live.measurement.capBytes}));
 globalThis.gc?.();
}

// Isolate extraction from acoustic work. Warm the real immutable source blocks
// before timing different rasters of the exact same three nearby physical cuts.
const manifest=await json('public/assets/ultra-volume-v7.json'),original=manifest.preparedPlanes.find(item=>item.id==='apical').plane;
let reads=0,bytes=0;
const backend=new FineVolumeBackend(manifest,{baseUrl:'https://heart.fixture/',fetcher:async(url,{signal}={})=>{
 const prefix=new URL(manifest.assetBaseUrl,'https://heart.fixture/').pathname,path=new URL(url).pathname;assert.ok(path.startsWith(prefix));
 signal?.throwIfAborted();const data=await readFile(resolve('data/ultra-volume-v7',path.slice(prefix.length)));signal?.throwIfAborted();reads++;bytes+=data.byteLength;return new Response(data);
}});
backend.disk={items:new Map(),bytes:0,available:false,async init(){},async get(){return null;},put(){},async remove(){throw new Error('Unexpected invalid source bytes');}};
const planes=[.1,.2,.3].map(mm=>({...original,center:original.center.map((value,i)=>value+original.normal[i]*mm/manifest.longestMm)}));
const started=performance.now();for(const plane of planes)await backend.samplePlane(plane,{spacingUm:manifest.sourceSpacingUm});
const warmup={elapsedMs:performance.now()-started,localFileRequests:reads,localCompressedBytes:bytes,decodedBytes:backend.bytes,decodedLimit:backend.limit};
const capLongest=probeFrameQuality(sanitizeProbeState(),800,false).capLongest,screenSpacingUm=Math.max(manifest.sourceSpacingUm,Math.max(original.width,original.height)*manifest.longestMm*1000/(capLongest-1));
const sourceMeasurements={warmup,sourceSpacingUm:manifest.sourceSpacingUm,screenSpacingUm,capLongest,native:[],screen:[]};
for(const [name,spacingUm]of [['native',manifest.sourceSpacingUm],['screen',screenSpacingUm]]){
 for(const plane of planes){
  const priorReads=reads,start=performance.now(),result=await backend.samplePlane(plane,{spacingUm}),elapsedMs=performance.now()-start;
  assert.deepEqual(result.plane,plane);assert.equal(result.sourceSpacingUm,manifest.sourceSpacingUm);assert.equal(reads,priorReads);assert.ok(result.spacingUm<=spacingUm+.01);
  sourceMeasurements[name].push({elapsedMs,width:result.width,height:result.height,capBytes:result.data.byteLength,capSpacingUm:result.spacingUm,sourceSpacingUm:result.sourceSpacingUm,bricks:result.brickCount,additionalSourceReads:reads-priorReads});
 }
}
sourceMeasurements.nativeMedianMs=median(sourceMeasurements.native.map(row=>row.elapsedMs));sourceMeasurements.screenMedianMs=median(sourceMeasurements.screen.map(row=>row.elapsedMs));
assert.ok(backend.bytes<=backend.limit);report.sourceExtraction=sourceMeasurements;
report.assertions=['All prepared image pixels retain their manifest hashes','All resident display volumes retain their compressed and decoded hashes','Each computed cap, CT and ultrasound retains one accepted source pose','Native cached rasters remain unchanged; only the displayed texture is reduced','Source spacing and actual displayed cap spacing remain distinct','Live frames stay at or below 384 px output and 448 px cap','Quiet frames stay at or below 896 px output and 1280 px cap','Live input requests zero fine-source downloads','Warm source measurements read no additional local files and stay within the bounded cache','Timings are not Safari, GPU, network or browser FPS measurements'];
report.passed=true;await writeFile(resolve(output,'benchmark.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:true,report:resolve(output,'benchmark.json'),nativeSourceMs:sourceMeasurements.nativeMedianMs,screenSourceMs:sourceMeasurements.screenMedianMs}));
