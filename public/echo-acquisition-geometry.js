/**
 * One acquisition geometry for the measured section and its illustrative probe.
 * A source plane is retained whenever it meets the fixed anatomical window.
 * Otherwise its normal is minimally rotated about the same anatomical target
 * to include a real skin/lumen contact. The resulting plane MUST be resampled;
 * it must not inherit a prepared raster or findings for the old section.
 * No donor voxel, source frame, body transform or organ mesh is modified here.
 */
import {add,mul,dot,cross,norm} from './planes.js';
import {rotateVector,probePhysicalScale} from './probe-geometry.js';
import {teeContextToLocal,teeContextToWorld} from './tee-context-geometry.js';
import {sampleEchoBodySkin,intersectEchoBodySkinPlane,worldToBodyReference} from './echo-anatomy-context-v2.js';
import {createEchoInstrumentClearance} from './echo-instrument-clearance.js';
import {tteApicalGuide} from './echo-tte-guidance.js';

export const ECHO_ACQUISITION_REVISION='echo-acquisition-v6';
/** These Table 2 acquisitions change depth or magnification, not the acoustic
 * footprint. Their measured ROI may move within the shared physical plane. */
export const TTE_ACQUISITION_PARENT=Object.freeze({plax_deep:'plax',plax_av:'plax',plax_mv:'plax',psax_av_zoom:'psax_av',a4c_lv:'a4c',a2c_lv:'a2c',a3c_lv:'a3c'});
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const length=v=>Math.hypot(...v);
const unit=(v,f=[1,0,0])=>length(v)>1e-10?norm(v):[...f];
const off=(v,n)=>sub(v,mul(n,dot(v,n)));
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const mix=(a,b,t)=>add(mul(a,1-t),mul(b,t));
const radians=x=>x*Math.PI/180;
const angle=(a,b)=>{const x=unit(a),y=unit(b);return Math.atan2(length(cross(x,y)),clamp(dot(x,y),-1,1))*180/Math.PI;};
const levelLabel=level=>({'ue':'Upper esophagus','me':'Midesophageal','le':'Lower esophagus','junction':'Gastroesophageal junction','tg':'Transgastric','deep-tg':'Deep transgastric'}[level]||'Illustrative tract');
const skinCandidates=new WeakMap();
const ME_HEIGHT=Object.freeze({me5c:35,me4c:25,mecommissural:25,me2c:25,melax:25,meavlax:35,meaaolax:47,meaaosax:47,merpv:32,meavsax:30,mervinout:28,memodbicaval:28,bicaval:28,mepv:28,melaa:24});
const TG_FRACTION=Object.freeze({tgbasalsax:.35,tgpapillary:.65,tgapicalsax:.85,tgrvbasal:.35,tgrvinout:.55,deeptg5c:.16,tg2c:.65,tgrvin:.65,tglax:.65});

function specimenTargetFit(plane,normal,centerMm,referenceMm){
 if(!plane.anatomyTargetsMm?.length)return {penalty:0,targets:[]};
 const originalMm=mul(plane.center,referenceMm),originalNormal=unit(plane.normal),scale=referenceMm/168.0104;
 const targets=(plane.anatomyTargetsMm||[]).map(target=>{
  const residualMm=Math.abs(dot(sub(target.pointMm,centerMm),normal));
  const signedStartingResidualMm=dot(sub(target.pointMm,originalMm),originalNormal),startingResidualMm=Math.abs(signedStartingResidualMm);
  // A chamber centroid is deliberately outside a basal SAX plane. Rotating
  // toward that centroid must not count as improving the desired section.
  // Retain its witness on the authored plane as well as the anatomical point.
  const sourceWitnessMm=sub(target.pointMm,mul(originalNormal,signedStartingResidualMm));
  const sourceWitnessResidualMm=Math.abs(dot(sub(sourceWitnessMm,centerMm),normal));
  const addedMissMm=Math.max(0,residualMm-startingResidualMm-1.5*scale);
  return {...target,residualMm,startingResidualMm,addedMissMm,sourceWitnessMm,sourceWitnessResidualMm};
 });
 return {penalty:targets.reduce((sum,t)=>sum+(t.weight||1)*((t.addedMissMm/(5*scale))**2+.7*(Math.max(0,t.sourceWitnessResidualMm-1.5*scale)/(5*scale))**2),0),targets};
}

