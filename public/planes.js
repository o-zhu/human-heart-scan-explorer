// Geometry is expressed in the original scan axes, then mapped into viewer space.
export const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
export const add=(a,b)=>a.map((v,i)=>v+b[i]);
export const mul=(a,s)=>a.map(v=>v*s);
export const norm=a=>mul(a,1/(Math.hypot(...a)||1));
export const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const sourceToWorld=(p,e)=>[(p[0]-.5)*e[0],(p[2]-.5)*e[1],(.5-p[1])*e[2]];
export const worldToSource=(p,e)=>[p[0]/e[0]+.5,.5-p[2]/e[2],p[1]/e[1]+.5];
export function orthogonalFrame(axis,position,extent){
 const p=[.5,.5,.5];p[axis]=position;
 const right=axis===0?[0,0,-1]:[1,0,0],up=axis===2?[0,0,1]:[0,-1,0];
 return {center:sourceToWorld(p,extent),right,up,normal:cross(right,up),width:axis===0?extent[2]:extent[0],height:axis===2?extent[2]:extent[1]};
}
export function clipPlane(settings,extent){
 if(settings.clipAxis<0)return null;
 let plane;
 if(settings.clipAxis===3&&settings.oblique)plane={...settings.oblique,normal:norm(settings.oblique.normal)};
 else {
  plane=orthogonalFrame(settings.clipAxis,settings.clipPosition,extent);
  plane.normal=[[1,0,0],[0,0,-1],[0,1,0]][settings.clipAxis];
 }
 if(!plane?.normal)return null;
 const normal=mul(plane.normal,settings.clipFlip?-1:1);
 return {...plane,normal,distance:dot(normal,plane.center)};
}
