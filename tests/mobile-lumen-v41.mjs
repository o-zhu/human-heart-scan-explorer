/** Actual mobile mask bytes, sparse picking, bounded loading and atomic activation. */
import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createHash,webcrypto} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {loadMobileLumenAtlas,validateMobileLumenManifest,MOBILE_LUMEN_LAYOUT} from '../public/mobile-lumen-atlas.js';
import {ReviewedMaskAtlas,ensureReviewedMaskAtlas,sampleReviewedMask} from '../public/reviewed-mask-atlas.js';
import {loadLumenCollection,LumenCleanupController} from '../public/lumen-cleanup-v23.js';
import {VolumeRenderer} from '../public/renderer.js';
import {lumenExcludedAt} from '../public/volume-picking.js';

globalThis.crypto ||= webcrypto;
const publicRoot=new URL('../public/',import.meta.url),hash=data=>createHash('sha256').update(data).digest('hex');
const fetcher=async(path,{signal}={})=>{signal?.throwIfAborted();const bytes=await readFile(new URL(String(path).replace(/^\.\//,''),publicRoot));signal?.throwIfAborted();return new Response(bytes);};
const initialRequests=[];let inFlight=0,peakRequests=0;
const collection=await loadMobileLumenAtlas({fetcher:async(path,options)=>{initialRequests.push(path);peakRequests=Math.max(peakRequests,++inFlight);try{return await fetcher(path,options);}finally{inFlight--;}}});
const receipt={version:1,createdAt:new Date().toISOString(),scope:'Actual source hashes and instrumented lifecycle/GL allocation; independent full-byte parity and native renders are separate v41 receipts.',cases:[],indexSha256:hash(collection.index),payloadSha256:hash(collection.payload),retainedAtlasBytes:collection.index.byteLength+collection.payload.byteLength,requests:initialRequests,peakRequests,runtimeHashes:{}};
for(const path of ['mobile-lumen-atlas.js','reviewed-mask-atlas.js','lumen-cleanup-v23.js','renderer.js','volume-picking.js','fine-surface.js'])receipt.runtimeHashes['public/'+path]=hash(await readFile(new URL(path,publicRoot)));
function check(name,fn){test(name,async()=>{try{await fn();receipt.cases.push({name,passed:true});}catch(error){receipt.cases.push({name,passed:false,error:error.message});throw error;}});}
after(async()=>{receipt.passed=receipt.cases.every(item=>item.passed);if(process.env.HEART_MOBILE_LUMEN_EVIDENCE){const path=process.env.HEART_MOBILE_LUMEN_EVIDENCE;await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(receipt,null,2)+'\n');}});
const options={loadCollection:loadMobileLumenAtlas,validateManifest:validateMobileLumenManifest,requiredFields:4};
const deferred=()=>{let resolve;return {promise:new Promise(done=>{resolve=done;}),resolve:(...args)=>resolve(...args)};};
async function until(predicate){const end=performance.now()+5000;while(performance.now()<end){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,1));}assert.fail('The bounded operation did not reach its checkpoint.');}

function gpu({failUpload=0,maxSize=2048}={}){
 let active=100,vao=null,array=null,uploads=0,allocated=0,error=0;const textures=new Set(),bindings=new Map(),unpack=new Map([['UNPACK_ALIGNMENT',4]]),uniforms={};
 const gl=new Proxy({NO_ERROR:0,TEXTURE0:100,
  getParameter:key=>key==='MAX_TEXTURE_SIZE'?maxSize:key==='MAX_TEXTURE_IMAGE_UNITS'?8:key==='ACTIVE_TEXTURE'?active:key==='VERTEX_ARRAY_BINDING'?vao:key==='ARRAY_BUFFER_BINDING'?array:key==='TEXTURE_BINDING_2D'?bindings.get(active)||null:unpack.get(key)||0,
  getError:()=>{const result=error;error=0;return result;},isContextLost:()=>false,
  createTexture:()=>{const texture={bytes:0};textures.add(texture);return texture;},deleteTexture:texture=>{if(textures.delete(texture))allocated-=texture.bytes;},
  activeTexture:unit=>{active=unit;},bindTexture:(target,texture)=>{assert.equal(target,'TEXTURE_2D');bindings.set(active,texture);},
  texParameteri:(_target,key,value)=>assert.ok(['NEAREST','CLAMP_TO_EDGE'].includes(value)),pixelStorei:(key,value)=>unpack.set(key,value),bindVertexArray:value=>{vao=value;},bindBuffer:(_target,value)=>{array=value;},
  texImage2D:(_target,_level,format,width,height,_border,_channels,type,data)=>{
   assert.ok(width<=maxSize&&height<=maxSize);assert.equal(unpack.get('UNPACK_ALIGNMENT'),1);assert.equal(data.byteLength,width*height*4);
   assert.ok(format==='R32UI'&&type==='UNSIGNED_INT'&&data instanceof Uint32Array||format==='RGBA8'&&type==='UNSIGNED_BYTE'&&data instanceof Uint8Array);
   if(++uploads===failUpload){error=0x505;return;}const texture=bindings.get(active);allocated+=data.byteLength-texture.bytes;texture.bytes=data.byteLength;
  },
  uniform1i:(name,value)=>{uniforms[name]=value;},uniform1iv:(name,value)=>{uniforms[name]=Array.from(value);},uniform3iv:(name,value)=>{uniforms[name]=Array.from(value);},
 },{get:(target,key)=>key in target?target[key]:String(key)});
 return {gl,report:()=>({allocated,textures:textures.size,uploads,uniforms})};
}
function renderer(g=gpu()){
 const r={gl:g.gl,extent:[...collection.manifest.extent],settings:{},requestRender(){},setReviewedMaskAtlas:VolumeRenderer.prototype.setReviewedMaskAtlas,setLumenCleanupData:VolumeRenderer.prototype.setLumenCleanupData};
 return {r,g};
}
function mount(){const nodes=new Map();return {innerHTML:'',setAttribute(){},querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{textContent:'',checked:false,disabled:false,addEventListener(){}});return nodes.get(selector);}};}
async function withFetch(next,fn){const previous=globalThis.fetch;globalThis.fetch=next;try{return await fn();}finally{globalThis.fetch=previous;}}
function controller(r){return new LumenCleanupController({renderer:r,donor:{id:'ladaf-2021-17'},mount:mount(),autoStart:false,resourcePolicy:{constrained:true}});}

