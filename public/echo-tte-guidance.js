/** Shared apical acquisition directions in the fixed reference body.
 *
 * ASE TTE Table 2 and the acquisition narrative describe rotation from A4C
 * for A2C/A3C, anterior tilt for A5C, and posterior tilt for coronary sinus.
 * These are illustrative directions, not registered patient probe positions.
 * The primary donor's broad apex/MV/aortic annotations remain approximate.
 */
import {rotateVector} from './probe-geometry.js';
import {sampleEchoBodySkin,worldToBodyReference} from './echo-anatomy-context-v2.js';

export const TTE_APICAL_GUIDANCE_REVISION='echo-tte-apical-guidance-v2';
export const TTE_APICAL_APPROXIMATE_TILT_DEG=8;
// Measured 0/2/4/8-degree LADAF MPR comparison: larger posterior tilts lose the
// AV/cavity corridor. This is a small posterior search, not identified CS lumen.
export const TTE_APICAL_POSTERIOR_TILT_DEG=2;
const canonicalCache=new WeakMap();
const add=(a,b)=>a.map((v,i)=>v+b[i]);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const mul=(v,s)=>v.map(x=>x*s);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const length=v=>Math.hypot(...v);
const finite3=v=>v?.length===3&&Array.from(v).every(Number.isFinite);
const unit=v=>length(v)>1e-10?mul(v,1/length(v)):null;
const off=(v,n)=>sub(v,mul(n,dot(v,n)));
const radians=x=>x*Math.PI/180;
const degrees=x=>x*180/Math.PI;
const cloneContact=c=>({...c,pointMm:[...c.pointMm],bodyPointMm:[...c.bodyPointMm],normal:[...c.normal],barycentric:c.barycentric&&[...c.barycentric]});

/** Ray hits the actual drawable world triangles. Prefer the outermost anterior
 * hit: the source skin has a small overlapping surface in this apical region.
 * Every candidate remains inside the same bounded, fixed body window.
 */
function skinContactOnAxis(model,apex,mitral){
 const direction=unit(sub(apex,mitral));if(!direction)return null;
 const vertices=model.skinSurface.vertices,bounds=model.bodyWindows.apical.referenceBounds;
 const scale=model.frame.scale,epsilon=1e-7*scale;let best=null;
 for(let at=0;at<vertices.length;at+=18){
  const a=Array.from(vertices.subarray(at,at+3)),b=Array.from(vertices.subarray(at+6,at+9)),c=Array.from(vertices.subarray(at+12,at+15));
  const e1=sub(b,a),e2=sub(c,a),h=cross(direction,e2),det=dot(e1,h);
  if(Math.abs(det)<1e-10)continue;
  const s=sub(apex,a),u=dot(s,h)/det;if(u< -1e-8||u>1+1e-8)continue;
  const q=cross(s,e1),v=dot(direction,q)/det;if(v< -1e-8||u+v>1+1e-8)continue;
  const distanceMm=dot(e2,q)/det;if(distanceMm<=epsilon||distanceMm>250*scale)continue;
  const pointMm=add(apex,mul(direction,distanceMm)),bodyPointMm=worldToBodyReference(pointMm,model);
  if(!bodyPointMm.every((x,i)=>x>=bounds.min[i]-1e-7&&x<=bounds.max[i]+1e-7))continue;
  const barycentric=[1-u-v,u,v];
  const normal=unit([0,1,2].map(k=>barycentric.reduce((sum,w,j)=>sum+w*vertices[at+j*6+3+k],0)));
  if(!normal||dot(normal,model.frame.anterior)<=.02||dot(direction,normal)<=.05)continue;
  if(!best||distanceMm>best.rayDistanceFromApexMm){
   best={pointMm,bodyPointMm,normal,triangleIndex:at/18,barycentric,rayDistanceFromApexMm:distanceMm,
    contactKind:'actual-skin-apical-axis',patientRegistered:false};
  }
 }
 return best;
}

