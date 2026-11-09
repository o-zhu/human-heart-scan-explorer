/** Real-asset decoding and bounded integration checks for the v29 local surfaces and verified compact-geometry compatibility. */
import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash, webcrypto} from 'node:crypto';
import {gunzipSync, gzipSync} from 'node:zlib';
// This opt-in fixture changes only the two release routing literals in memory.
// It tests the real controller before the new assets are seeded, without changing
// production activation or attributing fixture results to a deployed build.
const runtimeUrl=new URL('../public/local-surface-refinement.js',import.meta.url);
const runtimeSourceBytes=await readFile(runtimeUrl);
let testedRuntimeSource=runtimeSourceBytes.toString('utf8');
const useReleaseFixture=process.env.HEART_REFINEMENT_TEST_FIXTURE==='v29',fixtureChanges=[];
assert.ok(!process.env.HEART_REFINEMENT_TEST_FIXTURE||useReleaseFixture,'Unknown runtime fixture.');
if(useReleaseFixture){
 const swap=(from,to)=>{if(testedRuntimeSource.includes(from)){assert.equal(testedRuntimeSource.split(from).length,2,'Fixture target must be unique.');testedRuntimeSource=testedRuntimeSource.replace(from,to);fixtureChanges.push({from,to});}else assert.ok(testedRuntimeSource.includes(to),'Production routing differs from the reviewed v29 routing.');};
 swap("const MANIFEST='./assets/cleanup-v28/surface-manifest.json';","const MANIFEST='./assets/cleanup-v29/surface-manifest.json';");
 swap(String.raw`cleanup-v28\/`,String.raw`cleanup-v(?:28|29)\/`);
}
const {LocalSurfaceRefinementController,validateRefinementManifest,decodeRefinementMesh,refinementWorldBounds,LOCAL_REFINEMENT_GLSL}=await import(useReleaseFixture?'data:text/javascript;base64,'+Buffer.from(testedRuntimeSource).toString('base64'):runtimeUrl.href);
import {FineSurfacePass, fineSurfaceShaderSources} from '../public/fine-surface.js';
import {NativeMainDetailController} from '../public/native-main-detail.js';

globalThis.crypto ||= webcrypto;
const root=new URL('../',import.meta.url), output=new URL('docs/local-refinement-v29/',root);
const MANIFEST='./assets/cleanup-v29/surface-manifest.json';
const FINE='e50ab70a52373dc774cf6077ef906a753e56b78b9f9b646fba2ffe7220ff338c';
const GENTLE='175548ddaad01c409d59d561df6018c5cb0c90752b2ec771899c255065398dae';
const FULL=[1897,1897,2117], GPU=128*1024*1024, MASK=16*1024*1024;
const hash=b=>createHash('sha256').update(b).digest('hex');
const json=async path=>JSON.parse(await readFile(new URL(path,root),'utf8'));
const fineManifest=await json('public/assets/fine-surface-v23/manifest.json');
const extent=fineManifest.extent;
const world=f=>[(f[0]-948)/2116,(f[2]-1058)/2116,-(f[1]-948)/2116];
const fine=p=>[p[0]*2116+948,-p[2]*2116+948,p[1]*2116+1058];
const clone=structuredClone, delay=()=>new Promise(resolve=>setTimeout(resolve,0));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const until=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await delay();}assert.fail('The bounded operation did not reach its expected checkpoint.');};
const receipt={version:1,createdAt:new Date().toISOString(),testFile:'tests/local-refinement-v29.mjs',scope:'Actual asset hashes/layout and instrumented WebGL lifecycle; no browser speed or anatomical validation claim.',runtimeFixture:{enabled:useReleaseFixture,changes:fixtureChanges,originalModuleSha256:hash(runtimeSourceBytes),testedModuleSha256:hash(testedRuntimeSource),scope:useReleaseFixture?'Preactivation in-memory routing fixture, not a production activation.':'Actual active routing module.'},cases:[],assets:[]};
function check(name,fn){test(name,async()=>{const t=performance.now();try{await fn();receipt.cases.push({name,passed:true,milliseconds:performance.now()-t});}catch(error){receipt.cases.push({name,passed:false,error:error.message,milliseconds:performance.now()-t});throw error;}});}
after(async()=>{receipt.passed=receipt.cases.every(c=>c.passed);receipt.memory=process.memoryUsage();receipt.runtimeHashes={};for(const path of ['public/local-surface-refinement.js','public/fine-surface.js','public/renderer.js','public/volume-picking.js','public/compact-surface-codec.js','public/fine-surface-worker.js'])receipt.runtimeHashes[path]=hash(await readFile(new URL(path,root)));await mkdir(output,{recursive:true});await writeFile(new URL('validation.json',output),JSON.stringify(receipt,null,2)+'\n');});

