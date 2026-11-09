/** Export actual TEE Lab poses/camera/guide and fitted skeleton draw lists for EGL QC. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {TeeLabModule} from '../../../public/tee-lab.js';
import {TEE_PRESETS,teePresetState,sanitizeTeeState} from '../../../public/tee-geometry.js';
import {TeeSceneOverlay} from '../../../public/tee-scene.js';
import {probeCapPlane,volumeGeometry} from '../../../public/probe-geometry.js';
import {VolumeRenderer,volumeShaderSources} from '../../../public/renderer.js';
import {sharedGeometryShaderSources,createProbeMeshes} from '../../../public/probe-scene.js';
import {DONORS} from '../../../public/donors.js';
const root=fileURLToPath(new URL('../../../',import.meta.url)),pub=new URL('../../../public/',import.meta.url);
const arg=(key,fallback)=>process.argv.find(v=>v.startsWith(`--${key}=`))?.slice(key.length+3)||fallback;
const donor=DONORS.find(d=>d.id===arg('donor','ladaf-2021-17')),out=resolve(arg('out','/dev/shm/tee-skeleton-v43'));
const width=640,height=560,sha=b=>createHash('sha256').update(b).digest('hex'),read=p=>readFile(join(root,p));
const {parseHTML}=await import(pathToFileURL(arg('dom',process.env.HEART_DOM_MODULE)));
const {document,window}=parseHTML('<html><body><section id="teePanel"></section></body></html>');
Object.assign(globalThis,{document,window,ResizeObserver:class{observe(){}},requestAnimationFrame:()=>1,cancelAnimationFrame(){},fetch:async url=>new Response(await readFile(new URL(url,pub)))});
const sourceManifest='public/'+donor.manifestUrl.replace(/^\.\//,''),manifest=JSON.parse(await read(sourceManifest));
const geometry=volumeGeometry(manifest.levels.high),referenceMm=geometry.longestMm;
const renderer=Object.assign(Object.create(VolumeRenderer.prototype),{canvas:{getBoundingClientRect:()=>({left:0,top:0,width,height})},settings:{palette:4,cleanupEnabled:true},camera:{yaw:.32,pitch:.12,roll:Math.PI,distance:1.65,pan:[0,0,0]},requestRender(){},onChange(){},getContextOcclusion(){return null;}});
const module=new TeeLabModule({renderer,mount:document.getElementById('teePanel'),donor});
module.geometry=geometry;module.state=sanitizeTeeState({...module.state,referenceMm});await module.init();await module.loadSkeleton();if(!module.referenceAnatomy)throw module.skeletonLoadError||new Error('Verified skeleton missing');
module.active=true;module.mount.querySelector('#teeViewportMount').getBoundingClientRect=()=>({left:0,top:0,width,height});
const assetMap=new Map(),meshInfo=new Map();
for(const m of module.displayAnatomyContext().meshes)meshInfo.set(m.vertices,{id:m.id,role:m.role||'context'});
let draws=[],guides=[],path=[],closed=false,dash=[],cull=null,cullEnabled=false,depthRange=[0,1],depthWrite=true;
const gl={CULL_FACE:1,FRONT:2,BACK:3,DEPTH_TEST:4,LEQUAL:5,enable(cap){if(cap===1)cullEnabled=true;},disable(cap){if(cap===1)cullEnabled=false;},cullFace(v){cull=v===2?'front':'back';},depthFunc(){},depthRange(a,b){depthRange=[a,b];},depthMask(v){depthWrite=!!v;}};
const view={gl,begin(){cull=null;cullEnabled=false;depthRange=[0,1];depthWrite=true;},remove(){},upload(vertices,color,alpha=1,gloss=.12){return {vertices,color,alpha,gloss};},draw(mesh,matrix){
 const bytes=Buffer.from(mesh.vertices.buffer,mesh.vertices.byteOffset,mesh.vertices.byteLength),hash=sha(bytes),file=`geometry-${hash.slice(0,20)}.f32`;
 if(!assetMap.has(hash))assetMap.set(hash,{file,sha256:hash,bytes:bytes.length,data:bytes});
 draws.push({file,sha256:hash,color:mesh.color,alpha:mesh.alpha,gloss:mesh.gloss,model:matrix?[...matrix]:null,cull:cullEnabled?cull:null,depthRange:[...depthRange],depthWrite,...meshInfo.get(mesh.vertices)});
}};
const scene=Object.assign(Object.create(TeeSceneOverlay.prototype),{view,sharedDepth:true,head:createProbeMeshes('tee').filter((_,i)=>i!==2).map(m=>view.upload(m.vertices,m.color,1,m.gloss))});
module.sceneOverlay={sharedDepth:true,render(params){scene.drawGeometry(params);}};
const ctx={setTransform(){},clearRect(){},beginPath(){path=[];closed=false;},moveTo(x,y){path.push([x,y]);},lineTo(x,y){path.push([x,y]);},closePath(){closed=true;},setLineDash(v){dash=[...v];},fill(){guides.push({kind:'fill',points:path.map(p=>[...p]),closed,color:this.fillStyle});},stroke(){guides.push({kind:'stroke',points:path.map(p=>[...p]),closed,color:this.strokeStyle,width:this.lineWidth||1,dash:[...dash]});}};
module.$('guide').getContext=()=>ctx;
const cases=[];
for(const preset of TEE_PRESETS){
 module.state=teePresetState(preset.id,module.state,module.reference());module.ensureOrigin();const pose=module.getPose(),plane=probeCapPlane(pose,geometry);
 module.displayedFrame={id:cases.length,pose,state:structuredClone(module.state),plane,poseRevision:cases.length};module.orientCamera('explore');
 const camera={basis:renderer.basis(),state:structuredClone(renderer.camera)},drawsByCamera={},guidesByCamera={};
 for(const [key,visible]of [['on',true],['off',false]]){
  module.state.showSkeleton=visible;module.guideKey='';draws=[];guides=[];module.drawGuide();drawsByCamera[key]=[...draws];guidesByCamera[key]=[...guides];
 }
 cases.push({id:preset.id,mode:'tee',name:preset.label,code:preset.id.toUpperCase(),plane,capPlane:plane,pose,state:module.displayedFrame.state,clipFlip:module.state.flip?1:0,outsideScan:false,poseAvailable:true,cameras:{on:camera,off:camera},drawsByCamera,guidesByCamera});
 module.state.showSkeleton=true;
}
await mkdir(out,{recursive:true});for(const asset of assetMap.values())await writeFile(join(out,asset.file),asset.data);
const sourceFiles=['public/tee-lab.js','public/tee-geometry.js','public/tee-scene.js','public/tee-context-geometry.js','public/tee-context-presets.js','public/tee-view-refinement.js','public/echo-donor-planes.js','public/echo-anatomy-context-v2.js','public/echo-skeleton-fit.js','public/echo-context-presentation.js','public/renderer.js','public/probe-scene.js','public/probe-lab.js','public/probe-geometry.js','public/planes.js','public/mpr-worker.js','scripts/lab-context-v43/tee/export.mjs','scripts/lab-context-v43/tee/render.py','scripts/echo-face-v42/render_gallery.py','scripts/echo-face-v42/sample-caps.mjs',sourceManifest];
const sourceHashes={};for(const file of sourceFiles)sourceHashes[file]=sha(await read(file));
const review={schemaVersion:3,createdAt:new Date().toISOString(),donor:donor.id,referenceMm,extent:geometry.extent,width,height,sourceManifest,sourceHashes,models:{tee:{revision:module.displayAnatomyContext().revision,frame:module.anatomyContext().frame,provenance:module.displayAnatomyContext().provenance}},scope:'Actual production TEE Lab camera, calibrated probe, complete source-box CT cap and fixed Echo skeleton. Resident-source native spatial/occlusion QC, not browser, fresh fine source or clinical validation.',assets:[...assetMap.values()].map(({data,...rest})=>rest),cases};
await writeFile(join(out,'review.json'),JSON.stringify(review,null,2)+'\n');await writeFile(join(out,'shaders.json'),JSON.stringify({volume:volumeShaderSources,geometry:sharedGeometryShaderSources})+'\n');
console.log(JSON.stringify({donor:donor.id,cases:cases.length,out}));
