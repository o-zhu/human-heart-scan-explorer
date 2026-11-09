/** Independent triangle-distance checks for the fixed illustrative skin.
 * No production skin intersection or pose-fitting routine is used here.
 */
const sub=(a,b)=>a.map((x,i)=>x-b[i]);
const add=(a,b)=>a.map((x,i)=>x+b[i]);
const scale=(a,s)=>a.map(x=>x*s);
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const length=a=>Math.hypot(...a);
const unit=a=>scale(a,1/length(a));
const clamp=x=>Math.max(-1,Math.min(1,x));

/** Closest point by triangle Voronoi regions, including vertex/edge cases. */
export function closestPointOnTriangle(p,a,b,c){
 const ab=sub(b,a),ac=sub(c,a),ap=sub(p,a),d1=dot(ab,ap),d2=dot(ac,ap);
 if(d1<=0&&d2<=0)return {point:a,barycentric:[1,0,0]};
 const bp=sub(p,b),d3=dot(ab,bp),d4=dot(ac,bp);
 if(d3>=0&&d4<=d3)return {point:b,barycentric:[0,1,0]};
 const vc=d1*d4-d3*d2;
 if(vc<=0&&d1>=0&&d3<=0){const v=d1/(d1-d3);return {point:add(a,scale(ab,v)),barycentric:[1-v,v,0]};}
 const cp=sub(p,c),d5=dot(ab,cp),d6=dot(ac,cp);
 if(d6>=0&&d5<=d6)return {point:c,barycentric:[0,0,1]};
 const vb=d5*d2-d1*d6;
 if(vb<=0&&d2>=0&&d6<=0){const w=d2/(d2-d6);return {point:add(a,scale(ac,w)),barycentric:[1-w,0,w]};}
 const va=d3*d6-d5*d4;
 if(va<=0&&(d4-d3)>=0&&(d5-d6)>=0){const w=(d4-d3)/((d4-d3)+(d5-d6));return {point:add(b,scale(sub(c,b),w)),barycentric:[0,1-w,w]};}
 const denominator=va+vb+vc;
 if(Math.abs(denominator)<1e-20)throw new Error('Cannot audit a degenerate skin triangle.');
 const v=vb/denominator,w=vc/denominator;
 return {point:add(a,add(scale(ab,v),scale(ac,w))),barycentric:[1-v-w,v,w]};
}

export function worldToFixedBody(point,model){
 const t=model.bodyTransform,p=scale(sub(point,t.originMm),1/t.scale);
 return add(t.referenceOriginMm,[dot(p,t.left),dot(p,t.superior),dot(p,t.anterior)]);
}
const inside=(p,box,tolerance=1e-3)=>p.every((x,i)=>x>=box.min[i]-tolerance&&x<=box.max[i]+tolerance);

/** Physical origin distance to actual triangle surface, reference-window
 * membership, and inward beam sign. Surface tolerance is separate from plane
 * tolerance because the drawable mesh uses Float32 positions.
 */
export function evaluateSkinContact(pose,model,windowId){
 if(!model?.skinSurface?.vertices||!model.bodyTransform)return {applicable:false,reason:'No verified fixed skin mesh'};
 const bodyOrigin=worldToFixedBody(pose.originMm,model),window=model.bodyWindows?.[windowId];
 const v=model.skinSurface.vertices,r=model.skinSurface.referenceVertices;
 let nearest=null,frontNearest=null;
 for(let i=0;i<v.length;i+=18){
  const a=Array.from(v.subarray(i,i+3)),b=Array.from(v.subarray(i+6,i+9)),c=Array.from(v.subarray(i+12,i+15));
  const hit=closestPointOnTriangle(pose.originMm,a,b,c),distanceMm=length(sub(hit.point,pose.originMm));
  const bodyNormal=unit([0,1,2].map(k=>r[i+3+k]+r[i+9+k]+r[i+15+k]));
  if(nearest&&distanceMm>=nearest.distanceMm&&bodyNormal[2]<=.02)continue;
  const normal=unit([0,1,2].map(k=>hit.barycentric.reduce((sum,weight,j)=>sum+weight*v[i+j*6+3+k],0)));
  const result={distanceMm,pointMm:hit.point,triangleIndex:i/18,normal,bodyNormal,barycentric:hit.barycentric};
  if(!nearest||distanceMm<nearest.distanceMm)nearest=result;
  if(bodyNormal[2]>.02&&(!frontNearest||distanceMm<frontNearest.distanceMm))frontNearest=result;
 }
 const beamNormalDot=frontNearest?dot(unit(pose.beam),frontNearest.normal):null;
 return {applicable:true,bodyOriginMm:bodyOrigin,windowId,
  withinFixedWindow:!!window&&inside(bodyOrigin,window.referenceBounds),
  surfaceDistanceMm:nearest?.distanceMm??null,frontSurfaceDistanceMm:frontNearest?.distanceMm??null,
  triangleIndex:frontNearest?.triangleIndex??null,nearestFrontPointMm:frontNearest?.pointMm??null,
  inwardBeam:beamNormalDot!==null&&beamNormalDot<0,beamOutwardNormalDot:beamNormalDot,
  incidenceAngleDeg:beamNormalDot===null?null:Math.acos(clamp(-beamNormalDot))*180/Math.PI,
  contact:!!frontNearest&&frontNearest.distanceMm<=1e-3,
  patientRegistered:false};
}
