import {EchoTextureCache,isUltra} from './echo-texture-cache.js';
import {titleCaseUi} from './ui-text.js';
import {mountEchoCompactWorkspace} from './echo-mobile-v47.js';
import {referenceGalleryTemplate,mountReferenceGallery} from './reference-gallery.js';
export {EchoTextureCache} from './echo-texture-cache.js';
import { MPRSampler } from './mpr.js';
import { add, mul, norm, cross, dot } from './planes.js';
import { capColor, capAnatomyColor as anatomyColor, buildAnatomyPalette } from './render-styles.js';
import { EchoMediaCache } from './echo-media-cache.js';
import {fullEchoCutFacePlane,validateEchoFineSection} from './echo-cut-face.js';
import {createYouTubeReference,ensureEchoReferenceStyles,supplementalTeeAngle,referenceAngleMarkup,createReferenceAnglePlacement,localEchoReference,preferredEchoReference} from './echo-reference-player.js';
import { scanActivity } from './download-priority.js';
import {TEE_ATLAS_VIEWS,TEE_ATLAS_GROUPS} from './tee-atlas-data.js';
import {TTE_ATLAS_VIEWS,TTE_ATLAS_GROUPS,TTE_SOURCE} from './tte-atlas-data.js';
import {buildTteAtlasFrames,TteAtlasOverlay,createTteContextModel,tteContextCamera,tteAtlasProbePose,tteProbeCameraDistance,tteProbeFocusPoints} from './tte-atlas-geometry.js';
import {buildTeeAtlasFrames,TeeAtlasOverlay,atlasProbeFocusPoints} from './tee-atlas-geometry.js';
import {loadEchoReferenceAnatomy,createEchoAnatomyContext} from './echo-anatomy-context-v2.js';
import {resolveEchoAcquisitionPlane,reframeEchoAcquisitionPlane,TTE_ACQUISITION_PARENT,echoProbeCamera,echoAnatomyCamera} from './echo-acquisition-geometry.js';
import {TEE_REFINEMENT_DATASET,loadTeeRefinements,applyTeeRefinements} from './tee-view-refinement.js';
import {loadTeeRegionalReview,reviewedTeeEvidence,teeReviewStatusText,paintTeeTissueAnchors} from './tee-view-review.js';
import {createTeeContextModel,teeContextCamera} from './tee-context-geometry.js';
import {buildDonorEchoFrames,echoDonorPlaneRevision,protectEchoTargetAcquisitions} from './echo-donor-planes.js';
import {normalizeTeeAlignment,readTeeAlignment,rememberTeeAlignment} from './tee-alignment.js';
import { isEchoPlaneModified, orientEchoPlaneForDisplay, orientEchoPreparedPixels, echoDisplayFacing, describeEchoCorrespondence } from './echo-correspondence.js';

const TEE_SOURCE='https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf';
export const ECHO_PRESETS = [
 ...TTE_ATLAS_VIEWS,
 ...TEE_ATLAS_VIEWS,
];

const DEFAULT_STATE={mode:'tte',preset:'a4c',psaxLevel:'papillary',offsetMm:0,rotationDeg:0,tiltDeg:0,flip:false,lockCamera:true,alignment:'probe',contrast:1.8,leftView:'3d',ctNative:false,showProbe:true,showSector:true,showContext:true,planeReference:'refined'};
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const degrees=v=>v*Math.PI/180;
function rotate(v,axis,angle){const c=Math.cos(angle),s=Math.sin(angle),a=norm(axis);return add(add(mul(v,c),mul(cross(a,v),s)),mul(a,dot(a,v)*(1-c)));}
function validVector(v){return Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);}
const escapeHTML=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const mediaIdentity=clip=>`${clip.id}|${clip.kind||'video'}|${clip.url}`;

/** Sample measured pixels without inventing detail; callers choose a display/native size. */
export function sampleEchoPreview(sample,{maxSize=640,extent,flip=false,cleanup=null,anatomy=null}){
 const {data,width:sw,height:sh,plane}=sample;
 const longest=Math.min(maxSize,Math.max(sw,sh)),width=Math.max(2,Math.round(longest*Math.min(1,sw/sh))),height=Math.max(2,Math.round(longest*Math.min(1,sh/sw)));
 const count=width*height,intensity=new Uint8Array(count),support=new Uint8Array(count),labels=new Uint8Array(count);support.fill(1);
 const columns=new Int32Array(width),wx=new Float64Array(width),wy=new Float64Array(width),wz=new Float64Array(width);
 for(let col=0;col<width;col++){
  const u=(flip?1-col/(width-1):col/(width-1))-.5;columns[col]=Math.round((u+.5)*(sw-1));
  wx[col]=plane.center[0]+plane.right[0]*u*plane.width;wy[col]=plane.center[1]+plane.right[1]*u*plane.width;wz[col]=plane.center[2]+plane.right[2]*u*plane.width;
 }
 const sampleMap=(map,x,y,z)=>{if(x<0||x>1||y<0||y>1||z<0||z>1)return 0;const [nx,ny,nz]=map.dimensions;return map.data[Math.round(x*(nx-1))+nx*(Math.round(y*(ny-1))+ny*Math.round(z*(nz-1)))];};
 for(let row=0;row<height;row++){
  const sourceRow=Math.round(row/(height-1)*(sh-1)),v=(.5-row/(height-1))*plane.height;
  const dx=plane.up[0]*v,dy=plane.up[1]*v,dz=plane.up[2]*v;
  for(let col=0;col<width;col++){
   const i=row*width+col,value=data[sourceRow*sw+columns[col]];intensity[i]=value;if(!value||(!cleanup&&!anatomy))continue;
   const x=(wx[col]+dx)/extent[0]+.5,y=.5-(wz[col]+dz)/extent[2],z=(wy[col]+dy)/extent[1]+.5;
   if(cleanup)support[i]=sampleMap(cleanup,x,y,z)?1:0;if(anatomy)labels[i]=sampleMap(anatomy,x,y,z);
  }
 }
 return {intensity,support,labels,hasAnatomy:!!anatomy,width,height};
}

export function paintEchoPreview(grid,settings,contrast,colors){
 const withAnatomy=settings.palette===5&&grid.hasAnatomy,blocks=withAnatomy?17:1;
 const lut=new Uint8ClampedArray(blocks*256*4),packedLut=new Uint32Array(lut.buffer);
 for(let value=0;value<256;value++){
  const density=value/255,base=value&&!((settings.palette===4||settings.palette===6)&&density<settings.threshold)?capColor(density,contrast,settings.palette,settings):[0,0,0];
  for(let block=0;block<blocks;block++){
   const color=block&&density>settings.threshold?anatomyColor(base,block-1,colors,settings.anatomyOpacity??.65,settings.anatomySelected??0):base,index=(block*256+value)*4;
   lut[index]=Math.pow(Math.max(0,color[0]),.89)*255;lut[index+1]=Math.pow(Math.max(0,color[1]),.89)*255;lut[index+2]=Math.pow(Math.max(0,color[2]),.89)*255;lut[index+3]=255;
  }
 }
 const rgba=new Uint8ClampedArray(grid.intensity.length*4),packed=new Uint32Array(rgba.buffer);
 for(let i=0;i<packed.length;i++){
  const value=grid.intensity[i];let index=value;
  if(settings.cleanupEnabled!==false&&!grid.support[i])index=0;
  else if(withAnatomy&&value/255>settings.threshold)index+=(grid.labels[i]<16?grid.labels[i]+1:1)*256;
  packed[i]=packedLut[index];
 }
 return rgba;
}

/** Independent CT reference-plane controls. The host owns tabs and the shared 3D viewport. */
export class EchoModule {
 constructor({renderer,mount,onExit,onSteer,toast=()=>{},frames=null,appearance=null,donor={}}){
  this.renderer=renderer;this.mount=typeof mount==='string'?document.querySelector(mount):mount;
  if(!this.mount)throw new Error('EchoModule needs a mount element.');
  this.onExit=onExit;this.onSteer=onSteer;this.atlasGroup='apical';this.atlasSearch='';this.toast=toast;this.appearance=appearance;this.state={...DEFAULT_STATE,alignment:readTeeAlignment(),contrast:Number.isFinite(renderer.settings.capContrast)?clamp(renderer.settings.capContrast,.5,3):DEFAULT_STATE.contrast};this.active=false;this.frames={};this.requestId=0;this.sampler=null;this.presetTextures={};this.textureCache=new EchoTextureCache();this.mediaCatalog=null;this.mediaSelection=null;this.mediaFrameKey=null;this.donor=donor;
  this.fineSpacingUm=Number(donor.fineSpacingUm)>0?Number(donor.fineSpacingUm):79.4;this.fineLabel=`${Number(this.fineSpacingUm.toFixed(3))} µm`;this.offsetLimitMm=35;
  this.mediaCache=new EchoMediaCache();this.cineRequestId=0;this.cineTargetId=null;this.cineLoadedId=null;this.cineResume=false;this.cineFullFrame=true;this.destroyed=false;
  ensureEchoReferenceStyles();
  this.fineSource=null;this.fineController=null;this.fineTimer=null;
  this.mount.classList.add('echo-panel');this.mount.innerHTML=this.template();this.cineAnglePlacement=createReferenceAnglePlacement({screen:this.mount.querySelector('.echo-cine-screen'),indicator:this.$('cine-angle'),video:this.$('cine-video')});const overlayOptions={renderer,meshCanvas:this.$('probe-mesh'),guideCanvas:this.$('probe-guide'),mount:this.mount.querySelector('#echoViewportMount')};this.overlay=new TeeAtlasOverlay(overlayOptions);this.tteOverlay=new TteAtlasOverlay(overlayOptions);this.bind();this.updateUI();
  this.compactUI=mountEchoCompactWorkspace({mount:this.mount,presets:ECHO_PRESETS,getState:()=>this.state,onSelect:id=>this.selectPreset(id),onLayout:()=>this.renderer.requestRender()});
  this.referenceGallery=mountReferenceGallery({mount:this.mount,presets:ECHO_PRESETS,groups:{tte:TTE_ATLAS_GROUPS,tee:TEE_ATLAS_GROUPS},onSelect:id=>this.openReferenceView(id),onBack:()=>this.showReferenceGallery({focus:true})});
  this.referenceGallery.show();
  if(frames)this.setFrames(frames);
  if(String(donor.datasetId)===TEE_REFINEMENT_DATASET&&!donor.geometricComparisonOnly){this.loadPlaneReview();this.loadRegionReview();}
 }

