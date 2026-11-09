/** Physical probe geometry. Distances are millimetres; renderer units are
 * normalised by the longest physical scan dimension. No patient registration
 * or acoustic material identity is inferred here.
 */
import {add,mul,dot,cross,norm} from './planes.js';
import {skinContactFrame,initialSkinContact,restoreSkinContact,moveOnSkin} from './probe-skin-contact.js';

export const PROBE_REFERENCE_MM=168.0104;
/** The reference value keeps legacy bookmarks stable; new sources carry their
 * own physical field length. Distances remain millimetres at every scale. */
export function probePhysicalScale(referenceMm=PROBE_REFERENCE_MM){
 return Number.isFinite(referenceMm)&&referenceMm>0?referenceMm/PROBE_REFERENCE_MM:1;
}
export function probePhysicalLimits(referenceMm=PROBE_REFERENCE_MM){
 const scale=probePhysicalScale(referenceMm);
 return {scale,depth:[65*scale,190*scale],speed:[4*scale,55*scale],position:600*scale,step:5*scale};
}
export const PROBE_PRESETS=[
 {id:'apical',frame:'a4c',name:'Apical long axis',detail:'Four-chamber-like starting plane',depthMm:145,angleDeg:76},
 {id:'parasternal',frame:'plax',name:'Parasternal long axis',detail:'Long-axis anatomical starting plane',depthMm:135,angleDeg:80},
 {id:'short-axis',frame:'psax_papillary',name:'Ventricular short axis',detail:'Mid-ventricular starting plane',depthMm:130,angleDeg:84},
 {id:'atrial',frame:'me4c',name:'Atrial / TEE side',detail:'Opposite entry into the long-axis plane',depthMm:135,angleDeg:80},
];
export const DEFAULT_PROBE_STATE={preset:'apical',originMm:null,contactLocked:true,contactPositionMm:null,showSurface:true,imageMode:'ultrasound',interactionMode:'probe',sweepDeg:0,tiltDeg:0,rollDeg:0,depthMm:145,angleDeg:76,gainDb:0,frequencyMHz:3.5,dynamicRangeDb:52,shadow:.55,speedMm:22,cutaway:true,flip:false,showGuide:true};
export const clamp=(value,lo,hi)=>Math.max(lo,Math.min(hi,value));
export const radians=degrees=>degrees*Math.PI/180;
export const finiteVector=value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);
const wrap=degrees=>degrees>=-180&&degrees<180?degrees:((degrees+180)%360+360)%360-180;

export function rotateVector(value,axis,angle){
 const a=norm(axis),c=Math.cos(angle),s=Math.sin(angle);
 return add(add(mul(value,c),mul(cross(a,value),s)),mul(a,dot(a,value)*(1-c)));
}

export function volumeGeometry(meta){
 const spacing=Array.isArray(meta.spacingUm)?meta.spacingUm:[meta.spacingUm,meta.spacingUm,meta.spacingUm];
 const sourceSizeMm=meta.dimensions.map((n,i)=>(n-1)*spacing[i]/1000),longestMm=Math.max(...sourceSizeMm);
 return {longestMm,sourceSizeMm,extent:[sourceSizeMm[0]/longestMm,sourceSizeMm[2]/longestMm,sourceSizeMm[1]/longestMm],spacingUm:Math.max(...spacing)};
}

export function defaultOrigin(frame,depthMm,referenceMm=frame?.referenceMm||PROBE_REFERENCE_MM){
 const beam=mul(norm(frame.up),-1),target=mul(frame.center,referenceMm);
 // A geometric section's centre is not necessarily the heart's centre. The
 // comparison donors therefore carry an independently measured entry offset
 // beyond their retained source support. Moving along the beam preserves the
 // exact CT plane and its prepared Ultra texture.
 const entry=frame?.probeEntry,ratio=referenceMm/(entry?.referenceMm||referenceMm);
 const offset=Number.isFinite(entry?.tipOffsetMm)&&entry.tipOffsetMm>0?entry.tipOffsetMm*ratio:depthMm*.47;
 return add(target,mul(beam,-offset));
}

/** Start far enough outside this donor, with depth to reach its distal tissue.
 * The optional calibration changes neither voxel coordinates nor beam axes.
 */
