import {flowPlane} from './flow-plane.js';
export {flowPlane} from './flow-plane.js';
import {MPRSampler} from './mpr.js';
import {add,mul,norm,dot} from './planes.js';
import {capColor,capAnatomyColor as anatomyColor,buildAnatomyPalette} from './render-styles.js';
import {scanActivity} from './download-priority.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const escapeHTML=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const VALID_IDS=['rv-inflow','rv-outflow','ra-inflow','ra-outflow','lv-inflow','lv-outflow','la-inflow','la-outflow'];
const CHAMBERS=[['RV','Right ventricle'],['RA','Right atrium'],['LV','Left ventricle'],['LA','Left atrium']];
const DEFAULT_STATE={preset:'rv-inflow',offsetMm:0,rotationDeg:0,tiltDeg:0,contrast:1.65,threshold:.28,flip:false,lockCamera:true,view:'overview'};
const validVector=value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);

/** Cache source intensity and mask samples once; recoloring never repeats geometry work. */
export function sampleFlowSection(sample,preset,{width=600,height=600,longestMm,extent,flip=false,cleanup=null,anatomy=null}){
 const {data,width:sw,height:sh,plane}=sample,count=width*height;
 const intensity=new Uint8Array(count),support=new Uint8Array(count),labels=new Uint8Array(count);support.fill(1);
 const span=Math.max(preset.focusWidthMm,preset.focusHeightMm)/longestMm,target=plane.target;
 const delta=target.map((v,i)=>v-plane.center[i]),uc=dot(delta,plane.right)/plane.width+.5,vc=.5-dot(delta,plane.up)/plane.height;
 const columns=new Int32Array(width),wx=new Float64Array(width),wy=new Float64Array(width),wz=new Float64Array(width);
 for(let col=0;col<width;col++){
  const u=((flip?width-1-col:col)/(width-1)-.5)*span;columns[col]=Math.round((uc+u/plane.width)*(sw-1));
  // Retain the original expression's arithmetic order at mask boundaries.
  wx[col]=target[0]+plane.right[0]*u;wy[col]=target[1]+plane.right[1]*u;wz[col]=target[2]+plane.right[2]*u;
 }
 const sampleMap=(map,x,y,z)=>{const [nx,ny,nz]=map.dimensions;return map.data[Math.round(clamp(x,0,1)*(nx-1))+nx*(Math.round(clamp(y,0,1)*(ny-1))+ny*Math.round(clamp(z,0,1)*(nz-1)))];};
 for(let row=0;row<height;row++){
  const v=(.5-row/(height-1))*span,sourceRow=Math.round((vc-v/plane.height)*(sh-1));
  if(sourceRow<0||sourceRow>=sh)continue;
  const dx=plane.up[0]*v,dy=plane.up[1]*v,dz=plane.up[2]*v;
  for(let col=0;col<width;col++){
   const sourceCol=columns[col],i=row*width+col;if(sourceCol<0||sourceCol>=sw)continue;
   const value=data[sourceCol+sourceRow*sw];intensity[i]=value;if(!value||(!cleanup&&!anatomy))continue;
   const x=(wx[col]+dx)/extent[0]+.5,y=.5-(wz[col]+dz)/extent[2],z=(wy[col]+dy)/extent[1]+.5;
   if(cleanup)support[i]=sampleMap(cleanup,x,y,z)?1:0;
   if(anatomy)labels[i]=sampleMap(anatomy,x,y,z);
  }
 }
 return {intensity,support,labels,hasAnatomy:!!anatomy,width,height,span};
}

