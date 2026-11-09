/** Compare LADAF AV SAX target levels in the actual source volume. Runtime
 * only: no production frame, body mesh, source pixel or clinical label edits.
 * Output is input for sample-caps.mjs (the actual production MPR worker).
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {EchoModule} from '../../public/echo.js';
import {DONORS} from '../../public/donors.js';
import {TTE_ATLAS_VIEWS} from '../../public/tte-atlas-data.js';
import {validateTeeRefinements} from '../../public/tee-view-refinement.js';
import {decodeEchoReferenceAnatomy} from '../../public/echo-anatomy-context-v2.js';
import {resolveEchoAcquisitionPlane} from '../../public/echo-acquisition-geometry.js';
import {evaluatePlanePose} from './audit.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const out=resolve(process.argv[2]||'/dev/shm/ladaf-av-inspection');
const json=async p=>JSON.parse(await readFile(join(root,p),'utf8'));
const asset=url=>'public/'+url.replace(/^\.\//,'').split('?')[0];
const sha=b=>createHash('sha256').update(b).digest('hex');
const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(v,s)=>v.map(x=>x*s);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),length=v=>Math.hypot(...v),unit=v=>mul(v,1/length(v));
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const sourceToWorld=([x,y,z])=>[(x-237)/529,(z-264.5)/529,(237-y)/529];
const worldToSource=([x,y,z])=>[237+x*529,237-z*529,264.5+y*529];
const planeOnly=f=>Object.fromEntries(['center','right','up','normal','width','height'].map(k=>[k,Array.isArray(f[k])?[...f[k]]:f[k]]));
const files=['public/echo.js','public/tte-atlas-geometry.js','public/echo-acquisition-geometry.js','public/tee-context-geometry.js','public/assets/tee-atlas/plane-fit-v2.json','public/assets/manifest.json','public/mpr-worker.js'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async f=>[f,sha(await readFile(join(root,f)))])));
const before=await hashes(),donor=DONORS[0];
const [raw,flow,manifest,reviewFile,native]=await Promise.all([json(asset(donor.echoPlanesUrl)),json(asset(donor.flowViewsUrl)),json(asset(donor.manifestUrl)),json('public/assets/tee-atlas/plane-fit-v2.json'),json('docs/echo-donor-qc-v6/native/ladaf-2021-17/review.json')]);
const referenceMm=Math.max(...manifest.sourceScaleCenterExtentUm)/1000;
const referenceAnatomy=await decodeEchoReferenceAnatomy({manifestBytes:await readFile(join(root,'public/assets/probe-context-v11/manifest.json')),compressedBytes:await readFile(join(root,'public/assets/probe-context-v11/torso.bin.gz'))});
const e=Object.assign(Object.create(EchoModule.prototype),{donor,baseFrames:Object.fromEntries(Object.entries(raw.frames).map(([id,f])=>[id,{...f.world,displayMirrorX:!!f.displayMirrorX,displayRotate180:!!f.displayRotate180}])),flowFrames:Object.fromEntries(flow.presets.map(p=>[p.id,p.world])),planeReview:validateTeeRefinements(reviewFile),longestMm:referenceMm,referenceAnatomy,anatomyLoadError:false,state:{mode:'tte',planeReference:'refined'}});
e.rebuildAtlasFrames();
const context=e.anatomyContext(),view=TTE_ATLAS_VIEWS.find(v=>v.id==='psax_av');
const current=Object.fromEntries(native.acceptedViews.map(c=>[c.id,c]));
const points={reviewedRootCenter:[242.5,252,235],proximalRootTrack:[244,253,238],rootTrack225:[239,254,225],upstreamTrack205:[224,264,205],lvotFocus:[260,265,270]};
const worldPoints=Object.fromEntries(Object.entries(points).map(([id,p])=>[id,sourceToWorld(p)]));
const rootCenter=worldPoints.reviewedRootCenter;
const diagnostics=plane=>({centerSourceXYZ:worldToSource(plane.center),targetResidualMm:Object.fromEntries(Object.entries(worldPoints).map(([id,p])=>[id,Math.abs(dot(sub(p,plane.center),plane.normal))*referenceMm]))});
const cases=[];
for(const id of ['psax_av','psax_av_zoom','psax_great','meavsax']){
 const plane=planeOnly(current[id].plane);
 cases.push({id:`current-${id}`,plane,outsideScan:false,construction:'Current frozen production acquired section',diagnostics:diagnostics(plane)});
}
const reviewed=e.frames.meavsax;
const orientAsTte=(source,width=.70)=>{
 const normal=unit(source.normal),right=unit(sub(e.frames.psax_av.right,mul(normal,dot(e.frames.psax_av.right,normal)))),up=unit(cross(normal,right));
 return {...planeOnly(source),normal,right,up,width,height:width,preferSourcePlane:true,sourceTargetRevision:'runtime-reviewed-av-sax-investigation'};
};
const candidates=[];
for(const offsetMm of [-3,0,3,6]){
 const source=orientAsTte({...reviewed,center:add(reviewed.center,mul(unit(reviewed.normal),offsetMm/referenceMm))});
 candidates.push({id:`reviewed-root-offset-${offsetMm<0?'minus'+Math.abs(offsetMm):offsetMm}`,plane:source,construction:`Reviewed source root plane offset ${offsetMm} mm along its superior/outflow-facing normal; exact source fit requested`});
}
const great=planeOnly(current.psax_great.plane);
const greatRootProjection=sub(rootCenter,mul(great.normal,dot(sub(rootCenter,great.center),great.normal)));
candidates.push({id:'great-accepted-root-projection',plane:orientAsTte({...great,center:greatRootProjection}),construction:'Exact accepted PSAX great-vessel physical plane; ROI recentered in-plane at the reviewed root-center projection'});
for(const candidate of candidates){
 const accepted=resolveEchoAcquisitionPlane({plane:candidate.plane,view,referenceMm,contextModel:context});
 const pose=accepted.acquisitionPose,metrics=pose?evaluatePlanePose(accepted,pose,referenceMm):null;
 cases.push({...candidate,id:candidate.id+'-source',outsideScan:false,diagnostics:diagnostics(candidate.plane)});
 cases.push({id:candidate.id+'-acquired',plane:accepted,outsideScan:false,construction:'Actual production TTE acquisition solver with source preservation enabled',diagnostics:diagnostics(accepted),poseAvailable:!!pose,rotationDeg:accepted.acquisition?.correctionAngleDeg,centerShiftMm:length(sub(accepted.center,candidate.plane.center))*referenceMm,contextFit:pose?.contextFit,metrics});
 cases.push({id:candidate.id+'-zoom',plane:{...planeOnly(accepted),width:.37,height:.37},outsideScan:false,construction:'Same acquired physical source plane, closer AV crop',diagnostics:diagnostics(accepted)});
 console.log(JSON.stringify({candidate:candidate.id,rotation:accepted.acquisition?.correctionAngleDeg,poseAvailable:!!pose,markerDeviationDeg:pose?.contextFit?.markerAgreementDeg,skinTriangle:pose?.contextFit?.skinTriangleIndex,roiInside:metrics?.roiCenterWithinSector,center:worldToSource(accepted.center)}));
}
const after=await hashes(),changedFiles=files.filter(f=>before[f]!==after[f]);
await mkdir(out,{recursive:true});
await writeFile(join(out,'review.json'),JSON.stringify({schemaVersion:1,createdAt:new Date().toISOString(),donor:donor.id,sourceManifest:asset(donor.manifestUrl),referenceMm,sourceHashes:before,changedFiles,currentExportSha256:native.exportSha256,scope:'Measured source target-level comparison. Preserves source data and fixed reference chest. No individual cusp label or clinical validation is implied.',pointsSourceXYZ:points,pointProvenance:['public/assets/tee-atlas/plane-fit-v2.json meavsax: independently source-reviewed three-sinus/cusp neighborhood center [242.5,252,235], individual cusp labels/annular dimensions unvalidated','docs/anatomy/cavity-tracks.json track5: approximate proximal aortic centers [244,253,238],[239,254,225],[224,264,205]','public/assets/flow-views-v5.json lv-outflow: longitudinal LVOT/cusp focus [260,265,270], not a segmented valve-center ground truth'],cases},null,2)+'\n');
console.log(JSON.stringify({out,cases:cases.length,changedFiles}));
