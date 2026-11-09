/** Runtime-only LADAF target inspection. Writes measured-plane sampling input;
 * changes no source asset, production geometry, context, or clinical label.
 * Counterfactual CS planes use the actual canonical apical contact and marker,
 * with explicit 0/2/4/8 degree posterior tilts about that fixed marker.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {EchoModule} from '../../public/echo.js';
import {DONORS} from '../../public/donors.js';
import {TEE_ATLAS_VIEWS} from '../../public/tee-atlas-data.js';
import {TTE_ATLAS_VIEWS} from '../../public/tte-atlas-data.js';
import {validateTeeRefinements} from '../../public/tee-view-refinement.js';
import {decodeEchoReferenceAnatomy} from '../../public/echo-anatomy-context-v2.js';
import {resolveEchoAcquisitionPlane} from '../../public/echo-acquisition-geometry.js';
import {orientEchoPlaneForDisplay} from '../../public/echo-correspondence.js';
import {tteApicalGuide} from '../../public/echo-tte-guidance.js';
import {rotateVector} from '../../public/probe-geometry.js';

const root=fileURLToPath(new URL('../../',import.meta.url));
const out=resolve(process.argv[2]||'/dev/shm/ladaf-target-inspection');
const json=async p=>JSON.parse(await readFile(join(root,p),'utf8'));
const asset=url=>'public/'+url.replace(/^\.\//,'').split('?')[0];
const sha=b=>createHash('sha256').update(b).digest('hex');
const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(v,s)=>v.map(x=>x*s);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),length=v=>Math.hypot(...v),unit=v=>mul(v,1/length(v));
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const angle=(a,b)=>Math.acos(Math.max(-1,Math.min(1,dot(unit(a),unit(b)))))*180/Math.PI;
const mean=points=>points.reduce((sum,p)=>add(sum,mul(p,1/points.length)),[0,0,0]);
const sourceToWorld=([x,y,z])=>[(x-237)/529,(z-264.5)/529,(237-y)/529];
function rotateBasis(plane,normal){
 const axis=cross(plane.normal,normal),amount=angle(plane.normal,normal)*Math.PI/180;
 if(length(axis)<1e-9)return {...plane,normal:[...normal]};
 return {...plane,right:unit(rotateVector(plane.right,unit(axis),amount)),up:unit(rotateVector(plane.up,unit(axis),amount)),normal:[...normal]};
}
const files=['public/echo.js','public/echo-acquisition-geometry.js','public/echo-tte-guidance.js','public/echo-donor-planes.js','public/tee-context-geometry.js','public/assets/manifest.json','public/mpr-worker.js'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async f=>[f,sha(await readFile(join(root,f)))])));
const before=await hashes(),donor=DONORS[0];
const [raw,flow,manifest,boundary]=await Promise.all([json(asset(donor.echoPlanesUrl)),json(asset(donor.flowViewsUrl)),json(asset(donor.manifestUrl)),json('docs/anatomy/boundary-landmarks.json')]);
const referenceMm=Math.max(...manifest.sourceScaleCenterExtentUm)/1000;
const referenceAnatomy=await decodeEchoReferenceAnatomy({manifestBytes:await readFile(join(root,'public/assets/probe-context-v11/manifest.json')),compressedBytes:await readFile(join(root,'public/assets/probe-context-v11/torso.bin.gz'))});
const e=Object.assign(Object.create(EchoModule.prototype),{donor,baseFrames:Object.fromEntries(Object.entries(raw.frames).map(([id,f])=>[id,{...f.world,displayMirrorX:!!f.displayMirrorX,displayRotate180:!!f.displayRotate180}])),flowFrames:Object.fromEntries(flow.presets.map(p=>[p.id,p.world])),planeReview:validateTeeRefinements(await json('public/assets/tee-atlas/plane-fit-v2.json')),longestMm:referenceMm,referenceAnatomy,anatomyLoadError:false,state:{mode:'tte',planeReference:'refined'}});
e.rebuildAtlasFrames();
const oriented=id=>{const f=e.frames[id];return orientEchoPlaneForDisplay({...f,center:[...f.center],right:unit(f.right),up:unit(f.up),normal:unit(f.normal),outsideScan:!!f.outsideScan},{mirrorX:f.displayMirrorX,rotate180:f.displayRotate180});};
const cases=[],tteModel=e.anatomyContext(),csView=TTE_ATLAS_VIEWS.find(v=>v.id==='a4c_cs');
const csSource=oriented('a4c_cs'),four=oriented('a4c');
const csGuide=tteApicalGuide({view:csView,model:tteModel,sourcePlane:csSource,referenceMm,fourChamberPlane:four});
const marker=csGuide.canonicalMarkerDirection,origin=csGuide.contact.pointMm,posteriorSign=Math.sign(csGuide.guidance.tiltDeg)||1;
const acquiredA4C=resolveEchoAcquisitionPlane({plane:four,view:TTE_ATLAS_VIEWS.find(v=>v.id==='a4c'),referenceMm,contextModel:tteModel,fourChamberPlane:four});
cases.push({id:'a4c-current',plane:acquiredA4C,outsideScan:false,construction:'Actual production acquired A4C'});
for(const degrees of [0,2,4,8]){
 const beam=unit(rotateVector(csGuide.canonicalBeam,marker,posteriorSign*degrees*Math.PI/180)),right=mul(marker,-1);
 let normal=unit(cross(beam,right));if(dot(normal,csSource.normal)<0)normal=mul(normal,-1);
 const sourceCenterMm=mul(csSource.center,referenceMm),centerMm=sub(sourceCenterMm,mul(normal,dot(sub(sourceCenterMm,origin),normal)));
 const plane={...rotateBasis(csSource,normal),center:mul(centerMm,1/referenceMm)};
 cases.push({id:`cs-posterior-${degrees}`,plane,outsideScan:false,construction:'Counterfactual: same actual canonical apical contact/marker, explicit posterior tilt, same production ROI projection and minimal basis rotation',tiltDeg:posteriorSign*degrees,contactMm:origin,markerDirection:marker,beam});
}
e.state.mode='tee';const teeModel=e.anatomyContext(),rvSource=oriented('tgrvinout'),rvView=TEE_ATLAS_VIEWS.find(v=>v.id==='tgrvinout');
const tv=mean(boundary.tricuspidHingeSourceXYZ),pv=[190,302,230],rvMid=[195,184,330],rvApical=[190,218,448],pa=[205,317,210];
const points={tricuspidRegionalCenter:tv,pulmonaryRoot:pv,pulmonaryLumen:pa,rvMidCavity:rvMid,rvApicalCavity:rvApical};
const worldPoints=Object.fromEntries(Object.entries(points).map(([id,p])=>[id,sourceToWorld(p)]));
function diagnostics(plane){
 const topology=teeModel.topology.gastrointestinal,distances=[];
 for(let i=topology.joinRing*topology.segments*3;i<topology.positionsMm.length;i+=3)distances.push(dot(sub(Array.from(topology.positionsMm.subarray(i,i+3)),mul(plane.center,referenceMm)),plane.normal));
 const min=Math.min(...distances),max=Math.max(...distances),axis=unit(sub(worldPoints.rvApicalCavity,worldPoints.tricuspidRegionalCenter));
 return {stomachSignedRangeMm:[min,max],stomachPlaneGapMm:min>0?min:max<0?-max:0,rvAxisAngleOutOfPlaneDeg:Math.asin(Math.abs(dot(axis,plane.normal)))*180/Math.PI,targetResidualMm:Object.fromEntries(Object.entries(worldPoints).map(([id,p])=>[id,Math.abs(dot(sub(p,plane.center),plane.normal))*referenceMm]))};
}
cases.push({id:'rv-reviewed-source',plane:rvSource,outsideScan:false,construction:'Actual refined source target before acquisition',diagnostics:diagnostics(rvSource)});
for(const [name,target] of [['mid',rvMid],['apical',rvApical]]){
 const a=sourceToWorld(tv),b=sourceToWorld(pv),c=sourceToWorld(target),center=mean([a,b,c]);
 let normal=unit(cross(sub(b,a),sub(c,a)));if(dot(normal,rvSource.normal)<0)normal=mul(normal,-1);
 const up=unit(sub(mean([a,b]),c)),right=unit(cross(up,normal));
 const candidate={...rvSource,center,right,up,normal,width:.76,height:.90};
 cases.push({id:`rv-tv-pv-${name}-source`,plane:candidate,outsideScan:false,construction:`Exploratory plane through source tricuspid hinge mean, pulmonary root lumen center, and RV ${name} cavity center; no clinical validation`,diagnostics:diagnostics(candidate)});
 for(const angleDefault of [10,100]){
  const acquired=resolveEchoAcquisitionPlane({plane:candidate,view:{...rvView,angleDefault},referenceMm,contextModel:teeModel});
  cases.push({id:`rv-tv-pv-${name}-acquired-${angleDefault}`,plane:acquired,outsideScan:false,construction:'Actual production acquisition solver on exploratory target',diagnostics:diagnostics(acquired),angleDefault,sourceRotationDeg:acquired.acquisition?.correctionAngleDeg,contextFit:acquired.acquisitionPose?.contextFit});
 }
}
const originalAcquired=resolveEchoAcquisitionPlane({plane:rvSource,view:{...rvView,angleDefault:10},referenceMm,contextModel:teeModel});
cases.push({id:'rv-reviewed-acquired-10',plane:originalAcquired,outsideScan:false,construction:'Actual production acquired original target at 10 degrees',diagnostics:diagnostics(originalAcquired),sourceRotationDeg:originalAcquired.acquisition?.correctionAngleDeg});
const after=await hashes(),changedFiles=files.filter(f=>before[f]!==after[f]);
await mkdir(out,{recursive:true});
await writeFile(join(out,'review.json'),JSON.stringify({schemaVersion:1,createdAt:new Date().toISOString(),donor:donor.id,sourceManifest:asset(donor.manifestUrl),referenceMm,sourceHashes:before,changedFiles,scope:'Runtime source-data target inspection; no clinical verification. Source points are approximate regional annotations. CS tilt has no independently identified coronary-sinus lumen target.',pointsSourceXYZ:points,pointProvenance:['docs/anatomy/boundary-landmarks.json: reviewed tricuspid hinges, mean used only as regional annular proxy','docs/anatomy/cavity-tracks.json: pulmonary root track6 and RV cavity track2'],cases},null,2)+'\n');
console.log(JSON.stringify({out,cases:cases.length,changedFiles,summary:cases.filter(c=>c.id.startsWith('rv-')).map(c=>({id:c.id,rotation:c.sourceRotationDeg,...c.diagnostics}))}));
