/** Educational CT-derived ultrasound appearance.
 * HiP-CT intensity is NOT an acoustic-impedance measurement. This model uses
 * measured anatomy for location, then illustrative interface/scattering and
 * attenuation proxies. It is not a wave solver or a clinical prediction.
 */
import {probeCapPlane,sectorGeometry,volumeGeometry} from './probe-geometry.js';
import {reusableFineSection} from './ultra-volume-core.js';

const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const mix=(a,b,t)=>a+(b-a)*t;
const smooth=x=>{x=clamp(x,0,1);return x*x*(3-2*x);};

function hash3(x,y,z){
 let n=Math.imul(x|0,374761393)^Math.imul(y|0,668265263)^Math.imul(z|0,1442695041);
 n=Math.imul(n^(n>>>13),1274126177);n^=n>>>16;
 return ((n>>>0)+.5)/4294967296;
}

/** Stable 3D scatter field: the same tissue location has the same value when
 * another plane crosses it. Time and frame IDs never enter the calculation.
 */
export function tissueSpeckle(x,y,z,frequencyMHz=3.5){
 const scale=.65*Math.sqrt(3.5/frequencyMHz);x/=scale;y/=scale;z/=scale;
 const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z),fx=smooth(x-ix),fy=smooth(y-iy),fz=smooth(z-iz);
 const a=mix(hash3(ix,iy,iz),hash3(ix+1,iy,iz),fx),b=mix(hash3(ix,iy+1,iz),hash3(ix+1,iy+1,iz),fx);
 const c=mix(hash3(ix,iy,iz+1),hash3(ix+1,iy,iz+1),fx),d=mix(hash3(ix,iy+1,iz+1),hash3(ix+1,iy+1,iz+1),fx);
 const u=clamp(mix(mix(a,b,fy),mix(c,d,fy),fz),.0001,.9999);
 // A Rayleigh-shaped, spatially correlated amplitude proxy.
 return Math.sqrt(-2*Math.log(u))*.80;
}

export function createProbeSampler(volume,cleanupEnabled=true){
 const {data,dimensions,geometry,support}=volume,[nx,ny,nz]=dimensions;
 const sx=(nx-1)/(geometry.extent[0]*geometry.longestMm),sy=(ny-1)/(geometry.extent[2]*geometry.longestMm),sz=(nz-1)/(geometry.extent[1]*geometry.longestMm);
 const ox=(nx-1)/2,oy=(ny-1)/2,oz=(nz-1)/2,plane=nx*ny;
 const mask=cleanupEnabled&&support?.data,md=support?.dimensions;
 const mx=mask?(md[0]-1)/(nx-1):0,my=mask?(md[1]-1)/(ny-1):0,mz=mask?(md[2]-1)/(nz-1):0;
 return (worldXmm,worldYmm,worldZmm)=>{
  const x=worldXmm*sx+ox,y=-worldZmm*sy+oy,z=worldYmm*sz+oz;
  if(x<0||y<0||z<0||x>nx-1||y>ny-1||z>nz-1)return 0;
  if(mask&&!mask[Math.round(x*mx)+md[0]*(Math.round(y*my)+md[1]*Math.round(z*mz))])return 0;
  const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z),jx=Math.min(ix+1,nx-1),jy=Math.min(iy+1,ny-1),jz=Math.min(iz+1,nz-1);
  const fx=x-ix,fy=y-iy,fz=z-iz,a=ix+nx*iy+plane*iz,b=ix+nx*jy+plane*iz,c=ix+nx*iy+plane*jz,d=ix+nx*jy+plane*jz,dx=jx-ix;
  return mix(mix(mix(data[a],data[a+dx],fx),mix(data[b],data[b+dx],fx),fy),mix(mix(data[c],data[c+dx],fx),mix(data[d],data[d+dx],fx),fy),fz);
 };
}

/** A complete high-resolution measured plane is sufficient for this 2D beam
 * model. Every ray stays in that plane. It is never treated as a 3D volume.
 */
