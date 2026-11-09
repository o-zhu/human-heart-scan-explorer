// Software raycasting fallback: samples the same measured volume as WebGL.
import {clipPlane} from './planes.js';
import {surfaceColor,capColor,atlasTone,anatomyColor,capAnatomyColor,DEFAULT_ANATOMY_COLORS} from './render-styles.js';
import {buildAcceleration,validAcceleration} from './render-v5-acceleration.js';
let data,nx,ny,nz,acceleration=null,capData=null,cleanupData=null,anatomyData=null,anatomyColors=DEFAULT_ANATOMY_COLORS,activeCleanup=false;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function mapAt(map,x,y,z){
 const [mx,my,mz]=map.dimensions;
 return map.data[clamp(Math.round(x/(nx-1)*(mx-1)),0,mx-1)+mx*(clamp(Math.round(y/(ny-1)*(my-1)),0,my-1)+my*clamp(Math.round(z/(nz-1)*(mz-1)),0,mz-1))];
}
function keep(x,y,z){return !activeCleanup||mapAt(cleanupData,x,y,z)>=128;}
function at(x,y,z){if(!keep(x,y,z))return 0;return data[clamp(Math.round(x),0,nx-1)+nx*(clamp(Math.round(y),0,ny-1)+ny*clamp(Math.round(z),0,nz-1))]/255;}
function tri(x,y,z){
 if(!keep(x,y,z))return 0;
 return rawTri(x,y,z);
}
function rawTri(x,y,z){
 x=clamp(x,0,nx-1);y=clamp(y,0,ny-1);z=clamp(z,0,nz-1);
 const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z),jx=Math.min(ix+1,nx-1),jy=Math.min(iy+1,ny-1),jz=Math.min(iz+1,nz-1),fx=x-ix,fy=y-iy,fz=z-iz;
 const a=ix+nx*(iy+ny*iz),b=ix+nx*(jy+ny*iz),c=ix+nx*(iy+ny*jz),d=ix+nx*(jy+ny*jz),off=jx-ix;
 return (((data[a]*(1-fx)+data[a+off]*fx)*(1-fy)+(data[b]*(1-fx)+data[b+off]*fx)*fy)*(1-fz)+((data[c]*(1-fx)+data[c+off]*fx)*(1-fy)+(data[d]*(1-fx)+data[d+off]*fx)*fy)*fz)/255;
}
function norm(v){const n=Math.hypot(...v)||1;return v.map(x=>x/n);}
function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
function smooth(a,b,v){const t=clamp((v-a)/(b-a),0,1);return t*t*(3-2*t);}
function cubicKnots(q){
 const base=Math.floor(q)-1,f=q-Math.floor(q),f2=f*f,f3=f2*f,o=1-f;
 const w0=o*o*o/6,w1=(3*f3-6*f2+4)/6,w2=(-3*f3+3*f2+3*f+1)/6,w3=f3/6;
 const a=w0+w1,b=w2+w3,da=-.5*o*o+1.5*f2-2*f,db=-1.5*f2+f+.5+.5*f2;
 return [base+w1/a,base+2+w3/b,a,b,base+(1.5*f2-2*f)/da,base+2+.5*f2/db,da,db];
}
function cubicDerivative(kx,ky,kz,axis){
 const off=[0,0,0];off[axis]=4;let value=0;
 for(let z=0;z<2;z++)for(let y=0;y<2;y++)for(let x=0;x<2;x++)value+=rawTri(kx[off[0]+x],ky[off[1]+y],kz[off[2]+z])*kx[off[0]+2+x]*ky[off[1]+2+y]*kz[off[2]+2+z];
 return value;
}
function centralGradient(x,y,z,e,r){return [(rawTri(x-r,y,z)-rawTri(x+r,y,z))*(nx-1)/e[0]/(2*r),(rawTri(x,y,z-r)-rawTri(x,y,z+r))*(nz-1)/e[1]/(2*r),(rawTri(x,y+r,z)-rawTri(x,y-r,z))*(ny-1)/e[2]/(2*r)];}
const gaussian1=Math.exp(-1/(2*1.15*1.15)),gaussian2=Math.exp(-4/(2*1.15*1.15)),gaussianTotal=1+2*gaussian1+2*gaussian2;
const gaussianOuter=(gaussian1+gaussian2)/gaussianTotal,gaussianCenter=1/gaussianTotal,gaussianOffset=1+gaussian2/(gaussian1+gaussian2),derivativeOffset=1+2*gaussian2/(gaussian1+2*gaussian2);
function gaussianGradient(x,y,z,e){
 x=clamp(x,0,nx-1);y=clamp(y,0,ny-1);z=clamp(z,0,nz-1);let gx=0,gy=0,gz=0;
 for(let i=0;i<3;i++)for(let j=0;j<3;j++){
  const u=(i-1)*gaussianOffset,v=(j-1)*gaussianOffset,w=(i===1?gaussianCenter:gaussianOuter)*(j===1?gaussianCenter:gaussianOuter),d=derivativeOffset;
  gx+=w*(rawTri(x-d,y+u,z+v)-rawTri(x+d,y+u,z+v));
  gy+=w*(rawTri(x+u,y-d,z+v)-rawTri(x+u,y+d,z+v));
  gz+=w*(rawTri(x+u,y+v,z-d)-rawTri(x+u,y+v,z+d));
 }
 return [gx*(nx-1)/e[0],gz*(nz-1)/e[1],-gy*(ny-1)/e[2]];
}
function surfaceGradient(x,y,z,e,smoothing){
 if(smoothing===0)return centralGradient(x,y,z,e,1.5);
 if(smoothing===2)return gaussianGradient(x,y,z,e);
 const kx=cubicKnots(clamp(x,0,nx-1)),ky=cubicKnots(clamp(y,0,ny-1)),kz=cubicKnots(clamp(z,0,nz-1));
 const fine=[-cubicDerivative(kx,ky,kz,0)*(nx-1)/e[0],-cubicDerivative(kx,ky,kz,2)*(nz-1)/e[1],cubicDerivative(kx,ky,kz,1)*(ny-1)/e[2]];
 return fine;
}
function cellRange(x,y,z,dx,dy,dz){
 if(!acceleration)return [1,1e20];
 const {dimensions:d,blockSize:k,maxima}=acceleration;
 const cx=clamp(Math.floor(x/k),0,d[0]-1),cy=clamp(Math.floor(y/k),0,d[1]-1),cz=clamp(Math.floor(z/k),0,d[2]-1);
 const maximum=maxima[cx+d[0]*(cy+d[1]*cz)]/255;
 const tx=Math.abs(dx)>1e-6?((cx+(dx>=0?1:0))*k-x)/dx:1e20;
 const ty=Math.abs(dy)>1e-6?((cy+(dy>=0?1:0))*k-y)/dy:1e20;
 const tz=Math.abs(dz)>1e-6?((cz+(dz>=0?1:0))*k-z)/dz:1e20;
 return [maximum,Math.max(0,Math.min(tx,ty,tz))];
}
function capSample(p,e){
 const voxel=[(p[0]/e[0]+.5)*(nx-1),(.5-p[2]/e[2])*(ny-1),(p[1]/e[1]+.5)*(nz-1)];
 if(!capData)return tri(...voxel);
 const c=capData,f=c.plane,d=p.map((x,i)=>x-f.center[i]),u=dot(d,f.right)/f.width+.5,v=.5-dot(d,f.up)/f.height;
 if(u<0||u>1||v<0||v>1)return tri(...voxel);
 if(c.cleaned!==true&&!keep(...voxel))return 0;
 const x=u*(c.width-1),y=v*(c.height-1),ix=Math.floor(x),iy=Math.floor(y),jx=Math.min(ix+1,c.width-1),jy=Math.min(iy+1,c.height-1),fx=x-ix,fy=y-iy;
 return ((c.data[ix+iy*c.width]*(1-fx)+c.data[jx+iy*c.width]*fx)*(1-fy)+(c.data[ix+jy*c.width]*(1-fx)+c.data[jx+jy*c.width]*fx)*fy)/255;
}
async function render(p,cancelled){
 const {w,h,extent:e,basis:b,settings:s,fast}=p,buf=new Uint8ClampedArray(w*h*4),depths=new Float32Array(w*h),lo=e.map(x=>-x*.5),hi=e.map(x=>x*.5),eye=b.eye;
 depths.fill(Infinity);
 activeCleanup=Boolean(cleanupData)&&s.cleanupEnabled!==false;
 const plane=clipPlane(s,e);
 const light=norm(b.forward.map((v,i)=>-v*.85+b.up[i]*.62+b.right[i]*.46));
 const fill=norm(b.forward.map((v,i)=>-v-b.right[i]*.8-b.up[i]*.1));
 const ds=Math.min(e[0]/(nx-1),e[1]/(nz-1),e[2]/(ny-1))*(s.quality==='high'?.65:.9),threshold=s.threshold,smoothing=clamp(Math.round(s.surfaceSmoothing??1),0,2);
 const ox=(eye[0]/e[0]+.5)*(nx-1),oy=(.5-eye[2]/e[2])*(ny-1),oz=(eye[1]/e[1]+.5)*(nz-1);
 function color(v){return surfaceColor(v,threshold,s.palette);}
 function tint(c,x,y,z,cap=false){return s.palette===5&&anatomyData?(cap?capAnatomyColor:anatomyColor)(c,mapAt(anatomyData,x,y,z),anatomyColors,s.anatomyOpacity??.65,s.anatomySelected??0):c;}
 function shade(x,y,z,v,rd,cap){
  let normal;
  if(cap){normal=[0,0,0];if(s.clipAxis===0)normal[0]=s.clipFlip?-1:1;if(s.clipAxis===1)normal[2]=s.clipFlip?1:-1;if(s.clipAxis===2)normal[1]=s.clipFlip?-1:1;}
  else{
   normal=norm(surfaceGradient(x,y,z,e,smoothing));
  }
  if(dot(normal,rd)>0)normal=normal.map(x=>-x);
  if(s.palette===6){
   const d=1.25*Math.min(e[0]/(nx-1),e[1]/(nz-1),e[2]/(ny-1));
   const dx=normal[0]*d*(nx-1)/e[0],dy=-normal[2]*d*(ny-1)/e[2],dz=normal[1]*d*(nz-1)/e[1];
   v=Math.max(v,rawTri(x-dx,y-dy,z-dz),rawTri(x+dx,y+dy,z+dz));
  }
  const half=norm(light.map((v,i)=>v-rd[i])),dif=Math.max(dot(normal,light),0),f=Math.max(dot(normal,fill),0),rim=Math.pow(1-Math.max(-dot(normal,rd),0),2.4),spec=Math.pow(Math.max(dot(normal,half),0),34);
  let ao=1;
  if(!cap){let occ=0;for(let i=1;i<=4;i++){const step=i*.006;occ+=smooth(threshold-.025,threshold+.08,tri(x+normal[0]*step*(nx-1)/e[0],y-normal[2]*step*(ny-1)/e[2],z+normal[1]*step*(nz-1)/e[1]))/i;}ao=1-clamp(occ*.18,0,.6);}
  const c=tint(color(v),x,y,z);
  if(s.palette===6){const q=smooth(0,.70,dif),lightColor=[.78,.80,.82].map((v,i)=>v+([1,.985,.96][i]-v)*q);return c.map((v,i)=>v*lightColor[i]*(.30+.63*dif+.20*f)*(1+(ao-1)*.65)+[1,.985,.96][i]*spec*.04+v*rim*.04);}
  if(s.palette>=3){const q=smooth(0,.75,dif),lightColor=[.63,.78,.85].map((v,i)=>v+([1,.98,.92][i]-v)*q),lightness=s.palette===4?(.10+.90*dif+.13*f):(.23+.74*dif+.22*f);return c.map((v,i)=>v*lightColor[i]*lightness*ao+[.96,.98,1][i]*spec*.09+v*rim*.08);}
  return c.map((v,i)=>v*(.27+.79*dif+.21*f)*ao+[.98,.83,.69][i]*spec*(cap?.016:.16)+v*rim*.14);
 }
 let nextYield=performance.now()+12;
 for(let py=0;py<h;py++){
  for(let px=0;px<w;px++){
  // A long still-frame refinement must not delay a newly requested camera.
  if(((px+py*w)&63)===0&&performance.now()>=nextYield){await new Promise(resolve=>setTimeout(resolve,0));if(cancelled())return null;nextYield=performance.now()+12;}
  const u=(px+.5)/w*2-1,v=1-(py+.5)/h*2,rd=norm(b.forward.map((x,i)=>x+b.right[i]*u*w/h*.32+b.up[i]*v*.32));
  const radial=Math.max(0,1-Math.hypot(u*.66,v*.7));let bg=[.035+.04*radial,.043+.04*radial,.05+.039*radial];
  if(s.palette>=3)bg=[.018+.033*radial,.029+.044*radial,.037+.045*radial];
  if(s.palette===4)bg=[.004+.008*radial,.007+.015*radial,.011+.018*radial];
  if(s.palette===6)bg=[.008+.013*radial,.009+.013*radial,.010+.012*radial];
  let t0=0,t1=100,capAtEntry=false;
  for(let a=0;a<3;a++){const inv=1/(rd[a]||1e-12),aa=(lo[a]-eye[a])*inv,bb=(hi[a]-eye[a])*inv;t0=Math.max(t0,Math.min(aa,bb));t1=Math.min(t1,Math.max(aa,bb));}
  if(plane){const side=dot(plane.normal,eye)-plane.distance,denom=dot(plane.normal,rd);if(Math.abs(denom)<1e-6){if(side>0)t1=-1;}else{const pt=-side/denom;if(denom<0){capAtEntry=pt>=t0-1e-6;t0=Math.max(t0,pt);}else t1=Math.min(t1,pt);}}
  let c=[0,0,0],alpha=0,foundT=t1,opacityDepthT=Infinity;
  if(t1>t0){
   const dx=rd[0]/e[0]*(nx-1),dy=-rd[2]/e[2]*(ny-1),dz=rd[1]/e[1]*(nz-1);
   let best=0,bestT=t0,lastT=t0;
   if(s.mode===0&&capAtEntry){
    const pos=eye.map((v,i)=>v+rd[i]*t0),value=capSample(pos,e);
    if(value>threshold){const facing=Math.abs(dot(plane.normal,rd)),base=tint(capColor(value,s.capContrast??1.8,s.palette,s),(pos[0]/e[0]+.5)*(nx-1),(.5-pos[2]/e[2])*(ny-1),(pos[1]/e[1]+.5)*(nz-1),true);c=base.map(t=>t*(.91+.09*facing));alpha=1;foundT=t0;}
   }
   let sampleIndex=0,cellEnd=t0,cellMaximum=1;const accelerated=acceleration&&s.accelerationEnabled!==false;
   for(let iteration=0;iteration<2048&&alpha<.985;iteration++){
    const t=t0+sampleIndex*ds;if(t>=t1)break;
    if(sampleIndex===0&&capAtEntry&&s.mode===0){sampleIndex++;continue;}
    let x=ox+dx*t,y=oy+dy*t,z=oz+dz*t;
    if(accelerated&&t>=cellEnd-1e-7){const range=cellRange(x,y,z,dx,dy,dz);cellMaximum=range[0];cellEnd=t+range[1];}
    const cutoff=s.mode===0?threshold:s.mode===2?best:threshold-.035;
    const skip=accelerated&&cellMaximum<=cutoff-1e-6?Math.max(0,cellEnd-t):0;
    if(skip>ds*1.01){const jump=Math.max(1,Math.floor(skip/ds));lastT=t0+(sampleIndex+jump-1)*ds;sampleIndex+=jump;continue;}
    let val=tri(x,y,z);sampleIndex++;
    if(s.mode===2){if(val>best){best=val;bestT=t;}continue;}
    if(s.mode===0){
     if(val>threshold){
      let a=lastT,bb=t;const cap=false;
      for(let j=0;j<6;j++){const mid=(a+bb)*.5;if(tri(ox+dx*mid,oy+dy*mid,oz+dz*mid)>threshold)bb=mid;else a=mid;}
      const hit=cap?t0:(a+bb)*.5;x=ox+dx*hit;y=oy+dy*hit;z=oz+dz*hit;val=tri(x,y,z);
      c=shade(x,y,z,val,rd,cap);if(s.palette===4&&capAtEntry){const depth=.30+.70*Math.exp(-Math.max(0,hit-t0)*5);c=c.map(v=>v*depth);}alpha=1;foundT=hit;break;
     }
    }else{
     const a=clamp(smooth(threshold-.035,threshold+.1,val)*s.opacity*ds*110,0,.65);
     if(a>.001){const col=tint(color(val),x,y,z),depth=Math.max(.55,1.15-(t-t0)*.7);for(let i=0;i<3;i++)c[i]+=(1-alpha)*col[i]*depth*a;const before=alpha;alpha+=(1-alpha)*a;if(before<=.38&&alpha>.38)opacityDepthT=t;if(alpha>.985)break;}
    }
    lastT=t;
   }
   if(s.mode===2){const a=smooth(threshold,1,best),lo=s.palette===4?[.015,.035,.045]:[.10,.14,.17],hi=s.palette===4?[.98,.96,.88]:s.palette===1?[.98,.66,.43]:[.86,.95,.96];c=tint(s.palette===6?atlasTone(a):hi.map((v,i)=>lo[i]*(1-a)+v*a),ox+dx*bestT,oy+dy*bestT,oz+dz*bestT).map(v=>v*a);alpha=a;foundT=bestT;}
   if(alpha>.38)depths[px+w*py]=(s.mode===0||s.mode===2?foundT:opacityDepthT)*dot(rd,b.forward);
   if(s.showPlanes){
    const ps=[(s.slices[0]-.5)*e[0],(s.slices[2]-.5)*e[1],(.5-s.slices[1])*e[2]];
    for(let k=0;k<3;k++){const t=(ps[k]-eye[k])/rd[k];if(t>t0&&t<t1&&t<foundT){const val=tri(ox+dx*t,oy+dy*t,oz+dz*t),tint=[[.88,.42,.35],[.45,.70,.94],[.52,.80,.63]][k],a=.15+.14*smooth(.05,.65,val);c=c.map((v,i)=>v*(1-a)+(tint[i]*.34+val*.66)*a);alpha=Math.max(alpha,a);}}
   }
  }
  const idx=(px+w*py)*4;for(let i=0;i<3;i++)buf[idx+i]=Math.round(Math.pow(Math.max(0,c[i]+bg[i]*(1-alpha)),.89)*255);buf[idx+3]=255;
 }
 }
 return {pixels:buf,depths};
}
let latestJob=null,running=false,runningJob=null,epoch=0;
async function pump(){
 if(running)return;running=true;
 try{while(latestJob){
  const job=latestJob;latestJob=null;runningJob=job;const current=epoch,start=performance.now();
  const frame=await render(job,()=>current!==epoch);
  if(frame&&current===epoch)postMessage({type:'frame',id:job.id,w:job.w,h:job.h,pixels:frame.pixels.buffer,depth:frame.depths.buffer,basis:job.basis,elapsed:performance.now()-start,fast:job.fast},[frame.pixels.buffer,frame.depths.buffer]);
 }}catch(error){postMessage({type:'error',message:error.message});}finally{running=false;runningJob=null;}
}
onmessage=e=>{
 const m=e.data;
 if(m.type==='load'){epoch++;latestJob=null;data=new Uint8Array(m.data);[nx,ny,nz]=m.dimensions;acceleration=validAcceleration(m.acceleration,m.dimensions)?m.acceleration:buildAcceleration(data,m.dimensions);return;}
 if(m.type==='cap'){epoch++;latestJob=null;capData=m.cap;return;}
 if(m.type==='cleanup'){epoch++;latestJob=null;cleanupData=m.map;return;}
 if(m.type==='anatomy'){epoch++;latestJob=null;anatomyData=m.map;anatomyColors=m.colors||DEFAULT_ANATOMY_COLORS;return;}
 // Complete one small interaction frame while coalescing the next. Repeated
 // pointer events must not starve display by continually cancelling fast work.
 if(m.type==='render'){latestJob=m;if(!runningJob?.fast||!m.fast)epoch++;pump();}
};
