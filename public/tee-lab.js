import {ProbeLabModule} from './probe-lab.js';
import {titleCaseUi} from './ui-text.js';
import {add,mul,norm} from './planes.js';
import {beamPoint,projectProbePoint,probePhysicalLimits,probePhysicalScale,rescaleProbeState} from './probe-geometry.js';
import {RENDER_STYLES} from './render-styles.js';
import {TEE_PRESETS,sanitizeTeeState,createTeeReference,teePose,teePresetState,teeLevel} from './tee-geometry.js';
import {TeeSceneOverlay,paintTeeFallback,paintTeeContextLabels} from './tee-scene.js';
import {TEE_ATLAS_VIEWS} from './tee-atlas-data.js';
import {createTeeContextModel,teeContextCamera,TEE_CONTEXT_REVISION} from './tee-context-geometry.js';
import {TEE_REFINEMENT_DATASET,loadTeeRefinements,applyTeeRefinements} from './tee-view-refinement.js';
import {calibrateTeeContextPresets} from './tee-context-presets.js';
import {echoDonorPlaneRevision} from './echo-donor-planes.js';
import {createEchoAnatomyContext,loadEchoReferenceAnatomy} from './echo-anatomy-context-v2.js';

const copy=x=>JSON.parse(JSON.stringify(x));
const viewIllustration=id=>{const view=TEE_ATLAS_VIEWS.find(v=>v.id===(id==='tg'?'tgpapillary':id));return view?.illustration||view?.diagram||'';};
const editable=element=>!!element?.closest?.('input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"]),select,textarea,[contenteditable]:not([contenteditable="false"]),[role="textbox"]');
const steeringKeys={
 KeyW:['insertionCm',1,1.8,.1,'Advance'],KeyS:['insertionCm',-1,1.8,.1,'Withdraw'],
 KeyA:['shaftRotationDeg',-1,35,1,'Turn left'],KeyD:['shaftRotationDeg',1,35,1,'Turn right'],
 KeyQ:['multiplaneDeg',-1,35,1,'Decrease multiplane angle'],KeyE:['multiplaneDeg',1,35,1,'Increase multiplane angle'],
 KeyI:['anteflexDeg',1,28,1,'Anteflex'],KeyK:['anteflexDeg',-1,28,1,'Retroflex'],
 KeyJ:['lateralFlexDeg',-1,28,1,'Flex left'],KeyL:['lateralFlexDeg',1,28,1,'Flex right']
};
const arrowKeys={ArrowUp:'KeyI',ArrowDown:'KeyK',ArrowLeft:'KeyJ',ArrowRight:'KeyL'};
const canonicalKey=code=>arrowKeys[code]||code;
const precisionKey=code=>code==='ShiftLeft'||code==='ShiftRight';
const keycap=code=>`<button type="button" class="tee-control-key" data-tee-key="${code}" aria-label="${steeringKeys[code][4]} (${code.slice(3)})" aria-keyshortcuts="${code.slice(3)}" title="${steeringKeys[code][4]} · Hold ${code.slice(3)}; Shift for fine control"><kbd>${code.slice(3)}</kbd></button>`;
const signed=x=>(x>0?'+':'')+Number(x.toFixed(1));
const range=(key,label,min,max,step,suffix,ends='')=>`<label class="probe-range tee-range"><span>${titleCaseUi(label)}<output data-tee-value="${key}"></output></span><input type="range" data-tee-range="${key}" min="${min}" max="${max}" step="${step}" aria-label="${titleCaseUi(label)}" data-suffix="${suffix}">${ends?`<small>${ends}</small>`:''}</label>`;

/** TEE has its own kinematics and controls, and reuses Probe Lab's bounded,
 * transactional measured-plane / acoustic worker pipeline. Every accepted
 * image, cut face, probe and sector use one identical accepted pose. */
