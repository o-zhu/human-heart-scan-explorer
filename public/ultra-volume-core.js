/** Exact trilinear reformats of a measured display volume. Pure geometry/math. */
export const fineAbort=()=>new DOMException('A newer scan plane is selected.','AbortError');
export const checkFineAbort=signal=>{if(signal?.aborted)throw fineAbort();};
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const vector=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
export function validFinePlane(p){
 if(!p||!['center','right','up'].every(k=>vector(p[k]))||![p.width,p.height].every(v=>Number.isFinite(v)&&v>0&&v<4))throw new Error('Invalid fine scan plane.');
 if(Math.abs(Math.hypot(...p.right)-1)>.002||Math.abs(Math.hypot(...p.up)-1)>.002||Math.abs(dot(p.right,p.up))>.002)throw new Error('The fine scan plane axes must be orthonormal.');
 return {center:[...p.center],right:[...p.right],up:[...p.up],width:p.width,height:p.height,...(vector(p.normal)?{normal:[...p.normal]}:{})};
}
export function sameFinePlane(a,b,tolerance=1e-7){
 return Math.abs(a.width-b.width)<tolerance&&Math.abs(a.height-b.height)<tolerance&&['center','right','up'].every(k=>a[k].every((v,i)=>Math.abs(v-b[k][i])<tolerance));
}
/** A probe can turn or slide within a section without changing its physical
 * plane. Keep the measured image's OWN axes/extent when reusing that section;
 * relabelling its pixels with the new probe axes would rotate the anatomy. */
export function sameFineSection(a,b,tolerance=1e-7){
 if(!a||!b||!['center','right','up'].every(k=>vector(a[k])&&vector(b[k])))return false;
 const normal=p=>{const [r,u]=[p.right,p.up],n=[r[1]*u[2]-r[2]*u[1],r[2]*u[0]-r[0]*u[2],r[0]*u[1]-r[1]*u[0]],length=Math.hypot(...n);return length>0?n.map(v=>v/length):null;};
 const na=normal(a),nb=normal(b);if(!na||!nb)return false;
 const sign=dot(na,nb)<0?-1:1;
 return na.every((v,i)=>Math.abs(v-sign*nb[i])<=tolerance)&&Math.abs(dot(sub(a.center,b.center),na))<=tolerance;
}
const containsFinePoint=(plane,point,tolerance)=>{
 const delta=sub(point,plane.center);
 return Math.abs(dot(delta,plane.right))<=plane.width/2+tolerance&&Math.abs(dot(delta,plane.up))<=plane.height/2+tolerance;
};
/** Conservative coverage proof. Either every requested image corner is inside
 * the cached image, or that image contains the projection of the COMPLETE scan
 * box. In the latter case its pixels cover all tissue on this section, even if
 * another in-plane orientation asks for a differently shaped empty margin. */
