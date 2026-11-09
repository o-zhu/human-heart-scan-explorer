/** Reproduce cleanup against independently measured, checksum-pinned NBE1 tiles. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {parseNativeEdges,meshNativeEdges} from '../public/native-edge-format.js';
import {classifyNativeTissue,NATIVE_CLEANUP} from '../public/native-noise-filter.js';
const sha=b=>createHash('sha256').update(b).digest('hex');
const measured=JSON.parse(await readFile(new URL('../docs/noise-cleanup-v22/native-components.json',import.meta.url)));
const results=[];let normalChecks=0;
for(const sample of measured.records) {
  const encoded=await readFile(sample.path);assert.equal(sha(encoded),sample.sha256);
  const raw=gunzipSync(encoded),buffer=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),parsed=parseNativeEdges(buffer);
  const originalSha=sha(new Uint8Array(buffer)),t=performance.now(),cleanup=classifyNativeTissue(parsed);
  const classificationMs=performance.now()-t;
  const expected=sample.sweep.find(v=>v.maximumForegroundSamples===512&&v.inclusiveSampleBoxDiagonalLimitMm===.4&&v.guard==='thin');
  assert.equal(cleanup.stats.removedSamples,expected.removedForegroundSamples);
  assert.equal(cleanup.stats.removedComponents,expected.removedComponents);
  for(let z=0;z<129;z++)for(let y=0;y<129;y++)for(let x=0;x<129;x++)if(x===0||y===0||z===0||x===128||y===128||z===128)assert.equal(cleanup.removedSamples[(z*129+y)*129+x],0);
  let sourceTriangles=0,retainedTriangles=0,removedTriangles=0;
  for(const z of [0,64])for(const y of [0,64])for(const x of [0,64]) {
    const options={start:[x,y,z],size:64},original=meshNativeEdges(parsed,options);
    const retained=meshNativeEdges(parsed,{...options,cleanup}),removed=meshNativeEdges(parsed,{...options,cleanup,cleanupView:'removed'});
    const array=(m,key,Type,n)=>new Type(m.buffer,m[key],n);
    const oi=array(original,'indexOffset',Uint32Array,original.indexCount),ki=array(retained,'indexOffset',Uint32Array,retained.indexCount),ri=array(removed,'indexOffset',Uint32Array,removed.indexCount);
    for(const filtered of [retained,removed]){
      assert.equal(filtered.sourceTriangles,original.triangles);
      assert.deepEqual(array(filtered,'positionOffset',Uint32Array,filtered.vertexCount*3),array(original,'positionOffset',Uint32Array,original.vertexCount*3));
      const used=new Uint8Array(original.vertexCount),idx=array(filtered,'indexOffset',Uint32Array,filtered.indexCount);
      for(const v of idx)used[v]=1;
      const a=array(original,'normalOffset',Int16Array,original.vertexCount*3),b=array(filtered,'normalOffset',Int16Array,filtered.vertexCount*3);
      for(let v=0;v<used.length;v++)if(used[v])for(let k=0;k<3;k++){assert.equal(b[v*3+k],a[v*3+k]);normalChecks++;}
    }
    let k=0,r=0;
    for(let i=0;i<oi.length;i+=3){
      if(k<ki.length&&oi[i]===ki[k]&&oi[i+1]===ki[k+1]&&oi[i+2]===ki[k+2])k+=3;
      else{assert.equal(oi[i],ri[r]);assert.equal(oi[i+1],ri[r+1]);assert.equal(oi[i+2],ri[r+2]);r+=3;}
    }
    assert.equal(k,ki.length);assert.equal(r,ri.length);assert.equal(ki.length+ri.length,oi.length);
    sourceTriangles+=original.triangles;retainedTriangles+=retained.triangles;removedTriangles+=removed.triangles;
  }
  assert.equal(sha(new Uint8Array(buffer)),originalSha);
  assert.equal(sourceTriangles,sample.nativeTriangles);assert.equal(removedTriangles,expected.removedTriangles);
  const result={tile:sample.tile,sourceSha256:sample.sha256,sourceTriangles,retainedTriangles,removedTriangles,classificationMs,
    removedComponents:cleanup.stats.removedComponents,removedSamples:cleanup.stats.removedSamples,exactPositionArrays:true,
    exactReferencedNormals:true,exactFacePartition:true,outerFaceMasksUnchanged:true,sourceBytesUnchanged:true,pythonComponentAgreement:true};
  results.push(result);console.log(JSON.stringify(result));
}
const report={schema:'native-cleanup-browser-decoder-check-v22',passed:true,profile:NATIVE_CLEANUP,tiles:results,referencedNormalScalarComparisons:normalChecks,
  scope:'Node execution of the actual browser decoder/filter against checksum-verified production NBE1; not browser timing or anatomical ground truth'};
await writeFile(new URL('../docs/noise-cleanup-v22/browser-decoder-verification.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
