import {titleCaseUi} from '../public/ui-text.js';
// Import-stripping DOM fixtures still use the production display-label helper.
const uiFunction=(...args)=>new Function('titleCaseUi',...args).bind(null,titleCaseUi);
/** Real display functions and DOM controls; no browser interaction/FPS claim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {DONORS} from '../public/donors.js';
import {RENDER_STYLES,capColor,atlasTone} from '../public/render-styles.js';
import {PALETTE_KEYS} from '../public/appearance.js';
import {paintSectionPixels} from '../public/section-paint.js';
import {getWindowPresets,matchWindowPreset} from '../public/window-presets.js';
import {ProbeLabModule} from '../public/probe-lab.js';
import {TeeLabModule} from '../public/tee-lab.js';

const {parseHTML}=await import(pathToFileURL(process.argv[2]));
const html=await readFile(new URL('../page.html',import.meta.url),'utf8');
const appearanceSource=(await readFile(new URL('../public/appearance.js',import.meta.url),'utf8')).replace(/^import .*;\s*$/gm,'').replace(/^export /gm,'');
const checks=[];

test('Atlas is appended without changing palette identities or requesting labels',()=>{
 assert.deepEqual(PALETTE_KEYS,['ivory','copper','grayscale','porcelain','contrast','anatomy','atlas']);
 assert.deepEqual(RENDER_STYLES.map(p=>p.id),[0,1,2,3,4,5,6]);
 for(const donor of DONORS){
  const {document,window}=parseHTML(html);
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this._value??this.querySelector('option')?.value??'';},set(value){this._value=String(value);}});
  let requestedLabels=0;
  const Controller=uiFunction('document','loadAnatomy','paintSectionPixels','scanActivity','setTimeout','clearTimeout','getWindowPresets','matchWindowPreset',appearanceSource+'\nreturn AppearanceController;')(
   document,()=>{requestedLabels++;throw new Error('Unexpected label request');},paintSectionPixels,{beginForeground:()=>()=>{}},()=>1,()=>{},getWindowPresets,matchWindowPreset);
  const renderer={canvas:document.getElementById('volumeCanvas'),settings:{palette:4,threshold:.28,...donor.displayWindow},set(patch){Object.assign(this.settings,patch);}};
  const appearance=new Controller({renderer,donor});
  const button=document.querySelector('[data-material="atlas"]');assert.ok(button);
  button.dispatchEvent(new window.Event('click',{bubbles:true}));
  assert.equal(renderer.settings.palette,6);assert.equal(requestedLabels,0);
  assert.equal(document.getElementById('palette').value,'atlas');
  assert.equal(button.getAttribute('aria-pressed'),'true');
  assert.match(document.getElementById('materialDescription').textContent,/illustrative intensity/i);
  assert.equal(document.getElementById('anatomyControls').hidden,true);
  renderer.set({palette:4});appearance.changed();
  assert.equal(document.querySelector('[data-material="contrast"]').getAttribute('aria-pressed'),'true');
 }
 checks.push('Actual Color controls select palette 6 for each donor without fetching anatomical labels; palette IDs and selection state remain stable.');
});

test('Probe and TEE offer Atlas through the actual module templates',()=>{
 for(const Module of [ProbeLabModule,TeeLabModule]){
  const {document}=parseHTML(Module.prototype.template.call({fineLabel:'79.4 µm'}));
  const option=document.querySelector('[data-probe="material"] option[value="6"]');
  assert.equal(option?.textContent,'Atlas cinematic');
 }
 assert.equal(TeeLabModule.prototype.paintImages,ProbeLabModule.prototype.paintImages);
 checks.push('Actual Probe and TEE templates expose Atlas and share one measured-CT painter.');
});

const encodedPixels=(data,settings)=>{
 const out=new Uint8ClampedArray(data.length*4);
 for(let i=0;i<data.length;i++){
  const byte=data[i],v=byte/255,color=byte&&v>=settings.threshold?capColor(v,settings.capContrast,6,settings):[0,0,0];
  for(let c=0;c<3;c++)out[4*i+c]=Math.pow(Math.max(0,color[c]),.89)*255;
  out[4*i+3]=255;
 }
 return out;
};

test('all 256 measured CT values agree between section rail and Probe/TEE; ultrasound stays byte-exact',()=>{
 globalThis.ImageData=class{constructor(data,width,height){Object.assign(this,{data,width,height});}};
 const ct=Uint8Array.from({length:256},(_,i)=>i),ultrasound=Uint8Array.from({length:256},(_,i)=>(i*73+11)%256);
 const originalCt=ct.slice(),originalUs=ultrasound.slice();
 const state={depthMm:100},frame={width:16,height:16,ct,ultrasound,state,pose:{},sector:{depthMm:100,widthMm:100}};
 const contexts=Object.fromEntries(['ct','ultrasound'].map(key=>[key,{putImageData(image){this.pixels=image.data.slice();},beginPath(){},moveTo(){},lineTo(){},stroke(){},fillText(){}}]));
 const canvases=Object.fromEntries(Object.entries(contexts).map(([key,context])=>[key,{width:16,height:16,getContext:()=>context}]));
 const module={displayedFrame:frame,renderer:{settings:{},extent:[1,1,1]},geometry:{longestMm:100,extent:[1,1,1]},$:key=>canvases[key]};
 for(const windowEnabled of [false,true]){
  const settings={palette:6,threshold:.28,windowEnabled,windowLow:.12,windowHigh:.91,windowGamma:1.1,capContrast:1.4,cutFaceExposure:1.35};
  module.renderer.settings=settings;ProbeLabModule.prototype.paintImages.call(module);
  const expected=encodedPixels(ct,settings);
  assert.deepEqual(contexts.ct.pixels,expected);
  assert.deepEqual(paintSectionPixels(ct,16,16,2,.5,{width:16,height:16},settings,null,null),expected);
  for(let i=0;i<ultrasound.length;i++)assert.deepEqual(Array.from(contexts.ultrasound.pixels.slice(i*4,i*4+4)),[ultrasound[i],ultrasound[i],ultrasound[i],255]);
 }
 assert.deepEqual(ct,originalCt);assert.deepEqual(ultrasound,originalUs);
 checks.push('All 256 CT values match rail, Probe and inherited TEE display with window on/off; source CT and ultrasound remain byte-identical.');
});

test('shared view restoration retains palette 6 in Reconstruction, Probe and TEE',async()=>{
 const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 const restore=source.slice(source.indexOf('function restore(){'),source.indexOf('\nasync function main(){'));
 const run=uiFunction('hash','donor',`
  const location={hash},manifest={levels:{high:{}}},renderer={settings:{},set(p){Object.assign(this.settings,p);}};
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),errors=[],toast=e=>errors.push(e);
  let restoredLevel,cutFaceQuality,restoredEcho,restoredEchoCamera,restoredQuickView,restoredProbe,restoredProbeCamera,restoredTee,restoredTeeCamera;
  let activeAxis=-1,slicePositions=[.5,.5,.5];
  ${restore}
  restore();return {settings:renderer.settings,errors};
 `);
 for(const module of ['reconstruction','probe','tee']){
  const hash='#view='+encodeURIComponent(JSON.stringify({donor:DONORS[0].id,module,level:'high',settings:{palette:6,threshold:.28}}));
  const result=run(hash,DONORS[0]);assert.deepEqual(result.errors,[]);assert.equal(result.settings.palette,6);
 }
 checks.push('The actual app restore function preserves palette 6 in Reconstruction, Probe and TEE bookmarks.');
});

test('the illustrative cut-face ramp increases luminance continuously',()=>{
 let prior=-1;
 for(let i=0;i<=4096;i++){
  const rgb=atlasTone(i/4096);assert.ok(rgb.every(c=>Number.isFinite(c)&&c>=0&&c<=1));
  const luminance=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;assert.ok(luminance>=prior-1e-12);prior=luminance;
 }
 checks.push('The optional cut-face tint has finite bounded channels and monotonically increasing luminance.');
});

test.after(async()=>{
 if(checks.length!==5)return;
 const out=new URL('../docs/atlas-cinematic-v27/ui-validation.json',import.meta.url);
 await mkdir(new URL('.',out),{recursive:true});
 await writeFile(out,JSON.stringify({passed:true,checks,scope:'Actual DOM and source functions in Node/LinkeDOM. No browser, device latency or anatomical validation claim.'},null,2)+'\n');
});
