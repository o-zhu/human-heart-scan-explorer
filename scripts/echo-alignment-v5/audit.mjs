/** Independent quantitative audit of the production Echo plane/probe contract.
 * Run from the repository root. --repo can point to a frozen source snapshot.
 * This instruments controller handoffs; it does not claim a GPU render or
 * patient registration. Measurements deliberately use independent vector math.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {evaluateSkinContact} from './surface-checks.mjs';

const add=(a,b)=>a.map((v,i)=>v+b[i]);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const scale=(a,s)=>a.map(v=>v*s);
const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const length=a=>Math.hypot(...a);
const unit=a=>{const n=length(a);return n>1e-12?scale(a,1/n):[0,0,0];};
const clamp=(x,a=-1,b=1)=>Math.max(a,Math.min(b,x));
const deg=x=>x*180/Math.PI;
const angle=(a,b)=>deg(Math.acos(clamp(dot(unit(a),unit(b)))));
const planeAngle=(a,b)=>deg(Math.acos(clamp(Math.abs(dot(unit(a),unit(b))),0,1)));
const signedAngle=(a,b,axis)=>deg(Math.atan2(dot(unit(axis),cross(unit(a),unit(b))),dot(unit(a),unit(b))));
const mix=(a,b,t)=>add(scale(a,1-t),scale(b,t));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const median=xs=>{const x=[...xs].sort((a,b)=>a-b);return x.length?(x[Math.floor((x.length-1)/2)]+x[Math.ceil((x.length-1)/2)])/2:null;};
const percentile=(xs,p)=>{const x=[...xs].sort((a,b)=>a-b);return x.length?x[Math.min(x.length-1,Math.ceil(x.length*p)-1)]:null;};
const EMM=1e-5,EDEG=1e-4;
const planeSignature=plane=>JSON.stringify(plane&&Object.fromEntries(['center','right','up','normal','width','height','outsideScan'].map(k=>[k,k==='outsideScan'?!!plane[k]:plane[k]])));

export function evaluatePlanePose(plane,pose,referenceMm,{halfAngleDeg=38,outside=false}={}){
  if(!(referenceMm>0)||!(pose?.sectorDepthMm>0))throw new TypeError('Audit needs positive physical scale and sector depth.');
  for(const [label,value] of Object.entries({center:plane?.center,planeNormal:plane?.normal,planeRight:plane?.right,planeUp:plane?.up,origin:pose?.originMm,beam:pose?.beam,right:pose?.right,poseNormal:pose?.normal})){
    if(value?.length!==3||!Array.from(value).every(Number.isFinite))throw new TypeError(`Audit needs a finite ${label} vector.`);
    if(!['center','origin'].includes(label)&&length(value)<1e-9)throw new TypeError(`Audit needs a nonzero ${label} direction.`);
  }
  const n=unit(plane.normal),center=scale(plane.center,referenceMm);
  const sectorNormal=unit(cross(pose.beam,pose.right));
  const distance=point=>dot(sub(point,center),n);
  const points=[pose.originMm];
  for(const fraction of [.25,.5,1])for(let i=0;i<=48;i++){
    const a=(-halfAngleDeg+2*halfAngleDeg*i/48)*Math.PI/180,d=pose.sectorDepthMm*fraction;
    points.push(add(pose.originMm,add(scale(pose.beam,Math.cos(a)*d),scale(pose.right,Math.sin(a)*d))));
  }
  const residual=Math.abs(distance(pose.originMm));
  const sectorAngle=planeAngle(sectorNormal,n);
  const target=pose.targetMm||center,targetDelta=sub(target,pose.originMm);
  const beamAlong=dot(targetDelta,unit(pose.beam));
  const beamMiss=length(sub(targetDelta,scale(unit(pose.beam),beamAlong)));
  const roiDelta=sub(center,pose.originMm),roiForward=dot(roiDelta,unit(pose.beam)),roiLateral=dot(roiDelta,unit(pose.right));
  const roiAngleDeg=deg(Math.atan2(Math.abs(roiLateral),roiForward)),roiRangeMm=length(roiDelta);
  const displayNormal=unit(cross(plane.right,plane.up));
  const marker=pose.instrument?.right?scale(unit(pose.instrument.right),-1):null;
  const markerReference=pose.markerReference&&unit(pose.markerReference);
  const core={
    originPlaneResidualMm:residual,
    sectorPlaneAngleDeg:sectorAngle,
    maxFanVertexResidualMm:Math.max(...points.map(p=>Math.abs(distance(p)))),
    beamTargetMissMm:beamMiss,beamTargetForwardMm:beamAlong,
    targetPlaneResidualMm:Math.abs(distance(target)),
    roiCenterAngleFromBeamDeg:roiAngleDeg,roiCenterRangeMm:roiRangeMm,
    roiCenterWithinSector:roiForward>0&&roiAngleDeg<=halfAngleDeg+EDEG&&roiRangeMm<=pose.sectorDepthMm+EMM,
    originNearFieldMm:dot(sub(pose.originMm,center),plane.up),
    beamVsImageDownDeg:angle(pose.beam,scale(plane.up,-1)),
    displayedBasisHandedness:dot(displayNormal,n),
    sectorVsDisplayedNormalSignedDot:dot(sectorNormal,displayNormal),
    sectorVsDisplayedRightDeg:angle(pose.right,plane.right),
    reportedNormalVsSectorDeg:planeAngle(pose.normal,sectorNormal),
    orthogonalityError:Math.max(Math.abs(dot(pose.beam,pose.right)),Math.abs(length(pose.beam)-1),Math.abs(length(pose.right)-1)),
    markerReferenceAngleDeg:marker&&markerReference?angle(marker,markerReference):null,
    markerReportedAngleDeg:marker&&pose.markerDirection?angle(marker,pose.markerDirection):null,
  };
  return {outsideScan:outside,ctComparisonApplicable:!outside,
    coplanar:!outside&&residual<=EMM&&sectorAngle<=EDEG&&core.maxFanVertexResidualMm<=EMM,
    ...(!outside?core:{placeholderPlaneDiagnostics:core})};
}

/** Smallest plane-normal change that includes a fixed origin and CT center.
 * The source center stays fixed; the normal is projected perpendicular to the
 * origin-to-center line. This is a lower bound, not a claim of target anatomy.
 */
