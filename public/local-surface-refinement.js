/** Reversible local surfaces derived from the unchanged 79.4 µm source. */
import {ensureReviewedMaskAtlas,isolatedReviewedUpload,reviewedSourceMask} from './reviewed-mask-atlas.js';
import {drawIndexedTriangles} from './mesh-draw.js';
const MANIFEST='./assets/cleanup-v30/surface-manifest.json';
const FINE_SOURCE='e50ab70a52373dc774cf6077ef906a753e56b78b9f9b646fba2ffe7220ff338c';
const GENTLE='175548ddaad01c409d59d561df6018c5cb0c90752b2ec771899c255065398dae';
const FULL=[1897,1897,2117],MAX_GPU=128*1024*1024,MAX_MASK=24*1024*1024,MAX_PART=4*1024*1024,MAX_PARTS=64;
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const abort=()=>new DOMException('Local surface preparation was interrupted.','AbortError');
const current=signal=>{if(signal?.aborted)throw abort();};
const point=value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
export const LOCAL_REFINEMENT_GLSL=`
uniform int refinementReady,refinementCount;
uniform int refinementField0,refinementField1,refinementField2,refinementField3;
uniform vec3 refinementOrigin0,refinementOrigin1,refinementOrigin2,refinementOrigin3;
uniform vec3 refinementDimensions0,refinementDimensions1,refinementDimensions2,refinementDimensions3;
uniform vec3 refinementMin0,refinementMin1,refinementMin2,refinementMin3;
uniform vec3 refinementMax0,refinementMax1,refinementMax2,refinementMax3;
float localRefinementExcluded(vec3 p){
 if(refinementReady==0)return 0.;
 vec3 f=toTex(p)*vec3(1896.,1896.,2116.);
 float excluded=reviewedMaskAt(refinementField0,f-refinementOrigin0,refinementDimensions0);
 if(refinementCount>1)excluded=max(excluded,reviewedMaskAt(refinementField1,f-refinementOrigin1,refinementDimensions1));
 if(refinementCount>2)excluded=max(excluded,reviewedMaskAt(refinementField2,f-refinementOrigin2,refinementDimensions2));
 if(refinementCount>3)excluded=max(excluded,reviewedMaskAt(refinementField3,f-refinementOrigin3,refinementDimensions3));
 return excluded;
}
bool withinRefinement(vec3 p,vec3 lo,vec3 hi){return all(greaterThanEqual(p,lo))&&all(lessThanEqual(p,hi));}
int refinementRegionAt(vec3 p){
 if(refinementReady==0)return -1;
 if(withinRefinement(p,refinementMin0,refinementMax0))return 0;
 if(refinementCount>1&&withinRefinement(p,refinementMin1,refinementMax1))return 1;
 if(refinementCount>2&&withinRefinement(p,refinementMin2,refinementMax2))return 2;
 if(refinementCount>3&&withinRefinement(p,refinementMin3,refinementMax3))return 3;
 return -1;
}`;

export function refinementWorldBounds(lower,upper){
 const world=p=>[(p[0]-948)/2116,(p[2]-1058)/2116,-(p[1]-948)/2116];
 const a=world(lower),b=world(upper.map(n=>n-1));
 return {min:a.map((n,i)=>Math.min(n,b[i])),max:a.map((n,i)=>Math.max(n,b[i]))};
}

