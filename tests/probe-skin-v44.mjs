import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DONORS} from '../public/donors.js';
import {decodeEchoReferenceAnatomy,createEchoAnatomyContext} from '../public/echo-anatomy-context-v2.js';
import {buildDonorEchoFrames} from '../public/echo-donor-planes.js';
import {createSkinContactSurface,nearestSkinContact,raycastSkin,skinContactFrame,initialSkinContact,moveOnSkin} from '../public/probe-skin-contact.js';
import {volumeGeometry,PROBE_PRESETS,defaultOrigin,sanitizeProbeState,probePose,moveProbeState,probeCapPlane} from '../public/probe-geometry.js';
import {donorOverviewPose,donorOverviewSector} from '../public/probe-overview.js';
import {labProbeDisplayScale,probeModelMatrix,ReferenceTorsoView} from '../public/probe-scene.js';
import {ProbeLabModule} from '../public/probe-lab.js';
const read=url=>readFileSync(new URL('../public/'+url.replace(/^\.\//,'').split('?')[0],import.meta.url));
const dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0),sub=(a,b)=>a.map((v,i)=>v-b[i]),norm=v=>{const n=Math.hypot(...v);return v.map(x=>x/n);};
const reference=await decodeEchoReferenceAnatomy({manifestBytes:read('assets/probe-context-v11/manifest.json'),compressedBytes:read('assets/probe-context-v11/torso.bin.gz')});
const fixtures=DONORS.map(donor=>{
 const manifest=JSON.parse(read(donor.manifestUrl)),meta=manifest.levels.low||Object.values(manifest.levels)[0],geometry=volumeGeometry(meta),input=JSON.parse(read(donor.echoPlanesUrl)),source=input.frames||input.planes;
 const frames=buildDonorEchoFrames(Object.fromEntries(Object.entries(source).map(([id,f])=>[id,f.world||f])),{donorId:donor.id,referenceMm:geometry.longestMm});
 const model=createEchoAnatomyContext({referenceAnatomy:reference,frames,donorId:donor.id,referenceMm:geometry.longestMm});return {donor,geometry,frames,model,surface:createSkinContactSurface(model)};
});
test('every displayed skin triangle is selectable and belongs to the unchanged donor frame',()=>{
 for(const f of fixtures){
  const v=f.surface.vertices;
  for(let at=0;at<v.length;at+=18*19){
   const point=[0,1,2].map(k=>(v[at+k]+v[at+k+6]+v[at+k+12])/3),nearest=nearestSkinContact(f.surface,point);
   assert.ok(nearest.distance<1e-5);assert.equal(nearest.sourceKey,f.surface.key);
   const from=point.map((p,i)=>p+nearest.outward[i]*2),ray=raycastSkin(f.surface,from,nearest.outward.map(x=>-x));
   assert.ok(ray);assert.ok(ray.distance<2.001);
  }
 }
});
test('sliding crosses the old 55 by 45 mm patch and remains on actual skin',()=>{
 for(const f of fixtures){
  const frame={...f.frames.a4c,referenceMm:f.geometry.longestMm},start=initialSkinContact(f.surface,frame,defaultOrigin(frame,145)),contact=skinContactFrame(f.surface,nearestSkinContact(f.surface,start.pointMm),f.model.frame.left);
  let farthest=0;
  for(const inputs of [{lateral:1},{lateral:-1},{advance:1},{advance:-1}]){
   let current=contact;
   for(let step=0;step<200;step++){
    const next=moveOnSkin(f.surface,current,inputs,2);
    assert.ok(Math.hypot(...sub(next.pointMm,current.pointMm))<=2.05);
    assert.ok(nearestSkinContact(f.surface,next.pointMm).distance<1e-5);
    assert.ok(Math.abs(dot(next.right,next.inward))<1e-6);assert.ok(Math.abs(dot(next.normal,next.inward))<1e-6);
    farthest=Math.max(farthest,Math.hypot(...sub(next.pointMm,contact.pointMm)));current=next;
   }
  }
  assert.ok(farthest>100,`${f.donor.id} must move beyond the retired patch: ${farthest}`);
 }
});
test('slid and picked skin poses share exact origin, instrument scale, sector and source plane',()=>{
 for(const f of fixtures)for(const preset of PROBE_PRESETS.filter(p=>p.id!=='atrial')){
  const frame={...f.frames[preset.frame],referenceMm:f.geometry.longestMm,skinContactSurface:f.surface},contact=initialSkinContact(f.surface,frame,defaultOrigin(frame,145)),state=sanitizeProbeState({preset:preset.id,referenceMm:f.geometry.longestMm,contactLocked:true,skinContact:contact});
  const moved=moveProbeState(state,frame,{lateral:1,advance:1},85),pose=probePose(moved,frame),plane=probeCapPlane(pose,f.geometry),sector=donorOverviewSector(pose,moved);
  assert.equal(donorOverviewPose(pose),pose);assert.ok(nearestSkinContact(f.surface,pose.originMm).distance<1e-5);
  for(const point of sector)assert.ok(Math.abs(dot(point.map(x=>x/f.geometry.longestMm),plane.normal)-dot(plane.center,plane.normal))<1e-6);
  const matrix=probeModelMatrix(pose,labProbeDisplayScale(f.geometry.longestMm));assert.ok(Math.hypot(...sub(Array.from(matrix.subarray(12,15)),pose.originMm))<1e-4);
  assert.ok(labProbeDisplayScale(f.geometry.longestMm)>.9);
 }
});
test('each TTE start adopts the skin without moving the fixed heart or chest',()=>{
 for(const f of fixtures)for(const preset of PROBE_PRESETS.filter(p=>p.id!=='atrial')){
  const lab={frames:f.frames,geometry:f.geometry,torsoView:{model:f.model},state:sanitizeProbeState({preset:preset.id,referenceMm:f.geometry.longestMm,contactPositionMm:[0,0]}),frameForState:ProbeLabModule.prototype.frameForState};
  ProbeLabModule.prototype.ensureOrigin.call(lab);
  const pose=probePose(lab.state,lab.frameForState());assert.ok(nearestSkinContact(f.surface,pose.originMm).distance<1e-5);assert.ok(dot(pose.beam,pose.contact.inward)>0);
  const target=f.frames[preset.frame].center.map(v=>v*f.geometry.longestMm),targetRay=norm(sub(target,pose.originMm));assert.ok(dot(pose.beam,targetRay)>.99,'Starting beam still reaches its source target');
 }
});
test('overview picking uses its own camera ray and does not move the camera',()=>{
 const f=fixtures[0],contact=initialSkinContact(f.surface,{...f.frames.a4c,referenceMm:f.geometry.longestMm},[0,0,0]);
 const hit=nearestSkinContact(f.surface,contact.pointMm),eye=hit.pointMm.map((x,i)=>x+hit.outward[i]*30),forward=hit.outward.map(x=>-x),right=contact.right,up=contact.normal;let selected;
 const view={model:f.model,cameraReady:true,normalizationMm:1,canvas:{getBoundingClientRect:()=>({left:0,top:0,width:400,height:500})},basis:()=>({eye,forward,right,up}),onContact:h=>{selected=h;}};
 ReferenceTorsoView.prototype.pickContact.call(view,200,250);assert.ok(selected);const selectedRay=sub(selected.pointMm,eye);assert.ok(dot(norm(selectedRay),forward)>.999999);assert.ok(Math.hypot(...selectedRay)<=30.001);assert.ok(nearestSkinContact(f.surface,selected.pointMm).distance<1e-5);assert.deepEqual(view.basis().eye,eye);
});
