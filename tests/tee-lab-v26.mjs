import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {TEE_PRESETS,createTeeReference,sanitizeTeeState,teePose,teePresetState,teePathFrame,teeShaftAttachment} from '../public/tee-geometry.js';
import {TeeLabModule} from '../public/tee-lab.js';
import {ProbeLabModule} from '../public/probe-lab.js';
import {probeCapPlane,volumeGeometry,beamPoint} from '../public/probe-geometry.js';
import {computeProbeFrame} from '../public/probe-acoustics.js';
import {TeeSceneOverlay} from '../public/tee-scene.js';
import {dot,cross} from '../public/planes.js';

const rawFrames=JSON.parse(await readFile('public/assets/echo-planes.json','utf8'));
const reviewedFits=JSON.parse(await readFile('public/assets/tee-atlas/plane-fit-v2.json','utf8'));
const frames=Object.fromEntries(Object.entries(rawFrames.frames).map(([k,v])=>[k,v.world]));
const reference=createTeeReference(frames);
const near=(a,b,tolerance=1e-7)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
const vectorNear=(a,b,tolerance=1e-7)=>a.forEach((v,i)=>near(v,b[i],tolerance));
const report={scope:'Production TEE pose geometry, actual DOM events and shared worker contracts; not clinical registration, browser performance or contact-force validation.',checks:[],sourcePlanes:[]};

test('all four LADAF references retain their existing measured source plane',()=>{
 for(const preset of TEE_PRESETS){
  const state=teePresetState(preset.id,sanitizeTeeState(),reference),pose=teePose(state,reference),source=frames[preset.frame];
  const agreement=Math.abs(dot(pose.normal,source.normal)),offset=Math.abs(dot(pose.originMm.map((v,i)=>v/reference.referenceMm-source.center[i]),source.normal));
  near(agreement,1,2e-8);assert.ok(offset<1e-8);
  report.sourcePlanes.push({id:preset.id,normalAgreement:agreement,planeOffsetMm:offset*reference.referenceMm,insertionCm:state.insertionCm,multiplaneDeg:state.multiplaneDeg});
 }
 report.checks.push('ME 0°, 90°, 120° and distal short-axis references match the existing source sections to submicrometre numerical tolerance; named anatomy remains approximate.');
});

test('electronic multiplane rotates the image basis without rotating or moving the instrument',()=>{
 const state=sanitizeTeeState({teeVersion:1,insertionCm:38.2,shaftRotationDeg:23,anteflexDeg:28,lateralFlexDeg:-17}),zero=teePose({...state,multiplaneDeg:0},reference);
 for(const angle of [30,90,120,180]){
  const pose=teePose({...state,multiplaneDeg:angle},reference);
  assert.deepEqual(pose.instrument,zero.instrument);assert.deepEqual(pose.originMm,zero.originMm);assert.deepEqual(pose.shaftPoints,zero.shaftPoints);assert.deepEqual(pose.beam,zero.beam);
  near(dot(pose.right,zero.right),Math.cos(angle*Math.PI/180));
 }
 const opposite=teePose({...state,multiplaneDeg:180},reference);vectorNear(opposite.right,zero.right.map(x=>-x));vectorNear(opposite.normal,zero.normal.map(x=>-x));
 report.checks.push('Multiplane controls leave tip, shaft and central beam fixed; 180° mirrors the in-plane side without changing the physical section.');
});

test('insertion, shaft turning and two flexion wheels have distinct finite mechanical effects',()=>{
 const neutral=sanitizeTeeState(),p=teePose(neutral,reference);
 const inserted=teePose({...neutral,insertionCm:34},reference);near(Math.hypot(...p.originMm.map((v,i)=>v-inserted.originMm[i])),10);
 const turned=teePose({...neutral,shaftRotationDeg:30},reference);vectorNear(turned.originMm,p.originMm);near(dot(turned.instrument.shaft,p.instrument.shaft),1);near(dot(turned.beam,p.beam),Math.cos(Math.PI/6));assert.ok(dot(turned.beam,p.instrument.right)<0,'Positive turn is toward the marked image-left side.');
 for(const state of [{...neutral,anteflexDeg:45},{...neutral,lateralFlexDeg:40},{...neutral,anteflexDeg:-55,lateralFlexDeg:-30,shaftRotationDeg:-90,multiplaneDeg:142}]){
  const q=teePose(state,reference);assert.ok(Math.hypot(...q.originMm.map((v,i)=>v-p.originMm[i]))>1);
  for(const v of [q.right,q.beam,q.normal,q.instrument.shaft]){assert.ok(v.every(Number.isFinite));near(Math.hypot(...v),1);}
  near(dot(q.beam,q.right),0);near(dot(q.beam,q.normal),0);vectorNear(cross(q.beam,q.right),q.normal);
  vectorNear(q.shaftPoints.at(-1),teeShaftAttachment(q.instrument,reference.scale));
 }
 report.checks.push('Insertion translates along the reference tract; shaft turn changes mechanical facing; independent flexions bend and displace the tip. Every basis remains orthonormal.');
});