export function validateRefinementManifest(manifest,extent){
 if(manifest?.version!==1||manifest.donorId!=='ladaf-2021-17'||manifest.sourceManifestSha256!==FINE_SOURCE||manifest.sourceMeshDecodedSha256!==GENTLE||manifest.sourceSpacingUm!==79.4||manifest.threshold!==.28||!Array.isArray(manifest.extent)||!manifest.extent.every((n,i)=>Number.isFinite(n)&&Math.abs(n-extent[i])<1e-6)||manifest.extent.length!==3||!Array.isArray(manifest.patches)||manifest.patches.length<1||manifest.patches.length>4)throw new Error('Local refinement does not match this source.');
 let bytes=0,maskBytes=0;const names=new Set();
 for(const item of manifest.patches){
  const lo=item.lowerFullFineXYZ,hi=item.upperFullFineXYZ,surface=item.surface,mask=item.lowBandMask;
  if(typeof item.id!=='string'||!/^[a-z0-9-]+$/.test(item.id)||names.has(item.id)||!point(lo)||!point(hi)||!lo.every((n,i)=>Number.isInteger(n)&&n>=0&&Number.isInteger(hi[i])&&hi[i]>n+2&&hi[i]<=FULL[i]))throw new Error('Invalid local refinement region.');
  names.add(item.id);const dims=hi.map((n,i)=>n-lo[i]);
  for(const [asset,kind]of [[surface,'surface'],[mask,'mask']]){
   if(!asset||typeof asset.url!=='string'||!/^\.\/assets\/cleanup-v(?:28|29|30)\/[a-z0-9-]+\.(?:sfr|hfm|bits)\.gz$/.test(asset.url)||!Number.isSafeInteger(asset.compressedBytes)||asset.compressedBytes<1||asset.compressedBytes>48*1024*1024||!Number.isSafeInteger(asset.decodedBytes)||asset.decodedBytes<1||asset.decodedBytes>MAX_GPU||!sha(asset.sha256)||!sha(asset.decodedSha256))throw new Error('Invalid local refinement asset.');
   if(asset.parts!==undefined){
    if(!asset.url.startsWith('./assets/cleanup-v30/')||!Array.isArray(asset.parts)||asset.parts.length<1||asset.parts.length>MAX_PARTS)throw new Error('Invalid local refinement parts.');
    let total=0;
    for(const [index,part]of asset.parts.entries()){
     const expected=asset.url.slice(0,-3)+'.part-'+String(index).padStart(3,'0')+'.gz';
     if(!part||part.url!==expected||!Number.isSafeInteger(part.compressedBytes)||part.compressedBytes<1||part.compressedBytes>MAX_PART||!sha(part.sha256))throw new Error('Invalid local refinement part.');
     total+=part.compressedBytes;
    }
    if(total!==asset.compressedBytes)throw new Error('Local refinement part lengths do not match.');
   }
   if(kind==='mask'){
    if(asset.format!=='gzip-bitset-x-zyx'||!point(asset.dimensionsXYZ)||!asset.dimensionsXYZ.every((n,i)=>n===dims[i])||!point(asset.storageDimensionsXYZ)||!asset.storageDimensionsXYZ.every((n,i)=>n===(i===0?Math.ceil(dims[0]/8):dims[i]))||asset.decodedBytes!==asset.storageDimensionsXYZ.reduce((a,b)=>a*b,1))throw new Error('Invalid local refinement mask.');
    maskBytes+=asset.decodedBytes;
   }else{
    if(!['SFR1-gzip','HFM1-gzip'].includes(asset.format)||!Number.isSafeInteger(asset.vertices)||asset.vertices<3||!Number.isSafeInteger(asset.triangles)||asset.triangles<1||!point(asset.bounds?.min)||!point(asset.bounds?.max)||!asset.bounds.min.every((n,i)=>n<=asset.bounds.max[i]))throw new Error('Invalid local refinement surface.');
   }
   bytes+=asset.decodedBytes;
  }
  item.replacementBounds=refinementWorldBounds(lo,hi);
 }
 if(bytes>MAX_GPU||maskBytes>MAX_MASK)throw new Error('Local refinement exceeds its graphics budget.');
 for(let a=0;a<manifest.patches.length;a++)for(let b=a+1;b<manifest.patches.length;b++){
  const x=manifest.patches[a].replacementBounds,y=manifest.patches[b].replacementBounds;
  if(x.min.every((n,i)=>Math.min(x.max[i],y.max[i])-Math.max(n,y.min[i])>1e-7))throw new Error('Local refinement regions overlap.');
 }
 return manifest;
}

