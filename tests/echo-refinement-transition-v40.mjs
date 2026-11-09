/** Completed interior geometry must survive the shared viewer's Echo transition.
 * Uses actual SHA-verified production masks and the real controller/draw hooks.
 * GL calls are recorded; this is not a full heart render or a browser test.
 */
import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {LocalSurfaceRefinementController, validateRefinementManifest} from '../public/local-surface-refinement.js';
import {FineSurfaceController, FineSurfacePass} from '../public/fine-surface.js';

const root=new URL('../',import.meta.url),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const paths={surface:'public/assets/display-compact-v29/surface-manifest.json',local:'public/assets/cleanup-v30/surface-manifest.json',atlas:'public/assets/reviewed-mask-v32/manifest.json'};
const bytes=Object.fromEntries(await Promise.all(Object.entries(paths).map(async([key,path])=>[key,await readFile(new URL(path,root))])));
const source=Object.fromEntries(Object.entries(bytes).map(([key,value])=>[key,JSON.parse(value)]));
const manifest=validateRefinementManifest(source.local,source.surface.extent),lod=source.surface.lods.find(item=>item.id==='gentle');
assert.equal(hash(bytes.local),source.atlas.sourceManifests.surface.sha256);
assert.deepEqual(source.atlas.extent,source.surface.extent);
const receipt={version:1,createdAt:new Date().toISOString(),testFile:'tests/echo-refinement-transition-v40.mjs',scope:'Actual production mask hashes and controller lifecycle, CPU exclusion, scene uniforms and recorded GL submissions. No complete mesh allocation, native render, browser or anatomical validation claim.',sources:Object.fromEntries(Object.entries(paths).map(([key,path])=>[key,{path,sha256:hash(bytes[key])}])),runtimeHashes:{},masks:[],cases:[]};
for(const path of ['public/local-surface-refinement.js','public/fine-surface.js','public/mesh-draw.js','tests/echo-refinement-transition-v40.mjs'])receipt.runtimeHashes[path]=hash(await readFile(new URL(path,root)));

function firstSetVoxel(data,mask,lower){
 const index=data.findIndex(value=>value!==0);assert.ok(index>=0,'Production mask must have an excluded voxel.');
 let bit=0;while(!(data[index]>>bit&1))bit++;
 const [sx,sy]=mask.storageDimensionsXYZ;
 return [(index%sx)*8+bit,Math.floor(index/sx)%sy,Math.floor(index/(sx*sy))].map((value,axis)=>value+lower[axis]);
}
const pieces=[];
for(const patch of manifest.patches){
 const asset=patch.lowBandMask,packed=await readFile(new URL('public/'+asset.url.slice(2),root)),data=new Uint8Array(gunzipSync(packed));
 assert.equal(packed.length,asset.compressedBytes);assert.equal(hash(packed),asset.sha256);
 assert.equal(data.length,asset.decodedBytes);assert.equal(hash(data),asset.decodedSha256);
 const atlasField=source.atlas.fields.findIndex(field=>field.id==='local:'+patch.id),field=source.atlas.fields[atlasField];
 assert.ok(atlasField>=0);assert.equal(field.sourceDecodedSha256,asset.decodedSha256);
 assert.deepEqual(field.lowerFullFineXYZ,patch.lowerFullFineXYZ);assert.deepEqual(field.dimensionsXYZ,asset.dimensionsXYZ);
 const sample=firstSetVoxel(data,asset,patch.lowerFullFineXYZ),q=sample.map((value,axis)=>value/(source.atlas.sourceFullDimensionsXYZ[axis]-1)),extent=source.surface.extent;
 const sampleWorld=[(q[0]-.5)*extent[0],(q[2]-.5)*extent[1],(.5-q[1])*extent[2]];
 pieces.push({...patch,mask:{...asset,data,lowerFullFineXYZ:patch.lowerFullFineXYZ},atlasField,indexCount:patch.surface.triangles*3,bounds:patch.surface.bounds,vao:{id:patch.id},sampleWorld});
 receipt.masks.push({id:patch.id,atlasField,decodedSha256:hash(data),sourceSampleXYZ:sample,triangles:patch.surface.triangles});
}
assert.equal(pieces.length,4);

