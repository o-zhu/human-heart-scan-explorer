/** Read-only export of the exact v44 atlas geometry for reproducible QC. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildTeeAtlasFrames} from '../../public/tee-atlas-geometry.js';
import {TEE_ATLAS_VIEWS} from '../../public/tee-atlas-data.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const original=read('public/assets/echo-planes.json');
const flow=read('public/assets/flow-views-v5.json');
const existing=Object.fromEntries(Object.entries(original.frames).map(([id,p])=>[id,{...p.world,displayMirrorX:p.displayMirrorX===true,displayRotate180:p.displayRotate180===true}]));
const frames=buildTeeAtlasFrames(existing,TEE_ATLAS_VIEWS,{flowFrames:Object.fromEntries(flow.presets.map(p=>[p.id,p.world]))});
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=a=>a.map(v=>v/Math.hypot(...a));
const presented=f=>{
 const r=f.right.map(v=>v*(!!f.displayMirrorX!==!!f.displayRotate180?-1:1)),u=f.up.map(v=>v*(f.displayRotate180?-1:1));
 return {...f,right:r,up:u,normal:norm(cross(r,u)),displayMirrorX:false,displayRotate180:false};
};
const data={schemaVersion:1,revision:'v44-baseline',datasetId:'1659197537',sourceCommit:'5761089d06cae66da76445565999307a0612d184',views:Object.fromEntries(TEE_ATLAS_VIEWS.map(v=>[v.id,{id:v.id,name:v.name,aseNumber:v.aseNumber,group:v.group,frame:presented(frames[v.id]),rawFrame:frames[v.id],angles:v.angles,anatomy:v.anatomy}]))};
const out=path.join(root,'docs/tee-plane-qc-v2/baselines.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(data,null,2)+'\n');
console.log(`Exported ${Object.keys(data.views).length} immutable baseline views`);
