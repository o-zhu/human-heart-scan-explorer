/** Native ROI mesh layout. Decoding never changes positions or connectivity. */
export const MAX_NATIVE_MESH_BYTES = 192 * 1024 * 1024;

export function parseNativeMesh(buffer, expectedBytes) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 32 || buffer.byteLength > MAX_NATIVE_MESH_BYTES) throw new Error('Native surface exceeds the supported memory budget.');
  if (expectedBytes && buffer.byteLength !== expectedBytes) throw new Error('Native surface length did not match.');
  const d = new DataView(buffer);
  if (d.getUint32(0, true) !== 0x314d4648 || d.getUint32(4, true) !== 1) throw new Error('Unsupported native surface format.');
  const vertexCount = d.getUint32(8, true), indexCount = d.getUint32(12, true);
  const positionOffset = d.getUint32(16, true), normalOffset = d.getUint32(20, true), indexOffset = d.getUint32(24, true), flags = d.getUint32(28, true);
  if (flags > 1) throw new Error('Unsupported native surface position encoding.');
  const positionBytes = flags === 1 ? 12 : 6;
  if (!vertexCount || !indexCount || indexCount % 3 || positionOffset !== 32 || normalOffset % 4 || indexOffset % 4 || positionOffset + vertexCount * positionBytes > normalOffset || normalOffset + vertexCount * 6 > indexOffset || indexOffset + indexCount * 4 !== buffer.byteLength) throw new Error('Invalid native surface layout.');
  const indices = new Uint32Array(buffer, indexOffset, indexCount);
  for (let i = 0; i < indices.length; i++) if (indices[i] >= vertexCount) throw new Error('Invalid native surface index.');
  if (flags === 1) {
    const positions = new Float32Array(buffer, positionOffset, vertexCount * 3);
    for (let i = 0; i < positions.length; i++) if (!Number.isFinite(positions[i])) throw new Error('Invalid native surface position.');
  }
  return { buffer, vertexCount, indexCount, positionOffset, normalOffset, indexOffset, positionBytes, positionFormat: flags === 1 ? 'float32' : 'uint16' };
}
