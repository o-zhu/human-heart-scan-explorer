import {volumeShaderSources} from './renderer.js';
import {LumenCleanupController} from './lumen-cleanup-v23.js';
import {loadDebrisAttribute} from './mesh-debris-cleanup-v25.js';
import {LocalSurfaceRefinementController} from './local-surface-refinement.js';
import {drawIndexedTriangles,assertMeshDrawSucceeded} from './mesh-draw.js';
import {getDeviceResourcePolicy,permittedSurface,assertSurfaceBudget} from './device-resources.js';
import {ActiveLoadWatchdog,withAbort,progressFetch} from './load-watchdog.js';

const vertex=`#version 300 es
layout(location=0) in vec3 quantizedPosition;
layout(location=1) in vec3 quantizedNormal;
layout(location=2) in float detachedComponent;
uniform vec3 boundsMin,boundsMax,eye,forward,right,up;
uniform float fov,cameraAspect;
out vec3 meshPosition,meshNormal;
flat out float removedDebris;
void main(){
 meshPosition=mix(boundsMin,boundsMax,quantizedPosition);meshNormal=quantizedNormal;removedDebris=detachedComponent;
 vec3 d=meshPosition-eye;float depth=dot(d,forward);
 float nearPlane=.01,farPlane=10.;
 gl_Position=vec4(dot(d,right)/(fov*cameraAspect),dot(d,up)/fov,
  (farPlane+nearPlane)/(farPlane-nearPlane)*depth-2.*farPlane*nearPlane/(farPlane-nearPlane),depth);
}`;
const fragment=volumeShaderSources.volume.slice(0,volumeShaderSources.volume.indexOf('void main(){'))+`
in vec3 meshPosition,meshNormal;
flat in float removedDebris;
uniform int debrisCleanupEnabled;
uniform int nativeReplacementEnabled,nativePatchPass;
uniform vec3 nativeRegionMin,nativeRegionMax;
uniform int refinementPatchPass,refinementPatchIndex;
void main(){
 if(refinementReady==1){
  int region=refinementRegionAt(meshPosition);
  if(refinementPatchPass==0&&nativePatchPass==0&&region>=0)discard;
  if(refinementPatchPass==1&&region!=refinementPatchIndex)discard;
  if(nativePatchPass==1&&localRefinementExcluded(meshPosition)>.5)discard;
 }
 if(nativeReplacementEnabled==1){
  bool insideNative=all(greaterThanEqual(meshPosition,nativeRegionMin))&&all(lessThanEqual(meshPosition,nativeRegionMax));
  if((nativePatchPass==0&&insideNative)||(nativePatchPass==1&&!insideNative))discard;
 }
 if(debrisCleanupEnabled==1&&removedDebris>.5)discard;
 if(clipAxis>=0&&dot(planeNormal,meshPosition)>planeDistance)discard;
 if(lumenExcluded(meshPosition)>.5)discard;
 vec3 rd=normalize(meshPosition-eye);
 vec3 color=shade(meshPosition,threshold+.015,normalize(meshNormal),rd,false);
 fragColor=vec4(pow(max(color,vec3(0.)),vec3(.89)),1.);
}`;
const background=`#version 300 es
precision highp float;
uniform vec2 resolution;uniform int palette;out vec4 fragColor;
void main(){vec2 uv=gl_FragCoord.xy/resolution*2.-1.;float q=max(0.,1.-length(uv*vec2(.66,.7)));
 vec3 bg=mix(vec3(.035,.043,.050),vec3(.075,.083,.089),q);
 if(palette>=3)bg=mix(vec3(.018,.029,.037),vec3(.051,.073,.082),q);
 if(palette==4)bg=mix(vec3(.004,.007,.011),vec3(.012,.022,.029),q);
 if(palette==6)bg=mix(vec3(.008,.009,.010),vec3(.021,.022,.022),q);
 fragColor=vec4(pow(bg,vec3(.89)),1.);}`;

export const fineSurfaceShaderSources={vertex,fragment,background};

