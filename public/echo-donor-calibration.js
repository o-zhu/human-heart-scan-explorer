/**
 * Fixed specimen calibration for the two ESRF S-20 hearts.
 *
 * Points are independently reviewed v17 original-s4 source voxel centres,
 * converted through the donor's own fine-centre registration. They are NOT
 * coordinates copied from LADAF or from a generic echo preset. Excised-heart
 * anatomy does not establish patient pose: the body frame is an illustrative
 * rigid registration, while every source voxel and landmark remains fixed.
 */
import {add,mul,dot,cross,norm} from './planes.js';
import {ECHO_DONOR_SUPPORT} from './echo-donor-support.js';
export const ECHO_DONOR_CALIBRATION_REVISION='source-specimen-calibration-v1';
const sub=(a,b)=>a.map((x,i)=>x-b[i]);
const reject=(v,n)=>sub(v,mul(n,dot(v,n)));
const freeze3=v=>Object.freeze([...v]);
const SPECIMENS={
 's-20-29':{
  datasetId:'1773963465',dimensions:[478,478,487],spacingMm:.31824,referenceMm:154.66464,
  sourcePoints:{
   apex:[338,260,370],epicardialApex:[264,224,449],
   leftVentricle:[314,241,310],rightVentricle:[200,246,280],
   leftAtrium:[294,176,115],rightAtrium:[105,223,100],rightAtriumSuperior:[159,218,45],
   mitralRegion:[289,172,173],tricuspidRegion:[123,219,214],
   aorticRoot:[234,218,182],aorticLumen:[186,231,140],aorticSuperior:[169,278,90],
   pulmonaryRoot:[233,282,190],pulmonarySuperior:[245,305,115]
  },
  // Both source chamber axes and the source AV junctions establish this frame.
  // The oblique body target puts the LV apex inferior, left and anterior.
  bodyLongAxis:[.40,-.32,.8588364221433555],
  contextProfile:{
   revision:'source-clearance-fit-v3',bodyReferenceScale:1.35,diaphragmOffsetMm:-17,
   hiatusXZ:[12,-29],
   esophagusControls:[[15,110,-44],[18,85,-46],[21,60,-51],[24,40,-60],[22,20,-61],[24,0,-59],[30,-25,-48],[22,-45,-36]]
  },
  provenance:'docs/anatomy-donors-v17/source-guides.json; original source XYZ + 0.375 voxel fine-centre registration',
  apexMethod:'Endocardial distal LV cavity; outer compact-wall tip retained separately for the physical envelope.'
 },
 's-20-28':{
  datasetId:'1966162746',dimensions:[477,477,509],spacingMm:.3176,referenceMm:161.3408,
  sourcePoints:{
   apex:[193,198,475],epicardialApex:[193,198,475],
   leftVentricle:[259,207,340],rightVentricle:[163,219,250],
   leftAtrium:[309,205,150],rightAtrium:[194,197,105],rightAtriumSuperior:[200,223,28],
   mitralRegion:[302,210,229],tricuspidRegion:[185,180,157],
   aorticRoot:[255,251,204],aorticLumen:[244,266,150],aorticSuperior:[247,320,90],
   pulmonaryRoot:[240,340,235],pulmonarySuperior:[290,363,150]
  },
  bodyLongAxis:[.32,-.48,.8168231142664855],
  contextProfile:{
   revision:'source-clearance-fit-v3',bodyReferenceScale:1.22,diaphragmOffsetMm:-21,
   hiatusXZ:[12,-29],
   esophagusControls:[[0,110,-43],[3,85,-47],[5,60,-52],[5,40,-59],[4,20,-67],[5,0,-67],[12,-25,-53],[18,-48,-38]]
  },
  provenance:'docs/anatomy-donors-v17/source-guides.json; original source XYZ + 0.375 voxel fine-centre registration',
  apexMethod:'Distal LV envelope apex verified against the source long-axis cavity.'
 }
};
function canonicalDonor(id){
 const key=String(id||'').toLowerCase();
 if(key==='1773963465')return 's-20-29';
 if(key==='1966162746')return 's-20-28';
 return Object.hasOwn(SPECIMENS,key)?key:null;
}
function sourceToWorld(p,s,scale){
 const q=p.map((v,i)=>(v+.375-(s.dimensions[i]-1)/2)*s.spacingMm*scale);
 return [q[0],q[2],-q[1]];
}
/** Returns null for LADAF, whose existing reviewed context is preserved. */
export function getEchoDonorCalibration(donorId,referenceMm){
 const key=canonicalDonor(donorId);if(!key)return null;
 const s=SPECIMENS[key],ref=Number.isFinite(referenceMm)&&referenceMm>0?referenceMm:s.referenceMm,scale=ref/s.referenceMm;
 const landmarksMm=Object.freeze(Object.fromEntries(Object.entries(s.sourcePoints).map(([name,p])=>[name,freeze3(sourceToWorld(p,s,scale))])));
 const long=norm(sub(landmarksMm.apex,landmarksMm.mitralRegion));
 const lateral=norm(reject(sub(landmarksMm.mitralRegion,landmarksMm.tricuspidRegion),long));
 const normal=norm(cross(lateral,long));
 const bodyLong=norm(s.bodyLongAxis),bodyLateral=norm(reject([1,0,0],bodyLong)),bodyNormal=norm(cross(bodyLateral,bodyLong));
 const basis=axis=>add(add(mul(lateral,bodyLateral[axis]),mul(long,bodyLong[axis])),mul(normal,bodyNormal[axis]));
 const left=norm(basis(0)),superior=norm(basis(1)),anterior=norm(basis(2));
 const originMm=mul(add(landmarksMm.mitralRegion,landmarksMm.tricuspidRegion),.5);
 const contextProfile=Object.freeze({...s.contextProfile,hiatusXZ:Object.freeze([...s.contextProfile.hiatusXZ]),esophagusControls:Object.freeze(s.contextProfile.esophagusControls.map(freeze3))});
 const anatomicalFrame=Object.freeze({
  kind:'specimen-source-anchored-illustrative-frame',originMm:freeze3(originMm),
  left:freeze3(left),superior:freeze3(superior),anterior:freeze3(anterior),posterior:freeze3(mul(anterior,-1)),
  landmarksMm,contextProfile,patientOrientationValidated:false
 });
 const support=ECHO_DONOR_SUPPORT[key];
 const boundsMm=Object.freeze({min:freeze3(mul(support.boundsMm.min,scale)),max:freeze3(mul(support.boundsMm.max,scale)),kind:'retained-source-support-bounds'});
 const sourceSupportPointsMm=Object.freeze(support.pointsMm.map(p=>freeze3(mul(p,scale))));
 return Object.freeze({
  revision:ECHO_DONOR_CALIBRATION_REVISION,donorId:key,datasetId:s.datasetId,referenceMm:ref,
  sourceReferenceMm:s.referenceMm,landmarksMm,anatomicalFrame,contextProfile,boundsMm,sourceSupportPointsMm,
  sourceSupport:Object.freeze({sourceSha256:support.sourceSha256,dimensions:Object.freeze([...support.supportDimensions]),voxelDiagonalMm:support.voxelDiagonalMm*scale}),
  sourcePoints:Object.freeze(Object.fromEntries(Object.entries(s.sourcePoints).map(([k,p])=>[k,freeze3(p)]))),
  provenance:s.provenance,apexMethod:s.apexMethod,
  patientOrientationValidated:false,
  limitations:'Assistant-reviewed source regions; body and gastrointestinal organs are illustrative, not acquired patient anatomy.'
 });
}
