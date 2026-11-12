/** Display-only cleanup and manually seeded anatomical regions. Original intensities stay intact. */
import {loadAnatomy} from './anatomy-data.js';
import {paintSectionPixels} from './section-paint.js';
import {scanActivity} from './download-priority.js';
import {getWindowPresets,matchWindowPreset} from './window-presets.js';
import {titleCaseUi} from './ui-text.js';

export const PALETTE_KEYS=['ivory','copper','grayscale','porcelain','contrast','anatomy','atlas'];
const $=id=>document.getElementById(id);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const DESCRIPTIONS={porcelain:'Warm ivory tissue, cool shadows, a quiet dark field.',contrast:'Bright tissue against deep, dark spaces. Adjust the threshold to reveal finer structures.',anatomy:'Colors follow source-guided chamber and vessel regions. Uncertain tissue remains neutral.',ivory:'A warm, softly shaded interpretation of scan intensity.',copper:'A warm copper interpretation of scan intensity.',grayscale:'Neutral grayscale for inspecting the measured structure.',atlas:'Soft rose and warm ivory with gentle, neutral shadows. An illustrative intensity palette inspired by Human Organ Atlas.'};

async function readMask(meta){
 const response=await fetch(meta.volumeUrl);if(!response.ok)throw new Error('Cleanup mask is unavailable.');
 let bytes=new Uint8Array(await response.arrayBuffer());
 if(bytes[0]===31&&bytes[1]===139)bytes=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
 if(bytes.length!==meta.dimensions.reduce((a,b)=>a*b,1))throw new Error('Cleanup mask size does not match its metadata.');
 return {data:bytes,dimensions:meta.dimensions,manifest:meta};
}

