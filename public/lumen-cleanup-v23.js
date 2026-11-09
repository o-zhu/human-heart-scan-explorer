/** Reversible, source-pinned display review. No source or measured CT pixels are edited. */
import {ensureReviewedMaskAtlas,reviewedSourceMask} from './reviewed-mask-atlas.js';
import {loadMobileLumenAtlas,validateMobileLumenManifest} from './mobile-lumen-atlas.js';
import {getDeviceResourcePolicy} from './device-resources.js';
const MANIFEST='./assets/cleanup-v30/lumen-manifest.json';
const SOURCE='e50ab70a52373dc774cf6077ef906a753e56b78b9f9b646fba2ffe7220ff338c';
const FULL=[1897,1897,2117],MAX_MASK=128*1024*1024;
const hash=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),v=>v.toString(16).padStart(2,'0')).join('');
const sha=h=>typeof h==='string'&&/^[a-f0-9]{64}$/.test(h);

async function exactBytes(stream,size){
 if(!stream)throw new Error('Lumen review download is empty.');
 const reader=stream.getReader(),bytes=new Uint8Array(size);let used=0;
 try{
  for(;;){const {value,done}=await reader.read();if(done)break;if(used+value.length>size)throw new Error('Lumen review length does not match.');bytes.set(value,used);used+=value.length;}
  if(used!==size)throw new Error('Lumen review length does not match.');
 }catch(error){await reader.cancel().catch(()=>{});throw error;}
 finally{reader.releaseLock();}
 return bytes;
}