export function probePresetDepth(presetId,frame={}){
 const preset=PROBE_PRESETS.find(p=>p.id===presetId)||PROBE_PRESETS[0],referenceMm=frame?.referenceMm||PROBE_REFERENCE_MM,limits=probePhysicalLimits(referenceMm),entry=frame?.probeEntry;
 const calibrated=Number.isFinite(entry?.depthMm)&&entry.depthMm>0?entry.depthMm*referenceMm/(entry.referenceMm||referenceMm):frame?.probeDepthMm;
 return clamp(Number.isFinite(calibrated)&&calibrated>0?calibrated:preset.depthMm*limits.scale,...limits.depth);
}

/** Adopt a newly calibrated starting depth once. Keep a user's custom depth or
 * explicitly saved free pose; legacy untouched contact presets gain coverage.
 */
export function initializeProbeEntry(state,frame){
 const entry=frame?.probeEntry;if(!entry?.key||state.probeEntryKey===entry.key)return state;
 const preset=PROBE_PRESETS.find(p=>p.id===state.preset)||PROBE_PRESETS[0],legacyDepth=preset.depthMm*probePhysicalScale(frame.referenceMm||state.referenceMm);
 const defaultDepth=Math.abs(state.depthMm-legacyDepth)<1e-4;
 return {...state,probeEntryKey:entry.key,depthMm:state.contactLocked&&defaultDepth?probePresetDepth(state.preset,frame):state.depthMm};
}

export function sanitizeProbeState(saved={}){
 const referenceMm=Number.isFinite(saved.referenceMm)&&saved.referenceMm>0?saved.referenceMm:PROBE_REFERENCE_MM;
 const limits=probePhysicalLimits(referenceMm),defaults={...DEFAULT_PROBE_STATE,depthMm:DEFAULT_PROBE_STATE.depthMm*limits.scale,speedMm:DEFAULT_PROBE_STATE.speedMm*limits.scale};
 const state={...defaults,...saved,referenceMm};
 if(!PROBE_PRESETS.some(p=>p.id===state.preset))state.preset=DEFAULT_PROBE_STATE.preset;
 state.originMm=finiteVector(saved.originMm)?saved.originMm.map(x=>clamp(x,-limits.position,limits.position)):null;
 // Preserve an explicitly saved v6 free pose. New/default v7 sessions begin
 // on the synthetic contact surface; a legacy bookmark does not silently move.
 state.contactLocked=typeof saved.contactLocked==='boolean'?saved.contactLocked:!state.originMm;
 state.contactPositionMm=Array.isArray(saved.contactPositionMm)&&saved.contactPositionMm.length===2&&saved.contactPositionMm.every(Number.isFinite)?saved.contactPositionMm.map(v=>clamp(v,-limits.position,limits.position)):null;
 state.skinContact=saved.skinContact&&finiteVector(saved.skinContact.pointMm)&&finiteVector(saved.skinContact.right)&&finiteVector(saved.skinContact.inward)&&typeof saved.skinContact.sourceKey==='string'?{...saved.skinContact,pointMm:[...saved.skinContact.pointMm],right:[...saved.skinContact.right],inward:[...saved.skinContact.inward]}:null;
 state.imageMode=saved.imageMode==='ct'?'ct':'ultrasound';state.interactionMode=saved.interactionMode==='orbit'?'orbit':'probe';
 for(const [key,lo,hi] of [['tiltDeg',-85,85],['depthMm',...limits.depth],['angleDeg',35,110],['gainDb',-18,18],['frequencyMHz',1.5,7],['dynamicRangeDb',35,80],['shadow',0,1],['speedMm',...limits.speed]])
  state[key]=Number.isFinite(Number(saved[key]))?clamp(Number(saved[key]),lo,hi):defaults[key];
 for(const key of ['sweepDeg','rollDeg'])state[key]=Number.isFinite(Number(saved[key]))?wrap(Number(saved[key])):0;
 for(const key of ['cutaway','showGuide','showSurface'])state[key]=saved[key]!==false;
 if(state.contactLocked){const limit=state.skinContact?85:65;state.sweepDeg=clamp(state.sweepDeg,-limit,limit);state.tiltDeg=clamp(state.tiltDeg,-limit,limit);}
 state.flip=!!saved.flip;
 return state;
}

/** Preserve the relative pose when a loaded scan supplies its physical extent.
 * Preview and detailed levels have the same extent, so refinement is a no-op. */
export function rescaleProbeState(state,referenceMm){
 const oldReference=state.referenceMm||PROBE_REFERENCE_MM;
 if(!(referenceMm>0)||Math.abs(referenceMm-oldReference)<1e-6)return state;
 const ratio=referenceMm/oldReference;
 return sanitizeProbeState({...state,referenceMm,depthMm:state.depthMm*ratio,speedMm:state.speedMm*ratio,
  originMm:state.originMm?.map(v=>v*ratio)||null,contactPositionMm:state.contactPositionMm?.map(v=>v*ratio)||null,
  skinContact:state.skinContact?{...state.skinContact,pointMm:state.skinContact.pointMm.map(v=>v*ratio),sourceKey:''}:null});
}