function canonicalApical(model,referenceMm,fourChamberPlane){
 const landmarks=model.frame.landmarksMm||{},hasAxis=finite3(landmarks.apex)&&finite3(landmarks.mitralRegion);
 const fallbackTarget=finite3(fourChamberPlane?.center)?mul(fourChamberPlane.center,referenceMm):model.frame.originMm;
 const specimenNormal=fourChamberPlane?.donorCalibration&&finite3(fourChamberPlane.normal)?fourChamberPlane.normal:null;
 const key=(hasAxis?'source-apex-mitral':JSON.stringify([referenceMm,...fallbackTarget]))+(specimenNormal?JSON.stringify(specimenNormal):'');
 let entries=canonicalCache.get(model);if(!entries){entries=new Map();canonicalCache.set(model,entries);}
 if(entries.has(key))return entries.get(key);
 let contact=hasAxis?skinContactOnAxis(model,landmarks.apex,landmarks.mitralRegion):null;
 const usesSourceAxis=!!contact;
 if(!contact){
  const hit=sampleEchoBodySkin(model,...model.bodyWindows.apical.anchorXY);
  if(!hit)return null;
  contact={...hit,contactKind:'fixed-apical-window-anchor',patientRegistered:false};
 }
 const targetMm=usesSourceAxis?[...landmarks.mitralRegion]:[...fallbackTarget];
 const beam=unit(sub(targetMm,contact.pointMm));if(!beam||dot(beam,contact.normal)>=-.02)return null;
 let marker=unit(off(model.frame.left,beam))||unit(off(model.frame.superior,beam));if(!marker)return null;
 // A body reference left vector alone does not define a four-chamber slice in
 // an excised, differently mounted heart. Use its own AV/ventricular plane.
 if(specimenNormal){const sourceMarker=unit(cross(beam,specimenNormal));if(sourceMarker)marker=dot(sourceMarker,marker)<0?mul(sourceMarker,-1):sourceMarker;}
 const result={contact,beam,marker,targetMm,usesSourceAxis,
  kind:usesSourceAxis?'source-apex-mitral-apical-axis':'illustrative-fixed-apical-window'};
 entries.set(key,result);return result;
}

/** Rotate about the fixed physical marker toward an anatomical direction.
 * Limit the small illustrative tilt and stop at the directional extremum.
 */
function tiltToward(beam,marker,direction,maxDegrees){
 const desired=unit(off(direction,marker));if(!desired)return {beam:[...beam],degrees:0};
 const turn=Math.atan2(dot(marker,cross(beam,desired)),dot(beam,desired));
 const amount=Math.sign(turn)*Math.min(Math.abs(turn),radians(maxDegrees));
 return {beam:unit(rotateVector(beam,marker,amount)),degrees:degrees(amount)};
}

/**
 * @param {{view:object,model:object,sourcePlane?:object,referenceMm:number,fourChamberPlane?:object}} options
 * `fourChamberPlane.center` is used only for donors without a usable source
 * apex/MV axis. If omitted, the fixed frame origin is the illustrative target;
 * the selected view's varying raster center never changes the common contact.
 * `targetMm` always lies on the central beam. `anatomicalTargetMm`, when present,
 * may be lateral to that beam while remaining in its marker-defined plane.
 */
