/** Lossless, precomputed storage for the eight reviewed source masks. */
const MANIFEST='./assets/reviewed-mask-v32/manifest.json';
const FULL=[1897,1897,2117],EXTENT=[1896/2116,1,1896/2116];
const MAX_PACKED=16*1024*1024,MAX_DECODED=64*1024*1024;
const ATLAS_DECODED_SHA256='96cf62fdf734050d125bb851e63027ca11aec9c217f7cecdfb69de3202d380ca';
const ATLAS_COMPRESSED_SHA256='a8b34103a8d58b27a66080366d433b8b21bca2a42b3975d0e0065ca5e82023d5';
const SOURCE_MANIFESTS={lumen:'cdea0c182475a0daf3db7b8cf53ec99e3d9fc53bc5d61aaba33b2e359cbcd1a6',surface:'f12cc01dc5151df447c8c4456b5309ace7be642906923a395100eaefa03ea43d'};
const SOURCES=[
 ['lumen:atrial','./assets/cleanup-v29/atrial.bits.gz','8011250557ade5201d00d3fa9a7b9cc95e885bac6a2c0519e484d8ee5384f6e1',[355,607,728],[1080,748,432]],
 ['lumen:arterial','./assets/cleanup-v28/arterial.bits.gz','5e296ed795b22ef90a0b3c4dc7959b94e1c6f7868753dfad715297388c7efa38',[650,445,800],[510,900,180]],
 ['lumen:valve-region','./assets/cleanup-v28/valve-region.bits.gz','404b8c552c906d13b72dba3940883f74188d7b688873a659a75e92cc01c9677d',[430,305,470],[850,900,850]],
 ['lumen:rv','./assets/cleanup-v28/rv.bits.gz','aac23435be1a7484d4ed9aed86c78f69a6c85a2af800425f7640ce860af7a342',[570,440,790],[450,760,1020]],
 ['local:lvot-perivalvular-refinement','./assets/cleanup-v30/lvot-perivalvular-refinement-low-band.bits.gz','e825a608b3875ec220b46e5fe7b774dc81f79ca7eec386415470a685a4c590f4',[312,296,484],[1018,944,916]],
 ['local:pulmonary-regularized-v30','./assets/cleanup-v30/pulmonary-regularized-v30-low-band.bits.gz','7edfac07f8d54c3527d19cbe2dae3dc0f2e1fe6a5d64e57f29286e7ae16ae916',[290,316,572],[580,1064,540]],
 ['local:tricuspid-rv-regularized-v30','./assets/cleanup-v30/tricuspid-rv-regularized-v30-low-band.bits.gz','3e310a19dc454d33687ad9dc17f7efe7e7fa5dab0e2ce2ad3b288cbaf541373b',[290,420,466],[590,640,894]],
 ['local:right-perivascular-v29','./assets/cleanup-v29/right-perivascular-v29-low-band.bits.gz','22f4db4a9d0fcf7dadc9f9019190adbad465a1cf89de980fa5a3aa6e7468cb00',[500,245,200],[530,815,690]],
];
const equal=(a,b)=>Array.isArray(a)&&a.length===b.length&&a.every((n,i)=>n===b[i]);
const sha=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const positive=(x,max)=>Number.isSafeInteger(x)&&x>0&&x<=max;
const digest=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),n=>n.toString(16).padStart(2,'0')).join('');
const interrupted=()=>new DOMException('Reviewed model loading was interrupted.','AbortError');
const current=signal=>{if(signal?.aborted)throw interrupted();};

export const REVIEWED_MASK_UNIFORMS=['reviewedMaskReady','reviewedMaskIndex','reviewedMaskPayload','reviewedMaskOffsets','reviewedMaskGrids'];
export const REVIEWED_MASK_GLSL=`
precision highp int;
uniform int reviewedMaskReady;
uniform highp usampler2D reviewedMaskIndex;
uniform highp sampler2D reviewedMaskPayload;
uniform int reviewedMaskOffsets[8];
uniform ivec3 reviewedMaskGrids[8];
float reviewedMaskAt(int field,vec3 q,vec3 size){
 if(reviewedMaskReady==0||field<0||field>=8||any(lessThan(q,vec3(-.5)))||any(greaterThanEqual(q,size-.5)))return 0.;
 ivec3 cell=ivec3(floor(q+.5));
 ivec3 stored=ivec3(cell.x/8,cell.y,cell.z),brick=stored/8;
 ivec3 grid=reviewedMaskGrids[field];
 int entry=reviewedMaskOffsets[field]+brick.x+grid.x*(brick.y+grid.y*brick.z);
 int iw=textureSize(reviewedMaskIndex,0).x;
 uint id=texelFetch(reviewedMaskIndex,ivec2(entry%iw,entry/iw),0).r;
 if(id==0u)return 0.;
 ivec3 local=stored%8;
 uint byteOffset=(id-1u)*512u+uint(local.x+8*(local.y+8*local.z));
 int pixel=int(byteOffset/4u),pw=textureSize(reviewedMaskPayload,0).x;
 vec4 rgba=texelFetch(reviewedMaskPayload,ivec2(pixel%pw,pixel/pw),0);
 uint bits=uint(floor(rgba[int(byteOffset&3u)]*255.+.5));
 return float((bits>>uint(cell.x&7))&1u);
}`;