export function createProbePlaneSampler(slice,volume,cleanupEnabled=true){
 const {data,width,height,plane}=slice,{geometry,support}=volume,scale=1/geometry.longestMm;
 // A cleaned fine plane already contains the fine source's tissue support.
 // Reapplying the coarse volume mask here would erase genuine edge detail.
 const mask=cleanupEnabled&&slice.cleaned!==true&&support?.data,md=support?.dimensions,ex=geometry.extent;
 return (xMm,yMm,zMm)=>{
  const x=xMm*scale,y=yMm*scale,z=zMm*scale;
  if(mask){const sx=x/ex[0]+.5,sy=.5-z/ex[2],sz=y/ex[1]+.5;if(sx<0||sx>1||sy<0||sy>1||sz<0||sz>1)return 0;if(!mask[Math.round(sx*(md[0]-1))+md[0]*(Math.round(sy*(md[1]-1))+md[1]*Math.round(sz*(md[2]-1)))])return 0;}
  const dx=x-plane.center[0],dy=y-plane.center[1],dz=z-plane.center[2];
  if(Math.abs(dx*plane.normal[0]+dy*plane.normal[1]+dz*plane.normal[2])>1e-5)return 0;
  let u=((dx*plane.right[0]+dy*plane.right[1]+dz*plane.right[2])/plane.width+.5)*(width-1);
  let v=(.5-(dx*plane.up[0]+dy*plane.up[1]+dz*plane.up[2])/plane.height)*(height-1);
  if(u<-.00001||v<-.00001||u>width-1+.00001||v>height-1+.00001)return 0;
  u=clamp(u,0,width-1);v=clamp(v,0,height-1);const i=Math.floor(u),j=Math.floor(v),k=Math.min(i+1,width-1),l=Math.min(j+1,height-1),fu=u-i,fv=v-j;
  return mix(mix(data[i+j*width],data[k+j*width],fu),mix(data[i+l*width],data[k+l*width],fu),fv);
 };
}

export function validFineProbeSlice(slice,requestedPlane=null,fineSpacingUm=79.4,geometry=null){
 if(!slice||slice.complete!==true||!(slice.data instanceof Uint8Array)||!Number.isInteger(slice.width)||!Number.isInteger(slice.height)||slice.width<2||slice.height<2||slice.width>8192||slice.height>8192||slice.data.length!==slice.width*slice.height)return false;
 const p=slice.plane,spacing=slice.sourceSpacingUm??slice.spacingUm,maxSpacing=Number(fineSpacingUm)+.01;if(!(spacing>0&&Number.isFinite(maxSpacing)&&spacing<=maxSpacing)||!p||!(p.width>0&&p.height>0))return false;
 if(!['center','normal','right','up'].every(key=>Array.isArray(p[key])&&p[key].length===3&&p[key].every(Number.isFinite)))return false;
 if(requestedPlane){
  if(p.normal.reduce((sum,v,i)=>sum+v*requestedPlane.normal[i],0)<.999999)return false;
  if(!reusableFineSection(p,requestedPlane,geometry?.extent))return false;
 }
 return true;
}

function polarAt(data,beams,samples,b,r){
 const b0=Math.floor(b),b1=Math.min(b0+1,beams-1),r0=Math.floor(r),r1=Math.min(r0+1,samples-1),fb=b-b0,fr=r-r0;
 return mix(mix(data[b0*samples+r0],data[b0*samples+r1],fr),mix(data[b1*samples+r0],data[b1*samples+r1],fr),fb);
}

/** Match work to the displayed pane. A bounded live grid follows input without
 * waiting for native fine-plane extraction; the quiet pose gets a sharper grid.
 * Physical source/plane spacing remains separate from this display resolution. */
