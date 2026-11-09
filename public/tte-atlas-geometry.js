/** TTE acquisition atlas: donor-specific measured sections and an independently
 * authored chest/probe guide. No chest geometry or probe position was acquired
 * with these excised hearts. Source pixels, prepared planes and TEE are untouched. */
import {add,mul,dot,cross,norm} from './planes.js';
import {rotateVector,projectProbePoint,probePhysicalScale} from './probe-geometry.js';
import {GeometryCanvas,triangleMesh,createReferenceProbeMeshes,probeModelMatrix} from './probe-scene.js';
import {createTeeContextFrame,teeContextToWorld,teeContextToLocal} from './tee-context-geometry.js';
import {TeeDepthLabels} from './tee-depth-labels.js';
import {paintTeeContextLabels} from './tee-scene.js';
import {withHeartPriority,contextLabelMetrics} from './echo-context-presentation.js';
import {depthRaster,depthColor,depthTriangle,paintDepthRaster,depthPointVisible} from './tee-software-depth.js';

const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const unit=(v,f=[0,1,0])=>Math.hypot(...v)>1e-8?norm(v):[...f];
const off=(v,n)=>sub(v,mul(n,dot(v,n)));
const radians=x=>x*Math.PI/180;
const mix=(a,b,t)=>add(mul(a,1-t),mul(b,t));
const sourcePoint=([x,y,z])=>[(x-237)/529,(z-264.5)/529,(237-y)/529];
const probeMeshes=createReferenceProbeMeshes('phased');
const probeSupport=bounds(probeMeshes.slice(0,-1).flatMap(m=>{const points=[];for(let i=0;i<m.vertices.length;i+=6)points.push(Array.from(m.vertices.subarray(i,i+3)));return points;}));

function frame(center,right,up,width=.78,height=.88){
 up=unit(up);right=unit(off(right,up),[1,0,0]);
 return {center:[...center],right,up,normal:unit(cross(right,up)),width,height,atlasDerived:true,
  note:'Approximate educational TTE target in this donor. The external probe and living-patient acoustic window are not registered to the specimen.'};
}
function presented(p){return {...p,right:mul(p.right,!!p.displayMirrorX!==!!p.displayRotate180?-1:1),up:mul(p.up,p.displayRotate180?-1:1),displayMirrorX:false,displayRotate180:false};}
function shift(base,{center=base.center,rotate=0,tilt=0,width=base.width,height=base.height}={}){
 const right=rotateVector(base.right,base.up,radians(rotate));
 return frame(center,right,rotateVector(base.up,right,radians(tilt)),width,height);
}

/** Unchanged named source planes retain their prepared images. Every changed
 * rectangle/plane is atlasDerived, forcing a reformat of actual donor voxels. */
