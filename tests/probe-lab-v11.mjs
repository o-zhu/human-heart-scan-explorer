import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
import {ProbeLabModule} from '../public/probe-lab.js';
import {createProbeMeshes,createContactMesh,probeModelMatrix,referenceTorsoPose} from '../public/probe-scene.js';
import {sanitizeProbeState,probePose,probeContactSurface,volumeGeometry,PROBE_PRESETS} from '../public/probe-geometry.js';
const domPath=process.argv.find(x=>x.startsWith('--dom='))?.slice(6)||'/workspace/data/heart-ui-test-v11/node_modules/linkedom/esm/index.js';
const {parseHTML}=await import(pathToFileURL(domPath));
const {document,window}=parseHTML('<html><body><main id="probe"></main></body></html>');
Object.assign(globalThis,{document,window});
Object.defineProperty(document,'activeElement',{configurable:true,writable:true,value:document.body});
Object.defineProperty(document,'pointerLockElement',{configurable:true,writable:true,value:null});
Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this._value??this.querySelector('option')?.value??'';},set(v){this._value=String(v);}});
window.HTMLElement.prototype.focus=function(){document.activeElement=this;};
globalThis.ResizeObserver=class{observe(){}};globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
const frames=JSON.parse(await readFile('public/assets/echo-planes.json','utf8'));
const r={canvas:document.createElement('canvas'),settings:{palette:4,cleanupEnabled:true},camera:{pan:[0,0,0]},set(){},requestRender(){},clearCapData(){}};
const m=new ProbeLabModule({renderer:r,mount:document.getElementById('probe'),frames});m.active=true;m.ensureOrigin();m.poseChanged=()=>{m.ensureOrigin();m.updateUI();};m.orientCamera=()=>{};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
const report={};