const manifestPath='public/assets/cleanup-v29/surface-manifest.json',manifestBytes=await readFile(new URL(manifestPath,root));
const manifest=JSON.parse(manifestBytes);
assert.equal(manifest.patches.length,4,'The canonical v29 manifest must contain all four accepted patches.');
const assetPaths=new Map(manifest.patches.flatMap(p=>[p.surface,p.lowBandMask].map(a=>[a.url,'public/'+a.url.slice(2)])));
receipt.assetScope='canonical four-patch public v29 manifest';receipt.manifest={path:manifestPath,sha256:hash(manifestBytes)};

function bit(data,mask,x,y,z){const d=mask.dimensionsXYZ,s=mask.storageDimensionsXYZ;if(x<0||x>=d[0]||y<0||y>=d[1]||z<0||z>=d[2])return 0;return (data[(x>>3)+s[0]*(y+s[1]*z)]>>(x&7))&1;}
function fullBit(data,patch,f){const q=f.map((n,i)=>Math.round(n)-patch.lowerFullFineXYZ[i]);return bit(data,patch.lowBandMask,...q);}
function faceSample(mesh,raw,patch,maskData,start,id){
 const indices=new Uint32Array(raw.buffer,raw.byteOffset+mesh.indexOffset,mesh.indexCount),normals=new Int16Array(raw.buffer,raw.byteOffset+mesh.normalOffset,mesh.vertexCount*3);
 const source=mesh.float?new Float32Array(raw.buffer,raw.byteOffset+mesh.positionOffset,mesh.vertexCount*3):new Uint16Array(raw.buffer,raw.byteOffset+mesh.positionOffset,mesh.vertexCount*3);
 const positions=Array.from(indices.subarray(start,start+3),index=>Array.from({length:3},(_,axis)=>mesh.float?source[index*3+axis]:patch.surface.bounds.min[axis]+source[index*3+axis]/65535*(patch.surface.bounds.max[axis]-patch.surface.bounds.min[axis])));
 const fs=positions.map(fine),lo=[0,1,2].map(i=>Math.max(0,Math.floor(Math.min(...fs.map(f=>f[i])))-4)),hi=[0,1,2].map(i=>Math.min(FULL[i],Math.ceil(Math.max(...fs.map(f=>f[i])))+5));
 const d=hi.map((n,i)=>n-lo[i]),s=[Math.ceil(d[0]/8),d[1],d[2]],data=new Uint8Array(s[0]*s[1]*s[2]);
 for(let z=0;z<d[2];z++)for(let y=0;y<d[1];y++)for(let x=0;x<d[0];x++)if(fullBit(maskData,patch,[x+lo[0],y+lo[1],z+lo[2]]))data[(x>>3)+s[0]*(y+s[1]*z)]|=1<<(x&7);
 const bytes=new Uint8Array(100),h=new DataView(bytes.buffer);[0x31524653,1,3,3,32,68,88,0].forEach((n,i)=>h.setUint32(i*4,n,true));new Float32Array(bytes.buffer,32,9).set(positions.flat());
 indices.subarray(start,start+3).forEach((index,i)=>new Int16Array(bytes.buffer,68,9).set(normals.subarray(index*3,index*3+3),i*3));new Uint32Array(bytes.buffer,88,3).set([0,1,2]);
 const packed=gzipSync(bytes),maskPacked=gzipSync(data);
 const surface={format:'SFR1-gzip',url:`./assets/cleanup-v29/${id}.sfr.gz`,vertices:3,triangles:1,compressedBytes:packed.length,decodedBytes:bytes.length,sha256:hash(packed),decodedSha256:hash(bytes),bounds:{min:[0,1,2].map(i=>Math.min(...positions.map(p=>p[i]))),max:[0,1,2].map(i=>Math.max(...positions.map(p=>p[i])))}};
 const lowBandMask={format:'gzip-bitset-x-zyx',url:`./assets/cleanup-v29/${id}.bits.gz`,dimensionsXYZ:d,storageDimensionsXYZ:s,compressedBytes:maskPacked.length,decodedBytes:data.length,sha256:hash(maskPacked),decodedSha256:hash(data)};
 return {patch:{id,lowerFullFineXYZ:lo,upperFullFineXYZ:hi,surface,lowBandMask},bytes,data,packed,maskPacked};
}
const disjoint=(a,b)=>a.lowerFullFineXYZ.some((n,i)=>a.upperFullFineXYZ[i]<=b.lowerFullFineXYZ[i]||b.upperFullFineXYZ[i]<=n);
let fixturesPromise;
async function actualAssets(){
 if(fixturesPromise)return fixturesPromise;
 fixturesPromise=(async()=>{validateRefinementManifest(clone(manifest),extent);const samples=[],allPatchSamples=[];let realMask;
  for(const patch of manifest.patches){
   const packed=await readFile(new URL(assetPaths.get(patch.surface.url),root)),raw=gunzipSync(packed);assert.equal(packed.length,patch.surface.compressedBytes);assert.equal(hash(packed),patch.surface.sha256);assert.equal(raw.length,patch.surface.decodedBytes);assert.equal(hash(raw),patch.surface.decodedSha256);
   const mesh=await decodeRefinementMesh(raw,patch.surface);assert.equal(mesh.vertexCount,patch.surface.vertices);assert.equal(mesh.indexCount,patch.surface.triangles*3);assert.equal(hash(raw),patch.surface.decodedSha256,'Mesh decoding changed source bytes.');
   const maskPacked=await readFile(new URL(assetPaths.get(patch.lowBandMask.url),root)),data=new Uint8Array(gunzipSync(maskPacked));assert.equal(maskPacked.length,patch.lowBandMask.compressedBytes);assert.equal(hash(maskPacked),patch.lowBandMask.sha256);assert.equal(data.length,patch.lowBandMask.decodedBytes);assert.equal(hash(data),patch.lowBandMask.decodedSha256);
   const s=patch.lowBandMask.storageDimensionsXYZ,remainder=patch.lowBandMask.dimensionsXYZ[0]&7;let count=0;const pop=Uint8Array.from({length:256},(_,i)=>i.toString(2).replaceAll('0','').length);for(const n of data)count+=pop[n];if(remainder)for(let i=s[0]-1;i<data.length;i+=s[0])assert.equal(data[i]&(~((1<<remainder)-1)&255),0);if(patch.lowBandMask.maskedVoxels!==undefined)assert.equal(count,patch.lowBandMask.maskedVoxels);
   allPatchSamples.push(faceSample(mesh,raw,patch,data,0,`actual-region-${allPatchSamples.length}`));
   receipt.assets.push({id:patch.id,surfaceSha256:hash(packed),decodedSurfaceSha256:hash(raw),triangles:mesh.indexCount/3,maskSha256:hash(maskPacked),decodedMaskSha256:hash(data),maskedVoxels:count,decodedBytes:raw.length+data.length});
   if(!samples.length){samples.push(faceSample(mesh,raw,patch,data,0,'actual-face-a'));for(let i=3;i<mesh.indexCount;i+=3){const next=faceSample(mesh,raw,patch,data,i,'actual-face-b');if(disjoint(samples[0].patch,next.patch)){samples.push(next);break;}}assert.equal(samples.length,2,'Two separated source triangles are required for transaction tests.');realMask={patch:clone(patch),data};}
  }
  return {samples,allPatchSamples,realMask};
 })();return fixturesPromise;
}

