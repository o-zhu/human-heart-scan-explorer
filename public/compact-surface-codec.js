/** HFC1 presentation transport. Geometry is exact; shading normals use oct12.
 * Each independent block is checked and released before the next is decoded.
 * No vertices, faces, corner order, masks, sample grids or coordinates change.
 */
import { MeshoptDecoder } from './vendor/meshopt-decoder-0.23.js';

const PART_LIMIT = 8 * 1024 * 1024;
const DECODED_LIMIT = 512 * 1024 * 1024;
const hashPattern = /^[a-f0-9]{64}$/;
const integer = (value, max) => Number.isInteger(value) && value > 0 && value <= max;
const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');
// These identities are pinned to the immutable v23 geometry, independently of
// the transport manifest. A changed manifest cannot claim a matching cleanup
// source merely by copying sourceDecodedSha256 into its metadata.
const ORIGINAL_GEOMETRY = Object.freeze({
  decodedSha256: '175548ddaad01c409d59d561df6018c5cb0c90752b2ec771899c255065398dae',
  positionSha256: '9d43742c2a518e7efe05ece46e6740800472ef3d0161d52d80f95b1db448bd5e',
  indexSha256: '871fa8ec2f06c6db6ab1e9064f51f5f0fefb89e969082725e9a19f56307a21e4',
  vertexCount: 12837189, indexCount: 70856055,
});

export function validateCompactManifest(manifest) {
  if (!manifest || manifest.schema !== 'heart-compact-surface-v29' || manifest.codec !== 'hfc1-meshopt-oct12-gzip' || manifest.version !== 1) throw new Error('Unsupported compact surface transport.');
  const h = manifest.header;
  if (!Array.isArray(h) || h.length !== 8 || h.some(x => !Number.isInteger(x) || x < 0 || x > 0xffffffff) || h[0] !== 0x314d4648 || h[1] !== 1) throw new Error('Invalid compact surface header.');
  const [, , nv, ni, po, no, io] = h;
  if (!integer(nv, 30_000_000) || !integer(ni, 120_000_000) || ni % 3 || po < 32 || po % 4 || no % 4 || io % 4 || po + nv * 6 > no || no + nv * 6 > io || io + ni * 4 !== manifest.decodedBytes || !integer(manifest.decodedBytes, DECODED_LIMIT)) throw new Error('Invalid compact surface layout.');
  if (manifest.vertexCount !== nv || manifest.indexCount !== ni || manifest.positionBytesExact !== true || manifest.indexBytesExact !== true || manifest.triangleCornerOrderExact !== true || manifest.spatialResampling !== false || manifest.normalQuantization?.bitsPerCoordinate !== 12) throw new Error('Invalid compact surface fidelity declaration.');
  for (const key of ['decodedSha256', 'sourceDecodedSha256', 'positionSha256', 'indexSha256', 'shadingInputSha256', 'decodedNormalSha256']) if (!hashPattern.test(manifest[key] || '')) throw new Error('Missing compact surface identity.');
  if (manifest.sourceDecodedSha256 !== ORIGINAL_GEOMETRY.decodedSha256 || manifest.positionSha256 !== ORIGINAL_GEOMETRY.positionSha256 || manifest.indexSha256 !== ORIGINAL_GEOMETRY.indexSha256 || nv !== ORIGINAL_GEOMETRY.vertexCount || ni !== ORIGINAL_GEOMETRY.indexCount) throw new Error('Compact surface source geometry does not match.');
  if (!Array.isArray(manifest.parts) || !manifest.parts.length || manifest.parts.length > 512) throw new Error('Invalid compact surface parts.');
  const cursor = [0, 0, 0, 0], limits = [0, nv, nv, ni / 3];
  let packed = 0;
  for (const p of manifest.parts) {
    if (!p || ![1, 2, 3].includes(p.kind) || !Number.isInteger(p.start) || p.start !== cursor[p.kind] || !integer(p.count, 2097152) || p.start + p.count > limits[p.kind] || !integer(p.compressedBytes, PART_LIMIT) || !integer(p.payloadBytes, PART_LIMIT) || !hashPattern.test(p.sha256 || '') || !hashPattern.test(p.payloadSha256 || '')) throw new Error('Invalid compact surface block.');
    cursor[p.kind] += p.count;
    packed += p.compressedBytes;
  }
  if (cursor.some((value, kind) => value !== limits[kind]) || packed !== manifest.compressedBytes || packed > 256 * 1024 * 1024) throw new Error('Incomplete compact surface transport.');
  return { vertexCount: nv, indexCount: ni, positionOffset: po, normalOffset: no, indexOffset: io };
}