check('four exact fields load sequentially and retain only the 10.44 MiB sparse CPU representation',()=>{
 assert.equal(peakRequests,1);assert.equal(initialRequests.length,6);
 assert.deepEqual(initialRequests.slice(2),collection.manifest.fields.map(field=>field.sourceUrl));
 assert.ok(initialRequests.every(path=>!path.includes('low-band')&&!path.includes('surface-manifest')&&!path.endsWith('atlas.bin.gz')));
 assert.equal(hash(collection.index),MOBILE_LUMEN_LAYOUT.index.sha256);assert.equal(hash(collection.payload),MOBILE_LUMEN_LAYOUT.payload.sha256);
 assert.equal(receipt.retainedAtlasBytes,10948608);assert.deepEqual(Object.keys(collection).sort(),['index','manifest','payload']);
 assert.equal(collection.manifest.fields.length,4);assert.ok(collection.manifest.fields.every(field=>field.kind==='lumen'&&!('data'in field)));
 const sourceBytes=collection.manifest.fields.map(field=>field.sourceDecodedBytes);assert.equal(Math.max(...sourceBytes),29192000);assert.equal(sourceBytes.reduce((a,b)=>a+b),81845420);
});

check('source coordinates, layout and capability identity fail closed',()=>{
 for(const change of [m=>m.fields.push(m.fields[0]),m=>{m.fields[0].lowerFullFineXYZ[0]++;},m=>{m.fields[0].sourceDecodedSha256='0'.repeat(64);},m=>{m.indexTexture.byteLength+=4;},m=>{m.payloadTexture.sha256='0'.repeat(64);},m=>{m.sourceAtlasSha256='0'.repeat(64);}]){const changed=structuredClone(collection.manifest);change(changed);assert.throws(()=>validateMobileLumenManifest(changed),/source|field|layout/);}
 const {gl}=gpu();assert.throws(()=>new ReviewedMaskAtlas(gl,collection),/source/,'The desktop validator must not accept a four-field atlas as eight-field cleanup.');
});

