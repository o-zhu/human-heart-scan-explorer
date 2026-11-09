/**
 * Specimen-specific echo targets for the independently reviewed S-20 hearts.
 *
 * All lengths below are measured world millimetres. These are new reformats of
 * each donor's own voxels, never relabelled historical rasters or transferred
 * LADAF planes. Broad regional landmarks do not identify valve scallops, venous
 * ostia or appendages. The acquisition solver retains those qualifications.
 */
import {getEchoDonorCalibration} from './echo-donor-calibration.js';
import {ECHO_DONOR_SUPPORT} from './echo-donor-support.js';
import {rotateVector} from './probe-geometry.js';

export const ECHO_DONOR_PLANE_REVISION='specimen-echo-targets-v6';
const add=(a,b)=>a.map((x,i)=>x+b[i]);
const sub=(a,b)=>a.map((x,i)=>x-b[i]);
const mul=(a,s)=>a.map(x=>x*s);
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const length=v=>Math.hypot(...v);
const unit=(v,f=[1,0,0])=>length(v)>1e-9?mul(v,1/length(v)):[...f];
const off=(v,n)=>sub(v,mul(n,dot(v,n)));
const mix=(a,b,t)=>add(mul(a,1-t),mul(b,t));
const mean=ps=>mul(ps.reduce(add,[0,0,0]),1/ps.length);
const rad=d=>d*Math.PI/180;

