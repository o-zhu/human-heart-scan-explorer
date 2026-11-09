import {VolumeRenderer} from './renderer.js';
import {AppearanceController,PALETTE_KEYS} from './appearance.js';
import {ResidentSectionSource} from './resident-sections.js';
import {orthogonalFrame} from './planes.js';
import {ClinicalFrameStore,validateClinicalManifest,snapSectionPosition} from './clinical-data.js';
import {donorUrl} from './donors.js';
import {sectionNamingFor,sectionLabel,linkedSectionText,applySectionNames,updateSectionExpandLabel} from './section-names.js';
import {titleCaseUi} from './ui-text.js';

const $=id=>document.getElementById(id),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const setText=(id,value)=>{if($(id))$(id).textContent=value;};
const spacingText=spacing=>spacing.map(v=>Number(v.toFixed(3))).join(' × ')+' mm';
function el(tag,text,className){const node=document.createElement(tag);if(text!=null)node.textContent=text;if(className)node.className=className;return node;}

function sequenceControls(prefix){
 const node=el('div',null,'clinical-cine-controls');
 node.innerHTML=`<button id="${prefix}Play" type="button" class="outlined-button" aria-pressed="false">Play Phases</button><input id="${prefix}Phase" type="range" min="0" max="0" step="1" value="0" aria-label="Measured phase"><output id="${prefix}PhaseLabel" for="${prefix}Phase">Loading phase</output><label class="clinical-speed">Display Rate<select id="${prefix}Rate" aria-label="Playback display rate"><option value="4">4 fps</option><option value="8" selected>8 fps</option><option value="12">12 fps</option></select></label>`;
 return node;
}

/** Display transforms preserve the measured raster, physical aspect and scale bar. */
export function drawPhysicalSection(canvas,image,spacing,{flipY=false,halfTurn=false,plain=false}={}){
 const rect=canvas.getBoundingClientRect(),ratio=Math.min(globalThis.devicePixelRatio||1,2);
 const width=Math.max(2,Math.round(rect.width*ratio)),height=Math.max(2,Math.round(rect.height*ratio));
 if(canvas.width!==width)canvas.width=width;if(canvas.height!==height)canvas.height=height;
 const ctx=canvas.getContext('2d');ctx.fillStyle='#030607';ctx.fillRect(0,0,width,height);
 const physicalWidth=(image.width-1)*spacing[0],physicalHeight=(image.height-1)*spacing[1];
 const factor=Math.min((width-20*ratio)/physicalWidth,(height-20*ratio)/physicalHeight);
 const drawWidth=physicalWidth*factor,drawHeight=physicalHeight*factor,left=(width-drawWidth)/2,top=(height-drawHeight)/2;
 ctx.imageSmoothingEnabled=true;ctx.save();
 if(halfTurn){ctx.translate(width,height);ctx.scale(-1,-1);}
 if(flipY){ctx.translate(0,height);ctx.scale(1,-1);}
 ctx.drawImage(image,left,top,drawWidth,drawHeight);ctx.restore();
 if(!plain&&factor>0){
  const mm=physicalWidth<80?10:20,length=mm*factor;ctx.strokeStyle='#d4dfdc';ctx.lineWidth=ratio;
  ctx.beginPath();ctx.moveTo(14*ratio,height-17*ratio);ctx.lineTo(14*ratio+length,height-17*ratio);ctx.stroke();
  ctx.font=14*ratio+'px sans-serif';ctx.fillStyle='#b0bfbe';ctx.fillText(mm+' mm',14*ratio,height-23*ratio);
 }
 return {left,top,width:drawWidth,height:drawHeight};
}