/** A 256-value lookup per region replaces per-pixel color arrays and powers. */
export function paintFlowSection(grid,settings,contrast,colors){
 const withAnatomy=settings.palette===5&&grid.hasAnatomy,blocks=withAnatomy?17:1;
 const lut=new Uint8ClampedArray(blocks*256*4),packedLut=new Uint32Array(lut.buffer);
 for(let value=0;value<256;value++){
  const density=value/255,base=value&&!((settings.palette===4||settings.palette===6)&&density<settings.threshold)?capColor(density,contrast,settings.palette,settings):[0,0,0];
  for(let block=0;block<blocks;block++){
   const color=block&&density>settings.threshold?anatomyColor(base,block-1,colors,settings.anatomyOpacity??.65,settings.anatomySelected??0):base,index=(block*256+value)*4;
   lut[index]=Math.pow(Math.max(0,color[0]),.89)*255;lut[index+1]=Math.pow(Math.max(0,color[1]),.89)*255;lut[index+2]=Math.pow(Math.max(0,color[2]),.89)*255;lut[index+3]=255;
  }
 }
 const rgba=new Uint8ClampedArray(grid.intensity.length*4),packed=new Uint32Array(rgba.buffer),clean=settings.cleanupEnabled!==false;
 for(let i=0;i<packed.length;i++){
  const value=grid.intensity[i];let index=value;
  if(clean&&!grid.support[i])index=0;
  else if(withAnatomy&&value/255>settings.threshold)index+=(grid.labels[i]<16?grid.labels[i]+1:1)*256;
  packed[i]=packedLut[index];
 }
 return rgba;
}

