import {titleCaseUi} from '../public/ui-text.js';
// Import-stripping DOM fixtures still use the production display-label helper.
const uiFunction=(...args)=>new Function('titleCaseUi',...args).bind(null,titleCaseUi);
/** Exercise the actual window controls and donor reset without browser automation. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {DONORS} from '../public/donors.js';
import {capColor} from '../public/render-styles.js';
import {getWindowPresets,matchWindowPreset} from '../public/window-presets.js';

const domPath=process.argv[2];
if(!domPath)throw new Error('Pass an installed linkedom ESM entry point.');
const {parseHTML}=await import(pathToFileURL(domPath));
const html=await readFile(new URL('../page.html',import.meta.url),'utf8');
const source=(await readFile(new URL('../public/appearance.js',import.meta.url),'utf8')).replace(/^import .*;\s*$/gm,'').replace(/^export /gm,'');

function fixture(donor){
 const {document,window}=parseHTML(html);
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this._value??this.querySelector('option')?.value??'';},set(value){this._value=String(value);}});
 const timerCallbacks=[];
 const Controller=uiFunction('document','loadAnatomy','paintSectionPixels','scanActivity','setTimeout','clearTimeout','getWindowPresets','matchWindowPreset',source+'\nreturn AppearanceController;')(
  document,()=>{throw new Error('Windowing must not load anatomy.');},()=>{},null,callback=>timerCallbacks.push(callback),()=>{},getWindowPresets,matchWindowPreset);
 const renderer={settings:{threshold:.28,clipAxis:1,clipPosition:.5,palette:4,opacity:.8,anatomyOpacity:.65,anatomySelected:0,...donor.displayWindow},
  canvas:document.getElementById('volumeCanvas'),set(patch){Object.assign(this.settings,patch);}};
 const appearance=new Controller({renderer,donor});
 const trigger=(id,type,value)=>{const element=document.getElementById(id);if(typeof value==='boolean')element.checked=value;else if(value!==undefined)element.value=value;element.dispatchEvent(new window.Event(type));};
 return {document,renderer,appearance,trigger};
}

test('CT windowing is available below all modules with no duplicate or nested controls',()=>{
 const {document}=parseHTML(html),settings=document.getElementById('viewerSettings'),windowControls=document.getElementById('windowControls');
 assert.equal(settings.hasAttribute('open'),false,'Bottom Settings remains collapsed initially.');
 assert.equal(windowControls.closest('details'),settings,'Windowing needs only one disclosure to reach.');
 for(const module of ['reconstruction','echo','probe'])assert.equal(document.getElementById(module+'Panel').contains(settings),false,'Settings must not disappear with an inactive module.');
 for(const id of ['cutFaceExposure','capContrast','windowLow','windowHigh','windowGamma','windowEnabled','resetWindow']){
  assert.equal(document.querySelectorAll('#'+id).length,1,id+' is unique.');
  assert.equal(windowControls.contains(document.getElementById(id)),true);
  assert.equal(document.getElementById(id).closest('[data-reconstruction-settings]'),null,id+' stays available in Echo and Probe.');
 }
 for(const id of ['renderMode','threshold','opacity','clipAxis','clipPosition','showPlanes','clipFlip','cutFaceQuality','dataQuality','quality','surfaceSmoothing','cleanupEnabled','anatomyToggle']){
  assert.ok(document.getElementById(id).closest('[data-reconstruction-settings]'),id+' must be hidden outside reconstruction.');
 }
});

test('actual window controls enable on edit, preserve geometry, and reset each donor independently',()=>{
 for(const donor of DONORS){
  const {document,renderer,appearance,trigger}=fixture(donor);
  appearance.setWindowProfile(donor.displayWindow);
  const geometry={threshold:renderer.settings.threshold,clipAxis:renderer.settings.clipAxis,clipPosition:renderer.settings.clipPosition};
  for(const key of ['windowLow','windowHigh','windowGamma'])assert.equal(document.getElementById(key).disabled,false,key+' must be directly adjustable even with window off.');
  assert.equal(document.getElementById('windowDonor').textContent,donor.specimen+' · CT display');
  assert.match(document.getElementById('resetWindow').getAttribute('aria-label'),new RegExp(donor.specimen));
  assert.equal(document.getElementById('cutFaceExposureValue').textContent,donor.displayWindow.cutFaceExposure.toFixed(2)+'×');
  trigger('windowLow','input',.4);
  assert.equal(renderer.settings.windowEnabled,true);
  assert.equal(renderer.settings.windowLow,.4);
  assert.equal(document.getElementById('windowEnabled').checked,true);
  assert.match(document.getElementById('windowLow').getAttribute('aria-valuetext'),/scan intensity$/);
  const scanBlack=Math.round(donor.sourceWindow[0]+.4*(donor.sourceWindow[1]-donor.sourceWindow[0])).toLocaleString('en-US');
  assert.equal(document.getElementById('windowLowValue').textContent,scanBlack);
  trigger('windowHigh','input',.2);
  assert.ok(renderer.settings.windowHigh>=renderer.settings.windowLow+.005,'Moving white below black preserves a positive display window.');
  trigger('windowGamma','input',.65);
  assert.equal(renderer.settings.windowGamma,.65);
  trigger('windowEnabled','change',false);
  assert.equal(renderer.settings.windowEnabled,false);
  assert.equal(document.getElementById('windowGamma').disabled,false);
  trigger('windowGamma','input',.7);
  assert.equal(renderer.settings.windowEnabled,true,'Editing re-enables the window after a manual switch-off.');
  renderer.set({cutFaceExposure:.55,capContrast:2.5});
  trigger('resetWindow','click');
  for(const [key,value] of Object.entries(donor.displayWindow))assert.equal(renderer.settings[key],value,donor.id+' reset '+key);
  assert.equal(document.getElementById('cutFaceExposureValue').textContent,donor.displayWindow.cutFaceExposure.toFixed(2)+'×','Reset updates exposure feedback immediately.');
  assert.equal(document.getElementById('windowGammaValue').textContent,donor.displayWindow.windowGamma.toFixed(2));
  for(const [key,value] of Object.entries(geometry))assert.equal(renderer.settings[key],value,key+' remains independent of CT display changes.');
 }
});

test('historical donor gains retain their soft-shoulder brightness behavior',()=>{
 const gains={'ladaf-2021-17':[1.15,1.35],'s-20-29':[1.8,2.7],'s-20-28':[1.8,2.7]};
 for(const donor of DONORS){
  const [before,after]=gains[donor.id],settings=donor.originalDisplayWindow||donor.displayWindow;
  assert.equal(settings.cutFaceExposure,after);
  let improved=0;
  for(let value=1;value<255;value++){
   const old=capColor(value/255,settings.capContrast,4,{...settings,cutFaceExposure:before}),next=capColor(value/255,settings.capContrast,4,settings);
   for(let channel=0;channel<3;channel++){
    assert.ok(next[channel]>=old[channel]);
    assert.ok(next[channel]<1,'The soft shoulder does not hard-clip CT highlights to white.');
    if(next[channel]-old[channel]>.01)improved++;
   }
  }
  assert.ok(improved>150,donor.id+' meaningfully raises tissue midtones.');
  assert.equal(settings.windowGamma,donor.id==='ladaf-2021-17'?1:.9,'Calibrated donor encoding window is preserved.');
 }
});
