import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {EchoModule} from '../public/echo.js';
import {DONORS} from '../public/donors.js';
import {validateTeeRefinements} from '../public/tee-view-refinement.js';
import {decodeEchoReferenceAnatomy} from '../public/echo-anatomy-context-v2.js';

const json=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
const asset=url=>'../public/'+url.replace(/^\.\//,'').split('?')[0];
const sub=(a,b)=>a.map((x,i)=>x-b[i]);
const dot=(a,b)=>a.reduce((v,x,i)=>v+x*b[i],0);

test('each production default deep-TG section includes its reviewed root-region target and apex inside the scan sector',async()=>{
 const referenceAnatomy=await decodeEchoReferenceAnatomy({
  manifestBytes:await readFile(new URL('../public/assets/probe-context-v11/manifest.json',import.meta.url)),
  compressedBytes:await readFile(new URL('../public/assets/probe-context-v11/torso.bin.gz',import.meta.url)),
 });
 const planeReview=validateTeeRefinements(await json('../public/assets/tee-atlas/plane-fit-v2.json'));
 assert.equal(DONORS.length,3);
 for(const donor of DONORS){
  const [raw,flow,manifest]=await Promise.all([json(asset(donor.echoPlanesUrl)),json(asset(donor.flowViewsUrl)),json(asset(donor.manifestUrl))]);
  const referenceMm=Math.max(...manifest.sourceScaleCenterExtentUm)/1000;
  const baseFrames=Object.fromEntries(Object.entries(raw.frames).map(([id,f])=>[id,{...f.world,displayMirrorX:!!f.displayMirrorX,displayRotate180:!!f.displayRotate180}]));
  const echo=Object.assign(Object.create(EchoModule.prototype),{
   donor,baseFrames,flowFrames:Object.fromEntries(flow.presets.map(p=>[p.id,p.world])),longestMm:referenceMm,
   planeReview,referenceAnatomy,anatomyLoadError:false,
   state:{mode:'tee',preset:'deeptg5c',planeReference:'refined',offsetMm:0,rotationDeg:0,tiltDeg:0,flip:false},
  });
  echo.rebuildAtlasFrames();
  const plane=echo.getPlane(),pose=plane.acquisitionPose,model=echo.anatomyContext();
  assert.ok(pose,`${donor.id}: contained default estimate`);
  assert.equal(pose.contextFit.apicalGuide,true);
  assert.ok(model.frame.landmarksMm.aorticRoot,`${donor.id}: reviewed root-region target`);
  for(const key of ['apex','aorticRoot']){
   const p=model.frame.landmarksMm[key],relative=sub(p,pose.originMm),forward=dot(relative,pose.beam);
   const residual=Math.abs(dot(sub(p,plane.center.map(x=>x*referenceMm)),plane.normal));
   const angle=Math.atan2(Math.abs(dot(relative,pose.right)),forward)*180/Math.PI;
   assert.ok(residual<1e-5,`${donor.id}/${key}: actual source target misses the accepted section by ${residual}mm`);
   assert.ok(forward>0&&angle<=38&&Math.hypot(...relative)<=pose.sectorDepthMm+1e-5,`${donor.id}/${key}: target outside actual scan sector`);
  }
 }
});
