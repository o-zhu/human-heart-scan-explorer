/** TEE atlas reference placement. Clinical acquisition angles are references;
 * these specimen planes are explicitly approximate, never a registered TEE.
 * Source frame arrays and measured voxels remain immutable.
 */
import {add,mul,dot,cross,norm} from './planes.js';
import {rotateVector,projectProbePoint,probePhysicalScale} from './probe-geometry.js';
import {TeeSceneOverlay,paintTeeFallback,paintTeeContextLabels} from './tee-scene.js';
import {teeContextToLocal} from './tee-context-geometry.js';
import {depthPointVisible} from './tee-software-depth.js';
import {contextLabelMetrics} from './echo-context-presentation.js';

const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const radians=x=>x*Math.PI/180;
const sourcePoint=([x,y,z])=>[(x-237)/529,(z-264.5)/529,(237-y)/529];
const unit=(v,fallback=[1,0,0])=>Math.hypot(...v)>1e-9?norm(v):fallback;
const orthogonal=(v,axis)=>unit(sub(v,mul(axis,dot(v,axis))));
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const angleBetween=(a,b)=>Math.acos(clamp(dot(unit(a),unit(b)),-1,1))*180/Math.PI;
const levelLabel=level=>({'ue':'Upper esophagus','me':'Midesophageal','le':'Lower esophagus','junction':'Gastroesophageal junction','tg':'Transgastric','deep-tg':'Deep transgastric'}[level]||'Illustrative tract');
function frame(center,right,up,width=.78,height=.88,note='Approximate source-landmark plane; clinical correspondence has not been validated.'){
 up=unit(up);right=orthogonal(right,up);
 return {center:[...center],right,up,normal:unit(cross(right,up)),width,height,note,atlasDerived:true};
}
function shifted(base,{center=base.center,rotate=0,tilt=0,width=base.width,height=base.height}={}){
 const right=rotateVector(base.right,base.up,radians(rotate));
 return frame(center,right,rotateVector(base.up,right,radians(tilt)),width,height);
}

/** Per-view fitting starts from this donor's own reference planes. Only LADAF
 * has source-reviewed regional landmarks. Other donors get geometric targets,
 * keeping their existing unassigned clinical correspondence explicit. */