export class AppearanceController{
 constructor({renderer,onChange=()=>{},onCleanupChange=null,toast=()=>{},donor={}}){
  this.renderer=renderer;this.onChange=onChange;this.onCleanupChange=onCleanupChange;this.toast=toast;this.revision=0;this.colors=new Map();this.labels=new Map();
  this.donor=donor;
  if(donor.anatomyManifestUrl===null){
   $('anatomyToggle').disabled=true;$('anatomyToggle').title='Anatomical regions have not been assigned for this donor.';
   document.querySelectorAll('[data-material="anatomy"]').forEach(button=>{button.disabled=true;button.title='Anatomical regions have not been assigned for this donor.';});
   const option=$('palette')?.querySelector('option[value="anatomy"]');if(option){option.disabled=true;option.textContent='Anatomy · Unassigned';}
  }

  this.defaultWindow={windowEnabled:false,windowLow:0,windowHigh:1,windowGamma:1,capContrast:1.8,cutFaceExposure:1,...donor.displayWindow};
  this.renderWindowPresets();
  $('windowPresets')?.addEventListener('click',event=>{
   const button=event.target.closest('[data-window-preset]');if(!button)return;
   const preset=this.windowPresets.find(item=>item.id===button.dataset.windowPreset);if(!preset)return;
   renderer.set({...preset.settings});this.changed();
  });
  $('windowEnabled')?.addEventListener('change',()=>{renderer.set({windowEnabled:$('windowEnabled').checked});this.changed();});
  for(const key of ['windowLow','windowHigh','windowGamma'])$(''+key)?.addEventListener('input',()=>{
   const s=renderer.settings,value=Number($(key).value);if(!Number.isFinite(value))return;
   const patch={windowEnabled:true,[key]:value};
   if(key==='windowLow')patch.windowLow=Math.min(value,(s.windowHigh??1)-.005);
   if(key==='windowHigh')patch.windowHigh=Math.max(value,(s.windowLow??0)+.005);
   renderer.set(patch);this.changed();
  });
  $('resetWindow')?.addEventListener('click',()=>{renderer.set({...this.defaultWindow});this.changed();});
  $('cleanupEnabled').addEventListener('change',()=>this.setCleanupEnabled($('cleanupEnabled').checked));
  $('anatomyToggle').addEventListener('click',()=>{renderer.set({palette:renderer.settings.palette===5?4:5});this.changed();});
  $('anatomyOpacity').addEventListener('input',()=>{renderer.set({anatomyOpacity:+$('anatomyOpacity').value});this.changed();});
  $('anatomyAll').addEventListener('click',()=>{renderer.set({anatomySelected:0});this.changed();});
  $('anatomyLegend').addEventListener('click',event=>{const button=event.target.closest('[data-label-id]');if(!button)return;const id=+button.dataset.labelId;renderer.set({palette:5,anatomySelected:renderer.settings.anatomySelected===id?0:id});this.changed();});
  document.querySelectorAll('[data-material]').forEach(button=>button.addEventListener('click',()=>{renderer.set({palette:PALETTE_KEYS.indexOf(button.dataset.material)});this.changed();}));
  this.bindAnatomyPicking();
  this.sync();
 }
 bindAnatomyPicking(){
  const renderer=this.renderer,canvas=renderer.canvas,pointers=new Set();let down=null;
  const modified=event=>event.shiftKey||event.ctrlKey||event.altKey||event.metaKey;
  const clear=()=>{down=null;pointers.clear();};
  const track=event=>{
   if(!down||down.id!==event.pointerId)return;
   // Keep the entire gesture, including coalesced motion and a drag that ends
   // back at its starting point. Small click/tap jitter gets a 5 px allowance.
   for(const point of [...(event.getCoalescedEvents?.()||[]),event]){
    const distance=Math.hypot(point.clientX-down.x,point.clientY-down.y);
    down.distance+=distance;down.x=point.clientX;down.y=point.clientY;
    if(!Number.isFinite(distance)||down.distance>5)down.moved=true;
   }
  };
  canvas.addEventListener('pointerdown',event=>{
   const repeated=pointers.has(event.pointerId);pointers.add(event.pointerId);
   if(repeated||pointers.size!==1||event.button!==0||event.isPrimary===false||modified(event)||event.defaultPrevented||renderer.measurementPlacing||document.pointerLockElement||renderer.settings.palette!==5){down=null;return;}
   down={id:event.pointerId,x:event.clientX,y:event.clientY,distance:0,moved:false};
  });
  canvas.addEventListener('pointermove',event=>{
   track(event);
   if(down?.id===event.pointerId&&(modified(event)||event.buttons!==1))down.moved=true;
  });
  canvas.addEventListener('pointerup',event=>{
   track(event);const gesture=down?.id===event.pointerId?down:null;
   if(gesture)down=null;pointers.delete(event.pointerId);
   if(!gesture||gesture.moved||pointers.size||event.button!==0||event.isPrimary===false||modified(event)||event.defaultPrevented||renderer.measurementPlacing||document.pointerLockElement||renderer.settings.palette!==5||!renderer.inspectAt)return;
   const rect=canvas.getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width,y=(event.clientY-rect.top)/rect.height;
   if(!(rect.width>0&&rect.height>0)||!Number.isFinite(x+y)||x<0||x>1||y<0||y>1)return;
   const hit=renderer.inspectAt(x,y),candidate=this.labels.get(hit?.labelId),label=candidate?.id>0?candidate:null;
   const selected=label&&renderer.settings.anatomySelected!==label.id?label.id:0;
   renderer.set({anatomySelected:selected});this.describe(selected?label:null,!label&&!!hit);this.changed(false);
  });
  const cancel=event=>{pointers.delete(event.pointerId);if(down?.id===event.pointerId)down=null;};
  canvas.addEventListener('pointercancel',cancel);canvas.addEventListener('lostpointercapture',cancel);
  canvas.addEventListener('wheel',()=>{down=null;},{passive:true});
  // A second contact outside the canvas, cursor capture, or leaving the page
  // also ends a possible click; probe/native capture handlers keep ownership.
  document.addEventListener('pointerdown',event=>{if(down&&event.pointerId!==down.id)down=null;},true);
  document.addEventListener('pointerlockchange',()=>{if(document.pointerLockElement)clear();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clear();});
  document.defaultView?.addEventListener('blur',clear);
 }
 setCleanupEnabled(enabled){
  if(this.onCleanupChange)return this.onCleanupChange(enabled);
  this.renderer.set({cleanupEnabled:enabled});this.changed();
 }
 setWindowProfile(profile){
  this.defaultWindow={windowEnabled:false,windowLow:0,windowHigh:1,windowGamma:1,capContrast:1.8,cutFaceExposure:1,...profile};
  this.renderer.set({...this.defaultWindow});
  this.renderWindowPresets();
  this.sync();
 }
 renderWindowPresets(){
  this.windowPresetDonor={...this.donor,displayWindow:this.defaultWindow};
  this.windowPresets=getWindowPresets(this.windowPresetDonor);
  const mount=$('windowPresets');if(!mount)return;
  const fragment=document.createDocumentFragment();
  for(const preset of this.windowPresets){
   const button=document.createElement('button');button.type='button';button.dataset.windowPreset=preset.id;
   button.textContent=preset.label;button.title=preset.description;button.setAttribute('aria-pressed','false');
   fragment.append(button);
  }
  mount.replaceChildren(fragment);
 }
 async load(){
  if(this.cleanupPromise)return this.cleanupPromise;
  this.cleanupPromise=(async()=>{
   const release=scanActivity.beginForeground('cleanup');
   try{
    const response=await fetch(this.donor.cleanupManifestUrl||'./assets/cleanup/manifest.json');
    if(!response.ok)throw new Error('Cleanup metadata unavailable.');
    this.cleanup=await readMask(await response.json());this.renderer.setCleanupData(this.cleanup);
    $('cleanupEnabled').disabled=false;$('cleanupStatus').textContent='Detached fragments hidden · switch off to compare';
   }catch(error){console.warn(error);$('cleanupEnabled').disabled=true;$('cleanupStatus').textContent='Clean display loaded · optional support mask unavailable';}
   finally{release();}
   this.changed();
  })();
  return this.cleanupPromise;
 }
 async ensureAnatomy(){
  if(this.anatomy||this.anatomyPromise)return this.anatomyPromise;
  if(this.donor.anatomyManifestUrl===null){
   $('anatomyLoadStatus').textContent='Anatomical labels have not been reviewed for this donor.';
   return;
  }
  this.anatomyPromise=(async()=>{
   const release=scanActivity.beginForeground('anatomy');
   try{
    const anatomy=await loadAnatomy(this.donor.anatomyManifestUrl);
    const sourceId=String(anatomy.manifest.datasetId||anatomy.manifest.datasetUrl?.match(/\/datasets\/(\d+)/)?.[1]||'');
    if(this.donor.datasetId&&sourceId!==String(this.donor.datasetId))throw new Error('Anatomy labels belong to a different donor.');
    if(this.donor.specimen&&anatomy.manifest.specimen!==this.donor.specimen)throw new Error('Anatomy labels belong to a different donor.');
    this.anatomy=anatomy;
    this.renderer.setAnatomyData(this.anatomy);
    for(const label of this.anatomy.labels){this.labels.set(label.id,label);const hex=label.color.replace('#','');this.colors.set(label.id,[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)));}
    this.renderLegend();$('anatomyLoadStatus').textContent='Approximate regions · select a structure to emphasize it';this.changed();
   }catch(error){console.warn(error);this.anatomyPromise=null;$('anatomyLoadStatus').textContent='Anatomical regions could not load. Select Anatomy to retry.';}
   finally{release();}
  })();
  return this.anatomyPromise;
 }
 changed(updateDescription=true){this.revision++;this.sync();if(updateDescription)this.describe(this.renderer.settings.anatomySelected?this.labels.get(this.renderer.settings.anatomySelected):null);if(this.renderer.settings.palette===5)void this.ensureAnatomy();clearTimeout(this.changeTimer);this.changeTimer=setTimeout(()=>this.onChange(),65);}
 sync(){
  const settings=this.renderer.settings,key=PALETTE_KEYS[settings.palette]||'contrast',show=key==='anatomy';
  const presetId=matchWindowPreset(this.windowPresetDonor,settings),preset=this.windowPresets.find(item=>item.id===presetId);
  const presetStatus=$('windowPresetStatus'),presetDescription=$('windowPresetDescription');
  const status=preset?.label||'Custom settings',description=preset?.description||'Adjust the controls to tune this donor’s CT sections and cut faces.';
  if(presetStatus&&presetStatus.textContent!==status)presetStatus.textContent=status;
  if(presetDescription&&presetDescription.textContent!==description)presetDescription.textContent=description;
  if($('windowPresets')){
   $('windowPresets').dataset.activePreset=presetId;
   $('windowPresets').querySelectorAll('[data-window-preset]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.windowPreset===presetId)));
  }
  if($('windowEnabled'))$('windowEnabled').checked=!!settings.windowEnabled;
  if($('windowDonor'))$('windowDonor').textContent=(this.donor.specimen||'Current donor')+' · CT display';
  if($('windowStatus'))$('windowStatus').textContent=settings.windowEnabled?'Custom window active':'Window off · move a window slider to enable';
  if($('resetWindow'))$('resetWindow').setAttribute('aria-label','Reset brightness and window for '+(this.donor.specimen||'this donor'));
  if($('capContrast')){
   const value=settings.capContrast??1.8;$('capContrast').value=value;
   $('capContrast').setAttribute('aria-valuetext',Number(value).toFixed(2)+' times contrast');
   if($('capContrastValue'))$('capContrastValue').textContent=Number(value).toFixed(2)+'×';
  }
  if($('cutFaceExposure')){
   const value=settings.cutFaceExposure??1;$('cutFaceExposure').value=value;
   $('cutFaceExposure').setAttribute('aria-valuetext',Number(value).toFixed(2)+' times brightness');
   if($('cutFaceExposureValue'))$('cutFaceExposureValue').textContent=Number(value).toFixed(2)+'×';
  }
  for(const name of ['windowLow','windowHigh','windowGamma'])if($(name)){
   // Sliders remain usable when the custom window is off; editing one enables it.
   const value=settings[name]??(name==='windowLow'?0:1);$(name).value=value;$(name).disabled=false;
   const range=this.donor.sourceWindow;
   const label=name==='windowGamma'?Number(value).toFixed(2):range?Math.round(range[0]+value*(range[1]-range[0])).toLocaleString('en-US'):Math.round(value*100)+'%';
   $(name).setAttribute('aria-valuetext',label+(name==='windowGamma'?' gamma':range?' scan intensity':''));
   if($(name+'Value'))$(name+'Value').textContent=label;
  }
  if($('palette'))$('palette').value=key;
  $('materialDescription').textContent=DESCRIPTIONS[key];$('cleanupEnabled').checked=settings.cleanupEnabled!==false;
  $('anatomyToggle').setAttribute('aria-pressed',String(show));$('anatomyControls').hidden=!show;
  $('anatomyOpacity').value=settings.anatomyOpacity??.65;$('anatomyOpacityValue').textContent=Math.round((settings.anatomyOpacity??.65)*100)+'%';
  $('anatomyAll').setAttribute('aria-pressed',String(!settings.anatomySelected));
  document.querySelectorAll('[data-material]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.material===key)));
  $('anatomyLegend').querySelectorAll('[data-label-id]').forEach(button=>button.setAttribute('aria-pressed',String(+button.dataset.labelId===settings.anatomySelected)));
  const tag=$('displayModeBadge');if(tag){tag.hidden=!show;tag.textContent='Approximate Anatomy';}
 }
 renderLegend(){
  const fragment=document.createDocumentFragment();
  for(const label of this.anatomy.labels){if(!label.id)continue;const button=document.createElement('button');button.type='button';button.className='anatomy-legend-item';button.dataset.labelId=label.id;button.setAttribute('aria-pressed','false');
   const dot=document.createElement('i');dot.style.backgroundColor=label.color;dot.setAttribute('aria-hidden','true');
   const name=document.createElement('span');name.textContent=titleCaseUi(label.name);
   const confidence=document.createElement('small');confidence.textContent=label.confidence||'Approximate';
   button.append(dot,name,confidence);fragment.append(button);
  }
  $('anatomyLegend').replaceChildren(fragment);
 }
 describe(label,hit=false){
  $('anatomySelectionName').textContent=titleCaseUi(label?.name||(hit?'Unclassified tissue':'Reading the colors'));
  $('anatomySelectionDetail').textContent=label?.description||'Colors indicate approximate chamber-associated tissue and proximal vessel regions. Unclassified tissue stays neutral. Select a color or click a region to emphasize it; click it again or click empty space to show all colors.';
  $('anatomySelectionConfidence').textContent=label?`${label.confidence||'Approximate'} · boundaries are estimated`:'Source-guided contours and anatomical landmarks';
 }
 sample(map,x,y,z){
  if(!map)return 0;const [nx,ny,nz]=map.dimensions;const ix=Math.round(clamp(x,0,1)*(nx-1)),iy=Math.round(clamp(y,0,1)*(ny-1)),iz=Math.round(clamp(z,0,1)*(nz-1));return map.data[ix+nx*(iy+ny*iz)];
 }
 /** Apply the same support mask and optional region colors to an orthogonal image. */
 paintSection(canvas,data,width,height,axis,position,section={width,height}){
  if(canvas.width!==width)canvas.width=width;if(canvas.height!==height)canvas.height=height;
  this.sectionPaintTargets??=new WeakMap();let target=this.sectionPaintTargets.get(canvas);
  if(!target){
   target={context:canvas.getContext('2d')};
   this.sectionPaintTargets.set(canvas,target);
  }
  const bytes=width*height*4;
  // Cropped sections change shape often. Keep one high-water backing buffer,
  // with <64 KiB spare, while each ImageData/canvas retains its exact dimensions.
  if(!target.buffer||target.buffer.length<bytes)target.buffer=new Uint8ClampedArray(Math.ceil(bytes/65536)*65536);
  if(target.width!==width||target.height!==height){
   target.width=width;target.height=height;
   target.image=new ImageData(new Uint8ClampedArray(target.buffer.buffer,0,bytes),width,height);
  }
  paintSectionPixels(data,width,height,axis,position,section,this.renderer.settings,this.cleanup,this.anatomy,target.image.data);
  target.context.putImageData(target.image,0,0);return canvas;
 }
}
