import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {
 ECHO_REFERENCE_ANATOMY,ECHO_BODY_CROP,ECHO_BODY_WINDOWS,
 decodeEchoReferenceAnatomy,loadEchoReferenceAnatomy,loadEchoAnatomyContext,createEchoAnatomyContext,
 bodyReferenceToWorld,worldToBodyReference,bodyReferenceDirectionToWorld,skeletonReferenceToWorld,
 sampleEchoBodySkin,intersectEchoBodySkinPlane,
} from '../public/echo-anatomy-context-v2.js';
import {createTeeContextModel,teeContextToLocal} from '../public/tee-context-geometry.js';
import {createTteContextModel} from '../public/tte-atlas-geometry.js';

const read=name=>readFileSync(new URL('../'+name,import.meta.url));
const manifestBytes=read('public/assets/probe-context-v11/manifest.json');
const compressedBytes=read('public/assets/probe-context-v11/torso.bin.gz');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const byteView=a=>new Uint8Array(a.buffer,a.byteOffset,a.byteLength);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const norm=a=>Math.hypot(...a);
const near=(a,b,eps=1e-6)=>assert.ok(Math.abs(a-b)<=eps,`${a} != ${b} within ${eps}`);
const vectorNear=(a,b,eps=1e-6)=>a.forEach((v,i)=>near(v,b[i],eps));
const source=JSON.parse(read('public/assets/echo-planes.json'));
const frames=Object.fromEntries(Object.entries(source.frames).map(([id,v])=>[id,v.world]));
const options={frames,donorId:'1659197537',referenceMm:168.0104};
const reference=await decodeEchoReferenceAnatomy({manifestBytes,compressedBytes});
const baseTte=createTteContextModel(options),baseTee=createTeeContextModel(options);
const tte=createEchoAnatomyContext({baseModel:baseTte,referenceAnatomy:reference,frames});
const tee=createEchoAnatomyContext({baseModel:baseTee,referenceAnatomy:reference,frames});

test('pinned source is verified before decode/exposure; corrupt, truncated and oversized inputs fail',async()=>{
 assert.equal(hash(manifestBytes),ECHO_REFERENCE_ANATOMY.manifestSha256);
 assert.equal(hash(compressedBytes),ECHO_REFERENCE_ANATOMY.compressedSha256);
 const corrupt=Buffer.from(compressedBytes);corrupt[300]^=128;
 await assert.rejects(decodeEchoReferenceAnatomy({manifestBytes,compressedBytes:corrupt}),/checksum/);
 await assert.rejects(decodeEchoReferenceAnatomy({manifestBytes,compressedBytes:compressedBytes.subarray(1)}),/byte count/);
 await assert.rejects(decodeEchoReferenceAnatomy({manifestBytes:Buffer.concat([manifestBytes,Buffer.from(' ')]),compressedBytes}),/byte count/);
 assert.throws(()=>createEchoAnatomyContext({baseModel:baseTte,referenceAnatomy:{...reference}}),/verified/);
 assert.deepEqual(reference.meshes.map(m=>m.name),['skin','bones','spine']);
 assert.ok(reference.heartReferenceBounds);
});

test('real thoracic mesh ranges, cropped boundaries and normals are finite and bounded',()=>{
 for(const sourceMesh of reference.meshes){
  assert.ok(sourceMesh.referenceVertices.length>0);
  assert.equal(sourceMesh.referenceVertices.length%18,0);
  assert.ok(sourceMesh.referenceVertices.length/18<sourceMesh.sourceTriangleCount*2);
  for(let i=0;i<sourceMesh.referenceVertices.length;i+=6){
   for(let axis=0;axis<3;axis++){
    const p=sourceMesh.referenceVertices[i+axis];
    assert.ok(Number.isFinite(p));
    assert.ok(p>=ECHO_BODY_CROP.min[axis]-1e-4&&p<=ECHO_BODY_CROP.max[axis]+1e-4);
   }
   near(norm(Array.from(sourceMesh.referenceVertices.subarray(i+3,i+6))),1,2e-7);
  }
 }
 for(const model of [tte,tee]){
  assert.equal(model.provenance.referenceHeartDisplayed,false);
  assert.equal(model.provenance.patientRegistered,false);
  assert.equal(model.meshes.filter(m=>m.id.startsWith('bodyparts3d-')).length,3);
  assert.ok(!model.meshes.some(m=>/heart/.test(m.id)));
  assert.ok(model.meshes.filter(m=>m.id.startsWith('bodyparts3d-')).every(m=>m.alpha<.3));
 }
});

