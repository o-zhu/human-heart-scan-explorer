import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {getEchoDonorCalibration} from '../public/echo-donor-calibration.js';
import {buildDonorEchoFrames} from '../public/echo-donor-planes.js';
import {createTeeContextModel} from '../public/tee-context-geometry.js';
import {createTeeReference,teePose,teeAcousticFaceOffsetMm,teeHeadGuideBiasMm} from '../public/tee-geometry.js';
import {calibrateTeeContextPresets} from '../public/tee-context-presets.js';
import {createEchoInstrumentClearance} from '../public/echo-instrument-clearance.js';
import {createProbeMeshes,probeModelMatrix} from '../public/probe-scene.js';
import {TeeSceneOverlay} from '../public/tee-scene.js';

const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),sub=(a,b)=>a.map((v,i)=>v-b[i]);
const length=v=>Math.hypot(...v),near=(a,b,t=1e-7)=>assert.ok(Math.abs(a-b)<=t,`${a} differs from ${b}`);
const vectorNear=(a,b,t=1e-7)=>a.forEach((v,i)=>near(v,b[i],t));
const matrixPoint=(m,v)=>[0,1,2].map(i=>m[12+i]+m[i]*v[0]+m[4+i]*v[1]+m[8+i]*v[2]);
const report={scope:'Actual free-lab head, shaft, source-plane and fan regression at three physical reference extents. Illustrative geometry, not clinical validation.',cases:[]};
const models=new Map();
function setup(donorId,factor=1){
 const calibration=getEchoDonorCalibration(donorId),referenceMm=calibration.referenceMm*factor;
 const frames=buildDonorEchoFrames({},{donorId,referenceMm}),model=createTeeContextModel({donorId,referenceMm});
 const reference=createTeeReference(frames,referenceMm,model),fits=calibrateTeeContextPresets(reference,frames);
 return {frames,model,reference,fits,query:createEchoInstrumentClearance(model)};
}

for(const donorId of ['s-20-29','s-20-28'])for(const factor of [.75,1,1.25])test(`${donorId}: all four starts preserve their source and real instruments at ${factor} reference extent`,()=>{
 const {frames,model,reference,fits,query}=setup(donorId,factor);if(factor===1)models.set(donorId,{frames,model,reference,fits,query});
 for(const [id,controls] of Object.entries(fits.presetStates)){
  const state={teeVersion:1,teePreset:id,referenceMm:reference.referenceMm,...controls};
  const pose=teePose(state,reference),review=fits.review.presets[id];
  assert.equal(review.status,'fitted');assert.equal(review.geometricCoverageFraction,1);assert.equal(review.sourceTargetCoverageFraction,1);
  assert.ok(review.planeOffsetMm<=.05*reference.scale);assert.ok(review.normalAngleDeg<.15);assert.ok(review.maxAddedTargetMissMm<.4*reference.scale);
  near(pose.acousticFaceOffsetMm,3*reference.scale);
  vectorNear(pose.originMm,pose.headCenterMm.map((v,i)=>v+pose.beam[i]*pose.acousticFaceOffsetMm));
  const head=query(pose.instrument,reference.scale,{fullReport:true});
  assert.equal(head.testedVertices,390);assert.equal(head.outsideVertices,0);assert.ok(head.clearanceMm>=.1*reference.scale);
  // Capture the real production shaft mesh and head matrices, without WebGL.
  const draws=[],overlay=Object.create(TeeSceneOverlay.prototype);
  overlay.head=createProbeMeshes('tee').filter((_,i)=>i!==2);
  overlay.view={begin(){},remove(){},upload(vertices){return {vertices};},draw(mesh,matrix){draws.push({mesh,matrix});}};
  overlay.drawGeometry({pose,reference,width:640,height:560,dpr:1,showProbe:true,showContext:false});
  const entry=model.tractSamples[0],shaftPoints=new Map();
  for(let i=0;i<overlay.shaft.vertices.length;i+=6){const p=Array.from(overlay.shaft.vertices.subarray(i,i+3));if(dot(sub(p,entry.pointMm),entry.tangent)>=0)shaftPoints.set(p.join(','),p);}
  let shaftClearance=Infinity;
  for(const p of shaftPoints.values()){const q=query.point(p,{measureClearance:true});assert.equal(q.inside,true,`${donorId} ${id}: actual drawn shaft leaves the lumen`);shaftClearance=Math.min(shaftClearance,q.clearanceMm);}
  assert.ok(shaftClearance>.1*reference.scale);
  const headPoints=new Map();
  for(const draw of draws.filter(d=>d.matrix))for(let i=0;i<draw.mesh.vertices.length;i+=6){const v=Array.from(draw.mesh.vertices.subarray(i,i+3)),p=matrixPoint(draw.matrix,v);headPoints.set(p.join(','),p);}
  for(const p of headPoints.values())assert.equal(query.point(p).inside,true,'Rendered head matrix agrees with complete physical clearance');
  const neck=matrixPoint(probeModelMatrix(pose.instrument,.60*reference.scale),[0,11,6]);
  vectorNear(pose.shaftPoints.at(-1),neck,1e-5);
  const lastDirection=sub(pose.shaftPoints.at(-1),pose.shaftPoints.at(-2));
  near(dot(lastDirection,pose.instrument.shaft)/length(lastDirection),1,1e-8);
  const source=frames[id==='tg'?'tgpapillary':id],center=source.center.map(v=>v*reference.referenceMm);
  for(const target of source.anatomyTargetsMm){
   const baseline=Math.abs(dot(sub(target.pointMm,center),source.normal));
   const actual=Math.abs(dot(sub(target.pointMm,pose.originMm),pose.normal));assert.ok(actual-baseline<.4*reference.scale);
   if(baseline<=4*reference.scale){const q=sub(target.pointMm,pose.originMm);assert.ok(dot(q,pose.beam)>0);assert.ok(length(q)<=state.depthMm);assert.ok(Math.acos(Math.min(1,dot(q,pose.beam)/length(q)))*180/Math.PI<=state.angleDeg/2+1e-7);}
  }
  report.cases.push({donorId,preset:id,referenceFactor:factor,referenceMm:reference.referenceMm,controls,
   planeOffsetMm:review.planeOffsetMm,normalAngleDeg:review.normalAngleDeg,maxAddedTargetMissMm:review.maxAddedTargetMissMm,
   geometricCoverageFraction:1,sourceTargetCoverageFraction:1,coveredSourceTargets:review.coveredSourceTargets,
   headClearanceMm:head.clearanceMm,headVertices:head.testedVertices,actualShaftVertices:shaftPoints.size,actualShaftClearanceMm:shaftClearance,
   acousticFaceOffsetMm:pose.acousticFaceOffsetMm,headGuideBiasMm:pose.headGuideBiasMm});
 }
});