/** Return the input unchanged for donors without their own calibration. */
export function buildDonorEchoFrames(existing,{donorId,referenceMm}={}){
 const calibration=getEchoDonorCalibration(donorId,referenceMm);
 if(!calibration)return existing;
 const ref=calibration.referenceMm,L=calibration.landmarksMm;
 const required=['apex','leftVentricle','rightVentricle','leftAtrium','rightAtrium','mitralRegion','tricuspidRegion','aorticLumen'];
 if(required.some(k=>!L[k]||L[k].length!==3||!L[k].every(Number.isFinite)))throw new Error('Incomplete specimen echo landmarks.');
 const f=calibration.anatomicalFrame,scale=ref/168.0104;
 const apex=L.apex,mv=L.mitralRegion,tv=L.tricuspidRegion,lv=L.leftVentricle,rv=L.rightVentricle,la=L.leftAtrium,ra=L.rightAtrium;
 const av=L.aorticRoot||L.aorticLumen,ao=L.aorticSuperior||L.aorticLumen;
 const pv=L.pulmonaryRoot||add(av,mul(f.anterior,16*scale)),pa=L.pulmonarySuperior||add(pv,mul(f.superior,18*scale));
 const axis=unit(sub(mv,apex)),aorticAxis=unit(sub(ao,av),axis);
 const left=unit(off(sub(mv,tv),axis),off(sub(lv,rv),axis));
 const fourNormal=unit(rotateVector(unit(cross(left,axis)),axis,rad(calibration.targetAngles?.fourChamberRollDeg||0))),threeSide=unit(off(sub(av,mv),axis),left);
 let threeNormal=unit(cross(threeSide,axis));
 if(dot(threeNormal,fourNormal)<0)threeNormal=mul(threeNormal,-1);
 // Counterclockwise from the apical inward beam. The opposite sign passes
 // through the outflow tract in both S-20 specimens instead of their 2C plane.
 const twoNormal=unit(rotateVector(fourNormal,axis,rad(calibration.targetAngles?.twoChamberRollDeg??-60)));
 // Equal weighting of four chamber centroids would pull the rectangle toward
 // the base and crop the long S-20-28 apex. Span apex-to-atria explicitly.
 const center4=mix(apex,mean([la,ra]),.5);
 const allFour=['apex','mitralRegion','tricuspidRegion','leftAtrium','rightAtrium','leftVentricle','rightVentricle'];
 const rootTargets=['leftVentricle','mitralRegion','aorticRoot','aorticLumen'];
 const canonicalLandmarks={...L,aorticRoot:av,aorticSuperior:ao,pulmonaryRoot:pv,pulmonarySuperior:pa};
 const targets=keys=>keys.filter(k=>canonicalLandmarks[k]).map(key=>({key,pointMm:[...canonicalLandmarks[key]],weight:key==='apex'||key.endsWith('Region')?2:1,toleranceMm:(key==='apex'?7:10)*scale}));
 const result={...existing};
 function plane(id,{center,normal,right=left,up=axis,width=118*scale,height=130*scale,anchor=center,keys=[],status='regional',summary='',outside=false}){
  normal=unit(normal);center=sub(center,mul(normal,dot(sub(center,anchor),normal)));
  right=unit(off(right,normal),unit(cross(up,normal)));
  let imageUp=unit(cross(normal,right));if(dot(imageUp,up)<0){normal=mul(normal,-1);imageUp=mul(imageUp,-1);}up=imageUp;
  const evidence={revision:ECHO_DONOR_PLANE_REVISION,calibrationRevision:calibration.revision,donorId:calibration.donorId,viewId:id,status,landmarkKeys:keys,
   summary:summary||'Estimated from this specimen’s ventricular, atrial and outflow landmarks; the displayed CT is sampled from its own scan.',
   clinicalValidated:false,patientRegistered:false,namedSmallStructuresConfirmed:false};
  result[id]={referenceMm:ref,center:mul(center,1/ref),right,up,normal,width:width/ref,height:height/ref,atlasDerived:true,displayMirrorX:false,displayRotate180:false,outsideScan:outside,
   donorCalibration:evidence,anatomyTargetsMm:targets(keys),note:evidence.summary};
  return result[id];
 }
 const long=(id,n,keys=allFour,options={})=>plane(id,{center:center4,normal:n,anchor:mv,right:unit(cross(axis,n)),up:mul(axis,-1),keys,...options});
 const zoom=(id,parent,center,width,height)=>{
  const p=result[parent],n=p.normal,anchor=mul(p.center,ref);
  return plane(id,{center,normal:n,anchor,right:p.right,up:p.up,width:width*scale,height:height*scale,keys:p.donorCalibration.landmarkKeys,status:p.donorCalibration.status,summary:p.donorCalibration.summary});
 };
 const section=(id,center,n=axis,keys=['leftVentricle','rightVentricle'],options={})=>plane(id,{center,normal:n,right:left,up:f.anterior,width:112*scale,height:108*scale,keys,...options});
 const through=(id,ps,keys,options={})=>{
  const normal=unit(cross(sub(ps[1],ps[0]),sub(ps[2],ps[0])),fourNormal);
  return plane(id,{center:mean(ps),normal,anchor:ps[0],right:left,keys,...options});
 };

 // Apical targets share the independently measured apex-to-mitral axis.
 long('a4c',fourNormal,allFour,{anchor:mv});
 zoom('a4c_lv','a4c',mix(apex,mv,.49),86,113);
 // Keep the distal ventricular extent in the RV-focused rectangle as well.
 // A mean of the three basal right-heart landmarks crops the S-20-28 apex.
 long('a4c_rv',unit(cross(sub(tv,apex),sub(rv,apex))),['rightVentricle','tricuspidRegion','rightAtrium','apex'],{center:mix(apex,ra,.5),anchor:tv,width:107*scale,height:140*scale});
 long('a2c',twoNormal,['apex','leftVentricle','mitralRegion','leftAtrium'],{center:mix(apex,la,.5),anchor:mv,width:102*scale,height:140*scale});
 zoom('a2c_lv','a2c',mix(apex,mv,.48),82,114);
 long('a3c',threeNormal,['apex','leftVentricle','mitralRegion','aorticRoot'],{center:mix(apex,mean([la,av]),.5),anchor:mv,width:109*scale,height:140*scale});
 zoom('a3c_lv','a3c',mix(apex,mv,.52),88,117);
 through('a5c',[apex,tv,av],['apex','tricuspidRegion','aorticRoot','leftVentricle'],{center:center4,right:result.a4c.right,up:result.a4c.up,height:140*scale,summary:'Anterior apical target includes the source aortic-outflow region. Full five-chamber and leaflet correspondence remains approximate.'});
 long('a4c_cs',fourNormal,['leftAtrium','rightAtrium','mitralRegion'],{anchor:add(mv,mul(f.anterior,-8*scale)),status:'unidentified-target',summary:'Posterior atrioventricular regional section; the coronary sinus itself is not independently identified.'});
 zoom('a4c_la_pv','a4c',mean([la,ra]),105,83);result.a4c_la_pv.donorCalibration={...result.a4c_la_pv.donorCalibration,status:'unidentified-target',summary:'Atrial-focused view. Individual pulmonary-vein ostia remain unconfirmed.'};

 // Parasternal long axis follows this LV/MV/aortic route; zooms share its cut.
 plane('plax',{center:mean([lv,mv,av,la]),anchor:mv,normal:threeNormal,right:axis,up:f.anterior,width:120*scale,height:94*scale,keys:rootTargets});
 zoom('plax_deep','plax',mean([lv,mv,av,la]),143,118);
 zoom('plax_av','plax',av,65,63);zoom('plax_mv','plax',mv,72,69);
 through('plax_rvin',[ra,tv,rv],['rightAtrium','tricuspidRegion','rightVentricle'],{right:unit(sub(ra,rv)),height:104*scale,width:110*scale});
 through('plax_rvot',[rv,pv,pa],['rightVentricle','pulmonaryRoot','pulmonarySuperior'],{right:unit(sub(pa,rv)),height:100*scale,width:113*scale});
 section('psax_mitral',mix(mv,apex,.08),axis,['mitralRegion','leftVentricle','rightVentricle']);
 section('psax_papillary',mix(mv,apex,.47),axis,['leftVentricle','rightVentricle'],{summary:'Midventricular short-axis section perpendicular to this specimen’s LV long axis; paired papillary-muscle identity requires source review.'});
 section('psax_apical',mix(mv,apex,.79),axis,['apex','leftVentricle'],{width:88*scale,height:86*scale});
 section('psax_av',av,aorticAxis,['aorticRoot','leftAtrium','rightAtrium','pulmonaryRoot']);
 zoom('psax_av_zoom','psax_av',av,55,55);
 section('psax_great',mix(av,ao,.38),aorticAxis,['aorticRoot','aorticSuperior','pulmonarySuperior'],{width:123*scale,height:113*scale,status:'partial',summary:'Retained aortic and pulmonary outflow regions. Complete pulmonary bifurcation and branch identity may be outside the specimen.'});
 through('psax_tv',[tv,av,ra],['tricuspidRegion','rightAtrium','aorticRoot'],{width:108*scale,height:103*scale});
 // Table 2's pulmonary-valve window follows PV -> proximal PA longitudinally,
 // beside the aortic root. A plane perpendicular to PA shows only a lumen ring.
 through('psax_pv',[av,pv,pa],['aorticRoot','pulmonaryRoot','pulmonarySuperior'],{center:mix(pv,pa,.25),up:f.anterior,width:106*scale,height:98*scale,status:'partial',summary:'Longitudinal pulmonary-valve/outflow region beside the aortic root, selected from this specimen’s source tracks. Individual cusp identity and distal branches remain unconfirmed.'});
 long('subcostal',fourNormal,allFour,{center:center4,anchor:mv,width:127*scale,height:133*scale,status:'partial',summary:'Four-region cardiac target approached from the illustrative subxiphoid window. Liver and pericardial clinical context were not acquired.'});

 // Midesophageal targets: independent source anatomy, then a contained tract fit.
 long('me4c',fourNormal,allFour,{anchor:mv,right:left,up:axis});
 // Three basal valve points create a transverse slab, not a 5C long axis.
 // Actual source-MPR comparison selected both ventricular cavities + AV.
 through('me5c',[lv,rv,av],['leftVentricle','rightVentricle','aorticRoot','leftAtrium','rightAtrium'],{center:center4,right:left,up:axis,height:140*scale,status:'partial',summary:'Longitudinal ventricular and aortic-root target selected against this specimen’s source slices. Complete five-chamber and leaflet correspondence remains approximate.'});
 long('me2c',twoNormal,['leftAtrium','mitralRegion','leftVentricle','apex'],{center:mix(apex,la,.5),right:unit(cross(axis,twoNormal)),up:axis,anchor:mv,width:109*scale,height:140*scale});
 long('melax',threeNormal,['leftAtrium','mitralRegion','leftVentricle','aorticRoot'],{center:mix(apex,mean([la,av]),.5),right:unit(cross(axis,threeNormal)),up:axis,anchor:mv,width:111*scale,height:140*scale});
 const commissuralRoll=calibration.donorId==='s-20-28'?-30:-40;
 long('mecommissural',unit(rotateVector(fourNormal,axis,rad(commissuralRoll))),['leftAtrium','mitralRegion','leftVentricle','apex'],{center:mix(apex,la,.5),anchor:mv,right:left,up:axis,width:105*scale,height:140*scale,status:'unidentified-target',summary:'Source-reviewed mitral-region oblique plane between this specimen’s four- and two-chamber targets. Individual P3/A2/P1 scallops and commissures remain unconfirmed.'});
 through('meavlax',[lv,av,ao],rootTargets,{right:unit(sub(ao,lv)),up:f.superior,width:100*scale,height:103*scale});
 through('meaaolax',[av,ao,pv],['aorticRoot','aorticSuperior','pulmonaryRoot'],{center:mix(av,ao,.60),right:aorticAxis,width:101*scale,height:95*scale,status:'partial',summary:'Longitudinal retained aortic outflow; completeness of the proximal ascending aorta is limited by the excised specimen.'});
 section('meavsax',av,aorticAxis,['aorticRoot','leftAtrium','rightAtrium'],{width:102*scale,height:102*scale});
 section('meaaosax',mix(av,ao,.78),aorticAxis,['aorticSuperior','pulmonarySuperior'],{width:99*scale,height:99*scale,status:'partial'});
 through('mervinout',[tv,rv,pv],['tricuspidRegion','rightVentricle','pulmonaryRoot'],{width:123*scale,height:117*scale});
 const raSup=L.rightAtriumSuperior||add(ra,mul(f.superior,20*scale));
 through('bicaval',[ra,raSup,la],['rightAtrium','rightAtriumSuperior','leftAtrium'],{center:mix(ra,raSup,.2),right:unit(sub(raSup,ra)),width:107*scale,height:114*scale,status:'unidentified-target',summary:'Longitudinal right-atrial and interatrial target. Named SVC/IVC entries and their complete continuity are not independently confirmed.'});
 through('memodbicaval',[ra,raSup,tv],['rightAtrium','rightAtriumSuperior','tricuspidRegion'],{width:107*scale,height:114*scale,status:'unidentified-target',summary:'Right-atrial/tricuspid regional estimate; caval identity and named leaflet pairing remain unconfirmed.'});
 through('merpv',[la,ra,add(la,mul(f.superior,18*scale))],['leftAtrium','rightAtrium'],{center:mix(la,ra,.26),width:100*scale,height:90*scale,status:'unidentified-target',summary:'Right-sided atrial inflow-region estimate. The right pulmonary-vein ostium is not independently labelled.'});
 plane('mepv',{center:la,anchor:la,normal:f.superior,right:f.left,up:f.anterior,width:111*scale,height:100*scale,keys:['leftAtrium'],status:'unidentified-target',summary:'Broad left-atrial inflow section. Separate right and left pulmonary veins remain unconfirmed.'});
 through('melaa',[la,mv,add(la,mul(f.left,24*scale))],['leftAtrium','mitralRegion'],{center:add(la,mul(f.left,9*scale)),width:91*scale,height:90*scale,status:'unidentified-target',summary:'Lateral left-atrial regional estimate. Left-atrial-appendage identity is not established by the regional annotation.'});

 // Transgastric levels are ordered along the measured LV long axis.
 section('tgbasalsax',mix(mv,apex,.12),axis,['mitralRegion','leftVentricle','rightVentricle']);
 section('tgpapillary',mix(mv,apex,.47),axis,['leftVentricle','rightVentricle']);
 section('tgapicalsax',mix(mv,apex,.79),axis,['apex','leftVentricle'],{width:88*scale,height:86*scale});
 section('tgrvbasal',mix(tv,rv,.22),unit(sub(tv,rv)),['tricuspidRegion','rightVentricle'],{width:106*scale,height:103*scale});
 through('tgrvinout',[rv,tv,pv],['rightVentricle','tricuspidRegion','pulmonaryRoot'],{width:117*scale,height:119*scale});
 long('deeptg5c',threeNormal,['apex','leftVentricle','mitralRegion','aorticRoot'],{center:mix(apex,av,.5),anchor:mv,width:117*scale,height:137*scale,status:'partial',summary:'Apex-to-aortic-outflow target from the gastric model. Complete five-chamber correspondence and a Doppler flow axis are not established.'});
 long('tg2c',twoNormal,['apex','leftVentricle','mitralRegion','leftAtrium'],{center:mix(apex,la,.5),anchor:mv,width:106*scale,height:140*scale});
 through('tgrvin',[rv,tv,ra],['rightVentricle','tricuspidRegion','rightAtrium'],{width:111*scale,height:119*scale});
 long('tglax',threeNormal,['apex','leftVentricle','mitralRegion','aorticRoot'],{center:mean([apex,mv,av]),anchor:mv,width:113*scale,height:132*scale});

 // These targets are genuinely not contained in an isolated heart scan.
 for(const id of ['subcostal_ivc','subcostal_hepatic','ssn_arch','daosax','daolax','uearchlax','uearchsax']){
  const old=existing[id]||result.me4c;
  plane(id,{center:mul(old.center,ref),normal:old.normal,right:old.right,up:old.up,width:(old.width||.8)*ref,height:(old.height||.8)*ref,outside:true,status:'outside-scan',summary:'The complete extracardiac target is outside this acquisition. The specimen-specific context and probe estimate are shown without a fabricated CT section.'});
 }
 // The TTE Lab uses a deliberately synthetic contact surface. Its new entry
 // must be measured along the NEW beam, outside the donor's own source support;
 // copying an old entry offset would put the probe back inside the heart.
 const support=ECHO_DONOR_SUPPORT[calibration.donorId],ratio=ref/support.referenceMm;
 const guard=support.voxelDiagonalMm*ratio*.5+.00002,clearance=8*scale;
 for(const [id,preset,legacyDepth] of [['a4c','apical',145],['plax','parasternal',135],['psax_papillary','short-axis',130],['me4c','atrial',135]]){
  const p=result[id],centerMm=mul(p.center,ref),q=support.pointsMm.map(point=>sub(mul(point,ratio),centerMm));
  const near=q.map(point=>dot(point,p.up));
  const offset=Math.max(legacyDepth*scale*.47,Math.max(...near)+guard+clearance);
  const requiredDepth=Math.max(...q.map((point,i)=>Math.hypot(offset-near[i],dot(point,p.right))))+guard+5*scale;
  const depth=Math.max(legacyDepth*scale,requiredDepth);
  p.probeEntry={key:`${calibration.donorId}:${calibration.revision}:${ECHO_DONOR_PLANE_REVISION}:${preset}`,referenceMm:ref,tipOffsetMm:offset,depthMm:depth,
   sourceSupportSha256:support.sourceSha256,cellGuardMm:guard,clearanceMm:clearance,requiredDepthMm:requiredDepth,
   method:'New beam entry beyond this specimen’s hash-verified retained support, including a half-cell guard and 8 scaled mm clearance. Synthetic contact surface, not registered skin.'};
 }
 return result;
}

