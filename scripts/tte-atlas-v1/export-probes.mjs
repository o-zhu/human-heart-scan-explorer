/** Export the actual TTE production draw commands for native geometry review. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {TTE_ATLAS_VIEWS as views} from '../../public/tte-atlas-data.js';
import {buildTteAtlasFrames,createTteContextModel,tteAtlasProbePose,tteContextCamera,TteScene} from '../../public/tte-atlas-geometry.js';
import {createReferenceProbeMeshes} from '../../public/probe-scene.js';
const out=process.argv[2]||'/tmp/tte-atlas-v1';await mkdir(out,{recursive:true});
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const raw=await json('public/assets/echo-planes.json');
const base=Object.fromEntries(Object.entries(raw.frames).map(([id,f])=>[id,{...f.world,displayMirrorX:!!f.displayMirrorX,displayRotate180:!!f.displayRotate180}]));
const flow=Object.fromEntries((await json('public/assets/flow-views-v5.json')).presets.map(p=>[p.id,p.world]));
const frames=buildTteAtlasFrames(base,views,{flowFrames:flow,donorId:'1659197537'});
const model=createTteContextModel({frames:base,referenceMm:168.0104,donorId:'1659197537'});
const {forward,right,up}=tteContextCamera(model,1),camera={forward,right,up};
const assets=[],assetMap=new Map(),cases=[];let draws=[],cull=null,cullEnabled=false;
const gl={CULL_FACE:1,FRONT:2,BACK:3,enable(){cullEnabled=true;},disable(){cullEnabled=false;},cullFace(v){cull=v===2?'front':'back';}};
const view={gl,begin(){cullEnabled=false;cull=null;},remove(){},upload(vertices,color,alpha=1,gloss=.12){return {vertices,color,alpha,gloss};},draw(mesh,matrix){
 if(!assetMap.has(mesh.vertices)){const file=`geometry-${assets.length}.f32`;assetMap.set(mesh.vertices,file);assets.push({file,vertices:mesh.vertices});}
 draws.push({file:assetMap.get(mesh.vertices),color:mesh.color,alpha:mesh.alpha??1,gloss:mesh.gloss??.12,model:matrix?[...matrix]:null,cull:cullEnabled?cull:null});
}};
const scene=Object.create(TteScene.prototype);Object.assign(scene,{view,active:true,labels:{draw(){}},probe:createReferenceProbeMeshes('phased').map(m=>view.upload(m.vertices,m.color,1,m.gloss))});
for(const v of views){
 const pose=tteAtlasProbePose(frames[v.id],v,model.referenceMm,model);draws=[];
 scene.params={pose,contextModel:model,showProbe:true,showContext:true,probeLabel:v.code};
 scene.draw({basis:camera,width:600,height:600});
 cases.push({id:v.id,name:v.name,shortName:v.shortName,code:v.code,group:v.group,tableRow:v.tableRow,plane:frames[v.id],pose,draws:[...draws]});
}
for(const asset of assets)await writeFile(`${out}/${asset.file}`,Buffer.from(asset.vertices.buffer,asset.vertices.byteOffset,asset.vertices.byteLength));
const sourceHashes={};for(const name of ['public/tte-atlas-geometry.js','public/probe-scene.js','public/tee-context-geometry.js'])sourceHashes[name]=createHash('sha256').update(await readFile(name)).digest('hex');
await writeFile(`${out}/review.json`,JSON.stringify({scope:'Actual production TTE probe/chest meshes and transforms. Native orthographic review with a coarse source-heart silhouette; not a browser screenshot or clinical validation.',referenceMm:model.referenceMm,frame:model.frame,camera,bounds:model.focusBounds,sourceHashes,cases},null,2)+'\n');
console.log(JSON.stringify({views:cases.length,assets:assets.length,output:`${out}/review.json`}));