export function probePose(state,frame){
 if(!frame||!finiteVector(frame.right)||!finiteVector(frame.up))return null;
 let right=norm(frame.right),beam=mul(norm(frame.up),-1),normal=norm(cross(beam,right));
 let contact=null,originMm=state.originMm||defaultOrigin(frame,state.depthMm);
 if(state.contactLocked){
  const surface=probeContactSurface(state.preset,frame);
  if(surface.kind==='body-skin')contact=state.skinContact?.sourceKey===surface.key?skinContactFrame(surface,state.skinContact):initialSkinContact(surface,frame,originMm);
  else {const uv=contactCoordinates(state,surface);contact=contactFrame(surface,...uv);}
  right=contact.right;beam=contact.inward;normal=contact.normal;originMm=contact.pointMm;
 }
 // Sweep remains in the starting plane. Tilt moves out of that plane; roll
 // rotates the imaging plane around the resulting beam axis.
 right=rotateVector(right,normal,radians(state.sweepDeg));beam=rotateVector(beam,normal,radians(state.sweepDeg));
 beam=rotateVector(beam,right,radians(state.tiltDeg));
 right=rotateVector(right,beam,radians(state.rollDeg));
 beam=norm(beam);right=norm(add(right,mul(beam,-dot(right,beam))));normal=norm(cross(beam,right));
 return {originMm:[...originMm],right,beam,normal,up:mul(beam,-1),...(contact?{contact}: {})};
}

/** A deliberately synthetic positioning surface, not a segmented skin or
 * esophagus. Calibrated donor entries sit beyond retained source tissue;
 * uncalibrated legacy entries preserve their existing reference probe tip.
 */
export function probeContactSurface(presetId,frame){
 if(presetId!=='atrial'&&frame?.skinContactSurface)return frame.skinContactSurface;
 const preset=PROBE_PRESETS.find(p=>p.id===presetId)||PROBE_PRESETS[0],inward=mul(norm(frame.up),-1),right=norm(frame.right),axis=norm(cross(inward,right)),esophageal=preset.id==='atrial';
 const scale=probePhysicalScale(frame.referenceMm),depthMm=probePresetDepth(preset.id,frame);
 return {kind:esophageal?'esophageal':'skin',centerMm:defaultOrigin(frame,depthMm),inward,right,axis,limitU:(esophageal?18*Math.PI*50/180:55)*scale,limitV:(esophageal?42:45)*scale,radius:18*scale,radiusU:260*scale,radiusV:220*scale};
}

export function clampContactCoordinates(surface,u=0,v=0){
 u=clamp(Number.isFinite(u)?u:0,-surface.limitU,surface.limitU);v=clamp(Number.isFinite(v)?v:0,-surface.limitV,surface.limitV);
 if(surface.kind==='skin'){const radius=Math.hypot(u/surface.limitU,v/surface.limitV);if(radius>1){u/=radius;v/=radius;}}
 return [u,v];
}

export function projectToContact(surface,pointMm){
 const delta=pointMm.map((v,i)=>v-surface.centerMm[i]),lateral=dot(delta,surface.right),depth=dot(delta,surface.inward);
 const u=surface.kind==='esophageal'?Math.atan2(lateral,surface.radius-depth)*surface.radius:lateral;
 return clampContactCoordinates(surface,u,dot(delta,surface.axis));
}

export function contactCoordinates(state,surface){
 return state.contactPositionMm?clampContactCoordinates(surface,...state.contactPositionMm):state.originMm?projectToContact(surface,state.originMm):[0,0];
}

