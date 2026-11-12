import {add,mul,norm,cross,dot} from './planes.js';
import {titleCaseUi} from './ui-text.js';
import {capColor,capAnatomyColor as anatomyColor,buildAnatomyPalette,RENDER_STYLES} from './render-styles.js';
import {PROBE_PRESETS,PROBE_REFERENCE_MM,probePhysicalScale,probePhysicalLimits,rescaleProbeState,finiteVector,volumeGeometry,defaultOrigin,sanitizeProbeState,probePose,moveProbeState,steerProbe,beamPoint,probeCapPlane,projectProbePoint,probeContactSurface,contactCoordinates,contactFrame,contactSurfaceLines,setProbeContactLocked,probePresetDepth,initializeProbeEntry,anglesForProbePose} from './probe-geometry.js';
import {ProbeSceneOverlay, ReferenceTorsoView, paintProbeFallback, labProbeDisplayScale as probeDisplayScale} from './probe-scene.js';
import {createSkinContactSurface,skinContactFrame,initialSkinContact,restoreSkinContact} from './probe-skin-contact.js';
import {validFineProbeSlice,probeFrameQuality} from './probe-acoustics.js';
import {buildDonorEchoFrames,echoDonorPlaneRevision} from './echo-donor-planes.js';
import {createCompactLabLayout} from './lab-compact-v47.js';

const probeSteeringKeys={
 KeyW:['advance',1,'Slide forward','↑'],KeyS:['advance',-1,'Slide backward','↓'],
 KeyA:['lateral',-1,'Slide left','←'],KeyD:['lateral',1,'Slide right','→'],
 KeyQ:['roll',-1,'Rotate counterclockwise','↶'],KeyE:['roll',1,'Rotate clockwise','↷'],
 KeyI:['tilt',-1,'Tilt up','↑'],KeyK:['tilt',1,'Tilt down','↓'],
 KeyJ:['sweep',-1,'Fan left','←'],KeyL:['sweep',1,'Fan right','→'],
 KeyR:['elevation',1,'Move out of plane','↑'],KeyF:['elevation',-1,'Move into plane','↓']
};
const precisionKey=code=>code==='ShiftLeft'||code==='ShiftRight';
const controlIsEditable=element=>!!element?.closest?.('input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"]),select,textarea,[contenteditable]:not([contenteditable="false"]),[role="textbox"]');
const probeKeycap=code=>`<button type="button" class="probe-control-key" data-probe-key="${code}" aria-label="${probeSteeringKeys[code][2]} (${code.slice(3)})" aria-keyshortcuts="${code.slice(3)}" title="${probeSteeringKeys[code][2]} · Hold ${code.slice(3)}; Shift for fine control"><kbd>${code.slice(3)}</kbd><span aria-hidden="true">${probeSteeringKeys[code][3]}</span></button>`;
const copy=value=>JSON.parse(JSON.stringify(value));
const signed=value=>(value>=0?'+':'')+value.toFixed(1);
const range=(key,label,min,max,step,suffix)=>`<label class="probe-range"><span>${titleCaseUi(label)}<output data-probe-value="${key}"></output></span><input type="range" data-probe-range="${key}" min="${min}" max="${max}" step="${step}" aria-label="${titleCaseUi(label)}" data-suffix="${suffix}"></label>`;

/** One physical probe pose drives all three views. The host owns the shared
 * reconstruction canvas and moves its viewport into #probeViewportMount.
 */
export class ProbeLabModule{
 constructor({renderer,mount,onExit,toast=()=>{},appearance=null,frames=null,fineSource=null,donor={}}){
  this.renderer=renderer;this.mount=typeof mount==='string'?document.querySelector(mount):mount;
  if(!this.mount)throw new Error('ProbeLabModule needs a mount element.');
  this.onExit=onExit;this.toast=toast;this.appearance=appearance;this.fineSource=fineSource;this.frames={};this.active=false;this.donor=donor;
  this.fineSpacingUm=Number(donor.fineSpacingUm)>0?Number(donor.fineSpacingUm):79.4;this.fineLabel=`${Number(this.fineSpacingUm.toFixed(3))} µm`;
  this.state=sanitizeProbeState({interactionMode:'orbit'});this.keys=new Set();this.captureEpoch=0;this.captureWanted=false;this.nativeWasLocked=false;this.mouseMode='rotate';this.sequence=0;this.version=0;this.displayedId=-1;this.minFrameId=0;this.fineGeneration=0;this.poseRevision=0;
  this.mount.classList.add('probe-panel');this.mount.innerHTML=this.template();this.bind();
  if(frames)this.setFrames(frames);this.updateUI();
  this.compactLayout=createCompactLabLayout(this);
 }