export function minimumCenterPreservingCorrection(plane,originMm,referenceMm){
  const n=unit(plane.normal),v=sub(originMm,scale(plane.center,referenceMm)),d=length(v);
  if(d<1e-9)return {angleDeg:0,normal:[...n],originDistanceMm:0};
  const b=scale(v,1/d),projected=sub(n,scale(b,dot(n,b)));
  return {angleDeg:deg(Math.asin(clamp(Math.abs(dot(n,b)),0,1))),
    normal:length(projected)>1e-9?unit(projected):null,originDistanceMm:d};
}

function tractAudit(plane,view,model,referenceMm,strict=false){
  const gastric=view.group==='tg',deep=view.id==='deeptg5c';
  const levels=gastric?(strict?[deep?'deep-tg':'tg']:['junction','tg','deep-tg']):(strict?['me']:['me','le']);
  const n=unit(plane.normal),center=scale(plane.center,referenceMm),distance=p=>dot(sub(p,center),n);
  const candidates=(gastric&&model.gastricInteriorSamples?.length?model.gastricInteriorSamples:model.tractSamples).filter(s=>levels.includes(s.level));
  const curve=model.tractSamples.filter(s=>levels.includes(s.level));
  const describe=s=>({pointMm:s.pointMm,level:s.level,arcMm:s.arcMm,pathIndex:s.pathIndex??null,
    signedResidualMm:distance(s.pointMm),residualMm:Math.abs(distance(s.pointMm)),
    correction:minimumCenterPreservingCorrection(plane,s.pointMm,referenceMm),
    radialClearanceHintMm:s.radialClearanceHintMm});
  const sorted=candidates.map(describe).sort((a,b)=>a.residualMm-b.residualMm);
  const byCorrection=[...sorted].sort((a,b)=>a.correction.angleDeg-b.correction.angleDeg);
  const centerlineCrossings=[];
  for(let i=1;i<model.tractSamples.length;i++){
    const a=model.tractSamples[i-1],b=model.tractSamples[i];
    if(!levels.includes(a.level)||!levels.includes(b.level))continue;
    const da=distance(a.pointMm),db=distance(b.pointMm);
    if(da*db>0||Math.abs(da-db)<1e-12)continue;
    const t=da/(da-db),p=mix(a.pointMm,b.pointMm,t);
    centerlineCrossings.push({pointMm:p,segment:[i-1,i],fraction:t,
      arcMm:a.arcMm*(1-t)+b.arcMm*t,residualMm:Math.abs(distance(p)),
      correction:minimumCenterPreservingCorrection(plane,p,referenceMm)});
  }
  // Samples at the same gastric path index lie inside one convex cross-section.
  // Interpolating a signed crossing between them stays inside that sampled disk.
  const rings=new Map();
  if(gastric)for(const s of candidates){const ring=rings.get(s.pathIndex)||[];ring.push(s);rings.set(s.pathIndex,ring);}
  const gastricDiskCrossings=[];
  for(const [pathIndex,ss] of rings){
    const ordered=ss.map(s=>({s,d:distance(s.pointMm)})).sort((a,b)=>a.d-b.d),a=ordered[0],b=ordered.at(-1);
    if(a.d>0||b.d<0||Math.abs(a.d-b.d)<1e-12)continue;
    const t=a.d/(a.d-b.d),p=mix(a.s.pointMm,b.s.pointMm,t);
    gastricDiskCrossings.push({pathIndex,pointMm:p,residualMm:Math.abs(distance(p))});
  }
  // Conservative circular lumen cross-section, protecting a 3.3*scale head
  // radius. This tests feasibility; a full physical head collision test is
  // separate and cannot be inferred from the head-center point alone.
  const protectedLumenCrossings=[];
  for(const s of curve){
    const tangent=unit(s.tangent),q=sub(n,scale(tangent,dot(n,tangent))),q2=dot(q,q);
    if(q2<1e-12)continue;
    const delta=scale(q,-distance(s.pointMm)/q2),radius=Math.max(0,(s.radialClearanceHintMm||0)-3.3*model.frame.scale);
    if(length(delta)>radius+EMM)continue;
    const p=add(s.pointMm,delta);
    protectedLumenCrossings.push({pointMm:p,level:s.level,arcMm:s.arcMm,headCenterShiftMm:length(delta),availableRadiusMm:radius,residualMm:Math.abs(distance(p))});
  }
  return {levels,sampleCount:candidates.length,nearestSample:sorted[0]||null,
    minimumRotationSample:byCorrection[0]||null,
    signedRangeMm:sorted.length?[Math.min(...sorted.map(x=>x.signedResidualMm)),Math.max(...sorted.map(x=>x.signedResidualMm))]:null,
    centerlineCrossings,gastricDiskCrossings,protectedLumenCrossings,
    sampledInteriorIntersection:centerlineCrossings.length>0||gastricDiskCrossings.length>0||protectedLumenCrossings.length>0};
}

