import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {TeeLabModule} from '../public/tee-lab.js';
import {sanitizeTeeState} from '../public/tee-geometry.js';
import {TEE_CONTEXT_REVISION} from '../public/tee-context-geometry.js';

// The production module and its actual DOM listeners are exercised here. Only
// the expensive image pipeline and animation scheduler are replaced.
const domPath=process.argv.find(value=>value.startsWith('--dom='))?.slice(6)||process.env.HEART_DOM_MODULE||'/workspace/data/heart-ui-test-v11/node_modules/linkedom/esm/index.js';
const {parseHTML}=await import(pathToFileURL(domPath));
const globals=['document','window','ResizeObserver','requestAnimationFrame','cancelAnimationFrame'];
const original=Object.fromEntries(globals.map(key=>[key,globalThis[key]]));
let fixture;
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);

function environment(){
 const {document,window}=parseHTML('<html><body><section id="teePanel"></section><button id="outside">Outside</button></body></html>');
 Object.assign(globalThis,{document,window,ResizeObserver:class{observe(){}},requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{}});
 Object.defineProperty(document,'activeElement',{configurable:true,writable:true,value:document.body});
 Object.defineProperty(document,'hidden',{configurable:true,writable:true,value:false});
 const event=(type,properties={})=>{const e=new window.Event(type,{bubbles:true,cancelable:true});for(const[key,value]of Object.entries(properties))Object.defineProperty(e,key,{value});return e;};
 window.HTMLElement.prototype.focus=function(){
  const previous=document.activeElement;if(previous===this)return;
  document.activeElement=this;previous?.dispatchEvent(event('focusout',{relatedTarget:this}));this.dispatchEvent(event('focusin',{relatedTarget:previous}));
 };
 const captures=new Map();
 window.HTMLElement.prototype.setPointerCapture=function(id){captures.set(id,this);};
 window.HTMLElement.prototype.releasePointerCapture=function(id){captures.delete(id);};
 const renderer={settings:{palette:4},clearCapData(){}};
 const module=new TeeLabModule({mount:document.querySelector('#teePanel'),renderer,onExit:()=>module.leave()});
 module.active=true;module.lastTick=0;module.drawGuide=()=>{};module.orientCamera=()=>{};module.invalidatePending=()=>{};
 let changes=0;module.poseChanged=()=>{changes++;module.updateUI();};
 const focus=module.mount.querySelector('#teeViewportMount');focus.focus();
 const down=(code,extra={})=>{const e=event('keydown',{code,...extra});document.dispatchEvent(e);return e;};
 const up=(code,extra={})=>document.dispatchEvent(event('keyup',{code,...extra}));
 const tick=(ms=40)=>module.tick(module.lastTick+ms);
 const key=code=>module.mount.querySelector(`[data-tee-key="${code}"]`);
 const pointer=(target,type,id=1,extra={})=>target.dispatchEvent(event(type,{pointerId:id,button:0,...extra}));
 return fixture={module,document,window,event,down,up,tick,key,pointer,captures,focus,changes:()=>changes};
}
test.afterEach(()=>{fixture?.module.leave();fixture=null;for(const[key,value]of Object.entries(original)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});

test('visible two-hand console retains named sliders and replaces numeric quick presets and the banner',()=>{
 const f=environment(),m=f.module;
 assert.equal(m.mount.querySelectorAll('[data-tee-key]').length,10);
 assert.equal(m.mount.querySelectorAll('[data-tee-step],[data-tee-plane]').length,0);
 assert.equal(m.mount.querySelector('h2'),null);
 assert.equal(m.mount.querySelector('.tee-workspace').getAttribute('aria-label'),'TEE Lab');
 assert.equal(m.mount.querySelector('.tee-hand-controls').closest('details'),null);
 assert.deepEqual([...m.mount.querySelectorAll('.tee-mechanical-controls [data-tee-range]')].map(input=>input.dataset.teeRange),['insertionCm','shaftRotationDeg','anteflexDeg','lateralFlexDeg','multiplaneDeg']);
 for(const code of ['KeyW','KeyS','KeyA','KeyD','KeyQ','KeyE','KeyI','KeyK','KeyJ','KeyL']){
  assert.ok(f.key(code).getAttribute('aria-label').length>4);assert.equal(f.key(code).getAttribute('aria-keyshortcuts'),code.slice(3));
 }
 assert.match(m.mount.querySelector('#teeKeyboardHint').textContent,/Hold a key.*Shift.*Fine.*Always Ready/);
 assert.doesNotMatch(m.mount.querySelector('#teeKeyboardHint').textContent,/Click here|Esc/);
 assert.equal(m.mount.querySelector('.tee-hand-controls').hasAttribute('tabindex'),false);
 const ids=[...m.mount.querySelectorAll('[id]')].map(element=>element.id);assert.equal(new Set(ids).size,ids.length);
});

test('all ten keyboard directions update only their own axis, with a responsive tap and continuous hold',()=>{
 const f=environment(),m=f.module;
 const bindings=[['KeyW','insertionCm',1,.1,1.8],['KeyS','insertionCm',-1,.1,1.8],['KeyA','shaftRotationDeg',-1,1,35],['KeyD','shaftRotationDeg',1,1,35],['KeyQ','multiplaneDeg',-1,1,35],['KeyE','multiplaneDeg',1,1,35],['KeyI','anteflexDeg',1,1,28],['KeyK','anteflexDeg',-1,1,28],['KeyJ','lateralFlexDeg',-1,1,28],['KeyL','lateralFlexDeg',1,1,28]];
 for(const[code,field,direction,step,rate]of bindings){
  m.releaseControl();m.state=sanitizeTeeState({teeVersion:1,insertionCm:35,multiplaneDeg:90});
  const before={...m.state},e=f.down(code);assert.equal(e.defaultPrevented,true);
  near(m.state[field],before[field]+direction*step);assert.equal(f.key(code).getAttribute('aria-pressed'),'true');
  f.tick();near(m.state[field],before[field]+direction*(step+rate*.04));
  for(const other of ['insertionCm','shaftRotationDeg','multiplaneDeg','anteflexDeg','lateralFlexDeg'])if(other!==field)assert.equal(m.state[other],before[other]);
  f.up(code);const stopped=m.state[field];f.tick();assert.equal(m.state[field],stopped);assert.equal(f.key(code).getAttribute('aria-pressed'),'false');
 }
});

test('native key repeat cannot add extra steps or restart motion after Escape',()=>{
 const f=environment(),m=f.module;f.down('KeyW');const tapped=m.state.insertionCm;
 for(let i=0;i<12;i++)f.down('KeyW',{repeat:true});assert.equal(m.state.insertionCm,tapped);
 f.tick();near(m.state.insertionCm,tapped+1.8*.04);
 f.down('Escape');const stopped=m.state.insertionCm;f.down('KeyW',{repeat:true});f.tick();assert.equal(m.state.insertionCm,stopped);assert.equal(m.keys.size,0);
 f.up('KeyW');f.down('KeyW');assert.ok(m.state.insertionCm>stopped);
});

test('Shift fine control works before focus, during a hold and after release',()=>{
 const f=environment(),m=f.module;const initial=m.state.insertionCm;
 f.down('KeyW',{shiftKey:true});near(m.state.insertionCm,initial+.1*.22);f.tick();near(m.state.insertionCm,initial+(.1+1.8*.04)*.22);
 assert.equal(m.tee('precision-key').classList.contains('is-held'),true);
 f.up('ShiftLeft');let before=m.state.insertionCm;f.tick();near(m.state.insertionCm,before+1.8*.04);
 f.down('ShiftLeft',{shiftKey:true});before=m.state.insertionCm;f.tick();near(m.state.insertionCm,before+1.8*.04*.22);
 f.up('ShiftLeft');assert.equal(m.tee('precision-key').classList.contains('is-held'),false);
});

test('simultaneous hands combine independent axes; opposite keys cancel and arrow aliases do not double speed',()=>{
 const f=environment(),m=f.module;f.down('KeyW');f.down('KeyD');f.down('KeyI');const before={...m.state};f.tick();
 near(m.state.insertionCm,before.insertionCm+1.8*.04);near(m.state.shaftRotationDeg,before.shaftRotationDeg+35*.04);near(m.state.anteflexDeg,before.anteflexDeg+28*.04);
 f.down('KeyS');const canceled=m.state.insertionCm;f.tick();near(m.state.insertionCm,canceled);
 f.down('ArrowUp');const angle=m.state.anteflexDeg;f.tick();near(m.state.anteflexDeg,angle+28*.04);
 f.up('KeyI');assert.equal(f.key('KeyI').classList.contains('is-held'),true);f.up('ArrowUp');assert.equal(f.key('KeyI').classList.contains('is-held'),false);
 m.releaseControl();f.down('ArrowLeft');assert.equal(f.key('KeyJ').classList.contains('is-held'),true);
});

test('keyboard works from initial body focus and other ordinary page controls without arming a keypad',()=>{
 const f=environment(),m=f.module;
 for(const target of [f.document.body,f.document.getElementById('outside'),m.tee('atlas')]){
  m.releaseControl();target.focus();const before=m.state.insertionCm;
  const e=f.down('KeyW');assert.equal(e.defaultPrevented,true);assert.ok(m.state.insertionCm>before);
  const tapped=m.state.insertionCm;f.tick();near(m.state.insertionCm,tapped+1.8*.04);f.up('KeyW');
 }
});

test('editable focus immediately releases motion, including contenteditable and controls inside or outside the TEE panel',()=>{
 const f=environment(),m=f.module;
 for(const html of ['<input>','<input type="number">','<select></select>','<textarea></textarea>','<div contenteditable=""><span>Text</span></div>','<div contenteditable="plaintext-only">Text</div>','<div role="textbox">Text</div>']){
  f.focus.focus();f.down('KeyW');const holder=f.document.createElement('div');holder.innerHTML=html;m.mount.append(holder);const input=holder.firstElementChild;
  input.focus();assert.equal(m.keys.size,0);const before=m.state.insertionCm;f.tick();f.down('KeyW');assert.equal(m.state.insertionCm,before);assert.equal(m.keys.size,0);holder.remove();
 }
 const outsideInput=f.document.createElement('input');f.document.body.append(outsideInput);
 f.focus.focus();f.down('KeyW');outsideInput.focus();assert.equal(m.keys.size,0);
 const before=m.state.insertionCm;assert.equal(f.down('KeyW').defaultPrevented,false);f.tick();assert.equal(m.state.insertionCm,before);
});

test('letter shortcuts work after a slider or checkbox adjustment, with native range arrows preserved',()=>{
 const f=environment(),m=f.module,slider=m.mount.querySelector('[data-tee-range="insertionCm"]');
 f.down('ArrowUp');slider.focus();assert.equal(m.keys.size,0);
 const angle=m.state.anteflexDeg;for(const code of ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'])assert.equal(f.down(code).defaultPrevented,false);
 f.tick();near(m.state.anteflexDeg,angle);
 for(const control of [slider,m.$('cutaway')]){
  control.focus();const before=m.state.insertionCm;assert.equal(f.down('KeyW').defaultPrevented,true);f.tick();assert.ok(m.state.insertionCm>before);f.up('KeyW');
  assert.equal(f.down('Space').defaultPrevented,false);
 }
});

test('Ctrl, Meta, Alt and composition preserve browser shortcuts and stop a held probe',()=>{
 const f=environment(),m=f.module;
 for(const modifier of ['ctrlKey','metaKey','altKey','isComposing']){
  f.focus.focus();f.down('KeyW');const before=m.state.insertionCm;const e=f.down('KeyD',{[modifier]:true});
  assert.equal(e.defaultPrevented,false);assert.equal(m.keys.size,0);f.tick();assert.equal(m.state.insertionCm,before);
  assert.equal(f.key('KeyW').getAttribute('aria-pressed'),'false');
 }
});

test('blur, visibility, lock, reset, restore and module exit release every input and key highlight',()=>{
 const f=environment(),m=f.module;
 const stops=[()=>f.window.dispatchEvent(f.event('blur')),()=>{f.document.hidden=true;f.document.dispatchEvent(f.event('visibilitychange'));f.document.hidden=false;},()=>m.tee('lock').click(),()=>m.tee('reset').click(),()=>m.restore(m.getState())];
 for(const stop of stops){
  if(m.state.probeLocked)m.tee('lock').click();f.focus.focus();f.down('KeyW');f.pointer(f.key('KeyI'),'pointerdown');assert.ok(m.keys.size&&m.pointerControls.size);
  stop();assert.equal(m.keys.size,0);assert.equal(m.pointerControls.size,0);assert.equal(f.captures.size,0);assert.equal(m.mount.querySelectorAll('.tee-control-key.is-held').length,0);
 }
 m.tee('lock').click();assert.equal(m.state.probeLocked,true);assert.ok([...m.mount.querySelectorAll('[data-tee-key]')].every(button=>button.disabled));
 const locked=m.state.insertionCm;f.focus.focus();f.down('KeyW');f.key('KeyW').click();f.tick();assert.equal(m.state.insertionCm,locked);
 m.tee('lock').click();f.down('KeyW');m.$('exit').click();assert.equal(m.active,false);assert.equal(m.keys.size,0);assert.equal(m.pointerControls.size,0);
 const exited=m.state.insertionCm;f.down('KeyW');f.key('KeyW').click();f.tick();assert.equal(m.state.insertionCm,exited);
});

test('keycaps support pointer hold, multi-touch, cancellation and one-step accessible clicks without duplicate pointer clicks',()=>{
 const f=environment(),m=f.module,advance=f.key('KeyW');const before=m.state.insertionCm;
 f.pointer(advance,'pointerdown',7);near(m.state.insertionCm,before+.1);assert.equal(f.captures.get(7),advance);f.tick();near(m.state.insertionCm,before+.1+1.8*.04);
 f.pointer(f.key('KeyI'),'pointerdown',8);assert.equal(m.pointerControls.size,2);f.pointer(advance,'pointerup',7);assert.equal(m.pointerControls.size,1);
 const stopped=m.state.insertionCm;advance.dispatchEvent(f.event('click',{detail:1,pointerId:7}));assert.equal(m.state.insertionCm,stopped);
 f.tick();assert.equal(m.state.insertionCm,stopped);f.pointer(f.key('KeyI'),'pointercancel',8);assert.equal(m.pointerControls.size,0);assert.equal(f.captures.size,0);
 advance.dispatchEvent(f.event('click',{detail:0}));near(m.state.insertionCm,stopped+.1);
 for(const type of ['lostpointercapture','pointercancel']){f.pointer(advance,'pointerdown',4);f.pointer(advance,type,4);assert.equal(m.pointerControls.size,0);}
 f.pointer(advance,'pointerdown',5);f.pointer(f.window,'pointerup',5);assert.equal(m.pointerControls.size,0);
 f.pointer(advance,'pointerdown',6,{shiftKey:true});const fine=m.state.insertionCm;f.tick();near(m.state.insertionCm,fine+1.8*.04*.22);f.up('ShiftLeft');const normal=m.state.insertionCm;f.tick();near(m.state.insertionCm,normal+1.8*.04);
});

test('physical limits remain bounded and a long frame cannot cause a large jump',()=>{
 const f=environment(),m=f.module;m.state.multiplaneDeg=179.8;f.down('KeyE');f.tick();assert.equal(m.state.multiplaneDeg,180);
 m.releaseControl();m.state.anteflexDeg=89.9;f.down('KeyI');f.tick();assert.equal(m.state.anteflexDeg,90);
 m.releaseControl();m.state.lateralFlexDeg=-59.9;f.down('KeyJ');f.tick();assert.equal(m.state.lateralFlexDeg,-60);
 m.releaseControl();f.down('KeyW');const before=m.state.insertionCm;f.tick(60000);near(m.state.insertionCm,before+1.8*.05);
});

test('obsolete S20 bookmarks use the current fitted TEE preset while preserving imaging preferences',()=>{
 const f=environment(),m=f.module,evidence={donorId:'s-20-test',calibrationRevision:'landmarks-v2',revision:'planes-v3'},frame={center:[0,0,0],right:[1,0,0],up:[0,1,0],normal:[0,0,1],donorCalibration:evidence};
 m.frames={a4c:frame,me4c:frame,melax:frame};m.donor={clinicalPresetsReviewed:false};
 const fitted={insertionCm:36.4,shaftRotationDeg:12.5,anteflexDeg:10,lateralFlexDeg:-4.1,multiplaneDeg:123,depthMm:140};
 m.reference().presetStates={melax:fitted};
 const legacy={...m.getState(),donorPlaneRevision:'obsolete',teePreset:'melax',insertionCm:43,shaftRotationDeg:-37,anteflexDeg:29,lateralFlexDeg:31,multiplaneDeg:62,depthMm:75,gainDb:6,imageMode:'ct',showSurface:false,probeLocked:true};
 m.restore(legacy);for(const[key,value]of Object.entries(fitted))near(m.state[key],value);
 assert.equal(m.state.teePreset,'melax');assert.equal(m.state.probeLocked,false);assert.equal(m.state.gainDb,6);assert.equal(m.state.imageMode,'ct');assert.equal(m.state.showSurface,false);
 assert.match(m.tee('preset-note').textContent,/specimen.*landmarks.*unvalidated/);
 f.down('KeyD');f.up('KeyD');f.down('KeyI');f.up('KeyI');const current=m.getState();assert.equal(current.donorPlaneRevision,'s-20-test:landmarks-v2:planes-v3');assert.equal(current.teeContextRevision,TEE_CONTEXT_REVISION);
 m.restore(current);for(const key of ['insertionCm','shaftRotationDeg','anteflexDeg','lateralFlexDeg','multiplaneDeg'])near(m.state[key],current[key]);assert.equal(m.hasRestoredPose,true);
 m.restore({...current,teeContextRevision:'old-context'});for(const[key,value]of Object.entries(fitted))near(m.state[key],value);
 const missing={...current};delete missing.donorPlaneRevision;m.restore(missing);for(const[key,value]of Object.entries(fitted))near(m.state[key],value);
});

test('LADAF and other uncalibrated bookmarks retain their saved TEE position',()=>{
 const f=environment(),m=f.module,saved={...m.getState(),insertionCm:43.7,shaftRotationDeg:18,anteflexDeg:-12,lateralFlexDeg:9,multiplaneDeg:57,gainDb:4,imageMode:'ct'};
 m.restore(saved);for(const key of ['insertionCm','shaftRotationDeg','anteflexDeg','lateralFlexDeg','multiplaneDeg','gainDb','imageMode'])assert.equal(m.state[key],saved[key]);
 assert.equal(m.getState().donorPlaneRevision,undefined);assert.equal(m.getState().teeContextRevision,undefined);
});