export function buildTteAtlasFrames(existing,views,{geometricComparisonOnly=false,flowFrames={},donorId='unassigned'}={}){
 const result={...existing};if(!existing.a4c||!existing.plax)return result;
 const sourceAnchors=!geometricComparisonOnly&&/^(ladaf-2021-17|1659197537)$/i.test(String(donorId));
 const four=presented(existing.a4c),two=presented(existing.a2c||existing.a4c),three=presented(existing.a3c||existing.plax),plax=presented(existing.plax);
 const pap=presented(existing.psax_papillary||existing.plax),mv=presented(existing.psax_mitral||existing.psax_papillary||existing.plax);
 const base=add(four.center,mul(four.up,-.19));
 const put=(id,p,opts={})=>{result[id]=shift(p,opts);};
 put('plax_deep',plax,{width:plax.width*1.15,height:plax.height*1.20});
 const projectToPlax=p=>sub(p,mul(plax.normal,dot(sub(p,plax.center),plax.normal)));
 put('plax_av',plax,{center:sourceAnchors?projectToPlax(sourcePoint([260,265,270])):add(plax.center,mul(plax.right,.13)),width:.44,height:.44});
 put('plax_mv',plax,{center:sourceAnchors?projectToPlax(sourcePoint([290,274,280])):add(plax.center,mul(plax.right,.07)),width:.48,height:.48});
 put('plax_rvot',flowFrames['rv-outflow']||plax,flowFrames['rv-outflow']?{}:{rotate:8,tilt:7});
 put('plax_rvin',flowFrames['rv-inflow']||four,flowFrames['rv-inflow']?{}:{rotate:-12,tilt:12});
 const av=sourceAnchors?sourcePoint([260,265,270]):base;
 const ao=sourceAnchors?sourcePoint([193.5,241.5,163.3456]):add(base,mul(four.up,-.14));
 const aorticAxis=unit(sub(ao,av));
 const avRight=unit(off(pap.right,aorticAxis),pap.right),avUp=unit(cross(aorticAxis,avRight));
 const avSax=frame(av,avRight,avUp,.70,.70);
 put('psax_great',avSax,{center:mix(av,ao,.5),width:.76,height:.76});
 put('psax_av',avSax);
 put('psax_av_zoom',avSax,{width:.37,height:.37});
 put('psax_tv',avSax,{center:add(av,mul(four.right,-.11)),width:.62,height:.62,tilt:8});
 put('psax_pv',avSax,{center:add(av,mul(four.right,.08)),width:.65,height:.65,tilt:-10});
 if(sourceAnchors){
  // plane-fit-v2.json / views.meavsax independently reviewed the LADAF
  // three-sinus/cusp region at [242.5,252,235]. The longitudinal LVOT focus
  // [260,265,270] is too inferior for the AV short-axis target. Measured v6
  // source comparisons support a bounded 3 mm superior root-level refinement.
  const cuspRegion=sourcePoint([242.5,252,235]);
  const cuspNormal=unit([-.49697660993458026,-.8601518248867738,-.11468690998490312]);
  const cuspCenter=add(cuspRegion,mul(cuspNormal,3/168.0104)),cuspRight=unit(off(avRight,cuspNormal),avRight),cuspUp=unit(cross(cuspNormal,cuspRight));
  const cuspTarget={...frame(cuspCenter,cuspRight,cuspUp,.70,.70),preferSourcePlane:true,sourceTargetRevision:'ladaf-source-aortic-valve-target-v6',
   anatomyTargetsMm:[{key:'reviewedAorticCuspRegion',pointMm:mul(cuspRegion,168.0104),weight:2,toleranceMm:3.5},{key:'proximalAorticLumen',pointMm:mul(sourcePoint([239,254,225]),168.0104),weight:1,toleranceMm:1}],
   sourceTargetProvenance:{catalog:'assets/tee-atlas/plane-fit-v2.json',view:'meavsax',reviewedCenterSourceXYZ:[242.5,252,235],superiorOffsetMm:3,clinicalCuspIdentityValidated:false},
   note:'Source-reviewed LADAF aortic-root short-axis neighborhood with a measured 3 mm superior refinement. Individual cusp identities and clinical probe registration remain unvalidated.'};
  result.psax_av=cuspTarget;result.psax_av_zoom={...cuspTarget,width:.37,height:.37};
  // Independently reviewed LADAF source: visible pulmonary cusp at [174,292,226]
  // and the proximal PA cavity track, not an offset of the aortic SAX plane.
  // Keep their longitudinal plane when fitting the reference chest contact.
  const pv=sourcePoint([174,292,226]),pa=sourcePoint([205,317,210]);
  const n=unit(cross(sub(pa,pv),sub(av,pv))),right=unit(off(pap.right,n)),up=unit(cross(n,right));
  result.psax_pv={...frame(mix(pv,pa,.25),right,up,.68,.64),preferSourcePlane:true,sourceTargetRevision:'ladaf-source-pulmonary-target-v6',
   anatomyTargetsMm:[['pulmonaryRoot',pv],['pulmonarySuperior',pa],['lvotRegion',av]].map(([key,p])=>({key,pointMm:mul(p,168.0104),weight:key==='pulmonaryRoot'?2:1,toleranceMm:7})),
   note:'Longitudinal pulmonary outflow through the independently reviewed cusp region and proximal PA, with an LVOT-neighborhood point defining the adjacent section. Named cusp identity is not clinically validated.'};
 }
 put('psax_apical',pap,{center:add(pap.center,mul(four.up,.17)),width:.58,height:.58});
 put('a4c_lv',four,{center:add(four.center,mul(four.up,.08)),width:.61,height:.76});
 put('a4c_rv',four,{center:add(four.center,mul(four.right,-.10)),rotate:-10,width:.72,height:.85});
 put('a5c',four,{rotate:9,tilt:-10});
 put('a4c_cs',four,{rotate:-10,tilt:12});
 put('a2c_lv',two,{center:add(two.center,mul(two.up,.07)),width:.57,height:.74});
 put('a3c_lv',three,{center:add(three.center,mul(three.up,.07)),width:.61,height:.74});
 put('a4c_la_pv',four,{center:add(four.center,mul(four.up,-.23)),width:.65,height:.57});
 // A heart-only acquisition cannot supply a liver window, the abdominal IVC,
 // hepatic veins or the complete aortic arch. Keep those as spatial targets.
 for(const [id,p]of [['subcostal_ivc',existing.bicaval||four],['subcostal_hepatic',existing.bicaval||four],['ssn_arch',plax]]){
  result[id]={...shift(p),outsideScan:true,note:'The required extracardiac target is outside this heart-only acquisition. The probe and chest are illustrative; no corresponding CT slice is claimed.'};
 }
 for(const view of views)if(!result[view.id])result[view.id]=shift(four);
 return result;
}

