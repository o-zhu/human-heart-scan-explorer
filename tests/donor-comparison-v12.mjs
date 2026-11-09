/** V12 active comparison donors: physical geometry, compact views and neutral CT labels.
 * DOM fixtures exercise actual module code, without claiming browser/GPU QA.
 */
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import test from 'node:test';
import {DONORS} from '../public/donors.js';
import {PROBE_PRESETS,PROBE_REFERENCE_MM,volumeGeometry,probePhysicalScale,sanitizeProbeState,rescaleProbeState,probePose,probeCapPlane} from '../public/probe-geometry.js';
import {sameFinePlane,worldToFineVoxel,planFinePlane} from '../public/ultra-volume-core.js';
import {EchoModule,ECHO_PRESETS} from '../public/echo.js';
import {ProbeLabModule} from '../public/probe-lab.js';
import {QuickViews} from '../public/quick-views.js';
import {SectionDetail} from '../public/section-detail.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const requireFine=process.argv.includes('--require-fine');
const read=async file=>JSON.parse(await readFile(path.join(root,file),'utf8'));
const near=(a,b,tolerance=1e-7)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} differs from ${b}`);
const vector=(a,b,tolerance)=>{assert.equal(a.length,b.length);a.forEach((v,i)=>near(v,b[i],tolerance));};
const donors=DONORS.filter(d=>['s-20-29','s-20-28'].includes(d.id));
assert.equal(donors.length,2);
assert.equal(DONORS.length,3);
assert.ok(!DONORS.some(d=>d.id==='ladaf-2020-31'));
const report={passed:false,requireFine,scope:'Actual module geometry and DOM fixtures with controlled requests; no browser, device performance or human anatomical validation.',activeDonors:DONORS.map(d=>d.id),donors:[],checks:[]};
function check(name,run){test(name,async()=>{
 try{await run();report.checks.push({name,passed:true});}
 catch(error){report.checks.push({name,passed:false});throw error;}
});}
const records=[];
for(const donor of donors){
 const base='public/assets/donors/'+donor.id+'/';
 const manifest=await read(base+'manifest.json'),frames=await read(base+'echo-planes.json'),echo=await read(base+'echo-textures.json'),probe=await read(base+'probe-textures.json'),flow=await read(base+'flow-views.json');
 const finePath=base+'ultra-volume.json',fine=existsSync(path.join(root,finePath))?await read(finePath):null;
 if(requireFine)assert.ok(fine,`${donor.id} fine manifest is pending`);
 records.push({donor,base,manifest,frames,echo,probe,flow,fine,geometry:volumeGeometry(manifest.levels.high)});
}

check('both comparison donor levels preserve physical endpoints and normalize to their own longest physical axis',()=>{
 for(const record of records){
  const {manifest,donor,geometry,frames}=record;
  const low=volumeGeometry(manifest.levels.low);
  near(low.longestMm,geometry.longestMm);vector(low.extent,geometry.extent);vector(low.sourceSizeMm,geometry.sourceSizeMm);
  near(frames.referenceMm,geometry.longestMm);vector(frames.worldExtentXYZ,geometry.extent);
  const padded=manifest.registrationPadding.displayFineDimensionsXYZ,original=manifest.registrationPadding.sourceFineDimensionsXYZ;
  assert.equal(manifest.registrationPadding.sourceVoxelsOmitted,0);
  padded.forEach((n,i)=>assert.ok(n>=original[i]&&n-original[i]<4));
  vector(padded.map(n=>(n-1)*donor.fineSpacingUm/1000),geometry.sourceSizeMm);
  const state=rescaleProbeState(sanitizeProbeState(),geometry.longestMm);
  near(state.depthMm,145*geometry.longestMm/PROBE_REFERENCE_MM);
  assert.equal(rescaleProbeState(state,low.longestMm),state,'Switching preview/high cannot move the probe.');
 }
});

check('prepared probe planes match runtime physical poses and truthful source resolution',()=>{
 for(const {donor,geometry,frames,probe,fine} of records){
  assert.equal(probe.preparedPlanes.length,4);
  for(const preset of PROBE_PRESETS){
   const state=sanitizeProbeState({preset:preset.id,referenceMm:geometry.longestMm,depthMm:preset.depthMm*probePhysicalScale(geometry.longestMm),angleDeg:preset.angleDeg,contactLocked:true,contactPositionMm:[0,0]});
   const frame={...frames.frames[preset.frame].world,referenceMm:geometry.longestMm};
   const plane=probeCapPlane(probePose(state,frame),geometry),prepared=probe.preparedPlanes.find(p=>p.id===preset.id);
   assert.ok(prepared&&sameFinePlane(plane,prepared.plane),`${donor.id}:${preset.id} runtime plane differs`);
   near(prepared.sourceSpacingUm,probe.sourceSpacingUm);
   assert.equal(prepared.width,Math.ceil(plane.width*geometry.longestMm*1000/probe.sourceSpacingUm)+1);
   assert.equal(prepared.height,Math.ceil(plane.height*geometry.longestMm*1000/probe.sourceSpacingUm)+1);
   vector(prepared.spacingUmXY,[plane.width*geometry.longestMm*1000/(prepared.width-1),plane.height*geometry.longestMm*1000/(prepared.height-1)]);
   if(requireFine)near(prepared.sourceSpacingUm,donor.fineSpacingUm);
   if(fine&&Math.abs(prepared.sourceSpacingUm-donor.fineSpacingUm)<1e-8){
    const linked=fine.preparedPlanes.find(p=>p.id===preset.id);assert.deepEqual(linked,prepared);
    const plan=planFinePlane(fine,plane);assert.equal(plan.width,prepared.width);assert.equal(plan.height,prepared.height);vector(plan.spacingUmXY,prepared.spacingUmXY);
   }
  }
 }
});

check('fine-lattice coordinates map both physical endpoints on all axes, including cropped origins',()=>{
 for(const {donor,manifest,geometry,fine} of records){
  const contract=fine||{fullDimensionsXYZ:manifest.registrationPadding.displayFineDimensionsXYZ,sourceOriginXYZ:[18,24,10]};
  const d=contract.fullDimensionsXYZ,o=contract.sourceOriginXYZ,e=geometry.extent;
  vector(worldToFineVoxel([0,0,0],contract),d.map((n,i)=>(n-1)/2-o[i]));
  vector(worldToFineVoxel([-e[0]/2,-e[1]/2,e[2]/2],contract),o.map(v=>-v));
  vector(worldToFineVoxel([e[0]/2,e[1]/2,-e[2]/2],contract),d.map((n,i)=>n-1-o[i]));
  const last=manifest.registrationPadding.sourceFineDimensionsXYZ.map(v=>v-1),physical=last.map((n,i)=>(n-(d[i]-1)/2)*donor.fineSpacingUm/1000/geometry.longestMm);
  vector(worldToFineVoxel([physical[0],physical[2],-physical[1]],contract),last.map((n,i)=>n-o[i]));
 }
});

check('detail derivation retains measured alternate pixels and physical crop coordinates',async()=>{
 const width=9,height=7,data=Uint8Array.from({length:width*height},(_,i)=>i+1);
 const full={data,width,height,spacingUm:42.48,fullWidth:1761,fullHeight:1693,crop:[52,90,width,height]};
 const detail=new SectionDetail({init:async()=>({spacingUm:42.48,imageDimensionsXYZ:[1761,1917,1693],sliceCounts:[441,480,424]}),load:async()=>full});
 await detail.init();const result=await detail.load(0,100);
 assert.equal(result.width,5);assert.equal(result.height,4);assert.deepEqual(result.crop,[26,45,5,4]);
 near(result.spacingUm*(result.fullWidth-1),full.spacingUm*(full.fullWidth-1));
 near(result.spacingUm*(result.fullHeight-1),full.spacingUm*(full.fullHeight-1));
 for(let y=0;y<result.height;y++)for(let x=0;x<result.width;x++)assert.equal(result.data[y*result.width+x],data[y*2*width+x*2]);
 assert.deepEqual(full.data,data,'Detail generation cannot mutate the measured Ultra image.');
});

const domPath=process.argv.find(v=>v.startsWith('--dom='))?.slice(6)||'/workspace/data/heart-ui-test-v11/node_modules/linkedom/esm/index.js';
const {parseHTML}=await import(pathToFileURL(domPath));
const {document,window}=parseHTML('<!doctype html><html><body></body></html>');
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
const renderer=record=>({canvas:document.createElement('canvas'),extent:record.geometry.extent,settings:{palette:4,threshold:record.manifest.defaultThreshold,cleanupEnabled:true,...record.manifest.displayWindow,...record.donor.displayWindow},loaded:true,camera:{pan:[0,0,0],distance:2,yaw:0,pitch:0,roll:0},set(v){Object.assign(this.settings,v);},requestRender(){},clearCapData(){},setCapData(cap){this.cap=cap;},alignPlane(){},basis(){return {eye:[0,0,2],forward:[0,0,-1],right:[1,0,0],up:[0,1,0]};}});

for(const record of records)check(`${record.donor.id}: Echo, Probe and compact views use donor-specific measured labels and assets`,async()=>{
 const {donor,manifest,frames,echo:echoTextures,flow:flowMetadata}=record;
 document.body.innerHTML='<main id="echo"></main><main id="probe"></main><nav id="quick"></nav>';
 const calls=[],fetcher=globalThis.fetch;
 globalThis.fetch=async url=>{
  calls.push(url);assert.ok(String(url).includes('/donors/'+donor.id+'/'),'A module silently fetched another donor');
  if(url===donor.echoPlanesUrl)return Response.json(frames);
  if(url===donor.flowViewsUrl)return Response.json(flowMetadata);
  throw new Error('Unexpected network operation in a controlled DOM fixture: '+url);
 };
 let echo,probe,quick;
 const textureRequests=[],textureCache={pause(){},destroy(){},async load(item){
  textureRequests.push(item);
  return {data:new Uint8Array(4),width:2,height:2,spacingUm:item.spacingUm,sourceSpacingUm:item.sourceSpacingUm||item.spacingUm,ultra:true,cleaned:true};
 }};
 try{
  echo=new EchoModule({renderer:renderer(record),mount:document.getElementById('echo'),donor});
  probe=new ProbeLabModule({renderer:renderer(record),mount:document.getElementById('probe'),donor});
  quick=new QuickViews({renderer:renderer(record),mount:document.getElementById('quick'),donor,textureCache});
  echo.$('cine-video').pause=()=>{};echo.$('cine-video').load=()=>{};
  assert.equal(calls.length,0,'Module construction must not compete with initial volume loading.');
  echo.setMediaCatalog({clips:[]});echo.setFrames(frames);echo.setPresetTextures(echoTextures);echo.setVolume(new Uint8Array(8),manifest.levels.high);echo.updateAppearance();
  await probe.init();probe.setVolume(new Uint8Array(8),manifest.levels.high);probe.updateAppearance(false);
  await quick.init();quick.setVolume(new Uint8Array(8),manifest.levels.high);
  assert.deepEqual(calls,[donor.echoPlanesUrl,donor.flowViewsUrl]);
  assert.equal(echo.mount.querySelector('.echo-anatomy').hidden,false,'The donor alignment disclosure stays available for an unassigned donor.');
  assert.equal(echo.$('anatomy').textContent,'','A geometric donor must not inherit clinical structure chips.');
  assert.match(echo.$('ct-correspondence').textContent,/unverified/i);
  assert.match(echo.$('view-check').textContent,/geometric CT section/i);
  for(const preset of ECHO_PRESETS){
   const presented=echo.displayPreset(preset);
   assert.match(presented.name,/section/i);assert.deepEqual(presented.anatomy,[]);assert.equal(presented.angles,undefined);
   assert.doesNotMatch(presented.name,/ventric|atri|mitral|tricuspid|aortic|bicaval|chamber|papillar/i);
  }
  for(const module of [echo,probe]){
   const option=module.$('material').querySelector('option[value="5"]');
   assert.ok(option.disabled,'An unassigned donor cannot imply reviewed chamber coloring.');
   assert.match(option.textContent,/unassigned/i);
   assert.doesNotMatch(module.mount.textContent,/LADAF-2021-17|UCL-ZCR-2629/);
   near(module.renderer.settings.capContrast,manifest.displayWindow.capContrast);
   near(module.renderer.settings.cutFaceExposure,donor.displayWindow.cutFaceExposure);
   near(module.renderer.settings.threshold,manifest.defaultThreshold);
  }
  const options=[...probe.mount.querySelectorAll('[data-probe-preset-label]')].map(o=>o.textContent);
  assert.equal(probe.mount.querySelectorAll('[data-probe-preset]').length,4);
  assert.deepEqual(options,['Long-axis reference','Crossed long-axis reference','Short-axis reference','Opposite-side reference']);
  assert.match(probe.$('preset-note').textContent,/not assigned/);
  assert.equal(quick.mount.querySelectorAll('[data-quick-preset]').length,8);
  assert.equal(textureRequests.length,0,'Initializing compact buttons must not download their CT planes.');
  for(const button of quick.mount.querySelectorAll('[data-quick-preset]')){
   assert.match(button.getAttribute('aria-label'),/section/i);
   assert.doesNotMatch(button.textContent,/\b(?:RV|LV|RA|LA)\b|ventric|atri|mitral|tricuspid|aortic|bicaval|chamber|papillar/i);
   const preset=flowMetadata.presets.find(p=>p.id===button.dataset.quickPreset);
   await quick.select(preset.id);
   const item=textureRequests.at(-1);
   assert.equal(item.url,preset.texture.url,'The compact button must request this donor’s own measured texture.');
   assert.ok(item.url.includes('/donors/'+donor.id+'/'));
   near(item.fineSpacingUm,donor.fineSpacingUm);
   near(item.sourceSpacingUm||item.spacingUm,donor.fineSpacingUm);
   vector(quick.plane.center,preset.world.center);
   vector(quick.plane.normal,preset.world.normal);
   assert.equal(quick.renderer.settings.clipAxis,3);
   assert.equal(quick.renderer.settings.threshold,manifest.defaultThreshold);
   assert.equal(quick.renderer.settings.cutFaceExposure,donor.displayWindow.cutFaceExposure);
   assert.equal(quick.renderer.cap.plane,quick.plane);
   assert.equal(quick.renderer.cap.ultra,true);
   assert.match(quick.renderer.cap.key,new RegExp('^quick:'+donor.id+':'+preset.id+':'));
   assert.equal(button.getAttribute('aria-pressed'),'true');
  }
  assert.equal(textureRequests.length,8);
  assert.doesNotMatch(quick.mount.textContent,/LADAF-2021-17|UCL-ZCR-2629|LADAF-2020-31/);
  assert.throws(()=>echo.setFrames({...frames,datasetId:'1659197537'}),/different donor/);
  assert.throws(()=>echo.setPresetTextures({...echoTextures,datasetId:'2298522198'}),/different donor/);
  assert.throws(()=>probe.setFrames({...frames,datasetId:'1659197537'}),/different donor/);
  for(const mismatch of [{datasetId:'1659197537'},{specimen:'OTHER-DONOR'}]){
   const invalid=new QuickViews({renderer:renderer(record),mount:document.createElement('nav'),donor,textureCache:{pause(){},destroy(){}}});
   const previousFetch=globalThis.fetch;
   globalThis.fetch=async url=>{assert.equal(url,donor.flowViewsUrl);return Response.json({...flowMetadata,...mismatch});};
   try{await assert.rejects(invalid.init(),/different donor/);}finally{invalid.destroy();globalThis.fetch=previousFetch;}
  }
  report.donors.push({id:donor.id,physicalReferenceMm:record.geometry.longestMm,preparedSourceSpacingUm:record.probe.sourceSpacingUm,
   preparedProbePlanes:4,neutralEchoPlanes:13,neutralCompactViews:8,sourceSpecificFineTextureSelections:8,unassignedAnatomy:true,networkSilentConstruction:true,foreignDonorFramesRejected:true,cutFaceExposure:donor.displayWindow.cutFaceExposure});
 }finally{echo?.destroy();probe?.leave();quick?.destroy();globalThis.fetch=fetcher;}
});

test('write independent module-contract evidence',async()=>{
 report.passed=report.donors.length===2&&report.checks.length===6&&report.checks.every(check=>check.passed);
 await mkdir(path.join(root,'docs/release-v12'),{recursive:true});
 await writeFile(path.join(root,'docs/release-v12/module-validation.json'),JSON.stringify(report,null,2)+'\n');
 assert.equal(report.passed,true,'A failed module contract must not produce passing evidence.');
});
