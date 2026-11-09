import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createTeeContextModel,sampleTeeContextTract} from '../../public/tee-context-geometry.js';
import {atlasContextProbePose} from '../../public/tee-atlas-geometry.js';
import {TEE_ATLAS_VIEWS} from '../../public/tee-atlas-data.js';
import {dot} from '../../public/planes.js';

const model=createTeeContextModel(),catalog=JSON.parse(await readFile('public/assets/tee-atlas/plane-fit-v2.json','utf8'));
const sourceXYZ=p=>[p[0]/.3176+237,237-p[2]/.3176,p[1]/.3176+264.5];
const distance=(a,b)=>Math.hypot(...a.map((x,i)=>x-b[i]));
const signedDistance=(p,f)=>p.reduce((sum,v,i)=>sum+(v-f.center[i]*model.referenceMm)*f.normal[i],0);
const closest=(samples,f)=>samples.reduce((best,s)=>{const residualMm=Math.abs(signedDistance(s.pointMm,f));return !best||residualMm<best.residualMm?{...s,residualMm,sourceXYZ:sourceXYZ(s.pointMm)}:best;},null);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const rows=[];
for(const view of TEE_ATLAS_VIEWS){
 const f=catalog.views[view.id]?.frame;if(!f)continue;
 const gastric=view.group==='tg',levels=gastric?['junction','tg','deep-tg']:['me','le'];
 const path=model.tractSamples.filter(s=>levels.includes(s.level)),centerline=closest(path,f),interior=gastric?closest(model.gastricInteriorSamples,f):null;
 const pose=atlasContextProbePose(f,view,model.referenceMm,model);
 const pool=gastric?model.gastricInteriorSamples:path;
 const selected=pool.reduce((best,s)=>!best||distance(s.pointMm,pose.originMm)<distance(best.pointMm,pose.originMm)?s:best,null);
 const tipAngleDeg=Math.acos(Math.max(-1,Math.min(1,dot(selected.tangent,pose.instrument.shaft))))*180/Math.PI;
 rows.push({id:view.id,name:view.name,aseNumber:view.aseNumber,status:catalog.views[view.id].status,centerline:{residualMm:centerline.residualMm,sourceXYZ:centerline.sourceXYZ,insertionCm:centerline.insertionCm,level:centerline.level},...(interior?{gastricInterior:{residualMm:interior.residualMm,sourceXYZ:interior.sourceXYZ,insertionCm:interior.insertionCm,pathIndex:interior.pathIndex,radialClearanceHintMm:interior.radialClearanceHintMm}}:{}),productionPlacement:{...pose.contextFit,pointMm:pose.originMm,sourceXYZ:sourceXYZ(pose.originMm),planeResidualMm:Math.abs(signedDistance(pose.originMm,f)),localShaftToInstrumentAngleDeg:tipAngleDeg}});
}
const middle=model.tractSamples.find(s=>s.insertionCm===35),normal=catalog.views.me4c.frame.normal;
const shaftAngles=Object.fromEntries([31,32,33,34,35,36.6,38].map(cm=>{const sample=sampleTeeContextTract(model,middle.arcMm+(cm-35)*10);return [cm,Math.acos(Math.max(-1,Math.min(1,Math.abs(dot(sample.tangent,normal)))))*180/Math.PI];}));
const report={scope:'Authored TEE context versus final reviewed source planes. Geometric distances only; not patient-registered probe placement or contact validation.',revision:model.revision,geometrySha256:sha(await readFile('public/tee-context-geometry.js')),planeCatalogSha256:sha(await readFile('public/assets/tee-atlas/plane-fit-v2.json')),bodySuperiorToMe4cNormalDegrees:Math.acos(Math.abs(dot(model.frame.superior,normal)))*180/Math.PI,localShaftToMe4cPlaneNormalDegrees:shaftAngles,rows};
await writeFile('docs/tee-context-v2/plane-residuals.json',JSON.stringify(report,null,2)+'\n');
for(const r of rows)console.log(`${r.id.padEnd(16)} center=${r.centerline.residualMm.toFixed(2)}mm${r.gastricInterior?` interior=${r.gastricInterior.residualMm.toFixed(2)}mm`:''} production=${r.productionPlacement.distanceMm.toFixed(2)}mm ${r.productionPlacement.resolved?'shown':'unresolved'}`);