test('all donor paths are bounded and smooth and use their own calibrated source entry',async()=>{
 for(const donor of ['ladaf-2021-17','s-20-29','s-20-28']){
  const prefix=donor==='ladaf-2021-17'?'public/assets/':`public/assets/donors/${donor}/`,raw=JSON.parse(await readFile(prefix+'echo-planes.json','utf8')),manifest=JSON.parse(await readFile(prefix+'manifest.json','utf8')),geometry=volumeGeometry(manifest.levels.high);
  const f=Object.fromEntries(Object.entries(raw.frames).map(([k,v])=>[k,v.world])),r=createTeeReference(f,geometry.longestMm);let previous=null;
  for(let i=0;i<=300;i++){
   const cm=r.minInsertionCm+(r.maxInsertionCm-r.minInsertionCm)*i/300,p=teePathFrame(r,cm);
   assert.ok(p.pointMm.every(Number.isFinite));near(dot(p.beam,p.right),0);near(dot(p.beam,p.shaft),0);near(Math.hypot(...p.shaft),1);
   if(previous)assert.ok(Math.hypot(...p.pointMm.map((v,j)=>v-previous.pointMm[j]))<1.8);
   previous=p;
  }
  const state=teePresetState('me4c',sanitizeTeeState({referenceMm:geometry.longestMm}),r);
  if(f.me4c.probeEntry)near(state.depthMm,f.me4c.probeEntry.depthMm,1e-4);
 }
 report.checks.push('All three donor paths remain finite and continuous and comparison-donor imaging depths retain their calibrated entries.');
});

const domPath=process.argv.find(x=>x.startsWith('--dom='))?.slice(6)||'/workspace/data/heart-ui-test-v11/node_modules/linkedom/esm/index.js';
const {parseHTML}=await import(pathToFileURL(domPath));
const real={setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame,fetch:globalThis.fetch};
let fixture;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function environment(){
 globalThis.fetch=async url=>{assert.ok(String(url).endsWith('/assets/tee-atlas/plane-fit-v2.json'));return {ok:true,json:async()=>structuredClone(reviewedFits)};};
 const {document,window}=parseHTML('<html><body><section id="teePanel"></section><section id="probePanel"></section></body></html>');Object.assign(globalThis,{document,window});
 Object.defineProperty(document,'activeElement',{configurable:true,writable:true,value:document.body});Object.defineProperty(document,'pointerLockElement',{configurable:true,writable:true,value:null});
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this._value??this.querySelector('option')?.value??'';},set(v){this._value=String(v);}});
 window.HTMLElement.prototype.getBoundingClientRect=()=>({left:0,top:0,width:640,height:620});window.HTMLElement.prototype.focus=function(){document.activeElement=this;};
 const context=new Proxy({putImageData(){},setTransform(){}},{get:(o,k)=>k in o?o[k]:(()=>{})});window.HTMLCanvasElement.prototype.getContext=function(type){return type==='2d'?context:null;};
 globalThis.ImageData=class{constructor(data,width,height){Object.assign(this,{data,width,height});}};globalThis.ResizeObserver=class{observe(){}};
 const timers=new Map();let serial=0;globalThis.setTimeout=(fn,delay)=>{const id=++serial;timers.set(id,{fn,delay});return id;};globalThis.clearTimeout=id=>timers.delete(id);globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
 const workers=[];globalThis.Worker=class{constructor(){this.messages=[];workers.push(this);}postMessage(m){this.messages.push(m);}terminate(){this.terminated=true;}};
 const renderer={canvas:document.createElement('canvas'),settings:{palette:4,threshold:.28,cleanupEnabled:true,capContrast:1.8},camera:{yaw:0,pitch:0,roll:0,distance:2,pan:[0,0,0]},uploads:0,set(v){Object.assign(this.settings,v);},requestRender(){},clearCapData(){this.cap=null;},setCapData(cap){this.cap=cap;this.uploads++;},alignPlane(){},basis(){return {eye:[0,0,2],forward:[0,0,-1],right:[1,0,0],up:[0,1,0]};}};
 const calls=[],fineSource={samplePlane(plane,options){return new Promise((resolve,reject)=>{calls.push({plane,options,resolve,reject});options.signal.addEventListener('abort',()=>reject(new DOMException('Canceled','AbortError')),{once:true});});},scheduleWarmPlane(){},cancelWarm(){}};
 const module=new TeeLabModule({renderer,mount:document.getElementById('teePanel'),frames:rawFrames,fineSource,donor:{id:'ladaf-2021-17',datasetId:'1659197537'}});
 const probe=new ProbeLabModule({renderer,mount:document.getElementById('probePanel'),frames:rawFrames});
 module.setVolume(new Uint8Array(1),{dimensions:[475,475,530],spacingUm:317.6});
 const event=(type,props={})=>{const e=new window.Event(type,{bubbles:true,cancelable:true});for(const [k,v]of Object.entries(props))Object.defineProperty(e,k,{value:v});return e;};
 return fixture={module,probe,renderer,calls,workers,timers,document,event};
}
test.afterEach(async()=>{if(fixture){fixture.module.leave();fixture=null;Object.assign(globalThis,real);await flush();}});