/** A compact static isosurface; measured slice textures use the existing cap pass. */
export class FineSurfacePass{
 constructor(renderer,decoded,manifest,lod){
  const gl=renderer.gl;this.gl=gl;this.manifest=manifest;this.lod=lod;this.indexCount=decoded.indexCount;
  this.geometrySourceSha256=decoded.geometrySourceSha256||null;
  this.bounds=lod.bounds||manifest.bounds;this.enabled=false;this.buffers=[];
  this.hasDebrisMask=decoded.debrisFlags instanceof Uint8Array&&decoded.debrisFlags.length===decoded.vertexCount;
  this.debrisReport=this.hasDebrisMask?decoded.debrisReport:null;
  try{
  this.program=renderer.createProgram(vertex,fragment);this.backgroundProgram=renderer.createProgram(volumeShaderSources.vertex,background);
  this.uniforms=Object.fromEntries(Object.keys(renderer.uniforms).map(name=>[name,gl.getUniformLocation(this.program,name==='anatomyColors'?'anatomyColors[0]':name)]));
  this.boundsMin=gl.getUniformLocation(this.program,'boundsMin');this.boundsMax=gl.getUniformLocation(this.program,'boundsMax');
  this.debrisEnabled=gl.getUniformLocation(this.program,'debrisCleanupEnabled');
  this.nativeUniforms=Object.fromEntries(['nativeReplacementEnabled','nativePatchPass','nativeRegionMin','nativeRegionMax'].map(name=>[name,gl.getUniformLocation(this.program,name)]));
  this.refinementUniforms=Object.fromEntries(['refinementPatchPass','refinementPatchIndex'].map(name=>[name,gl.getUniformLocation(this.program,name)]));
  this.vao=gl.createVertexArray();if(!this.vao)throw new Error('Fine surface vertex storage is unavailable.');gl.bindVertexArray(this.vao);
  for(const [location,offset,type]of [[0,decoded.positionOffset,gl.UNSIGNED_SHORT],[1,decoded.normalOffset,gl.SHORT]]){
   const buffer=gl.createBuffer();if(!buffer)throw new Error('Fine surface storage is unavailable.');this.buffers.push(buffer);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
   gl.bufferData(gl.ARRAY_BUFFER,new Uint8Array(decoded.buffer,offset,decoded.vertexCount*6),gl.STATIC_DRAW);
   gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,3,type,true,0,0);
  }
  if(this.hasDebrisMask){
   const buffer=gl.createBuffer();if(!buffer)throw new Error('Detached-debris filter storage is unavailable.');this.buffers.push(buffer);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
   gl.bufferData(gl.ARRAY_BUFFER,decoded.debrisFlags,gl.STATIC_DRAW);gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,1,gl.UNSIGNED_BYTE,true,0,0);
  }
  const index=gl.createBuffer();if(!index)throw new Error('Fine surface index storage is unavailable.');this.buffers.push(index);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,index);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint32Array(decoded.buffer,decoded.indexOffset,decoded.indexCount),gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  if(gl.getError()!==gl.NO_ERROR)throw new Error('The graphics device could not retain this surface. Try the compact mesh.');
  this.target={texture:gl.createTexture(),framebuffer:gl.createFramebuffer(),depthTexture:gl.createTexture(),width:0,height:0};
  if(!this.target.texture||!this.target.framebuffer||!this.target.depthTexture)throw new Error('Fine surface render storage is unavailable.');
  gl.bindTexture(gl.TEXTURE_2D,this.target.texture);
  for(const [key,value]of [[gl.TEXTURE_MIN_FILTER,gl.NEAREST],[gl.TEXTURE_MAG_FILTER,gl.NEAREST],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,key,value);
  gl.bindTexture(gl.TEXTURE_2D,this.target.depthTexture);
  for(const [key,value]of [[gl.TEXTURE_MIN_FILTER,gl.NEAREST],[gl.TEXTURE_MAG_FILTER,gl.NEAREST],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,key,value);
  this.enabled=true;
  }catch(error){gl.bindVertexArray(null);this.dispose();throw error;}
 }
 activeFor(renderer){
  const s=renderer.settings;
  return this.enabled&&!renderer.coronaryActive?.()&&s.mode===0&&s.cleanupEnabled!==false&&!s.showPlanes&&Math.abs(s.threshold-this.manifest.threshold)<.00001&&this.manifest.extent.every((v,i)=>Math.abs(v-renderer.extent[i])<.000001);
 }
 draw(renderer,w,h,b,aspect){
  const gl=this.gl,t=this.target;
  gl.bindFramebuffer(gl.FRAMEBUFFER,t.framebuffer);
  if(t.width!==w||t.height!==h){
   gl.bindTexture(gl.TEXTURE_2D,t.texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
   gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t.texture,0);
   gl.bindTexture(gl.TEXTURE_2D,t.depthTexture);gl.texImage2D(gl.TEXTURE_2D,0,gl.DEPTH_COMPONENT24,w,h,0,gl.DEPTH_COMPONENT,gl.UNSIGNED_INT,null);
   gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,t.depthTexture,0);
   if(gl.getError()!==gl.NO_ERROR)throw new Error('The graphics device could not allocate this surface view.');
   if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Fine surface render target is unavailable.');
   t.width=w;t.height=h;
  }
  gl.viewport(0,0,w,h);gl.disable(gl.DEPTH_TEST);gl.useProgram(this.backgroundProgram);
  gl.uniform2f(gl.getUniformLocation(this.backgroundProgram,'resolution'),w,h);gl.uniform1i(gl.getUniformLocation(this.backgroundProgram,'palette'),renderer.settings.palette);
  gl.bindVertexArray(null);gl.drawArrays(gl.TRIANGLES,0,3);
  gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.clearDepth(1);gl.clear(gl.DEPTH_BUFFER_BIT);
  renderer.bindSceneUniforms(this.program,this.uniforms,w,h,b,aspect,true);
  gl.uniform1i(this.debrisEnabled,this.hasDebrisMask&&renderer.settings.debrisCleanupEnabled!==false?1:0);
  gl.uniform3fv(this.boundsMin,this.bounds.min);gl.uniform3fv(this.boundsMax,this.bounds.max);
  gl.uniform1i(this.nativeUniforms.nativeReplacementEnabled,0);gl.uniform1i(this.nativeUniforms.nativePatchPass,0);
  renderer.nativeMainDetail?.bindBase(this);
  renderer.localSurfaceRefinement?.bindBase(this);
  gl.bindVertexArray(this.vao);this.drawCalls=drawIndexedTriangles(gl,this.indexCount);
  renderer.nativeMainDetail?.draw(this);
  renderer.localSurfaceRefinement?.draw(this);
  gl.bindVertexArray(null);gl.disable(gl.DEPTH_TEST);
  assertMeshDrawSucceeded(gl);
  renderer.compositeScene(t.texture,w,h,b,aspect,t.depthTexture);
 }
 dispose(){
  const gl=this.gl;for(const buffer of this.buffers)gl.deleteBuffer(buffer);this.buffers=[];
  if(this.vao)gl.deleteVertexArray(this.vao);this.vao=null;
  if(this.program)gl.deleteProgram(this.program);if(this.backgroundProgram)gl.deleteProgram(this.backgroundProgram);this.program=this.backgroundProgram=null;
  if(this.target){if(this.target.texture)gl.deleteTexture(this.target.texture);if(this.target.framebuffer)gl.deleteFramebuffer(this.target.framebuffer);if(this.target.depthTexture)gl.deleteTexture(this.target.depthTexture);this.target=null;}
  this.enabled=false;
 }
}

// Activate only after the complete new immutable display collection is seeded
// and verified. The original v23 source transport remains available as fallback.
export const compactSurfaceEnabled=true;
const originalGentleManifest='./assets/fine-surface-v23/manifest.json';
const surfaceProfiles={
 gentle:{label:'Ultra-High Fidelity',manifest:compactSurfaceEnabled?'./assets/display-compact-v29/surface-manifest.json':originalGentleManifest},
 detail:{label:'Polished Detailed',manifest:'./assets/fine-surface-v19/manifest.json'},
 balanced:{label:'Polished Compact',manifest:'./assets/fine-surface-v19/manifest.json'}
};

function waitForCleanupOperation(operation,signal){
 return new Promise((resolve,reject)=>{
  const done=()=>signal.removeEventListener('abort',abort),abort=()=>{done();reject(signal.reason||new DOMException('Cleanup preparation was interrupted.','AbortError'));};
  signal.addEventListener('abort',abort,{once:true});
  Promise.resolve(operation).then(value=>{done();resolve(value);},error=>{done();reject(error);});
  if(signal.aborted)abort();
 });
}

