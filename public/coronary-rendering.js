/** Prepared display field, independent of original CT values and plane geometry. */
export function activeCoronaryField(renderer) {
 const field=renderer.coronaryField,s=renderer.settings;
 if(!field||s?.coronaryReveal!==true||s.mode!==0||
    !['reconstruction','echo'].includes(renderer.coronaryWorkspace)||
    field.meta.donorId!==renderer.donorId||
    !field.meta.extent.every((v,i)=>Math.abs(v-renderer.extent[i])<1e-6))return null;
 return field;
}

/** Reject a stale donor/physical grid before touching any visible GL resource. */
export function validateCoronaryField(renderer,data,meta) {
 const d=meta?.dimensions;
 if(!meta||meta.donorId!==renderer.donorId||!Array.isArray(d)||d.length!==3||
    !d.every(n=>Number.isInteger(n)&&n>=2&&n<=2048)||
    !(data instanceof Uint8Array)||data.length!==d.reduce((a,b)=>a*b,1)||
    data.length>300*1024*1024||!Number.isFinite(meta.threshold)||meta.threshold<=0||meta.threshold>=1||
    !Array.isArray(meta.extent)||meta.extent.length!==3||
    !meta.extent.every((v,i)=>Number.isFinite(v)&&Math.abs(v-renderer.extent[i])<1e-6)) {
  throw new Error('The prepared coronary view does not match this heart.');
 }
 return meta;
}