export async function bootClinicalPilot(source,{sources}){
 const isSlicerHeart=source.id==='slicerheart-4d';
 let saved;try{if(location.hash.startsWith('#clinical='))saved=JSON.parse(decodeURIComponent(location.hash.slice(10)));}catch{}
 let sectionNaming=sectionNamingFor({source});applySectionNames(document,sectionNaming);
 document.body.dataset.clinical='true';document.body.dataset.donor=source.id;
 const stylesheet=el('link');stylesheet.rel='stylesheet';stylesheet.href='./clinical.css';document.head.append(stylesheet);
 document.querySelector('.donor-bar').setAttribute('aria-label','Imaging source');
 document.querySelector('.brand').setAttribute('aria-label','Heart Explorer clinical imaging');
 document.title=source.specimen+' · Heart Explorer';
 $('probeTab').hidden=true;if($('teeTab'))$('teeTab').hidden=true;$('scanDownloadBar').hidden=true;
 $('echoTab').hidden=true;$('fineSurfaceControls').hidden=true;
 setText('loadTitle','Opening the clinical pilot');setText('loadDetail','The selected measured volume loads first.');
 document.querySelector('.loader-caption').textContent='MEASURED CARDIAC IMAGING';
 document.querySelector('.topbar-context').textContent='IN VIVO / MEASURED MOTION';
 setText('specimenLabel',source.specimen);
 setText('presetWhole','Whole Volume');setText('resetWindow','Reset series window');
 $('reconstructionWorkspace').setAttribute('aria-label','Clinical volume and linked source sections');
 $('fullscreen').title='Fullscreen · volume and linked sections';
 document.querySelector('.statusbar-right>span:last-child').textContent=source.id==='cmac-case-1'?'CARDIAC ATLAS PROJECT':'SLICERHEART';
 setText('windowDescription','Display window for this acquired series. Source intensity values and the ultrasound comparison remain independent.');
 for(const id of ['cleanupEnabled','anatomyToggle'])$(id).closest('.control-section').hidden=true;
 $('cutFaceQuality').closest('.control-row').hidden=true;$('ultraControls').hidden=true;
 $('dataQuality').closest('.control-row').hidden=true;
 document.querySelector('.source-note-mark').textContent='IN VIVO';
 $('sourceDataset').href=source.datasetUrl;
 const bar=el('section',null,'clinical-series-bar');bar.setAttribute('aria-label','Clinical series and cardiac phases');
 bar.innerHTML='<div class="clinical-series-heading"><label for="clinicalSeries">Acquired Series</label><select id="clinicalSeries" aria-label="Choose an acquired series"></select></div><details class="clinical-scan-details"><summary>Scan Details</summary><p id="clinicalSampling"></p><p id="clinicalSeriesNote" class="clinical-series-note"></p></details>';
 bar.append(sequenceControls('clinical'));
 if(isSlicerHeart){
  // Clinical controls share the section rail's height, including in fullscreen.
  // Keep the preserved-heart workspace and cMAC's paired-view tabs independent.
  document.querySelector('.workspace-tabs').hidden=true;
  document.querySelector('.sections-panel').prepend(bar);
  bar.querySelector('.clinical-series-heading label').classList.add('screen-reader-only');
  const rate=$('clinicalRate').closest('label');rate.firstChild.textContent='';
  rate.title='Playback display rate';
  const details=bar.querySelector('.clinical-scan-details');
  details.querySelector('summary').textContent='Scan Details';
  details.addEventListener('keydown',event=>{if(event.key==='Escape'){details.open=false;details.querySelector('summary').focus();}});
  document.addEventListener('pointerdown',event=>{if(details.open&&!details.contains(event.target))details.open=false;});
 }else $('reconstructionPanel').before(bar);
 const request=await fetch(source.manifestUrl,{priority:'high'});if(!request.ok)throw new Error('The pilot data manifest is unavailable.');
 const manifest=validateClinicalManifest(await request.json());
 setText('status','Opening the selected acquired series');
 const seriesSelect=$('clinicalSeries');for(const series of manifest.series){const option=el('option',titleCaseUi(series.label));option.value=series.id;seriesSelect.append(option);}
 let renderer;
 try{renderer=new VolumeRenderer($('volumeCanvas'),event=>{if(event.error)setText('status',event.error);});}
 catch{const {CPUVolumeRenderer}=await import('./cpu-renderer.js');renderer=new CPUVolumeRenderer($('volumeCanvas'),()=>{});}
 const native=new ResidentSectionSource(),store=new ClinicalFrameStore(),scratch=['X','Y','Z'].map(()=>document.createElement('canvas'));
 let currentSeries,currentFrame=0,positions=[.5,.5,.5],activeAxis=2,frameRevision=0,seriesRevision=0,playing=false,playTimer,warmTimer,drawFrame=0;
 let sourceData,appearance,echoView=null,pairRevision=0;
 let playbackRequested=saved?saved.playing===true:isSlicerHeart,playGeneration=0;
 const sourceProfile={...source,anatomyManifestUrl:null,cleanupManifestUrl:null,displayWindow:{windowEnabled:true,windowLow:0,windowHigh:1,windowGamma:1,capContrast:1,cutFaceExposure:1}};
 appearance=new AppearanceController({renderer,donor:sourceProfile,onChange:()=>{queueSections();syncWindowLabels();},toast:message=>setText('status',message)});
 renderer.set({cleanupEnabled:false,palette:4,surfaceSmoothing:1,quality:'auto'});
 $('cleanupEnabled').disabled=true;

 function syncWindowLabels(){
  setText('windowDonor',`${source.specimen} · ${currentSeries?.label||'source display'}`);
  if(currentSeries)setText('materialDescription',`${currentSeries.modality} intensity display. Surface thresholds do not constitute anatomical segmentation.`);
 }
 function queueSections(){if(!drawFrame)drawFrame=requestAnimationFrame(()=>{drawFrame=0;paintSections();});}
 function syncSections(){
  if(!currentSeries)return;
  for(const [axis,a]of ['X','Y','Z'].entries()){
   const n=currentSeries.dimensions[axis],index=Math.round(positions[axis]*(n-1));
   $('sliceRange'+a).step=1/(n-1);$('sliceRange'+a).value=positions[axis];
   $('sliceRange'+a).setAttribute('aria-valuetext',`${sectionLabel(sectionNaming,axis)} ${index+1} of ${n}`);
   setText('sliceIndex'+a,`Section ${index+1} / ${n}`);setText('sliceReadout'+a,(index*currentSeries.spacingMm[axis]).toFixed(1)+' mm');
   setText('sliceDetail'+a,(currentSeries.spatialResampling||currentSeries.isOverview||currentSeries.id==='overview'?'Overview':'Stored grid')+' · '+spacingText(currentSeries.spacingMm));
   const card=$('slice'+a).closest('.slice-card');card.classList.toggle('linked',activeAxis===axis);card.querySelector('.slice-activate').setAttribute('aria-pressed',String(activeAxis===axis));
   document.querySelectorAll(`[data-section-axis="${a}"][data-section-step]`).forEach(button=>{button.disabled=+button.dataset.sectionStep<0?index===0:index===n-1;});
  }
  setText('sectionSyncStatus',activeAxis<0?'Choose a section to reveal the interior':linkedSectionText(sectionNaming,activeAxis));
  $('volumeCanvas').setAttribute('aria-label',activeAxis<0?'3D acquired cardiac volume. Drag to orbit; scroll to zoom.':'3D acquired cardiac cutaway linked to the '+sectionLabel(sectionNaming,activeAxis)+'. Drag to orbit; scroll to zoom.');
  $('clipAxis').value=activeAxis<0?'none':['x','y','z'][activeAxis];$('clipPosition').value=positions[Math.max(0,activeAxis)];
  setText('clipValue',Math.round(positions[Math.max(0,activeAxis)]*100)+'%');
 }
 function paintSections(){
  if(!sourceData||!currentSeries)return;
  for(const [axis,a]of ['X','Y','Z'].entries()){
   const section=native.get(axis,positions[axis]);
   appearance.paintSection(scratch[axis],section.data,section.width,section.height,axis,positions[axis],section);
   drawPhysicalSection($('slice'+a),scratch[axis],section.inPlaneSpacingUm.map(v=>v/1000),{flipY:axis!==2&&currentSeries.defaultSlice?.flipVertical,halfTurn:isSlicerHeart&&axis!==2});
  }
 }
 function applyPlane(axis,align=false){
  if(!renderer.loaded||!currentSeries)return;activeAxis=axis;
  positions[axis]=snapSectionPosition(positions[axis],currentSeries.dimensions[axis]);
  const flip=axis!==2&&currentSeries.defaultSlice?.flipVertical;
  renderer.clearCapData();renderer.set({mode:0,clipAxis:axis,clipPosition:positions[axis],clipFlip:flip?1-[1,0,1][axis]:[1,0,1][axis],oblique:null,slices:positions});
  if(align){
   const p=orthogonalFrame(axis,positions[axis],renderer.extent),up=flip?p.up.map(v=>-v):p.up;
   // SlicerHeart source +Z is superior. Rotate only the display basis by 180°,
   // matching the CT card without moving the physical cut or its retained half.
   renderer.alignPlane(flip?p.normal.map(v=>-v):p.normal,isSlicerHeart&&axis!==2?up.map(v=>-v):up,p.center,{followScene:true});
  }
  syncSections();syncModes();queueSections();
 }
 function step(axis,delta){
  if(!currentSeries||!renderer.loaded||!delta)return;
  positions[axis]=clamp(positions[axis]+delta/(currentSeries.dimensions[axis]-1),0,1);
  applyPlane(axis,activeAxis!==axis);$('slice'+['X','Y','Z'][axis]).closest('.slice-card').classList.add('browsed');
 }
 function syncModes(){
  const s=renderer.settings,id=s.clipAxis>=0?'presetCutaway':s.mode===1?'presetGlass':'presetWhole';
  for(const key of ['presetWhole','presetCutaway','presetGlass']){$(key).classList.toggle('active',key===id);$(key).setAttribute('aria-pressed',String(key===id));}
  $('renderMode').value=['surface','volume','mip'][s.mode];$('threshold').value=s.threshold;setText('thresholdValue',Math.round(s.threshold*100)+'%');
  $('opacity').value=s.opacity;setText('opacityValue',Math.round(s.opacity*100)+'%');$('quality').value=s.quality;
  $('clipAxis').value=s.clipAxis>=0?['x','y','z'][s.clipAxis]:'none';$('clipPosition').value=s.clipPosition;setText('clipValue',Math.round(s.clipPosition*100)+'%');
  $('showPlanes').checked=!!s.showPlanes;
 }
 function stop({preserveRequest=false}={}){
  if(playing){frameRevision++;$('clinicalPhase').value=currentFrame;}
  playing=false;playGeneration++;clearTimeout(playTimer);playTimer=null;
  if(!preserveRequest)playbackRequested=false;
  $('clinicalPlay').textContent='Play Phases';$('clinicalPlay').setAttribute('aria-pressed','false');
 }
 function startPlayback({immediate=false}={}){
  playbackRequested=true;
  if(playing||!currentSeries||currentSeries.frames.length<2)return;
  playing=true;const generation=++playGeneration;
  $('clinicalPlay').textContent='Pause';$('clinicalPlay').setAttribute('aria-pressed','true');
  if(immediate)void playStep(generation);
  else playTimer=setTimeout(()=>playStep(generation),1000/Number($('clinicalRate').value));
 }
 async function showFrame(index){
  if(!currentSeries)return false;const series=currentSeries,revision=++frameRevision;
  index=clamp(Math.round(index),0,series.frames.length-1);$('clinicalPhase').value=index;
  setText('status',store.cached(series.frames[index])?'Displaying measured phase':'Loading measured phase '+(index+1)+'; current view remains available');
  try{
   const data=await store.load(series.frames[index]);
   if(revision!==frameRevision||series!==currentSeries)return false;
   const meta={dimensions:series.dimensions,spacingUm:series.spacingMm.map(v=>v*1000)};
   renderer.load(data,meta);sourceData=data;native.setVolume(data,meta);currentFrame=index;
   if(activeAxis>=0)renderer.set({clipAxis:activeAxis,clipPosition:positions[activeAxis],slices:positions});
   const record=series.frames[index];
   setText('clinicalPhaseLabel',series.frames.length===1?'Static acquired volume':`Phase ${index+1} / ${series.frames.length}${record.phaseLabel?' · '+record.phaseLabel:''}`);
   $('clinicalPhase').setAttribute('aria-valuetext',`Displayed measured phase ${index+1} of ${series.frames.length}`);
   setText('resolutionLabel',spacingText(series.spacingMm)+' · '+series.dimensions.join(' × '));
   setText('capDetailStatus','Measured '+series.modality+' sections · '+spacingText(series.spacingMm)+' stored grid');
   $('loading').hidden=true;syncSections();queueSections();
   setText('status',`${series.label} · ${series.frames.length>1?'measured phase '+(index+1):'static scan'} · ${spacingText(series.spacingMm)}`);
   clearTimeout(warmTimer);warmTimer=setTimeout(()=>{if(series===currentSeries)store.warm(series,index);},600);
   return true;
  }catch(error){if(revision===frameRevision&&error.name!=='AbortError'){stop();setText('status',error.message+' Move the phase slider to retry.');if(!sourceData)throw error;}return false;}
 }
 async function playStep(generation){
  if(!playing||generation!==playGeneration)return;
  const series=currentSeries,count=series.playbackFrameCount||series.frames.length,next=(currentFrame+1)%count;
  await showFrame(next);
  if(playing&&generation===playGeneration&&series===currentSeries)playTimer=setTimeout(()=>playStep(generation),1000/Number($('clinicalRate').value));
 }
 async function chooseSeries(id,{restore=false,autoplay=true}={}){
  stop({preserveRequest:isSlicerHeart||!currentSeries});clearTimeout(warmTimer);frameRevision++;const token=++seriesRevision;
  const next=manifest.series.find(s=>s.id===id);if(!next)throw new Error('The requested measured series is unavailable.');
  if(next.modality==='US'&&echoView&&!echoView.node.hidden)closePairedEcho();
  const previous=currentSeries;seriesSelect.value=id;
  $('clinicalPhase').disabled=true;$('clinicalPlay').disabled=true;$('clinicalRate').disabled=true;
  setText('status','Opening '+next.label+'; the current source remains visible until ready');
  try{await store.load(next.frames[next.defaultFrame??0]);}
  catch(error){
   if(token!==seriesRevision||error.name==='AbortError')return;
   if(!previous)throw error;
   seriesSelect.value=previous.id;$('clinicalPhase').disabled=previous.frames.length===1;$('clinicalPlay').disabled=previous.frames.length===1;$('clinicalRate').disabled=previous.frames.length===1;
   setText('status',error.message+' The previous series remains available. Select the series again to retry.');if(autoplay&&playbackRequested)startPlayback();return;
  }
  if(token!==seriesRevision)return;
  currentSeries=next;sectionNaming=sectionNamingFor({source,series:next});applySectionNames(document,sectionNaming);
  sourceProfile.sourceWindow=next.sourceWindow;sourceProfile.displayWindow=next.displayWindow;appearance.donor=sourceProfile;appearance.setWindowProfile(next.displayWindow);
  renderer.set({mode:0,threshold:next.defaultThreshold??.2,palette:next.modality==='US'?2:4,cleanupEnabled:false});
  if(!restore){positions=[.5,.5,.5];const start=next.defaultSlice||{axis:2,position:.5};positions[start.axis]=start.position;activeAxis=isSlicerHeart?-1:start.axis;positions=positions.map((p,i)=>snapSectionPosition(p,next.dimensions[i]));resetCamera();}
  appearance.sync();
  renderer.clearCapData();$('clinicalPhase').max=next.frames.length-1;$('clinicalPhase').disabled=next.frames.length===1;
  $('clinicalPlay').disabled=next.frames.length===1;$('clinicalRate').disabled=next.frames.length===1;
  setText('clinicalSampling',next.samplingDescription||spacingText(next.spacingMm)+' stored grid');
  setText('clinicalSeriesNote',(next.phaseDescription||next.description||'')+' '+(next.notes?.[0]||'')+(next.frames.length>1?' Playback rate controls viewing speed.':''));
  setText('sectionsTitle',next.modality+' Sections');
  document.querySelector('.viewport-heading>p').textContent=next.modality+' intensity surface · measured source data';
  setText('volumeLoadStatus','Only the selected series and a small phase neighborhood prepare automatically.');
  syncWindowLabels();
  const ready=await showFrame(next.defaultFrame??0);
  if(token!==seriesRevision||!ready)return;
  if(!restore&&activeAxis>=0)applyPlane(activeAxis,true);
  if(previous&&previous.id!==next.id)echoView?.setReference(next);
  syncModes();
  if(autoplay&&playbackRequested)startPlayback();
 }
 function resetCamera(){renderer.reset();renderer.camera.distance=currentSeries?.defaultCameraDistance??1.65;renderer.requestRender('camera');}
 if(isSlicerHeart){
  const resetRenderer=renderer.reset.bind(renderer);
  // Source +Z (superior) maps to renderer +Y. Zero roll keeps this direction upright.
  // The instance hook also covers the renderer's double-click and keyboard resets.
  renderer.reset=()=>{resetRenderer();renderer.camera.yaw=1.15;renderer.camera.roll=0;renderer.camera.distance=currentSeries?.defaultCameraDistance??1.65;activeAxis=-1;renderer.set({mode:0,clipAxis:-1,oblique:null});syncModes();syncSections();renderer.requestRender('camera');};
 }

 for(const [axis,a]of ['X','Y','Z'].entries()){
  const canvas=$('slice'+a);canvas.setAttribute('aria-label',`${sectionLabel(sectionNaming,axis)}. Scroll to move the 3D cutaway, or use arrow keys. Enter faces this section.`);
  canvas.addEventListener('wheel',event=>{if(!event.deltaY||event.ctrlKey)return;event.preventDefault();step(axis,Math.sign(event.deltaY)*(event.altKey?5:1));},{passive:false});
  canvas.addEventListener('click',()=>applyPlane(axis,true));
  canvas.addEventListener('keydown',event=>{if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter'].includes(event.key)){event.preventDefault();event.key==='Enter'?applyPlane(axis,true):step(axis,['ArrowUp','ArrowRight'].includes(event.key)?1:-1);}});
  let pointerY;
  canvas.addEventListener('pointerdown',event=>{pointerY=event.clientY;if(event.pointerType==='touch')canvas.setPointerCapture(event.pointerId);});
  canvas.addEventListener('pointermove',event=>{if(event.pointerType!=='touch'||pointerY==null)return;const d=event.clientY-pointerY;if(Math.abs(d)>9){step(axis,-Math.sign(d));pointerY=event.clientY;}});
  canvas.addEventListener('pointerup',()=>{pointerY=null;});canvas.addEventListener('pointercancel',()=>{pointerY=null;});
  $('sliceRange'+a).addEventListener('input',()=>{positions[axis]=Number($('sliceRange'+a).value);applyPlane(axis,activeAxis!==axis);canvas.closest('.slice-card').classList.add('browsed');});
  canvas.closest('.slice-card').querySelector('.slice-activate').addEventListener('click',()=>applyPlane(axis,true));
 }
 document.querySelectorAll('[data-section-step]').forEach(button=>button.addEventListener('click',()=>step(['X','Y','Z'].indexOf(button.dataset.sectionAxis),Number(button.dataset.sectionStep))));
 document.querySelectorAll('[data-section-expand]').forEach(button=>button.addEventListener('click',()=>{const card=button.closest('.slice-card'),expanded=!card.classList.contains('expanded');document.querySelectorAll('.slice-card').forEach(node=>node.classList.remove('expanded'));card.classList.toggle('expanded',expanded);document.querySelector('.slice-grid').classList.toggle('has-expanded',expanded);document.querySelectorAll('[data-section-expand]').forEach(b=>{b.setAttribute('aria-expanded',String(expanded&&b===button));updateSectionExpandLabel(b);});const axis=['X','Y','Z'].indexOf(button.dataset.sectionExpand);if(expanded&&activeAxis!==axis)applyPlane(axis,true);queueSections();}));
 $('clinicalPhase').addEventListener('input',()=>{const index=Number($('clinicalPhase').value);stop();void showFrame(index);});
 $('clinicalPlay').addEventListener('click',()=>{if(playing){stop();return;}startPlayback({immediate:true});});
 seriesSelect.addEventListener('change',()=>void chooseSeries(seriesSelect.value));
 document.addEventListener('visibilitychange',()=>{if(document.hidden){stop();echoView?.stop();}});
 document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>renderer.view(button.dataset.view)));
 $('presetWhole').addEventListener('click',()=>{if(isSlicerHeart){resetCamera();return;}activeAxis=-1;renderer.set({mode:0,clipAxis:-1});syncModes();syncSections();});
 $('presetCutaway').addEventListener('click',()=>applyPlane(1,true));
 $('presetGlass').addEventListener('click',()=>{activeAxis=-1;renderer.set({mode:1,clipAxis:-1,opacity:.065});syncModes();syncSections();});
 $('resetView').addEventListener('click',resetCamera);
 $('autoRotate').addEventListener('click',()=>{renderer.autoRotate=!renderer.autoRotate;$('autoRotate').setAttribute('aria-pressed',String(renderer.autoRotate));renderer.requestRender('camera');});
 for(const [id,key]of [['threshold','threshold'],['opacity','opacity'],['capContrast','capContrast'],['cutFaceExposure','cutFaceExposure'],['surfaceSmoothing','surfaceSmoothing']])$(id).addEventListener('input',()=>{renderer.set({[key]:Number($(id).value)});appearance.changed();syncModes();});
 $('palette').addEventListener('change',()=>{renderer.set({palette:PALETTE_KEYS.indexOf($('palette').value)});appearance.changed();});
 $('renderMode').addEventListener('change',()=>{renderer.set({mode:['surface','volume','mip'].indexOf($('renderMode').value)});syncModes();});
 $('quality').addEventListener('change',()=>renderer.set({quality:$('quality').value}));
 $('clipAxis').addEventListener('change',()=>{const axis=['x','y','z'].indexOf($('clipAxis').value);if(axis<0){activeAxis=-1;renderer.set({clipAxis:-1});syncModes();syncSections();}else applyPlane(axis,true);});
 $('clipPosition').addEventListener('input',()=>{if(activeAxis>=0){positions[activeAxis]=Number($('clipPosition').value);applyPlane(activeAxis);}});
 $('clipFlip').addEventListener('click',()=>renderer.set({clipFlip:renderer.settings.clipFlip?0:1}));
 $('showPlanes').addEventListener('change',()=>renderer.set({showPlanes:$('showPlanes').checked?1:0}));
 $('fullscreen').addEventListener('click',async()=>{try{const active=document.fullscreenElement||document.webkitFullscreenElement,workspace=$('reconstructionWorkspace');if(active){if(document.exitFullscreen)await document.exitFullscreen();else document.webkitExitFullscreen?.();}else if(workspace.requestFullscreen)await workspace.requestFullscreen();else if(workspace.webkitRequestFullscreen)workspace.webkitRequestFullscreen();else throw new Error('Fullscreen unavailable');}catch{setText('status','Fullscreen is unavailable in this browser.');}});
 const fullscreenChanged=()=>{const active=document.fullscreenElement||document.webkitFullscreenElement;$('fullscreen').setAttribute('aria-pressed',String(!!active));setText('fullscreenLabel',active?'Exit Fullscreen':'Fullscreen');queueSections();};
 document.addEventListener('fullscreenchange',fullscreenChanged);document.addEventListener('webkitfullscreenchange',fullscreenChanged);
 $('snapshot').addEventListener('click',()=>{const a=el('a');a.href=renderer.snapshot();a.download=source.id+'-'+currentSeries.id+'-phase-'+currentFrame+'.png';a.click();});
 $('shareView').addEventListener('click',async()=>{const url=donorUrl(location.href,source.id);url.hash='clinical='+encodeURIComponent(JSON.stringify({series:currentSeries.id,frame:currentFrame,playing,positions,axis:activeAxis,camera:renderer.camera,window:renderer.settings,paired:!!echoView&&!echoView.node.hidden,echo:echoView?.state()}));try{await navigator.clipboard.writeText(url.href);setText('status','Link to this source, phase and view copied.');}catch{location.hash=url.hash;setText('status','The address bar now contains this shareable view.');}});
 const sectionResize=new ResizeObserver(queueSections);sectionResize.observe($('reconstructionWorkspace'));
 if(isSlicerHeart)sectionResize.observe(document.querySelector('.slice-grid'));

 setupAbout(manifest,source);
 await chooseSeries(manifest.series.some(s=>s.id===saved?.series)?saved.series:manifest.defaultSeries||manifest.series[0].id,{autoplay:false});
 if(saved){
  if(saved.positions?.length===3)positions=saved.positions.map((v,i)=>snapSectionPosition(v,currentSeries.dimensions[i]));
  if(Number.isInteger(saved.axis)&&saved.axis>=0&&saved.axis<3)applyPlane(saved.axis,false);
  else if(saved.axis===-1){activeAxis=-1;renderer.set({clipAxis:-1,slices:positions});}
  if(Number.isFinite(saved.frame))await showFrame(saved.frame);
  if(saved.camera&&['yaw','pitch','distance'].every(k=>Number.isFinite(saved.camera[k]))){renderer.camera={yaw:saved.camera.yaw,pitch:clamp(saved.camera.pitch,-1.54,1.54),roll:Number(saved.camera.roll)||0,distance:clamp(saved.camera.distance,.34,5),pan:Array.isArray(saved.camera.pan)&&saved.camera.pan.length===3?saved.camera.pan.map(v=>clamp(Number(v)||0,-2,2)):[0,0,0]};renderer.requestRender('camera');}
  if(saved.window){
   const patch={};for(const [key,min,max]of [['windowLow',0,.995],['windowHigh',.005,1],['windowGamma',.5,2.5],['cutFaceExposure',.5,3],['capContrast',.5,3]])if(Number.isFinite(saved.window[key]))patch[key]=clamp(saved.window[key],min,max);
   if((patch.windowLow??0)<(patch.windowHigh??1)-.005)renderer.set({...patch,windowEnabled:!!saved.window.windowEnabled});
   const display={};for(const [key,min,max]of [['mode',0,2],['palette',0,6],['surfaceSmoothing',0,2],['clipFlip',0,1],['showPlanes',0,1]])if(Number.isInteger(saved.window[key]))display[key]=clamp(saved.window[key],min,max);
   for(const [key,min,max]of [['threshold',0,1],['opacity',0,2]])if(Number.isFinite(saved.window[key]))display[key]=clamp(saved.window[key],min,max);
   if(['auto','high','low'].includes(saved.window.quality))display.quality=saved.window.quality;
   if(display.palette===5)display.palette=4; // Clinical sources have no assigned anatomy labels.
   renderer.set(display);appearance.changed();
  }
  syncModes();syncSections();appearance.sync();
 }
 if(playbackRequested)startPlayback();
 const ultrasound=manifest.series.find(series=>series.modality==='US');
 if(ultrasound){
  $('echoTab').hidden=false;$('echoTab').textContent='Paired 4D Echo';$('echoTab').setAttribute('aria-controls','pairedClinicalEcho');
  $('echoTab').addEventListener('click',()=>void openPairedEcho());
 }
 async function openPairedEcho(savedEcho={}){
   if(!savedEcho||typeof savedEcho!=='object')savedEcho={};
   const token=++pairRevision;
   if(!echoView)echoView=createPairedEcho(ultrasound,manifest);
   $('reconstructionWorkspace').classList.add('clinical-paired');echoView.node.hidden=false;
   $('echoTab').classList.add('active');$('echoTab').setAttribute('aria-selected','true');$('reconstructionTab').classList.remove('active');$('reconstructionTab').setAttribute('aria-selected','false');
   if(currentSeries.modality==='US')await chooseSeries(manifest.series.find(series=>series.modality==='MRI').id);
   if(token!==pairRevision)return;
   if(currentSeries.modality!=='MRI'){closePairedEcho();setText('status','The MRI could not open for comparison. The recorded ultrasound remains available.');return;}
   echoView.restore(savedEcho);echoView.setReference(currentSeries);await echoView.show(Number.isFinite(savedEcho.frame)?savedEcho.frame:echoView.state().frame);renderer.requestRender('camera');queueSections();
 }
 function closePairedEcho(){
  pairRevision++;echoView?.stop();if(echoView)echoView.node.hidden=true;$('reconstructionWorkspace').classList.remove('clinical-paired');$('reconstructionTab').classList.add('active');$('reconstructionTab').setAttribute('aria-selected','true');$('echoTab').classList.remove('active');$('echoTab').setAttribute('aria-selected','false');renderer.requestRender('camera');queueSections();
 }
 $('reconstructionTab').addEventListener('click',closePairedEcho);
 if(saved?.paired&&ultrasound)await openPairedEcho(saved.echo);

 function createPairedEcho(series,meta){
  const echoNaming=sectionNamingFor({source,series});
  const node=el('section',null,'clinical-echo');node.id='pairedClinicalEcho';
  node.innerHTML='<div class="clinical-echo-heading"><h2>Recorded 4D Ultrasound</h2><span>Same volunteer · separate acquisition</span></div><p id="clinicalPairNote"></p><div class="clinical-echo-image"><canvas id="clinicalEchoCanvas" aria-label="Measured section of the recorded 4D ultrasound"></canvas><span class="clinical-echo-tag">MEASURED ECHO</span></div>';
  node.append(sequenceControls('echoCine'));
  const planeControls=el('div',null,'clinical-echo-plane-controls');planeControls.innerHTML='<label for="echoCineAxis">Echo Section<select id="echoCineAxis"><option value="1">Probe Plane 2</option><option value="0">Probe Plane 1</option><option value="2">Probe Plane 3</option></select></label><input id="echoCineSection" aria-label="Ultrasound section position" type="range" min="0" max="1" step=".005" value=".5"><span id="echoCineDetail"></span>';
  node.append(planeControls);$('reconstructionWorkspace').append(node);
  for(const option of $('echoCineAxis').querySelectorAll('option'))option.textContent=titleCaseUi(sectionLabel(echoNaming,Number(option.value)));
  const frames=new ClinicalFrameStore(),sections=new ResidentSectionSource(),image=document.createElement('canvas');
  let index=0,revision=0,running=false,timer,data,axis=series.defaultSlice?.axis??1,position=snapSectionPosition(series.defaultSlice?.position??.5,series.dimensions[series.defaultSlice?.axis??1]);
  const view={node,stop,show,setReference,state:()=>({frame:index,axis,position}),restore};
  function restore(state={}){
   if(Number.isInteger(state.axis)&&state.axis>=0&&state.axis<3)axis=state.axis;
   if(Number.isFinite(state.position))position=snapSectionPosition(state.position,series.dimensions[axis]);
   $('echoCineAxis').value=axis;$('echoCineSection').step=1/(series.dimensions[axis]-1);$('echoCineSection').value=position;paint();
  }
  function setReference(reference){setText('clinicalPairNote',`${reference.label} and this echo are separate acquisitions. The images are not spatially registered or phase-synchronized.`);}
  function stop(){running=false;clearTimeout(timer);$('echoCinePlay').textContent='Play Phases';$('echoCinePlay').setAttribute('aria-pressed','false');}
  function paint(){
   $('clinicalEchoCanvas').setAttribute('aria-label',sectionLabel(echoNaming,axis)+' of the recorded 4D ultrasound');
   $('echoCineSection').setAttribute('aria-label',sectionLabel(echoNaming,axis)+' position');
   if(!data)return;const section=sections.get(axis,position);image.width=section.width;image.height=section.height;
   const ctx=image.getContext('2d'),pixels=ctx.createImageData(image.width,image.height);
   for(let i=0;i<section.data.length;i++){const v=section.data[i],p=i*4;pixels.data[p]=v;pixels.data[p+1]=v;pixels.data[p+2]=v;pixels.data[p+3]=255;}ctx.putImageData(pixels,0,0);
   drawPhysicalSection($('clinicalEchoCanvas'),image,section.inPlaneSpacingUm.map(v=>v/1000),{flipY:axis!==2&&series.defaultSlice?.flipVertical});
   setText('echoCineDetail',spacingText(series.spacingMm)+' stored grid');
  }
  async function show(next){
   const token=++revision;next=clamp(Math.round(next),0,series.frames.length-1);$('echoCinePhase').value=next;
   setText('echoCinePhaseLabel','Loading phase '+(next+1)+'…');
   try{const bytes=await frames.load(series.frames[next]);if(token!==revision)return;data=bytes;index=next;sections.setVolume(data,{dimensions:series.dimensions,spacingUm:series.spacingMm.map(v=>v*1000)});paint();
    setText('echoCinePhaseLabel',`Phase ${next+1} / ${series.frames.length}`);setTimeout(()=>{if(token===revision)frames.warm(series,next);},400);
   }catch(error){if(token===revision&&error.name!=='AbortError'){stop();setText('echoCinePhaseLabel',error.message);}}
  }
  async function tick(){if(!running)return;await show((index+1)%series.frames.length);if(running)timer=setTimeout(tick,1000/Number($('echoCineRate').value));}
  $('echoCinePhase').max=series.frames.length-1;$('echoCinePhase').addEventListener('input',()=>{stop();void show(Number($('echoCinePhase').value));});
  $('echoCinePlay').addEventListener('click',()=>{if(running){stop();return;}running=true;$('echoCinePlay').textContent='Pause';$('echoCinePlay').setAttribute('aria-pressed','true');void tick();});
  $('echoCineAxis').value=axis;$('echoCineSection').step=1/(series.dimensions[axis]-1);$('echoCineSection').value=position;
  $('echoCineAxis').addEventListener('change',()=>{axis=Number($('echoCineAxis').value);position=snapSectionPosition(position,series.dimensions[axis]);$('echoCineSection').step=1/(series.dimensions[axis]-1);$('echoCineSection').value=position;paint();});
  $('echoCineSection').addEventListener('input',()=>{position=snapSectionPosition(Number($('echoCineSection').value),series.dimensions[axis]);$('echoCineSection').value=position;paint();});
  $('clinicalEchoCanvas').addEventListener('wheel',event=>{event.preventDefault();position=snapSectionPosition(position+Math.sign(event.deltaY)/(series.dimensions[axis]-1),series.dimensions[axis]);$('echoCineSection').value=position;paint();},{passive:false});
  new ResizeObserver(paint).observe(node);setReference(currentSeries);return view;
 }
 return {renderer,manifest,store,showFrame,chooseSeries};
}