export class FineSurfaceController{
 constructor({renderer,donor,mount,toast=()=>{},onChange=()=>{},autoStart=true,debrisLoader=loadDebrisAttribute,initialVolumeThreshold=.32,onSurfaceChoice=()=>{},resourcePolicy=getDeviceResourcePolicy(),watchdogFactory=options=>new ActiveLoadWatchdog(options)}={}){
  this.resourcePolicy=resourcePolicy;
  this.watchdogFactory=watchdogFactory;this.startupSurface=resourcePolicy.startupSurface||resourcePolicy.defaultSurface;
  this.fetcher=(...args)=>{const watchdog=this.loadWatchdog;return progressFetch(()=>watchdog?.progress())(...args);};
  this.deviceSurfaceLabel=resourcePolicy.mobile?'Mobile Detail':'Compact Detail';
  this.renderer=renderer;this.donor=donor;this.mount=mount;this.onSurfaceChoice=onSurfaceChoice;this.toast=toast;this.onChange=onChange;this.revision=0;this.manifests=new Map();this.workspaceWaiters=new Set();this.gentleReady=mount.dataset.gentleReady!=='false';this.workspaceActive=!document.getElementById('reconstructionPanel')?.hidden;
  if(donor.id!=='ladaf-2021-17'){mount.hidden=true;return;}
  // A pre-mobile "Use Interactive Volume" choice must not strand a phone on
  // the old unrefined startup path. Give mobile its own fresh default without
  // overwriting the desktop preference; subsequent explicit choices persist.
  mount.hidden=false;this.debrisLoader=debrisLoader;this.preferenceKey=(resourcePolicy.mobile?'heart-explorer:surface:mobile:v43:':'heart-explorer:surface:v25:')+donor.id;this.initialVolumeThreshold=initialVolumeThreshold;
  if(renderer.settings.debrisCleanupEnabled===undefined)renderer.settings.debrisCleanupEnabled=true;
  mount.innerHTML=[
   '<div class="control-section-heading"><h3 id="reconstructionDetailHeading">Reconstruction Detail</h3><span class="subtle-badge">Whole-Heart Surface</span></div>',
   '<div class="reconstruction-detail-layout"><div>',
   '<div class="surface-quality-choices" role="group" aria-label="Main reconstruction detail">',
   '<button id="useInteractiveVolume" type="button" aria-pressed="true"><strong>Interactive Volume</strong><span>Fast · adjustable tissue threshold</span></button>',
   '<button id="useCompactSurface" type="button" aria-pressed="false"><strong>Compact Detail</strong><span>Quick start · cleaned, polished surface</span></button>',
   '<button id="useGentleSurface" type="button" aria-pressed="false" aria-describedby="fineSurfaceDescription fineSurfaceStatus"><strong>Ultra-High Fidelity</strong><span>79.4 µm source · less smoothing</span><span id="gentleDownloadSize" class="surface-download-size" hidden></span></button></div>',
   '<button type="button" class="fine-detail-reset">Reset Detail Defaults</button>',
   '<p id="fineSurfaceDescription" class="control-note">New visits open Compact Detail first, with reviewed cavity cleanup and a smaller download. Choose Ultra-High Fidelity for the complete interior model and finer surface folds. The current view stays usable while it loads.</p>',
   '<p id="fineSurfaceStatus" class="control-note fine-surface-status" role="status" aria-live="polite">Interactive Volume · preparing your preferred surface.</p>',
   '<label class="fine-debris-toggle"><input id="fineDebrisCleanup" type="checkbox" checked disabled> Remove Detached Debris</label><p id="fineDebrisStatus" class="control-note">Available when Ultra-High Fidelity is ready.</p>',
   '<p id="baseVolumeResolution" class="control-note base-volume-resolution"></p></div>',
   '<a class="native-detail-link" href="./whole-native.html"><span class="native-detail-kicker">Native Scan Detail</span><strong>Inspect 19.85 µm Regions <span aria-hidden="true">→</span></strong><span>Open the whole-heart navigator and select a region reconstructed from the original 19.85 µm samples.</span></a></div>',
   '<div id="nativeMainDetailMount"></div>',
   '<details class="fine-surface-comparison"><summary>Compare Versions &amp; Processing</summary>',
   '<div class="control-row"><label for="fineSurfaceQuality">Surface Version</label><div class="select-wrap"><select id="fineSurfaceQuality" aria-describedby="fineSurfaceProcessing"><option value="volume">Interactive Volume</option><option value="gentle">Ultra-High Fidelity · 79.4 µm source</option><optgroup label="Earlier Polished Surfaces · Comparison"><option value="detail">Polished Detailed · 79.4 µm source</option><option value="balanced">Polished Compact · 79.4 µm source</option></optgroup></select></div></div>',
   '<p id="fineSurfaceProcessing" class="control-note">The earlier polished meshes use stronger smoothing and can lose small folds or thin structures. Each fine surface has a fixed tissue threshold and built-in smoothing. Volume shading changes only the interactive volume.</p>',
   '<p class="control-note">Changing threshold, transparency, cleanup or plane guides displays the interactive volume while retaining the selected mesh in memory. CT sections and cut faces keep their own measured source data and resolution.</p>',
   '<a class="native-study-link" href="./native-detail.html">Open the Small Native 19.85 µm Smoothing Comparison →</a></details>'
  ].join('');
  this.select=mount.querySelector('#fineSurfaceQuality');this.status=mount.querySelector('#fineSurfaceStatus');
  this.volumeButton=mount.querySelector('#useInteractiveVolume');this.compactButton=mount.querySelector('#useCompactSurface');this.gentleButton=mount.querySelector('#useGentleSurface');
  this.compactButton.hidden=resourcePolicy.constrained;
  this.downloadSize=mount.querySelector('#gentleDownloadSize');this.gentleDownloadMb=Number.parseFloat(mount.dataset.gentleDownloadMb);
  this.gentleOption=mount.querySelector('option[value="gentle"]');
  this.debrisToggle=mount.querySelector('#fineDebrisCleanup');this.debrisStatus=mount.querySelector('#fineDebrisStatus');
  this.debrisToggle.addEventListener('change',()=>{renderer.set({debrisCleanupEnabled:this.debrisToggle.checked});this.sync();renderer.requestRender('camera');this.onChange();});
  this.baseVolumeNote=mount.querySelector('#baseVolumeResolution');this.resolutionLabel=document.getElementById('resolutionLabel');
  this.badge=document.createElement('span');this.badge.className='fine-source-label';this.badge.hidden=true;
  (document.querySelector('#viewport .source-tag')||document.querySelector('#viewport .viewport-heading'))?.append(this.badge);
  this.refinementNotice=document.createElement('div');this.refinementNotice.className='interior-refinement-notice';this.refinementNotice.hidden=true;
  this.refinementNotice.innerHTML='<span role="status" aria-live="polite"></span><button type="button" hidden>Retry</button>';
  document.querySelector('#viewport .viewport-heading')?.append(this.refinementNotice);
  this.refinementNoticeText=this.refinementNotice.querySelector('span');this.refinementNoticeRetry=this.refinementNotice.querySelector('button');
  this.refinementNoticeRetry.addEventListener('click',()=>void this.retryRefinement());
  this.loadPanel=document.createElement('div');this.loadPanel.className='fine-load-panel';this.loadPanel.hidden=true;
  this.loadPanel.innerHTML='<strong class="fine-load-title"></strong><span class="fine-load-source"></span><span class="fine-load-status" role="status" aria-live="polite"></span><progress aria-label="Surface Download" max="1"></progress><button type="button">Use Interactive Volume</button><button type="button" class="fine-load-compact" hidden>Use Compact Detail</button><button type="button" class="fine-load-retry" hidden>Retry Surface</button>';
  document.getElementById('viewport')?.append(this.loadPanel);
  this.loadTitle=this.loadPanel.querySelector('strong');this.loadSource=this.loadPanel.querySelector('.fine-load-source');this.loadStatus=this.loadPanel.querySelector('.fine-load-status');this.loadProgress=this.loadPanel.querySelector('progress');
  this.loadPanel.querySelector('button').addEventListener('click',()=>void this.choose('volume'));
  this.loadCompact=this.loadPanel.querySelector('.fine-load-compact');this.loadRetry=this.loadPanel.querySelector('.fine-load-retry');
  this.loadCompact.addEventListener('click',()=>void this.choose(this.startupSurface));this.loadRetry.addEventListener('click',()=>void this.choose(this.retrySurface||this.startupSurface));
  mount.querySelector('.fine-detail-reset').addEventListener('click',()=>void this.resetDefaults());
  this.select.addEventListener('change',()=>void this.choose(this.select.value));
  this.volumeButton.addEventListener('click',()=>void this.choose('volume'));
  this.compactButton.addEventListener('click',()=>void this.choose(this.startupSurface));
  this.gentleButton.addEventListener('click',()=>void this.choose(this.resourcePolicy.defaultSurface));
  if(resourcePolicy.constrained){
   this.gentleButton.querySelector('strong').textContent=this.deviceSurfaceLabel;
   mount.querySelector('#fineSurfaceDescription').textContent='A smaller, polished surface keeps this device responsive, with the same reviewed cavity cleanup. Fine folds and thin structures can be reduced. Ultra CT sections still load for the current view. The full Ultra-High Fidelity model exceeds this device’s conservative resource budget.';
   this.gentleOption.textContent='Ultra-High Fidelity · desktop memory required';
   const option=mount.querySelector('option[value="'+resourcePolicy.defaultSurface+'"]');
   if(option)option.textContent=this.deviceSurfaceLabel+' · 79.4 µm source · polished surface';
  }
  if(!this.gentleReady)this.status.textContent='Interactive Volume · the Ultra-High Fidelity surface is being prepared. Earlier polished surfaces are available below.';
  if(!renderer.gl){this.select.disabled=true;this.gentleButton.disabled=true;this.compactButton.disabled=true;this.status.textContent='Interactive Volume fallback · fine surfaces require WebGL 2 in this browser.';}
  this.shortcut=document.getElementById('openReconstructionDetail');this.settings=document.getElementById('viewerSettings');
  if(this.shortcut&&this.settings){
   this.shortcut.hidden=false;this.shortcut.addEventListener('click',()=>void this.openSettings());
   this.settings.addEventListener('toggle',()=>this.shortcut.setAttribute('aria-expanded',String(this.settings.open)));
  }
  this.sync();
  const lumenMount=document.createElement('div');lumenMount.className='lumen-cleanup-controls';mount.append(lumenMount);
  this.lumenCleanup=new LumenCleanupController({renderer,donor,mount:lumenMount,toast,autoStart:false,compact:true,resourcePolicy,fetcher:this.fetcher,onChange:()=>this.syncRefinement()});
  this.refinementStatus=document.createElement('p');this.refinementStatus.className='control-note';this.refinementStatus.setAttribute('role','status');lumenMount.append(this.refinementStatus);
  this.refinementRetry=document.createElement('button');this.refinementRetry.type='button';this.refinementRetry.className='interior-refinement-retry';this.refinementRetry.textContent='Retry Interior Refinement';this.refinementRetry.hidden=true;lumenMount.append(this.refinementRetry);
  this.refinementRetry.addEventListener('click',()=>void this.retryRefinement());
  this.localRefinement=new LocalSurfaceRefinementController({renderer,donor,fetcher:this.fetcher,onChange:()=>this.syncRefinement()});
  this.syncRefinement();
  // Construction follows the first usable volume. A synchronous user choice
  // wins over this queued default; background completion never changes modes.
  this.ready=Promise.resolve().then(()=>{
   if(!autoStart||this.revision!==0||!renderer.gl)return;
   const preference=this.savedPreference();
   const savedView=new URL(location.href).hash.startsWith('#view=')||location.hash?.startsWith('#view=');
   if(preference!=='volume'&&(preference!=='gentle'||this.gentleReady)&&!savedView){
    if(this.workspaceActive&&!document.getElementById('reconstructionPanel')?.hidden)this.adoptDefaultThreshold();
    // Imports can finish after an early Echo/Lab selection. The application's
    // return path restores Reconstruction settings before activating us, so
    // normalize only that untouched view, never the active lab's threshold.
    else this.pendingDefaultThreshold=true;
   }
   return this.choose(preference,{automatic:true});
  });
 }
 adoptDefaultThreshold(){
  this.pendingDefaultThreshold=false;
  const s=this.renderer.settings;
  if(!s.coronaryReveal&&!this.renderer.coronaryPreparing&&s.mode===0&&s.cleanupEnabled!==false&&!s.showPlanes&&Math.abs(s.threshold-this.initialVolumeThreshold)<.00001)this.renderer.set({threshold:.28});
 }
 savedPreference(){
  try{const value=globalThis.localStorage?.getItem(this.preferenceKey);if(value==='volume'||Object.hasOwn(surfaceProfiles,value))return permittedSurface(value,this.resourcePolicy);}catch{}
  return this.startupSurface;
 }
 rememberPreference(id){try{globalThis.localStorage?.setItem(this.preferenceKey,id);}catch{}}
 get selectedThreshold(){return this.select&&Object.hasOwn(surfaceProfiles,this.select.value)? .28:null;}
 resetDefaults(){if(!this.select)return;this.rememberPreference(this.startupSurface);this.renderer.set({debrisCleanupEnabled:true});return this.choose(this.startupSurface);}
 surfaceLabel(id){return id===this.startupSurface?this.deviceSurfaceLabel:surfaceProfiles[id]?.label||'surface';}
 setStatus(text){this.status.textContent=text;if(this.loadStatus)this.loadStatus.textContent=text;}
 syncRefinement(){
  const local=this.localRefinement,lumen=this.lumenCleanup;if(!local||!this.refinementStatus)return;
  const r=this.renderer,pass=r.fineSurface,gentle=pass?.lod?.id==='gentle'&&pass.enabled!==false;
  const loading=!!(local.loading||lumen.loading),failed=!!(local.error||lumen.error);
  const mobile=['detail','balanced'].includes(pass?.lod?.id)&&pass.enabled!==false;
  const viewCompatible=(gentle||mobile)&&!!pass.activeFor?.(r),switchedOff=(lumen.toggle?.checked===false&&!lumen.error)||r.settings.debrisCleanupEnabled===false;
  let state='unavailable',label='',description=this.resourcePolicy?.constrained?'The smaller surface uses reviewed cavity cleanup. Desktop interior replacement surfaces are not loaded.':'Interior refinement is available in Ultra-High Fidelity with cleanup on.';
  if(mobile&&viewCompatible){
   if(lumen.error){state='error';label='Reviewed cleanup unavailable';description=lumen.error+'. The current view remains available.';}
   else if(lumen.toggle?.checked===false){state='off';label='Reviewed cleanup off';description='Turn on Hide Reviewed Lumen Material to restore the reviewed cavity cleanup.';}
   else if(r.settings.lumenCleanupEnabled===true&&r.lumenCleanup&&r.reviewedMaskAtlas?.ready){state='active';label='Reviewed cleanup ready';description='The reviewed atrial, arterial, valve-adjacent and right-ventricular masks are active on the smaller surface. Original CT cards remain available.';}
   else if(!this.workspaceActive){state='paused';description='Reviewed cleanup preparation resumes when you return to the reconstruction.';}
   else if(lumen.loading){state='loading';label='Loading reviewed cleanup…';description='Loading the existing reviewed cavity masks for the smaller surface.';}
   else {state='pending';label='Reviewed cleanup not active';description='The reviewed cavity masks are not active in this view.';}
  }
  else if(!this.workspaceActive&&!local.active()){state='paused';description='Interior refinement resumes when you return to the reconstruction.';}
  else if(viewCompatible){
   if(switchedOff){state='off';label='Interior refinement off';description='Turn on Lumen cleanup and Remove Detached Debris to restore the reviewed interior surfaces.';}
   else if(local.active()){state='active';label='Prepared model ready';description='The finalized interior surfaces and cleanup are loaded. Turn off Lumen cleanup to compare the earlier reconstruction.';}
   else if(loading){state='loading';label='Loading prepared model…';description='Downloading the completed interior surfaces and cleanup.';}
   else if(failed){state='error';label='Prepared model unavailable';description=(local.error||lumen.error)+'. The interactive volume remains available.';}
   else {state='pending';label='Interior refinement not active';description='The reviewed interior surfaces are not active in this view.';}
  }
  const retry=state==='error',text=(node,value)=>{if(node.textContent!==value)node.textContent=value;};
  text(this.refinementStatus,description);this.refinementRetry.hidden=!retry;this.refinementRetry.disabled=loading;
  this.refinementNotice.hidden=!this.workspaceActive||!viewCompatible||state==='active';
  this.refinementNotice.dataset.state=state;this.refinementNotice.setAttribute('aria-busy',String(state==='loading'));
  text(this.refinementNoticeText,label);this.refinementNoticeRetry.hidden=!retry;this.refinementNoticeRetry.disabled=loading;
 }
 async retryRefinement(){
  if(!this.workspaceActive)return;
  if(['detail','balanced'].includes(this.renderer.fineSurface?.lod?.id)){await this.lumenCleanup?.setEnabled(true);this.syncRefinement();return;}
  if(this.renderer.fineSurface?.lod?.id!=='gentle')return;
  const pending=[];
  if(this.lumenCleanup?.error)pending.push(this.lumenCleanup.setEnabled(true));
  if(!this.localRefinement?.current)pending.push(this.localRefinement?.ensure());
  this.syncRefinement();await Promise.all(pending);this.syncRefinement();
 }
 setWorkspaceActive(active){
  this.workspaceActive=!!active;
  this.loadWatchdog?.setActive(this.workspaceActive);
  if(this.workspaceActive&&this.pendingDefaultThreshold)this.adoptDefaultThreshold();
  this.localRefinement?.setWorkspaceActive(active);
  this.worker?.postMessage({type:'workspace-priority',paused:!this.workspaceActive});
  if(this.workspaceActive){for(const resume of [...this.workspaceWaiters])resume();}
  else {this.debrisAbort?.abort();this.mobileCleanupAbort?.abort();}
  if(this.loading&&!this.workspaceActive)this.setStatus('Surface preparation paused while the active lab loads its scan data. It resumes when you return.');
  this.sync();
 }
 async waitForWorkspace(revision,signal){
  const current=()=>{if(signal.aborted||revision!==this.revision)throw new DOMException('A newer surface was selected.','AbortError');};
  current();
  while(!this.workspaceActive){
   await new Promise((resolve,reject)=>{
    const cleanup=()=>{this.workspaceWaiters.delete(resume);signal.removeEventListener('abort',abort);};
    const resume=()=>{cleanup();resolve();};
    const abort=()=>{cleanup();reject(new DOMException('A newer surface was selected.','AbortError'));};
    this.workspaceWaiters.add(resume);signal.addEventListener('abort',abort,{once:true});
    if(signal.aborted)abort();
   });
   current();
  }
 }

