/** Bounded TEE instrument containment in the fixed illustrative GI mesh.
 * This does not move an organ, alter a source plane or resize the instrument.
 * The existing open esophageal/pyloric ends are capped only for parity queries;
 * clearance is always measured against the original, uncapped organ wall.
 * Discrete rendered-head vertices and shaft points are checked, not tissue
 * deformation or clinical safety. Reuse the cached query for ranked candidates.
 */
import {createProbeMeshes} from './probe-scene.js';

export const ECHO_TEE_HEAD_RENDER_SCALE=.60;
const CACHE=new WeakMap(),TOLERANCE_MM=1e-4;
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const length=a=>Math.hypot(a[0],a[1],a[2]);
const finite3=a=>a?.length===3&&Array.from(a).every(Number.isFinite);
const unit=a=>{const n=length(a);return a.map(v=>v/n);};
const RAYS=[[.731,.424,.534],[-.641,.673,.368],[.319,-.583,.747]].map(unit);

let headVertices=null;
function renderedHeadVertices(){
 if(headVertices)return headVertices;
 const unique=new Map();
 // Exactly the three head/indicator parts used by TeeProbeScene. Part 2 is
 // the historical fixed shaft; the atlas renders its own routed shaft.
 for(const mesh of createProbeMeshes('tee').filter((_,i)=>i!==2)){
  for(let i=0;i<mesh.vertices.length;i+=6){
   const p=Array.from(mesh.vertices.subarray(i,i+3));unique.set(p.join(','),p);
  }
 }
 // Inspect the most extended vertices first so rejected candidates are cheap.
 headVertices=Object.freeze([...unique.values()].sort((a,b)=>
  (b[0]*b[0]+b[1]*b[1]+(b[2]-5)**2)-(a[0]*a[0]+a[1]*a[1]+(a[2]-5)**2)));
 return headVertices;
}

function triangle(a,b,c,cap=false){
 return {a,b,c,e1:sub(b,a),e2:sub(c,a),cap,
  min:[0,1,2].map(i=>Math.min(a[i],b[i],c[i])),max:[0,1,2].map(i=>Math.max(a[i],b[i],c[i])),
  center:[0,1,2].map(i=>(a[i]+b[i]+c[i])/3)};
}
function buildTree(items){
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(const t of items)for(let i=0;i<3;i++){min[i]=Math.min(min[i],t.min[i]);max[i]=Math.max(max[i],t.max[i]);}
 if(items.length<=12)return {min,max,items};
 const span=max.map((v,i)=>v-min[i]),axis=span.indexOf(Math.max(...span));
 const sorted=[...items].sort((a,b)=>a.center[axis]-b.center[axis]),half=Math.floor(items.length/2);
 return {min,max,left:buildTree(sorted.slice(0,half)),right:buildTree(sorted.slice(half))};
}
function boxDistance2(p,box){
 let total=0;for(let i=0;i<3;i++){const d=Math.max(0,box.min[i]-p[i],p[i]-box.max[i]);total+=d*d;}return total;
}
function triangleDistance2(p,t){
 const ap=sub(p,t.a),ab=t.e1,ac=t.e2,d1=dot(ab,ap),d2=dot(ac,ap);
 if(d1<=0&&d2<=0)return dot(ap,ap);
 const bp=sub(p,t.b),d3=dot(ab,bp),d4=dot(ac,bp);
 if(d3>=0&&d4<=d3)return dot(bp,bp);
 const vc=d1*d4-d3*d2;
 if(vc<=0&&d1>=0&&d3<=0){const v=d1/(d1-d3),q=[ap[0]-v*ab[0],ap[1]-v*ab[1],ap[2]-v*ab[2]];return dot(q,q);}
 const cp=sub(p,t.c),d5=dot(ab,cp),d6=dot(ac,cp);
 if(d6>=0&&d5<=d6)return dot(cp,cp);
 const vb=d5*d2-d1*d6;
 if(vb<=0&&d2>=0&&d6<=0){const w=d2/(d2-d6),q=[ap[0]-w*ac[0],ap[1]-w*ac[1],ap[2]-w*ac[2]];return dot(q,q);}
 const va=d3*d6-d5*d4;
 if(va<=0&&(d4-d3)>=0&&(d5-d6)>=0){const w=(d4-d3)/((d4-d3)+(d5-d6)),bc=sub(t.c,t.b),q=[bp[0]-w*bc[0],bp[1]-w*bc[1],bp[2]-w*bc[2]];return dot(q,q);}
 const denominator=va+vb+vc;
 if(Math.abs(denominator)<1e-25)return Math.min(dot(ap,ap),dot(bp,bp),dot(cp,cp));
 const v=vb/denominator,w=vc/denominator,q=[ap[0]-v*ab[0]-w*ac[0],ap[1]-v*ab[1]-w*ac[1],ap[2]-v*ab[2]-w*ac[2]];
 return dot(q,q);
}
function wallDistance(p,tree){
 let best2=Infinity;const stack=[tree];
 while(stack.length){const node=stack.pop();if(boxDistance2(p,node)>=best2)continue;
  if(node.items){for(const t of node.items)best2=Math.min(best2,triangleDistance2(p,t));}
  else{const a=boxDistance2(p,node.left),b=boxDistance2(p,node.right);if(a<b)stack.push(node.right,node.left);else stack.push(node.left,node.right);}
 }
 return Math.sqrt(best2);
}
function rayBox(p,d,b){
 let lo=0,hi=Infinity;
 for(let i=0;i<3;i++){let a=(b.min[i]-p[i])/d[i],c=(b.max[i]-p[i])/d[i];if(a>c)[a,c]=[c,a];lo=Math.max(lo,a);hi=Math.min(hi,c);if(lo>hi)return false;}
 return true;
}
function rayTriangle(p,d,t){
 const h=cross(d,t.e2),det=dot(t.e1,h);if(Math.abs(det)<1e-11)return null;
 const s=sub(p,t.a),u=dot(s,h)/det;if(u< -1e-10||u>1+1e-10)return null;
 const q=cross(s,t.e1),v=dot(d,q)/det;if(v< -1e-10||u+v>1+1e-10)return null;
 const at=dot(t.e2,q)/det;return at>1e-7?at:null;
}
function rayInside(p,d,tree){
 const hits=[],stack=[tree];
 while(stack.length){const node=stack.pop();if(!rayBox(p,d,node))continue;
  if(node.items){for(const t of node.items){const at=rayTriangle(p,d,t);if(at!==null)hits.push(at);}}
  else stack.push(node.left,node.right);
 }
 hits.sort((a,b)=>a-b);let unique=0,last=-Infinity;
 for(const h of hits)if(h-last>1e-5){unique++;last=h;}
 return unique%2===1;
}