const adjustmentCases=referenceMm=>[
  {name:'baseline'}, {name:'retained-half-flipped',flip:true},
  {name:'offset-plus10',offsetMm:10},{name:'offset-minus10',offsetMm:-10},
  {name:'rotation-plus15',rotationDeg:15},{name:'rotation-minus15',rotationDeg:-15},
  {name:'tilt-plus10',tiltDeg:10},{name:'tilt-minus10',tiltDeg:-10},
  {name:'combined',offsetMm:12,rotationDeg:20,tiltDeg:15},
  {name:'offset-positive-limit',offsetMm:35*referenceMm/168.0104},
  {name:'offset-negative-limit',offsetMm:-35*referenceMm/168.0104},
  {name:'rotation-positive-limit',rotationDeg:90},{name:'rotation-negative-limit',rotationDeg:-90},
  {name:'tilt-positive-limit',tiltDeg:45},{name:'tilt-negative-limit',tiltDeg:-45},
];

function aggregate(rows){
  const acquired=rows.filter(r=>r.metrics.ctComparisonApplicable),measured=acquired.filter(r=>r.metrics.poseAvailable!==false),bad=measured.filter(r=>!r.metrics.coplanar);
  return {cases:rows.length,acquired:acquired.length,outside:rows.length-acquired.length,misaligned:bad.length,
    unavailable:rows.filter(r=>r.metrics.poseAvailable===false).length,
    maxOriginResidualMm:Math.max(0,...measured.map(r=>r.metrics.originPlaneResidualMm)),
    medianOriginResidualMm:median(measured.map(r=>r.metrics.originPlaneResidualMm)),
    maxSectorAngleDeg:Math.max(0,...measured.map(r=>r.metrics.sectorPlaneAngleDeg)),
    maxFanResidualMm:Math.max(0,...measured.map(r=>r.metrics.maxFanVertexResidualMm)),
    handoffMismatches:rows.filter(r=>!r.handoff.consistent).length,
    skinContactFailures:rows.filter(r=>r.skin?.applicable&&(!r.skin.contact||!r.skin.withinFixedWindow||!r.skin.inwardBeam)).length,
    beamTargetFailures:measured.filter(r=>r.metrics.beamTargetMissMm>EMM||r.metrics.beamTargetForwardMm<=0).length,
    roiCenterOutsideSector:measured.filter(r=>!r.metrics.roiCenterWithinSector).length,
    defaultMarkerFailures:measured.filter(r=>r.mode==='tte'&&r.adjustment==='baseline'&&r.metrics.markerReferenceAngleDeg!==null&&r.metrics.markerReferenceAngleDeg>EDEG).length,
    controllerSolveMs:{median:median(rows.map(r=>r.controllerSolveMs)),p95:percentile(rows.map(r=>r.controllerSolveMs),.95),max:Math.max(0,...rows.map(r=>r.controllerSolveMs))},
    worstOrigin:bad.toSorted((a,b)=>b.metrics.originPlaneResidualMm-a.metrics.originPlaneResidualMm).slice(0,5).map(r=>({id:r.id,adjustment:r.adjustment,mm:r.metrics.originPlaneResidualMm})),
    worstAngle:bad.toSorted((a,b)=>b.metrics.sectorPlaneAngleDeg-a.metrics.sectorPlaneAngleDeg).slice(0,5).map(r=>({id:r.id,adjustment:r.adjustment,degrees:r.metrics.sectorPlaneAngleDeg}))};
}

