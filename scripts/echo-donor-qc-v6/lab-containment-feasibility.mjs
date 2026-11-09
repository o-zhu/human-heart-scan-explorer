/** Read-only coarse search of the actual S-20 free-lab head and routed shaft. */
import{writeFile}from'node:fs/promises';
import{getEchoDonorCalibration}from'../../public/echo-donor-calibration.js';
import{buildDonorEchoFrames}from'../../public/echo-donor-planes.js';
import{createTeeContextModel}from'../../public/tee-context-geometry.js';
import{createTeeReference,teePose,sanitizeTeeState}from'../../public/tee-geometry.js';
import{createEchoInstrumentClearance}from'../../public/echo-instrument-clearance.js';
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(p,n)=>p.map(v=>v*n),len=p=>Math.hypot(...p),deg=x=>Math.acos(Math.min(1,Math.max(-1,x)))*180/Math.PI;
const result=[];
for(const donorId of ['s-20-29','s-20-28']){
 const c=getEchoDonorCalibration(donorId),frames=buildDonorEchoFrames({},{donorId,referenceMm:c.referenceMm}),model=createTeeContextModel({donorId,referenceMm:c.referenceMm}),reference=createTeeReference(frames,c.referenceMm,model),query=createEchoInstrumentClearance(model),entry=model.tractSamples[0],samples=model.tractSamples.filter(s=>['me','le'].includes(s.level)),low=samples[0].insertionCm,high=samples.at(-1).insertionCm;
 const candidates={me4c:[],me2c:[],melax:[]};let checked=0,headContained=0;
 const assess=(state,pose,key)=>{const frame=frames[key],center=mul(frame.center,c.referenceMm),to=sub(center,pose.originMm),distance=len(to),offset=Math.abs(dot(to,frame.normal)),angle=deg(Math.abs(dot(pose.normal,frame.normal))),aim=deg(dot(to,pose.beam)/distance);return{cost:(offset/(.5*reference.scale))**2+(angle/.75)**2+(aim/17)**2+(Math.max(0,aim-48)/3)**2*100,state,offsetMm:offset,angleDeg:angle,aimDeg:aim};};
 for(let insertionCm=low;insertionCm<=high+.0001;insertionCm+=.5)for(let shaftRotationDeg=-180;shaftRotationDeg<180;shaftRotationDeg+=30)for(let anteflexDeg=-30;anteflexDeg<=75;anteflexDeg+=15)for(let lateralFlexDeg=-45;lateralFlexDeg<=45;lateralFlexDeg+=15){
  const state=sanitizeTeeState({teeVersion:1,referenceMm:c.referenceMm,insertionCm,shaftRotationDeg,anteflexDeg,lateralFlexDeg,multiplaneDeg:0}),pose=teePose(state,reference);checked++;
  if(!query(pose.instrument,reference.scale).inside)continue;headContained++;
  for(const [key,angles]of Object.entries({me4c:[0,10,20],me2c:[80,90,100],melax:[120,130,140]}))for(const multiplaneDeg of angles){const s={...state,multiplaneDeg},p=multiplaneDeg?teePose(s,reference):pose;candidates[key].push(assess(s,p,key));}
 }
 const found={};for(const key of Object.keys(candidates)){candidates[key].sort((a,b)=>a.cost-b.cost);const valid=[];for(const candidate of candidates[key]){const p=teePose(candidate.state,reference),route=p.shaftPoints.filter(q=>dot(sub(q,entry.pointMm),entry.tangent)>=0),shaft=query.route(route,1.8*reference.scale);if(shaft.inside){valid.push({...candidate,shaft});if(valid.length>=12)break;}}found[key]=valid;console.log(JSON.stringify({donorId,key,checked,headContained,best:valid[0]}));}
 result.push({donorId,checked,headContained,found});
}
await writeFile(process.argv[2]||'/dev/shm/donor-context-qc/lab-containment-feasibility.json',JSON.stringify(result,null,2));
