import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DONORS} from '../public/donors.js';
import {decodeEchoReferenceAnatomy,createEchoAnatomyContext} from '../public/echo-anatomy-context-v2.js';
import {buildDonorEchoFrames} from '../public/echo-donor-planes.js';
import {createSkinContactSurface,nearestSkinContact,skinContactFrame,moveOnSkin} from '../public/probe-skin-contact.js';
import {volumeGeometry,PROBE_PRESETS,sanitizeProbeState,probePose,probeCapPlane,moveProbeState} from '../public/probe-geometry.js';
import {donorOverviewCamera,donorOverviewPose,donorOverviewSector} from '../public/probe-overview.js';
import {labProbeDisplayScale,probeModelMatrix} from '../public/probe-scene.js';
import {ProbeLabModule} from '../public/probe-lab.js';

// Use the actual donor frames and verified skin. A +v assertion against a
// synthetic plane cannot catch the original inverted / preset-relative WASD.
const read=url=>readFileSync(new URL('../public/'+url.replace(/^\.\//,'').split('?')[0],import.meta.url));
const dot=(a,b)=>a.reduce((n,x,i)=>n+x*b[i],0),sub=(a,b)=>a.map((x,i)=>x-b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const distance=(a,b)=>Math.hypot(...sub(a,b));
const reference=await decodeEchoReferenceAnatomy({manifestBytes:read('assets/probe-context-v11/manifest.json'),compressedBytes:read('assets/probe-context-v11/torso.bin.gz')});
const fixtures=DONORS.map(donor=>{
 const manifest=JSON.parse(read(donor.manifestUrl)),meta=manifest.levels.low||Object.values(manifest.levels)[0],geometry=volumeGeometry(meta),input=JSON.parse(read(donor.echoPlanesUrl)),source=input.frames||input.planes;
 const frames=buildDonorEchoFrames(Object.fromEntries(Object.entries(source).map(([id,f])=>[id,f.world||f])),{donorId:donor.id,referenceMm:geometry.longestMm});
 const model=createEchoAnatomyContext({referenceAnatomy:reference,frames,donorId:donor.id,referenceMm:geometry.longestMm});
 return {donor,geometry,frames,model,surface:createSkinContactSurface(model)};
});
const presets=PROBE_PRESETS.filter(p=>p.id!=='atrial');
const originalDocument=globalThis.document,originalRaf=globalThis.requestAnimationFrame;
test.before(()=>{globalThis.document={activeElement:null,hidden:false};globalThis.requestAnimationFrame=()=>1;});
test.after(()=>{if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;if(originalRaf===undefined)delete globalThis.requestAnimationFrame;else globalThis.requestAnimationFrame=originalRaf;});

function labFor(f,preset){
 const lab={active:true,frames:f.frames,geometry:f.geometry,torsoView:{model:f.model,camera:{yaw:0,pitch:0,roll:0,distance:2,pan:[0,0,0]}},state:sanitizeProbeState({preset:preset.id,referenceMm:f.geometry.longestMm,contactPositionMm:[0,0]}),keys:new Set(),pointerControls:new Map(),lastTick:0,lastUI:0,
  $:()=>null,drawGuide(){},updateUI(){},updateKeyFeedback(){},poseChanged(){this.ensureOrigin();}};
 for(const name of ['frameForState','ensureOrigin','getPose','nudgeKey','keyDown','activeSteeringKeys','fineSteering','tick'])lab[name]=ProbeLabModule.prototype[name];
 lab.ensureOrigin();return lab;
}
function press(lab,code){
 const event={code,key:code.slice(3).toLowerCase(),target:null,preventDefault(){this.defaultPrevented=true;},stopPropagation(){}};
 lab.keyDown(event);assert.equal(event.defaultPrevented,true);return event;
}
function screen(point,camera){
 const relative=sub(point.map(v=>v/camera.referenceMm),camera.eye),depth=dot(relative,camera.forward);
 assert.ok(depth>0);return [dot(relative,camera.right)/depth,dot(relative,camera.up)/depth];
}
function assertSharedPose(lab,f){
 const pose=lab.getPose(),plane=probeCapPlane(pose,f.geometry);
 assert.equal(donorOverviewPose(pose),pose);
 assert.ok(nearestSkinContact(f.surface,pose.originMm).distance<1e-5);
 for(const point of donorOverviewSector(pose,lab.state))assert.ok(Math.abs(dot(point.map(v=>v/f.geometry.longestMm),plane.normal)-dot(plane.center,plane.normal))<1e-6);
 const matrix=probeModelMatrix(pose,labProbeDisplayScale(f.geometry.longestMm));
 assert.ok(distance(Array.from(matrix.subarray(12,15)),pose.originMm)<1e-4);
}

test('actual WASD taps and held keys move in head/feet and front/oblique screen directions for every donor and external preset',()=>{
 for(const f of fixtures)for(const preset of presets)for(const [code,axis,sign,screenAxis]of [['KeyW','superior',1,1],['KeyS','superior',-1,1],['KeyA','left',-1,0],['KeyD','left',1,0]]){
  const lab=labFor(f,preset),start=lab.getPose(),cameras=['front','oblique'].map(mode=>donorOverviewCamera(f.model,440/500,mode));
  const name=`${f.donor.id} / ${preset.id} / ${code}`;press(lab,code);
  const tapped=lab.getPose();assert.ok(dot(sub(tapped.originMm,start.originMm),f.model.frame[axis])*sign>.1,name+' tap follows the chest');
  lab.tick(40);const held=lab.getPose();assert.ok(dot(sub(held.originMm,tapped.originMm),f.model.frame[axis])*sign>.1,name+' hold follows the same direction');
  for(const camera of cameras){const a=screen(start.originMm,camera),b=screen(held.originMm,camera);assert.ok((b[screenAxis]-a[screenAxis])*sign>0,name+' matches the displayed direction');}
  lab.keys.clear();const stopped=[...held.originMm];lab.tick(80);assert.deepEqual(lab.getPose().originMm,stopped);assertSharedPose(lab,f);
 }
});

test('sliding is independent of probe rotation and either camera and keeps all source geometry fixed',()=>{
 for(const f of fixtures)for(const preset of presets){
  const baseline=labFor(f,preset),rotated=labFor(f,preset),beforeFrames=JSON.stringify(f.frames),skinBytes=f.surface.vertices.slice();
  rotated.state={...rotated.state,sweepDeg:31,tiltDeg:-24,rollDeg:90};rotated.torsoView.camera={yaw:2.4,pitch:-.7,roll:.3,distance:5,pan:[.2,.8,-.5]};
  const camera=JSON.stringify(rotated.torsoView.camera),angles=[rotated.state.sweepDeg,rotated.state.tiltDeg,rotated.state.rollDeg];
  for(const code of ['KeyW','KeyD','KeyS','KeyA']){
   baseline.nudgeKey(code);rotated.nudgeKey(code);assert.ok(distance(baseline.getPose().originMm,rotated.getPose().originMm)<1e-9);assertSharedPose(rotated,f);
  }
  assert.equal(JSON.stringify(rotated.torsoView.camera),camera);assert.deepEqual([rotated.state.sweepDeg,rotated.state.tiltDeg,rotated.state.rollDeg],angles);
  assert.equal(JSON.stringify(f.frames),beforeFrames);assert.deepEqual(f.surface.vertices,skinBytes);
 }
});

test('opposite controls cancel, reverse paths return within skin-mesh precision, and position buttons share the accepted movement',()=>{
 for(const f of fixtures)for(const preset of presets)for(const [forward,backward,axis]of [['KeyW','KeyS','advance'],['KeyD','KeyA','lateral']]){
  const lab=labFor(f,preset),start=lab.getPose(),state=lab.state,step=f.geometry.longestMm/168.0104;
  for(let i=0;i<5;i++)lab.nudgeKey(forward);
  const buttonPose=probePose(moveProbeState(state,lab.frameForState(),{[axis]:1},5*step),lab.frameForState());
  assert.ok(distance(lab.getPose().originMm,buttonPose.originMm)<.1,'5 mm button and matching key motion use the same skin surface');
  for(let i=0;i<5;i++)lab.nudgeKey(backward);
  assert.ok(distance(lab.getPose().originMm,start.originMm)<.15,'Opposite moves reverse within 0.15 mm on triangulated skin');
  const before=[...lab.getPose().originMm];lab.keys=new Set([forward,backward]);lab.tick(40);assert.deepEqual(lab.getPose().originMm,before);assertSharedPose(lab,f);
 }
});

test('headward sliding continues on visible side and rear skin without a preset patch boundary',()=>{
 for(const f of fixtures){
  const selected={};
  for(let at=0;at<f.surface.vertices.length;at+=18){
   const v=f.surface.vertices,point=[0,1,2].map(k=>(v[at+k]+v[at+k+6]+v[at+k+12])/3),hit=nearestSkinContact(f.surface,point),anterior=dot(hit.outward,f.model.frame.anterior);
   if(Math.abs(dot(hit.outward,f.model.frame.superior))>.3)continue;
   const region=anterior>.8?'front':anterior<-.8?'rear':Math.abs(anterior)<.25?'side':null;
   if(region&&!selected[region])selected[region]=skinContactFrame(f.surface,hit,f.model.frame.left);
   if(Object.keys(selected).length===3)break;
  }
  assert.equal(Object.keys(selected).length,3);
  for(const [region,contact]of Object.entries(selected)){
   const moved=moveOnSkin(f.surface,contact,{advance:1},2);
   assert.ok(dot(sub(moved.pointMm,contact.pointMm),f.model.frame.superior)>1,`${f.donor.id} headward on ${region}`);
   assert.ok(nearestSkinContact(f.surface,moved.pointMm).distance<1e-5);
  }
 }
});

test('rotate, tilt and fan retain matching physical signs, inverse pairs, and a fixed contact point',()=>{
 for(const f of fixtures)for(const preset of presets)for(const [code,other,axis,sign]of [['KeyE','KeyQ','roll',1],['KeyQ','KeyE','roll',-1],['KeyI','KeyK','tilt',1],['KeyK','KeyI','tilt',-1],['KeyL','KeyJ','sweep',1],['KeyJ','KeyL','sweep',-1]]){
  const lab=labFor(f,preset);lab.state={...lab.state,sweepDeg:0,tiltDeg:0,rollDeg:0};const start=lab.getPose();
  lab.nudgeKey(code);const moved=lab.getPose();assert.deepEqual(moved.originMm,start.originMm);
  const direction=axis==='roll'?dot(cross(start.right,moved.right),start.beam):axis==='tilt'?dot(sub(moved.beam,start.beam),start.normal):dot(sub(moved.beam,start.beam),start.right);
  assert.ok(direction*sign>.01,`${code} follows its physical ${axis} axis`);
  lab.nudgeKey(other);const restored=lab.getPose();assert.ok(distance(restored.right,start.right)<1e-9);assert.ok(distance(restored.beam,start.beam)<1e-9);assertSharedPose(lab,f);
 }
});

test('mouse steering directions agree with the matching rotation, tilt and fan keys',()=>{
 for(const f of fixtures)for(const preset of presets)for(const [code,x,y,fan]of [['KeyE',6.25,0,false],['KeyQ',-6.25,0,false],['KeyI',0,-6.25,false],['KeyK',0,6.25,false],['KeyL',6.25,0,true],['KeyJ',-6.25,0,true]]){
  const keyboard=labFor(f,preset),mouse=labFor(f,preset);
  keyboard.nudgeKey(code);ProbeLabModule.prototype.mouseMove.call(mouse,x,y,fan,false);
  const a=keyboard.getPose(),b=mouse.getPose();assert.deepEqual(a.originMm,b.originMm);assert.ok(distance(a.right,b.right)<1e-9);assert.ok(distance(a.beam,b.beam)<1e-9);
 }
});
