import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createTeeContextModel,createTeeContextFrame,teeContextToWorld,teeContextToLocal,teeContextCamera,sampleTeeContextTract,teeDiaphragmHeight} from '../public/tee-context-geometry.js';
import {createTeeReference,teePose,sanitizeTeeState} from '../public/tee-geometry.js';
import {dot,cross} from '../public/planes.js';
import {getEchoDonorCalibration} from '../public/echo-donor-calibration.js';

const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const length=a=>Math.hypot(...a);
const near=(a,b,t=1e-5)=>assert.ok(Math.abs(a-b)<=t,`${a} != ${b} within ${t}`);
const vectorNear=(a,b,t=1e-5)=>a.forEach((x,i)=>near(x,b[i],t));
const raw=JSON.parse(await readFile('public/assets/echo-planes.json','utf8'));
const frames=Object.fromEntries(Object.entries(raw.frames).map(([id,f])=>[id,f.world]));
const input=JSON.stringify(frames),model=createTeeContextModel({frames});
const digest=m=>createHash('sha256').update(Buffer.concat(m.meshes.map(mesh=>Buffer.from(mesh.vertices.buffer,mesh.vertices.byteOffset,mesh.vertices.byteLength)))).digest('hex');
const report={scope:'Authored TEE context geometry, topology, frame invariance and camera fit. Not donor segmentation, patient registration, collision validation or browser performance.',revision:model.revision,checks:[],meshes:model.meshes.map(m=>({id:m.id,triangles:m.vertices.length/18,alpha:m.alpha})),topology:{}};

function inspectTopology(surface){
 const points=surface.positionsMm,indices=surface.indices,edges=new Map(),adjacency=new Map();let minArea=Infinity;
 for(let i=0;i<indices.length;i+=3){
  const ids=[...indices.slice(i,i+3)],p=ids.map(j=>[...points.slice(j*3,j*3+3)]);
  minArea=Math.min(minArea,length(cross(sub(p[1],p[0]),sub(p[2],p[0])))/2);
  for(let j=0;j<3;j++){
   const a=ids[j],b=ids[(j+1)%3],key=a<b?`${a}:${b}`:`${b}:${a}`;
   const value=edges.get(key)||{count:0,balance:0,a:Math.min(a,b),b:Math.max(a,b)};value.count++;value.balance+=a<b?1:-1;edges.set(key,value);
  }
 }
 let boundaries=0,nonManifold=0,nonOrientable=0;
 for(const e of edges.values()){
  if(e.count>2)nonManifold++;
  if(e.count===2&&e.balance!==0)nonOrientable++;
  if(e.count===1){boundaries++;for(const [a,b]of [[e.a,e.b],[e.b,e.a]]){if(!adjacency.has(a))adjacency.set(a,[]);adjacency.get(a).push(b);}}
 }
 const seen=new Set();let loops=0;
 for(const [seed,neighbors]of adjacency){
  assert.equal(neighbors.length,2,'An intended opening must be a continuous ring, not a torn edge.');
  if(seen.has(seed))continue;loops++;const stack=[seed];while(stack.length){const i=stack.pop();if(seen.has(i))continue;seen.add(i);stack.push(...adjacency.get(i));}
 }
 return {vertices:points.length/3,triangles:indices.length/3,edges:edges.size,euler:points.length/3-edges.size+indices.length/3,boundaries,boundaryLoops:loops,nonManifold,nonOrientable,minAreaMm2:minArea};
}

test('fixed frame is right-handed, physically scaled, explicit about uncertainty, and does not mutate source frames',()=>{
 const f=model.frame;
 for(const v of [f.left,f.superior,f.anterior,f.posterior])near(length(v),1);
 near(dot(f.left,f.superior),0);near(dot(f.left,f.anterior),0);near(dot(f.superior,f.anterior),0);
 vectorNear(cross(f.left,f.superior),f.anterior);
 assert.equal(JSON.stringify(frames),input);
 assert.equal(model.provenance.segmentedFromDonor,false);assert.equal(model.provenance.patientRegistered,false);assert.equal(f.patientOrientationValidated,false);
 for(const p of [[0,0,0],[15,-88,-25],[-70,-60,25]])vectorNear(teeContextToLocal(teeContextToWorld(p,f),f),p);
 report.checks.push('Fixed orthonormal source-anchored illustrative frame; source frames unchanged and all dimensions in world millimetres.');
});