async function exact(stream,size,signal){
 if(!stream)throw new Error('Local refinement download is empty.');
 const reader=stream.getReader(),bytes=new Uint8Array(size);let used=0;
 try{for(;;){current(signal);const {done,value}=await reader.read();current(signal);if(done)break;if(used+value.length>size)throw new Error('Local refinement length does not match.');bytes.set(value,used);used+=value.length;}if(used!==size)throw new Error('Local refinement length does not match.');}
 catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 return bytes;
}
async function loadPacked(item,fetcher,signal){
 current(signal);const reply=await fetcher(item.url,{signal,priority:'low'});if(!reply.ok)throw new Error('Local refinement download failed.');
 const packed=await exact(reply.body,item.compressedBytes,signal),checksum=await digest(packed);current(signal);
 if(checksum!==item.sha256)throw new Error('Local refinement checksum did not match.');return packed;
}
async function loadAsset(item,fetcher,signal){
 current(signal);let packed;
 if(item.parts){
  // Parts are opaque segments of one gzip stream. Keep only one part request
  // in flight, assemble in manifest order, then verify the complete stream.
  packed=new Uint8Array(item.compressedBytes);let offset=0;
  for(const part of item.parts){const bytes=await loadPacked(part,fetcher,signal);current(signal);packed.set(bytes,offset);offset+=bytes.length;}
  const checksum=await digest(packed);current(signal);if(checksum!==item.sha256)throw new Error('Local refinement checksum did not match.');
 }else packed=await loadPacked(item,fetcher,signal);
 current(signal);const bytes=await exact(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip')),item.decodedBytes,signal);
 if(await digest(bytes)!==item.decodedSha256)throw new Error('Decoded local refinement checksum did not match.');current(signal);return bytes;
}
export async function decodeRefinementMesh(bytes,item,signal){
 const h=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),integer=i=>h.getUint32(i*4,true);
 const float=item.format==='SFR1-gzip',magic=float?0x31524653:0x314d4648;
 if(bytes.length<32||integer(0)!==magic||integer(1)!==1||integer(7)!==0||integer(2)!==item.vertices||integer(3)!==item.triangles*3)throw new Error('Invalid local surface header.');
 const vertexCount=integer(2),indexCount=integer(3),positionOffset=integer(4),normalOffset=integer(5),indexOffset=integer(6),positionBytes=float?12:6;
 if(positionOffset<32||[positionOffset,normalOffset,indexOffset].some(n=>n%4)||positionOffset+vertexCount*positionBytes>normalOffset||normalOffset+vertexCount*6>indexOffset||indexOffset+indexCount*4!==bytes.length)throw new Error('Invalid local surface layout.');
 // The validated header offsets are relative to this byte view. Preserve an
 // aligned view without copying; normalize an unaligned view only after its
 // layout has passed validation, so every returned upload offset is absolute.
 const storage=(bytes.byteOffset&3)?new Uint8Array(bytes):bytes,base=storage.byteOffset;
 const positions=float?new Float32Array(storage.buffer,base+positionOffset,vertexCount*3):new Uint16Array(storage.buffer,base+positionOffset,vertexCount*3),indices=new Uint32Array(storage.buffer,base+indexOffset,indexCount),normals=new Int16Array(storage.buffer,base+normalOffset,vertexCount*3);
 for(let start=0;start<indices.length;start+=500000){current(signal);for(let i=start;i<Math.min(start+500000,indices.length);i++)if(indices[i]>=vertexCount)throw new Error('Invalid local surface index.');await pause();}
 for(let start=0;start<positions.length;start+=300000){current(signal);for(let i=start;i<Math.min(start+300000,positions.length);i+=3){if(float&&!Number.isFinite(positions[i]+positions[i+1]+positions[i+2]))throw new Error('Invalid local surface coordinate.');const length=Math.hypot(normals[i],normals[i+1],normals[i+2]);if(length<32000||length>33500)throw new Error('Invalid local surface normal.');}await pause();}
 return {buffer:storage.buffer,vertexCount,indexCount,positionOffset:base+positionOffset,normalOffset:base+normalOffset,indexOffset:base+indexOffset,positionBytes,float,bounds:float?{min:[0,0,0],max:[1,1,1]}:item.bounds};
}
function dispose(gl,piece){for(const buffer of piece.buffers||[])gl.deleteBuffer(buffer);if(piece.vao)gl.deleteVertexArray(piece.vao);if(piece.texture)gl.deleteTexture(piece.texture);}
function upload(gl,mesh){
 const piece={buffers:[],indexCount:mesh.indexCount,bounds:mesh.bounds};
 try{
  isolatedReviewedUpload(gl,()=>{
   piece.vao=gl.createVertexArray();if(!piece.vao)throw new Error('Local surface storage is unavailable.');gl.bindVertexArray(piece.vao);
   for(const [location,offset,length,type,normalized]of [[0,mesh.positionOffset,mesh.vertexCount*mesh.positionBytes,mesh.float?gl.FLOAT:gl.UNSIGNED_SHORT,!mesh.float],[1,mesh.normalOffset,mesh.vertexCount*6,gl.SHORT,true]]){
    const buffer=gl.createBuffer();if(!buffer)throw new Error('Local surface storage is unavailable.');piece.buffers.push(buffer);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Uint8Array(mesh.buffer,offset,length),gl.STATIC_DRAW);gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,3,type,normalized,0,0);
   }
   gl.disableVertexAttribArray(2);const buffer=gl.createBuffer();if(!buffer)throw new Error('Local surface storage is unavailable.');piece.buffers.push(buffer);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,buffer);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint32Array(mesh.buffer,mesh.indexOffset,mesh.indexCount),gl.STATIC_DRAW);
  });return piece;
 }catch(error){dispose(gl,piece);throw error;}
}