export function validateReviewedMaskManifest(m){
 if(m?.schema!=='heart-reviewed-mask-atlas-v32'||m.version!==1||m.donorId!=='ladaf-2021-17'||!equal(m.sourceFullDimensionsXYZ,FULL)||!Array.isArray(m.extent)||m.extent.length!==3||!m.extent.every((v,i)=>Number.isFinite(v)&&Math.abs(v-EXTENT[i])<1e-8)||!equal(m.brickSizeXYZ,[8,8,8])||m.brickBytes!==512||!Array.isArray(m.fields)||m.fields.length!==8)throw new Error('The reviewed mask atlas does not match this source.');
 for(const [kind,hash]of Object.entries(SOURCE_MANIFESTS))if(m.sourceManifests?.[kind]?.sha256!==hash||m.sourceManifests[kind].url!==`./assets/cleanup-v30/${kind}-manifest.json`)throw new Error('The reviewed mask atlas source identity does not match.');
 let entries=0;
 for(const [i,f]of m.fields.entries()){
  const [id,url,hash,dims,origin]=SOURCES[i],storage=[Math.ceil(dims[0]/8),dims[1],dims[2]],grid=storage.map(n=>Math.ceil(n/8));
  if(f.id!==id||f.sourceId!==id.slice(id.indexOf(':')+1)||f.kind!==id.split(':')[0]||f.sourceUrl!==url||f.sourceDecodedSha256!==hash||!sha(f.sourceCompressedSha256)||!positive(f.sourceCompressedBytes,MAX_PACKED)||!equal(f.dimensionsXYZ,dims)||!equal(f.lowerFullFineXYZ,origin)||!equal(f.upperFullFineXYZ,origin.map((n,k)=>n+dims[k]))||!equal(f.storageDimensionsXYZ,storage)||f.sourceDecodedBytes!==storage.reduce((a,b)=>a*b,1)||!equal(f.brickGridXYZ,grid)||f.indexOffset!==entries)throw new Error('Invalid reviewed mask atlas field.');
  entries+=grid.reduce((a,b)=>a*b,1);
 }
 const a=m.asset,index=m.indexTexture,payload=m.payloadTexture;
 if(!a||a.url!=='./assets/reviewed-mask-v32/atlas.bin.gz'||a.format!=='RMA1-gzip'||a.compressedBytes!==3080744||a.decodedBytes!==18264096||a.sha256!==ATLAS_COMPRESSED_SHA256||a.decodedSha256!==ATLAS_DECODED_SHA256)throw new Error('Invalid reviewed mask atlas asset.');
 for(const t of [index,payload])if(!t||!positive(t.width,8192)||!positive(t.height,8192)||!positive(t.byteLength,MAX_DECODED)||t.byteLength!==t.width*t.height*4)throw new Error('Invalid reviewed mask atlas texture.');
 if(index.format!=='R32UI'||index.entryCount!==entries||entries>index.width*index.height||index.offset!==32||payload.format!=='RGBA8'||!positive(payload.brickCount,MAX_DECODED/512)||payload.brickCount*512>payload.byteLength||payload.offset!==32+index.byteLength||a.decodedBytes!==payload.offset+payload.byteLength)throw new Error('Invalid reviewed mask atlas layout.');
 if(m.transport){const t=m.transport;if(t.url!=='./assets/reviewed-mask-v32/atlas.refs.gz'||t.format!=='RMR1-gzip'||!positive(t.compressedBytes,MAX_PACKED)||t.decodedBytes!==32+index.byteLength+payload.brickCount*8||!sha(t.sha256)||!sha(t.decodedSha256))throw new Error('Invalid reviewed mask reference transport.');}
 return m;
}

