/**
 * Authored spatial context for TEE, in the same world millimetres as the heart.
 *
 * These organs were NOT acquired with the excised heart. The LADAF orientation
 * uses approximate, source-reviewed cardiac anchors; their relationship to a
 * living patient's body is an illustrative assumption. Comparison donors use
 * their own source-reviewed frame and measured-clearance context. No active
 * image plane, electronic angle or probe pose is an input to this model.
 *
 * GeometryCanvas.upload(mesh.vertices, mesh.color, mesh.alpha, mesh.gloss)
 * accepts each returned mesh directly. Vertices are triangle-expanded XYZ/NXYZ.
 */
import {add,mul,dot,cross,norm} from './planes.js';
import {getEchoDonorCalibration} from './echo-donor-calibration.js';

export const TEE_CONTEXT_REVISION='anatomical-context-v2';
const BASE_MM=168.0104;
const TAU=Math.PI*2;
const sub=(a,b)=>a.map((x,i)=>x-b[i]);
const mix=(a,b,t)=>a.map((x,i)=>x*(1-t)+b[i]*t);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const finite3=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const unit=(v,fallback=[0,1,0])=>Math.hypot(...v)>1e-8?norm(v):[...fallback];
const projectOff=(v,n)=>sub(v,mul(n,dot(v,n)));
const freezeVector=v=>Object.freeze([...v]);
const frameOf=f=>f?.world||f;

/** Source s4 voxel centres. Chamber tracks are [z,x,y,rx,ry] in their source
 * document; these constants have explicitly been converted to source XYZ. */
const LADAF_ANCHORS=Object.freeze({
 leftAtrium:[313,263,220],rightAtrium:[236,172,210],
 // Root/cusp-region ROI: tee-atlas/plane-fit-v2 meavsax source review.
 // It is not an expert-segmented annular centroid. The older flow target is
 // retained separately because its LVOT-focused apical slice preserves LV.
 rightAtriumSuperior:[230,182,150],aorticLumen:[239,254,225],aorticRoot:[242.5,252,235],leftVentricularOutflow:[260,265,270],
 mitralRegion:[290,274,280],tricuspidRegion:[239.735,181.275,289.342],
 leftVentricle:[246,279,360],rightVentricle:[186,180,350],apex:[191,251,478]
});
const sourcePoint=(p,referenceMm)=>[(p[0]-237)/529*referenceMm,(p[2]-264.5)/529*referenceMm,(237-p[1])/529*referenceMm];

/** A fixed right-handed L/S/A reference. `originMm` is near the AV junctions.
 * Explicit frames may supply `posterior` instead of `anterior`. Input vectors
 * are copied and orthogonalized; neither metadata nor source frames are edited. */
