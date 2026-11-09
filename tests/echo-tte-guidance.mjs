import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTteContextModel} from '../public/tte-atlas-geometry.js';
import {decodeEchoReferenceAnatomy,createEchoAnatomyContext,worldToBodyReference} from '../public/echo-anatomy-context-v2.js';
import {tteApicalGuide,TTE_APICAL_POSTERIOR_TILT_DEG} from '../public/echo-tte-guidance.js';
import {buildDonorEchoFrames} from '../public/echo-donor-planes.js';

const read=p=>readFileSync(new URL('../'+p,import.meta.url));
const reference=await decodeEchoReferenceAnatomy({manifestBytes:read('public/assets/probe-context-v11/manifest.json'),compressedBytes:read('public/assets/probe-context-v11/torso.bin.gz')});
const source=JSON.parse(read('public/assets/echo-planes.json'));
const frames=Object.fromEntries(Object.entries(source.frames).map(([k,v])=>[k,v.world]));
const model=createEchoAnatomyContext({baseModel:createTteContextModel({frames,referenceMm:168.0104,donorId:'ladaf-2021-17'}),referenceAnatomy:reference,frames});
const view=id=>({id,group:'apical',mode:'tte'});
const guide=(id,m=model,f=frames)=>tteApicalGuide({view:view(id),model:m,referenceMm:m.referenceMm,sourcePlane:f[id]||f.a4c,fourChamberPlane:f.a4c});
const sub=(a,b)=>a.map((x,i)=>x-b[i]),mul=(v,s)=>v.map(x=>x*s),dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const length=v=>Math.hypot(...v),unit=v=>mul(v,1/length(v));
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const near=(a,b,e=1e-7)=>assert.ok(Math.abs(a-b)<=e,`${a} != ${b}`);
const same=(a,b,e=1e-7)=>a.forEach((v,i)=>near(v,b[i],e));
const planeDistance=(g,p)=>Math.abs(dot(sub(p,g.contact.pointMm),unit(cross(g.beam,g.markerDirection))));
const rayDistance=(g,p)=>{const q=sub(p,g.contact.pointMm);return length(sub(q,mul(g.beam,dot(q,g.beam))));};
const signedRoll=(a,b,beam)=>Math.atan2(dot(beam,cross(a,b)),dot(a,b))*180/Math.PI;

test('canonical apical contact is on an actual bounded anterior skin triangle',()=>{
 const g=guide('a4c'),c=g.contact,at=c.triangleIndex*18,v=model.skinSurface.vertices;
 const reconstructed=[0,1,2].map(k=>c.barycentric.reduce((s,w,j)=>s+w*v[at+j*6+k],0));
 same(c.pointMm,reconstructed,1e-8);same(c.bodyPointMm,worldToBodyReference(c.pointMm,model));
 const bounds=model.bodyWindows.apical.referenceBounds;
 assert.ok(c.bodyPointMm.every((x,i)=>x>=bounds.min[i]&&x<=bounds.max[i]));
 assert.ok(dot(c.normal,model.frame.anterior)>.5);assert.ok(dot(c.normal,g.beam)<-.5);
 assert.equal(g.guidance.usesSourceAxis,true);assert.equal(g.guidance.patientRegistered,false);
 assert.equal(g.guidance.namedAnatomyConfirmed,false);
});

test('one footprint and one beam cover apex and mitral region through the roll family',()=>{
 const a=guide('a4c');
 for(const id of ['a4c','a4c_lv','a4c_la_pv','a2c','a2c_lv','a3c','a3c_lv']){
  const g=guide(id);same(g.contact.pointMm,a.contact.pointMm);same(g.beam,a.beam);same(g.targetMm,a.targetMm);
  near(dot(g.beam,g.markerDirection),0);near(length(g.beam),1);near(length(g.markerDirection),1);
  for(const name of ['apex','mitralRegion']){near(planeDistance(g,model.frame.landmarksMm[name]),0);near(rayDistance(g,model.frame.landmarksMm[name]),0);}
 }
 const b=guide('a2c'),c=guide('a3c');
 near(signedRoll(a.markerDirection,b.markerDirection,a.beam),-60);
 near(signedRoll(b.markerDirection,c.markerDirection,a.beam),-60);
});

test('A5C retains physical contact and marker, tilts anteriorly and includes its source outflow target in-plane',()=>{
 const a=guide('a4c'),g=guide('a5c');same(g.contact.pointMm,a.contact.pointMm);same(g.markerDirection,a.markerDirection);
 const target=model.frame.landmarksMm.leftVentricularOutflow||model.frame.landmarksMm.aorticRoot;
 assert.ok(dot(g.beam,model.frame.anterior)>dot(a.beam,model.frame.anterior));
 near(dot(g.beam,g.markerDirection),0);near(planeDistance(g,target),0);
 near(rayDistance(g,g.targetMm),0);assert.ok(dot(sub(g.targetMm,g.contact.pointMm),g.beam)>0);
 same(g.anatomicalTargetMm,target);
 assert.ok(rayDistance(g,g.anatomicalTargetMm)>1,'The lateral anatomical target must not be mislabeled as a central-ray target.');
 assert.equal(g.guidance.namedAnatomyConfirmed,false);
});

