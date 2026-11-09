import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {DONORS} from '../public/donors.js';
import {ProbeLabModule} from '../public/probe-lab.js';
import {PROBE_PRESETS,PROBE_REFERENCE_MM,probePhysicalScale,volumeGeometry,sanitizeProbeState,probePose,probeContactSurface,contactFrame,setProbeContactLocked,sectorPoint} from '../public/probe-geometry.js';
import {PROBE_VISUAL_SCALE,REFERENCE_PROBE_VISUAL_SCALE,probeDisplayScale,probeModelMatrix,createProbeMeshes,createReferenceProbeMeshes,referenceTorsoPose,probeIndicatorPosition,ReferenceTorsoView} from '../public/probe-scene.js';

// v43 supersedes the old per-preset reference mapping: donor-world pose is
// exact in both views. The production rendering call is checked independently.
// It does not inspect CSS pixels or claim anatomical donor/torso registration.
const report={scope:'Numerical pose, geometry and production render-call audit. The torso is illustrative, not donor-registered. No browser or clinical validation.',checks:[],presets:[],poseCases:0,maximumDirectionError:0,maximumPositionErrorMm:0};
const audit=(name,run)=>test(name,async()=>{try{await run();report.checks.push({name,passed:true});}catch(error){report.checks.push({name,passed:false,error:error.message});throw error;}});
const sub=(a,b)=>a.map((v,i)=>v-b[i]),add=(a,b)=>a.map((v,i)=>v+b[i]),mul=(v,k)=>v.map(x=>x*k),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],length=v=>Math.hypot(...v),unit=v=>mul(v,1/length(v));
const near=(a,b,tolerance=1e-6,message='')=>assert.ok(Math.abs(a-b)<=tolerance,`${message} ${a} != ${b}`);
const nearVector=(a,b,tolerance=1e-6,message='')=>{assert.equal(a.length,b.length);a.forEach((v,i)=>near(v,b[i],tolerance,`${message}[${i}]`));};
const anchors={apical:[76,-48],parasternal:[26,25],'short-axis':[29,5],atrial:[7,28]};
const manifest=JSON.parse(await readFile('public/assets/probe-context-v11/manifest.json','utf8'));
const fixtures=[];
for(const donor of DONORS){
 const input=JSON.parse(await readFile('public/'+donor.echoPlanesUrl.replace(/^\.\//,'').split('?')[0],'utf8'));
 const data=JSON.parse(await readFile('public/'+donor.manifestUrl.replace(/^\.\//,''),'utf8'));
 const level=data.levels[data.defaultLevel]||Object.values(data.levels).at(-1),geometry=volumeGeometry(level);
 const entries=input.frames||input.planes||input,frames=Array.isArray(entries)?Object.fromEntries(entries.map(x=>[x.id,x])):entries;
 for(const preset of PROBE_PRESETS){
  const item=frames[preset.frame],frame={...(item.world||item),referenceMm:geometry.longestMm};
  const factor=geometry.longestMm/PROBE_REFERENCE_MM;
  const state=sanitizeProbeState({preset:preset.id,referenceMm:geometry.longestMm,depthMm:preset.depthMm*factor,angleDeg:preset.angleDeg,contactLocked:true,contactPositionMm:[0,0]});
  fixtures.push({donor,preset,frame,geometry,state,surface:probeContactSurface(preset.id,frame)});
 }
}

function anchorFor(preset){
 const [x,y]=anchors[preset],g=manifest.skinHeight;
 if(preset==='atrial')return [x,y,-28];
 const u=(x-g.xRange[0])/(g.xRange[1]-g.xRange[0])*(g.width-1),v=(y-g.yRange[0])/(g.yRange[1]-g.yRange[0])*(g.height-1),i=Math.floor(u),j=Math.floor(v),fu=u-i,fv=v-j;
 const top=g.values[j*g.width+i]*(1-fu)+g.values[j*g.width+i+1]*fu,bottom=g.values[(j+1)*g.width+i]*(1-fu)+g.values[(j+1)*g.width+i+1]*fu;
 return [x,y,top*(1-fv)+bottom*fv];
}
function axisRotation(axis,angle){
 const [x,y,z]=unit(axis),c=Math.cos(angle),s=Math.sin(angle),d=1-c;
 const rows=[[c+x*x*d,x*y*d-z*s,x*z*d+y*s],[y*x*d+z*s,c+y*y*d,y*z*d-x*s],[z*x*d-y*s,z*y*d+x*s,c+z*z*d]];
 return vector=>rows.map(row=>dot(row,vector));
}
function expectedMapping(fixture){
 const source=contactFrame(fixture.surface,0,0);
 return {anchor:source.pointMm,direction:v=>[...v],point:p=>[...p],targetBeam:source.inward,targetRight:source.right};
}

function assertMapped(fixture,state,pose){
 const expected=expectedMapping(fixture),before=JSON.stringify({state,pose,surface:fixture.surface});
 const actual=referenceTorsoPose(state,manifest,fixture.surface,pose);assert.ok(actual);
 const positionError=length(sub(actual.originMm,expected.point(pose.originMm)));report.maximumPositionErrorMm=Math.max(report.maximumPositionErrorMm,positionError);assert.ok(positionError<2e-5,`Position drift in ${fixture.donor.id}:${fixture.preset.id}: ${positionError}`);
 for(const name of ['right','beam','normal','up']){
  assert.ok(Array.isArray(actual[name])&&actual[name].every(Number.isFinite),`${name} must be a finite vector`);
  const error=length(sub(actual[name],expected.direction(pose[name])));report.maximumDirectionError=Math.max(report.maximumDirectionError,error);assert.ok(error<2e-6,`${name} drift in ${fixture.donor.id}:${fixture.preset.id}: ${error}`);
  near(length(actual[name]),1,2e-6,`${name} length`);
 }
 near(dot(actual.right,actual.beam),0,2e-6);near(dot(actual.right,actual.normal),0,2e-6);near(dot(actual.normal,actual.beam),0,2e-6);
 nearVector(cross(actual.beam,actual.right),actual.normal,2e-6,'Normal handedness');nearVector(actual.up,mul(actual.beam,-1),2e-6,'Outward direction');
 assert.equal(JSON.stringify({state,pose,surface:fixture.surface}),before,'Mapping must not mutate source pose, state or surface');report.poseCases++;
 return actual;
}
function meshHash(meshes){const hash=createHash('sha256');for(const mesh of meshes){hash.update(Buffer.from(mesh.vertices.buffer,mesh.vertices.byteOffset,mesh.vertices.byteLength));hash.update(JSON.stringify({color:mesh.color,gloss:mesh.gloss}));}return hash.digest('hex');}

audit('original main instrument bytes, 0.40 scale and raised reference marker mesh remain unchanged',()=>{
 const previous={phased:'72c97a38ea4c6e5bb97d2c460407319e340a1cd63a57e459a56044ea1f575152',tee:'4e01ca189606208099f5cdbde0d9589f7600ce662314331b206948dff065f1a3'};
 assert.equal(PROBE_VISUAL_SCALE,.4);assert.equal(REFERENCE_PROBE_VISUAL_SCALE,1.2);
 for(const kind of ['phased','tee']){
  const main=createProbeMeshes(kind),reference=createReferenceProbeMeshes(kind);assert.equal(meshHash(main),previous[kind],`${kind}: middle-column geometry/material changed`);assert.notEqual(meshHash(reference),previous[kind]);
  assert.ok(reference.every(mesh=>mesh.vertices.length>0&&[...mesh.vertices].every(Number.isFinite)));
 }
 for(const f of fixtures)near(probeDisplayScale(f.geometry.longestMm),probePhysicalScale(f.geometry.longestMm)*.4,1e-12);
 report.mainMeshSha256=previous;report.mainLinearScale=PROBE_VISUAL_SCALE;report.legacyReferenceLinearScale=REFERENCE_PROBE_VISUAL_SCALE;report.activeOverviewInstrumentScale='Same probeDisplayScale(referenceMm) as the main donor view.';
});

audit('all 12 donor presets retain their exact donor-world acoustic tip and axes',()=>{
 assert.equal(fixtures.length,12);
 for(const f of fixtures){
  const pose=probePose(f.state,f.frame),mapped=assertMapped(f,f.state,pose),expected=expectedMapping(f);
  nearVector(mapped.originMm,expected.anchor,2e-5);nearVector(mapped.beam,expected.targetBeam,2e-6);nearVector(mapped.right,expected.targetRight,2e-6);
  const matrix=probeModelMatrix(pose,probeDisplayScale(f.geometry.longestMm));nearVector(Array.from(matrix.slice(12,15)),pose.originMm,1e-5);
  report.presets.push(`${f.donor.id}:${f.preset.id}`);
 }
});

audit('contact movement and combined pan, tilt and rotation use one fixed mapping without retargeting',()=>{
 for(const f of fixtures){
  for(const uv of [[0,0],[.55,-.35],[-.65,.45],[.3,.7]])for(const angles of [[0,0,0],[20,17,34],[-35,26,-92],[61,-58,175]]){
   const state=sanitizeProbeState({...f.state,contactPositionMm:[f.surface.limitU*uv[0],f.surface.limitV*uv[1]],sweepDeg:angles[0],tiltDeg:angles[1],rollDeg:angles[2]});
   assertMapped(f,state,probePose(state,f.frame));
  }
 }
});

audit('lock-to-free transition preserves the same reference pose and free translations remain visible',()=>{
 for(const f of fixtures){
  const state=sanitizeProbeState({...f.state,contactPositionMm:[f.surface.limitU*.45,f.surface.limitV*.4],sweepDeg:20,tiltDeg:17,rollDeg:34});
  const locked=probePose(state,f.frame),leftLocked=assertMapped(f,state,locked),free=setProbeContactLocked(state,f.frame,false),freePose=probePose(free,f.frame),leftFree=assertMapped(f,free,freePose);
  nearVector(freePose.originMm,locked.originMm,1e-7);nearVector(freePose.beam,locked.beam,2e-6);nearVector(freePose.right,locked.right,2e-6);
  for(const key of ['originMm','beam','right','normal'])nearVector(leftFree[key],leftLocked[key],2e-6,`${key} lock toggle`);
  for(const axis of ['right','beam','normal']){
   const distance=20*probePhysicalScale(f.state.referenceMm),moved={...free,originMm:add(freePose.originMm,mul(freePose[axis],distance))},pose=probePose(moved,f.frame),mapped=assertMapped(f,moved,pose);
   const delta=sub(mapped.originMm,leftFree.originMm);near(length(delta),distance,2e-5,`Free ${axis} translation`);nearVector(unit(delta),leftFree[axis],2e-6);
   nearVector(mapped.beam,leftFree.beam,2e-6,'Free motion must not retarget beam');
  }
 }
});

audit('supplied displayed pose is authoritative even with inconsistent live-state angles or stale contact UV',()=>{
 for(const f of fixtures){
  const base=probePose(f.state,f.frame),state={...f.state,contactPositionMm:[f.surface.limitU*.8,f.surface.limitV*.2],sweepDeg:43,tiltDeg:-50,rollDeg:124,contactLocked:false};
  const unchanged=assertMapped(f,state,base),initial=assertMapped(f,f.state,base);
  for(const key of ['originMm','right','beam','normal','up'])nearVector(unchanged[key],initial[key],2e-6,key);
  assert.equal(referenceTorsoPose(state,manifest,f.surface),null,'Missing source pose must not silently invent a separate pose');
  assert.equal(referenceTorsoPose(state,manifest,null,base),base,'The authoritative donor pose no longer needs a separate reference calibration.');
 }
});

audit('raised markers stay on negative probe-right and correspond to the left half of the ultrasound sector',()=>{
 const points={phased:{main:[-12.8,0,12.2],reference:[-15.3,0,14]},tee:{main:[-4.9,-6,5],reference:[-6.9,-6,5]}};
 for(const f of fixtures){
  const state=sanitizeProbeState({...f.state,sweepDeg:26,tiltDeg:-21,rollDeg:72}),pose=probePose(state,f.frame),mapped=referenceTorsoPose(state,manifest,f.surface,pose),kind=f.preset.id==='atrial'?'tee':'phased';
  for(const [reference,current,scale] of [[false,pose,probeDisplayScale(f.state.referenceMm)],[true,mapped,REFERENCE_PROBE_VISUAL_SCALE]]){
   const marker=probeIndicatorPosition(current,kind,scale,reference),delta=sub(marker,current.originMm),local=[dot(delta,current.right)/scale,dot(delta,current.normal)/scale,-dot(delta,current.beam)/scale];
   nearVector(local,points[kind][reference?'reference':'main'],2e-6);assert.ok(dot(delta,current.right)<0,'Indicator must stay on -right');
  }
  const screenLeft=sectorPoint(pose,state,.35,.5),screenRight=sectorPoint(pose,state,.65,.5);assert.equal(screenLeft.inside,true);assert.equal(screenRight.inside,true);
  assert.ok(dot(sub(screenLeft.pointMm,pose.originMm),pose.right)<0);assert.ok(dot(sub(screenRight.pointMm,pose.originMm),pose.right)>0);
 }
 for(const kind of ['phased','tee']){
  const center=points[kind].reference,reference=createReferenceProbeMeshes(kind);let nearest=Infinity;
  for(const mesh of reference){if(!(mesh.color[0]>mesh.color[2]+.15))continue;for(let i=0;i<mesh.vertices.length;i+=6)nearest=Math.min(nearest,length(sub(Array.from(mesh.vertices.slice(i,i+3)),center)));}
  assert.ok(nearest<5,`${kind} visible warm marker geometry must coincide with its indicator anchor`);
 }
 report.markerConvention='Local -X = -pose.right = negative sector lateral = image-left. No camera-facing or marker polarity flip.';
});

audit('production drawGuide passes the identical displayed snapshot to torso and middle renderer',()=>{
 const f=fixtures[0],displayedState=sanitizeProbeState({...f.state,sweepDeg:16,tiltDeg:9,rollDeg:48}),displayedPose=probePose(displayedState,f.frame),liveState={...f.state,preset:'parasternal',rollDeg:-40,showGuide:false,showSurface:false};
 const context={setTransform(){},clearRect(){}},guide={style:{},getContext:()=>context},scene={style:{}},rect={width:720,height:680,left:0,top:0},seen={};let livePoseReads=0;
 const fixture={active:true,geometry:f.geometry,displayedId:14,poseRevision:17,state:liveState,displayedFrame:{pose:displayedPose,state:displayedState},
  mount:{querySelector:()=>({getBoundingClientRect:()=>rect})},$:(name)=>name==='guide'?guide:name==='scene-mesh'?scene:null,
  renderer:{canvas:{getBoundingClientRect:()=>rect},camera:{pan:[0,0,0],yaw:0,pitch:0,roll:0,distance:3},basis:()=>({eye:[0,0,3],right:[1,0,0],up:[0,1,0],forward:[0,0,-1]})},
  getPose(){livePoseReads++;return probePose(liveState,f.frame);},frameForState(state){assert.equal(state,displayedState);return f.frame;},
  sceneOverlay:{render(args){seen.middle=args;}},torsoView:{revision:0,render(args){seen.reference=args;}}
 };
 ProbeLabModule.prototype.drawGuide.call(fixture);assert.equal(livePoseReads,0);assert.ok(seen.middle&&seen.reference);
 assert.equal(seen.middle.pose,displayedPose);assert.equal(seen.reference.pose,displayedPose);assert.equal(seen.middle.state,displayedState);assert.equal(seen.reference.state,displayedState);assert.equal(seen.reference.surface,seen.middle.surface);
 report.snapshotSource='Both render calls receive the same displayedFrame.pose, displayedFrame.state and generated contact surface, even while live controls point to a different preset.';
});

audit('reference renderer consumes exact donor pose and matching main instrument scale',()=>{
 for(const f of fixtures.filter(x=>x.donor.id===DONORS[0].id)){
  const state=sanitizeProbeState({...f.state,contactPositionMm:[f.surface.limitU*.4,-f.surface.limitV*.2],sweepDeg:16,tiltDeg:23,rollDeg:-51}),pose=probePose(state,f.frame),draws=[],referenceMm=f.state.referenceMm*2.5,scale=probeDisplayScale(f.state.referenceMm);
  let indicator=null;const basis={eye:[0,0,2],forward:[0,0,-1],right:[1,0,0],up:[0,1,0]},fakeMesh={count:3},reference={model:{referenceMm:f.state.referenceMm},cameraReady:true,normalizationMm:referenceMm,canvas:{clientWidth:440,clientHeight:600},cameraMode:'manual',meshes:[],probe:{phased:[fakeMesh],tee:[fakeMesh]},basis:()=>basis,onIndicator(point){indicator=point;},view:{gl:{depthRange(){}},begin(){},remove(){},upload:()=>({}),draw(mesh,matrix){draws.push({mesh,matrix});}}};
  ReferenceTorsoView.prototype.render.call(reference,{state,pose,surface:f.surface,referenceMm:f.state.referenceMm});
  const draw=draws.find(x=>x.mesh===fakeMesh);assert.ok(draw,'Reference probe must be rendered');
  nearVector(Array.from(draw.matrix.slice(12,15)),pose.originMm,2e-5);
  nearVector(Array.from(draw.matrix.slice(0,3)),mul(pose.right,scale),2e-6);
  nearVector(Array.from(draw.matrix.slice(8,11)),mul(pose.beam,-scale),2e-6);
  assert.ok(indicator&&Number.isFinite(indicator.x)&&Number.isFinite(indicator.y));assert.equal(indicator.width,440);assert.equal(indicator.height,600);assert.equal(typeof indicator.farSide,'boolean');
  const local=f.preset.id==='atrial'?[-6.9,-6,5]:[-15.3,0,14],world=[0,1,2].map(i=>draw.matrix[12+i]+draw.matrix[i]*local[0]+draw.matrix[4+i]*local[1]+draw.matrix[8+i]*local[2]);
  const q=sub(mul(world,1/referenceMm),basis.eye),depth=dot(q,basis.forward);
  near(indicator.x,(.5+.5*dot(q,basis.right)/(depth*.32*(440/600)))*440,2e-5,'Rendered marker X');near(indicator.y,(.5-.5*dot(q,basis.up)/(depth*.32))*600,2e-5,'Rendered marker Y');
  const markerNormal=mul(Array.from(draw.matrix.slice(0,3)),-1/scale),viewVector=sub(mul(basis.eye,referenceMm),world);assert.equal(indicator.farSide,dot(markerNormal,viewVector)<0,'Far-side flag must describe the rendered marker');
 }
});

audit('production indicator callout tracks projected points, stays inside normal pane bounds and hides offscreen',async()=>{
 const domPath=process.argv.find(x=>x.startsWith('--dom='))?.slice(6)||'/workspace/data/heart-ui-test-v11/node_modules/linkedom/esm/index.js';
 const {parseHTML}=await import(pathToFileURL(domPath));
 const {document}=parseHTML('<html><body>'+ProbeLabModule.prototype.template.call({fineLabel:'79.4 µm'})+'</body></html>');
 const fixture={$:name=>document.querySelector(`[data-probe="${name}"]`)},overlay=fixture.$('torso-indicator'),dotNode=fixture.$('indicator-dot'),label=fixture.$('indicator-label');
 assert.ok(overlay&&dotNode&&label,'Production template must contain the indicator overlay');
 let checked=0;
 for(const [width,height] of [[220,280],[440,600],[800,900]])for(const [u,v] of [[0,0],[1,0],[0,1],[1,1],[.43,.58]])for(const farSide of [false,true]){
  const point={x:u*width,y:v*height,width,height,farSide};ProbeLabModule.prototype.updateTorsoIndicator.call(fixture,point);
  assert.equal(overlay.hasAttribute('hidden'),false);assert.equal(overlay.getAttribute('viewBox'),`0 0 ${width} ${height}`);
  near(Number(dotNode.getAttribute('cx')),point.x);near(Number(dotNode.getAttribute('cy')),point.y);
  const transform=label.getAttribute('transform').match(/^translate\(([-\d.]+) ([-\d.]+)\)$/);assert.ok(transform);
  const x=Number(transform[1]),y=Number(transform[2]),rect=label.querySelector('rect'),boxX=x+Number(rect.getAttribute('x')),boxY=y+Number(rect.getAttribute('y')),boxWidth=Number(rect.getAttribute('width')),boxHeight=Number(rect.getAttribute('height'));
  assert.ok(boxX>=0&&boxX+boxWidth<=width&&boxY>=0&&boxY+boxHeight<=height,'Callout box must stay inside the reference pane');
  assert.equal(overlay.classList.contains('is-far-side'),farSide);assert.equal(label.querySelector('text').textContent,farSide?'Indicator · Far Side':'Indicator');
  assert.ok(fixture.$('indicator-line').getAttribute('d').startsWith(`M ${point.x} ${point.y} L `),'Leader must begin at the supplied marker projection');checked++;
 }
 for(const point of [null,{x:-.01,y:30,width:440,height:600},{x:440.01,y:30,width:440,height:600},{x:30,y:-.01,width:440,height:600},{x:30,y:600.01,width:440,height:600}]){
  ProbeLabModule.prototype.updateTorsoIndicator.call(fixture,point);assert.equal(overlay.hasAttribute('hidden'),true);
 }
 ProbeLabModule.prototype.updateTorsoIndicator.call(fixture,{x:90,y:120,width:440,height:600,farSide:false});assert.equal(overlay.hasAttribute('hidden'),false);assert.equal(overlay.classList.contains('is-far-side'),false);
 const css=await readFile('public/probe-lab.css','utf8');assert.match(css,/\.probe-torso-indicator\.is-far-side\s+path\s*\{[^}]*stroke-dasharray:/);
 report.indicatorCallout={checkedPlacements:checked,normalPaneWidths:[220,440,800],offscreenHiddenCases:5,actualProductionTemplate:true,note:'DOM attributes, anchored coordinates, box bounds and dashed-class stylesheet verified; not browser font rasterization or CSS layout.'};
});

test.after(async()=>{
 report.passed=report.checks.length===9&&report.checks.every(x=>x.passed);
 await mkdir('docs/probe-overview-v43',{recursive:true});
 await writeFile('docs/probe-overview-v43/alignment-verification.json',JSON.stringify(report,null,2)+'\n');
});
