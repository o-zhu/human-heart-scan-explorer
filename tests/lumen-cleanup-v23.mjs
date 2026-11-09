import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {loadLumenCollection,LumenCleanupController} from '../public/lumen-cleanup-v23.js';
import {lumenExcludedAt,pickVolume} from '../public/volume-picking.js';

const domPath=process.argv[2];if(!domPath)throw new Error('Pass the installed LinkeDOM ESM entry point.');
const {parseHTML}=await import(domPath);
const root=new URL('../public/',import.meta.url);
// Keep this historical policy/byte audit explicitly on its frozen v28 inputs.
// The controller lifecycle cases below use tiny masks and an already-ready
// fixture atlas; the real atlas codec/GPU contract has its own focused suite.
const manifest=JSON.parse(await readFile(new URL('assets/cleanup-v28/lumen-manifest.json',root)));
const activeManifest='./assets/cleanup-v30/lumen-manifest.json';
const hash=data=>createHash('sha256').update(data).digest('hex');
const fetcher=async url=>url===activeManifest?Response.json(manifest):new Response(await readFile(new URL(url.replace(/^\.\//,''),root)));
const bitCounts=Uint8Array.from({length:256},(_,v)=>{let n=0;for(;v;v>>=1)n+=v&1;return n;});
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

function tinyCollection(){
 const bodies=new Map(),masks=manifest.masks.map((m,i)=>{
  const data=new Uint8Array([i?0:1]),packed=gzipSync(data);bodies.set(m.url,packed);
  return {...m,dimensionsXYZ:[1,1,1],storageDimensionsXYZ:[1,1,1],lowerFullFineXYZ:[i,0,0],upperFullFineXYZ:[i+1,1,1],decodedBytes:1,compressedBytes:packed.length,sha256:hash(packed),decodedSha256:hash(data)};
 });
 const source={...manifest,id:'fixture-lumen',masks};
 return {source,fetcher:async url=>{if(url===activeManifest)return Response.json(source);assert.ok(bodies.has(url),'A ready fixture atlas must not fetch production atlas files.');return new Response(bodies.get(url));}};
}

function readyAtlas(source){
 const fields=source.masks.map(mask=>({id:'lumen:'+mask.id,kind:'lumen',sourceId:mask.id,sourceUrl:mask.url,sourceCompressedSha256:mask.sha256,sourceDecodedSha256:mask.decodedSha256,sourceDecodedBytes:mask.decodedBytes,dimensionsXYZ:mask.dimensionsXYZ,storageDimensionsXYZ:mask.storageDimensionsXYZ,lowerFullFineXYZ:mask.lowerFullFineXYZ}));
 return {ready:true,collection:{manifest:{fields,extent:source.extent}},fieldIndex(id,mask){
  const index=fields.findIndex(f=>f.id===id);if(index<0)return -1;const f=fields[index];
  return f.sourceUrl===mask.url&&f.sourceCompressedSha256===mask.sha256&&f.sourceDecodedSha256===mask.decodedSha256&&f.sourceDecodedBytes===mask.decodedBytes&&['dimensionsXYZ','storageDimensionsXYZ','lowerFullFineXYZ'].every(key=>same(f[key],mask[key]))?index:-1;
 }};
}

test('all four actual masks decode exactly and preserve the documented source coordinate convention',async()=>{
 const collection=await loadLumenCollection({extent:manifest.extent,fetcher});
 assert.equal(collection.bitPacked,true);
 assert.deepEqual(collection.masks.map(m=>m.id),['atrial','arterial','valve-region','rv']);
 for(const mask of collection.masks){
  assert.equal(hash(mask.data),mask.decodedSha256);
  assert.equal(mask.data.reduce((n,v)=>n+bitCounts[v],0),mask.maskedVoxels);
  assert.equal(mask.data.length,mask.storageDimensionsXYZ.reduce((a,b)=>a*b,1));
  assert.deepEqual(mask.storageDimensionsXYZ,[Math.ceil(mask.dimensionsXYZ[0]/8),mask.dimensionsXYZ[1],mask.dimensionsXYZ[2]]);
  assert.equal(mask.policy.restoredWallFootprintOverlapSamples,0,'New selections must retain both repaired atrial wall footprints.');
  assert.equal(mask.policy.originalSourceAndGeometryUnchanged,true);
  for(const operation of mask.policy.operations){
   assert.equal(operation.protectedSourceOutsideObjectOverlapSamples,0);
   assert.equal(operation.restoredWallFootprintOverlapSamples,0);
   const policyBytes=await readFile(new URL('../'+operation.policy,root));
   assert.equal(hash(policyBytes),operation.policySha256);
   const policy=JSON.parse(policyBytes);
   assert.equal(policy.explicitSelectedObjectException,true);
   assert.equal(policy.protectedDenseOutsideObjectOverlapSamples,0);
   assert.equal(policy.protectedCollarOverlapSamples,0);
   assert.equal(policy.guard,4,'The v28 object-specific collar is source-traced, not the old blanket ten-sample rule.');
   assert.ok(policy.evidence.length>0);
   assert.match(policy.sourceIdentity,/Unverified/);
   assert.match(policy.intensityUnits,/not calibrated HU/);
  }
  const fine=mask.lowerFullFineXYZ.map((n,i)=>n+(mask.dimensionsXYZ[i]-1)/2);
  const mm=manifest.sourceSpacingUm/1000,half=collection.fullDimensionsXYZ.map(n=>(n-1)/2);
  const world=[(fine[0]-half[0])*mm/manifest.longestMm,(fine[2]-half[2])*mm/manifest.longestMm,-(fine[1]-half[1])*mm/manifest.longestMm];
  const reconstructed=[world[0]/collection.extent[0]+.5,.5-world[2]/collection.extent[2],world[1]/collection.extent[1]+.5].map((n,i)=>n*(collection.fullDimensionsXYZ[i]-1));
  reconstructed.forEach((n,i)=>assert.ok(Math.abs(n-fine[i])<1e-9));
 }
});

test('wrong source, malformed dimensions and altered payloads are rejected before display installation',async()=>{
 for(const change of [{donorId:'other'},{sourceManifestSha256:'0'.repeat(64)},{sourceFullDimensionsXYZ:[1900,1900,2120]},{masks:[{...manifest.masks[0],decodedBytes:100},manifest.masks[1]]}]){
  await assert.rejects(loadLumenCollection({extent:manifest.extent,fetcher:async url=>url.endsWith('manifest.json')?Response.json({...manifest,...change}):fetcher(url)}),/source|manifest/);
 }
 await assert.rejects(loadLumenCollection({extent:manifest.extent,fetcher:async url=>{
  if(url.endsWith('manifest.json'))return Response.json(manifest);
  const data=await readFile(new URL(url.replace(/^\.\//,''),root));data[Math.floor(data.length/2)]^=1;return new Response(data);
 }}),/checksum/);
});

function fixture(source){
 const {document}=parseHTML('<div id="mount"></div>');globalThis.document=document;
 let installs=0,renders=0;
 const renderer={gl:{},extent:source.extent,settings:{},reviewedMaskAtlas:readyAtlas(source),setLumenCleanupData(c){for(const mask of c.masks)assert.ok(this.reviewedMaskAtlas.fieldIndex('lumen:'+mask.id,mask)>=0,'Only matching atlas/source fields can be installed.');this.lumenCleanup=c;installs++;},requestRender(){renders++;}};
 const controller=new LumenCleanupController({renderer,donor:{id:'ladaf-2021-17'},mount:document.getElementById('mount')});
 return {controller,renderer,counts:()=>({installs,renders})};
}

test('requested cleanup loads by default and is exactly reversible without refetch',async()=>{
 const tiny=tinyCollection(),originalFetch=globalThis.fetch;let requests=0;globalThis.fetch=async(...args)=>{requests++;return tiny.fetcher(...args);};
 try{
  const {controller,renderer,counts}=fixture(tiny.source);assert.equal(controller.toggle.checked,true);
  await controller.ready;assert.equal(controller.error,null);assert.equal(renderer.settings.lumenCleanupEnabled,true);assert.equal(counts().installs,1);assert.equal(requests,1+tiny.source.masks.length);
  await controller.setEnabled(false);assert.equal(renderer.settings.lumenCleanupEnabled,false);
  await controller.setEnabled(true);assert.equal(requests,1+tiny.source.masks.length);assert.equal(counts().installs,1);assert.equal(renderer.settings.lumenCleanupEnabled,true);
 }finally{globalThis.fetch=originalFetch;}
});

test('turning off during a late fetch never installs or re-enables a stale exclusion',async()=>{
 const originalFetch=globalThis.fetch,tiny=tinyCollection();let release;
 globalThis.fetch=async url=>url===activeManifest?await new Promise(resolve=>{release=()=>resolve(Response.json(tiny.source));}):tiny.fetcher(url);
 try{
  const {controller,renderer,counts}=fixture(tiny.source);const pending=controller.ready;
  for(let i=0;!release&&i<50;i++)await new Promise(resolve=>setTimeout(resolve,1));assert.equal(typeof release,'function');
  await controller.setEnabled(false);release();await pending;
  assert.equal(counts().installs,0);assert.equal(renderer.settings.lumenCleanupEnabled,false);assert.equal(controller.toggle.checked,false);
 }finally{globalThis.fetch=originalFetch;}
});

test('GPU failure leaves the original view and a useful retry message',async()=>{
 const originalFetch=globalThis.fetch,tiny=tinyCollection();globalThis.fetch=tiny.fetcher;
 try{
  const {controller,renderer,counts}=fixture(tiny.source),install=renderer.setLumenCleanupData.bind(renderer);renderer.setLumenCleanupData=()=>{throw new Error('GPU allocation unavailable.');};
  await controller.ready;assert.equal(renderer.settings.lumenCleanupEnabled,false);assert.equal(controller.toggle.checked,false);assert.match(controller.status.textContent,/Original view retained/);
  assert.equal(counts().installs,0);assert.equal(renderer.reviewedMaskAtlas.ready,true);
  renderer.setLumenCleanupData=install;await controller.setEnabled(true);
  assert.equal(controller.error,null);assert.equal(renderer.settings.lumenCleanupEnabled,true);assert.equal(counts().installs,1);
 }finally{globalThis.fetch=originalFetch;}
});

test('CPU anatomy picking passes through the same excluded material and restores the original hit',()=>{
 const original=new Uint8Array(11**3).fill(255),before=hash(original);
 const renderer={data:original,dimensions:[11,11,11],extent:[1,1,1],
  settings:{mode:0,threshold:.28,clipAxis:-1,cleanupEnabled:true,lumenCleanupEnabled:false},
  canvas:{getBoundingClientRect:()=>({width:1000,height:1000})},
  basis:()=>({eye:[0,0,2],forward:[0,0,-1],right:[1,0,0],up:[0,1,0]}),
  lumenCleanup:{extent:[1,1,1],fullDimensionsXYZ:[11,11,11],masks:[{dimensionsXYZ:[11,2,11],lowerFullFineXYZ:[0,0,0],data:new Uint8Array(11*2*11).fill(255)}]},
 };
 const initial=pickVolume(renderer,.5,.5);assert.equal(initial.world[2],.5);
 renderer.settings.lumenCleanupEnabled=true;
 assert.equal(lumenExcludedAt(renderer,[0,0,.5]),true);assert.equal(lumenExcludedAt(renderer,[0,0,.3]),false);
 const reviewed=pickVolume(renderer,.5,.5);assert.ok(reviewed.world[2]>.34&&reviewed.world[2]<.36);
 renderer.settings.lumenCleanupEnabled=false;assert.deepEqual(pickVolume(renderer,.5,.5),initial);assert.equal(hash(original),before);
});
