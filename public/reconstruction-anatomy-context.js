import {DONORS} from './donors.js';

let modulesPromise;
const loadModules=()=>modulesPromise||(modulesPromise=Promise.all([
 import('./tee-context-geometry.js'),import('./echo-anatomy-context-v2.js'),
 import('./echo-acquisition-geometry.js'),import('./probe-scene.js'),
 import('./tee-depth-labels.js'),import('./echo-context-presentation.js'),
 import('./tee-scene.js'),import('./probe-geometry.js'),
]).then(parts=>Object.assign({},...parts)).catch(error=>{modulesPromise=null;throw error;}));
const copyCamera=camera=>({...camera,pan:[...camera.pan]});
const dot=(a,b)=>a.reduce((sum,value,index)=>sum+value*b[index],0);
const referenceMmOf=meta=>{
 if(!meta?.dimensions||meta.dimensions.length!==3)return null;
 const spacing=Array.isArray(meta.spacingUm)?meta.spacingUm:Array(3).fill(meta.spacingUm);
 const size=meta.dimensions.map((n,i)=>(n-1)*spacing[i]/1000);
 return size.every(n=>Number.isFinite(n)&&n>0)?Math.max(...size):null;
};

/** Context-only submission to the accepted heart/cut-face depth pass. The
 * source meshes, physical donor frame, and clipping state never change here. */
class ReconstructionContextLayer{
 constructor(renderer,modules,model,onError){
  this.renderer=renderer;this.modules=modules;this.model=model;this.onError=onError;
  try{
   this.view=new modules.GeometryCanvas(renderer.canvas,{gl:renderer.gl});
   this.labels=new modules.TeeDepthLabels(renderer);
   this.meshes=model.meshes.map(mesh=>({...this.view.upload(mesh.vertices,mesh.color,mesh.alpha,mesh.gloss),center:mesh.bounds.center,role:mesh.role}));
  }catch(error){this.dispose();throw error;}
 }
 draw(frame){
  if(this.disposed)return;
  const {gl,basis,width,height}=frame;
  this.view.begin(basis,width,height,this.model.referenceMm);
  const depth=mesh=>dot(mesh.center,basis.forward);
  const surfaces=this.meshes.filter(mesh=>mesh.role!=='contour').sort((a,b)=>depth(b)-depth(a));
  const contours=this.meshes.filter(mesh=>mesh.role==='contour').sort((a,b)=>depth(b)-depth(a));
  this.modules.withHeartPriority(gl,()=>{
   gl.enable(gl.CULL_FACE);gl.cullFace(gl.FRONT);for(const mesh of surfaces)this.view.draw(mesh);
   gl.cullFace(gl.BACK);for(const mesh of surfaces)this.view.draw(mesh);
   gl.disable(gl.CULL_FACE);for(const mesh of contours)this.view.draw(mesh);
  });
  this.labels.draw({...frame,referenceMm:this.model.referenceMm,model:this.model,showContext:true,showProbe:false});
 }
 dispose(){
  if(this.disposed)return;this.disposed=true;
  this.labels?.dispose();this.view?.dispose();this.meshes=[];
 }
}

/** Software anatomy uses the exact accepted CPU heart depth. Project in the
 * accepted pixel aspect, then map to CSS units so callout text stays readable
 * without moving anatomy when the heart uses a reduced interactive raster. */
class ReconstructionSoftwareContextLayer{
 constructor(renderer,modules,model,onError){this.renderer=renderer;this.modules=modules;this.model=model;this.onError=onError;}
 draw({context:ctx,basis,width,height,cssWidth=width,cssHeight=height,occlusion}){
  if(this.disposed||!occlusion?.data||occlusion.pending||occlusion.width!==width||occlusion.height!==height)return;
  const project=point=>{
   const p=this.modules.projectProbePoint(point.map(value=>value/this.model.referenceMm),basis,width,height);
   return p?{...p,x:p.x*cssWidth/width,y:p.y*cssHeight/height}:null;
  };
  ctx.save();ctx.setTransform(width/cssWidth,0,0,height/cssHeight,0,0);
  try{this.modules.paintTeeContextLabels(ctx,project,this.model,cssWidth,cssHeight,{fallback:true,occlusion});}
  finally{ctx.restore();}
 }
 dispose(){this.disposed=true;this.model=null;}
}

