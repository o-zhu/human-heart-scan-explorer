import {titleCaseUi} from '../public/ui-text.js';
// Import-stripping DOM fixtures still use the production display-label helper.
const uiFunction=(...args)=>new Function('titleCaseUi',...args).bind(null,titleCaseUi);
/** Execute clinical event handlers in a DOM fixture; no browser, network or GPU. */
import test from 'node:test';
import * as sectionNames from '../public/section-names.js';
// This fixture strips imports; preserve the real section-name dependency.
const fixtureFunction=(...args)=>uiFunction(...Object.keys(sectionNames),...args).bind(null,...Object.values(sectionNames));
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {ResidentSectionSource} from '../public/resident-sections.js';
import {orthogonalFrame} from '../public/planes.js';
import {validateClinicalManifest,snapSectionPosition} from '../public/clinical-data.js';
import {DONORS,ALL_SOURCES,donorFromSearch,donorUrl,spacingLabel} from '../public/donors.js';
import {getWindowPresets,matchWindowPreset} from '../public/window-presets.js';
import {paintSectionPixels} from '../public/section-paint.js';
import {initializeDatasetBrowser} from '../public/dataset-browser.js';

const entry=process.argv[2];if(!entry)throw new Error('Pass the installed LinkeDOM ESM entry point.');
const {parseHTML}=await import(pathToFileURL(entry));
const root=new URL('../',import.meta.url);
const html=await readFile(new URL('page.html',root),'utf8');
const clinicalCode=(await readFile(new URL('public/clinical-app.js',root),'utf8')).replace(/^import .*;\s*$/gm,'').replace(/^export /gm,'');
const appearanceCode=(await readFile(new URL('public/appearance.js',root),'utf8')).replace(/^import .*;\s*$/gm,'').replace(/^export /gm,'');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function settle(){await tick();await tick();}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}

