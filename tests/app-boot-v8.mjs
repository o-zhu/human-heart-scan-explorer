import {CoronaryControls} from '../public/coronary-controls.js';
import {CoronaryDataSource} from '../public/coronary-data.js';
import {CORONARY_REVEAL_READY} from '../public/coronary-release.js';
import {titleCaseUi} from '../public/ui-text.js';
// Import-stripping DOM fixtures still use the production display-label helper.
const uiFunction=(...args)=>new Function('titleCaseUi','CoronaryControls','CoronaryDataSource','CORONARY_REVEAL_READY',...args).bind(null,titleCaseUi,CoronaryControls,CoronaryDataSource,CORONARY_REVEAL_READY);
/** Execute the actual app boot/transition code with DOM and I/O fixtures; no browser. */
import test from 'node:test';
import * as sectionNames from '../public/section-names.js';
// This fixture strips imports; preserve the real section-name dependency.
const fixtureFunction=(...args)=>uiFunction(...Object.keys(sectionNames),...args).bind(null,...Object.values(sectionNames));
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {ScanActivity} from '../public/download-priority.js';
import {VolumeLoader} from '../public/volume-loader.js';
import {HostedSectionStore,UltraSections} from '../public/hosted-ultra.js';
import {SectionDetail} from '../public/section-detail.js';
import {UltraVolumeSource} from '../public/ultra-volume.js';
import {orthogonalFrame} from '../public/planes.js';
import {croppedSectionFrame} from '../public/section-layout.js';
import {DONORS,ALL_SOURCES,donorFromSearch,donorUrl,spacingLabel} from '../public/donors.js';
import {ResidentSectionSource} from '../public/resident-sections.js';
import {getWindowPresets,matchWindowPreset} from '../public/window-presets.js';

const domPath=process.argv[2];if(!domPath)throw new Error('Pass the installed linkedom ESM entry point.');
const {parseHTML}=await import(pathToFileURL(domPath));
const html=await readFile(new URL('../page.html',import.meta.url),'utf8');
const source=(await readFile(new URL('../public/app.js',import.meta.url),'utf8')).replace(/^import .*;\s*$/gm,'').replace(/\nmain\(\);\s*$/,'');
const appearanceSource=(await readFile(new URL('../public/appearance.js',import.meta.url),'utf8')).replace(/^import .*;\s*$/gm,'').replace(/^export /gm,'');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate,label='condition'){for(let i=0;i<1000;i++){if(predicate())return;await tick();}throw new Error(`Timed out: ${label}`);}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});