test('esophagus/stomach is one continuous orientable surface with only its intended two end openings',()=>{
 const t=model.topology.gastrointestinal,result=inspectTopology(t);report.topology.gastrointestinal=result;
 assert.equal(result.nonManifold,0);assert.equal(result.nonOrientable,0);assert.equal(result.boundaryLoops,2);assert.equal(result.euler,0);assert.equal(result.boundaries,t.segments*2);assert.ok(result.minAreaMm2>.001);
 // The GE junction ring is shared by both surfaces, not two almost-touching
 // terminal caps. Every seam edge must have one face above and one below.
 const joinStart=t.joinRing*t.segments,joinEnd=joinStart+t.segments;
 for(let i=joinStart;i<joinEnd;i++){
  let upper=false,lower=false;
  for(let k=0;k<t.indices.length;k+=3){const face=t.indices.slice(k,k+3);if(!face.includes(i))continue;upper ||= [...face].some(v=>v<joinStart);lower ||= [...face].some(v=>v>=joinEnd);}
  assert.ok(upper&&lower,'GEJ vertex must connect both organ portions.');
 }
 report.checks.push('Continuous esophagogastric junction, orientable mesh, no non-manifold edges; open upper esophagus and pyloric outlet only.');
});

test('diaphragm has a genuine continuous hiatus and a separate peripheral boundary',()=>{
 const t=model.topology.diaphragm,result=inspectTopology(t);report.topology.diaphragm=result;
 assert.equal(result.nonManifold,0);assert.equal(result.nonOrientable,0);assert.equal(result.boundaryLoops,2);assert.equal(result.euler,0);assert.equal(result.boundaries,t.segments*2);assert.ok(result.minAreaMm2>.001);
 const hi=teeContextToLocal(model.landmarksMm.hiatus,model.frame);near(hi[1],teeDiaphragmHeight(hi[0],hi[2]));
 for(let i=0;i<t.segments;i++){
  const p=teeContextToLocal([...t.positionsMm.slice(i*3,i*3+3)],model.frame);
  near(((p[0]-hi[0])/9.2)**2+((p[2]-hi[2])/7.6)**2,1,2e-5);
 }
 assert.ok(model.meshes.some(m=>m.id==='central-tendon'&&m.vertices.length>0));
 report.checks.push('Two-domed diaphragm with open esophageal hiatus, continuous hole rim and distinguished central tendon.');
});

test('all production mesh positions and normals remain finite, nondegenerate and consistently oriented',()=>{
 for(const m of model.meshes){
  assert.ok(m.vertices instanceof Float32Array);assert.equal(m.vertices.length%18,0);assert.ok(m.alpha>0&&m.alpha<.7,'Context must use the transparent depth-mask path.');
  for(let i=0;i<m.vertices.length;i+=6){const p=[...m.vertices.slice(i,i+3)],n=[...m.vertices.slice(i+3,i+6)];assert.ok(p.every(Number.isFinite));assert.ok(n.every(Number.isFinite));near(length(n),1,2e-5);}
  for(let i=0;i<m.vertices.length;i+=18){
   const a=[...m.vertices.slice(i,i+3)],b=[...m.vertices.slice(i+6,i+9)],c=[...m.vertices.slice(i+12,i+15)],n=[...m.vertices.slice(i+3,i+6)],area=cross(sub(b,a),sub(c,a));
   assert.ok(length(area)>1e-6,`Degenerate triangle in ${m.id}`);assert.ok(dot(area,n)>-1e-5,`Folded normal in ${m.id}`);
  }
 }
 report.checks.push('Finite world-mm coordinates, unit smooth normals and consistent face orientation for all surfaces and contours.');
});

test('anatomical ordering, tract directions and GE connection are preserved',()=>{
 const f=model.frame,l=Object.fromEntries(Object.entries(model.landmarksMm).map(([k,p])=>[k,teeContextToLocal(p,f)])),la=teeContextToLocal(f.landmarksMm.leftAtrium,f);
 assert.ok(l.esophagusME[2]<la[2]-10,'Esophagus should lie posterior to the LA reference.');
 assert.ok(l.cardia[1]<l.hiatus[1]-8&&l.cardia[1]>l.hiatus[1]-18,'Short abdominal segment must connect hiatus to cardia.');
 assert.ok(l.fundus[0]>l.cardia[0]+20&&l.fundus[1]>l.cardia[1]+5,'Fundus should rise left-superior to cardia.');
 assert.ok(l.gastricBody[1]<l.cardia[1]-15);assert.ok(l.antrum[0]<l.gastricBody[0]-30);
 assert.ok(teeContextToLocal(f.landmarksMm.apex,f)[1]<-25,'Body-axis choice must retain an inferior apex.');
 assert.ok(teeDiaphragmHeight(-48,5)>teeDiaphragmHeight(52,-17),'Illustrative right dome should be higher.');
 for(let i=1;i<model.tractSamples.length;i++){
  const a=model.tractSamples[i-1],b=model.tractSamples[i];assert.ok(b.arcMm>a.arcMm);assert.ok(b.insertionCm>a.insertionCm);near(dot(b.right,b.beam),0);near(dot(b.shaft,b.beam),0);vectorNear(cross(b.shaft,b.right),b.beam);assert.ok(dot(a.tangent,b.tangent)>.9,'The tract cannot have sudden bends.');
 }
 for(const distance of [0,40,80,150,200,model.tractSamples.at(-1).arcMm]){
  const p=sampleTeeContextTract(model,distance);assert.ok(p.pointMm.every(Number.isFinite));near(length(p.tangent),1);near(dot(p.right,p.beam),0);
 }
 report.checks.push('Posterior-LA esophagus, short abdominal segment, left-superior fundus, dependent body and rightward antrum; continuous distance-based routing with orthonormal shaft frames.');
});

