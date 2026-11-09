import { parseNativeEdges, meshNativeEdges } from './native-edge-format.js';
import { parseNativeMesh } from './native-mesh-format.js';
import { classifyNativeTissue } from './native-noise-filter.js';
import { filterOverviewFaces } from './overview-face-filter.js';

export const MAX_EDGE_BYTES = 5 * 1024 * 1024;
export const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;
const MAX_OVERVIEW_BYTES = 128 * 1024 * 1024;
const CACHE_BYTES = 12 * 1024 * 1024;
const CACHE_ENTRIES = 6;
const encodedCache = new Map();
let encodedBytes = 0;
let active = null;
const abortError = () => new DOMException('A newer region was selected.', 'AbortError');
const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');

export async function boundedRead(stream, limit, onProgress = () => {}) {
  const reader = stream.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('The surface payload exceeds its declared size.');
      chunks.push(value); onProgress(size);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function remember(key, value) {
  if (encodedCache.has(key)) { encodedBytes -= encodedCache.get(key).byteLength; encodedCache.delete(key); }
  if (value.byteLength > CACHE_BYTES) return;
  encodedCache.set(key, value); encodedBytes += value.byteLength;
  while (encodedBytes > CACHE_BYTES || encodedCache.size > CACHE_ENTRIES) {
    const oldest = encodedCache.keys().next().value;
    encodedBytes -= encodedCache.get(oldest).byteLength; encodedCache.delete(oldest);
  }
}
function check(job) { if (job.controller.signal.aborted || active !== job) throw abortError(); }
function progress(job, stage, loaded = 0, total = 0) { check(job); self.postMessage({ type: 'progress', id: job.id, stage, loaded, total }); }

async function verifiedBytes(record, limit, job, cache = false) {
  const size = record.bytes ?? record.compressedBytes, expected = record.decodedBytes;
  if (!Number.isSafeInteger(size) || size < 1 || size > limit || !Number.isSafeInteger(expected) || expected < 1 || expected > limit || !/^[0-9a-f]{64}$/i.test(record.sha256 || '')) {
    throw new Error('The reconstruction payload size or checksum is invalid.');
  }
  const key = `${record.url}|${record.sha256}`;
  let bytes = cache ? encodedCache.get(key) : null;
  if (bytes) { remember(key, bytes); progress(job, 'cached', size, size); }
  else {
    const response = await fetch(record.url, { signal: job.controller.signal, priority: 'high' });
    if (!response.ok || !response.body) throw new Error(`The surface download failed (${response.status}).`);
    let lastUpdate = 0;
    bytes = await boundedRead(response.body, size, loaded => {
      const now = performance.now();
      if (now - lastUpdate > 80 || loaded === size) { progress(job, 'download', loaded, size); lastUpdate = now; }
    });
    check(job);
    if (bytes.byteLength !== size || await hash(bytes) !== record.sha256.toLowerCase()) throw new Error('The compressed surface checksum did not match.');
    check(job);
    if (cache) remember(key, bytes);
  }
  progress(job, 'decode', size, size);
  let decoded = bytes;
  if (bytes[0] === 31 && bytes[1] === 139) {
    if (!globalThis.DecompressionStream) throw new Error('This browser cannot decompress the reconstruction.');
    decoded = await boundedRead(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')), expected);
  }
  check(job);
  if (decoded.byteLength !== expected) throw new Error('The decoded surface length did not match.');
  if (record.decodedSha256 && await hash(decoded) !== record.decodedSha256.toLowerCase()) throw new Error('The decoded surface checksum did not match.');
  check(job);
  return decoded;
}

async function waitForUpload(job, index) {
  check(job);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { job.ack = null; reject(new Error('The surface upload did not finish. Retry this region.')); }, 30000);
    job.ack = { index, resolve: () => { clearTimeout(timer); job.ack = null; resolve(); }, reject: error => { clearTimeout(timer); job.ack = null; reject(error); } };
  });
  check(job);
}