function gzipDecompressor() {
  try { return new DecompressionStream('gzip'); }
  catch { throw new Error('This browser cannot decompress gzip surface files.'); }
}

/** A bounded block reader, also usable without allocating a full heart mesh. */
export async function inflateCompactBlock(bytes, expectedBytes, wait = async () => {}, onProgress = () => {}) {
  if (!(bytes instanceof Uint8Array) || !integer(bytes.length, PART_LIMIT) || !integer(expectedBytes, PART_LIMIT)) throw new Error('Invalid compact surface block length.');
  if (bytes[0] !== 31 || bytes[1] !== 139) throw new Error('Invalid compact surface compression.');
  const reader = new Blob([bytes]).stream().pipeThrough(gzipDecompressor()).getReader();
  const output = new Uint8Array(expectedBytes);
  let offset = 0;
  try {
    for (;;) {
      await wait();
      const { value, done } = await reader.read();
      await wait();
      if (done) break;
      if (offset + value.length > output.length) throw new Error('Compact surface block exceeds its manifest.');
      output.set(value, offset); offset += value.length;
      onProgress(offset);
    }
    if (offset !== output.length) throw new Error('Compact surface block length did not match.');
    return output;
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}

export function decodeCompactBlock(payload, descriptor, output, layout) {
  const header = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  if (payload.length < 24 || header.getUint32(0, true) !== 0x31434648) throw new Error('Invalid compact surface block header.');
  const kind = header.getUint32(4, true), start = header.getUint32(8, true), count = header.getUint32(12, true), auxiliary = header.getUint32(16, true), bits = header.getUint32(20, true);
  if (kind !== descriptor.kind || start !== descriptor.start || count !== descriptor.count) throw new Error('Compact surface block identity did not match.');
  const body = payload.subarray(24);
  if (kind === 1) {
    if (body.length !== count * 6 || auxiliary || bits) throw new Error('Invalid compact surface positions.');
    const values = new Uint16Array(output.buffer, output.byteOffset + layout.positionOffset + start * 6, count * 3);
    const scalarCount = values.length;
    for (let i = 0; i < scalarCount; i++) values[i] = (body[i] | body[i + scalarCount] << 8) + (i < 3 ? 0 : values[i - 3]);
  } else if (kind === 2) {
    if (body.length !== count * 3 || auxiliary || bits !== 12) throw new Error('Invalid compact surface normals.');
    const values = new Int16Array(output.buffer, output.byteOffset + layout.normalOffset + start * 6, count * 3);
    for (let i = 0; i < count; i++) {
      const code = body[i] | body[i + count] << 8 | body[i + count * 2] << 16;
      if (code === 0xffffff) { values[i * 3] = values[i * 3 + 1] = values[i * 3 + 2] = 0; continue; }
      let x = ((code & 4095) - 2047) / 2047, y = ((code >>> 12) - 2047) / 2047;
      const z = 1 - Math.abs(x) - Math.abs(y);
      if (z < 0) {
        const tx = (1 - Math.abs(y)) * (x < 0 ? -1 : 1), ty = (1 - Math.abs(x)) * (y < 0 ? -1 : 1);
        x = tx; y = ty;
      }
      const factor = 32767 / Math.sqrt(x * x + y * y + z * z);
      values[i * 3] = Math.floor(x * factor + 0.5);
      values[i * 3 + 1] = Math.floor(y * factor + 0.5);
      values[i * 3 + 2] = Math.floor(z * factor + 0.5);
    }
  } else if (kind === 3) {
    if (bits || !auxiliary || auxiliary + Math.ceil(count / 4) !== body.length) throw new Error('Invalid compact surface topology.');
    const target = output.subarray(layout.indexOffset + start * 12, layout.indexOffset + (start + count) * 12);
    MeshoptDecoder.decodeIndexBuffer(target, count * 3, 4, body.subarray(0, auxiliary));
    const indices = new Uint32Array(target.buffer, target.byteOffset, count * 3);
    for (let i = 0; i < count; i++) {
      const rotation = body[auxiliary + (i >>> 2)] >>> ((i & 3) * 2) & 3;
      const a = indices[i * 3], b = indices[i * 3 + 1], c = indices[i * 3 + 2];
      if (rotation > 2 || a >= layout.vertexCount || b >= layout.vertexCount || c >= layout.vertexCount) throw new Error('Invalid compact surface triangle.');
      if (rotation === 1) { indices[i * 3] = c; indices[i * 3 + 1] = a; indices[i * 3 + 2] = b; }
      else if (rotation === 2) { indices[i * 3] = b; indices[i * 3 + 1] = c; indices[i * 3 + 2] = a; }
    }
  } else throw new Error('Unknown compact surface block.');
}

/** loadPart must perform a bounded, abortable fetch and return Uint8Array.
 * Its optional second argument reports the current block's downloaded bytes.
 * waitForWorkspace is called before download, each inflate read and decode.
 * The caller installs the returned geometry atomically, after its priority gate.
 */
export async function decodeCompactSurface(manifest, { loadPart, waitForWorkspace = async () => {}, onProgress = () => {}, hash = digest } = {}) {
  const layout = validateCompactManifest(manifest);
  if (typeof loadPart !== 'function') throw new Error('A compact surface transport is required.');
  if (hash === digest && typeof globalThis.crypto?.subtle?.digest !== 'function') throw new Error('This browser cannot securely verify surface files (SHA-256 unavailable).');
  // Fail before allocating the large decoded mesh or fetching its first part.
  // Constructor support matters as well as the global existing.
  gzipDecompressor();
  if (!MeshoptDecoder.supported) throw new Error('Compact surface decoder is unavailable.');
  try { await MeshoptDecoder.ready; }
  catch { throw new Error('Compact surface decoder could not initialize in this browser.'); }
  await waitForWorkspace();
  const output = new Uint8Array(manifest.decodedBytes);
  const header = new DataView(output.buffer);
  manifest.header.forEach((v, i) => header.setUint32(i * 4, v, true));
  let loaded = 0, verifiedParts = 0;
  // loadedBytes always refers to transport bytes, preserving existing compact
  // consumers. During inflation, decodedBytes reports the current block too.
  const progress = (phase, stage, loadedBytes = loaded, details = {}) => onProgress({
    type: 'progress', phase, stage, loadedBytes, totalBytes: manifest.compressedBytes,
    verifiedParts, totalParts: manifest.parts.length, ...details,
  });
  for (const part of manifest.parts) {
    await waitForWorkspace();
    let packed = await loadPart(part, count => progress('download', 'download', loaded + count));
    if (!(packed instanceof Uint8Array) || packed.length !== part.compressedBytes) throw new Error('Compact surface download length did not match.');
    if (await hash(packed) !== part.sha256) throw new Error('Compact surface block checksum did not match.');
    loaded += part.compressedBytes;
    verifiedParts++;
    progress('download', 'verify-part');
    const payload = await inflateCompactBlock(packed, part.payloadBytes, waitForWorkspace,
      count => progress('decode', 'inflate', loaded, { decodedBytes: count, decodedTotalBytes: part.payloadBytes }));
    packed = null;
    if (await hash(payload) !== part.payloadSha256) throw new Error('Compact surface payload checksum did not match.');
    await waitForWorkspace();
    decodeCompactBlock(payload, part, output, layout);
    progress('decode', 'decode-block');
  }
  await waitForWorkspace();
  if (await hash(output) !== manifest.decodedSha256) throw new Error('Compact surface decoded checksum did not match.');
  progress('decode', 'verify-surface', loaded, { verification: 'surface' });
  await waitForWorkspace();
  if (await hash(output.subarray(layout.positionOffset, layout.positionOffset + layout.vertexCount * 6)) !== ORIGINAL_GEOMETRY.positionSha256) throw new Error('Compact surface positions changed.');
  progress('decode', 'verify-surface', loaded, { verification: 'positions' });
  await waitForWorkspace();
  if (await hash(output.subarray(layout.indexOffset, layout.indexOffset + layout.indexCount * 4)) !== ORIGINAL_GEOMETRY.indexSha256) throw new Error('Compact surface topology changed.');
  progress('decode', 'verify-surface', loaded, { verification: 'indices' });
  await waitForWorkspace();
  return { bytes: output, ...layout, geometrySourceSha256: ORIGINAL_GEOMETRY.decodedSha256 };
}
