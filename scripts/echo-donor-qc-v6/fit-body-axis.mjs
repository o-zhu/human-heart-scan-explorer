/** Compare fixed illustrative frames against actual apical skin contact and
 * a fully contained ME4C instrument. This never modifies the source or model. */
import {readFile,writeFile} from 'node:fs/promises';
import {getEchoDonorCalibration} from '../../public/echo-donor-calibration.js';
import {buildDonorEchoFrames} from '../../public/echo-donor-planes.js';
import {decodeEchoReferenceAnatomy,createEchoAnatomyContext} from '../../public/echo-anatomy-context-v2.js';
import {createTteContextModel} from '../../public/tte-atlas-geometry.js';
import {createTeeContextModel} from '../../public/tee-context-geometry.js';
import {TTE_ATLAS_VIEWS} from '../../public/tte-atlas-data.js';
import {TEE_ATLAS_VIEWS} from '../../public/tee-atlas-data.js';
import {resolveEchoAcquisitionPlane} from '../../public/echo-acquisition-geometry.js';
const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(v,n)=>v.map(x=>x*n),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const unit=v=>mul(v,1/Math.hypot(...v)),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const off=(v,n)=>sub(v,mul(n,dot(v,n)));
const referenceAnatomy=await decodeEchoReferenceAnatomy({manifestBytes:await readFile('public/assets/probe-context-v11/manifest.json'),compressedBytes:await readFile('public/assets/probe-context-v11/torso.bin.gz')});
const records=[];
for(const donorId of ['s-20-28','s-20-29']){
 const c=getEchoDonorCalibration(donorId),L=c.landmarksMm,referenceMm=c.referenceMm,frames=buildDonorEchoFrames({},{donorId});
 const along=unit(sub(L.apex,L.mitralRegion)),lateral=unit(off(sub(L.mitralRegion,L.tricuspidRegion),along)),normal=unit(cross(lateral,along));
 for(const x of [.32,.40,.48,.56])for(const y of [-.32,-.40,-.48,-.56]){
  const bodyLong=[x,y,Math.sqrt(1-x*x-y*y)],bodyLeft=unit(off([1,0,0],bodyLong)),bodyNormal=unit(cross(bodyLeft,bodyLong));
  const basis=k=>unit(add(add(mul(lateral,bodyLeft[k]),mul(along,bodyLong[k])),mul(normal,bodyNormal[k])));
  const anatomicalFrame={...c.anatomicalFrame,left:basis(0),superior:basis(1),anterior:basis(2)};
  const options={donorId,referenceMm,frames,anatomicalFrame,referenceAnatomy};
  const tte=createEchoAnatomyContext({...options,baseModel:createTteContextModel(options)});
  const four=resolveEchoAcquisitionPlane({plane:frames.a4c,view:TTE_ATLAS_VIEWS.find(v=>v.id==='a4c'),referenceMm,contextModel:tte,fourChamberPlane:frames.a4c});
  const fit=four.acquisitionPose?.contextFit,sourceAxis=fit?.apicalGuidance?.usesSourceAxis;
  let me=null;if(sourceAxis){
   const tee=createEchoAnatomyContext({...options,baseModel:createTeeContextModel(options)});
   const plane=resolveEchoAcquisitionPlane({plane:frames.me4c,view:TEE_ATLAS_VIEWS.find(v=>v.id==='me4c'),referenceMm,contextModel:tee});
   me={available:!!plane.acquisitionPose,correctionDeg:plane.acquisition?.correctionAngleDeg,maxLandmarkResidualMm:plane.acquisitionPose?.contextFit?.specimenTargetFit?.maxLandmarkResidualMm};
  }
  const row={donorId,bodyLongAxis:bodyLong,sourceAxis,skinContact:fit?.skinReferencePointMm,apicalCorrectionDeg:four.acquisition?.correctionAngleDeg,me4c:me};
  records.push(row);console.log(JSON.stringify(row));
 }
}
const output=process.argv[2];if(output)await writeFile(output,JSON.stringify({method:'Fixed-frame parameter exploration; specimen landmarks and voxels never moved.',records},null,2)+'\n');
