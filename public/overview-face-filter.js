/** Select original HFM faces using a checksum-pinned, offline-audited mask.
 * A display-overlap repair only; it does not classify native tissue or restore
 * thin anatomy already lost during the earlier overview simplification.
 */
export function filterOverviewFaces(mesh, mask, specification) {
  if (!(mask instanceof Uint8Array) || specification.bitOrder!=='little' || specification.bit1!=='retain' ||
      !Number.isSafeInteger(specification.originalTriangles) || specification.originalTriangles!==mesh.indexCount/3 ||
      !Number.isSafeInteger(specification.retainedTriangles) || specification.retainedTriangles<0 || specification.retainedTriangles>specification.originalTriangles ||
      specification.removedTriangles!==specification.originalTriangles-specification.retainedTriangles ||
      mask.length!==Math.ceil(specification.originalTriangles/8)) throw new Error('The display repair mask does not match this overview.');
  const total=specification.originalTriangles,source=new Uint32Array(mesh.buffer,mesh.indexOffset,mesh.indexCount);
  let count=0;
  for(let i=0;i<total;i++)count+=(mask[i>>3]>>(i&7))&1;
  for(let i=total;i<mask.length*8;i++)if((mask[i>>3]>>(i&7))&1)throw new Error('The display repair mask has nonzero padding.');
  if(count!==specification.retainedTriangles)throw new Error('The display repair face count did not match its evidence.');
  const buffer=new ArrayBuffer(mesh.indexOffset+count*12);
  new Uint8Array(buffer,0,mesh.indexOffset).set(new Uint8Array(mesh.buffer,0,mesh.indexOffset));
  new DataView(buffer).setUint32(12,count*3,true);
  const target=new Uint32Array(buffer,mesh.indexOffset,count*3);let cursor=0;
  for(let i=0;i<total;i++)if((mask[i>>3]>>(i&7))&1){target[cursor++]=source[i*3];target[cursor++]=source[i*3+1];target[cursor++]=source[i*3+2];}
  return {...mesh,buffer,indexCount:count*3,sourceTriangles:total,removedTriangles:total-count};
}