export class TeeLabModule extends ProbeLabModule{
 constructor(options){super(options);this.onAtlas=options.onAtlas;this.mount.classList.add('tee-panel','probe-orbit-mode');this.updateUI();}
 template(){return `
 <div class="tee-workspace" role="region" aria-label="TEE Lab">
  <aside class="tee-console" aria-label="TEE Probe Controls"><div class="tee-console-heading"><h3>Probe Controls</h3><button type="button" data-tee="lock" aria-pressed="false" title="Locks manual steering. Starting views and Reset unlock it.">Lock Steering</button></div>
   <div class="tee-depth-readout"><span data-tee="level">Midesophageal reference</span><strong data-tee="depth-readout">35.0 <small>cm · Model</small></strong></div>
   <div class="tee-hand-controls" role="group" aria-label="Keyboard probe controls" aria-describedby="teeKeyboardHint">
    <div class="tee-hand"><span>Left · Shaft &amp; Plane</span><div class="tee-key-cluster">${['KeyQ','KeyW','KeyE','KeyA','KeyS','KeyD'].map(keycap).join('')}</div></div>
    <div class="tee-hand"><span>Right · Tip</span><div class="tee-key-cluster tee-tip-keys">${['KeyI','KeyJ','KeyK','KeyL'].map(keycap).join('')}</div></div>
    <p id="teeKeyboardHint">Hold a key or keycap to steer.<br><kbd data-tee="precision-key">Shift</kbd> Fine · Keyboard Always Ready</p>
   </div>
   <div class="tee-mechanical-controls">
   ${range('insertionCm','Insertion',27.5,52,.1,' cm','<span><kbd>S</kbd> Withdraw</span><span>Advance <kbd>W</kbd></span>')}
   ${range('shaftRotationDeg','Turn the shaft',-180,180,1,'°','<span><kbd>A</kbd> Left</span><span>Right <kbd>D</kbd></span>')}
   ${range('anteflexDeg','Tip flexion',-65,90,1,'°','<span><kbd>K</kbd> Retroflex</span><span>Anteflex <kbd>I</kbd></span>')}
   ${range('lateralFlexDeg','Side flexion',-60,60,1,'°','<span><kbd>J</kbd> Left</span><span>Right <kbd>L</kbd></span>')}
   <div class="tee-multiplane"><div class="tee-angle-dial" aria-hidden="true"><svg viewBox="0 0 100 64"><path d="M10 51A40 40 0 0 1 90 51"/><path data-tee="dial-line" d="M50 51L87 51"/><circle cx="50" cy="51" r="3"/><text x="6" y="62">180°</text><text x="42" y="9">90°</text><text x="84" y="62">0°</text></svg></div>${range('multiplaneDeg','Multiplane angle',0,180,1,'°','<span><kbd>Q</kbd> Decrease</span><span>Increase <kbd>E</kbd></span>')}<p>Rotates the image plane within the tip.</p></div>
   </div>
   <button class="probe-reset tee-reset" type="button" data-tee="reset">↺ Reset This Starting View</button>
   <details class="tee-keyboard"><summary>Drag Steering &amp; Help</summary><div class="probe-steer-pad" data-tee="steer-pad" tabindex="0" role="group" aria-label="Drag horizontally to turn the TEE shaft and vertically to flex the tip"><span>Drag: turn ↔ · flex ↕</span></div><p>Keyboard controls work anywhere on this page. Arrow keys also flex the tip; focused sliders keep their native arrow keys. Typing fields keep their normal keys. Leaving this workspace stops steering. Starting views and Reset unlock steering.</p></details>
   <nav class="tee-workspace-links" aria-label="Related Workspaces"><button type="button" data-tee="atlas" title="Browse 28 illustrated ASE views with independent real ultrasound">TEE View Atlas ↗</button><button type="button" data-probe="exit">Reconstruction ↗</button></nav>
  </aside>
  <section class="probe-comparison tee-comparison" aria-label="Matched TEE probe and image views">
   <div class="probe-comparison-headings"><div class="probe-scene-heading"><div><i aria-hidden="true"></i><strong>Probe &amp; Scan Plane</strong></div><span data-probe="frame-state" role="status">Preparing scan</span></div><div class="probe-scene-heading"><strong data-probe="image-title">Simulated Ultrasound</strong><span class="probe-simulation-tag" data-probe="image-kind">CT-DERIVED</span></div></div>
   <div class="probe-view-pair">
    <div id="teeViewportMount" class="probe-viewport-mount" tabindex="0" aria-label="TEE heart workspace. Drag to orbit. Probe keyboard controls are available throughout the TEE Lab.">
     <section class="probe-starting-views tee-starting-views workspace-starting-views" aria-labelledby="teeStartView"><span class="probe-select-label" id="teeStartView">Starting View</span><div class="probe-preset-grid" role="group" aria-labelledby="teeStartView">${TEE_PRESETS.map(p=>`<button type="button" data-tee-preset="${p.id}" aria-pressed="false"><img class="tee-start-diagram" src="${viewIllustration(p.id)}" alt="" width="38" height="28"><span data-tee-preset-label>${titleCaseUi(p.label)}</span><span class="probe-preset-number">${p.angle}°</span></button>`).join('')}</div></section>
     <canvas class="probe-scene-mesh" data-probe="scene-mesh" aria-hidden="true"></canvas><canvas class="probe-guide" data-probe="guide" aria-hidden="true"></canvas><div class="tee-displayed-pose" data-tee="displayed-pose">Preparing the matched pose…</div>
    </div>
    <div class="probe-image-panel" aria-label="Image from the same TEE probe plane"><figure class="probe-image-wrap" data-probe="ultrasound-figure"><canvas data-probe="ultrasound" width="720" height="584" aria-label="Simulated TEE ultrasound derived from this fixed CT volume"></canvas></figure><figure class="probe-image-wrap" data-probe="ct-figure" hidden><canvas data-probe="ct" width="720" height="584" aria-label="Measured CT intensities in the same TEE scan sector"></canvas></figure><span class="probe-image-marker" aria-label="Marked image side">●</span><p class="probe-image-status" data-probe="image-status">Preparing the matched scan plane…</p><div class="probe-image-overlay"><span data-probe="simulation-label">Simulated ultrasound · CT-derived</span><span data-probe="acoustic-meta">5.0 MHz proxy · 135 mm</span></div></div>
   </div>
   <div class="probe-comparison-footers"><div class="probe-scene-footer"><div class="probe-view-actions"><button type="button" data-tee="explore">Oblique</button><button type="button" data-tee="face">Face Plane</button><button type="button" data-tee="frame">Frame Anatomy</button><button type="button" data-tee="skeleton" aria-pressed="true" aria-label="Hide skeleton">Skeleton</button><label><input type="checkbox" data-probe="cutaway" checked> Cutaway</label><button type="button" data-probe="flip" aria-pressed="false">Flip Cut</button></div><div class="probe-contact-badge tee-model-badge"><i aria-hidden="true"></i>Illustrative Anatomy · Unregistered</div><p class="tee-orbit-hint">Drag to Orbit · Scroll to Zoom</p></div><div class="probe-image-footer"><div class="probe-image-modes" role="group" aria-label="TEE Comparison Image"><button type="button" data-probe-image="ultrasound" aria-pressed="true">Simulated Ultrasound</button><button type="button" data-probe-image="ct" aria-pressed="false">Measured CT</button></div><div class="probe-image-meta"><span data-probe="resolution">Volume Resolution</span><span data-probe="sampling">Awaiting Volume</span></div><p class="probe-fine-status" data-probe="fine-status" role="status">Fine detail follows the TEE probe.</p></div></div>
  </section>
 </div>
 <div class="workspace-secondary-tools">
 <details class="workspace-method-note"><summary>Model Notes <span>CT-Derived Simulation</span></summary><div class="workspace-method-body"><p class="probe-preset-note" data-tee="preset-note"></p><p class="probe-scene-caption">The heart is measured, fixed-specimen anatomy. Surrounding anatomy and insertion depth are illustrative and unregistered. Skeleton: <a href="https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html" target="_blank" rel="noopener">BodyParts3D / DBCLS · CC BY 4.0</a>. The probe, cut face and both image modes share one accepted pose; clinical correspondence remains approximate.</p></div></details>
 <details class="probe-controls-panel tee-imaging-settings"><summary>Image Settings</summary><div class="probe-controls">
  <section class="probe-controls-group"><h3>Image Controls</h3>${range('depthMm','Imaging depth',65,190,1,' mm')}${range('gainDb','Gain',-18,18,1,' dB')}${range('angleDeg','Sector width',35,110,1,'°')}</section>
  <section class="probe-controls-group"><h3>Ultrasound Appearance</h3>${range('frequencyMHz','Frequency proxy',1.5,7,.5,' MHz')}${range('dynamicRangeDb','Dynamic range',35,80,1,' dB')}${range('shadow','Attenuation & shadow',0,1,.05,'')}</section>
  <section class="probe-controls-group"><h3>Display &amp; Interpretation</h3><label class="probe-checkbox"><input type="checkbox" data-probe="show-guide" checked> Show Probe &amp; Scan Sector</label><label class="probe-checkbox"><input type="checkbox" data-probe="show-surface" checked> Show Esophagus, Diaphragm &amp; Stomach</label><label class="probe-material">Tissue Style <select data-probe="material" aria-label="TEE tissue color style">${RENDER_STYLES.map(p=>`<option value="${p.id}">${titleCaseUi(p.name)}</option>`).join('')}</select></label><details class="probe-method"><summary>What This Simulation Represents</summary><p>The probe follows the illustrated esophagus into the stomach. Starting poses adjust insertion, shaft turn and tip flexion to approach the selected source section. The 35 cm marker identifies a modeled ME reference; neither the tract nor the insertion scale comes from a donor esophagus. Flexion bends a modeled tip; electronic multiplane rotation changes only the scan plane. No contact-force or collision model is included.</p><p>Ultrasound appearance is a CT-derived interface, speckle and attenuation model. The scan does not measure acoustic impedance or a beating heart. Named views are educational starting points, not validated clinical acquisitions.</p><p data-tee="pose-fit"></p><p>Both image modes and the cut face use one accepted probe pose. Available fine data refine that same measured plane. Shared CT brightness and window controls are in CT Display.</p><a href="https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf" target="_blank" rel="noopener">ASE/SCA: TEE controls and standard views ↗</a></details></section>
 </div></details></div>`;}