test('gastric sample candidates stay connected to the fixed route and the fundus stays under the diaphragm',()=>{
 assert.ok(model.gastricInteriorSamples.length>1000);
 for(const s of model.gastricInteriorSamples){
  const route=model.tractSamples[s.pathIndex];assert.ok(route);near(s.arcMm,route.arcMm);near(s.insertionCm,route.insertionCm);assert.ok(length(sub(s.pointMm,route.pointMm))<45);assert.ok(s.radialClearanceHintMm>=4.49);
 }
 const vertices=model.meshes.find(m=>m.id==='stomach').vertices;let gap=Infinity;
 for(let i=0;i<vertices.length;i+=6){const p=teeContextToLocal([...vertices.slice(i,i+3)],model.frame);gap=Math.min(gap,teeDiaphragmHeight(p[0],p[2])-p[1]);}
 assert.ok(gap>.5,`Fundus crosses diaphragm: ${gap} mm`);report.minimumAuthoredStomachDiaphragmGapMm=gap;
 const middle=model.tractSamples.find(s=>s.insertionCm===35),reviewedNormal=[-.7816532,-.36674548,-.50449581];
 for(const cm of [31,32,33,34,35]){const s=sampleTeeContextTract(model,middle.arcMm+(cm-35)*10),angle=Math.acos(-dot(s.tangent,reviewedNormal))*180/Math.PI;assert.ok(angle<40,'ME tract cannot acquire a horizontal elbow to fit a plane.');}
 report.checks.push('1551 interior gastric candidates share fixed route indices and retain radial clearance; fundus remains below diaphragm; ME shaft stays within 40° of reviewed 4C normal over 31–35 model cm.');
});

test('probe steering and replacement scan planes cannot rotate or deform the organ model',()=>{
 const before=digest(model),ref=createTeeReference(frames);
 for(const insertionCm of [31,35,39,43])for(const multiplaneDeg of [0,30,90,120,180])for(const shaftRotationDeg of [-50,0,50]){
  const pose=teePose(sanitizeTeeState({insertionCm,multiplaneDeg,shaftRotationDeg,anteflexDeg:25,lateralFlexDeg:-15}),ref);assert.ok(pose.originMm.every(Number.isFinite));
 }
 assert.equal(digest(model),before);
 const movedFrames=structuredClone(frames);movedFrames.me4c.up=[0,1,0];movedFrames.me4c.center=[.4,-.4,.2];movedFrames.me4c.right=[0,0,1];
 assert.equal(digest(createTeeContextModel({frames:movedFrames})),before,'LADAF anatomical placement must not follow selected or optimized slice frames.');
 report.checks.push('Static anatomy is byte-identical after 60 steering combinations and after replacing the selected source-plane basis.');
});

