/** Actual Echo DOM and plane lifecycle. GPU/browser media rendering is not mocked as evidence. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {EchoModule} from '../public/echo.js';

const domPath=process.argv[2];
if(!domPath)throw new Error('Pass a test-only linkedom ESM entry point.');
const {parseHTML}=await import(pathToFileURL(domPath));
const {document,window}=parseHTML('<main id="echo"></main>');globalThis.document=document;
Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this._value??this.querySelector('option[selected]')?.value??this.querySelector('option')?.value??'';},set(value){this._value=String(value);}});
globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};window.HTMLCanvasElement.prototype.getBoundingClientRect=()=>({width:640,height:620});
globalThis.ImageData=class {constructor(data,width,height){Object.assign(this,{data,width,height});}};
let painted;
window.HTMLCanvasElement.prototype.getContext=type=>type==='2d'?new Proxy({putImageData(image){painted=image;}},{get:(o,k)=>o[k]||(()=>{})}):null;
const caps=[];
const renderer={canvas:document.createElement('canvas'),camera:{yaw:0,pitch:0,roll:0,distance:1.55,pan:[0,0,0]},basis(){return {eye:[0,0,2],forward:[0,0,-1],right:[1,0,0],up:[0,1,0]};},settings:{palette:4,threshold:.28,cleanupEnabled:true},extent:[.897,1,.897],
 requestRender(){},clearCapData(){},alignPlane(){},set(values){Object.assign(this.settings,values);},setCapData(cap){caps.push(cap);}};
const echo=new EchoModule({renderer,mount:document.getElementById('echo'),appearance:{changed(){},cleanup:{data:new Uint8Array([0]),dimensions:[1,1,1]}}});
const video=echo.$('cine-video');video.pause=()=>{};video.load=()=>{};
echo.setMediaCatalog({clips:[]});
echo.prefetchNeighbors=()=>{};
const textureManifest=JSON.parse(await readFile('public/assets/echo-textures.json','utf8'));
const frames=JSON.parse(await readFile('public/assets/echo-planes.json','utf8'));
echo.textureCache.destroy();
echo.textureCache={clear(){},pause(){},destroy(){},peek(item){
 const data=new Uint8Array(item.width*item.height).fill(180);data[0]=104;data[item.width-1]=211;
 return {data,width:item.width,height:item.height,spacingUm:item.spacingUm,sourceSpacingUm:item.sourceSpacingUm,ultra:true,cleaned:item.cleaned,encodedBytes:item.bytes};
}};
echo.loadPresetTexture=()=>Promise.resolve(null);
echo.setFrames(frames);echo.setPresetTextures(textureManifest);
echo.setVolume(new Uint8Array(8),{spacingUm:317.6,dimensions:[475,475,530]});
echo.ensureSampler=()=>({sample:async()=>({data:new Uint8Array(64).fill(145),width:8,height:8})});

assert.equal(document.querySelectorAll('.echo-comparison-screen').length,2);
assert.equal(document.querySelectorAll('[data-echo="mpr"]').length,1,'The CT section replaces the left visual; it is not a third thumbnail.');
assert.equal(echo.$('mpr').closest('.echo-view-column')!==null,true);
assert.equal(echo.$('cine-video').closest('.echo-cine')!==null,true);
const css=await readFile('public/echo.css','utf8');
assert.match(css,/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
assert.match(css,/\.echo-comparison-screen\s*\{[^}]*height:\s*var\(--echo-screen-height\)/s);
assert.equal(echo.$('ct-view').hidden,true);assert.equal(document.getElementById('echoViewportMount').hidden,false);
echo.enter();
const prepared=[];
for(const [key,item] of Object.entries(textureManifest.textures)){
 if(echo.frames[key]?.atlasDerived)continue; // New source-based fits cannot reuse the original cap pixels.
 if(key.startsWith('psax_')){echo.state.preset='psax';echo.state.psaxLevel=key.slice(5);echo.reset();}
 else echo.selectPreset(key);
 const cap=caps.at(-1);
 assert.equal(cap.width,item.width,key);assert.equal(cap.height,item.height,key);
 assert.equal(cap.data.length,item.width*item.height,key);assert.equal(cap.cleaned,true,key);
 assert.equal(cap.spacingUm,79.4,key);assert.equal(cap.sourceSpacingUm,79.4,key);
 assert.match(cap.key,/-ultra$/);assert.equal(echo.$('resolution').dataset.source,'prepared');
 prepared.push({key,width:cap.width,height:cap.height,cleaned:cap.cleaned});
}
assert.equal(prepared.length,12);
echo.selectPreset('a4c');
document.querySelector('[data-echo-view="ct"]').dispatchEvent(new window.Event('click'));
assert.equal(echo.$('ct-view').hidden,false);assert.equal(document.getElementById('echoViewportMount').hidden,true);
assert.equal(echo.$('mpr').width,textureManifest.textures.a4c.width);
assert.equal(echo.$('mpr').height,textureManifest.textures.a4c.height);
assert.ok(echo.$('mpr').width>640&&echo.$('mpr').height>640);
assert.equal(echo.previewGrid.intensity[0],104);assert.ok(painted.data[0]>0,'A prepared clean section is not cut away again by the coarse cleanup mask.');
assert.equal(echo.sample.data[0],104,'The shared measured density array is not mutated.');
echo.$('ct-native').dispatchEvent(new window.Event('click'));
assert.equal(echo.$('ct-view').classList.contains('is-native'),true);
assert.equal(echo.$('ct-native').getAttribute('aria-pressed'),'true');
assert.equal(echo.$('mpr').width,textureManifest.textures.a4c.width);
echo.setLeftView('3d');assert.equal(echo.$('ct-view').hidden,true);assert.equal(document.getElementById('echoViewportMount').hidden,false);

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const settle=()=>wait(0);
const fineRequests=[];
const fineSource={samplePlane:(plane,options)=>new Promise((resolve,reject)=>fineRequests.push({plane,options,resolve,reject}))};
const response=(request,overrides={})=>({data:new Uint8Array(120*160).fill(187),width:120,height:160,
 plane:structuredClone(request.plane),spacingUm:79.4,spacingUmXY:[79.4,79.4],sourceSpacingUm:79.4,
 complete:true,cleaned:true,source:'test measured source',...overrides});
echo.setFineSource(fineSource);echo.state.offsetMm=1;echo.applyPlane();
await wait(50);assert.equal(echo.sample.ultra,false);assert.equal(echo.$('resolution').dataset.source,'volume');
assert.match(echo.$('resolution').textContent,/317\.6.*loaded volume/);
await wait(130);assert.equal(fineRequests.length,1);const stale=fineRequests[0];
assert.equal(stale.options.priority,'interactive');assert.equal(stale.options.spacingUm,79.4);assert.equal(stale.options.exactRaster,true);
stale.options.onProgress({ready:2,total:4,phase:'loading'});assert.match(echo.$('detail-status').textContent,/50%/);
echo.state.offsetMm=2;echo.applyPlane();assert.equal(stale.options.signal.aborted,true);
await wait(180);assert.equal(fineRequests.length,2);const current=fineRequests[1];
stale.resolve(response(stale));await settle();assert.equal(echo.sample.ultra,false,'An old fine completion cannot overwrite the new plane.');
current.resolve(response(current));await settle();assert.equal(echo.sample.ultra,true);assert.equal(echo.$('resolution').dataset.source,'streamed');
assert.equal(caps.at(-1).cleaned,true);assert.deepEqual(caps.at(-1).plane,current.plane);
assert.equal(caps.at(-1).data[0],187);assert.match(echo.$('detail-status').textContent,/exact current plane/);

echo.state.rotationDeg=5;echo.applyPlane();await wait(180);const leaving=fineRequests.at(-1);echo.leave();
assert.equal(leaving.options.signal.aborted,true);const beforeLate=caps.length;
leaving.resolve(response(leaving));await settle();assert.equal(caps.length,beforeLate);
echo.enter();await wait(180);const reentry=fineRequests.at(-1);assert.notEqual(reentry,leaving);
const warnings=[],warn=console.warn;console.warn=(...args)=>warnings.push(args);
try{
 const wrong=response(reentry);wrong.plane.center[0]+=.1;reentry.resolve(wrong);await settle();
 assert.equal(echo.sample.ultra,false);assert.match(echo.$('detail-status').textContent,/Fine detail is unavailable/);
}finally{console.warn=warn;}
assert.equal(warnings.length,1);
const beforeOriginal=fineRequests.length;renderer.settings.cleanupEnabled=false;echo.applyPlane();await wait(200);
assert.equal(fineRequests.length,beforeOriginal,'The cleaned fine source is never used for original-volume comparison.');
assert.equal(echo.$('resolution').dataset.source,'volume');assert.equal(caps.at(-1).cleaned,false);
renderer.settings.cleanupEnabled=true;echo.reset();assert.equal(echo.$('resolution').dataset.source,'prepared');
assert.equal(echo.getState().leftView,'3d');echo.restore({...echo.getState(),leftView:'ct',ctNative:true});
assert.equal(echo.state.leftView,'ct');assert.equal(echo.$('ct-view').hidden,false);assert.equal(echo.state.ctNative,true);
echo.destroy();

const report={passed:true,scope:'Actual Echo DOM and state with controlled density service, canvas and native media APIs. No browser/GPU visual-quality claim.',
 prepared,checks:[
 'Two equal-grid comparison screens share one height; a single native CT canvas replaces the left 3D pane.',
 'All 12 retained prepared presets upload full native R8 dimensions, 79.4 µm metadata and cleaned provenance.',
 'CT fit and 1:1 modes preserve all 1525 × 2011 A4C pixels; no 640-pixel preview cap remains.',
 'Prepared clean pixels bypass the unrelated coarse cleanup mask and input density data is unchanged.',
 'Adjusted planes show the accurately labeled coarse section while a debounced interactive fine request loads.',
 'Fine progress is visible; a superseded request is aborted and late completion cannot replace the current plane.',
 'Completed fine samples require exact world-plane identity and complete density/spacing metadata.',
 'Leaving cancels fine work; reentry retries; failure keeps the correctly labeled coarse section visible.',
 'Original-volume comparison never requests or labels cleaned fine source data as original.',
 'Reset restores prepared Ultra; left-pane and native-pixel preferences persist through state restore.'
 ]};
await mkdir('docs/tee-atlas',{recursive:true});await writeFile('docs/tee-atlas/legacy-ui-validation.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