export async function loadLumenCollection({signal,extent,fetcher=fetch,atlas,sparse=false}={}){
 const response=await fetcher(MANIFEST,{signal,priority:'low'});
 if(!response.ok)throw new Error('Lumen review metadata is unavailable.');
 const manifest=await response.json();
 if(manifest.donorId!=='ladaf-2021-17'||manifest.sourceManifestSha256!==SOURCE||manifest.sourceSpacingUm!==79.4||!Array.isArray(manifest.sourceFullDimensionsXYZ)||!FULL.every((n,i)=>manifest.sourceFullDimensionsXYZ[i]===n)||!Array.isArray(manifest.extent)||manifest.extent.length!==3||!manifest.extent.every((n,i)=>Number.isFinite(n)&&Math.abs(n-extent[i])<.000001)||!Array.isArray(manifest.masks)||manifest.masks.length<1||manifest.masks.length>4||manifest.sampling!=='nearest'||manifest.format!=='gzip-bitset-x-zyx')throw new Error('The lumen review does not match this source.');
 const masks=[];let totalBytes=0;
 for(const item of manifest.masks){
  const dims=item.dimensionsXYZ,lower=item.lowerFullFineXYZ,upper=item.upperFullFineXYZ,storage=item.storageDimensionsXYZ;
  if(!['atrial','arterial','valve-region','rv'].includes(item.id)||masks.some(m=>m.id===item.id)||typeof item.url!=='string'||!/^\.\/assets\/cleanup-v(?:28|29|30)\/[a-z-]+\.(?:raw|bits)\.gz$/.test(item.url)||!Array.isArray(dims)||dims.length!==3||!dims.every((n,i)=>Number.isInteger(n)&&n>0&&Number.isInteger(lower?.[i])&&lower[i]>=0&&upper?.[i]===lower[i]+n&&upper[i]<=FULL[i])||!Array.isArray(storage)||storage.length!==3||!storage.every((n,i)=>n===(i===0?Math.ceil(dims[0]/8):dims[i]))||!Number.isInteger(item.compressedBytes)||item.compressedBytes<=0||item.compressedBytes>8*1024*1024||!Number.isInteger(item.decodedBytes)||item.decodedBytes<=0||item.decodedBytes>MAX_MASK||item.decodedBytes!==storage.reduce((a,b)=>a*b,1)||!sha(item.sha256)||!sha(item.decodedSha256)||(totalBytes+=item.decodedBytes)>MAX_MASK)throw new Error('Invalid lumen review manifest.');
  if(sparse){
   if(!atlas?.ready||!atlas.collection||atlas.fieldIndex('lumen:'+item.id,item)<0)throw new Error('The sparse lumen atlas does not match this reviewed mask.');
   masks.push({...item});continue;
  }
  let data=reviewedSourceMask(atlas,'lumen:'+item.id,item);
  if(!data){
  const reply=await fetcher(item.url,{signal,priority:'low'});
  if(!reply.ok)throw new Error('Lumen review download failed.');
  const packed=await exactBytes(reply.body,item.compressedBytes);
  if(await hash(packed)!==item.sha256)throw new Error('Lumen review checksum did not match.');
  data=await exactBytes(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip')),item.decodedBytes);
  if(await hash(data)!==item.decodedSha256)throw new Error('Lumen review decoded checksum did not match.');
  }
  const remainder=dims[0]&7;
  if(remainder)for(let i=storage[0]-1;i<data.length;i+=storage[0])if(data[i]&(~((1<<remainder)-1)&255))throw new Error('Invalid lumen review padding.');
  masks.push({...item,data});
 }
 return {id:manifest.id,fullDimensionsXYZ:FULL,extent:manifest.extent,bitPacked:true,masks,...(sparse?{sparseAtlas:atlas.collection}:{})};
}

export class LumenCleanupController{
 constructor({renderer,donor,mount,toast=()=>{},onChange=()=>{},autoStart=true,resourcePolicy=getDeviceResourcePolicy(),compact=resourcePolicy.constrained===true,fetcher=(...args)=>globalThis.fetch(...args)}){
  if(donor.id!=='ladaf-2021-17')return;
  this.renderer=renderer;this.mount=mount;this.toast=toast;this.onChange=onChange;this.revision=0;this.loading=false;this.error=null;this.compact=compact;this.fetcher=fetcher;
  mount.innerHTML='<div class="lumen-review-heading"><h4>Lumen Cleanup</h4><span class="control-note">On by default</span></div><label class="lumen-review-toggle"><input id="lumenCleanupToggle" type="checkbox" checked><span>Hide Reviewed Lumen Material</span></label><p class="control-note">Targets reviewed atrial clumps, arterial particles and selected valve-adjacent and right-ventricular material. Turn off to compare the original reconstruction. The CT section cards retain the measured scan.</p><p id="lumenCleanupStatus" class="control-note" role="status" aria-live="polite">Preparing the reviewed lumen cleanup…</p>';
  this.toggle=mount.querySelector('#lumenCleanupToggle');this.status=mount.querySelector('#lumenCleanupStatus');
  this.toggle.checked=true;renderer.settings.lumenCleanupEnabled=false;
  this.toggle.disabled=!renderer.gl||typeof renderer.setLumenCleanupData!=='function';
  if(this.toggle.disabled){this.toggle.checked=false;this.status.textContent='The original volume is shown. Reviewed lumen cleanup requires WebGL 2.';}
  this.toggle.addEventListener('change',()=>void this.setEnabled(this.toggle.checked));
  if(!autoStart&&!this.toggle.disabled){
   this.toggle.checked=this.compact;
   mount.querySelector('.lumen-review-heading .control-note').textContent=this.compact?'On by default':'Optional';
   this.status.textContent=this.compact?'The same reviewed cavity cleanup loads with the smaller surface. Original CT cards remain available.':'Reviewed lumen cleanup is available on request.';
  }
  this.ready=this.toggle.disabled||!autoStart?Promise.resolve():this.setEnabled(true);
 }
 setEnabled(enabled,options={}){
  const pending=this.updateEnabled(enabled,options);this.pending=pending;
  const settled=()=>{if(this.pending===pending)this.pending=null;};pending.then(settled,settled);
  return pending;
 }
 async updateEnabled(enabled,{signal}={}){
  if(signal?.aborted)return;
  const revision=++this.revision;this.abort?.abort();this.abort=null;
  const retained=!!this.renderer.lumenCleanup&&this.renderer.settings.lumenCleanupEnabled===true;
  this.renderer.settings.lumenCleanupEnabled=enabled&&retained;this.loading=false;this.error=null;
  if(!enabled){this.toggle.checked=false;this.mount.setAttribute('aria-busy','false');this.status.textContent='Original 3D view · reviewed lumen material is visible.';this.renderer.requestRender('scene');this.onChange();return;}
  this.toggle.checked=true;
  let requestAbort,abortFromParent;
  try{
   if(!this.renderer.lumenCleanup||(!this.compact&&this.renderer.lumenCleanup.sparseAtlas)){
    const abort=new AbortController();this.abort=abort;this.loading=true;this.mount.setAttribute('aria-busy','true');this.status.textContent='Loading the reviewed lumen cleanup…';this.onChange();
    requestAbort=abort;abortFromParent=()=>abort.abort(signal?.reason);signal?.addEventListener('abort',abortFromParent,{once:true});if(signal?.aborted)abortFromParent();
    const atlas=await ensureReviewedMaskAtlas(this.renderer,{signal:abort.signal,fetcher:this.fetcher,requiredFields:this.compact?4:8,...(this.compact?{loadCollection:loadMobileLumenAtlas,validateManifest:validateMobileLumenManifest}:{})});
    const collection=await loadLumenCollection({signal:abort.signal,fetcher:this.fetcher,extent:this.renderer.extent,atlas,sparse:this.compact});
    if(revision!==this.revision||abort.signal.aborted)return;
    this.renderer.setLumenCleanupData(collection);
   }
   if(revision!==this.revision)return;
   this.renderer.settings.lumenCleanupEnabled=true;this.status.textContent='Reviewed lumen cleanup on · original CT cards remain available. Material identity is unverified.';
   this.renderer.requestRender('scene');
  }catch(error){
   if(revision!==this.revision)return;
   if(requestAbort?.signal.aborted){this.status.textContent='Reviewed cleanup preparation paused. The current view remains available.';return;}
   this.error=error.message;this.toggle.checked=retained;this.renderer.settings.lumenCleanupEnabled=retained;this.status.textContent=error.message+(retained?' Previous reviewed cleanup retained.':' Original view retained.');this.toast(this.status.textContent);this.renderer.requestRender('scene');
  }finally{if(abortFromParent)signal?.removeEventListener('abort',abortFromParent);if(revision===this.revision){this.abort=null;this.loading=false;this.mount.setAttribute('aria-busy','false');this.onChange();}}
 }
}