export function createTeeContextFrame({frames={},referenceMm=BASE_MM,donorId='ladaf-2021-17',anatomicalFrame}={}){
 if(!(Number.isFinite(referenceMm)&&referenceMm>0))throw new TypeError('TEE context needs a positive physical referenceMm.');
 const scale=referenceMm/BASE_MM;
 let originMm,left,superior,anterior,landmarksMm={},kind,contextProfile;
 if(anatomicalFrame){
  const f=anatomicalFrame;
  if(!finite3(f.originMm)||!finite3(f.superior)||(!finite3(f.left)&&!finite3(f.posterior)&&!finite3(f.anterior)))throw new TypeError('A context frame needs finite originMm, superior, and left or anterior/posterior.');
  originMm=[...f.originMm];superior=unit(f.superior);
  if(finite3(f.left))left=unit(projectOff(f.left,superior));
  else left=unit(cross(superior,finite3(f.anterior)?f.anterior:mul(f.posterior,-1)));
  anterior=unit(cross(left,superior));left=unit(cross(superior,anterior));
  kind=f.kind||'explicit-illustrative-frame';
  if(f.landmarksMm)for(const [key,p]of Object.entries(f.landmarksMm))if(finite3(p))landmarksMm[key]=freezeVector(p);
  contextProfile=f.contextProfile;
 }else if(/^(ladaf-2021-17|1659197537)$/i.test(String(donorId))){
  landmarksMm=Object.fromEntries(Object.entries(LADAF_ANCHORS).map(([key,p])=>[key,freezeVector(sourcePoint(p,referenceMm))]));
  originMm=mul(add(landmarksMm.mitralRegion,landmarksMm.tricuspidRegion),.5);
  const atrialAxis=unit(sub(landmarksMm.rightAtriumSuperior,landmarksMm.rightAtrium));
  // An excised heart has no measured body vertical. Balance the longitudinal
  // atrial trend with the independently reviewed 4C section's normal, fixed
  // here at its source-review revision. This keeps the apex inferior while
  // admitting a clinically plausible oblique heart above the gastric fundus.
  // Never replace this constant with the currently selected electronic plane.
  const reviewedFourChamberNormal=unit([-.7816532,-.36674548,-.50449581]);
  superior=unit(add(atrialAxis,reviewedFourChamberNormal));
  const posterior=unit(projectOff(sub(landmarksMm.leftAtrium,landmarksMm.aorticLumen),superior));
  left=unit(cross(posterior,superior));anterior=mul(posterior,-1);
  kind='source-anchored-illustrative-frame';
 }else if(getEchoDonorCalibration(donorId,referenceMm)){
  const calibration=getEchoDonorCalibration(donorId,referenceMm),f=calibration.anatomicalFrame;
  ({originMm,left,superior,anterior,landmarksMm,kind}=f);
  contextProfile=calibration.contextProfile;
 }else{
  const f=frameOf(frames.me4c)||frameOf(frames.a4c)||{};
  superior=unit(finite3(f.up)?f.up:[0,-1,0]);
  left=unit(projectOff(finite3(f.right)?mul(f.right,-1):[1,0,0],superior),[0,0,1]);
  anterior=unit(cross(left,superior));left=unit(cross(superior,anterior));
  originMm=add(finite3(f.center)?mul(f.center,referenceMm):[0,0,0],mul(superior,20*scale));
  kind='scaled-geometric-context';
 }
 const frame={kind,donorId,referenceMm,scale,originMm:freezeVector(originMm),left:freezeVector(left),superior:freezeVector(superior),anterior:freezeVector(anterior),posterior:freezeVector(mul(anterior,-1)),landmarksMm:Object.freeze(landmarksMm),contextProfile,patientOrientationValidated:false};
 return Object.freeze(frame);
}

/** Local coordinates are illustrative adult millimetres: left, superior,
 * anterior. Their uniform size follows the donor's own physical extent. */
export function teeContextToWorld(local,frame){
 return add(frame.originMm,add(mul(frame.left,local[0]*frame.scale),add(mul(frame.superior,local[1]*frame.scale),mul(frame.anterior,local[2]*frame.scale))));
}
export function teeContextToLocal(world,frame){
 const q=sub(world,frame.originMm);return [dot(q,frame.left),dot(q,frame.superior),dot(q,frame.anterior)].map(x=>x/frame.scale);
}

// A C1 Catmull-Rom interpolant. There are no duplicated circumference vertices;
// normals at the longitudinal seam are therefore identical on both sides.
function spline(points,t){
 const s=clamp(t,0,1)*(points.length-1),i=Math.min(points.length-2,Math.floor(s)),u=s-i;
 const b=points[i],c=points[i+1],a=points[i-1]||sub(mul(b,2),c),d=points[i+2]||sub(mul(c,2),b);
 return b.map((x,k)=>.5*((2*x)+(-a[k]+c[k])*u+(2*a[k]-5*x+4*c[k]-d[k])*u*u+(-a[k]+3*x-3*c[k]+d[k])*u*u*u));
}
const tangent=(points,t)=>unit(sub(spline(points,clamp(t+.0002,0,1)),spline(points,clamp(t-.0002,0,1))));