 template(){return `
  <div class="probe-workspace" role="region" aria-label="TTE Lab">
    <aside class="probe-body-context" aria-label="Starting views, chest orientation and probe keyboard controls">
     <section class="probe-starting-views workspace-starting-views" aria-labelledby="probeStartView"><span class="probe-select-label" id="probeStartView">Starting View</span><div class="probe-preset-grid" role="group" aria-labelledby="probeStartView">${PROBE_PRESETS.map((p,i)=>`<button type="button" data-probe-preset="${p.id}" aria-pressed="${i===0}"><span class="probe-preset-number">0${i+1}</span><span data-probe-preset-label>${titleCaseUi(p.name)}</span></button>`).join('')}</div></section>
     <div class="probe-context-heading"><h3>Chest Orientation</h3><small>LINKED</small></div>
     <div class="probe-torso-wrap"><canvas data-probe="torso" width="440" height="500" tabindex="0" aria-label="Linked whole donor heart, fitted reference chest and actual scan sector. Place Probe lets you click or drag on the skin. Drag to orbit; two fingers or Shift-drag to pan; pinch or scroll to zoom. Arrow keys orbit; plus and minus zoom; R resets this overview camera."></canvas><svg data-probe="torso-indicator" class="probe-torso-indicator" role="img" aria-label="Probe indicator: corresponds to the marked side of the ultrasound image" hidden><title>The amber probe indicator corresponds to the image orientation dot. A dashed leader locates the marker when its side faces away.</title><path data-probe="indicator-line"/><circle data-probe="indicator-dot" r="4"/><g data-probe="indicator-label"><rect x="0" y="-15" width="89" height="27" rx="5"/><text x="10" y="2">Indicator</text></g></svg><span data-probe="torso-state" class="probe-torso-state">Loading linked chest…</span></div>
     <div class="probe-torso-actions" role="group" aria-label="Reference torso view"><button type="button" data-probe="place-skin" aria-pressed="false">Place Probe</button><button type="button" data-probe-torso-view="front" aria-pressed="false">Front</button><button type="button" data-probe-torso-view="oblique" aria-pressed="true">Oblique</button></div>
     <section class="probe-keyboard-console" aria-label="Probe keyboard controls" aria-describedby="probeKeyboardHint">
      <div class="probe-hand"><span>Slide &amp; Rotate</span><div class="probe-key-cluster">${['KeyQ','KeyW','KeyE','KeyA','KeyS','KeyD'].map(probeKeycap).join('')}</div></div>
      <div class="probe-hand"><span>Tilt &amp; Fan</span><div class="probe-key-cluster probe-angle-keys">${['KeyI','KeyJ','KeyK','KeyL'].map(probeKeycap).join('')}</div></div>
      <p class="probe-key-legend"><span>WASD Slide</span><span>Q/E Rotate</span><span>I/K Tilt</span><span>J/L Fan</span></p>
      <p class="probe-key-legend" data-probe="slide-direction-help">W/S Along Surface · A/D Sideways</p>
      <div class="probe-free-keys" data-probe="free-help" hidden>${['KeyR','KeyF'].map(probeKeycap).join('')}<span>Out of Plane</span></div>
      <p id="probeKeyboardHint">Hold a key or keycap. <kbd data-probe="precision-key">Shift</kbd> Fine<br><span data-probe="mouse-keyboard-hint">Mouse Orbits · Keyboard Steers</span></p>
     </section>
     <p class="probe-torso-help">Place Probe: Click / Drag on Skin<br>Whole Donor Heart · <a href="https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html" target="_blank" rel="noopener" title="BodyParts3D / DBCLS · CC BY 4.0. Illustrative chest, not donor-registered.">Reference Chest ↗</a></p>
    </aside>
   <section class="probe-comparison" aria-label="Equal-sized three-dimensional and ultrasound views"><div class="probe-primary-actions" role="group" aria-label="Choose how the mouse interacts"><button class="probe-primary-mode" type="button" data-probe-interaction="orbit" aria-pressed="true"><span class="probe-mode-icon" aria-hidden="true">↻</span><span><strong>Orbit the Heart</strong><small>Drag to Orbit · Scroll to Zoom</small></span></button><button class="probe-primary-mode" type="button" data-probe-interaction="probe" data-probe="capture" aria-pressed="false"><span class="probe-mode-icon" aria-hidden="true">⌖</span><span><strong data-probe="capture-label">Control the Probe</strong><small data-probe="capture-help">Mouse: Rotate ↔ · Tilt ↕</small></span><kbd data-probe="capture-key">↵</kbd></button></div>
    <div class="probe-comparison-headings"><div class="probe-scene-heading"><div><i aria-hidden="true"></i><strong>Probe &amp; Contact</strong></div><span data-probe="frame-state" role="status">Preparing scan</span></div><div class="probe-scene-heading"><strong data-probe="image-title">Simulated Ultrasound</strong><span class="probe-simulation-tag" data-probe="image-kind">CT-DERIVED</span></div></div>
    <div class="probe-view-pair">
     <div id="probeViewportMount" class="probe-viewport-mount" tabindex="0" aria-label="Three-dimensional probe workspace. Drag to orbit and scroll to zoom. Keyboard controls steer the probe throughout the TTE Lab.">
      <canvas class="probe-scene-mesh" data-probe="scene-mesh" aria-hidden="true"></canvas><canvas class="probe-guide" data-probe="guide" aria-hidden="true"></canvas><div class="probe-lock-badge" data-probe="lock-badge" hidden><span>Press <kbd>Esc</kbd> to release mouse control</span></div><div class="probe-click-hint" data-probe="click-hint">Drag to Orbit · Scroll to Zoom</div>
     </div>
     <div class="probe-image-panel" aria-label="Image from the same probe plane"><figure class="probe-image-wrap" data-probe="ultrasound-figure"><canvas data-probe="ultrasound" width="720" height="584" aria-label="Simulated ultrasound sector derived from this fixed CT volume"></canvas></figure><figure class="probe-image-wrap" data-probe="ct-figure" hidden><canvas data-probe="ct" width="720" height="584" aria-label="Measured CT intensities in the exact same ultrasound scan sector"></canvas></figure><span class="probe-image-marker" aria-label="Matching probe side marker">●</span><p class="probe-image-status" data-probe="image-status">Preparing the matched scan plane…</p><div class="probe-image-overlay"><span data-probe="simulation-label">Simulated ultrasound · CT-derived</span><span data-probe="acoustic-meta">3.5 MHz proxy · 145 mm</span></div></div>
    </div>
    <div class="probe-comparison-footers"><div class="probe-scene-footer"><div class="probe-view-actions"><button type="button" data-probe="explore">Oblique</button><button type="button" data-probe="face">Face Plane</button><button type="button" data-probe="frame">Frame Probe</button><label><input type="checkbox" data-probe="cutaway" checked> Cutaway</label><button type="button" data-probe="flip" aria-pressed="false">Flip Cut</button></div><div class="probe-contact-badge"><i aria-hidden="true"></i><span data-probe="contact-badge">Synthetic Skin · Contact Locked</span></div></div><div class="probe-image-footer"><div class="probe-image-modes" role="group" aria-label="Comparison Image"><button type="button" data-probe-image="ultrasound" aria-pressed="true">Simulated Ultrasound</button><button type="button" data-probe-image="ct" aria-pressed="false">Measured CT</button></div><div class="probe-image-meta"><span data-probe="resolution">Volume Resolution</span><span data-probe="sampling">Awaiting Volume</span></div><p class="probe-fine-status" data-probe="fine-status" role="status">Fine detail follows the probe.</p></div></div>
   </section>
  </div>
  <div class="workspace-secondary-tools">
  <details class="workspace-method-note"><summary>Model Notes <span>CT-Derived Simulation</span></summary><div class="workspace-method-body"><p class="probe-preset-note" data-probe="preset-note"></p><p class="probe-scene-caption">The heart is measured scan data; surrounding anatomy and contact surfaces are illustrative and unregistered. The probe, cut face and both image modes share one accepted plane.</p></div></details>
  <details class="probe-controls-panel"><summary>Probe Settings</summary><div class="probe-controls" aria-label="Probe Position and Imaging Controls">
   <section class="probe-controls-group"><h3>Move the Probe</h3>
    <label class="probe-contact-toggle"><input type="checkbox" data-probe="contact-locked" checked><span>Lock Probe to Contact Surface<small data-probe="contact-kind">Synthetic Skin Proxy</small></span></label>
    <p class="probe-contact-note" data-probe="contact-note">A synthetic positioning guide, not skin from the scanned donor.</p>

    <p class="probe-lock-state" data-probe="lock-status" role="status">Drag the heart to orbit. Keyboard controls steer the probe.</p>
    <div class="probe-mouse-modes" role="group" aria-label="Mouse orientation mode"><button type="button" data-probe-mouse="rotate" aria-pressed="true">Rotate + Tilt</button><button type="button" data-probe-mouse="steer" aria-pressed="false">Fan + Tilt</button></div>
    <div class="probe-steer-pad" data-probe="steer-pad" tabindex="0" role="group" aria-label="Drag horizontally to rotate the probe and vertically to tilt. Use the orientation controls below for keyboard access."><svg viewBox="0 0 140 64" aria-hidden="true"><path d="M70 8v48M46 32h48M70 8l-4 6m4-6 4 6M70 56l-4-6m4 6 4-6M46 32l6-4m-6 4 6 4M94 32l-6-4m6 4-6 4"/></svg><span>Drag: rotate ↔ · tilt ↕</span></div>
    <div class="probe-key-guide"><span><kbd>W</kbd><kbd>S</kbd> <span data-probe="advance-help">Along the surface</span></span><span><kbd>A</kbd><kbd>D</kbd> Slide sideways</span><span><kbd>Q</kbd><kbd>E</kbd> Rotate</span><span><kbd>I</kbd><kbd>K</kbd> Tilt</span><span><kbd>J</kbd><kbd>L</kbd> Fan</span><span><kbd>Alt</kbd> + mouse = fan</span><span><kbd>Shift</kbd> = precision</span></div>
    <div class="probe-pose-readout"><span>PROBE POSITION · MM FROM SCAN CENTER</span><output data-probe="position">0.0 / 0.0 / 0.0</output><span data-probe="angles">Fan 0° · Tilt 0° · Rotation 0°</span></div>
    <button class="probe-reset" type="button" data-probe="reset">↺ Reset Probe Position</button>
   </section>
   <section class="probe-controls-group"><h3>Position &amp; Imaging Depth</h3>
<div class="probe-acoustic-controls">${range('depthMm','Imaging depth',65,190,1,' mm')}${range('gainDb','Gain',-18,18,1,' dB')}</div>
    <details class="probe-detail-controls"><summary>Position &amp; Angle Controls</summary><p data-probe="position-help">Buttons slide the probe 5 mm along the contact surface. Steering pivots around its contact point.</p>
     <div class="probe-step-row"><span data-probe="advance-label">Along surface</span><button type="button" data-probe-step="advance:-1" aria-label="Move backward by 5 millimetres">−</button><button type="button" data-probe-step="advance:1" aria-label="Move forward by 5 millimetres">+</button></div>
     <div class="probe-step-row"><span>Sideways</span><button type="button" data-probe-step="lateral:-1" aria-label="Slide probe left by 5 millimetres">−</button><button type="button" data-probe-step="lateral:1" aria-label="Slide probe right by 5 millimetres">+</button></div>
     <div class="probe-step-row" data-probe="elevation-controls" hidden><span>Out of plane</span><button type="button" data-probe-step="elevation:-1" aria-label="Move probe down by 5 millimetres">−</button><button type="button" data-probe-step="elevation:1" aria-label="Move probe up by 5 millimetres">+</button></div>
     ${range('sweepDeg','Fan',-180,180,.5,'°')}${range('tiltDeg','Tilt',-85,85,.5,'°')}${range('rollDeg','Rotation',-180,180,.5,'°')}${range('speedMm','Travel speed',4,55,1,' mm/s')}
    </details>
   </section>
   <section class="probe-controls-group"><h3>Image &amp; Display</h3>
    <details class="probe-detail-controls probe-image-options"><summary>Image &amp; Display Controls</summary>${range('angleDeg','Sector width',35,110,1,'°')}${range('frequencyMHz','Frequency proxy',1.5,7,.5,' MHz')}${range('dynamicRangeDb','Dynamic range',35,80,1,' dB')}${range('shadow','Attenuation & shadow',0,1,.05,'')}<label class="probe-checkbox"><input type="checkbox" data-probe="show-guide" checked> Show Probe &amp; Sector</label><label class="probe-checkbox"><input type="checkbox" data-probe="show-surface" checked> Show Contact Surface</label><label class="probe-material">Tissue Style <select data-probe="material" aria-label="Tissue color style">${RENDER_STYLES.map(p=>`<option value="${p.id}">${titleCaseUi(p.name)}</option>`).join('')}</select></label></details>
    <details class="probe-method"><summary>What This Simulation Represents</summary><p>The fitted chest skin and illustrative esophageal wall constrain probe contact. Chest Orientation shows the complete prepared surface of this donor, with the same accepted probe origin, axes, physical instrument size and scan sector as the main view. Its fitted BodyParts3D chest is fixed across all starting views and remains illustrative, not donor-registered. Orbiting that overview changes only its camera. External probe contact follows the displayed skin triangles. Place Probe selects any visible skin surface; WASD continues sliding across that surface. W moves toward the head and S toward the feet. A/D moves left/right around the chest as seen from the Front view; these directions stay attached to the chest when you orbit. Q/E rotates counterclockwise/clockwise when looking along the beam from the handle toward the skin. I/K tilts and J/L fans relative to the selected starting plane. The finite edge of the cropped chest is the travel boundary. The amber indicator identifies the marked side of the ultrasound image.</p><p>The heart sections come from measured scan data. Ultrasound appearance uses intensity changes as interface proxies, angle-sensitive reflections, tissue-fixed speckle and attenuation. HiP-CT does not measure acoustic impedance, and the fixed scan contains no heart motion.</p><p>With Clean Scan enabled, the current ${this.fineLabel} source plane drives the cut face, measured CT and simulated image together. Nearby source blocks are retained and prepared during quiet periods. During movement, a lighter preview follows the probe. Fine source blocks continue loading during movement; cached sections refine the moving plane, and a pause sharpens both views together. Source and displayed plane spacing are shown separately.</p><a href="https://pubmed.ncbi.nlm.nih.gov/19249113/" target="_blank" rel="noopener">Background: Ray-Based CT-to-Ultrasound Simulation ↗</a></details>   </section>
  </div></details></div>`;}

