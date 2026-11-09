/** Actual ProbeLabModule with a test DOM and mocked browser permissions/worker.
 * Tests event/state integration, not real pointer-lock permission or GPU output.
 */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {ProbeLabModule} from '../public/probe-lab.js';
import {probeCapPlane} from '../public/probe-geometry.js';
const {parseHTML}=await import(pathToFileURL(process.argv[2]));
const frames=JSON.parse(await readFile('public/assets/echo-planes.json','utf8'));
const {document,window}=parseHTML('<!doctype html><html><body><section id="mount"></section><canvas id="scene"></canvas></body></html>');
Object.assign(globalThis,{document,window});
Object.defineProperty(document,'activeElement',{configurable:true,writable:true,value:document.body});
Object.defineProperty(document,'pointerLockElement',{configurable:true,writable:true,value:null});
Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this._value??this.querySelector('option')?.value??'';},set(value){this._value=String(value);}});
window.HTMLElement.prototype.focus=function(){document.activeElement=this;};
window.HTMLElement.prototype.getBoundingClientRect=()=>({left:0,top:0,width:600,height:500});
const context=new Proxy({putImageData(){},setTransform(){}},{get:(object,key)=>key in object?object[key]:(()=>{})});
window.HTMLCanvasElement.prototype.getContext=()=>context;
globalThis.ImageData=class{constructor(data,width,height){Object.assign(this,{data,width,height});}};
globalThis.ResizeObserver=class{observe(){}disconnect(){}};
const framesPending=new Map(),timers=new Map();let counter=0,lockRequests=0;
globalThis.requestAnimationFrame=fn=>{const id=++counter;framesPending.set(id,fn);return id;};
globalThis.cancelAnimationFrame=id=>framesPending.delete(id);
globalThis.setTimeout=(fn,delay)=>{const id=++counter;timers.set(id,{fn,delay});return id;};
globalThis.clearTimeout=id=>timers.delete(id);
const workers=[];
globalThis.Worker=class{constructor(url){this.url=String(url);this.messages=[];this.terminated=false;workers.push(this);}postMessage(message){this.messages.push(message);}terminate(){this.terminated=true;}};
document.exitPointerLock=()=>{document.pointerLockElement=null;document.dispatchEvent(new window.Event('pointerlockchange'));};
const renderer={canvas:document.getElementById('scene'),extent:[474/529,1,474/529],settings:{palette:4,cleanupEnabled:true,threshold:.28,capContrast:1.8},camera:{yaw:0,pitch:0,roll:0,distance:1.7,pan:[0,0,0]},autoRotate:true,uploads:0,
 set(values){Object.assign(this.settings,values);},clearCapData(){this.cap=null;},setCapData(cap){this.cap=cap;this.uploads++;},alignPlane(normal,up,center){this.camera.pan=[...center];},requestRender(){},basis(){return {eye:[0,0,2],forward:[0,0,-1],right:[1,0,0],up:[0,1,0]};}};
const module=new ProbeLabModule({renderer,mount:document.getElementById('mount'),frames});
const viewport=document.getElementById('probeViewportMount');
viewport.requestPointerLock=()=>{lockRequests++;document.pointerLockElement=viewport;document.dispatchEvent(new window.Event('pointerlockchange'));return Promise.resolve();};
const meta={dimensions:[475,475,530],spacingUm:317.6};
module.setVolume(new Uint8Array(125),meta);assert.equal(workers.length,0,'An inactive module must not clone the scan to a worker.');
await module.enter();
assert.equal(workers.length,1);assert.equal(lockRequests,0,'Entering the module must not capture the cursor automatically.');
assert.ok(module.state.originMm.every(Number.isFinite));assert.equal(renderer.autoRotate,false);
assert.equal(workers[0].messages.filter(m=>m.type==='sample').length,1,'Startup should issue a single live sample.');
assert.equal(framesPending.size,1);
const checks=['Module entry prepares one worker and one live scan without requesting pointer lock.'];