function rotateBasisToNormal(plane,normal){
 const original=unit(plane.normal),axis=cross(original,normal),s=length(axis),c=clamp(dot(original,normal),-1,1);
 if(s<1e-10)return {...plane,normal:[...normal],right:[...plane.right],up:[...plane.up]};
 const turn=Math.atan2(s,c),around=mul(axis,1/s);
 return {...plane,normal:[...normal],right:unit(rotateVector(plane.right,around,turn)),up:unit(rotateVector(plane.up,around,turn))};
}

function planeThroughProbe(plane,originMm,referenceMm){
 const targetMm=mul(plane.center,referenceMm),beam=unit(sub(targetMm,originMm)),original=unit(plane.normal);
 let normal=off(original,beam);
 if(length(normal)<1e-9)normal=cross(beam,plane.right);
 normal=unit(normal);if(dot(normal,original)<0)normal=mul(normal,-1);
 const correctionAngleDeg=angle(original,normal);
 return {plane:rotateBasisToNormal(plane,normal),beam,correctionAngleDeg};
}

function finish(original,accepted,pose,{correctionAngleDeg=0,contactKind,contactAdjusted=false}={}){
 const residual=Math.abs(dot(sub(pose.originMm,mul(accepted.center,pose.referenceMm)),accepted.normal));
 const parallel=Math.abs(dot(unit(pose.normal),unit(accepted.normal)));
 if(residual>1e-5||1-parallel>1e-8)throw new Error('Probe and sampled section must share one physical plane.');
 const adjusted=correctionAngleDeg>1e-6||length(sub(original.center,accepted.center))>1e-8;
 pose.contextFit={...pose.contextFit,resolved:true,estimated:false,registered:false,contactKind,planeResidualMm:residual,normalAngleDeg:0,acquisitionAdjusted:adjusted,correctionAngleDeg,contactAdjusted,clinicalPositionMeasured:false};
 if(original.anatomyTargetsMm?.length){
  const fit=specimenTargetFit(original,accepted.normal,mul(accepted.center,pose.referenceMm),pose.referenceMm);
  pose.contextFit.specimenTargetFit={revision:original.donorCalibration?.revision||original.sourceTargetRevision,targets:fit.targets,maxLandmarkResidualMm:Math.max(0,...fit.targets.map(t=>t.residualMm)),clinicalValidated:false};
 }
 return {...accepted,atlasDerived:original.atlasDerived||adjusted,acquisitionPose:pose,acquisition:{revision:ECHO_ACQUISITION_REVISION,adjusted,correctionAngleDeg,contactKind,planeResidualMm:residual,patientRegistered:false,sourceCenter:[...original.center],sourceNormal:[...original.normal],method:adjusted?'Source data reformatted in the acquisition plane constrained by the fixed anatomical guide.':'Source plane retained; probe contact lies in the same plane.'}};
}

function clinicalMarker(view,beam,model){
 const f=model.frame,group=view.group;
 let local=group==='parasternal-long'?[-1,1,0]:group==='parasternal-short'||group==='suprasternal'?[1,1,0]:[1,0,0];
 if(view.id==='subcostal_ivc'||view.id==='subcostal_hepatic')local=[0,1,0];
 let marker=unit(add(mul(f.left,local[0]),add(mul(f.superior,local[1]),mul(f.anterior,local[2]))));
 if(group==='apical'){
  const anchor=model.bodyWindows.apical.anchorMm,axis=unit(sub(f.originMm,anchor));
  marker=rotateVector(unit(off(f.left,axis),f.superior),axis,radians(view.id.startsWith('a2c')?-60:view.id.startsWith('a3c')?-120:0));
 }
 return unit(off(marker,beam),unit(off(f.superior,beam),f.left));
}

function skinSamples(model,group){
 let cache=skinCandidates.get(model);if(!cache){cache=new Map();skinCandidates.set(model,cache);}
 if(cache.has(group))return cache.get(group);
 const spec=model.bodyWindows[group],out=[],b=spec.referenceBounds;
 const addSample=(x,y)=>{const p=sampleEchoBodySkin(model,x,y);if(p&&p.bodyPointMm.every((v,i)=>v>=b.min[i]-1e-6&&v<=b.max[i]+1e-6))out.push(p);};
 addSample(...spec.anchorXY);
 for(let x=b.min[0];x<=b.max[0];x+=6)for(let y=b.min[1];y<=b.max[1];y+=6)addSample(x,y);
 cache.set(group,out);return out;
}

