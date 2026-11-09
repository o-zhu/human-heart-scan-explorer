/** Bounded calibration of four free-lab controls to a fixed illustrative tract.
 *
 * The target sections remain immutable. This solves model controls, not a
 * clinical insertion depth or a validated patient/probe registration. Residuals
 * are returned explicitly whenever the fixed tract cannot reproduce a plane.
 */
import {add,mul,dot,cross,norm} from './planes.js';
import {rotateVector,probePhysicalLimits} from './probe-geometry.js';
import {teePathFrame,teePose,sanitizeTeeState,teeAcousticFaceOffsetMm,teeHeadGuideBiasMm} from './tee-geometry.js';
import {createEchoInstrumentClearance} from './echo-instrument-clearance.js';

const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const radians=x=>x*Math.PI/180;
const degrees=x=>x*180/Math.PI;
const length=v=>Math.hypot(...v);
const unit=(v,fallback=[1,0,0])=>length(v)>1e-10?norm(v):[...fallback];
const finite3=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const cache=new WeakMap();
const PRESETS=[['me4c','me4c'],['me2c','me2c'],['melax','melax'],['tg','tgpapillary']];
const CLINICAL_ANGLES={me4c:{nominal:0,range:[0,20]},me2c:{nominal:90,range:[80,100]},melax:{nominal:120,range:[120,140]},tg:{nominal:0,range:[0,20]}};

// Offline source/lumen fits; runtime rechecks the actual head, shaft and fan.
// These model angles are not assigned clinical acquisition angles.
const SPECIMEN_START_CONTROLS={
 's-20-29':{
  me4c:[34.79129348332196,-41.988607681811644,-19.39654498281111,5.128453428411948,16.732470428913416],
  me2c:[31.69588844872106,-35.33598384058315,-7.120494922082441,5.606748214698107,53.60629183828337],
  melax:[35.48445567569027,-7.418779662465882,-6.835706317768648,-3.4809119479282034,150.11539121095967],
  tg:[50.223121166830566,-2.280333503681013,29.182740931433045,2.241597326292058,0],
 },
 's-20-28':{
  me4c:[33.33568484571044,-13.355467372886809,-5.787918937980816,7.878072519238126,11.8270766242901],
  me2c:[32.85847045413016,-24.05717721021803,-6.796146390351808,9.47221140422629,74.08231414425285],
  melax:[33.88653352360191,-14.981324906504884,3.5133324312763157,-6.535751727753869,128.36578641241977],
  tg:[50.63034902158981,1.9035376840975342,20.136270278365128,6.334382144657795,0],
 },
};

/** The same distal constant-curvature kinematics as teePose, without generating
 * 65 shaft drawing points for every optimization sample. Final residuals are
 * always measured again with the exported runtime teePose itself. */
function mechanics(base,x,scale,faceOffsetMm=0,headGuideBiasMm=0){
 const turn=radians(x[1]),right=rotateVector(base.right,base.shaft,turn),beam=rotateVector(base.beam,base.shaft,turn),shaft=base.shaft;
 const bend=add(mul(right,-radians(x[2])),mul(beam,-radians(x[3]))),angle=length(bend),axis=angle>1e-10?mul(bend,1/angle):right;
 const segment=20*scale,joint=add(base.pointMm,mul(shaft,-segment));
 const displacement=angle<1e-9?mul(shaft,segment):mul(add(add(mul(shaft,Math.sin(angle)),mul(cross(axis,shaft),1-Math.cos(angle))),mul(axis,dot(axis,shaft)*(angle-Math.sin(angle)))),segment/angle);
 const mechanicalBeam=unit(rotateVector(beam,axis,angle));
 return {originMm:add(add(add(joint,displacement),mul(beam,headGuideBiasMm)),mul(mechanicalBeam,faceOffsetMm)),beam:mechanicalBeam,right:unit(rotateVector(right,axis,angle))};
}

function bounded(x,bounds){return x.map((v,i)=>clamp(v,bounds[i][0],bounds[i][1]));}

