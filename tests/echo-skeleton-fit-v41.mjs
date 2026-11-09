import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import * as current from '../public/echo-anatomy-context-v2.js';
import {ECHO_SKELETON_FITS,fitEchoSkeletonSample} from '../public/echo-skeleton-fit.js';
import {createTeeContextModel} from '../public/tee-context-geometry.js';
import {createTteContextModel} from '../public/tte-atlas-geometry.js';

const frozenRevision='b1e5eb16954839923d0e37841079008c99730daf';
const baseUrl=new URL('../public/echo-anatomy-context-v2.js',import.meta.url);
const snapshot=file=>execFileSync('git',['show',frozenRevision+':'+file],{encoding:'utf8'});
const dataUrl=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const absoluteImports=code=>code.replace(/from (['"])(\.\/[^'"]+)\1/g,(_,q,p)=>'from '+q+new URL(p,baseUrl).href+q).replaceAll('import.meta.url',JSON.stringify(baseUrl.href));
const cutaway=dataUrl(absoluteImports(snapshot('public/echo-context-cutaway.js')));
const legacy=await import(dataUrl(absoluteImports(snapshot('public/echo-anatomy-context-v2.js').replace("'./echo-context-cutaway.js'",JSON.stringify(cutaway)))));
const read=file=>readFileSync(new URL('../'+file,import.meta.url));
const bytes={manifestBytes:read('public/assets/probe-context-v11/manifest.json'),compressedBytes:read('public/assets/probe-context-v11/torso.bin.gz')};
const reference=await current.decodeEchoReferenceAnatomy(bytes),oldReference=await legacy.decodeEchoReferenceAnatomy(bytes);
const hash=a=>createHash('sha256').update(Buffer.from(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
const sub=(a,b)=>a.map((x,i)=>x-b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const unit=v=>v.map(x=>x/Math.hypot(...v));
const near=(a,b,tol)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);

test('all donor skin, organ and contact geometry is unchanged; intact skeleton topology is restored',()=>{
 const originalHashes=reference.meshes.map(m=>hash(m.referenceVertices));
 for(const donorId of ['ladaf-2021-17','s-20-29','s-20-28']){
  const catalog=JSON.parse(read(donorId==='ladaf-2021-17'?'public/assets/echo-planes.json':`public/assets/donors/${donorId}/echo-planes.json`));
  const frames=Object.fromEntries(Object.entries(catalog.frames).map(([id,f])=>[id,f.world]));
  const options={donorId,referenceMm:catalog.referenceMm,frames},base=createTeeContextModel(options);
  const before=legacy.createEchoAnatomyContext({baseModel:base,referenceAnatomy:oldReference});
  const after=current.createEchoAnatomyContext({baseModel:base,referenceAnatomy:reference});
  const tte=current.createEchoAnatomyContext({baseModel:createTteContextModel(options),referenceAnatomy:reference});
  for(const key of ['referenceOriginMm','originMm','left','superior','anterior','scale','bodyReferenceScale','referenceMm'])assert.deepEqual(after.bodyTransform[key],before.bodyTransform[key],donorId+': '+key);
  assert.equal(hash(after.skinSurface.vertices),hash(before.skinSurface.vertices));
  assert.equal(hash(after.skinSurface.referenceVertices),hash(before.skinSurface.referenceVertices));
  assert.deepEqual(after.bodyWindows,before.bodyWindows);
  assert.deepEqual(after.focusPointsMm,before.focusPointsMm);
  assert.equal(after.tractSamples,base.tractSamples);assert.equal(after.gastricInteriorSamples,base.gastricInteriorSamples);assert.equal(after.topology,base.topology);
  for(const mesh of base.meshes)assert.equal(after.meshes.find(m=>m.id===mesh.id),mesh);
  assert.equal(after.spineCutaway,undefined);
  assert.equal(after.skeletonFit,tte.skeletonFit);
  assert.equal(after.skeletonFit?.topologyPreserved,donorId==='ladaf-2021-17'?true:undefined);
  for(const body of reference.meshes){
   const mesh=after.meshes.find(m=>m.id==='bodyparts3d-'+body.name),other=tte.meshes.find(m=>m.id===mesh.id);
   assert.equal(mesh.vertices.length,body.referenceVertices.length,donorId+': '+body.name);
   assert.equal(hash(mesh.vertices),hash(other.vertices));assert.equal(mesh.displayCutaway,undefined);
   if(donorId!=='ladaf-2021-17'||body.name==='skin')assert.equal(hash(mesh.vertices),hash(before.meshes.find(m=>m.id===mesh.id).vertices));
  }
  for(const id of ['bodyparts3d-sternum','bodyparts3d-ribs','bodyparts3d-spine'])assert.equal(after.labels.find(l=>l.id===id).text.includes('cutaway'),false);
 }
 assert.deepEqual(reference.meshes.map(m=>hash(m.referenceVertices)),originalHashes,'Verified source arrays must not be mutated.');
});

test('fixed field is globally monotone and analytic inverse-transpose normals match finite differences',()=>{
 const fit=ECHO_SKELETON_FITS['ladaf-2021-17'];
 assert.ok(fit.minimumJacobianDeterminant>.5);assert.equal(fit.maximumDisplacementMm,17);
 const epsilon=1e-3;
 for(const point of [[-20,0,-60],[-20,40,-81.2132],[-20,-40,65.2513],[30,100,-90],[-140,120,-40],[100,-90,80]]){
  const normal=unit([.31,.47,.83]),sample=fitEchoSkeletonSample(point,normal,fit);
  assert.equal(sample.point[0],point[0]);assert.equal(sample.point[1],point[1]);
  assert.ok(sample.displacementMm>=0&&sample.displacementMm<=fit.maximumDisplacementMm);
  assert.ok(sample.jacobianDeterminant>=fit.minimumJacobianDeterminant);
  const tangent=unit(cross(normal,[0,1,0])),other=unit(cross(normal,tangent));
  const derivative=axis=>{
   const high=fitEchoSkeletonSample(point.map((v,i)=>v+epsilon*axis[i]),null,fit).point;
   const low=fitEchoSkeletonSample(point.map((v,i)=>v-epsilon*axis[i]),null,fit).point;
   return high.map((v,i)=>(v-low[i])/(2*epsilon));
  };
  const outputNormal=unit(sample.normal);
  near(dot(outputNormal,derivative(tangent)),0,1e-8);near(dot(outputNormal,derivative(other)),0,1e-8);
  near(derivative([0,0,1])[2],sample.jacobianDeterminant,1e-8);
 }
});

test('every fitted triangle keeps its winding and finite unit normals without losing a source face',()=>{
 const base=createTeeContextModel({donorId:'ladaf-2021-17',referenceMm:168.0104});
 const model=current.createEchoAnatomyContext({baseModel:base,referenceAnatomy:reference});
 for(const source of reference.meshes.filter(m=>m.name!=='skin')){
  const mesh=model.meshes.find(m=>m.id==='bodyparts3d-'+source.name),a=source.referenceVertices,b=mesh.vertices;
  assert.equal(a.length,b.length);
  for(let i=0;i<a.length;i+=18){
   const original=[0,6,12].map(k=>Array.from(a.subarray(i+k,i+k+3))),mapped=[0,6,12].map(k=>Array.from(b.subarray(i+k,i+k+3)));
   const n=cross(sub(original[1],original[0]),sub(original[2],original[0]));
   const midpoint=original[0].map((_,axis)=>(original[0][axis]+original[1][axis]+original[2][axis])/3-model.bodyTransform.referenceOriginMm[axis]);
   const expected=current.bodyReferenceDirectionToWorld(fitEchoSkeletonSample(midpoint,n,model.skeletonFit).normal,model);
   const mappedNormal=unit(cross(sub(mapped[1],mapped[0]),sub(mapped[2],mapped[0])));
   assert.ok(dot(expected,mappedNormal)>.9,source.name+' triangle '+i/18+' reverses or folds.');
   for(const k of [0,6,12]){
    const normal=Array.from(b.subarray(i+k+3,i+k+6));assert.ok(normal.every(Number.isFinite));near(Math.hypot(...normal),1,2e-7);
   }
  }
 }
});
