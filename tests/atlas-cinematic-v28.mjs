import {titleCaseUi} from '../public/ui-text.js';
// Import-stripping DOM fixtures still use the production display-label helper.
const uiFunction=(...args)=>new Function('titleCaseUi',...args).bind(null,titleCaseUi);
/** Real display functions and DOM controls; no browser interaction/FPS claim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {DONORS} from '../public/donors.js';
import {RENDER_STYLES,capColor,atlasTone,surfaceColor} from '../public/render-styles.js';
import * as priorStyles from '../docs/atlas-cinematic-v28/baseline-render-styles.mjs';
import * as currentStyles from '../public/render-styles.js';
import vm from 'node:vm';
import {clipPlane} from '../public/planes.js';
import {buildAcceleration,validAcceleration} from '../public/render-v5-acceleration.js';
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


test('existing palette transfers remain exactly unchanged across source intensities and display settings',()=>{
 const profiles=[{windowEnabled:false,capContrast:1.8},{windowEnabled:true,windowLow:.12,windowHigh:.91,windowGamma:1.1,capContrast:1.4,cutFaceExposure:1.35},{windowEnabled:true,windowLow:.3,windowHigh:.8,windowGamma:.8,capContrast:1.8,cutFaceExposure:2}];
 for(let palette=0;palette<6;palette++)for(let byte=0;byte<256;byte++){
  for(const threshold of [.15,.28,.45])assert.deepEqual(surfaceColor(byte/255,threshold,palette),priorStyles.surfaceColor(byte/255,threshold,palette));
  for(const settings of profiles)assert.deepEqual(capColor(byte/255,settings.capContrast,palette,settings),priorStyles.capColor(byte/255,settings.capContrast,palette,settings));
 }
 checks.push('IDs 0–5 retain exact JavaScript surface and cap output for every 8-bit input, three thresholds and three display profiles.');
});

test('Atlas lifts near-surface tones, reduces saturation and retains an ordered ivory highlight',()=>{
 const luma=c=>c[0]*.2126+c[1]*.7152+c[2]*.0722;
 const saturation=c=>(Math.max(...c)-Math.min(...c))/Math.max(...c);
 for(let i=0;i<=64;i++){
  const value=.28+i/64*.35,current=surfaceColor(value,.28,6),prior=priorStyles.surfaceColor(value,.28,6);
  assert.ok(current.every(c=>Number.isFinite(c)&&c>=0&&c<=1));
  assert.ok(luma(current)>luma(prior)*1.4,'Near-surface tone should visibly lift.');
  assert.ok(saturation(current)<saturation(prior)*.8,'Rusty saturation should be reduced.');
 }
 const ivory=surfaceColor(1,.28,6);assert.ok(ivory.every(c=>c>.8));
 assert.ok(Math.max(...ivory)-Math.min(...ivory)<.15);
 checks.push('Atlas near-surface tones are lighter and less saturated; bright tones approach bounded, gently warm ivory.');
});

const createWorker=async(source,styles)=>{
 const context=vm.createContext({...styles,clipPlane,buildAcceleration,validAcceleration,Uint8Array,Uint8ClampedArray,Float32Array,ArrayBuffer,performance,setTimeout,clearTimeout,onmessage:null,postMessage:null});
 vm.runInContext(source.replace(/^import .*;\s*$/gm,''),context);
 let wait;
 context.postMessage=message=>{
  if(message.type==='frame'){wait?.resolve(Uint8Array.from(new Uint8ClampedArray(message.pixels)));wait=null;}
  else if(message.type==='error'){wait?.reject(new Error(message.message));wait=null;}
 };
 return {send:message=>context.onmessage({data:message}),render:message=>new Promise((resolve,reject)=>{wait={resolve,reject};context.onmessage({data:{...message,type:'render'}});})};
};

test('the actual software fallback preserves old palettes and agrees with the shared Atlas CT transfer',async()=>{
 const priorSource=await readFile(new URL('../docs/atlas-cinematic-v28/baseline-cpu-worker.js',import.meta.url),'utf8');
 const currentSource=await readFile(new URL('../public/cpu-worker.js',import.meta.url),'utf8');
 const oldWorker=await createWorker(priorSource,priorStyles),newWorker=await createWorker(currentSource,currentStyles);
 const size=24,volume=new Uint8Array(size**3);
 for(let z=0;z<size;z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const distance=Math.hypot(x-11.5,y-11.5,z-11.5);
  volume[x+size*(y+size*z)]=distance<8.5?Math.round(Math.min(1,8.5-distance)*(.6+.2*z/size)*255):0;
 }
 for(const worker of [oldWorker,newWorker])worker.send({type:'load',data:volume.slice().buffer,dimensions:[size,size,size]});
 const sourceSnapshot=volume.slice();
 const base={id:1,w:16,h:16,extent:[1,1,1],basis:{eye:[0,0,2],forward:[0,0,-1],right:[1,0,0],up:[0,1,0]},fast:false};
 const settings={threshold:.28,quality:'high',opacity:.8,clipAxis:-1,showPlanes:0,surfaceSmoothing:1,capContrast:1.8,windowEnabled:false};
 for(const mode of [0,1,2])for(let palette=0;palette<6;palette++){
  const job={...base,settings:{...settings,mode,palette}};
  assert.deepEqual(await newWorker.render(job),await oldWorker.render(job));
 }
 const oldAtlas=await oldWorker.render({...base,settings:{...settings,palette:6,mode:0}});
 const newAtlas=await newWorker.render({...base,settings:{...settings,palette:6,mode:0}});
 assert.notDeepEqual(newAtlas,oldAtlas);
 const plane={center:[0,0,0],right:[1,0,0],up:[0,1,0],normal:[0,0,1],width:1,height:1};
 newWorker.send({type:'load',data:new Uint8Array(512).buffer,dimensions:[8,8,8]});
 for(const windowEnabled of [false,true])for(const byte of [90,120,150,190,225,255]){
  const profile={...settings,palette:6,mode:0,clipAxis:3,clipFlip:0,oblique:plane,windowEnabled,windowLow:.12,windowHigh:.91,windowGamma:1.1,capContrast:1.4,cutFaceExposure:1.35};
  newWorker.send({type:'cap',cap:{data:new Uint8Array(4).fill(byte),width:2,height:2,plane}});
  const result=await newWorker.render({...base,w:1,h:1,settings:profile});
  const expected=capColor(byte/255,profile.capContrast,6,profile).map(c=>Math.round(Math.pow(c,.89)*255));
  assert.deepEqual([...result.slice(0,3)],expected);
 }
 assert.deepEqual(volume,sourceSnapshot);
 checks.push('Actual worker renders preserve IDs 0–5 byte-exact in all three scalar modes; Atlas changes, its CT cap matches the shared transfer, and input values are unchanged.');
});

test.after(async()=>{
 if(checks.length!==8)return;
 const out=new URL('../docs/atlas-cinematic-v28/ui-validation.json',import.meta.url);
 await mkdir(new URL('.',out),{recursive:true});
 await writeFile(out,JSON.stringify({passed:true,checks,scope:'Actual DOM and source functions in Node/LinkeDOM. No browser, device latency or anatomical validation claim.'},null,2)+'\n');
});