function nelderMead(start,steps,bounds,evaluate,maxIterations=180){
 let simplex=[{x:bounded(start,bounds)}];
 for(let i=0;i<4;i++){const x=[...start];x[i]+=steps[i];if(x[i]>bounds[i][1])x[i]=start[i]-steps[i];simplex.push({x:bounded(x,bounds)});}
 for(const s of simplex)s.value=evaluate(s.x);
 const make=x=>{x=bounded(x,bounds);return {x,value:evaluate(x)};};
 for(let iter=0;iter<maxIterations;iter++){
  simplex.sort((a,b)=>a.value.cost-b.value.cost);
  const spread=Math.max(...simplex.slice(1).map(s=>length(s.x.map((v,i)=>(v-simplex[0].x[i])/steps[i]))));
  if(spread<.0025)break;
  const centroid=[0,0,0,0];for(const s of simplex.slice(0,4))for(let i=0;i<4;i++)centroid[i]+=s.x[i]/4;
  const worst=simplex[4],reflected=make(centroid.map((v,i)=>2*v-worst.x[i]));
  if(reflected.value.cost<simplex[0].value.cost){
   const expanded=make(centroid.map((v,i)=>v+2*(reflected.x[i]-v)));simplex[4]=expanded.value.cost<reflected.value.cost?expanded:reflected;
  }else if(reflected.value.cost<simplex[3].value.cost)simplex[4]=reflected;
  else{
   const outside=reflected.value.cost<worst.value.cost,other=outside?reflected:worst;
   const contracted=make(centroid.map((v,i)=>v+.5*(other.x[i]-v)));
   if(contracted.value.cost<other.value.cost)simplex[4]=contracted;
   else for(let j=1;j<5;j++)simplex[j]=make(simplex[j].x.map((v,i)=>simplex[0].x[i]+.5*(v-simplex[0].x[i])));
  }
 }
 simplex.sort((a,b)=>a.value.cost-b.value.cost);return simplex[0];
}

function calibrationRange(reference,isGastric){
 const samples=reference.contextModel.tractSamples;
 const allowed=samples.filter(s=>isGastric?['tg','deep-tg'].includes(s.level):['me','le'].includes(s.level));
 const list=allowed.length?allowed:samples;
 const low=clamp(list[0].insertionCm,25,65),high=clamp(list.at(-1).insertionCm,25,65);
 return [Math.min(low,high),Math.max(low,high)];
}

function targetCoverage(frame,referenceMm){
 const center=mul(frame.center,referenceMm),r=mul(frame.right,frame.width*referenceMm*.28),u=mul(frame.up,frame.height*referenceMm*.33);
 // A central target cross is a geometric coverage proxy, not a chamber mask.
 return [center,add(center,r),sub(center,r),add(center,u),sub(center,u)];
}