async function fixture({four=false}={}){const {samples,allPatchSamples}=await actualAssets();const pieces=(four?allPatchSamples:samples).map(s=>({...s,patch:clone(s.patch),packed:Buffer.from(s.packed),maskPacked:Buffer.from(s.maskPacked),bytes:s.bytes.slice(),data:s.data.slice()}));const m={...clone(manifest),patches:pieces.map(s=>s.patch)};return {manifest:m,pieces};}
function fetching(f,hook){const calls=[];const next=url=>{if(url===MANIFEST)return Response.json(f.manifest);const p=f.pieces.find(p=>p.patch.surface.url===url||p.patch.lowBandMask.url===url);assert.ok(p,`Unexpected asset URL ${url}`);return new Response(url===p.patch.surface.url?p.packed:p.maskPacked);};return {calls,fetcher:async(url,options)=>{calls.push({url,options});return hook?hook(url,options,()=>next(url)):next(url);}};}

function gpu({maxUnits=16,maxSize=2048,failTexture=0}={}){
 let serial=0,boundBuffer,vao,texture,textureCount=0;const alive=new Map(),deleted=[],uploads=[],draws=[],uniforms={},parameters=[];
 const gl=new Proxy({NO_ERROR:0,TEXTURE0:100,getParameter:key=>key==='MAX_TEXTURE_IMAGE_UNITS'?maxUnits:key==='MAX_3D_TEXTURE_SIZE'?maxSize:0,getError:()=>failTexture&&textureCount===failTexture?1:0,isContextLost:()=>false,
  getUniformLocation:(_p,name)=>name,createVertexArray:()=>make('vao'),createBuffer:()=>make('buffer'),createTexture:()=>{textureCount++;return make('texture');},
  deleteVertexArray:drop,deleteBuffer:drop,deleteTexture:drop,bindVertexArray:v=>{vao=v;},bindBuffer:(_target,b)=>{boundBuffer=b;},bindTexture:(_target,t)=>{texture=t;},
  bufferData:(_target,data)=>{uploads.push({kind:'buffer',object:boundBuffer,bytes:data.byteLength});},texImage3D:(_target,_level,_format,x,y,z,_border,_type,_dataType,data)=>{uploads.push({kind:'texture',object:texture,dimensions:[x,y,z],bytes:data.byteLength,data:new Uint8Array(data)});},
  texParameteri:(_target,key,value)=>parameters.push({texture,key,value}),uniform1i:(name,value)=>{uniforms[name]=value;},uniform3fv:(name,value)=>{uniforms[name]=Array.from(value);},
  drawElements:(_mode,count)=>draws.push({vao,count,uniforms:clone(uniforms)})}, {get:(target,key)=>key in target?target[key]:String(key).toUpperCase()===key?key:()=>{}});
 function make(kind){const object={kind,id:++serial};alive.set(object,kind);return object;}function drop(object){assert.ok(alive.delete(object),'GPU resource was deleted twice or was not owned.');deleted.push(object);}
 return {gl,alive,deleted,uploads,draws,uniforms,parameters};
}
function harness(fetcher,options={}){const g=gpu(options),changes=[];const renderer={gl:g.gl,extent:[...extent],settings:{lumenCleanupEnabled:true,debrisCleanupEnabled:true,cleanupEnabled:true,mode:0,showPlanes:0,threshold:.28},lumenCleanup:{extent},lumenMaskTexture0:{placeholder:true},requestRender(reason){changes.push({render:reason});}};renderer.fineSurface={enabled:true,manifest:{extent,threshold:.28},lod:{id:'gentle',decodedSha256:GENTLE},activeFor:FineSurfacePass.prototype.activeFor};const previous=renderer.fineSurface,controller=new LocalSurfaceRefinementController({renderer,donor:{id:'ladaf-2021-17'},fetcher,onChange:()=>changes.push({loading:!!controller.loading,current:!!controller.current,error:controller.error||null})});return {g,renderer,controller,previous,changes};}
const uniforms=()=>Object.fromEntries(['refinementReady','refinementCount',...Array.from({length:4},(_,i)=>['Mask','Origin','Dimensions','Min','Max'].map(n=>'refinement'+n+i)).flat()].map(n=>[n,n]));