function bounds(points){const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const p of points)for(let i=0;i<3;i++){min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i]);}return {min,max,center:mix(min,max,.5)};}
function tube(points,radius=2,segments=10){
 const vertices=[],faces=[];
 for(let j=0;j<points.length;j++){
  const tangent=unit(sub(points[Math.min(j+1,points.length-1)],points[Math.max(0,j-1)]));
  let side=cross(tangent,[0,1,0]);if(Math.hypot(...side)<.01)side=cross(tangent,[1,0,0]);side=unit(side);const normal=unit(cross(tangent,side));
  for(let i=0;i<segments;i++){const a=i*Math.PI*2/segments;vertices.push(add(points[j],add(mul(side,Math.cos(a)*radius),mul(normal,Math.sin(a)*radius))));}
 }
 for(let j=0;j<points.length-1;j++)for(let i=0;i<segments;i++){const a=j*segments+i,b=j*segments+(i+1)%segments;faces.push([a,b,b+segments],[a,b+segments,a+segments]);}
 return triangleMesh(vertices,faces);
}
function mesh(id,vertices,color,alpha,role='surface'){
 const points=[];for(let i=0;i<vertices.length;i+=6)points.push(Array.from(vertices.subarray(i,i+3)));
 return {id,vertices,color,alpha,gloss:.04,role,bounds:bounds(points)};
}

export const TTE_WINDOW_ANCHORS=Object.freeze({
 'parasternal-long':Object.freeze([-8,18,73]),'parasternal-short':Object.freeze([-8,18,73]),
 apical:Object.freeze([63,-37,59]),subcostal:Object.freeze([-13,-72,52]),suprasternal:Object.freeze([-23,91,60])
});

/** Marker directions follow the clinical acoustic window, independent of the
 * CT raster's chosen presentation. Left-lateral bedward is modeled as patient
 * left. Negative roll is counterclockwise looking along the inward beam. */