function calibratedSpecimenStart(id,key,reference,frame){
 const donorId=frame.donorCalibration?.donorId,x=SPECIMEN_START_CONTROLS[donorId]?.[id];
 if(!x||!teeAcousticFaceOffsetMm(reference))return null;
 const scale=reference.scale,center=mul(frame.center,reference.referenceMm),normal=unit(cross(frame.right,frame.up));
 const crossTargets=targetCoverage(frame,reference.referenceMm);
 // Include source landmarks that actually lie near the intended section.
 // Off-plane atrial centroids are not evidence of tissue inside that slice.
 const sourceTargets=(frame.anatomyTargetsMm||[]).filter(t=>Math.abs(dot(sub(t.pointMm,center),normal))<=4*scale);
 const coverage=[...crossTargets,...sourceTargets.map(t=>t.pointMm)];
 const provisional=sanitizeTeeState({teeVersion:1,teePreset:id,referenceMm:reference.referenceMm,
  ...Object.fromEntries(['insertionCm','shaftRotationDeg','anteflexDeg','lateralFlexDeg','multiplaneDeg'].map((k,i)=>[k,x[i]]))});
 let actual=teePose(provisional,reference);
 const targetAngle=p=>degrees(Math.acos(clamp(dot(unit(sub(p,actual.originMm)),actual.beam),-1,1)));
 const limits=probePhysicalLimits(reference.referenceMm);
 const depthMm=clamp(Math.max(...coverage.map(p=>length(sub(p,actual.originMm))))+12*scale,...limits.depth);
 const angleDeg=clamp(2*Math.max(...coverage.map(targetAngle))+8,75,110);
 const presentationMirrorNeeded=dot(actual.right,frame.right)<0;
 const state=sanitizeTeeState({...provisional,depthMm,angleDeg,teeMirrorX:presentationMirrorNeeded});
 actual=teePose(state,reference);
 const query=createEchoInstrumentClearance(reference.contextModel),head=query(actual.instrument,scale,{fullReport:true});
 const entry=reference.contextModel.tractSamples[0];
 // The visible proximal shaft intentionally extends above the open entry.
 const intraluminalRoute=actual.shaftPoints.filter(p=>dot(sub(p,entry.pointMm),entry.tangent)>=0);
 const shaft=query.route(intraluminalRoute,1.8*scale,{fullReport:true,ignoreEntryPoint:false});
 const covered=coverage.map(p=>{const q=sub(p,actual.originMm);return dot(q,actual.beam)>0&&length(q)<=state.depthMm+1e-7&&targetAngle(p)<=state.angleDeg/2+1e-7;});
 const planeOffsetMm=Math.abs(dot(sub(actual.originMm,center),normal));
 const normalAngleDeg=degrees(Math.acos(clamp(Math.abs(dot(actual.normal,normal)),-1,1)));
 const sourcePlaneResiduals=(frame.anatomyTargetsMm||[]).map(t=>({key:t.key,
  sourceResidualMm:Math.abs(dot(sub(t.pointMm,center),normal)),
  acceptedResidualMm:Math.abs(dot(sub(t.pointMm,actual.originMm),actual.normal))}));
 const maxAddedTargetMissMm=Math.max(0,...sourcePlaneResiduals.map(t=>t.acceptedResidualMm-t.sourceResidualMm));
 const minimumHeadGuardMm=.1*scale;
 const contained=head.inside&&head.complete&&head.clearanceMm>=minimumHeadGuardMm&&shaft.inside&&shaft.clearanceMm>=1.9*scale;
 const sourceRetained=planeOffsetMm<=.05*scale&&normalAngleDeg<=.15&&maxAddedTargetMissMm<=.4*scale;
 if(!contained||!sourceRetained||!covered.every(Boolean))throw new Error(`The reviewed ${donorId} ${id} Lab start no longer passes its source, head, shaft and fan gates. Recalibrate the fixed controls before presenting it.`);
 const compact=Object.fromEntries(['insertionCm','shaftRotationDeg','anteflexDeg','lateralFlexDeg','multiplaneDeg','depthMm','angleDeg','teeMirrorX'].map(k=>[k,state[k]]));
 return {state:compact,review:{frame:key,status:'fitted',method:'Source-preserving fixed controls with complete rendered-head, routed-shaft and sector gates.',
  planeOffsetMm,normalAngleDeg,maxAddedTargetMissMm,sourcePlaneResiduals,
  centerAimAngleDeg:targetAngle(center),targetCenterInFan:covered[0],
  geometricCoverageFraction:covered.slice(0,5).filter(Boolean).length/5,
  sourceTargetCoverageFraction:sourceTargets.length?covered.slice(5).filter(Boolean).length/sourceTargets.length:1,
  coveredSourceTargets:sourceTargets.map(t=>t.key),insertionRangeCm:calibrationRange(reference,id==='tg'),evaluations:1,
  originMm:[...actual.originMm],beam:[...actual.beam],right:[...actual.right],normal:[...actual.normal],
  head,shaft,minimumHeadGuardMm,acousticFaceOffsetMm:actual.acousticFaceOffsetMm,headGuideBiasMm:actual.headGuideBiasMm,
  boundsRespected:true,patientRegistered:false,modelMultiplaneRange:[0,180],nominalMultiplaneDeg:CLINICAL_ANGLES[id].nominal,
  usedNominalAngle:state.multiplaneDeg===CLINICAL_ANGLES[id].nominal,presentationMirrorNeeded,presentationMatchesTargetHandedness:dot(actual.right,frame.right)>0,
  limitations:['Fixed controls and guide correction are fitted to an illustrative lumen, not measured patient mechanics.','The displayed model multiplane angle is chosen for source fidelity and physical containment; it is not a validated clinical angle.','Coverage checks a geometric target cross and near-plane source guides, not complete segmented chambers or confirmed valve identity.']}};
}