/** Eight measured-anatomy starting views, sharing the host's 3D renderer. */
export class FlowViewsModule{
 constructor({renderer,mount,onExit,toast=()=>{},appearance=null,donor={}}){
  this.renderer=renderer;this.mount=typeof mount==='string'?document.querySelector(mount):mount;
  if(!this.mount)throw new Error('Flow views need a mount element.');
  this.appearance=appearance;this.onExit=onExit;this.toast=toast;this.active=false;this.donor=donor;
  this.fineSpacingUm=Number(donor.fineSpacingUm)>0?Number(donor.fineSpacingUm):79.4;this.fineLabel=`${Number(this.fineSpacingUm.toFixed(3))} µm`;this.offsetLimitMm=15;
  this.state={...DEFAULT_STATE,contrast:Number.isFinite(renderer.settings.capContrast)?clamp(renderer.settings.capContrast,.5,3):DEFAULT_STATE.contrast,threshold:Number.isFinite(renderer.settings.threshold)?clamp(renderer.settings.threshold,.005,.995):DEFAULT_STATE.threshold};this.presets=[];this.requestId=0;this.textureCache=new Map();this.textureBytes=0;
  this.mount.classList.add('flow-panel');this.mount.innerHTML=this.template();this.bind();this.updateUI();
 }
 $(name){return this.mount.querySelector(`[data-flow="${name}"]`);}
 isGeometric(){return this.metadata?.geometricComparisonOnly===true||this.donor.geometricComparisonOnly===true;}
 template(){const geometric=this.isGeometric();return `
  <header class="flow-heading"><div><span class="eyebrow" data-flow="eyebrow">${geometric?'MEASURED COMPARISONS':'CHAMBERS &amp; VALVES'}</span><h2 data-flow="heading">${geometric?'Compare the sections.':'Follow the flow.'}</h2><p data-flow="heading-description">${geometric?'Eight measured planes through this donor, with chamber and valve identities left unassigned.':'Eight cutaway views through the actual scan, with a closer look at the entrances and exits.'}</p></div><button type="button" class="outlined-button" data-flow="exit">Back to reconstruction <span aria-hidden="true">↗</span></button></header>
  <div class="flow-workspace">
   <aside class="flow-library" data-flow="library" aria-label="${geometric?'Measured section comparison presets':'Chamber inflow and outflow presets'}"><p class="flow-library-caption" data-flow="library-caption">${geometric?'Choose a measured section.':'Choose a chamber, then a direction.'}</p><div data-flow="presets" class="flow-presets"></div><div class="flow-library-note">${escapeHTML(this.donor.specimen||'LADAF-2021-17')} <span>Measured donor anatomy</span></div></aside>
   <div class="flow-scene">
    <div class="flow-scene-title"><div><strong data-flow="title">${geometric?'Measured section':'RV inflow'}</strong><span data-flow="subtitle">${geometric?'Loading donor-specific geometry':'Tricuspid apparatus'}</span></div><span class="flow-source-badge" data-flow="source-badge">${geometric?'Anatomy unassigned':'Source-guided plane'}</span></div>
    <div id="flowViewportMount" class="flow-viewport-mount" aria-label="${geometric?'Three-dimensional measured comparison cutaway':'Three-dimensional chamber and valve cutaway'}"></div>
    <div class="flow-view-actions" role="group" aria-label="View angle"><button type="button" data-view-mode="overview" aria-pressed="true">Explore angle</button><button type="button" data-view-mode="close" aria-pressed="false">Close-up</button><button type="button" data-view-mode="section" aria-pressed="false">Face section</button><button type="button" data-flow="reset" class="flow-reset">Reset view ↺</button></div>
    <div class="flow-scene-caption"><p data-flow="description"></p><div data-flow="structures" class="flow-structures"></div></div>
   </div>
   <aside class="flow-detail" aria-label="Section and appearance controls">
    <div class="flow-style"><label for="flowMaterial">Visual style</label><select id="flowMaterial" data-flow="material"><option value="4">Tissue / space</option><option value="6">Atlas cinematic</option><option value="5">Anatomy colors</option><option value="3">Porcelain</option><option value="2">Grayscale</option><option value="0">Warm stone</option><option value="1">Terracotta</option></select><label for="flowSmoothing">Surface</label><select id="flowSmoothing" data-flow="smoothing"><option value="0">Source</option><option value="1">Soft normals</option><option value="2">Smooth</option></select><label class="flow-checkbox"><input type="checkbox" data-flow="cleanup" checked><span>Clean scan</span></label></div>
    <div class="flow-section-title"><h3>Inside the section</h3><span data-flow="resolution">Measured CT</span></div>
    <div class="flow-section-wrap"><canvas data-flow="section" width="600" height="600" tabindex="0" role="img" aria-label="CT section through the selected flow view. Click to align 3D; scroll or use arrow keys to move the cut."></canvas><p data-flow="message" role="status">Choose a view after the scan loads.</p></div>
    <p class="flow-section-meta" data-flow="texture-status">Fine textures load only for the selected preset.</p>
    <p class="flow-section-hint">Click to face the section. Scroll to move through it.</p>
    <div class="flow-slider"><label for="flowOffset">Move cut <output data-flow="offset-value">0.0 mm</output></label><input id="flowOffset" data-control="offsetMm" type="range" min="-15" max="15" step="0.1" value="0"><div><span data-flow="offset-min">−15 mm</span><span data-flow="offset-max">+15 mm</span></div></div>
    <div class="flow-slider"><label for="flowThreshold">Tissue threshold <output data-flow="threshold-value">28%</output></label><input id="flowThreshold" data-control="threshold" type="range" min="0.005" max="0.995" step="0.005" value="0.28"></div>
    <div class="flow-row-actions"><button type="button" data-flow="flip" aria-pressed="false">Flip cutaway</button><button type="button" data-flow="restore-detail">Restore fine plane</button></div>
    <details class="flow-refine"><summary>Refine the plane</summary><div class="flow-slider"><label for="flowRotation">Rotate <output data-flow="rotation-value">0°</output></label><input id="flowRotation" data-control="rotationDeg" type="range" min="-60" max="60" step="1" value="0"></div><div class="flow-slider"><label for="flowTilt">Tilt <output data-flow="tilt-value">0°</output></label><input id="flowTilt" data-control="tiltDeg" type="range" min="-40" max="40" step="1" value="0"></div><div class="flow-slider"><label for="flowContrast">Section contrast <output data-flow="contrast-value">1.65×</output></label><input id="flowContrast" data-control="contrast" type="range" min="0.5" max="3" step="0.05" value="1.65"></div><label class="flow-checkbox"><input type="checkbox" data-flow="lock" checked><span>Keep angle aligned while moving the plane</span></label></details>
    <details class="flow-evidence"><summary>About this view</summary><p data-flow="review"></p><p data-flow="note"></p><a href="${escapeHTML(this.donor.datasetUrl||'https://human-organ-atlas.esrf.fr/datasets/1659197537')}" target="_blank" rel="noopener">Original Human Organ Atlas scan ↗</a></details>
   </aside>
  </div>`;}
 bind(){
  this.$('exit').addEventListener('click',()=>this.onExit?.());
  this.$('presets').addEventListener('click',event=>{const button=event.target.closest('[data-flow-preset]');if(button)this.selectPreset(button.dataset.flowPreset);});
  this.mount.querySelectorAll('[data-view-mode]').forEach(button=>button.addEventListener('click',()=>{this.state.view=button.dataset.viewMode;this.updateReadouts();this.positionCamera(true);}));
  this.$('reset').addEventListener('click',()=>this.reset());
  this.$('restore-detail').addEventListener('click',()=>{this.state.offsetMm=0;this.state.rotationDeg=0;this.state.tiltDeg=0;this.updateReadouts();this.applyPlane(true);});
  this.$('flip').addEventListener('click',()=>{this.state.flip=!this.state.flip;this.updateReadouts();this.applyPlane(true);});
  this.$('material').addEventListener('change',()=>{this.renderer.set({palette:Number(this.$('material').value),anatomySelected:0});this.appearance?.changed();this.updateAppearance();});
  this.$('smoothing').addEventListener('change',()=>{this.renderer.set({surfaceSmoothing:Number(this.$('smoothing').value)});this.appearance?.changed();});
  this.$('cleanup').addEventListener('change',async()=>{const enabled=this.$('cleanup').checked;this.$('cleanup').disabled=true;try{if(this.appearance?.setCleanupEnabled)await this.appearance.setCleanupEnabled(enabled);else{this.renderer.set({cleanupEnabled:enabled});this.appearance?.changed();}}catch(error){this.toast(error.message||'The scan appearance could not change.');}finally{this.$('cleanup').disabled=false;this.updateAppearance();if(this.active)this.applyPlane(false,false,true);}});
  this.mount.querySelectorAll('[data-control]').forEach(input=>input.addEventListener('input',()=>{
   const key=input.dataset.control;this.state[key]=Number(input.value);this.updateReadouts();
   if(key==='contrast'||key==='threshold'){this.renderer.set({capContrast:this.state.contrast,threshold:this.state.threshold});this.appearance?.changed();this.drawSection();}
   else{this.renderer.lastInteraction=performance.now();this.applyPlane();}
  }));
  this.$('lock').addEventListener('change',()=>{this.state.lockCamera=this.$('lock').checked;if(this.state.lockCamera)this.positionCamera(false);});
  const canvas=this.$('section');
  canvas.addEventListener('click',()=>{this.state.view='section';this.updateReadouts();this.positionCamera(false);});
  canvas.addEventListener('wheel',event=>{if(!this.active||!this.meta)return;event.preventDefault();this.moveSection(Math.sign(event.deltaY)*(event.altKey?5:1));},{passive:false});
  canvas.addEventListener('keydown',event=>{
   if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','Enter',' '].includes(event.key))event.preventDefault();
   if(event.key==='ArrowUp'||event.key==='ArrowRight')this.moveSection(event.shiftKey?5:1);
   else if(event.key==='ArrowDown'||event.key==='ArrowLeft')this.moveSection(event.shiftKey?-5:-1);
   else if(event.key==='Home'){this.state.offsetMm=0;this.updateReadouts();this.applyPlane();}
   else if(event.key==='Enter'||event.key===' '){this.state.view='section';this.updateReadouts();this.positionCamera(false);}
  });
 }
 async init(){
  if(this.initPromise)return this.initPromise;
  this.initPromise=(async()=>{
   const url=this.donor.flowViewsUrl===undefined?'./assets/flow-views-v5.json':this.donor.flowViewsUrl;if(!url)throw new Error('Measured section presets have not been prepared for this donor.');
   const response=await fetch(url);if(!response.ok)throw new Error('The section-view collection could not load.');
   const metadata=await response.json();
   if(metadata.datasetId&&this.donor.datasetId&&String(metadata.datasetId)!==String(this.donor.datasetId))throw new Error('These chamber views belong to a different donor.');
   if(!Array.isArray(metadata.presets)||metadata.presets.length!==8)throw new Error('The section-view collection is incomplete.');
   for(const p of metadata.presets){const b=p.world;if(!VALID_IDS.includes(p.id)||!validVector(b?.center)||!validVector(b?.target)||!validVector(b?.right)||!validVector(b?.up)||!validVector(b?.normal)||!(b.width>0&&b.height>0))throw new Error('A section-view frame is invalid.');}
   if(metadata.geometricComparisonOnly===true){
    const ids=metadata.displayGroups?.flatMap(group=>group.presetIds||[]);
    if(!Array.isArray(ids)||ids.length!==8||new Set(ids).size!==8||ids.some(id=>!VALID_IDS.includes(id)))throw new Error('The measured comparison labels are incomplete.');
   }
   this.metadata=metadata;this.presets=metadata.presets;
   if(!this.restored)this.state.flip=!!this.preset()?.flip;
   this.updateUI();return metadata;
  })();
  try{return await this.initPromise;}catch(error){this.initPromise=null;throw error;}
 }
 preset(){return this.presets.find(p=>p.id===this.state.preset);}
 setVolume(data,meta){
  const hadVolume=!!this.data;
  this.data=data;this.meta=meta;const spacing=Array.isArray(meta.spacingUm)?meta.spacingUm:[meta.spacingUm,meta.spacingUm,meta.spacingUm];
  this.longestMm=Math.max(...meta.dimensions.map((d,i)=>(d-1)*spacing[i]))/1000;this.sourceSpacingUm=Math.max(...spacing);this.spacingMm=Math.min(...spacing)/1000;
  this.offsetLimitMm=15*this.longestMm/168.0104;this.state.offsetMm=clamp(this.state.offsetMm,-this.offsetLimitMm,this.offsetLimitMm);
  const input=this.mount?.querySelector('#flowOffset');if(input){input.min=-this.offsetLimitMm;input.max=this.offsetLimitMm;input.step=this.longestMm<85?.02:.1;
  const limit=Number(this.offsetLimitMm.toFixed(1));this.$('offset-min').textContent=`−${limit} mm`;this.$('offset-max').textContent=`+${limit} mm`;}
  this.sampler?.destroy();this.sampler=null;this.requestId++;this.sample=null;this.previewGrid=null;this.drawKey='';
  // First arrival initializes a view opened during loading. Later refinements
  // replace sampling data without disturbing the user's orbit or zoom.
  if(this.active)this.applyPlane(!hadVolume,!hadVolume,hadVolume);
 }
 ensureSampler(){if(!this.sampler){this.sampler=new MPRSampler();this.sampler.setVolume(this.data,this.meta,this.renderer.extent);}return this.sampler;}
 async enter(){
  this.active=true;this.mount.hidden=false;this.renderer.set({anatomySelected:0});this.updateAppearance();
  try{await this.init();if(this.active){this.updateUI();this.applyPlane(true,true);}}
  catch(error){if(this.active){this.message('The preset collection could not load. Return to reconstruction and try again.');this.toast(error.message);}}
 }
 leave(){this.active=false;this.requestId++;clearTimeout(this.sampleTimer);this.queuedSample=null;this.sampler?.destroy();this.sampler=null;this.renderer.clearCapData();}
 getState(){return {...this.state,contrast:this.renderer.settings.capContrast??this.state.contrast,threshold:this.renderer.settings.threshold??this.state.threshold};}
 restore(saved={}){
  const appearance={contrast:Number.isFinite(this.renderer.settings.capContrast)?clamp(this.renderer.settings.capContrast,.5,3):DEFAULT_STATE.contrast,threshold:Number.isFinite(this.renderer.settings.threshold)?clamp(this.renderer.settings.threshold,.005,.995):DEFAULT_STATE.threshold};
  this.restored=true;this.state={...DEFAULT_STATE,...appearance,...saved};if(!VALID_IDS.includes(this.state.preset))this.state.preset=DEFAULT_STATE.preset;
  for(const [key,lo,hi] of [['offsetMm',-this.offsetLimitMm,this.offsetLimitMm],['rotationDeg',-60,60],['tiltDeg',-40,40],['contrast',.5,3],['threshold',.005,.995]])this.state[key]=saved[key]!==null&&saved[key]!==undefined&&Number.isFinite(Number(saved[key]))?clamp(Number(saved[key]),lo,hi):(appearance[key]??DEFAULT_STATE[key]);
  const restoredAppearance={};if(saved.contrast!==null&&saved.contrast!==undefined&&Number.isFinite(Number(saved.contrast)))restoredAppearance.capContrast=this.state.contrast;if(saved.threshold!==null&&saved.threshold!==undefined&&Number.isFinite(Number(saved.threshold)))restoredAppearance.threshold=this.state.threshold;if(Object.keys(restoredAppearance).length)this.renderer.set(restoredAppearance);
  this.state.flip=!!this.state.flip;this.state.lockCamera=this.state.lockCamera!==false;this.state.view=['overview','close','section'].includes(this.state.view)?this.state.view:'overview';
  this.updateUI();if(this.active)this.applyPlane(true,true);
 }
 selectPreset(id){
  if(!VALID_IDS.includes(id))return;this.state.preset=id;this.restored=false;this.reset();
  this.$('presets').querySelector(`[data-flow-preset="${id}"]`)?.focus({preventScroll:true});
 }
 reset(){
  const p=this.preset(),contrast=this.renderer.settings.capContrast??this.state.contrast,threshold=this.renderer.settings.threshold??this.state.threshold;this.state={...DEFAULT_STATE,preset:this.state.preset,flip:!!p?.flip,contrast,threshold};this.renderer.set({anatomySelected:0});this.updateUI();if(this.active)this.applyPlane(true,true);
 }
 moveSection(direction){this.state.offsetMm=clamp(this.state.offsetMm+direction*(this.spacingMm||.3176),-this.offsetLimitMm,this.offsetLimitMm);this.renderer.lastInteraction=performance.now();this.updateReadouts();this.applyPlane();}
 getPlane(){return flowPlane(this.preset(),this.state,this.longestMm);}
 positionCamera(resetZoom=false,{followScene=false}={}){
  const p=this.preset(),plane=this.getPlane();if(!p||!plane)return;
  const side=this.state.flip?-1:1;let normal=mul(plane.normal,side),up=plane.up;
  if(this.state.view!=='section')normal=norm(add(normal,add(mul(plane.right,.24*side),mul(plane.up,.10))));
  up=norm(add(up,mul(normal,-dot(normal,up))));
  if(resetZoom)this.renderer.camera.distance=this.state.view==='close'?p.closeDistance:p.cameraDistance;
  this.renderer.alignPlane(normal,up,plane.target,{followScene});
 }
 applyPlane(forceAlign=false,resetZoom=false,preserveCamera=false){
  if(!this.active)return;const plane=this.getPlane();this.plane=plane;
  if(!plane||!this.data){this.message(this.meta?'Loading reference views…':'Loading scan data…');return;}
  this.renderer.set({mode:0,clipAxis:3,clipFlip:this.state.flip?1:0,showPlanes:0,oblique:plane});
  this.renderer.clearCapData();if(!preserveCamera&&(forceAlign||this.state.lockCamera))this.positionCamera(resetZoom,{followScene:true});
  const token=++this.requestId,preset=this.preset();clearTimeout(this.sampleTimer);this.message('Loading the measured section…');
  const fine=Math.abs(this.state.offsetMm)<1e-8&&Math.abs(this.state.rotationDeg)<1e-8&&Math.abs(this.state.tiltDeg)<1e-8;
  this.sampleTimer=setTimeout(()=>this.samplePlane(plane,preset,token,fine),60);
 }
 async loadTexture(item){
  if(this.textureCache.has(item.url)){const value=this.textureCache.get(item.url);this.textureCache.delete(item.url);this.textureCache.set(item.url,value);return value.promise;}
  const entry={bytes:0,promise:null};
  const release=scanActivity.beginForeground('chamber-section');
  entry.promise=(async()=>{
   const response=await fetch(item.url,{cache:'force-cache'});if(!response.ok)throw new Error('The fine section could not load.');
   const bitmap=await createImageBitmap(await response.blob(),{colorSpaceConversion:'none',premultiplyAlpha:'none'});
   if(bitmap.width!==item.width||bitmap.height!==item.height){bitmap.close();throw new Error('The fine section has unexpected dimensions.');}
   const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
   const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(bitmap,0,0);bitmap.close();
   const rgba=context.getImageData(0,0,canvas.width,canvas.height).data,data=new Uint8Array(canvas.width*canvas.height);
   for(let i=0;i<data.length;i++)data[i]=rgba[4*i];
   entry.bytes=data.byteLength;this.textureBytes+=entry.bytes;
   for(const [key,value] of this.textureCache){if(this.textureBytes<=20*1024*1024)break;if(key!==item.url&&value.bytes){this.textureCache.delete(key);this.textureBytes-=value.bytes;}}
   return {data,width:canvas.width,height:canvas.height,spacingUm:item.spacingUm,encodedBytes:item.bytes,fine:true,cleaned:item.cleaned===true};
  })().catch(error=>{this.textureCache.delete(item.url);throw error;}).finally(release);
  this.textureCache.set(item.url,entry);return entry.promise;
 }
 async samplePlane(plane,preset,token,fine){
  if(!this.active||token!==this.requestId)return;
  if(this.sampling){this.queuedSample={plane,preset,token,fine};return;}this.sampling=true;
  try{
   let result;
   if(fine&&preset.texture&&this.renderer.settings.cleanupEnabled!==false){try{result=await this.loadTexture(preset.texture);}catch(error){console.warn('Fine flow section unavailable; using the current scan volume.',error);}}
   if(!result){
    if(!this.active||token!==this.requestId)return;
    const longest=900,width=Math.max(128,Math.round(longest*Math.min(1,plane.width/plane.height))),height=Math.max(128,Math.round(longest*Math.min(1,plane.height/plane.width)));
    result=await this.ensureSampler().sample(plane,{width,height});result.spacingUm=this.sourceSpacingUm;result.fine=false;
   }
   if(token!==this.requestId||!this.active)return;
   this.sample={...result,plane,presetId:preset.id};this.drawKey='';
   this.renderer.setCapData({data:result.data,width:result.width,height:result.height,spacingUm:result.spacingUm,cleaned:result.cleaned===true,plane,key:`flow:${preset.id}:${token}`});
   this.$('resolution').textContent=`${result.spacingUm.toFixed(1)} µm`;
   this.$('texture-status').textContent=result.fine?`${Math.ceil(result.encodedBytes/1000)} KB lossless texture · source preset plane`:(this.renderer.settings.cleanupEnabled===false?`${result.spacingUm.toFixed(1)} µm original volume · enable Clean scan for the ${this.fineLabel} prepared plane.`:`${result.spacingUm.toFixed(1)} µm volume · adjusted plane. Restore the fine plane for ${this.fineLabel} detail.`);
   this.message('');this.drawSection();
  }catch(error){if(token===this.requestId&&this.active){this.message('This section could not finish loading. Choose another preset or restore the fine plane.');console.warn('Flow section:',error);}}
  finally{this.sampling=false;const next=this.queuedSample;this.queuedSample=null;if(next&&this.active)this.samplePlane(next.plane,next.preset,next.token,next.fine);}
 }
 drawSection(){
  if(!this.sample||!this.active)return;const {data,width,height,plane,presetId}=this.sample,p=this.presets.find(item=>item.id===presetId);if(!p)return;
  const s=this.renderer.settings,a=this.appearance,key=[presetId,this.requestId,s.palette,s.threshold,s.cleanupEnabled,s.anatomyOpacity,s.anatomySelected,s.capContrast,s.windowEnabled,s.windowLow,s.windowHigh,s.windowGamma,s.cutFaceExposure,this.state.flip,a?.revision||0].join(':');if(key===this.drawKey)return;this.drawKey=key;
  const canvas=this.$('section'),w=600,h=600;canvas.width=w;canvas.height=h;const context=canvas.getContext('2d');
  const cache=this.previewGrid,cleanup=this.sample.cleaned?null:a?.cleanup,anatomy=a?.anatomy;
  if(!cache||cache.sample!==this.sample||cache.flip!==this.state.flip||cache.cleanup!==cleanup||cache.anatomy!==anatomy){
   this.previewGrid={sample:this.sample,flip:this.state.flip,cleanup,anatomy,grid:sampleFlowSection(this.sample,p,{width:w,height:h,longestMm:this.longestMm,extent:this.renderer.extent,flip:this.state.flip,cleanup,anatomy})};
  }
  const grid=this.previewGrid.grid,span=grid.span,colors=this.renderer.anatomyColors||buildAnatomyPalette(a?.anatomy?.labels);
  const pixels=new ImageData(paintFlowSection(grid,s,s.capContrast??this.state.contrast,colors),w,h);
  context.putImageData(pixels,0,0);const scale=10/(span*this.longestMm)*w,pad=24;
  context.strokeStyle='#eee9df';context.fillStyle='#eee9df';context.lineWidth=2;context.font='14px ui-monospace,monospace';context.beginPath();context.moveTo(pad,h-pad);context.lineTo(pad+scale,h-pad);context.stroke();context.fillText('10 mm',pad,h-pad-10);
  canvas.setAttribute('aria-label',`${p.title}: ${p.subtitle}. Measured CT section at ${this.state.offsetMm.toFixed(1)} millimeters offset. Click to align 3D; scroll or use arrow keys to move.`);
 }
 message(text){this.$('message').textContent=text;this.$('message').hidden=!text;this.$('section').classList.toggle('is-loading',!!text);}
 updateAppearance(){
  const settings=this.renderer.settings,contrast=settings.capContrast,threshold=settings.threshold;
  const anatomyOption=this.$('material').querySelector('option[value="5"]');if(anatomyOption&&(this.isGeometric()||this.donor.anatomyManifestUrl===null)){anatomyOption.disabled=true;anatomyOption.textContent='Anatomy · unassigned';}
  let changed=false;if(Number.isFinite(contrast)&&this.state.contrast!==contrast){this.state.contrast=clamp(contrast,.5,3);changed=true;}if(Number.isFinite(threshold)&&this.state.threshold!==threshold){this.state.threshold=clamp(threshold,.005,.995);changed=true;}if(changed)this.updateReadouts();
  this.$('material').value=settings.palette;this.$('smoothing').value=settings.surfaceSmoothing??1;this.$('cleanup').checked=settings.cleanupEnabled!==false;this.drawSection();
 }
 updateUI(){
  const p=this.preset();
  if(this.isGeometric()){
   this.$('eyebrow').textContent='MEASURED COMPARISONS';this.$('heading').textContent='Compare the sections.';
   this.$('heading-description').textContent='Eight measured planes through this donor, with chamber and valve identities left unassigned.';
   this.$('library').setAttribute('aria-label','Measured section comparison presets');this.$('library-caption').textContent='Choose a measured section.';
   this.$('source-badge').textContent='Anatomy unassigned';this.mount.querySelector('#flowViewportMount').setAttribute('aria-label','Three-dimensional measured comparison cutaway');
   const groups=this.metadata?.displayGroups||[];
   this.$('presets').innerHTML=groups.map(group=>`<section class="flow-chamber"><h3><span>${escapeHTML(group.key)}</span>${escapeHTML(group.name)}</h3><div>${group.presetIds.map(id=>{const item=this.presets.find(p=>p.id===id),selected=id===this.state.preset;if(!item)return '';return `<button type="button" class="flow-preset" data-flow-preset="${id}" aria-pressed="${selected}" aria-label="${escapeHTML(item.title)}"><img src="${escapeHTML(item.previewUrl)}" alt="" loading="lazy"><span>${escapeHTML(item.displayLabel||item.title)} <i aria-hidden="true">↗</i></span></button>`;}).join('')}</div></section>`).join('');
  }else this.$('presets').innerHTML=CHAMBERS.map(([key,name])=>`<section class="flow-chamber"><h3><span>${key}</span>${name}</h3><div>${['inflow','outflow'].map(kind=>{const id=key.toLowerCase()+'-'+kind,item=this.presets.find(p=>p.id===id),selected=id===this.state.preset;return `<button type="button" class="flow-preset" data-flow-preset="${id}" aria-pressed="${selected}" aria-label="${key} ${kind}${item?' — '+escapeHTML(item.subtitle):''}"${item?'':' disabled'}>${item?`<img src="${escapeHTML(item.previewUrl)}" alt="" loading="lazy">`:''}<span>${kind==='inflow'?'Inflow':'Outflow'} <i aria-hidden="true">${kind==='inflow'?'↘':'↗'}</i></span></button>`;}).join('')}</div></section>`).join('');
  if(p){for(const key of ['title','subtitle','description','review','note'])this.$(key).textContent=p[key];this.$('structures').innerHTML=p.structures.map(label=>`<span>${escapeHTML(label)}</span>`).join('');}
  this.updateReadouts();this.updateAppearance();
 }
 updateReadouts(){
  this.mount.querySelectorAll('[data-control]').forEach(input=>{input.value=this.state[input.dataset.control];});
  this.$('offset-value').textContent=`${this.state.offsetMm>0?'+':''}${this.state.offsetMm.toFixed(1)} mm`;this.$('threshold-value').textContent=`${Math.round(this.state.threshold*100)}%`;
  this.$('rotation-value').textContent=`${this.state.rotationDeg>0?'+':''}${this.state.rotationDeg}°`;this.$('tilt-value').textContent=`${this.state.tiltDeg>0?'+':''}${this.state.tiltDeg}°`;this.$('contrast-value').textContent=`${this.state.contrast.toFixed(2).replace(/0$/,'')}×`;
  this.$('flip').setAttribute('aria-pressed',String(this.state.flip));this.$('lock').checked=this.state.lockCamera;
  this.mount.querySelectorAll('[data-view-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.viewMode===this.state.view)));
 }
 destroy(){this.leave();this.textureCache.clear();this.textureBytes=0;this.previewGrid=null;}
}