function boundsOf(points){
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(const p of points)for(let k=0;k<3;k++){min[k]=Math.min(min[k],p[k]);max[k]=Math.max(max[k],p[k]);}
 return {min,max,center:mix(min,max,.5)};
}
function geometry(positions,faces){
 const normals=positions.map(()=>[0,0,0]);
 for(const [a,b,c]of faces){const n=cross(sub(positions[b],positions[a]),sub(positions[c],positions[a]));for(const i of [a,b,c])for(let k=0;k<3;k++)normals[i][k]+=n[k];}
 return {positions,faces,normals:normals.map(n=>unit(n))};
}
function interleaved(g,faces=g.faces){
 const out=new Float32Array(faces.length*18);let at=0;
 for(const face of faces)for(const i of face){out.set(g.positions[i],at);out.set(g.normals[i],at+3);at+=6;}
 return out;
}
function mesh(g,id,color,alpha,gloss=.08,faces=g.faces,role='surface'){
 const vertices=interleaved(g,faces),points=[];
 for(const face of faces)for(const i of face)points.push(g.positions[i]);
 return Object.freeze({id,vertices,color:Object.freeze(color),alpha,gloss,role,bounds:boundsOf(points)});
}
function topology(g,details={}){
 return Object.freeze({positionsMm:new Float32Array(g.positions.flat()),indices:new Uint32Array(g.faces.flat()),...details});
}
function ringFaces(rings,segments){
 const faces=[];
 for(let i=0;i<rings-1;i++)for(let j=0;j<segments;j++){
  const a=i*segments+j,b=i*segments+(j+1)%segments,c=(i+1)*segments+j,d=(i+1)*segments+(j+1)%segments;
  faces.push([a,b,c],[b,d,c]);
 }
 return faces;
}
function curveTube(points,radius,frame,segments=8,closed=false){
 const positions=[],n=points.length;
 for(let i=0;i<n;i++){
  const prev=points[closed?(i+n-1)%n:Math.max(0,i-1)],next=points[closed?(i+1)%n:Math.min(n-1,i+1)],t=unit(sub(next,prev));
  let a=projectOff(closed?[0,1,0]:[0,0,1],t);if(Math.hypot(...a)<.1)a=projectOff([1,0,0],t);a=unit(a);const b=unit(cross(t,a));
  for(let j=0;j<segments;j++){const angle=j*TAU/segments;positions.push(teeContextToWorld(add(points[i],add(mul(a,Math.cos(angle)*radius),mul(b,Math.sin(angle)*radius))),frame));}
 }
 const faces=ringFaces(n,segments);
 if(closed)for(let j=0;j<segments;j++){const a=(n-1)*segments+j,b=(n-1)*segments+(j+1)%segments,c=j,d=(j+1)%segments;faces.push([a,b,c],[b,d,c]);}
 return geometry(positions,faces);
}

/** Asymmetric two-dome sheet. Its central flatter region is distinguished as
 * tendon; the posterior opening is a real mesh boundary, not a painted disk. */
export function teeDiaphragmHeight(leftMm,anteriorMm,frame){
 const x=leftMm,z=anteriorMm;
 return -82+55*Math.exp(-(((x+48)/50)**2+((z-5)/65)**2))+49*Math.exp(-(((x-52)/48)**2+((z+17)/58)**2))+7*Math.exp(-((x/38)**2+((z-15)/43)**2))+(frame?.contextProfile?.diaphragmOffsetMm||0);
}