function environment({saved,donorId,webglFailure=false}={}){
  const query=donorId?'?donor='+donorId:'',selectedDonor=donorFromSearch(query);
  const {document,window}=parseHTML(html),events=[],workers=[],modules={},timers=[],codeWait={};
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this._testValue??this.querySelector('option[selected]')?.value??this.querySelector('option')?.value??'';},set(v){this._testValue=String(v);}});
  for(const canvas of document.querySelectorAll('canvas'))canvas.getBoundingClientRect=()=>({width:0,height:0,left:0,top:0});
  const activity=new ScanActivity({idleMs:1000000,prefetchIdleMs:1000000});
  const fixtureManifest={specimen:selectedDonor.specimen,levels:{
    low:{label:'Preview',dimensions:[3,3,3],spacingUm:635.2,supportCompressed:true},
    high:{label:'Detail',dimensions:[5,5,5],spacingUm:317.6,supportCompressed:true}},defaultLevel:'high',previewLevel:'low'};
  const fixtureSections={schemaVersion:2,cropped:true,sliceCounts:[5,5,5],imageDimensionsXYZ:[17,17,17],
    sourceIndexStep:4,sourceWindow:[14640,23545],compressionLossless:true,spacingUm:79.4,
    assetBaseUrl:'https://scan.example/api/ultra/v4/',slices:Object.fromEntries([...'xyz'].map(axis=>[axis,
      Array.from({length:5},()=>({empty:true,path:'empty.webp',crop:[0,0,1,1],bytes:0}))]))};
  const cleanup=deferred(),echoFrames=deferred(),echoTextures=deferred();
  const renderer={canvas:document.getElementById('volumeCanvas'),loaded:false,backend:'webgl2',
    settings:{palette:4,mode:0,threshold:.28,opacity:.8,clipAxis:-1,clipPosition:.5,clipFlip:0,showPlanes:0,cleanupEnabled:true,quality:'high',surfaceSmoothing:1,capContrast:1.8},
    camera:{yaw:.5,pitch:.2,roll:0,distance:1.5,pan:[0,0,0]},extent:[1,1,1],cap:null,
    load(data,meta){this.loaded=true;this.meta=meta;events.push({type:'usable-view',level:meta.label});},
    set(values){Object.assign(this.settings,values);},requestRender(){},clearCapData(){this.cap=null;},setCapData(cap){this.cap=cap;},alignPlane(){},autoRotate:false,
    setCleanupData(){events.push({type:'cleanup-installed'});},setAnatomyData(){events.push({type:'anatomy-installed'});}};
  const fetcher=async(input,options={})=>{
    const url=String(input);events.push({type:'fetch',url,priority:options.priority,usable:renderer.loaded});
    if(url===selectedDonor.manifestUrl)return response(fixtureManifest);
    if(url===selectedDonor.ultraManifestUrl)return response(fixtureSections);
    if(url===selectedDonor.cleanupManifestUrl)return cleanup.promise;
    if(url==='/fixture-cleanup-mask')return new Response(new Uint8Array([1]));
    if(url===selectedDonor.echoPlanesUrl)return echoFrames.promise;
    if(url===selectedDonor.echoTexturesUrl)return echoTextures.promise;
    throw new Error('Unexpected fixture fetch: '+url);
  };
  const localTimeout=(fn,ms)=>{timers.push({fn,ms});return timers.length;};
  const AppearanceController=fixtureFunction('document','fetch','scanActivity','loadAnatomy','paintSectionPixels','setTimeout','clearTimeout','console','getWindowPresets','matchWindowPreset',
    appearanceSource+'\nreturn AppearanceController;')(document,fetcher,activity,async()=>{events.push({type:'anatomy-fetch'});return {labels:[]};},()=>{},localTimeout,()=>{},{warn(){}},getWindowPresets,matchWindowPreset);
  const moduleClass=mode=>class{
    constructor({mount}){
      this.enters=0;this.leaves=0;this.restores=0;this.volumes=0;this.active=false;modules[mode]=this;
      const viewport=document.createElement('div');viewport.id=mode+'ViewportMount';mount.append(viewport);
    }
    setFineSource(source){this.fineSource=source;}
    setVolume(){this.volumes++;events.push({type:'module-volume',mode});}
    setFrames(){events.push({type:'module-frames',mode});}
    setPresetTextures(){events.push({type:'module-textures',mode});}
    init(){events.push({type:'module-init',mode});return Promise.resolve();}
    enter(){this.enters++;this.active=true;events.push({type:'module-enter',mode});return this.enterWait?.promise||Promise.resolve();}
    leave(){this.leaves++;this.active=false;}
    updateAppearance(){}
    restore(){this.restores++;}
    getState(){return {};}
  };
  const EchoModule=moduleClass('echo'),ProbeLabModule=moduleClass('probe');
  const QuickViews=class{constructor(){this.active=false;this.state={preset:null};}setVolume(){}updateAppearance(){}suspend(){this.active=false;}resume(){}deactivate(){this.state.preset=null;this.active=false;}getState(){return this.state.preset?this.state:null;}restore(saved){this.state=saved;this.active=true;return Promise.resolve();}};
  const loadWorkbenchModule=async mode=>{events.push({type:'module-code',mode,usable:renderer.loaded});await codeWait[mode]?.promise;return {EchoModule,ProbeLabModule,QuickViews,CPUVolumeRenderer:class{constructor(canvas){renderer.canvas=canvas;renderer.backend='software';events.push({type:'software-canvas',canvas});return renderer;}}};};
  const code=source+`\nreturn {main,loadLevel,switchTab,ensureModuleData,
    collectionStatus(collection){const previous=ultraSource;try{ultraSource={getStatus:()=>({collection})};syncUltraCacheStatus();}finally{ultraSource=previous;}},
    state(){return {currentTab,currentLevel,postViewStarted,tabRevision};},
    close(){volumeLoader.cancel();sectionStore.dispose();ultraVolume.destroy();}};`;
  const api=fixtureFunction('document','window','location','VolumeRenderer','CPUVolumeRenderer','AppearanceController','EchoModule','QuickViews','ProbeLabModule',
    'SectionDetail','HostedSectionStore','UltraSections','UltraVolumeSource','VolumeLoader','scanActivity','fetch','ResizeObserver','requestAnimationFrame',
    'setTimeout','clearTimeout','console','PALETTE_KEYS','DONORS','ALL_SOURCES','donorFromSearch','donorUrl','spacingLabel','orthogonalFrame','croppedSectionFrame','ResidentSectionSource','loadWorkbenchModule',code)(
    document,window,{hash:saved?'#view='+encodeURIComponent(JSON.stringify(saved)):'',search:query},class{constructor(){if(webglFailure)throw new Error('Fixture shader/driver initialization failure');return renderer;}},class{},AppearanceController,
    EchoModule,QuickViews,ProbeLabModule,SectionDetail,
    class extends HostedSectionStore{constructor(options){super({...options,fetchImpl:fetcher,idleDelay:1000000});}},UltraSections,UltraVolumeSource,
    class{constructor(){return new VolumeLoader({activity,workerFactory:()=>{
      const worker={postMessage(message){this.message=message;events.push({type:'volume-request',level:message.level.label});},terminate(){this.terminated=true;},
        finish(){this.onmessage({data:{type:'ready',data:new Uint8Array(this.message.level.dimensions.reduce((a,b)=>a*b,1)).buffer,stats:{receivedBytes:1000}}});},
        fail(){this.onmessage({data:{type:'error',message:'Fixture volume error'}});}};
      workers.push(worker);return worker;
    }});}},activity,fetcher,class{observe(){}},fn=>{queueMicrotask(()=>{events.push({type:'paint-opportunity',usable:renderer.loaded});fn(performance.now());});return 0;},localTimeout,()=>{},
    {warn(){},error(error){events.push({type:'error',message:error.message});},info(){}},['ivory','copper','grayscale','porcelain','contrast','anatomy'],
    DONORS,ALL_SOURCES,donorFromSearch,donorUrl,spacingLabel,orthogonalFrame,croppedSectionFrame,ResidentSectionSource,loadWorkbenchModule);
  return {api,events,workers,modules,renderer,activity,document,window,cleanup,echoFrames,echoTextures,codeWait,
    finishCleanup:()=>cleanup.resolve(response({volumeUrl:'/fixture-cleanup-mask',dimensions:[1,1,1]})),
    finishEcho:()=>{echoFrames.resolve(response({frames:{}}));echoTextures.resolve(response({textures:{}}));},
    close:()=>{api.close();activity.dispose();}};
}
const count=(e,suffix)=>e.events.filter(v=>v.type==='fetch'&&v.url.split('?')[0].endsWith(suffix)).length;
async function firstPreview(e){const boot=e.api.main();await until(()=>e.workers.length===1,'preview request');e.workers[0].finish();await until(()=>e.workers.length===2,'background detail request');return {boot};}

