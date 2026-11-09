/**
 * Clinical reference definitions and presentation transforms.
 * These checks describe a target view; they never infer labels from a CT voxel.
 * References and the donor-specific review are recorded in docs/echo-v11/.
 */
import { cross, dot, mul, norm } from './planes.js';
import {TEE_ATLAS_VIEWS} from './tee-atlas-data.js';
import {TTE_ATLAS_VIEWS} from './tte-atlas-data.js';

export const ECHO_REFERENCE_CHECKS = Object.freeze({
 ...Object.fromEntries(TTE_ATLAS_VIEWS.map(v=>[v.id,{required:v.anatomy,check:v.teachingPoint,source:'tte'}])),
 ...Object.fromEntries(TEE_ATLAS_VIEWS.map(v=>[v.id,{required:v.anatomy,check:v.teachingPoint,source:'tee'}])),
 plax: { required: ['LV', 'LA', 'Mitral valve', 'LVOT', 'Aortic valve / root'], check: 'The LV long axis should cross both the mitral valve and aortic outflow.', source: 'tte' },
 psax_papillary: { required: ['LV ring', 'Papillary muscles', 'RV crescent'], check: 'Confirm the papillary level and a near-circular LV cross section.', source: 'tte' },
 psax_mitral: { required: ['Mitral leaflets in short axis', 'LV', 'RV'], check: 'The mitral opening must be visible; a basal LV section alone is insufficient.', source: 'tte' },
 a4c: { required: ['Both ventricles', 'Both atria', 'Both AV valves', 'Septa'], check: 'Include the LV apex and both AV valves; avoid an LVOT-dominant five-chamber section.', source: 'tte' },
 a2c: { required: ['LV', 'LA', 'Mitral valve'], check: 'Include the LV apex and mitral inflow while excluding the RV and aortic outflow.', source: 'tte' },
 a3c: { required: ['LV', 'LA', 'Mitral valve', 'LVOT', 'Aortic valve'], check: 'Both mitral inflow and aortic outflow must lie in the section.', source: 'tte' },
 subcostal: { required: ['Four chambers', 'Both AV valves', 'Atrial septum'], check: 'A subcostal acquisition also needs the inferior entry path, which an isolated heart does not record.', source: 'tte' },
 me4c: { required: ['Four chambers', 'Both AV valves', 'Septa'], check: 'Atria are near the probe; the LV apex is distal. Exclude the aortic valve and LVOT.', source: 'tee' },
 me2c: { required: ['LV', 'LA', 'Mitral valve'], check: 'Show left-heart inflow and the LV long axis; distinguish this from a commissural cut.', source: 'tee' },
 melax: { required: ['LV', 'LA', 'Mitral valve', 'LVOT', 'Aortic valve / root'], check: 'The section needs continuous LV outflow through the aortic valve.', source: 'tee' },
 meavsax: { required: ['Aortic cusps', 'Aortic root', 'Adjacent atria'], check: 'Confirm a true valve-level cross section, rather than a transverse vessel above the valve.', source: 'tee' },
 bicaval: { required: ['RA', 'Atrial septum', 'Caval inflows'], check: 'Identify both caval junctions with the RA and the interatrial septum.', source: 'tee' },
 tgpapillary: { required: ['LV ring', 'Papillary muscles', 'RV'], check: 'Confirm the midventricular papillary level and the gastric viewing direction.', source: 'tee' },
});

export function isEchoPlaneModified(state={}) {
 return ['offsetMm','rotationDeg','tiltDeg'].some(key=>Math.abs(Number(state[key])||0)>1e-8);
}

/** Preserve the physical clipping normal and signed offset; only the presentation basis changes. */
export function orientEchoPlaneForDisplay(plane, {mirrorX=false,rotate180=false}={}) {
 if(!mirrorX&&!rotate180)return plane;
 return {...plane,right:mul(plane.right,mirrorX!==rotate180?-1:1),up:mul(plane.up,rotate180?-1:1)};
}

/** Exact byte permutation, used only for immutable prepared scalar sections. No interpolation. */
export function orientEchoPreparedPixels(sample, {mirrorX=false,rotate180=false}={}) {
 if(!mirrorX&&!rotate180)return sample;
 const {data,width,height}=sample;
 if(!(data instanceof Uint8Array)||data.length!==width*height)throw new Error('Invalid prepared Echo scalar section.');
 const reflected=new Uint8Array(data.length);
 for(let row=0;row<height;row++)for(let col=0;col<width;col++){
  const sourceRow=rotate180?height-1-row:row,sourceCol=mirrorX!==rotate180?width-1-col:col;
  reflected[row*width+col]=data[sourceRow*width+sourceCol];
 }
 return {...sample,data:reflected,displayMirrorX:mirrorX,displayRotate180:rotate180};
}

/** Camera and cutaway half follow the displayed basis, independent of the signed physical normal. */
export function echoDisplayFacing(plane, flip=false) {
 const face=norm(cross(plane.right,plane.up));
 const reflected=dot(face,plane.normal)<0;
 return {normal:mul(face,flip?-1:1),clipFlip:Number(reflected!==Boolean(flip))};
}

export function describeEchoCorrespondence({key,review=null,geometric=false,modified=false,clip=null}={}) {
 const definition=ECHO_REFERENCE_CHECKS[key]||{required:[],check:'Confirm the target structures in the measured section.'};
 const namedMatch=clip?.preset===key;
 let status,summary;
 if(geometric||!review){status='CT correspondence unverified';summary='This donor has a measured geometric starting plane. Its clinical window and anatomical landmarks have not been established.';}
 else if(modified){status='CT plane adjusted';summary='The current plane has moved from the reviewed starting section. Recheck the target anatomy in this new section.';}
 else {status=review.status==='partial'?'Partial CT correspondence':'CT correspondence unverified';summary=review.summary;}
 let movieStatus='No matching recording';
 if(clip){
  if(!namedMatch)movieStatus='Different reference view';
  else if(clip.correspondence?.kind==='sweep')movieStatus='Changing-plane recording';
  else if(clip.correspondence?.kind==='broader-view')movieStatus='Broader view reference';
  else if(clip.correspondence?.sourceLabelVerified===true)movieStatus='Reference label checked';
  else movieStatus='Independent reference';
 }
 return {status,summary,movieStatus,required:geometric?[]:definition.required,check:geometric?'This is an independent geometric CT section. Chamber and valve landmarks have not been assigned for this donor.':definition.check,source:definition.source,
  referenceNote:clip?.correspondence?.note||'The movie and CT were acquired from different people and are not spatially registered.',
  orientationNote:review?.orientationNote||'',clinicallyValidated:false};
}
