/** Whole donor heart geometry for the independent TTE chest camera.
 *
 * Prefer the prepared indexed surface of the selected donor. If that surface
 * cannot load, derive a bounded coarse orientation outline from the resident
 * scalar volume. Neither path edits source bytes or the main reconstruction.
 */
import {volumeGeometry,beamPoint} from './probe-geometry.js';
import {add,mul,dot,cross,norm} from './planes.js';

export const OVERVIEW_MAX_GRID=40;
export const OVERVIEW_MAX_TRIANGLES=48000;
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const lerp=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const abort=signal=>{if(signal?.aborted)throw signal.reason||new DOMException('Overview cancelled.','AbortError');};
const yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0));
const sha256=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
async function boundedBytes(stream,expected,signal){
 if(!Number.isSafeInteger(expected)||expected<1||expected>48*1024*1024)throw new Error('Whole-heart asset exceeds the overview budget.');
 const output=new Uint8Array(expected),reader=stream.getReader();let at=0;
 try{while(true){abort(signal);const {value,done}=await reader.read();if(done)break;if(at+value.length>output.length)throw new Error('Whole-heart asset length mismatch.');output.set(value,at);at+=value.length;}if(at!==expected)throw new Error('Whole-heart asset is incomplete.');return output;}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
}

/** Complete prepared donor surface, kept indexed for a bounded second view.
 * LADAF reuses its existing compact whole-heart mesh byte for byte. The two
 * comparison donors use separately prepared surfaces of their own high grids.
 * Source positions are never fitted to the reference chest or a moving probe.
 */
export async function loadWholeHeartOverview(donorId,referenceMm,{signal,fetchImpl=(...args)=>globalThis.fetch(...args),yieldControl=yieldTask}={}){
 const response=await fetchImpl(new URL('./assets/probe-heart-v44/manifest.json',import.meta.url),{signal,cache:'force-cache'});
 if(!response.ok)throw new Error('Whole-heart overview metadata is unavailable.');
 const manifest=await response.json(),spec=manifest.donors?.find(d=>d.donorId===donorId),lod=spec?.lod;
 if(manifest.schemaVersion!==1||!spec||!lod||!Number.isFinite(referenceMm)||referenceMm<=0||!Number.isFinite(spec.referenceMm)||spec.referenceMm<=0||Math.abs(spec.referenceMm-referenceMm)>.5)throw new Error('Whole-heart overview belongs to another source.');
 const count=lod.vertexCount||lod.vertices,indexCount=lod.indexCount||lod.triangles*3;
 if(!Number.isSafeInteger(count)||count<3||count>600000||!Number.isSafeInteger(indexCount)||indexCount<3||indexCount%3||indexCount>2000000||lod.compressedBytes>8*1024*1024||lod.decodedBytes>48*1024*1024)throw new Error('Whole-heart overview exceeds the surface budget.');
 if(!spec.bounds?.min?.every(Number.isFinite)||!spec.bounds?.max?.every(Number.isFinite)||spec.bounds.min.length!==3||spec.bounds.max.length!==3||spec.bounds.min.some((v,i)=>v>=spec.bounds.max[i]))throw new Error('Whole-heart overview bounds are invalid.');
 const asset=await fetchImpl(new URL(lod.url,new URL('./',import.meta.url)),{signal,cache:'force-cache'});if(!asset.ok)throw new Error('Whole-heart overview could not load.');
 const compressed=await boundedBytes(asset.body,lod.compressedBytes,signal);if(await sha256(compressed)!==lod.sha256)throw new Error('Whole-heart overview transport checksum mismatch.');
 const raw=await boundedBytes(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')),lod.decodedBytes,signal);if(await sha256(raw)!==lod.decodedSha256)throw new Error('Whole-heart overview decoded checksum mismatch.');
 const header=new DataView(raw.buffer,raw.byteOffset,raw.byteLength),po=header.getUint32(16,true),no=header.getUint32(20,true),io=header.getUint32(24,true);
 if(header.getUint32(0,true)!==0x314d4648||header.getUint32(4,true)!==1||header.getUint32(8,true)!==count||header.getUint32(12,true)!==indexCount||po<32||po%2||no%2||io%4||po+count*6>no||no+count*6>io||io+indexCount*4!==raw.length)throw new Error('Whole-heart overview mesh layout mismatch.');
 const positions=new Uint16Array(raw.buffer,po,count*3),normals=new Int16Array(raw.buffer,no,count*3),sourceIndices=new Uint32Array(raw.buffer,io,indexCount),vertices=new Float32Array(count*6),min=spec.bounds.min,max=spec.bounds.max;
 for(let i=0;i<count;i++){
  for(let k=0;k<3;k++){vertices[i*6+k]=(min[k]+positions[i*3+k]/65535*(max[k]-min[k]))*referenceMm;vertices[i*6+k+3]=Math.max(-1,normals[i*3+k]/32767);}
  if(i%32768===32767){await yieldControl();abort(signal);}
 }
 for(const index of sourceIndices)if(index>=count)throw new Error('Whole-heart overview has an invalid index.');
 abort(signal);
 return {vertices,indices:sourceIndices.slice(),bounds:{min:mul(min,referenceMm),max:mul(max,referenceMm),center:mul(add(min,max),referenceMm*.5)},referenceMm,triangles:indexCount/3,kind:'prepared-whole-heart',source:spec,decodedSha256:lod.decodedSha256};
}
const corners=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
const tetrahedra=[[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]];
const edges=[[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]];

export function overviewSourcePointMm(meta,source){
 const geometry=volumeGeometry(meta),d=meta.dimensions,s=geometry.sourceSizeMm;
 return [(source[0]/(d[0]-1)-.5)*s[0],(source[2]/(d[2]-1)-.5)*s[2],(.5-source[1]/(d[1]-1))*s[1]];
}

export function overviewGrid(meta,maxGrid=OVERVIEW_MAX_GRID){
 const g=volumeGeometry(meta),limit=Math.max(8,Math.min(OVERVIEW_MAX_GRID,Math.round(maxGrid)));
 return g.sourceSizeMm.map((size,i)=>Math.max(3,Math.min(meta.dimensions[i],Math.round(size/g.longestMm*(limit-1))+1)));
}

function sample(data,d,x,y,z){
 const i=Math.min(d[0]-2,Math.max(0,Math.floor(x))),j=Math.min(d[1]-2,Math.max(0,Math.floor(y))),k=Math.min(d[2]-2,Math.max(0,Math.floor(z))),a=x-i,b=y-j,c=z-k;
 let result=0;
 for(let dz=0;dz<2;dz++)for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++)result+=data[i+dx+d[0]*(j+dy+d[1]*(k+dz))]*(dx?a:1-a)*(dy?b:1-b)*(dz?c:1-c);
 return result;
}