export function tteClinicalMarkerDirection(view,beam,model){
 const f=model.frame,group=view.group;let local=group==='parasternal-long'?[-1,1,0]:group==='parasternal-short'||group==='suprasternal'?[1,1,0]:[1,0,0];
 if(view.id==='subcostal_ivc'||view.id==='subcostal_hepatic')local=[0,1,0];
 let marker=unit(add(mul(f.left,local[0]),add(mul(f.superior,local[1]),mul(f.anterior,local[2]))));
 if(group==='apical'){
  const origin=teeContextToWorld(TTE_WINDOW_ANCHORS.apical,f),axis=unit(sub(f.originMm,origin));
  const angle=view.id.startsWith('a2c')?-60:view.id.startsWith('a3c')?-120:0;
  marker=rotateVector(unit(off(f.left,axis),f.superior),axis,radians(angle));
 }
 return unit(off(marker,beam),unit(off(f.superior,beam),f.left));
}

/** A deliberately quiet partial thorax, fixed across all view changes. All
 * contours are real 3D meshes, so accepted heart depth occludes them exactly. */
export function createTteContextModel(options={}){
 const f=createTeeContextFrame(options),world=p=>teeContextToWorld(p,f),meshes=[];
 const ribColor=[.56,.66,.65];
 for(let r=0;r<5;r++)for(const sign of [-1,1]){
  const level=65-r*23,rx=88+r*4,pts=Array.from({length:45},(_,i)=>{const a=i/44*Math.PI;return world([-24+sign*rx*Math.sin(a),level-17*Math.sin(a),5+64*Math.cos(a)]);});
  meshes.push(mesh(`rib-${r}-${sign}`,tube(pts,1.6*f.scale),ribColor,.10));
 }
 const sternum=Array.from({length:22},(_,i)=>world([-24,79-i*5,68-.0015*(i*5-45)**2]));
 meshes.push(mesh('sternum',tube(sternum,4.0*f.scale,16),[.65,.69,.66],.16));
 for(const sign of [-1,1]){
  const pts=Array.from({length:25},(_,i)=>{const t=i/24;return world([-24+sign*86*t,84+7*Math.sin(t*Math.PI),64-28*t*t]);});
  meshes.push(mesh(`clavicle-${sign}`,tube(pts,2.0*f.scale),ribColor,.12));
 }
 const points=[],faces=[],rings=13,segments=52;
 for(let r=0;r<=rings;r++)for(let s=0;s<segments;s++){const a=s/segments*Math.PI*2,t=r/rings;points.push(world([-10+97*t*Math.cos(a),-74+14*(1-t*t),-3+66*t*Math.sin(a)]));}
 for(let r=0;r<rings;r++)for(let s=0;s<segments;s++){const a=r*segments+s,b=r*segments+(s+1)%segments;faces.push([a,b,b+segments],[a,b+segments,a+segments]);}
 meshes.push(mesh('diaphragm',triangleMesh(points,faces),[.37,.58,.54],.055));
 const labels=[{id:'sternum',text:'Sternum',pointMm:world([-24,53,68]),priority:1},{id:'ribs',text:'Rib cage',pointMm:world([-96,29,35]),priority:3},{id:'diaphragm',text:'Diaphragm',pointMm:world([69,-69,15]),priority:2}];
 const focusLocal=[[-72,-78,-45],[92,98,80],[0,0,0]],focusBounds=bounds(focusLocal.map(world));
 return {revision:'tte-thorax-v1',frame:f,referenceMm:f.referenceMm,meshes,labels,contours:{},bounds:bounds(meshes.flatMap(m=>[m.bounds.min,m.bounds.max])),focusBounds,
  camera:{preferredAway:unit(add(mul(f.anterior,.96),mul(f.left,.29)))},
  provenance:{kind:'Illustrative external anatomy',segmentedFromDonor:false,patientRegistered:false,orientation:f.kind}};
}