async function run(job) {
  const { record, kind } = job;
  if (kind === 'manifest') {
    const response = await fetch(record.url, { signal: job.controller.signal });
    if (!response.ok || !response.body) throw new Error(`Reconstruction metadata could not load (${response.status}).`);
    const bytes = await boundedRead(response.body, MAX_MANIFEST_BYTES);
    check(job);
    let manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), baseUrl = record.url;
    if (manifest.manifestUrl) {
      baseUrl = new URL(manifest.manifestUrl, record.url).href;
      const decoded = await verifiedBytes({ ...manifest, url: baseUrl }, MAX_MANIFEST_BYTES, job);
      manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decoded));
    }
    return { manifest, baseUrl };
  }
  if (kind === 'overview') {
    const parts = record.parts || [record], totalBytes = parts.reduce((sum, part) => sum + part.decodedBytes, 0);
    if (!parts.length || parts.length > 16 || !Number.isSafeInteger(totalBytes) || totalBytes > MAX_OVERVIEW_BYTES) throw new Error('The complete overview exceeds the display budget.');
    let triangles = 0, sourceTriangles=0, removedTriangles=0;
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index], bytes = await verifiedBytes(part, MAX_OVERVIEW_BYTES, job);
      let mesh = parseNativeMesh(bytes.buffer, part.decodedBytes);
      if (Number.isSafeInteger(part.triangles) && mesh.indexCount / 3 !== part.triangles) throw new Error('An overview part has an inconsistent triangle count.');
      sourceTriangles+=mesh.indexCount/3;
      if(record.overviewRepair) {
        const filter=part.faceFilter;
        if(!filter || filter.sourceSha256!==part.sha256 || (part.decodedSha256 && filter.sourceDecodedSha256!==part.decodedSha256))throw new Error('A verified display repair is unavailable for this overview.');
        progress(job,'repair',index,parts.length);
        const mask=await verifiedBytes(filter.mask,512*1024,job);
        mesh=filterOverviewFaces(mesh,mask,filter);removedTriangles+=mesh.removedTriangles;
      }
      triangles += mesh.indexCount / 3;
      const pending = waitForUpload(job, index);
      self.postMessage({ type: 'piece', id: job.id, index, total: parts.length, mesh }, [mesh.buffer]);
      await pending;
    }
    if (Number.isSafeInteger(record.triangles) && sourceTriangles !== record.triangles) throw new Error('The complete overview triangle count did not match.');
    return { pieces: parts.length, triangles, sourceTriangles, removedTriangles, overviewRepair:Boolean(record.overviewRepair) };
  }
  if (kind !== 'tile') throw new Error('Unsupported reconstruction request.');
  const bytes = await verifiedBytes(record, MAX_EDGE_BYTES, job, true);
  const parsed = parseNativeEdges(bytes.buffer);
  if (parsed.step !== 1 || parsed.nx !== 129 || parsed.ny !== 129 || parsed.nz !== 129 ||
      !record.xyz?.every((n, axis) => parsed.origin[axis] === n * 128)) throw new Error('The downloaded native block does not match the selected coordinates.');
  const cleanupView=record.cleanupView??'original';
  if(!['cleaned','original','removed'].includes(cleanupView))throw new Error('The native cleanup view is invalid.');
  let cleanup=null;
  if(cleanupView!=='original') {
    progress(job,'cleanup',0,1);
    cleanup=classifyNativeTissue(parsed);
    // Yield so a changed selection can cancel before expensive mesh work.
    await new Promise(resolve=>setTimeout(resolve,0));check(job);
  }
  let index = 0, triangles = 0, sourceTriangles=0, suppressedTriangles=0;
  for (const z of [0, 64]) for (const y of [0, 64]) for (const x of [0, 64]) {
    check(job); progress(job, 'mesh', index, 8);
    const mesh = meshNativeEdges(parsed, { start: [x,y,z], size: 64, local: false, cleanup, cleanupView:cleanupView==='removed'?'removed':'cleaned' });
    triangles += mesh.indexCount / 3;
    sourceTriangles+=mesh.sourceTriangles;suppressedTriangles+=mesh.suppressedTriangles;
    const pending = waitForUpload(job, index);
    self.postMessage({ type: 'piece', id: job.id, index, total: 8, mesh }, [mesh.buffer]);
    await pending; index++;
  }
  if (Number.isSafeInteger(record.triangles) && sourceTriangles !== record.triangles) throw new Error('Native triangle counts did not match the verified block record.');
  return { pieces: index, triangles, sourceTriangles, suppressedTriangles, cleanupView, cleanup:cleanup?.stats??null,
    originXYZ: parsed.origin, cacheBytes: encodedBytes, cacheEntries: encodedCache.size };
}

if (typeof self !== 'undefined') self.onmessage = ({ data }) => {
  if (data.type === 'ack') { if (active?.id === data.id && active.ack?.index === data.index) active.ack.resolve(); return; }
  if (data.type === 'cancel') {
    if (active?.id === data.id) { active.controller.abort(); active.ack?.reject(abortError()); }
    return;
  }
  if (data.type !== 'load') return;
  if (active) { self.postMessage({ type: 'done', id: data.id, error: 'Another surface request is still active.' }); return; }
  const job = { ...data, controller: new AbortController(), ack: null };
  active = job;
  run(job).then(result => {
    check(job); active = null; self.postMessage({ type: 'done', id: job.id, result });
  }).catch(error => {
    if (active === job) active = null;
    job.ack?.reject(error);
    self.postMessage({ type: 'done', id: job.id, error: error.message || 'The native region could not load.', aborted: error.name === 'AbortError' });
  });
};
