/** Educational TEE kinematics in the donor's measured coordinate system.
 * The path is an authored positioning guide between existing source planes,
 * not a segmented esophagus or a registered clinical acquisition path.
 */
import {add,mul,dot,cross,norm} from './planes.js';
import {PROBE_REFERENCE_MM,probePhysicalScale,probePhysicalLimits,sanitizeProbeState,defaultOrigin,rotateVector,finiteVector,probePresetDepth} from './probe-geometry.js';
import {sampleTeeContextTract} from './tee-context-geometry.js';

const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const radians=x=>x*Math.PI/180;
const lerp=(a,b,t)=>add(mul(a,1-t),mul(b,t));
const validFrame=f=>f&&['center','right','up'].every(k=>finiteVector(f[k]));
const safeNorm=(v,fallback)=>Math.hypot(...v)>1e-9?norm(v):[...fallback];

/** The source-calibrated S-20 tract follows the physical head center. The
 * acoustic face is 3 model mm ahead along the mechanical beam, matching the same
 * .60-scale head convention used by the atlas. Legacy/LADAF controls retain
 * their established acoustic-origin convention. */
export function teeAcousticFaceOffsetMm(reference){
 const frame=reference?.contextModel?.frame;
 return frame?.kind==='specimen-source-anchored-illustrative-frame'&&['s-20-29','1773963465','s-20-28','1966162746'].includes(String(frame.donorId))?3*reference.scale:0;
}

/** Illustrative instrument-path calibration fitted to the fixed S-20-29 lumen.
 * This is not a measured esophageal reaction or a validated mechanics law.
 * The bounded radial guide correction follows the shaft-turned tract beam,
 * independently of electronic multiplane angle and the selected preset. Its
 * smooth joins keep manual flexion and the rendered/sampled pose continuous. */
export function teeHeadGuideBiasMm(reference,anteflexDeg){
 const frame=reference?.contextModel?.frame;
 if(frame?.kind!=='specimen-source-anchored-illustrative-frame'||!['s-20-29','1773963465'].includes(String(frame.donorId)))return 0;
 const t=clamp((-anteflexDeg-10)/8,0,1);
 return 3*reference.scale*t*t*(3-2*t);
}

export const TEE_PRESETS=[
 {id:'me4c',label:'ME four-chamber',geometricLabel:'Long-axis reference',angle:0,frame:'me4c',note:'Explore the chamber section from an illustrative esophageal position.'},
 {id:'me2c',label:'ME two-chamber',geometricLabel:'Crossed long-axis',angle:90,frame:'me2c',note:'A left-heart starting section with independently adjusted insertion, shaft turn and tip flexion.'},
 {id:'melax',label:'ME long-axis',geometricLabel:'Oblique long-axis',angle:120,frame:'melax',note:'Explore continuity between the LV, mitral region and aortic outflow.'},
 {id:'tg',label:'TG short-axis',geometricLabel:'Distal short-axis',angle:0,frame:'tgpapillary',note:'A short-axis starting section approached through the illustrative gastric region.'},
];

export function sanitizeTeeState(saved={}){
 const initialized=saved.teeVersion===1,referenceMm=Number.isFinite(saved.referenceMm)&&saved.referenceMm>0?saved.referenceMm:PROBE_REFERENCE_MM;
 const defaults={teeVersion:1,teePreset:'me4c',insertionCm:35,shaftRotationDeg:0,anteflexDeg:0,lateralFlexDeg:0,multiplaneDeg:0,teeMirrorX:false,probeLocked:false,depthMm:135*probePhysicalScale(referenceMm),angleDeg:80,frequencyMHz:5,showSurface:true,showSkeleton:true,interactionMode:'orbit',teeEntryInitialized:false};
 const s={...sanitizeProbeState({...defaults,...(initialized?saved:{}),referenceMm,preset:'atrial',contactLocked:false}),...defaults,...(initialized?saved:{}),referenceMm,preset:'atrial',contactLocked:false,teeVersion:1};
 if(!TEE_PRESETS.some(p=>p.id===s.teePreset))s.teePreset='me4c';
 for(const [key,min,max] of [['insertionCm',25,65],['shaftRotationDeg',-180,180],['anteflexDeg',-65,90],['lateralFlexDeg',-60,60],['multiplaneDeg',0,180]])s[key]=Number.isFinite(Number(s[key]))?clamp(Number(s[key]),min,max):defaults[key];
 const shared=sanitizeProbeState(s);
 for(const key of ['depthMm','angleDeg','gainDb','frequencyMHz','dynamicRangeDb','shadow','speedMm','cutaway','flip','showGuide','showSurface','imageMode'])s[key]=shared[key];
 s.teeMirrorX=!!s.teeMirrorX;s.probeLocked=!!s.probeLocked;s.showSkeleton=s.showSkeleton!==false;s.originMm=null;s.contactPositionMm=null;s.interactionMode='orbit';
 return s;
}

