import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {ProbeLabModule} from '../public/probe-lab.js';
import {sanitizeProbeState,setProbeContactLocked} from '../public/probe-geometry.js';

// Exercise the actual module, template and event listeners. Only the costly
// image pipeline and animation scheduler are replaced; this is not browser QA.
const domPath=process.argv.find(value=>value.startsWith('--dom='))?.slice(6)||process.env.HEART_DOM_MODULE||'/tmp/heart-review-test-deps/node_modules/linkedom/esm/index.js';
const {parseHTML}=await import(pathToFileURL(domPath));
const globals=['document','window','ResizeObserver','requestAnimationFrame','cancelAnimationFrame'];
const original=Object.fromEntries(globals.map(key=>[key,globalThis[key]]));
let fixture;
const near=(actual,expected,tolerance=1e-8)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`);

function environment(){
 const {document,window}=parseHTML('<html><body><section id="probePanel"></section><button id="outside">Outside</button></body></html>');
 Object.assign(globalThis,{document,window,ResizeObserver:class{observe(){}},requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{}});
 Object.defineProperty(document,'activeElement',{configurable:true,writable:true,value:document.body});
 Object.defineProperty(document,'hidden',{configurable:true,writable:true,value:false});
 Object.defineProperty(document,'pointerLockElement',{configurable:true,writable:true,value:null});
 const event=(type,properties={})=>{const e=new window.Event(type,{bubbles:true,cancelable:true});for(const[key,value]of Object.entries(properties))Object.defineProperty(e,key,{value});return e;};
 window.HTMLElement.prototype.focus=function(){const previous=document.activeElement;if(previous===this)return;document.activeElement=this;previous?.dispatchEvent(event('focusout',{relatedTarget:this}));this.dispatchEvent(event('focusin',{relatedTarget:previous}));};
 window.HTMLElement.prototype.blur=function(){if(document.activeElement===this)document.body.focus();};
 const captures=new Map();
 window.HTMLElement.prototype.setPointerCapture=function(id){captures.set(id,this);};
 window.HTMLElement.prototype.releasePointerCapture=function(id){captures.delete(id);};
 const renderer={settings:{palette:4},clearCapData(){}};
 const frame={center:[0,0,0],right:[1,0,0],up:[0,1,0],normal:[0,0,1]};
 const frames=Object.fromEntries(['a4c','plax','psax_papillary','me4c'].map(id=>[id,{...frame}]));
 const module=new ProbeLabModule({mount:document.getElementById('probePanel'),renderer,frames});
 module.active=true;module.lastTick=0;module.ensureOrigin();module.drawGuide=()=>{};module.orientCamera=()=>{};module.invalidatePending=()=>{};
 let changes=0;module.poseChanged=()=>{changes++;module.ensureOrigin();module.updateUI();};
 const viewport=module.mount.querySelector('#probeViewportMount');let locks=0;
 viewport.requestPointerLock=()=>{locks++;document.pointerLockElement=viewport;document.dispatchEvent(event('pointerlockchange'));};
 document.exitPointerLock=()=>{document.pointerLockElement=null;document.dispatchEvent(event('pointerlockchange'));};
 const down=(code,extra={})=>{const e=event('keydown',{code,...extra});document.dispatchEvent(e);return e;};
 const up=(code,extra={})=>document.dispatchEvent(event('keyup',{code,...extra}));
 const tick=(ms=40)=>module.tick(module.lastTick+ms);
 const key=code=>module.mount.querySelector(`[data-probe-key="${code}"]`);
 const pointer=(target,type,id=1,extra={})=>target.dispatchEvent(event(type,{pointerId:id,button:0,...extra}));
 return fixture={module,document,window,event,down,up,tick,key,pointer,captures,viewport,locks:()=>locks,changes:()=>changes};
}
test.afterEach(()=>{fixture?.module.leave();fixture=null;for(const[key,value]of Object.entries(original)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});

test('fresh TTE uses orbit and places starting views above anatomy with keyboard controls beneath',()=>{
 const f=environment(),m=f.module,chest=m.mount.querySelector('.probe-body-context'),children=[...chest.children];
 assert.equal(m.state.interactionMode,'orbit');assert.equal(m.mount.querySelector('[data-probe-interaction="orbit"]').getAttribute('aria-pressed'),'true');
 assert.equal(m.$('capture').getAttribute('aria-pressed'),'false');assert.equal(m.mount.querySelector('h2'),null);
 const starts=chest.querySelector('.workspace-starting-views'),torso=chest.querySelector('.probe-torso-wrap'),keys=chest.querySelector('.probe-keyboard-console');
 assert.ok(children.indexOf(starts)<children.indexOf(torso));assert.ok(children.indexOf(torso)<children.indexOf(keys));
 assert.equal(starts.querySelectorAll('[data-probe-preset]').length,4);assert.equal(f.viewport.contains(starts),false);assert.equal(keys.closest('details'),null);
 assert.equal(keys.querySelectorAll('[data-probe-key]').length,12);assert.equal(m.$('free-help').hidden,true);
 for(const button of keys.querySelectorAll('[data-probe-key]')){assert.ok(button.getAttribute('aria-label').length>4);assert.equal(button.getAttribute('aria-keyshortcuts'),button.dataset.probeKey.slice(3));}
 assert.match(keys.textContent,/WASD Slide.*Q\/E Rotate.*I\/K Tilt.*J\/L Fan/);assert.doesNotMatch(keys.textContent,/Click here|Escape|Esc/);
 const ids=[...m.mount.querySelectorAll('[id]')].map(element=>element.id);assert.equal(new Set(ids).size,ids.length);
});

test('ordinary page focus allows steering immediately while mouse gestures remain orbit gestures',()=>{
 const f=environment(),m=f.module;
 for(const target of [f.document.body,f.document.getElementById('outside'),f.viewport,m.mount.querySelector('[data-probe-torso-view="front"]')]){
  m.reset();target.focus();const before=m.state.contactPositionMm[1];
  const e=f.down('KeyW');assert.equal(e.defaultPrevented,true);near(m.state.contactPositionMm[1],before+1);
  f.tick();assert.ok(m.state.contactPositionMm[1]>before+1);f.up('KeyW');assert.equal(m.state.interactionMode,'orbit');
 }
 const press=f.event('pointerdown',{button:0,pointerId:7});f.viewport.dispatchEvent(press);
 assert.equal(press.defaultPrevented,false);assert.equal(f.locks(),0);assert.equal(m.hasControl(),false);
 assert.equal(f.down('ArrowLeft').defaultPrevented,false,'Camera arrows remain available to the focused 3D canvas.');
});

test('all ten visible steering keys have a responsive tap, continuous hold and matching live feedback',()=>{
 const f=environment(),m=f.module;
 const controls=[['KeyW','contactPositionMm',1,1],['KeyS','contactPositionMm',1,-1],['KeyA','contactPositionMm',0,-1],['KeyD','contactPositionMm',0,1],['KeyQ','rollDeg',null,-1],['KeyE','rollDeg',null,1],['KeyI','tiltDeg',null,-1],['KeyK','tiltDeg',null,1],['KeyJ','sweepDeg',null,-1],['KeyL','sweepDeg',null,1]];
 for(const[code,field,index,sign]of controls){
  m.reset();const value=()=>index===null?m.state[field]:m.state[field][index],before=value();
  f.down(code);near(value(),before+sign);assert.equal(f.key(code).getAttribute('aria-pressed'),'true');
  const afterTap=value();f.tick();assert.ok((value()-afterTap)*sign>0);f.up(code);
  const stopped=value();f.tick();near(value(),stopped);assert.equal(f.key(code).getAttribute('aria-pressed'),'false');assert.equal(m.state.interactionMode,'orbit');
 }
});

test('Shift precision, opposite keys and simultaneous hands share one bounded steering state',()=>{
 const f=environment(),m=f.module;
 f.down('KeyE',{shiftKey:true});near(m.state.rollDeg,.2);f.tick();near(m.state.rollDeg,.2+36*.04*.2);
 assert.equal(m.$('precision-key').classList.contains('is-held'),true);f.up('ShiftLeft');const normal=m.state.rollDeg;f.tick();near(m.state.rollDeg,normal+36*.04);
 f.down('KeyQ');const canceled=m.state.rollDeg;f.tick();near(m.state.rollDeg,canceled);
 f.down('KeyW');f.down('KeyI');f.down('KeyL');const before={u:m.state.contactPositionMm[1],tilt:m.state.tiltDeg,sweep:m.state.sweepDeg};f.tick();
 assert.ok(m.state.contactPositionMm[1]>before.u);near(m.state.tiltDeg,before.tilt-28*.04);near(m.state.sweepDeg,before.sweep+28*.04);
 m.releaseKeyboardControls();f.down('KeyE');const longFrame=m.state.rollDeg;f.tick(60000);near(m.state.rollDeg,longFrame+36*.05);
});

test('native repetition cannot add tap steps or restart after an interrupted hold',()=>{
 const f=environment(),m=f.module;f.down('KeyE');const tapped=m.state.rollDeg;
 for(let i=0;i<10;i++)f.down('KeyE',{repeat:true});near(m.state.rollDeg,tapped);f.tick();near(m.state.rollDeg,tapped+36*.04);
 f.window.dispatchEvent(f.event('blur'));const before=m.state.rollDeg;f.down('KeyE',{repeat:true});f.tick();near(m.state.rollDeg,before);assert.equal(m.keys.size,0);
 f.up('KeyE');f.down('KeyE');assert.ok(m.state.rollDeg>before);
});

test('editable controls and browser modifiers release steering and retain their native key behavior',()=>{
 const f=environment(),m=f.module;
 for(const html of ['<input>','<input type="number">','<select></select>','<textarea></textarea>','<div contenteditable=""><span>Text</span></div>','<div contenteditable="plaintext-only">Text</div>','<div role="textbox">Text</div>']){
  f.document.body.focus();f.down('KeyE');const holder=f.document.createElement('div');holder.innerHTML=html;f.document.body.append(holder);holder.firstElementChild.focus();
  assert.equal(m.keys.size,0);const before=m.state.rollDeg;assert.equal(f.down('KeyE').defaultPrevented,false);f.tick();near(m.state.rollDeg,before);holder.remove();
 }
 for(const modifier of ['ctrlKey','metaKey','altKey','isComposing']){
  f.document.body.focus();f.down('KeyE');const before=m.state.rollDeg;assert.equal(f.down('KeyD',{[modifier]:true}).defaultPrevented,false);
  assert.equal(m.keys.size,0);f.tick();near(m.state.rollDeg,before);assert.equal(f.key('KeyE').getAttribute('aria-pressed'),'false');
 }
});

test('letter shortcuts remain ready after using a slider or checkbox while native keys remain available',()=>{
 const f=environment(),m=f.module;
 for(const control of [m.mount.querySelector('[data-probe-range="depthMm"]'),m.$('cutaway')]){
  f.document.body.focus();f.down('KeyE');control.focus();assert.equal(m.keys.size,0);
  const before=m.state.rollDeg;assert.equal(f.down('KeyE').defaultPrevented,true);f.tick();assert.ok(m.state.rollDeg>before);f.up('KeyE');
  for(const code of ['ArrowUp','ArrowDown','Space'])assert.equal(f.down(code).defaultPrevented,false);
 }
});

test('keycaps support multi-touch holds, cancellation and one-step accessible activation without duplicate clicks',()=>{
 const f=environment(),m=f.module,roll=f.key('KeyE');f.pointer(roll,'pointerdown',7);near(m.state.rollDeg,1);assert.equal(f.captures.get(7),roll);
 f.tick();near(m.state.rollDeg,1+36*.04);f.pointer(f.key('KeyI'),'pointerdown',8);assert.equal(m.pointerControls.size,2);
 f.pointer(roll,'pointerup',7);const stopped=m.state.rollDeg;roll.dispatchEvent(f.event('click',{detail:1,pointerId:7}));near(m.state.rollDeg,stopped);
 f.tick();near(m.state.rollDeg,stopped);f.pointer(f.key('KeyI'),'pointercancel',8);assert.equal(m.pointerControls.size,0);assert.equal(f.captures.size,0);
 roll.dispatchEvent(f.event('click',{detail:0}));near(m.state.rollDeg,stopped+1);
 for(const type of ['lostpointercapture','pointercancel']){f.pointer(roll,'pointerdown',4);f.pointer(roll,type,4);assert.equal(m.pointerControls.size,0);}
 f.pointer(roll,'pointerdown',5);f.pointer(f.window,'pointerup',5);assert.equal(m.pointerControls.size,0);
 f.pointer(roll,'pointerdown',6,{shiftKey:true});const fine=m.state.rollDeg;f.tick();near(m.state.rollDeg,fine+36*.04*.2);
 f.up('ShiftLeft');const normal=m.state.rollDeg;f.tick();near(m.state.rollDeg,normal+36*.04);
});

test('free-position keys remain disabled on contact and move only the free pose',()=>{
 const f=environment(),m=f.module;const before=[...m.state.originMm];
 assert.equal(f.key('KeyR').disabled,true);f.down('KeyR');f.tick();assert.deepEqual(m.state.originMm,before);assert.equal(m.keys.has('KeyR'),false);
 m.state=setProbeContactLocked(m.state,m.frameForState(),false);m.updateUI();assert.equal(m.$('free-help').hidden,false);assert.equal(f.key('KeyR').disabled,false);
 f.down('KeyR');const moved=[...m.state.originMm];assert.notDeepEqual(moved,before);f.tick();assert.notDeepEqual(m.state.originMm,moved);f.up('KeyR');
 m.state=setProbeContactLocked(m.state,m.frameForState(),true);m.updateUI();assert.equal(m.$('free-help').hidden,true);
});

test('blur, hidden tab, reset, restore and exit release both hands; inactive labs never consume keys',()=>{
 const f=environment(),m=f.module;
 const stops=[()=>f.window.dispatchEvent(f.event('blur')),()=>{f.document.hidden=true;f.document.dispatchEvent(f.event('visibilitychange'));f.document.hidden=false;},()=>m.reset(),()=>m.restore({interactionMode:'orbit'})];
 for(const stop of stops){
  f.document.body.focus();f.down('KeyW');f.pointer(f.key('KeyI'),'pointerdown');assert.ok(m.keys.size&&m.pointerControls.size);stop();
  assert.equal(m.keys.size,0);assert.equal(m.pointerControls.size,0);assert.equal(f.captures.size,0);assert.equal(m.mount.querySelectorAll('.probe-control-key.is-held').length,0);
 }
 f.down('KeyE');m.leave();const before=m.state.rollDeg;assert.equal(f.down('KeyE').defaultPrevented,false);f.key('KeyE').click();f.tick();near(m.state.rollDeg,before);
 assert.equal(m.active,false);assert.equal(m.keys.size,0);assert.equal(m.pointerControls.size,0);
});

test('explicit mouse steering remains optional and one Escape releases its cursor without disarming the keyboard',()=>{
 const f=environment(),m=f.module;m.$('capture').click();assert.equal(f.locks(),1);assert.equal(m.hasControl(),true);
 f.down('KeyE');assert.equal(m.state.interactionMode,'probe');f.down('Escape');assert.equal(m.hasControl(),false);assert.equal(m.state.interactionMode,'orbit');
 const before=m.state.rollDeg;f.up('KeyE');f.document.body.focus();f.down('KeyE');assert.ok(m.state.rollDeg>before);assert.equal(f.locks(),1);
 m.restore({});assert.equal(m.state.interactionMode,'orbit');m.restore({interactionMode:'probe'});assert.equal(m.state.interactionMode,'probe','An explicit saved mouse mode remains readable.');
 assert.equal(m.hasControl(),false,'Restoring a view never requests cursor capture.');
});

test('obsolete S20 poses reset to the calibrated starting plane while current bookmarks and imaging preferences survive',()=>{
 const f=environment(),m=f.module,evidence={donorId:'s-20-test',calibrationRevision:'landmarks-v2',revision:'planes-v3'};
 for(const frame of Object.values(m.frames))frame.donorCalibration=evidence;
 m.donor={clinicalPresetsReviewed:false,geometricComparisonOnly:true};
 const legacy={...m.getState(),donorPlaneRevision:'obsolete',preset:'parasternal',contactLocked:false,originMm:[25,31,-17],contactPositionMm:[8,7],sweepDeg:13,tiltDeg:-21,rollDeg:42,depthMm:70,gainDb:7,imageMode:'ct',showSurface:false,interactionMode:'probe'};
 m.restore(legacy);assert.equal(m.state.preset,'parasternal');assert.equal(m.state.contactLocked,true);assert.deepEqual(m.state.contactPositionMm,[0,0]);
 assert.equal(m.state.sweepDeg,0);assert.equal(m.state.tiltDeg,0);assert.equal(m.state.rollDeg,0);assert.notDeepEqual(m.state.originMm,legacy.originMm);assert.ok(m.state.depthMm>legacy.depthMm);
 assert.equal(m.state.interactionMode,'orbit');assert.equal(m.state.gainDb,7);assert.equal(m.state.imageMode,'ct');assert.equal(m.state.showSurface,false);
 assert.match(m.$('preset-note').textContent,/specimen.*landmarks.*unvalidated/);assert.doesNotMatch(m.$('preset-note').textContent,/identity.*not assigned/);
 f.down('KeyD');f.up('KeyD');f.down('KeyI');f.up('KeyI');const current=m.getState();assert.equal(current.donorPlaneRevision,'s-20-test:landmarks-v2:planes-v3');
 m.reset();m.restore(current);assert.deepEqual(m.getState(),current);
 const missing={...current};delete missing.donorPlaneRevision;m.restore(missing);assert.equal(m.state.tiltDeg,0);assert.deepEqual(m.state.contactPositionMm,[0,0]);
});

test('uncalibrated legacy donors retain explicitly saved free probe positions',()=>{
 const f=environment(),m=f.module;
 const saved={...m.getState(),contactLocked:false,originMm:[14,27,-9],contactPositionMm:null,sweepDeg:17,tiltDeg:-11,rollDeg:24,depthMm:120,imageMode:'ct'};
 m.restore(saved);for(const key of ['originMm','contactLocked','sweepDeg','tiltDeg','rollDeg','depthMm','imageMode'])assert.deepEqual(m.state[key],saved[key]);
 assert.equal(m.getState().donorPlaneRevision,undefined);
});
