/** Diagnostic candidates only: never modifies the production view registry. */
import {writeFile} from 'node:fs/promises';
import {resolveEchoAcquisitionPlane} from '../../public/echo-acquisition-geometry.js';
import {buildDonorEchoFrames} from '../../public/echo-donor-planes.js';
import {getEchoDonorCalibration} from '../../public/echo-donor-calibration.js';
import {createTeeContextModel} from '../../public/tee-context-geometry.js';
import {rotateVector} from '../../public/probe-geometry.js';
import {TEE_ATLAS_VIEWS} from '../../public/tee-atlas-data.js';
const sub=(a,b)=>a.map((x,i)=>x-b[i]),dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),mul=(a,s)=>a.map(x=>x*s),norm=a=>mul(a,1/Math.hypot(...a));
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const rows=[];
for(const donor of ['s-20-28','s-20-29']){
 const cal=getEchoDonorCalibration(donor),ref=cal.referenceMm,L=cal.landmarksMm;
 const frames=buildDonorEchoFrames({},{donorId:donor,referenceMm:ref}),model=createTeeContextModel({donorId:donor,referenceMm:ref,frames});
 const view=TEE_ATLAS_VIEWS.find(v=>v.id==='mecommissural'),original=frames.mecommissural,axis=norm(sub(L.mitralRegion,L.apex)),four=frames.me4c;
 for(const rollDeg of [-60,-50,-40,-30,-20,0,20,50])for(const angleDefault of [40,50,60,70,80,90]){
  const normal=norm(rotateVector(four.normal,axis,rollDeg*Math.PI/180)),right=norm(cross(axis,normal));
  const plane={...original,normal,right,up:axis,center:mul(L.mitralRegion,1/ref)};
  const result=resolveEchoAcquisitionPlane({plane,view:{...view,angleDefault},referenceMm:ref,contextModel:model});
  const residual=key=>Math.abs(dot(sub(L[key],mul(result.center,ref)),result.normal));
  rows.push({donor,rollDeg,angleDefault,available:!!result.acquisitionPose,correctionAngleDeg:result.acquisition?.correctionAngleDeg,
   apexMissMm:residual('apex'),lvMissMm:residual('leftVentricle'),laMissMm:residual('leftAtrium'),sourcePlane:plane,acceptedPlane:result});
 }
 const filtered=rows.filter(r=>r.donor===donor&&r.available).sort((a,b)=>a.correctionAngleDeg-b.correctionAngleDeg);
 console.log(JSON.stringify({donor,best:filtered.slice(0,18).map(({sourcePlane,acceptedPlane,...x})=>x)}));
}
await writeFile('/dev/shm/tee-commissural-sweep.json',JSON.stringify({schemaVersion:1,rows},null,2)+'\n');
