import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { RIG, cycleAmount, deformPoint, jacobianDeterminant } from '../public/motion-field-v24.js';
import { parseNativeMesh } from '../public/native-mesh-format.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const input=process.argv[2]||'/workspace/data/guided-native-v21/whole/overview/assets/detail.hfm.gz';
const compressed=fs.readFileSync(input),raw=zlib.gunzipSync(compressed);
const source=JSON.parse(fs.readFileSync(path.join(root,'public/assets/motion-lab-v24/donor.json')));
const record=source.overviewLods.find(v=>v.id==='detail').parts[0];
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.equal(sha(compressed),record.sha256);assert.equal(sha(raw),record.decodedSha256);
const buffer=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),mesh=parseNativeMesh(buffer,record.decodedBytes);
assert.equal(mesh.positionFormat,'float32');const points=new Float32Array(buffer,mesh.positionOffset,mesh.vertexCount*3);
const mm=source.worldMm;
let maxDisplacement=0,maxRestError=0,minJ=Infinity,maxJ=-Infinity,meanJ=0;
const displacements=[];
for(let i=0;i<mesh.vertexCount;i++){
 const p=Array.from(points.subarray(i*3,i*3+3)),q=deformPoint(p,1,2,true),zero=deformPoint(p,0,2,true);
 const d=Math.hypot(...q.map((x,k)=>x-p[k]))*mm;maxDisplacement=Math.max(maxDisplacement,d);displacements.push(d);
 maxRestError=Math.max(maxRestError,...zero.map((x,k)=>Math.abs(x-p[k])));const j=jacobianDeterminant(p,1,2);minJ=Math.min(minJ,j);maxJ=Math.max(maxJ,j);meanJ+=j;
}
displacements.sort((a,b)=>a-b);
assert.equal(maxRestError,0);assert(minJ>0);assert.equal(cycleAmount(0),0);assert.equal(cycleAmount(1),0);assert.equal(cycleAmount(.38),1);
const determinant=m=>m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])-m[1][0]*(m[0][1]*m[2][2]-m[0][2]*m[2][1])+m[2][0]*(m[0][1]*m[1][2]-m[0][2]*m[1][1]);
let maxJacobianDifference=0,minNumericJ=Infinity,minAxialDerivative=Infinity,gridSamples=0;
const eps=1e-5;
for(let yi=0;yi<=40;yi++)for(let xi=0;xi<=20;xi++)for(let zi=0;zi<=20;zi++){
 const p=[-.45+xi*.045,-.5+yi*.025,-.45+zi*.045];
 const columns=[0,1,2].map(k=>{const lo=p.slice(),hi=p.slice();lo[k]-=eps;hi[k]+=eps;const a=deformPoint(lo,1,2,true),b=deformPoint(hi,1,2,true);return b.map((x,i)=>(x-a[i])/(2*eps));});
 const numeric=determinant(columns);minNumericJ=Math.min(minNumericJ,numeric);maxJacobianDifference=Math.max(maxJacobianDifference,Math.abs(numeric-jacobianDeterminant(p,1,2)));minAxialDerivative=Math.min(minAxialDerivative,columns[1][1]);gridSamples++;
}
assert(minNumericJ>0);assert(minAxialDerivative>0);assert(maxJacobianDifference<1e-5);
// A smooth field has nonzero displacements at fine-detail points; it does not
// mutate source arrays, alter face indices, or rerun surface extraction.
assert.equal(sha(new Uint8Array(buffer)),record.decodedSha256);
const output={schema:'heart-motion-audit-v24.1',sourceSha256:record.sha256,sourceDecodedSha256:record.decodedSha256,
 verticesChecked:mesh.vertexCount,trianglesUnchanged:mesh.indexCount/3,rig:RIG,geometryArraysUnmodified:true,
 motionIsMeasured:false,registeredToDynamicCT:false,referenceIsEndDiastole:false,fullMyocardialVolumeConservationEstablished:false,
 restIdentityMaxErrorMm:maxRestError*mm,cycleClosureMaxErrorMm:0,gridSamples,positiveJacobianAtAllGridSamples:true,
 minimumAxialDerivative:minAxialDerivative,finiteDifferenceJacobianMaxAbsoluteError:maxJacobianDifference,
 cavityAware:{minimumJacobianOnDisplayVertices:minJ,maximumJacobianOnDisplayVertices:maxJ,vertexMeanJacobian:meanJ/mesh.vertexCount,minimumJacobianOnAuditGrid:minNumericJ,
 displacementMm:{median:displacements[Math.floor(displacements.length*.5)],p95:displacements[Math.floor(displacements.length*.95)],maximum:maxDisplacement}},
 analyticDeterminant:'J=1-B(y)*exp(-r^2/R^2), B=0.44*amplitude*w(y); J>=0.56 for all allowed amplitudes. Axial derivative g\'(y)>0 is checked numerically and bounded by the polynomial coefficients.',
 limitations:['The analytic field is an assumed single-cavity model, not a segmented ventricular shell.','Positive pointwise Jacobians do not validate tissue strains, valvular contact or pre-existing surface intersections.','The source display mesh is already lossy and not a watertight anatomical segmentation.','Vertex-mean Jacobian is not a myocardial volume measurement.','No clinical motion, pressure, force, fiber architecture or hemodynamic inference.','Source noise and missing structures remain.'],
 summary:`Checked ${new Intl.NumberFormat('en').format(mesh.vertexCount)} display vertices: exact rest recovery and cycle closure; no source-array changes. The cavity-aware field has positive sampled Jacobians (${minNumericJ.toFixed(3)}–1.000). This does not establish accurate cardiac motion or myocardial volume conservation.`};
fs.mkdirSync(path.join(root,'docs/motion-lab-v24'),{recursive:true});
for(const relative of ['docs/motion-lab-v24/deformation-audit.json','public/assets/motion-lab-v24/deformation-audit.json'])fs.writeFileSync(path.join(root,relative),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(output,null,2));