test('Automatic download yields retain Pause while an explicit user pause offers Resume',()=>{
  const e=environment();try{
    const button=e.document.getElementById('pauseUltraCollection');
    for(const reason of ['loading-viewer','foreground','interaction']){
      e.api.collectionStatus({state:'paused',paused:false,reason});
      assert.equal(button.dataset.action,'pause',reason);
      assert.equal(button.textContent,'Pause Download',reason);
    }
    e.api.collectionStatus({state:'paused',paused:true,reason:'user'});
    assert.equal(button.dataset.action,'resume');assert.equal(button.textContent,'Resume Download');
    e.api.collectionStatus({state:'complete',complete:true});assert.equal(button.disabled,true);
  }finally{e.close();}
});

test('Actual boot requests only the manifest and preview before installing a usable heart',async()=>{
  const e=environment();try{
    const boot=e.api.main();await until(()=>e.workers.length===1);
    assert.deepEqual(e.events.filter(v=>v.type==='fetch').map(v=>v.url),['./assets/manifest.json']);
    assert.equal(e.events.some(v=>v.type==='module-code'),false,'Optional workspace scripts do not gate the first scan.');
    assert.equal(e.events.some(v=>v.type==='anatomy-fetch'||v.type==='module-init'),false);assert.equal(e.activity.getState().viewerReady,false);
    e.workers[0].finish();await until(()=>e.workers.length===2);
    assert.equal(e.document.getElementById('loading').hidden,true);assert.equal(e.renderer.loaded,true);
    assert.equal(e.activity.getState().viewerReady,true);assert.equal(e.activity.getState().allowBackground,false);
    assert(e.events.filter(v=>v.type==='fetch'&&!v.url.endsWith('/assets/manifest.json')).every(v=>v.usable));
    assert.equal(count(e,'/assets/cleanup/manifest.json'),1);assert.equal(count(e,'/assets/display-compact-v29/sections-manifest.json'),1);
    assert.equal(e.events.some(v=>v.type==='anatomy-fetch'||v.type==='module-init'),false);
    assert.deepEqual(e.events.filter(v=>v.type==='module-code').map(v=>v.mode),['quick']);
    const firstOptional=e.events.findIndex(v=>v.type==='module-code');
    assert(e.events.slice(0,firstOptional).filter(v=>v.type==='paint-opportunity'&&v.usable).length>=2);
    assert.equal(e.modules.echo,undefined);assert.equal(e.modules.probe,undefined);
    e.finishCleanup();e.workers[1].finish();await boot;assert.equal(e.api.state().currentLevel,'high');
    assert.equal(e.renderer.settings.palette,4);assert.equal(e.document.getElementById('loading').hidden,true);
  }finally{e.close();}
});

