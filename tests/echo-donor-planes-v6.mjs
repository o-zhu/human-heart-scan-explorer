import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildDonorEchoFrames,echoDonorPlaneRevision} from '../public/echo-donor-planes.js';
import {getEchoDonorCalibration} from '../public/echo-donor-calibration.js';
import {ECHO_DONOR_SUPPORT} from '../public/echo-donor-support.js';
import {TTE_ATLAS_VIEWS} from '../public/tte-atlas-data.js';
import {TEE_ATLAS_VIEWS} from '../public/tee-atlas-data.js';

const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=v=>{const l=Math.hypot(...v);return v.map(x=>x/l);};
const near=(a,b,t=1e-7)=>assert.ok(Math.abs(a-b)<=t,`${a} differs from ${b}`);
const views=[...TTE_ATLAS_VIEWS,...TEE_ATLAS_VIEWS];
const outside=new Set(['subcostal_ivc','subcostal_hepatic','ssn_arch','daosax','daolax','uearchlax','uearchsax']);
const read=async id=>{
 const catalog=JSON.parse(await readFile(`public/assets/donors/${id}/echo-planes.json`,'utf8'));
 const source=Object.fromEntries(Object.entries(catalog.frames).map(([key,v])=>[key,v.world]));
 const snapshot=JSON.stringify(source);
 const frames=buildDonorEchoFrames(source,{donorId:id,referenceMm:catalog.referenceMm});
 assert.equal(JSON.stringify(source),snapshot,'Original acquisition metadata must stay immutable.');
 return {catalog,frames,calibration:getEchoDonorCalibration(id,catalog.referenceMm)};
};
const donors=Object.fromEntries(await Promise.all(['s-20-28','s-20-29'].map(async id=>[id,await read(id)])));
const miss=(plane,point,ref)=>Math.abs(dot(sub(point,plane.center.map(v=>v*ref)),plane.normal));

test('the primary donor retains its existing reviewed planes and bookmark contract',()=>{
 const original={a4c:{center:[.1,.2,.3]},me4c:{center:[.4,.5,.6]}};
 for(const donorId of ['ladaf-2021-17','1659197537','unknown']){
  assert.equal(buildDonorEchoFrames(original,{donorId,referenceMm:168.0104}),original);
  assert.equal(getEchoDonorCalibration(donorId,168.0104),null);
 }
 assert.equal(echoDonorPlaneRevision(original),null);
});

