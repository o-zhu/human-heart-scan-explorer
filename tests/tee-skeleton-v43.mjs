/** Controller/asset checks; this file does not claim browser or clinical validation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {TeeLabModule} from '../public/tee-lab.js';
import {sanitizeTeeState,TEE_PRESETS,teePresetState} from '../public/tee-geometry.js';
import {createEchoAnatomyContext,decodeEchoReferenceAnatomy} from '../public/echo-anatomy-context-v2.js';
import {DONORS} from '../public/donors.js';

const domPath=process.argv.find(value=>value.startsWith('--dom='))?.slice(6)||process.env.HEART_DOM_MODULE;
if(!domPath)throw new Error('Set HEART_DOM_MODULE to an installed LinkeDOM ESM entry.');
const {parseHTML}=await import(pathToFileURL(domPath));
const publicRoot=new URL('../public/',import.meta.url);
const rawByDonor=new Map(await Promise.all(DONORS.map(async donor=>[donor.id,JSON.parse(await readFile(new URL(donor.echoPlanesUrl||'./assets/echo-planes.json',publicRoot),'utf8'))])));
const referenceAnatomy=await decodeEchoReferenceAnatomy({manifestBytes:await readFile(new URL('assets/probe-context-v11/manifest.json',publicRoot)),compressedBytes:await readFile(new URL('assets/probe-context-v11/torso.bin.gz',publicRoot))});
const globals=['document','window','ResizeObserver','requestAnimationFrame','cancelAnimationFrame','fetch'];
const old=Object.fromEntries(globals.map(key=>[key,globalThis[key]]));
const active=[];
function environment(donor,{loaded=true}={}){
 const {document,window}=parseHTML('<html><body><section id="teePanel"></section></body></html>');
 Object.assign(globalThis,{document,window,ResizeObserver:class{observe(){}},requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{},fetch:async url=>new Response(await readFile(new URL(url,publicRoot)))});
 const calls={sample:0,guide:0,layer:[]};
 const renderer={settings:{palette:4},clearCapData(){},requestRender(){},contextLayer:null};
 const source=rawByDonor.get(donor.id),module=new TeeLabModule({mount:document.getElementById('teePanel'),renderer,frames:source,donor});
 module.geometry={longestMm:source.referenceMm};module.state=sanitizeTeeState({...module.state,referenceMm:source.referenceMm});
 module.contextReady=true;module.teeReference=null;module.contextModel=null;module.ensureOrigin();module.updateUI();
 if(loaded)module.referenceAnatomy=referenceAnatomy;
 module.active=true;module.drawGuide=()=>{calls.guide++;};module.poseChanged=()=>{calls.sample++;};
 module.sceneOverlay={setActive(value){calls.layer.push(value);}};
 active.push(module);return {module,calls,source,document,window};
}
test.afterEach(()=>{
 for(const module of active.splice(0))module.leave();
 for(const[key,value]of Object.entries(old)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
});

for(const donor of DONORS){
 test(`${donor.id}: Lab uses byte-identical fitted Echo bones and preserves the fixed GI and probe in every starting view`,()=>{
  const {module:m}=environment(donor),base=m.anatomyContext(),echo=createEchoAnatomyContext({baseModel:base,referenceAnatomy});
  const context=m.displayAnatomyContext();assert.equal(context.provenance.referenceHeartDisplayed,false);
  const bones=context.meshes.filter(mesh=>mesh.id.startsWith('bodyparts3d-'));
  assert.deepEqual(bones.map(mesh=>mesh.id),['bodyparts3d-bones','bodyparts3d-spine']);
  assert.equal(context.meshes.some(mesh=>/heart|skin/.test(mesh.id)),false);
  for(const mesh of bones){const expected=echo.meshes.find(item=>item.id===mesh.id);assert.equal(mesh.vertices,expected.vertices);assert.deepEqual(mesh.bounds,expected.bounds);assert.equal(mesh.vertices.length%18,0);}
  for(const mesh of base.meshes)assert.equal(context.meshes.find(item=>item.id===mesh.id),mesh);
  assert.equal(context.tractSamples,base.tractSamples);assert.equal(context.gastricInteriorSamples,base.gastricInteriorSamples);assert.equal(context.frame,base.frame);
  for(const preset of TEE_PRESETS){
   m.state=teePresetState(preset.id,m.state,m.reference());const before=m.getPose();
   m.state.showSkeleton=false;assert.equal(m.displayAnatomyContext(),base);assert.deepEqual(m.getPose(),before);
   m.state.showSkeleton=true;assert.equal(m.displayAnatomyContext(),context);assert.deepEqual(m.getPose(),before);
  }
 });
 test(`${donor.id}: below-window Skeleton button is reversible, independent, saved, and never resamples or moves the scan`,()=>{
  const {module:m,calls}=environment(donor),button=m.tee('skeleton');
  assert.equal(m.state.showSkeleton,true);assert.equal(button.getAttribute('aria-pressed'),'true');
  assert.ok(button.closest('.probe-scene-footer'));assert.equal(button.closest('#teeViewportMount'),null);assert.equal(button.closest('details'),null);
  const before=m.getPose(),both=m.displayAnatomyContext();button.click();
  assert.equal(m.state.showSkeleton,false);assert.equal(button.getAttribute('aria-pressed'),'false');assert.equal(button.getAttribute('aria-label'),'Show skeleton');assert.equal(m.state.showSurface,true);assert.deepEqual(m.getPose(),before);assert.equal(calls.sample,0);
  const saved=m.getState();assert.equal(saved.showSkeleton,false);m.restore(saved);assert.equal(m.state.showSkeleton,false);assert.equal(button.getAttribute('aria-pressed'),'false');
  const samples=calls.sample;button.click();assert.equal(m.displayAnatomyContext(),both);assert.equal(calls.sample,samples);assert.deepEqual(m.getPose(),before);
  m.state.showSurface=false;const skeleton=m.displayAnatomyContext();assert.deepEqual(skeleton.meshes.map(x=>x.id),['bodyparts3d-bones','bodyparts3d-spine']);assert.equal(Object.keys(skeleton.contours).length,0);assert.ok(skeleton.labels.every(x=>x.id.startsWith('bodyparts3d-')));
  button.click();assert.equal(m.displayAnatomyContext(),null);assert.equal(m.state.showSurface,false);
  m.leave();assert.equal(calls.layer.at(-1),false);assert.equal(m.state.showSkeleton,false);
 });
}

test('a fresh or older TEE state defaults to skeleton, while an explicit hidden choice survives sanitization',()=>{
 assert.equal(sanitizeTeeState().showSkeleton,true);
 assert.equal(sanitizeTeeState({teeVersion:1,showSurface:false}).showSkeleton,true);
 assert.equal(sanitizeTeeState({teeVersion:1,showSkeleton:false}).showSkeleton,false);
});

test('verified skeleton completion after leaving the workspace cannot reattach context or trigger image sampling',async()=>{
 const {module:m,calls}=environment(DONORS[0],{loaded:false});
 assert.equal(m.displayAnatomyContext(),m.anatomyContext());
 const pending=m.loadSkeleton();assert.equal(m.tee('skeleton').getAttribute('aria-busy'),'true');
 m.leave();const sampled=calls.sample,drawn=calls.guide;await pending;
 assert.ok(m.referenceAnatomy);assert.equal(m.tee('skeleton').getAttribute('aria-busy'),'false');assert.equal(calls.sample,sampled);assert.equal(calls.guide,drawn);assert.equal(calls.layer.at(-1),false);
 assert.equal(m.displayAnatomyContext().meshes.filter(x=>x.id.startsWith('bodyparts3d-')).length,2);
});
