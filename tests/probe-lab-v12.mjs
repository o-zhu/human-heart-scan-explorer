import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
import {ProbeLabModule} from '../public/probe-lab.js';
import {PROBE_VISUAL_SCALE,REFERENCE_PROBE_VISUAL_SCALE,probeDisplayScale,probeModelMatrix,createProbeMeshes,ProbeSceneOverlay,paintProbeFallback,referenceTorsoCamera} from '../public/probe-scene.js';
import {PROBE_PRESETS,PROBE_REFERENCE_MM,probePhysicalScale,sanitizeProbeState,beamPoint,volumeGeometry} from '../public/probe-geometry.js';
import {DONORS} from '../public/donors.js';
const domPath=process.argv.find(x=>x.startsWith('--dom='))?.slice(6)||'/workspace/data/heart-ui-test-v11/node_modules/linkedom/esm/index.js';
const {parseHTML}=await import(pathToFileURL(domPath));
const {document,window}=parseHTML('<html><body><main id="probePanel"></main><button id="outside">Outside</button></body></html>');
Object.assign(globalThis,{document,window});
Object.defineProperty(document,'activeElement',{configurable:true,writable:true,value:document.body});
Object.defineProperty(document,'pointerLockElement',{configurable:true,writable:true,value:null});
Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this._value??this.querySelector('option')?.value??'';},set(v){this._value=String(v);}});
window.HTMLElement.prototype.focus=function(){document.activeElement=this;};
window.HTMLElement.prototype.blur=function(){if(document.activeElement===this)document.activeElement=document.body;};
globalThis.ResizeObserver=class{observe(){}};globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
const originalFrames=JSON.parse(await readFile('public/assets/echo-planes.json','utf8'));
const renderer={canvas:document.createElement('canvas'),settings:{palette:4,cleanupEnabled:true},camera:{pan:[0,0,0]},set(){},requestRender(){},clearCapData(){}};
const module=new ProbeLabModule({renderer,mount:document.getElementById('probePanel'),frames:originalFrames});
module.active=true;module.ensureOrigin();module.poseChanged=()=>{module.ensureOrigin();module.updateUI();};module.orientCamera=()=>{};
const viewport=module.mount.querySelector('#probeViewportMount'),capture=module.$('capture'),orbit=module.mount.querySelector('[data-probe-interaction="orbit"]');
let requests=0,exits=0,fullscreenExits=0;
document.exitFullscreen=()=>{fullscreenExits++;};
document.exitPointerLock=()=>{exits++;document.pointerLockElement=null;document.dispatchEvent(new window.Event('pointerlockchange'));};
const grant=()=>{document.pointerLockElement=viewport;document.dispatchEvent(new window.Event('pointerlockchange'));};
const reset=()=>{module.releaseControl();requests=0;exits=0;module.active=true;document.activeElement=document.body;viewport.requestPointerLock=()=>{requests++;grant();};};
const event=(type,props={})=>{const e=new window.Event(type,{bubbles:true,cancelable:true});for(const [k,v] of Object.entries(props))Object.defineProperty(e,k,{value:v});return e;};
const escape=(props={code:'Escape',key:'Escape'})=>{const e=event('keydown',props);document.dispatchEvent(e);return e;};
const near=(a,b,epsilon=1e-6)=>assert.ok(Math.abs(a-b)<epsilon,`${a} != ${b}`);
const report={scope:'Actual production DOM event handlers in Linkedom; numerical geometry and source-plane checks. Not browser permission or CSS pixel-layout verification.',checks:[]};