export function buildTeeAtlasFrames(existing,views,{geometricComparisonOnly=false,flowFrames={}}={}){
 const result={...existing},me=existing.me4c,tg=existing.tgpapillary;
 if(!me||!tg)return result;
 const presented=base=>({...base,right:mul(base.right,!!base.displayMirrorX!==!!base.displayRotate180?-1:1),up:mul(base.up,base.displayRotate180?-1:1),displayMirrorX:false,displayRotate180:false});
 const f4=presented(me),f2=presented(existing.me2c||me),lax=presented(existing.melax||me),bic=presented(existing.bicaval||me),tgp=presented(tg);
 const axis=unit(mul(f4.up,-1)),baseCenter=add(f4.center,mul(axis,-.16));
 const at=(n,base,opts={})=>{const view=views.find(v=>v.aseNumber===n);if(view)result[view.id]=shifted(base,opts);};
 at(1,f4,{rotate:12,center:add(f4.center,mul(f4.up,.035))});
 at(3,f2,{rotate:-30});
 at(6,lax,{center:add(lax.center,mul(lax.up,.18)),width:.58,height:.65});
 at(7,lax,{center:add(lax.center,mul(lax.up,.31)),rotate:-25,width:.56,height:.62});
 at(8,tg,{center:add(baseCenter,mul(axis,-.18)),rotate:15,width:.65,height:.65});
 at(9,bic,{center:add(bic.center,mul(f4.right,.09)),rotate:-65,width:.62,height:.62});
 at(11,f4,{center:add(f4.center,mul(f4.right,-.10)),rotate:55,width:.78,height:.82});
 at(12,bic,{rotate:-30,center:add(bic.center,mul(axis,.06))});
 at(14,bic,{rotate:20,center:add(bic.center,mul(axis,-.05))});
 at(15,f2,{center:add(f2.center,add(mul(f4.up,.22),mul(f4.right,.12))),rotate:-5,width:.60,height:.60});
 at(16,tgp,{center:baseCenter,width:.67,height:.67});
 at(18,tgp,{center:add(tg.center,mul(axis,.14)),width:.62,height:.62});
 at(19,tgp,{center:add(baseCenter,mul(f4.right,-.12)),width:.67,height:.67});
 at(20,f4,{center:add(f4.center,mul(f4.right,-.13)),rotate:60,tilt:50,width:.76,height:.78});
 at(21,f4,{center:add(f4.center,mul(axis,.08)),rotate:12,tilt:170});
 at(22,f2,{center:add(f2.center,mul(axis,.10)),tilt:155});
 at(23,bic,{center:add(f4.center,mul(f4.right,-.13)),tilt:155});
 at(24,lax,{center:add(lax.center,mul(axis,.07)),tilt:155});

 if(!geometricComparisonOnly){
  // Published source-review anchors, in the original s4 voxel-center grid.
  const av=sourcePoint([260,265,270]),aa=sourcePoint([193.5,241.5,163.3456]);
  const aorticUp=unit(sub(aa,av));
  const rvIn=flowFrames['rv-inflow'],rvOut=flowFrames['rv-outflow'],lvOut=flowFrames['lv-outflow'],laIn=flowFrames['la-inflow'];
  if(lvOut){
   at(6,lvOut,{center:av,width:.64,height:.67});
   // Both aortic anchors lie in this LAX plane; keep the vessel horizontal
   // as in the clinical view and keep the near-field side closest to LVOT up.
   const aorticLax=frame(mul(add(av,aa),.5),mul(aorticUp,-1),orthogonal(lvOut.up,aorticUp),.65,.69);
   at(7,aorticLax);
  }
  const sax=frame(av,orthogonal(f4.right,aorticUp),unit(cross(aorticUp,f4.right)),.64,.64);
  const avSax=views.find(v=>v.aseNumber===10);if(avSax)result[avSax.id]=sax;
  at(8,sax,{center:aa,width:.66,height:.66});
  if(rvIn){at(11,rvIn,{rotate:24});at(12,rvIn,{rotate:-15});at(23,rvIn,{tilt:155});}
  if(rvOut)at(20,rvOut,{tilt:135});
  if(laIn){at(9,laIn,{rotate:-30,center:sourcePoint([300,233,190]),width:.66,height:.66});at(15,laIn,{rotate:15,center:sourcePoint([322,302,190]),width:.64,height:.64});}
 }
 // The excised heart does not contain a continuous thoracic aorta or arch.
 // These poses provide spatial context only; no CT section is claimed there.
 const upper=add(baseCenter,mul(axis,-.34)),posterior=add(baseCenter,mul(f4.right,.38));
 at(25,tg,{center:posterior,width:.60,height:.60});
 at(26,f2,{center:posterior,width:.60,height:.78});
 at(27,f4,{center:upper,width:.86,height:.62});
 at(28,tg,{center:upper,rotate:80,width:.72,height:.72});
 for(const v of views){if(!result[v.id])result[v.id]=shifted(f4);if(v.aseNumber>=25)result[v.id]={...result[v.id],outsideScan:true};}
 return result;
}

/** The transducer lies in the exact currently displayed plane. A clinical
 * target angle is applied inversely to the head frame, so rotating the image
 * basis does not falsely rotate the instrument itself. Shaft routing remains
 * an authored guide, with no segmented esophageal registration. */
