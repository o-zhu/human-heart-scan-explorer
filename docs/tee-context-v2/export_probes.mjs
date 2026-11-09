/** Capture actual production overlay draw commands for native combined QA. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createTeeContextModel,teeContextCamera} from '../../public/tee-context-geometry.js';
import {atlasContextProbePose,TeeAtlasOverlay} from '../../public/tee-atlas-geometry.js';
import {TeeSceneOverlay} from '../../public/tee-scene.js';
import {createProbeMeshes} from '../../public/probe-scene.js';
import {TEE_ATLAS_VIEWS} from '../../public/tee-atlas-data.js';

const out=process.argv[2]||'{temporary-cache}';await mkdir(out,{recursive:true});
const model=createTeeContextModel(),catalog=JSON.parse(await readFile('public/assets/tee-atlas/plane-fit-v2.json','utf8')),basis=teeContextCamera(model,1),assets=[],assetMap=new Map();
let cull=null,cullEnabled=false,draws=[];
const gl={CULL_FACE:1,FRONT:2,BACK:3,enable(){cullEnabled=true;},disable(){cullEnabled=false;},cullFace(v){cull=v===2?'front':'back';}};
const view={gl,begin(){cullEnabled=false;cull=null;},remove(){},upload(vertices,color,alpha=1,gloss=.12){return {vertices,color,alpha,gloss};},draw(mesh,matrix){
 if(!assetMap.has(mesh.vertices)){const name=`production-${assets.length}.f32`;assetMap.set(mesh.vertices,name);assets.push({name,vertices:mesh.vertices});}
 draws.push({file:assetMap.get(mesh.vertices),color:mesh.color,alpha:mesh.alpha??1,gloss:mesh.gloss??.12,model:matrix?[...matrix]:null,cull:cullEnabled?cull:null});
}};
const overlay=Object.create(TeeSceneOverlay.prototype);overlay.view=view;overlay.head=createProbeMeshes('tee').filter((_,i)=>i!==2).map(m=>view.upload(m.vertices,m.color,1,m.gloss));
function guideContext(){
 const commands=[];let path=[];const stack=[];
 const ctx={commands,lineWidth:1,strokeStyle:'#fff',fillStyle:'#fff',font:'10px sans-serif',dash:[],
  save(){stack.push({strokeStyle:this.strokeStyle,fillStyle:this.fillStyle,font:this.font,lineWidth:this.lineWidth,dash:[...this.dash]});},restore(){Object.assign(this,stack.pop()||{});},setTransform(){},clearRect(){},setLineDash(v){this.dash=[...v];},
  beginPath(){path=[];},moveTo(x,y){path.push([x,y]);},lineTo(x,y){path.push([x,y]);},closePath(){if(path.length)path.push(path[0]);},
  fill(){commands.push({type:'fill',points:[...path],color:this.fillStyle});},stroke(){commands.push({type:'stroke',points:[...path],color:this.strokeStyle,width:this.lineWidth,dash:[...this.dash]});},
  fillRect(x,y,w,h){commands.push({type:'rect',rect:[x,y,x+w,y+h],color:this.fillStyle});},fillText(text,x,y){commands.push({type:'text',text,x,y,font:this.font,color:this.fillStyle});},measureText(text){return {width:text.length*5.5};}
 };return ctx;
}
const cases=[];
for(const id of ['me4c','me2c','tgpapillary']){
 const clinicalView=TEE_ATLAS_VIEWS.find(v=>v.id===id),plane=catalog.views[id].frame,pose=atlasContextProbePose(plane,clinicalView,model.referenceMm,model);
 draws=[];overlay.render({basis,width:800,height:800,dpr:1,pose,reference:{referenceMm:model.referenceMm,scale:1},showProbe:pose.contextFit?.resolved!==false,contextModel:model,showContext:true});
 const guide=guideContext(),meshCanvas={style:{}},guideCanvas={style:{},getContext:()=>guide};
 TeeAtlasOverlay.prototype.draw.call({plane,pose,view:clinicalView,referenceMm:model.referenceMm,running:true,mount:{hidden:false},showProbe:true,showSector:true,showContext:true,contextModel:model,key:'',meshCanvas,guideCanvas,scene:{render(){}},renderer:{canvas:{getBoundingClientRect:()=>({width:800,height:800})},camera:{yaw:0,pitch:0,roll:0,distance:1,pan:[0,0,0]},basis:()=>basis}});
 cases.push({id,name:clinicalView.name,plane,pose,basis,draws:[...draws],guide:guide.commands});
}
for(const asset of assets)await writeFile(`${out}/${asset.name}`,Buffer.from(asset.vertices.buffer,asset.vertices.byteOffset,asset.vertices.byteLength));
const sha=b=>createHash('sha256').update(b).digest('hex');
const manifest={scope:'Actual production atlasContextProbePose, TeeSceneOverlay draw order and TeeAtlasOverlay guide commands in one fixed global context camera. Native EGL review, not browser screenshots.',referenceMm:model.referenceMm,sourceHashes:{geometry:sha(await readFile('public/tee-context-geometry.js')),atlasPose:sha(await readFile('public/tee-atlas-geometry.js')),overlay:sha(await readFile('public/tee-scene.js')),planes:sha(await readFile('public/assets/tee-atlas/plane-fit-v2.json'))},cases};
await writeFile(`${out}/production-probes.json`,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({cases:cases.map(c=>({id:c.id,placement:c.pose.contextFit})),uniqueMeshes:assets.length}));