 template(){return `
  ${referenceGalleryTemplate()}
  <div class="echo-workspace">
   <aside id="echoViewLibrary" class="echo-library" aria-label="Echocardiography window presets">
    <header class="echo-library-heading"><div><h2 data-echo="heading-title">TTE Views</h2><p data-echo="heading-subtitle">28 guideline views</p></div><button class="echo-compact-close" type="button" data-echo="compact-library-close" aria-label="Close View Library" hidden>×</button></header>
    <div class="echo-compact-library-actions" data-echo="compact-library-actions"></div>
    <div class="echo-approach" role="group" aria-label="Echo approach"><button type="button" data-mode="tte" aria-pressed="true">TTE<span>Transthoracic</span></button><button type="button" data-mode="tee" aria-pressed="false">TEE<span>Transesophageal</span></button></div>
    <div class="echo-atlas-browser" data-echo="atlas-browser" hidden>
     <label class="echo-search"><span class="sr-only" data-echo="search-label">Search All Reference Views</span><input type="search" data-echo="search" placeholder="Search all views…" autocomplete="off"></label>
     <div class="echo-atlas-groups" data-echo="tee-groups" role="group" aria-label="TEE view groups">${TEE_ATLAS_GROUPS.map(g=>`<button type="button" data-tee-group="${g.id}" aria-pressed="${g.id==='me'}">${titleCaseUi(g.name)}<span>${g.count}</span></button>`).join('')}</div>
     <div class="echo-atlas-groups echo-tte-groups" data-echo="tte-groups" role="group" aria-label="TTE acoustic windows">${TTE_ATLAS_GROUPS.map(g=>`<button type="button" data-tte-group="${g.id}" aria-pressed="${g.id==='apical'}">${titleCaseUi(g.name)}<span>${g.count}</span></button>`).join('')}</div>
    </div>
    <p class="echo-library-caption" data-echo="library-caption">Choose a reference window</p><div class="echo-presets" data-echo="presets"></div><p class="echo-search-empty" data-echo="search-empty" hidden>No matching views. Try a chamber, valve, or abbreviation.</p>
    <div class="echo-source"><span>VIEW REFERENCES</span><a href="${TTE_SOURCE}" target="_blank" rel="noopener">ASE Adult TTE Guidance ↗</a><a href="${TEE_SOURCE}" target="_blank" rel="noopener">ASE / SCA Comprehensive TEE ↗</a></div>
   </aside>
   <div class="echo-comparison">
   <nav class="echo-compact-navigation" data-echo="compact-navigation" aria-label="Echo Workspace" hidden>
    <div class="echo-compact-approach" data-echo="compact-approach"></div>
    <select class="echo-compact-view" data-echo="compact-view" aria-label="Reference View"></select>
    <button type="button" data-echo="compact-browse" aria-controls="echoViewLibrary" aria-expanded="false" title="Browse and Search Views">Views</button>
    <button class="echo-compact-settings-toggle" type="button" data-echo="compact-settings-toggle" aria-label="Echo Settings" aria-controls="echoCompactSettings" aria-expanded="false" title="Echo Settings"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16M9 3v6m6 0v6M9 15v6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
    <div class="echo-compact-view-switch" role="group" aria-label="Visible Echo Panes"><button type="button" data-echo-pane="anatomy" aria-controls="echoAnatomyPane" aria-pressed="false">Anatomy</button><button type="button" data-echo-pane="ultrasound" aria-controls="echoUltrasoundPane" aria-pressed="false">Ultrasound</button><button type="button" data-echo-pane="both" aria-controls="echoAnatomyPane echoUltrasoundPane" aria-pressed="true">Both</button></div>
   </nav>
   <section id="echoCompactSettings" class="echo-compact-settings" data-echo="compact-settings" aria-label="Echo Settings" hidden><header><h2>Echo Settings</h2><button class="echo-compact-close" type="button" data-echo="compact-settings-close" aria-label="Close Echo Settings">×</button></header><section data-echo="compact-model-controls"><h3>Anatomy</h3></section><section data-echo="compact-reference-controls"><h3>Ultrasound</h3></section><section data-echo="compact-plane-controls"></section></section>
   <header class="echo-active-view"><div><span data-echo="active-code">PLAX</span><h3 data-echo="active-name">Parasternal Long-Axis</h3><span class="echo-view-index" data-echo="view-index"></span></div><nav aria-label="Browse Reference Views"><button type="button" data-echo="previous" aria-label="Previous View">←</button><button type="button" data-echo="next" aria-label="Next View">→</button><button type="button" data-echo="diagram-open" aria-label="Enlarge View Illustration" hidden>Illustration ↗</button></nav></header>
   <section id="echoAnatomyPane" class="echo-view-column" aria-label="CT anatomy comparison pane">
    <div class="echo-scene-heading"><div><strong>3D Anatomy</strong></div></div>
    <div class="echo-panel-toolbar"><div class="echo-toolbar-content"><div class="echo-left-switch" role="group" aria-label="Left Comparison Pane"><button type="button" data-echo-view="3d" aria-pressed="true">3D Cutaway</button><button type="button" data-echo-view="ct" aria-pressed="false">CT Slice</button></div><div class="echo-anchor-controls" role="group" aria-label="Anchor the 3D View"><button type="button" data-echo="anchor-probe" aria-pressed="true" title="Face the scan sector with the probe at the top">Anchor by Probe View</button><button type="button" data-echo="anchor-anatomy" aria-pressed="false" title="Keep a fixed anatomical camera across views">Anchor by Anatomy</button></div><button class="echo-region-toggle" data-echo="region-toggle" type="button" aria-pressed="false" title="Show approximate chamber and vessel tissue regions">Region Colors</button><button class="echo-native-toggle" data-echo="ct-native" type="button" aria-pressed="false" hidden>1:1 Pixels</button></div></div>
    <div class="echo-comparison-screen echo-anatomy-screen">
     <div id="echoViewportMount" class="echo-viewport-mount" aria-label="Three-dimensional echo reference cutaway"><canvas class="echo-probe-mesh" data-echo="probe-mesh" aria-hidden="true" hidden></canvas><canvas class="echo-probe-guide" data-echo="probe-guide" aria-hidden="true" hidden></canvas></div><span class="echo-coverage-badge" data-echo="coverage-badge" hidden>Outside this heart scan · spatial context</span>
     <div class="echo-mpr-wrap" data-echo="ct-view" hidden><canvas data-echo="mpr" width="768" height="768" tabindex="0" role="img" aria-label="Oblique CT section. Click to face this plane in 3D; scroll or use arrow keys to move through sections."></canvas><p class="echo-mpr-message" data-echo="mpr-message" role="status">Loading reference planes</p></div>
    </div>
    <div class="echo-mpr-caption"><button type="button" data-echo="retry-detail" hidden>Retry Detail</button><button type="button" data-echo="align">Face This Plane ↗</button></div>
    <p class="echo-tissue-caption" data-echo="tissue-caption" hidden>Labels identify measured tissue regions, not blood pools or valve leaflets.</p>
    <div data-echo="region-legend" class="echo-region-legend" hidden></div>
    <div class="echo-probe-options" data-echo="probe-options" hidden><label><input type="checkbox" data-echo="probe-visible" checked> Probe</label><label><input type="checkbox" data-echo="sector-visible" checked> Scan Sector</label><label><input type="checkbox" data-echo="context-visible" checked> Anatomy Context</label></div>
    <p class="echo-context-alert" data-echo="context-alert" role="status" hidden></p>
    <details class="echo-model-details"><summary><span>Model Details</span></summary><div class="echo-model-details-body">
    <p class="echo-resolution-diagnostic" data-echo="resolution" role="status">Waiting for Scan</p><p class="echo-approx-badge" data-echo="ct-correspondence">CT Correspondence Unverified</p>
    <div class="echo-notice" data-echo="evidence-notice"><span aria-hidden="true">i</span><p data-echo="correspondence-note">Reviewing the correspondence of this measured CT plane.</p></div>
    <p class="echo-context-caption" data-echo="context-caption" hidden>Translucent esophagus, diaphragm and stomach · illustrative, unregistered anatomy</p>
    <p class="echo-probe-fit-note" data-echo="probe-fit-note" hidden></p>
    <div class="echo-fit-bar" data-echo="fit-bar" hidden><span>CT Plane</span><div role="group" aria-label="Compare CT Plane Placement"><button type="button" data-echo-fit="refined" aria-pressed="true">Reviewed Fit</button><button type="button" data-echo-fit="previous" aria-pressed="false">Previous Plane</button></div></div>
    <details class="echo-resolution-detail echo-fit-review" data-echo="fit-review" hidden><summary>Plane Quality Review <span data-echo="fit-status"></span></summary><p data-echo="fit-summary"></p><p data-echo="fit-regions"></p><p data-echo="fit-search"></p><ul data-echo="fit-limits"></ul><p class="echo-fit-qualification">Landmark-guided comparison of measured CT sections. Clinical ultrasound is from another person; the fit is educational and has not been clinically validated.</p></details>
    <p class="echo-detail-status" data-echo="detail-status">Prepared presets use the measured ${this.fineLabel} scan.</p>
    </div></details>
    <p class="echo-section-hint" data-echo="section-hint" hidden>Scroll to Move the Plane · 1:1 Pixels for Detail</p>
   </section>
    <section id="echoUltrasoundPane" class="echo-cine" aria-labelledby="echoCineTitle">
     <div class="echo-section-heading"><h3 id="echoCineTitle">Real Ultrasound</h3><span class="echo-reference-qualifier" title="Clinical recording from another person; not registered to this donor">Independent reference</span></div>
     <div class="echo-panel-toolbar"><div class="echo-toolbar-content"><label class="sr-only" for="echoCineSelect">Reference View</label><select id="echoCineSelect" data-echo="cine-select" disabled><option>Loading Reference Library</option></select><button class="echo-cine-fit" type="button" data-echo="cine-fit" hidden>Full Frame</button></div></div>
     <div class="echo-cine-screen echo-comparison-screen"><video data-echo="cine-video" controls playsinline autoplay muted loop preload="metadata" aria-label="Independent echocardiography reference movie" hidden></video><img data-echo="cine-image" class="echo-reference-image" alt="" hidden><iframe data-echo="cine-embed" class="echo-reference-embed" title="Independent clinical ultrasound source player" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" hidden></iframe><p class="echo-reference-loading" data-echo="cine-empty" role="status">Clinical reference loops load when this module opens.</p>${referenceAngleMarkup}</div>
     <p class="echo-cine-source-line"><span>Source:</span><a data-echo="cine-visible-source" target="_blank" rel="noopener">Clinical reference</a></p>
     <p class="echo-cine-angle-note" data-echo="cine-angle-note" hidden></p>
     <div class="echo-cine-status-slot"><div class="echo-cine-loading" data-echo="cine-loading" hidden><progress data-echo="cine-progress" max="1" value="0" aria-label="Reference movie download progress"></progress><span data-echo="cine-status" role="status" aria-live="polite"></span><button data-echo="cine-fallback" type="button" hidden>Play Local Example</button><button data-echo="cine-retry" type="button" aria-label="Retry reference movie" hidden>Retry</button></div></div>
     <div class="echo-cine-playback"><label data-echo="rate-label" for="echoCineRate">Speed <select id="echoCineRate" data-echo="cine-rate"><option value="0.25">¼×</option><option value="0.5">½×</option><option value="1" selected>1×</option><option value="1.5">1½×</option></select></label><label data-echo="loop-label"><input type="checkbox" data-echo="cine-loop" checked> Loop</label><a class="echo-media-open" data-echo="media-open" target="_blank" rel="noopener">Original ↗</a><button type="button" data-echo="cine-expand" aria-pressed="false">Enlarge Pair</button></div>
     <details class="echo-cine-credit"><summary><span>Source Details</span><span class="echo-source-qualifier">Independent Recording</span></summary><div class="echo-cine-credit-body"><p data-echo="cine-match">Independent Reference</p><p class="echo-cine-quality" data-echo="cine-quality"></p><p class="echo-cine-description" data-echo="cine-description">Named teaching examples from published sources.</p><p class="echo-cine-separation" data-echo="reference-note">Different person · fixed donor CT · no spatial or heartbeat registration.</p><p data-echo="cine-credit"></p><div><a data-echo="cine-source" target="_blank" rel="noopener">View Original Source ↗</a><a data-echo="cine-license" target="_blank" rel="noopener"></a><a data-echo="cine-guideline" target="_blank" rel="noopener" hidden>ASE Acquisition Reference ↗</a><a data-echo="cine-institution" target="_blank" rel="noopener" hidden>University of Toronto Viewer ↗</a></div><p data-echo="cine-institution-note" hidden></p></div></details>
    </section>
   <details class="echo-detail-fold"><summary>View Guidance &amp; Plane Controls</summary>
   <section class="echo-acquisition" data-echo="acquisition" aria-label="Echo acquisition reference" hidden><div><span data-echo="angle-label">Multiplane</span><strong data-echo="target-angle"></strong></div><div><span data-echo="depth-label">Probe level</span><strong data-echo="target-depth"></strong></div><p data-echo="maneuver-summary"></p><button type="button" data-echo="steer">Free Steering ↗</button><a data-echo="table-source" target="_blank" rel="noopener" hidden>ASE Table 2 ↗</a></section>
   <aside class="echo-detail" aria-label="Echo plane details and controls">
    <div class="echo-display-controls"><label for="echoMaterial">Visual Style</label><select id="echoMaterial" data-echo="material"><option value="3">Porcelain</option><option value="4">Tissue / Space</option><option value="6">Atlas Cinematic</option><option value="5">Anatomy Colors</option><option value="2">Grayscale</option><option value="0">Classic Ivory</option><option value="1">Classic Copper</option></select><label class="echo-checkbox"><input data-echo="cleanup" type="checkbox" checked><span>Clean Scan</span></label></div>
    <div class="echo-description"><span data-echo="position"></span><p data-echo="description"></p><div class="echo-acquisition-guidance" data-echo="acquisition-guidance" hidden><p data-echo="depth-evidence"></p><ol data-echo="maneuvers"></ol><p data-echo="teaching-point"></p><p data-echo="display-orientation"></p><p data-echo="acquisition-qualification">Clinical guidance requires adjustment for individual anatomy. The probe position is illustrative and unregistered.</p></div><div class="echo-angle-reference" data-echo="angle-reference" hidden><span>Typical TEE multiplane angle</span><strong data-echo="angle-range"></strong><small>Reference at the probe; independent of the CT plane rotation below.</small></div></div>
    <div class="echo-psax-level" data-echo="psax-level" hidden><label for="echoPsaxLevel">Short-Axis Level</label><select id="echoPsaxLevel"><option value="papillary">Midpapillary</option><option value="mitral">Mitral Valve</option></select></div>
    <div class="echo-controls">
     <div class="echo-slider"><label for="echoOffset">Move Through Plane <output data-echo="offset-value">0.0 mm</output></label><input id="echoOffset" data-control="offsetMm" type="range" min="-35" max="35" value="0" step="0.1"><div><span data-echo="offset-min">−35 mm</span><span data-echo="offset-max">+35 mm</span></div></div>
     <div class="echo-slider"><label for="echoRotation">Plane Rotation <output data-echo="rotation-value">0°</output></label><input id="echoRotation" data-control="rotationDeg" type="range" min="-90" max="90" value="0" step="1"></div>
     <div class="echo-slider"><label for="echoTilt">Plane Tilt <output data-echo="tilt-value">0°</output></label><input id="echoTilt" data-control="tiltDeg" type="range" min="-45" max="45" value="0" step="1"></div>
     <div class="echo-slider"><label for="echoContrast">Section Contrast <output data-echo="contrast-value">1.8×</output></label><input id="echoContrast" data-control="contrast" type="range" min="0.5" max="3" value="1.8" step="0.05"></div>
     <label class="echo-checkbox"><input data-echo="lock" type="checkbox" checked><span>Align 3D as the Plane Changes</span></label>
     <div class="echo-actions"><button type="button" data-echo="flip" aria-pressed="false">Flip Cutaway</button><button type="button" data-echo="reset">Reset Plane</button></div>
    </div>
    <details class="echo-anatomy"><summary>Donor Alignment &amp; View Checks</summary><p data-echo="alignment-note"></p><p data-echo="orientation-note" hidden></p><p data-echo="view-check"></p><p>Clinical target structures; their presence in this donor is not implied by this list.</p><div data-echo="anatomy"></div></details>
   </aside></details>
   </div>
  </div><dialog class="echo-diagram-dialog" data-echo="diagram-dialog" aria-labelledby="echoDiagramTitle"><header><div><span>CONCEPTUAL VIEW ILLUSTRATION</span><h3 id="echoDiagramTitle" data-echo="diagram-title"></h3></div><button type="button" data-echo="diagram-close" aria-label="Close view illustration">×</button></header><img data-echo="diagram-image" alt=""><p data-echo="diagram-caption"></p><small>ChatGPT Image artwork · <a data-echo="diagram-source" href="${TEE_SOURCE}" target="_blank" rel="noopener">ASE reference ↗</a> · conceptual navigation art, not acquired anatomy or ultrasound.</small></dialog>`;}