export function atlasProbePose(plane,view,referenceMm){
 const scale=probePhysicalScale(referenceMm),beam=mul(unit(plane.up),-1),right=unit(plane.right);
 const angle=Number(view?.angleDefault)||0;
 const originMm=mul(add(plane.center,mul(plane.up,Math.min(plane.height*.53,.44))),referenceMm);
 const mechanicalRight=unit(rotateVector(right,beam,-radians(angle)));
 const shaft=unit(mul(cross(beam,mechanicalRight),-1));
 const shaftPoints=[];
 for(let i=0;i<=48;i++){
  const t=1-i/48,back=72*scale*t,bend=14*scale*t*t;
  shaftPoints.push(add(originMm,add(mul(shaft,-back),mul(beam,-bend))));
 }
 return {originMm,beam,right,normal:unit(cross(beam,right)),up:mul(beam,-1),shaftPoints,referenceMm,targetMm:mul(plane.center,referenceMm),
  instrument:{originMm,right:mechanicalRight,beam,shaft,normal:mul(shaft,-1)},multiplaneDeg:angle,
  sectorDepthMm:plane.height*referenceMm*1.03};
}

function routedAtlasShaft(contextModel,sample,index,originMm,shaft,scale){
 const endArc=Math.max(0,sample.arcMm-24*scale),proximal=contextModel.tractSamples.filter(s=>s.arcMm<=endArc).map(s=>s.pointMm);
 const start=proximal.at(-1)||contextModel.tractSamples[0].pointMm,tangent=contextModel.tractSamples[Math.max(0,index-10)].tangent;
 const p1=add(start,mul(tangent,12*scale)),p2=add(originMm,mul(shaft,-10*scale)),shaftPoints=[...proximal];
 for(let i=0;i<=24;i++){const t=i/24,q=1-t;shaftPoints.push(add(add(mul(start,q*q*q),mul(p1,3*q*q*t)),add(mul(p2,3*q*t*t),mul(originMm,t*t*t))));}
 return shaftPoints;
}

/** Try the established geometric fit without changing the reviewed CT plane.
 * The result may be outside the authored organ; only a resolved result may
 * be presented as a plane-coincident estimate. Unresolved results are retained
 * as diagnostics and replaced by an honest, tract-constrained estimate below. */
function fitAtlasProbeToPlane(plane,view,referenceMm,contextModel){
 const pose=atlasProbePose(plane,view,referenceMm);if(!contextModel?.tractSamples?.length)return pose;
 const c=mul(plane.center,referenceMm),n=unit(plane.normal||cross(plane.right,plane.up)),scale=probePhysicalScale(referenceMm);
 const group=view?.group,levels=group==='tg'?['junction','tg','deep-tg']:group==='aortic'?['ue','me']:['me','le'];
 const candidates=group==='tg'&&contextModel.gastricInteriorSamples?.length?contextModel.gastricInteriorSamples:contextModel.tractSamples;
 let best=null;
 for(const [index,s] of candidates.entries()){
  if(!levels.includes(s.level))continue;
  const delta=s.pointMm.map((x,i)=>x-c[i]),residual=dot(delta,n),distance=Math.hypot(...delta);
  const headCenter=add(s.pointMm,mul(n,-residual)),beam=unit(sub(c,headCenter)),origin=add(headCenter,mul(beam,3*scale)),right=unit(cross(n,beam)),mechanicalRight=unit(rotateVector(right,beam,-radians(pose.multiplaneDeg))),shaft=unit(mul(cross(beam,mechanicalRight),-1));
  // Either normal sign describes the same physical section. Choose the
  // presentation sign that avoids routing the head backwards up the tract.
  const alignment=dot(shaft,s.tangent),sign=alignment<0?-1:1,bendDeg=Math.acos(Math.min(1,Math.abs(alignment)))*180/Math.PI;
  const clearance=s.radialClearanceHintMm??5.5*scale,projectionLimit=Math.max(.5*scale,clearance-3.3*scale);
  const approachAngleDeg=Math.acos(Math.max(-1,Math.min(1,dot(beam,mul(plane.up,-1)))))*180/Math.PI,nearFieldMm=dot(sub(origin,c),plane.up);
  // Deep TG requires an apical approach. A lateral gastric intersection alone
  // cannot substantiate its characteristic apex-to-outflow insonation.
  const needsApical=view?.id==='deeptg5c',approachResolved=!needsApical||(approachAngleDeg<=40&&nearFieldMm>=20*scale);
  const approachPenalty=needsApical?1000*((Math.max(0,approachAngleDeg-40)*scale)**2+Math.max(0,20*scale-nearFieldMm)**2):0;
  const overshoot=Math.max(0,Math.abs(residual)-projectionLimit),cost=residual*residual+.004*(distance-55*scale)**2+.0008*(bendDeg*scale)**2+1000*overshoot*overshoot+approachPenalty;
  if(!best||cost<best.cost)best={index:s.pathIndex??index,s,residual,cost,origin,beam,right:mul(right,sign),mechanicalRight:mul(mechanicalRight,sign),shaft:mul(shaft,sign),normal:mul(n,sign),bendDeg,clearance,projectionLimit,sign,approachAngleDeg,nearFieldMm,approachResolved};
 }
 if(!best)return pose;
 const {origin:originMm,beam,right,mechanicalRight,shaft}=best;
 const shaftPoints=routedAtlasShaft(contextModel,best.s,best.index,originMm,shaft,scale);
 const distance=Math.hypot(...c.map((x,i)=>x-originMm[i]));
 const resolved=Math.abs(best.residual)<=Math.min(best.projectionLimit,(group==='tg'?12:7)*scale)&&view?.aseNumber<25&&best.approachResolved;
 return {...pose,originMm,beam,right,up:mul(beam,-1),normal:best.normal,shaftPoints,instrument:{originMm,beam,right:mechanicalRight,shaft,normal:mul(shaft,-1)},sectorDepthMm:Math.max(pose.sectorDepthMm,distance+plane.height*referenceMm*.45),contextFit:{distanceMm:Math.abs(best.residual),insertionCm:best.s.insertionCm,level:best.s.level,shaftBendDeg:best.bendDeg,clearanceHintMm:best.clearance,projectionLimitMm:best.projectionLimit,presentationReflected:best.sign<0,approachAngleDeg:best.approachAngleDeg,nearFieldMm:best.nearFieldMm,approachResolved:best.approachResolved,registered:false,resolved}};
}