function buildGeometry(model){
 const g=model?.topology?.gastrointestinal;
 if(!g||!Number.isInteger(g.rings)||!Number.isInteger(g.segments)||g.rings<2||g.rings>512||g.segments<3||g.segments>128||g.rings*g.segments*3!==g.positionsMm?.length||!g.indices?.length||g.indices.length%3||g.indices.length>512*128*6)throw new TypeError('TEE clearance requires the fixed GI ring topology.');
 const points=Array.from({length:g.positionsMm.length/3},(_,i)=>Array.from(g.positionsMm.subarray(i*3,i*3+3)));
 if(points.some(p=>!finite3(p)))throw new TypeError('GI coordinates must be finite.');
 const triangles=[];
 for(let i=0;i<g.indices.length;i+=3){const ids=Array.from(g.indices.subarray(i,i+3));if(ids.some(n=>!Number.isInteger(n)||n<0||n>=points.length))throw new TypeError('GI triangle index outside geometry.');triangles.push(triangle(...ids.map(n=>points[n])));}
 const caps=[];
 for(const start of [0,(g.rings-1)*g.segments]){
  const ring=points.slice(start,start+g.segments),center=[0,1,2].map(i=>ring.reduce((s,p)=>s+p[i],0)/ring.length);
  for(let i=0;i<ring.length;i++)caps.push(triangle(center,ring[i],ring[(i+1)%ring.length],true));
 }
 return {wall:buildTree(triangles),solid:buildTree([...triangles,...caps]),triangleCount:triangles.length,capTriangleCount:caps.length};
}

/** Returns a cached callable query(instrument, modelScale, options).
 * `instrument` is the existing {originMm,beam,right,normal} drawing frame.
 * `modelScale` is referenceMm/168.0104, NOT the .60 rendering multiplier.
 * Normal queries reject on the first outside head vertex. `fullReport:true`
 * evaluates all vertices and returns minimum wall clearance / max penetration.
 */