async function exact(stream,size,signal){
 if(!stream)throw new Error('The reviewed mask atlas download is empty.');
 const reader=stream.getReader(),bytes=new Uint8Array(size);let used=0;
 try{for(;;){current(signal);const {done,value}=await reader.read();current(signal);if(done)break;if(used+value.length>size)throw new Error('The reviewed mask atlas length does not match.');bytes.set(value,used);used+=value.length;}if(used!==size)throw new Error('The reviewed mask atlas length does not match.');}
 catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 return bytes;
}
export function decodeReviewedMaskAtlas(bytes,manifest){
 validateReviewedMaskManifest(manifest);
 const {indexTexture:i,payloadTexture:p}=manifest;
 if(!(bytes instanceof Uint8Array)||bytes.length!==manifest.asset.decodedBytes)throw new Error('Invalid reviewed mask atlas decoded length.');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),header=[0x31414d52,1,8,i.entryCount,32,i.byteLength,p.offset,p.byteLength];
 if(header.some((v,k)=>view.getUint32(k*4,true)!==v))throw new Error('Invalid reviewed mask atlas header.');
 const index=new Uint32Array(i.width*i.height);
 for(let n=0;n<index.length;n++){const value=view.getUint32(i.offset+n*4,true);if(value>p.brickCount||n>=i.entryCount&&value!==0)throw new Error('Invalid reviewed mask atlas brick index.');index[n]=value;}
 const payload=bytes.subarray(p.offset,p.offset+p.byteLength);
 for(let n=p.brickCount*512;n<payload.length;n++)if(payload[n]!==0)throw new Error('Invalid reviewed mask atlas padding.');
 return {manifest,index,payload};
}
async function loadVerifiedAsset(asset,fetcher,signal){
 current(signal);const reply=await fetcher(asset.url,{signal,priority:'low'});
 if(!reply.ok)throw new Error('The completed model masks could not download.');
 const packed=await exact(reply.body,asset.compressedBytes,signal);
 if(await digest(packed)!==asset.sha256)throw new Error('The reviewed mask asset checksum does not match.');current(signal);
 const bytes=await exact(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip')),asset.decodedBytes,signal);
 if(await digest(bytes)!==asset.decodedSha256)throw new Error('The decoded reviewed mask asset checksum does not match.');current(signal);return bytes;
}
export {loadVerifiedAsset as loadVerifiedReviewedMaskAsset};
export function validateReviewedMaskReferences(program,manifest){
 validateReviewedMaskManifest(manifest);
 const i=manifest.indexTexture,p=manifest.payloadTexture,offset=32+i.byteLength,length=offset+p.brickCount*8;
 if(!(program instanceof Uint8Array)||program.length!==length)throw new Error('Invalid reviewed mask reference length.');
 const view=new DataView(program.buffer,program.byteOffset,program.byteLength),header=[0x31524d52,1,8,i.byteLength,p.brickCount,32,offset,p.brickCount*8];
 if(header.some((n,k)=>view.getUint32(k*4,true)!==n))throw new Error('Invalid reviewed mask reference header.');
 for(let n=0;n<i.byteLength/4;n++){const id=view.getUint32(32+n*4,true);if(id>p.brickCount||n>=i.entryCount&&id!==0)throw new Error('Invalid reviewed mask reference index.');}
 for(let n=0;n<p.brickCount;n++){const field=view.getUint32(offset+n*8,true),ordinal=view.getUint32(offset+n*8+4,true);if(field>=manifest.fields.length||ordinal>=manifest.fields[field].brickGridXYZ.reduce((a,b)=>a*b,1))throw new Error('Invalid reviewed mask source brick reference.');}
 return {view,offset};
}
export async function decodeReviewedMaskReferences(program,manifest,sourceMasks,{signal}={}){
 current(signal);const {view,offset}=validateReviewedMaskReferences(program,manifest),i=manifest.indexTexture,p=manifest.payloadTexture;
 const bytes=new Uint8Array(manifest.asset.decodedBytes),header=new DataView(bytes.buffer);
 [0x31414d52,1,8,i.entryCount,32,i.byteLength,p.offset,p.byteLength].forEach((n,k)=>header.setUint32(k*4,n,true));bytes.set(program.subarray(32,offset),i.offset);
 for(let n=0;n<p.brickCount;n++){
  if(n%256===0){await new Promise(resolve=>setTimeout(resolve,0));current(signal);}
  const field=manifest.fields[view.getUint32(offset+n*8,true)],ordinal=view.getUint32(offset+n*8+4,true),data=sourceMasks.get(field.id),g=field.brickGridXYZ,s=field.storageDimensionsXYZ;
  if(!(data instanceof Uint8Array)||data.length!==field.sourceDecodedBytes)throw new Error('A verified source mask is missing from the reference transport.');
  const x=(ordinal%g[0])*8,y=(Math.floor(ordinal/g[0])%g[1])*8,z=Math.floor(ordinal/(g[0]*g[1]))*8,width=Math.min(8,s[0]-x),target=p.offset+n*512;
  for(let dz=0;dz<Math.min(8,s[2]-z);dz++)for(let dy=0;dy<Math.min(8,s[1]-y);dy++){const start=x+s[0]*(y+dy+s[1]*(z+dz));bytes.set(data.subarray(start,start+width),target+8*(dy+8*dz));}
 }
 current(signal);if(await digest(bytes)!==manifest.asset.decodedSha256)throw new Error('The reconstructed reviewed mask atlas checksum does not match.');current(signal);return bytes;
}
export async function loadReviewedMaskAtlas({fetcher=fetch,signal}={}){
 current(signal);const response=await fetcher(MANIFEST,{signal,priority:'low'});
 if(!response.ok)throw new Error('The completed model mask metadata is unavailable.');
 const manifest=validateReviewedMaskManifest(await response.json());current(signal);
 if(!manifest.transport)return decodeReviewedMaskAtlas(await loadVerifiedAsset(manifest.asset,fetcher,signal),manifest);
 const program=await loadVerifiedAsset(manifest.transport,fetcher,signal);validateReviewedMaskReferences(program,manifest);
 const sourceMasks=new Map();
 for(const f of manifest.fields){current(signal);sourceMasks.set(f.id,await loadVerifiedAsset({url:f.sourceUrl,compressedBytes:f.sourceCompressedBytes,decodedBytes:f.sourceDecodedBytes,sha256:f.sourceCompressedSha256,decodedSha256:f.sourceDecodedSha256},fetcher,signal));}
 const bytes=await decodeReviewedMaskReferences(program,manifest,sourceMasks,{signal});return {...decodeReviewedMaskAtlas(bytes,manifest),sourceMasks};
}
export function reviewedSourceMask(atlas,id,mask){
 const collection=atlas?.collection||atlas,field=collection?.manifest?.fields.find(f=>f.id===id),data=collection?.sourceMasks?.get?.(id);
 return field&&data instanceof Uint8Array&&data.length===field.sourceDecodedBytes&&sourceFieldMatches(field,mask)?data:null;
}
function sourceFieldMatches(f,mask){
 return !!mask&&f.sourceUrl===mask.url&&f.sourceCompressedSha256===mask.sha256&&f.sourceDecodedSha256===mask.decodedSha256&&f.sourceDecodedBytes===mask.decodedBytes&&equal(f.dimensionsXYZ,mask.dimensionsXYZ)&&equal(f.storageDimensionsXYZ,mask.storageDimensionsXYZ)&&equal(f.lowerFullFineXYZ,mask.lowerFullFineXYZ);
}

export function sampleReviewedMask(collection,id,fullFineXYZ){
 const f=collection?.manifest.fields.find(field=>field.id===id);if(!f)return false;
 const q=fullFineXYZ.map((v,i)=>v-f.lowerFullFineXYZ[i]);
 if(q.some((v,i)=>!Number.isFinite(v)||v<-.5||v>=f.dimensionsXYZ[i]-.5))return false;
 const [x,y,z]=q.map(v=>Math.floor(v+.5)),stored=[x>>3,y,z],b=stored.map(v=>v>>3),g=f.brickGridXYZ;
 const brick=collection.index[f.indexOffset+b[0]+g[0]*(b[1]+g[1]*b[2])];if(!brick)return false;
 const offset=(brick-1)*512+(stored[0]&7)+8*((stored[1]&7)+8*(stored[2]&7));
 return !!((collection.payload[offset]>>(x&7))&1);
}

function drainErrors(gl){const out=[];for(let n=0;n<16;n++){const error=gl.getError();if(error===gl.NO_ERROR)break;out.push(error);}return out;}
/** Uploads are synchronous: isolate their errors and restore the caller's GL state. */
export function isolatedReviewedUpload(gl,operation){
 if(gl.isContextLost())throw new Error('The graphics context is unavailable for the completed model.');
 const state={active:gl.getParameter(gl.ACTIVE_TEXTURE),vao:gl.getParameter(gl.VERTEX_ARRAY_BINDING),array:gl.getParameter(gl.ARRAY_BUFFER_BINDING),alignment:gl.getParameter(gl.UNPACK_ALIGNMENT)};
 const unpackNames=['UNPACK_ROW_LENGTH','UNPACK_IMAGE_HEIGHT','UNPACK_SKIP_PIXELS','UNPACK_SKIP_ROWS','UNPACK_SKIP_IMAGES','UNPACK_FLIP_Y_WEBGL','UNPACK_PREMULTIPLY_ALPHA_WEBGL','UNPACK_COLORSPACE_CONVERSION_WEBGL'];
 const unpack=unpackNames.filter(name=>typeof gl[name]==='number').map(name=>[gl[name],gl.getParameter(gl[name])]);
 const hasUnpackBuffer=typeof gl.PIXEL_UNPACK_BUFFER==='number'&&typeof gl.PIXEL_UNPACK_BUFFER_BINDING==='number',unpackBuffer=hasUnpackBuffer?gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING):null;
 const preexistingErrors=drainErrors(gl);
 try{
  if(hasUnpackBuffer)gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,null);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);for(const [key]of unpack)gl.pixelStorei(key,0);
  const result=operation();
  const errors=drainErrors(gl);if(errors.length||gl.isContextLost())throw new Error('The graphics device could not retain the completed model'+(errors.length?' (GL '+errors.map(n=>'0x'+n.toString(16)).join(', ')+')':'')+'.');
  return {result,preexistingErrors};
 }finally{
  gl.bindVertexArray(state.vao);gl.bindBuffer(gl.ARRAY_BUFFER,state.array);gl.pixelStorei(gl.UNPACK_ALIGNMENT,state.alignment);for(const [key,value]of unpack)gl.pixelStorei(key,value);if(hasUnpackBuffer)gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,unpackBuffer);gl.activeTexture(state.active);
 }
}

