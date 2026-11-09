import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {TeeLabModule} from '../public/tee-lab.js';
import {TEE_PRESETS,teePose} from '../public/tee-geometry.js';
import {probeCapPlane} from '../public/probe-geometry.js';
import {DONORS} from '../public/donors.js';

// Check the production DOM/controller and actual fitted donor kinematics. The
// image worker's pixels are deliberately outside this test: dispatch and paint
// are replaced, while frame acceptance, cut-plane and scene-overlay routing are
// the production methods. Source-pixel review is recorded separately.
const domPath=process.env.HEART_DOM_MODULE||'/workspace/data/heart-ui-test-v11/node_modules/linkedom/esm/index.js';
const {parseHTML}=await import(pathToFileURL(domPath));
const donors=await Promise.all(DONORS.filter(d=>d.id.startsWith('s-20-')).map(async donor=>{
 const base=`public/assets/donors/${donor.id}/`;
 const [frames,manifest]=await Promise.all(['echo-planes.json','manifest.json'].map(name=>readFile(base+name,'utf8').then(JSON.parse)));
 return {donor,frames,meta:manifest.levels.high};
}));
const globals=['document','window','ResizeObserver','requestAnimationFrame','cancelAnimationFrame','setTimeout','clearTimeout'];
const original=Object.fromEntries(globals.map(key=>[key,globalThis[key]]));
const near=(actual,expected,tolerance=1e-8)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`);
const vectorNear=(actual,expected)=>actual.forEach((value,index)=>near(value,expected[index]));
let fixture;

function environment(input){
 const {document,window}=parseHTML('<html><body><section id="teePanel"></section></body></html>');
 Object.defineProperty(document,'activeElement',{configurable:true,writable:true,value:document.body});
 Object.defineProperty(document,'hidden',{configurable:true,writable:true,value:false});
 window.HTMLElement.prototype.getBoundingClientRect=()=>({left:0,top:0,width:640,height:620});
 const context=new Proxy({},{get:()=>()=>{}});
 window.HTMLCanvasElement.prototype.getContext=()=>context;
 let serial=0;const timers=new Map();
 Object.assign(globalThis,{document,window,ResizeObserver:class{observe(){}},requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{},setTimeout:(fn,delay)=>{const id=++serial;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id)});
 const requests=[],overlays=[];
 const renderer={canvas:document.createElement('canvas'),settings:{palette:4,cleanupEnabled:true},camera:{pan:[0,0,0],yaw:0,pitch:0,roll:0,distance:2},clearCapData(){},set(values){Object.assign(this.settings,values);},setCapData(cap){this.cap=cap;},basis(){return {eye:[0,0,2],forward:[0,0,-1],right:[1,0,0],up:[0,1,0]};}};
 const module=new TeeLabModule({mount:document.getElementById('teePanel'),renderer,donor:input.donor,frames:input.frames});
 module.setVolume(new Uint8Array(1),input.meta);
 module.fitFrames=module.frames;module.contextReady=true;module.teeReference=null;
 module.ensureWorker=()=>{};module.dispatchFrame=request=>requests.push(request);module.paintImages=()=>{};module.orientCamera=()=>{};
 module.sceneOverlay={sharedDepth:true,setActive(){},render(options){overlays.push(options);}};
 module.active=true;module.updateUI();
 const event=(type,code)=>{const e=new window.Event(type,{bubbles:true,cancelable:true});Object.defineProperty(e,'code',{value:code});document.dispatchEvent(e);return e;};
 const accept=request=>{
  const frame={...request,type:'frame',plane:probeCapPlane(request.pose,module.geometry),cap:new Uint8Array([160]),capWidth:1,capHeight:1,capSpacingUm:module.geometry.spacingUm,stats:{sourceSpacingUm:module.geometry.spacingUm,tissueFraction:.5}};
  module.acceptFrame(frame);return frame;
 };
 return fixture={module,document,renderer,requests,overlays,event,accept,timers};
}

test.afterEach(()=>{
 fixture?.module.leave();fixture=null;
 for(const[key,value]of Object.entries(original)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
});

for(const input of donors)test(`${input.donor.id}: all fitted starting cards and keyboard sampling use the corrected acoustic origin`,()=>{
 const f=environment(input),m=f.module,reference=m.reference();
 assert.equal(reference.contextModel.frame.donorId,input.donor.datasetId);
 for(const preset of TEE_PRESETS){
  const fitted=reference.presetStates[preset.id];assert.ok(Number.isFinite(fitted?.multiplaneDeg),`${preset.id} has a fitted model angle`);
  const card=m.mount.querySelector(`[data-tee-preset="${preset.id}"]`),label=card.querySelector('.probe-preset-number');
  assert.equal(label.textContent,`${Math.round(fitted.multiplaneDeg)}° · model`);
  assert.match(label.title,/Simulated probe multiplane angle/);
  card.click();near(m.state.multiplaneDeg,fitted.multiplaneDeg);
  assert.equal(card.getAttribute('aria-pressed'),'true');
  const initial=f.requests.at(-1),initialPose=teePose(m.state,reference);
  assert.deepEqual(initial.pose,initialPose);
  assert.ok(initialPose.acousticFaceOffsetMm>2,'the S20 acoustic face differs from the head-center path');
  vectorNear(initialPose.originMm,initialPose.headCenterMm.map((value,index)=>value+initialPose.beam[index]*initialPose.acousticFaceOffsetMm));
  const firstFrame=f.accept(initial);
  assert.strictEqual(f.overlays.at(-1).pose,firstFrame.pose);
  assert.deepEqual(f.renderer.settings.oblique,firstFrame.plane);

  // No focus/arming: body focus owns the keyboard while this lab is active.
  assert.strictEqual(f.document.activeElement,f.document.body);
  const before=[...initialPose.originMm];assert.equal(f.event('keydown','KeyW').defaultPrevented,true);f.event('keyup','KeyW');
  assert.ok(Math.hypot(...m.getPose().originMm.map((value,index)=>value-before[index]))>.1);
  m.requestFrame(true);const moved=f.requests.at(-1),expected=teePose(m.state,reference);
  assert.deepEqual(moved.pose,expected);assert.notDeepEqual(moved.pose.originMm,initial.pose.originMm);
  vectorNear(moved.pose.originMm,moved.pose.headCenterMm.map((value,index)=>value+moved.pose.beam[index]*moved.pose.acousticFaceOffsetMm));

  // A newer live control state cannot move the visible instrument ahead of the
  // accepted pixels. Acceptance switches the cut and overlay together.
  m.guideKey='';m.drawGuide();assert.strictEqual(f.overlays.at(-1).pose,firstFrame.pose);
  const movedFrame=f.accept(moved);assert.strictEqual(m.displayedFrame,movedFrame);
  assert.strictEqual(f.overlays.at(-1).pose,movedFrame.pose);
  assert.deepEqual(f.renderer.cap.plane,probeCapPlane(expected,m.geometry));
  assert.deepEqual(f.renderer.settings.oblique,f.renderer.cap.plane);
  vectorNear(f.overlays.at(-1).pose.originMm,moved.pose.originMm);
 }
});