export function tteApicalGuide({view,model,sourcePlane,referenceMm,fourChamberPlane}={}){
 if(view?.group!=='apical'||(view.mode&&view.mode!=='tte')||view.id==='a4c_rv')return null;
 if(!model?.skinSurface?.vertices||!model?.bodyWindows?.apical||!model?.frame)return null;
 if(!(referenceMm>0)||!Number.isFinite(referenceMm))throw new TypeError('Apical guidance needs a positive physical reference scale.');
 const base=canonicalApical(model,referenceMm,fourChamberPlane);if(!base)return null;
 const origin=base.contact.pointMm,landmarks=model.frame.landmarksMm||{},id=view.id;
 let beam=[...base.beam],markerDirection=[...base.marker],targetMm=[...base.targetMm],kind=base.kind,anatomicalTargetMm=null;
 let markerRollDeg=0,tiltDeg=0,tiltDirection=null;
 if(id.startsWith('a2c')||id.startsWith('a3c')){
  markerRollDeg=id.startsWith('a2c')?-60:-120;
  if(sourcePlane?.donorCalibration&&finite3(sourcePlane.normal)){
   const desired=unit(cross(base.beam,sourcePlane.normal));
   if(desired){
    const raw=degrees(Math.atan2(dot(base.beam,cross(base.marker,desired)),dot(base.marker,desired)));
    markerRollDeg=[raw-360,raw-180,raw,raw+180,raw+360].sort((a,b)=>Math.abs(a-markerRollDeg)-Math.abs(b-markerRollDeg))[0];
   }
  }
  markerDirection=unit(rotateVector(base.marker,base.beam,radians(markerRollDeg)));
  kind+='-marker-roll';
 }else if(id==='a5c'){
  // LADAF has a separately source-reviewed LVOT guide that retains its LV
  // cavity in A5C. The more superior cusp-region center is a different target.
  const aorticTarget=landmarks.leftVentricularOutflow||landmarks.aorticRoot||landmarks.aorticLumen;
  if(finite3(aorticTarget)){
   anatomicalTargetMm=[...aorticTarget];
   const delta=sub(anatomicalTargetMm,origin),projected=unit(off(delta,markerDirection));
   if(!projected||dot(projected,base.beam)<=0)return null;
   beam=projected;targetMm=add(origin,mul(beam,dot(delta,beam)));
   tiltDeg=degrees(Math.atan2(dot(markerDirection,cross(base.beam,beam)),dot(base.beam,beam)));
   kind=landmarks.leftVentricularOutflow?'lvot-region-apical-tilt':'aortic-region-apical-tilt';
  }else{
   const tilted=tiltToward(beam,markerDirection,model.frame.anterior,TTE_APICAL_APPROXIMATE_TILT_DEG);
   beam=tilted.beam;tiltDeg=tilted.degrees;
   targetMm=add(origin,mul(beam,length(sub(base.targetMm,origin))));kind='illustrative-anterior-apical-tilt';
  }
  tiltDirection='anterior';
 }else if(id==='a4c_cs'){
  const tilted=tiltToward(beam,markerDirection,mul(model.frame.anterior,-1),TTE_APICAL_POSTERIOR_TILT_DEG);
  beam=tilted.beam;tiltDeg=tilted.degrees;tiltDirection='posterior';
  targetMm=add(origin,mul(beam,length(sub(base.targetMm,origin))));kind='illustrative-posterior-apical-tilt';
 }
 if(dot(beam,base.contact.normal)>=-.02)return null;
 return {contact:cloneContact(base.contact),beam,markerDirection,targetMm,kind,
  anatomicalTargetMm,canonicalBeam:[...base.beam],canonicalMarkerDirection:[...base.marker],
  guidance:{revision:TTE_APICAL_GUIDANCE_REVISION,source:'ASE TTE Table 2 and acquisition narrative',
   contactKind:base.contact.contactKind,usesSourceAxis:base.usesSourceAxis,markerRollDeg,tiltDeg,tiltDirection,
   approximateTilt:id==='a4c_cs'||(id==='a5c'&&!anatomicalTargetMm),patientRegistered:false,namedAnatomyConfirmed:false,
   qualification:base.usesSourceAxis?'Approximate specimen landmarks in a fixed reference body; named clinical CT correspondence is unconfirmed.':'Fixed reference-window construction; this donor has no assigned clinical landmark correspondence.',
   specimenCalibrated:!!sourcePlane?.donorCalibration,nominalMarkerRollDeg:id.startsWith('a2c')?-60:id.startsWith('a3c')?-120:0}};
}