export class ReviewedMaskAtlas{
 constructor(gl,collection=null,{validateManifest=validateReviewedMaskManifest}={}){
  this.gl=gl;this.collection=collection;this.ready=false;this.indexTexture=null;this.payloadTexture=null;
  this.offsets=new Int32Array(8);this.grids=new Int32Array(24);
  if(collection){validateManifest(collection.manifest);if(!(collection.index instanceof Uint32Array)||!(collection.payload instanceof Uint8Array)||collection.index.byteLength!==collection.manifest.indexTexture.byteLength||collection.payload.byteLength!==collection.manifest.payloadTexture.byteLength)throw new Error('Invalid reviewed mask atlas upload.');collection.manifest.fields.forEach((f,i)=>{this.offsets[i]=f.indexOffset;this.grids.set(f.brickGridXYZ,i*3);});}
  const index=collection?.manifest.indexTexture||{width:1,height:1},payload=collection?.manifest.payloadTexture||{width:1,height:1},max=gl.getParameter(gl.MAX_TEXTURE_SIZE);
  if([index.width,index.height,payload.width,payload.height].some(n=>n>max))throw new Error('The completed model needs a 2D texture size of at least '+Math.max(index.width,index.height,payload.width,payload.height)+'.');
  if(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)<8)throw new Error('The graphics device cannot bind the completed model masks.');
  const bindings=[];
  try{
   const upload=isolatedReviewedUpload(gl,()=>{
    gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
    for(const [unit,name,layout,internal,format,type,data]of [[6,'indexTexture',index,gl.R32UI,gl.RED_INTEGER,gl.UNSIGNED_INT,collection?.index||new Uint32Array(1)],[7,'payloadTexture',payload,gl.RGBA8,gl.RGBA,gl.UNSIGNED_BYTE,collection?.payload||new Uint8Array(4)]]){
     gl.activeTexture(gl.TEXTURE0+unit);bindings.push([unit,gl.getParameter(gl.TEXTURE_BINDING_2D)]);
     const texture=gl.createTexture();if(!texture)throw new Error('The completed model mask storage is unavailable.');this[name]=texture;gl.bindTexture(gl.TEXTURE_2D,texture);
     for(const [key,value]of [[gl.TEXTURE_MIN_FILTER,gl.NEAREST],[gl.TEXTURE_MAG_FILTER,gl.NEAREST],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,key,value);
     gl.texImage2D(gl.TEXTURE_2D,0,internal,layout.width,layout.height,0,format,type,data);
    }
   });this.preexistingErrors=upload.preexistingErrors;this.ready=!!collection;
  }catch(error){this.dispose();throw error;}
  finally{const active=gl.getParameter(gl.ACTIVE_TEXTURE);for(const [unit,texture]of bindings){gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,texture);}gl.activeTexture(active);}
 }
 fieldIndex(id,mask){
  if(!this.ready)return -1;const index=this.collection.manifest.fields.findIndex(field=>field.id===id);if(index<0)return -1;
  const f=this.collection.manifest.fields[index];
  if(mask&&!sourceFieldMatches(f,mask))return -1;
  return index;
 }
 sample(id,fullFineXYZ){return this.ready&&sampleReviewedMask(this.collection,id,fullFineXYZ);}
 bindScene(u){
  const gl=this.gl;gl.activeTexture(gl.TEXTURE0+6);gl.bindTexture(gl.TEXTURE_2D,this.indexTexture);gl.uniform1i(u.reviewedMaskIndex,6);
  gl.activeTexture(gl.TEXTURE0+7);gl.bindTexture(gl.TEXTURE_2D,this.payloadTexture);gl.uniform1i(u.reviewedMaskPayload,7);
  gl.uniform1i(u.reviewedMaskReady,this.ready?1:0);gl.uniform1iv(u.reviewedMaskOffsets,this.offsets);gl.uniform3iv(u.reviewedMaskGrids,this.grids);
 }
 dispose(){if(this.indexTexture)this.gl.deleteTexture(this.indexTexture);if(this.payloadTexture)this.gl.deleteTexture(this.payloadTexture);this.indexTexture=this.payloadTexture=null;this.ready=false;}
}

