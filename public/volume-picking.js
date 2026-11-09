/** Pick the first measured tissue intersection in Surface mode, including cut faces. */
import {clipPlane} from './planes.js';
import {sampleReviewedMask} from './reviewed-mask-atlas.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
const norm=v=>{const length=Math.hypot(...v)||1;return v.map(x=>x/length);};

export function mapAt(map,t){
 if(!map)return 0;
 const [nx,ny,nz]=map.dimensions;
 const x=clamp(Math.round(t[0]*(nx-1)),0,nx-1),y=clamp(Math.round(t[1]*(ny-1)),0,ny-1),z=clamp(Math.round(t[2]*(nz-1)),0,nz-1);
 return map.data[x+nx*(y+ny*z)];
}

/** Match the reviewed 3D display's nearest mask samples when picking anatomy. */
export function lumenExcludedAt(renderer,p){
 const collection=renderer.lumenCleanup,e=renderer.extent;
 if(renderer.settings.lumenCleanupEnabled!==true||!collection||!collection.extent.every((n,i)=>Math.abs(n-e[i])<.000001))return false;
 const f=[p[0]/e[0]+.5,.5-p[2]/e[2],p[1]/e[1]+.5].map((n,i)=>n*(collection.fullDimensionsXYZ[i]-1));
 if(collection.sparseAtlas)return collection.masks.some(mask=>sampleReviewedMask(collection.sparseAtlas,'lumen:'+mask.id,f));
 for(const mask of collection.masks){
  const d=mask.dimensionsXYZ,q=f.map((n,i)=>n-mask.lowerFullFineXYZ[i]);
  if(q.some((n,i)=>n<-.5||n>=d[i]-.5))continue;
  const [x,y,z]=q.map(n=>Math.floor(n+.5));
  if(collection.bitPacked){
   const storage=mask.storageDimensionsXYZ;
   if((mask.data[(x>>3)+storage[0]*(y+storage[1]*z)]>>(x&7))&1)return true;
  }else if(mask.data[x+d[0]*(y+d[1]*z)]>=128)return true;
 }
 return false;
}

export function pickVolume(renderer,u,v){
 const {data,dimensions:d,extent:e,settings:s,cap,cleanup,anatomy}=renderer;
 const coronary=renderer.coronaryActive?.(),surfaceData=coronary?.data||data,surfaceGrid=coronary?.meta.dimensions||d,surfaceThreshold=coronary?.meta.threshold??s.threshold;
 if(!data||s.mode!==0||u<0||u>1||v<0||v>1)return null;
 const {eye,forward,right,up}=renderer.basis(),rect=renderer.canvas.getBoundingClientRect();
 const rd=norm(forward.map((q,i)=>q+right[i]*(u*2-1)*rect.width/rect.height*.32+up[i]*(1-v*2)*.32));
 const toTex=p=>[p[0]/e[0]+.5,.5-p[2]/e[2],p[1]/e[1]+.5];
 const point=t=>eye.map((q,i)=>q+rd[i]*t);
 const reviewedExcluded=p=>lumenExcludedAt(renderer,p)||renderer.localSurfaceRefinement?.excludedAt(p);
 const supported=p=>s.cleanupEnabled===false||!cleanup||mapAt(cleanup,toTex(p))>=128;
 const keep=p=>!reviewedExcluded(p)&&supported(p);
 function sample(p,values=data,grid=d){
  const t=toTex(p).map(q=>clamp(q,0,1)),[nx,ny,nz]=grid;
  const x=t[0]*(nx-1),y=t[1]*(ny-1),z=t[2]*(nz-1),ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z),jx=Math.min(ix+1,nx-1),jy=Math.min(iy+1,ny-1),jz=Math.min(iz+1,nz-1),fx=x-ix,fy=y-iy,fz=z-iz;
  const a=ix+nx*(iy+ny*iz),b=ix+nx*(jy+ny*iz),c=ix+nx*(iy+ny*jz),dd=ix+nx*(jy+ny*jz),off=jx-ix;
  return (((values[a]*(1-fx)+values[a+off]*fx)*(1-fy)+(values[b]*(1-fx)+values[b+off]*fx)*fy)*(1-fz)+((values[c]*(1-fx)+values[c+off]*fx)*(1-fy)+(values[dd]*(1-fx)+values[dd+off]*fx)*fy)*fz)/255;
 }
 function density(p){return keep(p)?sample(p,surfaceData,surfaceGrid):0;}
 function capDensity(p){
  if(reviewedExcluded(p))return 0;
  if(!cap)return keep(p)?sample(p):0;
  const f=cap.plane,delta=p.map((q,i)=>q-f.center[i]),xNorm=dot(delta,f.right)/f.width+.5,yNorm=.5-dot(delta,f.up)/f.height;
  if(xNorm<0||xNorm>1||yNorm<0||yNorm>1)return supported(p)?sample(p):0;
  // Match the displayed GPU cap: a prepared fine image already carries its
  // source-resolution cleanup, so coarse support must not erase its fine edges.
  if(cap.cleaned!==true&&!supported(p))return 0;
  const x=xNorm*(cap.width-1),y=yNorm*(cap.height-1),ix=Math.floor(x),iy=Math.floor(y),jx=Math.min(ix+1,cap.width-1),jy=Math.min(iy+1,cap.height-1),fx=x-ix,fy=y-iy;
  return ((cap.data[ix+iy*cap.width]*(1-fx)+cap.data[jx+iy*cap.width]*fx)*(1-fy)+(cap.data[ix+jy*cap.width]*(1-fx)+cap.data[jx+jy*cap.width]*fx)*fy)/255;
 }
 let start=0,end=Infinity,capAtEntry=false;
 for(let i=0;i<3;i++){
  if(Math.abs(rd[i])<1e-10){if(Math.abs(eye[i])>e[i]*.5)return null;continue;}
  const a=(-e[i]*.5-eye[i])/rd[i],b=(e[i]*.5-eye[i])/rd[i];
  start=Math.max(start,Math.min(a,b));end=Math.min(end,Math.max(a,b));
 }
 const plane=clipPlane(s,e);
 if(plane){
  const side=dot(plane.normal,eye)-plane.distance,denom=dot(plane.normal,rd);
  if(Math.abs(denom)<1e-6){if(side>0)return null;}
  else {const pt=-side/denom;if(denom<0){capAtEntry=pt>=start-1e-6;start=Math.max(start,pt);}else end=Math.min(end,pt);}
 }
 if(end<=start)return null;
 function result(p,value,isCap){
  const t=toTex(p).map(q=>clamp(q,0,1));
  return {sourceNormalized:t,sourceIndex:t.map((q,i)=>q*(d[i]-1)),world:p,labelId:mapAt(anatomy,t),value:coronary&&!isCap?sample(p):value,cutFace:isCap,method:coronary&&!isCap?'prepared-coronary-surface':'surface-first-intersection'};
 }
 if(capAtEntry){const p=point(start),value=capDensity(p);if(value>s.threshold)return result(p,value,true);}
 const step=.0014;
 let previous=start;
 for(let t=start+(capAtEntry?step:0);t<=end;t+=step){
  const p=point(t),value=density(p);
  if(value>surfaceThreshold){
   let a=previous,b=t;
   for(let j=0;j<7;j++){const mid=(a+b)*.5;if(density(point(mid))>surfaceThreshold)b=mid;else a=mid;}
   const hit=point((a+b)*.5);return result(hit,density(hit),false);
  }
  previous=t;
 }
 return null;
}