export function tteContextCamera(model,aspect=1){
 const away=model.camera.preferredAway,forward=mul(away,-1),right=unit(cross(forward,model.frame.superior)),up=unit(cross(right,forward));
 const targetMm=teeContextToWorld([5,0,10],model.frame),ratio=Math.max(.2,Number(aspect)||1);let distanceMm=180*model.frame.scale;
 for(let mask=0;mask<8;mask++){
  const p=model.focusBounds.min.map((v,i)=>(mask>>i)&1?model.focusBounds.max[i]:v),q=sub(p,targetMm),z=dot(q,forward);
  distanceMm=Math.max(distanceMm,Math.abs(dot(q,right))*1.06/(.32*ratio)-z,Math.abs(dot(q,up))*1.06/.32-z);
 }
 return {forward,right,up,targetMm,distanceMm};
}

/** A modest projection may place the probe in the current plane. Large
 * differences retain the correct chest window and are shown as a dashed,
 * independent estimate; no specimen plane moves to accommodate the artwork. */
export function tteAtlasProbePose(plane,view,referenceMm,model){
 if(plane.acquisitionPose)return plane.acquisitionPose;
 const f=model.frame,scale=f.scale,group=view?.group||'apical',anchor=teeContextToWorld(TTE_WINDOW_ANCHORS[group]||TTE_WINDOW_ANCHORS.apical,f);
 const outside=!!plane.outsideScan||['subcostal_ivc','subcostal_hepatic','ssn_arch'].includes(view?.id);
 const special={subcostal_ivc:[-26,-16,9],subcostal_hepatic:[-34,-73,1],ssn_arch:[-18,72,-13]};
 const targetMm=outside?teeContextToWorld(special[view.id]||[0,0,0],f):mul(plane.center,referenceMm);
 const n=unit(plane.normal||cross(plane.right,plane.up)),residual=dot(sub(anchor,targetMm),n),projected=sub(anchor,mul(n,residual));
 const local=teeContextToLocal(projected,f);let canFit=!outside&&Math.abs(residual)<=14*scale&&local[2]>=38&&local[2]<=96;
 const candidateBeam=unit(sub(targetMm,projected)),candidateMarker=tteClinicalMarkerDirection(view,candidateBeam,model);
 let candidateRight=unit(cross(n,candidateBeam),unit(off(plane.right,candidateBeam),f.left));
 if(dot(mul(candidateRight,-1),candidateMarker)<0)candidateRight=mul(candidateRight,-1);
 const markerAgreement=Math.acos(Math.max(-1,Math.min(1,dot(mul(candidateRight,-1),candidateMarker))))*180/Math.PI;
 canFit=canFit&&markerAgreement<=25;
 const originMm=canFit?projected:anchor,beam=unit(sub(targetMm,originMm));
 const markerDirection=tteClinicalMarkerDirection(view,beam,model),right=canFit?candidateRight:mul(markerDirection,-1);
 const normal=unit(cross(beam,right)),depth=Math.hypot(...sub(targetMm,originMm))+38*scale;
 return {referenceMm,originMm,targetMm,beam,right,normal,up:mul(beam,-1),instrument:{originMm,beam,right,normal},sectorDepthMm:Math.max(65*scale,Math.min(180*scale,depth)),
  markerDirection:mul(right,-1),markerReference:markerDirection,
  contextFit:{resolved:canFit,estimated:!canFit,registered:false,outsideScan:outside,window:group,levelLabel:view?.position||'External acoustic window',distanceMm:Math.abs(residual),markerAgreementDeg:canFit?markerAgreement:0,clinicalPositionMeasured:false}};
}

/** Frame the complete instrument handle; the long cable may leave the image.
 * This changes the camera only, never CT geometry, pixels or retained tissue. */