check('real available patch meshes and masks match their exact encoded/decoded hashes and source provenance',async()=>{assert.equal(hash(await readFile(new URL('public/assets/ultra-volume-v7.json',root))),FINE);assert.equal(fineManifest.lods.find(l=>l.id==='gentle').decodedSha256,GENTLE);await actualAssets();assert.equal(receipt.assets.length,4);for(const patch of manifest.patches)for(const asset of [patch.surface,patch.lowBandMask])assert.ok(asset.compressedBytes<8*1024*1024,'Every selected gzip must fit the release upload limit.');const decodedBytes=receipt.assets.reduce((n,a)=>n+a.decodedBytes,0),maskDecodedBytes=manifest.patches.reduce((n,p)=>n+p.lowBandMask.decodedBytes,0),compressedBytes=manifest.patches.reduce((n,p)=>n+p.surface.compressedBytes+p.lowBandMask.compressedBytes,0);assert.ok(decodedBytes<=GPU);assert.ok(maskDecodedBytes<=MASK);receipt.budget={regions:manifest.patches.length,compressedBytes,decodedBytes,maskDecodedBytes,maximumDecodedBytes:GPU,maximumMaskDecodedBytes:MASK};});

check('manifest validation rejects wrong sources, unsafe paths, overlapping regions and memory overruns',async()=>{
 const f=await fixture(),invalid=[m=>{m.donorId='s-20-28';},m=>{m.sourceManifestSha256='0'.repeat(64);},m=>{m.sourceMeshDecodedSha256='0'.repeat(64);},m=>{m.threshold=.29;},m=>{m.sourceSpacingUm=19.85;},m=>{m.extent[0]+=.001;},m=>{m.patches=[];},m=>{m.patches=Array(5).fill(m.patches[0]);},m=>{m.patches[1].id=m.patches[0].id;},m=>{m.patches[0].lowerFullFineXYZ[0]+=.5;},m=>{m.patches[0].upperFullFineXYZ[0]=9999;},m=>{m.patches[0].surface.url='https://example.test/mesh.sfr.gz';},m=>{m.patches[0].surface.url='./assets/cleanup-v29/../mesh.sfr.gz';},m=>{m.patches[0].lowBandMask.format='gzip-uint8';},m=>{m.patches[0].lowBandMask.storageDimensionsXYZ[0]++;},m=>{m.patches[0].surface.compressedBytes=48*1024*1024+1;},m=>{m.patches[0].surface.decodedBytes=GPU;},m=>{m.patches[1]={...clone(m.patches[0]),id:'overlap'};}];
 for(const alter of invalid){const m=clone(f.manifest);alter(m);assert.throws(()=>validateRefinementManifest(m,extent));}
 const m=clone(f.manifest);m.patches=m.patches.slice(0,1);const p=m.patches[0];p.lowerFullFineXYZ=[0,0,0];p.upperFullFineXYZ=[544,512,512];Object.assign(p.lowBandMask,{dimensionsXYZ:[544,512,512],storageDimensionsXYZ:[68,512,512],decodedBytes:68*512*512});assert.ok(p.lowBandMask.decodedBytes>MASK);assert.throws(()=>validateRefinementManifest(m,extent),/budget/);
});