/** At most 40³ scalar samples and 48k triangles, yielding between Z slabs.
 * The returned XYZ/NXYZ positions use the very same world-mm mapping as the
 * main volume. No fitting, centering or per-probe transform is applied.
 */
export async function createDonorOverview(data,meta,{threshold=.28,maxGrid=OVERVIEW_MAX_GRID,signal,yieldControl=yieldTask}={}){
 const d=meta?.dimensions;
 if(!(data instanceof Uint8Array)||!Array.isArray(d)||d.length!==3||!d.every(n=>Number.isInteger(n)&&n>1)||data.length!==d.reduce((a,b)=>a*b,1))throw new TypeError('Overview requires the current complete donor volume.');
 if(!(Number.isFinite(threshold)&&threshold>0&&threshold<1))throw new TypeError('Overview requires the current source threshold.');
 const grid=overviewGrid(meta,maxGrid),[nx,ny,nz]=grid,g=volumeGeometry(meta),values=new Float32Array(nx*ny*nz),level=threshold*255;
 for(let z=0;z<nz;z++){
  abort(signal);
  for(let y=0;y<ny;y++)for(let x=0;x<nx;x++)values[x+nx*(y+ny*z)]=sample(data,d,x*(d[0]-1)/(nx-1),y*(d[1]-1)/(ny-1),z*(d[2]-1)/(nz-1));
  if(z%4===3)await yieldControl();
 }
 const result=new Float32Array(OVERVIEW_MAX_TRIANGLES*18),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];let at=0;
 const point=(x,y,z)=>[(x/(nx-1)-.5)*g.sourceSizeMm[0],(z/(nz-1)-.5)*g.sourceSizeMm[2],(.5-y/(ny-1))*g.sourceSizeMm[1]];
 const emit=(a,b,c,outward)=>{
  let normal=cross(sub(b,a),sub(c,a));if(Math.hypot(...normal)<1e-9)return;
  if(dot(normal,outward)<0){const swap=b;b=c;c=swap;normal=mul(normal,-1);}normal=norm(normal);
  if(at+18>result.length)throw new RangeError('Overview triangle budget exceeded.');
  for(const p of [a,b,c]){result.set(p,at);result.set(normal,at+3);at+=6;for(let k=0;k<3;k++){min[k]=Math.min(min[k],p[k]);max[k]=Math.max(max[k],p[k]);}}
 };
 try{
  for(let z=0;z<nz-1;z++){
   abort(signal);
   let yieldedAt=performance.now();
   for(let y=0;y<ny-1;y++){
    if(y%2===1&&performance.now()-yieldedAt>6){await yieldControl();abort(signal);yieldedAt=performance.now();}
    for(let x=0;x<nx-1;x++){
    const v=corners.map(([a,b,c])=>values[x+a+nx*(y+b+ny*(z+c))]);if(v.every(q=>q<=level)||v.every(q=>q>level))continue;
    const p=corners.map(([a,b,c])=>point(x+a,y+b,z+c));
    for(const t of tetrahedra){
     const inside=t.filter(i=>v[i]>level),outside=t.filter(i=>v[i]<=level);if(!inside.length||!outside.length)continue;
     const centre=ids=>mul(ids.reduce((s,i)=>add(s,p[i]),[0,0,0]),1/ids.length),outward=sub(centre(outside),centre(inside)),cut=[];
     for(const [a,b]of edges){const i=t[a],j=t[b];if((v[i]>level)!==(v[j]>level))cut.push(lerp(p[i],p[j],(level-v[i])/(v[j]-v[i])));}
     if(cut.length===3)emit(...cut,outward);
     else if(cut.length===4){
      const center=mul(cut.reduce((s,p)=>add(s,p),[0,0,0]),.25),u=norm(sub(cut[0],center)),normal=norm(outward),w=norm(cross(normal,u));
      cut.sort((a,b)=>Math.atan2(dot(sub(a,center),w),dot(sub(a,center),u))-Math.atan2(dot(sub(b,center),w),dot(sub(b,center),u)));
      emit(cut[0],cut[1],cut[2],outward);emit(cut[0],cut[2],cut[3],outward);
     }
    }
    }
   }
   if(z%2===1)await yieldControl();
  }
 }catch(error){
  if(error instanceof RangeError&&maxGrid>24)return createDonorOverview(data,meta,{threshold,maxGrid:24,signal,yieldControl});
  throw error;
 }
 abort(signal);
 return {vertices:result.slice(0,at),bounds:at?{min,max,center:mul(add(min,max),.5)}:null,grid,sourceDimensions:[...d],sourceSpacingUm:meta.spacingUm,threshold,referenceMm:g.longestMm,triangles:at/18,kind:'measured-coarse-orientation-outline'};
}