export function contactFrame(surface,u=0,v=0){
 [u,v]=clampContactCoordinates(surface,u,v);let lateral=u,depth,right,inward,du,dv;
 if(surface.kind==='esophageal'){
  const angle=u/surface.radius,c=Math.cos(angle),s=Math.sin(angle);lateral=surface.radius*s;depth=surface.radius*(1-c);
  du=add(mul(surface.right,c),mul(surface.inward,s));dv=surface.axis;right=norm(du);inward=norm(add(mul(surface.inward,c),mul(surface.right,-s)));
 }else{
  depth=u*u/(2*surface.radiusU)+v*v/(2*surface.radiusV);
  du=add(surface.right,mul(surface.inward,u/surface.radiusU));dv=add(surface.axis,mul(surface.inward,v/surface.radiusV));
  right=norm(du);inward=norm(add(add(surface.inward,mul(surface.right,-u/surface.radiusU)),mul(surface.axis,-v/surface.radiusV)));
 }
 const pointMm=add(add(add(surface.centerMm,mul(surface.right,lateral)),mul(surface.axis,v)),mul(surface.inward,depth)),normal=norm(cross(inward,right));
 return {kind:surface.kind,coordinatesMm:[u,v],pointMm,right,inward,normal,du,dv};
}

export function contactSurfaceLines(surface){
 if(surface.kind==='body-skin')return {outline:[],lines:[]};
 const lines=[],point=(u,v)=>contactFrame(surface,u,v).pointMm;let outline;
 if(surface.kind==='skin'){
  const ring=fraction=>Array.from({length:65},(_,i)=>{const a=i*Math.PI/32;return point(surface.limitU*fraction*Math.cos(a),surface.limitV*fraction*Math.sin(a));});
  outline=ring(1);for(const fraction of [.25,.5,.75])lines.push(ring(fraction));
  for(let k=0;k<12;k++){const angle=k*Math.PI/6;lines.push(Array.from({length:17},(_,i)=>point(surface.limitU*i/16*Math.cos(angle),surface.limitV*i/16*Math.sin(angle))));}
 }else{
  const arc=v=>Array.from({length:33},(_,i)=>point(-surface.limitU+2*surface.limitU*i/32,v));
  outline=[...arc(-surface.limitV),...arc(surface.limitV).reverse()];
  for(let k=-3;k<=3;k++)lines.push(arc(surface.limitV*k/4));
  for(let k=-3;k<=3;k++)lines.push([point(surface.limitU*k/4,-surface.limitV),point(surface.limitU*k/4,surface.limitV)]);
 }
 return {outline,lines};
}

export function moveProbeState(state,frame,inputs,distanceMm){
 const pose=probePose(state,frame);if(!pose)return state;
 if(!state.contactLocked)return {...state,originMm:translateProbe(state,pose,inputs,distanceMm)};
 const surface=probeContactSurface(state.preset,frame);
 if(surface.kind==='body-skin'){const contact=moveOnSkin(surface,pose.contact,inputs,distanceMm);return {...state,skinContact:contact,contactPositionMm:null,originMm:[...contact.pointMm]};}
 const uv=contactCoordinates(state,surface),contact=contactFrame(surface,...uv),u=inputs.lateral||0,v=inputs.advance||0;
 const tangent=add(mul(contact.du,u),mul(contact.dv,v)),length=Math.hypot(...tangent);if(!length)return state;
 const next=clampContactCoordinates(surface,uv[0]+u*distanceMm/Math.max(1,length),uv[1]+v*distanceMm/Math.max(1,length));
 return {...state,contactPositionMm:next,originMm:contactFrame(surface,...next).pointMm};
}

/** Recover the same orientation relative to a new base (for contact toggles). */
export function anglesForProbePose(pose,baseRight,baseBeam){
 const normal=norm(cross(baseBeam,baseRight)),tilt=-Math.asin(clamp(dot(pose.beam,normal),-1,1));
 const sweep=Math.atan2(dot(pose.beam,baseRight),dot(pose.beam,baseBeam)),right=rotateVector(baseRight,normal,sweep),n=norm(cross(pose.beam,right));
 return {sweepDeg:sweep*180/Math.PI,tiltDeg:tilt*180/Math.PI,rollDeg:Math.atan2(dot(pose.right,n),dot(pose.right,right))*180/Math.PI};
}

export function setProbeContactLocked(state,frame,locked){
 const pose=probePose(state,frame);if(!pose)return {...state,contactLocked:locked};
 if(!locked){const baseBeam=mul(norm(frame.up),-1);return sanitizeProbeState({...state,contactLocked:false,originMm:pose.originMm,...anglesForProbePose(pose,norm(frame.right),baseBeam)});}
 const surface=probeContactSurface(state.preset,frame);
 if(surface.kind==='body-skin'){const base=restoreSkinContact(surface,{pointMm:pose.originMm,right:pose.right});return sanitizeProbeState({...state,contactLocked:true,skinContact:base,contactPositionMm:null,originMm:base.pointMm,...anglesForProbePose(pose,base.right,base.inward)});}
 const uv=projectToContact(surface,pose.originMm),base=contactFrame(surface,...uv);
 return sanitizeProbeState({...state,contactLocked:true,contactPositionMm:uv,originMm:base.pointMm,...anglesForProbePose(pose,base.right,base.inward)});
}