export function reusableFineSection(cached,requested,extent=null,tolerance=1e-7){
 if(!sameFineSection(cached,requested,tolerance))return false;
 let containsRequest=true;
 for(const u of [-.5,.5])for(const v of [-.5,.5]){
  const point=requested.center.map((n,i)=>n+requested.right[i]*requested.width*u+requested.up[i]*requested.height*v);
  if(!containsFinePoint(cached,point,tolerance))containsRequest=false;
 }
 if(containsRequest)return true;
 if(!vector(extent)||!extent.every(v=>v>0))return false;
 for(const x of [-.5,.5])for(const y of [-.5,.5])for(const z of [-.5,.5]){
  if(!containsFinePoint(cached,[x*extent[0],y*extent[1],z*extent[2]],tolerance))return false;
 }
 return true;
}
export function fineSourceExtent(manifest){
 const d=manifest?.fullDimensionsXYZ;if(!vector(d)||!d.every(v=>v>1))return null;
 const longest=Math.max(...d.map(v=>v-1));return [(d[0]-1)/longest,(d[2]-1)/longest,(d[1]-1)/longest];
}
export function orientFineSection(imagePlane,requestedPlane){
 return {...imagePlane,center:[...imagePlane.center],right:[...imagePlane.right],up:[...imagePlane.up],...(vector(requestedPlane.normal)?{normal:[...requestedPlane.normal]}:{})};
}
export function finePlaneKey(p){return [p.width,p.height,...p.center,...p.right,...p.up].map(v=>v.toFixed(8)).join(',');}
export function worldToFineVoxel(point,manifest){
 const d=manifest.fullDimensionsXYZ,L=Math.max(...d.map(v=>v-1)),o=manifest.sourceOriginXYZ;
 return [point[0]*L+(d[0]-1)/2-o[0],-point[2]*L+(d[1]-1)/2-o[1],point[1]*L+(d[2]-1)/2-o[2]];
}
const sourceVector=v=>[v[0],-v[2],v[1]];
export function planFinePlane(manifest,input,{spacingUm=manifest.sourceSpacingUm,maxPixels=12*1024*1024}={}){
 const plane=validFinePlane(input),L=Math.max(...manifest.fullDimensionsXYZ.map(n=>n-1));
 const target=Math.max(manifest.sourceSpacingUm,Number(spacingUm)||manifest.sourceSpacingUm);
 const width=Math.ceil(plane.width*manifest.longestMm*1000/target)+1,height=Math.ceil(plane.height*manifest.longestMm*1000/target)+1;
 if(width*height>maxPixels||Math.max(width,height)>8192)throw new Error('This fine plane exceeds the bounded image size.');
 const center=worldToFineVoxel(plane.center,manifest),right=sourceVector(plane.right),up=sourceVector(plane.up);
 const normal=[right[1]*up[2]-right[2]*up[1],right[2]*up[0]-right[0]*up[2],right[0]*up[1]-right[1]*up[0]];
 const start=center.map((v,i)=>v-right[i]*plane.width*L/2+up[i]*plane.height*L/2);
 const column=right.map(v=>v*plane.width*L/(width-1)),row=up.map(v=>-v*plane.height*L/(height-1));
 const B=manifest.brickSize,counts=manifest.brickCountsXYZ,blocks=[];
 for(const [id,record] of Object.entries(manifest.blocks)){
  const index=Number(id),bx=index%counts[0],by=Math.floor(index/counts[0])%counts[1],bz=Math.floor(index/(counts[0]*counts[1]));
  const origin=[bx*B,by*B,bz*B],middle=origin.map(v=>v+B/2),delta=sub(middle,center);
  if(Math.abs(dot(delta,normal))>B/2*normal.reduce((s,v)=>s+Math.abs(v),0)+1e-6)continue;
  const u=dot(delta,right),v=dot(delta,up),ru=B/2*right.reduce((s,n)=>s+Math.abs(n),0),rv=B/2*up.reduce((s,n)=>s+Math.abs(n),0);
  const x0=clamp(Math.floor(((u-ru)/(plane.width*L)+.5)*(width-1))-1,0,width-1);
  const x1=clamp(Math.ceil(((u+ru)/(plane.width*L)+.5)*(width-1))+1,0,width-1);
  const y0=clamp(Math.floor((.5-(v+rv)/(plane.height*L))*(height-1))-1,0,height-1);
  const y1=clamp(Math.ceil((.5-(v-rv)/(plane.height*L))*(height-1))+1,0,height-1);
  if(u+ru<-plane.width*L/2||u-ru>plane.width*L/2||v+rv<-plane.height*L/2||v-rv>plane.height*L/2)continue;
  blocks.push({id,record,origin,bounds:[x0,y0,x1,y1],distance:dot(delta,delta)});
 }
 blocks.sort((a,b)=>a.distance-b.distance);
 return {plane,width,height,start,column,row,blocks,shape:manifest.sourceShapeXYZ,brickSize:B,edge:manifest.storedEdge,
  spacingUmXY:[plane.width*manifest.longestMm*1000/(width-1),plane.height*manifest.longestMm*1000/(height-1)]};
}
/** Pixels are assigned by their floor voxel's brick; the positive halo prevents seams. */
export function sampleFineBrick(plan,block,data,out){
 const E=plan.edge,E2=E*E,B=plan.brickSize,[ox,oy,oz]=block.origin,[c0,r0,c1,r1]=block.bounds;
 const [sx,sy,sz]=plan.shape,dx=plan.column,dy=plan.row,a=plan.start,W=plan.width;
 const lowX=Math.max(ox,0),lowY=Math.max(oy,0),lowZ=Math.max(oz,0),highX=Math.min(ox+B,sx-1),highY=Math.min(oy+B,sy-1),highZ=Math.min(oz+B,sz-1);
 const invX=dx[0]?1/dx[0]:0,invY=dx[1]?1/dx[1]:0,invZ=dx[2]?1/dx[2]:0;
 // A projected brick rectangle contains many pixels outside the brick. Clip
 // each scanline against its three source-space slabs once, then interpolate
 // only the owned pixels. The positive halo still supplies every neighbor.
 for(let row=r0;row<=r1;row++){
  const bx=a[0]+row*dy[0],by=a[1]+row*dy[1],bz=a[2]+row*dy[2];
  if((!invX&&(bx<lowX||bx>highX||bx>=ox+B))||(!invY&&(by<lowY||by>highY||by>=oy+B))||(!invZ&&(bz<lowZ||bz>highZ||bz>=oz+B)))continue;
  const x0=invX?Math.min((lowX-bx)*invX,(highX-bx)*invX):-Infinity,x1=invX?Math.max((lowX-bx)*invX,(highX-bx)*invX):Infinity;
  const y0=invY?Math.min((lowY-by)*invY,(highY-by)*invY):-Infinity,y1=invY?Math.max((lowY-by)*invY,(highY-by)*invY):Infinity;
  const z0=invZ?Math.min((lowZ-bz)*invZ,(highZ-bz)*invZ):-Infinity,z1=invZ?Math.max((lowZ-bz)*invZ,(highZ-bz)*invZ):Infinity;
  let first=Math.max(c0,Math.ceil(Math.max(x0,y0,z0)-1e-9)),last=Math.min(c1,Math.floor(Math.min(x1,y1,z1)+1e-9));
  const inside=col=>{const x=bx+col*dx[0],y=by+col*dx[1],z=bz+col*dx[2];return x>=lowX&&x<ox+B&&x<=highX&&y>=lowY&&y<oy+B&&y<=highY&&z>=lowZ&&z<oz+B&&z<=highZ;};
  while(first<=last&&!inside(first))first++;while(last>=first&&!inside(last))last--;
  for(let col=first;col<=last;col++){
   const x=bx+col*dx[0],y=by+col*dx[1],z=bz+col*dx[2];
   const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z),fx=x-ix,fy=y-iy,fz=z-iz;
   const i=(ix-ox)+E*((iy-oy)+E*(iz-oz));
   const v0=(data[i]*(1-fx)+data[i+1]*fx)*(1-fy)+(data[i+E]*(1-fx)+data[i+E+1]*fx)*fy;
   const v1=(data[i+E2]*(1-fx)+data[i+E2+1]*fx)*(1-fy)+(data[i+E2+E]*(1-fx)+data[i+E2+E+1]*fx)*fy;
   out[row*W+col]=Math.round(v0*(1-fz)+v1*fz);
  }
 }
}