await module.captureControl();assert.equal(lockRequests,1);assert.equal(module.isLocked(),true);
assert.equal(module.$('lock-badge').hidden,false);assert.equal(document.activeElement,viewport);
const event=code=>({code,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;}});
const w=event('KeyW');module.keyDown(w);assert.equal(w.prevented,true);
const before=[...module.state.originMm];framesPending.clear();module.lastTick=100;module.tick(150);
assert.ok(Math.hypot(...before.map((x,i)=>x-module.state.originMm[i]))>1,'W moves the physical probe along its beam.');
module.mouseMove(15,-10);assert.notEqual(module.state.sweepDeg,0);assert.notEqual(module.state.tiltDeg,0);
const sweep=module.state.sweepDeg;module.mouseMove(10,0,true);assert.equal(module.state.sweepDeg,sweep);assert.notEqual(module.state.rollDeg,0);
module.keyDown(event('Escape'));assert.equal(module.isLocked(),false);assert.equal(module.keys.size,0);assert.equal(module.$('lock-badge').hidden,true);
checks.push('Explicit capture, WASD movement, mouse steering, Alt-mouse roll and Escape release update actual module state correctly.');

document.activeElement=module.mount.querySelector('input');const inputEvent=event('KeyW');module.keyDown(inputEvent);assert.equal(inputEvent.prevented,undefined,'Typing/editing an input must not move the probe.');
viewport.requestPointerLock=()=>Promise.reject(new Error('Mock permission denial'));await module.captureControl();assert.match(module.$('lock-status').textContent,/not enabled/);assert.equal(module.isLocked(),false);
delete viewport.requestPointerLock;await module.captureControl();assert.match(module.$('lock-status').textContent,/unavailable/);assert.equal(document.activeElement,module.$('steer-pad'));
checks.push('Focused inputs are respected; denied or unsupported cursor capture leaves drag and form controls available.');

const pose=module.getPose(),plane=probeCapPlane(pose,module.geometry),id=module.sequence+1;
const frame={id,version:module.version,pose,state:{...module.state},plane,cap:new Uint8Array(4),capWidth:2,capHeight:2,ct:new Uint8Array([0,100,200,0]),ultrasound:new Uint8Array([0,80,160,0]),width:2,height:2,sector:{depthMm:module.state.depthMm,widthMm:140},stats:{tissueFraction:.5},fast:true};
module.acceptFrame(frame);assert.equal(module.displayedId,id);assert.equal(renderer.cap.plane,plane);assert.equal(module.$('ct').width,2);assert.equal(module.$('ultrasound').width,2);
const uploads=renderer.uploads;module.acceptFrame({...frame,id:id-1});module.acceptFrame({...frame,id:id+1,version:module.version-1});assert.equal(renderer.uploads,uploads);
checks.push('One accepted frame updates the 3D cap and both images together; old frames and old volume generations are ignored.');

const saved=module.getState();module.restore(saved);assert.deepEqual(module.getState(),saved);module.keys.add('KeyW');module.leave();assert.equal(module.keys.size,0);assert.equal(module.raf,0);assert.equal(module.sampleTimer,0);assert.equal(framesPending.size,0);assert.equal(workers[0].terminated,true);assert.equal(module.active,false);assert.equal(renderer.cap,null);
module.acceptFrame({...frame,id:id+2});assert.equal(renderer.cap,null);
checks.push('Saved probe poses round-trip and leaving releases workers, capture, movement, timers and rendering callbacks.');

let resolveInit;module.init=()=>new Promise(resolve=>{resolveInit=resolve;});
const deferred=module.init();module.init=()=>deferred;
const oldEnter=module.enter();module.leave();const newEnter=module.enter();resolveInit(module);await Promise.all([oldEnter,newEnter]);
assert.equal(framesPending.size,1,'An obsolete asynchronous enter must not create a second RAF loop.');module.leave();
checks.push('Rapid leave/re-enter during initialization produces one active RAF loop.');

const result={passed:true,checks,scope:'Actual ProbeLabModule and test DOM with mocked rendering, worker transport and pointer-lock permission. This does not verify real browser capture, playback or frame rate.'};
await writeFile('docs/probe-integration-validation-v6.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