function resolveTte(plane,view,referenceMm,model,{constrainMarker=true,fourChamberPlane}={}){
 if(!model.skinSurface||!model.bodyWindows)return {...plane,acquisitionPending:true};
 const group=view.group,spec=model.bodyWindows[group];if(!spec?.anchorMm)throw new Error('The reference chest has no contact for this acoustic window.');
 const scale=model.frame.scale,outside=!!plane.outsideScan,forceGenericMarker=constrainMarker&&!plane.donorCalibration&&!plane.preferSourcePlane;
 const guide=constrainMarker?tteApicalGuide({view,model,sourcePlane:plane,referenceMm,fourChamberPlane}):null;
 if(guide){
  const originMm=guide.contact.pointMm,beam=guide.beam,right=mul(guide.markerDirection,-1),poseNormal=unit(cross(beam,right));
  const normal=dot(poseNormal,plane.normal)<0?mul(poseNormal,-1):poseNormal,sourceCenterMm=mul(plane.center,referenceMm);
  const centerMm=sub(sourceCenterMm,mul(normal,dot(sub(sourceCenterMm,originMm),normal)));
  const accepted={...rotateBasisToNormal(plane,normal),center:mul(centerMm,1/referenceMm)},distance=length(sub(guide.targetMm,originMm));
  const pose={referenceMm,originMm,targetMm:guide.targetMm,beam,right,normal:poseNormal,up:mul(beam,-1),instrument:{originMm,beam,right,normal:poseNormal},
   markerDirection:[...guide.markerDirection],markerReference:[...guide.markerDirection],sectorDepthMm:clamp(Math.max(distance+38*scale,length(sub(centerMm,originMm))+20*scale),65*scale,240*scale),
   contextFit:{outsideScan:false,window:view.group,levelLabel:view.position||spec.label,skinPointMm:[...originMm],skinReferencePointMm:[...guide.contact.bodyPointMm],skinNormal:[...guide.contact.normal],skinTriangleIndex:guide.contact.triangleIndex,skinDistanceMm:0,beamInwardDot:dot(beam,guide.contact.normal),markerAgreementDeg:0,distanceMm:0,mode:'shared-apical-acquisition',apicalGuidance:guide.guidance,anatomicalTargetMm:guide.anatomicalTargetMm,anatomicalTargetPlaneResidualMm:guide.anatomicalTargetMm?Math.abs(dot(sub(guide.anatomicalTargetMm,originMm),normal)):undefined}};
  return finish(plane,accepted,pose,{correctionAngleDeg:angle(plane.normal,normal),contactKind:'reference-skin'});
 }
 const specials={subcostal_ivc:[-26,-16,9],subcostal_hepatic:[-34,-73,1],ssn_arch:[-18,72,-13]};
 const targetMm=outside?teeContextToWorld(specials[view.id]||[0,0,0],model.frame):mul(plane.center,referenceMm);
 const reference=outside?{...plane,center:mul(targetMm,1/referenceMm)}:plane;
 const segments=intersectEchoBodySkinPlane(model,{centerMm:targetMm,normal:plane.normal},{windowId:group});
 let best=null;
 const inspect=(contact,exact)=>{
  const originMm=contact.pointMm,delta=sub(targetMm,originMm),distance=length(delta),beam=unit(delta);
  if(distance<15*scale||dot(beam,contact.normal)>-.025)return;
  let projected;
  if(forceGenericMarker){
   const right=mul(clinicalMarker(view,beam,model),-1);let normal=unit(cross(beam,right));if(dot(normal,reference.normal)<0)normal=mul(normal,-1);
   projected={plane:rotateBasisToNormal(reference,normal),beam,correctionAngleDeg:angle(reference.normal,normal)};
  }else projected=exact?{plane:reference,beam,correctionAngleDeg:0}:planeThroughProbe(reference,originMm,referenceMm);
  const q=contact.bodyPointMm,anchor=spec.referenceAnchorMm,location=((q[0]-anchor[0])/30)**2+((q[1]-anchor[1])/35)**2;
  const targetFit=specimenTargetFit(reference,projected.plane.normal,mul(projected.plane.center,referenceMm),referenceMm);
  const marker=clinicalMarker(view,beam,model),sourceRight=unit(cross(projected.plane.normal,beam)),markerError=Math.min(angle(sourceRight,marker),angle(mul(sourceRight,-1),marker));
  const cost=(outside?0:projected.correctionAngleDeg**2/100)+location+3*targetFit.penalty+(plane.donorCalibration&&!outside ? .12*(markerError/35)**2 : 0);
  if(!best||cost<best.cost)best={...projected,contact,originMm,distance,cost};
 };
 for(const segment of segments){
  const d=sub(segment.bMm,segment.aMm),t=clamp(dot(sub(spec.anchorMm,segment.aMm),d)/dot(d,d),0,1),pointMm=mix(segment.aMm,segment.bMm,t);
  inspect({...segment,pointMm,bodyPointMm:worldToBodyReference(pointMm,model)},true);
 }
 if(forceGenericMarker||!best)for(const contact of skinSamples(model,group))inspect(contact,false);
 if(!best)throw new Error('No inward-facing skin contact is available in this reference window.');
 const {originMm,beam,contact}=best,marker=clinicalMarker(view,beam,model);
 let right=unit(cross(best.plane.normal,beam));if(dot(mul(right,-1),marker)<0)right=mul(right,-1);
 const normal=unit(cross(beam,right)),pose={referenceMm,originMm,targetMm,beam,right,normal,up:mul(beam,-1),instrument:{originMm,beam,right,normal},
  markerDirection:mul(right,-1),markerReference:marker,sectorDepthMm:clamp(best.distance+38*scale,65*scale,240*scale),
  contextFit:{outsideScan:outside,window:group,levelLabel:view.position||spec.label,skinPointMm:[...originMm],skinReferencePointMm:[...contact.bodyPointMm],skinNormal:[...contact.normal],skinTriangleIndex:contact.triangleIndex,skinDistanceMm:0,beamInwardDot:dot(beam,contact.normal),markerAgreementDeg:angle(mul(right,-1),marker),distanceMm:0,mode:'skin-plane-constrained'}};
 return finish(plane,best.plane,pose,{correctionAngleDeg:best.correctionAngleDeg,contactKind:'reference-skin'});
}