test('A resolution request superseding the startup preview still initializes optional features exactly once',async()=>{
  const e=environment();try{
    const boot=e.api.main();await until(()=>e.workers.length===1);
    const replacement=e.api.loadLevel('high',{background:false});await boot;
    assert.equal(e.workers[0].terminated,true);assert.equal(count(e,'/assets/cleanup/manifest.json'),0);
    e.workers[1].finish();assert.equal(await replacement,true);await until(()=>count(e,'/assets/display-compact-v29/sections-manifest.json')===1);
    assert.equal(e.api.state().postViewStarted,true);assert.equal(count(e,'/assets/cleanup/manifest.json'),1);
    const next=e.api.loadLevel('low');e.workers[2].finish();await next;e.finishCleanup();await tick();
    assert.equal(count(e,'/assets/cleanup/manifest.json'),1);assert.equal(count(e,'/assets/display-compact-v29/sections-manifest.json'),1);
  }finally{e.close();}
});

test('Retrying a failed first volume starts cleanup and fine sections after the retry succeeds',async()=>{
  const e=environment();try{
    const boot=e.api.main();await until(()=>e.workers.length===1);e.workers[0].fail();await boot;
    assert.equal(e.renderer.loaded,false);assert.equal(count(e,'/assets/cleanup/manifest.json'),0);
    const retry=e.document.getElementById('retryLoad').onclick();e.workers[1].finish();assert.equal(await retry,true);
    await until(()=>count(e,'/assets/display-compact-v29/sections-manifest.json')===1);assert.equal(count(e,'/assets/cleanup/manifest.json'),1);
    e.finishCleanup();await tick();assert.equal(e.document.getElementById('loading').hidden,true);
  }finally{e.close();}
});