check('oversized or altered metadata stops before any mask request',async()=>{
 let calls=0;await assert.rejects(loadMobileLumenAtlas({fetcher:async()=>{calls++;return new Response(new Uint8Array(32769));}}),/metadata length/);assert.equal(calls,1);
 calls=0;await assert.rejects(loadMobileLumenAtlas({fetcher:async()=>{calls++;return Response.json({schema:'different-source'});}}),/metadata checksum/);assert.equal(calls,1);
});

check('all four masks preserve nearest-cell CPU picking, byte boundaries and reversible visibility',async()=>{
 const {r,g}=renderer();r.setReviewedMaskAtlas(collection,{validateManifest:validateMobileLumenManifest});
 const requests=[],lumen=await loadLumenCollection({extent:r.extent,atlas:r.reviewedMaskAtlas,sparse:true,fetcher:(path,config)=>{requests.push(path);return fetcher(path,config);}});
 r.setLumenCleanupData(lumen);r.settings.lumenCleanupEnabled=true;
 assert.equal(requests.length,1,'Sparse metadata must not download the dense masks a second time.');assert.equal(lumen.sparseAtlas,collection);assert.ok(lumen.masks.every(mask=>!('data'in mask)));
 assert.deepEqual(r.lumenMaskFields,[0,1,2,3]);assert.equal(g.report().allocated,10948608);
 const world=f=>[(f[0]/1896-.5)*r.extent[0],(f[2]/2116-.5)*r.extent[1],(.5-f[1]/1896)*r.extent[2]];
 let checked=0,positive=0,seed=41;const samples=[];
 for(const field of collection.manifest.fields){
  const source=new Uint8Array(gunzipSync(await readFile(new URL(field.sourceUrl.slice(2),publicRoot)))),d=field.dimensionsXYZ,s=field.storageDimensionsXYZ;
  assert.equal(hash(source),field.sourceDecodedSha256);
  const compare=q=>{
   const outside=q.some((value,axis)=>value<-.5||value>=d[axis]-.5),[x,y,z]=q.map(value=>Math.floor(value+.5));
   const expected=!outside&&!!(source[(x>>3)+s[0]*(y+s[1]*z)]>>(x&7)&1),f=q.map((value,axis)=>value+field.lowerFullFineXYZ[axis]);
   assert.equal(sampleReviewedMask(collection,field.id,f),expected);if(expected){positive++;assert.equal(lumenExcludedAt(r,world(f)),true);r.settings.lumenCleanupEnabled=false;assert.equal(lumenExcludedAt(r,world(f)),false);r.settings.lumenCleanupEnabled=true;}
   samples.push({f,excluded:false});checked++;
  };
  for(let i=0;i<3000;i++){const q=d.map(size=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32*size-.5;});compare(q);}
  for(let axis=0;axis<3;axis++)for(const value of [-.5001,-.5,-.4999,0,7.4999,7.5,63.4999,63.5,d[axis]-.5001,d[axis]-.5]){const q=d.map(size=>Math.floor(size/2));q[axis]=value;compare(q);}
 }
 // Compare the union independently, including empty points in overlapping
 // fields. Only one original dense mask is held during each comparison pass.
 for(const field of collection.manifest.fields){
  const data=new Uint8Array(gunzipSync(await readFile(new URL(field.sourceUrl.slice(2),publicRoot)))),d=field.dimensionsXYZ,s=field.storageDimensionsXYZ;
  for(const sample of samples){const q=sample.f.map((value,axis)=>value-field.lowerFullFineXYZ[axis]);if(q.some((value,axis)=>value<-.5||value>=d[axis]-.5))continue;const [x,y,z]=q.map(value=>Math.floor(value+.5));sample.excluded||=!!(data[(x>>3)+s[0]*(y+s[1]*z)]>>(x&7)&1);}
 }
 for(const sample of samples)assert.equal(lumenExcludedAt(r,world(sample.f)),sample.excluded);
 assert.ok(positive>100);receipt.cpuSamples={checked,positive};
 const wrong={...lumen,sparseAtlas:{...collection}};assert.throws(()=>r.setLumenCleanupData(wrong),/match/);assert.equal(r.lumenCleanup,lumen);
 r.reviewedMaskAtlas.dispose();assert.equal(g.report().allocated,0);
});