function gastrointestinal(frame){
 const profile=frame.contextProfile||{},hiXZ=profile.hiatusXZ||[12,-29];
 const hi=[hiXZ[0],teeDiaphragmHeight(...hiXZ,frame),hiXZ[1]],gej=add(hi,[3,-12,4]),gy=gej[1];
 // One broad, smooth posterior course in the fixed body frame. The central
 // ME anchor maps near source XYZ [387,285,108], where the independently
 // reviewed 4C/2C/LAX sections nearly meet outside the preserved LA envelope.
 // Keeping the local shaft mainly inferior avoids a horizontal elbow solely
 // to intersect another image plane. The lower curve stays outside the LV.
 const controls=[...(profile.esophagusControls||[[19,110,-49],[15,88,-54],[10,70,-58],[-4,50,-61],[-14,31,-62],[-17,10,-58],[-8,-10,-49.5],[8,-32,-38.5]]),hi,gej];
 const esoRings=89,gastricRings=81,segments=48,positions=[],centers=[],rings=[];
 for(let i=0;i<esoRings;i++){
  const t=i/(esoRings-1),p=spline(controls,t),axis=tangent(controls,t),side=unit(projectOff([1,0,0],axis)),front=unit(cross(axis,side));
  const taper=1-.095*Math.exp(-(((p[1]-hi[1])/10)**2)),rx=(6.6+.35*Math.sin(t*Math.PI))*taper,rz=(4.85+.23*Math.sin(t*Math.PI))*taper;
  centers.push(p);rings.push({p,a:mul(side,rx),b:mul(front,rz)});
 }
 const join=rings.at(-1);
 // Paired lesser/greater-curvature sections. Their asymmetric, changing axes
 // form a cardial notch, left-superior fundus, dependent body and rightward
 // antrum. This is a continuous surface with the esophagus, not joined spheres.
 const stations=[
  [...gej,...join.a,...join.b],
  [18,gy-7,-23,10,6,0,0,0,9],
  [39,gy-7.5,-26,25,27.5,0,0,0,25],
  [50,gy-23,-15,32,14,0,0,0,25],
  [48,gy-48,-8,31,1,0,0,0,27],
  [33,gy-65,1,27,-12,0,0,0,24],
  [11,gy-65,11,16,-16,0,0,0,19],
  [-8,gy-54,18,6,-12,0,0,0,11],
  [-20,gy-46,20,1,-8,0,0,0,7.8],
  [-29,gy-42,20,-2,-6.5,0,0,0,6.6]
 ];
 const gastricCenters=[];
 for(let i=1;i<gastricRings;i++){
  const v=spline(stations,i/(gastricRings-1)),p=v.slice(0,3),a=v.slice(3,6),b=v.slice(6,9);
  centers.push(p);gastricCenters.push(p);rings.push({p,a,b});
 }
 for(const {p,a,b}of rings)for(let j=0;j<segments;j++){
  const angle=j*TAU/segments;
  positions.push(teeContextToWorld(add(p,add(mul(a,Math.cos(angle)),mul(b,Math.sin(angle)))),frame));
 }
 const faces=ringFaces(rings.length,segments),g=geometry(positions,faces),joinFace=(esoRings-1)*segments*2;
 const meshes=[mesh(g,'esophagus',[.75,.52,.49],.13,.1,faces.slice(0,joinFace)),mesh(g,'stomach',[.77,.57,.50],.11,.1,faces.slice(joinFace))];
 // Restrained fine contours identify the two gastric curvatures without
 // decorating the wall with unsupported internal rugae or fabricated texture.
 for(const [id,sign]of [['greater-curvature',1],['lesser-curvature',-1]]){
  const pts=rings.slice(esoRings-1).map(r=>add(r.p,mul(r.a,sign)));
  meshes.push(mesh(curveTube(pts,.40,frame),id,[.85,.68,.59],.28,.06,undefined,'contour'));
 }
 for(const [id,index]of [['esophageal-rim',0],['pyloric-rim',rings.length-1]]){
  const r=rings[index],pts=Array.from({length:48},(_,j)=>add(r.p,add(mul(r.a,Math.cos(j*TAU/48)),mul(r.b,Math.sin(j*TAU/48)))));
  meshes.push(mesh(curveTube(pts,.43,frame,8,true),id,[.82,.62,.57],.29,.08,undefined,'contour'));
 }
 const tract=[];let arc=0;
 const path=centers.slice(0,esoRings+Math.floor((gastricRings-1)*.58));
 for(let i=0;i<path.length;i++){
  if(i)arc+=Math.hypot(...sub(path[i],path[i-1]))*frame.scale;
  const p=path[i],level=i>=esoRings?(i>esoRings+22?'deep-tg':'tg'):p[1]>55?'ue':p[1]>0?'me':p[1]>hi[1]+8?'le':'junction';
  const a=path[Math.max(0,i-1)],b=path[Math.min(path.length-1,i+1)],worldTangent=unit(sub(teeContextToWorld(b,frame),teeContextToWorld(a,frame)));
  const target=frame.landmarksMm.leftVentricle||teeContextToWorld([18,-16,15],frame),heartTarget=mix(frame.originMm,target,clamp((20-p[1])/65,0,1));
  const inward=projectOff(sub(heartTarget,teeContextToWorld(p,frame)),worldTangent),beam=unit(inward,unit(cross(worldTangent,frame.left))),right=unit(cross(beam,worldTangent));
  const radialClearanceHintMm=Math.min(Math.hypot(...rings[i].a),Math.hypot(...rings[i].b))*frame.scale;
  tract.push({pointMm:freezeVector(teeContextToWorld(p,frame)),tangent:freezeVector(worldTangent),shaft:freezeVector(worldTangent),right:freezeVector(right),beam:freezeVector(beam),arcMm:arc,level,radialClearanceHintMm});
 }
 const meIndex=path.reduce((best,p,i)=>Math.abs(p[1]-20)<Math.abs(path[best][1]-20)?i:best,0),meArc=tract[meIndex].arcMm;
 for(const sample of tract){sample.insertionCm=35+(sample.arcMm-meArc)/(10*frame.scale);Object.freeze(sample);}
 const gastricInteriorSamples=[];
 for(let i=esoRings-1;i<path.length;i++){
  const ring=rings[i],base=tract[i],radialLimit=Math.max(0,Math.min(.8,1-4.5/Math.min(Math.hypot(...ring.a),Math.hypot(...ring.b))));
  const entry=(point,radius=0)=>Object.freeze({...base,pointMm:freezeVector(teeContextToWorld(point,frame)),pathIndex:i,level:i>esoRings+22?'deep-tg':'tg',radialClearanceHintMm:Math.min(Math.hypot(...ring.a),Math.hypot(...ring.b))*(1-radius)*frame.scale});
  gastricInteriorSamples.push(entry(ring.p));
  if(radialLimit>.05)for(const radius of [radialLimit*.5,radialLimit])for(let j=0;j<16;j++){
   const angle=j*TAU/16,p=add(ring.p,add(mul(ring.a,radius*Math.cos(angle)),mul(ring.b,radius*Math.sin(angle))));
   gastricInteriorSamples.push(entry(p,radius));
  }
 }
 const fundus=rings.slice(esoRings-1).map(r=>add(r.p,r.a)).reduce((a,b)=>b[1]>a[1]?b:a);
 return {meshes,topology:topology(g,{segments,rings:rings.length,joinRing:esoRings-1,openBoundaries:['upper esophagus','pyloric outlet']}),tractSamples:Object.freeze(tract),gastricInteriorSamples:Object.freeze(gastricInteriorSamples),landmarks:{esophagusME:path[meIndex],hiatus:hi,cardia:gej,fundus,gastricBody:[50,gy-31,-13],antrum:[-6,gy-55,17],pylorus:stations.at(-1).slice(0,3)},contours:{esophagus:centers.slice(0,esoRings),greaterCurvature:rings.slice(esoRings-1).map(r=>add(r.p,r.a)),lesserCurvature:rings.slice(esoRings-1).map(r=>sub(r.p,r.a))}};
}