 $(key){return this.mount.querySelector(`[data-probe="${key}"]`);}
 bind(){
  this.pointerControls=new Map();
  this.mount.querySelectorAll('[data-probe-preset]').forEach(button=>button.addEventListener('click',()=>this.selectPreset(button.dataset.probePreset)));
  this.mount.querySelectorAll('[data-probe-torso-view]').forEach(button=>button.addEventListener('click',()=>{this.torsoView?.setView(button.dataset.probeTorsoView);this.guideKey='';this.drawGuide();}));
  this.$('place-skin').addEventListener('click',()=>{const enabled=!this.torsoView?.placementMode;this.torsoView?.setPlacementMode(enabled);this.$('place-skin').setAttribute('aria-pressed',String(enabled));});
  this.$('contact-locked').addEventListener('change',()=>{this.state=setProbeContactLocked(this.state,this.frameForState(),this.$('contact-locked').checked);this.ensureOrigin();this.poseChanged();});
  this.$('reset').addEventListener('click',()=>this.reset());
  for(const name of ['explore','face','frame'])this.$(name).addEventListener('click',()=>this.orientCamera(name));
  this.$('cutaway').addEventListener('change',()=>{this.state.cutaway=this.$('cutaway').checked;this.applyDisplayPlane();});
  this.$('show-guide').addEventListener('change',()=>{this.state.showGuide=this.$('show-guide').checked;this.guideKey='';this.drawGuide();});
  this.$('show-surface').addEventListener('change',()=>{this.state.showSurface=this.$('show-surface').checked;this.guideKey='';this.drawGuide();});
  this.$('flip').addEventListener('click',()=>{this.state.flip=!this.state.flip;this.updateUI();this.applyDisplayPlane();});
  this.$('material').addEventListener('change',()=>{this.renderer.set({palette:Number(this.$('material').value)});this.appearance?.changed();this.updateAppearance();});
  this.mount.querySelectorAll('[data-probe-mouse]').forEach(button=>button.addEventListener('click',()=>{this.mouseMode=button.dataset.probeMouse;this.updateControlStatus();}));
  this.mount.querySelectorAll('[data-probe-interaction]').forEach(button=>button.addEventListener('click',()=>{this.setInteractionMode(button.dataset.probeInteraction);if(button.dataset.probeInteraction==='probe')this.captureControl();}));
  this.mount.querySelectorAll('[data-probe-image]').forEach(button=>button.addEventListener('click',()=>{this.state.imageMode=button.dataset.probeImage;this.updateUI();}));
  this.mount.querySelectorAll('[data-probe-range]').forEach(input=>input.addEventListener('input',()=>{this.state=sanitizeProbeState({...this.state,[input.dataset.probeRange]:Number(input.value)});if(input.dataset.probeRange==='speedMm')this.updateUI();else this.poseChanged();}));
  this.mount.querySelectorAll('[data-probe-step]').forEach(button=>button.addEventListener('click',()=>{const [axis,direction]=button.dataset.probeStep.split(':');if(!this.frameForState())return;this.state=moveProbeState(this.state,this.frameForState(),{[axis]:Number(direction)},probePhysicalLimits(this.state.referenceMm).step);this.poseChanged();}));
  this.mount.querySelectorAll('[data-probe-key]').forEach(button=>{
   this.bindSteeringSurface(button);
   button.addEventListener('pointerdown',event=>{
    if(!this.active||document.hidden||event.button!==0||event.ctrlKey||event.metaKey||event.altKey||button.disabled||this.pointerControls.has(event.pointerId))return;
    event.preventDefault();button.focus({preventScroll:true});this.shiftHeld=!!event.shiftKey;this.pointerControls.set(event.pointerId,{code:button.dataset.probeKey,button});
    try{button.setPointerCapture?.(event.pointerId);}catch{}
    this.nudgeKey(button.dataset.probeKey,event.shiftKey);this.updateKeyFeedback();
   });
   for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,event=>this.releasePointerControl(event.pointerId));
   button.addEventListener('click',event=>{if(!(event.detail>0)&&!(event.pointerId>0))this.nudgeKey(button.dataset.probeKey,event.shiftKey);});
  });
  const viewport=this.mount.querySelector('#probeViewportMount');
  const sceneGesture=event=>{
   if(!this.active||this.state.interactionMode!=='probe'||this.isLocked()||event.button>0||event.target.closest?.('button,a,input,select'))return;
   event.preventDefault();event.stopPropagation();
   if(event.type==='pointerdown'){this.lastSceneCapture=performance.now();this.captureControl(false);}
   else if(!this.lockRequested&&performance.now()-(this.lastSceneCapture||-1000)>350)this.captureControl(false);
  };
  // A direct gesture on the visual is sufficient; no second button click is
  // needed. Capture phase prevents the same press from starting camera orbit.
  viewport.addEventListener('pointerdown',sceneGesture,true);viewport.addEventListener('click',sceneGesture,true);
  const pad=this.$('steer-pad');
  this.bindSteeringSurface(pad);
  pad.addEventListener('pointerdown',event=>{if(!this.active||document.hidden||this.drag||event.button!==0||event.ctrlKey||event.metaKey)return;event.preventDefault();this.setInteractionMode('probe');pad.focus({preventScroll:true});this.drag={id:event.pointerId,x:event.clientX,y:event.clientY};try{pad.setPointerCapture?.(event.pointerId);}catch{}pad.classList.add('is-dragging');});
  pad.addEventListener('pointermove',event=>{if(this.drag?.id!==event.pointerId)return;event.preventDefault();this.mouseMove(event.clientX-this.drag.x,event.clientY-this.drag.y,event.altKey,event.shiftKey);this.drag.x=event.clientX;this.drag.y=event.clientY;});
  const endDrag=event=>{if(this.drag?.id===event.pointerId)this.releaseDrag();};
  for(const type of ['pointerup','pointercancel','lostpointercapture'])pad.addEventListener(type,endDrag);
  document.addEventListener('pointerlockchange',()=>this.pointerLockChanged());
  document.addEventListener('pointerlockerror',()=>{if(this.lockRequested&&this.captureWanted)this.captureUnavailable('Cursor capture is unavailable here. Drag the steering pad or use the controls below.');});
  document.addEventListener('mousemove',event=>{if(!this.hasControl())return;event.preventDefault();event.stopPropagation();this.mouseMove(event.movementX||0,event.movementY||0,event.altKey,event.shiftKey);},true);
  // The locked target is our DIV, not the orbit canvas. Capture is also a guard
  // against providers which retarget pointer events to the old canvas.
  for(const type of ['pointerdown','pointermove','pointerup','click','dblclick'])document.addEventListener(type,event=>{if(this.hasControl()){event.preventDefault();event.stopPropagation();}},true);
  document.addEventListener('keydown',event=>this.keyDown(event),true);
  document.addEventListener('keyup',event=>{const held=this.keys.delete(event.code);if(precisionKey(event.code))this.shiftHeld=!!event.shiftKey;if(held&&this.active&&!precisionKey(event.code))event.preventDefault();if(held||precisionKey(event.code))this.updateKeyFeedback();},true);
  for(const type of ['pointerup','pointercancel'])window.addEventListener(type,event=>{this.releasePointerControl(event.pointerId);if(this.drag?.id===event.pointerId)this.releaseDrag();});
  window.addEventListener('blur',()=>{if(this.active)this.releaseControl();});
  window.addEventListener('pagehide',()=>{if(this.active)this.releaseControl();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&this.active)this.releaseControl();});
  document.addEventListener('focusin',event=>{if(this.active&&(controlIsEditable(event.target)||event.target?.closest?.('input')))this.releaseKeyboardControls();});
  this.mount.addEventListener('wheel',event=>{if(this.hasControl()){event.preventDefault();event.stopPropagation();}},{capture:true,passive:false});
  if(typeof ResizeObserver==='function'){this.resizeObserver=new ResizeObserver(()=>{this.guideKey='';if(this.active)this.drawGuide();});this.resizeObserver.observe(this.mount);}
 }

 // A steering press is an ongoing control gesture, not selectable prose. Keep
 // this local to the keycaps/pad so descriptions, links and fields retain their
 // native selection, context menus, scrolling and zoom behavior.
 bindSteeringSurface(control){
  for(const type of ['selectstart','contextmenu','dragstart'])control.addEventListener(type,event=>{
   event.preventDefault();
   // If a browser cannot cancel its menu, do not keep moving behind that menu.
   if(type==='contextmenu'&&!event.defaultPrevented&&this.active)this.releaseControl();
  });
 }

 setFrames(input){
  if(input?.datasetId&&this.donor.datasetId&&String(input.datasetId)!==String(this.donor.datasetId))throw new Error('These probe starting planes belong to a different donor.');
  this.frames={};const source=input?.frames||input?.planes||input||{};for(const [id,item] of (Array.isArray(source)?source.map(p=>[p.id,p]):Object.entries(source))){const frame=item?.world||item;if(finiteVector(frame?.center)&&finiteVector(frame?.right)&&finiteVector(frame?.up))this.frames[id]={...frame,note:item.note||frame.note||''};}
  // The catalog extent keeps specimen-specific targets in the same normalized
  // space before the volume loads. TEE inherits these targets for pose fitting.
  this.frames=buildDonorEchoFrames(this.frames,{donorId:this.donor.datasetId||input?.datasetId||this.donor.id,referenceMm:Number(input?.referenceMm)>0?Number(input.referenceMm):this.geometry?.longestMm});
 }
 async init(){
  if(Object.keys(this.frames).length)return this;
  if(!this.initPromise)this.initPromise=(async()=>{const url=this.donor.echoPlanesUrl===undefined?'./assets/echo-planes.json':this.donor.echoPlanesUrl;if(!url)throw new Error('Probe reference geometry has not been prepared for this donor.');const response=await fetch(url);if(!response.ok)throw new Error('Probe reference geometry is unavailable.');this.setFrames(await response.json());if(!this.frameForState())throw new Error('Probe reference geometry is incomplete.');return this;})().catch(error=>{this.initPromise=null;throw error;});
  return this.initPromise;
 }
 frameForState(state=this.state){const frame=this.frames[PROBE_PRESETS.find(p=>p.id===state.preset)?.frame],model=this.torsoView?.model;return frame?{...frame,referenceMm:this.geometry?.longestMm||state.referenceMm||PROBE_REFERENCE_MM,...(model?{skinContactSurface:createSkinContactSurface(model)}:{})}:null;}
 getPose(){return probePose(this.state,this.frameForState());}
 ensureOrigin(){
  const frame=this.frameForState();if(!frame)return;
  this.state=initializeProbeEntry(this.state,frame);
  if(this.state.contactLocked){
   const surface=probeContactSurface(this.state.preset,frame);
   if(surface.kind==='body-skin'){
    if(this.state.skinContact?.sourceKey!==surface.key){
     const legacy=probePose(this.state,{...frame,skinContactSurface:null}),fresh=!this.state.skinContact&&(!this.state.contactPositionMm||this.state.contactPositionMm.every(v=>Math.abs(v)<1e-7));
     const contact=fresh?initialSkinContact(surface,frame,legacy.originMm):restoreSkinContact(surface,{pointMm:this.state.skinContact?.pointMm||legacy.originMm,right:this.state.skinContact?.right||legacy.right});
     const beam=fresh?norm(mul(frame.center,frame.referenceMm).map((v,i)=>v-contact.pointMm[i])):legacy.beam;
     let right=add(legacy.right,mul(beam,-dot(legacy.right,beam)));right=Math.hypot(...right)>1e-6?norm(right):contact.right;
     this.state=sanitizeProbeState({...this.state,skinContact:contact,contactPositionMm:null,...anglesForProbePose({beam,right,normal:norm(cross(beam,right))},contact.right,contact.inward)});
    }
    this.state.originMm=[...this.state.skinContact.pointMm];
   }else{this.state.contactPositionMm=contactCoordinates(this.state,surface);this.state.originMm=contactFrame(surface,...this.state.contactPositionMm).pointMm;}
  }
  else if(!this.state.originMm)this.state.originMm=defaultOrigin(frame,this.state.depthMm);
 }

 setFineSource(source){this.abortFine();this.reusableFineSlice=null;this.fineSource=source;if(this.active)this.requestFrame(false);}

 setVolume(data,meta){
  if(data===this.data&&meta===this.meta)return;
  this.abortFine();this.data=data;this.meta=meta;this.geometry=volumeGeometry(meta);this.state=rescaleProbeState(this.state,this.geometry.longestMm);this.version++;this.displayedFrame=null;this.displayedId=-1;this.guideKey='';this.stopWorker();this.updateUI();
  this.$('resolution').textContent=`${this.geometry.spacingUm.toFixed(1)} µm volume preview`;
  if(this.torsoView)this.updateTorsoSource();
  if(this.active){this.renderer.clearCapData();this.$('image-status').hidden=false;this.$('image-status').textContent='Preparing the current volume…';this.ensureWorker();this.requestFrame(false);}
 }
 async enter(){
  const generation=this.enterGeneration=(this.enterGeneration||0)+1;
  this.active=true;this.mount.hidden=false;this.renderer.autoRotate=false;cancelAnimationFrame(this.raf);clearTimeout(this.refineTimer);
  try{await this.init();}catch(error){if(this.active&&generation===this.enterGeneration){this.$('image-status').hidden=false;this.$('image-status').textContent='Starting geometry could not load. Return and try the TTE Lab again.';this.toast(error.message);}return;}
  if(!this.active||generation!==this.enterGeneration)return;
  this.ensureOrigin();this.ensureScene();this.updateUI();this.updateAppearance(false);this.applyDisplayPlane();this.orientCamera('explore');
  this.ensureWorker();this.requestFrame(false);
  this.lastTick=performance.now();this.raf=requestAnimationFrame(time=>this.tick(time));
 }
 leave(){
  this.enterGeneration=(this.enterGeneration||0)+1;this.active=false;this.releaseControl();this.abortFine();this.fineSource?.cancelWarm?.();clearTimeout(this.sampleTimer);this.sampleTimer=0;clearTimeout(this.refineTimer);cancelAnimationFrame(this.raf);this.raf=0;this.stopWorker();this.version++;this.renderer.clearCapData();
  this.torsoView?.setActive(false);
  this.sceneOverlay?.setActive?.(false);
 }
 getState(){this.ensureOrigin();const donorPlaneRevision=echoDonorPlaneRevision(this.frames);return copy({...this.state,originMm:this.state.originMm||this.getPose()?.originMm||null,...(donorPlaneRevision?{donorPlaneRevision}:{})});}
 restore(saved={}){
  this.releaseControl();const donorPlaneRevision=echoDonorPlaneRevision(this.frames),stale=donorPlaneRevision&&saved.donorPlaneRevision!==donorPlaneRevision;
  this.state=sanitizeProbeState({interactionMode:'orbit',...saved});if(this.geometry)this.state=rescaleProbeState(this.state,this.geometry.longestMm);
  if(this.state.skinContact)this.state.skinContact.sourceKey='';
  if(stale)this.state=this.startingPresetState(this.state.preset,{...this.state,interactionMode:'orbit',donorPlaneRevision});
  this.ensureOrigin();this.updateUI();if(this.active){this.invalidatePending();this.poseChanged(true);}
 }
 reset(){this.selectPreset(this.state.preset);}
 startingPresetState(id,current=this.state){
  const preset=PROBE_PRESETS.find(p=>p.id===id)||PROBE_PRESETS[0];
  return sanitizeProbeState({...current,preset:preset.id,originMm:null,skinContact:null,contactLocked:true,contactPositionMm:[0,0],sweepDeg:0,tiltDeg:0,rollDeg:0,probeEntryKey:null,depthMm:probePresetDepth(preset.id,this.frameForState({...current,preset:preset.id})),angleDeg:preset.angleDeg});
 }
 selectPreset(id){
  this.releaseKeyboardControls();this.releaseDrag();this.state=this.startingPresetState(id);this.ensureOrigin();this.invalidatePending();this.poseChanged(true);if(this.active)this.orientCamera('explore');
 }

 isLocked(){return document.pointerLockElement===this.mount.querySelector('#probeViewportMount');}
 hasControl(){return this.active&&this.captureWanted&&this.isLocked();}
 async captureControl(toggle=true){
  if(this.isLocked()){if(toggle)this.releaseControl();return;}if(!this.active||this.lockRequested)return;
  const target=this.mount.querySelector('#probeViewportMount'),epoch=++this.captureEpoch;
  this.state.interactionMode='probe';this.captureWanted=true;this.controlMessage='';
  if(typeof target.requestPointerLock!=='function'){
   this.captureUnavailable('Cursor capture is unavailable here. Drag the steering pad, or use the buttons and sliders.');return;
  }
  this.lockRequested=true;this.updateControlStatus();
  try{
   // Browsers expose either a void or Promise-returning request. Intent must
   // outlive neither Escape nor a module switch, even if a grant arrives late.
   const result=target.requestPointerLock();if(result?.then)await result;
   if(epoch!==this.captureEpoch||!this.captureWanted){if(!this.captureWanted&&this.isLocked())document.exitPointerLock?.();return;}
   if(this.isLocked())this.pointerLockChanged();
  }catch{
   if(epoch!==this.captureEpoch||!this.captureWanted)return;
   this.captureUnavailable('Cursor capture was not enabled. Drag the steering pad, or try Control the probe again.');
  }
 }
 captureUnavailable(message){
  this.lockRequested=false;this.captureWanted=false;this.controlMessage=message;
  this.mount.querySelector('.probe-controls-panel').open=true;this.$('steer-pad').focus();this.updateControlStatus();
 }
 pointerLockChanged(){
  const locked=this.isLocked(),previous=this.nativeWasLocked;this.nativeWasLocked=locked;
  if(locked){
   this.lockRequested=false;this.releaseKeyboardControls();
   if(!this.active||!this.captureWanted||this.state.interactionMode!=='probe'){
    // Do not let an already-cancelled request recapture after Escape.
    document.exitPointerLock?.();this.updateControlStatus();return;
   }
   this.mount.querySelector('#probeViewportMount').focus();this.controlMessage='';
  }else if(previous){
   // Native Escape can unlock without delivering a DOM keydown at all.
   this.releaseControl({exitNative:false});return;
  }
  this.updateControlStatus();
 }
 releaseDrag(){
  const pad=this.$('steer-pad'),id=this.drag?.id;this.drag=null;pad?.classList.remove('is-dragging');
  if(id!==undefined){try{pad?.releasePointerCapture?.(id);}catch{/* Capture may already have ended. */}}
 }
 releaseControl({exitNative=true}={}){
  ++this.captureEpoch;this.captureWanted=false;this.lockRequested=false;this.nativeWasLocked=false;
  this.releaseKeyboardControls();this.releaseDrag();this.controlMessage='';this.state.interactionMode='orbit';
  const target=this.mount.querySelector('#probeViewportMount'),focused=document.activeElement;
  if(focused===target||focused===this.$('steer-pad'))focused.blur?.();
  if(exitNative&&this.isLocked())document.exitPointerLock?.();
  // Fullscreen is owned by the shared viewer. Releasing the cursor does not
  // exit that view or request another lock; only a new explicit gesture can.
  this.updateControlStatus();
 }
 setInteractionMode(mode){this.state.interactionMode=mode==='orbit'?'orbit':'probe';this.releaseKeyboardControls();if(this.state.interactionMode==='orbit')this.releaseControl();this.updateControlStatus();}
 updateControlStatus(){
  const locked=this.hasControl();this.mount.classList.toggle('probe-is-locked',locked);this.$('lock-badge').hidden=!locked;
  this.$('capture-label').textContent=locked?'Release Probe Control':'Control the Probe';this.$('capture-key').textContent=locked?'Esc':'↵';this.$('capture').setAttribute('aria-pressed',String(this.state.interactionMode==='probe'));
  this.$('lock-status').textContent=this.controlMessage||(locked?`${this.mouseMode==='rotate'?'Horizontal motion rotates; vertical motion tilts.':'Horizontal motion fans; vertical motion tilts.'} Press Esc to release mouse control.`:this.state.interactionMode==='orbit'?'Drag the heart to orbit and scroll to zoom. The keyboard steers the probe in either mouse mode.':'Click the 3D view for mouse steering. The keyboard is already active. Escape releases mouse control.');
  this.$('click-hint').hidden=locked;this.$('click-hint').textContent=this.state.interactionMode==='orbit'?'Drag to Orbit · Scroll to Zoom':'Click the 3D View for Mouse Steering';
  this.$('mouse-keyboard-hint').textContent=this.state.interactionMode==='orbit'?'Mouse Orbits · Keyboard Steers':'Mouse & Keyboard Steer the Probe';
  this.mount.classList.toggle('probe-orbit-mode',this.state.interactionMode==='orbit');
  this.mount.querySelectorAll('[data-probe-interaction]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.probeInteraction===this.state.interactionMode)));
  this.mount.querySelectorAll('[data-probe-mouse]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.probeMouse===this.mouseMode)));
  this.$('steer-pad').querySelector('span').textContent=this.mouseMode==='rotate'?'Drag: Rotate ↔ · Tilt ↕':'Drag: Fan ↔ · Tilt ↕';
  this.$('capture-help').textContent=this.mouseMode==='rotate'?'Mouse: Rotate ↔ · Tilt ↕':'Mouse: Fan ↔ · Tilt ↕';
  this.updateKeyFeedback();
 }
 releaseKeyboardControls(){
  this.keys.clear();this.shiftHeld=false;
  for(const id of this.pointerControls?.keys()||[])this.releasePointerControl(id);
  this.updateKeyFeedback();
 }
 releasePointerControl(id){
  const control=this.pointerControls?.get(id);if(!control)return;
  this.pointerControls.delete(id);try{control.button.releasePointerCapture?.(id);}catch{}
  this.updateKeyFeedback();
 }
 activeSteeringKeys(){return new Set([...this.keys,...[...(this.pointerControls?.values()||[])].map(control=>control.code)]);}
 fineSteering(){return this.shiftHeld||this.keys.has('ShiftLeft')||this.keys.has('ShiftRight');}
 updateKeyFeedback(){
  const held=this.activeSteeringKeys();
  this.mount.querySelectorAll('[data-probe-key]').forEach(button=>{
   const unavailable=this.state.contactLocked&&['KeyR','KeyF'].includes(button.dataset.probeKey),down=!unavailable&&held.has(button.dataset.probeKey);
   button.disabled=unavailable;button.classList.toggle('is-held',down);button.setAttribute('aria-pressed',String(down));
  });
  this.$('precision-key')?.classList.toggle('is-held',!!this.fineSteering());
 }
 nudgeKey(code,fine=false){
  const binding=probeSteeringKeys[code],frame=this.frameForState();
  if(!this.active||!binding||!frame||(this.state.contactLocked&&binding[0]==='elevation'))return;
  const [axis,direction]=binding,precision=fine ? .2 : 1;
  if(['advance','lateral','elevation'].includes(axis))this.state=moveProbeState(this.state,frame,{[axis]:direction},probePhysicalScale(this.state.referenceMm)*precision);
  else this.state=steerProbe(this.state,{[axis]:direction*precision});
  this.poseChanged();
 }
 keyDown(event){
  if(!this.active)return;
  if(event.target===this.$('torso')&&/^(Arrow(Left|Right|Up|Down)|r|R|\+|=|-)$/.test(event.key))return;
  if(event.code==='Escape'||event.key==='Escape'||event.key==='Esc'){
   const focused=document.activeElement,ownsGesture=this.captureWanted||this.lockRequested||this.isLocked()||this.drag||this.keys.size||
    (this.state.interactionMode==='probe'&&(focused===this.mount.querySelector('#probeViewportMount')||focused===this.$('steer-pad')));
   if(ownsGesture){event.preventDefault();event.stopPropagation?.();this.releaseControl();}else this.releaseKeyboardControls();return;
  }
  if(event.ctrlKey||event.metaKey||event.altKey||event.isComposing||document.hidden||controlIsEditable(event.target)||controlIsEditable(document.activeElement)){this.releaseKeyboardControls();return;}
  if((event.code==='Enter'||event.code==='Space')&&document.activeElement===this.mount.querySelector('#probeViewportMount')&&this.state.interactionMode==='probe'){event.preventDefault();event.stopPropagation();this.captureControl(false);return;}
  if(!probeSteeringKeys[event.code]&&!precisionKey(event.code))return;
  if(this.state.contactLocked&&(event.code==='KeyR'||event.code==='KeyF'))return;
  // A held key resumes only with a fresh press after blur, reset or text entry.
  if(event.repeat&&!this.keys.has(event.code))return;
  if(!precisionKey(event.code)){event.preventDefault();event.stopPropagation();}
  this.shiftHeld=!!event.shiftKey||precisionKey(event.code);
  const first=!this.keys.has(event.code);this.keys.add(event.code);
  if(first&&!precisionKey(event.code))this.nudgeKey(event.code,this.fineSteering());
  this.updateKeyFeedback();
 }
 mouseMove(dx,dy,alt=false,precision=false){
  if(!this.active||(!dx&&!dy))return;const scale=precision ? .045 : .16;
  this.state=steerProbe(this.state,alt||this.mouseMode==='steer'?{sweep:dx*scale,tilt:dy*scale}:{roll:dx*scale,tilt:dy*scale});this.poseChanged();
 }
 tick(time){
  if(!this.active)return;const dt=Math.min(.05,Math.max(0,(time-this.lastTick)/1000));this.lastTick=time;
  if(document.hidden||controlIsEditable(document.activeElement))this.releaseKeyboardControls();
  const k=this.activeSteeringKeys(),precision=this.fineSteering(),step=dt*this.state.speedMm*(precision ? .20 : 1),pose=this.getPose();
  const advance=Number(k.has('KeyW'))-Number(k.has('KeyS')),lateral=Number(k.has('KeyD'))-Number(k.has('KeyA')),elevation=this.state.contactLocked?0:Number(k.has('KeyR'))-Number(k.has('KeyF')),roll=Number(k.has('KeyE'))-Number(k.has('KeyQ')),tilt=Number(k.has('KeyK'))-Number(k.has('KeyI')),sweep=Number(k.has('KeyL'))-Number(k.has('KeyJ'));
  if(pose&&(advance||lateral||elevation||roll||tilt||sweep)){
   if(advance||lateral||elevation)this.state=moveProbeState(this.state,this.frameForState(),{advance,lateral,elevation},step);
   if(roll||tilt||sweep)this.state=steerProbe(this.state,{roll:roll*dt*36*(precision ? .2 : 1),tilt:tilt*dt*28*(precision ? .2 : 1),sweep:sweep*dt*28*(precision ? .2 : 1)});
   this.poseChanged(false,false);if(time-(this.lastUI||0)>90){this.updateUI();this.lastUI=time;}
  }
  // This inexpensive overlay follows every camera provider, including controls
  // which do not emit an onChange event. It never requests a volume render.
  this.drawGuide();this.raf=requestAnimationFrame(next=>this.tick(next));
 }
 poseChanged(hard=false,update=true){
  this.poseRevision++;this.ensureOrigin();
  if(update)this.updateUI();if(!this.active)return;
  this.renderer.lastInteraction=performance.now();
  this.pauseFineForMotion();
  clearTimeout(this.refineTimer);this.refineTimer=setTimeout(()=>{this.updateUI();this.requestFrame(false);},190);
  if(hard){clearTimeout(this.sampleTimer);this.sampleTimer=0;this.requestFrame(true);return;}
  if(!this.sampleTimer)this.sampleTimer=setTimeout(()=>{this.sampleTimer=0;this.requestFrame(true);},28);
 }
 invalidatePending(){this.abortFine();this.minFrameId=this.sequence+1;this.worker?.postMessage({type:'cancel'});this.fallbackEpoch=(this.fallbackEpoch||0)+1;this.fallbackLatest=null;}

 ensureWorker(){
  if(!this.active||!this.data||!this.meta||this.worker||this.workerUnavailable)return;
  try{
   const worker=new Worker(new URL('./probe-acoustics-worker.js',import.meta.url),{type:'module'});this.worker=worker;this.workerSupport=this.appearance?.cleanup||null;
   worker.onmessage=event=>{if(worker!==this.worker||!this.active)return;const message=event.data;if(message.type==='frame'){this.acceptFrame(message);this.finishFineFrame(message);}else if(message.type==='error'&&message.version===this.version){if(message.fine){if(message.refinementToken===this.fineGeneration)this.fineError(message.message);this.finishFineFrame(message);}else this.sampleError(message.message);}};
   worker.onerror=()=>{if(worker!==this.worker)return;worker.terminate();this.worker=null;this.workerUnavailable=true;this.abortFine();if(this.active)this.requestFrame(true);};
   worker.postMessage({type:'load',version:this.version,data:this.data,meta:this.meta,support:this.workerSupport?{data:this.workerSupport.data,dimensions:this.workerSupport.dimensions}:null});
  }catch{this.workerUnavailable=true;}
 }
 stopWorker(){this.worker?.terminate();this.worker=null;this.workerSupport=null;this.fallbackEpoch=(this.fallbackEpoch||0)+1;this.fallbackLatest=null;}
 requestFrame(fast=false){
  if(!this.active||!this.data||!this.geometry)return;this.ensureOrigin();const pose=this.getPose();if(!pose)return;
  const pane=this.$(this.state.imageMode==='ct'?'ct':'ultrasound'),paneWidth=pane.getBoundingClientRect?.().width||800,width=paneWidth*Math.min(globalThis.devicePixelRatio||1,1.25);
  if(!fast)this.stopMovingDetail();
  this.ensureWorker();const request={type:'sample',id:++this.sequence,version:this.version,poseRevision:this.poseRevision,pose,state:copy(this.state),fineSpacingUm:this.fineSpacingUm,fast,cleanupEnabled:this.renderer.settings.cleanupEnabled!==false,...probeFrameQuality(this.state,width,fast)};
  // Include the actual display budget so release requests refine once, while
  // repeats of the same settled geometry/settings remain deduplicated.
  request.workKey=JSON.stringify([request.version,request.poseRevision,request.cleanupEnabled,request.width,request.beams,request.samples,request.capLongest,request.fineSpacingUm,pose.originMm,pose.right,pose.beam,this.state.depthMm,this.state.angleDeg,this.state.gainDb,this.state.frequencyMHz,this.state.dynamicRangeDb,this.state.shadow]);
  if(fast){
   this.pauseFineForMotion();
   const cached=this.reusableFineSlice,plane=probeCapPlane(pose,this.geometry);
   // A turn within an already measured section can reuse its pixels immediately.
   // A shifted/tilted section must instead sample the resident 3D volume; no
   // network request or stale image is allowed on this live path.
   if(request.cleanupEnabled&&cached?.version===this.version&&validFineProbeSlice(cached,plane,this.fineSpacingUm,this.geometry))Object.assign(request,{fineSlice:cached,refinementToken:this.fineGeneration,capLongest:Math.max(request.capLongest,Math.min(1280,Math.max(cached.width,cached.height)))});
   this.$('frame-state').textContent='Following Probe';
   this.$('fine-status').textContent='Live Preview · Fine Detail Streams Along the Probe';
   this.dispatchFrame(request);this.scheduleMovingDetail(request);return;
  }
  if(this.fineSource?.samplePlane&&request.cleanupEnabled){
   if(this.fineRunning?.request.workKey===request.workKey||this.fineLatest?.workKey===request.workKey)return;
   if(this.displayedFrame?.fine&&this.displayedFrame.id>=this.minFrameId&&this.displayedFrame.workKey===request.workKey){this.fineSource?.scheduleWarmPlane?.(this.displayedFrame.plane);return;}
   if(this.fineRunning)this.pauseFineForMotion();
   this.previewLatest=request;this.fineLatest=request;
   void this.requestFine();
   // Prepared entry planes get a short head start; cold data never holds the
   // interface hostage. During input the live branch above is immediate.
   if(!this.previewTimer)this.previewTimer=setTimeout(()=>{this.previewTimer=0;this.dispatchPreview();},75);
  }else{this.$('frame-state').textContent='Following Probe';this.dispatchFrame(request);}
 }
 pauseFineForMotion(){
  const computing=this.fineRunning?.phase==='acoustics';
  if(this.fineRunning||this.fineLatest||this.previewLatest){
   this.abortFine({keepMoving:true});
   if(computing){this.worker?.postMessage({type:'cancel'});this.fallbackEpoch=(this.fallbackEpoch||0)+1;this.fallbackLatest=null;}
  }
  this.fineSource?.cancelWarm?.();
 }
 // Live planes never wait for network. A coalesced cache-only reformat can
 // sharpen the current accepted pose, while a separate bounded source queue
 // keeps useful brick transfers alive across frequent steering changes.
 scheduleMovingDetail(request){
  if(!this.active||!request.cleanupEnabled||(!this.fineSource?.sampleResidentPlane&&!this.fineSource?.warmPlane))return;
  this.movingLatest=request;this.lastMovingRequest=request;
  if(!this.movingTimer&&!this.movingBusy)this.movingTimer=setTimeout(()=>{this.movingTimer=0;void this.refineMovingDetail();},80);
 }
 stopMovingDetail(){
  this.movingEpoch=(this.movingEpoch||0)+1;clearTimeout(this.movingTimer);this.movingTimer=0;
  this.movingController?.abort();this.movingController=null;this.motionWarmController?.abort();this.motionWarmController=null;
  this.movingLatest=null;this.lastMovingRequest=null;this.movingBusy=null;this.motionWarmKey=null;
 }
 async refineMovingDetail(){
  const request=this.movingLatest;if(!request||this.movingBusy||!this.active)return;
  this.movingLatest=null;const epoch=this.movingEpoch||0,controller=new AbortController(),busy={request,epoch};
  this.movingController=controller;this.movingBusy=busy;
  const plane=probeCapPlane(request.pose,this.geometry),paneWidth=this.$('ct').getBoundingClientRect?.().width||800;
  const capLongest=Math.round(Math.min(960,Math.max(640,paneWidth))/32)*32;
  const spacingUm=Math.max(this.fineSpacingUm,Math.max(plane.width,plane.height)*this.geometry.longestMm*1000/(capLongest-1));
  try{
   const slice=await this.fineSource.sampleResidentPlane?.(plane,{signal:controller.signal,spacingUm});
   if(controller.signal.aborted||!this.active||epoch!==(this.movingEpoch||0)||request.version!==this.version)return;
   if(slice&&request.poseRevision===this.poseRevision&&validFineProbeSlice(slice,plane,this.fineSpacingUm,this.geometry)){
    this.dispatchFrame({...request,capLongest,fineSlice:slice,refinementToken:this.fineGeneration,workKey:request.workKey+'|resident-fine|'+capLongest});
   }else if(!slice&&request.poseRevision===this.poseRevision&&this.fineSource.warmPlane&&this.motionWarmKey!==request.workKey){
    this.motionWarmController?.abort();const warm=new AbortController();this.motionWarmController=warm;this.motionWarmKey=request.workKey;
    void this.fineSource.warmPlane(plane,{signal:warm.signal,localOnly:false,paddingMm:0,currentPlane:true,retainTransfers:true}).then(()=>{
     if(this.active&&!warm.signal.aborted&&epoch===(this.movingEpoch||0)&&!this.fineRunning&&this.lastMovingRequest)this.scheduleMovingDetail(this.lastMovingRequest);
    }).catch(()=>{/* A settling request reports source failures; live preview remains usable. */});
   }
  }catch(error){if(error.name!=='AbortError')this.motionFineError=error.message;}
  finally{
   if(this.movingController===controller)this.movingController=null;
   if(this.movingBusy===busy){this.movingBusy=null;if(this.movingLatest&&this.active)this.scheduleMovingDetail(this.movingLatest);}
  }
 }
 dispatchFrame(request){if(this.worker)this.worker.postMessage(request);else this.requestFallback(request);}
 dispatchPreview(){
  const request=this.previewLatest;if(!request||!this.active)return;
  if(this.fineRunning?.phase==='acoustics')return;
  this.previewLatest=null;
  if(this.displayedFrame?.id>=this.minFrameId&&this.displayedFrame.poseRevision===request.poseRevision)return;
  this.dispatchFrame({...request,...probeFrameQuality(request.state,this.$('ultrasound').getBoundingClientRect?.().width||800,true),fast:true});
 }
 abortFine({keepMoving=false}={}){
  if(!keepMoving)this.stopMovingDetail();
  this.fineGeneration++;this.fineController?.abort();this.fineController=null;this.fineRunning=null;this.fineLatest=null;this.previewLatest=null;clearTimeout(this.previewTimer);this.previewTimer=0;
  const status=this.$('fine-status');if(status)status.textContent=this.renderer.settings.cleanupEnabled===false?'Original volume · enable Clean scan for Ultra sections.':this.fineSource?`${this.fineLabel} detail follows the current probe plane.`:'Fine source is preparing.';
 }
 async requestFine(){
  const request=this.fineLatest;if(this.fineRunning||!request||!this.active||!this.fineSource?.samplePlane||!request.cleanupEnabled)return;
  this.fineLatest=null;const token=this.fineGeneration,controller=new AbortController(),running={request,token,phase:'source'};this.fineController=controller;this.fineRunning=running;
  const plane=probeCapPlane(request.pose,this.geometry),spacingUm=Math.max(this.fineSpacingUm,Math.max(plane.width,plane.height)*this.geometry.longestMm*1000/(request.capLongest-1));
  this.$('fine-status').textContent=`Preparing ${this.fineLabel} source detail…`;this.$('frame-state').textContent='Loading Fine Plane';
  let posted=false;
  try{
   const slice=await this.fineSource.samplePlane(plane,{signal:controller.signal,priority:'interactive',spacingUm,onProgress:progress=>{
    if(!this.active||token!==this.fineGeneration)return;
    running.local=progress.local===true;
    const fraction=progress.total>0?Math.min(100,Math.round(progress.ready/progress.total*100)):null;
    if(progress.phase!=='complete')this.$('frame-state').textContent=`Loading Fine Plane${fraction===null?'':' · '+fraction+'%'}`;
    this.$('fine-status').textContent=progress.phase==='sampling'?'Building the fine measured plane from cached blocks…':progress.reused?'Reusing the measured section for this probe direction…':`Loading ${this.fineLabel} detail${fraction===null?'…':' · '+fraction+'%'}`;
   }});
   if(!this.active||controller.signal.aborted||token!==this.fineGeneration||request.version!==this.version)return;
   if(!validFineProbeSlice(slice,plane,this.fineSpacingUm,this.geometry))throw new Error('Fine source returned an incomplete or mismatched plane.');
   this.$('fine-status').textContent=`Updating both views from ${this.fineLabel} data…`;this.$('frame-state').textContent='Building Matched Views';
   const refined={...request,fineSlice:slice,refinementToken:token};running.phase='acoustics';
   // Keep the source cache's pixels intact. The worker creates a screen-sized
   // display texture in the original section frame and reports its spacing.
   posted=true;this.dispatchFrame(refined);
  }catch(error){if(this.active&&!controller.signal.aborted&&token===this.fineGeneration)this.fineError(error.message);}
  finally{if(this.fineController===controller)this.fineController=null;if(!posted&&this.fineRunning===running){this.fineRunning=null;this.dispatchPreview();if(this.fineLatest)void this.requestFine();}}
 }
 finishFineFrame(frame){
  const running=this.fineRunning;if(!frame.fine||!running||frame.id!==running.request.id||frame.refinementToken!==running.token)return;
  this.fineRunning=null;
  if(this.displayedFrame?.fine&&this.displayedFrame.poseRevision>=frame.poseRevision){clearTimeout(this.previewTimer);this.previewTimer=0;if(this.previewLatest?.poseRevision<=frame.poseRevision)this.previewLatest=null;}
  if(this.fineLatest){void this.requestFine();if(!this.previewTimer)this.previewTimer=setTimeout(()=>{this.previewTimer=0;this.dispatchPreview();},190);}
  else if(frame.type!=='error'&&!frame.fast&&this.active)this.fineSource?.scheduleWarmPlane?.(frame.plane);
 }
 fineError(message){this.$('frame-state').textContent='Volume Preview · Detail Unavailable';this.$('fine-status').textContent=String(message).includes('requires HTTPS')?`${message} The measured volume preview remains available.`:'Fine detail could not finish. The measured preview remains available; move the probe or select a starting view to retry.';console.warn('Probe fine plane:',message);}
 async requestFallback(request){
  this.fallbackLatest=request;if(this.fallbackRunning){if(!this.fallbackRunning.fast||!request.fast)this.fallbackEpoch=(this.fallbackEpoch||0)+1;return;}
  this.fallbackRunning=request;
  try{
   const {computeProbeFrame}=await import('./probe-acoustics.js');
   while(this.fallbackLatest&&this.active){
    const job=this.fallbackLatest;this.fallbackLatest=null;this.fallbackRunning=job;const epoch=this.fallbackEpoch||0;
    const result=await computeProbeFrame({data:this.data,meta:this.meta,dimensions:this.meta.dimensions,geometry:this.geometry,support:this.appearance?.cleanup},job,{cancelled:()=>!this.active||epoch!==(this.fallbackEpoch||0)||job.version!==this.version,yieldFn:()=>new Promise(resolve=>setTimeout(resolve,0))});
    if(result&&this.active&&epoch===(this.fallbackEpoch||0)){this.acceptFrame(result);this.finishFineFrame(result);}
   }
  }catch(error){if(this.fallbackRunning?.fineSlice){this.fineError(error.message);this.finishFineFrame({...this.fallbackRunning,fine:true,type:'error'});}else this.sampleError(error.message);}finally{this.fallbackRunning=null;}
 }
 sampleError(message){this.$('frame-state').textContent='Section Unavailable';this.$('image-status').hidden=false;this.$('image-status').textContent='This section could not finish. Move the probe or reset to try again.';console.warn('Probe section:',message);}
 acceptFrame(frame){
  if(!this.active||frame.version!==this.version||frame.id<this.minFrameId)return;
  if(frame.fine&&(frame.refinementToken!==this.fineGeneration||this.renderer.settings.cleanupEnabled===false))return;
  const previous=this.displayedFrame,quality=f=>(f.fine?2:0)+(f.fast?0:1);
  if(previous&&previous.id>=this.minFrameId&&(frame.poseRevision<previous.poseRevision||(frame.poseRevision===previous.poseRevision&&(quality(frame)<quality(previous)||(quality(frame)===quality(previous)&&frame.id<=this.displayedId)))))return;
  this.displayedId=frame.id;this.displayedFrame=frame;this.applyDisplayPlane();
  const sourceSpacing=frame.stats.sourceSpacingUm||this.geometry.spacingUm,capSpacing=frame.capSpacingUm||sourceSpacing,tolerance=Math.max(.04,this.fineSpacingUm*1e-5),ultra=frame.fine&&Math.abs(sourceSpacing-this.fineSpacingUm)<=tolerance&&capSpacing>0&&capSpacing<=this.fineSpacingUm+tolerance;
  if(frame.fine&&(!this.reusableFineSlice||this.reusableFineSlice.version!==this.version||!validFineProbeSlice(this.reusableFineSlice,frame.plane,this.fineSpacingUm,this.geometry)||capSpacing<this.reusableFineSlice.spacingUm))this.reusableFineSlice={version:this.version,data:frame.cap,width:frame.capWidth,height:frame.capHeight,plane:frame.plane,spacingUm:capSpacing,spacingUmXY:frame.capSpacingUmXY,sourceSpacingUm:sourceSpacing,complete:true,cleaned:frame.capCleaned===true,source:frame.source};
  this.renderer.setCapData({data:frame.cap,width:frame.capWidth,height:frame.capHeight,plane:frame.plane,spacingUm:capSpacing,cleaned:frame.capCleaned===true,key:`probe-${frame.version}-${frame.id}`});
  this.paintImages();this.guideKey='';this.drawGuide();
  this.$('frame-state').textContent=frame.fast?'Live Preview':ultra?'Ultra Plane':frame.fine?'Fine Plane':this.fineRunning?'Preview · Loading Fine Plane':'Volume Preview';
  this.$('sampling').textContent=frame.fast?'Live Sampling':frame.fine?'Matched Fine Plane':'Measured Volume';
  this.$('resolution').textContent=`${sourceSpacing.toFixed(1)} µm Source · ${capSpacing.toFixed(1)} µm Plane${frame.fast?' · Preview':ultra?' · Ultra':frame.fine?' · Fine':' · Preview'}`;
  if(frame.fine)this.$('fine-status').textContent=ultra?`Both views refined from the same ${this.fineLabel} measured plane.`:`Both views refined from the same fine source · ${capSpacing.toFixed(1)} µm plane sampling.`;
  this.updateImageLabels();
  const empty=frame.stats.tissueFraction<.001;this.$('image-status').hidden=!empty;this.$('image-status').textContent=empty?'The sector is outside the tissue. Move toward the heart, or reset the probe.':'';
 }
 applyDisplayPlane(){
  if(!this.active||!this.geometry)return;const pose=this.displayedFrame?.pose||this.getPose();if(!pose)return;
  const plane=this.displayedFrame?.plane||probeCapPlane(pose,this.geometry);
  this.renderer.set({mode:0,showPlanes:0,clipAxis:this.state.cutaway?3:-1,clipFlip:this.state.flip?1:0,oblique:plane});
 }
 updateAppearance(resample=true){
  const anatomyOption=this.$('material').querySelector('option[value="5"]');if(anatomyOption&&this.donor.anatomyManifestUrl===null){anatomyOption.disabled=true;anatomyOption.textContent='Anatomy · Unassigned';}
  this.$('material').value=String(this.renderer.settings.palette??4);
  const cleanup=this.appearance?.cleanup||null,enabled=this.renderer.settings.cleanupEnabled!==false;
  const supportChanged=cleanup!==this.lastCleanup||enabled!==this.lastCleanupEnabled;this.lastCleanup=cleanup;this.lastCleanupEnabled=enabled;
  if(this.active&&supportChanged&&resample){if(this.worker&&cleanup!==this.workerSupport){this.workerSupport=cleanup;this.worker.postMessage({type:'support',support:cleanup?{data:cleanup.data,dimensions:cleanup.dimensions}:null});}this.invalidatePending();this.requestFrame(false);}
  if(this.displayedFrame)this.paintImages();
 }
 updateUI(){
  const calibrated=!!this.frameForState()?.donorCalibration,unreviewed=this.donor.clinicalPresetsReviewed===false&&!calibrated,labels={'apical':'Long-axis reference','parasternal':'Crossed long-axis reference','short-axis':'Short-axis reference','atrial':'Opposite-side reference'};
  for(const button of this.mount.querySelectorAll('[data-probe-preset]')){const id=button.dataset.probePreset,preset=PROBE_PRESETS.find(p=>p.id===id),estimated=!!this.frames[preset?.frame]?.donorCalibration;button.querySelector('[data-probe-preset-label]').textContent=titleCaseUi(this.donor.clinicalPresetsReviewed===false&&!estimated?labels[id]:(preset?.name||id));button.setAttribute('aria-pressed',String(id===this.state.preset));}
  this.$('preset-note').textContent=calibrated?'Starting plane estimated from this specimen’s chamber and outflow landmarks. The clinical window and simulated probe position remain unvalidated.':this.donor.geometricComparisonOnly?'Measured comparison plane from this donor. Chamber identity and clinical window correspondence are not assigned.':unreviewed?'Scan-derived starting plane for this donor. Chamber and clinical-window alignment remain unverified.':(PROBE_PRESETS.find(p=>p.id===this.state.preset)||PROBE_PRESETS[0]).detail;
  this.$('cutaway').checked=this.state.cutaway;this.$('show-guide').checked=this.state.showGuide;this.$('show-surface').checked=this.state.showSurface;this.$('contact-locked').checked=this.state.contactLocked;this.$('flip').setAttribute('aria-pressed',String(this.state.flip));
  const tee=this.state.preset==='atrial',locked=this.state.contactLocked,bodySkin=!!this.state.skinContact&&!tee;
  this.$('contact-kind').textContent=tee?(unreviewed?'Inner-Wall Positioning Proxy':'Synthetic Esophageal Wall Proxy'):bodySkin?'Reference Chest Skin':'Skin Positioning Guide';
  this.$('contact-note').textContent=tee?(calibrated?'Synthetic esophageal contact guide estimated from this specimen’s landmarks. The probe location is not clinically registered.':unreviewed?'An inner-wall contact guide for the opposite-side plane. The donor’s esophageal position and clinical alignment are unassigned.':'TEE starts against an esophageal-wall proxy, not external skin. This is an educational guide, not scanned anatomy.'):'A synthetic positioning guide, not skin from the scanned donor.';
  this.$('contact-badge').textContent=(tee?(unreviewed?'Inner-Wall Reference':'Synthetic Esophageal Wall'):bodySkin?'Reference Chest Skin':'Skin Guide')+' · '+(locked?'Contact Locked':'Free Position');
  if(bodySkin)this.$('contact-note').textContent='Contact follows the displayed reference skin. Place Probe selects any visible skin surface; WASD slides along it. This chest is illustrative, not donor-registered.';
  this.$('advance-help').textContent=locked?(tee?'Along the Wall':bodySkin?'Toward Head / Feet':'Along the Surface'):'Advance / Withdraw';this.$('advance-label').textContent=locked?(bodySkin?'Head / Feet':'Along Surface'):'Along Beam';
  this.$('slide-direction-help').textContent=locked&&bodySkin?'W/S Head / Feet · A/D Around Chest':locked?'W/S Along Surface · A/D Sideways':'W/S Along Beam · A/D Sideways';
  const slideLabels=locked&&bodySkin?{KeyW:'Slide toward head',KeyS:'Slide toward feet',KeyA:'Slide left around chest',KeyD:'Slide right around chest'}:null;
  for(const button of this.mount.querySelectorAll('[data-probe-key]')){
   const code=button.dataset.probeKey,label=slideLabels?.[code]||probeSteeringKeys[code][2];
   button.setAttribute('aria-label',`${label} (${code.slice(3)})`);button.title=`${label} · Hold ${code.slice(3)}; Shift for fine control`;
  }
  this.$('free-help').hidden=locked;this.$('elevation-controls').hidden=locked;
  const limits=probePhysicalLimits(this.state.referenceMm),step=Number(limits.step.toFixed(1));
  this.$('position-help').textContent=locked?`Buttons slide the probe ${step} mm along the contact surface.${bodySkin?' Head / Feet: + toward the head, − toward the feet. Sideways follows left/right around the chest from Front.':''} Steering pivots around its contact point.`:`Free mode: move in the probe’s local axes. Buttons step ${step} mm.`;
  for(const button of this.mount.querySelectorAll('[data-probe-step]')){
   const [axis,direction]=button.dataset.probeStep.split(':'),positive=Number(direction)>0;
   const label=axis==='advance'?(locked&&bodySkin?`Slide probe toward ${positive?'head':'feet'}`:`Move ${positive?'forward':'backward'}`):axis==='lateral'?`Slide probe ${positive?'right':'left'}${locked&&bodySkin?' around chest':''}`:`Move probe ${positive?'up':'down'}`;
   button.setAttribute('aria-label',`${label} by ${step} millimetres`);
  }
  for(const input of this.mount.querySelectorAll('[data-probe-range]')){
   const key=input.dataset.probeRange,value=this.state[key];input.value=String(value);const suffix=input.dataset.suffix;
   const angleLimit=locked&&!bodySkin?65:85;if(key==='sweepDeg'){input.min=locked?-angleLimit:-180;input.max=locked?angleLimit:180;}if(key==='tiltDeg'){input.min=-angleLimit;input.max=angleLimit;}
   if(key==='depthMm'||key==='speedMm'){const bounds=key==='depthMm'?limits.depth:limits.speed;input.min=bounds[0];input.max=bounds[1];input.step=limits.scale<.75?.1:1;}
   this.mount.querySelector(`[data-probe-value="${key}"]`).textContent=(key==='shadow'?Math.round(value*100)+'%':key==='frequencyMHz'||(limits.scale<.75&&['depthMm','speedMm'].includes(key))?value.toFixed(1):Math.round(value))+suffix;
  }
  const origin=this.state.originMm||this.getPose()?.originMm;this.$('position').textContent=origin?origin.map(signed).join(' / '):'Preparing geometry';
  this.$('angles').textContent=`Fan ${Math.round(this.state.sweepDeg)}° · Tilt ${Math.round(this.state.tiltDeg)}° · Rotation ${Math.round(this.state.rollDeg)}°`;this.updateControlStatus();this.updateImageLabels();this.compactLayout?.sync();
 }
 updateImageLabels(){
  const ct=this.state.imageMode==='ct',frame=this.displayedFrame;
  this.$('ultrasound-figure').hidden=ct;this.$('ct-figure').hidden=!ct;this.$('image-title').textContent=ct?'Measured CT Section':'Simulated Ultrasound';this.$('image-kind').textContent=ct?'MEASURED':'CT-DERIVED';
  this.$('simulation-label').textContent=ct?'Measured CT · Same Scan Plane':'Simulated Ultrasound · CT-Derived';
  if(frame)this.$('acoustic-meta').textContent=ct?`${frame.state.depthMm.toFixed(0)} mm depth · fixed donor scan`:`${frame.state.frequencyMHz.toFixed(1)} MHz proxy · ${frame.state.depthMm.toFixed(0)} mm`;
  this.mount.querySelectorAll('[data-probe-image]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.probeImage===this.state.imageMode)));
 }

 paintImages(){
  const frame=this.displayedFrame;if(!frame)return;const {width,height}=frame,settings=this.renderer.settings;
  if(this.imageBuffers?.width!==width||this.imageBuffers?.height!==height){
   const ct=new Uint8ClampedArray(width*height*4),us=new Uint8ClampedArray(width*height*4);
   this.imageBuffers={width,height,ct,us,ct32:new Uint32Array(ct.buffer),us32:new Uint32Array(us.buffer),ctImage:new ImageData(ct,width,height),usImage:new ImageData(us,width,height)};
  }
  const {ct,us,ct32,us32}=this.imageBuffers,lut=new Uint8ClampedArray(256*4),gray=new Uint8ClampedArray(256*4);
  for(let value=0;value<256;value++){
   const density=value/255,color=value&&!((settings.palette===4||settings.palette===6)&&density<settings.threshold)?capColor(density,settings.capContrast??1.8,settings.palette,settings):[0,0,0];
   for(let c=0;c<3;c++){lut[value*4+c]=Math.pow(Math.max(0,color[c]),.89)*255;gray[value*4+c]=value;}lut[value*4+3]=gray[value*4+3]=255;
  }
  const lut32=new Uint32Array(lut.buffer),gray32=new Uint32Array(gray.buffer);
  const anatomy=settings.palette===5&&this.appearance?.anatomy,colors=anatomy?buildAnatomyPalette(anatomy.palette||anatomy.labels):null;
  const {pose,sector}=frame,scale=this.geometry?.longestMm||PROBE_REFERENCE_MM,extent=this.geometry?.extent||this.renderer.extent;
  for(let row=0;row<height;row++){
   const forward=row/(height-1)*sector.depthMm;
   for(let col=0;col<width;col++){
    const i=col+row*width,v=frame.ct[i],offset=i*4;
    ct32[i]=lut32[v];us32[i]=gray32[frame.ultrasound[i]];
    if(anatomy&&v/255>settings.threshold){
     const lateral=(col/(width-1)-.5)*sector.widthMm,x=(pose.originMm[0]+pose.beam[0]*forward+pose.right[0]*lateral)/scale,y=(pose.originMm[1]+pose.beam[1]*forward+pose.right[1]*lateral)/scale,z=(pose.originMm[2]+pose.beam[2]*forward+pose.right[2]*lateral)/scale;
     const source=[x/extent[0]+.5,.5-z/extent[2],y/extent[1]+.5];
     if(source.every(p=>p>=0&&p<=1)){const d=anatomy.dimensions,id=anatomy.data[Math.round(source[0]*(d[0]-1))+d[0]*(Math.round(source[1]*(d[1]-1))+d[1]*Math.round(source[2]*(d[2]-1)))];const base=capColor(v/255,settings.capContrast??1.8,settings.palette,settings),color=anatomyColor(base,id,colors,settings.anatomyOpacity??.65,settings.anatomySelected??0);for(let c=0;c<3;c++)ct[offset+c]=Math.pow(Math.max(0,color[c]),.89)*255;}
    }
   }
  }
  for(const [key,image] of [['ct',this.imageBuffers.ctImage],['ultrasound',this.imageBuffers.usImage]]){
   const canvas=this.$(key);if(canvas.width!==width)canvas.width=width;if(canvas.height!==height)canvas.height=height;canvas.getContext('2d').putImageData(image,0,0);
   const context=canvas.getContext('2d');context.font=`${Math.max(10,width/45)}px ui-monospace,monospace`;context.textAlign='right';context.fillStyle='#748a8d';context.strokeStyle='#4f6369';context.lineWidth=1;
   const tick=frame.state.depthMm<70?5:20;
   for(let depth=tick;depth<frame.state.depthMm;depth+=tick){const y=depth/frame.state.depthMm*(height-1);context.beginPath();context.moveTo(width-7,y);context.lineTo(width-2,y);context.stroke();context.fillText(String(depth),width-11,y+4);}
   context.fillStyle='#718d87';context.fillText('mm',width-10,height-9);
  }
 }

 orientCamera(mode='explore'){
  if(!this.active||!this.geometry)return;const pose=this.getPose();if(!pose)return;
  const scale=probeDisplayScale(this.geometry.longestMm),targetDepth=mode==='face'?this.state.depthMm*.47:(this.state.depthMm-135*scale)/2;
  const target=mul(add(pose.originMm,mul(pose.beam,targetDepth)),1/this.geometry.longestMm),normal=mul(pose.normal,this.state.flip?-1:1);
  const rect=this.renderer.canvas.getBoundingClientRect(),aspect=rect.width>0&&rect.height>0?rect.width/rect.height:1.2;
  // Frame the unchanged scan sector plus the reduced illustration. A full-size
  // decorative handle no longer makes the measured heart needlessly small.
  const fittedDistance=Math.max(1.85,(this.state.depthMm+165*scale)/this.geometry.longestMm/.58,(this.state.depthMm*2*Math.sin(this.state.angleDeg*Math.PI/360)+35*scale)/this.geometry.longestMm/(.58*aspect));
  if(mode==='frame'){this.renderer.camera.distance=fittedDistance;this.renderer.camera.pan=target;this.renderer.requestRender();}
  else{if(mode==='explore')this.renderer.camera.distance=fittedDistance;this.renderer.alignPlane(mode==='face'?normal:norm(add(add(normal,mul(pose.right,.38)),mul(pose.up,.38))),pose.up,target);}
  this.guideKey='';this.drawGuide();
 }
 onRendererChange(){if(this.active){if(this.torsoView)this.updateTorsoSource();this.guideKey='';this.drawGuide();}}
 updateTorsoIndicator(point){
  const overlay=this.$('torso-indicator');if(!overlay)return;
  const visible=point&&point.x>=0&&point.x<=point.width&&point.y>=0&&point.y<=point.height;
  overlay.toggleAttribute('hidden',!visible);if(!visible)return;
  const {x,y,width,height,farSide}=point,labelWidth=farSide?145:89,margin=10;
  const labelX=Math.max(margin,Math.min(width-labelWidth-margin,x+(x<width*.5?30:-labelWidth-30))),labelY=Math.max(28,Math.min(height-24,y-29));
  overlay.setAttribute('viewBox',`0 0 ${width} ${height}`);overlay.classList.toggle('is-far-side',farSide);
  this.$('indicator-dot').setAttribute('cx',x);this.$('indicator-dot').setAttribute('cy',y);
  const edge=labelX>x?labelX:labelX+labelWidth;
  this.$('indicator-line').setAttribute('d',`M ${x} ${y} L ${edge} ${labelY-2}`);
  const label=this.$('indicator-label');label.setAttribute('transform',`translate(${labelX} ${labelY})`);label.querySelector('rect').setAttribute('width',labelWidth);label.querySelector('text').textContent=farSide?'Indicator · Far Side':'Indicator';
 }
 ensureScene(){
  if(!this.sceneOverlay){try{this.sceneOverlay=new ProbeSceneOverlay(this.$('scene-mesh'),{renderer:this.renderer});}catch(error){console.warn('Probe mesh view:',error.message);}}
  if(!this.torsoView){try{this.torsoView=new ReferenceTorsoView(this.$('torso'),{onStatus:message=>{this.$('torso-state').textContent=message;this.$('torso-state').hidden=!message;},onIndicator:point=>this.updateTorsoIndicator(point),onContact:hit=>this.placeOnSkin(hit),onCameraChange:mode=>this.mount.querySelectorAll('[data-probe-torso-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.probeTorsoView===mode)))});}catch(error){this.$('torso-state').textContent='Linked chest unavailable.';}}
  this.sceneOverlay?.setActive?.(true);this.torsoView?.setActive(true);this.updateTorsoSource();
 }
 placeOnSkin(hit){
  if(!this.active||!this.torsoView?.model)return;
  const surface=createSkinContactSurface(this.torsoView.model),right=this.getPose()?.right||this.torsoView.model.frame.left,contact=skinContactFrame(surface,hit,right);
  this.releaseKeyboardControls();this.state=sanitizeProbeState({...this.state,preset:this.state.preset==='atrial'?'apical':this.state.preset,contactLocked:true,skinContact:contact,contactPositionMm:null,originMm:contact.pointMm,sweepDeg:0,tiltDeg:0,rollDeg:0});
  this.invalidatePending();this.poseChanged(true);
 }
 updateTorsoSource(){
  if(!this.torsoView||!this.data||!this.meta)return;
  if(!this.active){this.torsoView.invalidateSource();return;}
  const threshold=this.renderer.settings.threshold??.28;
  if(this.torsoView.sourceData===this.data&&this.torsoView.sourceMeta===this.meta&&this.torsoView.sourceThreshold===threshold)return;
  const oldModel=this.torsoView.model;
  this.torsoView.setSource({data:this.data,meta:this.meta,frames:this.frames,donorId:this.donor.id||this.donor.datasetId,threshold}).then(()=>{this.guideKey='';if(this.active){if(this.torsoView.model&&this.torsoView.model!==oldModel){this.ensureOrigin();this.invalidatePending();this.poseChanged(true);this.orientCamera('explore');}else this.drawGuide();}}).catch(error=>console.warn('Linked chest:',error.message));
 }
 drawGuide(){
  if(!this.active||!this.geometry)return;const guide=this.$('guide'),target=this.mount.querySelector('#probeViewportMount'),canvas=this.renderer.canvas;
  // The compact Chest panel has its own camera and dimensions. It must keep
  // following the accepted scan pose when the shared 3D pane is hidden.
  if(this.compactLayout?.compact&&this.compactLayout.view==='chest'){
   const frame=this.displayedFrame,pose=frame?.pose||this.getPose(),state=frame?.state||this.state,torso=this.$('torso');if(!pose)return;
   const key=['chest',torso.clientWidth,torso.clientHeight,this.displayedId,frame?.poseRevision??this.poseRevision,this.torsoView?.revision||0].join(',');if(key===this.guideKey)return;this.guideKey=key;
   const sourceFrame=this.frameForState(state),surface=sourceFrame?probeContactSurface(state.preset,sourceFrame):null;
   this.torsoView?.render({pose,state,surface,referenceMm:this.geometry.longestMm});return;
  }
  const rect=canvas.getBoundingClientRect(),mountRect=target.getBoundingClientRect(),w=Math.round(rect.width),h=Math.round(rect.height);if(w<2||h<2)return;
  const camera=this.renderer.camera,key=[...camera.pan,camera.yaw,camera.pitch,camera.roll,camera.distance,w,h,this.displayedId,this.state.showGuide,this.state.showSurface,this.state.preset,this.displayedFrame?.poseRevision??this.poseRevision,this.torsoView?.revision||0,Boolean(this.sceneOverlay?.failed)].join(',');if(key===this.guideKey)return;this.guideKey=key;
  const dpr=Math.min(globalThis.devicePixelRatio||1,2);guide.width=Math.round(w*dpr);guide.height=Math.round(h*dpr);guide.style.width=w+'px';guide.style.height=h+'px';guide.style.left=(rect.left-mountRect.left)+'px';guide.style.top=(rect.top-mountRect.top)+'px';
  const ctx=guide.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  const frame=this.displayedFrame,pose=frame?.pose||this.getPose(),state=frame?.state||this.state;if(!pose)return;
  const basis=this.renderer.basis(),scale=1/this.geometry.longestMm,deviceScale=probePhysicalScale(this.geometry.longestMm),project=p=>projectProbePoint(mul(p,scale),basis,w,h),half=state.angleDeg*Math.PI/360;
  const path=(points,close=false,fill=null,stroke='#84b5aa',lineWidth=1)=>{const projected=points.map(project);if(projected.some(p=>!p))return;ctx.beginPath();projected.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));if(close)ctx.closePath();if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=lineWidth;ctx.stroke();}};
  const sourceFrame=this.frameForState(state),surface=sourceFrame?probeContactSurface(state.preset,sourceFrame):null;
  const meshCanvas=this.$('scene-mesh');meshCanvas.style.width=w+'px';meshCanvas.style.height=h+'px';meshCanvas.style.left=(rect.left-mountRect.left)+'px';meshCanvas.style.top=(rect.top-mountRect.top)+'px';
  this.sceneOverlay?.render({basis,width:w,height:h,dpr,pose,state,surface,contextModel:this.torsoView?.model,referenceMm:this.geometry.longestMm,showSurface:this.state.showSurface,showProbe:this.state.showGuide});
  if(!this.compactLayout?.compact)this.torsoView?.render({pose,state,surface,referenceMm:this.geometry.longestMm});
  if(this.state.showSurface&&surface&&surface.kind!=='body-skin'&&!this.sceneOverlay){
   const mesh=contactSurfaceLines(surface),tee=surface.kind==='esophageal',under=mesh.outline.map(p=>add(p,mul(surface.inward,1.5*deviceScale)));
   path(under,true,tee?'rgba(116,72,91,.18)':'rgba(116,81,55,.18)',tee?'rgba(161,105,126,.5)':'rgba(177,128,88,.5)',.8);
   path(mesh.outline,true,tee?'rgba(185,130,151,.22)':'rgba(198,153,111,.22)',tee?'rgba(217,163,182,.82)':'rgba(224,183,136,.82)',1.35);
   for(const line of mesh.lines)path(line,false,null,tee?'rgba(197,143,166,.26)':'rgba(212,169,123,.28)',.75);
   const tag=project(add(contactFrame(surface,surface.limitU*.6,-surface.limitV*.3).pointMm,mul(surface.inward,-.8*deviceScale)));
   if(tag&&tag.x>0&&tag.x<w-85&&tag.y>20&&tag.y<h-25){ctx.font='9px ui-monospace,monospace';ctx.fillStyle=tee?'#d5a4ba':'#d5b68d';ctx.fillText(tee?'WALL PROXY':'SKIN PROXY',tag.x,tag.y);}
  }
  if(!this.state.showGuide)return;
  if(!this.sceneOverlay||this.sceneOverlay.failed)paintProbeFallback(ctx,project,pose,surface?.kind==='esophageal'?'tee':'phased',probeDisplayScale(this.geometry.longestMm));
  const arc=depth=>Array.from({length:49},(_,i)=>beamPoint(pose,-half+i*2*half/48,depth));
  path([pose.originMm,...arc(state.depthMm)],true,'rgba(107,185,162,.045)','rgba(134,198,178,.8)',1.35);
  ctx.setLineDash([3,5]);for(const portion of [.25,.5,.75])path(arc(state.depthMm*portion),false,null,'rgba(110,169,158,.31)');path([pose.originMm,beamPoint(pose,0,state.depthMm)],false,null,'rgba(159,200,188,.43)');ctx.setLineDash([]);
  if(pose.contact){const c=pose.contact;path(Array.from({length:33},(_,i)=>add(add(add(c.pointMm,mul(c.right,6.5*deviceScale*Math.cos(i*Math.PI/16))),mul(c.normal,6.5*deviceScale*Math.sin(i*Math.PI/16))),mul(c.inward,-.25*deviceScale))),true,'rgba(164,217,198,.19)','rgba(184,231,209,.94)',1.2);}
 }
}
