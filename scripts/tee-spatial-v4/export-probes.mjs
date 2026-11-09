/** Native scientific review inputs; no browser or source-volume mutation. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {TEE_ATLAS_VIEWS as views} from '../../public/tee-atlas-data.js';
import {buildTeeAtlasFrames,atlasContextProbePose} from '../../public/tee-atlas-geometry.js';
import {applyTeeRefinements,validateTeeRefinements} from '../../public/tee-view-refinement.js';
import {createTeeContextModel} from '../../public/tee-context-geometry.js';
import {createProbeMeshes} from '../../public/probe-scene.js';
import {TeeSceneOverlay} from '../../public/tee-scene.js';
import {add,mul,norm,cross} from '../../public/planes.js';

const out=process.argv[2]||'/tmp/tee-spatial-v4';await mkdir(out,{recursive:true});
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const raw=await json('public/assets/echo-planes.json');
const base=Object.fromEntries(Object.entries(raw.frames).map(([id,f])=>[id,{...f.world,displayMirrorX:!!f.displayMirrorX,displayRotate180:!!f.displayRotate180}]));
const flow=Object.fromEntries((await json('public/assets/flow-views-v5.json')).presets.map(p=>[p.id,p.world]));
const catalog=validateTeeRefinements(await json('public/assets/tee-atlas/plane-fit-v2.json'));
const frames=applyTeeRefinements(buildTeeAtlasFrames(base,views,{flowFrames:flow}),catalog,{datasetId:'1659197537'});
const model=createTeeContextModel({frames:base,referenceMm:168.0104,donorId:'1659197537'});
const forward=norm(add(model.frame.anterior,add(mul(model.frame.left,-.45),mul(model.frame.superior,-.12))));
const right=norm(cross(forward,model.frame.superior)),up=norm(cross(right,forward)),camera={forward,right,up};
const assets=[],assetMap=new Map(),cases=[];let draws=[],cull=null,cullEnabled=false;
const gl={CULL_FACE:1,FRONT:2,BACK:3,enable(){cullEnabled=true;},disable(){cullEnabled=false;},cullFace(v){cull=v===2?'front':'back';}};
const view={gl,begin(){cullEnabled=false;cull=null;},remove(){},upload(vertices,color,alpha=1,gloss=.12){return {vertices,color,alpha,gloss};},draw(mesh,matrix){
 if(!assetMap.has(mesh.vertices)){const file=`geometry-${assets.length}.f32`;assetMap.set(mesh.vertices,file);assets.push({file,vertices:mesh.vertices});}
 draws.push({file:assetMap.get(mesh.vertices),color:mesh.color,alpha:mesh.alpha??1,gloss:mesh.gloss??.12,model:matrix?[...matrix]:null,cull:cullEnabled?cull:null});
}};
const scene=Object.create(TeeSceneOverlay.prototype);scene.view=view;scene.head=createProbeMeshes('tee').filter((_,i)=>i!==2).map(m=>view.upload(m.vertices,m.color,1,m.gloss));
for(const v of views){
 const pose=atlasContextProbePose(frames[v.id],v,model.referenceMm,model);draws=[];
 scene.drawGeometry({basis:camera,width:600,height:600,dpr:1,pose,reference:{referenceMm:model.referenceMm,scale:1},showProbe:true,contextModel:model,showContext:true});
 cases.push({id:v.id,name:v.name,shortName:v.shortName,code:v.code,group:v.group,aseNumber:v.aseNumber,plane:frames[v.id],pose,draws:[...draws]});
}
for(const asset of assets)await writeFile(`${out}/${asset.file}`,Buffer.from(asset.vertices.buffer,asset.vertices.byteOffset,asset.vertices.byteLength));
const sha=b=>createHash('sha256').update(b).digest('hex');
const sourceHashes={};for(const name of ['public/tee-atlas-geometry.js','public/tee-scene.js','public/probe-scene.js','public/tee-context-geometry.js','public/assets/tee-atlas/plane-fit-v2.json'])sourceHashes[name]=sha(await readFile(name));
await writeFile(`${out}/review.json`,JSON.stringify({scope:'Actual production poses, head/shaft/organ meshes and transforms. The follow-up native renderer uses an orthographic camera and a coarse source-heart silhouette for positional inspection; not a browser screenshot or clinical validation.',referenceMm:model.referenceMm,frame:model.frame,camera,bounds:model.bounds,sourceHashes,cases},null,2)+'\n');
console.log(JSON.stringify({views:cases.length,assets:assets.length,output:`${out}/review.json`}));