check('decoder rejects corrupt layout, coordinates, normals and indices, and respects byte offsets',async()=>{
 const {pieces:[p]}=await fixture();const original=hash(p.bytes);
 for(const alter of [b=>new DataView(b.buffer).setUint32(20,34,true),b=>new DataView(b.buffer).setUint32(88,3,true),b=>new DataView(b.buffer).setFloat32(32,NaN,true),b=>new Int16Array(b.buffer,68,3).fill(0),b=>new DataView(b.buffer).setUint32(4,2,true)]){const bytes=p.bytes.slice();alter(bytes);await assert.rejects(decodeRefinementMesh(bytes,p.patch.surface),/Invalid local surface/);}
 for(const offset of [1,16]){const padded=new Uint8Array(p.bytes.length+offset);padded.set(p.bytes,offset);const decoded=await decodeRefinementMesh(padded.subarray(offset),p.patch.surface);assert.deepEqual([...new Float32Array(decoded.buffer,decoded.positionOffset,9)],[...new Float32Array(p.bytes.buffer,32,9)]);assert.deepEqual([...new Int16Array(decoded.buffer,decoded.normalOffset,9)],[...new Int16Array(p.bytes.buffer,68,9)]);assert.deepEqual([...new Uint32Array(decoded.buffer,decoded.indexOffset,3)],[0,1,2]);}assert.equal(hash(p.bytes),original);
});

check('geometry and packed masks remain inactive until every patch is verified and uploaded together',async()=>{
 const f=await fixture(),hold=deferred();let held=false;const network=fetching(f,(url,_options,next)=>{if(url===f.pieces[1].patch.lowBandMask.url){held=true;return hold.promise;}return next();});const h=harness(network.fetcher),pending=h.controller.ensure();await until(()=>held);assert.equal(h.controller.current,null);assert.equal(h.controller.active(),false);assert.equal(h.renderer.fineSurface,h.previous);assert.equal(h.g.uploads.filter(u=>u.kind==='texture').length,1);h.controller.bindScene(uniforms());assert.equal(h.g.uniforms.refinementReady,0);
 hold.resolve(new Response(f.pieces[1].maskPacked));await pending;assert.equal(h.controller.current.pieces.length,2);assert.equal(h.controller.active(),true);h.controller.bindScene(uniforms());assert.equal(h.g.uniforms.refinementReady,1);assert.equal(h.g.uniforms.refinementCount,2);assert.ok(network.calls.every(c=>c.options.priority==='low'));assert.equal(h.changes.filter(c=>c.render).length,1);
 for(const p of h.controller.current.pieces){const upload=h.g.uploads.find(u=>u.object===p.texture);assert.deepEqual(upload.dimensions,p.mask.storageDimensionsXYZ);assert.deepEqual(upload.data,p.mask.data);for(const key of ['TEXTURE_MIN_FILTER','TEXTURE_MAG_FILTER'])assert.ok(h.g.parameters.some(c=>c.texture===p.texture&&c.key===key&&c.value==='NEAREST'));}h.controller.dispose();assert.equal(h.g.alive.size,0);
});

