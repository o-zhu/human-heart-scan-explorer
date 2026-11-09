import {EchoTextureCache} from './echo-texture-cache.js';
import {flowPlane} from './flow-plane.js';
import {MPRSampler} from './mpr.js';
import {add,mul,norm,dot} from './planes.js';
import {scanActivity} from './download-priority.js';
import {MAIN_VIEW_REVIEW_VERSION,MAIN_VIEW_REVIEW_DATASET,loadMainViewReview,applyMainViewReview,reviewedStartingCamera,sameStartingRaster} from './main-view-review.js';

const PRIMARY=['rv-inflow','rv-outflow','lv-inflow','lv-outflow'];
const SECONDARY=['ra-inflow','ra-outflow','la-inflow','la-outflow'];
const IDS=[...PRIMARY,...SECONDARY];
const NAMES={'rv-inflow':'RV Inflow','rv-outflow':'RV Outflow','lv-inflow':'LV Inflow','lv-outflow':'LV Outflow','ra-inflow':'RA Inflow','ra-outflow':'RA Outflow','la-inflow':'LA Inflow','la-outflow':'LA Outflow'};
const GEOMETRIC={'rv-inflow':'Long A','rv-outflow':'Long B','lv-inflow':'Oblique Long','lv-outflow':'Oblique Cross','ra-inflow':'Central Cross','ra-outflow':'Offset Cross','la-inflow':'Offset Long A','la-outflow':'Offset Cross B'};
const DEFAULT={preset:null,view:'close',flip:false,offsetMm:0,rotationDeg:0,tiltDeg:0,reviewVersion:MAIN_VIEW_REVIEW_VERSION};
const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
const vector=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);

