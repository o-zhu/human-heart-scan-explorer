import {add,mul,norm,cross,dot} from './planes.js';

const radians=x=>x*Math.PI/180;
function rotate(v,axis,angle){const a=norm(axis),c=Math.cos(angle),s=Math.sin(angle);return add(add(mul(v,c),mul(cross(a,v),s)),mul(a,dot(a,v)*(1-c)));}

/** A rotated cut pivots about its anatomical target; source coordinates stay fixed. */
export function flowPlane(preset,state,longestMm){
 if(!preset?.world||!longestMm)return null;
 const b=preset.world;
 let right=norm(b.right),up=norm(b.up),normal=norm(b.normal||cross(right,up));
 right=rotate(right,up,radians(state.rotationDeg||0));normal=rotate(normal,up,radians(state.rotationDeg||0));
 up=rotate(up,right,radians(state.tiltDeg||0));normal=norm(rotate(normal,right,radians(state.tiltDeg||0)));
 right=norm(right);up=norm(up);
 const originalDelta=b.center.map((v,i)=>v-b.target[i]);
 const target=add(b.target,mul(normal,(state.offsetMm||0)/longestMm));
 const center=add(target,add(mul(right,dot(originalDelta,b.right)),mul(up,dot(originalDelta,b.up))));
 return {center,right,up,normal,width:b.width,height:b.height,target};
}

