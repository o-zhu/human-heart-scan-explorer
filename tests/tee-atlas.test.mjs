import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {TEE_ATLAS_VIEWS as views,TEE_ATLAS_GROUPS as groups} from '../public/tee-atlas-data.js';
import {buildTeeAtlasFrames,atlasProbePose} from '../public/tee-atlas-geometry.js';
import {orientEchoPlaneForDisplay} from '../public/echo-correspondence.js';
import {rotateVector} from '../public/probe-geometry.js';
import {dot,add,mul} from '../public/planes.js';
const json=path=>JSON.parse(readFileSync(new URL(path,import.meta.url)));
const raw=json('../public/assets/echo-planes.json');
const original=Object.fromEntries(Object.entries(raw.frames).map(([id,v])=>[id,{...v.world,displayMirrorX:!!v.displayMirrorX,displayRotate180:!!v.displayRotate180}]));
const flow=Object.fromEntries(json('../public/assets/flow-views-v5.json').presets.map(v=>[v.id,v.world]));
const frames=buildTeeAtlasFrames(original,views,{flowFrames:flow});
const near=(a,b,epsilon=1e-7)=>assert.ok(Math.abs(a-b)<epsilon,`${a} differs from ${b}`);

test('the ASE examination has 28 distinct targets in the 15 / 9 / 4 clinical groups',()=>{
 assert.equal(views.length,28);assert.equal(new Set(views.map(v=>v.id)).size,28);
 assert.deepEqual(views.map(v=>v.aseNumber),Array.from({length:28},(_,i)=>i+1));
 for(const group of groups)assert.equal(views.filter(v=>v.group===group.id).length,group.count);
 assert.deepEqual(groups.map(g=>g.count),[15,9,4]);
 for(const v of views){assert.equal(v.angleRange.length,2);assert.ok(v.angleDefault>=v.angleRange[0]&&v.angleDefault<=v.angleRange[1]);assert.ok(v.anatomy.length);assert.ok(v.maneuvers.length);assert.ok(v.depthEvidence);assert.ok(v.diagram.endsWith('.svg'));}
 assert.equal(views[15].group,'tg');assert.equal(views[20].shortName,'Deep five-chamber');
});

test('view fitting preserves measured source frames and flags the absent thoracic aorta',()=>{
 assert.deepEqual(original,Object.fromEntries(Object.entries(raw.frames).map(([id,v])=>[id,{...v.world,displayMirrorX:!!v.displayMirrorX,displayRotate180:!!v.displayRotate180}])));
 for(const id of ['me4c','me2c','melax','bicaval','tgpapillary','a4c','a2c','plax'])assert.equal(frames[id],original[id]);
 for(const v of views){const p=frames[v.id];assert.ok(p);assert.ok([...p.center,...p.right,...p.up,...p.normal,p.width,p.height].every(Number.isFinite));near(Math.hypot(...p.right),1);near(Math.hypot(...p.up),1);near(dot(p.right,p.up),0);assert.equal(!!p.outsideScan,v.aseNumber>=25);}
 assert.equal(frames.meavsax.atlasDerived,true,'Refitted aortic-valve section must bypass its old prepared texture.');
});

test('the probe face, central beam and sector use each actual displayed scan plane',()=>{
 for(const v of views){const base=frames[v.id],plane=orientEchoPlaneForDisplay(base,{mirrorX:base.displayMirrorX,rotate180:base.displayRotate180}),pose=atlasProbePose(plane,v,168.0104);
  const origin=mul(pose.originMm,1/168.0104),delta=add(origin,mul(plane.center,-1));
  near(dot(delta,plane.normal),0);near(dot(pose.beam,plane.normal),0);near(dot(pose.right,plane.normal),0);
  near(dot(pose.instrument.right,pose.beam),0);near(dot(pose.instrument.shaft,pose.beam),0);
  const electronic=rotateVector(pose.instrument.right,pose.beam,v.angleDefault*Math.PI/180);electronic.forEach((value,i)=>near(value,pose.right[i]));
  assert.ok(pose.shaftPoints.length>30);assert.ok(pose.shaftPoints.flat().every(Number.isFinite));
 }
});

test('other donors retain their own geometric references rather than LADAF landmarks',()=>{
 const scaled=Object.fromEntries(Object.entries(original).map(([id,p])=>[id,{...p,center:p.center.map(x=>x*.6)}]));
 const fitted=buildTeeAtlasFrames(scaled,views,{geometricComparisonOnly:true,flowFrames:flow});
 assert.equal(fitted.me4c,scaled.me4c);assert.notDeepEqual(fitted.meavsax.center,frames.meavsax.center);
 for(const v of views)assert.ok(fitted[v.id].center.every(Number.isFinite));
});

test('every study target has its own reference-guided illustration and separately verified guideline cine',()=>{
 const media=json('../public/assets/tee-atlas/media.json').clips;
 const artwork=json('../docs/tee-atlas/artwork-v2.json');
 assert.equal(media.length,28);assert.equal(new Set(media.map(c=>c.id)).size,28);
 assert.equal(artwork.views.length,28);assert.equal(new Set(artwork.views.map(v=>v.id)).size,28);
 for(const v of views){
  const svg=readFileSync(new URL('../public/'+v.diagram.replace(/^\.\//,''),import.meta.url),'utf8');assert.match(svg,/<svg/);assert.match(svg,/viewBox="0 0 220 150"/);
  assert.ok(v.illustration.endsWith(`/art-v2/${v.id}.webp`));
  const image=readFileSync(new URL('../public/'+v.illustration.replace(/^\.\//,''),import.meta.url));
  assert.equal(image.toString('ascii',0,4),'RIFF');assert.equal(image.toString('ascii',8,12),'WEBP');
  const entry=artwork.views.find(a=>a.id===v.id);assert.equal(entry.aseNumber,v.aseNumber);assert.equal(entry.output.bytes,image.length);assert.ok(entry.output.width>=1000);assert.ok(entry.reference.pdfPage>=14&&entry.reference.pdfPage<=17);
  const c=media.find(c=>c.preset===v.id);assert.ok(c);assert.equal(c.aseNumber,v.aseNumber);assert.equal(c.kind,'video');assert.equal(c.external,true);assert.equal(c.correspondence.sourceLabelVerified,true);assert.equal(c.correspondence.ctRegistered,false);assert.equal(c.verification.decodedVideo,true);assert.ok(c.width>=800&&c.height>=600);assert.match(c.url,new RegExp(`mmc${v.aseNumber}\\.mp4$`));assert.match(c.license,/Publisher-hosted/);
 }
});

test('ascending-aorta long and short axes are orthogonal and the long axis contains both source anchors',()=>{
 const point=([x,y,z])=>[(x-237)/529,(z-264.5)/529,(237-y)/529],lax=frames[views.find(v=>v.aseNumber===7).id],sax=frames[views.find(v=>v.aseNumber===8).id];
 for(const p of [point([260,265,270]),point([193.5,241.5,163.3456])])near(dot(p.map((v,i)=>v-lax.center[i]),lax.normal),0);
 near(dot(lax.normal,sax.normal),0);
});