for(const [id,{catalog,frames,calibration}] of Object.entries(donors)){
 test(`${id}: all 56 named views receive independent, finite and qualified source planes`,()=>{
  assert.equal(views.length,56);
  for(const view of views){
   const plane=frames[view.id];assert.ok(plane,view.id);
   for(const key of ['center','right','up','normal'])assert.ok(plane[key]?.length===3&&plane[key].every(Number.isFinite),`${view.id}/${key}`);
   for(const key of ['right','up','normal'])near(Math.hypot(...plane[key]),1);
   near(dot(plane.right,plane.up),0);near(dot(plane.normal,plane.right),0);near(dot(plane.normal,plane.up),0);
   near(dot(cross(plane.right,plane.up),plane.normal),1);
   assert.ok(plane.width>0&&plane.height>0);assert.equal(plane.atlasDerived,true,'Changed planes must sample real voxels.');
   assert.equal(plane.donorCalibration.viewId,view.id);assert.equal(plane.donorCalibration.donorId,calibration.donorId);
   assert.equal(plane.donorCalibration.patientRegistered,false);assert.equal(plane.donorCalibration.clinicalValidated,false);
   assert.equal(plane.donorCalibration.namedSmallStructuresConfirmed,false);
   assert.equal(plane.outsideScan,outside.has(view.id),`${view.id} must have the correct acquired/outside status`);
  }
  assert.ok(echoDonorPlaneRevision(frames).includes(calibration.revision));
 });

 test(`${id}: four-chamber and three-chamber source targets contain the measured long axis`,()=>{
  const L=calibration.landmarksMm,ref=catalog.referenceMm;
  for(const key of ['apex','mitralRegion','tricuspidRegion'])near(miss(frames.a4c,L[key],ref),0);
  for(const key of ['apex','mitralRegion','aorticRoot'])near(miss(frames.a3c,L[key]||L.aorticLumen,ref),0);
  for(const key of ['apex','mitralRegion','tricuspidRegion'])near(miss(frames.me4c,L[key],ref),0);
 });

 test(`${id}: RV-focused and five-chamber fields include their distal source targets`,()=>{
  for(const viewId of ['a4c_rv','a5c']){
   const p=frames[viewId],ref=catalog.referenceMm,center=p.center.map(v=>v*ref);
   for(const target of p.anatomyTargetsMm){
    const offset=sub(target.pointMm,center);
    assert.ok(Math.abs(dot(offset,p.up))<=p.height*ref/2-5,`${viewId}/${target.key} must not be cropped vertically.`);
    assert.ok(Math.abs(dot(offset,p.right))<=p.width*ref/2-5,`${viewId}/${target.key} must not be cropped laterally.`);
   }
  }
  const p=frames.melax,ref=catalog.referenceMm,offset=sub(calibration.landmarksMm.apex,p.center.map(v=>v*ref));
  assert.ok(Math.abs(dot(offset,p.up))<=p.height*ref/2-5,'ME LAX must retain its distal source cavity.');
  assert.ok(Math.abs(dot(offset,p.right))<=p.width*ref/2-5,'ME LAX apex must fit its lateral field.');
 });

 test(`${id}: ventricular short-axis levels stay perpendicular to the donor long axis and in anatomical order`,()=>{
  const L=calibration.landmarksMm,axis=norm(sub(L.mitralRegion,L.apex)),ref=catalog.referenceMm;
  const position=id=>dot(sub(frames[id].center.map(v=>v*ref),L.apex),axis);
  for(const key of ['psax_mitral','psax_papillary','psax_apical','tgbasalsax','tgpapillary','tgapicalsax'])near(Math.abs(dot(frames[key].normal,axis)),1);
  assert.ok(position('psax_mitral')>position('psax_papillary'));
  assert.ok(position('psax_papillary')>position('psax_apical'));
  assert.ok(position('tgbasalsax')>position('tgpapillary'));
  assert.ok(position('tgpapillary')>position('tgapicalsax'));
 });

 test(`${id}: five-chamber target stays longitudinal and pulmonary view follows the outflow tract`,()=>{
  const L=calibration.landmarksMm,ref=catalog.referenceMm,axis=norm(sub(L.mitralRegion,L.apex));
  assert.ok(Math.abs(dot(frames.me5c.normal,axis))<Math.sin(25*Math.PI/180),'A five-chamber target must not become a basal transverse slab.');
  for(const key of ['leftVentricle','rightVentricle','aorticRoot'])near(miss(frames.me5c,L[key],ref),0);
  for(const key of ['aorticRoot','pulmonaryRoot','pulmonarySuperior'])near(miss(frames.psax_pv,L[key],ref),0);
  near(dot(frames.psax_pv.normal,norm(sub(L.pulmonarySuperior,L.pulmonaryRoot))),0);
 });

 test(`${id}: depth and zoom variants retain the same physical acquisition plane`,()=>{
  for(const [child,parent] of Object.entries({plax_deep:'plax',plax_av:'plax',plax_mv:'plax',psax_av_zoom:'psax_av',a4c_lv:'a4c',a2c_lv:'a2c',a3c_lv:'a3c'})){
   near(Math.abs(dot(frames[child].normal,frames[parent].normal)),1);
   near(dot(sub(frames[child].center,frames[parent].center),frames[parent].normal),0);
  }
 });

 test(`${id}: physical rescaling preserves section coordinates and scales source landmarks`,()=>{
  const half=buildDonorEchoFrames({}, {donorId:id,referenceMm:catalog.referenceMm/2});
  for(const view of views.filter(v=>!outside.has(v.id))){
   for(const key of ['center','right','up','normal'])frames[view.id][key].forEach((value,i)=>near(value,half[view.id][key][i]));
   near(frames[view.id].width,half[view.id].width);near(frames[view.id].height,half[view.id].height);
   const target=frames[view.id].anatomyTargetsMm[0],scaled=half[view.id].anatomyTargetsMm[0];
   if(target)target.pointMm.forEach((value,i)=>near(value/2,scaled.pointMm[i]));
  }
 });

 test(`${id}: all four lab entries clear retained source support and cover its projected depth`,()=>{
  const support=ECHO_DONOR_SUPPORT[id],scale=catalog.referenceMm/168.0104;
  for(const key of ['a4c','plax','psax_papillary','me4c']){
   const plane=frames[key],entry=plane.probeEntry,center=plane.center.map(v=>v*catalog.referenceMm);
   assert.equal(entry.sourceSupportSha256,support.sourceSha256);
   assert.ok(entry.depthMm<=190*scale,'New default must fit the available depth control.');
   for(const point of support.pointsMm){
    const q=sub(point,center),along=dot(q,plane.up),lateral=dot(q,plane.right);
    assert.ok(entry.tipOffsetMm-along-entry.cellGuardMm>=8*scale-1e-7,'Probe head entry must be outside this donor.');
    assert.ok(Math.hypot(entry.tipOffsetMm-along,lateral)+entry.cellGuardMm<=entry.depthMm,'Distal support must remain within selected depth.');
   }
  }
 });
}

test('the two specimens have different long axes and fixed anatomical frames',()=>{
 const a=donors['s-20-28'],b=donors['s-20-29'];
 assert.notDeepEqual(a.frames.a4c.normal,b.frames.a4c.normal);
 assert.notDeepEqual(a.calibration.landmarksMm,b.calibration.landmarksMm);
 assert.notDeepEqual(a.calibration.anatomicalFrame,b.calibration.anatomicalFrame);
 assert.notEqual(echoDonorPlaneRevision(a.frames),echoDonorPlaneRevision(b.frames));
});
