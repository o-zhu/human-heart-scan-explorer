/**
 * One fixed, smooth fit of the intact LADAF reference skeleton.
 *
 * The independent illustrative esophagus crosses the original reference spine.
 * A local depth fit moves the vertebral front posteriorly while preserving room
 * for the spinous processes inside the unchanged skin. The smaller anterior
 * term fits the sternum inside the same skin. Every bone uses this field, so
 * shared positions remain shared; no triangle is cut, removed or added.
 *
 * Inputs use reference millimetres relative to the fixed body reference origin.
 * This is an illustrative fit, not measured donor anatomy or registration.
 */
const frozenVector=value=>Object.freeze([...value]);
const term=(amplitudeMm,leftMm,anteriorMm,leftRadiusMm,anteriorRadiusMm)=>Object.freeze({amplitudeMm,centerMm:frozenVector([leftMm,anteriorMm]),radiusMm:frozenVector([leftRadiusMm,anteriorRadiusMm])});
const terms=Object.freeze([
 term(14,-20,-60,60,30),
 term(3,-20,90,60,35),
]);
const gradientBound=terms.reduce((sum,t)=>sum+Math.sqrt(2/Math.E)*t.amplitudeMm/t.radiusMm[1],0);

export const ECHO_SKELETON_FITS=Object.freeze({
 'ladaf-2021-17':Object.freeze({
  revision:'echo-intact-skeleton-fit-v41',
  method:'One fixed smooth depth fit shared by the intact reference spine, ribs, sternum and clavicles.',
  coordinateSystem:'Patient-left, superior, anterior reference millimetres relative to the fixed body reference origin.',
  terms,
  maximumDisplacementMm:terms.reduce((sum,t)=>sum+t.amplitudeMm,0),
  minimumJacobianDeterminant:1-gradientBound,
  topologyPreserved:true,
  patientRegistered:false,
 }),
});

/** The field changes only anterior depth. Its determinant is positive globally,
 * not only at the sampled mesh vertices. Normals use the exact inverse transpose
 * of the local Jacobian, including the left-to-depth derivative.
 */
export function fitEchoSkeletonSample(point,normal,fit){
 let displacement=0,dx=0,dz=1;
 for(const term of fit.terms){
  const x=point[0]-term.centerMm[0],z=point[2]-term.centerMm[1],rx2=term.radiusMm[0]**2,rz2=term.radiusMm[1]**2;
  const amount=term.amplitudeMm*Math.exp(-x*x/rx2-z*z/rz2);
  displacement+=amount;dx+=2*x*amount/rx2;dz+=2*z*amount/rz2;
 }
 return {
  point:[point[0],point[1],point[2]-displacement],
  normal:normal?[normal[0]-dx*normal[2]/dz,normal[1],normal[2]/dz]:null,
  displacementMm:displacement,
  jacobianDeterminant:dz,
 };
}