export class LocalSurfaceRefinementController{
 // Keep the native fetch receiver on the global object: calling a captured
 // Window.fetch as this.fetcher makes the controller its receiver in Safari.
 constructor({renderer,donor,fetcher=(...args)=>globalThis.fetch(...args),onChange=()=>{}}){this.renderer=renderer;this.fetcher=fetcher;this.onChange=onChange;this.available=donor.id==='ladaf-2021-17'&&!!renderer.gl;this.workspaceActive=true;this.revision=0;this.current=null;this.staging=null;if(this.available)renderer.localSurfaceRefinement=this;}
 // Workspace priority pauses preparation, not completed geometry in the shared
 // viewer. Echo must retain the same replacement surfaces and exclusion masks.
 active(){const r=this.renderer,p=r.fineSurface;return !!r.reviewedMaskAtlas?.ready&&!!this.current&&r.settings.lumenCleanupEnabled===true&&r.settings.debrisCleanupEnabled!==false&&!!r.lumenCleanup&&p?.lod?.id==='gentle'&&(p.geometrySourceSha256||p.lod.decodedSha256)===GENTLE&&this.current.manifest.extent.every((n,i)=>Math.abs(n-r.extent[i])<1e-6)&&p.activeFor(r);}
 discardStaging(){const pieces=this.staging;this.staging=null;if(pieces){for(const piece of pieces)dispose(this.renderer.gl,piece);pieces.length=0;}}
 setWorkspaceActive(active){this.workspaceActive=!!active;if(!active){this.revision++;this.abort?.abort();this.abort=null;this.discardStaging();this.loading=null;}else if(this.renderer.fineSurface?.lod?.id==='gentle')void this.ensure();this.onChange();}
 cancelPreparation(){this.revision++;this.abort?.abort();this.abort=null;this.discardStaging();this.loading=null;}
 async ensure({signal:parentSignal}={}){
  if(!this.available||this.current||!this.workspaceActive)return;if(this.loading)return this.loading;
  const revision=++this.revision,controller=new AbortController(),staged=[];this.abort=controller;this.staging=staged;const signal=controller.signal;
  const cancel=()=>controller.abort(parentSignal.reason);parentSignal?.addEventListener('abort',cancel,{once:true});if(parentSignal?.aborted)cancel();
  this.loading=Promise.resolve().then(async()=>{try{
   current(signal);
   const reply=await this.fetcher(MANIFEST,{signal,priority:'low'});if(!reply.ok)throw new Error('Local surface metadata is unavailable.');
   const manifest=validateRefinementManifest(await reply.json(),this.renderer.extent);current(signal);
   const atlas=await ensureReviewedMaskAtlas(this.renderer,{fetcher:this.fetcher,signal});current(signal);
   for(const item of manifest.patches){
    const bytes=await loadAsset(item.surface,this.fetcher,signal),mesh=await decodeRefinementMesh(bytes,item.surface,signal),data=reviewedSourceMask(atlas,'local:'+item.id,{...item.lowBandMask,lowerFullFineXYZ:item.lowerFullFineXYZ})||await loadAsset(item.lowBandMask,this.fetcher,signal);
    const mask={...item.lowBandMask,data,lowerFullFineXYZ:item.lowerFullFineXYZ},remainder=mask.dimensionsXYZ[0]&7;
    const atlasField=atlas.fieldIndex('local:'+item.id,mask);if(atlasField<0)throw new Error('The completed model atlas does not match this local mask.');
    if(remainder)for(let i=mask.storageDimensionsXYZ[0]-1;i<data.length;i+=mask.storageDimensionsXYZ[0])if(data[i]&(~((1<<remainder)-1)&255))throw new Error('Invalid local refinement mask padding.');
    current(signal);if(revision!==this.revision)throw abort();staged.push({...item,mask,atlasField,...upload(this.renderer.gl,mesh)});await pause();
   }
   current(signal);if(revision!==this.revision)throw abort();this.current={manifest,pieces:staged};if(this.staging===staged)this.staging=null;this.error=null;this.renderer.requestRender('scene');
  }catch(error){if(this.current?.pieces!==staged){for(const piece of staged)dispose(this.renderer.gl,piece);staged.length=0;}if(revision===this.revision&&!signal.aborted&&error.name!=='AbortError'){this.error=error.message;this.renderer.requestRender('scene');}}
  finally{parentSignal?.removeEventListener('abort',cancel);if(this.staging===staged)this.staging=null;if(revision===this.revision){this.loading=null;this.abort=null;this.onChange();}}});this.onChange();return this.loading;
 }
 bindScene(uniforms){
  const gl=this.renderer.gl,active=this.active(),pieces=active?this.current.pieces:[];gl.uniform1i(uniforms.refinementReady,active?1:0);gl.uniform1i(uniforms.refinementCount,pieces.length);
  for(let i=0;i<4;i++){const p=pieces[i];gl.uniform1i(uniforms['refinementField'+i],p?.atlasField??-1);gl.uniform3fv(uniforms['refinementOrigin'+i],p?.lowerFullFineXYZ||[0,0,0]);gl.uniform3fv(uniforms['refinementDimensions'+i],p?.mask.dimensionsXYZ||[1,1,1]);gl.uniform3fv(uniforms['refinementMin'+i],p?.replacementBounds.min||[0,0,0]);gl.uniform3fv(uniforms['refinementMax'+i],p?.replacementBounds.max||[0,0,0]);}
 }
 bindBase(pass){const gl=this.renderer.gl;gl.uniform1i(pass.refinementUniforms.refinementPatchPass,0);gl.uniform1i(pass.refinementUniforms.refinementPatchIndex,-1);}
 draw(pass){
  if(!this.active())return;const gl=this.renderer.gl;gl.uniform1i(pass.refinementUniforms.refinementPatchPass,1);gl.uniform1i(pass.debrisEnabled,0);
  for(const [index,piece]of this.current.pieces.entries()){gl.uniform1i(pass.refinementUniforms.refinementPatchIndex,index);gl.uniform3fv(pass.boundsMin,piece.bounds.min);gl.uniform3fv(pass.boundsMax,piece.bounds.max);gl.bindVertexArray(piece.vao);gl.vertexAttrib1f(2,0);drawIndexedTriangles(gl,piece.indexCount);}
  gl.bindVertexArray(null);this.bindBase(pass);
 }
 excludedAt(p){
  if(!this.active())return false;const e=this.renderer.extent,f=[p[0]/e[0]+.5,.5-p[2]/e[2],p[1]/e[1]+.5].map((n,i)=>n*(FULL[i]-1));
  return this.current.pieces.some(({mask:m})=>{const q=f.map((n,i)=>n-m.lowerFullFineXYZ[i]);if(q.some((n,i)=>n<-.5||n>=m.dimensionsXYZ[i]-.5))return false;const [x,y,z]=q.map(n=>Math.floor(n+.5)),d=m.storageDimensionsXYZ;return !!((m.data[(x>>3)+d[0]*(y+d[1]*z)]>>(x&7))&1);});
 }
 dispose(){this.revision++;this.abort?.abort();this.abort=null;this.discardStaging();for(const piece of this.current?.pieces||[])dispose(this.renderer.gl,piece);this.current=null;this.loading=null;}
}
