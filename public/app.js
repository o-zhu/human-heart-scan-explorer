import { VolumeRenderer } from './renderer.js';
import { SectionDetail } from './section-detail.js';
import { orthogonalFrame } from './planes.js';
import {croppedSectionFrame,sectionImageRect} from './section-layout.js';
import {AppearanceController,PALETTE_KEYS} from './appearance.js';
import {UltraSections,HostedSectionStore} from './hosted-ultra.js';
import {VolumeLoader} from './volume-loader.js';
import {UltraVolumeSource} from './ultra-volume.js';
import {scanActivity} from './download-priority.js';
import {DONORS,ALL_SOURCES,donorFromSearch,spacingLabel} from './donors.js';
import {ResidentSectionSource} from './resident-sections.js';
import {loadWorkbenchModule} from './workbench-modules.js';
import {sectionNamingFor,sectionLabel,linkedSectionText,applySectionNames,updateSectionExpandLabel} from './section-names.js';
import {titleCaseUi} from './ui-text.js';
import {CoronaryControls} from './coronary-controls.js';
import {CoronaryDataSource} from './coronary-data.js';
import {CORONARY_REVEAL_READY} from './coronary-release.js';
const $=id=>document.getElementById(id);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const displaySpacing=level=>(Array.isArray(level.spacingUm)?level.spacingUm[0]:level.spacingUm).toFixed(1);
const donor=donorFromSearch(typeof location==='undefined'?'':location.search||'');
const source=donor.datasetUrl;
const sectionNaming=sectionNamingFor({source:donor});
const sectionStore=donor.kind==='clinical'?null:new HostedSectionStore({manifestUrl:donor.ultraManifestUrl,cacheName:donor.cacheName,pauseKey:donor.pauseKey,activity:scanActivity});
const ultraVolume=donor.kind==='clinical'?null:new UltraVolumeSource({manifestUrl:donor.ultraVolumeManifestUrl,cacheName:donor.volumeCacheName,activity:scanActivity});
let renderer, manifest, volumeData, volumeMeta, currentLevel, loading=false, slicePositions=[.5,.5,.5];
let slices=[],toastTimer,restoredLevel,activeAxis=-1,sectionDetail=new SectionDetail(sectionStore),detailTimer,detailFailed=false;
let echoModule,quickViews,probeModule,teeModule,currentTab='reconstruction',reconstructionState,restoredEcho,restoredEchoCamera,restoredQuickView,restoredProbe,restoredProbeCamera,restoredTee,restoredTeeCamera;
let appearance,ultraSource,ultraReady,ultraController,ultraBusy=false,ultraToken=0,ultraFailed=false,cutFaceQuality='ultra';
let ultraRequestKey='',ultraSubscribed=false,detailControllers=[];
const volumeLoader=new VolumeLoader();
const residentSections=new ResidentSectionSource();
let volumeLoadToken=0,volumeOriginal=false,cleanupRequested=true,requestedLevel;
const moduleReady=new Map();
const moduleInstances=new Map();
let postViewStarted=false,tabRevision=0;
let fineSurfaceController,nativeMainDetailController,coronaryControls,coronarySource,restoredCoronary=false,coronaryRestoreReady=false;
const pendingSectionDraws=new Set();let sectionDrawFrame=0,sectionDrawTask=0;
const viewportHome=$('viewport').parentElement;
const setText=(id,text)=>{if($(id)&&$(id).textContent!==text)$(id).textContent=text;};
function toast(text){let el=$('toast');if(!el){el=document.createElement('div');el.id='toast';el.setAttribute('role','status');document.body.append(el);}el.textContent=text;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),4000);}
function status(text){setText('status',text);}
function loadingState(title,detail,pct){
 $('loading').hidden=false;setText('loadTitle',title);setText('loadDetail',detail);
 const p=$('loadProgress');if(p){if(p.tagName==='PROGRESS')p.value=pct;else{p.style.width=pct+'%';p.setAttribute('aria-valuenow',pct);}}
}
function hideLoading(){$('loading').hidden=true;}
function configureDonorUI(){
 applySectionNames(document,sectionNaming);
 setText('specimenLabel',donor.specimen);
 $('sourceDataset')?.setAttribute('href',donor.datasetUrl);$('aboutDatasetLink')?.setAttribute('href',donor.datasetUrl);
 const quality=$('cutFaceQuality');if(quality){quality.querySelector('[value="ultra"]').textContent='Ultra · '+spacingLabel(donor.fineSpacingUm);quality.querySelector('[value="detail"]').textContent='Detailed · '+spacingLabel(donor.fineSpacingUm*2);}
 document.body.dataset.donor=donor.id;
}
function ensureModuleInstance(mode){
 const existing=mode==='quick'?quickViews:specializedModule(mode);if(existing)return Promise.resolve(existing);
 if(moduleInstances.has(mode))return moduleInstances.get(mode);
 const promise=loadWorkbenchModule(mode).then(types=>{
  let instance;
  if(mode==='echo'){
   instance=echoModule=new types.EchoModule({renderer,mount:$('echoPanel'),onExit:()=>switchTab('reconstruction'),onSteer:()=>switchTab('tee'),toast,appearance,donor});
   instance.setFineSource?.(ultraVolume);
  }else if(mode==='probe')instance=probeModule=new types.ProbeLabModule({renderer,mount:$('probePanel'),onExit:()=>switchTab('reconstruction'),toast,appearance,fineSource:ultraVolume,donor});
  else if(mode==='tee')instance=teeModule=new types.TeeLabModule({renderer,mount:$('teePanel'),onExit:()=>switchTab('reconstruction'),onAtlas:()=>Promise.resolve(switchTab('echo')).then(()=>echoModule?.selectPreset('me4c')),toast,appearance,fineSource:ultraVolume,donor});
  else if(mode==='quick')instance=quickViews=new types.QuickViews({renderer,mount:$('quickViews'),toast,appearance,donor,fineSource:ultraVolume,onActivate:()=>{tabRevision++;cancelUltraLoad(false);activeAxis=-1;renderer.clearCapData();setText('sectionSyncStatus','Scroll over a section to link it to 3D');syncControls();},onChange:syncControls});
  if(volumeData)instance.setVolume(volumeData,volumeMeta);
  return instance;
 }).catch(error=>{moduleInstances.delete(mode);throw error;});
 moduleInstances.set(mode,promise);return promise;
}
function ensureModuleData(mode){
 if(moduleReady.has(mode))return moduleReady.get(mode);
 const release=scanActivity.beginForeground('module:'+mode);
 const load=async()=>{
  const instance=await ensureModuleInstance(mode);
  await appearance?.load();
  if(mode==='echo'){
   const [frames,textures]=await Promise.all([donor.echoPlanesUrl,donor.echoTexturesUrl].map(async url=>{const response=await fetch(url,{priority:'high'});if(!response.ok)throw new Error('Reference scan planes could not load.');return response.json();}));
   echoModule.setFrames(frames);echoModule.setPresetTextures(textures);
   if(!donor.geometricComparisonOnly&&donor.flowViewsUrl){try{const r=await fetch(donor.flowViewsUrl);if(r.ok)echoModule.setAtlasFlowFrames(await r.json());}catch(error){console.warn('Optional TEE regional anchors:',error);}}
  }else if(mode==='probe'||mode==='tee')await instance.init?.();
  return instance;
 };
 const promise=load().catch(error=>{moduleReady.delete(mode);throw error;}).finally(release);
 moduleReady.set(mode,promise);return promise;
}
function cancelCoronaryRestore(){restoredCoronary=false;coronaryControls?.exit();}
function resumeCoronaryRestore(){
 if(!coronaryRestoreReady||!restoredCoronary||!coronaryControls?.available)return;
 restoredCoronary=false;return coronaryControls.enable();
}
function setupCoronaryControls(){
 if(coronaryControls)return;
 const supported=CORONARY_REVEAL_READY&&!!renderer.gl&&DONORS.some(item=>item.id===donor.id);
 coronarySource=new CoronaryDataSource({donorId:donor.id});
 coronaryControls=new CoronaryControls({renderer,document,
  prepare:options=>coronarySource.prepare(options),
  commit:({data,meta})=>renderer.setCoronaryData(data,meta),
  onIntent:()=>{restoredCoronary=false;},
  onChange:()=>{renderer.coronaryPreparing=coronaryControls?.loading===true;syncControls(false);renderer.requestRender('camera');},
  context:{donorId:donor.id,workspace:currentTab,supported,
   samplingLabel:spacingLabel(manifest.levels.high.spacingUm)+' prepared display grid.'}});
}
function afterFirstUsableView(){
 if(postViewStarted)return;postViewStarted=true;setupCoronaryControls();
 if(donor.id==='ladaf-2021-17')void import('./fine-surface.js').then(async({FineSurfaceController})=>{
  fineSurfaceController=new FineSurfaceController({renderer,donor,mount:$('fineSurfaceControls'),toast,onChange:()=>syncControls(),initialVolumeThreshold:manifest?.defaultThreshold??.32,onSurfaceChoice:cancelCoronaryRestore});
  fineSurfaceController.setWorkspaceActive(currentTab==='reconstruction');
  $('fineSurfaceControls').hidden=currentTab!=='reconstruction';
  const {NativeMainDetailController}=await import('./native-main-detail.js');
  nativeMainDetailController=new NativeMainDetailController({renderer,donor,mount:$('nativeMainDetailMount'),toast,onChange:()=>syncControls()});
 }).catch(error=>console.warn('Optional fine surface controls unavailable:',error));
 // Every successful first view follows this path, including a retry or a
 // resolution selection that supersedes the startup preview.
 void ensureModuleInstance('quick').catch(error=>{console.warn(error);setText('quickViews','Starting views unavailable. Reload to retry.');});
 void appearance.load();
 void sectionDetail.init().then(async()=>{
  await prepareUltra();updateUltraFocus();queueDetailedSections();
  for(const[i,a]of ['X','Y','Z'].entries())$('sliceRange'+a).step=1/(sectionCount(i)-1);
 }).catch(error=>{setText('capDetailStatus','Volume texture · detailed sections unavailable');console.warn(error);});
}
function syncControls(syncAppearance=true){
 if(!renderer)return;const s=renderer.settings;
 const vals={renderMode:['surface','volume','mip'][s.mode],palette:PALETTE_KEYS[s.palette],threshold:s.threshold,opacity:s.opacity,clipAxis:['none','x','y','z'][s.clipAxis+1],clipPosition:activeAxis>=0&&activeAxis===s.clipAxis?slicePositions[activeAxis]:s.clipPosition,quality:s.quality,surfaceSmoothing:renderer.coronaryActive?.()?(s.coronarySmoothing??2):(s.surfaceSmoothing??1)};
 for(const [id,val]of Object.entries(vals))if($(id))$(id).value=val;
 if($('clipPosition')&&s.clipAxis>=0&&s.clipAxis<3){$('clipPosition').step=1/(sectionCount(s.clipAxis)-1);$('clipPosition').value=activeAxis>=0&&activeAxis===s.clipAxis?slicePositions[activeAxis]:s.clipPosition;}
 if($('showPlanes'))$('showPlanes').checked=!!s.showPlanes;
 if($('opacity')){$('opacity').disabled=s.mode!==1;$('opacity').title=s.mode===1?'Control transparency through the tissue':'Select Volume or Translucent to adjust opacity';}
 if($('clipFlip'))$('clipFlip').setAttribute('aria-pressed',String(!!s.clipFlip));
 if($('autoRotate')){$('autoRotate').setAttribute('aria-pressed',String(renderer.autoRotate));$('autoRotate').classList.toggle('active',renderer.autoRotate);}
 setText('thresholdValue',Math.round(s.threshold*100)+'%');setText('opacityValue',Math.round(s.opacity*100)+'%');setText('clipValue',Math.round((activeAxis>=0&&activeAxis===s.clipAxis?slicePositions[activeAxis]:s.clipPosition)*100)+'%');
 if($('capContrast'))$('capContrast').value=s.capContrast??1.8;setText('capContrastValue',(s.capContrast??1.8).toFixed(2)+'×');
 if($('cutFaceExposure'))$('cutFaceExposure').value=s.cutFaceExposure??1;setText('cutFaceExposureValue',(s.cutFaceExposure??1).toFixed(2)+'×');
 if($('clipAxis')&&s.clipAxis===3)$('clipAxis').value='preset';
 if($('clipPosition'))$('clipPosition').disabled=s.clipAxis<0||s.clipAxis>2;if($('clipFlip'))$('clipFlip').disabled=s.clipAxis<0;
 for(const [i,a]of ['X','Y','Z'].entries()){
  const count=sectionCount(i),index=Math.round(slicePositions[i]*(count-1));
  if($('sliceRange'+a)){$('sliceRange'+a).step=1/(count-1);$('sliceRange'+a).value=slicePositions[i];$('sliceRange'+a).setAttribute('aria-valuetext',`${sectionLabel(sectionNaming,i)} ${index+1} of ${count}`);}
  setText('sliceIndex'+a,`Section ${index+1} / ${count}`);
  document.querySelectorAll(`[data-section-axis="${a}"][data-section-step]`).forEach(button=>{button.disabled=+button.dataset.sectionStep<0?index===0:index===count-1;});
  const card=$('slice'+a)?.closest('.slice-card');card?.classList.toggle('linked',activeAxis===i);card?.querySelector('.slice-activate')?.setAttribute('aria-pressed',String(activeAxis===i));
  if(volumeMeta){const ix=slicePositions[i]*(volumeMeta.dimensions[i]-1);const sp=Array.isArray(volumeMeta.spacingUm)?volumeMeta.spacingUm[i]:volumeMeta.spacingUm;setText('sliceReadout'+a,`${(ix*sp/1000).toFixed(1)} mm`);}
 }
 const active=s.clipAxis>=0?'presetCutaway':s.mode===1?'presetGlass':'presetWhole';
 for(const id of ['presetWhole','presetCutaway','presetGlass']){$(id)?.classList.toggle('active',id===active);$(id)?.setAttribute('aria-pressed',String(id===active));}
 if(syncAppearance)appearance?.sync();coronaryControls?.sync();fineSurfaceController?.sync?.();nativeMainDetailController?.sync?.();syncUltraControls();
}
function sectionCount(axis){return sectionDetail.manifest?.sliceCounts[axis]||manifest?.levels?.high?.dimensions[axis]||volumeMeta?.dimensions[axis]||475;}
function scheduleSectionDraw(axis){
 if(Number.isInteger(axis))pendingSectionDraws.add(axis);else for(let i=0;i<slices.length;i++)pendingSectionDraws.add(i);
 if(sectionDrawFrame||sectionDrawTask)return;
 // Publish the 3D cap first. Repainting the CT cards is coalesced into one
 // later task, after the renderer's animation-frame opportunity. This keeps
 // multi-megapixel color conversion out of the scroll/decode callback.
 sectionDrawFrame=requestAnimationFrame(()=>{
  sectionDrawFrame=0;
  sectionDrawTask=setTimeout(()=>{
   sectionDrawTask=0;const axes=[...pendingSectionDraws];pendingSectionDraws.clear();
   if(currentTab!=='reconstruction')return;
   for(const index of axes)slices[index]?.draw();
  },0);
 });
}
function setSlices(values){
 const planeChanged=activeAxis>=0&&Math.round(values[activeAxis]*(sectionCount(activeAxis)-1))!==Math.round(slicePositions[activeAxis]*(sectionCount(activeAxis)-1));
 if(planeChanged)cancelUltraLoad(false);
 slicePositions=values.map((v,i)=>Math.round(clamp(v,0,1)*(sectionCount(i)-1))/(sectionCount(i)-1));
 updateUltraFocus();
 const changes={slices:slicePositions};if(activeAxis>=0){changes.clipAxis=activeAxis;changes.clipPosition=slicePositions[activeAxis];}
 // The requested plane always follows input. If native Ultra pixels are not
 // ready, sample this plane from the resident volume with the same cap transfer;
 // never freeze on, or move, a previous section's fine texture.
 renderer?.set(changes);
 if(activeAxis>=0&&slices[activeAxis])applySectionCap(slices[activeAxis],activeAxis);
 syncControls(false);refreshUltraCut();scheduleSectionDraw();queueDetailedSections();
}
function activateSection(axis,align=true){
 if(!renderer?.loaded)return;
 quickViews?.deactivate();
 if(axis!==activeAxis)cancelUltraLoad(false);
 const changed=activeAxis!==axis;activeAxis=axis;slicePositions[axis]=Math.round(slicePositions[axis]*(sectionCount(axis)-1))/(sectionCount(axis)-1);
 const plane=orthogonalFrame(axis,slicePositions[axis],renderer.extent);
 renderer.set({mode:0,clipAxis:axis,clipPosition:slicePositions[axis],clipFlip:[1,0,1][axis],showPlanes:0,oblique:null,slices:slicePositions});
 if(align){renderer.alignPlane(plane.normal,plane.up,plane.center);document.querySelectorAll('[data-view]').forEach(b=>{b.classList.remove('active');b.setAttribute('aria-pressed','false');});}
 if(changed)renderer.clearCapData();if(slices[axis])applySectionCap(slices[axis],axis);
 updateUltraFocus();refreshUltraCut();syncControls();queueDetailedSections();setText('sectionSyncStatus',linkedSectionText(sectionNaming,axis));
 $('volumeCanvas').setAttribute('aria-label','3D heart cutaway linked to the '+sectionLabel(sectionNaming,axis)+'. Drag to orbit; scroll to zoom.');
}
function unlinkSection(){quickViews?.deactivate();cancelUltraLoad(false);activeAxis=-1;renderer?.clearCapData();updateUltraFocus();setText('sectionSyncStatus','Choose a section to begin');}
function stepSection(axis,delta){
 if(!renderer?.loaded||!volumeMeta||!delta)return;
 if(activeAxis!==axis)activateSection(axis,true);
 const next=[...slicePositions];next[axis]+=delta/(sectionCount(axis)-1);
 renderer.lastInteraction=performance.now();
 $('slice'+['X','Y','Z'][axis])?.closest('.slice-card')?.classList.add('browsed');
 setSlices(next);
}
function queueDetailedSections(){clearTimeout(detailTimer);detailTimer=setTimeout(refreshDetailedSections,85);}
function currentSectionTexture(slice,axis){
 const index=Math.round(slicePositions[axis]*(sectionCount(axis)-1));
 if(cutFaceQuality==='ultra'&&slice.ultra?.index===index)return slice.ultra;
 return slice.detail?.index===index?slice.detail:sectionDetail.cached?.(axis,index)||null;
}
function setUltraTexture(slice,result){
 const changed=slice.ultra?.key!==result.key||slice.ultra?.data!==result.data;
 slice.ultra=result;if(changed)slice.cacheKey='';
 return changed;
}
function applySectionCap(slice,axis){
 if(activeAxis!==axis||renderer.settings.clipAxis!==axis||currentTab!=='reconstruction')return;
 let detail=currentSectionTexture(slice,axis);
 const index=Math.round(slicePositions[axis]*(sectionCount(axis)-1));
 // WebGL samples its resident volume directly at full output resolution. Only
 // the software renderer needs a CPU-extracted resident cap here; cards extract
 // their own latest native raster in the coalesced draw task.
 if(!detail&&renderer.backend!=='webgl2')detail=residentSections.get(axis,slicePositions[axis],index);
 if(!detail){
  if(renderer.cap)renderer.clearCapData();
  if(renderer.settings.clipPosition!==slicePositions[axis])renderer.set({clipPosition:slicePositions[axis],slices:slicePositions});
  setText('sectionSyncStatus',linkedSectionText(sectionNaming,axis));
  setText('capDetailStatus',`Current section ${index+1} · volume preview${cutFaceQuality==='ultra'&&!ultraFailed?' · Ultra detail follows':''}`);
  return;
 }
 const spacing=detail.spacingUm||sectionDetail.manifest?.spacingUm||158.8;
 const displayKey=`${detail.key}:${spacing}:${detail.width}x${detail.height}:${axis}:${slicePositions[axis]}:${renderer.extent.join(',')}`;
 const moved=renderer.settings.clipPosition!==slicePositions[axis];
 if(renderer.cap?.displayKey!==displayKey||renderer.cap?.data!==detail.data)renderer.setCapData({...detail,displayKey,sectionAxis:axis,sectionIndex:detail.index,spacingUm:spacing,plane:croppedSectionFrame(orthogonalFrame(axis,slicePositions[axis],renderer.extent),detail)});
 // Both changes run before the next animation frame: source pixels and clipping
 // geometry are published as one view, including a late cache decode.
 if(moved){renderer.lastInteraction=performance.now();renderer.set({clipPosition:slicePositions[axis],slices:slicePositions});}
 setText('sectionSyncStatus',linkedSectionText(sectionNaming,axis));
 if(!ultraBusy)setText('capDetailStatus',spacingLabel(spacing)+(detail.resident?' volume preview':' cut-face texture · measured scan')+(cutFaceQuality==='ultra'&&spacing>donor.fineSpacingUm*1.01?' · loading finer detail…':''));
 syncUltraControls();
}
function syncUltraControls(){
 if(!$('cutFaceQuality'))return;$('cutFaceQuality').value=cutFaceQuality;$('ultraControls').hidden=cutFaceQuality!=='ultra';
 const eligible=activeAxis>=0&&activeAxis<3&&currentTab==='reconstruction'&&renderer?.loaded;
 $('loadUltra').disabled=!eligible||ultraBusy;$('loadUltra').hidden=!ultraFailed;$('ultraProgress').hidden=!ultraBusy;
 if(!eligible){$('ultraEstimate').textContent='Select a section first.';return;}
 const index=Math.round(slicePositions[activeAxis]*(sectionCount(activeAxis)-1));
 const detail=slices[activeAxis]?.ultra,estimate=ultraSource?.manifest?ultraSource.estimate(activeAxis,index):null;
 const bytes=detail?.index===index?(detail.encodedBytes??detail.receivedBytes??estimate?.estimatedBytes):estimate?.estimatedBytes;
 const size=bytes==null?'':bytes<1024?`${bytes} B`:bytes<1e6?`${Math.ceil(bytes/1000)} KB`:`${(bytes/1e6).toFixed(2)} MB`;
 if(detail?.index===index){if(!ultraBusy)$('ultraEstimate').textContent=detail.empty?'Empty section · no image download':`${spacingLabel(donor.fineSpacingUm)} · ${size?size+' lossless image · ':''}ready`;return;}
 if(!ultraBusy)$('ultraEstimate').textContent=ultraFailed?'This slice could not load. You can retry.':`${size?size+' for this slice · ':''}viewed slices load first; nearby sections load ahead.`;
 syncUltraCacheStatus();
}
function cancelUltraLoad(announce=true){
 ultraToken++;ultraController?.abort();ultraController=null;ultraBusy=false;ultraFailed=false;ultraRequestKey='';syncUltraControls();
 if(announce)setText('capDetailStatus','Loading the selected scan section…');
}
async function prepareUltra(){
 if(!ultraSource)ultraSource=new UltraSections(sectionStore);
 if(!ultraSubscribed){ultraSubscribed=true;ultraSource.subscribe?.(event=>{
  if(event.type==='ready'&&event.result&&currentTab==='reconstruction'&&renderer?.loaded){
   const {axis,index,result}=event,expected=Math.round(slicePositions[axis]*(sectionCount(axis)-1));
   if(index===expected&&slices[axis]){setUltraTexture(slices[axis],result);applySectionCap(slices[axis],axis);scheduleSectionDraw(axis);}
  }
  syncUltraCacheStatus();
 });}
 ultraReady=ultraSource.init();await ultraReady;syncUltraControls();return ultraSource;
}
function syncUltraCacheStatus(){
 const s=ultraSource?.getStatus?.();if(!s)return;
 setText('ultraCacheStatus',s.plannedNeighbors?`${s.readyNeighbors} / ${s.plannedNeighbors} nearby slices decoded and ready`:'The viewed slice always loads first.');
 const c=s.collection;if(!c)return;
 const completed=Math.min(c.totalBytes||1,(c.completedBytes||0)+(c.activeBytes||0)),fraction=completed/(c.totalBytes||1);
 const counts=`${(c.completedFiles||0).toLocaleString()} / ${(c.totalFiles||0).toLocaleString()} images`,size=`${Math.round(completed/1e6)} / ${Math.round((c.totalBytes||0)/1e6)} MB`;
 const reasons={'loading-viewer':'Opening the heart first','foreground':'Current view has download priority','interaction':'Background download waits while you interact',quota:'Not enough browser storage', 'storage-unavailable':'Persistent browser storage is unavailable','save-data':'Paused by Data Saver',offline:'Waiting for connection',hidden:'Paused while the tab is hidden',user:'Download paused','network-retry':'Retrying interrupted downloads','failed-files':'Some downloads need a retry'};
 const title=c.complete?'CT Slice Cache Ready':c.state==='checking'?'Checking Stored CT Slices…':c.reason?reasons[c.reason]||'Preparing CT Slices…':`Downloading CT Slices · ${Math.round(fraction*100)}%`;
 setText('ultraCollectionLabel',title);setText('ultraCollectionDetail',c.totalFiles?`${counts} · ${size}. Echo and lab detail load for the current plane.`:'Preparing the scan inventory');
 $('scanDownloadBar')?.setAttribute('data-complete',String(!!c.complete));
 const progress=$('ultraCollectionProgress');if(progress)progress.value=c.complete?1:fraction;
 // Automatic interaction/foreground yields keep the user's Pause action stable,
 // including the pointerdown that precedes a click on this very button.
 const resumable=c.paused||['blocked','partial'].includes(c.state)||['user','save-data','failed-files'].includes(c.reason);
 const button=$('pauseUltraCollection');if(button){button.disabled=c.complete;button.textContent=c.complete?'Complete':resumable?'Resume Download':'Pause Download';button.dataset.action=resumable?'resume':'pause';}
}
function updateUltraFocus(){
 if(!ultraSource?.manifest||!volumeData||currentTab!=='reconstruction')return;
 const positions=slicePositions.map((v,i)=>Math.round(v*(sectionCount(i)-1)));
 ultraSource.setFocus?.(activeAxis,activeAxis>=0?positions[activeAxis]:0,{positions});
 for(const [axis,index] of positions.entries()){
  const cached=ultraSource.cached?.(axis,index);
  if(cached&&slices[axis])setUltraTexture(slices[axis],cached);
 }
 syncUltraCacheStatus();
}
function cancelDetailedSections(){for(const controller of detailControllers)controller?.abort();detailControllers=[];for(const slice of slices)slice.detailLoadingKey='';}
async function refreshUltraCut(){
 if(cutFaceQuality!=='ultra'||activeAxis<0||currentTab!=='reconstruction'||!renderer?.loaded)return;
 const index=Math.round(slicePositions[activeAxis]*(sectionCount(activeAxis)-1));
 const cached=ultraSource?.cached?.(activeAxis,index);if(cached)setUltraTexture(slices[activeAxis],cached);
 if(slices[activeAxis].ultra?.index===index){applySectionCap(slices[activeAxis],activeAxis);return;}
 if(ultraBusy&&ultraRequestKey===`${activeAxis}:${index}`)return;
 await loadUltraCut({silent:true});
}
async function loadUltraCut({silent=false}={}){
 if(activeAxis<0||activeAxis>2||!renderer?.loaded||currentTab!=='reconstruction')return;
 cancelUltraLoad(false);const token=++ultraToken,axis=activeAxis,index=Math.round(slicePositions[axis]*(sectionCount(axis)-1));
 ultraController=new AbortController();const signal=ultraController.signal;ultraBusy=true;ultraRequestKey=`${axis}:${index}`;$('ultraProgress').value=0;syncUltraControls();
 setText('capDetailStatus','Loading '+spacingLabel(donor.fineSpacingUm)+' scan texture…');
 try{
  await prepareUltra();if(signal.aborted)return;updateUltraFocus();
  const result=await ultraSource.load(axis,index,{signal,onProgress:progress=>{
   if(token!==ultraToken)return;const total=progress.estimatedBytes??progress.total??1,loaded=progress.estimatedBytes?(progress.receivedBytes??0):(progress.loaded??progress.completed??0);
   $('ultraProgress').value=total?loaded/total:0;
  }});
  if(signal.aborted||token!==ultraToken||axis!==activeAxis||index!==Math.round(slicePositions[axis]*(sectionCount(axis)-1)))return;
  setUltraTexture(slices[axis],{...result,index,axis,key:result.key||`ultra:${axis}:${index}`,spacingUm:result.spacingUm||donor.fineSpacingUm});
  ultraBusy=false;ultraFailed=false;applySectionCap(slices[axis],axis);scheduleSectionDraw(axis);if(!silent)toast(spacingLabel(donor.fineSpacingUm)+' cut-face detail ready');
 }catch(error){
  if(error.name!=='AbortError'&&token===ultraToken){ultraFailed=true;console.warn(error);if(!silent)toast('The finer texture could not load. Use Retry to try this slice again.');}
 }finally{if(token===ultraToken){ultraBusy=false;ultraController=null;ultraRequestKey='';applySectionCap(slices[axis],axis);if(ultraFailed){scheduleSectionDraw(axis);setText('capDetailStatus',currentSectionTexture(slices[axis],axis)?'Ultra unavailable · showing available scan detail':'Ultra unavailable · showing the selected volume section');}syncUltraControls();}}
}
async function refreshDetailedSections(){
 if(!renderer?.loaded||currentTab!=='reconstruction')return;
 if(!sectionDetail.manifest){if(activeAxis>=0)applySectionCap(slices[activeAxis],activeAxis);refreshUltraCut();return;}
 // The active fine cut need not wait for unrelated orthogonal card requests.
 refreshUltraCut();
 const jobs=slices.map(async(s,axis)=>{
  // Unselected card detail must not compete with initial volume/mask work.
  // The active cut is always allowed through with foreground priority.
  if(axis!==activeAxis&&(loading||scanActivity.getState().allowLocalPrefetch===false))return;
  const index=sectionDetail.index(axis,slicePositions[axis]),key=axis+':'+index;
  // A ready Ultra image already serves the card and cap. Avoid deriving a
  // second, half-size pixel array on the UI thread while browsing Ultra slices.
  if(cutFaceQuality==='ultra'&&s.ultra?.index===index){applySectionCap(s,axis);return;}
  if(s.detail?.key===key){applySectionCap(s,axis);return;}
  if(s.detailLoadingKey===key)return;
  detailControllers[axis]?.abort();const controller=new AbortController();detailControllers[axis]=controller;s.detailLoadingKey=key;
  if(activeAxis===axis)setText('capDetailStatus','Loading detailed scan section…');
  try{
   const result=await sectionDetail.load(axis,index,{signal:controller.signal,priority:axis===activeAxis?5:30});
   if(controller.signal.aborted||currentTab!=='reconstruction'||index!==sectionDetail.index(axis,slicePositions[axis]))return;
   s.detail=result;applySectionCap(s,axis);scheduleSectionDraw(axis);
  }catch(e){if(e.name==='AbortError')return;if(activeAxis===axis)setText('capDetailStatus','Using volume texture · detailed section unavailable');if(!detailFailed){console.warn(e);detailFailed=true;}}
  finally{if(detailControllers[axis]===controller){detailControllers[axis]=null;s.detailLoadingKey='';}}
 });await Promise.allSettled(jobs);
}
class SliceView{
 constructor(canvas,axis){
  this.canvas=canvas;this.axis=axis;this.zoom=1;this.offscreen=document.createElement('canvas');this.cacheKey='';
  this.observer=new ResizeObserver(()=>this.draw());this.observer.observe(canvas);
  let dragging=false,touchStart=null;
  canvas.style.touchAction='none';
  const point=e=>{if(!this.box||!volumeMeta)return;const r=canvas.getBoundingClientRect(),dpr=canvas.width/r.width,x=(e.clientX-r.left)*dpr,y=(e.clientY-r.top)*dpr;const u=clamp((x-this.box.x)/this.box.w,0,1),v=clamp((y-this.box.y)/this.box.h,0,1);let p=[...slicePositions];if(axis===2){p[0]=u;p[1]=v;}else if(axis===1){p[0]=u;p[2]=v;}else{p[1]=u;p[2]=v;}setSlices(p);};
  canvas.addEventListener('pointerdown',e=>{activateSection(axis,true);dragging=true;canvas.setPointerCapture(e.pointerId);touchStart=e.pointerType==='touch'?{y:e.clientY,index:Math.round(slicePositions[axis]*(sectionCount(axis)-1))}:null;if(!touchStart)point(e);});
  canvas.addEventListener('pointermove',e=>{if(!dragging)return;if(touchStart){const index=clamp(touchStart.index+Math.round((touchStart.y-e.clientY)/7),0,sectionCount(axis)-1),current=Math.round(slicePositions[axis]*(sectionCount(axis)-1));if(index!==current)stepSection(axis,index-current);}else point(e);});
  const stop=()=>{dragging=false;touchStart=null;};canvas.addEventListener('pointerup',stop);canvas.addEventListener('pointercancel',stop);
  canvas.addEventListener('wheel',e=>{if(!volumeMeta||!e.deltaY||e.ctrlKey)return;e.preventDefault();if(e.shiftKey){this.zoom=clamp(this.zoom*Math.exp(-e.deltaY*.002),1,6);this.draw();}else stepSection(axis,Math.sign(e.deltaY)*(e.altKey?5:1));},{passive:false});
  canvas.addEventListener('dblclick',()=>{this.zoom=1;this.draw();});
  canvas.addEventListener('keydown',e=>{if(!volumeMeta)return;if(e.key==='Enter'||e.key===' '){e.preventDefault();activateSection(axis,true);}if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();stepSection(axis,(e.key==='ArrowUp'||e.key==='ArrowRight'?1:-1)*(e.altKey?5:1));}});
 }
 draw(){
  if(!volumeData||!volumeMeta)return;const c=this.canvas,r=c.getBoundingClientRect();if(r.width<2||r.height<2)return;
  const dpr=Math.min(window.devicePixelRatio||1,2),w=Math.round(r.width*dpr),h=Math.round(r.height*dpr);if(c.width!==w)c.width=w;if(c.height!==h)c.height=h;
  const [nx,ny,nz]=volumeMeta.dimensions,sp=Array.isArray(volumeMeta.spacingUm)?volumeMeta.spacingUm:[volumeMeta.spacingUm,volumeMeta.spacingUm,volumeMeta.spacingUm];
  const axis=this.axis,index=Math.round(slicePositions[axis]*(volumeMeta.dimensions[axis]-1));
  const iw=axis===0?ny:nx,ih=axis===2?ny:nz;const physicalW=(iw-1)*sp[axis===0?1:0],physicalH=(ih-1)*sp[axis===2?1:2];
  const requestedIndex=Math.round(slicePositions[axis]*(sectionCount(axis)-1));
  const detail=currentSectionTexture(this,axis)||residentSections.get(axis,slicePositions[axis],requestedIndex);
  const position=slicePositions[axis],pixelWidth=detail?.width||iw,pixelHeight=detail?.height||ih;
  const spacing=detail?.spacingUm||(Array.isArray(volumeMeta.spacingUm)?volumeMeta.spacingUm[axis]:volumeMeta.spacingUm);
  const native=detail?.spacingUm&&spacing<=donor.fineSpacingUm*1.01&&!detail.resident;
  const refining=cutFaceQuality==='ultra'&&!native&&!ultraFailed;
  setText('sliceDetail'+['X','Y','Z'][axis],`${native?'Ultra':detail&&!detail.resident?'Detailed':'Preview'} · ${spacingLabel(spacing)}${refining?' · Ultra follows':''}`);
  c.setAttribute('aria-busy',String(refining));
  const key=(detail?.key||currentLevel+':'+axis+':'+index)+':'+(appearance?.revision||0);
  if(this.cacheKey!==key){
   let pixels=detail?.data;
   if(!pixels){pixels=new Uint8Array(iw*ih);for(let y=0;y<ih;y++)for(let x=0;x<iw;x++){let off;if(axis===2)off=x+nx*(y+ny*index);else if(axis===1)off=x+nx*(index+ny*y);else off=index+nx*(x+ny*y);pixels[x+iw*y]=volumeData[off];}}
   if(appearance)appearance.paintSection(this.offscreen,pixels,pixelWidth,pixelHeight,axis,position,detail??{width:iw,height:ih});
   else{this.offscreen.width=pixelWidth;this.offscreen.height=pixelHeight;const o=this.offscreen.getContext('2d'),img=o.createImageData(pixelWidth,pixelHeight);for(let i=0;i<pixels.length;i++){img.data[4*i]=img.data[4*i+1]=img.data[4*i+2]=pixels[i];img.data[4*i+3]=255;}o.putImageData(img,0,0);}
   this.cacheKey=key;
  }
  const ctx=c.getContext('2d');ctx.fillStyle='#090d10';ctx.fillRect(0,0,w,h);
  const k=Math.min(w/physicalW,h/physicalH)*this.zoom,dw=physicalW*k,dh=physicalH*k,dx=(w-dw)/2,dy=(h-dh)/2;
  this.box={x:dx,y:dy,w:dw,h:dh};ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  const imageRect=sectionImageRect(detail??{width:iw,height:ih});
  ctx.drawImage(this.offscreen,dx+imageRect.x*dw,dy+imageRect.y*dh,imageRect.width*dw,imageRect.height*dh);
  const px=axis===0?slicePositions[1]:slicePositions[0],py=axis===2?slicePositions[1]:slicePositions[2];
  const colors=['#ed8e7d','#a5c6a3','#8bb8e2'];
  ctx.save();ctx.beginPath();ctx.rect(Math.max(dx,0),Math.max(dy,0),Math.min(dw,w),Math.min(dh,h));ctx.clip();
  ctx.lineWidth=dpr*.8;ctx.setLineDash([5*dpr,4*dpr]);ctx.strokeStyle=colors[axis===0?1:0];ctx.beginPath();ctx.moveTo(dx+px*dw,dy);ctx.lineTo(dx+px*dw,dy+dh);ctx.stroke();ctx.strokeStyle=colors[axis===2?1:2];ctx.beginPath();ctx.moveTo(dx,dy+py*dh);ctx.lineTo(dx+dw,dy+py*dh);ctx.stroke();ctx.restore();
  const tenMm=10000*k;let bar=tenMm,label='10 mm';if(bar>w*.35){bar/=2;label='5 mm';}if(bar<w*.08){bar*=2;label='20 mm';}
  ctx.strokeStyle='rgba(239,240,238,.85)';ctx.lineWidth=dpr;ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(12*dpr,h-15*dpr);ctx.lineTo(12*dpr+bar,h-15*dpr);ctx.stroke();ctx.fillStyle='#d9dddf';ctx.font=`${14*dpr}px system-ui`;ctx.fillText(label,12*dpr,h-22*dpr);
 }
}
async function loadLevel(key,{background=Boolean(volumeData),preview=false,original=cleanupRequested===false}={}){
 const level=manifest.levels[key];if(!level)throw new Error('The requested resolution is unavailable.');
 const token=++volumeLoadToken;loading=true;if(!preview)requestedLevel=key;
 if($('dataQuality'))$('dataQuality').disabled=false;
 try{
  status(original?'Loading original scan…':background?'Refining the whole heart…':'Loading scan data…');
  if(!background)loadingState('Opening the whole heart',preview?'Loading an interactive preview…':'Loading the lossless scan…',3);
  const result=await volumeLoader.load(level,{original,gpuCrop:renderer.backend==='webgl2',acceleration:renderer.backend!=='webgl2',onProgress:progress=>{
   if(token!==volumeLoadToken)return;
   const text=progress.phase==='prepare'?'Preparing smooth interaction…':`${(progress.received/1e6).toFixed(1)} / ${(progress.total/1e6).toFixed(1)} MB · ${displaySpacing(level)} µm`;
   if(background){status(progress.phase==='prepare'?'Preparing detailed view…':`Refining scan · ${text}`);setText('volumeLoadStatus',text);}
   else loadingState('Opening the whole heart',text,Math.min(94,progress.received/progress.total*88));
  }});
  if(token!==volumeLoadToken)return false;const data=result.data;
  await new Promise(resolve=>requestAnimationFrame(resolve));
  if(token!==volumeLoadToken)return false;
  renderer.load(data,level,result.acceleration,result.gpuCrop);volumeData=data;volumeMeta=level;residentSections.setVolume(data,level);volumeOriginal=original||!level.supportCompressed;currentLevel=key;slices.forEach(s=>s.cacheKey='');echoModule?.setVolume(data,level);quickViews?.setVolume(data,level);probeModule?.setVolume(data,level);teeModule?.setVolume(data,level);
  // A completed request follows the latest appearance intent, even if the user
  // changed cleanup or resolution while its worker was still running.
  renderer.set({cleanupEnabled:cleanupRequested||!volumeOriginal});appearance?.changed();
  setText('cleanupStatus',cleanupRequested?'Detached fragments hidden · switch off to compare':volumeOriginal?'Original scan · detached material is visible':'Clean preview · original scan is loading');
  const spacing=Array.isArray(level.spacingUm)?level.spacingUm[0]:level.spacingUm;
  setText('resolutionLabel',`${spacing.toFixed(1)} µm · ${level.dimensions.join(' × ')}${preview?' · preview':''}`);
  setText('specimenLabel',manifest.specimen||'LADAF-2021-17');
  if($('dataQuality'))$('dataQuality').value=preview?(requestedLevel||manifest.defaultLevel):key;
  setSlices(slicePositions);hideLoading();status(preview?'Interactive preview · finer detail follows':'Complete scan loaded');
  setText('volumeLoadStatus',preview?'Interactive preview · loading finer detail next':`${(result.stats.receivedBytes/1e6).toFixed(1)} MB ${volumeOriginal?'original':'lossless clean'} scan loaded`);
  document.body.dataset.scanLoaded='true';document.body.dataset.volumeDimensions=level.dimensions.join('x');
  document.body.dataset.volumeCompressed=String(!volumeOriginal);document.body.dataset.volumeBytes=String(result.stats.receivedBytes);
  // The first preview must have a paint opportunity before optional modules,
  // inventory and detailed-volume preparation compete for its first frame.
  if(!postViewStarted)await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  scanActivity.setViewerReady(true);
  afterFirstUsableView();
  return token===volumeLoadToken;
 }catch(e){
  if(e.name==='AbortError'||token!==volumeLoadToken)return false;
  if(!cleanupRequested&&!volumeOriginal){cleanupRequested=true;renderer.set({cleanupEnabled:true});appearance?.changed();setText('cleanupStatus','Original scan could not load · clean view retained');}
  console.error(e);status('Scan loading needs attention');loadingState('Unable to load this view',e.message,0);
  let retry=$('retryLoad');if(!retry){retry=document.createElement('button');retry.id='retryLoad';retry.textContent='Try Again';retry.className='outlined-button';retry.style.pointerEvents='auto';retry.style.marginTop='16px';$('loading').append(retry);}retry.onclick=()=>loadLevel(key);
  if(volumeData){hideLoading();if($('dataQuality'))$('dataQuality').value=currentLevel;toast(e.message+' The previous resolution is still available.');}
  return false;
 }finally{if(token===volumeLoadToken){loading=false;if($('dataQuality'))$('dataQuality').disabled=false;}}
}
async function setCleanupMode(enabled){
 if(!enabled)cancelCoronaryRestore();
 cleanupRequested=enabled;
 if(enabled||volumeOriginal||!volumeData){renderer.set({cleanupEnabled:enabled});appearance?.changed();setText('cleanupStatus',enabled?'Detached fragments hidden · switch off to compare':'Original scan · detached material is visible');return;}
 // Keep the current clean view until its omitted background has been restored.
 renderer.set({cleanupEnabled:true});appearance?.changed();setText('cleanupStatus','Loading original scan for comparison…');
 // loadLevel owns completion/failure state. An aborted older request must not
 // undo a newer resolution request or a more recent cleanup selection.
 return loadLevel(requestedLevel||currentLevel,{original:true,background:true});
}
function bind(){
 configureDonorUI();
 const viewerMenus=[$('viewMenu'),$('colorMenu')].filter(Boolean);
 const closeViewerMenus=except=>viewerMenus.forEach(menu=>{if(menu!==except)menu.removeAttribute('open');});
 for(const menu of viewerMenus)menu.addEventListener('toggle',()=>{if(menu.open)closeViewerMenus(menu);});
 document.addEventListener('click',event=>{
  if(!event.target.closest?.('.viewer-menu'))closeViewerMenus();
  else if(event.target.closest?.('[data-view],[data-material]')){const menu=event.target.closest('.viewer-menu');closeViewerMenus();menu.querySelector('summary')?.focus();}
 });
 document.addEventListener('keydown',event=>{if(event.key==='Escape'){const menu=viewerMenus.find(item=>item.open);if(menu){closeViewerMenus();menu.querySelector('summary')?.focus();}}});
 $('palette')?.addEventListener('change',()=>{closeViewerMenus();$('colorMenu')?.querySelector('summary')?.focus();});
 document.querySelectorAll('[data-section-expand]').forEach(button=>button.addEventListener('click',()=>{
  const card=button.closest('.slice-card'),grid=card.closest('.slice-grid'),expand=!card.classList.contains('expanded');
  grid.classList.toggle('has-expanded',expand);
  for(const item of grid.querySelectorAll('.slice-card')){
   const expanded=expand&&item===card,control=item.querySelector('[data-section-expand]');item.classList.toggle('expanded',expanded);
   control.setAttribute('aria-expanded',String(expanded));updateSectionExpandLabel(control);
  }
  const axis=['X','Y','Z'].indexOf(button.dataset.sectionExpand);
  if(expand&&activeAxis!==axis)activateSection(axis,true);
  slices.forEach(slice=>slice.draw());
 }));
 document.querySelectorAll('[data-section-step]').forEach(button=>button.addEventListener('click',()=>stepSection(['X','Y','Z'].indexOf(button.dataset.sectionAxis),+button.dataset.sectionStep)));
 const controls={renderMode:v=>({mode:['surface','volume','mip'].indexOf(v)}),palette:v=>({palette:PALETTE_KEYS.indexOf(v)}),threshold:v=>({threshold:+v}),opacity:v=>({opacity:+v}),capContrast:v=>({capContrast:+v}),cutFaceExposure:v=>({cutFaceExposure:+v}),quality:v=>({quality:v}),surfaceSmoothing:v=>renderer.coronaryActive?.()?({coronarySmoothing:+v}):({surfaceSmoothing:+v})};
 for(const[id,fn]of Object.entries(controls))$(id)?.addEventListener('input',()=>{const patch=fn($(id).value);if(id==='threshold'||id==='renderMode')cancelCoronaryRestore();renderer?.set(patch);if(id==='palette'||id==='capContrast'||id==='cutFaceExposure'||id==='threshold'&&renderer.settings.palette>=4)appearance?.changed();syncControls();});
 $('clipAxis')?.addEventListener('change',()=>{const a=['x','y','z'].indexOf($('clipAxis').value);if(a>=0)activateSection(a,true);else{unlinkSection();renderer.set({clipAxis:-1});syncControls();}});
 $('clipPosition')?.addEventListener('input',()=>{if(renderer.settings.clipAxis<0||renderer.settings.clipAxis>2)return;activeAxis=renderer.settings.clipAxis;const p=[...slicePositions];p[activeAxis]=+$('clipPosition').value;renderer.lastInteraction=performance.now();setSlices(p);});
 $('showPlanes')?.addEventListener('change',()=>{renderer?.set({showPlanes:$('showPlanes').checked?1:0});syncControls();});
 $('clipFlip')?.addEventListener('click',()=>{if(quickViews?.active)quickViews.flip();else renderer?.set({clipFlip:1-renderer.settings.clipFlip});syncControls();});
 $('resetView')?.addEventListener('click',()=>{if(currentTab==='probe'||currentTab==='tee'){specializedModule(currentTab).reset();syncControls();toast(currentTab==='tee'?'TEE probe restored':'Probe position restored');return;}if(currentTab==='reconstruction'&&quickViews?.active){void quickViews.reset();syncControls();toast('Starting view restored');return;}if(currentTab==='echo'){renderer.camera.distance=1.55;echoModule.reset();syncControls();toast('Echo reference plane restored');return;}unlinkSection();renderer?.reset();renderer?.set({clipAxis:-1,clipFlip:0,showPlanes:0,threshold:fineSurfaceController?.selectedThreshold??manifest?.defaultThreshold??.30,opacity:.8,mode:0});renderer.autoRotate=false;setSlices([.5,.5,.5]);syncControls();toast('Whole-heart view restored');});
 $('autoRotate')?.addEventListener('click',()=>{renderer.autoRotate=!renderer.autoRotate;renderer.requestRender();syncControls();});
 document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{renderer?.view(b.dataset.view);document.querySelectorAll('[data-view]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b));});}));
 $('presetWhole')?.addEventListener('click',()=>{unlinkSection();renderer?.set({mode:0,clipAxis:-1,threshold:fineSurfaceController?.selectedThreshold??manifest?.defaultThreshold??.30,opacity:.8});syncControls();});
 $('presetCutaway')?.addEventListener('click',()=>{slicePositions[1]=.52;activateSection(1,false);renderer?.set({clipFlip:1,threshold:fineSurfaceController?.selectedThreshold??manifest?.defaultThreshold??.30});renderer?.view('front');setSlices(slicePositions);syncControls();});
 $('presetGlass')?.addEventListener('click',()=>{cancelCoronaryRestore();unlinkSection();renderer?.set({mode:1,clipAxis:-1,threshold:manifest?.defaultThreshold??.30,opacity:.075});syncControls();});
 for(const[i,a]of ['X','Y','Z'].entries()){
  $('sliceRange'+a)?.addEventListener('input',()=>{const value=+$('sliceRange'+a).value;if(activeAxis!==i)activateSection(i,true);const p=[...slicePositions];p[i]=value;renderer.lastInteraction=performance.now();$('slice'+a)?.closest('.slice-card')?.classList.add('browsed');setSlices(p);});
  $('slice'+a)?.closest('.slice-card')?.querySelector('.slice-activate')?.addEventListener('click',()=>activateSection(i,true));
 }
 $('dataQuality')?.addEventListener('change',()=>loadLevel($('dataQuality').value));
 $('cutFaceQuality')?.addEventListener('change',()=>{const next=$('cutFaceQuality').value;cancelUltraLoad(false);cutFaceQuality=next;for(const slice of slices){slice.cacheKey='';slice.draw();}syncUltraControls();updateUltraFocus();if(activeAxis>=0)applySectionCap(slices[activeAxis],activeAxis);refreshUltraCut();queueDetailedSections();});
 $('loadUltra')?.addEventListener('click',()=>loadUltraCut());
 $('aboutButton')?.addEventListener('click',()=>$('aboutDialog').showModal());$('aboutClose')?.addEventListener('click',()=>$('aboutDialog').close());
 $('aboutDialog')?.addEventListener('click',e=>{if(e.target===$('aboutDialog'))$('aboutDialog').close();});
 $('fullscreen')?.addEventListener('click',toggleFullscreen);
 document.addEventListener('fullscreenchange',syncFullscreen);document.addEventListener('webkitfullscreenchange',syncFullscreen);
 $('snapshot')?.addEventListener('click',async()=>{
  if(!renderer?.loaded)return toast('Wait for the scan to finish loading.');
  const src=renderer.snapshot(),img=new Image();img.src=src;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height+82;const ctx=c.getContext('2d');ctx.fillStyle='#11171b';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0);ctx.fillStyle='#ebe7df';ctx.font='12px system-ui';ctx.fillText(`${donor.specimen} · HiP-CT · ${displaySpacing(volumeMeta)} µm volume${renderer.cap?.spacingUm?' / '+renderer.cap.spacingUm.toFixed(1)+' µm cut face':''}`,18,img.height+23,c.width-36);ctx.fillStyle='#a7b1b8';ctx.font='10px system-ui';ctx.fillText(renderer.settings.palette===5?'Approximate anatomical regions · manually guided segmentation':currentTab==='tee'?'TEE lab · measured CT cutaway · modeled esophageal probe':currentTab==='probe'?'TTE Lab · measured CT cutaway · approximate probe position':currentTab==='echo'?'Approximate echo reference anatomy · '+echoModule.state.preset.toUpperCase():'Measured donor scan · windowed display derivative',18,img.height+43,c.width-36);ctx.font='9px system-ui';ctx.fillText(`Data: ESRF Human Organ Atlas · DOI ${donor.doi} · CC BY 4.0`,18,img.height+64,c.width-36);const a=document.createElement('a');a.download=donor.specimen+'-heart-view.png';a.href=c.toDataURL('image/png');a.click();toast('Snapshot saved with source attribution');
 });
 $('shareView')?.addEventListener('click',async()=>{
  if(!renderer)return;const state={donor:donor.id,camera:renderer.camera,settings:renderer.settings,slices:slicePositions,level:currentLevel,module:currentTab,cutFaceQuality,echo:currentTab==='echo'?echoModule?.getState():undefined,quickView:currentTab==='reconstruction'?quickViews?.getState():undefined,probe:currentTab==='probe'?probeModule?.getState():undefined,tee:currentTab==='tee'?teeModule?.getState():undefined};const url=new URL(location.href);url.hash='view='+encodeURIComponent(JSON.stringify(state));history.replaceState(null,'',url);try{await navigator.clipboard.writeText(url.href);toast('Link copied · it preserves this angle and cutaway');}catch{toast('This angle is now saved in the address bar. Copy its URL to share.');}
 });
 $('reconstructionTab')?.addEventListener('click',()=>switchTab('reconstruction'));$('echoTab')?.addEventListener('click',()=>switchTab('echo'));$('probeTab')?.addEventListener('click',()=>switchTab('probe'));$('teeTab')?.addEventListener('click',()=>switchTab('tee'));
 $('sourceDataset')?.setAttribute('href',source);
 $('pauseUltraCollection')?.addEventListener('click',async()=>{await prepareUltra();if($('pauseUltraCollection').dataset.action==='resume')await ultraSource.resumeCollectionDownload?.({allowMetered:true});else ultraSource.pauseCollectionDownload?.(true);syncUltraCacheStatus();});
}
function syncFullscreen(){
 const active=!!(document.fullscreenElement||document.webkitFullscreenElement),button=$('fullscreen');
 button?.setAttribute('aria-pressed',String(active));button?.setAttribute('aria-label',active?'Exit Fullscreen':'Open fullscreen workspace');
 if(button)button.title=active?'Exit Fullscreen':'Fullscreen · heart and CT sections';
 setText('fullscreenLabel',active?'Exit Fullscreen':'Fullscreen');
 renderer?.requestRender();requestAnimationFrame(()=>slices.forEach(slice=>slice.draw()));
}
async function toggleFullscreen(){
 try{
  if(document.fullscreenElement||document.webkitFullscreenElement){
   const exit=document.exitFullscreen||document.webkitExitFullscreen;if(!exit)throw new Error('Unsupported');await exit.call(document);
  }else{
   const target=currentTab==='reconstruction'?$('reconstructionWorkspace'):$(currentTab+'Panel');
   const request=target.requestFullscreen||target.webkitRequestFullscreen;if(!request)throw new Error('Unsupported');await request.call(target);
  }
  syncFullscreen();
 }catch{toast('Full screen is unavailable in this browser.');}
}
function specializedModule(mode){return {echo:echoModule,probe:probeModule,tee:teeModule}[mode];}
function switchTab(mode){
 if(!['reconstruction','echo','probe','tee'].includes(mode))mode='reconstruction';
 if(!renderer?.loaded)return;
 if(mode===currentTab)return;const specialized=mode==='echo'||mode==='probe'||mode==='tee';
 const transition=++tabRevision;
 const coronaryPreference=renderer.settings.coronaryReveal===true;
 renderer.coronaryWorkspace=mode;coronaryControls?.setContext({workspace:mode});
 if(currentTab==='reconstruction')quickViews?.suspend();
 const fullscreen=document.fullscreenElement||document.webkitFullscreenElement;if(fullscreen){const exit=document.exitFullscreen||document.webkitExitFullscreen;if(exit)Promise.resolve(exit.call(document)).catch(()=>{});}
 cancelUltraLoad(false);cancelDetailedSections();ultraSource?.pauseBackground?.(mode!=='reconstruction');
 if(currentTab!=='reconstruction'){
  specializedModule(currentTab)?.leave();viewportHome.prepend($('viewport'));
  if(reconstructionState){const appearanceSettings=Object.fromEntries(['palette','cleanupEnabled','anatomyOpacity','anatomySelected','surfaceSmoothing','coronarySmoothing','cutFaceExposure','windowEnabled','windowLow','windowHigh','windowGamma','capContrast'].map(key=>[key,renderer.settings[key]]));renderer.camera=structuredClone(reconstructionState.camera);renderer.set({...structuredClone(reconstructionState.settings),...appearanceSettings,coronaryReveal:coronaryPreference});activeAxis=reconstructionState.activeAxis;renderer.autoRotate=reconstructionState.autoRotate;appearance?.changed();}
 }
 currentTab=mode;
 renderer.renderProfile=mode==='reconstruction'?'reconstruction':'interactive';
 fineSurfaceController?.setWorkspaceActive(mode==='reconstruction');
 document.querySelectorAll('[data-reconstruction-settings]').forEach(element=>{element.hidden=mode!=='reconstruction'||element.id==='fineSurfaceControls'&&!fineSurfaceController?.select;});
 for(const key of ['reconstruction','echo','probe','tee']){$(key+'Panel').hidden=key!==mode;$(key+'Tab').classList.toggle('active',key===mode);$(key+'Tab').setAttribute('aria-selected',String(key===mode));}
 if(specialized){
  reconstructionState={camera:structuredClone(renderer.camera),settings:structuredClone(renderer.settings),activeAxis,autoRotate:renderer.autoRotate};
  activeAxis=-1;renderer.autoRotate=false;renderer.clearCapData();renderer.camera.distance=1.55;renderer.set({mode:0,threshold:manifest?.defaultThreshold??.32,showPlanes:0});
  if(!specializedModule(mode)){
   const waiting=document.createElement('p');waiting.className='module-loading';waiting.setAttribute('role','status');waiting.textContent=mode==='echo'?'Opening echo windows…':mode==='tee'?'Opening the TEE lab…':'Opening the TTE Lab…';$(mode+'Panel').replaceChildren(waiting);
  }
  const entered=ensureModuleInstance(mode).then(async selected=>{
   if(tabRevision!==transition||currentTab!==mode)return;
   $(mode+'ViewportMount').append($('viewport'));
   await ensureModuleData(mode);
   if(tabRevision===transition&&currentTab===mode){coronaryControls?.sync();const result=await selected.enter();if(tabRevision===transition&&currentTab===mode)void resumeCoronaryRestore();return result;}
  }).catch(error=>{console.warn(error);if(tabRevision===transition&&currentTab===mode){toast(error.message);switchTab('reconstruction');}});
  const descriptions={echo:['Three-dimensional heart cutaway for an approximate echo reference plane. Drag to orbit; scroll to zoom.','Echo windows · fine CT sections and reference ultrasound'],probe:['Three-dimensional heart with an adjustable ultrasound probe and scan sector. Drag to orbit and scroll to zoom. Keyboard controls steer the probe; mouse steering is optional.','TTE Lab · CT-derived ultrasound simulation'],tee:['Three-dimensional heart with a controllable transesophageal probe and linked CT scan plane. Use insertion, rotation, flexion and multiplane controls.','TEE lab · CT-derived ultrasound simulation']};
  $('volumeCanvas').setAttribute('aria-label',descriptions[mode][0]);status(descriptions[mode][1]);return entered;
 }else{
  void quickViews?.resume();updateUltraFocus();syncControls();void resumeCoronaryRestore();renderer?.requestRender();slices.forEach(s=>s.draw());refreshUltraCut();queueDetailedSections();status('Complete scan loaded');
 }
}
function restore(){
 try{if(!location.hash.startsWith('#view='))return;const v=JSON.parse(decodeURIComponent(location.hash.slice(6)));if(v.donor&&v.donor!==donor.id)return;
  if(manifest.levels[v.level])restoredLevel=v.level;
  cutFaceQuality=v.cutFaceQuality==='detail'?'detail':'ultra';
  if(v.camera){const c=v.camera;if(Number.isFinite(c.yaw)&&Number.isFinite(c.pitch)&&Number.isFinite(c.distance))renderer.camera={yaw:c.yaw,pitch:clamp(c.pitch,-Math.PI/2,Math.PI/2),roll:Number.isFinite(c.roll)?c.roll:Math.PI,distance:clamp(c.distance,.34,5),pan:Array.isArray(c.pan)&&c.pan.length===3?c.pan.map(x=>clamp(Number(x)||0,-2,2)):[0,0,0]};}
  if(v.settings){const s=v.settings;restoredCoronary=s.coronaryReveal===true;const safe={};for(const[k,min,max]of[['mode',0,2],['palette',0,6],['threshold',0,1],['opacity',0,2],['clipAxis',-1,2],['clipPosition',0,1],['clipFlip',0,1],['showPlanes',0,1],['capContrast',.5,3],['cutFaceExposure',.5,3],['windowLow',0,.995],['windowHigh',.005,1],['windowGamma',.5,2.5],['anatomyOpacity',.15,1],['anatomySelected',0,15],['surfaceSmoothing',0,2],['coronarySmoothing',0,2]])if(Number.isFinite(s[k])&&(!['echo','flow','probe','tee'].includes(v.module)||!['clipAxis','clipPosition','clipFlip'].includes(k)))safe[k]=clamp(s[k],min,max);if(typeof s.cleanupEnabled==='boolean')safe.cleanupEnabled=s.cleanupEnabled;if(typeof s.windowEnabled==='boolean')safe.windowEnabled=s.windowEnabled;if((safe.windowLow??renderer.settings.windowLow??0)>=(safe.windowHigh??renderer.settings.windowHigh??1)-.005){delete safe.windowLow;delete safe.windowHigh;}renderer.set(safe);if(!['echo','flow','probe','tee'].includes(v.module)&&safe.clipAxis>=0)activeAxis=safe.clipAxis;}
  if(v.module==='echo'&&v.echo){restoredEcho=v.echo;restoredEchoCamera=structuredClone(renderer.camera);}
  if(v.module==='flow'&&v.flow)restoredQuickView=v.flow;
  else if(v.module==='reconstruction'&&v.quickView)restoredQuickView=v.quickView;
  if(v.module==='probe'&&v.probe){restoredProbe=v.probe;restoredProbeCamera=structuredClone(renderer.camera);}
  if(v.module==='tee'&&v.tee){restoredTee=v.tee;restoredTeeCamera=structuredClone(renderer.camera);}
  if(v.slices?.length===3)slicePositions=v.slices.map(x=>clamp(Number(x)||0,0,1));if(activeAxis>=0)slicePositions[activeAxis]=renderer.settings.clipPosition;renderer.set({slices:slicePositions});
 }catch{toast('The saved view could not be read. Showing the whole heart.');}
}
async function requestScanManifest(url){
 const abort=new AbortController();let timer;
 const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{const error=new Error('The scan metadata did not respond. Reload to retry the connection.');abort.abort(error);reject(error);},30000);});
 try{return await Promise.race([fetch(url,{priority:'high',signal:abort.signal}).then(response=>{if(!response.ok)throw new Error('The scan manifest is unavailable.');return response.json();}),timeout]);}
 finally{clearTimeout(timer);abort.abort();}
}
async function main(){
 if(donor.ready===false){
  document.body.dataset.donor=donor.id;
  setText('specimenLabel',donor.specimen);
  $('sourceDataset')?.setAttribute('href',donor.datasetUrl);
  $('aboutDatasetLink')?.setAttribute('href',donor.datasetUrl);
  loadingState('Dataset not included',donor.unavailableReason,0);
  $('loadProgress')?.setAttribute('hidden','');
  status('Dataset not included · see asset setup');
  return;
 }
 if(donor.kind==='clinical'){
  try{const {bootClinicalPilot}=await import('./clinical-app.js');await bootClinicalPilot(donor,{sources:ALL_SOURCES});}
  catch(error){loadingState('The clinical pilot could not start',error.message+' Reload to retry.',0);status('Clinical source unavailable');}
  return;
 }
 scanActivity.setViewerReady(false);bind();
 try{
  // The small source manifest and first volume are the only startup data path.
  const manifestRequest=requestScanManifest(donor.manifestUrl);manifestRequest.catch(()=>{});
  const onRendererChange=evt=>{if(evt.error){status(evt.error);toast(evt.error);}probeModule?.onRendererChange?.(evt);teeModule?.onRendererChange?.(evt);};
  try{renderer=new VolumeRenderer($('volumeCanvas'),onRendererChange);renderer.backend='webgl2';}catch(error){
   console.info('Using software volume rendering:',error.message);const {CPUVolumeRenderer}=await loadWorkbenchModule('cpu');
   // A canvas already claimed by WebGL cannot provide a 2D context after a
   // shader/driver failure. Preserve its DOM attributes on a fresh canvas.
   const previous=$('volumeCanvas'),canvas=previous.cloneNode(false);previous.replaceWith(canvas);
   renderer=new CPUVolumeRenderer(canvas,onRendererChange);
  }
  renderer.renderProfile='reconstruction';renderer.donorId=donor.id;renderer.coronaryWorkspace='reconstruction';
  renderer.set({...donor.displayWindow});
  appearance=new AppearanceController({renderer,toast,donor,onCleanupChange:setCleanupMode,onChange:()=>{scheduleSectionDraw();echoModule?.updateAppearance();quickViews?.updateAppearance();probeModule?.updateAppearance();teeModule?.updateAppearance();syncControls();if(currentTab==='reconstruction')queueDetailedSections();}});
  slices=['X','Y','Z'].map((a,i)=>new SliceView($('slice'+a),i));
  manifest=await manifestRequest;
  if(manifest.specimen!==donor.specimen)throw new Error('The scan does not match the selected donor.');
  appearance.setWindowProfile({...manifest.displayWindow,...donor.displayWindow});
  renderer.set({threshold:manifest.defaultThreshold??.30});restore();cleanupRequested=renderer.settings.cleanupEnabled!==false;
  if(donor.anatomyManifestUrl===null&&renderer.settings.palette===5)renderer.set({palette:4,anatomySelected:0});
  setText('sourceCitation',`${manifest.attribution||'Human Organ Atlas Collaboration / ESRF'}. ${manifest.title}. DOI: ${donor.doi}. Licensed ${manifest.license||'CC BY 4.0'}.`);
  setText('datasetDetails',(manifest.processingSummary||'A complete-organ scan, downsampled for interactive display.')+' Surface smoothing changes the shading normals; cut faces retain the measured display values. '+sectionNaming.note+' Each donor has its own scale, cleanup and texture data.');
  setText('aboutScanIntro',`${donor.specimen}: ${donor.age}; ${manifest.donorSex||donor.sex||'male'}. Atlas medical history: ${manifest.donorMedicalInfo||donor.medicalInfo}. The full-resolution source is ${spacingLabel(donor.nativeSpacingUm)}. Whole-organ views use compact, lossless display volumes; Ultra cutaways use ${spacingLabel(donor.fineSpacingUm)} scan data. The first usable view loads before background preparation begins. Current slices, interactions and active modules take priority. Background downloads resume during quiet periods and can be paused at any time.`);
  const q=$('dataQuality');if(q){q.replaceChildren();for(const[k,v]of Object.entries(manifest.levels)){const opt=document.createElement('option');opt.value=k;opt.textContent=titleCaseUi(v.label)||`${v.spacingUm} µm`;q.append(opt);}}
  syncControls();const target=restoredLevel||manifest.defaultLevel||Object.keys(manifest.levels)[0];requestedLevel=target;
  const firstLevel=!restoredLevel&&manifest.previewLevel&&cleanupRequested?manifest.previewLevel:target;
  const restoreRevision=tabRevision;
  const firstReady=await loadLevel(firstLevel,{preview:firstLevel!==target,background:false});
  if(!firstReady)return;
  if(firstLevel!==target&&requestedLevel===target)await loadLevel(target,{background:true});
  coronaryRestoreReady=true;
  if(tabRevision!==restoreRevision){void resumeCoronaryRestore();return;}
  const saved=[['echo',restoredEcho,restoredEchoCamera],['probe',restoredProbe,restoredProbeCamera],['tee',restoredTee,restoredTeeCamera]].find(item=>item[1]);
  if(restoredQuickView&&!saved&&currentTab==='reconstruction'){
   const views=await ensureModuleInstance('quick');
   if(tabRevision===restoreRevision&&currentTab==='reconstruction')await views.restore(restoredQuickView,{preserveCamera:true});
  }
  if(saved){
   const [mode,state,camera]=saved;await ensureModuleData(mode);
   if(tabRevision!==restoreRevision)return;
   specializedModule(mode).restore(state);const entering=switchTab(mode),expectedTransition=tabRevision;
   await entering;
   if(tabRevision===expectedTransition&&currentTab===mode&&camera){renderer.camera=camera;renderer.requestRender();}
  }
  await resumeCoronaryRestore();
 }catch(e){console.error(e);loadingState('The 3D view could not start',e.message+' Reload to retry, or check the source dataset in About.',0);status('The scan could not finish loading');}
}
main();
