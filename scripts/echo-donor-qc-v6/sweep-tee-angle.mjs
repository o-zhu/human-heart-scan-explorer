/** Runtime-only TEE electronic-angle sweep in the unchanged donor GI model.
 * Uses the actual production source-frame builder and acquisition solver.
 * Does not change public source, context dimensions, target planes or assets.
 *
 * node scripts/echo-donor-qc-v6/sweep-tee-angle.mjs --donor=s-20-28
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {EchoModule} from '../../public/echo.js';
import {DONORS} from '../../public/donors.js';
import {TEE_ATLAS_VIEWS} from '../../public/tee-atlas-data.js';
import {validateTeeRefinements} from '../../public/tee-view-refinement.js';
import {decodeEchoReferenceAnatomy} from '../../public/echo-anatomy-context-v2.js';
import {resolveEchoAcquisitionPlane} from '../../public/echo-acquisition-geometry.js';
import {createEchoInstrumentClearance} from '../../public/echo-instrument-clearance.js';
import {orientEchoPlaneForDisplay} from '../../public/echo-correspondence.js';
import {evaluatePlanePose,minimumCenterPreservingCorrection} from './audit.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const option=(name,fallback)=>process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3)||fallback;
const donorIds=option('donor','ladaf-2021-17,s-20-29,s-20-28').split(',');
const viewId=option('view','tgrvinout');
const angles=option('angles','0,10,20,90,100,110,120').split(',').map(Number);
const out=resolve(option('out','/dev/shm/heart-tee-angle-sweep'));
const json=async p=>JSON.parse(await readFile(join(root,p),'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const readAsset=url=>'public/'+url.replace(/^\.\//,'').split('?')[0];
const unit=v=>{const n=Math.hypot(...v);return v.map(x=>x/n);};
const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const sourceFiles=['public/echo.js','public/echo-acquisition-geometry.js','public/echo-donor-planes.js','public/echo-donor-calibration.js','public/tee-context-geometry.js','public/echo-anatomy-context-v2.js','public/echo-instrument-clearance.js','public/tee-view-refinement.js','public/tee-atlas-geometry.js'];
const getHashes=async()=>Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,sha(await readFile(join(root,file)))])));
const sourceHashes=await getHashes();
const view=TEE_ATLAS_VIEWS.find(v=>v.id===viewId);
if(!view||angles.some(a=>!Number.isFinite(a)||a<0||a>180))throw new Error('A valid TEE view and electronic angles in [0,180] are required.');
await mkdir(out,{recursive:true});
const referenceAnatomy=await decodeEchoReferenceAnatomy({
 manifestBytes:await readFile(join(root,'public/assets/probe-context-v11/manifest.json')),
 compressedBytes:await readFile(join(root,'public/assets/probe-context-v11/torso.bin.gz'))
});
const planeReview=validateTeeRefinements(await json('public/assets/tee-atlas/plane-fit-v2.json'));

for(const donorId of donorIds){
 const donor=DONORS.find(d=>d.id===donorId);if(!donor)throw new Error(`Unknown donor ${donorId}`);
 const [raw,flow,manifest]=await Promise.all([json(readAsset(donor.echoPlanesUrl)),json(readAsset(donor.flowViewsUrl)),json(readAsset(donor.manifestUrl))]);
 const referenceMm=Math.max(...manifest.sourceScaleCenterExtentUm)/1000,scale=referenceMm/168.0104;
 const baseFrames=Object.fromEntries(Object.entries(raw.frames).map(([id,f])=>[id,{...f.world,displayMirrorX:!!f.displayMirrorX,displayRotate180:!!f.displayRotate180}]));
 const e=Object.assign(Object.create(EchoModule.prototype),{donor,baseFrames,flowFrames:Object.fromEntries(flow.presets.map(p=>[p.id,p.world])),planeReview,longestMm:referenceMm,referenceAnatomy,anatomyLoadError:false,state:{mode:'tee',planeReference:'refined'}});
 e.rebuildAtlasFrames();
 const f=e.frames[viewId];if(!f)throw new Error(`Missing ${donorId}/${viewId}`);
 const source=orientEchoPlaneForDisplay({...f,center:[...f.center],right:unit(f.right),up:unit(f.up),normal:unit(f.normal),outsideScan:!!f.outsideScan},{mirrorX:f.displayMirrorX,rotate180:f.displayRotate180});
 const sourceBefore=JSON.stringify(source),context=e.anatomyContext(),clearance=createEchoInstrumentClearance(context);
 const regionalSamples=(view.group==='tg'?context.gastricInteriorSamples:context.tractSamples).filter(s=>(view.group==='tg'?['junction','tg','deep-tg']:['me']).includes(s.level));
 const sampledBounds=regionalSamples.map(s=>({level:s.level,pathIndex:s.pathIndex,pointMm:s.pointMm,
  residualMm:Math.abs(dot(sub(s.pointMm,source.center.map(v=>v*referenceMm)),source.normal)),
  radialAllowanceMm:Math.max(0,s.radialClearanceHintMm-4*scale),
  correctionAngleDeg:minimumCenterPreservingCorrection(source,s.pointMm,referenceMm).angleDeg}));
 const geometryFeasibility={sampleCount:sampledBounds.length,
  nearestSample:[...sampledBounds].sort((a,b)=>a.residualMm-b.residualMm)[0],
  minimumRotationSample:[...sampledBounds].sort((a,b)=>a.correctionAngleDeg-b.correctionAngleDeg)[0],
  exactPlaneProjectionCandidates:sampledBounds.filter(s=>s.residualMm<=s.radialAllowanceMm+1e-8).length,
  limitation:'Bounded candidate-center sample diagnostics, before full head/shaft clearance; not a proof over the continuous gastric volume.'};
 const topology=context.topology.gastrointestinal;
 const signedDistance=p=>dot(sub(p,source.center.map(v=>v*referenceMm)),source.normal);
 const summarizeMeshRegion=(firstRing,lastRing)=>{
  const first=firstRing*topology.segments,last=(lastRing+1)*topology.segments;
  const points=Array.from({length:last-first},(_,i)=>Array.from(topology.positionsMm.subarray((first+i)*3,(first+i)*3+3)));
  const distances=points.map(signedDistance),min=Math.min(...distances),max=Math.max(...distances);
  const closest=distances.reduce((best,d,i)=>Math.abs(d)<Math.abs(distances[best])?i:best,0);
  let crossingTriangles=0,totalTriangles=0;
  for(let i=0;i<topology.indices.length;i+=3){
   const ids=Array.from(topology.indices.subarray(i,i+3));if(ids.some(id=>id<first||id>=last))continue;
   const d=ids.map(id=>distances[id-first]);totalTriangles++;
   if(Math.min(...d)<=0&&Math.max(...d)>=0)crossingTriangles++;
  }
  return {firstRing,lastRing,vertices:points.length,totalTriangles,signedDistanceRangeMm:[min,max],crossingTriangles,
   disjoint:min>0||max<0,separatingPlaneGapMm:min>0?min:max<0?-max:0,closestVertexMm:points[closest],
   proof:'A linear signed-distance function attains its extrema at mesh vertices. If every vertex is strictly on one side, every wall triangle and any ring-closing planar disk remain on that side; this proves disjointness from the complete represented regional solid, not just sampled centers.'};
 };
 geometryFeasibility.meshRegions={entireGI:summarizeMeshRegion(0,topology.rings-1),entireStomach:summarizeMeshRegion(topology.joinRing,topology.rings-1)};
 geometryFeasibility.ringIntersections=[];
 for(let ring=0;ring<topology.rings;ring++){
  const range=Array.from({length:topology.segments},(_,j)=>signedDistance(Array.from(topology.positionsMm.subarray((ring*topology.segments+j)*3,(ring*topology.segments+j)*3+3))));
  if(Math.min(...range)<=0&&Math.max(...range)>=0)geometryFeasibility.ringIntersections.push({ring,level:context.tractSamples[ring]?.level,insertionCm:context.tractSamples[ring]?.insertionCm});
 }
 const contextHash=sha(Buffer.from(topology.positionsMm.buffer,topology.positionsMm.byteOffset,topology.positionsMm.byteLength));
 const rows=[];
 for(const angleDefault of angles){
  const started=performance.now();
  const accepted=resolveEchoAcquisitionPlane({plane:source,view:{...view,angleDefault},referenceMm,contextModel:context});
  const pose=accepted.acquisitionPose;
  const row={angleDefault,approach:angleDefault<=20?'standard 0–20°':angleDefault>=90&&angleDefault<=120?'mirrored alternate 90–120°':'other',poseAvailable:!!pose,solveMs:performance.now()-started};
  if(pose){
   const head=clearance(pose.instrument,scale,{fullReport:true});
   const shaft=clearance.route(pose.shaftPoints,1.8*scale,{fullReport:true});
   const metrics=evaluatePlanePose(accepted,pose,referenceMm);
   Object.assign(row,{correctionAngleDeg:accepted.acquisition.correctionAngleDeg,head,shaft,
    roiCenterUnchangedMm:Math.hypot(...sub(accepted.center,source.center))*referenceMm,
    roiCenterWithinSector:metrics.roiCenterWithinSector,roiCenterAngleDeg:metrics.roiCenterAngleFromBeamDeg,
    roiCenterRangeMm:metrics.roiCenterRangeMm,sectorDepthMm:pose.sectorDepthMm,
    maxPlaneResidualMm:metrics.maxFanVertexResidualMm,normalAngleDeg:metrics.sectorPlaneAngleDeg,
    insertionCm:pose.contextFit.insertionCm,level:pose.contextFit.level,shaftBendDeg:pose.contextFit.shaftBendDeg,
    rayTurnDeg:pose.contextFit.rayTurnDeg,sourcePlane:source,acceptedPlane:accepted,
    targets:(source.anatomyTargetsMm||[]).map(t=>({...t,acceptedResidualMm:Math.abs(dot(sub(t.pointMm,accepted.center.map(v=>v*referenceMm)),accepted.normal)),sourceResidualMm:Math.abs(dot(sub(t.pointMm,source.center.map(v=>v*referenceMm)),source.normal))}))});
  }else row.reason=accepted.acquisition?.reason;
  row.contained=!!pose&&row.head.inside&&row.head.complete&&row.shaft.inside;
  row.eligible=row.contained&&row.roiCenterWithinSector&&row.roiCenterUnchangedMm<1e-6&&row.maxPlaneResidualMm<1e-5;
  rows.push(row);
  console.log(JSON.stringify({donor:donorId,angle:angleDefault,eligible:row.eligible,rotation:row.correctionAngleDeg??null,headClearanceMm:row.head?.clearanceMm??null,shaftClearanceMm:row.shaft?.clearanceMm??null,roiAngle:row.roiCenterAngleDeg??null,solveMs:Math.round(row.solveMs)}));
 }
 if(JSON.stringify(source)!==sourceBefore)throw new Error('Acquisition sweep mutated its source plane.');
 const afterHash=sha(Buffer.from(topology.positionsMm.buffer,topology.positionsMm.byteOffset,topology.positionsMm.byteLength));
 if(afterHash!==contextHash)throw new Error('Acquisition sweep mutated fixed context geometry.');
 const eligible=rows.filter(r=>r.eligible).sort((a,b)=>a.correctionAngleDeg-b.correctionAngleDeg||b.head.clearanceMm-a.head.clearanceMm);
 const finalHashes=await getHashes(),changedFiles=Object.keys(sourceHashes).filter(k=>sourceHashes[k]!==finalHashes[k]);
 const report={schemaVersion:1,createdAt:new Date().toISOString(),donorId,viewId,referenceMm,angles,sourceHashes,changedFiles,
  contextHash,contextUnchanged:true,sourcePlaneUnchanged:true,geometryFeasibility,sourceBasis:donorId==='ladaf-2021-17'?'LADAF source-reviewed frame from plane-fit-v2':'specimen-landmark frame from buildDonorEchoFrames',
  scope:'Runtime-only nominal electronic-angle comparison; all candidates use one immutable donor context and source target. Full drawn head vertices and sampled shaft-radius containment are measured. This does not establish clinical maneuver feasibility or validate named leaflets.',
  bestAngle:eligible[0]?.angleDefault??null,bestRotationDeg:eligible[0]?.correctionAngleDeg??null,rows};
 await writeFile(join(out,`${donorId}-${viewId}.json`),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({donor:donorId,bestAngle:report.bestAngle,bestRotationDeg:report.bestRotationDeg,eligible:eligible.length,out:join(out,`${donorId}-${viewId}.json`),changedFiles}));
}