check('all four canonical regions activate together and the fourth-slot failure preserves the original display',async()=>{
 const f=await fixture({four:true});assert.equal(f.pieces.length,4);
 const hold=deferred();let held=false;
 const network=fetching(f,(url,_options,next)=>{if(url===f.pieces[3].patch.lowBandMask.url){held=true;return hold.promise;}return next();});
 const h=harness(network.fetcher),pending=h.controller.ensure();await until(()=>held);
 assert.equal(h.controller.current,null);assert.equal(h.controller.active(),false);
 assert.equal(h.g.alive.size,15,'Only three staged groups should exist before the final mask is verified.');
 assert.equal(h.renderer.fineSurface,h.previous);h.controller.bindScene(uniforms());assert.equal(h.g.uniforms.refinementReady,0);
 hold.resolve(new Response(f.pieces[3].maskPacked));await pending;
 assert.equal(h.controller.current.pieces.length,4);assert.equal(h.controller.active(),true);assert.equal(h.g.alive.size,20);
 h.controller.bindScene(uniforms());assert.equal(h.g.uniforms.refinementCount,4);
 for(let i=0;i<4;i++){assert.equal(h.g.uniforms['refinementMask'+i],10+i);assert.deepEqual(h.g.uniforms['refinementOrigin'+i],f.pieces[i].patch.lowerFullFineXYZ);}
 h.controller.dispose();assert.equal(h.g.alive.size,0);
 const bad=await fixture({four:true});bad.pieces[3].maskPacked[8]^=1;
 const failed=harness(fetching(bad).fetcher);await failed.controller.ensure();
 assert.equal(failed.controller.current,null);assert.equal(failed.controller.active(),false);assert.equal(failed.g.alive.size,0);
 assert.equal(failed.renderer.fineSurface,failed.previous);assert.match(failed.controller.error,/checksum/i);
});

check('checksum, stream-size, padding and GPU failures release staged resources and preserve the old surface',async()=>{
 for(const mode of ['checksum','short','long','padding','gpu','units','dimensions']){
  const f=await fixture();if(mode==='checksum')f.pieces[1].packed[8]^=1;if(mode==='short')f.pieces[1].packed=f.pieces[1].packed.subarray(0,-1);if(mode==='long')f.pieces[1].packed=Buffer.concat([f.pieces[1].packed,Buffer.from([0])]);if(mode==='padding'){const p=f.pieces[1],s=p.patch.lowBandMask.storageDimensionsXYZ;assert.ok(p.patch.lowBandMask.dimensionsXYZ[0]&7);p.data[s[0]-1]|=128;p.maskPacked=gzipSync(p.data);Object.assign(p.patch.lowBandMask,{compressedBytes:p.maskPacked.length,sha256:hash(p.maskPacked),decodedSha256:hash(p.data)});}
  const h=harness(fetching(f).fetcher,mode==='gpu'?{failTexture:2}:mode==='units'?{maxUnits:13}:mode==='dimensions'?{maxSize:1}:{});await h.controller.ensure();assert.equal(h.controller.current,null,mode);assert.equal(h.controller.active(),false,mode);assert.equal(h.renderer.fineSurface,h.previous,mode);assert.equal(h.g.alive.size,0,mode);assert.ok(h.controller.error,mode);
 }
});

check('cancelled staged work is disposed; a newer successful load ignores stale non-abort failures',async()=>{
 const f=await fixture(),hold=deferred();let held=false,first=true;const network=fetching(f,(url,_options,next)=>{if(url===f.pieces[1].patch.lowBandMask.url&&first){first=false;held=true;return hold.promise;}return next();});const h=harness(network.fetcher),old=h.controller.ensure();await until(()=>held);h.controller.setWorkspaceActive(false);assert.equal(h.controller.active(),false);const retainedAfterCancellation=h.g.alive.size;h.controller.setWorkspaceActive(true);await h.controller.loading;const accepted=h.controller.current;assert.ok(accepted);hold.reject(new Error('stale transport failed'));await old;assert.equal(h.controller.current,accepted);assert.equal(h.controller.error,null);assert.equal(h.g.alive.size,10,'Only the two accepted VAO/buffer/texture groups may remain.');assert.equal(h.renderer.fineSurface,h.previous);h.controller.dispose();assert.equal(h.g.alive.size,0);assert.equal(retainedAfterCancellation,0,'Cancellation must free staged GPU storage before another bounded job can start.');
});

