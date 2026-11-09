/** Focused physical-geometry, acoustic-proxy and real-worker checks.
 * node scripts/verify-probe-v6.mjs [--source] [--out=/workspace/data/probe-v6]
 * This is not a browser/WebGL frame-rate benchmark or clinical validation.
 */
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {Worker} from 'node:worker_threads';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {dot,cross,add,mul} from '../public/planes.js';
import {PROBE_PRESETS,PROBE_REFERENCE_MM,volumeGeometry,sanitizeProbeState,defaultOrigin,probePose,translateProbe,steerProbe,sectorPoint,beamPoint,probeCapPlane,capPixelWorld,worldMillimetresToVoxel,projectProbePoint} from '../public/probe-geometry.js';
import {computeProbeFrame,createProbeSampler,tissueSpeckle} from '../public/probe-acoustics.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const report={schemaVersion:1,checks:[],sourceFrames:[],limits:['Node CPU sampling timings are not browser FPS.','Proxy acoustics are not validated clinical ultrasound.']};
const test=async(name,fn)=>{await fn();report.checks.push(name);console.log('PASS',name);};
const near=(a,b,epsilon=1e-9)=>assert.ok(Math.abs(a-b)<=epsilon,`${a} differs from ${b}`);
const nearVector=(a,b,epsilon=1e-9)=>a.forEach((v,i)=>near(v,b[i],epsilon));
const frame={center:[0,0,0],right:[1,0,0],up:[0,0,-1],normal:[0,1,0]};
const state=sanitizeProbeState({originMm:[0,0,-40],depthMm:80,angleDeg:72});
const pose=probePose(state,frame),meta={dimensions:[65,65,65],spacingUm:1000},geometry=volumeGeometry(meta);
const data=new Uint8Array(65**3);
for(let z=0;z<65;z++)for(let y=0;y<65;y++)for(let x=0;x<65;x++){
 const world=[x-32,z-32,32-y],r=Math.hypot(...world),v=r>13&&r<23?175:0;
 data[x+65*(y+65*z)]=v;
}
const volume={data,meta,dimensions:meta.dimensions,geometry};
const small={id:1,version:1,pose,state,capLongest:140,width:140,beams:64,samples:128,fast:true};

await test('Probe basis remains orthonormal through pan, tilt and roll',()=>{
 for(const angles of [[0,0,0],[48,32,-76],[-175,-84,179],[180,85,-180]]){
  const p=probePose({...state,sweepDeg:angles[0],tiltDeg:angles[1],rollDeg:angles[2]},frame);
  for(const v of [p.beam,p.right,p.normal,p.up])near(Math.hypot(...v),1);
  near(dot(p.beam,p.right),0);near(dot(p.beam,p.normal),0);near(dot(p.right,p.normal),0);nearVector(cross(p.right,p.up),p.normal);
 }
});
await test('WASD/RF translation uses physical local axes with bounded diagonal speed',()=>{
 nearVector(translateProbe(state,pose,{advance:1},5),add(pose.originMm,mul(pose.beam,5)));
 nearVector(translateProbe(state,pose,{lateral:-1},5),add(pose.originMm,mul(pose.right,-5)));
 nearVector(translateProbe(state,pose,{elevation:1},5),add(pose.originMm,mul(pose.normal,5)));
 const moved=translateProbe(state,pose,{advance:1,lateral:1,elevation:1},5);near(Math.hypot(...moved.map((v,i)=>v-pose.originMm[i])),5);
 const rolled=steerProbe(state,{roll:360,tilt:100});near(rolled.rollDeg,0);near(rolled.tiltDeg,85);
});
await test('Scan source-axis mapping preserves first/last physical voxel centers',()=>{
 nearVector(worldMillimetresToVoxel([-32,-32,32],geometry,meta.dimensions),[0,0,0]);
 nearVector(worldMillimetresToVoxel([32,32,-32],geometry,meta.dimensions),[64,64,64]);
 nearVector(worldMillimetresToVoxel([0,0,0],geometry,meta.dimensions),[32,32,32]);
});
await test('Sector pixels and fan geometry occupy exactly the cutaway plane',()=>{
 const p=probePose({...state,sweepDeg:24,tiltDeg:17,rollDeg:-37},frame),plane=probeCapPlane(p,geometry);
 for(const [u,v] of [[.5,0],[.5,.5],[.2,.7],[.8,.7]]){
  const q=sectorPoint(p,state,u,v);assert.ok(q.inside);near(dot(q.pointMm.map((x,i)=>x/geometry.longestMm-plane.center[i]),plane.normal),0);
  nearVector(q.pointMm,beamPoint(p,q.angle,q.depthMm),1e-8);
 }
 assert.equal(sectorPoint(p,state,0,0).inside,false);assert.equal(sectorPoint(p,state,0,1).inside,false);
 const translated=probePose({...state,originMm:add(state.originMm,mul(pose.normal,5))},frame),movedPlane=probeCapPlane(translated,geometry),oldPlane=probeCapPlane(pose,geometry);
 near(dot(movedPlane.center.map((v,i)=>v-oldPlane.center[i]),pose.normal)*geometry.longestMm,5);
});
await test('3D overlay projection agrees with the renderer camera-ray convention',()=>{
 const basis={eye:[0,0,2],forward:[0,0,-1],right:[1,0,0],up:[0,1,0]};
 const center=projectProbePoint([0,0,0],basis,800,600);near(center.x,400);near(center.y,300);
 const right=projectProbePoint([2*.32*(800/600),0,0],basis,800,600);near(right.x,800);
 const up=projectProbePoint([0,2*.32,0],basis,800,600);near(up.y,0);assert.equal(projectProbePoint([0,0,3],basis,800,600),null);
});

