/** Export actual Echo controller planes, cameras, shared-depth scene draw lists,
 * and projected guide commands for native scientific rendering. No browser,
 * build, source-volume edit, or publication is performed by this script.
 *
 * node scripts/echo-face-v42/export-review.mjs --out=/tmp/echo-face-v42
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAudit} from '../echo-donor-qc-v6/audit.mjs';
import {EchoModule} from '../../public/echo.js';
import {VolumeRenderer,volumeShaderSources} from '../../public/renderer.js';
import {sharedGeometryShaderSources,createProbeMeshes,createReferenceProbeMeshes} from '../../public/probe-scene.js';
import {TTE_ATLAS_VIEWS} from '../../public/tte-atlas-data.js';
import {TEE_ATLAS_VIEWS} from '../../public/tee-atlas-data.js';
import {TteScene,TteAtlasOverlay,createTteContextModel,tteAtlasProbePose} from '../../public/tte-atlas-geometry.js';
import {TeeAtlasOverlay,atlasContextProbePose} from '../../public/tee-atlas-geometry.js';
import {TeeSceneOverlay} from '../../public/tee-scene.js';
import {createTeeContextModel} from '../../public/tee-context-geometry.js';
import {decodeEchoReferenceAnatomy,createEchoAnatomyContext} from '../../public/echo-anatomy-context-v2.js';
import {fullEchoCutFacePlane} from '../../public/echo-cut-face.js';
import {DONORS} from '../../public/donors.js';

const root=fileURLToPath(new URL('../../',import.meta.url));
const option=(key,fallback)=>process.argv.find(v=>v.startsWith(`--${key}=`))?.slice(key.length+3)||fallback;
const out=resolve(option('out','/dev/shm/echo-face-v42'));
const donorId=option('donor','ladaf-2021-17');
const width=Number(option('width','640')),height=Number(option('height','560'));
if(!(width>0&&height>0))throw new Error('Positive output dimensions required.');
await mkdir(out,{recursive:true});
const read=p=>readFile(join(root,p));
const json=async p=>JSON.parse(await read(p));
const sha=b=>createHash('sha256').update(b).digest('hex');
const bytes=a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength);
const report=await runAudit({repo:root,includeAdjustments:false,donorId,includeRuntimeModels:true});
const rows=report.rows.filter(r=>r.donor===donorId&&r.planeReference==='refined'&&r.adjustment==='baseline');
if(rows.length!==56)throw new Error(`Expected all 56 atlas views, received ${rows.length}.`);
const donorMeta=report.models.find(m=>m.donor===donorId),referenceMm=donorMeta.referenceMm;
const donor=DONORS.find(d=>d.id===donorId),sourceManifest=await json(donorMeta.manifest);
const extents=sourceManifest.sourceScaleCenterExtentUm,referenceUm=Math.max(...extents);
const extent=[extents[0]/referenceUm,extents[2]/referenceUm,extents[1]/referenceUm];
const models=report.runtimeModels[donorId];
if(!report.sourceStable)throw new Error(`Runtime source changed during controller audit: ${report.sourceChangedDuringAudit.join(', ')}. Re-run export.`);
const descriptions=new Map([...TTE_ATLAS_VIEWS,...TEE_ATLAS_VIEWS].map(v=>[v.id,v]));

// Capture exact production draw calls. Vertex bytes are content-deduplicated;
// immutable anatomy is not reconstructed or moved for individual views.
const assets=new Map(),meshInfo=new Map();
for(const [mode,model]of Object.entries(models))for(const m of model.meshes)meshInfo.set(m.vertices,{id:m.id,role:m.role||'context',mode});
let draws=[],cull=null,cullEnabled=false,depthRange=[0,1],depthWrite=true;
const gl={CULL_FACE:1,FRONT:2,BACK:3,DEPTH_TEST:4,LEQUAL:5,
 enable(cap){if(cap===1)cullEnabled=true;},disable(cap){if(cap===1)cullEnabled=false;},
 cullFace(v){cull=v===2?'front':'back';},depthFunc(){},
 depthRange(near,far){depthRange=[near,far];},depthMask(value){depthWrite=!!value;}};
const captureView={gl,begin(){cullEnabled=false;cull=null;depthRange=[0,1];depthWrite=true;},remove(){},
 upload(vertices,color,alpha=1,gloss=.12){return {vertices,color,alpha,gloss};},
 draw(mesh,matrix){
  const data=bytes(mesh.vertices),hash=sha(data),file=`geometry-${hash.slice(0,20)}.f32`;
  if(!assets.has(hash))assets.set(hash,{file,sha256:hash,bytes:data.length,vertices:mesh.vertices.length/6,data});
  draws.push({file,sha256:hash,color:mesh.color,alpha:mesh.alpha??1,gloss:mesh.gloss??.12,model:matrix?[...matrix]:null,cull:cullEnabled?cull:null,depthRange:[...depthRange],depthWrite,...(meshInfo.get(mesh.vertices)||{role:'probe'})});
 }
};
// Keep the same probe factory as the current production scene, including its
// raised orientation indicator; fail visibly if that private setup changes.
if(!(await read('public/tte-atlas-geometry.js')).toString().includes("const probeMeshes=createReferenceProbeMeshes('phased');"))throw new Error('Production TTE probe factory changed; update the native capture setup.');
const tteScene=Object.assign(Object.create(TteScene.prototype),{view:captureView,active:true,labels:{draw(){}},probe:createReferenceProbeMeshes('phased').map(m=>captureView.upload(m.vertices,m.color,1,m.gloss))});
const teeScene=Object.assign(Object.create(TeeSceneOverlay.prototype),{view:captureView,sharedDepth:true,head:createProbeMeshes('tee').filter((_,i)=>i!==2).map(m=>captureView.upload(m.vertices,m.color,1,m.gloss))});

function renderer(){return Object.assign(Object.create(VolumeRenderer.prototype),{canvas:{getBoundingClientRect:()=>({width,height})},camera:{yaw:.32,pitch:.12,roll:Math.PI,distance:1.55,pan:[0,0,0]},requestRender(){},onChange(){}});}
function productionCamera(row,model,alignment){
 const r=renderer(),e=Object.assign(Object.create(EchoModule.prototype),{renderer:r,state:{mode:row.mode,preset:row.id,alignment,flip:false,showProbe:!!row.plane.acquisitionPose},frames:{[row.id]:row.plane},longestMm:referenceMm,getPlane:()=>row.plane,anatomyContext:()=>model});
 e.applyCameraAlignment({fitUpright:true});
 return {basis:r.basis(),state:{...r.camera,pan:[...r.camera.pan]}};
}

// Native rasterization later replays these Canvas2D vector guide commands.
// They are intentionally unoccluded, as in the production sector overlay;
// anatomy and probe use the shared depth-tested geometry shader instead.
function productionGuides(row,description,model,camera){
 const commands=[];let path=[],closed=false,dash=[];
 const ctx={setTransform(){},clearRect(){},beginPath(){path=[];closed=false;},moveTo(x,y){path.push([x,y]);},lineTo(x,y){path.push([x,y]);},closePath(){closed=true;},setLineDash(v){dash=[...v];},
  fill(){commands.push({kind:'fill',points:path.map(p=>[...p]),closed,color:this.fillStyle});},
  stroke(){commands.push({kind:'stroke',points:path.map(p=>[...p]),closed,color:this.strokeStyle,width:this.lineWidth||1,dash:[...dash]});}
 };
 const guideCanvas={style:{},width,height,getContext:()=>ctx};
 const overlay=Object.assign(Object.create(row.mode==='tte'?TteAtlasOverlay.prototype:TeeAtlasOverlay.prototype),{
  renderer:{canvas:{getBoundingClientRect:()=>({width,height})},camera:camera.state,basis:()=>camera.basis},
  mount:{hidden:false},meshCanvas:{style:{}},guideCanvas,scene:{sharedDepth:true,render(){}},
  running:true,showProbe:!!row.plane.acquisitionPose,showSector:!!row.plane.acquisitionPose,showContext:true,contextModel:model,referenceMm,
  plane:row.plane,pose:row.plane.acquisitionPose,view:description,key:''
 });
 overlay.draw();return commands;
}

const cases=[];
for(const row of rows){
 const description=descriptions.get(row.id),model=models[row.mode],pose=row.plane.acquisitionPose;
 const drawablePose=pose||(row.mode==='tte'?tteAtlasProbePose:atlasContextProbePose)(row.plane,description,referenceMm,model);
 // Rejected acquisitions keep the fixed context; diagnostic fallback poses
 // are never drawn or reported as accepted probes.
 const cameras={},drawsByCamera={},guidesByCamera={};
 for(const [key,alignment]of [['probe','probe'],['anatomy','upright']]){
  const camera=productionCamera(row,model,alignment);cameras[key]=camera;draws=[];
  if(row.mode==='tte'){
   tteScene.params={pose:drawablePose,contextModel:model,showContext:true,showProbe:!!pose,probeLabel:`TTE · ${description.code}`};
   tteScene.draw({basis:camera.basis,width,height});
  }else teeScene.drawGeometry({basis:camera.basis,width,height,dpr:1,pose:drawablePose,reference:{referenceMm,scale:referenceMm/168.0104},showProbe:!!pose,contextModel:model,showContext:true});
  drawsByCamera[key]=draws;guidesByCamera[key]=productionGuides(row,description,model,camera);
 }
 const capPlane=row.metrics.outsideScan?null:fullEchoCutFacePlane(row.plane,extent,{paddingWorld:2*donor.fineSpacingUm/(referenceMm*1000)});
 cases.push({id:row.id,mode:row.mode,name:description.name,shortName:description.shortName,code:description.code,group:description.group,tableRow:description.tableRow,aseNumber:description.aseNumber,plane:row.plane,capPlane,pose:pose||null,poseAvailable:!!pose,intentionalWithheld:row.metrics.intentionalWithheld===true,clipFlip:row.handoff.clipFlip,outsideScan:row.metrics.outsideScan,cameras,drawsByCamera,guidesByCamera,auditMetrics:row.metrics,anatomicalTargets:row.anatomicalTargets});
}
for(const asset of assets.values())await writeFile(join(out,asset.file),asset.data);
const sourceFiles=['public/echo.js','public/echo-cut-face.js','public/donors.js','public/window-presets.js','public/echo-donor-planes.js','public/echo-donor-calibration.js','public/echo-donor-support.js','public/renderer.js','public/probe-scene.js','public/probe-geometry.js','public/planes.js','public/echo-correspondence.js','public/render-depth.js','public/render-styles.js','public/mpr-worker.js','public/tte-atlas-data.js','public/tee-atlas-data.js','public/tte-atlas-geometry.js','public/tee-atlas-geometry.js','public/tee-scene.js','public/echo-acquisition-geometry.js','public/echo-tte-guidance.js','public/echo-instrument-clearance.js','public/echo-anatomy-context-v2.js','public/echo-context-presentation.js','public/echo-skeleton-fit.js','public/tee-context-geometry.js','public/tee-view-refinement.js','public/assets/echo-planes.json','public/assets/flow-views-v5.json','public/assets/tee-atlas/plane-fit-v2.json','public/assets/probe-context-v11/manifest.json','public/assets/probe-context-v11/torso.bin.gz','scripts/echo-donor-qc-v6/audit.mjs','scripts/echo-face-v42/export-review.mjs','scripts/echo-face-v42/sample-caps.mjs','scripts/echo-face-v42/render_gallery.py'];
if(donorId!=='ladaf-2021-17')sourceFiles.push(`public/assets/donors/${donorId}/echo-planes.json`,`public/assets/donors/${donorId}/flow-views.json`);
sourceFiles.push(donorMeta.manifest);
const sourceHashes={};for(const file of sourceFiles)sourceHashes[file]=sha(await read(file));
const changedAfterAudit=Object.entries(report.sourceHashes).filter(([file,hash])=>sourceHashes[file]&&sourceHashes[file]!==hash).map(([file])=>file);
if(changedAfterAudit.length)throw new Error(`Runtime source changed during scene export: ${changedAfterAudit.join(', ')}. Re-run export.`);
const modelInfo=Object.fromEntries(Object.entries(models).map(([mode,m])=>[mode,{revision:m.revision,frame:m.frame,bodyTransform:m.bodyTransform,focusPointsMm:m.focusPointsMm,bounds:m.bounds,provenance:m.provenance,meshes:m.meshes.map(mesh=>({id:mesh.id,sha256:sha(bytes(mesh.vertices)),color:mesh.color,alpha:mesh.alpha,gloss:mesh.gloss,role:mesh.role}))}]));
const manifest={schemaVersion:3,createdAt:new Date().toISOString(),donor:donorId,sourceSpacingUm:donorMeta.sourceSpacingUm,fineSpacingUm:donor.fineSpacingUm,sourceManifest:donorMeta.manifest,referenceMm,extent,width,height,sourceHashes,models:modelInfo,
 scope:'Actual production Echo controller accepted planes/poses, unchanged CT ROI, same-plane full-face bounds, both camera alignments, complete shared-depth scene draw lists and production Canvas2D scan-sector commands. Native renderer samples the selected donor’s hash-verified measured resident source; this is orientation, whole-cut coverage and composition evidence, not browser UI/FPS, Ultra detail, clinical echo correspondence or patient registration.',
 assets:[...assets.values()].map(({data,...a})=>a),cases};
const {runtimeModels,...serializableAudit}=report;
await writeFile(join(out,'controller-audit.json'),JSON.stringify(serializableAudit)+'\n');
await writeFile(join(out,'review.json'),JSON.stringify(manifest,null,2)+'\n');
await writeFile(join(out,'shaders.json'),JSON.stringify({volume:volumeShaderSources,geometry:sharedGeometryShaderSources},null,2)+'\n');
console.log(JSON.stringify({donor:donorId,views:cases.length,cameras:cases.length*2,unavailablePoses:cases.filter(c=>!c.poseAvailable).map(c=>c.id),geometryAssets:assets.size,geometryBytes:[...assets.values()].reduce((n,a)=>n+a.bytes,0),output:join(out,'review.json')}));