export function echoDonorTargetEvidence(plane){return plane?.donorCalibration||null;}

/** Saved steering offsets are meaningful only relative to the same specimen
 * calibration and starting-plane revision. Legacy LADAF bookmarks are stable. */
export function echoDonorPlaneRevision(frames){
 const evidence=frames?.a4c?.donorCalibration;
 return evidence?`${evidence.donorId}:${evidence.calibrationRevision}:${evidence.revision}`:null;
}

/** A contained instrument is insufficient when its fitted plane has lost the
 * named RV inlet/outlet regions. Preserve the source section and show context
 * without a probe if this fixed illustrative stomach cannot support that cut.
 * The LADAF points are independent source-region guides, not S-20 transfers.
 */
export function protectEchoTargetAcquisitions(frames,{donorId,referenceMm=168.0104}={}){
 const p=frames?.tgrvinout;if(!p)return frames;
 referenceMm=Number.isFinite(referenceMm)&&referenceMm>0?referenceMm:p.referenceMm||168.0104;
 let targets=p.anatomyTargetsMm,revision=p.donorCalibration?.revision;
 if(/^(ladaf-2021-17|1659197537)$/i.test(String(donorId))){
  const point=([x,y,z])=>[(x-237)/529,(z-264.5)/529,(237-y)/529].map(v=>v*referenceMm);
  targets=[['tricuspidRegion',[239.735,181.275,289.342]],['pulmonaryRoot',[190,302,230]],['pulmonarySuperior',[205,317,210]],['rightVentricle',[195,184,330]]]
   .map(([key,p])=>({key,pointMm:point(p),weight:key==='tricuspidRegion'||key==='pulmonaryRoot'?2:1,toleranceMm:8*referenceMm/168.0104}));
  revision='ladaf-rv-inlet-outlet-source-v6';
 }
 if(!targets?.length)return frames;
 const scale=referenceMm/168.0104;
 return {...frames,tgrvinout:{...p,anatomyTargetsMm:targets,sourceTargetRevision:revision,preferSourcePlane:true,
  acquisitionTargetBudget:{maxAddedMissMm:5*scale,maxSourceWitnessResidualMm:8*scale,maxCorrectionAngleDeg:20},
  note:'Source right-ventricular inlet/outlet section. A contained gastric probe is displayed only if its plane retains the source TV/PV/RV target neighborhood.'}};
}