/** The overview consumes the accepted snapshot without retargeting it. */
export function donorOverviewPose(sourcePose){return sourcePose||null;}

/** Exact same world-mm sector as the main donor view, including missed tissue. */
export function donorOverviewSector(pose,state,segments=48){
 if(!pose)return [];
 const half=state.angleDeg*Math.PI/360;
 return [pose.originMm,...Array.from({length:segments+1},(_,i)=>beamPoint(pose,-half+2*half*i/segments,state.depthMm))];
}

/** Independent camera, fixed donor-space anatomy. Its normalization changes
 * only projection scale, never the geometry, probe origin or scan sector.
 */
export function donorOverviewCamera(model,aspect=1,mode='oblique',heartBounds){
 const skeleton=model.meshes.filter(m=>m.id==='bodyparts3d-bones'||m.id==='bodyparts3d-spine'),points=skeleton.flatMap(m=>[m.bounds.min,m.bounds.max]);
 if(heartBounds)points.push(heartBounds.min,heartBounds.max);
 const bounds={min:[0,1,2].map(k=>Math.min(...points.map(p=>p[k]))),max:[0,1,2].map(k=>Math.max(...points.map(p=>p[k])))};
 const target=mul(add(bounds.min,bounds.max),.5),frame=model.frame,away=norm(add(mul(frame.anterior,mode==='front'?1:.866),add(mul(frame.left,mode==='front'?0:.5),mul(frame.superior,.07)))),forward=mul(away,-1),right=norm(cross(forward,frame.superior)),up=norm(cross(right,forward));
 const ratio=Math.max(.15,Number(aspect)||1),referenceMm=model.referenceMm*2.5;let distance=model.referenceMm;
 const fit=(x,y,z)=>{
  x-=target[0];y-=target[1];z-=target[2];
  const depth=x*forward[0]+y*forward[1]+z*forward[2],horizontal=x*right[0]+y*right[1]+z*right[2],vertical=x*up[0]+y*up[1]+z*up[2];
  distance=Math.max(distance,Math.abs(horizontal)*1.06/(.32*ratio)-depth,Math.abs(vertical)*1.06/.32-depth);
 };
 // Fit real fixed skeleton points, not the eight phantom corners of its
 // rotated world AABB. Those corners can be far outside the chest and made
 // the old overview needlessly tiny. The fixed target remains unchanged.
 for(const mesh of skeleton)for(let i=0;i<mesh.vertices.length;i+=6)fit(mesh.vertices[i],mesh.vertices[i+1],mesh.vertices[i+2]);
 if(heartBounds)for(let mask=0;mask<8;mask++)fit(...heartBounds.min.map((v,k)=>(mask>>k)&1?heartBounds.max[k]:v));
 return {eye:mul(add(target,mul(away,distance)),1/referenceMm),forward,right,up,target:mul(target,1/referenceMm),distance:distance/referenceMm,referenceMm,bounds};
}