/** Small, donor-specific entry points into the existing measured reference planes. */
export class QuickViews{
 constructor({renderer,mount,donor,appearance,fineSource,onActivate=()=>{},onChange=()=>{},toast=()=>{},textureCache=null,reviewLoader=loadMainViewReview}){
  this.renderer=renderer;this.mount=mount;this.donor=donor;this.appearance=appearance;this.fineSource=fineSource;
  this.onActivate=onActivate;this.onChange=onChange;this.toast=toast;this.state={...DEFAULT};this.active=false;this.requestId=0;
  this.textureCache=textureCache||new EchoTextureCache();this.presets=[];this.lastCleanup=renderer.settings.cleanupEnabled!==false;
  this.reviewLoader=reviewLoader;this.reviewedPresets=[];this.review=null;
  const names=donor.geometricComparisonOnly?GEOMETRIC:NAMES;
  const buttons=ids=>ids.map(id=>`<button type="button" data-quick-preset="${id}" aria-pressed="false">${names[id]}</button>`).join('');
  mount.innerHTML=`<div class="quick-view-row quick-view-primary" role="group" aria-label="${donor.geometricComparisonOnly?'Measured section starting views':'Ventricular starting views'}">${buttons(PRIMARY)}</div><div class="quick-view-row quick-view-secondary" role="group" aria-label="${donor.geometricComparisonOnly?'Additional measured section starting views':'Atrial starting views'}">${buttons(SECONDARY)}</div><div class="quick-view-selection" hidden><span class="quick-view-status" role="status"></span><div class="quick-view-actions" role="group" aria-label="Selected cutaway view"><button type="button" data-quick-view="close" aria-pressed="true" title="Restore the close-up camera">Close-up</button><button type="button" data-quick-flip aria-pressed="false">Flip</button><button type="button" data-quick-regions aria-pressed="false" title="Show approximate chamber and vessel tissue regions">Region Colors</button></div></div>`;
  mount.querySelector('[data-quick-regions]').hidden=donor.anatomyManifestUrl===null;
  mount.addEventListener('click',event=>{
   const preset=event.target.closest('[data-quick-preset]');
   if(preset){void this.select(preset.dataset.quickPreset);return;}
   const view=event.target.closest('[data-quick-view]');
   if(view&&this.active){this.state.view=view.dataset.quickView;this.positionCamera(true);this.updateUI();return;}
   if(event.target.closest('[data-quick-flip]'))this.flip();
   if(event.target.closest('[data-quick-regions]'))this.toggleRegions();
  });
 }
 async init(){
  if(this.initPromise)return this.initPromise;
  this.initPromise=(async()=>{
   const response=await fetch(this.donor.flowViewsUrl,{priority:'high'});
   if(!response.ok)throw new Error('The starting views could not load. Select a view to retry.');
   const metadata=await response.json();
   const sourceId=metadata.datasetId??metadata.datasetUrl?.match(/\/datasets\/(\d+)\/?$/)?.[1];
   if(String(sourceId)!==String(this.donor.datasetId)||metadata.specimen!==this.donor.specimen)throw new Error('These views belong to a different donor.');
   if(!Array.isArray(metadata.presets)||metadata.presets.length!==8||new Set(metadata.presets.map(p=>p.id)).size!==8)throw new Error('The starting-view collection is incomplete.');
   for(const p of metadata.presets){const w=p.world;if(!IDS.includes(p.id)||!vector(w?.center)||!vector(w?.target)||!vector(w?.right)||!vector(w?.up)||!vector(w?.normal)||!(w.width>0&&w.height>0)||!(p.cameraDistance>0&&p.closeDistance>0))throw new Error('A starting-view frame is invalid.');}
   this.presets=metadata.presets;
   if(this.reviewLoader&&!this.donor.geometricComparisonOnly&&String(this.donor.datasetId)===MAIN_VIEW_REVIEW_DATASET){
    try{this.review=await this.reviewLoader();this.reviewedPresets=applyMainViewReview(this.presets,this.review,this.donor);}
    catch(error){this.reviewError=true;console.warn('Starting-view review:',error);}
   }
   for(const button of this.mount.querySelectorAll('[data-quick-preset]')){
    const p=(this.reviewedPresets.length?this.reviewedPresets:this.presets).find(p=>p.id===button.dataset.quickPreset);button.title=[p.title,p.subtitle].filter(Boolean).join(' · ');button.setAttribute('aria-label',button.title);
   }
   return metadata;
  })();
  try{return await this.initPromise;}catch(error){this.initPromise=null;throw error;}
 }
 preset(){return (this.state.reviewVersion===MAIN_VIEW_REVIEW_VERSION&&this.review?this.reviewedPresets:this.presets).find(p=>p.id===this.state.preset);}
 getState(){return this.state.preset?{...this.state}:null;}
 setVolume(data,meta){
  this.data=data;this.meta=meta;const spacing=Array.isArray(meta.spacingUm)?meta.spacingUm:[meta.spacingUm,meta.spacingUm,meta.spacingUm];
  this.longestMm=Math.max(...meta.dimensions.map((d,i)=>(d-1)*spacing[i]))/1000;this.sourceSpacingUm=Math.max(...spacing);
  this.sampler?.destroy();this.sampler=null;
  if(this.active&&this.preset())void this.applyPlane({preserveCamera:true});
 }
 async select(id,{saved=null,preserveCamera=false,clearEmphasis=true}={}){
  if(!IDS.includes(id)||!this.renderer.loaded)return;
  this.onActivate();this.cancel();this.active=true;this.state={...DEFAULT,preset:id};
  const token=this.requestId;this.updateUI('Loading view…');
  const release=scanActivity.beginForeground('quick-view');
  try{
   await this.init();if(!this.active||token!==this.requestId)return;
   // Older shared views must retain their recorded physical plane. A fresh
   // button selection adopts the reviewed catalog; Reset does the same.
   if(saved)this.state.reviewVersion=saved.reviewVersion===MAIN_VIEW_REVIEW_VERSION?MAIN_VIEW_REVIEW_VERSION:'previous';
   if(!this.reviewedPresets.length)this.state.reviewVersion='previous';
   const p=this.preset();this.state.flip=!!p.flip;
   if(saved){
    this.state.view=['overview','close','section'].includes(saved.view)?saved.view:DEFAULT.view;
    if(typeof saved.flip==='boolean')this.state.flip=saved.flip;
    for(const [key,limit] of [['offsetMm',15*(this.longestMm||168.0104)/168.0104],['rotationDeg',60],['tiltDeg',40]])if(Number.isFinite(saved[key]))this.state[key]=clamp(saved[key],-limit,limit);
   }
   this.lastCleanup=this.renderer.settings.cleanupEnabled!==false;
   this.renderer.autoRotate=false;if(clearEmphasis){this.renderer.set({anatomySelected:0});this.appearance?.changed();}
   await this.applyPlane({preserveCamera});
  }catch(error){if(this.active&&token===this.requestId){this.updateUI('View unavailable · select to retry');this.toast(error.message);}}
  finally{release();}
 }
 restore(saved,{preserveCamera=true}={}){return IDS.includes(saved?.preset)?this.select(saved.preset,{saved,preserveCamera,clearEmphasis:false}):Promise.resolve();}
 cancel(){this.requestId++;this.fineController?.abort();this.fineController=null;this.textureCache.pause();}
 suspend(){this.active=false;this.cancel();}
 resume(){if(this.state.preset){this.active=true;return this.presets.length?this.applyPlane({preserveCamera:true}):this.restore(this.state);}}
 deactivate(){this.suspend();this.state={...DEFAULT};this.updateUI();}
 reset(){if(this.state.preset)return this.select(this.state.preset);}
 flip(){if(!this.active||!this.preset())return;this.state.flip=!this.state.flip;this.renderer.set({clipFlip:this.state.flip?1:0});this.positionCamera(false);this.updateUI();this.onChange();}
 toggleRegions(){
  const settings=this.renderer.settings,on=settings.palette===5;
  if(!on)this.previousRegionPalette=settings.palette;
  this.renderer.set({palette:on?(this.previousRegionPalette??4):5,anatomySelected:0});this.appearance?.changed();this.updateUI();
 }
 positionCamera(resetZoom){
  const p=this.preset(),plane=this.plane;if(!p||!plane)return;
  if(p.reviewVersion===MAIN_VIEW_REVIEW_VERSION){
   const rect=this.renderer.canvas?.getBoundingClientRect?.(),camera=reviewedStartingCamera(p,plane,{view:this.state.view,flip:this.state.flip,aspect:rect?.height?rect.width/rect.height:1});
   if(resetZoom)this.renderer.camera.distance=camera.distance;
   this.renderer.alignPlane(camera.normal,camera.up,camera.target);return;
  }
  const side=this.state.flip?-1:1;let normal=mul(plane.normal,side),up=plane.up;
  if(this.state.view!=='section')normal=norm(add(normal,add(mul(plane.right,.24*side),mul(plane.up,.10))));
  up=norm(add(up,mul(normal,-dot(normal,up))));
  if(resetZoom)this.renderer.camera.distance=this.state.view==='close'?p.closeDistance:p.cameraDistance;
  this.renderer.alignPlane(normal,up,plane.target);
 }
 async applyPlane({preserveCamera=false}={}){
  if(!this.active||!this.data||!this.preset())return;
  this.cancel();const token=this.requestId,p=this.preset(),plane=flowPlane(p,this.state,this.longestMm);this.plane=plane;
  this.fineController=new AbortController();const signal=this.fineController.signal;
  this.renderer.set({mode:0,clipAxis:3,clipFlip:this.state.flip?1:0,showPlanes:0,oblique:plane});this.renderer.clearCapData();
  if(!preserveCamera)this.positionCamera(true);
  this.updateUI('Loading fine texture…');this.onChange();
  const current=()=>this.active&&token===this.requestId&&!signal.aborted;
  const release=scanActivity.beginForeground('quick-view-texture');
  try{
   let result;const clean=this.renderer.settings.cleanupEnabled!==false,exact=!this.state.offsetMm&&!this.state.rotationDeg&&!this.state.tiltDeg;
   if(exact&&clean&&p.texture){
    try{result=await this.textureCache.load({...p.texture,fineSpacingUm:this.donor.fineSpacingUm});}
    catch(error){if(error.name==='AbortError')return;console.warn('Prepared starting-view texture:',error);}
   }
   if(!current())return;
   if(!result){
    if(!this.sampler){this.sampler=new MPRSampler();this.sampler.setVolume(this.data,this.meta,this.renderer.extent);}
    const longest=720,width=Math.max(128,Math.round(longest*Math.min(1,plane.width/plane.height))),height=Math.max(128,Math.round(longest*Math.min(1,plane.height/plane.width)));
    result={...await this.sampler.sample(plane,{width,height}),spacingUm:this.sourceSpacingUm,cleaned:false};
   }
   if(!current())return;
   this.setTexture(result,plane,token);
   if(clean&&!result.ultra&&this.fineSource?.samplePlane){
    this.updateUI(`${Number(result.spacingUm.toFixed(2))} µm · refining…`);
    const fine=await this.fineSource.samplePlane(plane,{signal,exactRaster:true,spacingUm:this.donor.fineSpacingUm});
    if(current()&&fine.complete){if(!sameStartingRaster(fine.plane,plane))throw new Error('Fine detail belongs to another starting plane.');this.setTexture({...fine,cleaned:true},plane,token);}
   }
  }catch(error){if(current()&&error.name!=='AbortError'){this.updateUI('Volume preview · fine detail unavailable');console.warn('Starting-view detail:',error);}}
  finally{release();}
 }
 setTexture(result,plane,token){
  this.renderer.setCapData({...result,plane,key:`quick:${this.donor.id}:${this.state.preset}:${token}`});
  this.updateUI(`${Number(result.spacingUm.toFixed(2))} µm${result.ultra||result.complete?' · Ultra':''}`);
 }
 updateAppearance(){
  const clean=this.renderer.settings.cleanupEnabled!==false;
  if(clean!==this.lastCleanup){this.lastCleanup=clean;if(this.active)void this.applyPlane({preserveCamera:true});}
  this.updateUI();
 }
 updateUI(message){
  for(const button of this.mount.querySelectorAll('[data-quick-preset]'))button.setAttribute('aria-pressed',String(button.dataset.quickPreset===this.state.preset));
  const selection=this.mount.querySelector('.quick-view-selection');selection.hidden=!this.state.preset;
  if(message!==undefined)this.message=message;
  const p=this.preset(),names=this.donor.geometricComparisonOnly?GEOMETRIC:NAMES;
  const status=this.mount.querySelector('.quick-view-status');status.textContent=this.state.preset?[p?.title||names[this.state.preset],this.message].filter(Boolean).join(' · '):'';
  status.title=p?[p.subtitle,p.description,p.note].filter(Boolean).join(' — '):'';
  for(const b of this.mount.querySelectorAll('[data-quick-view]'))b.setAttribute('aria-pressed',String(b.dataset.quickView===this.state.view));
  this.mount.querySelector('[data-quick-flip]').setAttribute('aria-pressed',String(this.state.flip));
  this.mount.querySelector('[data-quick-regions]').setAttribute('aria-pressed',String(this.renderer.settings.palette===5));
  if(this.reviewError&&this.state.preset){status.textContent+=' · Original plane (review unavailable)';status.title+=' Review unavailable; the original source plane is shown.';}
 }
 destroy(){this.deactivate();this.sampler?.destroy();this.textureCache.destroy();}
}