function calibrateOne(id,key,reference,frame){
 const scale=reference.scale,center=mul(frame.center,reference.referenceMm),normal=unit(cross(frame.right,frame.up));
 const range=calibrationRange(reference,id==='tg'),bounds=[range,[-180,180],[-65,90],[-60,60]],coverage=targetCoverage(frame,reference.referenceMm);
 const midpoint=(range[0]+range[1])/2,clinical=CLINICAL_ANGLES[id];let evaluations=0,activeAngle=clinical.nominal;
 const evaluate=x=>{
  evaluations++;const path=teePathFrame(reference,x[0]),pose=mechanics(path,x,scale,teeAcousticFaceOffsetMm(reference),teeHeadGuideBiasMm(reference,x[2])),toCenter=sub(center,pose.originMm),distance=length(toCenter),direction=unit(toCenter);
  const imageRight=rotateVector(pose.right,pose.beam,radians(activeAngle)),imageNormal=unit(cross(pose.beam,imageRight));
  const signedAlignment=dot(imageNormal,normal),planeOffset=Math.abs(dot(sub(pose.originMm,center),normal)),normalAngle=degrees(Math.acos(clamp(Math.abs(signedAlignment),0,1))),aimAngle=degrees(Math.acos(clamp(dot(direction,pose.beam),-1,1)));
  const forward=dot(toCenter,pose.beam),onNearSide=forward>10*scale;
  const nearField=dot(sub(pose.originMm,center),frame.up),nearFieldMinimum=(id==='melax'?40:20)*scale,nearFieldPenalty=id==='tg'?0:(Math.max(0,nearFieldMinimum-nearField)/(5*scale))**2;
  let coveragePenalty=0;
  for(const p of coverage){const a=degrees(Math.acos(clamp(dot(unit(sub(p,pose.originMm)),pose.beam),-1,1)));coveragePenalty+=(Math.max(0,a-51)/9)**2;}
  // Prioritize the physical target plane, then a useful fan aimed into it.
  // The weak regularizer prefers moderate bends only among comparable fits.
  const centerOutsidePenalty=(Math.max(0,aimAngle-48)/3)**2*100;
  const cost=(planeOffset/(.5*scale))**2+(normalAngle/.75)**2+(aimAngle/17)**2+nearFieldPenalty+coveragePenalty+centerOutsidePenalty+(signedAlignment<0?.25:0)+(!onNearSide?10000+100*(10*scale-forward)**2:0)+.003*((x[2]/65)**2+(x[3]/60)**2)+.0005*((x[0]-midpoint)/(range[1]-range[0]||1))**2;
  return {cost,pose,planeOffsetMm:planeOffset,normalAngleDeg:normalAngle,aimAngleDeg:aimAngle,distanceMm:distance,multiplaneDeg:activeAngle,nearFieldMm:nearField};
 };
 const solveAt=angle=>{
  activeAngle=angle;const candidates=[];
  for(let i=0;i<=30;i++){
   const insertion=range[0]+(range[1]-range[0])*i/30;
   for(let turn=-180;turn<180;turn+=30)for(const ante of [-65,-45,-25,0,30,60,90])for(const lateral of [-50,0,50]){
    const x=[insertion,turn,ante,lateral],value=evaluate(x);candidates.push({x,value});
   }
  }
  candidates.sort((a,b)=>a.value.cost-b.value.cost);
  const starts=[];
  for(const c of candidates){
   if(starts.every(s=>Math.abs(s.x[0]-c.x[0])>.3||Math.abs(s.x[1]-c.x[1])>25||Math.abs(s.x[2]-c.x[2])>20||Math.abs(s.x[3]-c.x[3])>20))starts.push(c);
   if(starts.length>=10)break;
  }
  // Keep independent insertion basins even when coarse angular sampling makes
  // a distant basin rank below many similar states at the current best level.
  for(let i=0;i<=6;i++){
   const insertion=range[0]+(range[1]-range[0])*i/6,candidate=candidates.find(c=>Math.abs(c.x[0]-insertion)<1e-6);
   if(candidate&&!starts.includes(candidate))starts.push(candidate);
  }
  let best=candidates[0];
  for(const start of starts){const fit=nelderMead(start.x,[.25,9,7,7],bounds,evaluate);if(fit.value.cost<best.value.cost)best=fit;}
  return best;
 };
 let best=solveAt(clinical.nominal);const nominalFit={planeOffsetMm:best.value.planeOffsetMm,normalAngleDeg:best.value.normalAngleDeg,aimAngleDeg:best.value.aimAngleDeg};
 const nominalUseful=best.value.planeOffsetMm<=2*scale&&best.value.normalAngleDeg<=3&&best.value.aimAngleDeg<=22;
 if(!nominalUseful)for(let angle=clinical.range[0];angle<=clinical.range[1];angle+=5){
  if(angle===clinical.nominal)continue;const candidate=solveAt(angle);if(candidate.value.cost<best.value.cost)best=candidate;
 }
 const angle=best.value.multiplaneDeg,provisional={teeVersion:1,teePreset:id,referenceMm:reference.referenceMm,insertionCm:best.x[0],shaftRotationDeg:best.x[1],anteflexDeg:best.x[2],lateralFlexDeg:best.x[3],multiplaneDeg:angle};
 const limits=probePhysicalLimits(reference.referenceMm),desiredDepth=Math.max(...coverage.map(p=>length(sub(p,best.value.pose.originMm))))+12*scale;
 const desiredAngle=2*Math.max(...coverage.map(p=>degrees(Math.acos(clamp(dot(unit(sub(p,best.value.pose.originMm)),best.value.pose.beam),-1,1)))))+8;
 const state=sanitizeTeeState({...provisional,depthMm:clamp(desiredDepth,...limits.depth),angleDeg:clamp(desiredAngle,75,110)});
 let actual=teePose(state,reference);const presentationMirrorNeeded=dot(actual.right,frame.right)<0;
 state.teeMirrorX=presentationMirrorNeeded;actual=teePose(state,reference);
 const actualOffset=Math.abs(dot(sub(actual.originMm,center),normal)),actualNormalAngle=degrees(Math.acos(clamp(Math.abs(dot(actual.normal,normal)),-1,1))),toCenter=sub(center,actual.originMm),centerAngle=degrees(Math.acos(clamp(dot(unit(toCenter),actual.beam),-1,1)));
 const covered=coverage.map(p=>{const q=sub(p,actual.originMm),forward=dot(q,actual.beam),angle=degrees(Math.acos(clamp(dot(unit(q),actual.beam),-1,1)));return forward>0&&length(q)<=state.depthMm&&angle<=state.angleDeg/2;});
 const compact=Object.fromEntries(['insertionCm','shaftRotationDeg','anteflexDeg','lateralFlexDeg','multiplaneDeg','depthMm','angleDeg','teeMirrorX'].map(k=>[k,state[k]]));
 const limited=actualOffset>2*scale||actualNormalAngle>3||!covered.every(Boolean);
 const review={frame:key,status:limited?'limited':'fitted',planeOffsetMm:actualOffset,normalAngleDeg:actualNormalAngle,centerAimAngleDeg:centerAngle,targetCenterInFan:covered[0],geometricCoverageFraction:covered.filter(Boolean).length/covered.length,insertionRangeCm:range,evaluations,originMm:[...actual.originMm],beam:[...actual.beam],right:[...actual.right],normal:[...actual.normal],boundsRespected:true,patientRegistered:false,clinicalMultiplaneRange:clinical.range,nominalMultiplaneDeg:clinical.nominal,nominalFit,usedNominalAngle:angle===clinical.nominal,presentationMirrorNeeded,presentationMatchesTargetHandedness:dot(actual.right,frame.right)>0,limitations:['Control values are solved on an illustrative tract, not measured from a patient.','Nominal clinical multiplane angles are attempted first; only the stated view-family interval is permitted as a fallback.','Coverage uses a central geometric target cross; actual chamber/valve coverage requires source-pixel inspection.',...(limited?['The fixed tract and bounded flexion do not exactly reproduce the selected source plane.']:[])]};
 return {state:compact,review};
}