function interpolatedSample(a,b,t,index){
 return {...a,pointMm:mix(a.pointMm,b.pointMm,t),tangent:unit(mix(a.tangent,b.tangent,t)),arcMm:a.arcMm+(b.arcMm-a.arcMm)*t,insertionCm:a.insertionCm+(b.insertionCm-a.insertionCm)*t,radialClearanceHintMm:Math.min(a.radialClearanceHintMm,b.radialClearanceHintMm),pathIndex:index,level:t<.5?a.level:b.level};
}
function routeShaft(model,sample,headCenterMm,shaft,scale){
 const endArc=Math.max(0,sample.arcMm-24*scale),proximal=model.tractSamples.filter(s=>s.arcMm<=endArc),start=proximal.at(-1)||model.tractSamples[0];
 const p0=start.pointMm,p1=add(p0,mul(start.tangent,12*scale)),p2=add(headCenterMm,mul(shaft,-9*scale)),points=proximal.map(s=>[...s.pointMm]);
 for(let i=0;i<=24;i++){const t=i/24,q=1-t;points.push(add(add(mul(p0,q*q*q),mul(p1,3*q*q*t)),add(mul(p2,3*q*t*t),mul(headCenterMm,t*t*t))));}
 return points;
}

function resolveTee(plane,view,referenceMm,model,{clinicalDefaults=true}={}){
 if(!model.tractSamples?.length)return {...plane,acquisitionPending:true};
 const scale=probePhysicalScale(referenceMm),outside=!!plane.outsideScan||view.aseNumber>=25,isArch=view.aseNumber>=27,isTg=view.group==='tg',deep=view.id==='deeptg5c';
 const allowed=outside?(isArch?['ue']:['le']):isTg?(deep?['deep-tg']:['junction','tg','deep-tg']):['me'];
 const pool=isTg?model.gastricInteriorSamples:model.tractSamples,samples=pool.filter(s=>allowed.includes(s.level)),path=model.tractSamples;
 const preferredSamples=path.filter(s=>allowed.includes(s.level)),arcStart=preferredSamples[0]?.arcMm||0,arcEnd=preferredSamples.at(-1)?.arcMm||arcStart;
 const preferredArc=arcStart+(arcEnd-arcStart)*(TG_FRACTION[view.id]??.5),preferredHeight=outside?(isArch?77:teeContextToLocal(model.landmarksMm.hiatus,model.frame)[1]+18):(ME_HEIGHT[view.id]??28);
 const centerMm=mul(plane.center,referenceMm),normal=unit(plane.normal),multiplaneDeg=Number(view.angleDefault)||0;
 // The deep-TG guide targets the reviewed valve/root level. The retained
 // upstream lumen is only a fallback when a source root is unavailable.
 const anatomy=model.frame.landmarksMm,aorticGuide=anatomy?.aorticRoot||anatomy?.aorticLumen,apicalGuide=deep&&clinicalDefaults&&anatomy?.apex&&aorticGuide;
 // The gastric fundus can graze a basal SAX section. A small change in its
 // level is preferable to rotating that transverse section into a long-axis
 // cut. This bounded search is only for the authored specimen basal preset;
 // manual sections and other families retain their explicit source plane.
 const basalPlaneSearch=clinicalDefaults&&!!plane.donorCalibration&&view.id==='tgbasalsax';
 const preserveSourceTargets=clinicalDefaults&&(plane.preferSourcePlane===true||view.id==='tgrvinout');
 // Budget distances are physical millimetres supplied with the source
 // targets. Defaults are scaled only when a preset has no explicit budget.
 const sourceLimits=plane.acquisitionTargetBudget||{};
 const maxAddedTargetMissMm=sourceLimits.maxAddedMissMm??5*scale,maxSourceWitnessMissMm=sourceLimits.maxSourceWitnessResidualMm??8*scale;
 const maxSourceNormalChangeDeg=sourceLimits.maxCorrectionAngleDeg??20;
 let anatomyRejected=0;
 const candidates=[];
 const inspect=(s,headCenterMm,exact=false,contactAdjusted=false,sourceNormalOffsetMm=0,maxNormalChangeDeg=Infinity)=>{
  const sectionCenterMm=sourceNormalOffsetMm?add(centerMm,mul(normal,sourceNormalOffsetMm)):centerMm;
  const targetMm=apicalGuide?aorticGuide:outside?add(headCenterMm,isArch?add(mul(model.frame.anterior,30*scale),mul(model.frame.left,5*scale)):add(mul(model.frame.left,22*scale),mul(model.frame.posterior,14*scale))):sectionCenterMm;
  const reference=apicalGuide?{...plane,center:mul(mix(anatomy.apex,aorticGuide,.5),1/referenceMm)}:outside?{...plane,center:mul(targetMm,1/referenceMm)}:sourceNormalOffsetMm?{...plane,center:mul(sectionCenterMm,1/referenceMm)}:plane;
  const v=sub(targetMm,headCenterMm),distance=length(v);if(distance<12*scale)return;
  const beam=unit(v),geometric=exact&&!outside?{plane:reference,beam,correctionAngleDeg:0}:planeThroughProbe(reference,headCenterMm,referenceMm);
  if(geometric.correctionAngleDeg>maxNormalChangeDeg)return;
  const originMm=add(headCenterMm,mul(beam,3*scale));
  let normals;
  if(apicalGuide){
   const near=sub(anatomy.apex,headCenterMm),nearDepth=dot(near,beam);if(nearDepth<8*scale||nearDepth>distance-8*scale)return;
   let n=cross(near,v);if(length(n)<1e-8)n=cross(v,sub(anatomy.mitralRegion,headCenterMm));n=unit(n);if(dot(n,normal)<0)n=mul(n,-1);normals=[n];
  }else if(sourceNormalOffsetMm){
   // Offset candidates only test the minimum-rotation section. The broader
   // nominal-angle alternatives were already searched at the authored level.
   normals=[geometric.plane.normal];
  }else{
   // A plane-only solution can demand a head that cuts through the organ.
   // Also rank orientations toward the actual tract tangent at the nominal
   // electronic angle. These alternatives still reformat the same target.
   const shaft=unit(off(s.tangent,beam),model.frame.superior),mechanicalRight=unit(cross(beam,shaft));
   const clinicalRight=unit(rotateVector(mechanicalRight,beam,radians(multiplaneDeg)));
   let clinicalNormal=unit(cross(beam,clinicalRight));if(dot(clinicalNormal,geometric.plane.normal)<0)clinicalNormal=mul(clinicalNormal,-1);
   const n0=geometric.plane.normal,turn=Math.atan2(dot(beam,cross(n0,clinicalNormal)),dot(n0,clinicalNormal));
   normals=[0,.25,.5,.75,1].map(t=>unit(rotateVector(n0,beam,turn*t)));
  }
  for(const n of normals)for(const rayTurn of apicalGuide?[0]:[0,-8,8,-16,16,-24,24,-32,32]){
   const accepted=rotateBasisToNormal(reference,n),correctionAngleDeg=angle(normal,n);
   if(correctionAngleDeg>maxNormalChangeDeg)continue;
   const acousticBeam=unit(rotateVector(beam,n,radians(rayTurn))),faceMm=add(headCenterMm,mul(acousticBeam,3*scale));
   const roiDelta=sub(targetMm,faceMm),roiAngle=angle(roiDelta,acousticBeam),roiDepth=dot(roiDelta,acousticBeam);
   if(roiAngle>37.5||roiDepth<=8*scale)continue;
   const apexAngle=apicalGuide?angle(sub(anatomy.apex,faceMm),acousticBeam):null;
   if(apicalGuide&&(apexAngle>37.5||dot(sub(anatomy.apex,faceMm),acousticBeam)<=5*scale))continue;
   let right=unit(cross(n,acousticBeam)),mechanicalRight=unit(rotateVector(right,acousticBeam,-radians(multiplaneDeg))),shaft=unit(mul(cross(acousticBeam,mechanicalRight),-1));
   const sign=dot(shaft,s.tangent)<0?-1:1;right=mul(right,sign);mechanicalRight=mul(mechanicalRight,sign);shaft=mul(shaft,sign);
   const bendDeg=angle(shaft,s.tangent),location=isTg?((s.arcMm-preferredArc)/(28*scale))**2:((teeContextToLocal(headCenterMm,model.frame)[1]-preferredHeight)/22)**2;
   const lvotAngle=apicalGuide&&anatomy.leftVentricle?angle(acousticBeam,sub(aorticGuide,anatomy.leftVentricle)):0;
   const mitralMiss=apicalGuide?Math.abs(dot(sub(anatomy.mitralRegion,headCenterMm),n))/scale:0;
   // Always compare with the original authored targets, including when the
   // candidate plane was translated. A shifted reference must not reset its
   // anatomical loss or its source-patch witness baseline to zero.
   const targetFit=specimenTargetFit(plane,n,mul(accepted.center,referenceMm),referenceMm);
   if(preserveSourceTargets){
    const critical=targetFit.targets.filter(t=>t.critical!==false);
    const losesTarget=correctionAngleDeg>maxSourceNormalChangeDeg||critical.some(t=>
     t.residualMm-t.startingResidualMm>(t.maxAddedMissMm??maxAddedTargetMissMm)||
     t.sourceWitnessResidualMm>(t.maxSourceWitnessResidualMm??t.maxSourceWitnessMm??maxSourceWitnessMissMm));
    if(losesTarget){anatomyRejected++;continue;}
   }
   const offsetPenalty=.25*(sourceNormalOffsetMm/(4*scale))**2;
   const cost=(apicalGuide?(lvotAngle/20)**2+(mitralMiss/15)**2+.2*(bendDeg/60)**2+.04*location:correctionAngleDeg**2/(basalPlaneSearch?36:64)+.18*location+.025*(bendDeg/60)**2+.025*((distance-60*scale)/(60*scale))**2+.10*(rayTurn/16)**2)+3*targetFit.penalty+offsetPenalty;
   const rayTargetMm=rayTurn?add(faceMm,mul(acousticBeam,distance-3*scale)):targetMm;
   candidates.push({plane:accepted,beam:acousticBeam,correctionAngleDeg,s,headCenterMm,originMm:faceMm,targetMm:rayTargetMm,roiTargetMm:targetMm,roiAngle,apexAngle,rayTurn,right,mechanicalRight,shaft,bendDeg,distance,cost,contactAdjusted,sourceNormalOffsetMm,apicalGuide:!!apicalGuide,lvotAngle,mitralMiss});
  }
 };
 for(const s of samples){
  if((s.radialClearanceHintMm||0)<4*scale)continue;
  const residual=dot(sub(s.pointMm,centerMm),normal),limit=Math.max(0,(s.radialClearanceHintMm||4*scale)-4*scale);
  // A sphere of this radius fits within the local elliptical lumen. Reserve
  // four model millimetres for the head instead of snapping onto an organ wall.
  if(!outside&&Math.abs(residual)<=limit+1e-8)inspect(s,sub(s.pointMm,mul(normal,residual)),true,Math.abs(residual)>1e-8);
  inspect(s,[...s.pointMm],false);
 }
 for(let i=0;i<path.length-1;i++){
  const a=path[i],b=path[i+1];if(!allowed.includes(a.level)||!allowed.includes(b.level))continue;
  const da=dot(sub(a.pointMm,centerMm),normal),db=dot(sub(b.pointMm,centerMm),normal);
  if(!outside&&da*db<=0&&Math.abs(da-db)>1e-12){const t=da/(da-db),s=interpolatedSample(a,b,t,i);inspect(s,s.pointMm,true);}
 }
 if(basalPlaneSearch)for(const offset of [-2,2,-4,4,-6,6]){
  const shift=offset*scale,shiftedCenter=add(centerMm,mul(normal,shift));
  for(const s of samples){
   if((s.radialClearanceHintMm||0)<4*scale)continue;
   const residual=dot(sub(s.pointMm,shiftedCenter),normal),limit=Math.max(0,(s.radialClearanceHintMm||4*scale)-4*scale);
   if(Math.abs(residual)<=limit+1e-8)inspect(s,sub(s.pointMm,mul(normal,residual)),true,Math.abs(residual)>1e-8,shift,12);
   // The angle bound rejects remote stomach positions before allocating
   // normal/ray candidates. No additional organ samples or meshes are made.
   inspect(s,[...s.pointMm],false,false,shift,12);
  }
 }
 const clearance=createEchoInstrumentClearance(model);
 const selectContained=()=>{
  candidates.sort((a,b)=>a.cost-b.cost);
  for(const candidate of candidates){
   const instrument={originMm:candidate.originMm,beam:candidate.beam,right:candidate.mechanicalRight,normal:mul(candidate.shaft,-1)};
   const headFit=clearance(instrument,scale);if(!headFit.inside)continue;
   const shaftPoints=routeShaft(model,candidate.s,candidate.headCenterMm,candidate.shaft,scale),shaftFit=clearance.route(shaftPoints,1.8*scale);
   if(!shaftFit.inside)continue;
   return {...candidate,shaftPoints,headFit,shaftFit};
  }
  return null;
 };
 let best=selectContained();
 if(!best&&!isTg){
  // A centreline is not the entire lumen. Small radial translations are
  // legitimate only when the complete drawn head AND shaft still fit the
  // unchanged wall. Do not shift the body or relax that collision check.
  candidates.length=0;
  for(const s of samples)for(const radius of [1,2])for(let i=0;i<8;i++){
   const t=i*Math.PI/4,point=add(s.pointMm,add(mul(s.right,radius*scale*Math.cos(t)),mul(s.beam,radius*scale*Math.sin(t))));
   if(clearance.point(point).inside)inspect(s,point,false,true);
  }
  best=selectContained();
 }
 if(!best)return {...plane,acquisitionUnavailable:true,acquisition:{revision:ECHO_ACQUISITION_REVISION,adjusted:false,patientRegistered:false,
  sourcePlaneRetained:true,sourceConstraintRejectedCandidates:anatomyRejected,
  sourceTargetBudget:preserveSourceTargets?{maxAddedMissMm:maxAddedTargetMissMm,maxSourceWitnessResidualMm:maxSourceWitnessMissMm,maxCorrectionAngleDeg:maxSourceNormalChangeDeg}:undefined,
  reason:preserveSourceTargets&&anatomyRejected?'No contained probe pose preserves this source section within its anatomical target limits. The original source CT plane is retained.':'No full-head-contained pose is available for this section in the fixed reference tract.'}};
 const {originMm,beam,right,shaft,mechanicalRight,headCenterMm,s}=best;
 const pose={referenceMm,originMm,targetMm:best.targetMm,beam,right,normal:unit(cross(beam,right)),up:mul(beam,-1),multiplaneDeg,
  shaftPoints:best.shaftPoints,instrument:{originMm,beam,right:mechanicalRight,shaft,normal:mul(shaft,-1)},sectorDepthMm:clamp(best.distance+35*scale,65*scale,240*scale),
  contextFit:{outsideScan:outside,mode:'lumen-plane-constrained',level:s.level,levelLabel:levelLabel(s.level),insertionCm:s.insertionCm,headCenterMm:[...headCenterMm],tractSampleMm:[...s.pointMm],tractArcMm:s.arcMm,tractOffsetMm:length(sub(headCenterMm,s.pointMm)),clearanceHintMm:s.radialClearanceHintMm,shaftBendDeg:best.bendDeg,clinicalDepthMeasured:false,distanceMm:0,headContained:true,shaftContained:true,shaftClearanceMm:best.shaftFit.clearanceMm,roiTargetMm:best.roiTargetMm,roiTargetAngleDeg:best.roiAngle,rayTurnDeg:best.rayTurn,sourceNormalOffsetMm:best.sourceNormalOffsetMm,sourceNormalOffsetLimitMm:basalPlaneSearch?6*scale:0,apicalGuide:best.apicalGuide,apexAngleDeg:best.apexAngle,apexPlaneResidualMm:apicalGuide?Math.abs(dot(sub(anatomy.apex,mul(best.plane.center,referenceMm)),best.plane.normal)):undefined,lvotProxyAngleDeg:apicalGuide?best.lvotAngle:undefined,targetKind:outside?'illustrative extracardiac target':apicalGuide?'approximate apex and aortic-region guide':'source regional target inside scan sector'}};
 return finish(plane,best.plane,pose,{correctionAngleDeg:best.correctionAngleDeg,contactKind:isTg?'reference-gastric-lumen':'reference-esophageal-lumen',contactAdjusted:best.contactAdjusted});
}