function diaphragm(frame,hiatus){
 const segments=128,radial=36,positions=[],local=[],faces=[];
 const hole=[hiatus[0],hiatus[2]],rx=9.2,rz=7.6;
 for(let i=0;i<=radial;i++)for(let j=0;j<segments;j++){
  const angle=j*TAU/segments,c=Math.cos(angle),s=Math.sin(angle),inner=[hole[0]+rx*c,hole[1]+rz*s];
  // Intersect the same ray with the outer footprint; no triangle spans the
  // hiatus. Mild asymmetry avoids a flat, circular or umbrella-like disk.
  const ax=c/113,az=s/85,b=2*(hole[0]*c/113**2+hole[1]*s/85**2),a=ax*ax+az*az,k=hole[0]**2/113**2+hole[1]**2/85**2-1;
  const outerDistance=(-b+Math.sqrt(b*b-4*a*k))/(2*a),outer=[hole[0]+outerDistance*c,hole[1]+outerDistance*s];
  const r=i/radial,x=inner[0]*(1-r)+outer[0]*r,z=inner[1]*(1-r)+outer[1]*r,y=teeDiaphragmHeight(x,z,frame)-1.4*r**8*Math.cos(3*angle);
  const p=[x,y,z];local.push(p);positions.push(teeContextToWorld(p,frame));
 }
 for(let i=0;i<radial;i++)for(let j=0;j<segments;j++){
  const a=i*segments+j,b=i*segments+(j+1)%segments,c=(i+1)*segments+j,d=(i+1)*segments+(j+1)%segments;
  for(const face of [[a,b,c],[b,d,c]]){
   faces.push(face);
  }
 }
 const g=geometry(positions,faces),meshes=[mesh(g,'diaphragm',[.39,.57,.58],.075,.04)];
 // A smooth clover-like material patch follows the same diaphragm surface.
 // The 0.12 mm display lift avoids co-planar depth artifacts; it is not a
 // separate anatomical slab, and no triangle closes the posterior hiatus.
 const tp=[teeContextToWorld([0,teeDiaphragmHeight(0,11,frame)+.12,11],frame)],tf=[],ts=96,tr=12;
 for(let i=1;i<=tr;i++)for(let j=0;j<ts;j++){
  const angle=j*TAU/ts,r=i/tr*(1+.075*Math.cos(3*angle)),x=33*r*Math.cos(angle),z=11+29*r*Math.sin(angle);
  tp.push(teeContextToWorld([x,teeDiaphragmHeight(x,z,frame)+.12,z],frame));
 }
 for(let j=0;j<ts;j++)tf.push([0,1+(j+1)%ts,1+j]);
 for(let i=0;i<tr-1;i++)for(let j=0;j<ts;j++){
  const a=1+i*ts+j,b=1+i*ts+(j+1)%ts,c=1+(i+1)*ts+j,d=1+(i+1)*ts+(j+1)%ts;tf.push([a,b,c],[b,d,c]);
 }
 meshes.push(mesh(geometry(tp,tf),'central-tendon',[.65,.77,.74],.075,.08));
 const holePoints=local.slice(0,segments),rimPoints=local.slice(radial*segments);
 meshes.push(mesh(curveTube(holePoints,.57,frame,8,true),'esophageal-hiatus',[.66,.77,.71],.33,.07,undefined,'contour'));
 meshes.push(mesh(curveTube(rimPoints,.38,frame,8,true),'diaphragm-rim',[.52,.70,.68],.19,.05,undefined,'contour'));
 return {meshes,topology:topology(g,{segments,rings:radial+1,openBoundaries:['esophageal hiatus','peripheral diaphragm']}),contours:{hiatus:holePoints,diaphragmRim:rimPoints}};
}