test('one fixed body frame and intact skeleton fit are identical in TTE and TEE',()=>{
 assert.deepEqual(tte.bodyTransform,tee.bodyTransform);
 vectorNear(bodyReferenceToWorld([20,5,8],tte),baseTee.frame.originMm,1e-12);
 for(const p of [[20,5,8],[-30,87,95],[76,-48,104],[-120,-100,-125]]){
  vectorNear(worldToBodyReference(bodyReferenceToWorld(p,tte),tte),p,1e-11);
  vectorNear(bodyReferenceToWorld(p,tte),bodyReferenceToWorld(p,tee),1e-12);
 }
 for(const body of reference.meshes){
  const a=tte.meshes.find(m=>m.id==='bodyparts3d-'+body.name),b=tee.meshes.find(m=>m.id===a.id);
  assert.equal(hash(byteView(a.vertices)),hash(byteView(b.vertices)));
  assert.equal(a.vertices.length,body.referenceVertices.length,'Every original cropped bone triangle is retained.');
  const skeleton=body.name!=='skin'&&tte.skeletonFit;
  for(let at=0;at<body.referenceVertices.length;at+=6*17){
   vectorNear(Array.from(a.vertices.subarray(at,at+3)),(skeleton?skeletonReferenceToWorld:bodyReferenceToWorld)(body.referenceVertices.subarray(at,at+3),tte),2e-5);
   if(skeleton)near(norm(Array.from(a.vertices.subarray(at+3,at+6))),1,2e-7);
   else vectorNear(Array.from(a.vertices.subarray(at+3,at+6)),bodyReferenceDirectionToWorld(body.referenceVertices.subarray(at+3,at+6),tte),2e-7);
  }
 }
 const geometricApicalPatch=[59.749516,-31.686808,45.1497];
 const delta=norm(sub(bodyReferenceToWorld(geometricApicalPatch,tte),tte.frame.landmarksMm.apex));
 assert.ok(delta<8,'Fixed illustrative reference must remain close to the independently reviewed donor apex.');
 assert.ok(Math.abs(dot(tte.frame.superior,sub(tte.frame.landmarksMm.apex,tte.frame.originMm)))>25);
 assert.equal(createEchoAnatomyContext({baseModel:baseTte,referenceAnatomy:reference,frames:{a4c:{center:[9,9,9]}}}),tte);
});

test('existing TEE organs and routing are untouched; TTE reuses the double-domed diaphragm with a real hiatus',()=>{
 assert.equal(tee.tractSamples,baseTee.tractSamples);
 assert.equal(tee.gastricInteriorSamples,baseTee.gastricInteriorSamples);
 assert.equal(tee.landmarksMm,baseTee.landmarksMm);
 assert.equal(tee.topology,baseTee.topology);
 for(const mesh of baseTee.meshes)assert.equal(tee.meshes.find(m=>m.id===mesh.id),mesh);
 assert.ok(!tte.meshes.some(m=>/^rib-|^sternum$/.test(m.id)));
 assert.ok(tte.topology.diaphragm.openBoundaries.includes('esophageal hiatus'));
 for(const id of ['diaphragm','central-tendon','esophageal-hiatus','diaphragm-rim']){
  const a=tte.meshes.find(m=>m.id===id),b=baseTee.meshes.find(m=>m.id===id);
  assert.equal(a.vertices.length,b.vertices.length);
  for(let i=0;i<a.vertices.length;i++)near(a.vertices[i],b.vertices[i],2e-5);
 }
 assert.ok(!tte.tractSamples,'A TTE diaphragm upgrade must not silently add TEE route behavior.');
});

test('window anchors are on actual anterior triangles and source/body/world coordinates agree',()=>{
 for(const [id,spec]of Object.entries(ECHO_BODY_WINDOWS)){
  const hit=sampleEchoBodySkin(tte,...spec.anchorXY),window=tte.bodyWindows[id];
  assert.ok(hit,id);assert.ok(hit.bodyNormal[2]>.02);
  vectorNear(hit.pointMm,window.anchorMm,1e-12);
  vectorNear(worldToBodyReference(hit.pointMm,tte),hit.bodyPointMm,1e-10);
  const at=hit.triangleIndex*18,v=tte.skinSurface.referenceVertices;
  const reconstructed=[0,1,2].map(k=>hit.barycentric.reduce((n,w,j)=>n+w*v[at+j*6+k],0));
  vectorNear(reconstructed,hit.bodyPointMm,1e-7);
  for(let i=0;i<3;i++)assert.ok(hit.bodyPointMm[i]>=spec.referenceBounds.min[i]&&hit.bodyPointMm[i]<=spec.referenceBounds.max[i],id);
 }
 assert.equal(sampleEchoBodySkin(tte,400,0),null);
 assert.equal(sampleEchoBodySkin(tte,0,-180),null);
});

test('skin/plane segments stay in the unchanged world-mm plane and exact bounded window',()=>{
 for(const id of Object.keys(ECHO_BODY_WINDOWS)){
  const centerMm=tte.bodyWindows[id].anchorMm;
  for(const direction of [[1,0,0],[.4,.7,.2],[.2,.3,.9]]){
   const normal=bodyReferenceDirectionToWorld(direction,tte),plane={centerMm,normal},before=JSON.stringify(plane);
   const segments=intersectEchoBodySkinPlane(tte,plane,{windowId:id});
   assert.ok(segments.length>0,id);
   for(const s of segments)for(const p of [s.aMm,s.bMm]){
    near(dot(sub(p,centerMm),normal),0,1e-6);
    const ref=worldToBodyReference(p,tte),box=ECHO_BODY_WINDOWS[id].referenceBounds;
    for(let i=0;i<3;i++)assert.ok(ref[i]>=box.min[i]-1e-7&&ref[i]<=box.max[i]+1e-7);
   }
   assert.equal(JSON.stringify(plane),before);
  }
 }
 assert.deepEqual(intersectEchoBodySkinPlane(tte,{centerMm:[10000,10000,10000],normal:[1,0,0]}),[]);
 assert.throws(()=>intersectEchoBodySkinPlane(tte,{centerMm:[0,0,0],normal:[1,0,0]},{windowId:'wrong'}),/Unknown/);
});