test('explicit LVOT guide takes priority over a distinct cusp-region target for A5C only',()=>{
 const landmarks=model.frame.landmarksMm;
 assert.ok(landmarks.leftVentricularOutflow&&landmarks.aorticRoot);
 assert.ok(length(sub(landmarks.leftVentricularOutflow,landmarks.aorticRoot))>10,'The reviewed LVOT and cusp-region targets must remain distinct.');
 const g=guide('a5c');same(g.anatomicalTargetMm,landmarks.leftVentricularOutflow);near(planeDistance(g,landmarks.leftVentricularOutflow),0);
 assert.ok(planeDistance(g,landmarks.aorticRoot)>1,'A5C is intentionally not retargeted to the more superior cusp center.');
 const withoutLvot={...model,frame:{...model.frame,landmarksMm:{...landmarks,leftVentricularOutflow:undefined}}};
 const fallback=guide('a5c',withoutLvot);same(fallback.anatomicalTargetMm,landmarks.aorticRoot);near(planeDistance(fallback,landmarks.aorticRoot),0);
 for(const id of ['a4c','a2c','a3c','a4c_cs']){
  const selected=guide(id),unchanged=guide(id,withoutLvot);same(selected.beam,unchanged.beam);same(selected.markerDirection,unchanged.markerDirection);
 }
 assert.equal(g.guidance.namedAnatomyConfirmed,false);
});

test('CS retains the same contact and marker with a small explicitly approximate posterior tilt',()=>{
 const a=guide('a4c'),g=guide('a4c_cs');same(g.contact.pointMm,a.contact.pointMm);same(g.markerDirection,a.markerDirection);
 assert.ok(dot(g.beam,model.frame.anterior)<dot(a.beam,model.frame.anterior));
 near(Math.abs(g.guidance.tiltDeg),TTE_APICAL_POSTERIOR_TILT_DEG);
 near(dot(g.beam,g.markerDirection),0);near(rayDistance(g,g.targetMm),0);
 assert.equal(g.guidance.approximateTilt,true);assert.equal(g.anatomicalTargetMm,null);
});

test('nominal marker rotations do not silently certify named target correspondence',()=>{
 const four=guide('a4c'),three=guide('a3c'),lm=model.frame.landmarksMm;
 assert.ok(planeDistance(four,lm.tricuspidRegion)>5,'Broad TV landmark is not exactly in the nominal four-chamber plane.');
 assert.ok(planeDistance(three,lm.aorticLumen)>0.5,'Near an AV landmark is not clinical validation.');
 assert.ok(planeDistance(three,lm.aorticLumen)<2);
 assert.equal(four.guidance.namedAnatomyConfirmed,false);assert.equal(three.guidance.namedAnatomyConfirmed,false);
});

test('comparison donors follow their own measured LV axes to bounded skin, never LADAF targets',()=>{
 for(const donorId of ['s-20-28','s-20-29']){
  const s=JSON.parse(read(`public/assets/donors/${donorId}/echo-planes.json`));
  const f=buildDonorEchoFrames(Object.fromEntries(Object.entries(s.frames).map(([k,v])=>[k,v.world])),{donorId,referenceMm:s.referenceMm});
  const m=createEchoAnatomyContext({baseModel:createTteContextModel({frames:f,referenceMm:s.referenceMm,donorId}),referenceAnatomy:reference,frames:f});
  const a=guide('a4c',m,f),b=guide('a2c',m,f),c=guide('a3c',m,f),five=guide('a5c',m,f),cs=guide('a4c_cs',m,f);
  assert.ok(a&&b&&c&&five&&cs);
  const bounds=m.bodyWindows.apical.referenceBounds;
  assert.ok(a.contact.bodyPointMm.every((x,i)=>x>=bounds.min[i]&&x<=bounds.max[i]));
  for(const g of [a,b,c,five,cs]){same(g.contact.pointMm,a.contact.pointMm);assert.equal(g.guidance.usesSourceAxis,true);assert.equal(g.guidance.namedAnatomyConfirmed,false);}
  for(const key of ['apex','mitralRegion','tricuspidRegion'])near(planeDistance(a,m.frame.landmarksMm[key]),0);
  for(const key of ['apex','mitralRegion'])near(rayDistance(a,m.frame.landmarksMm[key]),0);
  same(a.beam,b.beam);same(a.beam,c.beam);same(five.anatomicalTargetMm,m.frame.landmarksMm.aorticRoot);
  near(planeDistance(five,m.frame.landmarksMm.aorticRoot),0);
  assert.notDeepEqual(five.anatomicalTargetMm,model.frame.landmarksMm.aorticRoot);
  assert.ok(dot(five.beam,m.frame.anterior)>dot(a.beam,m.frame.anterior));
  assert.ok(dot(cs.beam,m.frame.anterior)<dot(a.beam,m.frame.anterior));
 }
});

test('unrelated windows, RV optimization and incomplete context remain outside this helper',()=>{
 assert.equal(tteApicalGuide({view:{id:'plax',group:'parasternal-long',mode:'tte'},model,referenceMm:168.0104}),null);
 assert.equal(guide('a4c_rv'),null);
 assert.equal(tteApicalGuide({view:view('a4c'),model:{frame:model.frame},referenceMm:168.0104}),null);
 assert.throws(()=>tteApicalGuide({view:view('a4c'),model,referenceMm:0}),/physical reference/);
 const a=guide('a4c');a.contact.pointMm[0]+=100;a.beam[1]+=100;
 const again=guide('a4c');assert.notEqual(a.contact.pointMm[0],again.contact.pointMm[0]);near(length(again.beam),1);
});