/** Build once per donor/baseline frame; retain across every steering update.
 * Labels, tract, bounds and meshes are all in world millimetres. The optional
 * topology payload supports numerical review and does not need GPU upload. */
export function createTeeContextModel(options={}){
 const frame=createTeeContextFrame(options),gi=gastrointestinal(frame),di=diaphragm(frame,gi.landmarks.hiatus),meshes=Object.freeze([...di.meshes,...gi.meshes]);
 const landmarksMm=Object.fromEntries(Object.entries(gi.landmarks).map(([key,p])=>[key,freezeVector(teeContextToWorld(p,frame))]));
 const label=(id,text,local,priority)=>Object.freeze({id,text,pointMm:freezeVector(teeContextToWorld(local,frame)),priority});
 const esophagealLabel=gi.contours.esophagus.reduce((best,p)=>Math.abs(p[1]-60)<Math.abs(best[1]-60)?p:best);
 const labels=Object.freeze([
  label('esophagus','Esophagus',esophagealLabel,1),
  label('diaphragm','Diaphragm',[-76,teeDiaphragmHeight(-76,31,frame),31],2),
  label('stomach','Stomach',[79,gi.landmarks.cardia[1]-35,-8],1),
  label('hiatus','Esophageal hiatus',add(gi.landmarks.hiatus,[10,0,-4]),3)
 ]);
 const bounds=boundsOf(meshes.flatMap(m=>[m.bounds.min,m.bounds.max]));
 const cardiacTarget=teeContextToWorld([0,-10,0],frame),contextTarget=teeContextToWorld([0,-27,-3],frame);
 const contours=Object.fromEntries(Object.entries({...gi.contours,...di.contours}).map(([key,path])=>[key,Object.freeze(path.map(p=>freezeVector(teeContextToWorld(p,frame))))]));
 return Object.freeze({revision:TEE_CONTEXT_REVISION,frame,referenceMm:frame.referenceMm,meshes,bounds,landmarksMm:Object.freeze(landmarksMm),labels,tractSamples:gi.tractSamples,gastricInteriorSamples:gi.gastricInteriorSamples,contours:Object.freeze(contours),topology:Object.freeze({gastrointestinal:gi.topology,diaphragm:di.topology}),camera:Object.freeze({targetMm:freezeVector(contextTarget),cardiacTargetMm:freezeVector(cardiacTarget),preferredAway:freezeVector(unit(add(mul(frame.anterior,.94),add(mul(frame.left,.32),mul(frame.superior,.16)))))}),provenance:Object.freeze({kind:'illustrative spatial context',segmentedFromDonor:false,patientRegistered:false,orientation:frame.kind,insertionScale:'Model distance; the 35 cm ME marker is illustrative, not measured from incisors.',presentation:'Translucent spatial context; the displayed heart and cut face occlude anatomy behind them using their rendered depth.'})});
}

