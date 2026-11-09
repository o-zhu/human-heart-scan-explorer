import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {PROBE_PRESETS,PROBE_REFERENCE_MM,probePhysicalScale,volumeGeometry,defaultOrigin,probePresetDepth,initializeProbeEntry,sanitizeProbeState,rescaleProbeState,probePose,probeContactSurface,probeCapPlane} from '../public/probe-geometry.js';
import {createProbeMeshes,probeDisplayScale,referenceTorsoPose} from '../public/probe-scene.js';
import {sameFinePlane} from '../public/ultra-volume-core.js';

const near=(a,b,e=1e-7)=>assert.ok(Math.abs(a-b)<e,`${a} differs from ${b}`);
const vector=(a,b,e=1e-7)=>a.forEach((v,i)=>near(v,b[i],e));
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),sub=(a,b)=>a.map((v,i)=>v-b[i]);
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const body=await json('public/assets/probe-context-v11/manifest.json');
const report={scope:'Production geometry and every retained support sample; no browser or clinical registration claim.',sources:[],checks:[]};
const cases=[];
for(const donor of ['ladaf-2021-17','s-20-29','s-20-28']){
 const root=donor.startsWith('s-')?`public/assets/donors/${donor}`:'public/assets';
 const manifest=await json(root+'/manifest.json'),planes=await json(root+'/echo-planes.json'),geometry=volumeGeometry(manifest.levels.high),scale=probePhysicalScale(geometry.longestMm);
 const prepared=donor.startsWith('s-')?await json(root+'/probe-textures.json'):null;
 const source={donor,referenceMm:geometry.longestMm,presets:[]};report.sources.push(source);
 for(const preset of PROBE_PRESETS){
  const frame={...planes.frames[preset.frame].world,referenceMm:geometry.longestMm},legacyFrame={...frame};delete legacyFrame.probeEntry;
  const legacyState=sanitizeProbeState({preset:preset.id,referenceMm:geometry.longestMm,depthMm:preset.depthMm*scale,angleDeg:preset.angleDeg,contactLocked:true,contactPositionMm:[0,0]});
  const state=initializeProbeEntry(legacyState,frame),pose=probePose(state,frame),oldPose=probePose(legacyState,legacyFrame),plane=probeCapPlane(pose,geometry),oldPlane=probeCapPlane(oldPose,geometry);
  const row={id:preset.id,legacyDepthMm:legacyState.depthMm,depthMm:state.depthMm,originMm:pose.originMm,legacyOriginMm:oldPose.originMm,movedMm:Math.hypot(...sub(pose.originMm,oldPose.originMm)),preparedPlaneRetained:!prepared||sameFinePlane(plane,prepared.preparedPlanes.find(p=>p.id===preset.id).plane)};
  source.presets.push(row);cases.push({donor,root,manifest,source,prepared,preset,frame,legacyFrame,geometry,scale,state,legacyState,pose,oldPose,plane,oldPlane,row});
 }
}

test('all twelve starting planes retain their source axes; eight S presets retain exact prepared Ultra plane geometry',()=>{
 assert.equal(cases.length,12);
 for(const c of cases){
  vector(c.pose.right,c.oldPose.right);vector(c.pose.beam,c.oldPose.beam);vector(c.pose.normal,c.oldPose.normal);
  assert.ok(sameFinePlane(c.plane,c.oldPlane),`${c.donor}:${c.preset.id} cap moved`);
  assert.ok(c.row.preparedPlaneRetained,`${c.donor}:${c.preset.id} lost the prepared fine plane`);
  const shift=sub(c.pose.originMm,c.oldPose.originMm);near(dot(shift,c.pose.right),0);near(dot(shift,c.pose.normal),0);
  if(!c.donor.startsWith('s-')){vector(c.pose.originMm,c.oldPose.originMm);near(c.state.depthMm,c.legacyState.depthMm);}
  if(['parasternal','short-axis'].includes(c.preset.id)){near(c.row.movedMm,0);near(c.state.depthMm,c.legacyState.depthMm);}
 }
 report.checks.push('CT plane, source orientation and prepared fine images unchanged; original donor and already-safe S entries unchanged.');
});

