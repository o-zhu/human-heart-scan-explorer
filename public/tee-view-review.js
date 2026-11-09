import {TEE_ATLAS_VIEWS} from './tee-atlas-data.js';
import {isEchoPlaneModified} from './echo-correspondence.js';

export const TEE_REGIONAL_REVIEW_ID='tee-regional-sanity-v3';
export const TEE_REGIONAL_REVIEW_DATASET='1659197537';
const vector=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const statuses=new Set(['supported','partial','unsupported','outside']);
export const teeReviewStatusText=status=>({supported:'Regional match reviewed',partial:'Partial CT target',unsupported:'Named target unconfirmed',outside:'Target outside scan'}[status]||'CT correspondence unverified');

export function validateTeeRegionalReview(input){
 if(input?.id!==TEE_REGIONAL_REVIEW_ID||String(input?.datasetId)!==TEE_REGIONAL_REVIEW_DATASET||input.clinicalRegistrationValidated!==false||input.expertValidated!==false)throw new Error('TEE regional review has an unsupported source or validation claim.');
 if(!input.views||Object.keys(input.views).length!==TEE_ATLAS_VIEWS.length)throw new Error('TEE regional review is incomplete.');
 const views={};
 for(const view of TEE_ATLAS_VIEWS){
  const item=input.views[view.id],outside=view.aseNumber>=25;
  if(!item||!statuses.has(item.status)||outside!==(item.status==='outside')||item.aseNumber!==view.aseNumber||typeof item.summary!=='string'||item.summary.length<20)throw new Error(`Invalid TEE regional evidence: ${view.id}.`);
  for(const key of ['visibleRegions','targetRegions','remainingLimits'])if(!Array.isArray(item[key])||!item[key].every(x=>typeof x==='string'))throw new Error(`Invalid TEE regional findings: ${view.id}.`);
  const frame=item.reviewedFrame;
  if(!outside&&(!frame||!['center','right','up','normal'].every(k=>vector(frame[k]))||!['width','height'].every(k=>Number.isFinite(frame[k])&&frame[k]>.05&&frame[k]<2.5)))throw new Error(`Missing reviewed TEE raster: ${view.id}.`);
  const anchors=item.regionAnchors||[];
  for(const anchor of anchors){
   if(!Number.isInteger(anchor.regionId)||anchor.regionId<1||anchor.regionId>6||typeof anchor.text!=='string'||!vector(anchor.world)||!Array.isArray(anchor.normalizedXY)||anchor.normalizedXY.length!==2||!anchor.normalizedXY.every(x=>Number.isFinite(x)&&x>=0&&x<=1)||!Number.isInteger(anchor.sourceValue)||anchor.sourceValue<=0||anchor.sourceValue>255||outside)throw new Error(`Invalid source-tissue anchor: ${view.id}.`);
   const [x,y]=anchor.normalizedXY,world=frame.center.map((v,i)=>v+(x-.5)*frame.width*frame.right[i]+(.5-y)*frame.height*frame.up[i]);
   if(world.some((v,i)=>Math.abs(v-anchor.world[i])>2e-6))throw new Error(`Source-tissue anchor does not match its reviewed raster: ${view.id}.`);
  }
  views[view.id]={...item,regionAnchors:anchors.map(a=>({...a,world:[...a.world],normalizedXY:[...a.normalizedXY]}))};
 }
 return {...input,views};
}

/** Anatomical findings apply only to the exact source-reviewed presentation.
 * A prior frame, another donor, or a moved section never inherits them. */
export function reviewedTeeEvidence(catalog,{id,donor,state,plane,outsideScan=false}={}){
 if(String(donor?.datasetId)!==TEE_REGIONAL_REVIEW_DATASET||donor.geometricComparisonOnly||state?.mode!=='tee'||isEchoPlaneModified(state))return null;
 const item=catalog?.views[id];if(!item)return null;
 if(item.status==='outside')return outsideScan?item:null;
 if(state.planeReference!=='refined'||!plane)return null;
 const frame=item.reviewedFrame;
 if(['center','right','up','normal'].some(k=>!vector(plane[k])||plane[k].some((x,i)=>Math.abs(x-frame[k][i])>2e-6))||['width','height'].some(k=>!Number.isFinite(plane[k])||Math.abs(plane[k]-frame[k])>2e-6))return null;
 return item;
}

/** Callouts identify measured tissue ownership, never a cavity or valve. */
export function paintTeeTissueAnchors(context,anchors,width,height,{flip=false}={}){
 const scale=width/600,pad=10*scale,font=14*scale;
 context.save();context.font=`500 ${font}px system-ui`;context.textBaseline='middle';
 for(const anchor of anchors){
  const x=(flip?1-anchor.normalizedXY[0]:anchor.normalizedXY[0])*width,y=anchor.normalizedXY[1]*height;
  const tw=context.measureText(anchor.text)?.width||anchor.text.length*font*.56,bw=tw+16*scale,bh=25*scale;
  const bx=Math.max(pad,Math.min(width-bw-pad,x+(x<width*.5?24*scale:-bw-24*scale))),by=Math.max(pad,Math.min(height-bh-pad,y-31*scale));
  context.strokeStyle='rgba(241,228,207,.92)';context.lineWidth=1.1*scale;context.beginPath();context.moveTo(x,y);context.lineTo(bx+(x<width*.5?0:bw),by+bh*.7);context.stroke();
  context.fillStyle='rgba(6,16,20,.92)';context.fillRect(bx,by,bw,bh);context.strokeStyle='rgba(188,204,198,.55)';context.strokeRect(bx,by,bw,bh);
  context.fillStyle='#f3e8d9';context.beginPath();context.arc(x,y,2.7*scale,0,Math.PI*2);context.fill();context.fillText(anchor.text,bx+8*scale,by+bh/2);
 }
 context.restore();
}

let pending;
export function loadTeeRegionalReview(){
 if(!pending)pending=fetch(new URL('./assets/tee-atlas/regional-review-v3.json',import.meta.url),{priority:'low'}).then(r=>{if(!r.ok)throw new Error('TEE regional evidence is unavailable.');return r.json();}).then(validateTeeRegionalReview).catch(error=>{pending=null;throw error;});
 return pending;
}
