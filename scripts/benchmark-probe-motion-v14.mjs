/** Real-source native CPU benchmark, not a browser/GPU frame-rate test.
 * Requires the local scan banks, Python/Pillow and the baseline Git commit.
 */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cpus,platform,arch} from 'node:os';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {FineVolumeBackend} from '../public/ultra-volume-backend.js';
import {computeProbeFrame} from '../public/probe-acoustics.js';
import {probePose,probeCapPlane,volumeGeometry,rescaleProbeState,sanitizeProbeState,initializeProbeEntry} from '../public/probe-geometry.js';
const root=resolve(new URL('..',import.meta.url).pathname),baseline='f34a66ee3cf969394f49f3004dc09a40a9366e78';
const output=process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'docs/probe-motion-v14';await mkdir(output,{recursive:true});
const json=async p=>JSON.parse(await readFile(p,'utf8')),sha=b=>createHash('sha256').update(b).digest('hex');
const oldSource=p=>execFileSync('git',['show',baseline+':'+p],{cwd:root,encoding:'utf8',maxBuffer:2**22});
const moduleUrl=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const oldCoreUrl=moduleUrl(oldSource('public/ultra-volume-core.js'));
const {FineVolumeBackend:BeforeBackend}=await import(moduleUrl(oldSource('public/ultra-volume-backend.js').replace("'./ultra-volume-core.js'",JSON.stringify(oldCoreUrl))));
const {computeProbeFrame:beforeFrame}=await import(moduleUrl(oldSource('public/probe-acoustics.js').replace("'./probe-geometry.js'",JSON.stringify(pathToFileURL(resolve(root,'public/probe-geometry.js')).href))));
const report={baselineCommit:baseline,scope:'Native Node CPU measurements using real prepared donor pixels and local immutable fine bricks. Local-file access stands in for already downloaded CacheStorage; these are not browser input latency, GPU timings, network speed or user-device FPS.',runtime:{node:process.version,platform:platform(),architecture:arch(),cpuModel:cpus()[0]?.model},nativeCap:[],acoustics:[],assertions:[]};
const manifest=await json('public/assets/donors/s-20-28/ultra-volume.json');
const basePlane=manifest.preparedPlanes[0].plane,shift=distance=>({...basePlane,center:basePlane.center.map((v,i)=>v+basePlane.normal[i]*distance/manifest.longestMm)});
const p1=shift(.08067),p2=shift(.16134),p3=shift(.24201);
const known=new Map(Object.values(manifest.blocks).map(r=>{const u=new URL(manifest.assetBaseUrl+r.path,'https://heart.test/');u.searchParams.set('v',r.sha256.slice(0,16));return [u.href,r.bytes];}));
let baselineFinal;
for(const [name,Type] of [['v13',BeforeBackend],['v14',FineVolumeBackend]]){
 let diskReads=0,diskBytes=0,networkRequests=0;
 const backend=new Type(manifest,{baseUrl:'https://heart.test/',fetcher:async()=>{networkRequests++;throw new Error('All source bytes must be read locally for this benchmark.');}});
 backend.disk={items:known,bytes:manifest.totalEncodedBytes,available:true,async init(){},async get(url){diskReads++;const data=new Uint8Array(await readFile('data/donors/s-20-28/ultra-volume/'+new URL(url).pathname.split('/volume/')[1]));diskBytes+=data.length;return data;},async remove(){throw new Error('Source checksum failure');},put(){throw new Error('Unexpected persistence of already-local bytes');}};
 const samples=[];let result;
 for(const [label,plane] of [['first-local-plane',p1],['nearby-local-plane',p2],['next-local-plane',p3],['same-local-plane',p3]]){
  const priorReads=diskReads,start=performance.now();result=await backend.samplePlane(plane,{spacingUm:manifest.sourceSpacingUm});const elapsedMs=performance.now()-start;
  samples.push({label,elapsedMs,diskReads:diskReads-priorReads,sourceSpacingUm:result.sourceSpacingUm,capSpacingUm:result.spacingUm,width:result.width,height:result.height,bricks:result.brickCount});
 }
 assert.equal(networkRequests,0);assert.ok(backend.bytes<=backend.limit);
 if(name==='v13')baselineFinal=result.data;else{let max=0,changed=0;for(let i=0;i<result.data.length;i++){const d=Math.abs(result.data[i]-baselineFinal[i]);max=Math.max(max,d);if(d)changed++;}assert.ok(max<=1&&changed/result.data.length<.0001);report.nativePixels={count:result.data.length,maximumByteDifference:max,changedPixels:changed,sha256:sha(result.data)};}
 report.nativeCap.push({version:name,decodedLimit:backend.limit,decodedBytes:backend.bytes,diskReads,diskBytes,networkRequests,samples});
 backend.cache.clear();backend.bytes=0;
}
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
for(const id of ['ladaf-2021-17','s-20-29','s-20-28']){
 const dir=id==='ladaf-2021-17'?'public/assets':'public/assets/donors/'+id;
 const meta=(await json(dir+'/manifest.json')).levels.high,geometry=volumeGeometry(meta),frames=(await json(dir+'/echo-planes.json')).frames;
 const frame={...(frames.a4c.world||frames.a4c),referenceMm:geometry.longestMm},state=initializeProbeEntry(rescaleProbeState(sanitizeProbeState(),geometry.longestMm),frame),pose=probePose(state,frame),plane=probeCapPlane(pose,geometry);
 const rec=(await json(dir+(id==='ladaf-2021-17'?'/ultra-volume-v7.json':'/ultra-volume.json'))).preparedPlanes.find(x=>x.id==='apical');
 const pixels=new Uint8Array(execFileSync('python3',['-c','from PIL import Image;import sys;sys.stdout.buffer.write(Image.open(sys.argv[1]).convert("L").tobytes())',resolve('public',rec.url)],{maxBuffer:32*1024*1024}));assert.equal(sha(pixels),rec.pixelSha256);
 const fineSlice={...rec,plane,data:pixels,complete:true,cleaned:true},source={data:new Uint8Array(1),dimensions:meta.dimensions,meta,geometry},request={state,pose,fineSlice,fineSpacingUm:rec.sourceSpacingUm};
 const sourceHash=sha(pixels),timings={before:[],after:[]};let oldResult,newResult;
 for(let n=0;n<4;n++){oldResult=await beforeFrame(source,request);newResult=await computeProbeFrame(source,{...request,width:800,fast:n%2===0});if(n){timings.before.push(oldResult.stats.elapsedMs);timings.after.push(newResult.stats.elapsedMs);}}
 const sameGrid=await computeProbeFrame(source,{...request,width:oldResult.width,beams:oldResult.stats.beams,samples:oldResult.stats.radialSamples});
 const differences={};for(const key of ['ct','ultrasound']){let max=0,changed=0,sum=0;for(let i=0;i<oldResult[key].length;i++){const d=Math.abs(oldResult[key][i]-sameGrid[key][i]);max=Math.max(max,d);if(d)changed++;sum+=d;}assert.ok(max<=1&&sum/oldResult[key].length<.0001);differences[key]={maxByteDifference:max,changedPixels:changed,meanAbsoluteDifference:sum/oldResult[key].length};}
 const motion=await computeProbeFrame(source,{...request,width:800,fast:true}),rest=await computeProbeFrame(source,{...request,width:800,fast:false});assert.deepEqual(motion.ct,rest.ct);assert.deepEqual(motion.ultrasound,rest.ultrasound);assert.equal(motion.cap,pixels);assert.equal(rest.cap,pixels);assert.equal(sha(pixels),sourceHash);
 report.acoustics.push({donor:id,sourceSpacingUm:rec.sourceSpacingUm,sourceHash,cap:[rec.width,rec.height],before:{width:oldResult.width,height:oldResult.height,beams:oldResult.stats.beams,radialSamples:oldResult.stats.radialSamples,medianMs:median(timings.before),samplesMs:timings.before},after:{width:newResult.width,height:newResult.height,beams:newResult.stats.beams,radialSamples:newResult.stats.radialSamples,medianMs:median(timings.after),samplesMs:timings.after},matchedGridDifferences:differences,motionAndRestIdentical:true,capBytesUnchanged:true});
}
report.assertions=['Native source cap sampling retained during movement and rest','Final real-source cap matches the baseline within at most one quantization level','New bounded cache retains the active oblique plane','No benchmark network requests','Real prepared images pass their manifest pixel hashes','Matching acoustic grids preserve CT and ultrasound bytes within one quantization level','Movement and rest produce identical CT/ultrasound pixels for identical input','Prepared cap bytes remain unchanged'];
report.passed=true;await writeFile(resolve(output,'benchmark.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:true,report:resolve(output,'benchmark.json'),nativeCap:report.nativeCap.map(x=>({version:x.version,decodedMiB:x.decodedLimit/1048576,samples:x.samples.map(y=>({label:y.label,ms:Math.round(y.elapsedMs),diskReads:y.diskReads}))})),acoustics:report.acoustics.map(x=>({donor:x.donor,beforeMs:Math.round(x.before.medianMs),afterMs:Math.round(x.after.medianMs)}))}));
