/** Donor isolation, physical units and exact prepared-plane registration. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {PROBE_PRESETS,PROBE_REFERENCE_MM,volumeGeometry,probePhysicalScale,probePhysicalLimits,sanitizeProbeState,rescaleProbeState,probePose,probeCapPlane,probeContactSurface,contactCoordinates,contactFrame,moveProbeState} from '../public/probe-geometry.js';
import {validFineProbeSlice} from '../public/probe-acoustics.js';
import {sameFinePlane,worldToFineVoxel,planFinePlane} from '../public/ultra-volume-core.js';
import {EchoModule} from '../public/echo.js';
import {ProbeLabModule} from '../public/probe-lab.js';
import {FlowViewsModule} from '../public/flow-views.js';
import {loadAnatomy} from '../public/anatomy-data.js';

const base='public/assets/donors/ucl-zcr-2629/';
const manifest=JSON.parse(await readFile(base+'manifest.json','utf8'));
const fine=JSON.parse(await readFile(base+'ultra-volume.json','utf8'));
const frames=JSON.parse(await readFile(base+'echo-planes.json','utf8'));
const geometry=volumeGeometry(manifest.levels.high),scale=probePhysicalScale(geometry.longestMm);
const donor={id:'ucl-zcr-2629',datasetId:'2298522198',specimen:'UCL-ZCR-2629',datasetUrl:'https://human-organ-atlas.esrf.fr/datasets/2298522198',fineSpacingUm:28.128,echoPlanesUrl:'./'+base+'echo-planes.json',flowViewsUrl:'./'+base+'flow-views.json',clinicalPresetsReviewed:false};
const near=(a,b,epsilon=1e-7)=>assert.ok(Math.abs(a-b)<=epsilon,`${a} differs from ${b}`);
const nearVector=(a,b)=>a.forEach((v,i)=>near(v,b[i]));

test('physical reference, motion and contact surfaces scale to this donor, retaining mm units',()=>{
 near(geometry.longestMm,51.305472);
 const original=sanitizeProbeState(),state=rescaleProbeState(original,geometry.longestMm);
 near(state.depthMm,145*scale);near(state.speedMm,22*scale);
 assert.ok(state.depthMm<45&&state.depthMm>44);
 const limits=probePhysicalLimits(geometry.longestMm);assert.ok(limits.depth[0]<20&&limits.depth[1]<59);
 const frame={...frames.frames.a4c.world,referenceMm:geometry.longestMm};
 const surface=probeContactSurface('apical',frame);
 near(surface.limitU,55*scale);near(surface.radiusU,260*scale);
 let moving=state;
 for(let i=0;i<300;i++)moving=moveProbeState(moving,frame,{advance:Math.sin(i),lateral:Math.cos(i)},limits.step);
 const coordinates=contactCoordinates(moving,surface),contact=contactFrame(surface,...coordinates);
 nearVector(probePose(moving,frame).originMm,contact.pointMm);
 assert.ok(Math.hypot(coordinates[0]/surface.limitU,coordinates[1]/surface.limitV)<=1+1e-8);
 assert.equal(rescaleProbeState(moving,geometry.longestMm),moving,'A detailed level with the same extent must not move a saved pose.');
 const restored=rescaleProbeState(state,PROBE_REFERENCE_MM);near(restored.depthMm,145);near(restored.speedMm,22);
});

test('every new prepared probe plane matches the actual scaled browser pose and fine source',()=>{
 assert.equal(fine.preparedPlanes.length,4);
 for(const preset of PROBE_PRESETS){
  const state=sanitizeProbeState({preset:preset.id,referenceMm:geometry.longestMm,depthMm:preset.depthMm*scale,angleDeg:preset.angleDeg});
  const frame={...frames.frames[preset.frame].world,referenceMm:geometry.longestMm};
  const plane=probeCapPlane(probePose(state,frame),geometry),prepared=fine.preparedPlanes.find(p=>p.id===preset.id);
  assert.ok(prepared&&sameFinePlane(plane,prepared.plane),preset.id);
  assert.equal(prepared.sourceSpacingUm,28.128);assert.equal(prepared.cleaned,true);
  const plan=planFinePlane(fine,plane);
  assert.equal(plan.width,prepared.width);assert.equal(plan.height,prepared.height);
  nearVector([...plan.spacingUmXY,0],[...prepared.spacingUmXY,0]);
  assert.ok(plan.width*plan.height<12*1024*1024);
 }
});

test('registered scan endpoints and a centered voxel map to the correct physical fine lattice',()=>{
 const c=worldToFineVoxel([0,0,0],fine),d=fine.fullDimensionsXYZ,o=fine.sourceOriginXYZ;
 nearVector(c,d.map((n,i)=>(n-1)/2-o[i]));
 nearVector(worldToFineVoxel([-fine.extent[0]/2,-.5,fine.extent[2]/2],fine),o.map(v=>-v));
 nearVector(worldToFineVoxel([fine.extent[0]/2,.5,-fine.extent[2]/2],fine),d.map((n,i)=>n-1-o[i]));
 const plane=fine.preparedPlanes[0].plane,slice={plane,data:new Uint8Array(4),width:2,height:2,complete:true,sourceSpacingUm:28.128,spacingUm:28.128};
 assert.ok(validFineProbeSlice(slice,plane,28.128));
 assert.equal(validFineProbeSlice({...slice,sourceSpacingUm:79.4},plane,28.128),false,'The other donor’s fine source cannot satisfy this finer source contract.');
});

const domPath=process.argv.find(v=>v.startsWith('--dom='))?.slice(6)||'/workspace/data/heart-ui-test-v5/node_modules/linkedom/esm/index.js';
const {parseHTML}=await import(pathToFileURL(domPath));
const {document,window}=parseHTML('<!doctype html><html><body><main id="echo"></main><main id="probe"></main><main id="flow"></main></body></html>');
Object.assign(globalThis,{document,window});
Object.defineProperty(document,'activeElement',{configurable:true,writable:true,value:document.body});
Object.defineProperty(document,'pointerLockElement',{configurable:true,writable:true,value:null});
Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this._value??this.querySelector('option')?.value??'';},set(v){this._value=String(v);}});
window.HTMLElement.prototype.focus=function(){document.activeElement=this;};
window.HTMLElement.prototype.getBoundingClientRect=()=>({left:0,top:0,width:700,height:700});
window.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>{}});
globalThis.ImageData=class {constructor(data,width,height){Object.assign(this,{data,width,height});}};
globalThis.ResizeObserver=class {observe(){}disconnect(){}};
globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
const renderer=()=>({canvas:document.createElement('canvas'),extent:geometry.extent,settings:{palette:4,threshold:.28,cleanupEnabled:true},camera:{pan:[0,0,0],distance:2,yaw:0,pitch:0,roll:0},set(v){Object.assign(this.settings,v);},requestRender(){},clearCapData(){},setCapData(cap){this.cap=cap;},alignPlane(){},basis(){return {eye:[0,0,2],forward:[0,0,-1],right:[1,0,0],up:[0,1,0]};}});

test('module construction is network silent; donor geometry and UI never silently use legacy assets',async()=>{
 const fetcher=globalThis.fetch,calls=[];
 globalThis.fetch=async url=>{calls.push(url);return new Response(JSON.stringify(frames),{status:200});};
 try{
  const echo=new EchoModule({renderer:renderer(),mount:document.getElementById('echo'),donor});
  const probe=new ProbeLabModule({renderer:renderer(),mount:document.getElementById('probe'),donor});
  const flow=new FlowViewsModule({renderer:renderer(),mount:document.getElementById('flow'),donor});
  echo.$('cine-video').pause=()=>{};echo.$('cine-video').load=()=>{};
  assert.equal(calls.length,0);
  await probe.init();assert.deepEqual(calls,[donor.echoPlanesUrl]);
  probe.setVolume(new Uint8Array(8),manifest.levels.high);
  assert.ok(probe.state.depthMm<45);assert.ok(Number(probe.mount.querySelector('[data-probe-range="depthMm"]').max)<59);
  assert.match(probe.$('preset-note').textContent,/unverified/);assert.match(probe.$('fine-status').textContent,/preparing|28\.128/);
  echo.setFrames(frames);echo.setVolume(new Uint8Array(8),manifest.levels.high);
  assert.ok(echo.offsetLimitMm<11&&echo.offsetLimitMm>10);assert.equal(echo.fineSpacingUm,28.128);
  assert.match(flow.mount.textContent,/UCL-ZCR-2629/);assert.doesNotMatch(flow.mount.textContent,/LADAF-2021-17/);
  assert.throws(()=>echo.setFrames({datasetId:'1659197537',frames:frames.frames}),/different donor/);
  echo.setFrames({frames:{a4c:frames.frames.a4c}});assert.deepEqual(Object.keys(echo.frames),['a4c']);
  probe.setFrames({frames:{a4c:frames.frames.a4c}});assert.deepEqual(Object.keys(probe.frames),['a4c']);
  const before=calls.length;probe.frames={};probe.initPromise=null;probe.donor={...donor,echoPlanesUrl:null};
  await assert.rejects(probe.init(),/not been prepared/);assert.equal(calls.length,before);
  flow.donor={...donor,flowViewsUrl:null};await assert.rejects(flow.init(),/not been prepared/);assert.equal(calls.length,before);
  echo.destroy();probe.leave();flow.destroy();
 }finally{globalThis.fetch=fetcher;}
});

test('anatomy requests are keyed by manifest URL and null never falls back to the old donor',async()=>{
 const fetcher=globalThis.fetch,calls=[];
 globalThis.fetch=async url=>{
  calls.push(url);if(url.endsWith('.raw'))return new Response(new Uint8Array(8).fill(url.includes('donor-b')?2:1));
  const b=url.includes('donor-b');return Response.json({dimensions:[2,2,2],volumeUrl:b?'donor-b.raw':'donor-a.raw',labels:[{id:0,color:'#000000'},{id:b?2:1,color:'#ffffff'}]});
 };
 try{
  const a=await loadAnatomy('donor-a.json'),b=await loadAnatomy('donor-b.json');
  assert.equal(a.sample([.5,.5,.5]),1);assert.equal(b.sample([.5,.5,.5]),2);assert.notEqual(a,b);
  assert.equal(await loadAnatomy('donor-a.json'),a);assert.equal(calls.length,4);
  await assert.rejects(loadAnatomy(null),/not been prepared/);assert.equal(calls.length,4);
 }finally{globalThis.fetch=fetcher;}
});