/** Input/output lengths are normalized donor units; probe and context use mm. */
export function resolveEchoAcquisitionPlane({plane,view,referenceMm,contextModel,constrainMarker=true,fourChamberPlane}){
 if(!plane||!view||!contextModel||!(referenceMm>0))return plane;
 return view.mode==='tte'?resolveTte(plane,view,referenceMm,contextModel,{constrainMarker,fourChamberPlane}):resolveTee(plane,view,referenceMm,contextModel,{clinicalDefaults:constrainMarker});
}

export function reframeEchoAcquisitionPlane(parent,requested,{parentId}={}){
 if(!parent?.acquisitionPose)return {...requested,acquisitionPending:true};
 const normal=parent.normal,center=sub(requested.center,mul(normal,dot(sub(requested.center,parent.center),normal)));
 const pose={...parent.acquisitionPose,contextFit:{...parent.acquisitionPose.contextFit,acquisitionParent:parentId}};
 const accepted={...requested,center,right:[...parent.right],up:[...parent.up],normal:[...normal]};
 const result=finish(requested,accepted,pose,{correctionAngleDeg:angle(requested.normal,normal),contactKind:pose.contextFit.contactKind});
 result.acquisition={...result.acquisition,reframedFrom:parentId,beamTargetIsRoiCenter:false};
 return result;
}