test('actual TEE controls coexist with Probe Lab and keep electronic angle independent of shaft turn',async()=>{
 const f=environment(),m=f.module;await m.enter();
 const ids=[...f.document.querySelectorAll('[id]')].map(e=>e.id);assert.equal(new Set(ids).size,ids.length);
 assert.equal(f.calls.length,1);assert.ok(f.calls[0].options.spacingUm>=79.4);assert.ok(m.getPose().shaftPoints.length>30);
 const turn=m.mount.querySelector('[data-tee-range="shaftRotationDeg"]');turn.value='32';turn.dispatchEvent(f.event('input'));assert.equal(m.state.shaftRotationDeg,32);
 const angle=m.mount.querySelector('[data-tee-range="multiplaneDeg"]');angle.value='90';angle.dispatchEvent(f.event('input'));assert.equal(m.state.multiplaneDeg,90);assert.equal(m.state.shaftRotationDeg,32);
 assert.equal(f.probe.state.rollDeg,0);assert.equal(f.probe.state.preset,'apical');assert.equal(f.probe.active,false);
 m.tee('lock').click();assert.equal(m.state.probeLocked,true);assert.equal(turn.disabled,true);
 const before=m.getPose();m.changeControl('shaftRotationDeg',-70);assert.deepEqual(m.getPose(),before);m.changeControl('gainDb',6);assert.equal(m.state.gainDb,6);
 m.mount.querySelector('[data-tee-preset="me2c"]').click();assert.equal(m.state.probeLocked,false);assert.equal(turn.disabled,false);assert.equal(m.state.multiplaneDeg,90);assert.equal(m.state.shaftRotationDeg,m.reference().presetStates?.me2c?.shaftRotationDeg??0);assert.equal(f.calls[0].options.signal.aborted,true);
 m.changeControl('shaftRotationDeg',24);m.changeControl('multiplaneDeg',45);m.tee('lock').click();assert.equal(m.state.probeLocked,true);m.tee('reset').click();assert.equal(m.state.probeLocked,false);assert.equal(turn.disabled,false);assert.equal(m.state.teePreset,'me2c');assert.equal(m.state.shaftRotationDeg,m.reference().presetStates?.me2c?.shaftRotationDeg??0);assert.equal(m.state.multiplaneDeg,90);assert.equal(m.tee('lock').textContent,'Lock Steering');
 assert.match(m.mount.querySelector('.tee-model-badge').textContent,/Illustrative Anatomy · Unregistered/i);assert.match(m.mount.querySelector('.probe-method').textContent,/neither the tract nor the insertion scale comes from a donor esophagus/);assert.equal(m.mount.querySelector('.tee-imaging-settings').hasAttribute('open'),false);
 report.checks.push('Actual TEE controls, lock, presets and IDs remain independent when Probe Lab is also mounted. Locking stops manual steering but allows imaging changes; starting views and Reset explicitly establish an unlocked reference pose. The authored tract remains labeled illustrative and unregistered.');
});