/** Relative model positions are authored starting points, not clinical depth
 * measurements. Their role is to keep a missing-fit probe in the correct organ
 * and retain sensible withdrawal/advancement between related view families. */
const ME_ESTIMATE_HEIGHT=Object.freeze({me5c:35,me4c:25,mecommissural:25,me2c:25,melax:25,meavlax:35,meaaolax:47,meaaosax:47,merpv:32,meavsax:30,mervinout:28,memodbicaval:28,bicaval:28,mepv:28,melaa:24});
const TG_ESTIMATE_FRACTION=Object.freeze({tgbasalsax:.35,tgpapillary:.65,tgapicalsax:.85,tgrvbasal:.35,tgrvinout:.55,deeptg5c:.16,tg2c:.65,tgrvin:.65,tglax:.65});

function estimatedAtlasProbePose(plane,view,referenceMm,contextModel,failedFit){
 const scale=probePhysicalScale(referenceMm),f=contextModel.frame,c=mul(plane.center,referenceMm),n=unit(plane.normal||cross(plane.right,plane.up));
 const outside=!!plane.outsideScan||view?.aseNumber>=25,isArch=view?.aseNumber>=27,isGastric=view?.group==='tg',deep=view?.id==='deeptg5c';
 const angle=Number(view?.angleDefault)||0,allowed=outside?(isArch?['ue']:['le']):isGastric?(deep?['deep-tg']:['tg']):['me'];
 const candidates=(isGastric&&contextModel.gastricInteriorSamples?.length?contextModel.gastricInteriorSamples:contextModel.tractSamples).filter(s=>allowed.includes(s.level));
 const samples=candidates.length?candidates:contextModel.tractSamples;
 const levelSamples=contextModel.tractSamples.filter(s=>allowed.includes(s.level));
 const arcStart=(levelSamples[0]||samples[0]).arcMm,arcEnd=(levelSamples.at(-1)||samples.at(-1)).arcMm;
 const preferredArc=arcStart+(arcEnd-arcStart)*(TG_ESTIMATE_FRACTION[view?.id]??.5);
 const preferredHeight=outside?(isArch?77:teeContextToLocal(contextModel.landmarksMm.hiatus,f)[1]+18):(ME_ESTIMATE_HEIGHT[view?.id]??28);
 let best=null;
 for(const s of samples){
  const headCenterMm=[...s.pointMm];
  // ASE/SCA sections 25–28: descending aorta is posterior-left of the
  // esophagus; the arch is approached from upper esophagus facing anterior.
  // These target locations are schematic, never fabricated acquired aorta.
  const targetMm=outside?add(headCenterMm,isArch?add(mul(f.anterior,30*scale),mul(f.left,5*scale)):add(mul(f.left,22*scale),mul(f.posterior,14*scale))):c;
  const beam=unit(sub(targetMm,headCenterMm),f.anterior),projectedShaft=sub(s.tangent,mul(beam,dot(s.tangent,beam)));
  const shaft=unit(projectedShaft,orthogonal(f.anterior,beam)),mechanicalRight=unit(cross(beam,shaft)),right=unit(rotateVector(mechanicalRight,beam,radians(angle))),normal=unit(cross(beam,right));
  // The electrical face sits toward the lumen wall; the head body remains
  // centred on the selected interior sample instead of being projected to CT.
  const originMm=add(headCenterMm,mul(beam,3*scale)),distance=Math.hypot(...sub(targetMm,originMm)),planeOffsetMm=Math.abs(dot(sub(originMm,c),n));
  const normalAngleDeg=Math.acos(clamp(Math.abs(dot(normal,n)),0,1))*180/Math.PI,shaftBendDeg=angleBetween(shaft,s.tangent);
  const positionError=isGastric?(s.arcMm-preferredArc)/(12*scale):(teeContextToLocal(headCenterMm,f)[1]-preferredHeight)/10;
  const cost=outside?positionError**2:positionError**2+((distance-55*scale)/(55*scale))**2+.30*(planeOffsetMm/(40*scale))**2+.35*(normalAngleDeg/70)**2+.08*(shaftBendDeg/75)**2;
  if(!best||cost<best.cost)best={s,cost,headCenterMm,originMm,targetMm,beam,shaft,mechanicalRight,right,normal,distance,planeOffsetMm,normalAngleDeg,shaftBendDeg};
 }
 const {s,originMm,targetMm,beam,shaft,mechanicalRight,right,normal}=best;
 const index=s.pathIndex??contextModel.tractSamples.indexOf(s),shaftPoints=routedAtlasShaft(contextModel,s,Math.max(0,index),originMm,shaft,scale);
 const sectorDepthMm=outside?(isArch?75:48)*scale:clamp(best.distance+30*scale,65*scale,155*scale);
 return {referenceMm,originMm,targetMm,beam,right,normal,up:mul(beam,-1),shaftPoints,instrument:{originMm,beam,right:mechanicalRight,shaft,normal:mul(shaft,-1)},multiplaneDeg:angle,sectorDepthMm,
  contextFit:{resolved:false,estimated:true,outsideScan:outside,registered:false,mode:outside?'outside-scan-estimate':'tract-estimate',level:s.level,levelLabel:levelLabel(s.level),insertionCm:s.insertionCm,
   distanceMm:best.planeOffsetMm,normalAngleDeg:best.normalAngleDeg,shaftBendDeg:best.shaftBendDeg,clearanceHintMm:s.radialClearanceHintMm,
   headCenterMm:best.headCenterMm,tractSampleMm:[...s.pointMm],tractArcMm:s.arcMm,tractOffsetMm:0,clinicalDepthMeasured:false,
   targetKind:outside?'illustrative aortic target':'regional CT center',failedPlaneFitMm:failedFit?.distanceMm??null,
   reason:outside?'The target is outside the acquired heart. Probe and sector provide illustrative spatial context.':'The authored tract cannot reproduce the reviewed CT plane. This estimated probe and sector are independent of that measured section.'}};
}