/** Continuous distance-based access for authored probe routing. This samples
 * the fixed model; it cannot change organ position or validate probe contact. */
export function sampleTeeContextTract(model,arcMm){
 const samples=model.tractSamples,target=clamp(arcMm,0,samples.at(-1).arcMm);
 let lo=0,hi=samples.length-1;while(hi-lo>1){const mid=(lo+hi)>>1;if(samples[mid].arcMm<target)lo=mid;else hi=mid;}
 const a=samples[lo],b=samples[hi],t=(target-a.arcMm)/Math.max(1e-8,b.arcMm-a.arcMm);
 const tangent=unit(mix(a.tangent,b.tangent,t)),right=unit(projectOff(mix(a.right,b.right,t),tangent)),beam=unit(cross(tangent,right));
 return {pointMm:mix(a.pointMm,b.pointMm,t),tangent,shaft:[...tangent],right,beam,arcMm:target,insertionCm:a.insertionCm*(1-t)+b.insertionCm*t,level:t<.5?a.level:b.level,radialClearanceHintMm:a.radialClearanceHintMm*(1-t)+b.radialClearanceHintMm*t};
}

/** Main renderer uses a 0.32 vertical projection factor. Returns a camera basis
 * with normalized eye, plus the world-mm target and distance needed to adopt it.
 * No renderer or probe state is mutated. */
export function teeContextCamera(model,aspect=1,away=model.camera.preferredAway){
 away=unit(away);const forward=mul(away,-1),right=unit(cross(forward,model.frame.superior)),up=unit(cross(right,forward));
 const target=model.bounds.center,ratio=Math.max(.15,Number(aspect)||1);let distance=0;
 for(let mask=0;mask<8;mask++){
  const q=model.bounds.min.map((x,i)=>((mask>>i)&1?model.bounds.max[i]:x)-target[i]),z=dot(q,forward);
  distance=Math.max(distance,Math.abs(dot(q,right))*1.08/(.32*ratio)-z,Math.abs(dot(q,up))*1.08/.32-z);
 }
 return {eye:mul(add(target,mul(away,distance)),1/model.referenceMm),forward,right,up,targetMm:[...target],distanceMm:distance};
}