export async function runAudit({repo=process.cwd(),includeAdjustments=true,includeDonors=true,includeSkin=true}={}){
  repo=resolve(repo);const load=p=>import(pathToFileURL(join(repo,p)).href),json=async p=>JSON.parse(await readFile(join(repo,p),'utf8'));
  const sourceFiles=['public/echo.js','public/tte-atlas-geometry.js','public/tee-atlas-geometry.js','public/tee-context-geometry.js','public/tee-view-refinement.js','public/echo-acquisition-geometry.js','public/echo-anatomy-context-v2.js','public/echo-instrument-clearance.js','public/echo-tte-guidance.js','public/probe-scene.js','public/tee-scene.js','public/echo-correspondence.js','public/tee-alignment.js'];
  const getHashes=async()=>{const result={};for(const file of sourceFiles){try{result[file]=hash(await readFile(join(repo,file)));}catch(error){if(error.code!=='ENOENT')throw error;}}return result;};
  const sourceHashes=await getHashes();
  const [{EchoModule},{TTE_ATLAS_VIEWS},{TEE_ATLAS_VIEWS},tte,tee,context,review]=await Promise.all([
    load('public/echo.js'),load('public/tte-atlas-data.js'),load('public/tee-atlas-data.js'),
    load('public/tte-atlas-geometry.js'),load('public/tee-atlas-geometry.js'),load('public/tee-context-geometry.js'),load('public/tee-view-refinement.js')]);
  const views=[...TTE_ATLAS_VIEWS,...TEE_ATLAS_VIEWS];
  let anatomy=null,referenceAnatomy=null;
  if(includeSkin){
    try{
      await readFile(join(repo,'public/echo-anatomy-context-v2.js'));
      anatomy=await load('public/echo-anatomy-context-v2.js');
      referenceAnatomy=await anatomy.decodeEchoReferenceAnatomy({
        manifestBytes:await readFile(join(repo,'public/assets/probe-context-v11/manifest.json')),
        compressedBytes:await readFile(join(repo,'public/assets/probe-context-v11/torso.bin.gz'))});
    }catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const catalog=review.validateTeeRefinements(await json('public/assets/tee-atlas/plane-fit-v2.json'));
  const donors=[{id:'ladaf-2021-17',datasetId:'1659197537',echo:'public/assets/echo-planes.json',flow:'public/assets/flow-views-v5.json',referenceMm:168.0104},
    ...(includeDonors?[{id:'s-20-28',datasetId:'1966162746',geometricComparisonOnly:true},{id:'s-20-29',datasetId:'1773963465',geometricComparisonOnly:true}].map(d=>({...d,echo:`public/assets/donors/${d.id}/echo-planes.json`,flow:`public/assets/donors/${d.id}/flow-views.json`})) : [])];
  const rows=[],models=[];
  for(const donor of donors){
    const raw=await json(donor.echo),referenceMm=donor.referenceMm||raw.referenceMm;
    const base=Object.fromEntries(Object.entries(raw.frames).map(([id,f])=>[id,{...f.world,normal:f.world.normal,displayMirrorX:!!f.displayMirrorX,displayRotate180:!!f.displayRotate180}]));
    let modelTte=tte.createTteContextModel({frames:base,referenceMm,donorId:donor.datasetId});
    let modelTee=context.createTeeContextModel({frames:base,referenceMm,donorId:donor.datasetId});
    if(referenceAnatomy){
      modelTte=anatomy.createEchoAnatomyContext({baseModel:modelTte,referenceAnatomy,frames:base});
      modelTee=anatomy.createEchoAnatomyContext({baseModel:modelTee,referenceAnatomy,frames:base});
    }
    const frameState=()=>({tte:modelTte.frame,tee:modelTee.frame,tteBody:modelTte.bodyTransform,teeBody:modelTee.bodyTransform});
    const frameHash=hash(JSON.stringify(frameState()));
    models.push({donor:donor.id,referenceMm,frameHash,tte:modelTte.frame,tee:modelTee.frame,
      bodyTransform:modelTte.bodyTransform,skinContactConstraintAvailable:!!modelTte.skinSurface,
      skinSourceSha256:modelTte.skinSurface?.sourceSha256,tractSamples:modelTee.tractSamples.length,gastricSamples:modelTee.gastricInteriorSamples.length});
    const flow=Object.fromEntries((await json(donor.flow)).presets.map(p=>[p.id,p.world]));
    const nodes=new Map();
    const e=Object.assign(Object.create(EchoModule.prototype),{
      donor,baseFrames:base,flowFrames:flow,planeReview:catalog,longestMm:referenceMm,sourceSpacingUm:317.6,
      state:{planeReference:'refined',offsetMm:0,rotationDeg:0,tiltDeg:0,flip:false,showProbe:true,showSector:true,showContext:true,leftView:'3d',lockCamera:false},
      active:true,requestId:0,presetTextures:{},textureCache:{pause(){}},fineLabel:'audit',
      cancelFine(){},clearSection(){},updateCine(){},updateCorrespondence(){},message(){},drawSection(){},
      $(id){if(!nodes.has(id))nodes.set(id,{hidden:false,textContent:'',dataset:{},style:{}});return nodes.get(id);},
      anatomyContext(){return this.state.mode==='tte'?modelTte:modelTee;},
      renderer:{settings:{cleanupEnabled:true},set(s){Object.assign(this.settings,s);},clearCapData(){this.cap=null;},setCapData(cap){this.cap=cap;}},
    });
    const overlay=(fn,model)=>({set(p){Object.assign(this,p);this.pose=fn(p.plane,p.view,p.referenceMm,p.contextModel||model);},start(){this.running=true;},stop(){this.running=false;}});
    e.overlay=overlay(tee.atlasContextProbePose,modelTee);e.tteOverlay=overlay(tte.tteAtlasProbePose,modelTte);
    const references=donor.geometricComparisonOnly?['refined']:['refined','previous'];
    for(const planeReference of references){
      e.state.planeReference=planeReference;e.rebuildAtlasFrames();
      const adjustments=includeAdjustments&&planeReference==='refined'?adjustmentCases(referenceMm):[{name:'baseline'}];
      for(const view of views)for(const change of adjustments){
        Object.assign(e.state,{preset:view.id,mode:view.mode,offsetMm:0,rotationDeg:0,tiltDeg:0,flip:false},change);
        const solveStarted=performance.now();e.applyPlane(false,true);const controllerSolveMs=performance.now()-solveStarted;
        clearTimeout(e.sampleTimer);clearTimeout(e.prefetchTimer);
        const plane=e.renderer.settings.oblique,active=view.mode==='tte'?e.tteOverlay:e.overlay,pose=plane.acquisitionUnavailable?null:active.pose;
        const outside=e.renderer.settings.clipAxis===-1;
        const capBefore=e.renderer.cap;
        if(!outside){
          // Tiny token fixture exercises the real accepted-cap handoff. It is
          // not a CT image and is never rendered or written as an image.
          e.showSample({data:new Uint8Array(4),width:2,height:2,spacingUm:317.6},plane,e.requestId,view.id);
          const accepted=e.renderer.cap;
          e.showSample({data:new Uint8Array(4),width:2,height:2,spacingUm:317.6},plane,e.requestId-1,view.id);
          if(e.renderer.cap!==accepted)throw new Error('Stale cap token was accepted.');
        }
        const handoff={clipEnabled:!outside,overlayEqualsClip:plane.acquisitionUnavailable?!active.running:planeSignature(active.plane)===planeSignature({...plane,outsideScan:outside}),
          capEqualsClip:outside?e.renderer.cap===capBefore:planeSignature(e.renderer.cap.plane)===planeSignature(plane),
          clipFlip:e.renderer.settings.clipFlip,staleCapRejected:true,unavailableOverlayHidden:plane.acquisitionUnavailable?!active.running:null};
        handoff.consistent=handoff.overlayEqualsClip&&handoff.capEqualsClip;
        const metrics=pose?{...evaluatePlanePose(plane,pose,referenceMm,{halfAngleDeg:view.mode==='tte'?37:38,outside}),poseAvailable:true}:{outsideScan:outside,ctComparisonApplicable:!outside,poseAvailable:false,coplanar:false};
        const row={donor:donor.id,id:view.id,mode:view.mode,planeReference,adjustment:change.name,controllerSolveMs,
          requestedState:{offsetMm:e.state.offsetMm,rotationDeg:e.state.rotationDeg,tiltDeg:e.state.tiltDeg,flip:e.state.flip},
          plane:change.name==='baseline'?plane:{...plane,acquisitionPose:undefined},
          pose:pose?{originMm:pose.originMm,beam:pose.beam,right:pose.right,normal:pose.normal,targetMm:pose.targetMm,sectorDepthMm:pose.sectorDepthMm,
            instrument:pose.instrument,markerReference:pose.markerReference,markerDirection:pose.markerDirection,multiplaneDeg:pose.multiplaneDeg}:null,
          fit:pose?.contextFit||plane.acquisition,metrics,handoff};
        if(view.mode==='tte'&&pose)row.skin=evaluateSkinContact(pose,modelTte,view.group);
        if(change.name==='baseline'&&view.mode==='tee'&&!outside){
          row.tract={currentSolverLevels:tractAudit(plane,view,modelTee,referenceMm),strictClinicalLevels:tractAudit(plane,view,modelTee,referenceMm,true)};
        }
        if(change.name==='baseline'&&view.mode==='tte'&&pose){
          const anchor=context.teeContextToWorld(tte.TTE_WINDOW_ANCHORS[view.group],modelTte.frame);
          row.window={anchorMm:anchor,originLocal:context.teeContextToLocal(pose.originMm,modelTte.frame),
            anchorToPlaneMm:Math.abs(dot(sub(anchor,scale(plane.center,referenceMm)),unit(plane.normal))),
            originToAnchorMm:length(sub(pose.originMm,anchor)),skinContactStatus:modelTte.skinSurface?'See independent skin triangle distance':'No skin surface in this model; anterior slab is not skin contact'};
        }
        rows.push(row);
      }
    }
    if(hash(JSON.stringify(frameState()))!==frameHash)throw new Error('Body frame changed between views.');
  }
  const endSourceHashes=await getHashes(),sourceChangedDuringAudit=sourceFiles.filter(file=>sourceHashes[file]!==endSourceHashes[file]);
  const zoomParents={plax_deep:'plax',plax_av:'plax',plax_mv:'plax',psax_av_zoom:'psax_av',a4c_lv:'a4c',a2c_lv:'a2c',a3c_lv:'a3c'},zoomFamilies=[];
  for(const row of rows.filter(r=>r.mode==='tte'&&r.adjustment==='baseline'&&zoomParents[r.id]&&r.pose)){
    const parent=rows.find(r=>r.donor===row.donor&&r.planeReference===row.planeReference&&r.adjustment==='baseline'&&r.id===zoomParents[row.id]);
    const originDistanceMm=parent?.pose?length(sub(row.pose.originMm,parent.pose.originMm)):null;
    const beamAngleDeg=parent?.pose?angle(row.pose.beam,parent.pose.beam):null;
    const normalAngleDeg=parent?.pose?planeAngle(row.plane.normal,parent.plane.normal):null;
    zoomFamilies.push({donor:row.donor,id:row.id,parent:zoomParents[row.id],planeReference:row.planeReference,originDistanceMm,beamAngleDeg,normalAngleDeg,consistent:originDistanceMm!==null&&originDistanceMm<=EMM&&beamAngleDeg<=EDEG&&normalAngleDeg<=EDEG});
  }
  const apicalFamilies=[],landmarkChecks=[];
  for(const donor of donors)for(const planeReference of ['refined','previous']){
    const selected=rows.filter(r=>r.donor===donor.id&&r.planeReference===planeReference&&r.adjustment==='baseline');
    const four=selected.find(r=>r.id==='a4c');if(!four?.pose)continue;
    const pure={a4c:0,a4c_lv:0,a2c:-60,a2c_lv:-60,a3c:-120,a3c_lv:-120,a4c_la_pv:0};
    for(const [id,expectedRoll] of Object.entries(pure)){
      const row=selected.find(r=>r.id===id);if(!row?.pose)continue;
      const originDistanceMm=length(sub(row.pose.originMm,four.pose.originMm)),beamAngleDeg=angle(row.pose.beam,four.pose.beam);
      const markerRollDeg=signedAngle(scale(four.pose.instrument.right,-1),scale(row.pose.instrument.right,-1),four.pose.beam);
      apicalFamilies.push({donor:donor.id,id,planeReference,originDistanceMm,beamAngleDeg,markerRollDeg,expectedRollDeg:expectedRoll,
        consistent:originDistanceMm<=EMM&&beamAngleDeg<=EDEG&&Math.abs(markerRollDeg-expectedRoll)<=EDEG});
    }
    const five=selected.find(r=>r.id==='a5c'),cs=selected.find(r=>r.id==='a4c_cs');
    if(five?.pose&&cs?.pose){
      const marker=scale(four.pose.instrument.right,-1),fiveTilt=signedAngle(four.pose.beam,five.pose.beam,marker),csTilt=signedAngle(four.pose.beam,cs.pose.beam,marker);
      const contactErrorMm=Math.max(length(sub(four.pose.originMm,five.pose.originMm)),length(sub(four.pose.originMm,cs.pose.originMm)));
      const markerErrorDeg=Math.max(angle(four.pose.instrument.right,five.pose.instrument.right),angle(four.pose.instrument.right,cs.pose.instrument.right));
      apicalFamilies.push({donor:donor.id,id:'a5c-and-cs-tilts',planeReference,originDistanceMm:contactErrorMm,markerErrorDeg,fiveTiltDeg:fiveTilt,csTiltDeg:csTilt,consistent:contactErrorMm<=EMM&&markerErrorDeg<=EDEG&&fiveTilt*csTilt<0});
    }
    const sourceModel=models.find(m=>m.donor===donor.id),landmarks=sourceModel.tee.landmarksMm||{};
    const assess=(row,label,{onBeam=false,required=true}={})=>{
      const point=landmarks[label];if(!point||!row?.pose)return;
      const delta=sub(point,row.pose.originMm),beam=unit(row.pose.beam),forward=dot(delta,beam),range=length(delta),lateral=dot(delta,unit(row.pose.right));
      const axisMissMm=length(sub(delta,scale(beam,forward))),angleDeg=deg(Math.atan2(Math.abs(lateral),forward));
      const planeResidualMm=Math.abs(dot(sub(point,scale(row.plane.center,sourceModel.referenceMm)),unit(row.plane.normal)));
      const inSector=forward>0&&angleDeg<=(row.mode==='tte'?37:38)+EDEG&&range<=row.pose.sectorDepthMm+EMM;
      landmarkChecks.push({donor:donor.id,id:row.id,planeReference,label,required,onBeam,planeResidualMm,axisMissMm,angleDeg,inSector,
        consistent:!required||(planeResidualMm<=EMM&&inSector&&(!onBeam||axisMissMm<=EMM)),approximateSourceLandmark:true,clinicalValidation:false});
    };
    for(const row of selected.filter(r=>Object.hasOwn(pure,r.id))){assess(row,'apex',{onBeam:true});assess(row,'mitralRegion',{onBeam:true});}
    assess(five,'aorticLumen');assess(selected.find(r=>r.id==='a3c'),'aorticLumen',{required:false});
    const deep=selected.find(r=>r.id==='deeptg5c');assess(deep,'apex');assess(deep,'aorticLumen');
  }
  const groups=[];for(const donor of donors)for(const mode of ['tte','tee']){
    const selected=rows.filter(r=>r.donor===donor.id&&r.mode===mode&&r.planeReference==='refined');
    groups.push({donor:donor.id,mode,baseline:aggregate(selected.filter(r=>r.adjustment==='baseline')),allAdjustments:aggregate(selected)});
  }
  return {schemaVersion:1,repo,sourceHashes,sourceChangedDuringAudit,sourceStable:sourceChangedDuringAudit.length===0,zoomFamilies,apicalFamilies,landmarkChecks,
    scope:'Actual production controller plane/clip/cap/overlay handoffs plus independent numerical plane, tract and skin-contact audit. Skin contact is geometric contact with a fixed illustrative body. GPU pixels, full instrument collision certification and clinical validity are not established by this harness.',
    performanceScope:'Node CPU production controller/solver call using stub UI and renderer; excludes independent mesh audit, GPU rendering, source voxel sampling and network. Not an interactive frame-rate claim.',
    tolerances:{originAndFanMm:EMM,normalAngleDeg:EDEG},models,summary:groups,rows};
}

function markdown(report){
  const lines=['# Echo plane/probe alignment audit','',report.scope,'',
    `Runtime source remained unchanged during audit: **${report.sourceStable?'yes':'NO'}**. Rejected poses are counted separately; absence of a visible pose is not counted as geometric agreement.`,
    '', '| Donor | Mode | Baseline acquired | Noncoplanar | Max origin residual (mm) | Max sector angle (°) | Adjusted failures / acquired cases | Rejected poses / total cases |',
    '|---|---|---:|---:|---:|---:|---:|---:|'];
  for(const s of report.summary)lines.push(`| ${s.donor} | ${s.mode.toUpperCase()} | ${s.baseline.acquired} | ${s.baseline.misaligned} | ${s.baseline.maxOriginResidualMm.toFixed(3)} | ${s.baseline.maxSectorAngleDeg.toFixed(3)} | ${s.allAdjustments.misaligned} / ${s.allAdjustments.acquired} | ${s.allAdjustments.unavailable} / ${s.allAdjustments.cases} |`);
  lines.push('','## Rejected default poses','','| Donor | View | Reference | Overlay hidden |','|---|---|---|---|');
  for(const r of report.rows.filter(r=>r.adjustment==='baseline'&&!r.metrics.poseAvailable))lines.push(`| ${r.donor} | ${r.id} | ${r.planeReference} | ${r.handoff.unavailableOverlayHidden?'yes':'NO'} |`);
  lines.push('','## LADAF baseline by view','','| View | Origin residual (mm) | Sector angle (°) | Largest fan residual (mm) | Pose mode |','|---|---:|---:|---:|---|');
  for(const r of report.rows.filter(r=>r.donor==='ladaf-2021-17'&&r.planeReference==='refined'&&r.adjustment==='baseline')){
    if(r.metrics.poseAvailable===false){lines.push(`| ${r.id} | — | — | — | Unavailable; visible probe must be hidden |`);continue;}
    if(!r.metrics.ctComparisonApplicable){lines.push(`| ${r.id} | — | — | — | Outside scan; CT comparison inapplicable |`);continue;}
    lines.push(`| ${r.id} | ${r.metrics.originPlaneResidualMm.toFixed(3)} | ${r.metrics.sectorPlaneAngleDeg.toFixed(3)} | ${r.metrics.maxFanVertexResidualMm.toFixed(3)} | ${r.fit.mode|| (r.fit.resolved?'plane fit':'independent estimate')} |`);
  }
  lines.push('','## TEE strict-level feasibility','','| View | Nearest sampled origin residual (mm) | Minimum center-preserving rotation (°) | Centerline crossings | Gastric disk crossings | Protected lumen fits |','|---|---:|---:|---:|---:|---:|');
  for(const r of report.rows.filter(r=>r.donor==='ladaf-2021-17'&&r.planeReference==='refined'&&r.adjustment==='baseline'&&r.tract)){
    const t=r.tract.strictClinicalLevels;lines.push(`| ${r.id} | ${t.nearestSample?.residualMm.toFixed(3)??'—'} | ${t.minimumRotationSample?.correction.angleDeg.toFixed(3)??'—'} | ${t.centerlineCrossings.length} | ${t.gastricDiskCrossings.length} | ${t.protectedLumenCrossings.length} |`);
  }
  lines.push('','## Controller timing','',report.performanceScope,'', '| Donor | Mode | Median (ms) | 95th percentile (ms) | Maximum (ms) |', '|---|---|---:|---:|---:|');
  for(const s of report.summary){const t=s.allAdjustments.controllerSolveMs;lines.push(`| ${s.donor} | ${s.mode.toUpperCase()} | ${t.median.toFixed(1)} | ${t.p95.toFixed(1)} | ${t.max.toFixed(1)} |`);}
  return lines.join('\n')+'\n';
}

export async function saveAuditReport(report,output){
  const out=resolve(output);await mkdir(dirname(out),{recursive:true});
  await writeFile(out+'.json',JSON.stringify(report)+'\n');await writeFile(out+'.md',markdown(report));
  await writeFile(out+'-rejections.json',JSON.stringify({schemaVersion:1,sourceHashes:report.sourceHashes,sourceStable:report.sourceStable,
    cases:report.rows.filter(r=>!r.metrics.poseAvailable).map(r=>({donor:r.donor,id:r.id,mode:r.mode,planeReference:r.planeReference,adjustment:r.adjustment,requestedState:r.requestedState,outsideScan:r.metrics.outsideScan,reason:r.fit?.reason,overlayHidden:r.handoff.unavailableOverlayHidden}))},null,2)+'\n');
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const args=process.argv.slice(2),value=key=>{const i=args.indexOf(key);return i>=0?args[i+1]:undefined;};
  const report=await runAudit({repo:value('--repo')||process.cwd(),includeAdjustments:!args.includes('--baseline-only'),includeDonors:!args.includes('--primary-only')});
  const out=resolve(value('--out')||'docs/echo-alignment-v5/current');await saveAuditReport(report,out);
  console.log(JSON.stringify({output:out,cases:report.rows.length,summary:report.summary},null,2));
  if(args.includes('--strict')&&(!report.sourceStable||report.zoomFamilies.some(z=>!z.consistent)||report.apicalFamilies.some(z=>!z.consistent)||report.landmarkChecks.some(z=>!z.consistent)||report.summary.some(s=>s.allAdjustments.unavailable||s.allAdjustments.misaligned||s.allAdjustments.handoffMismatches||s.allAdjustments.skinContactFailures||s.allAdjustments.beamTargetFailures||s.allAdjustments.roiCenterOutsideSector||s.allAdjustments.defaultMarkerFailures)))process.exitCode=1;
}