function orthogonalFrame(frame,referenceMm){
 const beam=norm(mul(frame.up,-1));
 const right=norm(sub(frame.right,mul(beam,dot(frame.right,beam))));
 return {originMm:defaultOrigin({...frame,referenceMm},135*probePhysicalScale(referenceMm),referenceMm),beam,right,shaft:mul(norm(cross(beam,right)),-1)};
}

function bezier(points,t){const q=1-t;return add(add(mul(points[0],q*q*q),mul(points[1],3*q*q*t)),add(mul(points[2],3*q*t*t),mul(points[3],t*t*t)));}
function bezierTangent(points,t){const q=1-t;return norm(add(add(mul(sub(points[1],points[0]),3*q*q),mul(sub(points[2],points[1]),6*q*t)),mul(sub(points[3],points[2]),3*t*t)));}

/** Exact ME entry and a distal source-plane anchor, connected by a smooth
 * curve and an arc-length table. The 35 cm marker is a model reference only.
 * Travel is in reference-centimetres, scaled with the donor's physical extent.
 */
export function createTeeReference(frames,referenceMm=PROBE_REFERENCE_MM,contextModel=null){
 const me=frames.me4c;
 if(!validFrame(me))throw new Error('A measured long-axis reference is required for the TEE lab.');
 if(contextModel){
  const scale=probePhysicalScale(referenceMm),samples=contextModel.tractSamples;
  if(Math.abs(contextModel.referenceMm-referenceMm)>1e-5||!samples?.length)throw new Error('TEE context and source scan must share physical coordinates.');
  const middle=samples.reduce((a,b)=>Math.abs(a.insertionCm-35)<Math.abs(b.insertionCm-35)?a:b),gastric=samples.find(s=>s.level==='tg')||samples.at(-1);
  const meArcMm=middle.arcMm-(middle.insertionCm-35)*10*scale;
  const reference={referenceMm,scale,contextModel,meArcMm,before:meArcMm,length:gastric.arcMm-meArcMm,after:samples.at(-1).arcMm-gastric.arcMm,minInsertionCm:samples[0].insertionCm,maxInsertionCm:samples.at(-1).insertionCm,tgInsertionCm:gastric.insertionCm,meDepthMm:probePresetDepth('atrial',{...me,referenceMm}),tgDepthMm:135*scale,pathPoints:samples.map(s=>[...s.pointMm])};
  const base=teePathFrame(reference,35),tg=teePathFrame(reference,reference.tgInsertionCm);
  reference.base={...base,originMm:base.pointMm};reference.tg={...tg,originMm:tg.pointMm};return reference;
 }
 const scale=probePhysicalScale(referenceMm),base=orthogonalFrame(me,referenceMm);
 const tg=validFrame(frames.tgpapillary)?orthogonalFrame(frames.tgpapillary,referenceMm):{...base,originMm:add(base.originMm,mul(base.shaft,90*scale))};
 // An in-plane sign reversal changes presentation, not the distal source
 // section. Choose the compatible side to avoid twisting the authored tract.
 if(dot(base.right,tg.right)<0){tg.right=mul(tg.right,-1);tg.shaft=mul(tg.shaft,-1);}
 const distance=Math.hypot(...sub(tg.originMm,base.originMm));
 const reach=Math.max(24*scale,Math.min(55*scale,distance*.4));
 const curve=[base.originMm,add(base.originMm,mul(base.shaft,reach)),add(tg.originMm,mul(tg.shaft,-reach)),tg.originMm];
 const table=[{t:0,s:0,p:curve[0]}];let length=0,last=curve[0];
 for(let i=1;i<=256;i++){const t=i/256,p=bezier(curve,t);length+=Math.hypot(...sub(p,last));table.push({t,s:length,p});last=p;}
 const reference={referenceMm,scale,base,tg,curve,table,length,before:75*scale,after:25*scale,
  meDepthMm:probePresetDepth('atrial',{...me,referenceMm}),tgDepthMm:135*scale};
 reference.minInsertionCm=35-reference.before/(10*scale);
 reference.maxInsertionCm=35+(length+reference.after)/(10*scale);
 reference.tgInsertionCm=35+length/(10*scale);
 reference.pathPoints=Array.from({length:121},(_,i)=>teePathFrame(reference,reference.minInsertionCm+(reference.maxInsertionCm-reference.minInsertionCm)*i/120).pointMm);
 return reference;
}