test('reference chest is a visible first column; settings do not contain the three visual panes',()=>{
 const workspace=module.mount.querySelector('.probe-workspace'),chest=module.mount.querySelector('.probe-body-context'),settings=module.mount.querySelector('.probe-controls-panel'),pair=module.mount.querySelector('.probe-view-pair');
 assert.equal(workspace.children[0],chest);assert.equal(chest.tagName,'ASIDE');assert.equal(chest.contains(module.$('torso')),true);assert.equal(settings.hasAttribute('open'),false);
 for(const target of [chest,viewport,module.$('ultrasound')])assert.equal(settings.contains(target),false);
 assert.equal(pair.children.length,2);assert.equal(pair.children[0],viewport);assert.equal(pair.children[1].contains(module.$('ultrasound')),true);
 const buttons=[...module.mount.querySelectorAll('[data-probe-preset]')];assert.equal(buttons.length,4);assert.ok(buttons.every(b=>!settings.contains(b)));
 const ids=[...module.mount.querySelectorAll('[id]')].map(x=>x.id);assert.equal(new Set(ids).size,ids.length);
 assert.match(chest.querySelector('.probe-torso-help a').getAttribute('title'),/not donor-registered/);
 assert.match(module.mount.querySelector('.probe-method').textContent,/not donor-registered/);assert.equal(module.$('body-context'),null);
 report.checks.push('Always-visible reference chest precedes equal-grid heart/US pair; four starting presets remain outside collapsed settings.');
});

test('first explicit click captures; one Escape releases, clears keys and focuses out without exiting fullscreen',()=>{
 reset();capture.click();assert.equal(requests,1);assert.equal(module.hasControl(),true);assert.equal(module.$('lock-badge').hidden,false);
 document.dispatchEvent(event('keydown',{code:'KeyW'}));assert.equal(module.keys.has('KeyW'),true);
 const released=escape();assert.equal(released.defaultPrevented,true);assert.equal(document.pointerLockElement,null);assert.equal(exits,1);assert.equal(module.keys.size,0);assert.equal(module.state.interactionMode,'orbit');assert.equal(module.$('lock-badge').hidden,true);assert.notEqual(document.activeElement,viewport);assert.equal(fullscreenExits,0);
 viewport.dispatchEvent(event('click',{button:0}));assert.equal(requests,1,'A trailing click must not immediately recapture.');
 capture.click();assert.equal(requests,2);assert.equal(module.hasControl(),true);orbit.click();assert.equal(module.hasControl(),false);assert.equal(orbit.getAttribute('aria-pressed'),'true');
 report.checks.push('One Escape releases an active lock and held movement keys; trailing click cannot relock; explicit Control button works on its next first click.');
});

test('Escape cancels a pending void request and refuses its late native grant',()=>{
 reset();viewport.requestPointerLock=()=>{requests++;};capture.click();assert.equal(module.lockRequested,true);assert.equal(module.captureWanted,true);
 escape({key:'Escape'});assert.equal(module.lockRequested,false);assert.equal(module.captureWanted,false);assert.equal(module.state.interactionMode,'orbit');
 grant();assert.equal(document.pointerLockElement,null);assert.equal(module.$('lock-badge').hidden,true);assert.equal(module.captureWanted,false);assert.equal(requests,1);assert.equal(exits,1);
 report.checks.push('Pending void-returning pointer-lock request is cancelled by a single Escape; late grant exits immediately.');
});

test('late Promise resolution and rejection cannot revive or overwrite cancelled control',async()=>{
 reset();let resolve,reject;viewport.requestPointerLock=()=>{requests++;return new Promise((ok,no)=>{resolve=ok;reject=no;});};
 capture.click();escape();grant();resolve();await Promise.resolve();await Promise.resolve();assert.equal(module.hasControl(),false);assert.equal(module.state.interactionMode,'orbit');assert.equal(module.controlMessage,'');
 capture.click();escape();reject(new Error('Late browser denial'));await Promise.resolve();await Promise.resolve();assert.equal(module.controlMessage,'');assert.equal(module.lockRequested,false);assert.equal(module.$('lock-badge').hidden,true);
 report.checks.push('Cancelled Promise-returning requests stay cancelled after late resolution or rejection.');
});

test('native Escape unlock without DOM keydown disarms the module',()=>{
 reset();capture.click();module.keys.add('KeyD');document.pointerLockElement=null;document.dispatchEvent(new window.Event('pointerlockchange'));
 assert.equal(module.hasControl(),false);assert.equal(module.captureWanted,false);assert.equal(module.keys.size,0);assert.equal(module.state.interactionMode,'orbit');assert.equal(module.$('lock-badge').hidden,true);assert.notEqual(document.activeElement,viewport);
 viewport.dispatchEvent(event('pointerdown',{button:0}));viewport.dispatchEvent(event('click',{button:0}));assert.equal(requests,1);
 capture.click();assert.equal(requests,2);assert.equal(module.hasControl(),true);escape();assert.equal(fullscreenExits,0);
 report.checks.push('Browser-native unlock alone clears keyboard motion and disarms scene click capture without affecting fullscreen.');
});

