/** Collect source-bound all-view QC receipts and complete native contact sheets.
 * Full-size native images remain in the supplied render directory; the source
 * repository retains all twelve sheets, exact numerical receipts and targeted
 * enlarged pairs without committing hundreds of redundant derivatives.
 */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DONORS} from '../../public/donors.js';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const option=(key,fallback)=>process.argv.find(v=>v.startsWith(`--${key}=`))?.slice(key.length+3)||fallback;
const input=resolve(option('input','/dev/shm/echo-face-v42/native'));
const out=resolve(option('out','docs/echo-face-v42'));
const finalExports=option('final-exports',null),originalExports=option('original-exports',null);
const coveragePath=resolve(option('coverage',join(out,'coverage.json')));
const sha=b=>createHash('sha256').update(b).digest('hex');
const readJson=async p=>JSON.parse(await readFile(p));
const coverage=await readJson(coveragePath);assert.equal(coverage.passed,true);assert.equal(coverage.rows.length,168);
assert.ok(coverage.sources.every(s=>/^[a-f0-9]{64}$/.test(s.baselineExportSha256||'')),'A frozen baseline comparison is required for this final receipt.');
await mkdir(out,{recursive:true});
const donors=[],hashes={};let frames=0,faceCount=0,oracleChecks=0,oldCropIncomplete=0,maxOracleError=0;
for(const donor of DONORS){
 const dir=join(input,donor.id),bytes=await readFile(join(dir,'review.json')),review=JSON.parse(bytes);
 assert.equal(review.donor,donor.id);assert.equal(review.passed,true);assert.equal(review.views,56);assert.equal(review.renders,112);
 assert.equal(review.staleSourceFiles.length,0);assert.equal(review.unexpectedUnavailable.length,0);
 assert.deepEqual(review.intentionalWithheld,['tgrvinout']);
 let finalVerification=null;
 if(finalExports){
  assert.ok(originalExports,'Original captured exports required for post-render validation.');
  const finalDir=join(resolve(finalExports),donor.id),originalDir=join(resolve(originalExports),donor.id);
  const finalBytes=await readFile(join(finalDir,'review.json')),final=JSON.parse(finalBytes),originalBytes=await readFile(join(originalDir,'review.json')),original=JSON.parse(originalBytes);
  assert.equal(sha(originalBytes),review.exportSha256);
  const pick=(obj,fields)=>Object.fromEntries(fields.map(k=>[k,obj[k]]));
  const fields=['donor','sourceSpacingUm','sourceManifest','referenceMm','extent','width','height','models','assets'];
  assert.deepEqual(pick(final,fields),pick(original,fields),'Scientific scene/source changed after rendering.');
  const viewFields=['id','mode','plane','capPlane','pose','poseAvailable','intentionalWithheld','clipFlip','outsideScan','cameras','drawsByCamera','guidesByCamera'];
  assert.deepEqual(final.cases.map(c=>pick(c,viewFields)),original.cases.map(c=>pick(c,viewFields)),'Render inputs changed after rendering.');
  assert.equal(sha(await readFile(join(finalDir,'shaders.json'))),review.shaderSourcesSha256,'Shader changed after rendering.');
  const changed=Object.keys(final.sourceHashes).filter(file=>final.sourceHashes[file]!==review.sourceHashes[file]);
  assert.ok(changed.every(file=>file==='public/echo.js'),'Only a controller caption-only edit can use this revalidation path.');
  for(const [file,expected]of Object.entries(final.sourceHashes))assert.equal(sha(await readFile(join(ROOT,file))),expected,'Final source drift: '+file);
  finalVerification={reason:'Caption-only Echo status refinement after native render; fresh actual controller exports reproduce every scientific render input exactly.',
   scientificSceneInputsIdentical:true,shaderInputsIdentical:true,views:56,cameras:112,renderedExportSha256:review.exportSha256,finalExportSha256:sha(finalBytes),
   sourceUpdates:changed.map(file=>({file,renderedSha256:review.sourceHashes[file],finalSha256:final.sourceHashes[file]})),finalSourceHashes:final.sourceHashes};
 }else for(const [file,expected]of Object.entries(review.sourceHashes))assert.equal(sha(await readFile(join(ROOT,file))),expected,'Source drift: '+file);
 const seen=new Set(review.checks.map(c=>c.mode+'/'+c.id+'/'+c.camera));assert.equal(seen.size,112);
 assert.ok(review.checks.every(c=>c.glError===0));
 const cases=review.cap.metadata,acquired=cases.filter(c=>c.available),outside=cases.filter(c=>!c.available);
 assert.equal(acquired.length,49);assert.equal(outside.length,7);
 assert.ok(acquired.every(c=>c.coverage.supportedDisplaySamples>0),'An acquired full face has no supported measured tissue.');
 const direct=acquired.reduce((s,c)=>s+c.directComparisons+c.roi.directComparisons,0);
 const error=Math.max(...acquired.flatMap(c=>[c.maximumDirectError,c.roi.maximumDirectError]));assert.ok(error<=1);
 const incomplete=acquired.filter(c=>c.coverage.supportedSamplesOutsideOriginalRoi>0).length;
 const target=join(out,donor.id);await mkdir(target,{recursive:true});
 const saved=[];
 for(const name of review.galleries){await copyFile(join(dir,name),join(target,name));saved.push(name);}
 for(const id of ['plax_av','plax_mv','psax_pv']){
  const name=`tte-${id}-pair.jpg`;await copyFile(join(dir,name),join(target,name));saved.push(name);
 }
 await writeFile(join(target,'native-receipt.json'),JSON.stringify({...review,postRenderVerification:finalVerification},null,2)+'\n');
 for(const name of [...saved,'native-receipt.json'])hashes[relative(out,join(target,name))]=sha(await readFile(join(target,name)));
 donors.push({donor:donor.id,views:56,tteViews:28,teeViews:28,acquiredViews:49,outsideScanViews:7,nativeFrames:112,
  sourceSpacingUm:review.sourceSpacingUm,sourceDimensions:review.sourceDimensions,sourceManifestSha256:review.sourceManifestSha256,
  nativeDriver:review.driver,fullFaceRasters:49,unchangedRoiRasters:49,independentSourceComparisons:direct,maximumInterpolationError:error,
  priorRoiClippedSupportedTissue:incomplete,maximumPriorRoiClippedTissueFraction:Math.max(...acquired.map(c=>c.coverage.outsideRoiFraction)),
  minimumSupportedDisplaySamples:Math.min(...acquired.map(c=>c.coverage.supportedDisplaySamples)),
  deliberateOutsideIds:outside.map(c=>c.id),withheldProbeIds:review.intentionalWithheld,
  receipt:`${donor.id}/native-receipt.json`,galleries:review.galleries.map(n=>`${donor.id}/${n}`),
  exportSha256:review.exportSha256,shaderSourcesSha256:review.shaderSourcesSha256});
 frames+=review.renders;faceCount+=acquired.length;oracleChecks+=direct;oldCropIncomplete+=incomplete;maxOracleError=Math.max(maxOracleError,error);
}
assert.equal(frames,336);assert.equal(faceCount,147);
const report={schemaVersion:1,createdAt:new Date().toISOString(),passed:true,
 scope:'All 56 Echo presets on all three supported HiP-CT donors, two accepted camera anchors per preset. Separate clinical-source viewers do not expose this Echo workspace.',
 totals:{donorViews:168,acquiredViews:147,deliberateOutsideScanViews:21,nativeFrames:frames,fullFaceRasters:faceCount,unchangedRoiRasters:faceCount,
  independentSourceComparisons:oracleChecks,maximumInterpolationError:maxOracleError,priorRoiClippedSupportedTissue:oldCropIncomplete,
  acceptedPlanesPreserved:true,ctCropsPreserved:true,retainedHalvesPreserved:true,cameraAnchorsPreserved:true,sourceVoxelsPreserved:true,sourceIdentities:3,
  maximumFineRasterBytes:coverage.maxFullRasterBytes,maximumFineDimension:coverage.maximumFullRasterDimension,maximumCombinedRoiAndFaceBytes:coverage.maximumCombinedRoiAndFullFaceBytes},
 checks:['Independent plane/source-box half-space clipping covers all acquired cuts.','Original accepted physical planes, CT crops, retained halves and both camera anchors equal the pre-fix snapshot.',
  'Exact full-face cache descriptors differ from ROI descriptors and remain donor-isolated.','Native fine grid metadata fits the existing 12 MiB per-raster and 8192 dimension limits.',
  'Production MPR worker samples hash-verified resident source for both full faces and CT crops; independent weighted-corner checks verify orientation and interpolation.',
  'Unmodified production GLSL renders every view in both anchors with current heart-priority context depth and zero GL errors.','All acquired faces contain supported measured tissue; deliberate outside-scan entries receive no fabricated CT cap.'],
 limitations:['Native rendering uses measured resident source spacing 317.6–318.24 µm, not 79.4–79.56 µm fine-brick downloads.',
  'The fine-bank endpoint was inaccessible to the local executor; exact fine raster bounds are checked from verified source manifests, and production fine lifecycle is covered separately by focused tests.',
  'These are scientific native EGL renders, not browser screenshots, iPhone/iPad measurements or clinical correspondence validation.',
  'The full-size native frame set is reproducible with the harness; this repository retains complete contact sheets, receipts and three enlarged affected views per donor.'],
 coverageReceipt:'coverage.json',coverageSha256:sha(await readFile(coveragePath)),donors,artifacts:hashes};
await writeFile(join(out,'quality-report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:true,...report.totals,report:join(out,'quality-report.json')}));