test('Rapid tab reversal enters the latest module once while high detail refines in the background',async()=>{
  const e=environment();try{
    const {boot}=await firstPreview(e);const old=e.api.switchTab('echo');e.api.switchTab('reconstruction');const latest=e.api.switchTab('echo');
    e.finishCleanup();await until(()=>count(e,'/assets/echo-planes.json')===1);assert.equal(e.modules.echo.enters,0);
    e.finishEcho();await Promise.all([old,latest]);assert.equal(e.modules.echo.enters,1);
    e.renderer.camera.distance=.75;e.workers[1].finish();await boot;
    assert.equal(e.api.state().currentTab,'echo');assert.equal(e.modules.echo.active,true);assert.equal(e.renderer.camera.distance,.75);
    assert.equal(e.document.getElementById('viewport').parentElement.id,'echoViewportMount');
  }finally{e.close();}
});

test('A module chosen during background refinement supersedes a saved module',async()=>{
  const e=environment({saved:{module:'echo',echo:{preset:'plax'}}});try{
    const {boot}=await firstPreview(e);const selected=e.api.switchTab('probe');e.finishCleanup();await selected;
    e.workers[1].finish();await boot;assert.equal(e.api.state().currentTab,'probe');assert.equal(e.modules.echo?.restores||0,0);
    assert.equal(count(e,'/assets/echo-planes.json'),0);
  }finally{e.close();}
});

test('A module chosen during saved-module metadata loading is not replaced by its late result',async()=>{
  const e=environment({saved:{module:'echo',echo:{preset:'plax'}}});try{
    const {boot}=await firstPreview(e);e.finishCleanup();e.workers[1].finish();await until(()=>count(e,'/assets/echo-planes.json')===1);
    await e.api.switchTab('probe');e.finishEcho();await boot;
    assert.equal(e.api.state().currentTab,'probe');assert.equal(e.modules.echo.enters,0);assert.equal(e.modules.echo.restores,0);
  }finally{e.close();}
});

test('Late saved-module entry cannot restore its old camera after a newer module is selected',async()=>{
  const e=environment({saved:{module:'echo',echo:{preset:'plax'},camera:{yaw:.8,pitch:.2,roll:0,distance:2.1,pan:[0,0,0]}}});try{
    const {boot}=await firstPreview(e);e.finishCleanup();e.workers[1].finish();await until(()=>e.modules.echo,'lazy saved module creation');e.modules.echo.enterWait=deferred();e.finishEcho();
    await until(()=>e.modules.echo.enters===1);await e.api.switchTab('probe');e.renderer.camera.distance=.67;
    e.modules.echo.enterWait.resolve();await boot;assert.equal(e.api.state().currentTab,'probe');assert.equal(e.renderer.camera.distance,.67);
  }finally{e.close();}
});


test('A slow optional script never blocks Reconstruction or steals the viewport after a tab reversal',async()=>{
 const e=environment();try{
  const {boot}=await firstPreview(e);e.codeWait.probe=deferred();
  e.renderer.camera.distance=.82;const opening=e.api.switchTab('probe');
  assert.equal(e.api.state().currentTab,'probe');assert.equal(e.modules.probe,undefined);
  assert.match(e.document.getElementById('probePanel').textContent,/Opening the TTE Lab/);
  e.api.switchTab('reconstruction');assert.equal(e.renderer.camera.distance,.82);
  e.workers[1].finish();await boot;e.codeWait.probe.resolve();await opening;
  assert.equal(e.api.state().currentTab,'reconstruction');assert.equal(e.modules.probe.enters,0);
  assert(e.document.getElementById('reconstructionWorkspace').contains(e.document.getElementById('viewport')));
  assert.equal(e.events.filter(event=>event.type==='module-code'&&event.mode==='probe').length,1);
  e.finishCleanup();await e.api.switchTab('probe');assert.equal(e.modules.probe.enters,1);
  assert.equal(e.events.filter(event=>event.type==='module-code'&&event.mode==='probe').length,1,'The loaded workspace is reused.');
  assert.equal(e.document.getElementById('viewport').parentElement.id,'probeViewportMount');
 }finally{e.close();}
});