 async prepareFinalModel(revision,signal){
  // All reconstruction and cleanup were performed offline. Do not install a
  // partial base mesh while its reviewed geometry is still loading.
  for(;;){
   await this.waitForWorkspace(revision,signal);
   this.loadProgress.removeAttribute('value');this.loadProgress.setAttribute('aria-label','Preparing reviewed interior model');
   this.loadWatchdog?.progress();this.setStatus('Preparing reviewed cavity masks · the current view stays usable');
   await withAbort(this.lumenCleanup.pending||this.lumenCleanup.ready,signal);
   if(!this.renderer.lumenCleanup||this.renderer.lumenCleanup.sparseAtlas||this.lumenCleanup.error){
    if(!this.lumenCleanup.toggle.checked&&!this.lumenCleanup.error)throw new Error('Interior preparation was canceled when reviewed cleanup was switched off.');
    await withAbort(this.lumenCleanup.setEnabled(true,{signal}),signal);
   }
   if(signal.aborted||revision!==this.revision)return false;
   if(this.lumenCleanup.error)throw new Error(this.lumenCleanup.error);
   this.loadWatchdog?.progress();this.setStatus('Loading the finalized interior model · preparing 4 regions');
   await withAbort(this.localRefinement.ensure({signal}),signal);
   if(signal.aborted||revision!==this.revision)return false;
   if(!this.workspaceActive)continue;
   if(!this.localRefinement.current)throw new Error(this.localRefinement.error||'The prepared interior model could not be loaded.');
   if(this.lumenCleanup.toggle.checked&&!this.renderer.lumenCleanup)throw new Error('The prepared cleanup masks could not be loaded.');
   return true;
  }
 }