async function fixture(id,{saved}={}){
 const source=ALL_SOURCES.find(s=>s.id===id);assert.equal(source.kind,'clinical');
 const manifest=JSON.parse(await readFile(new URL('public/'+source.manifestUrl.replace(/^\.\//,''),root),'utf8'));
 // Keep genuine series metadata, acquisition counts and phase identities. The
 // small arrays substitute only for GPU/volume transport in this event test.
 for(const series of manifest.series){series.dimensions=[4,6,8];series.frames=series.frames.map(frame=>({...frame,decodedBytes:192}));}
 const {document,window}=parseHTML(html),events=[],stores=[],timers=new Map();let timerId=0;
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this._testValue??this.querySelector('option[selected]')?.value??this.querySelector('option')?.value??'';},set(value){this._testValue=String(value);}});
 window.HTMLCanvasElement.prototype.getBoundingClientRect=()=>({left:0,top:0,width:400,height:300});
 window.HTMLCanvasElement.prototype.getContext=function(){
  const canvas=this;
  return {fillRect(){},save(){},restore(){},translate(){},scale(x,y){events.push({type:'flip',id:canvas.id,x,y});},drawImage(){events.push({type:'paint',id:canvas.id});},beginPath(){},moveTo(){},lineTo(){},stroke(){},fillText(){},putImageData(image){events.push({type:'pixels',id:canvas.id,first:image.data[0]});},createImageData(width,height){return {data:new Uint8ClampedArray(width*height*4),width,height};}};
 };
 document.getElementById('reconstructionWorkspace').requestFullscreen=async()=>{document.fullscreenElement=document.getElementById('reconstructionWorkspace');document.dispatchEvent(new window.Event('fullscreenchange'));};
 document.exitFullscreen=async()=>{document.fullscreenElement=null;document.dispatchEvent(new window.Event('fullscreenchange'));};
 document.getElementById('aboutDialog').showModal=function(){this.open=true;};
 document.getElementById('aboutDialog').close=function(){this.open=false;};
 const location={href:'https://fixture.invalid/?donor='+id,hash:saved?'#clinical='+encodeURIComponent(JSON.stringify(saved)):''};
 location.search=new URL(location.href).search;initializeDatasetBrowser(document,location);
 const navigator={clipboard:{async writeText(text){events.push({type:'clipboard',text});}}};
 class Renderer{
  constructor(canvas){this.canvas=canvas;this.settings={palette:4,mode:0,threshold:.3,opacity:.8,clipAxis:-1,clipPosition:.5,clipFlip:0,showPlanes:0,slices:[.5,.5,.5],quality:'auto',surfaceSmoothing:1};this.reset();this.extent=[1,1,1];}
  reset(){this.camera={yaw:.32,pitch:.12,roll:Math.PI,distance:1.65,pan:[0,0,0]};}
  load(data,meta){assert.equal(data.length,meta.dimensions.reduce((a,b)=>a*b,1));this.loaded=true;this.data=data;this.meta=meta;const size=meta.dimensions.map((n,i)=>(n-1)*meta.spacingUm[i]),longest=Math.max(...size);this.extent=[size[0],size[2],size[1]].map(v=>v/longest);events.push({type:'volume',first:data[0],meta});}
  set(patch){Object.assign(this.settings,patch);events.push({type:'settings',patch:structuredClone(patch)});}
  clearCapData(){}requestRender(kind){events.push({type:'render',kind});}
  alignPlane(normal,up,center){events.push({type:'align',normal,up,center});}view(name){events.push({type:'view',name});}
  snapshot(){return 'data:image/png;base64,fixture';}
 }
 const localTimeout=(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;};
 const clearTimer=id=>timers.delete(id);
 const fetcher=async url=>{events.push({type:'fetch',url});assert.equal(url,source.manifestUrl,'Only the clinical manifest should be fetched by boot.');return new Response(JSON.stringify(manifest));};
 const Appearance=fixtureFunction('document','fetch','scanActivity','loadAnatomy','paintSectionPixels','setTimeout','clearTimeout','getWindowPresets','matchWindowPreset','ImageData',appearanceCode+'\nreturn AppearanceController;')(
  document,fetcher,{beginForeground(){throw new Error('Clinical boot must not prepare HOA anatomy/cleanup.');}},()=>{throw new Error('Clinical labels are unassigned.');},paintSectionPixels,localTimeout,clearTimer,getWindowPresets,matchWindowPreset,
  class {constructor(data,width,height){this.data=data;this.width=width;this.height=height;}});
 class Store{
  constructor(){this.cache=new Map();this.held=new Map();stores.push(this);}
  cached(frame){return this.cache.get(frame.sha256)||null;}
  hold(frame){const wait=deferred();this.held.set(frame.url,wait);return wait;}
  async load(frame){const cached=this.cached(frame);if(cached)return cached;events.push({type:'load',frame,store:this});if(this.held.has(frame.url))await this.held.get(frame.url).promise;const bytes=Uint8Array.from({length:frame.decodedBytes},(_,i)=>(i+frame.index*7)%256);this.cache.set(frame.sha256,bytes);return bytes;}
  warm(series,index){events.push({type:'warm',series:series.id,index});}dispose(){this.cache.clear();}
 }
 const boot=fixtureFunction('document','VolumeRenderer','AppearanceController','ResidentSectionSource','orthogonalFrame','ClinicalFrameStore','validateClinicalManifest','snapSectionPosition','donorUrl','fetch','location','navigator','ResizeObserver','requestAnimationFrame','setTimeout','clearTimeout','PALETTE_KEYS',clinicalCode+'\nreturn bootClinicalPilot;')(
  document,Renderer,Appearance,ResidentSectionSource,orthogonalFrame,Store,validateClinicalManifest,snapSectionPosition,donorUrl,fetcher,location,navigator,class{observe(){}},fn=>{queueMicrotask(fn);return ++timerId;},localTimeout,clearTimer,['ivory','copper','grayscale','porcelain','contrast','anatomy']);
 const api=await boot(source,{sources:ALL_SOURCES});await settle();
 const trigger=(id,type,value,properties={})=>{const node=document.getElementById(id);assert(node,id);if(value!==undefined)node.value=String(value);const event=new window.Event(type,{bubbles:true,cancelable:true});Object.assign(event,properties);node.dispatchEvent(event);return event;};
 const runTimers=async maxMs=>{for(const [id,timer]of [...timers])if(timer.ms<=maxMs){timers.delete(id);await timer.fn();}await settle();};
 return {api,document,window,manifest,events,stores,timers,location,trigger,runTimers};
}

test('the existing app routes clinical sources before preparing any HOA banks or modules',async()=>{
 const {document}=parseHTML(html),calls=[];
 const code=(await readFile(new URL('public/app.js',root),'utf8')).replace(/^import .*;\s*$/gm,'').replace(/\nmain\(\);\s*$/,'').replace("import('./clinical-app.js')",'Promise.resolve(clinicalModule)');
 const api=fixtureFunction('document','location','donorFromSearch','HostedSectionStore','UltraVolumeSource','SectionDetail','VolumeLoader','ResidentSectionSource','ALL_SOURCES','clinicalModule',code+'\nreturn {main};')(
  document,{search:'?donor=cmac-case-1'},donorFromSearch,class{constructor(){assert.fail('HOA section bank initialized');}},class{constructor(){assert.fail('HOA fine volume initialized');}},class{constructor(store){assert.equal(store,null);}},class{},ResidentSectionSource,ALL_SOURCES,
  {async bootClinicalPilot(source,options){calls.push({source,options});}});
 await api.main();assert.equal(calls.length,1);assert.equal(calls[0].source.id,'cmac-case-1');assert.equal(calls[0].options.sources.length,DONORS.length+2);
});

test('the single heart-choice row preserves source routes and returns from both clinical pilots',async()=>{
 for(const source of ALL_SOURCES){
  const {document}=parseHTML(html);
  const href=`https://fixture.invalid/?donor=${source.id}&context=review#view=old-camera`;
  initializeDatasetBrowser(document,{href,search:new URL(href).search});
  assert.equal(document.getElementById('donorSelect'),null,'The redundant dropdown is removed.');
  assert.equal(document.getElementById('exploreSlicerHeart'),null,'The duplicate SlicerHeart action is removed.');
  const choices=[...document.querySelectorAll('.dataset-shortcuts [data-source-link]')];
  assert.equal(choices.length,ALL_SOURCES.length);
  assert.equal(choices.filter(link=>link.getAttribute('aria-current')==='page').length,1);
  for(const link of choices){
   const destination=new URL(link.href);
   assert.equal(destination.searchParams.get('donor'),link.dataset.sourceLink);
   assert.equal(destination.searchParams.get('context'),'review');
   assert.equal(destination.hash,'','Saved views never move between sources.');
   assert.equal(link.getAttribute('aria-current')==='page',link.dataset.sourceLink===source.id);
  }
 }
 for(const id of ['cmac-case-1','slicerheart-4d']){
  const clinical=await fixture(id);
  const href=clinical.location.href+'&context=review#clinical=old-view';
  initializeDatasetBrowser(clinical.document,{href,search:new URL(href).search});
  const returned=new URL(clinical.document.querySelector('[data-source-link="'+DONORS[0].id+'"]').href);
  assert.equal(returned.searchParams.get('donor'),DONORS[0].id);
  assert.equal(returned.searchParams.get('context'),'review');
  assert.equal(returned.hash,'');
 }
});

test('clinical metadata, source window, linked sections and fullscreen controls use the acquired series',async()=>{
 const f=await fixture('cmac-case-1'),r=f.api.renderer;
 assert.equal(f.events.filter(e=>e.type==='load').length,1,'First useful view needs just one measured volume.');
 assert.equal(f.document.getElementById('loading').hidden,true);assert.equal(f.document.getElementById('probeTab').hidden,true);assert.equal(f.document.getElementById('teeTab').hidden,true);
 assert.equal(f.document.querySelectorAll('.dataset-shortcuts [data-source-link]').length,5);
 assert.match(f.document.getElementById('clinicalSampling').textContent,/3 mm source slice thickness/);
 assert.equal(r.camera.distance,2,'The native MRI framing keeps its taller field in view.');
 assert.equal(f.document.querySelector('[data-material="anatomy"]').disabled,true);
 const bytes=r.data.slice(),threshold=r.settings.threshold;
 f.trigger('windowGamma','input',.72);await f.runTimers(100);
 assert.equal(r.settings.windowGamma,.72);assert.equal(r.settings.threshold,threshold);assert.deepEqual(r.data,bytes);
 assert.equal(f.document.getElementById('windowGammaValue').textContent,'0.72');
 f.trigger('resetWindow','click');await f.runTimers(100);assert.equal(r.settings.windowGamma,f.manifest.series[0].displayWindow.windowGamma);
 f.trigger('sliceRangeX','input',.8);await settle();
 assert.equal(r.settings.clipAxis,0);assert.equal(r.settings.clipPosition,snapSectionPosition(.8,4));
 const before=r.settings.clipPosition;f.trigger('sliceX','wheel',undefined,{deltaY:-20});await settle();
 assert.equal(r.settings.clipPosition,snapSectionPosition(before-1/3,4));
 assert.match(f.document.getElementById('sliceIndexX').textContent,/Section 2 \/ 4/);
 f.trigger('fullscreen','click');await settle();assert.equal(f.document.fullscreenElement.id,'reconstructionWorkspace');assert.equal(f.document.getElementById('fullscreenLabel').textContent,'Exit Fullscreen');
 f.trigger('fullscreen','click');await settle();assert.equal(f.document.fullscreenElement,null);
 f.trigger('aboutButton','click');assert.equal(f.document.getElementById('aboutDialog').open,true);
 assert.match(f.document.getElementById('aboutDialog').textContent,/separate acquisitions|not co-registered/i);
});

test('both clinical sources transfer active section feedback across browsing and enlargement',async()=>{
 for(const id of ['cmac-case-1','slicerheart-4d']){
  const f=await fixture(id),keys=['X','Y','Z'];
  const active=axis=>{
   assert.equal(f.api.renderer.settings.clipAxis,axis);
   assert.equal(f.document.querySelectorAll('.slice-card.linked').length,axis<0?0:1);
   for(const [i,key]of keys.entries()){
    const card=f.document.getElementById('slice'+key).closest('.slice-card');
    assert.equal(card.classList.contains('linked'),i===axis,id+'/'+key);
    assert.equal(card.querySelector('.slice-activate').getAttribute('aria-pressed'),String(i===axis));
   }
  };
  const click=selector=>f.document.querySelector(selector).dispatchEvent(new f.window.Event('click',{bubbles:true}));
  for(const [axis,key]of keys.entries()){f.trigger('slice'+key,'wheel',undefined,{deltaY:40});active(axis);}
  f.trigger('sliceRangeX','input',.4);active(0);
  assert.equal(f.document.querySelector('.axis-x').classList.contains('browsed'),true);
  click('[data-section-axis="Y"][data-section-step="1"]');active(1);
  f.trigger('sliceZ','keydown',undefined,{key:'ArrowDown'});active(2);
  f.trigger('sliceX','click');active(0);
  click('[data-section-expand="Y"]');active(1);
  assert.equal(f.document.querySelector('.slice-card.expanded').dataset.axis,'y');
  f.trigger('sliceY','wheel',undefined,{deltaY:-40});active(1);
  click('[data-section-expand="Y"]');active(1);
  const pinch=f.trigger('sliceX','wheel',undefined,{deltaY:40,ctrlKey:true});active(1);
  assert.equal(pinch.defaultPrevented,false);
  f.trigger('sliceX','wheel',undefined,{deltaY:0});active(1);
  f.document.getElementById('sliceZ').setPointerCapture=()=>{};
  f.trigger('sliceZ','pointerdown',undefined,{pointerType:'touch',pointerId:1,clientY:100});
  f.trigger('sliceZ','pointermove',undefined,{pointerType:'touch',pointerId:1,clientY:75});active(2);
  f.trigger('sliceZ','pointerup');f.trigger('presetWhole','click');active(-1);
 }
});

test('plane names follow the committed clinical series and paired echo keeps probe-local names',async()=>{
 const f=await fixture('cmac-case-1'),names=()=>[...f.document.querySelectorAll('[data-section-name]')].map(node=>node.textContent);
 assert.deepEqual(names(),['Coronal','Axial','Sagittal']);
 const sax=f.manifest.series.find(series=>series.id==='cine-sax'),store=f.stores[0],frame=sax.frames[sax.defaultFrame??0];
 const held=store.hold(frame),pending=f.api.chooseSeries(sax.id);
 assert.deepEqual(names(),['Coronal','Axial','Sagittal'],'Old names remain while old source is displayed.');
 held.reject(new Error('Fixture transfer interrupted'));await pending;
 assert.deepEqual(names(),['Coronal','Axial','Sagittal'],'A failed replacement keeps the prior source names.');
 store.held.delete(frame.url);await f.api.chooseSeries(sax.id);await settle();
 assert.deepEqual(names(),['Longitudinal 1','Longitudinal 2','Short-axis']);
 f.trigger('sliceRangeZ','input',.6);await settle();
 assert.equal(f.api.renderer.settings.clipAxis,2);assert.match(f.document.getElementById('sectionSyncStatus').textContent,/^Short-axis is linked/);
 await f.api.chooseSeries('ultrasound');await settle();
 assert.deepEqual(names(),['Probe plane 1','Probe plane 2','Probe plane 3']);
 assert.match(f.document.getElementById('sectionOrientationNote').textContent,/patient orientation is not registered/i);
 f.trigger('echoTab','click');await settle();
 assert.deepEqual(names(),['Coronal','Axial','Sagittal']);
 assert.deepEqual([...f.document.querySelectorAll('#echoCineAxis option')].map(node=>node.textContent),['Probe Plane 2','Probe Plane 1','Probe Plane 3']);
 f.trigger('echoCineAxis','change',2);await settle();
 assert.match(f.document.getElementById('clinicalEchoCanvas').getAttribute('aria-label'),/^Probe plane 3/);
 assert.equal(f.document.getElementById('echoCineSection').getAttribute('aria-label'),'Probe plane 3 position');
});

test('newest requested measured phase wins over an older late decode',async()=>{
 const f=await fixture('slicerheart-4d'),series=f.manifest.series.find(s=>s.id==='overview'),store=f.stores[0];
 const held=store.hold(series.frames[2]);const old=f.api.showFrame(2);
 const current=await f.api.showFrame(4);assert.equal(current,true);assert.equal(f.api.renderer.data[0],28);
 held.resolve();assert.equal(await old,false);assert.equal(f.api.renderer.data[0],28);
 assert.match(f.document.getElementById('clinicalPhaseLabel').textContent,/Phase 5 \/ 21/);
});

test('phase-loop controls skip the duplicate closing phase and static reference disables playback',async()=>{
 const f=await fixture('slicerheart-4d');
 assert.equal(f.api.renderer.settings.clipAxis,-1);assert.equal(f.api.renderer.settings.mode,0);assert.equal(f.api.renderer.camera.roll,0);
 assert.equal(f.document.getElementById('clinicalPlay').getAttribute('aria-pressed'),'true');
 await f.api.showFrame(19);await f.runTimers(125);
 assert.equal(f.document.getElementById('clinicalPhase').value,'0');assert.equal(f.api.renderer.data[0],0);
 assert.equal(f.document.getElementById('clinicalPlay').textContent,'Pause');
 f.trigger('clinicalPlay','click');assert.equal(f.document.getElementById('clinicalPlay').textContent,'Play Phases');
 await f.api.chooseSeries('native-reference');await settle();
 assert.equal(f.document.getElementById('clinicalPlay').disabled,true);assert.equal(f.document.getElementById('clinicalPhase').disabled,true);
 assert.match(f.document.getElementById('clinicalPhaseLabel').textContent,/Static/);
 assert.equal(f.document.getElementById('echoTab').hidden,true);assert.equal(f.document.getElementById('probeTab').hidden,true);
 await f.api.chooseSeries('native-detail');await settle();
 const detail=f.manifest.series.find(s=>s.id==='native-detail');
 assert.equal(f.document.getElementById('clinicalPhase').value,String(detail.defaultFrame));
 assert.equal(f.api.renderer.settings.clipAxis,-1);assert.equal(f.api.renderer.camera.roll,0);
 assert.equal(Number(f.document.getElementById('sliceRangeZ').value),snapSectionPosition(detail.defaultSlice.position,detail.dimensions[detail.defaultSlice.axis]));
 assert.equal(f.document.getElementById('clinicalPlay').textContent,'Play Phases','An explicit pause survives series changes.');
});

test('SlicerHeart reset restores the upright whole volume after an explicit section view',async()=>{
 const f=await fixture('slicerheart-4d');
 f.trigger('sliceRangeY','input',.6);await settle();assert.equal(f.api.renderer.settings.clipAxis,1);
 f.api.renderer.camera.roll=1.1;f.api.renderer.reset();
 assert.equal(f.api.renderer.settings.clipAxis,-1);assert.equal(f.api.renderer.settings.mode,0);assert.equal(f.api.renderer.camera.roll,0);
 assert.equal(f.document.getElementById('presetWhole').getAttribute('aria-pressed'),'true');
 f.trigger('sliceRangeX','input',.7);f.trigger('resetView','click');
 assert.equal(f.api.renderer.settings.clipAxis,-1);assert.equal(f.api.renderer.camera.roll,0);
});

test('SlicerHeart controls stay with all three sections in fullscreen without moving cMAC controls',async()=>{
 const f=await fixture('slicerheart-4d'),workspace=f.document.getElementById('reconstructionWorkspace');
 const rail=workspace.querySelector('.sections-panel'),bar=f.document.querySelector('.clinical-series-bar');
 assert.equal(bar.parentElement,rail);
 assert.equal(f.document.querySelector('.workspace-tabs').hidden,true);
 assert.equal(rail.querySelectorAll('.slice-card').length,3);
 assert.equal(rail.querySelector('[data-section-slot="first"]').dataset.axis,'y');
 assert.equal(rail.querySelector('[data-section-slot="second"]').dataset.axis,'x');
 assert.equal(rail.querySelector('[data-section-slot="wide"]').dataset.axis,'z');
 f.trigger('fullscreen','click');await settle();
 assert.equal(f.document.fullscreenElement.contains(bar),true);
 const cmac=await fixture('cmac-case-1');
 assert.equal(cmac.document.getElementById('reconstructionWorkspace').contains(cmac.document.querySelector('.clinical-series-bar')),false);
 assert.notEqual(cmac.document.querySelector('.workspace-tabs').hidden,true);
});

test('all SlicerHeart series rotate longitudinal displays together while retaining measured cuts and axial orientation',async()=>{
 const f=await fixture('slicerheart-4d'),r=f.api.renderer;
 for(const id of ['overview','native-detail','native-reference']){
  await f.api.chooseSeries(id);await settle();
  assert.ok(r.camera.yaw>1&&r.camera.yaw<2.4,'The whole volume opens laterally, away from the posterior spine view.');
  assert.equal(r.camera.roll,0);
  const pixels=r.data.slice();
  for(const [axis,key]of ['X','Y','Z'].entries()){
   f.events.length=0;f.trigger('sliceRange'+key,'input',.6);await settle();
   const frame=orthogonalFrame(axis,r.settings.clipPosition,r.extent),alignment=f.events.findLast(e=>e.type==='align');
   assert.deepEqual(alignment.normal,frame.normal,'A display rotation cannot reverse the physical cutting plane.');
   assert.deepEqual(alignment.center,frame.center);
   assert.deepEqual(alignment.up,axis===2?frame.up:frame.up.map(v=>-v));
   assert.equal(r.settings.clipFlip,[1,0,1][axis],'The retained volume half is unchanged.');
   for(const name of ['X','Y'])assert.ok(f.events.some(e=>e.type==='flip'&&e.id==='slice'+name&&e.x===-1&&e.y===-1));
   assert.equal(f.events.some(e=>e.type==='flip'&&e.id==='sliceZ'),false,'The axial raster retains its established orientation.');
   assert.deepEqual(r.data,pixels,'Reorientation leaves the measured volume byte-exact.');
  }
  f.trigger('presetWhole','click');assert.equal(r.settings.clipAxis,-1);assert.equal(r.camera.roll,0);
  assert.ok(r.camera.yaw>1&&r.camera.yaw<2.4);
 }
 const cmac=await fixture('cmac-case-1');
 assert.equal(cmac.events.some(e=>e.type==='flip'&&e.x===-1&&e.y===-1),false,'cMAC does not inherit SlicerHeart display rotation.');
});

test('automatic playback cannot revive a stale series loop and preserves static-series intent',async()=>{
 const f=await fixture('slicerheart-4d'),overview=f.manifest.series.find(s=>s.id==='overview');
 const held=f.stores[0].hold(overview.frames[1]);
 const [id,timer]=[...f.timers].find(([,timer])=>timer.ms===125);f.timers.delete(id);const oldStep=timer.fn();await settle();
 await f.api.chooseSeries('native-detail');const current=f.api.renderer.data;
 held.resolve();await oldStep;
 assert.equal(f.api.renderer.data,current);assert.equal(f.document.getElementById('clinicalPhase').value,'10');
 assert.equal([...f.timers.values()].filter(timer=>timer.ms===125).length,1,'Only the newly selected series schedules playback.');
 await f.runTimers(125);assert.equal(f.document.getElementById('clinicalPhase').value,'11');
 await f.api.chooseSeries('native-reference');assert.equal([...f.timers.values()].filter(timer=>timer.ms===125).length,0);
 await f.api.chooseSeries('overview');assert.equal(f.document.getElementById('clinicalPlay').textContent,'Pause');
 f.trigger('clinicalPhase','input',20);await settle();
 assert.equal(f.document.getElementById('clinicalPhase').value,'20','The recorded duplicate closing phase remains manually available.');
 assert.equal(f.document.getElementById('clinicalPlay').textContent,'Play Phases');
 await f.api.chooseSeries('native-detail');assert.equal(f.document.getElementById('clinicalPlay').textContent,'Play Phases');
});

test('pausing an in-flight phase restores the slider to the displayed frame',async()=>{
 const f=await fixture('slicerheart-4d'),overview=f.manifest.series.find(s=>s.id==='overview');
 const current=f.api.renderer.data,held=f.stores[0].hold(overview.frames[1]);
 const [id,timer]=[...f.timers].find(([,timer])=>timer.ms===125);f.timers.delete(id);const pendingStep=timer.fn();await settle();
 assert.equal(f.document.getElementById('clinicalPhase').value,'1');
 f.trigger('clinicalPlay','click');
 assert.equal(f.document.getElementById('clinicalPhase').value,'0');assert.match(f.document.getElementById('clinicalPhaseLabel').textContent,/Phase 1 \/ 21/);
 held.resolve();await pendingStep;
 assert.equal(f.api.renderer.data,current);assert.equal(f.document.getElementById('clinicalPhase').value,'0');
 assert.equal([...f.timers.values()].filter(timer=>timer.ms===125).length,0);
});

test('cMAC series switches stop playback instead of carrying its intent to another acquisition',async()=>{
 const f=await fixture('cmac-case-1');
 await f.api.chooseSeries('cine-sax');
 assert.equal(f.document.getElementById('clinicalPlay').textContent,'Play Phases');
 f.trigger('clinicalPlay','click');await settle();assert.equal(f.document.getElementById('clinicalPlay').textContent,'Pause');
 await f.api.chooseSeries('ultrasound');
 assert.equal(f.document.getElementById('clinicalPlay').textContent,'Play Phases');
 assert.equal([...f.timers.values()].filter(timer=>timer.ms===125).length,0);
 await f.api.chooseSeries('cine-sax');assert.equal(f.document.getElementById('clinicalPlay').textContent,'Play Phases');
});

test('late results from an old series cannot overwrite the selected series',async()=>{
 const f=await fixture('slicerheart-4d'),series=f.manifest.series.find(s=>s.id==='overview'),store=f.stores[0];
 const held=store.hold(series.frames[3]),old=f.api.showFrame(3);
 await f.api.chooseSeries('native-reference');const current=f.api.renderer.data;
 held.resolve();assert.equal(await old,false);assert.equal(f.api.renderer.data,current);
 assert.equal(f.document.getElementById('clinicalSeries').value,'native-reference');assert.match(f.document.getElementById('clinicalPhaseLabel').textContent,/Static/);
});

test('series metadata changes only with its ready data and a failed replacement retains the previous view',async()=>{
 const f=await fixture('slicerheart-4d'),detail=f.manifest.series.find(s=>s.id==='native-detail'),store=f.stores[0];
 const original=f.api.renderer.data,originalSampling=f.document.getElementById('clinicalSampling').textContent;
 const pending=store.hold(detail.frames[detail.defaultFrame]),switching=f.api.chooseSeries(detail.id);
 assert.equal(f.api.renderer.data,original);assert.equal(f.document.getElementById('clinicalSampling').textContent,originalSampling);
 f.trigger('sliceRangeY','input',.6);await settle();assert.equal(f.api.renderer.data,original);
 pending.reject(new Error('Fixture transfer interrupted'));await switching;
 assert.equal(f.api.renderer.data,original);assert.equal(f.document.getElementById('clinicalSeries').value,'overview');
 assert.equal(f.document.getElementById('clinicalPlay').disabled,false);
 assert.match(f.document.getElementById('status').textContent,/previous series remains available/);
 store.held.delete(detail.frames[detail.defaultFrame].url);await f.api.chooseSeries(detail.id);await settle();
 assert.notEqual(f.api.renderer.data,original);assert.equal(f.document.getElementById('clinicalSampling').textContent,detail.samplingDescription);
});

test('paired ultrasound uses a separate acquired phase and is independent of MRI windowing',async()=>{
 const f=await fixture('cmac-case-1');
 f.trigger('echoTab','click');await settle();
 assert.equal(f.document.getElementById('pairedClinicalEcho').hidden,false);assert.equal(f.stores.length,2);
 assert.match(f.document.getElementById('clinicalPairNote').textContent,/not spatially registered or phase-synchronized/);
 f.trigger('echoCinePhase','input',6);await settle();assert.equal(f.document.getElementById('echoCinePhase').value,'6');
 assert.match(f.document.getElementById('echoCinePhaseLabel').textContent,/Phase 7 \/ 14/);
 const echoLoads=f.events.filter(e=>e.type==='load'&&e.store===f.stores[1]).length;
 f.trigger('windowHigh','input',.63);await f.runTimers(100);
 assert.equal(f.events.filter(e=>e.type==='load'&&e.store===f.stores[1]).length,echoLoads);
 f.trigger('echoCineAxis','change',0);f.trigger('echoCineSection','input',.8);await settle();
 assert.equal(Number(f.document.getElementById('echoCineSection').value),snapSectionPosition(.8,4));
 assert(f.events.some(e=>e.type==='flip'&&e.id==='clinicalEchoCanvas'&&e.y===-1));
 f.trigger('reconstructionTab','click');assert.equal(f.document.getElementById('pairedClinicalEcho').hidden,true);assert.equal(f.document.getElementById('reconstructionWorkspace').classList.contains('clinical-paired'),false);
});

test('shared whole-organ and translucent clinical links restore accepted phase, appearance and camera',async()=>{
 for(const mode of [0,1]){
  const saved={series:'overview',frame:7,positions:[.22,.64,.38],axis:-1,
   camera:{yaw:.31,pitch:-.22,roll:.71,distance:1.92,pan:[.01,.02,.03]},
   window:{mode,palette:3,threshold:.43,opacity:.12,clipFlip:1,showPlanes:1,quality:'high',surfaceSmoothing:2,
    windowEnabled:true,windowLow:.18,windowHigh:.91,windowGamma:.77,cutFaceExposure:1.24,capContrast:1.15}};
  const f=await fixture('slicerheart-4d',{saved}),r=f.api.renderer;
  assert.equal(r.settings.clipAxis,-1,'A saved uncut view must not reopen as the default cutaway.');
  for(const [key,value]of Object.entries(saved.window))assert.equal(r.settings[key],value,key);
  assert.deepEqual(r.camera,saved.camera);assert.equal(f.document.getElementById('clinicalPhase').value,'7');
  assert.equal(f.document.getElementById(mode?'presetGlass':'presetWhole').getAttribute('aria-pressed'),'true');
  f.trigger('shareView','click');await settle();
  const shared=new URL(f.events.find(e=>e.type==='clipboard').text),state=JSON.parse(decodeURIComponent(shared.hash.slice(10)));
  assert.equal(shared.searchParams.get('donor'),'slicerheart-4d');assert.equal(state.axis,-1);assert.equal(state.frame,7);assert.equal(state.window.mode,mode);assert.equal(state.playing,false);
  assert.equal([...f.timers.values()].filter(timer=>timer.ms===125).length,0,'An existing shared phase stays paused.');
 }
});

test('an explicitly playing shared view restores its camera and phase before advancing',async()=>{
 const saved={series:'overview',frame:7,axis:-1,playing:true,camera:{yaw:.2,pitch:.1,roll:.8,distance:1.8,pan:[0,0,0]}};
 const f=await fixture('slicerheart-4d',{saved});
 assert.equal(f.document.getElementById('clinicalPhase').value,'7');assert.deepEqual(f.api.renderer.camera,saved.camera);
 assert.equal(f.document.getElementById('clinicalPlay').textContent,'Pause');
 await f.runTimers(125);assert.equal(f.document.getElementById('clinicalPhase').value,'8');assert.deepEqual(f.api.renderer.camera,saved.camera);
});

test('prefixed fullscreen API operates on the same clinical comparison wrapper',async()=>{
 const f=await fixture('slicerheart-4d'),workspace=f.document.getElementById('reconstructionWorkspace');
 workspace.requestFullscreen=undefined;f.document.exitFullscreen=undefined;
 workspace.webkitRequestFullscreen=()=>{f.document.webkitFullscreenElement=workspace;f.document.dispatchEvent(new f.window.Event('webkitfullscreenchange'));};
 f.document.webkitExitFullscreen=()=>{f.document.webkitFullscreenElement=null;f.document.dispatchEvent(new f.window.Event('webkitfullscreenchange'));};
 f.trigger('fullscreen','click');await settle();assert.equal(f.document.webkitFullscreenElement,workspace);assert.equal(f.document.getElementById('fullscreen').getAttribute('aria-pressed'),'true');
 f.trigger('fullscreen','click');await settle();assert.equal(f.document.webkitFullscreenElement,null);assert.equal(f.document.getElementById('fullscreenLabel').textContent,'Fullscreen');
});

test('a shared paired view restores its independent echo phase and choosing the echo volume leaves MRI comparison',async()=>{
 const f=await fixture('cmac-case-1');
 f.trigger('echoTab','click');await settle();f.trigger('echoCinePhase','input',6);await settle();
 f.trigger('echoCineAxis','change',0);f.trigger('echoCineSection','input',.8);await settle();
 f.trigger('shareView','click');await settle();
 const url=new URL(f.events.find(e=>e.type==='clipboard').text),saved=JSON.parse(decodeURIComponent(url.hash.slice(10)));
 assert.equal(saved.paired,true);assert.equal(saved.echo.frame,6);assert.equal(saved.echo.axis,0);
 const restored=await fixture('cmac-case-1',{saved});
 assert.equal(restored.document.getElementById('pairedClinicalEcho').hidden,false);
 assert.equal(restored.document.getElementById('echoCinePhase').value,'6');
 assert.equal(restored.document.getElementById('echoCineAxis').value,'0');
 assert.equal(Number(restored.document.getElementById('echoCineSection').value),snapSectionPosition(.8,4));
 const us=restored.manifest.series.find(s=>s.modality==='US');await restored.api.chooseSeries(us.id);await settle();
 assert.equal(restored.document.getElementById('pairedClinicalEcho').hidden,true,'The same echo cannot be mislabeled as an independent MRI/echo acquisition.');
});