test('donor window controls adjust display, retain geometry and reset to the selected source',async()=>{
 const profile=DONORS.find(item=>item.id==='s-20-29').displayWindow;
 const e=environment({donorId:'s-20-29'});try{
  const {boot}=await firstPreview(e);e.workers[1].finish();await boot;
  const settings=e.renderer.settings,beforeThreshold=settings.threshold,requestCount=e.workers.length;
  assert.equal(settings.windowEnabled,true);assert.equal(settings.capContrast,1);
  assert.equal(settings.cutFaceExposure,profile.cutFaceExposure);
  assert.ok(Math.abs(settings.windowLow-profile.windowLow)<1e-12);
  const low=e.document.getElementById('windowLow');low.value=.4;low.dispatchEvent(new e.window.Event('input'));
  assert.equal(settings.windowLow,.4);assert.equal(settings.threshold,beforeThreshold);assert.equal(e.workers.length,requestCount);
  const high=e.document.getElementById('windowHigh');high.value=.2;high.dispatchEvent(new e.window.Event('input'));
  assert.ok(settings.windowHigh>=settings.windowLow+.005);
  const gamma=e.document.getElementById('windowGamma');gamma.value=1.8;gamma.dispatchEvent(new e.window.Event('input'));
  assert.equal(settings.windowGamma,1.8);assert.equal(settings.threshold,beforeThreshold);
  const exposure=e.document.getElementById('cutFaceExposure');exposure.value=2.2;exposure.dispatchEvent(new e.window.Event('input'));
  assert.equal(settings.cutFaceExposure,2.2);assert.equal(settings.threshold,beforeThreshold);assert.equal(e.workers.length,requestCount);
  e.document.getElementById('resetWindow').dispatchEvent(new e.window.Event('click'));
  assert.equal(settings.windowGamma,profile.windowGamma);assert.equal(settings.capContrast,1);assert.equal(settings.threshold,beforeThreshold);
  assert.equal(settings.cutFaceExposure,profile.cutFaceExposure);
 }finally{e.close();}
});

test('boot preserves dataset links after removing the comparison table',async()=>{
 const e=environment();try{
  const {boot}=await firstPreview(e);e.workers[1].finish();await boot;
  for(const id of ['compareDonors','donorComparison','donorComparisonRows','closeDonorComparison'])assert.equal(e.document.getElementById(id),null);
  const links=[...e.document.querySelectorAll('[data-source-link]')];
  assert.equal(links.length,ALL_SOURCES.length);
  assert.deepEqual(links.map(node=>node.dataset.sourceLink).sort(),ALL_SOURCES.map(item=>item.id).sort());
  assert.equal(e.document.querySelector('.brand').getAttribute('aria-label'),'Heart Explorer');
  assert.equal(e.document.querySelector('.brand-copy').textContent,'HEART EXPLORER');
 }finally{e.close();}
});

test('global CT window settings stay usable across Probe and Echo without restoring old brightness',async()=>{
 const e=environment({donorId:'s-20-28'});try{
  const {boot}=await firstPreview(e);e.finishCleanup();e.workers[1].finish();await boot;
  const settings=e.document.getElementById('viewerSettings'),windowControls=e.document.getElementById('windowControls');
 const reconstructionControls=[...e.document.querySelectorAll('[data-reconstruction-settings]')].filter(element=>element.id!=='fineSurfaceControls');
 assert.equal(e.document.getElementById('fineSurfaceControls').hidden,true,'The LADAF-only experiment stays hidden for this S donor.');
  assert(reconstructionControls.length>0);assert(reconstructionControls.every(element=>!element.hidden));
  await e.api.switchTab('probe');
  assert.equal(settings.hidden,false);assert.equal(windowControls.hidden,false);
  assert(reconstructionControls.every(element=>element.hidden));
  const exposure=e.document.getElementById('cutFaceExposure');exposure.value=2.35;exposure.dispatchEvent(new e.window.Event('input'));
  const gamma=e.document.getElementById('windowGamma');gamma.value=.75;gamma.dispatchEvent(new e.window.Event('input'));
  const contrast=e.document.getElementById('capContrast');contrast.value=1.05;contrast.dispatchEvent(new e.window.Event('input'));
  assert.equal(e.renderer.settings.cutFaceExposure,2.35);assert.equal(e.renderer.settings.windowGamma,.75);
  assert.equal(e.renderer.settings.capContrast,1.05);assert.equal(e.document.getElementById('capContrastValue').textContent,'1.05×');
  e.finishEcho();await e.api.switchTab('echo');
  assert.equal(settings.hidden,false);assert(reconstructionControls.every(element=>element.hidden));
  assert.equal(e.renderer.settings.cutFaceExposure,2.35);assert.equal(e.renderer.settings.windowGamma,.75);
  assert.equal(e.renderer.settings.capContrast,1.05);
  await e.api.switchTab('reconstruction');
  assert(reconstructionControls.every(element=>!element.hidden));
  assert.equal(e.document.getElementById('fineSurfaceControls').hidden,true);
  assert.equal(e.renderer.settings.cutFaceExposure,2.35);assert.equal(e.renderer.settings.windowGamma,.75);
  assert.equal(e.renderer.settings.capContrast,1.05);
  assert.equal(exposure.value,'2.35');assert.equal(gamma.value,'0.75');
 }finally{e.close();}
});

