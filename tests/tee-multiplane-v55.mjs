import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {TeeLabModule} from '../public/tee-lab.js';
import {formatMultiplaneAngle,multiplanePoint} from '../public/multiplane-indicator.js';

// Real controls, accepted-frame rejection and image-mode events; pixels and
// worker scheduling are outside this display-only test.
const domPath=process.argv.find(value=>value.startsWith('--dom='))?.slice(6)||process.env.HEART_DOM_MODULE||'/tmp/heart-v55-test-deps/node_modules/linkedom/esm/index.js';
const {parseHTML}=await import(pathToFileURL(domPath));
const names=['document','window','ResizeObserver','requestAnimationFrame','cancelAnimationFrame'];
const originals=Object.fromEntries(names.map(name=>[name,globalThis[name]]));
let fixture;

function environment(){
 const {document,window}=parseHTML('<html><body><section id="teePanel"></section></body></html>');
 Object.assign(globalThis,{document,window,ResizeObserver:class{observe(){}},requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{}});
 Object.defineProperty(document,'activeElement',{configurable:true,writable:true,value:document.body});
 Object.defineProperty(document,'hidden',{configurable:true,writable:true,value:false});
 const renderer={settings:{palette:4,cleanupEnabled:true},clearCapData(){},setCapData(){}};
 const module=new TeeLabModule({mount:document.getElementById('teePanel'),renderer});
 module.setVolume(new Uint8Array(1),{dimensions:[2,2,2],spacingUm:1000});
 module.applyDisplayPlane=module.paintImages=module.drawGuide=module.orientCamera=module.ensureWorker=module.requestFrame=()=>{};
 module.poseChanged=function(){this.poseRevision++;this.updateUI();};
 module.active=true;
 const event=(type,properties={})=>{const e=new window.Event(type,{bubbles:true,cancelable:true});for(const[key,value]of Object.entries(properties))Object.defineProperty(e,key,{value});return e;};
 const frame=(angle,id=++module.sequence)=>({id,version:module.version,poseRevision:module.poseRevision,fast:true,state:{...module.state,multiplaneDeg:angle},stats:{sourceSpacingUm:1000,tissueFraction:.5},capSpacingUm:1000,cap:new Uint8Array(1),capWidth:1,capHeight:1});
 const value=key=>module.tee(key).querySelector('[data-multiplane="value"]').textContent;
 return fixture={module,document,event,frame,value};
}

test.afterEach(()=>{
 fixture?.module.leave();fixture=null;
 for(const[name,value]of Object.entries(originals)){if(value===undefined)delete globalThis[name];else globalThis[name]=value;}
});

test('image indicator waits for an accepted image and stays with displayed pixels while controls change',()=>{
 const f=environment(),m=f.module;
 assert.equal(m.tee('image-angle').hidden,true);
 const first=f.frame(5.5);m.acceptFrame(first);
 assert.equal(m.tee('image-angle').hidden,false);assert.equal(f.value('image-angle'),'5.5°');
 assert.match(m.tee('image-angle').textContent,/SIM/);
 const slider=m.mount.querySelector('[data-tee-range="multiplaneDeg"]');slider.value='90';slider.dispatchEvent(f.event('input'));
 assert.equal(m.state.multiplaneDeg,90);assert.equal(f.value('control-angle'),'90°');assert.equal(f.value('image-angle'),'5.5°');
 const next=f.frame(90);m.acceptFrame(next);assert.equal(f.value('image-angle'),'90°');
 const pointer=m.tee('image-angle').querySelector('[data-multiplane="pointer"]'),down=multiplanePoint(90);
 assert.equal(Number(pointer.getAttribute('x2')),down.x);assert.equal(Number(pointer.getAttribute('y2')),down.y);
 const indicator=m.tee('image-angle').querySelector('[data-multiplane="indicator"]');
 assert.match(indicator.getAttribute('aria-label'),/Displayed simulated multiplane angle 90 degrees/);
});

test('stale, canceled, inactive and previous-source frames cannot relabel the accepted image',()=>{
 const f=environment(),m=f.module,first=f.frame(30);m.acceptFrame(first);
 for(const rejected of [{...f.frame(120),version:m.version-1},{...f.frame(120),poseRevision:-1}]){
  m.acceptFrame(rejected);assert.equal(m.displayedFrame,first);assert.equal(f.value('image-angle'),'30°');
 }
 m.invalidatePending();m.acceptFrame({...first,state:{...first.state,multiplaneDeg:180}});assert.equal(f.value('image-angle'),'30°');
 m.active=false;m.acceptFrame(f.frame(150));assert.equal(f.value('image-angle'),'30°');
 m.active=true;m.setVolume(new Uint8Array(1),{dimensions:[3,3,3],spacingUm:1000});
 assert.equal(m.displayedFrame,null);assert.equal(m.tee('image-angle').hidden,true);
 m.acceptFrame(first);assert.equal(m.tee('image-angle').hidden,true);
 const replacement=f.frame(125);m.acceptFrame(replacement);assert.equal(m.tee('image-angle').hidden,false);assert.equal(f.value('image-angle'),'125°');
});

test('keyboard, lock, presets and reset keep control angle separate until the next image is accepted',()=>{
 const f=environment(),m=f.module;m.acceptFrame(f.frame(0));
 f.document.dispatchEvent(f.event('keydown',{code:'KeyE'}));f.document.dispatchEvent(f.event('keyup',{code:'KeyE'}));
 assert.equal(m.state.multiplaneDeg,1);assert.equal(f.value('control-angle'),'1°');assert.equal(f.value('image-angle'),'0°');
 m.tee('lock').click();m.changeControl('multiplaneDeg',90);assert.equal(m.state.multiplaneDeg,1);assert.equal(f.value('image-angle'),'0°');
 m.mount.querySelector('[data-tee-preset="me2c"]').click();assert.equal(m.state.probeLocked,false);assert.equal(m.state.multiplaneDeg,90);assert.equal(f.value('control-angle'),'90°');assert.equal(f.value('image-angle'),'0°');
 m.acceptFrame(f.frame(m.state.multiplaneDeg));assert.equal(f.value('image-angle'),'90°');
 m.changeControl('multiplaneDeg',130);m.tee('reset').click();assert.equal(m.state.multiplaneDeg,90);assert.equal(f.value('image-angle'),'90°');
});

test('all endpoint orientations and both image modes use the same accepted model angle',()=>{
 const f=environment(),m=f.module;
 for(const angle of [0,5,90,180]){
  m.poseRevision++;m.acceptFrame(f.frame(angle));
  const pointer=m.tee('image-angle').querySelector('[data-multiplane="pointer"]'),point=multiplanePoint(angle);
  assert.equal(Number(pointer.getAttribute('x2')),point.x);assert.equal(Number(pointer.getAttribute('y2')),point.y);
  for(const mode of ['ct','ultrasound']){
   m.mount.querySelector(`[data-probe-image="${mode}"]`).click();
   assert.equal(f.value('image-angle'),formatMultiplaneAngle(angle));assert.equal(m.tee('image-angle').hidden,false);
  }
 }
 assert.deepEqual(multiplanePoint(0),{x:12,y:34});assert.deepEqual(multiplanePoint(90),{x:64,y:86});assert.deepEqual(multiplanePoint(180),{x:116,y:34});
});