export function translateProbe(state,pose,{lateral=0,advance=0,elevation=0},distanceMm){
 const direction=add(add(mul(pose.right,lateral),mul(pose.beam,advance)),mul(pose.normal,elevation));
 const length=Math.hypot(...direction);if(!length)return [...pose.originMm];
 const bound=probePhysicalLimits(state.referenceMm).position;
 return add(pose.originMm,mul(direction,distanceMm/Math.max(1,length))).map(v=>clamp(v,-bound,bound));
}

export function steerProbe(state,{sweep=0,tilt=0,roll=0}){
 const limit=state.contactLocked&&!state.skinContact?65:85,sweepDeg=state.contactLocked?clamp(state.sweepDeg+sweep,-limit,limit):wrap(state.sweepDeg+sweep);
 return {...state,sweepDeg,tiltDeg:clamp(state.tiltDeg+tilt,-limit,limit),rollDeg:wrap(state.rollDeg+roll)};
}

export function beamPoint(pose,angle,depthMm){
 return add(pose.originMm,add(mul(pose.beam,Math.cos(angle)*depthMm),mul(pose.right,Math.sin(angle)*depthMm)));
}

/** A fan's rectangular screen bounds use its circular depth limit, not tan(). */
export function sectorGeometry(state){
 const halfAngle=radians(state.angleDeg/2),widthMm=2*state.depthMm*Math.sin(halfAngle);
 return {depthMm:state.depthMm,halfAngle,widthMm,heightMm:state.depthMm};
}

export function sectorPoint(pose,state,u,v){
 const sector=sectorGeometry(state),lateral=(u-.5)*sector.widthMm,forward=v*sector.depthMm;
 const depthMm=Math.hypot(lateral,forward),angle=Math.atan2(lateral,forward);
 return {inside:forward>=0&&depthMm<=sector.depthMm&&Math.abs(angle)<=sector.halfAngle,depthMm,angle,pointMm:add(pose.originMm,add(mul(pose.right,lateral),mul(pose.beam,forward)))};
}

/** Full source-box projection onto the current probe plane. This supplies a
 * complete measured cut cap while the fan separately marks the insonified area.
 */
export function probeCapPlane(pose,geometry){
 const origin=mul(pose.originMm,1/geometry.longestMm),right=pose.right,up=pose.up;
 let minU=Infinity,maxU=-Infinity,minV=Infinity,maxV=-Infinity;
 for(const x of [-.5,.5])for(const y of [-.5,.5])for(const z of [-.5,.5]){
  const delta=[x*geometry.extent[0]-origin[0],y*geometry.extent[1]-origin[1],z*geometry.extent[2]-origin[2]];
  const u=dot(delta,right),v=dot(delta,up);minU=Math.min(minU,u);maxU=Math.max(maxU,u);minV=Math.min(minV,v);maxV=Math.max(maxV,v);
 }
 const margin=.0025;
 return {center:add(origin,add(mul(right,(minU+maxU)/2),mul(up,(minV+maxV)/2))),right:[...right],up:[...up],normal:[...pose.normal],width:maxU-minU+2*margin,height:maxV-minV+2*margin};
}

export function capPixelWorld(plane,column,row,width,height){
 const u=(column/(width-1)-.5)*plane.width,v=(.5-row/(height-1))*plane.height;
 return add(plane.center,add(mul(plane.right,u),mul(plane.up,v)));
}

export function worldMillimetresToVoxel(pointMm,geometry,dimensions){
 const x=pointMm[0]/geometry.longestMm,y=pointMm[1]/geometry.longestMm,z=pointMm[2]/geometry.longestMm;
 return [(x/geometry.extent[0]+.5)*(dimensions[0]-1),(.5-z/geometry.extent[2])*(dimensions[1]-1),(y/geometry.extent[1]+.5)*(dimensions[2]-1)];
}

/** Same projection as the scalar renderer's ray construction. */
export function projectProbePoint(pointWorld,basis,width,height,fov=.32){
 const delta=pointWorld.map((v,i)=>v-basis.eye[i]),depth=dot(delta,basis.forward);
 if(depth<=.015)return null;
 return {x:(.5+.5*dot(delta,basis.right)/(depth*fov*(width/height)))*width,y:(.5-.5*dot(delta,basis.up)/(depth*fov))*height,depth};
}