test('CT browsing steps link the right plane, clamp at its edge and expose the current index',async()=>{
 const e=environment();try{
  const {boot}=await firstPreview(e);e.workers[1].finish();await boot;
  const next=e.document.querySelector('[data-section-axis="X"][data-section-step="1"]');
  for(let n=0;n<4;n++)next.dispatchEvent(new e.window.Event('click'));
  assert.equal(e.renderer.settings.clipAxis,0);assert.equal(e.renderer.settings.clipPosition,1);
  assert.equal(e.document.getElementById('sliceIndexX').textContent,'Section 5 / 5');
  assert.equal(e.document.getElementById('sliceRangeX').getAttribute('aria-valuetext'),'Coronal section 5 of 5');
  assert.equal(next.disabled,true);assert(e.document.getElementById('sliceX').closest('.slice-card').classList.contains('browsed'));
  e.document.querySelector('[data-section-axis="X"][data-section-step="-1"]').dispatchEvent(new e.window.Event('click'));
  assert.equal(e.renderer.settings.clipPosition,.75);assert.equal(next.disabled,false);
  e.document.querySelector('[data-section-axis="Z"][data-section-step="1"]').dispatchEvent(new e.window.Event('click'));
  assert.equal(e.renderer.settings.clipAxis,2);assert.equal(e.renderer.settings.clipPosition,.75);
  assert.match(e.document.getElementById('sectionSyncStatus').textContent,/Axial is linked/);
 }finally{e.close();}
});

test('Section enlargement is reversible and optional controls remain in the collapsed Settings panel',async()=>{
 const e=environment();try{
  const {boot}=await firstPreview(e);e.workers[1].finish();await boot;
  const settings=e.document.getElementById('viewerSettings');assert(!settings.hasAttribute('open'));
  for(const id of ['renderMode','threshold','windowLow','cutFaceQuality','cleanupEnabled','surfaceSmoothing'])assert(settings.contains(e.document.getElementById(id)),id);
  assert(!settings.contains(e.document.getElementById('palette')));
  assert(e.document.querySelector('.viewer-toolbar').contains(e.document.getElementById('palette')));
  assert(e.document.querySelector('.viewer-controls').contains(e.document.getElementById('presetWhole')));
  const button=e.document.querySelector('[data-section-expand="Y"]'),card=button.closest('.slice-card');
  button.dispatchEvent(new e.window.Event('click'));
  assert.equal(button.getAttribute('aria-expanded'),'true');assert(card.classList.contains('expanded'));assert(card.parentElement.classList.contains('has-expanded'));
  button.dispatchEvent(new e.window.Event('click'));
  assert.equal(button.getAttribute('aria-expanded'),'false');assert(!card.classList.contains('expanded'));assert(!card.parentElement.classList.contains('has-expanded'));
 }finally{e.close();}
});