export function teePathFrame(reference,insertionCm){
 if(reference.contextModel){
  const distance=(insertionCm-35)*10*reference.scale,arc=reference.meArcMm+distance,total=reference.contextModel.tractSamples.at(-1).arcMm,sample=sampleTeeContextTract(reference.contextModel,arc),extra=arc<0?arc:arc>total?arc-total:0;
  return {pointMm:add(sample.pointMm,mul(sample.shaft,extra)),shaft:sample.shaft,beam:sample.beam,right:sample.right,distance,level:sample.level};
 }
 const {scale,length,table,curve,base,tg}=reference;
 const distance=clamp((insertionCm-35)*10*scale,-reference.before,length+reference.after);
 if(distance<=0)return {pointMm:add(base.originMm,mul(base.shaft,distance)),shaft:[...base.shaft],beam:[...base.beam],right:[...base.right],distance};
 if(distance>=length)return {pointMm:add(tg.originMm,mul(tg.shaft,distance-length)),shaft:[...tg.shaft],beam:[...tg.beam],right:[...tg.right],distance};
 let lo=0,hi=table.length-1;while(hi-lo>1){const mid=(lo+hi)>>1;if(table[mid].s<distance)lo=mid;else hi=mid;}
 const ratio=(distance-table[lo].s)/(table[hi].s-table[lo].s),t=table[lo].t+(table[hi].t-table[lo].t)*ratio;
 const shaft=bezierTangent(curve,t),candidate=lerp(base.right,tg.right,t);
 const right=safeNorm(sub(candidate,mul(shaft,dot(candidate,shaft))),base.right),beam=norm(cross(shaft,right));
 return {pointMm:bezier(curve,t),shaft,beam,right,distance};
}

/** Rear attachment of the illustrative head, not its acoustic face. The
 * production head is drawn at .60 scale; its original neck meets local
 * [0, 11, 6], with +Y proximal and +Z behind the acoustic face. */
export function teeShaftAttachment(instrument,scale=1){
 return add(instrument.originMm,add(mul(instrument.shaft,-6.6*scale),mul(instrument.beam,-3.6*scale)));
}

function routedTeeShaft(reference,insertionCm,instrument){
 const scale=reference.scale,visualInsertion=reference.contextModel?insertionCm:clamp(insertionCm,reference.minInsertionCm,reference.maxInsertionCm);
 const joinCm=visualInsertion-4,startCm=Math.min(reference.minInsertionCm-2,joinCm-1);
 // The source-only reference clamps its acoustic position at the shallow
 // limit. Continue the visible proximal shaft along its entry tangent so a
 // short insertion cannot double the shaft back onto the head.
 const pathFrame=cm=>{
  if(cm>=reference.minInsertionCm)return teePathFrame(reference,cm);
  const entry=teePathFrame(reference,reference.minInsertionCm);
  return {...entry,pointMm:add(entry.pointMm,mul(entry.shaft,(cm-reference.minInsertionCm)*10*scale))};
 };
 const entry=pathFrame(joinCm),attachment=teeShaftAttachment(instrument,scale);
 // A short straight neck enters the actual rear of the head tangentially.
 // Only this illustration is routed: the constant-curvature acoustic pose,
 // sampled plane and calibrated controls below remain exactly unchanged.
 const neck=add(attachment,mul(instrument.shaft,-2.4*scale));
 const reach=Math.max(4*scale,Math.hypot(...sub(neck,entry.pointMm))/3);
 const curve=[entry.pointMm,add(entry.pointMm,mul(entry.shaft,reach)),add(neck,mul(instrument.shaft,-reach)),neck];
 const points=[],push=p=>{if(!points.length||Math.hypot(...sub(p,points.at(-1)))>1e-6*scale)points.push(p);};
 const steps=Math.max(1,Math.ceil((joinCm-startCm)*5));
 for(let i=0;i<=steps;i++)push(pathFrame(startCm+(joinCm-startCm)*i/steps).pointMm);
 // Both end derivatives follow their adjoining shaft directions. Sampling a
 // single smooth join avoids the previous tract→straight-joint→bend dogleg.
 for(let i=1;i<=48;i++)push(bezier(curve,i/48));
 push(attachment);
 return points;
}