test('four visible starting buttons preserve the prepared physical preset poses',()=>{
 const buttons=[...m.mount.querySelectorAll('[data-probe-preset]')];assert.equal(buttons.length,4);assert.equal(m.mount.querySelector('[data-probe="preset"]'),null);
 for(const b of buttons){b.click();const p=PROBE_PRESETS.find(x=>x.id===b.dataset.probePreset);assert.equal(m.state.preset,p.id);assert.equal(b.getAttribute('aria-pressed'),'true');assert.equal(buttons.filter(x=>x.getAttribute('aria-pressed')==='true').length,1);const expected=probePose(sanitizeProbeState({preset:p.id,depthMm:p.depthMm,angleDeg:p.angleDeg,contactPositionMm:[0,0]}),m.frameForState());m.getPose().originMm.forEach((x,i)=>near(x,expected.originMm[i]));}
 report.presetButtons=buttons.map(x=>x.textContent.trim());
});
test('horizontal movement rotates; vertical movement tilts; Alt explicitly fans',()=>{
 m.selectPreset('apical');const p=[...m.state.originMm];m.mouseMove(80,0);near(m.state.rollDeg,12.8);near(m.state.sweepDeg,0);near(m.state.tiltDeg,0);m.mouseMove(0,30);near(m.state.tiltDeg,4.8);m.mouseMove(25,0,true);near(m.state.sweepDeg,4);near(m.state.rollDeg,12.8);m.mouseMove(20,0,false,true);near(m.state.rollDeg,13.7);m.state.originMm.forEach((x,i)=>near(x,p[i]));m.mount.querySelector('[data-probe-mouse=steer]').click();assert.match(m.$('capture-help').textContent,/fan/i);assert.match(m.$('steer-pad').textContent,/fan/i);m.mount.querySelector('[data-probe-mouse=rotate]').click();report.mouseMapping={horizontal:'roll',vertical:'tilt',altHorizontal:'fan',contactPointUnchanged:true};
});
test('large mode buttons capture and release control with mutually exclusive state',async()=>{
 const viewport=m.mount.querySelector('#probeViewportMount'),capture=m.$('capture'),orbit=m.mount.querySelector('[data-probe-interaction="orbit"]');let requests=0;
 viewport.requestPointerLock=()=>{requests++;document.pointerLockElement=viewport;document.dispatchEvent(new window.Event('pointerlockchange'));};document.exitPointerLock=()=>{document.pointerLockElement=null;document.dispatchEvent(new window.Event('pointerlockchange'));};
 capture.click();assert.equal(requests,1);assert.equal(m.isLocked(),true);assert.equal(m.$('lock-badge').hidden,false);assert.match(m.$('lock-badge').textContent,/Esc/);assert.equal(capture.getAttribute('aria-pressed'),'true');assert.equal(orbit.getAttribute('aria-pressed'),'false');
 orbit.click();assert.equal(m.state.interactionMode,'orbit');assert.equal(m.isLocked(),false);assert.equal(orbit.getAttribute('aria-pressed'),'true');assert.equal(capture.getAttribute('aria-pressed'),'false');
 m.setInteractionMode('probe');const e=new window.Event('pointerdown',{bubbles:true});Object.defineProperty(e,'button',{value:0});viewport.dispatchEvent(e);assert.equal(requests,2);assert.equal(m.isLocked(),true);
 m.keyDown({code:'Escape',preventDefault(){}});assert.equal(m.isLocked(),false);report.modes={captureOnFirstClick:true,orbitReleases:true,escapeReleases:true};
});
test('unreviewed donors keep geometric labels and every control remains available',()=>{
 m.donor={clinicalPresetsReviewed:false,geometricComparisonOnly:true};m.updateUI();const labels=[...m.mount.querySelectorAll('[data-probe-preset-label]')].map(x=>x.textContent);assert.deepEqual(labels,['Long-Axis Reference','Crossed Long-Axis Reference','Short-Axis Reference','Opposite-Side Reference']);assert.match(m.$('preset-note').textContent,/not assigned/);report.unreviewedLabels=labels;
});
test('probe meshes are finite, properly scaled, and use the unchanged physical pose basis',()=>{
 report.meshes={};for(const kind of ['phased','tee']){const meshes=createProbeMeshes(kind),positions=meshes.flatMap(m=>Array.from(m.vertices).filter((_,i)=>i%6<3));assert.ok(positions.every(Number.isFinite));const count=meshes.reduce((a,b)=>a+b.vertices.length/18,0);assert.ok(count>1000&&count<15000);report.meshes[kind]={triangles:count,drawCalls:meshes.length};}
 const pose=m.getPose(),matrix=probeModelMatrix(pose,1);pose.originMm.forEach((x,i)=>assert.ok(Math.abs(matrix[12+i]-x)<1e-5));const patch=createContactMesh(probeContactSurface(m.state.preset,m.frameForState()));assert.ok([...patch].every(Number.isFinite));
});
test('reference torso bytes, source identities and skin contacts remain coherent',async()=>{
 const base='public/assets/probe-context-v11/',manifest=JSON.parse(await readFile(base+'manifest.json','utf8')),data=await readFile(base+manifest.dataFile),decoded=gunzipSync(data);assert.equal(data.length,manifest.compressedBytes);assert.equal(decoded.length,manifest.decodedBytes);assert.equal(manifest.license,'CC BY 4.0');assert.ok(manifest.modifications.includes('Not registered'));
 const coords=new Float32Array(decoded.buffer,decoded.byteOffset,decoded.length/4);assert.ok([...coords].every(Number.isFinite));assert.equal(manifest.meshes.reduce((n,x)=>n+x.count*24,0),decoded.length);
 for(const preset of PROBE_PRESETS){const state=sanitizeProbeState({preset:preset.id}),frame={...frames.frames[preset.frame].world,referenceMm:state.referenceMm};const p=referenceTorsoPose(state,manifest,probeContactSurface(preset.id,frame),probePose(state,frame));assert.ok(p&&p.originMm.every(Number.isFinite));near(Math.hypot(...p.beam),1);near(Math.hypot(...p.normal),1);assert.deepEqual(p,probePose(state,frame),'The linked reference now retains the real donor-world pose.');}
 report.referenceTorso={compressedBytes:manifest.compressedBytes,triangles:manifest.meshes.reduce((n,x)=>n+x.triangles,0),groups:manifest.meshes.map(m=>m.name),licensed:true,donorRegistration:false};
 const reportPath=process.argv.find(x=>x.startsWith('--report='))?.slice(9);if(reportPath)await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
});
