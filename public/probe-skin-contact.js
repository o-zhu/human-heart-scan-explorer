/** Probe contact on the fixed, illustrative BodyParts3D skin triangles.
 * No donor registration is inferred. Points and distances use donor world mm.
 * The BVH limits work to nearby skin; movement has no synthetic ellipse limit.
 */
import {add,mul,dot,cross,norm} from './planes.js';

export const SKIN_CONTACT_REVISION='body-skin-contact-v44';
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const finite=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const squareDistance=(a,b)=>a.reduce((s,v,i)=>s+(v-b[i])**2,0);
const cache=new WeakMap();

function closestTriangle(p,a,b,c){
 const ab=sub(b,a),ac=sub(c,a),ap=sub(p,a),d1=dot(ab,ap),d2=dot(ac,ap);
 if(d1<=0&&d2<=0)return {point:a,weights:[1,0,0]};
 const bp=sub(p,b),d3=dot(ab,bp),d4=dot(ac,bp);
 if(d3>=0&&d4<=d3)return {point:b,weights:[0,1,0]};
 const vc=d1*d4-d3*d2;
 if(vc<=0&&d1>=0&&d3<=0){const v=d1/(d1-d3);return {point:add(a,mul(ab,v)),weights:[1-v,v,0]};}
 const cp=sub(p,c),d5=dot(ab,cp),d6=dot(ac,cp);
 if(d6>=0&&d5<=d6)return {point:c,weights:[0,0,1]};
 const vb=d5*d2-d1*d6;
 if(vb<=0&&d2>=0&&d6<=0){const w=d2/(d2-d6);return {point:add(a,mul(ac,w)),weights:[1-w,0,w]};}
 const va=d3*d6-d5*d4;
 if(va<=0&&d4-d3>=0&&d5-d6>=0){const w=(d4-d3)/((d4-d3)+(d5-d6));return {point:add(b,mul(sub(c,b),w)),weights:[0,1-w,w]};}
 const total=va+vb+vc;if(Math.abs(total)<1e-18)return {point:a,weights:[1,0,0]};
 const v=vb/total,w=vc/total;return {point:add(a,add(mul(ab,v),mul(ac,w))),weights:[1-v-w,v,w]};
}
function boxDistance(point,node){let d=0;for(let i=0;i<3;i++)d+=Math.max(node.min[i]-point[i],0,point[i]-node.max[i])**2;return d;}
function rayBox(origin,direction,node,limit){
 let lo=0,hi=limit;
 for(let i=0;i<3;i++){
  if(Math.abs(direction[i])<1e-12){if(origin[i]<node.min[i]||origin[i]>node.max[i])return false;continue;}
  let a=(node.min[i]-origin[i])/direction[i],b=(node.max[i]-origin[i])/direction[i];if(a>b)[a,b]=[b,a];lo=Math.max(lo,a);hi=Math.min(hi,b);if(lo>hi)return false;
 }
 return true;
}
function triangle(surface,id){const v=surface.vertices,i=id*18;return [0,6,12].map(k=>Array.from(v.subarray(i+k,i+k+3)));}
function hitRecord(surface,id,point,weights,distance=0){
 const v=surface.vertices,at=id*18;
 let outward=[0,1,2].map(k=>weights[0]*v[at+k+3]+weights[1]*v[at+k+9]+weights[2]*v[at+k+15]);
 if(Math.hypot(...outward)<1e-8){const [a,b,c]=triangle(surface,id);outward=cross(sub(b,a),sub(c,a));}
 return {pointMm:[...point],outward:norm(outward),triangleIndex:id,barycentric:weights,distance,sourceKey:surface.key};
}
export function createSkinContactSurface(model){
 if(cache.has(model))return cache.get(model);
 const skin=model?.skinSurface;if(!(skin?.vertices instanceof Float32Array)||skin.vertices.length%18)throw new TypeError('Verified skin triangles are required.');
 const vertices=skin.vertices,triangles=vertices.length/18;
 const bounds=Array.from({length:triangles},(_,id)=>{const at=id*18,min=[0,1,2].map(k=>Math.min(vertices[at+k],vertices[at+k+6],vertices[at+k+12])),max=[0,1,2].map(k=>Math.max(vertices[at+k],vertices[at+k+6],vertices[at+k+12]));return {min,max,center:mul(add(min,max),.5)};});
 function tree(ids){
  const min=[0,1,2].map(k=>Math.min(...ids.map(id=>bounds[id].min[k]))),max=[0,1,2].map(k=>Math.max(...ids.map(id=>bounds[id].max[k]))),node={min,max};
  if(ids.length<=12){node.ids=ids;return node;}
  const sizes=sub(max,min),axis=sizes.indexOf(Math.max(...sizes));ids.sort((a,b)=>bounds[a].center[axis]-bounds[b].center[axis]);const mid=Math.floor(ids.length/2);node.left=tree(ids.slice(0,mid));node.right=tree(ids.slice(mid));return node;
 }
 const surface={kind:'body-skin',vertices,tree:tree(Array.from({length:triangles},(_,i)=>i)),model,referenceMm:model.referenceMm,key:[SKIN_CONTACT_REVISION,model.frame.donorId,model.referenceMm,skin.sourceSha256,model.bodyTransform.scale].join(':'),patientRegistered:false};
 cache.set(model,surface);return surface;
}
export function nearestSkinContact(surface,point){
 if(!finite(point))throw new TypeError('Skin contact requires a finite point.');
 let best=null,bestSquared=Infinity;
 const visit=node=>{
  if(boxDistance(point,node)>bestSquared)return;
  if(node.ids){for(const id of node.ids){const result=closestTriangle(point,...triangle(surface,id)),d=squareDistance(point,result.point);if(d<bestSquared){bestSquared=d;best=hitRecord(surface,id,result.point,result.weights,Math.sqrt(d));}}return;}
  const children=[node.left,node.right].sort((a,b)=>boxDistance(point,a)-boxDistance(point,b));visit(children[0]);visit(children[1]);
 };
 visit(surface.tree);return best;
}
export function raycastSkin(surface,origin,direction){
 if(!finite(origin)||!finite(direction)||Math.hypot(...direction)<1e-8)return null;
 const ray=norm(direction);let best=null,distance=Infinity;
 const visit=node=>{
  if(!rayBox(origin,ray,node,distance))return;
  if(node.ids){for(const id of node.ids){
   const [a,b,c]=triangle(surface,id),ab=sub(b,a),ac=sub(c,a),h=cross(ray,ac),det=dot(ab,h);if(Math.abs(det)<1e-10)continue;
   const s=sub(origin,a),u=dot(s,h)/det;if(u<0||u>1)continue;
   const q=cross(s,ab),v=dot(ray,q)/det;if(v<0||u+v>1)continue;
   const t=dot(ac,q)/det;if(t<1e-6||t>=distance)continue;distance=t;best=hitRecord(surface,id,add(origin,mul(ray,t)),[1-u-v,u,v],t);
  }return;}
  visit(node.left);visit(node.right);
 };
 visit(surface.tree);return best;
}
export function skinContactFrame(surface,hit,preferredRight){
 const inward=mul(hit.outward||hit.inward?.map(x=>-x),-1),candidate=preferredRight||hit.right||surface.model.frame.left;
 let right=sub(candidate,mul(inward,dot(candidate,inward)));
 if(Math.hypot(...right)<1e-6){const axis=Math.abs(inward[1])<.9?[0,1,0]:[1,0,0];right=cross(axis,inward);}
 right=norm(right);const normal=norm(cross(inward,right));
 return {kind:'body-skin',sourceKey:surface.key,pointMm:[...hit.pointMm],right,inward,normal,du:right,dv:normal,triangleIndex:hit.triangleIndex,patientRegistered:false};
}
export function restoreSkinContact(surface,saved,preferredRight){
 const hit=nearestSkinContact(surface,saved.pointMm);return skinContactFrame(surface,hit,preferredRight||saved.right);
}
export function initialSkinContact(surface,frame,originMm){
 const target=mul(frame.center,frame.referenceMm),outward=norm(frame.up),hit=raycastSkin(surface,target,outward)||nearestSkinContact(surface,originMm);
 return skinContactFrame(surface,hit,frame.right);
}