test('comparison donors use independent source frames and a fixed specimen-envelope torso fit',()=>{
 assert.throws(()=>createEchoAnatomyContext({baseModel:baseTte,referenceAnatomy:reference,donorId:'s-20-28'}),/another donor/);
 assert.throws(()=>createEchoAnatomyContext({baseModel:baseTte,referenceAnatomy:reference,referenceMm:154}),/physical scale/);
 assert.throws(()=>createEchoAnatomyContext({baseModel:baseTte,referenceAnatomy:reference,referenceMm:NaN}),/physical scale/);
 for(const id of ['s-20-28','s-20-29']){
  const data=JSON.parse(read(`public/assets/donors/${id}/echo-planes.json`));
  const ownFrames=Object.fromEntries(Object.entries(data.frames).map(([key,p])=>[key,p.world]));
  const ownBase=createTteContextModel({frames:ownFrames,referenceMm:data.referenceMm,donorId:id});
  const model=createEchoAnatomyContext({baseModel:ownBase,referenceAnatomy:reference});
  assert.equal(model.frame,ownBase.frame);
  assert.ok(model.frame.landmarksMm.apex&&model.frame.landmarksMm.mitralRegion);
  assert.notDeepEqual(model.frame.landmarksMm.apex,tte.frame.landmarksMm.apex);
  assert.equal(model.provenance.orientation,'specimen-source-anchored-illustrative-frame');
  assert.equal(model.provenance.patientRegistered,false);
  assert.equal(model.referenceMm,data.referenceMm);
  assert.ok(model.bodyTransform.bodyReferenceScale>1);
  near(model.bodyTransform.scale,model.frame.scale*model.frame.contextProfile.bodyReferenceScale);
  vectorNear(worldToBodyReference(model.bodyWindows.apical.anchorMm,model),worldToBodyReference(tte.bodyWindows.apical.anchorMm,tte),1e-9);
  const ownTee=createTeeContextModel({frames:ownFrames,referenceMm:data.referenceMm,donorId:id});
  const teeBody=createEchoAnatomyContext({baseModel:ownTee,referenceAnatomy:reference});
  assert.deepEqual(model.bodyTransform,teeBody.bodyTransform);
  for(const mesh of ownTee.meshes)assert.equal(teeBody.meshes.find(m=>m.id===mesh.id),mesh,'Torso fit cannot modify GI or diaphragm.');
 }
 assert.equal(tte.bodyTransform.bodyReferenceScale,1,'LADAF keeps its existing torso placement.');
});

test('bounded loader is usable with file-backed fetch and rejects oversized response streams',async()=>{
 const calls=[];
 const fetchImpl=async url=>{calls.push(url);return new Response(url===ECHO_REFERENCE_ANATOMY.manifestUrl?manifestBytes:compressedBytes);};
 const model=await loadEchoAnatomyContext({baseModel:baseTte,fetchImpl});
 assert.equal(model.provenance.sourceHash,ECHO_REFERENCE_ANATOMY.compressedSha256);
 assert.deepEqual(calls.sort(),[ECHO_REFERENCE_ANATOMY.manifestUrl,ECHO_REFERENCE_ANATOMY.meshUrl].sort());
 await assert.rejects(loadEchoReferenceAnatomy({fetchImpl:async url=>new Response(url===ECHO_REFERENCE_ANATOMY.manifestUrl?Buffer.concat([manifestBytes,Buffer.from('x')]):compressedBytes)}),/pinned byte limit/);
 const controller=new AbortController();controller.abort();
 assert.throws(()=>loadEchoReferenceAnatomy({signal:controller.signal,fetchImpl}),/abort/i);
});

test('camera focus excludes the arms/abdomen while retaining every named entry point and donor anchor',()=>{
 for(const model of [tte,tee]){
  assert.ok(model.focusPointsMm.length>=8);
  for(const window of Object.values(model.bodyWindows)){
   const p=worldToBodyReference(window.anchorMm,model),box=model.focusReferenceBounds;
   for(let i=0;i<3;i++)assert.ok(p[i]>=box.min[i]&&p[i]<=box.max[i]);
  }
  assert.ok(model.focusReferenceBounds.max[0]-model.focusReferenceBounds.min[0]<200);
  assert.ok(model.focusReferenceBounds.max[1]-model.focusReferenceBounds.min[1]<220);
  for(const p of Object.values(model.frame.landmarksMm)){
   for(let i=0;i<3;i++)assert.ok(p[i]>=model.focusBounds.min[i]&&p[i]<=model.focusBounds.max[i]);
  }
 }
});
