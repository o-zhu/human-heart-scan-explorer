/** Independent TEE camera/state integration review using the real DOM and
 * production camera math. Graphics and scan transport are deliberately stubbed;
 * this is not a browser-rendering or clinical-validation test. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {EchoModule} from '../public/echo.js';
import {decodeEchoReferenceAnatomy} from '../public/echo-anatomy-context-v2.js';
import {VolumeRenderer} from '../public/renderer.js';
import {TEE_ATLAS_VIEWS as views} from '../public/tee-atlas-data.js';
import {TEE_ALIGNMENT_STORAGE_KEY,normalizeTeeAlignment,readTeeAlignment,rememberTeeAlignment} from '../public/tee-alignment.js';
import {dot} from '../public/planes.js';

const {parseHTML}=await import(pathToFileURL(process.argv[2]));
const {document,window}=parseHTML('<main id="echo"></main>');
Object.assign(globalThis,{document,window,requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{}});
Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this._value??this.querySelector('option')?.value??'';},set(v){this._value=String(v);}});
window.HTMLElement.prototype.getBoundingClientRect=()=>({left:0,top:0,width:640,height:620});
window.HTMLElement.prototype.focus=function(){};
window.HTMLElement.prototype.scrollIntoView=function(){};
window.HTMLElement.prototype.showModal=function(){this.open=true;};
window.HTMLElement.prototype.close=function(){this.open=false;};
window.HTMLElement.prototype.pause=function(){this.paused=true;};
window.HTMLElement.prototype.load=function(){};
const context=new Proxy({},{get:()=>()=>{}});
window.HTMLCanvasElement.prototype.getContext=function(type){return type==='2d'?context:null;};
const stored=new Map();
const storage={getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,String(value))};
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage,writable:true});
const json=name=>JSON.parse(readFileSync(new URL('../public/assets/'+name,import.meta.url)));
globalThis.fetch=async url=>{
 const name=String(url).split('/').pop();
 assert.ok(['plane-fit-v2.json','regional-review-v3.json'].includes(name));
 return {ok:true,json:async()=>json('tee-atlas/'+name)};
};
const renderer=Object.assign(Object.create(VolumeRenderer.prototype),{
 canvas:document.createElement('canvas'),settings:{palette:4,threshold:.28,cleanupEnabled:true,capContrast:1.8},extent:[.9,1,.9],
 camera:{yaw:0,pitch:0,roll:0,distance:1.55,pan:[0,0,0]},autoRotate:false,
 set(v){Object.assign(this.settings,v);},requestRender(reason){this.lastRenderReason=reason;},onChange(){},clearCapData(){this.cap=null;},setCapData(v){this.cap=v;}
});
const echo=new EchoModule({renderer,mount:document.getElementById('echo'),donor:{id:'ladaf-2021-17',datasetId:'1659197537'}});
echo.referenceAnatomy=await decodeEchoReferenceAnatomy({manifestBytes:readFileSync(new URL('../public/assets/probe-context-v11/manifest.json',import.meta.url)),compressedBytes:readFileSync(new URL('../public/assets/probe-context-v11/torso.bin.gz',import.meta.url))});
await echo.loadPlaneReview();await echo.loadRegionReview();
// The overlay has separate geometry/depth tests. Keep this suite specific to
// actual controller transitions and camera math without fabricating pixels.
echo.overlay.dispose();
echo.overlay={set(v){Object.assign(this,v);},start(){this.running=true;},stop(){this.running=false;},dispose(){this.stop();}};
echo.setFrames(json('echo-planes.json'));echo.setAtlasFlowFrames(json('flow-views-v5.json'));
echo.setVolume(new Uint8Array(1),{dimensions:[475,475,530],spacingUm:317.6});
echo.mediaCatalog={clips:[]};
echo.ensureSampler=()=>({sample:async()=>({data:new Uint8Array(16),width:4,height:4})});
echo.drawSection=()=>{};echo.message=()=>{};echo.prefetchNeighbors=()=>{};
const event=type=>new window.Event(type,{bubbles:true});
const click=selector=>echo.mount.querySelector(selector).dispatchEvent(event('click'));
const camera=()=>structuredClone(renderer.camera);
const plane=()=>structuredClone(echo.getPlane());
const near=(actual,expected,message,epsilon=1e-10)=>assert.ok(Math.abs(actual-expected)<=epsilon,`${message}: ${actual} versus ${expected}`);
let checks=0;
const passed=name=>{checks++;console.log('PASS '+name);};

try{
 assert.equal(normalizeTeeAlignment('upright'),'upright');
 for(const value of [undefined,null,'UPRIGHT','invalid',{},false])assert.equal(normalizeTeeAlignment(value),'ultrasound');
 assert.equal(readTeeAlignment(),'probe');
 assert.equal(echo.state.alignment,'probe');
 globalThis.localStorage={getItem(){throw new Error('unavailable');},setItem(){throw new Error('unavailable');}};
 assert.equal(readTeeAlignment(),'probe');assert.equal(rememberTeeAlignment('upright'),'upright');
 globalThis.localStorage=storage;
 passed('Fresh default is Probe View and unavailable storage is harmless');

 echo.enter();click('[data-mode="tee"]');
 assert.equal(echo.state.alignment,'probe');assert.equal(echo.$('anchor-probe').getAttribute('aria-pressed'),'true');
 echo.setAlignment('ultrasound');
 const baseline=new Map();
 for(const view of views){
  echo.selectPreset(view.id);
  baseline.set(view.id,{plane:plane(),clipFlip:renderer.settings.clipFlip,evidence:echo.currentRegionalEvidence()});
  if(view.aseNumber<25){
   near(dot(renderer.basis().right,echo.getPlane().right),1,view.id+' ultrasound horizontal presentation');
   near(dot(renderer.basis().up,echo.getPlane().up),1,view.id+' ultrasound vertical presentation');
  }
 }
 passed('All 28 ultrasound defaults retain measured plane and display orientation');

 echo.selectPreset('me4c');
 const originalPlane=plane(),originalFlip=renderer.settings.clipFlip,originalRequest=echo.requestId;
 click('[data-echo="anchor-anatomy"]');
 assert.equal(echo.state.alignment,'upright');
 assert.equal(stored.get(TEE_ALIGNMENT_STORAGE_KEY),'upright');
 assert.deepEqual(plane(),originalPlane);assert.equal(renderer.settings.clipFlip,originalFlip);
 assert.equal(echo.requestId,originalRequest,'Changing orientation must not resample the CT plane');
 const upright=camera(),body=echo.anatomyContext();
 near(dot(renderer.basis().right,body.frame.superior),0,'Anatomical superior projects vertically');
 assert.ok(dot(renderer.basis().up,body.frame.superior)>.98,'Superior points upward');
 for(const view of views){
  echo.selectPreset(view.id);
  assert.equal(echo.state.alignment,'upright');
  assert.deepEqual(camera(),upright,view.id+' must keep the fixed anatomical camera');
  assert.deepEqual(plane(),baseline.get(view.id).plane,view.id+' must not alter the CT frame');
  assert.equal(renderer.settings.clipFlip,baseline.get(view.id).clipFlip,view.id+' must retain the same cut side');
  assert.equal(echo.currentRegionalEvidence(),baseline.get(view.id).evidence,view.id+' evidence must remain tied to the same source plane');
 }
 passed('Upright alignment stays fixed across all 28 views without changing CT planes, cut sides or evidence');

 renderer.orbit(21,-13);renderer.camera.distance*=.79;
 renderer.camera.pan=renderer.camera.pan.map((v,i)=>v+[.02,-.01,.03][i]);
 const explored=camera();
 for(const id of ['melaa','tgrvinout','daosax','uearchsax','me4c']){
  echo.selectPreset(id);assert.deepEqual(camera(),explored,id+' should preserve user exploration in upright mode');
 }
 click('[data-echo-fit="previous"]');assert.deepEqual(camera(),explored);
 click('[data-echo-fit="refined"]');assert.deepEqual(camera(),explored);
 echo.moveSection(1);assert.deepEqual(camera(),{...upright,distance:explored.distance},'Locked section edits restore anatomical axes while retaining zoom');echo.reset();
 assert.deepEqual(camera(),upright,'Explicit reset restores the stable upright fit');
 passed('Preset/reference changes preserve upright exploration; explicit reset restores upright framing');

 echo.setLeftView('ct');const ctPlane=plane(),ctRequest=echo.requestId;
 echo.setAlignment('ultrasound');assert.deepEqual(plane(),ctPlane);assert.equal(echo.requestId,ctRequest);
 echo.setAlignment('upright');echo.setLeftView('3d');
 assert.deepEqual(camera(),upright);assert.deepEqual(plane(),ctPlane);
 click('[data-mode="tte"]');assert.equal(echo.state.preset,'a4c');
 click('[data-mode="tee"]');assert.equal(echo.state.alignment,'upright');assert.deepEqual(camera(),upright);
 passed('CT and TTE round trips preserve source pixels and restore the selected TEE alignment');

 echo.$('lock').checked=false;echo.$('lock').dispatchEvent(event('change'));
 const unlocked=camera();echo.moveSection(1);assert.deepEqual(camera(),unlocked);
 echo.$('lock').checked=true;echo.$('lock').dispatchEvent(event('change'));
 assert.equal(echo.state.alignment,'upright');near(dot(renderer.basis().right,body.frame.superior),0,'Relocking remains anatomical');
 echo.reset();click('[data-echo="align"]');
 assert.equal(echo.state.alignment,'ultrasound','Explicit Face plane selects matching alignment');
 click('[data-echo="anchor-anatomy"]');assert.equal(echo.state.alignment,'upright');assert.equal(echo.state.showContext,true);
 passed('Lock and explicit camera actions report the alignment they actually use');

 const saved=echo.getState();assert.equal(saved.alignment,'upright');
 echo.restore({...saved,preset:'tg2c'});assert.equal(echo.state.alignment,'upright');
 assert.deepEqual(camera(),upright);
 echo.restore({preset:'me4c',planeReference:'refined'});
 assert.equal(echo.state.alignment,'ultrasound','Legacy saved views keep ultrasound meaning even with an upright local preference');
 echo.restore({...saved,alignment:'invalid'});assert.equal(echo.state.alignment,'ultrasound');
 assert.equal(stored.get(TEE_ALIGNMENT_STORAGE_KEY),'upright','Restoring a shared view must not overwrite the visitor’s preference');
 passed('Shared-view alignment is explicit; legacy state and stored preference remain distinct');
}finally{
 echo.destroy();
}
console.log(`TEE spatial review v4 passed ${checks} independent controller/camera checks.`);