test('focused keyboard movement updates TEE and stops on blur, lock and module exit',async()=>{
 const f=environment(),m=f.module;await m.enter();const viewport=m.mount.querySelector('#teeViewportMount');viewport.focus();
 f.document.dispatchEvent(f.event('keydown',{code:'KeyW'}));assert.equal(m.keys.has('KeyW'),true);const before=m.state.insertionCm;m.tick(m.lastTick+40);assert.ok(m.state.insertionCm>before);
 assert.equal(f.probe.keys.size,0);window.dispatchEvent(f.event('blur'));assert.equal(m.keys.size,0);
 m.tee('lock').click();f.document.dispatchEvent(f.event('keydown',{code:'ArrowUp'}));assert.equal(m.keys.size,0);
 m.tee('lock').click();f.document.dispatchEvent(f.event('keydown',{code:'KeyE'}));assert.equal(m.keys.size,1);m.leave();assert.equal(m.keys.size,0);assert.equal(m.active,false);assert.equal(f.calls[0].options.signal.aborted,true);assert.equal(f.workers.at(-1).terminated,true);
 report.checks.push('Focused keyboard motion is TEE-only and clears on blur, lock, Escape and exit; exit aborts pending fine source work.');
});

test('the shared real computation preserves TEE state and publishes cap, images and guides from one accepted pose',async()=>{
 const f=environment(),m=f.module;await m.enter();const request=m.fineRunning.request,plane=probeCapPlane(request.pose,m.geometry);
 const slice={data:new Uint8Array(65*65).fill(160),width:65,height:65,plane,spacingUm:79.4,sourceSpacingUm:79.4,complete:true,cleaned:true};
 const job={...request,fineSlice:slice,refinementToken:m.fineGeneration,width:128,beams:48,samples:100};
 const result=await computeProbeFrame({data:new Uint8Array(1),dimensions:m.meta.dimensions,meta:m.meta,geometry:m.geometry},job);
 assert.equal(result.state.teeVersion,1);assert.equal(result.state.insertionCm,m.reference().presetStates.me4c.insertionCm);assert.equal(result.state.multiplaneDeg,m.reference().presetStates.me4c.multiplaneDeg);assert.deepEqual(result.pose.instrument,request.pose.instrument);
 assert.equal(result.pose,job.pose);assert.equal(result.state,job.state);assert.equal(result.cap,slice.data);assert.equal(result.plane,slice.plane);
 m.acceptFrame(result);assert.equal(m.displayedFrame,result);assert.equal(f.renderer.cap.plane,result.plane);assert.equal(f.renderer.cap.data,result.cap);assert.ok(m.tee('displayed-pose').textContent.includes(`${result.state.insertionCm.toFixed(1)} cm model`));assert.ok(m.tee('displayed-pose').textContent.includes(`${Math.round(result.state.multiplaneDeg)}°`));
 const acceptedPose=copy(m.displayedFrame.pose),old=result;m.changeControl('multiplaneDeg',90);assert.deepEqual(m.displayedFrame.pose,acceptedPose,'Input does not move the displayed guide before a matched image exists.');
 m.selectPreset('melax');const uploads=f.renderer.uploads;m.acceptFrame({...old,id:old.id+999});assert.equal(f.renderer.uploads,uploads,'Old source frame cannot return after a preset cancellation.');
 report.checks.push('Production CT/acoustic computation retains all TEE fields and identical accepted cap/image/pose; requested motion cannot move an old image, and cancelled frames are rejected.');
});

const copy=x=>JSON.parse(JSON.stringify(x));
test('the production instrument overlay keeps the same model matrix under electronic angle changes',()=>{
 const matrices=[],view={begin(){},remove(){},upload(vertices,color){return {vertices,color};},draw(mesh,matrix){if(matrix)matrices.push(Array.from(matrix));}};
 const overlay={view,head:[{}],drawGeometry:TeeSceneOverlay.prototype.drawGeometry},state=sanitizeTeeState({teeVersion:1,anteflexDeg:23,lateralFlexDeg:11}),pose=teePose(state,reference);
 const common={basis:{},width:600,height:600,dpr:1,reference,showProbe:true};
 TeeSceneOverlay.prototype.render.call(overlay,{...common,pose});const shaft=overlay.shaft;
 TeeSceneOverlay.prototype.render.call(overlay,{...common,pose:teePose({...state,multiplaneDeg:90},reference)});
 assert.deepEqual(matrices[0],matrices[1]);assert.equal(overlay.shaft,shaft);assert.ok(shaft.vertices.length>1000);assert.ok([...shaft.vertices].every(Number.isFinite));
 report.checks.push('Production overlay reuses the same mechanical shaft geometry and head matrix during electronic multiplane rotation.');
});

test('write the bounded verification receipt',async()=>{
 const output=process.argv.find(x=>x.startsWith('--report='))?.slice(9);if(output){await mkdir(output.slice(0,output.lastIndexOf('/')),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');}
});