/** Returns {presetStates,review}; safe to attach only presetStates to reference.
 * Legacy references without a context model are intentionally left unchanged. */
export function calibrateTeeContextPresets(reference,frames){
 if(!reference?.contextModel)return {presetStates:{},review:{status:'legacy-reference',presets:{}}};
 const signature=JSON.stringify(PRESETS.map(([,key])=>frames[key]||null));
 const existing=cache.get(reference);if(existing?.signature===signature)return existing.result;
 const presetStates={},presets={};
 for(const [id,key]of PRESETS){
  const supplied=frames[key],frame=supplied?.world||supplied?.frame||supplied;
  if(!frame||!['center','right','up'].every(k=>finite3(frame[k]))||!(frame.width>0&&frame.height>0)){presets[id]={frame:key,status:'missing-target',patientRegistered:false};continue;}
  const result=calibratedSpecimenStart(id,key,reference,frame)||calibrateOne(id,key,reference,frame);presetStates[id]=Object.freeze(result.state);presets[id]=Object.freeze(result.review);
 }
 const specimenFits=Object.values(presets).some(p=>p.head);
 const result=Object.freeze({presetStates:Object.freeze(presetStates),review:Object.freeze({revision:specimenFits?'source-contained-lab-presets-v3':'fixed-tract-presets-v2',method:specimenFits?'Specimen-specific control fits with runtime source, complete head, routed shaft and fan verification.':'Bounded coarse-to-fine mechanical search at nominal clinical multiplane angles, with restricted view-family fallback; residuals remeasured with runtime teePose.',patientRegistered:false,presets:Object.freeze(presets)})});
 cache.set(reference,{signature,result});return result;
}