check('two-texture activation is atomic and failure retains the prior exact cleanup',()=>{
 const {r,g}=renderer(gpu({failUpload:3}));r.setReviewedMaskAtlas(collection,{validateManifest:validateMobileLumenManifest});const previous=r.reviewedMaskAtlas;
 assert.equal(g.report().textures,2);assert.throws(()=>r.setReviewedMaskAtlas(collection,{validateManifest:validateMobileLumenManifest}),/graphics device/);
 assert.equal(r.reviewedMaskAtlas,previous);assert.equal(previous.ready,true);assert.equal(g.report().textures,2);assert.equal(g.report().allocated,10948608);previous.dispose();assert.equal(g.report().allocated,0);
});

check('a corrupt later mask never installs an atlas or fetches later sources',async()=>{
 const {r,g}=renderer(),requests=[],broken=collection.manifest.fields[2].sourceUrl;
 await assert.rejects(ensureReviewedMaskAtlas(r,{...options,fetcher:async(path,config)=>{requests.push(path);if(path!==broken)return fetcher(path,config);const bytes=await readFile(new URL(path.slice(2),publicRoot));bytes[8]^=1;return new Response(bytes);}}),/checksum/);
 assert.equal(r.reviewedMaskAtlas,undefined);assert.equal(g.report().allocated,0);assert.equal(g.report().textures,0);assert.ok(!requests.includes(collection.manifest.fields[3].sourceUrl));
});

check('aborting mobile cleanup stops later source requests and cannot publish stale GPU state',async()=>{
 const {r,g}=renderer(),hold=deferred(),signal=new AbortController(),requests=[];let held=false;
 const waiting=ensureReviewedMaskAtlas(r,{...options,signal:signal.signal,fetcher:async(path,config)=>{requests.push(path);if(path===collection.manifest.fields[1].sourceUrl){held=true;await hold.promise;}return fetcher(path,config);}});
 await until(()=>held);const job=r.reviewedMaskAtlasLoading;signal.abort();await assert.rejects(waiting,error=>error.name==='AbortError');assert.equal(r.reviewedMaskAtlasLoading,null);
 hold.resolve();await assert.rejects(job.promise,error=>error.name==='AbortError');assert.equal(r.reviewedMaskAtlas,undefined);assert.equal(g.report().allocated,0);assert.equal(g.report().textures,0);
 assert.ok(!requests.includes(collection.manifest.fields[2].sourceUrl));
});

check('mobile controller failure is retryable without reloading its verified atlas, then toggles without network',async()=>{
 const {r,g}=renderer(),c=controller(r),requests=[];let failMetadata=true;
 assert.equal(c.toggle.checked,true);assert.equal(r.settings.lumenCleanupEnabled,false);
 await withFetch(async(path,config)=>{requests.push(path);return failMetadata&&path==='./assets/cleanup-v30/lumen-manifest.json'?new Response(null,{status:503}):fetcher(path,config);},async()=>{
  await c.setEnabled(true);assert.match(c.error,/metadata/);assert.equal(r.lumenCleanup,undefined);assert.equal(r.settings.lumenCleanupEnabled,false);assert.equal(r.reviewedMaskAtlas.ready,true);assert.equal(g.report().allocated,10948608);
  failMetadata=false;const before=requests.length;await c.setEnabled(true);assert.equal(requests.length,before+1);assert.equal(c.error,null);assert.equal(r.settings.lumenCleanupEnabled,true);assert.ok(r.lumenCleanup.sparseAtlas);
  const loaded=requests.length;await c.setEnabled(false);assert.equal(r.settings.lumenCleanupEnabled,false);await c.setEnabled(true);assert.equal(r.settings.lumenCleanupEnabled,true);assert.equal(requests.length,loaded);
 });
 r.reviewedMaskAtlas.dispose();assert.equal(g.report().allocated,0);
});

check('desktop preparation cannot mistake the four mobile masks for complete local-surface coverage',async()=>{
 const {r,g}=renderer();r.setReviewedMaskAtlas(collection,{validateManifest:validateMobileLumenManifest});const retained=r.reviewedMaskAtlas;let requested=false;
 await assert.rejects(ensureReviewedMaskAtlas(r,{requiredFields:8,loadCollection:async()=>{requested=true;throw new Error('Deliberate full-atlas transfer failure');}}),/Deliberate/);
 assert.equal(requested,true);assert.equal(r.reviewedMaskAtlas,retained);assert.equal(g.report().allocated,10948608);retained.dispose();
});
