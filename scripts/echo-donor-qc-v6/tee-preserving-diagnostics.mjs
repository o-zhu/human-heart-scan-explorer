/** Independent source-plane / fixed-lumen feasibility measurements. */
import {writeFile} from 'node:fs/promises';
import {resolveEchoAcquisitionPlane} from '../../public/echo-acquisition-geometry.js';
import {buildDonorEchoFrames} from '../../public/echo-donor-planes.js';
import {getEchoDonorCalibration} from '../../public/echo-donor-calibration.js';
import {createTeeContextModel} from '../../public/tee-context-geometry.js';
import {TEE_ATLAS_VIEWS} from '../../public/tee-atlas-data.js';
const option=(key,fallback)=>process.argv.find(v=>v.startsWith(`--${key}=`))?.slice(key.length+3)||fallback;
const ids=option('ids','tgbasalsax,mecommissural').split(',');
const donors=option('donors','s-20-28,s-20-29').split(',');
const out=option('out','/dev/shm/tee-preserving-diagnostics.json');
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),sub=(a,b)=>a.map((x,i)=>x-b[i]);
const mul=(a,s)=>a.map(x=>x*s),len=a=>Math.hypot(...a);
const rows=[];
for(const donor of donors){
 const calibration=getEchoDonorCalibration(donor),referenceMm=calibration.referenceMm;
 const frames=buildDonorEchoFrames({},{donorId:donor,referenceMm});
 const model=createTeeContextModel({donorId:donor,referenceMm,frames});
 const topo=model.topology.gastrointestinal;
 for(const id of ids){
  const plane=frames[id],view=TEE_ATLAS_VIEWS.find(v=>v.id===id),c=mul(plane.center,referenceMm),n=plane.normal;
  const region=view.group==='tg'?model.gastricInteriorSamples:model.tractSamples.filter(s=>s.level==='me');
  const residual=p=>dot(sub(p,c),n);
  const ringResiduals=Array.from({length:topo.rings},(_,ring)=>{
   const a=Array.from({length:topo.segments},(_,j)=>residual(Array.from(topo.positionsMm.subarray((ring*topo.segments+j)*3,(ring*topo.segments+j)*3+3))));
   return {ring,min:Math.min(...a),max:Math.max(...a)};
  });
  const gastric=ringResiduals.slice(topo.joinRing);
  const row={donor,id,source:plane,sourceLumen:{sampleCount:region.length,minSampleDistanceMm:Math.min(...region.map(s=>Math.abs(residual(s.pointMm)))),
   signedSampleRangeMm:[Math.min(...region.map(s=>residual(s.pointMm))),Math.max(...region.map(s=>residual(s.pointMm)))],
   gastricWallRangeMm:[Math.min(...gastric.map(r=>r.min)),Math.max(...gastric.map(r=>r.max))],
   gastricCrossedRings:gastric.filter(r=>r.min<=0&&r.max>=0),allCrossedRings:ringResiduals.filter(r=>r.min<=0&&r.max>=0)},fits:[]};
  for(const offsetMm of [0,-2,2,-4,4,-6,6])for(const electronicAngle of view.group==='tg'?[0,10,20]:[40,50,60,70]){
   const requested={...plane,center:plane.center.map((v,i)=>v+n[i]*offsetMm/referenceMm)};
   const start=performance.now(),result=resolveEchoAcquisitionPlane({plane:requested,view:{...view,angleDefault:electronicAngle},referenceMm,contextModel:model});
   const fit=result.acquisitionPose?.contextFit;
   row.fits.push({offsetMm,electronicAngle,available:!!result.acquisitionPose,correctionAngleDeg:result.acquisition?.correctionAngleDeg,
    sourcePlane:requested,acceptedPlane:result,head:fit?.headContained,shaft:fit?.shaftContained,
    ms:performance.now()-start});
  }
  rows.push(row);
  console.log(JSON.stringify({donor,id,sourceLumen:row.sourceLumen,fits:row.fits.map(({acceptedPlane,sourcePlane,...x})=>x)}));
 }
}
await writeFile(out,JSON.stringify({schemaVersion:1,createdAt:new Date().toISOString(),rows},null,2)+'\n');