function setupAbout(manifest,source){
 const dialog=$('aboutDialog');dialog.replaceChildren();
 const heading=el('div',null,'dialog-heading');heading.append(el('span','CLINICAL PILOT','eyebrow'));const close=el('button','Close','outlined-button');close.type='button';close.addEventListener('click',()=>dialog.close());heading.append(close);const title=el('h2',manifest.label);title.id='aboutTitle';dialog.append(heading,title,el('p',manifest.description||manifest.clinicalContext,'dialog-intro'));
 for(const series of manifest.series){dialog.append(el('h3',series.label));for(const text of [series.samplingDescription,series.phaseDescription,...(series.notes||[])])if(text)dialog.append(el('p',text));}
 if(manifest.pairing?.note)dialog.append(el('p',manifest.pairing.note));
 dialog.append(el('h3','Source & attribution'));
 const info=manifest.source||{};for(const text of [info.citation,info.license])if(text)dialog.append(el('p',text));
 const link=el('a','Open the original source ↗');link.href=source.datasetUrl;link.target='_blank';link.rel='noopener';dialog.append(link);
 dialog.append(el('p','These are acquired clinical images. Thresholded intensity surfaces are exploratory displays, with no inferred chambers or synthetic valve detail. The preserved-heart Echo window presets and TTE Lab are available with the HOA donors.'));
 $('aboutButton').addEventListener('click',()=>dialog.showModal());
 dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
}