test('S donor starting tips and the complete compact instruments lie outside every retained support cell',async()=>{
 for(const donor of ['s-20-29','s-20-28']){
  const relevant=cases.filter(c=>c.donor===donor),support=await json(relevant[0].root+'/cleanup/manifest.json'),compressed=await readFile('public/'+support.volumeUrl),digest=createHash('sha256').update(compressed).digest('hex');
  assert.equal(digest,support.sha256);const mask=gunzipSync(compressed),[nx,ny,nz]=support.dimensions,[ex,ey,ez]=support.physicalCenterExtentUm.map(v=>v/1000),spacing=[ex/(nx-1),ey/(ny-1),ez/(nz-1)];
  const guard=Math.hypot(...spacing)/2;
  // Scan the whole binary source independently from preparation metadata.
  const stats=relevant.map(c=>({c,maxAlong:-Infinity,minNewDepth:Infinity,maxRadius:0,oldTipValue:0}));
  let at=0,count=0;
  for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++,at++){
   if(!mask[at])continue;count++;const p=[x*spacing[0]-ex/2,z*spacing[2]-ez/2,ey/2-y*spacing[1]];
   for(const s of stats){const {c}=s,d=sub(p,c.pose.originMm),along=dot(p,c.pose.up),depth=dot(d,c.pose.beam),lateral=dot(d,c.pose.right);s.maxAlong=Math.max(s.maxAlong,along);s.minNewDepth=Math.min(s.minNewDepth,depth);s.maxRadius=Math.max(s.maxRadius,Math.hypot(depth,lateral));}
  }
  for(const s of stats){const {c}=s;
   assert.equal(c.frame.probeEntry.sourceSupportSha256,digest);
   const [x,y,z]=[Math.round((c.oldPose.originMm[0]/ex+.5)*(nx-1)),Math.round((.5-c.oldPose.originMm[2]/ey)*(ny-1)),Math.round((c.oldPose.originMm[1]/ez+.5)*(nz-1))];
   s.oldTipValue=x>=0&&x<nx&&y>=0&&y<ny&&z>=0&&z<nz?mask[x+nx*(y+ny*z)]:0;
   if(['apical','atrial'].includes(c.preset.id))assert.equal(s.oldTipValue,255,'Must reproduce the reported old embedded tip.');
   const clearance=s.minNewDepth-guard;assert.ok(clearance>=8*c.scale-1e-6,`${donor}:${c.preset.id} tip is not safely external`);
   // Probe local +Z is the outward direction; test actual authored vertices,
   // including the lens and cable rather than only the acoustic point.
   let minMeshZ=Infinity;
   for(const mesh of createProbeMeshes(c.preset.id==='atrial'?'tee':'phased'))for(let i=2;i<mesh.vertices.length;i+=6)minMeshZ=Math.min(minMeshZ,mesh.vertices[i]);
   const meshClearance=clearance+minMeshZ*probeDisplayScale(c.geometry.longestMm);assert.ok(meshClearance>7*c.scale);
   assert.ok(c.state.depthMm>s.maxRadius+guard,`${donor}:${c.preset.id} distal source was cropped by depth`);
   Object.assign(c.row,{sourceSupportSamples:count,legacyTipInSupport:s.oldTipValue===255,tipCellClearanceMm:clearance,instrumentCellClearanceMm:meshClearance,maxProjectedSourceRadiusMm:s.maxRadius,distalDepthMarginMm:c.state.depthMm-s.maxRadius-guard});
  }
 }
 report.checks.push('Whole retained source support and complete probe mesh clearances checked, including former embedded tips and distal depth coverage.');
});

test('calibrated entry rescales in physical millimetres and keeps one contact/torso pose',()=>{
 for(const c of cases.filter(c=>c.frame.probeEntry)){
  const physicalRatio=.65,frame={...c.frame,referenceMm:c.geometry.longestMm*physicalRatio},state=rescaleProbeState(c.state,frame.referenceMm),pose=probePose(state,frame);
  vector(pose.originMm,c.pose.originMm.map(x=>x*physicalRatio));near(probePresetDepth(c.preset.id,frame),c.state.depthMm*physicalRatio);
  const surface=probeContactSurface(c.preset.id,c.frame);vector(surface.centerMm,c.pose.originMm);
  const torso=referenceTorsoPose(c.state,body,surface,c.pose),legacySurface=probeContactSurface(c.preset.id,c.legacyFrame),oldTorso=referenceTorsoPose(c.legacyState,body,legacySurface,c.oldPose);
  vector(torso.originMm,c.pose.originMm);vector(oldTorso.originMm,c.oldPose.originMm);vector(torso.beam,oldTorso.beam);vector(torso.right,oldTorso.right);
 }
 report.checks.push('Per-donor physical scaling, contact origin and exact donor-world reference pose preserved, including the actual changed entry offset.');
});

test('entry migration preserves custom depth, explicit free bookmarks and later user depth choices',()=>{
 for(const c of cases){
  if(!c.frame.probeEntry){assert.equal(initializeProbeEntry(c.state,c.frame),c.state);continue;}
  const custom=sanitizeProbeState({...c.legacyState,depthMm:110*c.scale}),customResult=initializeProbeEntry(custom,c.frame);near(customResult.depthMm,custom.depthMm);
  const free=sanitizeProbeState({...c.legacyState,contactLocked:false,originMm:[12,23,34]}),freeResult=initializeProbeEntry(free,c.frame);vector(probePose(freeResult,c.frame).originMm,free.originMm);near(freeResult.depthMm,free.depthMm);
  const selectedLater={...c.state,depthMm:c.legacyState.depthMm};assert.equal(initializeProbeEntry(selectedLater,c.frame),selectedLater);
  vector(defaultOrigin(c.frame,c.state.depthMm),c.pose.originMm);vector(defaultOrigin(c.frame,80*c.scale),c.pose.originMm);
 }
 report.checks.push('Custom depth/free bookmarks remain explicit; changing imaging depth cannot push a calibrated contact tip into tissue.');
});

test('write the focused geometry audit only when requested',async()=>{
 const output=process.argv.find(v=>v.startsWith('--report='))?.slice(9);if(!output)return;
 await mkdir(output.slice(0,output.lastIndexOf('/')),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
});