export function tteProbeFocusPoints(pose){
 const scale=.45*probePhysicalScale(pose.referenceMm),points=[];
 for(let mask=0;mask<8;mask++){
  const [x,y,z]=probeSupport.min.map((v,i)=>(mask>>i)&1?probeSupport.max[i]:v);
  points.push(add(pose.originMm,add(mul(pose.right,x*scale),add(mul(pose.normal,y*scale),mul(pose.beam,-z*scale)))));
 }
 return [pose.originMm,pose.targetMm,...points];
}
export function tteProbeCameraDistance(pose,basis,target,aspect=1,minimum=1.55){
 let distance=minimum;
 for(const p of tteProbeFocusPoints(pose)){
  const q=sub(mul(p,1/pose.referenceMm),target),z=dot(q,basis.forward);
  distance=Math.max(distance,Math.abs(dot(q,basis.right))/(.288*Math.max(.2,aspect))-z,Math.abs(dot(q,basis.up))/.288-z);
 }
 return distance;
}

export class TteScene{
 constructor(renderer,canvas){
  if(!renderer?.gl||!renderer.setContextLayer)throw new Error('Shared heart depth is unavailable.');
  this.renderer=renderer;this.view=new GeometryCanvas(renderer.canvas,{gl:renderer.gl});this.labels=new TeeDepthLabels(renderer);this.active=false;
  this.probe=probeMeshes.map(m=>this.view.upload(m.vertices,m.color,1,m.gloss));
  this.layer={draw:frame=>this.draw(frame),onError:error=>{this.setActive(false);console.warn('TTE anatomy context:',error);}};
 }
 setActive(active){this.active=!!active;if(this.active&&this.params&&(this.params.showProbe||this.params.showContext))this.renderer.setContextLayer(this.layer);else if(this.renderer.contextLayer===this.layer)this.renderer.setContextLayer(null);}
 set(params){this.params=params;this.setActive(this.active);this.renderer.requestRender();}
 draw({basis,width,height}){
  if(!this.active||!this.params)return;const {pose,contextModel,showContext,showProbe,probeLabel}=this.params;
  this.view.begin(basis,width,height,pose.referenceMm,1);
  if(showProbe){const matrix=probeModelMatrix(pose.instrument,.45*probePhysicalScale(pose.referenceMm));for(const m of this.probe)this.view.draw(m,matrix);}
  if(showContext){
   if(this.model!==contextModel){for(const m of this.context||[])this.view.remove(m);this.model=contextModel;this.context=contextModel.meshes.map(m=>({...this.view.upload(m.vertices,m.color,m.alpha,m.gloss),center:m.bounds.center}));}
   const ordered=[...this.context].sort((a,b)=>dot(b.center,basis.forward)-dot(a.center,basis.forward));
   const gl=this.view.gl;withHeartPriority(gl,()=>{gl.enable(gl.CULL_FACE);gl.cullFace(gl.FRONT);for(const m of ordered)this.view.draw(m);gl.cullFace(gl.BACK);for(const m of ordered)this.view.draw(m);gl.disable(gl.CULL_FACE);});
  }
  this.labels.draw({basis,width,height,referenceMm:pose.referenceMm,model:contextModel,pose,showContext,showProbe,probeLabel});
 }
 dispose(){this.setActive(false);this.labels.dispose();this.view.dispose();}
}

function paintProbeDepth(ctx,project,pose,occlusion,w,h){
 if(!occlusion?.data||occlusion.pending)return;
 const raster=depthRaster(occlusion,w,h),s=.45*probePhysicalScale(pose.referenceMm);
 const world=p=>add(pose.originMm,add(mul(pose.right,p[0]*s),add(mul(pose.normal,p[1]*s),mul(pose.beam,-p[2]*s))));
 for(const mesh of probeMeshes){const a=mesh.vertices,color=depthColor(`rgba(${mesh.color.map(v=>Math.round(v*255)).join(',')},1)`);for(let i=0;i<a.length;i+=18){const ps=[0,6,12].map(k=>project(world(a.subarray(i+k,i+k+3))));if(ps.every(Boolean))depthTriangle(raster,ps,color);}}
 paintDepthRaster(ctx,raster,w,h);
}