/** Sliding follows the fixed reference chest, not the acquisition plane.
 * Positive advance is headward. Positive lateral travels around the chest
 * toward screen-right in the front view, continuing around either side.
 * Keep this tangent basis separate from contact.right: rotating or changing
 * the probe preset must not reverse WASD or rotate the accepted scan plane.
 */
function skinSlideDirection(surface,contact,lateral,advance){
 const superior=surface.model.frame.superior,up=sub(superior,mul(contact.inward,dot(superior,contact.inward)));
 const length=Math.hypot(...up);
 // At a horizontal cap there is no further headward surface tangent. A/D
 // can still move across it; projecting the fixed left axis avoids NaNs.
 if(length<1e-6){
  const right=sub(surface.model.frame.left,mul(contact.inward,dot(surface.model.frame.left,contact.inward)));
  return mul(norm(right),lateral);
 }
 const headward=mul(up,1/length),right=norm(cross(contact.inward,headward));
 return add(mul(right,lateral),mul(headward,advance));
}

export function moveOnSkin(surface,contact,{lateral=0,advance=0},distanceMm){
 if(!distanceMm||(!lateral&&!advance))return contact;
 const count=Math.max(1,Math.ceil(Math.abs(distanceMm)/1.25)),step=distanceMm/count;let current=contact;
 for(let i=0;i<count;i++){
  const tangent=skinSlideDirection(surface,current,lateral,advance);if(Math.hypot(...tangent)<1e-8)break;
  const direction=norm(tangent),wanted=add(current.pointMm,mul(direction,step)),hit=nearestSkinContact(surface,wanted);
  if(!hit||hit.distance>Math.abs(step)*2+.05)break;
  const next=skinContactFrame(surface,hit,current.right);
  if(Math.sqrt(squareDistance(next.pointMm,current.pointMm))<1e-6)break;
  current=next;
 }
 return current;
}
