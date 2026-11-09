/** Exact production pose, acoustic model and instrument meshes for native QA. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {TEE_PRESETS,createTeeReference,sanitizeTeeState,teePose,teePresetState} from '../../public/tee-geometry.js';
import {TeeLabModule} from '../../public/tee-lab.js';
import {TeeSceneOverlay} from '../../public/tee-scene.js';
import {createProbeMeshes} from '../../public/probe-scene.js';
import {volumeGeometry,beamPoint,projectProbePoint} from '../../public/probe-geometry.js';
import {computeProbeFrame,probeFrameQuality} from '../../public/probe-acoustics.js';
import {VolumeRenderer} from '../../public/renderer.js';
import {capColor} from '../../public/render-styles.js';
import {DONORS} from '../../public/donors.js';

const out=resolve(process.argv[2]||'/workspace/data/tee-lab-v26/render');await mkdir(out,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const donor=DONORS[0],manifest=JSON.parse(await readFile('public/assets/manifest.json','utf8')),meta=manifest.levels.high,geometry=volumeGeometry(meta),data=new Uint8Array(meta.dimensions.reduce((a,b)=>a*b,1)),source=[];
let offset=0;
for(const part of meta.parts){
 const compressed=await readFile(join('public',part.url));if(sha(compressed)!==part.sha256)throw new Error('Source checksum mismatch');
 const raw=gunzipSync(compressed);if(raw.length!==part.uncompressedBytes)throw new Error('Decoded source length mismatch');
 if(part.predictor==='delta-z'){const plane=meta.dimensions[0]*meta.dimensions[1];for(let i=plane;i<raw.length;i++)raw[i]=(raw[i]+raw[i-plane])&255;}
 if(sha(raw)!==part.rawSha256)throw new Error('Decoded source checksum mismatch');
 data.set(raw,offset);offset+=raw.length;source.push({url:part.url,sha256:part.sha256,decodedSha256:part.rawSha256,bytes:raw.length});
}
const cleanup=JSON.parse(await readFile('public/assets/cleanup/manifest.json','utf8')),support={data:new Uint8Array(gunzipSync(await readFile(join('public',cleanup.volumeUrl)))),dimensions:cleanup.dimensions};
const raw=JSON.parse(await readFile('public/assets/echo-planes.json','utf8')),frames=Object.fromEntries(Object.entries(raw.frames).map(([k,v])=>[k,v.world])),reference=createTeeReference(frames,geometry.longestMm);
const cases=TEE_PRESETS.map(p=>({id:p.id,label:p.label,state:teePresetState(p.id,sanitizeTeeState(),reference)}));
cases.push({id:'steered',label:'Turned + flexed + multiplane',state:sanitizeTeeState({...cases[0].state,insertionCm:36.2,shaftRotationDeg:18,anteflexDeg:16,lateralFlexDeg:-9,multiplaneDeg:55})});
const head=createProbeMeshes('tee').filter((_,i)=>i!==2),settings={palette:4,threshold:.28,capContrast:1.8,...donor.displayWindow};
for(const item of cases){
 const pose=teePose(item.state,reference),request={id:1,version:1,poseRevision:1,pose,state:item.state,cleanupEnabled:true,fineSpacingUm:79.4,fast:false,...probeFrameQuality(item.state,640)};
 const result=await computeProbeFrame({data,meta,dimensions:meta.dimensions,geometry,support},request);if(!result)throw new Error('No computed source frame');
 const colored=new Uint8Array(result.ct.length*3),gray=new Uint8Array(result.ultrasound.length*3);
 for(let i=0;i<result.ct.length;i++){
  const v=result.ct[i],color=v&&v/255>=settings.threshold?capColor(v/255,settings.capContrast,settings.palette,settings):[0,0,0];
  for(let k=0;k<3;k++){colored[i*3+k]=Math.round(Math.pow(Math.max(0,color[k]),.89)*255);gray[i*3+k]=result.ultrasound[i];}
 }
 for(const [suffix,bytes] of [['cap.raw',result.cap],['ct.rgb',colored],['us.rgb',gray]])await writeFile(join(out,`${item.id}-${suffix}`),bytes);
 const renderer=Object.create(VolumeRenderer.prototype);Object.assign(renderer,{camera:{yaw:0,pitch:0,roll:0,distance:2,pan:[0,0,0]},canvas:{getBoundingClientRect:()=>({width:600,height:660})},onChange(){},requestRender(){}});
 TeeLabModule.prototype.orientCamera.call({active:true,geometry,state:item.state,renderer,getPose:()=>pose,drawGuide(){}},'explore');const basis=renderer.basis();
 const meshes=[],view={begin(){},remove(){},upload(vertices,color,alpha=1,gloss=.1){return {vertices,color,alpha,gloss};},draw(mesh,model){meshes.push({...mesh,vertices:Array.from(mesh.vertices),model:model?Array.from(model):null});}};
 TeeSceneOverlay.prototype.render.call({view,head},{basis,width:600,height:660,dpr:1,pose,reference,showProbe:true});
 const project=p=>projectProbePoint(p.map(x=>x/geometry.longestMm),basis,600,660),half=item.state.angleDeg*Math.PI/360;
 item.pose=pose;item.plane=result.plane;item.basis=basis;item.meshes=meshes;item.sector=Array.from({length:49},(_,i)=>project(beamPoint(pose,-half+i*2*half/48,item.state.depthMm)));item.origin=project(pose.originMm);item.path=reference.pathPoints.map(project);
 item.width=result.width;item.height=result.height;item.capWidth=result.capWidth;item.capHeight=result.capHeight;item.capSpacingUm=result.capSpacingUm;item.capSha256=sha(result.cap);item.stats=result.stats;
 console.log(JSON.stringify({id:item.id,tissueFraction:result.stats.tissueFraction,sourceSpacingUm:result.stats.sourceSpacingUm,capSpacingUm:result.capSpacingUm}));
}
await writeFile(join(out,'fixture.json'),JSON.stringify({scope:'Production CT and acoustic frames from hash-verified 317.6 µm display data; genuine preview, not an Ultra-resolution rendering.',source,meta,cleanup,settings,referenceMm:geometry.longestMm,cases}));