const uniforms=new Proxy({},{get:(_target,name)=>name});
const node=()=>({textContent:'',hidden:false,disabled:false,dataset:{},setAttribute(name,value){this[name]=value;}});
function harness(){
 const records={draws:[],uniforms:{},deleted:[],fetches:[]};let vao;
 const forbidden=()=>assert.fail('A completed workspace transition must not allocate or upload geometry.');
 const gl=new Proxy({
  NO_ERROR:0,getError:()=>0,isContextLost:()=>false,getUniformLocation:(_program,name)=>name,
  uniform1i:(name,value)=>{records.uniforms[name]=value;},uniform3fv:(name,value)=>{records.uniforms[name]=Array.from(value);},
  bindVertexArray:value=>{vao=value;},drawElements:(_mode,count,_type,offset)=>records.draws.push({id:vao.id,count,offset,refinementReady:records.uniforms.refinementReady,patchPass:records.uniforms.refinementPatchPass,patchIndex:records.uniforms.refinementPatchIndex}),
  createBuffer:forbidden,createVertexArray:forbidden,bufferData:forbidden,texImage2D:forbidden,
  deleteBuffer:value=>records.deleted.push(value),deleteVertexArray:value=>records.deleted.push(value),deleteTexture:value=>records.deleted.push(value),
 },{get:(target,key)=>key in target?target[key]:String(key).toUpperCase()===key?key:()=>{}});
 const renderer={gl,extent:[...source.surface.extent],settings:{mode:0,threshold:.28,showPlanes:0,cleanupEnabled:true,lumenCleanupEnabled:true,debrisCleanupEnabled:true},lumenCleanup:{},reviewedMaskAtlas:{ready:true},requestRender(){},compositeScene(){}};
 const pass=Object.assign(Object.create(FineSurfacePass.prototype),{gl,enabled:true,manifest:source.surface,lod:{...lod},geometrySourceSha256:lod.sourceDecodedSha256,indexCount:lod.triangles*3,bounds:source.surface.bounds,vao:{id:'base'},target:{width:1,height:1},program:{},backgroundProgram:{},uniforms,nativeUniforms:uniforms,refinementUniforms:uniforms,boundsMin:'boundsMin',boundsMax:'boundsMax',debrisEnabled:'debrisCleanupEnabled',hasDebrisMask:true});
 renderer.fineSurface=pass;let fine;
 const local=new LocalSurfaceRefinementController({renderer,donor:{id:'ladaf-2021-17'},fetcher:(...args)=>{records.fetches.push(args);throw new Error('Completed geometry must not fetch again.');},onChange:()=>fine?.syncRefinement()});
 local.current={manifest,pieces};
 renderer.bindSceneUniforms=()=>local.bindScene(uniforms);
 fine=Object.assign(Object.create(FineSurfaceController.prototype),{renderer,localRefinement:local,lumenCleanup:{toggle:{checked:true}},workspaceActive:true,workspaceWaiters:new Set(),refinementStatus:node(),refinementRetry:node(),refinementNotice:node(),refinementNoticeText:node(),refinementNoticeRetry:node(),sync(){this.syncRefinement();}});
 const state=()=>{
  records.draws.length=0;local.bindScene(uniforms);pass.draw(renderer,1,1,{},1);fine.syncRefinement();
  const submitted=Object.fromEntries(['base',...pieces.map(piece=>piece.id)].map(id=>[id,records.draws.filter(draw=>draw.id===id).reduce((sum,draw)=>sum+draw.count,0)]));
  return {baseActive:pass.activeFor(renderer),retainedRegions:local.current?.pieces.length||0,interiorsActive:local.active(),refinementReady:records.uniforms.refinementReady,refinementCount:records.uniforms.refinementCount,atlasFields:pieces.map((_piece,index)=>records.uniforms['refinementField'+index]),excludedSourceSamples:pieces.map(piece=>local.excludedAt(piece.sampleWorld)),submittedIndices:submitted,status:fine.refinementNotice.dataset.state,noticeHidden:fine.refinementNotice.hidden};
 };
 return {renderer,local,pass,fine,records,state};
}
function check(name,fn){test(name,async()=>{try{await fn();receipt.cases.push({name,passed:true});}catch(error){receipt.cases.push({name,passed:false,error:error.message});throw error;}});}
after(async()=>{
 receipt.passed=receipt.cases.every(item=>item.passed);
 if(process.env.HEART_REFINEMENT_EVIDENCE){const path=process.env.HEART_REFINEMENT_EVIDENCE;await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(receipt,null,2)+'\n');}
});

check('completed base geometry, all four replacement surfaces and their masks survive Echo and return',()=>{
 const h=harness(),installed=h.local.current,states={reconstruction:h.state()};
 h.fine.setWorkspaceActive(false);states.echoTTE=h.state();
 h.fine.setWorkspaceActive(false);states.echoTEE=h.state();
 h.fine.setWorkspaceActive(true);states.returnToReconstruction=h.state();
 receipt.transitions=states;
 for(const [name,state]of Object.entries(states)){
  assert.equal(state.baseActive,true,name);assert.equal(state.retainedRegions,4,name);
  assert.equal(state.interiorsActive,true,name);assert.equal(state.refinementReady,1,name);assert.equal(state.refinementCount,4,name);
  assert.deepEqual(state.atlasFields,pieces.map(piece=>piece.atlasField),name);assert.deepEqual(state.excludedSourceSamples,[true,true,true,true],name);
  assert.deepEqual(state.submittedIndices,Object.fromEntries([['base',h.pass.indexCount],...pieces.map(piece=>[piece.id,piece.indexCount])]),name);
 }
 assert.equal(h.local.current,installed);assert.equal(h.local.current.pieces,pieces);
 for(const piece of pieces)assert.equal(hash(piece.mask.data),piece.lowBandMask.decodedSha256);
 assert.equal(h.records.fetches.length,0);assert.equal(h.records.deleted.length,0);
 for(const draw of h.records.draws){assert.equal(draw.refinementReady,1);assert.equal(draw.patchPass,draw.id==='base'?0:1);}
});

