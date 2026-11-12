#!/usr/bin/env node
/** Reproducible exact default-reference rasters from the existing fine banks.
 * No network acquisition, source edits, anatomical fitting or browser mocks.
 * Missing inputs are reported explicitly; incomplete donors get no final manifest.
 */
import assert from 'node:assert/strict';
import {readFile,mkdir,lstat,rename,unlink,link,open} from 'node:fs/promises';
import {resolve,join,relative,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {FineVolumeBackend} from '../../public/ultra-volume-backend.js';
import {FineSectionStore} from '../../public/fine-section-store.js';
import {planFinePlane,validFinePlane,sameFinePlane} from '../../public/ultra-volume-core.js';
import {fullEchoCutFacePlane,validateEchoFineSection} from '../../public/echo-cut-face.js';
import {DONORS} from '../../public/donors.js';
import {TTE_ATLAS_VIEWS} from '../../public/tte-atlas-data.js';
import {TEE_ATLAS_VIEWS} from '../../public/tee-atlas-data.js';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const MiB=1024*1024,SCHEMA=1,SAMPLER='trilinear-u8-positive-halo-v1';
const GZIP_LEVEL=9,CODEC='gzip-r8-delta-v1';
const MAX_RASTER=12*MiB,MAX_ENCODED=MAX_RASTER+65536;
const SOURCES={
 'ladaf-2021-17':{manifest:'public/assets/ultra-volume-v7.json',directory:'data/ultra-volume-v7'},
 's-20-29':{manifest:'public/assets/donors/s-20-29/ultra-volume.json',directory:'data/donors/s-20-29/ultra-volume'},
 's-20-28':{manifest:'public/assets/donors/s-20-28/ultra-volume.json',directory:'data/donors/s-20-28/ultra-volume'},
};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const jsonBytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const timestamp=()=>new Date().toISOString();
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const plainPlane=plane=>validFinePlane(plane);
const close=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-9;
const sameNumbers=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>close(v,b[i]));
const safeChild=(root,path)=>{
 if(typeof path!=='string'||!path||path.includes('\\')||path.startsWith('/')||path.split('/').some(p=>!p||p==='.'||p==='..'))throw new Error('Unsafe manifest path.');
 const target=resolve(root,path),rel=relative(resolve(root),target);
 if(rel==='..'||rel.startsWith('../'))throw new Error('Manifest path escaped its source root.');
 return target;
};
async function readJson(path){return JSON.parse(await readFile(path,'utf8'));}
async function optionalJson(path){try{return await readJson(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function atomicWrite(path,bytes){
 await mkdir(dirname(path),{recursive:true});
 const temporary=path+'.part-'+process.pid+'-'+randomBytes(6).toString('hex');
 let handle;
 try{handle=await open(temporary,'wx');await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;await rename(temporary,path);}
 finally{await handle?.close().catch(()=>{});await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function immutableWrite(path,bytes){
 await mkdir(dirname(path),{recursive:true});
 try{const old=await readFile(path);assert.ok(old.equals(bytes),'Immutable output conflict: '+path);return;}
 catch(error){if(error.code!=='ENOENT')throw error;}
 const temporary=path+'.part-'+process.pid+'-'+randomBytes(6).toString('hex');
 let handle;
 try{
  handle=await open(temporary,'wx');await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
  try{await link(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;assert.ok((await readFile(path)).equals(bytes),'Concurrent immutable output conflict.');}
 }finally{await handle?.close().catch(()=>{});await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
function parseArgs(args){
 const options={sourceRoot:ROOT,output:join(ROOT,'data/reference-sections-v57'),urlPrefix:'/assets/reference-sections-v57/',donor:null,inspectOnly:false,maxRasters:Infinity};
 for(let i=0;i<args.length;i++){
  const argument=args[i];
  if(argument==='--help'||argument==='-h'){options.help=true;continue;}
  if(argument==='--inspect-only'){options.inspectOnly=true;continue;}
  if(!argument.startsWith('--'))throw new Error('Unexpected argument: '+argument);
  const split=argument.indexOf('='),key=split<0?argument:argument.slice(0,split),value=split<0?args[++i]:argument.slice(split+1);
  if(!value||value.startsWith('--'))throw new Error('Missing value for '+key);
  const names={'--planes':'planes','--source-root':'sourceRoot','--output':'output','--report':'report','--url-prefix':'urlPrefix','--donor':'donor','--max-rasters':'maxRasters','--reencode-from':'reencodeFrom'};
  if(!names[key])throw new Error('Unknown option: '+key);options[names[key]]=value;
 }
 if(options.help)return options;
 if(!options.planes)throw new Error('--planes must identify an export from export-planes.mjs.');
 if(options.donor&&!SOURCES[options.donor])throw new Error('Unknown donor.');
 if(!/^\/[a-zA-Z0-9/_-]+\/$/.test(options.urlPrefix)||options.urlPrefix.includes('//'))throw new Error('Use a same-origin absolute URL prefix ending in /.');
 options.maxRasters=Number(options.maxRasters);if(!(options.maxRasters>0)||(!Number.isSafeInteger(options.maxRasters)&&options.maxRasters!==Infinity))throw new Error('--max-rasters must be a positive integer.');
 for(const key of ['planes','sourceRoot','output'])options[key]=resolve(options[key]);
 if(options.reencodeFrom){options.reencodeFrom=resolve(options.reencodeFrom);assert.notEqual(options.reencodeFrom,options.output,'Lossless reencoding needs a separate output bank.');}
 options.report=resolve(options.report||join(options.output,options.donor||'', 'coverage.json'));
 for(const source of Object.values(SOURCES)){
  const bank=join(options.sourceRoot,source.directory),rel=relative(bank,options.output);
  if(!rel||!rel.startsWith('..'))throw new Error('Output must not be inside an immutable input bank.');
 }
 return options;
}

async function validateExport(exported){
 assert.equal(exported.schemaVersion,SCHEMA);assert.equal(exported.kind,'heart-reference-planes-v57');
 assert.equal(exported.sources?.length,3);assert.equal(exported.rows?.length,168);
 assert.ok(exported.sourceHashes&&Object.keys(exported.sourceHashes).length>0,'Plane export has no source provenance.');
 for(const [path,digest] of Object.entries(exported.sourceHashes)){
  assert.ok(hex(digest),'Invalid plane-export source checksum.');
  assert.equal(sha(await readFile(safeChild(ROOT,path))),digest,'Source changed since plane export: '+path);
 }
 const donors=new Map(DONORS.map(d=>[d.id,d])),views=new Map([...TTE_ATLAS_VIEWS,...TEE_ATLAS_VIEWS].map(v=>[v.id,v]));
 const sourceIds=new Set(),rowIds=new Set(),prepared=new Map();
 for(const source of exported.sources){
  const config=SOURCES[source.donorId],donor=donors.get(source.donorId);assert.ok(config&&donor,'Unknown source.');
  assert.ok(!sourceIds.has(source.donorId),'Duplicate source.');sourceIds.add(source.donorId);
  assert.equal(String(source.datasetId),String(donor.datasetId));assert.equal(source.fineManifest,config.manifest);assert.equal(source.sampler,SAMPLER);
  const bytes=await readFile(join(ROOT,config.manifest));assert.equal(sha(bytes),source.fineManifestSha256,'Fine manifest changed since plane export.');
  const manifest=JSON.parse(bytes);assert.equal(manifest.cleaned,true);assert.equal(manifest.quantitativeIntensityData,false);
  assert.equal(manifest.sourceMaskSha256,source.sourceMaskSha256);assert.equal(manifest.sourceSpacingUm,source.sourceSpacingUm);
  assert.ok(close(manifest.longestMm,source.longestMm));assert.ok(close(source.referenceMm,source.longestMm));
  for(const key of ['sourceOriginXYZ','sourceShapeXYZ','fullDimensionsXYZ','sourceWindow'])assert.deepEqual(manifest[key],source[key]);
  const store=new FineSectionStore(manifest,{baseUrl:'https://reference-sections.invalid/',cacheStorage:null});assert.equal(await store.identity(),source.sourceKey,'Fine source identity mismatch.');
  for(const [id,record] of Object.entries(manifest.blocks)){
   assert.ok(/^\d+$/.test(id)&&/^(?:\d{2}\/){2}\d{2}\.gz$/.test(record.path),'Unexpected fine-block path.');
   assert.ok(Number.isSafeInteger(record.bytes)&&record.bytes>0&&record.bytes<=MiB&&hex(record.sha256)&&hex(record.rawSha256),'Invalid fine-block record.');
  }
  prepared.set(source.donorId,{source,manifest,store,config,rows:[],rasters:[],needed:new Map()});
 }
 for(const row of exported.rows){
  const current=prepared.get(row.donorId),view=views.get(row.viewId),id=row.donorId+'/'+row.mode+'/'+row.viewId;
  assert.ok(current&&view&&view.mode===row.mode&&!rowIds.has(id),'Unknown or duplicated view.');rowIds.add(id);
  assert.equal(row.sourceKey,current.source.sourceKey);assert.equal(String(row.datasetId),String(current.source.datasetId));assert.equal(row.planeReference,'refined');
  current.rows.push(row);
  if(row.outsideScan){assert.equal(row.ct,null);assert.equal(row.face,null);assert.ok(row.outsideReason);continue;}
  assert.ok(row.state&&row.state.offsetMm===0&&row.state.rotationDeg===0&&row.state.tiltDeg===0,'Only unmodified default planes can be prepared.');
  const accepted=plainPlane(row.acceptedPlane);
  assert.ok(sameFinePlane(accepted,row.ct.plane,1e-12),'CT crop differs from accepted plane.');
  const full=fullEchoCutFacePlane(accepted,current.source.extent,{paddingWorld:2*current.source.sourceSpacingUm/(current.source.longestMm*1000)});
  assert.ok(sameFinePlane(full,row.face.plane,1e-12),'Full face differs from production coverage.');
  for(const role of ['ct','face']){
   const record=row[role];assert.ok(record&&record.cleaned===true);
   const plan=planFinePlane(current.manifest,record.plane,{spacingUm:current.source.sourceSpacingUm});
   assert.equal(record.width,plan.width);assert.equal(record.height,plan.height);assert.equal(record.decodedBytes,plan.width*plan.height);
   assert.ok(record.decodedBytes<=MAX_RASTER&&sameNumbers(record.spacingUmXY,plan.spacingUmXY));assert.equal(record.sourceSpacingUm,current.source.sourceSpacingUm);
   const wanted=plan.blocks.map(b=>b.id).sort(),listed=[...record.sourceBrickIds].map(String).sort();assert.deepEqual(listed,wanted,'Exported source brick union changed.');
   const descriptor=await current.store.descriptor(record.plane,plan);
   current.rasters.push({row,role,spec:record,descriptor});
   for(const block of plan.blocks)current.needed.set(block.id,block.record);
  }
 }
 for(const current of prepared.values()){
  assert.equal(current.rows.length,56);assert.equal(current.rows.filter(r=>!r.outsideScan).length,49);assert.equal(current.rasters.length,98);
 }
 return prepared;
}
async function inspectInputs(current,sourceRoot){
 const directory=join(sourceRoot,current.config.directory),available=new Set(),missing=[],invalid=[];
 let exists=true;try{const stat=await lstat(directory);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink(),'Source bank root must be an ordinary directory.');}catch(error){if(error.code==='ENOENT')exists=false;else throw error;}
 for(const [id,record] of current.needed){
  if(!exists){missing.push(id);continue;}
  try{const stat=await lstat(safeChild(directory,record.path));
   if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==record.bytes)invalid.push(id);else available.add(id);
  }catch(error){if(error.code==='ENOENT')missing.push(id);else throw error;}
 }
 return {directory,available,missing,invalid,summary:{requiredBlocks:current.needed.size,requiredEncodedBytes:[...current.needed.values()].reduce((s,r)=>s+r.bytes,0),sizeMatchedLocalBlocks:available.size,missingBlocks:missing.length,invalidSizeOrTypeBlocks:invalid.length,initialHashVerification:'Encoded and decoded hashes are checked by the production backend when each source block is used.',missingExamples:missing.slice(0,8).map(id=>current.needed.get(id).path),invalidExamples:invalid.slice(0,8).map(id=>current.needed.get(id).path)}};
}
function localBackend(current,directory,verified){
 const byPath=new Map([...current.needed].map(([id,r])=>[current.manifest.assetBaseUrl+r.path,{id,record:r}]));
 return new FineVolumeBackend({...current.manifest,preparedPlanes:[]},{
  baseUrl:'https://reference-sections.invalid/',decodedLimit:256*MiB,transferPolicy:{foreground:8,background:1},
  sectionStore:{async get(){return null;},save(){return false;},getStatus(){return {}; }},
  fetcher:async(url,{signal}={})=>{
   signal?.throwIfAborted();const parsed=new URL(url);assert.equal(parsed.origin,'https://reference-sections.invalid');
   const item=byPath.get(parsed.pathname);assert.ok(item,'Sampler requested an unlisted source block.');
   assert.equal(parsed.searchParams.get('v'),item.record.sha256.slice(0,16));
   const path=safeChild(directory,item.record.path),stat=await lstat(path);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size===item.record.bytes,'Source file is missing or its size changed.');
   const encoded=await readFile(path);signal?.throwIfAborted();assert.equal(encoded.length,item.record.bytes);assert.equal(sha(encoded),item.record.sha256,'Immutable encoded source checksum failed.');
   verified.add(item.id);
   return new Response(encoded,{headers:{'content-type':'application/octet-stream','content-length':String(encoded.length)}});
  },
 });
}
function rowDeltaEncode(pixels,width){
 const filtered=Buffer.allocUnsafe(pixels.length);
 for(let start=0;start<pixels.length;start+=width){filtered[start]=pixels[start];for(let column=1;column<width;column++){const index=start+column;filtered[index]=(pixels[index]-pixels[index-1])&255;}}
 return filtered;
}
function decodePixels(encoded,record){
 const pixels=gunzipSync(encoded,{maxOutputLength:record.decodedBytes});assert.equal(pixels.length,record.decodedBytes);
 if(record.codec===CODEC)for(let start=0;start<pixels.length;start+=record.width)for(let column=1;column<record.width;column++){const index=start+column;pixels[index]=(pixels[index]+pixels[index-1])&255;}
 else assert.equal(record.codec,'gzip-r8','Unsupported prior-bank codec.');
 return pixels;
}
async function verifyOutput(record,options,current,spec,{allowLegacy=false}={}){
 assert.ok(record.codec===CODEC||(allowLegacy&&record.codec==='gzip-r8'),'Unexpected bank codec.');assert.equal(record.cleaned,true);assert.ok(hex(record.sha256)&&hex(record.pixelSha256));
 assert.equal(record.width,spec.width);assert.equal(record.height,spec.height);assert.equal(record.decodedBytes,spec.decodedBytes);assert.equal(record.sourceSpacingUm,current.source.sourceSpacingUm);
 assert.ok(sameFinePlane(record.plane,spec.plane,1e-12)&&sameNumbers(record.spacingUmXY,spec.spacingUmXY));
 const prefix=options.urlPrefix+'rasters/';assert.equal(record.url,prefix+record.sha256+'.r8.gz');
 const target=join(options.output,'rasters',record.sha256+'.r8.gz'),stat=await lstat(target);assert.ok(stat.isFile()&&!stat.isSymbolicLink());
 assert.ok(Number.isSafeInteger(record.bytes)&&record.bytes>0&&record.bytes<=MAX_ENCODED&&stat.size===record.bytes);
 const encoded=await readFile(target);assert.equal(sha(encoded),record.sha256,'Prepared payload checksum failed.');
 const pixels=decodePixels(encoded,record);assert.equal(sha(pixels),record.pixelSha256,'Prepared pixel checksum failed.');
 return pixels;
}

async function priorBank(current,options,generationIdentity){
 if(!options.reencodeFrom)return null;
 const directory=join(options.reencodeFrom,current.source.donorId),bytes=await readFile(join(directory,'manifest.json')),manifest=JSON.parse(bytes);
 assert.equal(manifest.schemaVersion,SCHEMA);assert.equal(manifest.kind,'heart-reference-sections-v57');
 const expected={donorId:current.source.donorId,datasetId:String(current.source.datasetId),sourceKey:current.source.sourceKey,sourceMaskSha256:current.source.sourceMaskSha256,sourceSpacingUm:current.source.sourceSpacingUm,longestMm:current.source.longestMm};
 assert.deepEqual(manifest.source,expected);assert.equal(manifest.views.length,56);
 const checkpointBytes=await readFile(join(directory,'checkpoint.json')),checkpoint=JSON.parse(checkpointBytes);
 for(const key of ['sampler','samplerFiles','planesSha256'])assert.deepEqual(checkpoint.identity[key],generationIdentity[key],'Prior bank is bound to a different sampler or frozen export.');
 assert.equal(checkpoint.identity.sourceKey,current.source.sourceKey);
 const views=new Map(manifest.views.map(v=>[v.mode+'/'+v.viewId,v]));assert.equal(views.size,56);
 for(const row of current.rows){const view=views.get(row.mode+'/'+row.viewId);assert.ok(view);assert.equal(view.outsideScan,row.outsideScan);assert.equal(view.outsideReason,row.outsideReason);if(row.outsideScan){assert.equal(view.ct,null);assert.equal(view.face,null);}else assert.ok(view.ct&&view.face,'Prior bank is incomplete.');}
 return {views,checkpoint,provenance:{manifestSha256:sha(bytes),checkpointSha256:sha(checkpointBytes),generationIdentity:checkpoint.identity}};
}

/** Prepare a copyable public tree only after every donor is complete. The
 * active public directory and repository files are never modified here. */
async function stageRuntimeFiles(prepared,options){
 const manifests=[],unavailable=[];
 for(const current of prepared.values()){
  const path=join(options.output,current.source.donorId,'manifest.json');
  let bytes;try{bytes=await readFile(path);}catch(error){if(error.code==='ENOENT'){unavailable.push(current.source.donorId);continue;}throw error;}
  const manifest=JSON.parse(bytes);
  assert.equal(manifest.kind,'heart-reference-sections-v57');assert.equal(manifest.schemaVersion,SCHEMA);
  const expected={donorId:current.source.donorId,datasetId:String(current.source.datasetId),sourceKey:current.source.sourceKey,sourceMaskSha256:current.source.sourceMaskSha256,sourceSpacingUm:current.source.sourceSpacingUm,longestMm:current.source.longestMm};
  assert.deepEqual(manifest.source,expected);assert.equal(manifest.views.length,56);
  const byView=new Map(manifest.views.map(v=>[v.mode+'/'+v.viewId,v]));assert.equal(byView.size,56);
  for(const row of current.rows){
   const view=byView.get(row.mode+'/'+row.viewId);assert.ok(view);assert.equal(view.outsideScan,row.outsideScan);
   if(row.outsideScan){assert.equal(view.ct,null);assert.equal(view.face,null);continue;}
   for(const role of ['ct','face'])await verifyOutput(view[role],options,current,row[role]);
  }
  manifests.push({current,manifest,bytes});
 }
 if(unavailable.length)return {ready:false,incompleteDonors:unavailable};
 const stage=join(options.output,'staged-public'),configuration={},files=[],rasters=new Map();
 for(const {current,manifest,bytes} of manifests){
  const donorId=current.source.donorId,name='assets/reference-sections-v57/'+donorId+'.json';
  await immutableWrite(join(stage,name),bytes);files.push({path:name,bytes:bytes.length,sha256:sha(bytes)});
  configuration[donorId]={manifestUrl:options.urlPrefix+donorId+'.json',manifestSha256:sha(bytes),expectedSource:manifest.source};
  for(const view of manifest.views)for(const role of ['ct','face'])if(view[role])rasters.set(view[role].sha256,view[role]);
 }
 for(const [digest,record] of rasters){
  const name='assets/reference-sections-v57/rasters/'+digest+'.r8.gz',target=join(stage,name);
  await mkdir(dirname(target),{recursive:true});
  try{await link(join(options.output,'rasters',digest+'.r8.gz'),target);}
  catch(error){if(error.code!=='EEXIST')throw error;assert.equal(sha(await readFile(target)),digest,'Staged payload changed.');}
  files.push({path:name,bytes:record.bytes,sha256:digest});
 }
 const module=Buffer.from('/** Verified default CT and full-face banks. Generated after all 147 acquired views completed. */\nexport const REFERENCE_SECTIONS=Object.freeze('+JSON.stringify(configuration,null,2)+');\n');
 await immutableWrite(join(stage,'reference-sections-v57.js'),module);files.push({path:'reference-sections-v57.js',bytes:module.length,sha256:sha(module)});
 const receipt={schemaVersion:SCHEMA,kind:'heart-reference-section-public-stage-v57',complete:true,donors:3,views:168,acquiredViews:147,outsideViews:21,rasterRoles:294,uniqueRasterPayloads:rasters.size,files};
 await immutableWrite(join(options.output,'staged-public-manifest.json'),jsonBytes(receipt));
 return {ready:true,directory:'staged-public',manifest:'staged-public-manifest.json',donors:3,rasterRoles:294,uniqueRasterPayloads:rasters.size,bytes:files.reduce((s,f)=>s+f.bytes,0)};
}

export async function generateSections(options){
 const exportedBytes=await readFile(options.planes),exported=JSON.parse(exportedBytes),prepared=await validateExport(exported);
 const samplerFiles={};for(const path of ['public/ultra-volume-core.js','public/ultra-volume-backend.js','public/fine-section-store.js'])samplerFiles[path]=sha(await readFile(join(ROOT,path)));
 const generationIdentity={schemaVersion:SCHEMA,sampler:SAMPLER,samplerFiles,planesSha256:sha(exportedBytes),urlPrefix:options.urlPrefix,
  compression:{codec:CODEC,filter:'per-row left difference modulo 256; first byte unchanged',level:GZIP_LEVEL,mtimeSeconds:0,implementation:'node:zlib',zlibVersion:process.versions.zlib}};
 const report={schemaVersion:SCHEMA,kind:'heart-reference-section-generation-qc-v57',createdAt:timestamp(),status:'incomplete',generationIdentity,
  generator:'scripts/reference-sections-v57/generate-sections.mjs',generatorSha256:sha(await readFile(fileURLToPath(import.meta.url))),
  mode:options.inspectOnly?'inspect-only':options.reencodeFrom?'lossless-reencoding':'generate',sourceAcquisition:'Local immutable manifest-listed fine banks, or an explicitly supplied and verified prior raster bank. This generator makes no network requests.',
  limits:{sourceSpacingUm:[79.4,79.56],maximumRasterBytes:MAX_RASTER,decodedBrickCacheBytes:256*MiB,concurrentSourceReads:8},
  scope:'Exact scalar CT crop and complete same-plane cut face for each supported default reference view. No anatomical or clinical validation claim.',donors:[],rows:[]};
 let generated=0,reencoded=0;
 for(const current of prepared.values()){
  const donorId=current.source.donorId;if(options.donor&&options.donor!==donorId)continue;
  const availability=await inspectInputs(current,options.sourceRoot),directory=join(options.output,donorId),checkpointPath=join(directory,'checkpoint.json'),prior=await priorBank(current,options,generationIdentity);
  const old=await optionalJson(checkpointPath),identity={...generationIdentity,sourceKey:current.source.sourceKey};
  if(old)assert.deepEqual(old.identity,identity,'Checkpoint belongs to another source, sampler or plane export. Use a new output directory.');
  const checkpoint=old||{schemaVersion:SCHEMA,kind:'heart-reference-section-checkpoint-v57',identity,donorId,results:{},measurements:{},updatedAt:timestamp()};
  checkpoint.measurements??={};
  checkpoint.provenance??={};if(prior){if(checkpoint.reencodedFrom)assert.deepEqual(checkpoint.reencodedFrom,prior.provenance);else checkpoint.reencodedFrom=prior.provenance;}
  const verified=new Set(),backend=localBackend(current,availability.directory,verified),checkedOutputs=new Set(),views=[];
  const donorReport={donorId,sourceKey:current.source.sourceKey,sourceSpacingUm:current.source.sourceSpacingUm,inputs:availability.summary,views:56,acquiredViews:49,outsideViews:7,expectedRasters:98,readyRasters:0,generatedRasters:0,reencodedRasters:0,reusedRasters:0,unavailableRasters:0,failedRasters:0,uniqueReadyPayloads:0};
  if(prior)donorReport.reencodedFrom=prior.provenance;
  report.donors.push(donorReport);
  for(const row of current.rows){
   const view={viewId:row.viewId,mode:row.mode,outsideScan:row.outsideScan,outsideReason:row.outsideReason,ct:null,face:null};views.push(view);
   const status={donorId,viewId:row.viewId,mode:row.mode,outsideScan:row.outsideScan,ct:row.outsideScan?'outside-scan':'pending',face:row.outsideScan?'outside-scan':'pending'};report.rows.push(status);
   if(row.outsideScan)continue;
   for(const role of ['ct','face']){
    const task=current.rasters.find(t=>t.row===row&&t.role===role),key=task.descriptor.key,spec=task.spec;
    let record=checkpoint.results[key];
    try{
     if(record){
      if(!checkedOutputs.has(key)){await verifyOutput(record,options,current,spec);checkedOutputs.add(key);}
      record={...record,plane:plainPlane(spec.plane)};view[role]=record;status[role]='ready-existing';donorReport.readyRasters++;donorReport.reusedRasters++;continue;
     }
     const previous=prior?.views.get(row.mode+'/'+row.viewId)?.[role],missing=spec.sourceBrickIds.filter(id=>!availability.available.has(String(id)));
     if(!previous&&missing.length){status[role]='unavailable-source-data';status[role+'MissingBlocks']=missing.length;donorReport.unavailableRasters++;continue;}
     if(options.inspectOnly){status[role]='source-files-present-generation-not-run';continue;}
     if(generated+reencoded>=options.maxRasters){status[role]='not-generated-run-limit';continue;}
     const started=performance.now();let result;
     if(previous){const pixels=await verifyOutput(previous,{...options,output:options.reencodeFrom},current,spec,{allowLegacy:true});result={data:pixels,width:spec.width,height:spec.height,plane:spec.plane,spacingUm:Math.max(...spec.spacingUmXY),spacingUmXY:spec.spacingUmXY,sourceSpacingUm:spec.sourceSpacingUm,complete:true,cleaned:true};}
     else result=await backend.samplePlane(spec.plane,{exactRaster:true,persistSection:false,spacingUm:current.source.sourceSpacingUm});
     const acquisitionElapsedMs=performance.now()-started;
     validateEchoFineSection(result,spec.plane);assert.equal(result.width,spec.width);assert.equal(result.height,spec.height);assert.ok(result.cleaned&&sameNumbers(result.spacingUmXY,spec.spacingUmXY));
     const pixels=Buffer.from(result.data.buffer,result.data.byteOffset,result.data.byteLength),pixelSha256=sha(pixels);
     const encoded=gzipSync(rowDeltaEncode(pixels,result.width),{level:GZIP_LEVEL});assert.equal(encoded.readUInt32LE(4),0,'Gzip timestamp must be deterministic.');assert.ok(encoded.length<=MAX_ENCODED);assert.ok(decodePixels(encoded,{codec:CODEC,width:result.width,decodedBytes:pixels.length}).equals(pixels),'Lossless round trip failed.');
     const digest=sha(encoded),target=join(options.output,'rasters',digest+'.r8.gz');await immutableWrite(target,encoded);
     record={codec:CODEC,url:options.urlPrefix+'rasters/'+digest+'.r8.gz',bytes:encoded.length,sha256:digest,pixelSha256,decodedBytes:pixels.length,width:result.width,height:result.height,spacingUmXY:[...result.spacingUmXY],sourceSpacingUm:result.sourceSpacingUm,cleaned:true,plane:plainPlane(spec.plane)};
     checkpoint.measurements[key]={...(previous?{priorPayloadReadDecodeElapsedMs:acquisitionElapsedMs,priorSourceSampling:prior.checkpoint.measurements?.[key]||null}:{sampleElapsedMs:acquisitionElapsedMs,backendSourceElapsedMs:result.sourceElapsedMs}),encodeAndWriteElapsedMs:performance.now()-started-acquisitionElapsedMs,encodedBytes:encoded.length,decodedBytes:pixels.length,measuredAt:timestamp()};
     checkpoint.provenance[key]=previous?{kind:'verified-lossless-reencoding',priorCodec:previous.codec,priorEncodedSha256:previous.sha256,unchangedPixelSha256:pixelSha256}:{kind:'production-fine-source-sampling'};
     checkpoint.results[key]=record;checkpoint.updatedAt=timestamp();await atomicWrite(checkpointPath,jsonBytes(checkpoint));checkedOutputs.add(key);
     view[role]=record;status[role]=previous?'ready-reencoded':'ready-generated';status[role+'ElapsedMs']=Math.round(performance.now()-started);donorReport.readyRasters++;if(previous){donorReport.reencodedRasters++;reencoded++;}else{donorReport.generatedRasters++;generated++;}
     console.log(JSON.stringify({donorId,viewId:row.viewId,role,action:previous?'reencoded':'sampled',completedRasters:donorReport.readyRasters,expectedRasters:98,decodedBytes:record.decodedBytes,encodedBytes:record.bytes,sourceSpacingUm:record.sourceSpacingUm,pixelSha256:record.pixelSha256}));
    }catch(error){
     status[role]='failed';status[role+'Error']=String(error.message).replaceAll(options.sourceRoot,'<source-root>').replaceAll(options.output,'<output>');donorReport.failedRasters++;
     report.status='failed';await atomicWrite(options.report,jsonBytes(report));throw error;
    }
   }
  }
  donorReport.sourceBlocksEncodedVerifiedThisRun=verified.size;
  donorReport.decodedSourceHashVerification=donorReport.generatedRasters?'The production backend verified every decoded block used by newly generated rasters.':'No new source rasters were sampled during this run.';
  const records=views.flatMap(v=>[v.ct,v.face]).filter(Boolean),unique=new Map(records.map(r=>[r.sha256,r]));
  donorReport.uniqueReadyPayloads=unique.size;donorReport.uniqueEncodedBytes=[...unique.values()].reduce((s,r)=>s+r.bytes,0);donorReport.uniqueDecodedBytes=[...unique.values()].reduce((s,r)=>s+r.decodedBytes,0);
  donorReport.complete=donorReport.readyRasters===98;
  if(donorReport.complete){
   const source={donorId,datasetId:String(current.source.datasetId),sourceKey:current.source.sourceKey,sourceMaskSha256:current.source.sourceMaskSha256,sourceSpacingUm:current.source.sourceSpacingUm,longestMm:current.source.longestMm};
   const manifest={schemaVersion:SCHEMA,kind:'heart-reference-sections-v57',source,views};
   const bytes=jsonBytes(manifest);await immutableWrite(join(directory,'manifest.json'),bytes);donorReport.manifest={path:donorId+'/manifest.json',bytes:bytes.length,sha256:sha(bytes)};
  }
  await atomicWrite(options.report,jsonBytes(report));
 }
 report.status=report.donors.every(d=>d.complete)?'complete':report.donors.some(d=>d.failedRasters)?'failed':'incomplete';
 report.totals={views:report.donors.reduce((s,d)=>s+d.views,0),acquiredViews:report.donors.reduce((s,d)=>s+d.acquiredViews,0),outsideViews:report.donors.reduce((s,d)=>s+d.outsideViews,0),expectedRasters:report.donors.reduce((s,d)=>s+d.expectedRasters,0),readyRasters:report.donors.reduce((s,d)=>s+d.readyRasters,0),generatedRasters:generated,reencodedRasters:reencoded,unavailableRasters:report.donors.reduce((s,d)=>s+d.unavailableRasters,0),uniqueReadyPayloads:report.donors.reduce((s,d)=>s+d.uniqueReadyPayloads,0),uniqueEncodedBytes:report.donors.reduce((s,d)=>s+d.uniqueEncodedBytes,0)};
 report.publicStage=await stageRuntimeFiles(prepared,options);
 report.completedAt=timestamp();await atomicWrite(options.report,jsonBytes(report));
 console.log(JSON.stringify({status:report.status,...report.totals,report:options.report}));return report;
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 try{
  const options=parseArgs(process.argv.slice(2));
  if(options.help)console.log('Usage: node scripts/reference-sections-v57/generate-sections.mjs --planes EXPORT.json [--source-root ROOT_CONTAINING_DATA] [--output NEW_BANK_DIRECTORY] [--report QC.json] [--donor ID] [--inspect-only] [--max-rasters N] [--reencode-from VERIFIED_BANK_DIRECTORY] [--url-prefix /assets/reference-sections-v57/]\nMissing source files remain unavailable; an incomplete run exits 2. All source and output bytes are verified before use. Only complete donors receive final manifests; the public stage requires all three donors. Reencoding preserves original pixel hashes and records prior-bank provenance without resampling.');
  else{const report=await generateSections(options);if(report.status!=='complete')process.exitCode=2;}
 }catch(error){console.error(error.stack||error.message);process.exitCode=1;}
}