/** A constant-curvature distal segment moves AND rotates the transducer tip.
 * Shaft turning is mechanical rotation; multiplane rotation affects only the
 * image basis and never the instrument, path, beam origin or beam direction.
 */
export function teePose(state,reference){
 if(!reference)return null;
 const base=teePathFrame(reference,state.insertionCm),turn=radians(state.shaftRotationDeg);
 const right=rotateVector(base.right,base.shaft,turn),beam=rotateVector(base.beam,base.shaft,turn),shaft=base.shaft;
 const bend=add(mul(right,-radians(state.anteflexDeg)),mul(beam,-radians(state.lateralFlexDeg))),angle=Math.hypot(...bend),axis=angle>1e-10?mul(bend,1/angle):right;
 const segmentLength=20*reference.scale,joint=add(base.pointMm,mul(shaft,-segmentLength));
 const bendAt=f=>{
  const a=angle*f;
  if(a<1e-9)return add(joint,mul(shaft,segmentLength*f));
  const v=add(add(mul(shaft,Math.sin(a)),mul(cross(axis,shaft),1-Math.cos(a))),mul(axis,dot(axis,shaft)*(a-Math.sin(a))));
  return add(joint,mul(v,segmentLength/angle));
 };
 const headGuideBiasMm=teeHeadGuideBiasMm(reference,state.anteflexDeg);
 const headCenterMm=add(bendAt(1),mul(beam,headGuideBiasMm)),mechanicalBeam=norm(rotateVector(beam,axis,angle)),mechanicalRight=norm(rotateVector(right,axis,angle));
 const mechanicalShaft=norm(rotateVector(shaft,axis,angle));
 const acousticFaceOffsetMm=teeAcousticFaceOffsetMm(reference);
 const originMm=add(headCenterMm,mul(mechanicalBeam,acousticFaceOffsetMm));
 // Presentation handedness belongs to the sampled image basis, independently
 // of the physical head, electronic angle and retained side of the cutaway.
 const imageRight=mul(norm(rotateVector(mechanicalRight,mechanicalBeam,radians(state.multiplaneDeg))),state.teeMirrorX?-1:1),normal=norm(cross(mechanicalBeam,imageRight));
 const instrument={originMm,right:mechanicalRight,beam:mechanicalBeam,normal:mul(mechanicalShaft,-1),shaft:mechanicalShaft};
 const shaftPoints=routedTeeShaft(reference,state.insertionCm,instrument);
 return {originMm,headCenterMm,acousticFaceOffsetMm,headGuideBiasMm,right:imageRight,beam:mechanicalBeam,normal,up:mul(mechanicalBeam,-1),
  instrument,shaftPoints,
  insertionCm:state.insertionCm,multiplaneDeg:state.multiplaneDeg};
}

export function teePresetState(id,current,reference){
 const preset=TEE_PRESETS.find(p=>p.id===id)||TEE_PRESETS[0],scale=reference?.scale||probePhysicalScale(current.referenceMm);
 const depth=(preset.id==='tg'?reference?.tgDepthMm:reference?.meDepthMm)||135*scale;
 return sanitizeTeeState({...current,teeVersion:1,teePreset:preset.id,insertionCm:preset.id==='tg'?(reference?.tgInsertionCm||46):35,shaftRotationDeg:0,anteflexDeg:0,lateralFlexDeg:0,multiplaneDeg:preset.angle,teeMirrorX:false,...reference?.presetStates?.[preset.id],probeLocked:false,teeEntryInitialized:!!reference,depthMm:clamp(reference?.presetStates?.[preset.id]?.depthMm||depth,...probePhysicalLimits(current.referenceMm).depth)});
}

export function teeLevel(state,reference){
 if(!reference)return 'Reference tract';
 if(reference.contextModel)return {ue:'Upper esophagus',me:'Midesophageal region',le:'Lower esophagus',junction:'Esophageal hiatus / cardia',tg:'Gastric fundus', 'deep-tg':'Deeper gastric region'}[teePathFrame(reference,state.insertionCm).level]||'Illustrative tract';
 const d=(state.insertionCm-35)*10*reference.scale;
 return d< -25*reference.scale?'Upper reference':d>reference.length*.75?'Distal / TG reference':'Midesophageal reference';
}