let result;
await test('Measured CT sector and full cap resample the same physical phantom',async()=>{
 result=await computeProbeFrame(volume,small);assert.ok(result);const sample=createProbeSampler(volume);let checked=0;
 for(let row=0;row<result.height;row+=11)for(let col=0;col<result.width;col+=7){
  const q=sectorPoint(pose,state,col/(result.width-1),row/(result.height-1)),expected=q.inside&&q.depthMm>=.3?Math.round(sample(...q.pointMm)):0;
  assert.equal(result.ct[col+row*result.width],expected);checked++;
 }
 for(let row=0;row<result.capHeight;row+=13)for(let col=0;col<result.capWidth;col+=9){
  const p=mul(capPixelWorld(result.plane,col,row,result.capWidth,result.capHeight),geometry.longestMm);
  assert.equal(result.cap[col+row*result.capWidth],Math.round(sample(...p)));checked++;
 }
 assert.ok(checked>200);assert.ok(result.stats.tissuePixels>100);assert.ok(result.ultrasound.some(v=>v>20));
});
await test('Identical anatomy and pose yield byte-identical ultrasound; speckle is tissue-fixed',async()=>{
 const repeated=await computeProbeFrame(volume,{...small,id:800});assert.deepEqual(repeated.ultrasound,result.ultrasound);assert.deepEqual(repeated.ct,result.ct);
 near(tissueSpeckle(1.2,3.4,5.6),tissueSpeckle(1.2,3.4,5.6));assert.notEqual(tissueSpeckle(1.2,3.4,5.6),tissueSpeckle(2.2,3.4,5.6));
});
await test('An empty volume produces no invented ultrasound structures',async()=>{
 const empty=await computeProbeFrame({...volume,data:new Uint8Array(data.length)},small);
 assert.ok(empty.ct.every(v=>v===0));assert.ok(empty.ultrasound.every(v=>v===0));near(empty.stats.tissueFraction,0);
});
await test('Gain is monotonic while measured CT stays unchanged',async()=>{
 const brighter=await computeProbeFrame(volume,{...small,state:{...state,gainDb:6}});assert.deepEqual(brighter.ct,result.ct);
 assert.ok(brighter.ultrasound.every((v,i)=>v>=result.ultrasound[i]));assert.ok(brighter.ultrasound.some((v,i)=>v>result.ultrasound[i]));
});
await test('Cleanup exclusion removes unsupported anatomy from both derived images',async()=>{
 const excluded=await computeProbeFrame({...volume,support:{data:new Uint8Array(data.length),dimensions:meta.dimensions}},small);
 assert.ok(excluded.ct.every(v=>v===0));assert.ok(excluded.ultrasound.every(v=>v===0));
 const comparison=await computeProbeFrame({...volume,support:{data:new Uint8Array(data.length),dimensions:meta.dimensions}},{...small,cleanupEnabled:false});assert.deepEqual(comparison.ct,result.ct);
});
await test('Settled sampling yields and honors cancellation',async()=>{
 let yields=0;const cancelled=await computeProbeFrame(volume,{...small,capLongest:900,fast:false},{yieldFn:async()=>{yields++;},cancelled:()=>yields>0});
 assert.equal(cancelled,null);assert.equal(yields,1);
});