export function createEchoInstrumentClearance(model){
 const topology=model?.topology?.gastrointestinal;if(!topology)throw new TypeError('TEE clearance requires gastrointestinal context.');
 const cached=CACHE.get(topology);if(cached)return cached;
 const geometry=buildGeometry(model),vertices=renderedHeadVertices();
 const point=(p,{marginMm=0,toleranceMm=TOLERANCE_MM,measureClearance=false}={})=>{
  if(!finite3(p)||!Number.isFinite(marginMm)||marginMm<0||!Number.isFinite(toleranceMm)||toleranceMm<0)throw new TypeError('Clearance query needs finite points and nonnegative margins.');
  let inside=rayInside(p,RAYS[0],geometry.solid),distance=null;
  if(!inside){
   const second=rayInside(p,RAYS[1],geometry.solid),third=rayInside(p,RAYS[2],geometry.solid);inside=Number(inside)+Number(second)+Number(third)>=2;
   distance=wallDistance(p,geometry.wall);if(distance<=toleranceMm)inside=true;
  }
  if(inside&&(measureClearance||marginMm>0)&&distance===null)distance=wallDistance(p,geometry.wall);
  const fits=inside&&(marginMm===0||distance>=marginMm-toleranceMm);
  return {inside, fits,clearanceMm:inside?distance:null,penetrationMm:inside?0:distance,marginMm};
 };
 const query=(instrument,modelScale=model.frame.scale,{fullReport=false,toleranceMm=TOLERANCE_MM}={})=>{
  if(!(Number.isFinite(modelScale)&&modelScale>0))throw new TypeError('TEE head scale must be positive.');
  for(const k of ['originMm','beam','right','normal'])if(!finite3(instrument?.[k]))throw new TypeError('TEE head needs a finite drawing frame.');
  const axes=[instrument.beam,instrument.right,instrument.normal];
  if(axes.some(a=>Math.abs(length(a)-1)>1e-5)||Math.abs(dot(axes[0],axes[1]))>1e-5||Math.abs(dot(axes[0],axes[2]))>1e-5||Math.abs(dot(axes[1],axes[2]))>1e-5)throw new TypeError('TEE head drawing frame must be orthonormal.');
  const renderScale=ECHO_TEE_HEAD_RENDER_SCALE*modelScale;
  let testedVertices=0,outsideVertices=0,minClearance=Infinity,penetration=0,firstOutsideMm=null;
  for(const v of vertices){
   const p=[0,1,2].map(i=>instrument.originMm[i]+renderScale*(instrument.right[i]*v[0]+instrument.normal[i]*v[1]-instrument.beam[i]*v[2]));
   const result=point(p,{toleranceMm,measureClearance:fullReport});testedVertices++;
   if(result.inside){if(result.clearanceMm!==null)minClearance=Math.min(minClearance,result.clearanceMm);}
   else{outsideVertices++;penetration=Math.max(penetration,result.penetrationMm);if(!firstOutsideMm)firstOutsideMm=p;if(!fullReport)break;}
  }
  return {inside:outsideVertices===0,testedVertices,totalVertices:vertices.length,complete:testedVertices===vertices.length,
   outsideVertices,clearanceMm:Number.isFinite(minClearance)?minClearance:null,penetrationMm:penetration,firstOutsideMm,
   renderScale,patientRegistered:false,method:'Rendered head vertices inside the fixed GI mesh'};
 };
 query.point=point;
 query.route=(points,radiusMm,{ignoreEntryPoint=true,fullReport=false}={})=>{
  if(!Array.isArray(points)||points.length<2||!Number.isFinite(radiusMm)||radiusMm<0)throw new TypeError('Shaft route needs at least two points and a nonnegative radius.');
  let testedPoints=0,failedPoints=0,minimumClearance=Infinity,worstPenetration=0;
  for(let i=ignoreEntryPoint?1:0;i<points.length;i++){
   const result=point(points[i],{marginMm:radiusMm,measureClearance:true});testedPoints++;
   if(result.clearanceMm!==null)minimumClearance=Math.min(minimumClearance,result.clearanceMm);
   if(!result.fits){failedPoints++;worstPenetration=Math.max(worstPenetration,result.penetrationMm||0,radiusMm-(result.clearanceMm??0));if(!fullReport)break;}
  }
  return {inside:failedPoints===0,testedPoints,failedPoints,clearanceMm:Number.isFinite(minimumClearance)?minimumClearance:null,penetrationMm:worstPenetration,radiusMm};
 };
 query.metadata=Object.freeze({headVertices:vertices.length,wallTriangles:geometry.triangleCount,queryCapTriangles:geometry.capTriangleCount,renderMultiplier:ECHO_TEE_HEAD_RENDER_SCALE,patientRegistered:false});
 CACHE.set(topology,query);return query;
}