export function probeFrameQuality(state,width=800,fast=false){
 const pixels=Number(width)||800;
 width=Math.round(clamp(pixels*(fast ? .45 : 1),fast?256:448,fast?384:896)/32)*32;
 return fast?{width,capLongest:Math.round(clamp(width*1.2,320,448)/32)*32,
  beams:Math.round(clamp(width/3,96,128)),samples:Math.round(clamp(Math.ceil(state.depthMm/.5),256,512))}
  :{width,capLongest:Math.round(clamp(width*1.5,768,1280)/32)*32,
   beams:Math.round(clamp(width/3.3,192,288)),samples:Math.round(clamp(Math.ceil(state.depthMm/.2),512,1280))};
}

// Scan conversion depends on the sector/grid, not on the probe pose. Reuse its
// polar coordinates during motion instead of repeating atan2/hypot for every
// pixel in every frame. Keep only two bounded grids (usually one).
const conversionGrids=new Map();
function scanConversion(sector,width,height,beams,samples){
 const key=[width,height,beams,samples,sector.halfAngle].join(',');
 if(conversionGrids.has(key)){const grid=conversionGrids.get(key);conversionGrids.delete(key);conversionGrids.set(key,grid);return grid;}
 const indices=new Uint32Array(width*height),bases=new Uint32Array(width*height),weights=new Float32Array(width*height*3),rows=new Uint32Array(height+1);let count=0;
 const halfWidth=Math.sin(sector.halfAngle),da=2*sector.halfAngle/(beams-1);
 for(let row=0;row<height;row++){
  rows[row]=count;const forward=row/(height-1);
  for(let col=0;col<width;col++){
   const lateral=(col/(width-1)-.5)*2*halfWidth,depth=Math.hypot(lateral,forward),angle=Math.atan2(lateral,forward);
   if(depth>1||Math.abs(angle)>sector.halfAngle)continue;
   const b=clamp((angle+sector.halfAngle)/da,0,beams-1),r=clamp(depth*(samples-1),0,samples-1),b0=Math.floor(b),r0=Math.floor(r);
   indices[count]=col+row*width;bases[count]=b0*samples+r0;weights[count*3]=b-b0;weights[count*3+1]=r-r0;weights[count*3+2]=depth;count++;
  }
 }
 rows[height]=count;
 const grid={indices,bases,weights,rows};
 conversionGrids.set(key,grid);while(conversionGrids.size>2)conversionGrids.delete(conversionGrids.keys().next().value);
 return grid;
}

function planarCoordinates(slice,geometry){
 const {plane,width,height,data}=slice,L=geometry.longestMm,
  su=(width-1)/(plane.width*L),sv=(height-1)/(plane.height*L);
 const project=p=>[
  ((p[0]/L-plane.center[0])*plane.right[0]+(p[1]/L-plane.center[1])*plane.right[1]+(p[2]/L-plane.center[2])*plane.right[2])/plane.width*(width-1)+(width-1)/2,
  (height-1)/2-((p[0]/L-plane.center[0])*plane.up[0]+(p[1]/L-plane.center[1])*plane.up[1]+(p[2]/L-plane.center[2])*plane.up[2])/plane.height*(height-1)];
 const vector=p=>[(p[0]*plane.right[0]+p[1]*plane.right[1]+p[2]*plane.right[2])*su,-(p[0]*plane.up[0]+p[1]*plane.up[1]+p[2]*plane.up[2])*sv];
 const sample=(u,v)=>{
  if(u<-.00001||v<-.00001||u>width-1+.00001||v>height-1+.00001)return 0;
  u=clamp(u,0,width-1);v=clamp(v,0,height-1);
  const i=Math.floor(u),j=Math.floor(v),fu=u-i,fv=v-j,a=i+j*width,b=i+Math.min(j+1,height-1)*width,dx=Math.min(i+1,width-1)-i;
  return mix(mix(data[a],data[a+dx],fu),mix(data[b],data[b+dx],fu),fv);
 };
 return {project,vector,sample};
}

/** Compute one consistent cap / measured sector / ultrasound-style frame.
 * yieldFn lets a worker receive newer poses during larger settled refinements.
 */