await test('Actual worker coalesces live poses and cancels superseded refinement',async()=>{
 const moduleUrl=pathToFileURL(path.join(root,'public/probe-acoustics-worker.js')).href;
 const adapter=`import {parentPort} from 'node:worker_threads'; globalThis.self={postMessage:(message,transfer)=>parentPort.postMessage(message,transfer)}; await import(${JSON.stringify(moduleUrl)}); parentPort.on('message',data=>self.onmessage({data})); parentPort.postMessage({type:'ready'});`;
 const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(adapter)),{type:'module'}),messages=[];
 let error;worker.on('error',value=>{error=value;});worker.on('message',message=>messages.push(message));
 const waitFor=predicate=>new Promise((resolve,reject)=>{const started=Date.now();const poll=()=>{if(error)return reject(error);const value=messages.find(predicate);if(value)return resolve(value);if(Date.now()-started>15000)return reject(new Error('Worker did not finish in 15 seconds.'));setTimeout(poll,5);};poll();});
 try{
  await waitFor(m=>m.type==='ready');worker.postMessage({type:'load',version:1,data,meta});await waitFor(m=>m.type==='loaded');
  worker.postMessage({...small,type:'sample',id:1,capLongest:900});worker.postMessage({...small,type:'sample',id:2});worker.postMessage({...small,type:'sample',id:3,pose:{...pose,originMm:[3,0,-40]}});
  const newest=await waitFor(m=>m.type==='frame'&&m.id===3);nearVector(newest.pose.originMm,[3,0,-40]);assert.equal(messages.some(m=>m.type==='frame'&&m.id===2),false);
  worker.postMessage({...small,type:'sample',id:10,capLongest:1900,fast:false});worker.postMessage({...small,type:'sample',id:11,fast:true});
  await waitFor(m=>m.type==='frame'&&m.id===11);assert.equal(messages.some(m=>m.type==='frame'&&m.id===10),false);
  report.workerReturnedIds=messages.filter(m=>m.type==='frame').map(m=>m.id);
 }finally{await worker.terminate();}
});

const outArg=process.argv.find(v=>v.startsWith('--out=')),out=outArg?path.resolve(outArg.slice(6)):null;
if(out)await mkdir(out,{recursive:true});
if(process.argv.includes('--source')){
 const manifest=JSON.parse(await readFile(path.join(root,'public/assets/manifest.json'),'utf8')),scanMeta=manifest.levels.high;
 const encoded=await readFile(path.join(root,'public',scanMeta.parts[0].url)),scanData=new Uint8Array(gunzipSync(encoded));
 const stride=scanMeta.dimensions[0]*scanMeta.dimensions[1];if(scanMeta.parts[0].predictor==='delta-z')for(let i=stride;i<scanData.length;i++)scanData[i]=(scanData[i]+scanData[i-stride])&255;
 const supportMeta=JSON.parse(await readFile(path.join(root,'public/assets/cleanup/manifest.json'),'utf8')),support={data:new Uint8Array(gunzipSync(await readFile(path.join(root,'public',supportMeta.volumeUrl)))),dimensions:supportMeta.dimensions};
 const reference=JSON.parse(await readFile(path.join(root,'public/assets/echo-planes.json'),'utf8')),sourceVolume={data:scanData,meta:scanMeta,dimensions:scanMeta.dimensions,geometry:volumeGeometry(scanMeta),support};
 for(const preset of PROBE_PRESETS){
  const f=reference.frames[preset.frame].world,s=sanitizeProbeState({preset:preset.id,depthMm:preset.depthMm,angleDeg:preset.angleDeg,originMm:defaultOrigin(f,preset.depthMm)}),p=probePose(s,f);
  const measured=await computeProbeFrame(sourceVolume,{id:1,version:1,state:s,pose:p,fast:false});
  assert.ok(measured.stats.tissueFraction>.01,`${preset.id} must intersect actual heart tissue.`);
  const stats={preset:preset.id,...measured.stats,width:measured.width,height:measured.height,capWidth:measured.capWidth,capHeight:measured.capHeight,originMm:s.originMm};
  const start=performance.now();const live=await computeProbeFrame(sourceVolume,{id:2,version:1,state:s,pose:p,fast:true});stats.liveCpuMs=performance.now()-start;stats.livePixels=live.width*live.height;
  report.sourceFrames.push(stats);console.log('SOURCE',JSON.stringify(stats));
  if(out){for(const [label,pixels] of [['ct',measured.ct],['us',measured.ultrasound]])await writeFile(path.join(out,preset.id+'-'+label+'.pgm'),Buffer.concat([Buffer.from(`P5\n${measured.width} ${measured.height}\n255\n`),Buffer.from(pixels)]));await writeFile(path.join(out,preset.id+'-plane.json'),JSON.stringify({pose:p,plane:measured.plane,state:s},null,2));}
 }
 report.checks.push('All four starting probes intersect the measured high-resolution heart volume');
}
if(out)await writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');
console.log(`${report.checks.length} focused checks passed.`);
