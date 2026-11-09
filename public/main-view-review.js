import {add,mul,norm,dot,cross} from './planes.js';

export const MAIN_VIEW_REVIEW_VERSION='main-view-qc-v3';
export const MAIN_VIEW_REVIEW_DATASET='1659197537';
const ids=['rv-inflow','rv-outflow','lv-inflow','lv-outflow','ra-inflow','ra-outflow','la-inflow','la-outflow'];
const vector=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const copyWorld=w=>Object.fromEntries(Object.entries(w).map(([k,v])=>[k,Array.isArray(v)?[...v]:v]));
const close=(a,b,tolerance=1e-8)=>a.length===b.length&&a.every((v,i)=>Math.abs(v-b[i])<=tolerance);

export function validateMainViewReview(input){
 if(String(input?.datasetId)!==MAIN_VIEW_REVIEW_DATASET||input?.specimen!=='LADAF-2021-17'||input?.version!==MAIN_VIEW_REVIEW_VERSION)throw new Error('Starting-view review belongs to another source.');
 if(!input.views||Object.keys(input.views).length!==ids.length||ids.some(id=>!input.views[id]))throw new Error('Starting-view review is incomplete.');
 const views={};
 for(const id of ids){
  const item=input.views[id],w=item.world;
  if(w){
   if(!['center','target','right','up','normal'].every(k=>vector(w[k]))||w.center.some(x=>Math.abs(x)>1.5)||w.target.some(x=>Math.abs(x)>1.5))throw new Error(`Invalid starting-view frame: ${id}.`);
   if(['right','up','normal'].some(k=>Math.abs(Math.hypot(...w[k])-1)>.002)||Math.abs(dot(w.right,w.up))>.002||dot(cross(w.right,w.up),w.normal)<.998)throw new Error(`Invalid starting-view orientation: ${id}.`);
   if(!['width','height'].every(k=>Number.isFinite(w[k])&&w[k]>.05&&w[k]<2.5)||Math.abs(dot(w.center.map((v,i)=>v-w.target[i]),w.normal))>1e-5)throw new Error(`Invalid starting-view field: ${id}.`);
  }
  if(item.fitBounds&&(!vector(item.fitBounds.min)||!vector(item.fitBounds.max)||item.fitBounds.min.some((x,i)=>x>=item.fitBounds.max[i]||Math.abs(x)>1.5)||item.fitBounds.max.some(x=>Math.abs(x)>1.5)))throw new Error(`Invalid starting-view bounds: ${id}.`);
  if(item.fitPoints)for(const key of ['overview','section','flippedOverview','flippedSection']){
   const points=item.fitPoints[key];if(!Array.isArray(points)||points.length<4||points.length>96||points.some(p=>!vector(p)||p.some(x=>Math.abs(x)>1.5)))throw new Error(`Invalid starting-view support points: ${id}.`);
  }
  if(item.overviewTarget&&!vector(item.overviewTarget))throw new Error(`Invalid overview target: ${id}.`);
  if(item.cameraOffset&&['right','up'].some(k=>!Number.isFinite(item.cameraOffset[k])||Math.abs(item.cameraOffset[k])>1))throw new Error(`Invalid overview angle: ${id}.`);
  for(const key of ['cameraDistance','closeDistance'])if(item[key]!==undefined&&!(Number.isFinite(item[key])&&item[key]>.05&&item[key]<5))throw new Error(`Invalid starting-view distance: ${id}.`);
  if(typeof item.summary!=='string'||item.summary.length<12||!Array.isArray(item.remainingLimits))throw new Error(`Missing starting-view review: ${id}.`);
  views[id]={...item,world:w?copyWorld(w):undefined,remainingLimits:item.remainingLimits.filter(x=>typeof x==='string')};
 }
 return {...input,views};
}

/** A texture may be reused only with the identical displayed sampling rectangle.
 * Camera/retained-half changes alone do not change that measured rectangle. */
export function sameStartingRaster(a,b){
 return ['center','right','up'].every(k=>vector(a?.[k])&&vector(b?.[k])&&close(a[k],b[k]))&&['width','height'].every(k=>Number.isFinite(a?.[k])&&Math.abs(a[k]-b[k])<=1e-8);
}

export function applyMainViewReview(presets,catalog,donor){
 if(!catalog||donor?.geometricComparisonOnly||String(donor?.datasetId)!==MAIN_VIEW_REVIEW_DATASET||String(catalog.datasetId)!==String(donor.datasetId))return presets;
 return presets.map(p=>{
  const item=catalog.views[p.id];if(!item)return p;
  const world=item.world?copyWorld(item.world):copyWorld(p.world),sameRaster=sameStartingRaster(world,p.world);
  return {...p,world,review:item,reviewVersion:catalog.version,texture:sameRaster?p.texture:undefined,
   cameraDistance:item.cameraDistance??p.cameraDistance,closeDistance:item.closeDistance??p.closeDistance,
   flip:item.flip??p.flip,fitBounds:item.fitBounds,fitPoints:item.fitPoints,overviewTarget:item.overviewTarget,cameraOffset:item.cameraOffset,
   subtitle:item.subtitle||p.subtitle,description:item.summary,note:item.remainingLimits.join(' ')};
 });
}

/** Fit the retained measured support, including depth, at the actual viewport
 * aspect. Reserve space around it for the existing heading and controls. */
export function reviewedStartingCamera(preset,plane,{view='overview',flip=false,aspect=1}={}){
 const side=flip?-1:1,offset=preset.cameraOffset||{right:.24,up:.10};
 let normal=mul(plane.normal,side),up=plane.up;
 if(view!=='section')normal=norm(add(normal,add(mul(plane.right,offset.right*side),mul(plane.up,offset.up))));
 up=norm(add(up,mul(normal,-dot(normal,up))));
 const target=view==='close'?plane.target:(preset.overviewTarget||plane.target),forward=mul(normal,-1),right=norm(cross(forward,up));
 let distance=view==='close'?preset.closeDistance:preset.cameraDistance;
 if(view!=='close'&&(preset.fitBounds||preset.fitPoints)){
  distance=.1;const ratio=Math.max(.2,Number(aspect)||1),b=preset.fitBounds,flipped=Boolean(flip)!==Boolean(preset.flip);
  const key=view==='section'?(flipped?'flippedSection':'section'):(flipped?'flippedOverview':'overview');
  const points=preset.fitPoints?.[key]||Array.from({length:8},(_,mask)=>b.min.map((v,i)=>(mask>>i)&1?b.max[i]:v));
  for(const point of points){
   const q=point.map((v,i)=>v-target[i]),depth=dot(q,forward);
   distance=Math.max(distance,Math.abs(dot(q,right))/(.32*ratio*.84)-depth,Math.abs(dot(q,up))/(.32*.76)-depth);
  }
 }
 return {normal,up,target:[...target],distance};
}

let pending;
export function loadMainViewReview(){
 if(!pending)pending=fetch(new URL('./assets/main-view-qc-v3.json',import.meta.url),{priority:'high'}).then(r=>{if(!r.ok)throw new Error('Starting-view review is unavailable.');return r.json();}).then(validateMainViewReview).catch(error=>{pending=null;throw error;});
 return pending;
}