/** Main-workspace owner for the same fixed skeleton/GI context used by TEE.
 * Optional modules and the shared verified reference asset load on first use.
 * Workspace pauses detach only this layer; they never move the shared camera. */
export class ReconstructionAnatomyContext{
 constructor({renderer,donor,root=globalThis.document,toast=()=>{},onChange=()=>{}}){
  this.renderer=renderer;this.donor=donor||{};this.root=root;this.toast=toast;this.onChange=onChange;
  this.button=root?.querySelector?.('[data-anatomy-context-toggle]');
  this.controls=this.button?.closest?.('[data-anatomy-context-controls],[data-anatomy-context-control]');
  this.status=root?.querySelector?.('[data-anatomy-context-status]');
  this.supported=DONORS.some(item=>item.id===this.donor.id||String(item.datasetId)===String(this.donor.datasetId||this.donor.id));
  this.active=true;this.enabled=false;this.loading=false;this.epoch=0;
  this.click=()=>{void this.toggle();};this.button?.addEventListener('click',this.click);
  this.contextLost=()=>{
   this.lost=true;this.epoch++;this.abort?.abort();this.loading=false;this.enabled=false;
   this.detach();this.releaseLayer();this.savedView=null;this.framed=false;this.restorePending=false;
   this.sync();this.onChange();
  };
  renderer.canvas.addEventListener('webglcontextlost',this.contextLost);
  this.setVolume(null,renderer.meta);
 }
 unavailableReason(){
  if(this.destroyed)return 'Anatomy context is unavailable.';
  if(!this.supported)return 'Anatomy context is available for the three preserved-heart donors.';
  if(this.lost)return 'Reload the viewer to restore anatomy context after the graphics interruption.';
  const software=this.renderer.backend==='software'&&this.renderer.ctx&&typeof this.renderer.drawContextLayer==='function';
  if((!this.renderer.gl&&!software)||typeof this.renderer.setContextLayer!=='function')return 'Anatomy context is unavailable with this rendering backend.';
  if(!this.renderer.loaded||!this.referenceMm)return 'Load the heart reconstruction to show its anatomy context.';
  return '';
 }
 setVolume(_data,meta){
  if(this.destroyed)return;
  const referenceMm=referenceMmOf(meta);this.meta=meta;
  if(referenceMm!==this.referenceMm){
   this.epoch++;this.abort?.abort();this.loading=false;this.referenceMm=referenceMm;
   this.detach();this.releaseLayer();this.model=null;
   if(this.enabled&&this.active&&!this.unavailableReason())void this.prepare(false);
  }
  this.sync();
 }
 setWorkspaceActive(active){
  if(this.destroyed)return;
  this.active=Boolean(active);
  if(!this.active){this.frameOnReady=false;this.detach();}
  else{
   if(this.restorePending)this.restoreView();
   if(this.enabled&&!this.unavailableReason())void this.prepare(false);
  }
  this.sync();
 }
 sync(){
  if(!this.button)return;
  const unavailable=this.unavailableReason(),state=unavailable?'unavailable':this.error?'error':this.loading?'loading':this.enabled?'on':'off';
  this.button.dataset.anatomyContextState=state;
  this.button.setAttribute('aria-pressed',String(this.enabled));
  this.button.setAttribute('aria-busy',String(this.loading));
  this.button.disabled=Boolean(unavailable)||!this.active;
  this.button.classList.toggle('active',this.enabled);
  const label=this.button.querySelector('[data-anatomy-context-label]');
  if(label)label.textContent='Anatomy Context';
  this.button.title=unavailable||(this.error?'Anatomy context could not load. Select to retry.':this.loading?'Loading anatomy context… Select to cancel.':this.enabled?'Hide anatomy context and return to your previous view':'Show the skeleton, diaphragm and esophagus in anatomical orientation');
  this.button.setAttribute('aria-label',this.error?'Retry anatomy context':this.loading?'Cancel loading anatomy context':this.enabled?'Hide anatomy context':'Show anatomy context');
  if(this.controls)this.controls.hidden=!this.active;
  if(this.status){
   this.status.hidden=!this.enabled&&!this.error;
   this.status.textContent=this.error?'Anatomy context unavailable · Select to retry':this.loading?'Loading anatomy context…':'Reference anatomy · Approximate fit';
  }
 }
 async toggle(){
  if(!this.active||this.destroyed)return false;
  if(this.enabled){this.disable();return false;}
  const unavailable=this.unavailableReason();if(unavailable){this.toast(unavailable);return false;}
  this.epoch++;this.enabled=true;this.error=null;this.framed=false;
  this.savedView={camera:copyCamera(this.renderer.camera),autoRotate:this.renderer.autoRotate};
  this.sync();this.onChange();
  return this.prepare(true);
 }
 async prepare(frame){
  if(this.destroyed||!this.enabled||this.unavailableReason())return false;
  if(frame)this.frameOnReady=true;
  if(this.loading)return this.pending;
  if(this.model){
   try{this.attach();if(this.frameOnReady&&this.active)this.frameAnatomy();this.sync();return true;}
   catch(error){this.fail(error);return false;}
  }
  const epoch=this.epoch,referenceMm=this.referenceMm;
  const abort=this.abort=new AbortController();this.loading=true;this.sync();this.onChange();
  const current=()=>!this.destroyed&&this.enabled&&epoch===this.epoch&&referenceMm===this.referenceMm;
  const work=(async()=>{
   try{
    const modules=await loadModules();if(!current())return false;this.modules=modules;
    const referenceAnatomy=await modules.loadEchoReferenceAnatomy({signal:abort.signal});if(!current())return false;
    const base=modules.createTeeContextModel({referenceMm,donorId:this.donor.datasetId||this.donor.id});
    const fitted=modules.createEchoAnatomyContext({baseModel:base,referenceAnatomy});
    const bones=fitted.meshes.filter(mesh=>mesh.id==='bodyparts3d-bones'||mesh.id==='bodyparts3d-spine');
    const labels=fitted.labels.filter(label=>label.id.startsWith('bodyparts3d-'));
    this.model=Object.freeze({...fitted,meshes:Object.freeze([...base.meshes,...bones]),labels:Object.freeze([...base.labels,...labels])});
    if(this.active){this.attach();if(this.frameOnReady)this.frameAnatomy();}
    return true;
   }catch(error){
    if(current())this.fail(error);
    return false;
   }finally{
    if(epoch===this.epoch){this.loading=false;this.pending=null;this.sync();this.onChange();}
   }
  })();
  this.pending=work;return work;
 }
 attach(){
  if(!this.active||!this.enabled||!this.model||this.destroyed||this.unavailableReason())return;
  if(!this.layer){const Layer=this.renderer.gl?ReconstructionContextLayer:ReconstructionSoftwareContextLayer;this.layer=new Layer(this.renderer,this.modules,this.model,error=>this.fail(error));}
  this.renderer.setContextLayer(this.layer);
 }
 detach(){if(this.layer&&this.renderer.contextLayer===this.layer)this.renderer.setContextLayer(null);}
 releaseLayer(){this.layer?.dispose();this.layer=null;}
 frameAnatomy(){
  if(!this.model||!this.active||!this.enabled)return;
  const rect=this.renderer.canvas.getBoundingClientRect();
  const camera=this.modules.echoAnatomyCamera(this.model,rect.width/Math.max(1,rect.height));
  this.renderer.camera.distance=camera.distanceMm/this.referenceMm;
  this.renderer.alignPlane(camera.forward.map(value=>-value),camera.up,camera.targetMm.map(value=>value/this.referenceMm));
  this.framed=true;this.frameOnReady=false;
 }
 restoreView(){
  if(!this.savedView)return;
  if(!this.active){this.restorePending=true;return;}
  if(this.framed){
   this.renderer.camera=copyCamera(this.savedView.camera);this.renderer.autoRotate=this.savedView.autoRotate;
   this.renderer.requestRender('camera');
  }
  this.savedView=null;this.framed=false;this.restorePending=false;
 }
 disable(){
  this.epoch++;this.abort?.abort();this.loading=false;this.pending=null;this.enabled=false;this.frameOnReady=false;
  this.detach();this.restoreView();this.sync();this.onChange();
 }
 fail(error){
  if(this.destroyed)return;
  this.error=error;this.disable();this.releaseLayer();this.model=null;
  console.warn('Reconstruction anatomy context:',error);
  if(this.active)this.toast('Anatomy context could not load. Select Anatomy Context to retry.');
 }
 destroy(){
  if(this.destroyed)return;
  this.disable();this.destroyed=true;this.releaseLayer();this.model=null;
  this.button?.removeEventListener('click',this.click);
  this.renderer.canvas.removeEventListener('webglcontextlost',this.contextLost);
  this.sync();
 }
}