test('the calibrated guide is bounded, continuous, independent of the preset, and leaves S-20-28 unchanged',()=>{
 const {reference,fits}=models.get('s-20-29');
 for(const angle of [-65,-30,-18,-14,-10,0,90])assert.ok(teeHeadGuideBiasMm(reference,angle)>=0&&teeHeadGuideBiasMm(reference,angle)<=3*reference.scale);
 for(const boundary of [-18,-10]){
  const epsilon=1e-3,state={...fits.presetStates.me4c,referenceMm:reference.referenceMm,teePreset:'me4c',anteflexDeg:boundary};
  const before=teePose({...state,anteflexDeg:boundary-epsilon},reference),at=teePose(state,reference),after=teePose({...state,anteflexDeg:boundary+epsilon},reference);
  assert.ok(length(sub(before.originMm,after.originMm))<.002*reference.scale);
  const left=sub(at.originMm,before.originMm).map(v=>v/epsilon),right=sub(after.originMm,at.originMm).map(v=>v/epsilon);
  assert.ok(length(sub(left,right))<.001*reference.scale,'The join must not introduce a position or velocity jump');
 }
 const state={...fits.presetStates.me4c,referenceMm:reference.referenceMm};
 const first=teePose({...state,teePreset:'me4c'},reference);
 for(const teePreset of ['me2c','melax','tg'])assert.deepEqual(teePose({...state,teePreset},reference),first);
 const other=models.get('s-20-28').reference;for(const angle of [-65,-18,-14,0,90])near(teeHeadGuideBiasMm(other,angle),0);
});

test('LADAF positions, complete instrument frames and shaft routes remain identical to the original implementation',async()=>{
 const raw=JSON.parse(await readFile('public/assets/echo-planes.json','utf8'));
 const frames=Object.fromEntries(Object.entries(raw.frames).map(([k,f])=>[k,f.world]));
 const model=createTeeContextModel({frames}),reference=createTeeReference(frames,model.referenceMm,model);
 const baseline=JSON.parse(await readFile('docs/echo-donor-context-v6/ladaf-kinematics-baseline.json','utf8'));
 near(teeAcousticFaceOffsetMm(reference),0);
 for(const item of baseline.cases){const pose=teePose(item.state,reference);near(pose.headGuideBiasMm,0);for(const key of Object.keys(item.pose))assert.deepEqual(pose[key],item.pose[key]);}
});

test('write a current compact receipt for all verified defaults and physical scales',async()=>{
 assert.equal(report.cases.length,24);
 report.sourceHashes={};for(const path of ['public/tee-geometry.js','public/tee-context-presets.js','public/tee-scene.js','public/probe-scene.js','public/echo-donor-planes.js','public/echo-donor-calibration.js','public/tee-context-geometry.js','public/echo-instrument-clearance.js','tests/tee-lab-source-containment-v6.mjs'])report.sourceHashes[path]=createHash('sha256').update(await readFile(path)).digest('hex');
 await writeFile('docs/echo-donor-context-v6/lab-presets.json',JSON.stringify(report,null,2)+'\n');
});