/** Every atlas target receives a probe estimate. Tight existing fits retain
 * exact CT-plane coincidence; all other targets receive an independent pose
 * inside the fixed esophageal/gastric model. No CT frame or evidence is edited. */
export function atlasContextProbePose(plane,view,referenceMm,contextModel){
 if(plane.acquisitionPose)return plane.acquisitionPose;
 const fitted=fitAtlasProbeToPlane(plane,view,referenceMm,contextModel);
 if(fitted.contextFit?.resolved)return {...fitted,contextFit:{...fitted.contextFit,estimated:false,outsideScan:false,mode:'ct-plane-estimate',levelLabel:levelLabel(fitted.contextFit.level),clinicalDepthMeasured:false}};
 if(contextModel?.tractSamples?.length)return estimatedAtlasProbePose(plane,view,referenceMm,contextModel,fitted.contextFit);
 return {...fitted,contextFit:{resolved:false,estimated:true,outsideScan:!!plane.outsideScan||view?.aseNumber>=25,registered:false,mode:'plane-only-estimate',level:view?.group==='tg'?'tg':view?.aseNumber>=27?'ue':'me',levelLabel:view?.depthLabel||'Illustrative position',clinicalDepthMeasured:false,reason:'Anatomical tract unavailable; the probe is a geometric illustration only.'}};
}