/** Probe-anchored camera: the acoustic face is at the top of the displayed
 * sector; its forward beam points down. This is camera-only, with no new CT
 * reflection, clipping-half change or resampling when the anchor is toggled.
 */
export function echoProbeCamera(plane,{flip=false,aspect=1,focusPoints=[]}={}){
 const pose=plane?.acquisitionPose;if(!pose)return null;
 const up=mul(pose.beam,-1),face=unit(cross(plane.right,plane.up)),away=mul(face,flip?-1:1),forward=mul(away,-1),right=unit(cross(forward,up));
 const centerMm=mul(plane.center,pose.referenceMm),targetMm=mix(centerMm,pose.originMm,.20),points=[pose.originMm,centerMm,...focusPoints];
 for(const x of [-.5,.5])for(const y of [-.5,.5])points.push(mul(add(plane.center,add(mul(plane.right,x*plane.width),mul(plane.up,y*plane.height))),pose.referenceMm));
 let distanceMm=1.55*pose.referenceMm;
 for(const p of points){const q=sub(p,targetMm),z=dot(q,forward);distanceMm=Math.max(distanceMm,Math.abs(dot(q,right))/(.285*Math.max(.25,aspect))-z,Math.abs(dot(q,up))/.285-z);}
 return {forward,right,up,targetMm,distanceMm};
}

/** A fixed upright thoracic camera. Fit the real transformed focus points,
 * never the larger world-axis bounding box or the full proximal esophagus. */
export function echoAnatomyCamera(model,aspect=1){
 const away=unit(model.camera.preferredAway),forward=mul(away,-1),right=unit(cross(forward,model.frame.superior)),up=unit(cross(right,forward));
 const targetMm=teeContextToWorld([5,model.tractSamples?-14:0,5],model.frame),points=model.focusPointsMm||[];
 const anchors=Object.values(model.landmarksMm||{}),focus=[...points,...anchors];
 let distanceMm=1.8*model.referenceMm;
 for(const p of focus){const q=sub(p,targetMm),z=dot(q,forward);distanceMm=Math.max(distanceMm,Math.abs(dot(q,right))*1.04/(.32*Math.max(.25,aspect))-z,Math.abs(dot(q,up))*1.04/.32-z);}
 return {forward,right,up,targetMm,distanceMm};
}