test('Fullscreen captures the heart and all three CT sections, with a labeled exit',async()=>{
 const e=environment();try{
  const {boot}=await firstPreview(e);e.workers[1].finish();await boot;
  const workspace=e.document.getElementById('reconstructionWorkspace'),button=e.document.getElementById('fullscreen');
  assert(workspace.contains(e.document.getElementById('viewport')));
  for(const axis of ['X','Y','Z'])assert(workspace.contains(e.document.getElementById('slice'+axis)));
  assert(!workspace.contains(e.document.getElementById('viewerSettings')));
  assert.equal(e.document.getElementById('flowTab'),null);assert.equal(e.document.getElementById('flowPanel'),null);
  assert(e.document.querySelector('.viewport-heading').contains(e.document.getElementById('quickViews')));
  workspace.requestFullscreen=async function(){e.document.fullscreenElement=this;};
  e.document.exitFullscreen=async()=>{e.document.fullscreenElement=null;};
  button.dispatchEvent(new e.window.Event('click'));await tick();
  assert.equal(e.document.fullscreenElement,workspace);assert.equal(button.getAttribute('aria-pressed'),'true');
  assert.equal(e.document.getElementById('fullscreenLabel').textContent,'Exit Fullscreen');
  button.dispatchEvent(new e.window.Event('click'));await tick();
  assert.equal(e.document.fullscreenElement,null);assert.equal(button.getAttribute('aria-pressed'),'false');
 }finally{e.close();}
});

test('Fullscreen uses the active comparison workspace and supports the WebKit fallback',async()=>{
 const e=environment();try{
  const {boot}=await firstPreview(e);e.workers[1].finish();e.finishCleanup();await boot;
  await e.api.switchTab('probe');
  const panel=e.document.getElementById('probePanel');
  panel.webkitRequestFullscreen=async function(){e.document.webkitFullscreenElement=this;};
  e.document.webkitExitFullscreen=async()=>{e.document.webkitFullscreenElement=null;};
  e.document.getElementById('fullscreen').dispatchEvent(new e.window.Event('click'));await tick();
  assert.equal(e.document.webkitFullscreenElement,panel);
  assert(panel.contains(e.document.getElementById('viewport')));
  e.api.switchTab('reconstruction');await tick();assert.equal(e.document.webkitFullscreenElement,null);
 }finally{e.close();}
});

test('a failed WebGL initialization uses a fresh 2D canvas and still opens the scan',async()=>{
 const e=environment({webglFailure:true});
 try{
  const previous=e.document.getElementById('volumeCanvas'),label=previous.getAttribute('aria-label');
  const boot=e.api.main();await until(()=>e.workers.length===1);
  const canvas=e.document.getElementById('volumeCanvas');
  assert.notEqual(canvas,previous);assert.equal(previous.isConnected,false);
  assert.equal(canvas.getAttribute('aria-label'),label);assert.equal(canvas,e.renderer.canvas);
  assert.equal(e.renderer.backend,'software');assert.equal(e.workers[0].message.gpuCrop,false);assert.equal(e.workers[0].message.acceleration,true);
  e.workers[0].finish();await until(()=>e.workers.length===2);
  assert.equal(e.renderer.loaded,true);assert.equal(e.document.getElementById('loading').hidden,true);
  e.finishCleanup();e.workers[1].finish();await boot;
  assert.equal(e.document.querySelectorAll('#volumeCanvas').length,1);
 }finally{e.close();}
});

test('a stalled startup manifest has a finite timeout, aborts transport and releases its timer',async()=>{
 const helper=source.slice(source.indexOf('async function requestScanManifest('),source.indexOf('async function main('));
 let deadline,signal,cleared=false;
 const request=Function('fetch','setTimeout','clearTimeout',helper+'\nreturn requestScanManifest;')(
  (_url,options)=>{signal=options.signal;return new Promise(()=>{});},
  (fn,ms)=>{assert.equal(ms,30000);deadline=fn;return 7;},
  id=>{assert.equal(id,7);cleared=true;});
 const pending=request('./manifest.json');deadline();
 await assert.rejects(pending,/scan metadata did not respond/);
 assert.equal(signal.aborted,true);assert.equal(cleared,true);
});