/** Compact world-mm support for framing the physical head and nearby shaft.
 * The full proximal tract is intentionally not required in a heart close-up. */
export function atlasProbeFocusPoints(pose){
 if(!pose?.originMm||!pose.instrument)return [];
 const scale=probePhysicalScale(pose.referenceMm),points=[pose.originMm,...(pose.shaftPoints||[]).filter(p=>Math.hypot(...sub(p,pose.originMm))<=30*scale)];
 if(pose.targetMm)points.push(pose.targetMm);
 for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1])points.push(add(pose.originMm,add(mul(pose.instrument.right,x*4*scale),add(mul(pose.instrument.shaft,y*9*scale),mul(pose.beam,(z*3-3)*scale)))));
 return points.map(p=>[...p]);
}

export class TeeAtlasOverlay{
 constructor({renderer,meshCanvas,guideCanvas,mount}){
  this.renderer=renderer;this.meshCanvas=meshCanvas;this.guideCanvas=guideCanvas;this.mount=mount;
  try{this.scene=new TeeSceneOverlay(meshCanvas,{renderer});}catch{this.scene=null;}
 }
 start(){if(this.running)return;this.running=true;this.scene?.setActive?.(true);const tick=()=>{if(!this.running)return;this.draw();this.raf=requestAnimationFrame(tick);};tick();}
 stop(){this.running=false;cancelAnimationFrame(this.raf);this.scene?.setActive?.(false);this.meshCanvas.hidden=true;this.guideCanvas.hidden=true;this.key='';}
 set({plane,view,referenceMm,showProbe=true,showSector=true,showContext=true,contextModel=null}){this.plane=plane;this.view=view;this.referenceMm=referenceMm;this.showProbe=showProbe;this.showSector=showSector;this.showContext=showContext;this.contextModel=contextModel;this.pose=plane&&referenceMm?atlasContextProbePose(plane,view,referenceMm,contextModel):null;this.key='';if(this.running)this.draw();}
 draw(){
  if(!this.plane||!this.referenceMm||!this.running||this.mount.hidden)return;
  const rect=this.renderer.canvas.getBoundingClientRect(),w=Math.round(rect.width),h=Math.round(rect.height);
  if(w<2||h<2)return;
  const c=this.renderer.camera,key=[w,h,c.yaw,c.pitch,c.roll,c.distance,...c.pan,this.showProbe,this.showSector,this.showContext,this.renderer.contextFrameRevision??this.renderer.displayedRevision??this.renderer.displayedId??0].join(',');if(key===this.key)return;this.key=key;
  if(!this.pose)this.pose=atlasContextProbePose(this.plane,this.view,this.referenceMm,this.contextModel);
  const pose=this.pose,scale=probePhysicalScale(this.referenceMm),basis=this.renderer.basis(),dpr=Math.min(globalThis.devicePixelRatio||1,2);
  const resolved=pose.contextFit?.resolved===true,estimated=pose.contextFit?.estimated===true,showProbe=this.showProbe!==false,showSector=this.showSector!==false;
  const probeLabel=`TEE · ${pose.multiplaneDeg}° target`;
  this.meshCanvas.hidden=!!this.scene?.sharedDepth||!showProbe&&!this.showContext;this.guideCanvas.hidden=!showSector&&!showProbe&&!this.showContext;
  for(const canvas of [this.meshCanvas,this.guideCanvas]){canvas.style.width=w+'px';canvas.style.height=h+'px';}
  this.scene?.render({basis,width:w,height:h,dpr,pose,reference:{referenceMm:this.referenceMm,scale},showProbe,probeLabel,contextModel:this.contextModel,showContext:this.showContext});
  const cv=this.guideCanvas;if(cv.width!==Math.round(w*dpr))cv.width=Math.round(w*dpr);if(cv.height!==Math.round(h*dpr))cv.height=Math.round(h*dpr);
  const ctx=cv.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  const project=p=>projectProbePoint(mul(p,1/this.referenceMm),basis,w,h);
  const occlusion=this.renderer.getContextOcclusion?.();
  if(this.showContext&&!this.scene?.sharedDepth)paintTeeContextLabels(ctx,project,this.contextModel,w,h,{fallback:!this.scene,occlusion});
  if(showProbe&&!this.scene)paintTeeFallback(ctx,project,pose,scale,{occlusion});
  const path=(points,{fill,stroke='#91c9b6',width=1.1,close=false}={})=>{
   const ps=points.map(project);if(ps.some(p=>!p))return;ctx.beginPath();ps.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));if(close)ctx.closePath();if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.lineWidth=width;ctx.strokeStyle=stroke;ctx.stroke();}
  };
  if(showSector){
   const half=38*Math.PI/180,arc=depth=>Array.from({length:49},(_,i)=>{const a=-half+2*half*i/48;return add(pose.originMm,add(mul(pose.beam,Math.cos(a)*depth),mul(pose.right,Math.sin(a)*depth)));});
   if(estimated)ctx.setLineDash([5,5]);
   path([pose.originMm,...arc(pose.sectorDepthMm)],{close:true,fill:estimated?'rgba(227,181,117,.025)':'rgba(108,193,162,.045)',stroke:estimated?'rgba(227,181,117,.65)':'rgba(147,218,187,.7)'});
   ctx.setLineDash([3,6]);path(arc(pose.sectorDepthMm*.5),{stroke:estimated?'rgba(227,181,117,.28)':'rgba(147,218,187,.32)'});ctx.setLineDash([]);
   path([pose.originMm,arc(Math.min(26*scale,pose.sectorDepthMm))[0]],{stroke:'#ecc087',width:2.5});
  }
  if(this.showSector&&!resolved&&this.view?.aseNumber<25){
   const f=this.plane;ctx.setLineDash([5,7]);path([[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>mul(add(f.center,add(mul(f.right,x*f.width*.5),mul(f.up,y*f.height*.5))),this.referenceMm)),{close:true,stroke:'rgba(147,218,187,.45)'});ctx.setLineDash([]);
  }
  const p=project(pose.originMm);if(showProbe&&!this.scene?.sharedDepth&&depthPointVisible(occlusion,p,w,h)&&p.x>0&&p.x<w&&p.y>0&&p.y<h){
   const metrics=contextLabelMetrics(w,h);ctx.font=metrics.font;const labelWidth=Math.min(w-24,(ctx.measureText?.(probeLabel)?.width||probeLabel.length*metrics.fontSize*.55)+14),x=Math.max(12,Math.min(w-labelWidth-4,p.x+15)),y=Math.max(24,Math.min(h-35,p.y-19));
   ctx.fillStyle='rgba(11,20,22,.9)';ctx.fillRect(x-6,y-metrics.fontSize-4,labelWidth,metrics.height+3);ctx.fillStyle='#e6d5bc';ctx.fillText(probeLabel,x,y+1);
  }
 }
 dispose(){this.stop();this.scene?.dispose();}
}
