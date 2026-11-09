/** Numerical evidence / optional native-render export. No build or publication.
 * `node scripts/echo-anatomy-context-v2/export-models.mjs`
 * `node scripts/echo-anatomy-context-v2/export-models.mjs --mesh-out=/tmp/echo-body-v2`
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {createTeeContextModel,teeContextToLocal} from '../../public/tee-context-geometry.js';
import {createTteContextModel} from '../../public/tte-atlas-geometry.js';
import {
 ECHO_REFERENCE_ANATOMY,ECHO_BODY_CROP,ECHO_ANATOMY_CONTEXT_REVISION,
 decodeEchoReferenceAnatomy,createEchoAnatomyContext,bodyReferenceToWorld,worldToBodyReference,
} from '../../public/echo-anatomy-context-v2.js';

const root=fileURLToPath(new URL('../../',import.meta.url));
const output=join(root,'docs/echo-anatomy-context-v2');
const arg=process.argv.find(v=>v.startsWith('--mesh-out='));
const meshOut=arg?resolve(arg.slice('--mesh-out='.length)):null;
const read=name=>readFileSync(join(root,name));
const json=name=>JSON.parse(read(name));
const hash=data=>createHash('sha256').update(data).digest('hex');
const bytes=a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0);
const norm=v=>Math.hypot(...v);
const manifestBytes=read('public/assets/probe-context-v11/manifest.json');
const compressedBytes=read('public/assets/probe-context-v11/torso.bin.gz');
const reference=await decodeEchoReferenceAnatomy({manifestBytes,compressedBytes});

// The combined reference-heart mesh is used only for an explicitly geometric
// placement check. It is never exported as a displayed model or patient data.
const sourceManifest=JSON.parse(manifestBytes),entry=sourceManifest.meshes.find(m=>m.name==='heart');
const decoded=gunzipSync(compressedBytes,{maxOutputLength:ECHO_REFERENCE_ANATOMY.decodedBytes});
const data=new DataView(decoded.buffer,decoded.byteOffset,decoded.byteLength),unique=new Map();
for(let i=0;i<entry.count;i++){
 const p=[0,1,2].map(k=>data.getFloat32(entry.offset+(i*6+k)*4,true));
 unique.set(p.join(','),p);
}
const direction=[.55,-.48,.63],patch=[...unique.values()].sort((a,b)=>dot(b,direction)-dot(a,direction)).slice(0,12);
const apicalPatch=[0,1,2].map(i=>patch.reduce((n,p)=>n+p[i],0)/patch.length);
const report={
 revision:ECHO_ANATOMY_CONTEXT_REVISION,
 scope:'Numerical verification of existing BodyParts3D bytes, one fixed transform and production context meshes. Not clinical registration or browser rendering evidence.',
 source:{manifestSha256:hash(manifestBytes),compressedSha256:hash(compressedBytes),decodedSha256:hash(decoded),compressedBytes:compressedBytes.length,decodedBytes:decoded.length},
 bodyCrop:ECHO_BODY_CROP,
 referenceHeart:{displayed:false,referenceCenter:ECHO_REFERENCE_ANATOMY.referenceOriginMm,geometricApicalPatch:apicalPatch,patchMethod:'Mean of twelve unique mesh vertices with greatest projection along fixed [0.55,-0.48,0.63]; a geometric support patch, not an annotated anatomical apex.',bounds:reference.heartReferenceBounds},
 donors:[],
};
const cases=[['ladaf-2021-17','public/assets/echo-planes.json',168.0104],['s-20-28','public/assets/donors/s-20-28/echo-planes.json'],['s-20-29','public/assets/donors/s-20-29/echo-planes.json']];
for(const [donorId,path,fallback]of cases){
 const source=json(path),frames=Object.fromEntries(Object.entries(source.frames).map(([id,v])=>[id,v.world]));
 const options={donorId,frames,referenceMm:source.referenceMm||fallback};
 const baseTte=createTteContextModel(options),baseTee=createTeeContextModel(options);
 const models={tte:createEchoAnatomyContext({baseModel:baseTte,referenceAnatomy:reference,frames}),tee:createEchoAnatomyContext({baseModel:baseTee,referenceAnatomy:reference,frames})};
 const tte=models.tte,tee=models.tee;
 const bodyHash=model=>hash(Buffer.concat(model.meshes.filter(m=>m.id.startsWith('bodyparts3d-')).map(m=>bytes(m.vertices))));
 const donor={donorId,frame:tte.frame,transform:tte.bodyTransform,bodyMeshHashes:{tte:bodyHash(tte),tee:bodyHash(tee)},sameBodyAcrossModes:bodyHash(tte)===bodyHash(tee),teeTractIdentityUnchanged:tee.tractSamples===baseTee.tractSamples,teeGastricSamplesIdentityUnchanged:tee.gastricInteriorSamples===baseTee.gastricInteriorSamples,focusReferenceBounds:tte.focusReferenceBounds,focusPointsMm:tte.focusPointsMm,windows:tte.bodyWindows,models:{}};
 if(tte.frame.landmarksMm.apex){
  donor.placementCheck={donorApexLocalMm:teeContextToLocal(tte.frame.landmarksMm.apex,tte.frame),referencePatchLocalMm:sub(apicalPatch,ECHO_REFERENCE_ANATOMY.referenceOriginMm),distanceMm:norm(sub(bodyReferenceToWorld(apicalPatch,tte),tte.frame.landmarksMm.apex)),clinicalRegistration:false};
 }
 for(const [mode,model]of Object.entries(models)){
  const meshes=model.meshes.map(m=>{
   let normalError=0;
   for(let i=0;i<m.vertices.length;i+=6)normalError=Math.max(normalError,Math.abs(norm(Array.from(m.vertices.subarray(i+3,i+6)))-1));
   return {id:m.id,triangles:m.vertices.length/18,bytes:m.vertices.byteLength,sha256:hash(bytes(m.vertices)),maximumNormalLengthError:normalError,color:m.color,alpha:m.alpha,gloss:m.gloss,bounds:m.bounds,role:m.role};
  });
  donor.models[mode]={meshCount:meshes.length,triangles:meshes.reduce((n,m)=>n+m.triangles,0),meshes};
  if(meshOut){
   const folder=join(meshOut,donorId,mode);mkdirSync(folder,{recursive:true});
   meshes.forEach((m,i)=>{m.file=m.id+'.f32';writeFileSync(join(folder,m.file),bytes(model.meshes[i].vertices));});
   writeFileSync(join(folder,'model.json'),JSON.stringify({donorId,mode,revision:model.revision,referenceMm:model.referenceMm,frame:model.frame,bodyTransform:model.bodyTransform,bodyWindows:model.bodyWindows,meshes,labels:model.labels,focusPointsMm:model.focusPointsMm,focusBounds:model.focusBounds,bounds:model.bounds,provenance:model.provenance},null,2)+'\n');
  }
 }
 donor.maximumRoundTripErrorMm=Math.max(...Object.values(tte.bodyWindows).map(w=>norm(sub(worldToBodyReference(w.anchorMm,tte),w.referenceAnchorMm))));
 report.donors.push(donor);
}
mkdirSync(output,{recursive:true});
writeFileSync(join(output,'geometry-verification.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({verified:true,report:'docs/echo-anatomy-context-v2/geometry-verification.json',donors:report.donors.map(d=>({id:d.donorId,sameBodyAcrossModes:d.sameBodyAcrossModes,teeTractIdentityUnchanged:d.teeTractIdentityUnchanged,triangles:Object.fromEntries(Object.entries(d.models).map(([k,v])=>[k,v.triangles]))})),meshOut}));
