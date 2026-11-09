/** Capture the actual linked-chest renderer on measured donor data. No browser.
 * node scripts/lab-context-v43/export-tte-overview.mjs --out=/tmp/tte-overview-v43
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {DONORS} from '../../public/donors.js';
import {ProbeLabModule} from '../../public/probe-lab.js';
import {PROBE_PRESETS,sanitizeProbeState,volumeGeometry} from '../../public/probe-geometry.js';
import {ReferenceTorsoView,createReferenceProbeMeshes} from '../../public/probe-scene.js';
import {createDonorOverview,donorOverviewCamera,donorOverviewSector} from '../../public/probe-overview.js';
import {decodeEchoReferenceAnatomy,createEchoAnatomyContext} from '../../public/echo-anatomy-context-v2.js';

const root=fileURLToPath(new URL('../../',import.meta.url));
const out=resolve(process.argv.find(a=>a.startsWith('--out='))?.slice(6)||'/dev/shm/tte-overview-v43');
await mkdir(out,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const bytes=a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength);
const publicPath=url=>join(root,'public',url.replace(/^\.\//,'').split('?')[0]);
const readJson=async path=>JSON.parse(await readFile(path,'utf8'));
const anatomy=await decodeEchoReferenceAnatomy({manifestBytes:await readFile(publicPath('assets/probe-context-v11/manifest.json')),compressedBytes:await readFile(publicPath('assets/probe-context-v11/torso.bin.gz'))});
const sourceFiles=['public/probe-overview.js','public/probe-scene.js','public/probe-lab.js','public/probe-geometry.js','public/echo-anatomy-context-v2.js','public/echo-skeleton-fit.js','public/renderer.js'];
const sourceHashes=Object.fromEntries(await Promise.all(sourceFiles.map(async path=>[path,sha(await readFile(join(root,path)))])));
const width=440,height=560,assets=new Map(),cases=[],donors=[];
let draws=[],basis,normalizationMm,depthRange=[0,1];
const view={gl:{depthRange(a,b){depthRange=[a,b];}},
 begin(b,w,h,referenceMm){basis=b;normalizationMm=referenceMm;depthRange=[0,1];assert.equal(w,width);assert.equal(h,height);},
 upload(vertices,color,alpha=1,gloss=.12){return {vertices,color,alpha,gloss};},remove(){},
 draw(mesh,matrix){
  if(!mesh)return;
  const data=bytes(mesh.vertices),hash=sha(data),file=`mesh-${hash.slice(0,20)}.f32`;
  if(!assets.has(hash))assets.set(hash,{file,sha256:hash,bytes:data.length,count:mesh.vertices.length/6,data});
  draws.push({file,color:mesh.color,alpha:mesh.alpha,gloss:mesh.gloss,model:matrix?Array.from(matrix):null,depthRange:[...depthRange],id:mesh.id||null});
 }
};
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),add=(a,b)=>a.map((v,i)=>v+b[i]),mul=(a,s)=>a.map(v=>v*s);
for(const donor of DONORS){
 const manifest=await readJson(publicPath(donor.manifestUrl)),level=manifest.levels.high,[nx,ny,nz]=level.dimensions;
 const data=new Uint8Array(nx*ny*nz),parts=[];
 for(const part of level.parts){
  const packed=await readFile(publicPath(part.url));assert.equal(sha(packed),part.sha256);
  const decoded=new Uint8Array(gunzipSync(packed)),count=part.zRange[1]-part.zRange[0];
  if(part.predictor==='delta-z')for(let z=1;z<count;z++)for(let i=0;i<nx*ny;i++)decoded[z*nx*ny+i]=(decoded[z*nx*ny+i]+decoded[(z-1)*nx*ny+i])&255;
  else if(part.predictor==='delta-x'){for(let i=0;i<decoded.length;i++)if(i%nx)decoded[i]=(decoded[i]+decoded[i-1])&255;}
  else assert.ok(!part.predictor);
  assert.equal(sha(decoded),part.rawSha256);data.set(decoded,part.zRange[0]*nx*ny);parts.push({url:part.url,sha256:part.sha256,rawSha256:part.rawSha256});
 }
 const before=sha(data),geometry=volumeGeometry(level),threshold=manifest.defaultThreshold??.32;
 const overview=await createDonorOverview(data,level,{threshold,maxGrid:32});assert.equal(sha(data),before);
 const lab=Object.assign(Object.create(ProbeLabModule.prototype),{donor,geometry,frames:{},state:sanitizeProbeState({referenceMm:geometry.longestMm,interactionMode:'orbit'})});
 lab.setFrames(await readJson(publicPath(donor.echoPlanesUrl)));
 const model=createEchoAnatomyContext({frames:lab.frames,donorId:donor.id,referenceMm:geometry.longestMm,referenceAnatomy:anatomy});
 const mini=Object.assign(Object.create(ReferenceTorsoView.prototype),{
  view,model,active:true,canvas:{clientWidth:width,clientHeight:height},cameraReady:true,cameraMode:'manual',heartBounds:overview.bounds,
  heartMesh:view.upload(overview.vertices,[.77,.78,.64],1,.08),
  meshes:model.meshes.map(mesh=>({...view.upload(mesh.vertices,mesh.color,mesh.id==='bodyparts3d-skin'?.035:mesh.id==='bodyparts3d-bones'?.3:mesh.id==='bodyparts3d-spine'?.22:mesh.alpha,mesh.gloss),id:mesh.id})),
  probe:Object.fromEntries(['phased','tee'].map(kind=>[kind,createReferenceProbeMeshes(kind).map(mesh=>view.upload(mesh.vertices,mesh.color,1,mesh.gloss))])),
  onIndicator(){},requestRender(){},basis(){return this.reviewBasis;}
 });
 const boundsCorners=Array.from({length:8},(_,mask)=>overview.bounds.min.map((v,i)=>(mask>>i)&1?overview.bounds.max[i]:v));
 for(const preset of PROBE_PRESETS){
  lab.state=lab.startingPresetState(preset.id);lab.ensureOrigin();const basePose=lab.getPose(),baseState=structuredClone(lab.state);
  for(const variant of ['start','out-of-plane']){
   const pose=structuredClone(basePose),state=structuredClone(baseState);
   if(variant==='out-of-plane'){
    const separation=Math.max(...boundsCorners.map(p=>dot(p,pose.normal)))-dot(pose.originMm,pose.normal)+geometry.longestMm*.08;
    pose.originMm=add(pose.originMm,mul(pose.normal,separation));state.contactLocked=false;state.originMm=[...pose.originMm];
    assert.ok(boundsCorners.every(p=>dot(p.map((v,i)=>v-pose.originMm[i]),pose.normal)<-geometry.longestMm*.079));
   }
   const sector=donorOverviewSector(pose,state);
   assert.ok(sector.every(p=>Math.abs(dot(p.map((v,i)=>v-pose.originMm[i]),pose.normal))<1e-8));
   for(const camera of ['front','oblique']){
    const cam=donorOverviewCamera(model,width/height,camera,overview.bounds);mini.reviewBasis=cam;mini.normalizationMm=cam.referenceMm;
    draws=[];mini.render({pose,state});assert.deepEqual(mini.lastFrame.pose,pose);
    cases.push({donor:donor.id,preset:preset.id,name:preset.name,variant,camera,basis,referenceMm:normalizationMm,physicalReferenceMm:geometry.longestMm,pose,state,sector,draws,
     sourcePlaneOutsideHeartBounds:variant==='out-of-plane',sourcePoseIsAuthoritative:true});
   }
  }
 }
 donors.push({id:donor.id,sourceDimensions:level.dimensions,sourceSpacingUm:level.spacingUm,decodedSha256:before,sourceParts:parts,overviewGrid:overview.grid,overviewTriangles:overview.triangles,overviewBounds:overview.bounds,referenceMm:geometry.longestMm});
}
for(const asset of assets.values())await writeFile(join(out,asset.file),asset.data);
const geometrySource=await readFile(join(root,'public/probe-scene.js'),'utf8');
const shaders=Object.fromEntries([['vertex','VERTEX'],['fragment','FRAGMENT']].map(([key,name])=>[key,geometrySource.match(new RegExp('const '+name+'=`([\\s\\S]*?)`;'))[1]]));
await writeFile(join(out,'shaders.json'),JSON.stringify(shaders));
const report={scope:'Native scientific capture of the actual linked chest renderer using measured resident donor source, same accepted world-mm probe/sector, fixed fitted reference context, and independent front/oblique cameras. This is a coarse orientation outline, not fine anatomical detail, patient registration or browser/device performance.',width,height,sourceHashes,donors,cases,assets:[...assets.values()].map(({data,...asset})=>asset)};
await writeFile(join(out,'review.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({donors:donors.length,cases:cases.length,assets:assets.size,output:out}));