check('Echo reports completed interior geometry as ready without an unready overlay',()=>{
 const h=harness();h.fine.setWorkspaceActive(false);
 assert.equal(h.fine.refinementNotice.dataset.state,'active');assert.equal(h.fine.refinementNotice.hidden,true);
 assert.equal(h.fine.refinementNotice['aria-busy'],'false');assert.equal(h.fine.refinementNoticeText.textContent,'Prepared model ready');
 assert.match(h.fine.refinementStatus.textContent,/finalized interior surfaces and cleanup are loaded/);
 assert.equal(h.fine.refinementRetry.hidden,true);assert.equal(h.fine.refinementNoticeRetry.hidden,true);
});

check('source, cleanup, threshold, extent and mode compatibility remain required in Echo',()=>{
 const alterations=[
  ['cleanup',h=>{h.renderer.settings.cleanupEnabled=false;}],['lumen cleanup',h=>{h.renderer.settings.lumenCleanupEnabled=false;}],['debris cleanup',h=>{h.renderer.settings.debrisCleanupEnabled=false;}],
  ['mode',h=>{h.renderer.settings.mode=1;}],['planes',h=>{h.renderer.settings.showPlanes=1;}],['threshold',h=>{h.renderer.settings.threshold=.31;}],['extent',h=>{h.renderer.extent[0]+=.01;}],
  ['lumen data',h=>{h.renderer.lumenCleanup=null;}],['reviewed atlas',h=>{h.renderer.reviewedMaskAtlas.ready=false;}],['surface disabled',h=>{h.pass.enabled=false;}],
  ['profile',h=>{h.pass.lod.id='detail';}],['source identity',h=>{h.pass.geometrySourceSha256='0'.repeat(64);}],['coronaries',h=>{h.renderer.coronaryActive=()=>true;}],
 ];
 for(const [name,alter]of alterations){
  const h=harness();h.fine.setWorkspaceActive(false);const installed=h.local.current;alter(h);
  assert.equal(h.local.active(),false,name);h.local.bindScene(uniforms);assert.equal(h.records.uniforms.refinementReady,0,name);assert.equal(h.records.uniforms.refinementCount,0,name);
  h.local.draw(h.pass);assert.equal(h.records.draws.length,0,name);assert.ok(pieces.every(piece=>!h.local.excludedAt(piece.sampleWorld)),name);assert.equal(h.local.current,installed,name);
 }
});

check('leaving Reconstruction still aborts incomplete preparation and frees only staged resources',async()=>{
 const h=harness();h.local.current=null;let release,signal;
 h.local.fetcher=(_url,options)=>{signal=options.signal;return new Promise(resolve=>{release=()=>resolve(Response.json(manifest));});};
 const pending=h.local.ensure();await new Promise(resolve=>setImmediate(resolve));assert.ok(signal);assert.equal(signal.aborted,false);
 const staged={buffers:[{id:'staged-position'},{id:'staged-normal'},{id:'staged-index'}],vao:{id:'staged-vao'}};
 h.local.staging.push(staged);h.fine.setWorkspaceActive(false);
 assert.equal(signal.aborted,true);assert.equal(h.local.current,null);assert.equal(h.local.staging,null);assert.equal(h.local.loading,null);assert.equal(h.local.active(),false);
 assert.deepEqual(h.records.deleted,[...staged.buffers,staged.vao]);assert.equal(h.fine.refinementNotice.dataset.state,'paused');assert.equal(h.fine.refinementNotice.hidden,true);
 release();await pending;assert.equal(h.local.current,null);assert.equal(h.records.deleted.length,4,'A stale completion must not free the same staged resources twice.');
 let calls=0;h.local.fetcher=()=>{calls++;throw new Error('Preparation must remain paused in Echo.');};await h.local.ensure();assert.equal(calls,0);
});

check('a queued preparation cancelled by the workspace transition never starts fetching',async()=>{
 const h=harness();h.local.current=null;const pending=h.local.ensure();h.fine.setWorkspaceActive(false);await pending;
 assert.equal(h.records.fetches.length,0);assert.equal(h.local.current,null);assert.equal(h.local.active(),false);assert.equal(h.records.deleted.length,0);
});
