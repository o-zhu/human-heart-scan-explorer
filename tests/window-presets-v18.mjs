/** Real display controls, source-specific presets and reversible manual editing. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {AppearanceController} from '../public/appearance.js';
import {DONORS} from '../public/donors.js';
import {getWindowPresets,matchWindowPreset} from '../public/window-presets.js';

const domPath=process.argv[2];
if(!domPath)throw new Error('Pass an installed linkedom ESM entry point.');
const {parseHTML}=await import(pathToFileURL(domPath));
const html=await readFile(new URL('../page.html',import.meta.url),'utf8');
const displayKeys=['windowEnabled','windowLow','windowHigh','windowGamma','capContrast','cutFaceExposure'];
const displayState=settings=>Object.fromEntries(displayKeys.map(key=>[key,settings[key]]));

function fixture(donor,overrides={}){
 const {document,window}=parseHTML(html),previousDocument=globalThis.document,previousFetch=globalThis.fetch;
 globalThis.document=document;
 const requests=[];
 globalThis.fetch=async(...args)=>{requests.push(args);throw new Error('Display presets must not fetch scan data.');};
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this._value??this.querySelector('option')?.value??'';},set(value){this._value=String(value);}});
 const patches=[],sourceData=new Uint8Array([0,22,57,96,155,201,242,255]);
 const renderer={
  canvas:document.getElementById('volumeCanvas'),data:sourceData,
  camera:{yaw:.7,pitch:-.2,distance:1.8,pan:[.02,.1,-.03]},
  settings:{mode:0,palette:4,threshold:.28,opacity:.8,clipAxis:1,clipPosition:.37,clipFlip:1,
   showPlanes:1,slices:[.2,.37,.7],surfaceSmoothing:1,quality:'high',anatomyOpacity:.65,anatomySelected:0,
   ultrasoundGain:6,...donor.displayWindow,...overrides},
  set(patch){patches.push({...patch});Object.assign(this.settings,patch);}
 };
 const appearance=new AppearanceController({renderer,donor});
 const trigger=(id,type,value)=>{
  const element=document.getElementById(id);assert.ok(element,id);
  if(typeof value==='boolean')element.checked=value;else if(value!==undefined)element.value=String(value);
  element.dispatchEvent(new window.Event(type,{bubbles:true}));
 };
 const choose=id=>{
  const button=document.querySelector('[data-window-preset="'+id+'"]');assert.ok(button,'Preset '+id);
  button.dispatchEvent(new window.Event('click',{bubbles:true}));
 };
 return {document,window,renderer,appearance,patches,requests,sourceData,trigger,choose,
  close(){clearTimeout(appearance.changeTimer);globalThis.document=previousDocument;globalThis.fetch=previousFetch;}};
}

test('preset controls and contrast stay in the shared, initially collapsed Settings panel',()=>{
 const {document}=parseHTML(html),settings=document.getElementById('viewerSettings'),controls=document.getElementById('windowControls');
 assert.equal(settings.hasAttribute('open'),false);
 assert.equal(controls.closest('details'),settings);
 for(const id of ['windowPresets','windowPresetStatus','windowPresetDescription','cutFaceExposure','capContrast','windowLow','windowHigh','windowGamma']){
  const element=document.getElementById(id);
  assert.equal(document.querySelectorAll('#'+id).length,1,id+' stays unique');
  assert.ok(controls.contains(element),id+' belongs with the shared window controls');
  assert.equal(element.closest('[data-reconstruction-settings]'),null,id+' remains available in Echo and Probe');
 }
 assert.equal(document.getElementById('windowPresets').getAttribute('role'),'group');
 assert.equal(document.getElementById('windowPresetStatus').getAttribute('aria-live'),'polite');
 assert.equal(document.getElementById('capContrast').getAttribute('step'),'0.05');
});

for(const donor of DONORS)test(donor.specimen+' presets apply all display settings together, preserve anatomy and allow custom edits/reset',()=>{
 const f=fixture(donor),defaults=structuredClone(donor.displayWindow);
 try{
  const preserved=Object.fromEntries(Object.entries(f.renderer.settings).filter(([key])=>!displayKeys.includes(key)));
  const camera=structuredClone(f.renderer.camera),source=[...f.sourceData];
  const profiles=getWindowPresets(donor);
  assert.deepEqual(profiles.slice(0,3).map(profile=>profile.id),['balanced','contrast','original']);
  assert.equal(f.document.getElementById('windowPresets').dataset.activePreset,'contrast');
  assert.equal(f.patches.length,0,'Constructing preset controls must preserve the active settings.');
  assert.equal(f.requests.length,0);
  for(const id of ['balanced','contrast']){
   const preset=profiles.find(profile=>profile.id===id);
   f.choose(id);
   assert.deepEqual(displayState(f.renderer.settings),displayState(preset.settings));
   assert.deepEqual(Object.keys(f.patches.at(-1)).sort(),[...displayKeys].sort(),'A preset changes only CT display properties.');
   assert.equal(f.document.getElementById('windowPresets').dataset.activePreset,id);
   assert.equal(f.document.getElementById('windowPresetStatus').textContent,preset.label);
   assert.equal(f.document.getElementById('windowPresetDescription').textContent,preset.description);
   assert.equal(f.document.querySelectorAll('[data-window-preset][aria-pressed="true"]').length,1);
   assert.equal(f.document.querySelector('[data-window-preset="'+id+'"]').getAttribute('aria-pressed'),'true');
   assert.equal(f.document.getElementById('capContrastValue').textContent,preset.settings.capContrast.toFixed(2)+'×');
   assert.equal(f.document.getElementById('cutFaceExposureValue').textContent,preset.settings.cutFaceExposure.toFixed(2)+'×');
   const black=Math.round(donor.sourceWindow[0]+preset.settings.windowLow*(donor.sourceWindow[1]-donor.sourceWindow[0])).toLocaleString('en-US');
   assert.equal(f.document.getElementById('windowLowValue').textContent,black,'The donor raw-intensity scale is used.');
  }
  const nextBlack=f.renderer.settings.windowLow+.007<f.renderer.settings.windowHigh-.005?f.renderer.settings.windowLow+.007:f.renderer.settings.windowLow-.007;
  f.trigger('windowLow','input',nextBlack);
  assert.equal(matchWindowPreset(donor,f.renderer.settings),'custom');
  assert.equal(f.document.getElementById('windowPresetStatus').textContent,'Custom settings');
  assert.equal(f.document.querySelectorAll('[data-window-preset][aria-pressed="true"]').length,0);
  assert.equal(f.renderer.settings.windowEnabled,true);
  f.choose('original');
  assert.deepEqual(displayState(f.renderer.settings),displayState(donor.originalDisplayWindow));
  f.choose('balanced');
  f.trigger('resetWindow','click');
  assert.deepEqual(displayState(f.renderer.settings),displayState(defaults),'Reset restores the brighter Strong default.');
  assert.equal(f.document.getElementById('windowPresets').dataset.activePreset,'contrast');
  for(const [key,value]of Object.entries(preserved))assert.deepEqual(f.renderer.settings[key],value,key+' remains independent');
  assert.deepEqual(f.renderer.camera,camera);
  assert.deepEqual([...f.sourceData],source);
  assert.deepEqual(donor.displayWindow,defaults,'Preset selection never mutates the donor defaults.');
  assert.equal(f.requests.length,0,'Switching styles reuses the existing source.');
 }finally{f.close();}
});

test('restored custom display values survive control construction and sync',()=>{
 const custom={windowEnabled:true,windowLow:.123,windowHigh:.912,windowGamma:1.37,capContrast:1.17,cutFaceExposure:2.41};
 const f=fixture(DONORS[0],custom);
 try{
  assert.deepEqual(displayState(f.renderer.settings),custom);
  assert.equal(f.document.getElementById('windowPresetStatus').textContent,'Custom settings');
  assert.equal(f.patches.length,0);
  f.appearance.sync();
  assert.deepEqual(displayState(f.renderer.settings),custom);
  assert.equal(f.patches.length,0,'Sync reads state without applying a preset.');
  assert.equal(f.requests.length,0);
 }finally{f.close();}
});

test('a changed reset profile preserves the historical Original and the reviewed presets',()=>{
 const f=fixture(DONORS[1]);
 try{
  const before=getWindowPresets(DONORS[1]).filter(profile=>profile.id!=='original');
  const profile={...DONORS[1].displayWindow,cutFaceExposure:2.35,windowGamma:1.15};
  f.appearance.setWindowProfile(profile);
  assert.equal(f.document.getElementById('windowPresets').dataset.activePreset,'custom');
  assert.deepEqual(f.appearance.windowPresets.filter(item=>item.id!=='original'),before);
  f.choose('balanced');f.choose('original');
  assert.deepEqual(displayState(f.renderer.settings),displayState(DONORS[1].originalDisplayWindow));
  f.trigger('resetWindow','click');
  assert.deepEqual(displayState(f.renderer.settings),displayState(profile));
 }finally{f.close();}
});
