/** Export the initialized production Reference Views planes without rendering,
 * sampling source volumes, fetching data, or changing geometry. Outputs are
 * generation inputs, never substitutes for measured source pixels.
 *
 * node scripts/reference-sections-v57/export-planes.mjs --out=/absolute/planes.json
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {EchoModule,ECHO_PRESETS} from '../../public/echo.js';
import {DONORS} from '../../public/donors.js';
import {decodeEchoReferenceAnatomy} from '../../public/echo-anatomy-context-v2.js';
import {validateTeeRefinements} from '../../public/tee-view-refinement.js';
import {fullEchoCutFacePlane} from '../../public/echo-cut-face.js';
import {planFinePlane,validFinePlane,finePlaneKey,sameFinePlane} from '../../public/ultra-volume-core.js';
import {FineSectionStore} from '../../public/fine-section-store.js';

const root=fileURLToPath(new URL('../../',import.meta.url));
const option=(name,fallback)=>process.argv.find(arg=>arg.startsWith(`--${name}=`))?.slice(name.length+3)||fallback;
const output=resolve(option('out','/tmp/heart-reference-planes-v57.json'));
const bytes=path=>readFile(join(root,path));
const json=async path=>JSON.parse(await bytes(path));
const hash=data=>createHash('sha256').update(data).digest('hex');
const publicPath=url=>'public/'+url.replace(/^\.\//,'').split('?')[0];
const sourceFiles=[
 'public/echo.js','public/echo-cut-face.js','public/donors.js',
 'public/echo-donor-planes.js','public/echo-donor-calibration.js','public/echo-donor-support.js',
 'public/tte-atlas-data.js','public/tee-atlas-data.js','public/tte-atlas-geometry.js',
 'public/tee-atlas-geometry.js','public/echo-acquisition-geometry.js',
 'public/echo-correspondence.js','public/tee-view-refinement.js',
 'public/tee-context-geometry.js','public/echo-anatomy-context-v2.js',
 'public/echo-instrument-clearance.js','public/echo-tte-guidance.js',
 'public/ultra-volume-core.js','public/fine-section-store.js',
 'public/assets/tee-atlas/plane-fit-v2.json',
 'public/assets/probe-context-v11/manifest.json','public/assets/probe-context-v11/torso.bin.gz',
 ...DONORS.flatMap(d=>[d.manifestUrl,d.echoPlanesUrl,d.echoTexturesUrl,d.flowViewsUrl,d.ultraVolumeManifestUrl].map(publicPath)),
];
const fingerprints=async()=>Object.fromEntries(await Promise.all([...new Set(sourceFiles)].map(async path=>[path,hash(await bytes(path))])));
const before=await fingerprints();
const [referenceAnatomy,review]=await Promise.all([
 decodeEchoReferenceAnatomy({manifestBytes:await bytes('public/assets/probe-context-v11/manifest.json'),compressedBytes:await bytes('public/assets/probe-context-v11/torso.bin.gz')}),
 json('public/assets/tee-atlas/plane-fit-v2.json').then(validateTeeRefinements),
]);
const sources=[],rows=[];
for(const donor of DONORS){
 const [manifest,fine,frames,flow,textures]=await Promise.all([donor.manifestUrl,donor.ultraVolumeManifestUrl,donor.echoPlanesUrl,donor.flowViewsUrl,donor.echoTexturesUrl].map(url=>json(publicPath(url))));
 const nodes=new Map();
 const controller=Object.assign(Object.create(EchoModule.prototype),{
  donor,state:{mode:'tte',preset:'a4c',planeReference:'refined',offsetMm:0,rotationDeg:0,tiltDeg:0,flip:false},
  fineSpacingUm:donor.fineSpacingUm,referenceAnatomy,planeReview:review,active:false,requestId:0,
  mount:{querySelector:()=>null},renderer:{settings:{}},cancelFine(){},updateUI(){},
  $(id){if(!nodes.has(id))nodes.set(id,{textContent:'',hidden:false});return nodes.get(id);},
 });
 controller.setVolume(new Uint8Array(0),manifest.levels.high);
 const rawExtent=manifest.levels.high.dimensions.map((n,i)=>(n-1)*(Array.isArray(manifest.levels.high.spacingUm)?manifest.levels.high.spacingUm[i]:manifest.levels.high.spacingUm));
 const longest=Math.max(...rawExtent),extent=[rawExtent[0]/longest,rawExtent[2]/longest,rawExtent[1]/longest];
 controller.renderer.extent=extent;
 controller.setFrames(frames);controller.setAtlasFlowFrames(flow);
 const sourceKey=await new FineSectionStore(fine,{cacheStorage:null}).identity();
 const source={donorId:donor.id,datasetId:String(donor.datasetId),sourceKey,
  sampler:'trilinear-u8-positive-halo-v1',sourceMaskSha256:fine.sourceMaskSha256,
  sourceSpacingUm:fine.sourceSpacingUm,sourceWindow:fine.sourceWindow,
  sourceOriginXYZ:fine.sourceOriginXYZ,sourceShapeXYZ:fine.sourceShapeXYZ,
  fullDimensionsXYZ:fine.fullDimensionsXYZ,longestMm:fine.longestMm,
  referenceMm:controller.longestMm,extent,
  fineManifest:publicPath(donor.ultraVolumeManifestUrl),fineManifestSha256:before[publicPath(donor.ultraVolumeManifestUrl)],
  displayManifest:publicPath(donor.manifestUrl),displayManifestSha256:before[publicPath(donor.manifestUrl)],
  planeRevision:controller.getState().donorPlaneRevision||null,
 };
 sources.push(source);
 for(const view of ECHO_PRESETS){
  Object.assign(controller.state,{mode:view.mode,preset:view.id,planeReference:'refined',offsetMm:0,rotationDeg:0,tiltDeg:0,flip:false});
  controller.rebuildAtlasFrames();
  const accepted=controller.getPlane();
  if(!accepted)throw new Error(`Missing accepted plane: ${donor.id}/${view.id}`);
  const outsideScan=!!controller.frames[view.id].outsideScan;
  const base={donorId:donor.id,datasetId:String(donor.datasetId),sourceKey,viewId:view.id,mode:view.mode,name:view.name,
   planeReference:'refined',state:{offsetMm:0,rotationDeg:0,tiltDeg:0,flip:false},
   outsideScan,outsideReason:outsideScan?(controller.frames[view.id].note||'The required extracardiac target is outside this isolated-heart acquisition.'):null,
   acceptedPlane:accepted,acquisitionAvailable:!!accepted.acquisitionPose,
   sourcePlaneRetained:accepted.acquisition?.sourcePlaneRetained===true,
   atlasDerived:!!accepted.atlasDerived,
   legacyTextureEligible:!outsideScan&&!accepted.atlasDerived&&!!textures.textures?.[view.id]?.url,
  };
  if(outsideScan){rows.push({...base,ct:null,face:null});continue;}
  const face=fullEchoCutFacePlane(accepted,extent,{paddingWorld:2*donor.fineSpacingUm/(controller.longestMm*1000)});
  const record=plane=>{
   const plan=planFinePlane(fine,plane,{spacingUm:donor.fineSpacingUm});
   return {plane:validFinePlane(plane),planeKey:finePlaneKey(plane),width:plan.width,height:plan.height,
    decodedBytes:plan.width*plan.height,spacingUmXY:plan.spacingUmXY,spacingUm:Math.max(...plan.spacingUmXY),
    sourceSpacingUm:fine.sourceSpacingUm,cleaned:true,brickCount:plan.blocks.length,
    sourceBrickIds:plan.blocks.map(block=>block.id),
    existingPreparedMatches:(fine.preparedPlanes||[]).filter(item=>sameFinePlane(item.plane,plane,1e-8)).map(item=>item.id)};
  };
  rows.push({...base,ct:record(accepted),face:record(face)});
 }
 console.log(JSON.stringify({donorId:donor.id,views:rows.filter(r=>r.donorId===donor.id).length,acquired:rows.filter(r=>r.donorId===donor.id&&!r.outsideScan).length,sourceKey}));
}
const after=await fingerprints(),changed=Object.keys(before).filter(path=>before[path]!==after[path]);
if(changed.length)throw new Error(`Source changed during export: ${changed.join(', ')}`);
if(rows.length!==168||rows.filter(row=>!row.outsideScan).length!==147)throw new Error('Unexpected Reference Views coverage; review before generation.');
const report={schemaVersion:1,kind:'heart-reference-planes-v57',createdAt:new Date().toISOString(),
 scope:'Initialized production EchoModule.getPlane() defaults with loaded source review and fixed anatomy. Full-face crops use production fullEchoCutFacePlane(); all raster plans use production planFinePlane(). Source pixels have not been sampled by this export. Geometry, masks, shading, probes and clinical correspondence are unchanged.',
 sourceIdentityConvention:'FineSectionStore.identity()',sourceHashes:before,sources,rows};
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,views:rows.length,acquired:147,outside:21,roles:294,sourceStable:true}));