check('active replacement requires the verified Gentle mesh, matching extent, lumen cleanup and active workspace',async()=>{
 const f=await fixture(),h=harness(fetching(f).fetcher);await h.controller.ensure();const installed=h.controller.current;assert.ok(h.controller.active());const cases=[()=>{h.renderer.settings.lumenCleanupEnabled=false;},()=>{h.renderer.settings.debrisCleanupEnabled=false;},()=>{h.renderer.settings.mode=1;},()=>{h.renderer.settings.showPlanes=1;},()=>{h.renderer.settings.threshold=.31;},()=>{h.renderer.fineSurface.lod.id='detail';},()=>{h.renderer.fineSurface.lod.decodedSha256='0'.repeat(64);},()=>{h.renderer.extent[0]+=.01;},()=>{h.renderer.lumenCleanup=null;}];
 for(const change of cases){const settings=clone(h.renderer.settings),lod=clone(h.renderer.fineSurface.lod),e=[...h.renderer.extent],lumen=h.renderer.lumenCleanup;change();assert.equal(h.controller.active(),false);h.controller.bindScene(uniforms());assert.equal(h.g.uniforms.refinementReady,0);assert.equal(h.controller.current,installed);h.renderer.settings=settings;h.renderer.fineSurface.lod=lod;h.renderer.extent=e;h.renderer.lumenCleanup=lumen;}
 h.controller.setWorkspaceActive(false);assert.equal(h.controller.active(),false);h.controller.setWorkspaceActive(true);assert.equal(h.controller.active(),true);h.controller.dispose();
});

check('compact transport activates cleanup only through decoder-verified geometry identity',async()=>{
 const f=await fixture(),h=harness(fetching(f).fetcher);await h.controller.ensure();
 const pass=h.renderer.fineSurface,original=clone(pass.lod);assert.ok(h.controller.active());
 // A different decoded transport cannot borrow the original geometry identity
 // from its untrusted manifest descriptor. The decoder must have verified it.
 pass.lod={...original,decodedSha256:'a'.repeat(64),geometrySourceSha256:GENTLE};
 delete pass.geometrySourceSha256;assert.equal(h.controller.active(),false);
 pass.geometrySourceSha256=GENTLE;assert.equal(h.controller.active(),true);
 h.controller.bindScene(uniforms());assert.equal(h.g.uniforms.refinementReady,1);
 // A mismatching verified value must override even a matching legacy hash.
 pass.geometrySourceSha256='b'.repeat(64);pass.lod=original;
 assert.equal(h.controller.active(),false);h.controller.bindScene(uniforms());assert.equal(h.g.uniforms.refinementReady,0);
 pass.geometrySourceSha256=null;assert.equal(h.controller.active(),true);
 h.controller.dispose();assert.equal(h.g.alive.size,0);
 receipt.geometryCompatibility={legacyDecodedSha256:GENTLE,verifiedCompactGeometryIdentityAccepted:true,manifestOnlyIdentityRejected:true,mismatchingVerifiedIdentityRejected:true};
});

check('nearest CPU picking agrees with actual packed mask samples, byte boundaries and outside-box points',async()=>{
 const {realMask:{patch,data}}=await actualAssets(),h=harness(async()=>{throw new Error('No download expected');});h.controller.current={manifest:clone(manifest),pieces:[{...patch,mask:{...patch.lowBandMask,data,lowerFullFineXYZ:patch.lowerFullFineXYZ}}]};const d=patch.lowBandMask.dimensionsXYZ;let seen=[0,0];
 let seed=29;for(let i=0;i<4000;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const x=seed%d[0];seed=(Math.imul(seed,1664525)+1013904223)>>>0;const y=seed%d[1];seed=(Math.imul(seed,1664525)+1013904223)>>>0;const z=seed%d[2],expected=bit(data,patch.lowBandMask,x,y,z);seen[expected]++;const p=world([x,y,z].map((n,j)=>n+patch.lowerFullFineXYZ[j]));assert.equal(h.controller.excludedAt(p),!!expected);for(const off of [-.499,.499]){const q=[x+off,y,z].map((n,j)=>n+patch.lowerFullFineXYZ[j]);assert.equal(h.controller.excludedAt(world(q)),!!expected);}}
 assert.ok(seen.every(n=>n>0));for(const axis of [0,1,2])for(const edge of [-.501,d[axis]-.499]){const q=d.map(n=>Math.floor(n/2));q[axis]=edge;assert.equal(h.controller.excludedAt(world(q.map((n,i)=>n+patch.lowerFullFineXYZ[i]))),false);}h.renderer.settings.lumenCleanupEnabled=false;assert.equal(h.controller.excludedAt(world(patch.lowerFullFineXYZ)),false);
});

