// Multiplanar reformat of the measured scalar volume, with no generated tissue.
let data,dims,extent;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function sample(x,y,z){
 const [nx,ny,nz]=dims;if(x<0||x>nx-1||y<0||y>ny-1||z<0||z>nz-1)return 0;
 const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z),jx=Math.min(ix+1,nx-1),jy=Math.min(iy+1,ny-1),jz=Math.min(iz+1,nz-1),fx=x-ix,fy=y-iy,fz=z-iz;
 const a=ix+nx*(iy+ny*iz),b=ix+nx*(jy+ny*iz),c=ix+nx*(iy+ny*jz),d=ix+nx*(jy+ny*jz),off=jx-ix;
 return ((data[a]*(1-fx)+data[a+off]*fx)*(1-fy)+(data[b]*(1-fx)+data[b+off]*fx)*fy)*(1-fz)+((data[c]*(1-fx)+data[c+off]*fx)*(1-fy)+(data[d]*(1-fx)+data[d+off]*fx)*fy)*fz;
}
onmessage=e=>{
 const m=e.data;
 if(m.type==='load'){data=m.data;dims=m.dimensions;extent=m.extent;return;}
 if(m.type!=='sample'||!data)return;
 const {plane:p,width:w,height:h,id}=m,out=new Uint8Array(w*h),[nx,ny,nz]=dims;
 for(let row=0;row<h;row++){
  const v=(.5-row/(h-1))*p.height;
  for(let col=0;col<w;col++){
   const u=(col/(w-1)-.5)*p.width;
   const x=p.center[0]+p.right[0]*u+p.up[0]*v,y=p.center[1]+p.right[1]*u+p.up[1]*v,z=p.center[2]+p.right[2]*u+p.up[2]*v;
   out[col+row*w]=Math.round(sample((x/extent[0]+.5)*(nx-1),(.5-z/extent[2])*(ny-1),(y/extent[1]+.5)*(nz-1)));
  }
 }
 postMessage({id,data:out,width:w,height:h},[out.buffer]);
};