export function cancelReviewedMaskAtlas(renderer){const pending=renderer.reviewedMaskAtlasLoading;if(pending){renderer.reviewedMaskAtlasLoading=null;pending.controller.abort();}}
export async function ensureReviewedMaskAtlas(renderer,{fetcher=fetch,signal,loadCollection=loadReviewedMaskAtlas,validateManifest=validateReviewedMaskManifest,requiredFields=8}={}){
 current(signal);if(renderer.reviewedMaskAtlas?.ready&&(renderer.reviewedMaskAtlas.collection?.manifest?.fields?.length??8)>=requiredFields)return renderer.reviewedMaskAtlas;
 if(!renderer.gl)throw new Error('The completed model requires WebGL 2.');
 let job=renderer.reviewedMaskAtlasLoading;
 if(job&&(job.requiredFields??8)<requiredFields){renderer.reviewedMaskAtlasLoading=null;job.controller.abort();job=null;}
 if(!job){
  job={controller:new AbortController(),consumers:new Set(),settled:false,promise:null,requiredFields:loadCollection===loadReviewedMaskAtlas?8:requiredFields};renderer.reviewedMaskAtlasLoading=job;
  job.promise=loadCollection({fetcher,signal:job.controller.signal}).then(collection=>{
   current(job.controller.signal);if(renderer.reviewedMaskAtlasLoading!==job)throw interrupted();
   if(renderer.setReviewedMaskAtlas)renderer.setReviewedMaskAtlas(collection,{validateManifest});
   else{const next=new ReviewedMaskAtlas(renderer.gl,collection,{validateManifest});renderer.reviewedMaskAtlas?.dispose();renderer.reviewedMaskAtlas=next;renderer.requestRender?.('scene');}
   return renderer.reviewedMaskAtlas;
  }).finally(()=>{job.settled=true;if(renderer.reviewedMaskAtlasLoading===job)renderer.reviewedMaskAtlasLoading=null;});
 }
 const consumer={};job.consumers.add(consumer);
 try{return await new Promise((resolve,reject)=>{
  const aborted=()=>{signal?.removeEventListener('abort',aborted);reject(interrupted());};
  signal?.addEventListener('abort',aborted,{once:true});
  job.promise.then(value=>{signal?.removeEventListener('abort',aborted);signal?.aborted?reject(interrupted()):resolve(value);},error=>{signal?.removeEventListener('abort',aborted);reject(error);});
  if(signal?.aborted)aborted();
 });}finally{job.consumers.delete(consumer);if(!job.settled&&!job.consumers.size){if(renderer.reviewedMaskAtlasLoading===job)renderer.reviewedMaskAtlasLoading=null;job.controller.abort();}}
}