export class TteAtlasOverlay{
 constructor({renderer,meshCanvas,guideCanvas,mount}){this.renderer=renderer;this.meshCanvas=meshCanvas;this.guideCanvas=guideCanvas;this.mount=mount;try{this.scene=new TteScene(renderer,meshCanvas);}catch{this.scene=null;}}
 start(){if(this.running)return;this.running=true;this.scene?.setActive(true);const tick=()=>{if(!this.running)return;this.draw();this.raf=requestAnimationFrame(tick);};tick();}
 stop(){this.running=false;cancelAnimationFrame(this.raf);this.scene?.setActive(false);this.meshCanvas.hidden=true;this.guideCanvas.hidden=true;this.key='';}
 set({plane,view,referenceMm,showProbe=true,showSector=true,showContext=true,contextModel}){
  Object.assign(this,{plane,view,referenceMm,showProbe,showSector,showContext,contextModel});this.pose=plane&&contextModel?tteAtlasProbePose(plane,view,referenceMm,contextModel):null;this.key='';
  if(this.pose)this.scene?.set({pose:this.pose,contextModel,showProbe,showContext,probeLabel:`TTE · ${view.code}`});if(this.running)this.draw();
 }
 draw(){
  if(!this.running||!this.pose||this.mount.hidden)return;const rect=this.renderer.canvas.getBoundingClientRect(),w=Math.round(rect.width),h=Math.round(rect.height);if(w<2||h<2)return;
  const c=this.renderer.camera,key=[w,h,c.yaw,c.pitch,c.roll,c.distance,...c.pan,this.showProbe,this.showSector,this.showContext,this.renderer.contextFrameRevision??this.renderer.displayedRevision??this.renderer.displayedId??0].join(',');if(key===this.key)return;this.key=key;
  const cv=this.guideCanvas,dpr=Math.min(globalThis.devicePixelRatio||1,2);this.meshCanvas.hidden=true;cv.hidden=!this.showSector&&!this.showProbe&&!this.showContext;
  cv.style.width=w+'px';cv.style.height=h+'px';if(cv.width!==Math.round(w*dpr))cv.width=Math.round(w*dpr);if(cv.height!==Math.round(h*dpr))cv.height=Math.round(h*dpr);
  const ctx=cv.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  const basis=this.renderer.basis(),project=p=>projectProbePoint(mul(p,1/this.referenceMm),basis,w,h),pose=this.pose,occlusion=this.renderer.getContextOcclusion?.();
  if(!this.scene){if(this.showContext&&occlusion?.data)paintTeeContextLabels(ctx,project,this.contextModel,w,h,{occlusion,fallback:true});if(this.showProbe)paintProbeDepth(ctx,project,pose,occlusion,w,h);}
  if(this.showSector){
   const half=radians(37),arc=Array.from({length:49},(_,i)=>{const a=-half+2*half*i/48;return add(pose.originMm,add(mul(pose.beam,Math.cos(a)*pose.sectorDepthMm),mul(pose.right,Math.sin(a)*pose.sectorDepthMm)));}),points=[pose.originMm,...arc].map(project);
   if(points.every(Boolean)){ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fillStyle='rgba(220,175,111,.025)';ctx.fill();ctx.strokeStyle='rgba(224,184,128,.62)';ctx.lineWidth=1.1;if(pose.contextFit.estimated)ctx.setLineDash([5,5]);ctx.stroke();ctx.setLineDash([]);}
  }
  if(this.showProbe&&!this.scene){const p=project(pose.originMm);if(depthPointVisible(occlusion,p,w,h)){ctx.font=contextLabelMetrics(w,h).font;ctx.fillStyle='#e6c99e';ctx.fillText(`Estimated TTE · ${this.view.code}`,Math.min(w-170,Math.max(12,p.x+12)),Math.max(20,p.y-12));}}
 }
 dispose(){this.stop();this.scene?.dispose();}
}