test('one Escape releases fallback steering-pad pointer capture too',()=>{
 reset();const pad=module.$('steer-pad');let held=null,released=null;pad.setPointerCapture=id=>{held=id;};pad.releasePointerCapture=id=>{released=id;held=null;};
 pad.dispatchEvent(event('pointerdown',{button:0,pointerId:17,clientX:100,clientY:120}));assert.equal(held,17);assert.equal(module.drag.id,17);
 escape();assert.equal(released,17);assert.equal(held,null);assert.equal(module.drag,null);assert.equal(pad.classList.contains('is-dragging'),false);assert.equal(module.state.interactionMode,'orbit');assert.notEqual(document.activeElement,pad);
 const before=module.state.rollDeg;pad.dispatchEvent(event('pointermove',{pointerId:17,clientX:180,clientY:120}));assert.equal(module.state.rollDeg,before);
 const e=escape();assert.equal(e.defaultPrevented,false,'Escape outside owned interaction must remain available to the host.');
 report.checks.push('Steering-pad pointer capture releases with one Escape and subsequent movement has no effect; unowned Escape remains available.');
});

test('blur and module leave cancel pending intent, and unsupported capture exposes usable fallback controls',()=>{
 reset();viewport.requestPointerLock=()=>{requests++;};capture.click();window.dispatchEvent(new window.Event('blur'));grant();assert.equal(module.hasControl(),false);assert.equal(document.pointerLockElement,null);
 capture.click();module.active=false;module.releaseControl();grant();assert.equal(document.pointerLockElement,null);module.active=true;
 delete viewport.requestPointerLock;capture.click();assert.equal(module.$('steer-pad'),document.activeElement);assert.equal(module.mount.querySelector('.probe-controls-panel').open,true);assert.match(module.controlMessage,/unavailable/);escape();
 module.mount.querySelector('.probe-controls-panel').open=false;
 report.checks.push('Blur / module exit cancel pending lock. Unsupported native capture reveals and focuses the steering-pad fallback.');
});

