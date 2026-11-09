import {TEE_ATLAS_VIEWS} from './tee-atlas-data.js';
import {dot,cross} from './planes.js';

export const TEE_REFINEMENT_DATASET='1659197537';
const allowed=new Set(TEE_ATLAS_VIEWS.filter(v=>v.aseNumber<25).map(v=>v.id));
const vector=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const copyFrame=f=>({...f,center:[...f.center],right:[...f.right],up:[...f.up],normal:[...f.normal]});

/** A fitted plane is a new measured reformat, never a relabelled cached image.
 * The source donor, right-handed display basis and field of view are checked
 * before any override is exposed. Original source frames remain untouched. */
export function validateTeeRefinements(input){
 if(String(input?.datasetId)!==TEE_REFINEMENT_DATASET||!input?.views)throw new Error('TEE plane review belongs to an unsupported source scan.');
 const views={};
 for(const [id,item] of Object.entries(input.views)){
  if(!allowed.has(id))throw new Error(`TEE plane review cannot override ${id}.`);
  const f=item?.frame;
  if(!f||!['center','right','up','normal'].every(k=>vector(f[k])))throw new Error(`Invalid reviewed plane: ${id}.`);
  if(f.center.some(x=>Math.abs(x)>1.5)||!['width','height'].every(k=>Number.isFinite(f[k])&&f[k]>.05&&f[k]<2.5))throw new Error(`Invalid reviewed field of view: ${id}.`);
  if(['right','up','normal'].some(k=>Math.abs(Math.hypot(...f[k])-1)>.002)||Math.abs(dot(f.right,f.up))>.002||dot(cross(f.right,f.up),f.normal)<.998||f.displayMirrorX||f.displayRotate180)throw new Error(`Reviewed plane must use a right-handed display basis: ${id}.`);
  views[id]={...item,frame:copyFrame(f),remainingLimits:Array.isArray(item.remainingLimits)?item.remainingLimits.filter(x=>typeof x==='string'):[]};
 }
 return {...input,views};
}

export function applyTeeRefinements(frames,catalog,{datasetId,geometricComparisonOnly=false,useRefinement=true}={}){
 const output={...frames};
 if(!useRefinement||geometricComparisonOnly||String(datasetId)!==TEE_REFINEMENT_DATASET||String(catalog?.datasetId)!==String(datasetId))return output;
 for(const [id,item] of Object.entries(catalog.views)){
  if(!output[id]||output[id].outsideScan)continue;
  output[id]={...output[id],...copyFrame(item.frame),displayMirrorX:false,displayRotate180:false,atlasDerived:true,refinement:item,note:item.summary||output[id].note};
 }
 return output;
}

let pending;
export function loadTeeRefinements(){
 if(!pending)pending=fetch(new URL('./assets/tee-atlas/plane-fit-v2.json',import.meta.url),{priority:'low'})
  .then(r=>{if(!r.ok)throw new Error('TEE plane review is unavailable.');return r.json();})
  .then(validateTeeRefinements).catch(error=>{pending=null;throw error;});
 return pending;
}
