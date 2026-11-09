import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {parseNativeMesh} from '../public/native-mesh-format.js';
import {filterOverviewFaces} from '../public/overview-face-filter.js';
const hash=b=>createHash('sha256').update(b).digest('hex');
const root=new URL('../',import.meta.url),report={schema:'overview-filter-browser-decoder-check-v22',passed:true,records:[]};
const manifest=JSON.parse(await readFile(new URL('public/assets/noise-cleanup-v22/manifest.json',root)));
for(const record of manifest.records) {
  const encoded=await readFile(`/workspace/data/guided-native-v21/whole/overview/assets/${record.id}.hfm.gz`);
  assert.equal(hash(encoded),record.sourceSha256);
  const raw=gunzipSync(encoded);assert.equal(hash(raw),record.sourceDecodedSha256);
  const mesh=parseNativeMesh(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),raw.length);
  const maskEncoded=await readFile(new URL('public'+record.mask.url,root)),mask=gunzipSync(maskEncoded);
  assert.equal(hash(maskEncoded),record.mask.sha256);assert.equal(hash(mask),record.mask.decodedSha256);
  const repaired=filterOverviewFaces(mesh,mask,record);
  assert.equal(repaired.indexCount,record.retainedTriangles*3);
  assert.deepEqual(new Uint8Array(repaired.buffer,16,mesh.indexOffset-16),new Uint8Array(mesh.buffer,16,mesh.indexOffset-16));
  const original=new Uint32Array(mesh.buffer,mesh.indexOffset,mesh.indexCount),filtered=new Uint32Array(repaired.buffer,repaired.indexOffset,repaired.indexCount);
  const ids=new Uint32Array(record.retainedTriangles);let out=0;
  for(let i=0;i<record.originalTriangles;i++)if((mask[i>>3]>>(i&7))&1){
    ids[out]=i;for(let k=0;k<3;k++)assert.equal(filtered[out*3+k],original[i*3+k]);out++;
  }
  assert.equal(hash(new Uint8Array(ids.buffer)),record.retainedTriangleIndexSha256);
  assert.equal(hash(new Uint8Array(mesh.buffer)),record.sourceDecodedSha256);
  const corrupt=mask.slice();corrupt[0]^=1;assert.throws(()=>filterOverviewFaces(mesh,corrupt,record),/face count/);
  assert.throws(()=>filterOverviewFaces(mesh,mask,{...record,originalTriangles:record.originalTriangles+1}),/match/);
  if(record.originalTriangles%8){const padded=mask.slice();padded[padded.length-1]|=128;assert.throws(()=>filterOverviewFaces(mesh,padded,record),/padding/);}
  const result={id:record.id,sourceSha256:record.sourceSha256,originalTriangles:record.originalTriangles,retainedTriangles:record.retainedTriangles,
    removedTriangles:record.removedTriangles,exactRetainedTriangleIds:true,allPositionsAndNormalsExact:true,sourceUnchanged:true,corruptMaskRejected:true};
  report.records.push(result);console.log(JSON.stringify(result));
}
report.scope='Actual browser filter and archived HFM files, independent of offline mask generator; not anatomical or closed-solid validation.';
await writeFile(new URL('docs/noise-cleanup-v22/overview-decoder-verification.json',root),JSON.stringify(report,null,2)+'\n');