test('all donor starting probes keep their prepared plane and contact origin while illustrations shrink',async()=>{
 report.preservedStartingPlanes=[];
 for(const donor of DONORS){
  const path='public/'+donor.echoPlanesUrl.replace(/^\.\//,'').split('?')[0],frames=JSON.parse(await readFile(path,'utf8'));
  const manifest=JSON.parse(await readFile('public/'+donor.manifestUrl.replace(/^\.\//,''),'utf8')),level=manifest.levels[manifest.defaultLevel]||Object.values(manifest.levels).at(-1),geometry=volumeGeometry(level);
  module.donor=donor;module.geometry=geometry;module.setFrames(frames);module.state=sanitizeProbeState({referenceMm:geometry.longestMm});
  for(const preset of PROBE_PRESETS){
   module.mount.querySelector(`[data-probe-preset="${preset.id}"]`).click();const pose=module.getPose(),frame=module.frameForState(),before=JSON.stringify(pose),sourceCenter=frame.center.map(x=>x*geometry.longestMm);
   // v14 donor frames record the measured distance from their calibrated
   // probe tip to the section center; only legacy frames use 47% of depth.
   const entry=frame.probeEntry,tipDistance=Number.isFinite(entry?.tipOffsetMm)&&entry.tipOffsetMm>0?entry.tipOffsetMm*geometry.longestMm/(entry.referenceMm||geometry.longestMm):module.state.depthMm*.47;
   const sampledCenter=beamPoint(pose,0,tipDistance);sourceCenter.forEach((x,i)=>near(sampledCenter[i],x,1e-4));
   const model=probeModelMatrix(pose,probeDisplayScale(geometry.longestMm));pose.originMm.forEach((x,i)=>near(model[12+i],x,1e-5));
   for(const start of [0,4,8])near(Math.hypot(...model.subarray(start,start+3)),probePhysicalScale(geometry.longestMm)*.4,1e-6);
   assert.equal(JSON.stringify(pose),before);report.preservedStartingPlanes.push(`${donor.id}:${preset.id}`);
  }
 }
 assert.equal(PROBE_VISUAL_SCALE,.4);assert.equal(REFERENCE_PROBE_VISUAL_SCALE,1.2);
 module.donor=DONORS[0];module.geometry=null;module.setFrames(originalFrames);module.state=sanitizeProbeState();module.ensureOrigin();module.updateUI();
 report.checks.push('All 12 donor starting planes retain center, contact origin and orientation while the main instrument is 60% shorter/narrower.');
});

test('production GL overlay and software fallback use the same reduced illustration around the exact source tip',()=>{
 const pose=module.getPose(),kind='phased',scale=probeDisplayScale(PROBE_REFERENCE_MM),meshes=createProbeMeshes(kind),matrices=[];
 ProbeSceneOverlay.prototype.render.call({view:{begin(){},draw(mesh,matrix){matrices.push(matrix);}},meshes:{skin:meshes}},{basis:{},width:400,height:500,dpr:1,pose,state:module.state,surface:{kind:'skin'},referenceMm:PROBE_REFERENCE_MM,showSurface:false});
 assert.equal(matrices.length,meshes.length);const matrix=matrices[0];near(Math.hypot(...matrix.subarray(0,3)),scale);
 let firstPoint;const ctx={beginPath(){},moveTo(){},lineTo(){},closePath(){},fill(){}};
 paintProbeFallback(ctx,p=>{firstPoint??=p;return{x:p[0],y:p[1],depth:p[2]};},pose,kind,scale);
 const vertex=meshes[0].vertices.subarray(0,3),projected=[0,1,2].map(i=>matrix[i]*vertex[0]+matrix[i+4]*vertex[1]+matrix[i+8]*vertex[2]+matrix[i+12]);projected.forEach((x,i)=>near(x,firstPoint[i],1e-5));
 report.checks.push('GL mesh transform and software fallback agree on reduced geometry and unchanged tip coordinates.');
});

test('reference camera keeps the rib cage inside narrow, wide and fullscreen pane aspects',async()=>{
 const base='public/assets/probe-context-v11/',manifest=JSON.parse(await readFile(base+'manifest.json','utf8')),bytes=await readFile(base+manifest.dataFile),decoded=gunzipSync(bytes),positions=[];
 assert.equal(bytes.length,manifest.compressedBytes);assert.equal(decoded.length,manifest.decodedBytes);
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const mesh of manifest.meshes){if(mesh.name==='skin')continue;const a=new Float32Array(decoded.buffer,decoded.byteOffset+mesh.offset,mesh.count*6);for(let j=0;j<a.length;j+=6){const p=Array.from(a.subarray(j,j+3));positions.push(p);p.forEach((v,i)=>{min[i]=Math.min(min[i],v);max[i]=Math.max(max[i],v);});}}
 const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);report.referenceCamera=[];
 for(const mode of ['front','oblique'])for(const aspect of [.38,.5,.72,1,1.5]){
  const basis=referenceTorsoCamera(mode,aspect,{min,max});let maximum=0;
  for(const p of positions){const q=p.map((x,i)=>x/400-basis.eye[i]),depth=dot(q,basis.forward);assert.ok(depth>0);maximum=Math.max(maximum,Math.abs(dot(q,basis.right)/(.32*aspect*depth)),Math.abs(dot(q,basis.up)/(.32*depth)));}
  assert.ok(maximum<.94,`Reference ribs clipped at ${mode}, ${aspect}: ${maximum}`);report.referenceCamera.push({mode,aspect,maxNormalizedExtent:Number(maximum.toFixed(6))});
 }
 report.checks.push('Actual rib, spine and reference-heart vertices remain inside both camera views at aspect ratios 0.38–1.5; no donor registration applied.');
});

test('final control status and generated report',async()=>{
 module.releaseControl();assert.equal(fullscreenExits,0);assert.equal(module.hasControl(),false);assert.equal(module.$('lock-badge').hidden,true);
 report.mainProbeLinearScale=PROBE_VISUAL_SCALE;report.referenceProbeLinearScale=REFERENCE_PROBE_VISUAL_SCALE;report.fullscreenExitCalls=fullscreenExits;
 const reportPath=process.argv.find(x=>x.startsWith('--report='))?.slice(9);
 if(reportPath)await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
});
