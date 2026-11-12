/** Actual atlas bytes, exact CPU queries, and strict resource/state lifecycle checks. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {webcrypto} from 'node:crypto';
import {loadReviewedMaskAtlas,decodeReviewedMaskAtlas,validateReviewedMaskManifest,sampleReviewedMask,ReviewedMaskAtlas,ensureReviewedMaskAtlas,validateReviewedMaskReferences,decodeReviewedMaskReferences,reviewedSourceMask} from '../public/reviewed-mask-atlas.js';
import {LocalSurfaceRefinementController} from '../public/local-surface-refinement.js';
import {loadLumenCollection,LumenCleanupController} from '../public/lumen-cleanup-v23.js';
import {loadMobileLumenAtlas,validateMobileLumenManifest} from '../public/mobile-lumen-atlas.js';
import {VolumeRenderer} from '../public/renderer.js';
import {FineSurfaceController} from '../public/fine-surface.js';

globalThis.crypto ||= webcrypto;
const root=new URL('../public/',import.meta.url),url='./assets/reviewed-mask-v32/atlas.bin.gz';
const fetcher=async(path,{signal}={})=>{signal?.throwIfAborted();const bytes=await readFile(new URL(String(path).replace(/^\.\//,''),root));signal?.throwIfAborted();return new Response(bytes);};
const initialRequests=[],collection=await loadReviewedMaskAtlas({fetcher:(path,options)=>{initialRequests.push(path);return fetcher(path,options);}}),manifest=collection.manifest,transportUrl=manifest.transport?.url||url;
const packed=await readFile(new URL(url.slice(2),root)),raw=new Uint8Array(gunzipSync(packed));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

function strictGL({max2D=4096,max3D=256,failUpload=0,staleError=0}={}){
 const g={NO_ERROR:0,INVALID_OPERATION:0x502,OUT_OF_MEMORY:0x505,ACTIVE_TEXTURE:0x84e0,MAX_TEXTURE_SIZE:0x0d33,MAX_3D_TEXTURE_SIZE:0x8073,MAX_TEXTURE_IMAGE_UNITS:0x8872,VERTEX_ARRAY_BINDING:0x85b5,ARRAY_BUFFER_BINDING:0x8894,PIXEL_UNPACK_BUFFER_BINDING:0x88ef,ARRAY_BUFFER:0x8892,ELEMENT_ARRAY_BUFFER:0x8893,PIXEL_UNPACK_BUFFER:0x88ec,STATIC_DRAW:0x88e4,FLOAT:0x1406,SHORT:0x1402,UNSIGNED_SHORT:0x1403,UNSIGNED_INT:0x1405,UNSIGNED_BYTE:0x1401,TEXTURE0:0x84c0,TEXTURE_2D:0x0de1,TEXTURE_3D:0x806f,TEXTURE_BINDING_2D:0x8069,R32UI:0x8236,RED_INTEGER:0x8d94,RGBA8:0x8058,RGBA:0x1908,UNPACK_ALIGNMENT:0x0cf5,UNPACK_ROW_LENGTH:0x0cf2,UNPACK_SKIP_PIXELS:0x0cf4,UNPACK_SKIP_ROWS:0x0cf3,TEXTURE_MIN_FILTER:0x2801,TEXTURE_MAG_FILTER:0x2800,TEXTURE_WRAP_S:0x2802,TEXTURE_WRAP_T:0x2803,NEAREST:0x2600,CLAMP_TO_EDGE:0x812f};
 let active=g.TEXTURE0+3,currentVao=null,array=null,unpackBuffer=null,allocated=0,uploads=0;
 const buffers=new Set(),textures=new Set(),vaos=new Set(),bindings=new Map(),errors=new Set(staleError?[staleError]:[]),calls=[];
 const unpack=new Map([[g.UNPACK_ALIGNMENT,8],[g.UNPACK_ROW_LENGTH,23],[g.UNPACK_SKIP_PIXELS,4],[g.UNPACK_SKIP_ROWS,2]]),defaultVao={element:null,attributes:new Map()},vao=()=>currentVao||defaultVao;
 const resource=set=>{const o={bytes:0,attributes:new Map()};set.add(o);return o;};
 Object.assign(g,{
  getParameter(p){calls.push(['getParameter',p]);if(p===g.MAX_TEXTURE_SIZE)return max2D;if(p===g.MAX_3D_TEXTURE_SIZE)return max3D;if(p===g.MAX_TEXTURE_IMAGE_UNITS)return 16;if(p===g.ACTIVE_TEXTURE)return active;if(p===g.VERTEX_ARRAY_BINDING)return currentVao;if(p===g.ARRAY_BUFFER_BINDING)return array;if(p===g.PIXEL_UNPACK_BUFFER_BINDING)return unpackBuffer;if(p===g.TEXTURE_BINDING_2D)return bindings.get(active)||null;if(unpack.has(p))return unpack.get(p);throw new Error('Unmodeled GL parameter '+p);},
  getError(){const error=errors.values().next().value||0;errors.delete(error);return error;},isContextLost:()=>false,
  createTexture:()=>resource(textures),deleteTexture(t){if(textures.delete(t))allocated-=t.bytes;for(const [k,v]of bindings)if(v===t)bindings.delete(k);},
  activeTexture(unit){assert(unit>=g.TEXTURE0&&unit<g.TEXTURE0+16);active=unit;},
  bindTexture(target,t){assert.equal(target,g.TEXTURE_2D,'No dense 3D mask texture may be uploaded or bound.');assert(!t||textures.has(t));bindings.set(active,t);},
  pixelStorei(p,v){assert(unpack.has(p));unpack.set(p,v);},
  texParameteri(target,p,v){assert.equal(target,g.TEXTURE_2D);assert(bindings.get(active));assert([g.TEXTURE_MIN_FILTER,g.TEXTURE_MAG_FILTER,g.TEXTURE_WRAP_S,g.TEXTURE_WRAP_T].includes(p));assert([g.NEAREST,g.CLAMP_TO_EDGE].includes(v));},
  texImage2D(target,level,internal,width,height,border,format,type,data){
   assert.equal(target,g.TEXTURE_2D);assert.equal(level,0);assert.equal(border,0);assert(width<=max2D&&height<=max2D);assert.equal(unpackBuffer,null,'A previous pixel-unpack buffer cannot change a typed-array upload.');
   assert.equal(unpack.get(g.UNPACK_ALIGNMENT),1);for(const p of [g.UNPACK_ROW_LENGTH,g.UNPACK_SKIP_PIXELS,g.UNPACK_SKIP_ROWS])assert.equal(unpack.get(p),0);
   if(internal===g.R32UI){assert.equal(format,g.RED_INTEGER);assert.equal(type,g.UNSIGNED_INT);assert(data instanceof Uint32Array);}else{assert.equal(internal,g.RGBA8);assert.equal(format,g.RGBA);assert.equal(type,g.UNSIGNED_BYTE);assert(data instanceof Uint8Array);}
   assert.equal(data.byteLength,width*height*4);uploads++;if(uploads===failUpload){errors.add(g.OUT_OF_MEMORY);return;}
   const texture=bindings.get(active);assert(texture);allocated+=data.byteLength-texture.bytes;texture.bytes=data.byteLength;calls.push(['texImage2D',width,height,data.byteLength]);
  },
  createVertexArray:()=>resource(vaos),bindVertexArray(v){assert(!v||vaos.has(v));currentVao=v;},deleteVertexArray(v){vaos.delete(v);if(currentVao===v)currentVao=null;},
  createBuffer:()=>resource(buffers),bindBuffer(target,b){assert(!b||buffers.has(b));if(target===g.ARRAY_BUFFER)array=b;else if(target===g.ELEMENT_ARRAY_BUFFER)vao().element=b;else if(target===g.PIXEL_UNPACK_BUFFER)unpackBuffer=b;else assert.fail('Unsupported buffer target');},
  bufferData(target,data,usage){assert.equal(usage,g.STATIC_DRAW);assert(ArrayBuffer.isView(data));const b=target===g.ARRAY_BUFFER?array:vao().element;assert(b);allocated+=data.byteLength-b.bytes;b.bytes=data.byteLength;},deleteBuffer(b){if(buffers.delete(b))allocated-=b.bytes;},
  enableVertexAttribArray(i){const a=vao().attributes.get(i)||{};a.enabled=true;vao().attributes.set(i,a);},disableVertexAttribArray(i){const a=vao().attributes.get(i)||{};a.enabled=false;vao().attributes.set(i,a);},
  vertexAttribPointer(i,size,type,normalized,stride,offset){assert(array);assert.equal(size,3);assert([g.FLOAT,g.SHORT,g.UNSIGNED_SHORT].includes(type));assert.equal(stride,0);assert.equal(offset,0);vao().attributes.set(i,{...vao().attributes.get(i),array,type,normalized});},
  report:()=>({allocated,textures:textures.size,buffers:buffers.size,vaos:vaos.size,pendingErrors:[...errors],uploads,calls}),
  state:()=>({active,currentVao,array,unpackBuffer,unpack:[...unpack],bindings:[...bindings].filter(([,t])=>t)}),
 });
 return g;
}
function renderer(gl){return {gl,extent:manifest.extent,settings:{lumenCleanupEnabled:true,debrisCleanupEnabled:true},fineSurface:{lod:{id:'gentle',decodedSha256:'175548ddaad01c409d59d561df6018c5cb0c90752b2ec771899c255065398dae'},activeFor:()=>true},requestRender(){},setReviewedMaskAtlas:VolumeRenderer.prototype.setReviewedMaskAtlas};}

test('actual atlas lookup matches original packed bytes, bit positions and nearest-cell bounds in all eight fields',async()=>{
 let checked=0,ones=0,seed=202603;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
 for(const f of manifest.fields){
  const data=new Uint8Array(gunzipSync(await readFile(new URL(f.sourceUrl.slice(2),root)))),d=f.dimensionsXYZ,s=f.storageDimensionsXYZ;
  const compare=q=>{const outside=q.some((v,i)=>v<-.5||v>=d[i]-.5),[x,y,z]=q.map(v=>Math.floor(v+.5)),expected=outside?false:!!((data[(x>>3)+s[0]*(y+s[1]*z)]>>(x&7))&1);assert.equal(sampleReviewedMask(collection,f.id,q.map((v,i)=>v+f.lowerFullFineXYZ[i])),expected,f.id+' '+q.join(','));checked++;if(expected)ones++;};
  for(let n=0;n<5000;n++)compare(d.map(v=>random()*v-.5));
  for(let axis=0;axis<3;axis++)for(const boundary of [-.50001,-.5,-.49999,0,7.49999,7.5,7.50001,63.49999,63.5,63.50001,d[axis]-1,d[axis]-.50001,d[axis]-.5]){const q=d.map(v=>Math.floor(v/2));q[axis]=boundary;compare(q);}
  // Nonzero bricks exercise every bit and all RGBA channels, not only empty-space queries.
  let found=0;for(let offset=0;offset<data.length&&found<80;offset++){if(!data[offset])continue;const x=(offset%s[0])*8,y=Math.floor(offset/s[0])%s[1],z=Math.floor(offset/(s[0]*s[1]));for(let bit=0;bit<8;bit++)if(x+bit<d[0])compare([x+bit,y,z]);found++;offset+=127;}
 }
 assert(checked>44000);assert(ones>500,'The comparisons must include occupied reviewed mask samples.');
});

test('source identity, header, out-of-range brick references and nonzero padding fail closed',()=>{
 const changed=structuredClone(manifest);changed.fields[0].lowerFullFineXYZ[0]++;assert.throws(()=>validateReviewedMaskManifest(changed),/field/);
 const badHeader=raw.slice();new DataView(badHeader.buffer).setUint32(0,0,true);assert.throws(()=>decodeReviewedMaskAtlas(badHeader,manifest),/header/);
 const badIndex=raw.slice();new DataView(badIndex.buffer).setUint32(manifest.indexTexture.offset,manifest.payloadTexture.brickCount+1,true);assert.throws(()=>decodeReviewedMaskAtlas(badIndex,manifest),/brick index/);
 const badPadding=raw.slice();badPadding[badPadding.length-1]=1;assert.throws(()=>decodeReviewedMaskAtlas(badPadding,manifest),/padding/);
});

test('strict GPU upload uses two 2D textures and restores unpack, buffer, VAO and texture state',()=>{
 const gl=strictGL({staleError:0x502}),vao=gl.createVertexArray(),buffer=gl.createBuffer(),pbo=gl.createBuffer();
 gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,pbo);
 for(const unit of [6,7]){gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,gl.createTexture());}gl.activeTexture(gl.TEXTURE0+3);
 const before=gl.state(),atlas=new ReviewedMaskAtlas(gl,collection);
 assert.deepEqual(gl.state(),before);assert.deepEqual(atlas.preexistingErrors,[0x502]);assert.equal(gl.report().allocated,18264064);assert.equal(gl.report().uploads,2);assert.equal(atlas.ready,true);
 assert.equal(gl.report().calls.some(([name,p])=>name==='getParameter'&&p===gl.MAX_3D_TEXTURE_SIZE),false);
 atlas.dispose();assert.equal(gl.report().allocated,0);assert.deepEqual(gl.state(),before);assert.equal(gl.getError(),gl.NO_ERROR);
});

test('device and allocation failures do not replace an already installed atlas or leak staged textures',()=>{
 const limited=strictGL({max2D:2048});assert.throws(()=>new ReviewedMaskAtlas(limited,collection),/2D texture size/);assert.equal(limited.report().textures,0);
 const gl=strictGL({failUpload:3}),r=renderer(gl);r.setReviewedMaskAtlas(collection);const original=r.reviewedMaskAtlas,bytes=gl.report().allocated;
 assert.throws(()=>r.setReviewedMaskAtlas(collection),/graphics device/);assert.equal(r.reviewedMaskAtlas,original);assert.equal(original.ready,true);assert.equal(gl.report().allocated,bytes);assert.equal(gl.report().textures,2);assert.equal(gl.getError(),gl.NO_ERROR);
 original.dispose();assert.equal(gl.report().allocated,0);
});

test('a full atlas load serves lumen and local consumers and survives one cancellation without duplicate fetches',async()=>{
 const gl=strictGL(),r=renderer(gl),hold=deferred(),first=new AbortController(),second=new AbortController(),requests=[];let assetSignal;
 const load=async(path,options)=>{requests.push(path);if(path===transportUrl){assetSignal=options.signal;await hold.promise;}return fetcher(path,options);};
 const a=ensureReviewedMaskAtlas(r,{fetcher:load,signal:first.signal,requiredFields:4}),b=ensureReviewedMaskAtlas(r,{fetcher:load,signal:second.signal,requiredFields:8});
 while(!assetSignal)await tick();first.abort();await assert.rejects(a,{name:'AbortError'});assert.equal(assetSignal.aborted,false);
 hold.resolve();const atlas=await b;assert.equal(atlas,r.reviewedMaskAtlas);assert.equal(atlas.ready,true);assert.equal(requests.length,manifest.transport?10:2);assert.equal(r.reviewedMaskAtlasLoading,null);atlas.dispose();
});

test('cancelling the final atlas consumer aborts its transfer and a later request can retry',async()=>{
 const gl=strictGL(),r=renderer(gl),controller=new AbortController();let reached=false;
 const load=async(path,options)=>{if(path!==transportUrl)return fetcher(path,options);reached=true;return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true}));};
 const pending=ensureReviewedMaskAtlas(r,{fetcher:load,signal:controller.signal});while(!reached)await tick();controller.abort();await assert.rejects(pending,{name:'AbortError'});await tick();
 assert.equal(r.reviewedMaskAtlasLoading,null);assert.equal(r.reviewedMaskAtlas,undefined);assert.equal(gl.report().textures,0);
 const atlas=await ensureReviewedMaskAtlas(r,{fetcher});assert.equal(atlas.ready,true);atlas.dispose();
});

test('all real local meshes and lumen masks activate with a 256-voxel 3D texture limit and no dense mask uploads',async()=>{
 const gl=strictGL({max3D:256}),r=renderer(gl),requests=[],tracked=(path,options)=>{requests.push(path);return fetcher(path,options);};await ensureReviewedMaskAtlas(r,{fetcher:tracked});
 const lumen=await loadLumenCollection({extent:r.extent,fetcher:tracked,atlas:r.reviewedMaskAtlas});VolumeRenderer.prototype.setLumenCleanupData.call(r,lumen);
 const local=new LocalSurfaceRefinementController({renderer:r,donor:{id:'ladaf-2021-17'},fetcher:tracked});await local.ensure();
 assert.equal(local.error,null);assert.equal(local.current.pieces.length,4);assert.equal(local.active(),true);assert.equal(gl.report().uploads,2);
 assert.deepEqual(local.current.pieces.map(piece=>piece.atlasField),[4,5,6,7]);assert.deepEqual(r.lumenMaskFields,[0,1,2,3]);
 if(manifest.transport){for(const field of manifest.fields)assert.equal(requests.filter(path=>path===field.sourceUrl).length,1,'Verified source masks download only once.');for(const mask of lumen.masks)assert.equal(mask.data,r.reviewedMaskAtlas.collection.sourceMasks.get('lumen:'+mask.id));for(const piece of local.current.pieces)assert.equal(piece.mask.data,r.reviewedMaskAtlas.collection.sourceMasks.get('local:'+piece.id));}
 assert.equal(gl.report().allocated,75017056);assert.equal(gl.report().calls.some(([name,p])=>name==='getParameter'&&p===gl.MAX_3D_TEXTURE_SIZE),false);
 local.dispose();r.reviewedMaskAtlas.dispose();assert.equal(gl.report().allocated,0);assert.equal(gl.report().textures,0);assert.equal(gl.report().buffers,0);assert.equal(gl.report().vaos,0);
});

test('the default loader completes the finalized model with a Safari-style Window.fetch receiver check',async t=>{
 const requests=[],gl=strictGL({max3D:256}),r=renderer(gl),surface=r.fineSurface;
 r.fineSurface=null;
 // Web IDL treats a bare call as the current global. An object method call
 // supplies that object instead, which Window.fetch rejects in Safari.
 t.mock.method(globalThis,'fetch',function(path,options){
  const receiver=this==null?globalThis:this;
  if(receiver!==globalThis)throw new TypeError('Can only call Window.fetch on instances of Window');
  requests.push({path,options,receiver});return fetcher(path,options);
 });
 const loadAbort=new AbortController(),local=new LocalSurfaceRefinementController({renderer:r,donor:{id:'ladaf-2021-17'}});
 const lumenCleanup={error:null,toggle:{checked:true},ready:(async()=>{
  const atlas=await ensureReviewedMaskAtlas(r,{signal:loadAbort.signal});
  const lumen=await loadLumenCollection({extent:r.extent,atlas,signal:loadAbort.signal});
  VolumeRenderer.prototype.setLumenCleanupData.call(r,lumen);
 })()};
 const preparationStages=[];
 const selection={renderer:r,revision:1,workspaceActive:true,workspaceWaiters:new Set(),lumenCleanup,localRefinement:local,
  setLoadStage(stage){preparationStages.push(stage);},waitForWorkspace:FineSurfaceController.prototype.waitForWorkspace,setStatus(){}};
 try{
  const ready=await FineSurfaceController.prototype.prepareFinalModel.call(selection,1,loadAbort.signal);
  assert.equal(ready,true,'The real prepared-model gate must succeed before the selected surface can be installed.');
  assert.deepEqual(preparationStages,['masks','interiors']);
  assert.equal(r.fineSurface,null,'Preparing interiors must not publish a partial base model.');
  assert.equal(local.error,null);assert.equal(local.current.pieces.length,4);
  assert.deepEqual(local.current.pieces.map(piece=>piece.atlasField),[4,5,6,7]);
  assert.deepEqual(r.lumenMaskFields,[0,1,2,3]);
  r.fineSurface=surface;assert.equal(local.active(),true);
  assert.ok(requests.some(({path})=>path==='./assets/cleanup-v30/surface-manifest.json'));
  for(const piece of local.current.pieces){
   for(const part of piece.surface.parts||[piece.surface])assert.equal(requests.filter(({path})=>path===part.url).length,1,'Every prepared surface part must download once.');
  }
  for(const field of manifest.fields)assert.equal(requests.filter(({path})=>path===field.sourceUrl).length,1,'Atlas, lumen and local loading must reuse verified source masks.');
  assert.equal(gl.report().uploads,2);assert.equal(gl.report().allocated,75017056);
 }finally{
  loadAbort.abort();local.dispose();r.reviewedMaskAtlas?.dispose();
 }
 assert.equal(gl.report().allocated,0);assert.equal(gl.report().textures,0);assert.equal(gl.report().buffers,0);assert.equal(gl.report().vaos,0);
});


test('reference transport reconstructs the identical pinned RMA1 bytes and retains reusable verified source masks',async()=>{
 assert.equal(manifest.transport?.format,'RMR1-gzip');
 const program=new Uint8Array(gunzipSync(await readFile(new URL(transportUrl.slice(2),root))));
 validateReviewedMaskReferences(program,manifest);
 const rebuilt=await decodeReviewedMaskReferences(program,manifest,collection.sourceMasks);
 assert.deepEqual(rebuilt,raw);assert.equal(collection.sourceMasks.size,8);
 assert.equal(initialRequests.includes(url),false,'The hosted reference path never requests the full atlas payload.');
 for(const field of manifest.fields)assert.equal(initialRequests.filter(path=>path===field.sourceUrl).length,1);
 const f=manifest.fields[0],mask={url:f.sourceUrl,sha256:f.sourceCompressedSha256,decodedSha256:f.sourceDecodedSha256,decodedBytes:f.sourceDecodedBytes,dimensionsXYZ:f.dimensionsXYZ,storageDimensionsXYZ:f.storageDimensionsXYZ,lowerFullFineXYZ:f.lowerFullFineXYZ};
 assert.equal(reviewedSourceMask(collection,f.id,mask),collection.sourceMasks.get(f.id));assert.equal(reviewedSourceMask(collection,f.id,{...mask,decodedSha256:'0'.repeat(64)}),null);
});

test('reference corruption fails before source fetching and invalid references never address source bytes',async()=>{
 const packedRefs=new Uint8Array(await readFile(new URL(transportUrl.slice(2),root))),program=new Uint8Array(gunzipSync(packedRefs)),offset=32+manifest.indexTexture.byteLength;
 for(const [location,value,pattern]of [[0,0,/header/],[offset,8,/source brick/],[offset+4,0xffffffff,/source brick/],[32,manifest.payloadTexture.brickCount+1,/reference index/]]){const bad=program.slice();new DataView(bad.buffer).setUint32(location,value,true);assert.throws(()=>validateReviewedMaskReferences(bad,manifest),pattern);}
 assert.throws(()=>validateReviewedMaskReferences(program.subarray(1),manifest),/length/);
 const corrupted=packedRefs.slice();corrupted[10]^=1;const requests=[];
 await assert.rejects(loadReviewedMaskAtlas({fetcher:(path,options)=>{requests.push(path);return path===transportUrl?new Response(corrupted):fetcher(path,options);}}),/checksum/);
 assert.equal(requests.length,2);
});

test('reference copying yields so cancellation cannot commit a partial atlas',async()=>{
 const program=new Uint8Array(gunzipSync(await readFile(new URL(transportUrl.slice(2),root)))),controller=new AbortController();
 const pending=decodeReviewedMaskReferences(program,manifest,collection.sourceMasks,{signal:controller.signal});
 setTimeout(()=>controller.abort(),0);await assert.rejects(pending,{name:'AbortError'});
});

test('v47 a compact-to-Ultra sparse upgrade reuses exact cavity bricks and completes all interiors without retaining or refetching dense masks',async()=>{
 const gl=strictGL(),r=renderer(gl),requests=[];let pending=0,peak=0;
 const tracked=async(path,options)=>{requests.push(path);peak=Math.max(peak,++pending);try{return await fetcher(path,options);}finally{pending--;}};
 const first=await loadMobileLumenAtlas({fetcher:tracked});r.setReviewedMaskAtlas(first,{validateManifest:validateMobileLumenManifest});
 r.setLumenCleanupData=VolumeRenderer.prototype.setLumenCleanupData;
 r.setLumenCleanupData(await loadLumenCollection({extent:r.extent,fetcher:tracked,atlas:r.reviewedMaskAtlas,sparse:true}));
 const nodes=new Map(),mount={innerHTML:'',setAttribute(){},querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{textContent:'',checked:false,disabled:false,addEventListener(){}});return nodes.get(selector);}};
 const cleanup=new LumenCleanupController({renderer:r,donor:{id:'ladaf-2021-17'},mount,fetcher:tracked,compact:false,autoStart:false,resourcePolicy:{sparseReviewedMasks:true}});
 await cleanup.setEnabled(true);assert.equal(cleanup.error,null);
 const atlas=r.reviewedMaskAtlas,lumen=r.lumenCleanup;
 assert.equal(peak,1);assert.equal(atlas.collection.manifest.fields.length,8);
 assert.deepEqual(Object.keys(atlas.collection).sort(),['index','manifest','payload']);
 assert.deepEqual(atlas.collection.index,collection.index);assert.deepEqual(atlas.collection.payload,collection.payload);
 assert.equal(atlas.collection.index.buffer,atlas.collection.payload.buffer,'Aligned little-endian atlas views must not retain a duplicate index.');assert.equal(atlas.collection.payload.buffer.byteLength,manifest.asset.decodedBytes);
 assert.equal(lumen.sparseAtlas,atlas.collection);assert.ok(lumen.masks.every(mask=>!mask.data));
 const installedRequests=requests.length;await cleanup.setEnabled(false);assert.equal(r.settings.lumenCleanupEnabled,false);await cleanup.setEnabled(true);assert.equal(r.settings.lumenCleanupEnabled,true);assert.equal(requests.length,installedRequests,'Full sparse cleanup must not be mistaken for the four-field intermediate on toggles.');
 const local=new LocalSurfaceRefinementController({renderer:r,donor:{id:'ladaf-2021-17'},fetcher:tracked,resourcePolicy:{sparseReviewedMasks:true}});
 try{
  await local.ensure();assert.equal(local.error,null);assert.equal(local.current.pieces.length,4);assert.equal(local.active(),true);
  assert.deepEqual(local.current.pieces.map(piece=>piece.atlasField),[4,5,6,7]);
  assert.ok(local.current.pieces.every(piece=>!piece.mask.data&&piece.mask.sparseAtlas===atlas.collection));
  for(const field of manifest.fields)assert.equal(requests.filter(path=>path===field.sourceUrl).length,1,'Each verified field transfers once even though CPU picking remains enabled.');
  const world=f=>[(f[0]/1896-.5)*r.extent[0],(f[2]/2116-.5)*r.extent[1],(.5-f[1]/1896)*r.extent[2]];
  let checked=0,positive=0,seed=47;
  const check=f=>{const expected=manifest.fields.slice(4).some(field=>sampleReviewedMask(collection,field.id,f));assert.equal(local.excludedAt(world(f)),expected);checked++;positive+=Number(expected);};
  for(const field of manifest.fields.slice(4)){
   for(let n=0;n<1000;n++)check(field.dimensionsXYZ.map((size,i)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return field.lowerFullFineXYZ[i]+(seed/2**32)*(size-1);}));
   const data=collection.sourceMasks.get(field.id),s=field.storageDimensionsXYZ;
   let found=0;for(let offset=0;offset<data.length&&found<50;offset++){if(!data[offset])continue;const x=(offset%s[0])*8,y=Math.floor(offset/s[0])%s[1],z=Math.floor(offset/(s[0]*s[1]));for(let bit=0;bit<8;bit++)if(x+bit<field.dimensionsXYZ[0])check([x+bit,y,z].map((v,i)=>v+field.lowerFullFineXYZ[i]));found++;offset+=127;}
  }
  assert.ok(checked>5000);assert.ok(positive>100);assert.equal(gl.report().uploads,4);
 }finally{local.dispose();atlas.dispose();}
 assert.equal(gl.report().allocated,0);assert.equal(gl.report().buffers,0);assert.equal(gl.report().vaos,0);
});

test('v47 streamed full-atlas corruption and cancellation preserve the installed compact atlas',async()=>{
 for(const failure of ['corrupt','abort']){
  const gl=strictGL(),r=renderer(gl),previous={ready:true,collection:{manifest:{fields:new Array(4)}},dispose(){assert.fail('An incomplete replacement must not dispose the current compact atlas.');}};
  r.reviewedMaskAtlas=previous;const controller=new AbortController(),requests=[];
  const tracked=async(path,options)=>{
   requests.push(path);const result=await fetcher(path,options);
   if(path===manifest.fields[4].sourceUrl){
    if(failure==='abort'){controller.abort();return result;}
    const bytes=new Uint8Array(await result.arrayBuffer());bytes[10]^=1;return new Response(bytes);
   }
   return result;
  };
  await assert.rejects(ensureReviewedMaskAtlas(r,{fetcher:tracked,retainSourceMasks:false,signal:controller.signal}),failure==='abort'?{name:'AbortError'}:/checksum/);
  assert.equal(r.reviewedMaskAtlas,previous);assert.equal(gl.report().allocated,0);assert.equal(r.reviewedMaskAtlasLoading,null);
  assert.equal(requests.includes(manifest.fields[5].sourceUrl),false);
 }
});
