/** Table inventory and spatial contracts. These do not establish clinical
 * validity, patient registration, or browser appearance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {TTE_ATLAS_VIEWS as views,TTE_ATLAS_GROUPS as groups,TTE_SOURCE} from '../public/tte-atlas-data.js';
import {buildTteAtlasFrames,createTteContextModel,tteAtlasProbePose,TTE_WINDOW_ANCHORS,tteProbeFocusPoints,tteProbeCameraDistance} from '../public/tte-atlas-geometry.js';
import {teeContextToLocal} from '../public/tee-context-geometry.js';
import {dot,mul,cross,norm} from '../public/planes.js';

const json=name=>JSON.parse(readFileSync(new URL('../public/assets/'+name,import.meta.url)));
const raw=json('echo-planes.json');
const base=Object.fromEntries(Object.entries(raw.frames).map(([id,f])=>[id,{...f.world,displayMirrorX:!!f.displayMirrorX,displayRotate180:!!f.displayRotate180}]));
const flow=Object.fromEntries(json('flow-views-v5.json').presets.map(p=>[p.id,p.world]));
const original=JSON.stringify(base),frames=buildTteAtlasFrames(base,views,{flowFrames:flow,donorId:'1659197537'});
const rows=['2.1','2.2','2.3','2.4','2.5','2.6','2.7','2.8','2.9','2.10a','2.10b',...Array.from({length:17},(_,i)=>'2.'+(i+11))];
const outside=new Set(['subcostal_ivc','subcostal_hepatic','ssn_arch']);
const near=(a,b,tol=1e-8)=>assert.ok(Math.abs(a-b)<tol,`${a} vs ${b}`);
const artwork=JSON.parse(readFileSync(new URL('../docs/reference-views-v60/asset-manifest.json',import.meta.url))).entries.filter(e=>e.mode==='tte');

test('All 28 ASE Table 2 entries retain order, split 2.10 and source page links',()=>{
 assert.equal(views.length,28);assert.equal(new Set(views.map(v=>v.id)).size,28);
 assert.deepEqual(views.map(v=>v.tableRow),rows);
 assert.deepEqual(groups.map(g=>g.count),[6,8,10,3,1]);
 for(const g of groups)assert.equal(views.filter(v=>v.group===g.id).length,g.count);
 for(const [i,v]of views.entries()){
  assert.equal(v.mode,'tte');assert.equal(v.tableOrder,i+1);
  assert.ok(v.sourceUrl.startsWith(TTE_SOURCE));assert.ok(v.tablePage>=19&&v.tablePage<=25);
  assert.ok(v.maneuvers.length&&v.anatomy.length&&v.teachingPoint&&v.position);
  const art=artwork.find(e=>e.id===v.id);assert.ok(art,v.id+' has current artwork provenance');
  assert.equal(art.view_number,v.tableRow);
  for(const [role,field,size] of [['image','illustration',960],['thumbnail','thumbnail',384]]){
   assert.equal(v[field],'./'+art[role].path.replace(/^public\//,''));
   const bytes=readFileSync(new URL('../'+art[role].path,import.meta.url));
   assert.equal(bytes.length,art[role].bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),art[role].sha256);
   assert.equal(art[role].width,size);assert.equal(art[role].height,size);
  }
 }
});

test('Original donor sections stay immutable; every new CT rectangle is resampled',()=>{
 assert.equal(JSON.stringify(base),original);
 for(const id of ['plax','psax_mitral','psax_papillary','a4c','a2c','a3c','subcostal'])assert.equal(frames[id],base[id]);
 for(const v of views){
  const f=frames[v.id];assert.ok(f,v.id);
  for(const k of ['center','right','up','normal'])assert.ok(f[k].length===3&&f[k].every(Number.isFinite),v.id+' '+k);
  assert.ok(f.width>0&&f.height>0);near(dot(f.right,f.up),0,1e-6);
  near(dot(f.right,f.right),1,1e-6);near(dot(f.up,f.up),1,1e-6);
  if(!base[v.id])assert.equal(f.atlasDerived,true,v.id+' must use its own voxels');
  assert.equal(!!f.outsideScan,outside.has(v.id),v.id+' coverage');
 }
});

test('LADAF AV and zoom retain the reviewed root neighborhood instead of the inferior LVOT focus',()=>{
 const toWorld=([x,y,z])=>[(x-237)/529,(z-264.5)/529,(237-y)/529];
 const reviewed=json('tee-atlas/plane-fit-v2.json').views.meavsax.source.centerXYZ;
 const miss=(plane,sourceXYZ)=>Math.abs(dot(toWorld(sourceXYZ).map((v,i)=>v-plane.center[i]),plane.normal))*168.0104;
 for(const id of ['psax_av','psax_av_zoom']){
  const f=frames[id];assert.equal(f.preferSourcePlane,true,id);
  assert.ok(miss(f,reviewed)<=3.5,id+' remains near the independently reviewed cusp region');
  assert.ok(miss(f,[239,254,225])<1,id+' intersects the independent proximal aortic cavity track');
  assert.ok(miss(f,[260,265,270])>10,id+' is distinct from the inferior longitudinal LVOT focus');
  assert.equal(f.sourceTargetProvenance.clinicalCuspIdentityValidated,false);
 }
 for(const key of ['center','right','up','normal'])assert.deepEqual(frames.psax_av_zoom[key],frames.psax_av[key],key+' shared physical plane');
 assert.ok(frames.psax_av_zoom.width<frames.psax_av.width);assert.ok(frames.psax_av_zoom.height<frames.psax_av.height);
});

test('External window estimates and fixed subtle anatomy never imply measured positions',()=>{
 const model=createTteContextModel({frames:base,referenceMm:168.0104,donorId:'1659197537'}),fixed=JSON.stringify(model.frame);
 assert.equal(model.provenance.patientRegistered,false);assert.equal(model.provenance.segmentedFromDonor,false);
 assert.equal(model.meshes.length,14);assert.ok(model.meshes.every(m=>m.alpha>0&&m.alpha<=.16));
 for(const v of views){
  const p=tteAtlasProbePose(frames[v.id],v,168.0104,model);
  for(const k of ['originMm','targetMm','beam','right','normal'])assert.ok(p[k].every(Number.isFinite),v.id+' '+k);
  near(dot(p.beam,p.right),0);near(dot(p.beam,p.normal),0);near(dot(p.right,p.normal),0);
  for(const k of ['beam','right','normal'])near(dot(p[k],p[k]),1);
  assert.equal(p.contextFit.registered,false);assert.equal(p.contextFit.clinicalPositionMeasured,false);
  assert.ok(dot(p.markerDirection,p.markerReference)>=Math.cos(25*Math.PI/180),v.id+' clinical marker polarity');
  const local=teeContextToLocal(p.originMm,model.frame);assert.ok(local[2]>=38,v.id+' external anterior surface');
  if(p.contextFit.resolved)near(dot(p.originMm.map((n,i)=>n-p.targetMm[i]),frames[v.id].normal),0,1e-6);
  else for(let i=0;i<3;i++)near(local[i],TTE_WINDOW_ANCHORS[v.group][i]);
  assert.equal(p.contextFit.outsideScan,outside.has(v.id));
 }
 assert.equal(JSON.stringify(model.frame),fixed);
});

test('Ultrasound-facing camera contains every external handle without changing the CT basis',()=>{
 const model=createTteContextModel({frames:base,referenceMm:168.0104,donorId:'1659197537'});
 for(const v of views){
  const f=frames[v.id],p=tteAtlasProbePose(f,v,168.0104,model);
  const right=mul(f.right,!!f.displayMirrorX!==!!f.displayRotate180?-1:1),up=mul(f.up,f.displayRotate180?-1:1),forward=mul(norm(cross(right,up)),-1),basis={right,up,forward};
  const target=f.outsideScan?[0,0,0]:f.center;
  for(const aspect of [.72,1,1.7]){
   const distance=tteProbeCameraDistance(p,basis,target,aspect);
   assert.ok(Number.isFinite(distance)&&distance>=1.55);
   for(const point of tteProbeFocusPoints(p)){
    const q=point.map((n,i)=>n/p.referenceMm-target[i]),depth=distance+dot(q,forward);
    assert.ok(depth>0);assert.ok(Math.abs(dot(q,right))/(depth*.32*aspect)<=.901,v.id+' handle horizontal framing');
    assert.ok(Math.abs(dot(q,up))/(depth*.32)<=.901,v.id+' handle vertical framing');
   }
  }
 }
});

test('Comparison donors receive their own geometric context and no LADAF aortic anchors',()=>{
 const other=buildTteAtlasFrames(base,views,{geometricComparisonOnly:true,flowFrames:flow});
 assert.notDeepEqual(other.psax_av.center,frames.psax_av.center);
 const model=createTteContextModel({frames:base,referenceMm:143,donorId:'s20-29'});
 assert.equal(model.frame.kind,'scaled-geometric-context');assert.deepEqual(model.frame.landmarksMm,{});
 for(const v of views)assert.ok(tteAtlasProbePose(other[v.id],v,143,model).originMm.every(Number.isFinite));
 const unknown=buildTteAtlasFrames(base,views,{flowFrames:flow,donorId:'unknown'});assert.deepEqual(unknown.psax_av.center,other.psax_av.center);
 for(const donorId of ['s-20-28','s-20-29']){
  const raw=json(`donors/${donorId}/echo-planes.json`),own=Object.fromEntries(Object.entries(raw.frames).map(([id,f])=>[id,f.world]));
  const built=buildTteAtlasFrames(own,views,{donorId,geometricComparisonOnly:true});
  const ownContext=createTteContextModel({frames:own,referenceMm:raw.referenceMm,donorId});
  for(const v of views)assert.ok(tteAtlasProbePose(built[v.id],v,raw.referenceMm,ownContext).originMm.every(Number.isFinite));
 }
});