 async prepareMobileCleanup(revision,signal){
  const lumen=this.lumenCleanup;
  if(!lumen)return true;
  for(;;){
   await this.waitForWorkspace(revision,signal);
   if(signal.aborted||revision!==this.revision)return false;
   if(!this.workspaceActive)continue;
   if(lumen.toggle.disabled||(!lumen.toggle.checked&&!lumen.error))return true;
   const abort=this.mobileCleanupAbort=new AbortController(),cancel=()=>abort.abort(signal.reason);
   signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
   try{
    this.loadProgress.removeAttribute('value');this.loadProgress.setAttribute('aria-label','Preparing reviewed cavity cleanup');
    this.loadWatchdog?.progress();this.setStatus('Loading reviewed cavity cleanup · the current view stays usable');
    await withAbort(lumen.setEnabled(true,{signal:abort.signal}),abort.signal);
    // Follow a newer explicit enable instead of treating its in-progress
    // collection as a failed older preparation. An explicit off wins as well.
    while(lumen.pending&&!abort.signal.aborted){const pending=lumen.pending;await waitForCleanupOperation(pending,abort.signal);if(lumen.pending===pending)break;}
    if(signal.aborted||revision!==this.revision)return false;
    if(abort.signal.aborted||!this.workspaceActive)continue;
    if(lumen.error)throw new Error(lumen.error);
    if(lumen.toggle.checked&&!this.renderer.lumenCleanup)throw new Error('The reviewed cavity cleanup could not be loaded.');
    return true;
   }catch(error){
    if(signal.aborted||revision!==this.revision)return false;
    if(abort.signal.aborted||!this.workspaceActive)continue;
    throw error;
   }finally{signal.removeEventListener('abort',cancel);if(this.mobileCleanupAbort===abort)this.mobileCleanupAbort=null;}
  }
 }