test('each comparison donor uses its own source landmarks, fixed body frame, physical support and clearance-fitted organs',async()=>{
 const profiles=[];
 for(const id of ['s-20-28','s-20-29']){
  const raw=JSON.parse(await readFile(`public/assets/donors/${id}/echo-planes.json`,'utf8')),f=Object.fromEntries(Object.entries(raw.frames).map(([key,v])=>[key,v.world])),m=createTeeContextModel({frames:f,referenceMm:raw.referenceMm,donorId:id});
  const c=getEchoDonorCalibration(id,raw.referenceMm);
  assert.equal(m.frame.kind,'specimen-source-anchored-illustrative-frame');assert.ok(m.frame.landmarksMm.apex);assert.equal(m.referenceMm,raw.referenceMm);near(m.frame.scale,raw.referenceMm/168.0104);
  vectorNear(m.frame.landmarksMm.apex,c.landmarksMm.apex);vectorNear(cross(m.frame.left,m.frame.superior),m.frame.anterior);
  assert.ok(c.sourceSupportPointsMm.length>500);assert.ok(c.sourceSupport.voxelDiagonalMm>0);
  assert.equal(m.frame.patientOrientationValidated,false);
  const apex=teeContextToLocal(m.frame.landmarksMm.apex,m.frame),mv=teeContextToLocal(m.frame.landmarksMm.mitralRegion,m.frame);
  assert.ok(apex[0]>mv[0]&&apex[1]<mv[1]&&apex[2]>mv[2],'LV axis must extend left, inferior and anterior in its fixed body frame.');
  const hi=teeContextToLocal(m.landmarksMm.hiatus,m.frame);near(hi[1],teeDiaphragmHeight(hi[0],hi[2],m.frame));
  assert.ok(m.frame.contextProfile.diaphragmOffsetMm<0);
  for(const surface of Object.values(m.topology)){
   const topology=inspectTopology(surface);assert.equal(topology.nonManifold,0);assert.equal(topology.nonOrientable,0);assert.equal(topology.boundaryLoops,2);assert.ok(topology.minAreaMm2>.001);
  }
  for(let i=1;i<m.tractSamples.length;i++)assert.ok(dot(m.tractSamples[i-1].tangent,m.tractSamples[i].tangent)>.9,'Specimen tract needs smooth shaft routing.');
  const stomach=m.meshes.find(mesh=>mesh.id==='stomach');let stomachGap=Infinity;
  for(let i=0;i<stomach.vertices.length;i+=6){const p=teeContextToLocal([...stomach.vertices.slice(i,i+3)],m.frame);stomachGap=Math.min(stomachGap,teeDiaphragmHeight(p[0],p[2],m.frame)-p[1]);}
  assert.ok(stomachGap>.5,'Specimen stomach must remain below its fixed diaphragm.');
  const altered=structuredClone(f);for(const value of Object.values(altered)){value.center=[.4,-.3,.1];value.up=[1,0,0];value.right=[0,0,1];}
  assert.equal(digest(createTeeContextModel({frames:altered,referenceMm:raw.referenceMm,donorId:id})),digest(m),'Selected atlas planes must not move specimen context.');
  const half=getEchoDonorCalibration(id,raw.referenceMm/2);vectorNear(half.landmarksMm.apex,c.landmarksMm.apex.map(x=>x/2));vectorNear(half.sourceSupportPointsMm[0],c.sourceSupportPointsMm[0].map(x=>x/2));
  profiles.push(JSON.stringify(m.frame.contextProfile));
 }
 assert.notEqual(profiles[0],profiles[1],'Each S-20 model needs its independently fitted organ profile.');
 const small=createTeeContextFrame({referenceMm:84.0052}),full=createTeeContextFrame();
 vectorNear(teeContextToWorld([30,-40,20],small),teeContextToWorld([30,-40,20],full).map(v=>v/2));
 report.checks.push('Both comparison donors use independent source landmarks, retained-source hulls, oblique anatomical frames and distinct fixed organ profiles; selected planes cannot move them.');
});

test('context camera contains every mesh bound across desktop and narrow aspect ratios',()=>{
 for(const aspect of [.45,.75,1,1.6,2.1]){
  const basis=teeContextCamera(model,aspect);near(length(basis.forward),1);near(length(basis.right),1);near(dot(basis.forward,basis.up),0);
  for(let mask=0;mask<8;mask++){
   const q=model.bounds.min.map((v,i)=>((mask>>i)&1?model.bounds.max[i]:v)/model.referenceMm-basis.eye[i]),d=dot(q,basis.forward);
   assert.ok(d>0);assert.ok(Math.abs(dot(q,basis.right))/(.32*aspect*d)<1);assert.ok(Math.abs(dot(q,basis.up))/(.32*d)<1);
  }
 }
 report.checks.push('Context camera fit contains all organ bounds across five aspect ratios, with the same main-view projection factor.');
});

test.after(async()=>{
 const output=process.argv.find(v=>v.startsWith('--report='))?.split('=').slice(1).join('=');
 if(output){await mkdir(output.slice(0,output.lastIndexOf('/')),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');}
 const renderData=process.argv.find(v=>v.startsWith('--render-data='))?.split('=').slice(1).join('=');
 if(renderData){
  await mkdir(renderData,{recursive:true});
  const meshes=[];for(const m of model.meshes){await writeFile(`${renderData}/${m.id}.f32`,Buffer.from(m.vertices.buffer));meshes.push({...m,vertices:undefined,file:`${m.id}.f32`});}
  const cameras=Object.fromEntries([['anterior',model.frame.anterior],['oblique',model.camera.preferredAway],['left',model.frame.left],['posterior',model.frame.posterior]].map(([id,away])=>[id,teeContextCamera(model,1,away)]));
  await writeFile(`${renderData}/model.json`,JSON.stringify({meshes,cameras,labels:model.labels,frame:model.frame,landmarksMm:model.landmarksMm,bounds:model.bounds,referenceMm:model.referenceMm,tractSamples:model.tractSamples,provenance:model.provenance},null,2));
 }
});