 $(name){return this.mount.querySelector(`[data-echo="${name}"]`);}
 setLeftView(view){this.state.leftView=view==='ct'&&!this.frames[this.frameKey()]?.outsideScan?'ct':'3d';this.updateLeftView();this.updateProbe();}
 updateLeftView(draw=true){
  const ct=this.state.leftView==='ct',wrap=this.$('ct-view'),native=this.state.ctNative;
  this.mount.querySelectorAll('[data-echo-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.echoView===this.state.leftView)));
  this.mount.querySelector('#echoViewportMount').hidden=ct;wrap.hidden=!ct;wrap.classList.toggle('is-native',native);
  this.$('tissue-caption').hidden=!ct||this.renderer.settings.palette!==5||!this.currentRegionalEvidence()?.regionAnchors?.length;
  this.$('ct-native').hidden=!ct;this.$('ct-native').setAttribute('aria-pressed',String(native));this.$('ct-native').textContent=native?'Fit Slice':'1:1 Pixels';
  this.$('section-hint').hidden=!ct;this.$('section-hint').textContent=native?'Full Measured Pixels · Scroll to Move the Plane':'Scroll to Move the Plane · 1:1 Pixels for Detail';
  if(ct&&draw){this.drawSection();if(native){wrap.scrollLeft=Math.max(0,(this.$('mpr').width-wrap.clientWidth)/2);wrap.scrollTop=Math.max(0,(this.$('mpr').height-wrap.clientHeight)/2);}}
  this.updateSectionResolution();this.renderer.requestRender();
 }
 bind(){
  this.$('retry-detail')?.addEventListener('click',()=>this.applyPlane(false,true));
  this.$('search').addEventListener('input',()=>{this.atlasSearch=this.$('search').value;this.renderPresets();});
  this.mount.querySelectorAll('[data-tee-group]').forEach(button=>button.addEventListener('click',()=>{this.atlasGroup=button.dataset.teeGroup;this.atlasSearch='';this.$('search').value='';this.renderPresets();this.$('presets').scrollTop=0;}));
  this.mount.querySelectorAll('[data-tte-group]').forEach(button=>button.addEventListener('click',()=>{this.atlasGroup=button.dataset.tteGroup;this.atlasSearch='';this.$('search').value='';this.renderPresets();this.$('presets').scrollTop=0;}));
  for(const [name,direction] of [['previous',-1],['next',1]])this.$(name).addEventListener('click',()=>this.stepPreset(direction));
  for(const [name,key] of [['probe-visible','showProbe'],['sector-visible','showSector'],['context-visible','showContext']])this.$(name).addEventListener('change',()=>{this.state[key]=this.$(name).checked;this.updateProbe();});
  this.mount.querySelectorAll('[data-echo-fit]').forEach(button=>button.addEventListener('click',()=>this.selectPlaneReference(button.dataset.echoFit)));
  this.$('anchor-probe').addEventListener('click',()=>{this.setLeftView('3d');this.setAlignment('probe');});
  this.$('anchor-anatomy').addEventListener('click',()=>this.frameAnatomyContext());
  this.$('region-toggle').addEventListener('click',()=>{const on=this.renderer.settings.palette===5;if(!on)this.previousRegionPalette=this.renderer.settings.palette;this.renderer.set({palette:on?(this.previousRegionPalette??4):5,anatomySelected:0});this.appearance?.changed();this.updateAppearance();});
  this.$('steer').addEventListener('click',()=>this.onSteer?.(this.state.preset));
  this.$('diagram-open').addEventListener('click',()=>this.$('diagram-dialog').showModal());
  this.$('diagram-close').addEventListener('click',()=>this.$('diagram-dialog').close());
  this.$('diagram-dialog').addEventListener('click',e=>{if(e.target===this.$('diagram-dialog'))this.$('diagram-dialog').close();});
  this.$('material').addEventListener('change',()=>{this.renderer.set({palette:Number(this.$('material').value)});this.appearance?.changed();this.updateAppearance();});
  this.$('cleanup').addEventListener('change',async()=>{const enabled=this.$('cleanup').checked;this.$('cleanup').disabled=true;try{if(this.appearance?.setCleanupEnabled)await this.appearance.setCleanupEnabled(enabled);else this.renderer.set({cleanupEnabled:enabled});this.updateAppearance();if(this.active)this.applyPlane(false,true);}catch(error){this.toast('The scan display could not be changed.');console.warn('Echo cleanup:',error);}finally{this.$('cleanup').disabled=false;}});
  this.$('region-legend').addEventListener('click',event=>{const button=event.target.closest('[data-echo-region]');if(!button)return;const id=Number(button.dataset.echoRegion);this.renderer.set({anatomySelected:this.renderer.settings.anatomySelected===id?0:id});this.appearance?.changed();this.updateAppearance();});
  this.mount.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{
   const mode=button.dataset.mode;this.atlasSearch='';this.$('search').value='';this.selectPreset(mode==='tee'?'me4c':'a4c');
  }));
  this.$('presets').addEventListener('click',event=>{const button=event.target.closest('[data-preset]');if(button)this.selectPreset(button.dataset.preset);});
  this.mount.querySelectorAll('[data-control]').forEach(input=>input.addEventListener('input',()=>{
   if(input.dataset.control!=='contrast')this.holdCurrentPlaneReference();
   this.state[input.dataset.control]=Number(input.value);this.updateReadouts();
   if(input.dataset.control==='contrast'){this.renderer.set({capContrast:this.state.contrast});this.drawSection();}
   else this.applyPlane();
  }));
  this.mount.querySelector('#echoPsaxLevel').addEventListener('change',event=>{this.state.psaxLevel=event.target.value;this.reset();});
  this.$('lock').addEventListener('change',event=>{this.state.lockCamera=event.target.checked;if(this.state.lockCamera)this.applyCameraAlignment();});
  this.$('flip').addEventListener('click',()=>{this.holdCurrentPlaneReference();this.state.flip=!this.state.flip;this.updateReadouts();this.applyPlane();});
  this.$('reset').addEventListener('click',()=>this.reset());
  this.$('align').addEventListener('click',()=>this.setAlignment('ultrasound'));
  this.mount.querySelectorAll('[data-echo-view]').forEach(button=>button.addEventListener('click',()=>this.setLeftView(button.dataset.echoView)));
  this.$('ct-native').addEventListener('click',()=>{this.state.ctNative=!this.state.ctNative;this.updateLeftView();});
  this.$('cine-select').addEventListener('change',()=>{this.mediaSelection=this.$('cine-select').value;this.updateCine();});
  this.$('cine-fit').addEventListener('click',()=>{this.cineFullFrame=!this.cineFullFrame;this.updateCine();});
  this.$('cine-rate').addEventListener('change',()=>{this.$('cine-video').playbackRate=Number(this.$('cine-rate').value);});
  this.$('cine-loop').addEventListener('change',()=>{this.$('cine-video').loop=this.$('cine-loop').checked;});
  this.$('cine-expand').addEventListener('click',()=>{const expanded=this.mount.classList.toggle('echo-cine-expanded');this.$('cine-expand').setAttribute('aria-pressed',String(expanded));this.$('cine-expand').textContent=expanded?'Show Presets':'Enlarge Pair';this.renderer.requestRender();});
  this.$('cine-retry').addEventListener('click',()=>{const selected=this.mediaCatalog?.clips.find(clip=>clip.id===this.mediaSelection);if(this.active&&selected)this.startCine(selected);});
  this.$('cine-fallback').addEventListener('click',()=>{const local=this.localCineReference();if(this.active&&local){this.mediaSelection=local.id;this.updateCine();}});
  this.$('cine-video').addEventListener('error',()=>{
   const video=this.$('cine-video');
   // Clearing a superseded source can queue a media event. It cannot fail the
   // next selection unless that current, attached source itself has an error.
   if(!this.active||!this.cineLoadedId||!video.error||video.getAttribute('src')!==this.cineSourceUrl)return;
   video.pause();this.cineResume=false;this.cineLoadedId=null;
   this.cineError('This browser could not play the movie. Retry or open the original source below.');
  });
  const canvas=this.$('mpr');
  canvas.addEventListener('click',()=>this.setAlignment('ultrasound'));
  canvas.addEventListener('wheel',event=>{if(!this.active||!this.meta)return;event.preventDefault();this.moveSection(Math.sign(event.deltaY)*(event.altKey?5:1));},{passive:false});
  canvas.addEventListener('keydown',event=>{
   if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','Enter',' '].includes(event.key))event.preventDefault();
   if(event.key==='ArrowUp'||event.key==='ArrowRight')this.moveSection(event.shiftKey?5:1);
   else if(event.key==='ArrowDown'||event.key==='ArrowLeft')this.moveSection(event.shiftKey?-5:-1);
   else if(event.key==='Home'){this.holdCurrentPlaneReference();this.state.offsetMm=0;this.updateReadouts();this.applyPlane();}
   else if(event.key==='Enter'||event.key===' '){this.setAlignment('ultrasound');}
  });
 }

 setMediaCatalog(catalog){
  const clips=(catalog?.clips||[]).filter(c=>['tte','tee'].includes(c.mode)&&typeof c.id==='string'&&typeof c.url==='string'&&typeof c.sourceUrl==='string');
  // Retrying a missing catalog must not replace a chosen source or restart a
  // playing movie that is still present. Changed source URLs retain their
  // existing mediaIdentity invalidation below.
  this.mediaCatalog={...catalog,clips};
  if(!clips.some(clip=>clip.id===this.mediaSelection&&clip.mode===this.state.mode&&clip.preset===this.frameKey()))this.mediaFrameKey=null;
  this.updateCine();
 }
 async loadMediaCatalog(){
  if(this.mediaCatalog&&!this.mediaCatalog.incompleteSources?.length)return this.mediaCatalog;
  const urls=['./assets/tte-atlas/media.json?v=tte-atlas-v1','./assets/tee-atlas/media.json?v=tee-atlas-20261107-framing','./assets/echo-media-v6.json?v=echo-correspondence-v11'];
  this.mediaSourceData??=new Map();
  if(!this.mediaPromise)this.mediaPromise=Promise.allSettled(urls.filter(url=>!this.mediaSourceData.has(url)).map(async url=>{
   const response=await fetch(url,{cache:'force-cache'});if(!response.ok)throw new Error(`Reference catalog returned ${response.status}`);
   const catalog=await response.json();this.mediaSourceData.set(url,catalog);
  })).then(()=>{
   const catalogs=urls.filter(url=>this.mediaSourceData.has(url)).map(url=>this.mediaSourceData.get(url));
   if(!catalogs.length)throw new Error('Reference catalogs could not load');
   const catalog={clips:catalogs.flatMap(c=>c.clips||[]),unavailable:Object.assign({},...catalogs.map(c=>c.unavailable||{})),incompleteSources:urls.filter(url=>!this.mediaSourceData.has(url))};
   if(!this.destroyed)this.setMediaCatalog(catalog);return catalog;
  }).catch(error=>{
   if(this.destroyed)return null;
   this.$('cine-empty').textContent='The reference library is temporarily unavailable. Reopen Reference Views to retry.';this.$('cine-select').innerHTML='<option>Reference Library Unavailable</option>';console.warn('Echo cine library:',error);return null;
  }).finally(()=>{this.mediaPromise=null;});
  return this.mediaPromise;
 }
 updateCine(){
  if(!this.mediaCatalog)return;
  const key=this.frameKey(),clips=this.mediaCatalog.clips.filter(c=>c.mode===this.state.mode&&c.preset===key),exact=preferredEchoReference(clips,{mode:this.state.mode,preset:key});
  if(this.mediaFrameKey!==key){this.mediaFrameKey=key;this.mediaSelection=exact?.id||'';}
  const selected=clips.find(c=>c.id===this.mediaSelection),select=this.$('cine-select'),video=this.$('cine-video');
  const angle=selected?.mode==='tee'?supplementalTeeAngle(TEE_ATLAS_VIEWS.find(view=>view.id===key)):null;
  this.$('cine-angle').hidden=!angle;this.$('cine-angle-note').hidden=!angle;
  if(angle){this.$('cine-angle-value').textContent=angle.label;this.$('cine-angle-pointer').setAttribute('x2',angle.x);this.$('cine-angle-pointer').setAttribute('y2',angle.y);this.$('cine-angle-note').textContent=angle.explanation;this.$('cine-angle').setAttribute('aria-label',`Reference multiplane angle ${angle.label}. ${angle.explanation}`);}
  this.$('cine-guideline').hidden=!selected;this.$('cine-guideline').href=selected?.pdfUrl||ECHO_PRESETS.find(view=>view.id===key)?.sourceUrl||(this.state.mode==='tee'?TEE_SOURCE:TTE_SOURCE);
  const institution=selected?.institutionalAlternative;this.$('cine-institution').hidden=!institution?.viewerUrl;this.$('cine-institution').href=institution?.viewerUrl||'';
  this.$('cine-institution-note').hidden=!institution?.viewerUrl;this.$('cine-institution-note').textContent=institution?`${institution.note||''} ${institution.deepLinkNote||''}`:'';
  const focusAspect=Number(selected?.focusAspect),canFrame=focusAspect>=1&&focusAspect<=2;
  this.$('cine-fit').hidden=!canFrame;this.$('cine-fit').textContent=this.cineFullFrame?'Fit Ultrasound':'Full Frame';
  video.classList.toggle('is-framed',canFrame&&!this.cineFullFrame);video.style.setProperty('--echo-cine-aspect',canFrame?String(focusAspect):'1.4');
  this.cineAnglePlacement.update({enabled:!!angle,sourceUrl:selected?.url||'',sourceKey:selected?mediaIdentity(selected):'',focusAspect,fullFrame:!canFrame||this.cineFullFrame});
  select.disabled=!clips.length;select.innerHTML=(!exact?'<option value="">No Example Available for This View</option>':'')+clips.map(c=>`<option value="${escapeHTML(c.id)}">${escapeHTML(titleCaseUi(this.state.mode==='tee'?(c.aseNumber?'ASE / SCA Guideline Cine':c.title||'Additional Clinical Example'):c.title))}</option>`).join('');select.value=selected?.id||'';
  this.updateCorrespondence(selected);
  if(!selected){
   this.stopCine();video.hidden=true;this.$('cine-loading').hidden=true;
   const guideline=ECHO_PRESETS.find(v=>v.id===this.state.preset)?.sourceUrl||(this.state.mode==='tee'?TEE_SOURCE:TTE_SOURCE);
   this.$('media-open').href=guideline;this.$('media-open').textContent='Guideline ↗';this.$('rate-label').hidden=true;this.$('loop-label').hidden=true;
   this.$('cine-empty').hidden=false;this.$('cine-empty').textContent=this.mediaCatalog.unavailable?.[key]||'No source-verified recording is available for this acquisition.';
   this.$('cine-description').textContent='Open the ASE guideline below to see the acquisition reference.';
   this.$('cine-quality').textContent='';
   this.$('cine-credit').textContent='Clinical view definitions are available in the ASE reference guide.';this.$('cine-source').href=guideline;
   this.$('cine-visible-source').href=guideline;this.$('cine-visible-source').textContent='ASE acquisition guideline ↗';
   this.$('cine-license').removeAttribute('href');this.$('cine-license').textContent='';return;
  }
  this.$('cine-description').textContent=selected.tableRow&&selected.supplementalVideo?`Guideline target: Table ${selected.tableRow} · ASE reference Video ${selected.supplementalVideo}. ${selected.description||''}`:selected.aseNumber?`ASE / SCA comprehensive examination · view ${selected.aseNumber} of 28.`:selected.description||'';
  const ownControls=selected.kind==='image'||selected.kind==='youtube';this.$('rate-label').hidden=ownControls;this.$('loop-label').hidden=ownControls;this.$('media-open').href=selected.watchUrl||selected.originalUrl||selected.sourceUrl;this.$('media-open').textContent='Original ↗';
  const [numerator,denominator]=String(selected.averageFrameRate||'0/1').split('/').map(Number),fps=numerator/(denominator||1);
  this.$('cine-quality').textContent=selected.qualityLabel||`${selected.width} × ${selected.height} source pixels · ${Number.isFinite(fps)?Number(fps.toFixed(1)):0} fps · no artificial upscaling`;
  this.$('cine-credit').textContent=[selected.author,selected.modifications].filter(Boolean).join('. ');
  this.$('cine-visible-source').href=selected.sourceUrl;this.$('cine-visible-source').textContent=`${selected.sourceName||selected.author||'Original publisher'} ↗`;
  this.$('cine-source').href=selected.sourceUrl;if(selected.licenseUrl)this.$('cine-license').href=selected.licenseUrl;else this.$('cine-license').removeAttribute('href');this.$('cine-license').textContent=selected.license||'';
  video.setAttribute('aria-label',`${selected.title}. ${selected.clinicalStatus}. Independent reference cine; not registered to this donor CT.`);
  if(this.active&&this.cineTargetKey!==mediaIdentity(selected))this.startCine(selected);
 }
 stopCine(){
  this.cineRequestId++;this.mediaCache.cancel();
  this.$('cine-fallback').hidden=true;
  this.cineNativeCleanup?.();this.cineNativeCleanup=null;
  this.cineEmbedController?.destroy();this.cineEmbedController=null;
  const still=this.$('cine-image');still.onload=null;still.onerror=null;still.removeAttribute('src');still.hidden=true;
  const embed=this.$('cine-embed');embed.onload=null;embed.onerror=null;embed.hidden=true;
  const video=this.$('cine-video');video.pause();
  if(video.hasAttribute('src')){video.removeAttribute('src');video.load();}
  // Detach first: an LRU eviction must never revoke a source still in use.
  this.mediaCache.setActive(null);this.cineTargetId=null;this.cineTargetKey=null;this.cineLoadedId=null;this.cineSourceUrl=null;this.cineResume=false;
 }
 localCineReference(){return localEchoReference(this.mediaCatalog?.clips||[],{mode:this.state.mode,preset:this.frameKey()});}
 showCineFallback(){const local=this.localCineReference();this.$('cine-fallback').hidden=!local||local.id===this.mediaSelection;}
 cineError(message){
  this.cineLoadedId=null;this.cineNativeCleanup?.();this.cineNativeCleanup=null;
  this.$('cine-video').hidden=true;this.$('cine-image').hidden=true;this.$('cine-embed').hidden=true;this.$('cine-empty').hidden=false;this.$('cine-empty').textContent=message;
  this.$('cine-loading').hidden=false;this.$('cine-progress').hidden=true;this.$('cine-status').textContent='Reference unavailable · original source remains linked.';this.$('cine-retry').hidden=false;
  this.showCineFallback();
 }
 startCine(selected){
  if(selected.kind==='youtube'){this.startYouTubeReference(selected);return;}
  if(selected.kind==='image'||selected.external){this.startExternalReference(selected);return;}
  const video=this.$('cine-video'),resume=this.cineResume||(!video.paused&&!video.ended);
  this.stopCine();this.cineTargetId=selected.id;this.cineTargetKey=mediaIdentity(selected);this.cineResume=resume;const token=this.cineRequestId;
  video.poster=selected.poster;video.muted=true;video.loop=this.$('cine-loop').checked;video.hidden=false;
  this.$('cine-empty').hidden=true;this.$('cine-loading').hidden=false;this.$('cine-retry').hidden=true;
  this.$('cine-progress').hidden=false;this.$('cine-progress').value=0;this.$('cine-status').textContent='Loading reference movie…';
  const current=()=>this.active&&!this.destroyed&&token===this.cineRequestId&&selected.id===this.mediaSelection;
  const release=scanActivity.beginForeground('echo-video');
  this.mediaCache.load(selected,{onProgress:(loaded,total)=>{
   if(!current())return;
   this.$('cine-progress').value=loaded/total;
   this.$('cine-status').textContent=`Loading movie · ${Math.round(loaded/total*100)}% · ${(total/1e6).toFixed(1)} MB`;
  }}).then(entry=>{
   if(!current())return;
   this.mediaCache.setActive(entry);this.cineSourceUrl=entry.url;video.src=entry.url;video.load();
   video.playbackRate=Number(this.$('cine-rate').value);video.loop=this.$('cine-loop').checked;this.cineLoadedId=selected.id;
   this.$('cine-progress').hidden=true;this.$('cine-status').textContent='Entire movie loaded · ready to play and scrub.';
   this.cineResume=false;video.defaultMuted=true;video.autoplay=true;
   video.play().then(()=>{if(current())this.$('cine-loading').hidden=true;}).catch(()=>{if(current()){this.$('cine-loading').hidden=false;this.$('cine-status').textContent='Ready · press Play to continue.';}});
  }).catch(error=>{
   if(!current()||error.name==='AbortError')return;
   this.cineResume=false;this.cineError('This movie could not load. Retry or open the original source below.');
   console.warn('Echo reference movie:',error);
  }).finally(release);
 }

 startYouTubeReference(selected){
  this.stopCine();this.cineTargetId=selected.id;this.cineTargetKey=mediaIdentity(selected);const token=this.cineRequestId,current=()=>this.active&&!this.destroyed&&token===this.cineRequestId&&selected.id===this.mediaSelection;
  this.$('cine-video').hidden=true;this.$('cine-image').hidden=true;this.$('cine-empty').hidden=false;this.$('cine-empty').textContent='Loading source player…';
  this.$('cine-loading').hidden=false;this.$('cine-progress').hidden=true;this.$('cine-retry').hidden=true;
  this.$('cine-status').textContent='Loading source player · muted autoplay.';
  this.showCineFallback();
  try{this.cineEmbedController=createYouTubeReference({placeholder:this.$('cine-embed'),selected,isCurrent:current,
   onReady:()=>{this.cineLoadedId=selected.id;this.$('cine-empty').hidden=true;this.$('cine-status').textContent='Starting Muted Playback…';},
   onPlaying:()=>{this.$('cine-status').textContent='Playing · Muted';this.$('cine-loading').hidden=true;},
   onBuffering:()=>{this.$('cine-loading').hidden=false;this.$('cine-status').textContent='Loading Source Video…';},
   onPaused:()=>{this.$('cine-loading').hidden=false;this.$('cine-status').textContent='Paused · press Play to continue.';},
   onBlocked:()=>{this.$('cine-loading').hidden=false;this.$('cine-status').textContent='Ready · press Play to start.';},
   onError:()=>this.cineError('The source player could not load. Retry, select the source still, or open Original below.'),
  });}catch{this.cineError('This source player could not be opened. Use Original below.');}
 }

 startExternalReference(selected){
  this.stopCine();this.cineTargetId=selected.id;this.cineTargetKey=mediaIdentity(selected);const token=this.cineRequestId,current=()=>this.active&&!this.destroyed&&token===this.cineRequestId&&selected.id===this.mediaSelection;
  const isImage=selected.kind==='image',element=this.$(isImage?'cine-image':'cine-video');
  this.$('cine-video').hidden=isImage;this.$('cine-image').hidden=!isImage;this.$('cine-empty').hidden=true;this.$('cine-loading').hidden=false;this.$('cine-progress').hidden=true;this.$('cine-retry').hidden=true;
  this.$('cine-status').textContent=isImage?'Loading clinical ultrasound image…':'Loading clinical reference movie…';
  this.showCineFallback();
  if(isImage){
   element.alt=selected.title+'. Independent clinical ultrasound reference.';
   element.onload=()=>{if(!current())return;this.cineLoadedId=selected.id;this.$('cine-status').textContent=selected.correspondence?.sourceLabelVerified?'Clinical ultrasound still · source label checked.':'Independent clinical ultrasound still.';this.$('cine-loading').hidden=true;};
   element.onerror=()=>{if(current())this.cineError('The original image could not load here. Open Original below to view its source, or retry.');};
   element.src=selected.url;
  }else{
   this.cineSourceUrl=selected.url;element.poster=selected.poster||'';element.muted=true;element.defaultMuted=true;element.autoplay=true;element.loop=this.$('cine-loop').checked;
   let blocked=false;
   const ready=()=>{if(!current()||element.getAttribute('src')!==selected.url)return;clearTimeout(timer);this.cineLoadedId=selected.id;const waiting=blocked||element.paused;this.$('cine-status').textContent=waiting?'Ready · press Play to start.':'Playing · Muted';this.$('cine-loading').hidden=!waiting;};
   const failed=()=>{if(current())this.cineError('This movie could not load. Retry or open the original source below.');};
   const mediaError=()=>{if(element.error&&element.getAttribute('src')===selected.url)failed();};
   const timer=setTimeout(failed,25000);element.addEventListener('loadeddata',ready);element.addEventListener('canplay',ready);element.addEventListener('error',mediaError);
   this.cineNativeCleanup=()=>{clearTimeout(timer);element.removeEventListener('loadeddata',ready);element.removeEventListener('canplay',ready);element.removeEventListener('error',mediaError);};
   element.src=selected.url;element.load();element.playbackRate=Number(this.$('cine-rate').value);
   element.play().then(()=>{if(current())this.$('cine-loading').hidden=true;}).catch(error=>{if(!current()||error?.name==='AbortError')return;blocked=true;this.$('cine-loading').hidden=false;this.$('cine-status').textContent='Ready · press Play to start.';});
  }
 }

 setVolume(data,meta){
  this.cancelFine();
  const hadVolume=!!this.data;this.data=data;this.meta=meta;const spacing=Array.isArray(meta.spacingUm)?meta.spacingUm:[meta.spacingUm,meta.spacingUm,meta.spacingUm];
  this.spacingMm=Math.min(...spacing)/1000;this.longestMm=Math.max(...meta.dimensions.map((d,i)=>(d-1)*spacing[i]))/1000;
  this.offsetLimitMm=35*this.longestMm/168.0104;this.state.offsetMm=clamp(Number(this.state.offsetMm)||0,-this.offsetLimitMm,this.offsetLimitMm);
  const input=this.mount?.querySelector('#echoOffset');if(input){input.min=-this.offsetLimitMm;input.max=this.offsetLimitMm;input.step=this.longestMm<85?.02:.1;
  const limit=Number(this.offsetLimitMm.toFixed(1));this.$('offset-min').textContent=`−${limit} mm`;this.$('offset-max').textContent=`+${limit} mm`;}
  this.sampler?.destroy();this.sampler=null;this.samplerVolume=null;this.sample=null;this.previewGrid=null;this.requestId++;
  this.sourceSpacingUm=Math.max(...spacing);this.$('resolution').textContent=`${this.sourceSpacingUm.toFixed(1)} µm source voxels`;
  if(this.active)this.applyPlane(!hadVolume,hadVolume);
 }

 ensureSampler(){
  if(!this.sampler)this.sampler=new MPRSampler();
  if(this.samplerVolume!==this.data){this.sampler.setVolume(this.data,this.meta,this.renderer.extent);this.samplerVolume=this.data;}
  return this.sampler;
 }

 /** Frames may be keyed by preset id or supplied as an array of {id,world:{...}}. */
 setFrames(input){
  if(input?.datasetId&&this.donor.datasetId&&String(input.datasetId)!==String(this.donor.datasetId))throw new Error('These reference planes belong to a different donor.');
  this.cancelFine();this.requestId++;this.frames={};
  this.presetOverrides=input?.presetOverrides||{};
  this.correspondenceReviews=input?.correspondence?.views||{};
  const source=input?.frames||input?.planes||input?.presets||input||{};
  const entries=Array.isArray(source)?source.map(frame=>[frame.id,frame]):Object.entries(source);
  for(const [id,value] of entries){const p=value?.world||value?.plane||value;if(validVector(p?.center)&&validVector(p?.right)&&validVector(p?.up))this.frames[id]={...p,normal:p.normal||cross(p.right,p.up),note:value.note||p.note||'',confidence:value.confidence||p.confidence||'',displayName:value.displayName,displayCode:value.displayCode,displayDescription:value.displayDescription,displayPosition:value.displayPosition,displayMirrorX:value.displayMirrorX===true,displayRotate180:value.displayRotate180===true};}
  this.baseFrames={...this.frames};this.contextModel=null;this.tteContextModel=null;this.acquisitionCache=null;this.rebuildAtlasFrames();
  this.preparedPresentation=null;
  this.updateUI();
  if(this.active)this.applyPlane();
 }

 setAtlasFlowFrames(input){this.flowFrames=Object.fromEntries((input?.presets||[]).map(p=>[p.id,p.world]).filter(([,p])=>p));if(this.baseFrames){this.rebuildAtlasFrames();this.updateUI();if(this.active)this.applyPlane();}}
 rebuildAtlasFrames(){
  if(!this.baseFrames)return;
  const tte=buildTteAtlasFrames(this.baseFrames,TTE_ATLAS_VIEWS,{geometricComparisonOnly:this.donor.geometricComparisonOnly,flowFrames:this.flowFrames,donorId:this.donor.datasetId||this.donor.id});
  const original=buildTeeAtlasFrames(tte,TEE_ATLAS_VIEWS,{geometricComparisonOnly:this.donor.geometricComparisonOnly,flowFrames:this.flowFrames});
  const reviewed=applyTeeRefinements(original,this.planeReview,{datasetId:this.donor.datasetId,geometricComparisonOnly:this.donor.geometricComparisonOnly,useRefinement:this.state.planeReference==='refined'});
  const context={donorId:this.donor.datasetId||this.donor.id,referenceMm:this.longestMm};
  this.frames=protectEchoTargetAcquisitions(buildDonorEchoFrames(reviewed,context),context);
 }
 async loadPlaneReview(){
  try{const catalog=await loadTeeRefinements();if(this.destroyed)return;
   // A late metadata response must never move a plane the user has edited.
   if(this.state.mode==='tee'&&isEchoPlaneModified(this.state)&&!this.restoredReviewedPending)this.state.planeReference='previous';
   this.setPlaneReview(catalog);
   this.restoredReviewedPending=false;
  }catch(error){if(!this.destroyed)console.warn('TEE plane review:',error);}
 }
 setPlaneReview(catalog){this.planeReview=catalog;this.rebuildAtlasFrames();this.preparedPresentation=null;this.updateUI();if(this.active&&this.state.mode==='tee')this.applyPlane(this.state.lockCamera,this.state.alignment==='upright');}
 async loadRegionReview(){
  try{const catalog=await loadTeeRegionalReview();if(this.destroyed)return;this.regionReview=catalog;this.updateCorrespondence();if(this.active)this.drawSection();}
  catch(error){if(!this.destroyed){this.regionReviewError=true;this.updateCorrespondence();console.warn('TEE regional evidence:',error);}}
 }
 currentRegionalEvidence(plane=this.getPlane()){
  return reviewedTeeEvidence(this.regionReview,{id:this.frameKey(),donor:this.donor,state:this.state,plane,outsideScan:this.frames[this.frameKey()]?.outsideScan});
 }
 holdCurrentPlaneReference(){
  // Before review metadata arrives, edits act on the visible original plane.
  // An explicit restored reviewed pose may wait for its catalog, until edited.
  if(!this.planeReview&&this.state.mode==='tee'){this.state.planeReference='previous';this.restoredReviewedPending=false;}
 }
 selectPlaneReference(value){
  if(!this.planeReview?.views[this.frameKey()])return;
  this.state.planeReference=value==='previous'?'previous':'refined';this.cancelFine();this.requestId++;this.rebuildAtlasFrames();this.preparedPresentation=null;this.reset({preserveUpright:true});
 }
 updatePlaneReview(){
  const item=!this.donor.geometricComparisonOnly&&String(this.donor.datasetId)===TEE_REFINEMENT_DATASET?this.planeReview?.views[this.frameKey()]:null,visible=this.state.mode==='tee'&&!!item&&!this.frames[this.frameKey()]?.outsideScan;
  this.$('fit-bar').hidden=!visible;this.$('fit-review').hidden=!visible;
  this.mount.querySelectorAll('[data-echo-fit]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.echoFit===this.state.planeReference)));
  if(!visible)return;
  const acquisition=this.getPlane()?.acquisition,modified=isEchoPlaneModified(this.state)||acquisition?.adjusted,evidence=this.currentRegionalEvidence();
  this.$('fit-status').textContent=acquisition?.adjusted?'Probe-constrained section':modified?'Manually adjusted':this.state.planeReference==='previous'?'Previous plane':evidence?teeReviewStatusText(evidence.status):'Regional evidence unavailable';
  const previous=this.state.planeReference==='previous';
  this.$('fit-summary').textContent=acquisition?.adjusted?`The anatomical acquisition constraints changed the starting plane orientation by ${acquisition.correctionAngleDeg.toFixed(1)}°. This section is sampled from donor voxels; findings for the previous plane do not apply.`:modified?'The current plane has been adjusted. The reviewed starting-plane findings do not establish the anatomy in this new section.':previous?'The previous plane is shown. Select Reviewed fit to see the source-reviewed placement and its anatomical findings.':evidence?.summary||'This measured plane has not loaded its source-specific regional review. Confirm the target structures before interpreting it as the named clinical view.';
  this.$('fit-regions').textContent=evidence?.visibleRegions.length?`CT regions visible: ${evidence.visibleRegions.join(', ')}.`:'';
  const count=Number(item.search?.candidatesEvaluated)||0;
  this.$('fit-search').textContent=count?`${count.toLocaleString()} candidate combinations were evaluated for the reviewed starting plane; this is not an accuracy score.`:'The reviewed starting plane was compared with neighboring measured sections and source landmarks.';
  this.$('fit-limits').innerHTML=(previous||modified?['The source review applies to the reviewed starting plane. Recheck the target structures in this displayed section.']:evidence?.remainingLimits||['Regional labels do not establish valve leaflets or the precise clinical acquisition.']).map(x=>`<li>${escapeHTML(x)}</li>`).join('');
 }

 /** Optional measured, precomputed density sections for the unmodified preset planes. */
 setPresetTextures(map){if(map?.datasetId&&this.donor.datasetId&&String(map.datasetId)!==String(this.donor.datasetId))throw new Error('These prepared sections belong to a different donor.');const textures=map?.textures||map||{};this.presetTextures=Object.fromEntries(Object.entries(textures).map(([key,item])=>[key,{...item,fineSpacingUm:this.fineSpacingUm}]));this.textureCache.clear();if(this.active)this.applyPlane(false,true);}
 /** Shared streamed fine-volume service; the host owns its lifecycle and cache. */
 setFineSource(source){this.cancelFine();this.fineSource=source;if(this.active)this.applyPlane(false,true);}
 cancelFine(){clearTimeout(this.fineTimer);this.fineTimer=null;this.fineController?.abort();this.fineController=null;this.facePendingToken=null;}
 queueFinePlane(plane,token,key){
  if(!this.fineSource?.samplePlane||this.renderer.settings.cleanupEnabled===false)return;
  this.pendingFineToken=token;
  this.fineTimer=setTimeout(async()=>{
   if(!this.active||token!==this.requestId)return;
   const controller=new AbortController();this.fineController=controller;
   try{
    this.$('detail-status').textContent=`Loading measured ${this.fineLabel} detail for this plane…`;
    const result=await this.fineSource.samplePlane(plane,{signal:controller.signal,priority:'interactive',exactRaster:true,persistSection:!isEchoPlaneModified(this.state),spacingUm:this.fineSpacingUm,onProgress:progress=>{
     if(controller.signal.aborted||!this.active||token!==this.requestId)return;
     const ready=Number(progress.ready)||0,total=Number(progress.total)||0;
     this.$('detail-status').textContent=total?`Loading measured ${this.fineLabel} detail · ${Math.round(ready/total*100)}%`:`Preparing measured ${this.fineLabel} detail…`;
    }});
    if(controller.signal.aborted||!this.active||token!==this.requestId)return;
    validateEchoFineSection(result,plane);
    this.pendingFineToken=null;this.showSample({...result,ultra:isUltra(result.sourceSpacingUm,result.spacingUm,this.fineSpacingUm),streamed:true},plane,token,key);
    await this.refineCutFace(plane,token,key,controller);
   }catch(error){
    if(error.name==='AbortError'||controller.signal.aborted||!this.active||token!==this.requestId)return;
    this.pendingFineToken=null;this.sectionError=true;this.$('detail-status').textContent='Fine detail could not load. The current-plane preview remains visible; use Retry detail.';this.updateSectionResolution();console.warn('Echo streamed section:',error);
   }finally{if(this.fineController===controller)this.fineController=null;}
  },160);
 }
 queueFineFace(plane,token,key){
  if(!this.fineSource?.samplePlane||this.renderer.settings.cleanupEnabled===false||!this.cutFacePlane||this.cutFacePlane===plane)return;
  this.facePendingToken=token;this.updateSectionResolution();
  this.fineTimer=setTimeout(async()=>{
   if(!this.active||token!==this.requestId)return;
   const controller=new AbortController();this.fineController=controller;
   try{await this.refineCutFace(plane,token,key,controller);}
   finally{if(this.fineController===controller)this.fineController=null;}
  },160);
 }
 async refineCutFace(plane,token,key,controller){
  const face=this.cutFacePlane;
  if(!face||face===plane||!this.active||token!==this.requestId||controller.signal.aborted)return;
  this.facePendingToken=token;this.updateSectionResolution();
  try{
   const result=await this.fineSource.samplePlane(face,{signal:controller.signal,priority:'interactive',exactRaster:true,
    persistSection:!isEchoPlaneModified(this.state),spacingUm:this.fineSpacingUm,onProgress:progress=>{
     if(controller.signal.aborted||!this.active||token!==this.requestId)return;
     const total=Number(progress.total)||0,ready=Number(progress.ready)||0;
     this.$('detail-status').textContent=total?`Loading full cut-face detail · ${Math.round(ready/total*100)}%`:'Preparing full cut-face detail…';
    }});
   if(controller.signal.aborted||!this.active||token!==this.requestId)return;
   validateEchoFineSection(result,face);
   this.cutFaceSample={...result,plane:face,token,streamed:true,ultra:isUltra(result.sourceSpacingUm,result.spacingUm,this.fineSpacingUm)};
   this.facePendingToken=null;this.faceError=false;this.presentCutFace(this.cutFaceSample,face,token,key);
   this.$('detail-status').textContent=`Full cut face · ${result.width} × ${result.height} measured pixels · ${Number(result.sourceSpacingUm).toFixed(1)} µm source${result.savedSection?' · saved on this device':''}. The CT view retains its original crop.`;
   this.updateSectionResolution();
  }catch(error){
   if(error.name==='AbortError'||controller.signal.aborted||!this.active||token!==this.requestId)return;
   this.facePendingToken=null;this.faceError=true;
   this.$('detail-status').textContent='Full cut-face detail could not load. The current-plane preview remains visible outside the CT crop; use Retry detail.';
   this.updateSectionResolution();console.warn('Echo full cut face:',error);
  }
 }
 presentCutFace(result,plane,token,key){
  this.renderer.setCapData({data:result.data,width:result.width,height:result.height,
   spacingUm:result.spacingUm||this.sourceSpacingUm,sourceSpacingUm:result.sourceSpacingUm||result.spacingUm||this.sourceSpacingUm,
   cleaned:result.cleaned===true,plane,key:`echo-${key}-${token}-${result===this.cutFaceSample?'face':result.ultra?'ultra':result.streamed?'fine':'volume'}`});
 }
 updateSectionResolution(){
  const isCt=this.state.leftView==='ct',failed=this.sectionError||!isCt&&this.faceError;
  const retry=this.$('retry-detail');if(retry)retry.hidden=!failed;
  const sample=this.sample;if(!sample||sample.token!==this.requestId)return;
  const full=this.cutFaceSample?.token===this.requestId?this.cutFaceSample:null;
  const partial=!isCt&&this.cutFacePlane&&this.cutFacePlane!==sample.plane&&!full;
  const shown=isCt?sample:full||sample;
  const spacing=partial?this.sourceSpacingUm:(shown.spacingUm||this.sourceSpacingUm);
  const pending=this.pendingFineToken===this.requestId||!isCt&&this.facePendingToken===this.requestId;
  this.$('resolution').textContent=`${Number(spacing).toFixed(1)} µm${partial||!shown.ultra&&!shown.streamed?' · Preview':shown.ultra?' · Ultra':' · Fine'}${pending?' · refining…':''}${failed?' · detail unavailable':''}`;
  this.$('resolution').dataset.resolutionUm=String(spacing);this.$('resolution').dataset.source=partial?'volume':shown.streamed?'streamed':shown.ultra?'prepared':'volume';
  this.$('resolution').dataset.faceCoverage=partial?'preview':'full';
 }
 loadPresetTexture(item,priority=0){const release=priority===0?scanActivity.beginForeground('echo-section'):()=>{};return this.textureCache.load(item,{priority}).finally(release);}
 warmPreset(key=this.frameKey()){
  if(!this.active||this.renderer.settings.cleanupEnabled===false)return Promise.resolve(null);
  const item=this.frames[key]?.atlasDerived?null:this.presetTextures[key];return item?.url?this.loadPresetTexture(item,1).catch(()=>null):Promise.resolve(null);
 }
 prefetchNeighbors(){
  clearTimeout(this.prefetchTimer);
  const key=this.frameKey();this.prefetchTimer=setTimeout(()=>{
   if(!this.active||key!==this.frameKey()||document.hidden||navigator.connection?.saveData||!scanActivity.getState().allowPrefetch)return;
   const presets=ECHO_PRESETS.filter(p=>p.mode===this.state.mode),index=presets.findIndex(p=>p.id===this.state.preset),neighbor=presets[index+1]||presets[index-1];
   if(neighbor)this.warmPreset(neighbor.id==='psax'?`psax_${this.state.psaxLevel}`:neighbor.id);
  },700);
 }

 enter(){if(this.destroyed)return;this.mount.hidden=false;if(this.restoreReferenceDetail){this.restoreReferenceDetail=false;this.openReferenceView();}else this.showReferenceGallery();}
 showReferenceGallery({focus=false}={}){const mode=this.referenceGallery?.visible?this.referenceGallery.state.mode:this.state.mode;this.leave();this.referenceGallery?.show({mode,focus});}
 openReferenceView(id){
  if(this.destroyed)return;
  this.referenceGallery?.hide();this.active=true;
  if(id)this.selectPreset(id);else{this.updateUI();this.updateAppearance();this.applyPlane(true);}
  this.loadMediaCatalog();this.updateCine();this.renderer.requestRender();
  const back=this.mount.querySelector('[data-reference="back"]');back?.scrollIntoView({block:'nearest',behavior:'instant'});back?.focus({preventScroll:true});
 }
 leave(){this.compactUI?.close();this.overlay?.stop();this.tteOverlay?.stop();this.$('diagram-dialog')?.close?.();this.active=false;this.requestId++;this.pendingFineToken=null;this.cancelFine();this.cutFaceSample=null;this.cutFacePlane=null;clearTimeout(this.sampleTimer);clearTimeout(this.prefetchTimer);this.textureCache.pause();this.queuedSample=null;this.preparedPresentation=null;this.sampler?.destroy();this.sampler=null;this.samplerVolume=null;this.stopCine();this.renderer.clearCapData();}
 reset({preserveUpright=false}={}){Object.assign(this.state,{offsetMm:0,rotationDeg:0,tiltDeg:0,flip:false});this.updateUI();if(this.active)this.applyPlane(true,preserveUpright&&this.state.alignment==='upright');}
 getState(){return {...this.state,presentation:this.referenceGallery?.visible?'gallery':'detail',gallery:this.referenceGallery?.state,contrast:this.renderer.settings.capContrast??this.state.contrast,donorPlaneRevision:echoDonorPlaneRevision(this.frames)};}
 restore(saved={}){
  // Existing shared view links retain their exact selected comparison and pose.
  this.restoreReferenceDetail=!this.active&&saved.presentation!=='gallery';
  const revision=echoDonorPlaneRevision(this.frames);
  if(revision&&saved.donorPlaneRevision!==revision)saved={...saved,offsetMm:0,rotationDeg:0,tiltDeg:0,flip:false,planeReference:'refined',donorPlaneRevision:revision};
  const savedId=saved.preset==='psax'?`psax_${saved.psaxLevel==='mitral'?'mitral':'papillary'}`:saved.preset;
  const preset=ECHO_PRESETS.find(p=>p.id===savedId)||ECHO_PRESETS[0];
  this.referenceGallery?.restore(saved.gallery||{mode:preset.mode});
  if(preset.group)this.atlasGroup=preset.group;
  const contrast=Number.isFinite(this.renderer.settings.capContrast)?clamp(this.renderer.settings.capContrast,.5,3):DEFAULT_STATE.contrast;
  this.state={...DEFAULT_STATE,contrast,...saved,mode:preset.mode,preset:preset.id};
  this.state.alignment=normalizeTeeAlignment(saved.alignment);
  this.state.psaxLevel=this.state.psaxLevel==='mitral'?'mitral':'papillary';
  this.state.leftView=this.state.leftView==='ct'?'ct':'3d';this.state.ctNative=!!this.state.ctNative;
  this.state.planeReference=saved.planeReference==='previous'||(!saved.planeReference&&isEchoPlaneModified(saved))?'previous':'refined';this.state.showContext=saved.showContext!==false;this.rebuildAtlasFrames();
  this.restoredReviewedPending=!this.planeReview&&saved.planeReference==='refined';
  for(const [key,min,max] of [['offsetMm',-this.offsetLimitMm,this.offsetLimitMm],['rotationDeg',-90,90],['tiltDeg',-45,45],['contrast',.5,3]])this.state[key]=clamp(Number(this.state[key])||(key==='contrast'?contrast:DEFAULT_STATE[key]),min,max);
  this.renderer.set({capContrast:this.state.contrast});
  this.state.flip=!!this.state.flip;this.state.lockCamera=!!this.state.lockCamera;this.updateUI();if(this.active)this.applyPlane(true);
  if(this.active&&saved.presentation==='gallery')this.showReferenceGallery();
 }

 selectPreset(id){if(id==='psax')id=`psax_${this.state.psaxLevel==='mitral'?'mitral':'papillary'}`;const preset=ECHO_PRESETS.find(p=>p.id===id);if(!preset)return;const preserveUpright=this.state.mode===preset.mode&&this.state.alignment==='upright';if(!preserveUpright&&this.frames[this.frameKey()]?.outsideScan&&!this.frames[id]?.outsideScan)this.renderer.camera.distance=1.55;this.renderer.set({anatomySelected:0});this.appearance?.changed();this.state.preset=id;this.state.mode=preset.mode;this.state.planeReference='refined';this.rebuildAtlasFrames();if(preset.group)this.atlasGroup=preset.group;if(this.frames[id]?.outsideScan)this.state.leftView='3d';this.reset({preserveUpright});this.updateAppearance();this.mount.querySelector('.echo-detail').scrollTop=0;if(!this.compactUI?.selectionChanged())this.mount.querySelector(`[data-preset="${id}"]`)?.focus({preventScroll:true});}
 moveSection(direction){this.holdCurrentPlaneReference();this.state.offsetMm=clamp(this.state.offsetMm+direction*(this.spacingMm||.3176),-this.offsetLimitMm,this.offsetLimitMm);this.updateReadouts();this.applyPlane();}
 frameKey(){return this.state.preset==='psax'?`psax_${this.state.psaxLevel}`:this.state.preset;}
 getPlane(){
  const base=this.frames[this.frameKey()];if(!base||!this.longestMm)return null;
  const model=this.anatomyContext?.()||null,signature=[base.displayMirrorX===true,base.displayRotate180===true].join(','),key=[this.frameKey(),signature,this.state.offsetMm,this.state.rotationDeg,this.state.tiltDeg,this.longestMm].join('|');
  if(this.acquisitionCache?.base===base&&this.acquisitionCache.model===model&&this.acquisitionCache.key===key)return this.acquisitionCache.plane;
  const view=ECHO_PRESETS.find(v=>v.id===this.frameKey());
  let starting;
  if(this.acquisitionStart?.base===base&&this.acquisitionStart.model===model&&this.acquisitionStart.signature===signature)starting=this.acquisitionStart.plane;
  else{
   const sourcePlane=f=>orientEchoPlaneForDisplay({center:[...f.center],right:norm(f.right),up:norm(f.up),normal:norm(f.normal||cross(f.right,f.up)),width:f.width||f.widthWorld||.65,height:f.height||f.heightWorld||.75,outsideScan:!!f.outsideScan,atlasDerived:!!f.atlasDerived,donorCalibration:f.donorCalibration,anatomyTargetsMm:f.anatomyTargetsMm,preferSourcePlane:f.preferSourcePlane,sourceTargetRevision:f.sourceTargetRevision,acquisitionTargetBudget:f.acquisitionTargetBudget},{mirrorX:f.displayMirrorX,rotate180:f.displayRotate180});
   const parentId=TTE_ACQUISITION_PARENT[view.id],parent=parentId&&this.frames[parentId];
   if(parent){
    const acquisition=resolveEchoAcquisitionPlane({plane:sourcePlane(parent),view:ECHO_PRESETS.find(v=>v.id===parentId),referenceMm:this.longestMm,contextModel:model,fourChamberPlane:this.frames.a4c});
    starting=reframeEchoAcquisitionPlane(acquisition,sourcePlane(base),{parentId});
   }else starting=resolveEchoAcquisitionPlane({plane:sourcePlane(base),view,referenceMm:this.longestMm,contextModel:model,fourChamberPlane:this.frames.a4c});
   this.acquisitionStart={base,model,signature,plane:starting};
  }
  if(!isEchoPlaneModified(this.state)){this.acquisitionCache={base,model,key,plane:starting};return starting;}
  let right=mul(starting.right,!!base.displayMirrorX!==!!base.displayRotate180?-1:1),up=mul(starting.up,base.displayRotate180?-1:1),normal=[...starting.normal];
  right=rotate(right,up,degrees(this.state.rotationDeg));normal=rotate(normal,up,degrees(this.state.rotationDeg));
  up=rotate(up,right,degrees(this.state.tiltDeg));normal=norm(rotate(normal,right,degrees(this.state.tiltDeg)));
  const plane={center:add(starting.center,mul(normal,this.state.offsetMm/this.longestMm)),right:norm(right),up:norm(up),normal,width:starting.width,height:starting.height,outsideScan:!!base.outsideScan,atlasDerived:starting.atlasDerived};
  const accepted=resolveEchoAcquisitionPlane({plane:orientEchoPlaneForDisplay(plane,{mirrorX:base.displayMirrorX,rotate180:base.displayRotate180}),view,referenceMm:this.longestMm,contextModel:model,constrainMarker:false});
  this.acquisitionCache={base,model,key,plane:accepted};return accepted;
 }

 facePlane({followScene=false,fitProbe=false}={}){
  const plane=this.getPlane();if(!plane)return;const outside=this.frames[this.frameKey()]?.outsideScan,target=outside?[0,0,0]:plane.center;
  if(outside)this.renderer.camera.distance=Math.max(this.renderer.camera.distance,2.6);
  this.renderer.alignPlane(echoDisplayFacing(plane,this.state.flip).normal,plane.up,target,{followScene});
  if(this.state.mode==='tte'&&this.state.showProbe!==false){
   const view=TTE_ATLAS_VIEWS.find(v=>v.id===this.state.preset),model=this.anatomyContext(),rect=this.renderer.canvas.getBoundingClientRect();
   if(view&&model){const pose=tteAtlasProbePose({...plane,outsideScan:!!outside},view,this.longestMm,model);this.renderer.camera.distance=tteProbeCameraDistance(pose,this.renderer.basis(),target,rect.width/Math.max(1,rect.height),fitProbe?1.55:this.renderer.camera.distance);}
  }
 }
 setAlignment(value,{remember=true}={}){
  if(this.anatomyLoadError){this.anatomyLoadError=false;this.anatomyContext();}
  this.state.alignment=remember?rememberTeeAlignment(value):normalizeTeeAlignment(value);
  if(this.state.alignment!=='upright')this.renderer.camera.distance=this.frames[this.frameKey()]?.outsideScan?2.6:1.55;
  this.applyCameraAlignment({fitUpright:true});this.updateUI();this.renderer.requestRender();
 }
 applyCameraAlignment({followScene=false,fitUpright=false}={}){
  if(this.state.alignment==='probe'){
   const plane=this.getPlane(),pose=plane?.acquisitionPose,rect=this.renderer.canvas.getBoundingClientRect();
   const camera=pose&&echoProbeCamera(plane,{flip:this.state.flip,aspect:rect.width/Math.max(1,rect.height),focusPoints:this.state.mode==='tte'?tteProbeFocusPoints(pose):atlasProbeFocusPoints(pose)});
   if(camera){this.renderer.camera.distance=camera.distanceMm/this.longestMm;this.renderer.alignPlane(mul(camera.forward,-1),camera.up,mul(camera.targetMm,1/this.longestMm),{followScene});return;}
  }
  if(this.state.alignment!=='upright'){this.facePlane({followScene,fitProbe:fitUpright});return;}
  const model=this.anatomyContext();if(!model)return;
  const rect=this.renderer.canvas.getBoundingClientRect(),camera=echoAnatomyCamera(model,rect.width/Math.max(1,rect.height));
  if(fitUpright)this.renderer.camera.distance=camera.distanceMm/this.longestMm;
  this.renderer.alignPlane(mul(camera.forward,-1),camera.up,mul(camera.targetMm,1/this.longestMm),{followScene});
 }
 anatomyContext(){
  if(!this.baseFrames||!this.longestMm)return null;
  if(!this.referenceAnatomy&&!this.anatomyLoad&&!this.anatomyLoadError){
   this.anatomyLoad=loadEchoReferenceAnatomy().then(reference=>{
    if(this.destroyed)return;this.referenceAnatomy=reference;this.contextModel=null;this.tteContextModel=null;this.acquisitionCache=null;
    if(this.active){this.updateUI();this.applyPlane(true);}else this.updateUI();
   }).catch(error=>{if(!this.destroyed){this.anatomyLoadError=true;console.warn('Echo reference anatomy:',error);if(this.active)this.updateProbe();}}).finally(()=>{this.anatomyLoad=null;});
  }
  const options={frames:this.baseFrames,referenceMm:this.longestMm,donorId:this.donor.datasetId||this.donor.id||'unassigned'};
  if(this.state.mode==='tte'){
   if(!this.tteContextModel||this.tteContextModel.referenceMm!==this.longestMm){const baseModel=createTteContextModel(options);this.tteContextModel=this.referenceAnatomy?createEchoAnatomyContext({...options,baseModel,referenceAnatomy:this.referenceAnatomy}):baseModel;}
   return this.tteContextModel;
  }
  if(!this.contextModel||this.contextModel.referenceMm!==this.longestMm){const baseModel=createTeeContextModel(options);this.contextModel=this.referenceAnatomy?createEchoAnatomyContext({...options,baseModel,referenceAnatomy:this.referenceAnatomy}):baseModel;}
  return this.contextModel;
 }
 frameAnatomyContext(){
  this.state.showContext=true;this.setLeftView('3d');this.setAlignment('upright');
 }
 preparedPixels(result,key){
  const frame=this.frames[key]||{};if(!frame.displayMirrorX&&!frame.displayRotate180)return result;
  if(this.preparedPresentation?.source!==result||this.preparedPresentation.key!==key)this.preparedPresentation={source:result,key,value:orientEchoPreparedPixels(result,{mirrorX:frame.displayMirrorX,rotate180:frame.displayRotate180})};
  return this.preparedPresentation.value;
 }
 applyPlane(forceAlign=false,preserveCamera=false){
  if(!this.active)return;this.cancelFine();const plane=this.getPlane();this.plane=plane;
  if(!plane){this.message(this.meta?'Loading reference planes':'Loading scan data');return;}
  this.cutFaceSample=null;this.faceError=false;this.sectionError=false;
  this.cutFacePlane=fullEchoCutFacePlane(plane,this.renderer.extent,{paddingWorld:2*this.fineSpacingUm/(this.longestMm*1000)});
  const retry=this.$('retry-detail');if(retry)retry.hidden=true;
  const outside=this.frames[this.frameKey()]?.outsideScan;
  this.renderer.set({mode:0,clipAxis:outside?-1:3,clipFlip:echoDisplayFacing(plane,this.state.flip).clipFlip,showPlanes:0,oblique:plane});
  this.renderer.clearCapData();this.clearSection();
  if(!preserveCamera&&(forceAlign||this.state.lockCamera))this.applyCameraAlignment({followScene:true,fitUpright:forceAlign});
  const token=++this.requestId,key=this.frameKey();clearTimeout(this.sampleTimer);clearTimeout(this.prefetchTimer);this.updateCine();this.updateCorrespondence();this.updateProbe();
  if(outside){this.pendingFineToken=null;this.textureCache.pause();this.sample=null;this.previewGrid=null;this.$('resolution').textContent='Whole-heart context · target outside scan';this.$('detail-status').textContent='The complete extracardiac target is absent from this excised-heart scan. The estimated probe provides spatial context; no matching CT section is shown.';this.message('This target is outside the heart scan.');return;}
  const item=plane.atlasDerived?null:this.presetTextures[key],unmodified=!isEchoPlaneModified(this.state);
  const fine=item?.url&&unmodified&&this.renderer.settings.cleanupEnabled!==false;
  if(fine){
   const cached=this.textureCache.peek(item);
   if(cached){this.pendingFineToken=null;this.loadPresetTexture(item).catch(()=>{});this.showSample(this.preparedPixels(cached,key),plane,token,key);this.queueFineFace(plane,token,key);this.prefetchNeighbors();return;}
   this.pendingFineToken=token;this.message('Preparing Ultra section…');this.$('detail-status').textContent='The current preset has loading priority. The measured volume appears first.';
   // Fine-image transfer does not block the worker's immediate lower-resolution view.
   this.loadPresetTexture(item).then(result=>{
    if(token!==this.requestId||!this.active)return;
    this.pendingFineToken=null;this.showSample(this.preparedPixels(result,key),plane,token,key);this.queueFineFace(plane,token,key);this.prefetchNeighbors();
   }).catch(error=>{
    if(error.name==='AbortError'||token!==this.requestId||!this.active)return;
    this.pendingFineToken=null;this.$('detail-status').textContent='Prepared Ultra image could not load; the current scan volume remains visible.';console.warn('Echo Ultra section:',error);
    if(this.fineSource?.samplePlane)this.queueFinePlane(plane,token,key);
    if(this.sample?.token===token)this.message('');
   });
  }else{
   this.pendingFineToken=null;this.textureCache.pause();this.message('Reconstructing adjusted section…');
   this.$('detail-status').textContent=this.renderer.settings.cleanupEnabled===false?`Original volume. Enable Clean scan for measured ${this.fineLabel} display detail.`:this.fineSource?.samplePlane?`The loaded volume appears first; measured ${this.fineLabel} detail follows when the plane settles.`:'This section is reformatted from the currently loaded donor volume.';
   this.queueFinePlane(plane,token,key);
  }
  this.sampleTimer=setTimeout(()=>this.samplePlane(plane,token,key,this.pendingFineToken===token),25);
 }

 async samplePlane(plane,token,key=this.frameKey(),finePending=false){
  if(!this.active||token!==this.requestId)return;
  if(this.sampling){this.queuedSample={plane,token,key,finePending};return;}
  this.sampling=true;
  try{
   const longest=768,width=Math.max(64,Math.round(longest*Math.min(1,plane.width/plane.height))),height=Math.max(64,Math.round(longest*Math.min(1,plane.height/plane.width)));
   const result=await this.ensureSampler().sample(plane,{width,height});
   if(this.sample?.token===token&&(this.sample.ultra||this.sample.streamed))return;
   if(token===this.requestId&&this.active){this.showSample({...result,spacingUm:this.sourceSpacingUm,ultra:false},plane,token,key);if(finePending&&this.pendingFineToken===token)this.$('detail-status').textContent='Measured Ultra detail is loading in the background for this plane.';}
  }catch(error){if(token===this.requestId&&this.active){this.message('This section could not be reconstructed. Adjust the plane to retry.');console.warn('Echo section:',error);}}
  finally{this.sampling=false;const next=this.queuedSample;this.queuedSample=null;if(next&&this.active)this.samplePlane(next.plane,next.token,next.key,next.finePending);}
 }

 showSample(result,plane,token,key){
  if(!this.active||token!==this.requestId)return;
  this.sample={...result,plane,token};this.previewGrid=null;
  if(result.ultra||result.streamed)this.sectionError=false;
  const face=this.cutFaceSample?.token===token?this.cutFaceSample:null;
  this.presentCutFace(face||result,face?.plane||plane,token,key);this.updateSectionResolution();
  if(result.savedSection)this.$('detail-status').textContent=`${result.width} × ${result.height} measured pixels · exact section saved on this device · ${Number(result.sourceSpacingUm).toFixed(1)} µm source.`;
  else if(result.streamed)this.$('detail-status').textContent=`${result.width} × ${result.height} measured pixels from the ${Number(result.sourceSpacingUm).toFixed(1)} µm volume · exact current plane.`;
  else if(result.ultra)this.$('detail-status').textContent=`${Math.round(result.encodedBytes/1000)} KB lossless preset texture · ${result.width} × ${result.height} measured display pixels.`;
  this.drawSection();this.message('');
 }

 drawSection(){
  if(!this.sample||this.state.leftView!=='ct')return;const {plane}=this.sample,canvas=this.$('mpr'),a=this.appearance,s=this.renderer.settings;
  const cleanup=this.sample.cleaned?null:a?.cleanup,anatomy=s.palette===5?a?.anatomy:null;
  if(!this.previewGrid||this.previewSource!==this.sample||this.previewFlip!==this.state.flip||this.previewCleanup!==cleanup||this.previewAnatomy!==anatomy){
   this.previewGrid=sampleEchoPreview(this.sample,{maxSize:Math.max(this.sample.width,this.sample.height),extent:this.renderer.extent,flip:this.state.flip,cleanup,anatomy});
   this.previewSource=this.sample;this.previewFlip=this.state.flip;this.previewCleanup=cleanup;this.previewAnatomy=anatomy;
   this.previewColors=buildAnatomyPalette(a?.anatomy?.palette||a?.anatomy?.labels);
  }
  const {width,height}=this.previewGrid;if(canvas.width!==width)canvas.width=width;if(canvas.height!==height)canvas.height=height;
  const context=canvas.getContext('2d'),rgba=paintEchoPreview(this.previewGrid,s,s.capContrast??this.state.contrast,this.previewColors);
  context.putImageData(new ImageData(rgba,width,height),0,0);
  const scale=Math.min(width*.25,20/(plane.width*this.longestMm)*width),scaleMm=scale/width*plane.width*this.longestMm;
  context.fillStyle='#f0ede5';context.strokeStyle='#f0ede5';context.lineWidth=Math.max(1.5,width/400);context.font=`${Math.max(12,width/40)}px ui-monospace,monospace`;
  const pad=width*.045,y=height-pad;context.beginPath();context.moveTo(pad,y);context.lineTo(pad+scale,y);context.stroke();context.fillText(`${Math.round(scaleMm)} mm`,pad,y-width*.018);
  const anchors=s.palette===5&&this.sample.token===this.requestId?this.currentRegionalEvidence(plane)?.regionAnchors:[];
  if(anchors?.length)paintTeeTissueAnchors(context,anchors,width,height,{flip:this.state.flip});
  this.$('tissue-caption').hidden=!anchors?.length;
  canvas.setAttribute('aria-label',`${this.displayPreset(ECHO_PRESETS.find(p=>p.id===this.state.preset)||ECHO_PRESETS[0]).name}, measured CT section, ${this.sample.spacingUm||this.sourceSpacingUm} micrometer source, offset ${this.state.offsetMm.toFixed(1)} millimeters. Click to align 3D. Scroll or use arrow keys to move through sections.`);
 }

 clearSection(){this.sample=null;this.previewGrid=null;this.$('tissue-caption').hidden=true;this.$('resolution').textContent='Preparing CT section…';const canvas=this.$('mpr');canvas?.getContext?.('2d')?.clearRect?.(0,0,canvas.width,canvas.height);canvas?.setAttribute?.('aria-label','CT section loading for the selected view.');}
 message(value){this.$('mpr-message').textContent=value;this.$('mpr-message').hidden=!value;this.$('mpr').classList.toggle('is-loading',!!value);}
 updateAppearance(){
  this.$('region-toggle').hidden=this.donor.anatomyManifestUrl===null;this.$('region-toggle').setAttribute('aria-pressed',String(this.renderer.settings.palette===5));
  const anatomyOption=this.$('material').querySelector('option[value="5"]');if(anatomyOption&&this.donor.anatomyManifestUrl===null){anatomyOption.disabled=true;anatomyOption.textContent='Anatomy · Unassigned';}
  // Global window changes retain the current contrast. Only an actual global
  // contrast change updates this module's matching control; changing planes
  // never reinstates a hard-coded brightness default.
  const contrast=this.renderer.settings.capContrast;
  if(Number.isFinite(contrast)&&this.state.contrast!==contrast){this.state.contrast=clamp(contrast,.5,3);this.updateReadouts();}
  this.$('material').value=this.renderer.settings.palette;this.$('cleanup').checked=this.renderer.settings.cleanupEnabled!==false;
  const legend=this.$('region-legend');legend.hidden=this.renderer.settings.palette!==5;
  if(this.appearance?.anatomy){const focused=document.activeElement?.dataset.echoRegion;legend.innerHTML=this.appearance.anatomy.labels.filter(label=>label.id).map(label=>`<button type="button" data-echo-region="${label.id}" aria-pressed="${this.renderer.settings.anatomySelected===label.id}"><i style="background:${label.color}" aria-hidden="true"></i>${escapeHTML(titleCaseUi(label.name))}</button>`).join('')+'<small>Approximate tissue regions · select to emphasize</small>';if(focused)legend.querySelector(`[data-echo-region="${focused}"]`)?.focus({preventScroll:true});}
  if(this.active)this.drawSection();
 }
 displayPreset(preset){
  if(this.frames[preset.id]?.donorCalibration)return preset;
  if(!this.donor.geometricComparisonOnly)return preset;
  const key=preset.id==='psax'?'psax_'+this.state.psaxLevel:preset.id,frame=this.frames[key]||{},override=this.presetOverrides?.[key]||{};
  return {...preset,code:frame.displayCode||override.code||'CT',name:frame.displayName||override.name||'Measured comparison plane',position:frame.displayPosition||override.position||'Independent scan section',description:frame.displayDescription||override.description||'A measured section from this donor. The ultrasound movie is an independent reference; its anatomy is not registered to this CT plane.',angles:undefined,anatomy:[]};
 }
 updateCorrespondence(selected=this.mediaCatalog?.clips.find(clip=>clip.id===this.mediaSelection)){
  const key=this.frameKey(),review=this.correspondenceReviews?.[key];
  const result=describeEchoCorrespondence({key,review,geometric:this.donor.geometricComparisonOnly,modified:isEchoPlaneModified(this.state),clip:selected});
  const view=ECHO_PRESETS.find(v=>v.id===key),outside=this.frames[key]?.outsideScan,accepted=this.getPlane(),acquisition=accepted?.acquisition,evidence=this.currentRegionalEvidence(),isTee=view?.mode==='tee';
  if(view){
   result.required=view.anatomy;result.check=view.teachingPoint;
   if(outside){result.status='Target outside scan';result.summary=evidence?.summary||'The complete extracardiac target is absent from this heart-only scan. The chest and probe show estimated spatial context; the ultrasound shows the clinical target.';}
   else if(isEchoPlaneModified(this.state)){result.status='CT plane adjusted';result.summary='The plane has moved from its specimen-specific starting estimate. Recheck the target structures in the current CT section.';}
   else if(accepted?.acquisitionUnavailable){
    result.status='Source target retained · probe fit unavailable';
    result.summary=acquisition?.reason||'The source target and surrounding anatomy are shown. No contained probe estimate preserves this target in the fixed illustrative tract.';
    result.orientationNote='The source CT section remains available. A probe and sector are withheld when fitting them would lose the intended anatomical target.';
   }
   else if(accepted?.donorCalibration){
    const fit=accepted.donorCalibration;
    result.status=fit.status==='unidentified-target'?'Named target unconfirmed':fit.status==='partial'?'Partial anatomical estimate':'Specimen-specific anatomical estimate';
    result.summary=fit.summary+' Probe position and surrounding anatomy are estimated; clinical registration is unvalidated.';
    result.orientationNote='This plane uses this specimen’s own source landmarks and newly sampled CT pixels. Camera anchors do not change the section.';
   }
   else if(acquisition?.adjusted){result.status='Probe-constrained CT plane';result.summary='The probe and displayed CT section share one plane through the target. This reformat uses measured donor voxels; the named clinical anatomy still needs confirmation.';}
   else if(evidence){result.status=teeReviewStatusText(evidence.status);result.summary=evidence.summary;result.orientationNote=this.state.alignment==='upright'?'The 3D camera keeps a consistent anatomical orientation. The CT image retains its reviewed presentation; the cutaway may be oblique or face away. Regional labels describe tissue ownership.':'Regional labels describe tissue ownership in this exact CT section; clinical probe alignment is unvalidated.';}
   else if(isTee&&this.state.planeReference==='previous'&&!this.donor.geometricComparisonOnly){result.status='Previous CT plane';result.summary='The previous plane is shown. Select Reviewed fit for the source-reviewed starting section and its regional findings.';}
   else if(this.frames[key]?.refinement){result.status='CT target unconfirmed';result.summary='This measured section has not loaded its regional anatomy review. Its named clinical target remains unconfirmed.';}
   else if(this.frames[key]?.atlasDerived&&!this.donor.geometricComparisonOnly){result.status='Approximate CT plane';result.summary=`Estimated from this specimen’s landmarks. Confirm the target structures; this is not a validated clinical ${isTee?'TEE':'TTE'} acquisition.`;}
   if(!isTee&&view.specificCoverage)result.summary+=' '+view.coverageNote;
   if(!isTee&&!outside){result.orientationNote='The chest and external probe are illustrative. The CT section uses this donor’s own voxels; neither the probe position nor the independent ultrasound is registered to this specimen.';}
   if(selected)result.referenceNote=selected.aseNumber?'Independent clinical recording · different person; no spatial or heartbeat registration.':selected.correspondence?.note||'Independent clinical recording · different person; no spatial or heartbeat registration.';
  }
  this.$('ct-correspondence').textContent=titleCaseUi(result.status);
  this.$('ct-correspondence').dataset.status=evidence?.status||((review?.status==='partial'&&!isEchoPlaneModified(this.state)&&!acquisition?.adjusted)?'partial':'unverified');
  this.$('evidence-notice').dataset.status=evidence?.status||'unverified';
  this.$('correspondence-note').textContent=result.summary;
  if(view)this.$('alignment-note').textContent=result.summary;
  this.$('cine-match').textContent=titleCaseUi(result.movieStatus);
  this.$('reference-note').textContent=result.referenceNote;
  this.$('view-check').textContent=result.check;
  this.$('orientation-note').hidden=!result.orientationNote;this.$('orientation-note').textContent=result.orientationNote;
  this.$('anatomy').innerHTML=result.required.map(label=>`<span>${escapeHTML(label)}</span>`).join('');
  this.updatePlaneReview();
 }
 renderPresets(){
  const isTee=this.state.mode==='tee',groups=isTee?TEE_ATLAS_GROUPS:TTE_ATLAS_GROUPS,query=this.atlasSearch.trim().toLowerCase(),terms=query.replace(/[-–]/g,' ').split(/\s+/).filter(Boolean);
  const all=ECHO_PRESETS.filter(p=>p.mode===this.state.mode),filtered=all.filter(p=>query?terms.every(term=>`${p.id} ${p.code} ${p.name} ${p.tableRow||''} ${(p.anatomy||[]).join(' ')}`.toLowerCase().replace(/[-–]/g,' ').includes(term)):p.group===this.atlasGroup);
  this.$('presets').innerHTML=filtered.map(original=>{
   const p=original,selected=p.id===this.state.preset;
   return `<button type="button" class="echo-preset echo-illustrated-preset ${selected?'is-selected':''}" data-preset="${p.id}" aria-pressed="${selected}" title="${escapeHTML(titleCaseUi(p.name))}"><img src="${p.thumbnail||p.illustration||p.diagram}" width="104" height="104" alt="" loading="lazy" decoding="async"><span class="echo-preset-copy"><span class="echo-preset-code">${escapeHTML(p.code)}${isTee?`<span>${p.angles}</span>`:''}</span><span class="echo-preset-name">${escapeHTML(titleCaseUi(p.shortName||p.name))}</span></span><span class="echo-ase-number">${isTee?String(p.aseNumber).padStart(2,'0'):p.tableRow}</span></button>`;
  }).join('');
  this.$('search-empty').hidden=!!filtered.length;
  this.$('library-caption').textContent=query?`${filtered.length} results across all views`:`${groups.find(g=>g.id===this.atlasGroup)?.name||this.state.mode.toUpperCase()} · ${filtered.length} views`;
  this.mount.querySelectorAll('[data-tee-group]').forEach(button=>button.setAttribute('aria-pressed',String(!query&&button.dataset.teeGroup===this.atlasGroup)));
  this.mount.querySelectorAll('[data-tte-group]').forEach(button=>button.setAttribute('aria-pressed',String(!query&&button.dataset.tteGroup===this.atlasGroup)));
 }
 stepPreset(direction){const all=ECHO_PRESETS.filter(p=>p.mode===this.state.mode),i=all.findIndex(p=>p.id===this.state.preset);this.atlasSearch='';this.$('search').value='';this.selectPreset(all[(i+direction+all.length)%all.length].id);if(!this.compactUI?.compact)this.mount.querySelector(`[data-preset="${this.state.preset}"]`)?.scrollIntoView({block:'nearest'});}
 updateProbe(){
  if(!this.overlay)return;
  const view=ECHO_PRESETS.find(v=>v.id===this.state.preset),plane=this.getPlane(),isTee=this.state.mode==='tee',overlay=isTee?this.overlay:this.tteOverlay;
  (isTee?this.tteOverlay:this.overlay)?.stop();
  if(!this.active||!view||!plane||this.state.leftView!=='3d'){overlay?.stop();this.$('context-caption').hidden=true;this.$('context-alert').hidden=true;this.$('probe-fit-note').hidden=true;return;}
  const contextModel=this.anatomyContext();
  if(!contextModel?.referenceAnatomy){overlay?.stop();this.$('context-caption').hidden=true;this.$('context-alert').hidden=false;this.$('context-alert').textContent=this.anatomyLoadError?'Reference Anatomy Unavailable · Select an Anchor to Retry':'Loading Reference Anatomy…';this.$('probe-fit-note').hidden=true;return;}
  this.$('context-alert').hidden=true;
  const hasPose=!!plane.acquisitionPose;
  // The fixed surrounding anatomy remains useful even when a manually moved
  // section has no fully contained instrument pose. Suppress only that probe
  // and fan, rather than making the entire esophagus/stomach disappear.
  overlay.set({plane,view,referenceMm:this.longestMm,showProbe:hasPose&&this.state.showProbe,showSector:hasPose&&this.state.showSector,showContext:this.state.showContext,contextModel});overlay.start();
  this.$('context-caption').hidden=this.state.showContext===false;
  this.$('context-caption').innerHTML=`<a href="https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html" target="_blank" rel="noopener">BodyParts3D thorax</a> · © DBCLS · <a href="https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html" target="_blank" rel="noopener">CC BY 4.0</a> · ${isTee?'esophagus, stomach and diaphragm':'skin, ribs, sternum, spine and diaphragm'} · illustrative alignment`;
  const fit=overlay.pose?.contextFit,note=this.$('probe-fit-note'),visible=this.state.showProbe||this.state.showSector;
  if(!hasPose){note.hidden=false;note.textContent=plane.acquisition?.sourcePlaneRetained?`${plane.acquisition.reason} The specimen’s fixed anatomy context remains visible.`:'No contained probe pose is available for this adjusted section. The specimen’s fixed anatomy context remains visible. Reset the plane to restore its acquisition.';note.dataset.estimated='true';this.$('context-alert').hidden=!visible;this.$('context-alert').textContent='Probe Unavailable for This Plane · See Model Details';return;}
  note.hidden=!visible;
  if(visible){
   const depth=Number.isFinite(fit?.insertionCm)?` · ${fit.insertionCm.toFixed(1)} cm in the model`:'',level=fit?.levelLabel||view.depthLabel;
   const qualifier=fit?.outsideScan||this.frames[this.frameKey()]?.outsideScan?'This target is outside the heart scan; no corresponding CT section is shown.':isTee?'Probe, scan sector and CT cut share one plane. The head follows the reference esophageal or gastric lumen.':'Probe, scan sector and CT cut share one plane. The acoustic face contacts the reference skin surface.';
   note.textContent=`${level}${depth}. ${qualifier} Reference anatomy is not registered to this specimen.`;
   note.dataset.estimated=String(fit?.estimated===true||fit?.resolved===false);
  }
 }
 updateUI(){
  const original=ECHO_PRESETS.find(p=>p.id===this.state.preset)||ECHO_PRESETS[0],preset=this.displayPreset(original),isTee=original.mode==='tee',outside=this.frames[this.frameKey()]?.outsideScan;
  if(outside)this.state.leftView='3d';
  this.mount.classList.toggle('echo-tee-atlas',isTee);
  this.mount.classList.toggle('echo-tte-atlas',!isTee);
  this.mount.querySelectorAll('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===this.state.mode)));
  this.$('heading-title').textContent=isTee?'TEE Views':'TTE Views';
  this.$('heading-subtitle').textContent=isTee?'28 ASE / SCA Guideline Views':`${TTE_ATLAS_VIEWS.length} ASE Table 2 Views`;
  for(const key of ['atlas-browser','diagram-open','acquisition','acquisition-guidance','probe-options'])this.$(key).hidden=false;
  this.$('tee-groups').hidden=!isTee;this.$('tte-groups').hidden=isTee;
  const viewCount=isTee?TEE_ATLAS_VIEWS.length:TTE_ATLAS_VIEWS.length;
  this.$('search').placeholder=`Search All ${viewCount} ${isTee?'TEE':'TTE'} Views…`;this.$('search-label').textContent=`Search All ${viewCount} ${isTee?'TEE':'TTE'} Views`;
  this.$('anchor-probe').setAttribute('aria-pressed',String(this.state.alignment==='probe'));
  this.$('anchor-anatomy').setAttribute('aria-pressed',String(this.state.alignment==='upright'));
  this.$('context-caption').hidden=this.state.leftView!=='3d'||this.state.showContext===false;
  this.$('coverage-badge').hidden=!outside;this.mount.querySelector('[data-echo-view="ct"]').disabled=!!outside;
  this.$('probe-visible').checked=this.state.showProbe!==false;this.$('sector-visible').checked=this.state.showSector!==false;this.$('context-visible').checked=this.state.showContext!==false;
  this.renderPresets();
  const title=original;
  this.$('active-code').textContent=title.code;this.$('active-name').textContent=titleCaseUi(title.name);this.$('position').textContent=preset.position;this.$('description').textContent=preset.description;
  this.$('view-index').textContent=isTee?`${String(original.aseNumber).padStart(2,'0')} / 28`:`Table ${original.tableRow} · ${original.tableOrder} / ${TTE_ATLAS_VIEWS.length}`;
  this.$('angle-label').textContent=isTee?'Multiplane':'Probe Marker';this.$('depth-label').textContent=isTee?'Probe Level':'Acoustic Window';
  this.$('steer').hidden=!isTee;this.$('table-source').hidden=isTee;
  this.$('table-source').href=original.sourceUrl||TTE_SOURCE;this.$('table-source').textContent=`ASE Table ${original.tableRow||'2'} ↗`;
  {
   this.$('target-angle').textContent=isTee?original.angles:(original.markerShort||original.marker||'See acquisition guidance');this.$('target-depth').textContent=isTee?original.depthLabel:TTE_ATLAS_GROUPS.find(g=>g.id===original.group)?.name||original.position;
   this.$('maneuver-summary').textContent=original.maneuvers?.[0]||original.teachingPoint;
   this.$('depth-evidence').textContent=original.depthEvidence||original.coverageNote||'';this.$('maneuvers').innerHTML=(original.maneuvers||[]).map(m=>`<li>${escapeHTML(m)}</li>`).join('');this.$('teaching-point').textContent=original.teachingPoint;this.$('display-orientation').textContent=original.displayOrientation||'';
   this.$('acquisition-qualification').textContent=isTee?'Clinical angle ranges guide acquisition; individual anatomy requires adjustment. The probe tract and insertion depth are not registered to this excised specimen.':'Patient position, rib spaces and marker direction guide acquisition. The chest and external probe shown here are illustrative and unregistered to this donor.';
   this.$('diagram-title').textContent=titleCaseUi(original.name);this.$('diagram-image').src=original.illustration||original.diagram;this.$('diagram-image').alt=`${original.name}: ${original.anatomy.join(', ')}`;this.$('diagram-caption').textContent=original.teachingPoint;
   this.$('diagram-source').href=original.sourceUrl||(isTee?TEE_SOURCE:TTE_SOURCE);this.$('diagram-source').textContent=isTee?'ASE / SCA Table 10 ↗':`ASE Table ${original.tableRow} ↗`;
  }
  this.$('alignment-note').textContent=isTee?(this.currentRegionalEvidence()?.summary||'The current CT section is a regional comparison. Its named target structures need confirmation.'):this.frames[this.frameKey()]?.note||'This donor has independent starting planes. Their anatomical landmarks and clinical echo correspondence have not been verified.';
  this.$('angle-reference').hidden=!original.angles;this.$('angle-range').textContent=original.angles||'';this.$('psax-level').hidden=preset.id!=='psax';this.mount.querySelector('#echoPsaxLevel').value=this.state.psaxLevel;
  if(this.donor.geometricComparisonOnly&&!this.frames.psax_mitral?.donorCalibration){for(const option of this.mount.querySelectorAll('#echoPsaxLevel option'))option.textContent=option.value==='mitral'?'Section B':'Section A';}
  this.updateReadouts();this.updateLeftView(false);this.updateCorrespondence();this.updateCine();this.updateProbe();this.compactUI?.sync();
 }
 updateReadouts(){
  this.mount.querySelectorAll('[data-control]').forEach(input=>{input.value=this.state[input.dataset.control];});
  this.$('offset-value').textContent=`${this.state.offsetMm>0?'+':''}${this.state.offsetMm.toFixed(1)} mm`;
  this.$('rotation-value').textContent=`${this.state.rotationDeg>0?'+':''}${this.state.rotationDeg}°`;this.$('tilt-value').textContent=`${this.state.tiltDeg>0?'+':''}${this.state.tiltDeg}°`;this.$('contrast-value').textContent=`${this.state.contrast.toFixed(2).replace(/0$/,'')}×`;
  this.$('lock').checked=this.state.lockCamera;this.$('flip').setAttribute('aria-pressed',String(this.state.flip));
 }
 destroy(){this.leave();this.destroyed=true;this.referenceGallery?.destroy();this.compactUI?.destroy();this.cineAnglePlacement?.destroy();this.sampler?.destroy();this.textureCache.destroy();this.mediaCache.destroy();this.overlay.dispose();this.tteOverlay?.dispose();}
}
