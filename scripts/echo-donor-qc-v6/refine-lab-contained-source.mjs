/** Read-only source-plane fit with unrestricted model multiplane and an actual
 * positive head/shaft guard. The fixed organs and free-lab kinematics are used
 * unchanged. Input seeds come from the recorded contained mechanical sweep. */
import {readFile, writeFile} from 'node:fs/promises';
import {getEchoDonorCalibration} from '../../public/echo-donor-calibration.js';
import {buildDonorEchoFrames} from '../../public/echo-donor-planes.js';
import {createTeeContextModel} from '../../public/tee-context-geometry.js';
import {createTeeReference, teePose, sanitizeTeeState} from '../../public/tee-geometry.js';
import {createEchoInstrumentClearance} from '../../public/echo-instrument-clearance.js';
import {createProbeMeshes} from '../../public/probe-scene.js';

const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0), sub=(a,b)=>a.map((v,i)=>v-b[i]);
const mul=(a,k)=>a.map(v=>v*k), len=a=>Math.hypot(...a), unit=a=>mul(a,1/len(a));
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const deg=x=>Math.acos(Math.min(1,Math.max(-1,x)))*180/Math.PI;
const keys=['insertionCm','shaftRotationDeg','anteflexDeg','lateralFlexDeg','multiplaneDeg'];
const unique=new Map();
for(const mesh of createProbeMeshes('tee').filter((_,i)=>i!==2))for(let i=0;i<mesh.vertices.length;i+=6){
  const v=Array.from(mesh.vertices.subarray(i,i+3));unique.set(v.join(','),v);
}
const vertices=[...unique.values()].sort((a,b)=>b[0]**2+b[1]**2+(b[2]-5)**2-a[0]**2-a[1]**2-(a[2]-5)**2);
const seeds=JSON.parse(await readFile('/dev/shm/donor-context-qc/lab-containment-feasibility.json','utf8'));
const refined=JSON.parse(await readFile('/dev/shm/donor-context-qc/lab-containment-refined.json','utf8'));
const records=[];

function nm(start,bounds,evaluate){
  const steps=[.18,5,2.5,2.5,5];
  const clip=x=>x.map((v,i)=>Math.max(bounds[i][0],Math.min(bounds[i][1],v)));
  const make=x=>{x=clip(x);return{x,result:evaluate(x)};};
  let simplex=[make(start),...steps.map((v,i)=>make(start.map((x,k)=>x+(i===k?v:0))))];
  for(let iteration=0;iteration<280;iteration++){
    simplex.sort((a,b)=>a.result.cost-b.result.cost);
    const c=Array(5).fill(0);for(const s of simplex.slice(0,5))s.x.forEach((v,i)=>c[i]+=v/5);
    const w=simplex[5],r=make(c.map((v,i)=>2*v-w.x[i]));
    if(r.result.cost<simplex[0].result.cost){
      const e=make(c.map((v,i)=>v+2*(r.x[i]-v)));simplex[5]=e.result.cost<r.result.cost?e:r;
    }else if(r.result.cost<simplex[4].result.cost)simplex[5]=r;
    else{
      const other=r.result.cost<w.result.cost?r:w,q=make(c.map((v,i)=>v+.5*(other.x[i]-v)));
      if(q.result.cost<other.result.cost)simplex[5]=q;
      else for(let i=1;i<6;i++)simplex[i]=make(simplex[i].x.map((v,k)=>simplex[0].x[k]+.5*(v-simplex[0].x[k])));
    }
  }
  return simplex.sort((a,b)=>a.result.cost-b.result.cost)[0];
}

for(const donor of seeds){
  const donorId=donor.donorId,c=getEchoDonorCalibration(donorId);
  const frames=buildDonorEchoFrames({},{donorId,referenceMm:c.referenceMm});
  const model=createTeeContextModel({donorId,referenceMm:c.referenceMm});
  const reference=createTeeReference(frames,c.referenceMm,model),query=createEchoInstrumentClearance(model);
  const entry=model.tractSamples[0],allowed=model.tractSamples.filter(s=>['me','le'].includes(s.level));
  const guardMm=.15*reference.scale;
  const guardedHead=instrument=>{
    for(const v of vertices){
      const p=[0,1,2].map(i=>instrument.originMm[i]+.60*reference.scale*(instrument.right[i]*v[0]+instrument.normal[i]*v[1]-instrument.beam[i]*v[2]));
      const q=query.point(p,{marginMm:guardMm,measureClearance:true});
      if(!q.fits)return {inside:false,deficitMm:q.inside?guardMm-q.clearanceMm:guardMm+q.penetrationMm};
    }
    return {inside:true};
  };
  for(const [key,startCandidates] of Object.entries(donor.found)){
    const frame=frames[key],center=mul(frame.center,c.referenceMm);
    const bounds=[[allowed[0].insertionCm,allowed.at(-1).insertionCm],[-180,180],[-65,90],[-60,60],[0,180]];
    let evaluations=0;
    const evaluate=x=>{
      evaluations++;
      const state=sanitizeTeeState({teeVersion:1,referenceMm:c.referenceMm,teePreset:key,...Object.fromEntries(keys.map((k,i)=>[k,x[i]]))});
      const pose=teePose(state,reference),head=guardedHead(pose.instrument);
      if(!head.inside)return {cost:1e6+head.deficitMm**2*1e4,head};
      const route=pose.shaftPoints.filter(p=>dot(sub(p,entry.pointMm),entry.tangent)>=0);
      const shaft=query.route(route,(1.8+.15)*reference.scale);
      if(!shaft.inside)return {cost:1e6+shaft.penetrationMm**2*1e4,shaft};
      const to=sub(center,pose.originMm),offset=Math.abs(dot(to,frame.normal));
      const angle=deg(Math.abs(dot(pose.normal,frame.normal))),aim=deg(dot(to,pose.beam)/len(to));
      const cost=(offset/(.5*reference.scale))**2+(angle/.75)**2+(aim/17)**2+(Math.max(0,aim-48)/3)**2*100;
      return {cost,state,offsetMm:offset,angleDeg:angle,aimDeg:aim};
    };
    let best=null;
    const prior=refined.find(r=>r.donorId===donorId&&r.key===key);
    for(const candidate of [...startCandidates,prior].filter(Boolean)){
      const state={...candidate.state,multiplaneDeg:0};
      const pose=teePose(state,reference),target=unit(sub(frame.normal,mul(pose.beam,dot(frame.normal,pose.beam))));
      const targetRight=cross(target,pose.beam);
      let angle=Math.atan2(dot(cross(pose.right,targetRight),pose.beam),dot(pose.right,targetRight))*180/Math.PI;
      angle=(angle+360)%180;
      const fit=nm(keys.map(k=>k==='multiplaneDeg'?angle:state[k]),bounds,evaluate);
      if(!best||fit.result.cost<best.result.cost)best=fit;
    }
    const result=best.result;
    if(result.state){
      const pose=teePose(result.state,reference);
      result.head=query(pose.instrument,reference.scale,{fullReport:true});
      const route=pose.shaftPoints.filter(p=>dot(sub(p,entry.pointMm),entry.tangent)>=0);
      result.shaft=query.route(route,1.8*reference.scale,{fullReport:true});
    }
    const row={donorId,key,evaluations,guardMm,...result};records.push(row);console.log(JSON.stringify(row));
    await writeFile('/dev/shm/donor-context-qc/lab-contained-source.json',JSON.stringify(records,null,2));
  }
}