export async function computeProbeFrame(volume,request,{cancelled=()=>false,yieldFn=()=>Promise.resolve()}={}){
 const started=performance.now(),{pose,state,fast=false}=request;
 const geometry=volume.geometry||volumeGeometry(volume.meta),requestedPlane=probeCapPlane(pose,geometry),fineSlice=request.fineSlice;
 if(fineSlice&&!validFineProbeSlice(fineSlice,requestedPlane,request.fineSpacingUm||79.4,geometry))throw new Error('The fine plane is incomplete or does not match this probe pose.');
 const sourceVolume={...volume,geometry},sampler=fineSlice?createProbePlaneSampler(fineSlice,sourceVolume,request.cleanupEnabled!==false):createProbeSampler(sourceVolume,request.cleanupEnabled!==false);
 const plane=fineSlice?.plane||requestedPlane,sector=sectorGeometry(state),fine=!!fineSlice;
 const quality=probeFrameQuality(state,request.width,fast),longest=request.capLongest||quality.capLongest;
 // A native cached raster stays intact. Only the displayed texture is reduced,
 // in its original coordinate frame, when the caller supplies a screen budget.
 const capScale=fineSlice&&request.capLongest?Math.min(1,longest/Math.max(fineSlice.width,fineSlice.height)):1;
 const capWidth=fineSlice?Math.max(2,Math.round(fineSlice.width*capScale)):Math.max(64,Math.round(longest*Math.min(1,plane.width/plane.height))),capHeight=fineSlice?Math.max(2,Math.round(fineSlice.height*capScale)):Math.max(64,Math.round(longest*Math.min(1,plane.height/plane.width)));
 const cap=fineSlice&&capScale===1?fineSlice.data:new Uint8Array(capWidth*capHeight),longestMm=geometry.longestMm;
 const capSpacingUmXY=fineSlice&&capScale===1?(fineSlice.spacingUmXY||[fineSlice.spacingUm,fineSlice.spacingUm]):[plane.width*longestMm*1000/(capWidth-1),plane.height*longestMm*1000/(capHeight-1)];
 const c=plane.center.map(v=>v*longestMm),right=pose.right,beam=pose.beam,up=pose.up,origin=pose.originMm;
 if(!fine)for(let row=0;row<capHeight;row++){
  const v=(.5-row/(capHeight-1))*plane.height*longestMm;
  const bx=c[0]+up[0]*v,by=c[1]+up[1]*v,bz=c[2]+up[2]*v;
  for(let col=0;col<capWidth;col++){
   const u=(col/(capWidth-1)-.5)*plane.width*longestMm;
   cap[col+row*capWidth]=Math.round(sampler(bx+right[0]*u,by+right[1]*u,bz+right[2]*u));
  }
  if(row%56===55){await yieldFn();if(cancelled())return null;}
 }
 if(fine&&capScale<1){
  const source=fineSlice.data,sourceWidth=fineSlice.width,stepX=(sourceWidth-1)/(capWidth-1),stepY=(fineSlice.height-1)/(capHeight-1),columns=new Uint32Array(capWidth),fractions=new Float64Array(capWidth);
  for(let col=0;col<capWidth;col++){const u=col*stepX;columns[col]=Math.floor(u);fractions[col]=u-columns[col];}
  for(let row=0;row<capHeight;row++){
   const v=row*stepY,y=Math.floor(v),fraction=v-y,a=y*sourceWidth,b=Math.min(y+1,fineSlice.height-1)*sourceWidth;
   for(let col=0;col<capWidth;col++){
    const x=columns[col],next=Math.min(x+1,sourceWidth-1),fx=fractions[col];
    cap[col+row*capWidth]=Math.round(mix(mix(source[a+x],source[a+next],fx),mix(source[b+x],source[b+next],fx),fraction));
   }
   if(row%56===55){await yieldFn();if(cancelled())return null;}
  }
 }
 if(cancelled())return null;
 const capElapsedMs=performance.now()-started;

 const beams=request.beams||quality.beams,samples=request.samples||quality.samples,dr=sector.depthMm/(samples-1),da=2*sector.halfAngle/(beams-1);
 // Every beam is in this exact plane. Transform its origin and increment once,
 // then sample in image coordinates. Do not repeat a 3D projection per sample.
 // The live cap has already sampled and cleaned this exact physical section.
 // Reuse it for all beams and measured CT pixels instead of repeating random
 // 3D trilinear reads. This is explicitly a screen-resolution preview; quiet
 // fine-source frames continue sampling their original measured raster.
 const acousticSlice=fineSlice||(fast?{data:cap,width:capWidth,height:capHeight,plane,cleaned:true}:null);
 const planar=acousticSlice&&(acousticSlice.cleaned===true||request.cleanupEnabled===false||!volume.support?.data)?planarCoordinates(acousticSlice,geometry):null;
 const imageOrigin=planar?.project(origin);
 const raw=new Float32Array(beams*samples),directions=new Float64Array(beams*3);
 for(let b=0;b<beams;b++){
  const angle=-sector.halfAngle+b*da,sin=Math.sin(angle),cos=Math.cos(angle);
  const dx=beam[0]*cos+right[0]*sin,dy=beam[1]*cos+right[1]*sin,dz=beam[2]*cos+right[2]*sin;
  directions[b*3]=dx;directions[b*3+1]=dy;directions[b*3+2]=dz;
  if(planar){const delta=planar.vector([dx*dr,dy*dr,dz*dr]);for(let r=0;r<samples;r++)raw[b*samples+r]=planar.sample(imageOrigin[0]+delta[0]*r,imageOrigin[1]+delta[1]*r)/255;}
  else for(let r=0;r<samples;r++){const depth=r*dr;raw[b*samples+r]=sampler(origin[0]+dx*depth,origin[1]+dy*depth,origin[2]+dz*depth)/255;}
  if(b%20===19){await yieldFn();if(cancelled())return null;}
 }

 const amplitude=new Float32Array(raw.length),frequency=state.frequencyMHz,shadow=state.shadow;
 for(let b=0;b<beams;b++){
  let loss=0;const line=b*samples,left=Math.max(0,b-1)*samples,rightLine=Math.min(beams-1,b+1)*samples;
  const dx=directions[b*3],dy=directions[b*3+1],dz=directions[b*3+2];
  for(let r=1;r<samples-1;r++){
   const depth=r*dr,v=raw[line+r],tissue=smooth((v-.18)/.39);
   const radial=(raw[line+r+1]-raw[line+r-1])/(2*dr);
   const transverse=(raw[rightLine+r]-raw[left+r])/(Math.max(1,Math.min(beams-1,b+1)-Math.max(0,b-1))*Math.max(depth*da,dr));
   const gradient=Math.hypot(radial,transverse),incidence=Math.abs(radial)/(gradient+.00001);
   const reflection=Math.min(.32,gradient*.30)*(.12+.88*Math.pow(incidence,1.6));
   const speckle=tissue>.001?tissueSpeckle(origin[0]+dx*depth,origin[1]+dy*depth,origin[2]+dz*depth,frequency):0;
   const scattering=.0125*tissue*(.52+.48*v)*speckle;
   // These are display proxies, deliberately not calibrated tissue coefficients.
   loss+=(.0012*tissue+.0017*tissue*tissue)*frequency*dr*shadow;
   const transmitted=Math.exp(-loss),tgcDb=2.5*depth/sector.depthMm;
   amplitude[line+r]=(reflection+scattering)*transmitted*Math.pow(10,(state.gainDb+tgcDb)/20);
   // Integrate interface shadow over physical travel, not sample count.
   // Otherwise a fine plane's denser radial grid would spuriously make
   // the same anatomy many times darker than the movement preview.
   loss+=reflection*shadow*.30*dr;
  }
  if(b%24===23){await yieldFn();if(cancelled())return null;}
 }

 // A modest separable beam/pulse blur approximates finite imaging resolution;
 // it acts only on the simulated echo envelope, never on the CT cap.
 const blurred=new Float32Array(amplitude.length),blur=clamp(.23*Math.sqrt(3.5/frequency),.11,.34),middle=1-2*blur;
 for(let b=0;b<beams;b++)for(let r=1;r<samples-1;r++){
  let sum=0;
  for(let k=-1;k<=1;k++){
   const row=Math.max(0,Math.min(beams-1,b+k))*samples;
   sum+=(k===0?middle:blur)*(amplitude[row+r-1]*blur+amplitude[row+r]*middle+amplitude[row+r+1]*blur);
  }
  blurred[b*samples+r]=sum;
 }
 if(cancelled())return null;

 const width=request.width||quality.width,height=Math.max(160,Math.round(width*sector.heightMm/sector.widthMm));
 const ct=new Uint8Array(width*height),ultrasound=new Uint8Array(width*height);let sectorPixels=0,tissuePixels=0;
 const grid=scanConversion(sector,width,height,beams,samples),sideStep=planar?.vector(right.map(v=>v*sector.widthMm/(width-1))),depthStep=planar?.vector(beam.map(v=>v*sector.depthMm/(height-1)));
 const leftUV=planar?.project(origin.map((v,i)=>v-right[i]*sector.widthMm/2));
 for(let row=0;row<height;row++){
  const forward=row/(height-1)*sector.depthMm,px=origin[0]+beam[0]*forward,py=origin[1]+beam[1]*forward,pz=origin[2]+beam[2]*forward;
  for(let entry=grid.rows[row];entry<grid.rows[row+1];entry++){
   const i=grid.indices[entry],col=i-row*width,weight=entry*3;
   if(grid.weights[weight+2]*sector.depthMm<.3)continue;
   const lateral=(col/(width-1)-.5)*sector.widthMm;
   sectorPixels++;
   const v=planar?planar.sample(leftUV[0]+depthStep[0]*row+sideStep[0]*col,leftUV[1]+depthStep[1]*row+sideStep[1]*col):sampler(px+right[0]*lateral,py+right[1]*lateral,pz+right[2]*lateral);ct[i]=Math.round(v);if(v>255*.25)tissuePixels++;
   const base=grid.bases[entry],fb=grid.weights[weight],fr=grid.weights[weight+1],b0=Math.floor(base/samples),r0=base-b0*samples,nextLine=Math.min(b0+1,beams-1)*samples+r0,dr1=Number(r0<samples-1);
   const a=mix(mix(blurred[base],blurred[base+dr1],fr),mix(blurred[nextLine],blurred[nextLine+dr1],fr),fb);
   if(a>.00001){const db=20*Math.log10(a/.16);ultrasound[i]=Math.round(clamp((db+state.dynamicRangeDb)/state.dynamicRangeDb,0,1)*255);}
  }
  if(row%64===63){await yieldFn();if(cancelled())return null;}
 }
 const sourceSpacingUm=fineSlice?.sourceSpacingUm??fineSlice?.spacingUm??geometry.spacingUm;
 const elapsedMs=performance.now()-started;
 return {id:request.id,version:request.version,refinementToken:request.refinementToken,poseRevision:request.poseRevision,workKey:request.workKey,fast,fine,pose,state,plane,cap,capWidth,capHeight,capCleaned:fineSlice?.cleaned===true,ct,ultrasound,width,height,sector,source:fineSlice?.source||'Loaded display volume',capSpacingUm:Math.max(...capSpacingUmXY),capSpacingUmXY,stats:{elapsedMs,capElapsedMs,acousticElapsedMs:elapsedMs-capElapsedMs,sourceSpacingUm,spacingUmXY:capSpacingUmXY,beams,radialSamples:samples,sectorPixels,tissuePixels,tissueFraction:tissuePixels/Math.max(1,sectorPixels)}};
}