check('actual fine/native draw hooks preserve native priority and never apply the low-band discard to their own replacement',async()=>{
 const f=await fixture(),h=harness(fetching(f).fetcher);await h.controller.ensure();const pass=Object.assign(h.previous,{gl:h.g.gl,target:{width:1,height:1},program:{},backgroundProgram:{},uniforms:uniforms(),nativeUniforms:{nativeReplacementEnabled:'nativeReplacementEnabled',nativePatchPass:'nativePatchPass',nativeRegionMin:'nativeRegionMin',nativeRegionMax:'nativeRegionMax'},refinementUniforms:{refinementPatchPass:'refinementPatchPass',refinementPatchIndex:'refinementPatchIndex'},bounds:refinementWorldBounds([0,0,0],FULL),boundsMin:'boundsMin',boundsMax:'boundsMax',debrisEnabled:'debrisCleanupEnabled',hasDebrisMask:true,vao:{base:true},indexCount:3});
 const native=Object.assign(Object.create(NativeMainDetailController.prototype),{renderer:h.renderer,donor:{id:'ladaf-2021-17'},visible:true,state:{current:{bounds:{min:[0,0,0],max:[.01,.01,.01]},pieces:[{vao:{native:true},indexCount:3}]}}});h.renderer.nativeMainDetail=native;h.renderer.bindSceneUniforms=()=>h.controller.bindScene(pass.uniforms);h.renderer.compositeScene=()=>{};FineSurfacePass.prototype.draw.call(pass,h.renderer,1,1,{},1);
 assert.equal(h.g.draws.length,4);const [base,nativeDraw,...locals]=h.g.draws;assert.equal(base.uniforms.refinementPatchPass,0);assert.equal(base.uniforms.nativePatchPass,0);assert.equal(nativeDraw.uniforms.nativePatchPass,1);for(const [i,draw]of locals.entries()){assert.equal(draw.uniforms.refinementPatchPass,1);assert.equal(draw.uniforms.refinementPatchIndex,i);assert.equal(draw.uniforms.nativePatchPass,0);assert.equal(draw.uniforms.nativeReplacementEnabled,1);assert.equal(draw.uniforms.debrisCleanupEnabled,0);}assert.equal(h.g.uniforms.refinementPatchPass,0);assert.equal(h.g.uniforms.refinementPatchIndex,-1);
 const shader=fineSurfaceShaderSources.fragment;assert.ok(shader.includes(LOCAL_REFINEMENT_GLSL));assert.match(shader,/refinementPatchPass==0&&nativePatchPass==0&&region>=0\)discard/);assert.match(shader,/refinementPatchPass==1&&region!=refinementPatchIndex\)discard/);assert.match(shader,/nativePatchPass==1&&localRefinementExcluded\(meshPosition\)>.5\)discard/);assert.match(shader,/nativePatchPass==0&&insideNative/);assert.doesNotMatch(shader,/refinementPatchPass==1&&localRefinementExcluded/);h.controller.dispose();
});

check('a synchronous fetch failure is retryable and disposal cancels unresolved preparation',async()=>{
 const f=await fixture(),valid=fetching(f);let first=true;const h=harness((url,options)=>{if(first){first=false;throw new Error('synchronous fetch failure');}return valid.fetcher(url,options);});await h.controller.ensure();assert.equal(h.controller.loading,null);assert.match(h.controller.error,/synchronous/);await h.controller.ensure();assert.ok(h.controller.current);assert.equal(h.controller.error,null);h.controller.dispose();assert.equal(h.g.alive.size,0);
 const held=deferred();let waiting=false;const network=fetching(f,(url,_options,next)=>{if(url===f.pieces[1].patch.lowBandMask.url){waiting=true;return held.promise;}return next();}),late=harness(network.fetcher),pending=late.controller.ensure();await until(()=>waiting);assert.equal(late.g.alive.size,5);late.controller.dispose();assert.equal(late.g.alive.size,0,'Disposal must immediately release staged GPU resources.');held.resolve(new Response(f.pieces[1].maskPacked));await pending;assert.equal(late.controller.current,null);assert.equal(late.g.alive.size,0);assert.equal(late.renderer.fineSurface,late.previous);
 let calls=0;const early=harness(()=>{calls++;throw new Error('A cancelled queued task must not start fetching.');}),queued=early.controller.ensure();early.controller.dispose();await queued;assert.equal(calls,0);
});