 tee(key){return this.mount.querySelector(`[data-tee="${key}"]`);}
 bind(){
  this.pointerControls=new Map();
  this.tee('atlas').addEventListener('click',()=>this.onAtlas?.());
  this.$('exit').addEventListener('click',()=>{this.releaseControl();this.onExit?.();});
  this.mount.querySelectorAll('[data-tee-preset]').forEach(b=>b.addEventListener('click',()=>this.selectPreset(b.dataset.teePreset)));
  this.tee('reset').addEventListener('click',()=>this.reset());
  this.tee('lock').addEventListener('click',()=>{this.state.probeLocked=!this.state.probeLocked;this.releaseControl();this.updateUI();});
  this.mount.querySelectorAll('[data-tee-range]').forEach(input=>input.addEventListener('input',()=>this.changeControl(input.dataset.teeRange,Number(input.value))));
  this.mount.querySelectorAll('[data-tee-key]').forEach(button=>{
   button.addEventListener('pointerdown',event=>{
    if(!this.active||this.state.probeLocked||event.button!==0||event.ctrlKey||event.metaKey||event.altKey)return;
    event.preventDefault();button.focus();this.shiftHeld=!!event.shiftKey;this.pointerControls.set(event.pointerId,{code:button.dataset.teeKey,button});
    try{button.setPointerCapture?.(event.pointerId);}catch{}
    this.nudgeKey(button.dataset.teeKey,event.shiftKey);this.updateKeyFeedback();
   });
   for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,event=>this.releasePointerControl(event.pointerId));
   // Physical pointers start on pointerdown. A synthetic click (Enter, Space or
   // assistive technology) makes one precise step without requiring a pointer.
   button.addEventListener('click',event=>{if(!(event.detail>0)&&!(event.pointerId>0))this.nudgeKey(button.dataset.teeKey,event.shiftKey);});
  });
  for(const key of ['explore','face','frame'])this.tee(key).addEventListener('click',()=>this.orientCamera(key));
  this.tee('skeleton').addEventListener('click',()=>{
   if(this.skeletonLoadError){this.skeletonLoadError=null;this.state.showSkeleton=true;this.loadSkeleton();}
   else{this.state.showSkeleton=!this.state.showSkeleton;if(this.state.showSkeleton)this.loadSkeleton();}
   this.updateUI();this.guideKey='';this.drawGuide();
  });
  this.$('cutaway').addEventListener('change',()=>{this.state.cutaway=this.$('cutaway').checked;this.applyDisplayPlane();});
  this.$('flip').addEventListener('click',()=>{this.state.flip=!this.state.flip;this.updateUI();this.applyDisplayPlane();});
  for(const [key,field] of [['show-guide','showGuide'],['show-surface','showSurface']])this.$(key).addEventListener('change',()=>{this.state[field]=this.$(key).checked;this.guideKey='';this.drawGuide();});
  this.$('material').addEventListener('change',()=>{this.renderer.set({palette:Number(this.$('material').value)});this.appearance?.changed();this.updateAppearance();});
  this.mount.querySelectorAll('[data-probe-image]').forEach(b=>b.addEventListener('click',()=>{this.state.imageMode=b.dataset.probeImage;this.updateImageLabels();}));
  const pad=this.tee('steer-pad');
  pad.addEventListener('pointerdown',e=>{if(!this.active||this.state.probeLocked||e.button!==0||e.ctrlKey||e.metaKey||e.altKey)return;e.preventDefault();pad.focus();this.drag={id:e.pointerId,x:e.clientX,y:e.clientY};pad.setPointerCapture?.(e.pointerId);pad.classList.add('is-dragging');});
  pad.addEventListener('pointermove',e=>{if(this.drag?.id!==e.pointerId)return;e.preventDefault();const scale=e.shiftKey ? .04 : .15;this.state=sanitizeTeeState({...this.state,shaftRotationDeg:this.state.shaftRotationDeg+(e.clientX-this.drag.x)*scale,anteflexDeg:this.state.anteflexDeg-(e.clientY-this.drag.y)*scale});this.drag.x=e.clientX;this.drag.y=e.clientY;this.poseChanged();});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])pad.addEventListener(type,()=>this.releaseControl());
  document.addEventListener('keydown',e=>this.keyDown(e),true);
  document.addEventListener('keyup',e=>{const held=this.keys.delete(e.code);if(precisionKey(e.code))this.shiftHeld=!!e.shiftKey;if(held&&this.active)e.preventDefault();if(held||precisionKey(e.code))this.updateKeyFeedback();},true);
  for(const type of ['pointerup','pointercancel'])window.addEventListener(type,e=>this.releasePointerControl(e.pointerId));
  window.addEventListener('blur',()=>{if(this.active)this.releaseControl();});
  document.addEventListener('visibilitychange',()=>{if(this.active&&document.hidden)this.releaseControl();});
  document.addEventListener('focusin',e=>{if(this.active&&(editable(e.target)||e.target?.closest?.('input')))this.releaseControl();});
  if(typeof ResizeObserver==='function'){this.resizeObserver=new ResizeObserver(()=>{this.guideKey='';if(this.active)this.drawGuide();});this.resizeObserver.observe(this.mount);}
 }
 setFrames(input){super.setFrames(input);this.teeReference=null;this.contextModel=null;this.fitFrames=null;}
 async init(){
  this.loadSkeleton();
  await super.init();
  if(!this.contextInitPromise){
   const revision=this.poseRevision;
   this.contextInitPromise=(async()=>{
    this.fitFrames=this.frames;
    if(String(this.donor.datasetId)===TEE_REFINEMENT_DATASET&&!this.donor.geometricComparisonOnly){try{const catalog=await loadTeeRefinements();this.fitFrames=applyTeeRefinements(this.frames,catalog,{datasetId:this.donor.datasetId});}catch(error){console.warn('TEE starting-plane review:',error);}}
    this.contextReady=true;this.teeReference=null;const reference=this.reference();
    if(!this.hasRestoredPose&&this.poseRevision===revision)this.state=teePresetState(this.state.teePreset,this.state,reference);
    this.ensureOrigin();this.updateUI();return this;
   })();
  }
  return this.contextInitPromise;
 }
 anatomyContext(){
  if(!this.frames.me4c)return null;const referenceMm=this.geometry?.longestMm||this.state.referenceMm;
  if(!this.contextModel||this.contextModel.referenceMm!==referenceMm)this.contextModel=createTeeContextModel({frames:this.frames,referenceMm,donorId:this.donor.datasetId||this.donor.id||'unassigned'});
  return this.contextModel;
 }
 loadSkeleton(){
  if(this.referenceAnatomy)return Promise.resolve(this.referenceAnatomy);
  if(this.skeletonLoadPromise)return this.skeletonLoadPromise;
  // The atlas and Lab share one small verified reference asset. This is a
  // display-only addition: the fixed tract and calibrated probe never change.
  this.skeletonLoadPromise=loadEchoReferenceAnatomy().then(reference=>{
   this.referenceAnatomy=reference;this.skeletonLoadError=null;return reference;
  }).catch(error=>{this.skeletonLoadError=error;return null;}).finally(()=>{
   this.skeletonLoadPromise=null;this.updateSkeletonButton();this.guideKey='';if(this.active)this.drawGuide();
  });
  this.updateSkeletonButton();return this.skeletonLoadPromise;
 }
 updateSkeletonButton(){
  const button=this.tee('skeleton');if(!button)return;
  const failed=!!this.skeletonLoadError,loading=!!this.skeletonLoadPromise;
  button.textContent=failed?'Retry Skeleton':'Skeleton';
  button.setAttribute('aria-pressed',String(this.state.showSkeleton!==false));
  button.setAttribute('aria-label',failed?'Retry loading the fitted reference skeleton':this.state.showSkeleton!==false?'Hide skeleton':'Show skeleton');
  button.setAttribute('aria-busy',String(loading));
  button.title=failed?'Reference skeleton could not load. Select to retry.':loading?'Loading fitted reference skeleton…':'Fitted reference skeleton · illustrative, not donor-registered';
 }
 displayAnatomyContext(){
  const base=this.anatomyContext();if(!base)return null;
  const showSkeleton=this.state.showSkeleton!==false&&!!this.referenceAnatomy,showSurface=!!this.state.showSurface;
  if(!showSkeleton)return showSurface?base:null;
  if(this.skeletonBase!==base||this.skeletonSource!==this.referenceAnatomy){
   const fitted=createEchoAnatomyContext({baseModel:base,referenceAnatomy:this.referenceAnatomy});
   const bones=fitted.meshes.filter(m=>m.id==='bodyparts3d-bones'||m.id==='bodyparts3d-spine');
   const labels=fitted.labels.filter(l=>l.id.startsWith('bodyparts3d-'));
   this.skeletonBase=base;this.skeletonSource=this.referenceAnatomy;
   // A visibility choice only selects already-fitted meshes. Keep every bone
   // triangle and the exact GI arrays; do not re-fit anatomy to a moving probe.
   this.skeletonContexts={
    both:Object.freeze({...fitted,meshes:Object.freeze([...base.meshes,...bones]),labels:Object.freeze([...base.labels,...labels])}),
    skeleton:Object.freeze({...fitted,meshes:Object.freeze(bones),labels:Object.freeze(labels),contours:Object.freeze({}),topology:Object.freeze({})}),
   };
  }
  return this.skeletonContexts[showSurface?'both':'skeleton'];
 }
 frameForState(){const frame=this.frames.me4c;return frame?{...frame,referenceMm:this.geometry?.longestMm||this.state?.referenceMm}:null;}
 reference(){
  if(!this.frames.me4c)return null;const referenceMm=this.geometry?.longestMm||this.state.referenceMm;
  if(!this.teeReference||this.teeReference.referenceMm!==referenceMm){
   const frames=this.fitFrames||this.frames;
   this.teeReference=createTeeReference(frames,referenceMm,this.contextReady?this.anatomyContext():null);
   if(this.contextReady){const fitted=calibrateTeeContextPresets(this.teeReference,frames);this.teeReference.presetStates=fitted.presetStates;this.teeReference.calibrationReview=fitted.review;}
  }
  return this.teeReference;
 }
 ensureOrigin(){
  this.state=sanitizeTeeState(this.state);const r=this.reference();
  if(r){
   this.state.insertionCm=Math.max(r.minInsertionCm,Math.min(r.maxInsertionCm,this.state.insertionCm));
   if(!this.state.teeEntryInitialized){if(Math.abs(this.state.depthMm-135*r.scale)<1e-4)this.state.depthMm=r.meDepthMm;this.state.teeEntryInitialized=true;}
  }
 }
 getPose(){return teePose(this.state,this.reference());}
 getState(){const donorPlaneRevision=echoDonorPlaneRevision(this.frames);return copy({...this.state,...(donorPlaneRevision?{donorPlaneRevision,teeContextRevision:TEE_CONTEXT_REVISION}:{})});}
 restore(saved={}){
  this.releaseControl();const donorPlaneRevision=echoDonorPlaneRevision(this.frames),stale=!!donorPlaneRevision&&(saved.donorPlaneRevision!==donorPlaneRevision||saved.teeContextRevision!==TEE_CONTEXT_REVISION);
  this.hasRestoredPose=!stale;this.state=sanitizeTeeState(saved);if(this.geometry)this.state=rescaleProbeState(this.state,this.geometry.longestMm);
  if(stale)this.state=teePresetState(this.state.teePreset,{...this.state,donorPlaneRevision,teeContextRevision:TEE_CONTEXT_REVISION},this.reference());
  this.ensureOrigin();this.updateUI();if(this.active){this.invalidatePending();this.poseChanged(true);}
 }
 reset(){this.selectPreset(this.state.teePreset);}
 selectPreset(id){this.releaseControl();this.state=teePresetState(id,this.state,this.reference());this.ensureOrigin();this.invalidatePending();this.poseChanged(true);if(this.active)this.orientCamera('explore');}
 changeControl(key,value){
  if(this.state.probeLocked&&['insertionCm','shaftRotationDeg','anteflexDeg','lateralFlexDeg','multiplaneDeg'].includes(key))return;
  this.state=sanitizeTeeState({...this.state,[key]:value});this.poseChanged();
 }
 releaseControl(){
  this.keys.clear();this.shiftHeld=false;for(const id of this.pointerControls?.keys()||[])this.releasePointerControl(id);
  const pad=this.tee('steer-pad'),id=this.drag?.id;this.drag=null;pad?.classList.remove('is-dragging');
  if(id!==undefined){try{pad.releasePointerCapture?.(id);}catch{}}
  this.updateKeyFeedback();
 }
 releasePointerControl(id){
  const control=this.pointerControls?.get(id);if(!control)return;
  this.pointerControls.delete(id);try{control.button.releasePointerCapture?.(id);}catch{}
  this.updateKeyFeedback();
 }
 activeSteeringKeys(){
  return new Set([...this.keys,...[...this.pointerControls.values()].map(control=>control.code)].map(canonicalKey));
 }
 fineSteering(){return this.shiftHeld||this.keys.has('ShiftLeft')||this.keys.has('ShiftRight');}
 updateKeyFeedback(){
  const held=this.activeSteeringKeys();
  this.mount.querySelectorAll('[data-tee-key]').forEach(button=>{const down=held.has(button.dataset.teeKey);button.classList.toggle('is-held',down);button.setAttribute('aria-pressed',String(down));});
  this.tee('precision-key')?.classList.toggle('is-held',!!this.fineSteering());
 }
 nudgeKey(code,fine=false){
  if(!this.active||this.state.probeLocked)return;
  const [field,direction,,step]=steeringKeys[canonicalKey(code)];
  this.changeControl(field,this.state[field]+direction*step*(fine ? .22 : 1));
 }
 keyDown(event){
  if(!this.active)return;
  if(event.code==='Escape'){this.releaseControl();return;}
  if(event.ctrlKey||event.metaKey||event.altKey||event.isComposing){this.releaseControl();return;}
  if(this.state.probeLocked||document.hidden||editable(event.target)||editable(document.activeElement)){this.releaseControl();return;}
  if(arrowKeys[event.code]&&(event.target?.closest?.('input[type="range"]')||document.activeElement?.closest?.('input[type="range"]')))return;
  if(!steeringKeys[canonicalKey(event.code)]&&!precisionKey(event.code))return;
  // Native repeat must never restart motion after an interrupted hold. Ordinary
  // page focus does not arm or disarm the keyboard; the active lab owns it.
  if(event.repeat&&!this.keys.has(event.code))return;
  if(!precisionKey(event.code)){event.preventDefault();event.stopPropagation();}
  this.shiftHeld=!!event.shiftKey||precisionKey(event.code);
  const first=!this.keys.has(event.code);this.keys.add(event.code);
  if(first&&!precisionKey(event.code))this.nudgeKey(event.code,this.fineSteering());
  this.updateKeyFeedback();
 }
 tick(time){
  if(!this.active)return;const dt=Math.min(.05,Math.max(0,(time-this.lastTick)/1000));this.lastTick=time;
  if(document.hidden||editable(document.activeElement))this.releaseControl();
  const speed=this.fineSteering() ? .22 : 1,deltas={};
  for(const code of this.activeSteeringKeys()){const binding=steeringKeys[code];if(binding){const[field,direction,rate]=binding;deltas[field]=(deltas[field]||0)+direction*rate;}}
  if(!this.state.probeLocked&&Object.values(deltas).some(Boolean)){const next={...this.state};for(const key in deltas)next[key]+=deltas[key]*dt*speed;this.state=sanitizeTeeState(next);this.poseChanged(false,false);if(time-(this.lastUI||0)>80){this.updateUI();this.lastUI=time;}}
  this.drawGuide();this.raf=requestAnimationFrame(next=>this.tick(next));
 }
 updateUI(){
  this.ensureOrigin();const s=this.state,r=this.reference(),unreviewed=this.donor.clinicalPresetsReviewed===false;
  const preset=TEE_PRESETS.find(p=>p.id===s.teePreset)||TEE_PRESETS[0];
  this.mount.querySelectorAll('[data-tee-preset]').forEach(b=>{
   const p=TEE_PRESETS.find(p=>p.id===b.dataset.teePreset),estimated=!!this.frames[p.frame]?.donorCalibration;
   b.querySelector('[data-tee-preset-label]').textContent=titleCaseUi(unreviewed&&!estimated?p.geometricLabel:p.label);
   const fittedAngle=r?.presetStates?.[p.id]?.multiplaneDeg,hasFittedAngle=Number.isFinite(fittedAngle),angleLabel=b.querySelector('.probe-preset-number');
   angleLabel.textContent=`${Math.round(hasFittedAngle?fittedAngle:p.angle)}°${hasFittedAngle?' · model':''}`;
   angleLabel.title=hasFittedAngle?'Simulated probe multiplane angle for this starting pose':'Nominal starting multiplane angle';
   b.setAttribute('aria-pressed',String(p.id===s.teePreset));
  });
  this.tee('preset-note').textContent=this.frames[preset.frame]?.donorCalibration?'Starting plane estimated from this specimen’s chamber and outflow landmarks. The clinical TEE window and simulated probe position remain unvalidated.':unreviewed?'Donor-specific geometric references. Clinical TEE correspondence is unassigned.':preset.note+' Educational starting view.';
  const fit=r?.calibrationReview?.presets?.[s.teePreset],fitNote=this.tee('pose-fit');
  if(fitNote){const ready=Number.isFinite(fit?.planeOffsetMm)&&Number.isFinite(fit?.normalAngleDeg);fitNote.hidden=!ready;fitNote.textContent=ready?`Starting pose: ${fit.planeOffsetMm.toFixed(2)} mm plane offset · ${fit.normalAngleDeg.toFixed(2)}° orientation residual. This is a geometric fit to the source section, not clinical probe registration.`:'';}
  this.tee('level').textContent=titleCaseUi(teeLevel(s,r));this.tee('depth-readout').innerHTML=`${s.insertionCm.toFixed(1)} <small>cm · model</small>`;
  this.tee('lock').textContent=s.probeLocked?'Unlock Steering':'Lock Steering';this.tee('lock').setAttribute('aria-pressed',String(s.probeLocked));
  this.mount.classList.toggle('tee-is-locked',s.probeLocked);
  const limits=probePhysicalLimits(s.referenceMm);
  this.mount.querySelectorAll('[data-tee-range]').forEach(input=>{
   const key=input.dataset.teeRange,v=s[key];input.value=String(v);
   if(key==='insertionCm'&&r){input.min=r.minInsertionCm;input.max=r.maxInsertionCm;}
   if(key==='depthMm'){input.min=limits.depth[0];input.max=limits.depth[1];}
   input.disabled=s.probeLocked&&['insertionCm','shaftRotationDeg','anteflexDeg','lateralFlexDeg','multiplaneDeg'].includes(key);
   input.setAttribute('aria-valuetext',key==='shadow'?`${Math.round(v*100)} percent`:`${Number(v.toFixed(1))}${input.dataset.suffix}`);
   const output=this.mount.querySelector(`[data-tee-value="${key}"]`);output.textContent=(key==='shadow'?Math.round(v*100)+'%':key==='insertionCm'||key==='frequencyMHz'?v.toFixed(1):['shaftRotationDeg','anteflexDeg','lateralFlexDeg','gainDb'].includes(key)?signed(v):Math.round(v))+input.dataset.suffix;
  });
  for(const b of this.mount.querySelectorAll('[data-tee-key]'))b.disabled=s.probeLocked;
  this.updateKeyFeedback();
  const a=s.multiplaneDeg*Math.PI/180;this.tee('dial-line').setAttribute('d',`M50 51L${50+37*Math.cos(a)} ${51-37*Math.sin(a)}`);
  this.$('cutaway').checked=s.cutaway;this.$('flip').setAttribute('aria-pressed',String(s.flip));this.$('show-guide').checked=s.showGuide;this.$('show-surface').checked=s.showSurface;
  this.updateSkeletonButton();
  this.updateImageLabels();
 }
 acceptFrame(frame){super.acceptFrame(frame);if(this.displayedFrame===frame){const s=frame.state;this.tee('displayed-pose').textContent=`Displayed · ${s.insertionCm.toFixed(1)} cm model · ${Math.round(s.multiplaneDeg)}° multiplane`;}}
 ensureScene(){if(!this.sceneOverlay&&!this.sceneUnavailable){try{this.sceneOverlay=new TeeSceneOverlay(this.$('scene-mesh'),{renderer:this.renderer});}catch{this.sceneUnavailable=true;}}this.sceneOverlay?.setActive?.(this.active);}
 leave(){this.sceneOverlay?.setActive?.(false);super.leave();}
 orientCamera(mode='explore'){
  if(!this.active||!this.geometry)return;const pose=this.displayedFrame?.pose||this.getPose();if(!pose)return;
  if(mode==='frame'){
   this.state.showSurface=true;const model=this.displayAnatomyContext(),rect=this.renderer.canvas.getBoundingClientRect();if(!model)return;
   const camera=teeContextCamera(model,rect.width/Math.max(1,rect.height));
   this.renderer.camera.distance=camera.distanceMm/this.geometry.longestMm;this.renderer.alignPlane(mul(camera.forward,-1),camera.up,mul(camera.targetMm,1/this.geometry.longestMm));this.updateUI();this.guideKey='';this.drawGuide();return;
  }
  const state=this.displayedFrame?.state||this.state,scale=this.geometry.longestMm,target=mul(add(pose.originMm,mul(pose.beam,state.depthMm*.43)),1/scale);
  const rect=this.renderer.canvas.getBoundingClientRect(),aspect=rect.height?rect.width/rect.height:1;
  const fit=Math.max(1.65,state.depthMm/scale/.52,state.depthMm*2*Math.sin(state.angleDeg*Math.PI/360)/scale/(.58*aspect));
  this.renderer.camera.distance=fit;
  if(mode==='frame'){this.renderer.camera.pan=target;this.renderer.requestRender();}
  else this.renderer.alignPlane(mode==='face'?mul(pose.normal,this.state.flip?-1:1):norm(add(add(mul(pose.normal,this.state.flip?-1:1),mul(pose.right,.42)),mul(pose.up,.24))),pose.up,target);
  this.guideKey='';this.drawGuide();
 }
 drawGuide(){
  if(!this.active||!this.geometry)return;const guide=this.$('guide'),target=this.mount.querySelector('#teeViewportMount'),canvas=this.renderer.canvas;
  const rect=canvas.getBoundingClientRect(),mountRect=target.getBoundingClientRect(),w=Math.round(rect.width),h=Math.round(rect.height);if(w<2||h<2)return;
  const camera=this.renderer.camera,key=[...camera.pan,camera.yaw,camera.pitch,camera.roll,camera.distance,w,h,this.displayedId,this.state.showGuide,this.state.showSurface,this.state.showSkeleton,!!this.referenceAnatomy,this.displayedFrame?.poseRevision??this.poseRevision,this.renderer.contextFrameRevision||0].join(',');if(key===this.guideKey)return;this.guideKey=key;
  const dpr=Math.min(globalThis.devicePixelRatio||1,2);guide.width=Math.round(w*dpr);guide.height=Math.round(h*dpr);guide.style.width=w+'px';guide.style.height=h+'px';guide.style.left=(rect.left-mountRect.left)+'px';guide.style.top=(rect.top-mountRect.top)+'px';
  const ctx=guide.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  const frame=this.displayedFrame,pose=frame?.pose||this.getPose(),state=frame?.state||this.state,reference=this.reference();if(!pose||!reference)return;
  const basis=this.renderer.basis(),scale=1/this.geometry.longestMm,project=p=>projectProbePoint(mul(p,scale),basis,w,h);
  const path=(points,close=false,fill=null,stroke='#84b5aa',lineWidth=1)=>{const ps=points.map(project);if(ps.some(p=>!p))return;ctx.beginPath();ps.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));if(close)ctx.closePath();if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=lineWidth;ctx.stroke();}};
  const contextModel=this.displayAnatomyContext(),showContext=!!contextModel,occlusion=this.renderer.getContextOcclusion?.();
  if(showContext&&!this.sceneOverlay?.sharedDepth)paintTeeContextLabels(ctx,project,contextModel,w,h,{fallback:!this.sceneOverlay,occlusion});
  const mesh=this.$('scene-mesh');mesh.style.width=w+'px';mesh.style.height=h+'px';mesh.style.left=guide.style.left;mesh.style.top=guide.style.top;
  this.sceneOverlay?.render({basis,width:w,height:h,dpr,pose,reference,showProbe:this.state.showGuide,contextModel,showContext});
  if(!this.state.showGuide)return;
  if(!this.sceneOverlay)paintTeeFallback(ctx,project,pose,reference.scale,{occlusion});
  const half=state.angleDeg*Math.PI/360,arc=d=>Array.from({length:49},(_,i)=>beamPoint(pose,-half+i*2*half/48,d));
  path([pose.originMm,...arc(state.depthMm)],true,'rgba(116,194,164,.05)','rgba(153,218,188,.85)',1.4);
  ctx.setLineDash([3,5]);for(const part of [.25,.5,.75])path(arc(state.depthMm*part),false,null,'rgba(121,190,163,.30)');path([pose.originMm,beamPoint(pose,0,state.depthMm)],false,null,'rgba(160,215,191,.55)');ctx.setLineDash([]);
  // The amber ray marks the same image-left edge as the dot on the image.
  path([pose.originMm,beamPoint(pose,-half,Math.min(state.depthMm,24*reference.scale))],false,null,'#e8b16d',2.2);
 }
}
