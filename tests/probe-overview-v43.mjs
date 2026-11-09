import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DONORS} from '../public/donors.js';
import {buildDonorEchoFrames} from '../public/echo-donor-planes.js';
import {decodeEchoReferenceAnatomy,createEchoAnatomyContext} from '../public/echo-anatomy-context-v2.js';
import {createTeeContextModel} from '../public/tee-context-geometry.js';
import {PROBE_PRESETS,volumeGeometry,sanitizeProbeState,probePose,probeContactSurface,probeCapPlane,probePresetDepth,initializeProbeEntry} from '../public/probe-geometry.js';
import {createDonorOverview,overviewSourcePointMm,overviewGrid,donorOverviewPose,donorOverviewSector,donorOverviewCamera,OVERVIEW_MAX_TRIANGLES} from '../public/probe-overview.js';
import {ReferenceTorsoView,ProbeSceneOverlay,labProbeDisplayScale as probeDisplayScale} from '../public/probe-scene.js';
import {ProbeLabModule} from '../public/probe-lab.js';

const read=url=>readFileSync(new URL('../public/'+url.replace(/^\.\//,'').split('?')[0],import.meta.url));
const digest=data=>createHash('sha256').update(data).digest('hex');
const near=(a,b,eps=1e-6)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);
const vnear=(a,b,eps=1e-6)=>a.forEach((v,i)=>near(v,b[i],eps));
const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,k)=>a.map(v=>v*k);
const reference=await decodeEchoReferenceAnatomy({manifestBytes:read('assets/probe-context-v11/manifest.json'),compressedBytes:read('assets/probe-context-v11/torso.bin.gz')});
const fixtures=DONORS.map(donor=>{
 const manifest=JSON.parse(read(donor.manifestUrl)),meta=manifest.levels.low||Object.values(manifest.levels)[0],geometry=volumeGeometry(meta),input=JSON.parse(read(donor.echoPlanesUrl)),source=input.frames||input.planes;
 const frames=buildDonorEchoFrames(Object.fromEntries(Object.entries(source).map(([id,f])=>[id,f.world||f])),{donorId:donor.id,referenceMm:geometry.longestMm});
 const context=createEchoAnatomyContext({referenceAnatomy:reference,frames,donorId:donor.id,referenceMm:geometry.longestMm});
 return {donor,meta,geometry,frames,context};
});

test('all three overviews reuse the exact fixed Echo skeleton/skin transform and never the generic heart',()=>{
 for(const f of fixtures){
  const tee=createEchoAnatomyContext({baseModel:createTeeContextModel({frames:f.frames,donorId:f.donor.id,referenceMm:f.geometry.longestMm}),referenceAnatomy:reference,frames:f.frames});
  assert.deepEqual(f.context.bodyTransform,tee.bodyTransform);
  for(const id of ['bodyparts3d-bones','bodyparts3d-spine','bodyparts3d-skin']){
   const a=f.context.meshes.find(m=>m.id===id).vertices,b=tee.meshes.find(m=>m.id===id).vertices;
   assert.equal(digest(new Uint8Array(a.buffer,a.byteOffset,a.byteLength)),digest(new Uint8Array(b.buffer,b.byteOffset,b.byteLength)));
  }
  assert.equal(f.context.provenance.referenceHeartDisplayed,false);
  assert.ok(!f.context.meshes.some(m=>/heart/.test(m.id)));
 }
});

test('12 starting views and moved/missed poses keep exact accepted donor-mm pose and sector',()=>{
 let starts=0,cases=0,missed=0;
 for(const f of fixtures){
  const contextHash=digest(new Uint8Array(f.context.meshes.find(m=>m.id==='bodyparts3d-bones').vertices.buffer));
  for(const preset of PROBE_PRESETS){
   const frame={...f.frames[preset.frame],referenceMm:f.geometry.longestMm},state=initializeProbeEntry(sanitizeProbeState({preset:preset.id,referenceMm:f.geometry.longestMm,depthMm:probePresetDepth(preset.id,frame),angleDeg:preset.angleDeg}),frame);
   starts++;
   for(const variation of [{},{contactPositionMm:[24,-17],sweepDeg:31,tiltDeg:-28,rollDeg:57},{contactLocked:false,originMm:[f.geometry.longestMm*2,0,0],tiltDeg:65,rollDeg:112},{contactLocked:false,originMm:[0,f.geometry.longestMm*2,0],sweepDeg:-50,tiltDeg:44}]){
    const current=sanitizeProbeState({...state,...variation}),pose=probePose(current,frame),copy=JSON.stringify({pose,current}),shown=donorOverviewPose(pose),sector=donorOverviewSector(shown,current),plane=probeCapPlane(pose,f.geometry);
    assert.equal(shown,pose,'No preset transform or target-following branch may replace the accepted snapshot');
    assert.equal(sector[0],pose.originMm);
    for(let i=1;i<sector.length;i++){
     const delta=sub(sector[i],pose.originMm);near(Math.hypot(...delta),current.depthMm,1e-6);near(dot(delta,pose.normal),0,1e-6);
     near(dot(mul(sector[i],1/f.geometry.longestMm),plane.normal),dot(plane.center,plane.normal),1e-6);
    }
    const half=current.angleDeg*Math.PI/360;
    vnear(sub(sector[1],pose.originMm),pose.beam.map((v,i)=>current.depthMm*(v*Math.cos(half)-pose.right[i]*Math.sin(half))));
    assert.equal(JSON.stringify({pose,current}),copy);
    if(variation.originMm){
     // Translations perpendicular to the plane remain translations relative
     // to every fixed donor landmark; neither miniature organ nor probe aims
     // itself back at a generic heart as the old reference mapping did.
     for(const point of Object.values(f.context.frame.landmarksMm))near(dot(sub(point,shown.originMm),shown.normal),dot(sub(point,pose.originMm),pose.normal));
     missed++;
    }
    cases++;
   }
  }
  assert.equal(digest(new Uint8Array(f.context.meshes.find(m=>m.id==='bodyparts3d-bones').vertices.buffer)),contextHash);
 }
 assert.equal(starts,12);assert.equal(cases,48);assert.equal(missed,24);
});

test('source outline uses exact voxel-center anisotropic world mapping and leaves original bytes intact',async()=>{
 const meta={dimensions:[31,25,23],spacingUm:[1000,1800,2400]},data=new Uint8Array(31*25*23);
 for(let z=0;z<23;z++)for(let y=0;y<25;y++)for(let x=0;x<31;x++)if(((x-18)/8)**2+((y-9)/6)**2+((z-12)/7)**2<1)data[x+31*(y+25*z)]=220;
 const before=digest(data);let yields=0;
 const mesh=await createDonorOverview(data,meta,{threshold:.28,maxGrid:32,yieldControl:async()=>{yields++;}});
 assert.ok(mesh.triangles>500&&mesh.triangles<=OVERVIEW_MAX_TRIANGLES);assert.ok(mesh.vertices.byteLength<=OVERVIEW_MAX_TRIANGLES*18*4);assert.ok(yields>2);assert.equal(digest(data),before);
 vnear(overviewSourcePointMm(meta,[0,0,0]),[-15,-26.4,21.6]);vnear(overviewSourcePointMm(meta,[30,24,22]),[15,26.4,-21.6]);
 const expectedCenter=overviewSourcePointMm(meta,[18,9,12]);vnear(mesh.bounds.center,expectedCenter,2);
 for(let i=0;i<mesh.vertices.length;i+=6){assert.ok(Array.from(mesh.vertices.subarray(i,i+6)).every(Number.isFinite));near(Math.hypot(...mesh.vertices.subarray(i+3,i+6)),1,2e-6);}
 assert.ok(overviewGrid(meta,1000).every(n=>n<=40));
});

test('outline cancellation prevents obsolete geometry from finishing',async()=>{
 const meta={dimensions:[24,24,24],spacingUm:1000},data=new Uint8Array(24**3).fill(100),controller=new AbortController();let calls=0;
 await assert.rejects(createDonorOverview(data,meta,{signal:controller.signal,yieldControl:async()=>{if(++calls===2)controller.abort();}}),{name:'AbortError'});
 assert.equal(calls,2);
});

test('independent Front/Oblique cameras fit fixed anatomy at portrait and desktop aspects',()=>{
 for(const {context}of fixtures)for(const aspect of [.32,.7,1.3])for(const mode of ['front','oblique']){
  const heartPoints=Object.values(context.frame.landmarksMm),heartBounds={min:[0,1,2].map(k=>Math.min(...heartPoints.map(p=>p[k]))-8),max:[0,1,2].map(k=>Math.max(...heartPoints.map(p=>p[k]))+8)},b=donorOverviewCamera(context,aspect,mode,heartBounds);let maximum=0;
  const check=p=>{
   const q=sub(mul(p,1/b.referenceMm),b.eye),depth=dot(q,b.forward),u=Math.abs(dot(q,b.right)/(.32*aspect*depth)),v=Math.abs(dot(q,b.up)/(.32*depth));
   assert.ok(depth>0);assert.ok(u<=1/1.059&&v<=1/1.059,'Every real bone vertex and heart bound stays inside the padded pane');maximum=Math.max(maximum,u,v);
  };
  for(const mesh of context.meshes.filter(m=>m.id==='bodyparts3d-bones'||m.id==='bodyparts3d-spine'))for(let i=0;i<mesh.vertices.length;i+=6)check(Array.from(mesh.vertices.subarray(i,i+3)));
  for(let mask=0;mask<8;mask++)check(heartBounds.min.map((v,k)=>(mask>>k)&1?heartBounds.max[k]:v));
  assert.ok(maximum>.92,'Actual anatomy must use the limiting pane dimension rather than fit empty AABB corners');
  vnear(b.target,mul(b.bounds.min.map((v,k)=>(v+b.bounds.max[k])*.5),1/b.referenceMm));
 }
});

test('actual overview render uses source pose/scale and restores heart-priority depth for the probe',()=>{
 const f=fixtures[0],preset=PROBE_PRESETS[0],frame={...f.frames[preset.frame],referenceMm:f.geometry.longestMm},state=sanitizeProbeState({preset:preset.id,referenceMm:f.geometry.longestMm,contactLocked:false,originMm:[90,-43,17],tiltDeg:40,sweepDeg:38,rollDeg:71}),pose=probePose(state,frame),draws=[],depth=[];
 const basis=donorOverviewCamera(f.context,.8,'oblique'),heart={id:'measured-heart'},bone={id:'bodyparts3d-bones'},instrument={id:'instrument'};
 const fake={model:f.context,canvas:{clientWidth:400,clientHeight:500},cameraReady:true,cameraMode:'manual',normalizationMm:basis.referenceMm,basis:()=>basis,heartMesh:heart,meshes:[bone],probe:{phased:[instrument],tee:[instrument]},onIndicator(){},view:{gl:{depthRange:(a,b)=>depth.push([a,b])},begin(){},remove(){},upload:()=>({id:'sector'}),draw:(mesh,matrix)=>draws.push({mesh,matrix,depth:depth.at(-1)})}};
 ReferenceTorsoView.prototype.render.call(fake,{pose,state});
 const actual=draws.find(d=>d.mesh===instrument),scale=probeDisplayScale(f.geometry.longestMm);
 vnear(Array.from(actual.matrix.subarray(12,15)),pose.originMm,1e-5);vnear(Array.from(actual.matrix.subarray(0,3)),mul(pose.right,scale),1e-6);
 assert.deepEqual(draws.find(d=>d.mesh===bone).depth,[1,1]);assert.deepEqual(actual.depth,[0,1]);assert.equal(draws[0].mesh,heart);
});

function interactionFixture(){
 const canvas=new EventTarget(),doc=new EventTarget();doc.defaultView=new EventTarget();doc.hidden=false;
 const gl=new Proxy({getShaderParameter:()=>true,getProgramParameter:()=>true,getAttribLocation:()=>0,getUniformLocation:()=>({})},{get:(obj,key)=>key in obj?obj[key]:key===String(key).toUpperCase()?1:()=>({})});
 Object.assign(canvas,{style:{},clientWidth:400,clientHeight:500,ownerDocument:doc,getContext:()=>gl,getBoundingClientRect:()=>({width:400,height:500,left:0,top:0}),setPointerCapture(){},releasePointerCapture(){},focus(){}});
 const view=new ReferenceTorsoView(canvas);view.camera={yaw:.2,pitch:.1,roll:0,distance:2,pan:[0,0,0]};
 const pointer=(type,id,x,y)=>{const e=new Event(type,{cancelable:true});Object.assign(e,{pointerId:id,clientX:x,clientY:y,button:0});canvas.dispatchEvent(e);};
 return {view,canvas,pointer};
}

test('overview orbit/two-finger pan do not steer the probe, and workspace exit clears contacts',()=>{
 const oldRAF=globalThis.requestAnimationFrame,oldCancel=globalThis.cancelAnimationFrame;globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
 try{
  const f=interactionFixture(),before={...f.view.camera},pose={originMm:[4,7,11],beam:[0,0,-1],right:[1,0,0],normal:[0,1,0]},snapshot=JSON.stringify(pose);f.view.lastFrame={pose};
  f.pointer('pointerdown',1,120,180);f.pointer('pointermove',1,135,185);assert.notEqual(f.view.camera.yaw,before.yaw);
  f.pointer('pointerdown',2,220,180);const angles=[f.view.camera.yaw,f.view.camera.pitch,f.view.camera.roll],pan=[...f.view.camera.pan];f.pointer('pointermove',1,155,200);f.pointer('pointermove',2,240,195);
  assert.deepEqual([f.view.camera.yaw,f.view.camera.pitch,f.view.camera.roll],angles);assert.notDeepEqual(f.view.camera.pan,pan);assert.equal(JSON.stringify(pose),snapshot);
  f.view.setActive(false);const paused=JSON.stringify(f.view.camera);assert.equal(f.view.pointerIds.size,0);f.pointer('pointermove',2,280,230);assert.equal(JSON.stringify(f.view.camera),paused);
  f.view.setActive(true);f.pointer('pointerdown',3,100,100);const pan2=[...f.view.camera.pan];f.pointer('pointermove',3,110,110);assert.deepEqual(f.view.camera.pan,pan2,'Returning to the workspace starts one-finger orbit, not a stale two-finger pan');
 }finally{globalThis.requestAnimationFrame=oldRAF;globalThis.cancelAnimationFrame=oldCancel;}
});

test('TTE source updates are identity-gated; overview controls do not change accepted probe state',()=>{
 let updates=0,invalidated=0;const data=new Uint8Array(8),meta={dimensions:[2,2,2],spacingUm:1000},view={sourceData:data,sourceMeta:meta,sourceThreshold:.28,invalidateSource(){invalidated++;this.sourceData=null;},setSource(){updates++;return Promise.resolve();}},lab={active:true,torsoView:view,data,meta,renderer:{settings:{threshold:.28}}};
 ProbeLabModule.prototype.updateTorsoSource.call(lab);assert.equal(updates,0);
 lab.active=false;lab.data=new Uint8Array(8);ProbeLabModule.prototype.updateTorsoSource.call(lab);assert.equal(updates,0);assert.equal(invalidated,1);assert.equal(view.sourceData,null,'Inactive source upgrades must release the old volume reference.');
 const state={originMm:[11,12,13],tiltDeg:24},torso={};let prevented=false;
 ProbeLabModule.prototype.keyDown.call({active:true,state,$:()=>torso},{target:torso,key:'r',code:'KeyR',preventDefault(){prevented=true;}});
 assert.deepEqual(state,{originMm:[11,12,13],tiltDeg:24});assert.equal(prevented,false);
});

test('Place Probe distinguishes taps, one-contact drags and cancelled two-contact gestures',()=>{
 const f=interactionFixture();let selections=0;f.view.pickContact=()=>{selections++;};f.view.setPlacementMode(true);
 const camera=JSON.stringify(f.view.camera);
 f.pointer('pointerdown',1,200,200);assert.equal(selections,0,'A possible two-contact gesture must not place on its first touch.');
 f.pointer('pointerup',1,200,200);assert.equal(selections,1);assert.equal(f.view.pointerIds.size,0);
 f.pointer('pointerdown',1,200,200);f.pointer('pointerdown',2,220,200);
 f.pointer('pointermove',1,215,200);f.pointer('pointermove',2,235,200);
 f.pointer('pointerup',1,215,200);f.pointer('pointerup',2,235,200);
 assert.equal(selections,1);assert.equal(f.view.pointerIds.size,0);assert.equal(JSON.stringify(f.view.camera),camera);
 f.pointer('pointerdown',3,200,200);f.pointer('pointermove',3,209,200);assert.equal(selections,2);
 f.pointer('pointerup',3,209,200);assert.equal(selections,2,'Ending a drag must not add a second selection.');assert.equal(f.view.pointerIds.size,0);
});

test('shared geometry failure detaches the layer and cannot reattach on workspace reentry',()=>{
 const f=interactionFixture(),renderer={gl:f.view.view.gl,canvas:f.canvas,contextLayer:null,setContextLayer(layer){this.contextLayer=layer;},requestRender(){}};
 const overlay=new ProbeSceneOverlay(f.canvas,{renderer});overlay.params={};overlay.setActive(true);assert.equal(renderer.contextLayer,overlay.layer);
 overlay.layer.onError();assert.equal(overlay.failed,true);assert.equal(overlay.active,false);assert.equal(renderer.contextLayer,null);
 overlay.render({});assert.equal(renderer.contextLayer,null);
 overlay.setActive(true);assert.equal(overlay.active,false);assert.equal(renderer.contextLayer,null);
});

test('a failed shared layer repaints the same accepted pose as a software instrument without camera motion',()=>{
 const rect={width:400,height:500,left:0,top:0},camera={yaw:0,pitch:0,roll:0,distance:2,pan:[0,0,0]};let clears=0,fills=0;
 const ctx=new Proxy({clearRect(){clears++;},fill(){fills++;}},{get:(o,k)=>k in o?o[k]:()=>{}}),guide={style:{},getContext:()=>ctx},mesh={style:{}};
 const state=sanitizeProbeState({contactLocked:false,originMm:[0,0,0],showSurface:false}),pose={originMm:[0,0,0],right:[1,0,0],normal:[0,1,0],beam:[0,0,-1]},accepted={pose,state,poseRevision:1};
 const lab={active:true,geometry:{longestMm:168.0104},state,displayedFrame:accepted,displayedId:1,sceneOverlay:{render(){}},
  $:key=>key==='guide'?guide:mesh,mount:{querySelector:()=>({getBoundingClientRect:()=>rect})},frameForState:()=>null,
  renderer:{camera,canvas:{getBoundingClientRect:()=>rect},basis:()=>({eye:[0,0,2],forward:[0,0,-1],right:[1,0,0],up:[0,1,0]})}};
 ProbeLabModule.prototype.drawGuide.call(lab);const originalFills=fills;assert.equal(clears,1);
 ProbeLabModule.prototype.drawGuide.call(lab);assert.equal(clears,1,'An unchanged healthy frame is cached.');
 lab.sceneOverlay.failed=true;ProbeLabModule.prototype.drawGuide.call(lab);
 assert.equal(clears,2);assert.ok(fills>originalFills+100,'The shaded software instrument must actually be painted.');
 assert.equal(lab.displayedFrame,accepted);assert.deepEqual(camera,{yaw:0,pitch:0,roll:0,distance:2,pan:[0,0,0]});
});

test('indexed whole-heart upload failure installs and labels a bounded preview instead of losing the chest',async()=>{
 const spec=JSON.parse(read('assets/probe-heart-v44/manifest.json')).donors[0],referenceMm=spec.referenceMm;
 const data=new Uint8Array(16**3),meta={dimensions:[16,16,16],spacingUm:referenceMm*1000/15};
 for(let z=0;z<16;z++)for(let y=0;y<16;y++)for(let x=0;x<16;x++)if((x-8)**2+(y-8)**2+(z-8)**2<30)data[x+16*(y+16*z)]=200;
 const previous={id:'previous-heart'},removed=[],statuses=[];let indexed=0,uploaded=0;
 const view={active:true,model:{referenceMm,frame:{donorId:spec.donorId},meshes:[]},heartMesh:previous,cameraReady:true,cameraMode:'manual',requestRender(){},onStatus:message=>statuses.push(message),
  view:{uploadIndexed(){indexed++;throw new Error('OES_element_index_uint unavailable fixture');},upload(vertices){uploaded++;return {count:vertices.length/6};},remove(mesh){if(mesh)removed.push(mesh);}}};
 const oldFetch=globalThis.fetch;globalThis.fetch=async input=>new Response(readFileSync(input));
 try{await ReferenceTorsoView.prototype.setSource.call(view,{data,meta,frames:{},donorId:spec.donorId});}finally{globalThis.fetch=oldFetch;}
 assert.equal(indexed,1);assert.equal(uploaded,1);assert.equal(view.overview.kind,'measured-coarse-orientation-outline');
 assert.ok(view.overview.fallbackReason.includes('OES_'));assert.ok(view.heartMesh.count>0);assert.ok(removed.includes(previous));assert.equal(view.sourceFailed,false);
 assert.equal(statuses.at(-1),'Preview outline · whole-heart surface unavailable');
});