 async openSettings(){
  if(!this.settings)return;
  // Settings sits outside the fullscreen heart-and-sections workspace.
  if(document.fullscreenElement||document.webkitFullscreenElement){
   const exit=document.exitFullscreen||document.webkitExitFullscreen;
   try{if(!exit)throw new Error('Fullscreen exit is unavailable.');await exit.call(document);}catch{this.toast('Exit fullscreen to open reconstruction detail settings.');return;}
  }
  this.settings.open=true;this.shortcut?.setAttribute('aria-expanded','true');
  this.mount.scrollIntoView?.({behavior:'smooth',block:'start'});
  (this.gentleButton.disabled?this.volumeButton:this.gentleButton).focus?.({preventScroll:true});
 }
 async readManifest(url,signal){
  if(this.manifests.has(url))return this.manifests.get(url);
  const response=await withAbort(this.fetcher(url,{signal,priority:'low'}),signal);
  if(!response.ok)throw new Error('Fine surface metadata is unavailable.');
  const manifest=await withAbort(response.json(),signal);
  this.manifests.set(url,manifest);return manifest;
 }
 async choose(id,{automatic=false}={}){
  if(!this.select)return;
  if(id!=='volume'&&!Object.hasOwn(surfaceProfiles,id))return;
  id=permittedSurface(id,this.resourcePolicy);
  if(!automatic){this.pendingDefaultThreshold=false;this.onSurfaceChoice(id);}
  if(id==='gentle'&&!this.gentleReady){this.select.value=this.renderer.fineSurface?.activeFor?.(this.renderer)?this.renderer.fineSurface.lod.id:'volume';return;}
  const revision=++this.revision;this.loadWatchdog?.close();this.worker?.terminate();this.worker=null;this.cancelPending?.();this.cancelPending=null;this.loadAbort?.abort();this.loadAbort=null;this.loading=false;this.statusOverride=null;this.select.value=id;this.retrySurface=null;
  if(!automatic)this.rememberPreference(id);
  this.loadProgress.removeAttribute('value');
  if(id==='volume'||!this.renderer.gl){
   this.localRefinement?.cancelPreparation();this.lumenCleanup?.abort?.abort();
   this.select.value='volume';if(this.renderer.fineSurface)this.renderer.fineSurface.enabled=false;
   this.setStatus(this.renderer.gl?'Interactive Volume · adjustable tissue threshold':'Interactive Volume fallback · fine surfaces require WebGL 2 in this browser.');
   this.sync();this.renderer.requestRender('camera');this.onChange();return;
  }
  this.lumenCleanup.compact=id!=='gentle';
  // Set the requested display mode now; a late result must preserve any
  // settings the user changes while the new surface is being prepared.
  if(!automatic)this.renderer.set({mode:0,threshold:.28,cleanupEnabled:true,showPlanes:0});
  if(this.renderer.fineSurface?.lod?.id===id){
   this.renderer.fineSurface.enabled=true;
   if(this.lumenCleanup.toggle.checked&&(!this.renderer.lumenCleanup||this.lumenCleanup.error))void this.lumenCleanup.setEnabled(true);
   if(id==='gentle')void this.localRefinement?.ensure();this.sync();this.renderer.requestRender('camera');this.onChange();return;
  }
  const loadAbort=new AbortController();this.loading=true;this.loadAbort=loadAbort;this.setStatus('Preparing '+this.surfaceLabel(id).toLowerCase()+'…');this.sync();this.onChange();
  const watchdog=this.loadWatchdog=this.watchdogFactory({onTimeout:error=>loadAbort.abort(error)});watchdog.setActive(this.workspaceActive);
  const cancelLoad=()=>{watchdog.close();this.worker?.terminate();this.worker=null;this.cancelPending?.(loadAbort.signal.reason);this.localRefinement?.cancelPreparation();this.lumenCleanup?.abort?.abort(loadAbort.signal.reason);};
  loadAbort.signal.addEventListener('abort',cancelLoad,{once:true});
  try{
   // Each request retains its own manifest. A superseded polished download
   // must never supply metadata for a newer gentle-surface request.
   let manifest;
   try{manifest=await this.readManifest(surfaceProfiles[id].manifest,loadAbort.signal);}
   catch(error){
    if(id!=='gentle'||!compactSurfaceEnabled||revision!==this.revision||loadAbort.signal.aborted)throw error;
    manifest=await this.readManifest(originalGentleManifest,loadAbort.signal);
   }
   if(revision!==this.revision)return;
   if(manifest.available===false){
    if(id==='gentle')this.gentleReady=false;
    this.loading=false;this.select.value=this.renderer.fineSurface?.activeFor?.(this.renderer)?this.renderer.fineSurface.lod.id:'volume';
    this.statusOverride='This surface is being prepared. Your current reconstruction remains available.';this.sync();this.onChange();return;
   }
   if(manifest.donorId!==this.donor.id)throw new Error('Fine surface source does not match this donor.');
   if(manifest.threshold!==.28)throw new Error('Fine surface extraction settings do not match this version.');
   let lod=manifest.lods.find(item=>item.id===id);if(!lod)throw new Error('This surface level is unavailable.');
   assertSurfaceBudget(lod,this.resourcePolicy);
   if(id==='gentle'){this.gentleDownloadMb=lod.compressedBytes/1e6;this.sync();}
   const decodeLod=async selectedLod=>{
   const lod=selectedLod;
   // Enforce on every path, including preserved-source fallback. Download
   // compression cannot make an oversized decoded surface safe on mobile.
   assertSurfaceBudget(lod,this.resourcePolicy);
   if(lod.parts!==undefined&&!Array.isArray(lod.parts))throw new Error('Fine surface transport metadata is invalid.');
   const parts=lod.parts?.map(part=>{
    if(!part||typeof part.url!=='string')throw new Error('Fine surface part metadata is invalid.');
    return {...part,url:new URL(part.url,location.href).href};
   });
   const compact=lod.compactTransport?{...lod.compactTransport,parts:lod.compactTransport.parts.map(part=>({...part,url:new URL(part.path,new URL(lod.compactTransport.assetBaseUrl,location.href)).href}))}:undefined;
   const payload={url:lod.url?new URL(lod.url,location.href).href:undefined,parts,sha256:lod.sha256,compressedBytes:lod.compressedBytes,expectedBytes:lod.decodedBytes,decodedSha256:lod.decodedSha256,compact};
   this.setStatus('Loading '+(lod.compressedBytes/1e6).toFixed(1)+' MB · the current view stays usable');
   return new Promise((resolve,reject)=>{
    this.cancelPending=reason=>reject(reason||new DOMException('A newer surface was selected.','AbortError'));
    const worker=this.worker=new Worker(new URL('./fine-surface-worker.js',import.meta.url),{type:'module'});
    worker.onmessage=event=>{
     if(event.data?.type==='progress'){
      if(revision===this.revision&&this.worker===worker){
       watchdog.progress();
       const total=Number.isFinite(event.data.totalBytes)?event.data.totalBytes:lod.compressedBytes;
       const loaded=Number.isFinite(event.data.loadedBytes)?event.data.loadedBytes:0;
       const stage=event.data.stage;
       const preparation=stage==='verify-surface'?'Checking the complete surface':stage==='verify-part'?'Checking downloaded surface parts':stage==='validate-indices'?'Validating the surface geometry':'Preparing the downloaded surface';
       this.setStatus(event.data.phase==='decode'?preparation+' · the current view stays usable':'Downloading '+(loaded/1e6).toFixed(1)+' of '+(total/1e6).toFixed(1)+' MB · the current view stays usable');
       this.loadProgress.setAttribute('aria-label',event.data.phase==='download'?'Surface download':'Surface preparation');
       if(event.data.phase==='download'&&total>0)this.loadProgress.value=Math.min(1,loaded/total);else this.loadProgress.removeAttribute('value');
      }
      return;
     }
     watchdog.progress();
     worker.terminate();if(this.worker===worker)this.worker=null;event.data.error?reject(new Error(event.data.error)):resolve(event.data);
    };
    worker.onerror=()=>{worker.terminate();if(this.worker===worker)this.worker=null;reject(new Error('Fine surface decoding failed.'));};
    worker.onmessageerror=()=>{worker.terminate();if(this.worker===worker)this.worker=null;reject(new Error('The surface worker could not transfer its result. Choose Compact Detail.'));};
    worker.postMessage({...payload,paused:!this.workspaceActive});
   });
   };
   let decoded;
   try{decoded=await decodeLod(lod);}
   catch(error){
    if(!lod.compactTransport||revision!==this.revision||loadAbort.signal.aborted)throw error;
    await this.waitForWorkspace(revision,loadAbort.signal);
    const fallback=await this.readManifest(originalGentleManifest,loadAbort.signal);
    if(revision!==this.revision||loadAbort.signal.aborted)return;
    if(fallback.donorId!==this.donor.id||fallback.threshold!==.28)throw new Error('Original fine surface source does not match.');
    const originalLod=fallback.lods.find(item=>item.id===id);
    if(!originalLod)throw error;
    manifest=fallback;lod=originalLod;
    this.gentleDownloadMb=lod.compressedBytes/1e6;this.sync();
    this.setStatus('Loading the preserved source surface · the current view stays usable');
    decoded=await decodeLod(lod);
   }
   if(revision!==this.revision)return;
   this.cancelPending=null;
   let cleanupWarning=null;
   for(;;){
    // A completed worker may arrive after the workspace switched. Do not start
    // cleanup downloads or their validation work while the lab owns priority.
    await this.waitForWorkspace(revision,loadAbort.signal);
    if(loadAbort.signal.aborted||revision!==this.revision)return;
    if(!this.workspaceActive)continue;
    const debrisAbort=this.debrisAbort=new AbortController(),cancelDebris=()=>debrisAbort.abort();
    loadAbort.signal.addEventListener('abort',cancelDebris,{once:true});
    this.setStatus('Preparing detached-debris cleanup · the current view stays usable');
    try{
     this.loadProgress.removeAttribute('value');this.loadProgress.setAttribute('aria-label','Preparing detached-debris cleanup');watchdog.progress();
     const flags=await withAbort(this.debrisLoader(lod,decoded,{signal:debrisAbort.signal,fetcher:this.fetcher}),loadAbort.signal);
     if(loadAbort.signal.aborted||revision!==this.revision)return;
     // A completed, verified result survives a workspace pause that arrives
     // between promise settlement and this continuation; installation still waits.
     decoded.debrisFlags=flags;break;
    }catch(error){
     if(loadAbort.signal.aborted||revision!==this.revision)return;
     if(debrisAbort.signal.aborted)continue;
     cleanupWarning='The prepared surface cleanup could not be loaded. '+error.message;break;
    }finally{
     loadAbort.signal.removeEventListener('abort',cancelDebris);
     if(this.debrisAbort===debrisAbort)this.debrisAbort=null;
    }
   }
   // Cleanup may finish in the same turn as a workspace change. Keep the
   // decoded geometry resident without compiling shaders or uploading buffers.
   do{
    await this.waitForWorkspace(revision,loadAbort.signal);
    if(loadAbort.signal.aborted||revision!==this.revision)return;
   }while(!this.workspaceActive);
   if(lod.id==='gentle'){
    if(cleanupWarning)throw new Error(cleanupWarning);
    if(!await withAbort(this.prepareFinalModel(revision,loadAbort.signal),loadAbort.signal))return;
   }
   else if(!await withAbort(this.prepareMobileCleanup(revision,loadAbort.signal),loadAbort.signal))return;
   do{
    await this.waitForWorkspace(revision,loadAbort.signal);
    if(loadAbort.signal.aborted||revision!==this.revision)return;
   }while(!this.workspaceActive);
   this.loadProgress.removeAttribute('value');this.loadProgress.setAttribute('aria-label','Preparing graphics');this.setStatus('Preparing graphics · the current view stays usable');
   // Let the status paint before synchronous graphics-driver allocation.
   await withAbort(new Promise(resolve=>setTimeout(resolve,0)),loadAbort.signal);
   await this.waitForWorkspace(revision,loadAbort.signal);
   const next=new FineSurfacePass(this.renderer,decoded,manifest,lod);next.cleanupWarning=cleanupWarning;
   next.onError=error=>{
    if(this.renderer.fineSurface!==next)return;
    // A failed draw must not retain the buffers that caused memory pressure.
    next.dispose();this.renderer.fineSurface=null;
    this.localRefinement?.dispose();
    if(!this.loading){this.select.value='volume';this.statusOverride=error.message+' Interactive Volume remains available.';}
    this.sync();this.renderer.requestRender('camera');this.toast(error.message+' Interactive Volume remains available.');
   };
   this.renderer.fineSurface?.dispose();this.renderer.fineSurface=next;
   this.renderer.requestRender('camera');
   this.loadedLabel=this.surfaceLabel(id)+' · '+(lod.triangles/1e6).toFixed(2)+' M triangles · '+(lod.compressedBytes/1e6).toFixed(1)+' MB downloaded';
   this.loading=false;this.cancelPending=null;this.loadAbort=null;this.sync();this.onChange();
  }catch(error){
   if(revision!==this.revision)return;
   loadAbort.abort(error);
   this.worker?.terminate();this.worker=null;
   if(this.renderer.fineSurface?.lod?.id!=='gentle')this.localRefinement?.dispose();
   this.loading=false;this.cancelPending=null;this.loadAbort=null;this.retrySurface=id;this.statusOverride=error.message+' Your current reconstruction remains available. Retry or choose Compact Detail.';
   this.select.value=this.renderer.fineSurface?.enabled?this.renderer.fineSurface.lod.id:'volume';
   this.sync();this.renderer.requestRender('camera');this.toast(error.message);
  }finally{
   watchdog.close();loadAbort.signal.removeEventListener('abort',cancelLoad);if(this.loadWatchdog===watchdog)this.loadWatchdog=null;
   if(revision===this.revision&&this.loading&&loadAbort.signal.aborted){
    this.loading=false;this.cancelPending=null;this.loadAbort=null;this.retrySurface=id;
    this.statusOverride=(loadAbort.signal.reason?.message||'Surface preparation was interrupted.')+' Your current reconstruction remains available. Retry or choose Compact Detail.';
    this.select.value=this.renderer.fineSurface?.enabled?this.renderer.fineSurface.lod.id:'volume';this.sync();this.renderer.requestRender('camera');this.onChange();
   }
  }
 }
 sync(){
  if(!this.select)return;
  const pass=this.renderer.fineSurface,active=!!pass?.activeFor?.(this.renderer),coronary=this.renderer.coronaryActive?.();
  this.badge.hidden=!active&&!coronary;
  if(this.resolutionLabel)this.resolutionLabel.hidden=active||!!coronary;
  if(active){
   const spacing=pass.manifest.sourceSpacingUm;
   this.badge.textContent=this.surfaceLabel(pass.lod.id)+(Number.isFinite(spacing)?' · '+spacing+' µm source':'');
  }
  if(coronary)this.badge.textContent='Coronary View · '+coronary.meta.sourceSpacingUm+' µm Display';
  this.baseVolumeNote.textContent=this.resolutionLabel?'Base volume: '+this.resolutionLabel.textContent+'. CT section detail is shown on each section card.':'CT section detail is shown on each section card.';
  this.volumeButton.setAttribute('aria-pressed',String(!active&&!coronary));
  this.compactButton.setAttribute('aria-pressed',String(active&&pass.lod.id===this.startupSurface));
  this.compactButton.disabled=!this.renderer.gl||(this.loading&&this.select.value===this.startupSurface);
  this.gentleButton.setAttribute('aria-pressed',String(active&&pass.lod.id===this.resourcePolicy.defaultSurface));
  this.gentleOption.disabled=!this.gentleReady||!this.resourcePolicy.allowUltraSurface;
  this.gentleButton.disabled=!this.renderer.gl||(!this.resourcePolicy.constrained&&!this.gentleReady)||(this.loading&&this.select.value===this.resourcePolicy.defaultSurface);
  this.gentleButton.querySelector('span').textContent=this.resourcePolicy.constrained?'79.4 µm source · smaller polished surface':this.gentleReady?'79.4 µm source · less smoothing':'Ultra-High Fidelity is being prepared';
  this.downloadSize.hidden=this.resourcePolicy.constrained||!Number.isFinite(this.gentleDownloadMb)||this.gentleDownloadMb<=0;
  if(!this.downloadSize.hidden)this.downloadSize.textContent=pass?.lod.id==='gentle'?'Loaded in this session · no new download':this.gentleDownloadMb.toFixed(1)+' MB download';
  this.mount.setAttribute('aria-busy',String(!!this.loading));
  this.debrisToggle.disabled=!!coronary||!pass?.hasDebrisMask;this.debrisToggle.checked=this.renderer.settings.debrisCleanupEnabled!==false;
  this.debrisStatus.textContent=coronary?'The prepared coronary surface retains its source cleanup. Restore Surface Tissue to adjust fine-mesh debris.':pass?.cleanupWarning||(pass?.hasDebrisMask?(this.debrisToggle.checked?'Detached components removed from Ultra-High Fidelity.':'Original detached components are visible for comparison.'):'Available when Ultra-High Fidelity is ready.');
  if(!this.loading){
   if(coronary)this.setStatus('Prepared Coronary View · local atrial protection · original surface retained');
   else if(this.statusOverride)this.setStatus(this.statusOverride);
   else if(this.loadedLabel&&this.select.value!=='volume')this.setStatus((active?this.loadedLabel:'Interactive Volume for these settings · fine mesh retained in memory')+(pass?.cleanupWarning?' · '+pass.cleanupWarning:''));
  }
  this.loadPanel.hidden=!this.workspaceActive||(!this.loading&&!this.statusOverride&&!(this.select.value!=='volume'&&pass?.cleanupWarning));
  this.loadTitle.textContent=this.loading?'Loading '+this.surfaceLabel(this.select.value):'Surface Detail';
  this.loadSource.textContent='Showing: '+(active||coronary?this.badge.textContent:'Interactive Volume · '+(this.resolutionLabel?.textContent||'resident scan'));
  this.loadProgress.hidden=!this.loading;
  this.loadRetry.hidden=this.loading||!this.retrySurface;
  this.loadCompact.hidden=!this.renderer.gl||!(this.loading&&this.select.value==='gentle'||this.retrySurface==='gentle');
  this.syncRefinement();
 }
}
