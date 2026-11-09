/** One persistent worker, one active job, and at most one pending request per view. */
const abortError = () => new DOMException('A newer region was selected.', 'AbortError');
export const NATIVE_DIMENSIONS = [7614, 7614, 8480];
export const NATIVE_SPACING_UM = 19.85;
export const NATIVE_BLOCK_CELLS = 128;

export function nativeToWorld(xyz) {
  return [(xyz[0] - 7613 / 2) / 8479, (xyz[2] - 8479 / 2) / 8479, -(xyz[1] - 7613 / 2) / 8479];
}

export function selectAvailableTile(tiles, nativeXYZ) {
  if (!Array.isArray(nativeXYZ) || nativeXYZ.length !== 3 || nativeXYZ.some((n, axis) => !Number.isFinite(n) || n < 0 || n > NATIVE_DIMENSIONS[axis] - 1)) {
    throw new Error('Enter X, Y and Z coordinates inside the original scan.');
  }
  if (!tiles.length) throw new Error('This reconstruction does not contain an available native surface block.');
  const requestedBlock = nativeXYZ.map(n => Math.floor(n / NATIVE_BLOCK_CELLS));
  let tile = tiles.find(item => item.xyz.every((n, axis) => n === requestedBlock[axis]));
  const exact = Boolean(tile);
  let distanceSquared = 0;
  if (!tile) {
    distanceSquared = Infinity;
    for (const candidate of tiles) {
      const squared = candidate.xyz.reduce((sum, n, axis) => sum + (n * 128 + 64 - nativeXYZ[axis]) ** 2, 0);
      if (squared < distanceSquared) { distanceSquared = squared; tile = candidate; }
    }
  }
  return { tile, exact, requestedXYZ: nativeXYZ.slice(), requestedBlock, distanceMm: Math.sqrt(distanceSquared) * NATIVE_SPACING_UM / 1000 };
}

export function validateGuidedManifest(value, baseUrl) {
  if (!value || typeof value.schema !== 'string' || typeof value.complete !== 'boolean' || value.sourceSpacingUm !== NATIVE_SPACING_UM ||
      !Array.isArray(value.dimensionsXYZ) || !NATIVE_DIMENSIONS.every((n, i) => n === value.dimensionsXYZ[i]) ||
      !Array.isArray(value.tiles) || value.tiles.length > 250000) throw new Error('Whole-heart reconstruction metadata is incompatible.');
  const safeUrl = value => {
    if (typeof value !== 'string' || !value.length || value.length > 4096) throw new Error('A reconstruction URL is invalid.');
    const url = new URL(value, baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('A reconstruction URL is unsupported.');
    return url.href;
  };
  const validHash = value => typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
  const seen = new Set();
  const tiles = value.tiles.map(record => {
    const key = record.xyz?.join('_');
    if (!Array.isArray(record.xyz) || record.xyz.length !== 3 || record.xyz.some((n, i) => !Number.isSafeInteger(n) || n < 0 || n * 128 + 128 >= NATIVE_DIMENSIONS[i]) ||
        seen.has(key) || !validHash(record.sha256) || !Number.isSafeInteger(record.bytes) || record.bytes < 1 || record.bytes > 5 * 1024 * 1024 ||
        !Number.isSafeInteger(record.decodedBytes) || record.decodedBytes < 64 || record.decodedBytes > 5 * 1024 * 1024 ||
        !Number.isSafeInteger(record.triangles) || record.triangles < 0) throw new Error('A native block record is invalid or duplicated.');
    seen.add(key);
    return { ...record, key, url: safeUrl(record.url), sha256: record.sha256.toLowerCase() };
  });
  let overview = null;
  if (value.overview) {
    const parts = value.overview.parts || [value.overview];
    if (!Array.isArray(parts) || !parts.length || parts.length > 16) throw new Error('The overview part list is invalid.');
    const normalized = parts.map(part => {
      const size = part.compressedBytes ?? part.bytes;
      if (!validHash(part.sha256) || !Number.isSafeInteger(size) || size < 1 || size > 128*1024*1024 ||
          !Number.isSafeInteger(part.decodedBytes) || part.decodedBytes < 32 || part.decodedBytes > 128*1024*1024) throw new Error('The overview record is invalid.');
      return { ...part, url: safeUrl(part.url), bounds: part.bounds || value.overview.bounds };
    });
    if (normalized.reduce((sum, part) => sum + part.decodedBytes, 0) > 128*1024*1024) throw new Error('The overview exceeds the supported display budget.');
    overview = { ...value.overview, parts: normalized };
  }
  const coverage = value.coverage || {};
  for (const key of ['plannedBlocks', 'completedBlocks', 'nativeOnlyEdgeVertices', 'blendedEdgeVertices', 'priorOnlyEdgeVertices']) {
    if (coverage[key] !== undefined && (!Number.isSafeInteger(coverage[key]) || coverage[key] < 0)) throw new Error('Reconstruction coverage counts are invalid.');
  }
  if (coverage.plannedBlocks !== undefined && coverage.completedBlocks > coverage.plannedBlocks) throw new Error('Completed coverage exceeds the planned region.');
  if (value.complete && Number.isSafeInteger(coverage.plannedBlocks) && Number.isSafeInteger(coverage.completedBlocks) && coverage.completedBlocks !== coverage.plannedBlocks) throw new Error('The completion flag does not match reconstruction coverage.');
  return { ...value, tiles, overview, coverage };
}

export class NativeEdgeLoader {
  constructor({ createWorker = () => new Worker(new URL('./native-edge-worker.js', import.meta.url), { type: 'module' }), baseUrl = globalThis.location?.href } = {}) {
    this.createWorker = createWorker; this.baseUrl = baseUrl; this.worker = null;
    this.active = null; this.pending = new Map(); this.sequence = 0; this.disposed = false;
  }
  loadManifest(url, onProgress) { return this.request('manifest', 'manifest', { url: new URL(url, this.baseUrl).href }, { onProgress }); }
  loadOverview(record, callbacks = {}) { return this.request('overview', 'overview', record, callbacks); }
  loadTile(record, callbacks = {}) { return this.request('detail', 'tile', record, callbacks); }
  request(channel, kind, record, callbacks = {}) {
    this.cancel(channel);
    if (this.disposed) return Promise.reject(new Error('The native region loader is closed.'));
    return new Promise((resolve, reject) => {
      this.pending.set(channel, { id: ++this.sequence, channel, kind, record, ...callbacks, resolve, reject });
      this.pump();
    });
  }
  cancel(channel) {
    const queued = this.pending.get(channel);
    if (queued) { this.pending.delete(channel); queued.reject(abortError()); }
    if (this.active?.channel === channel && !this.active.cancelled) {
      this.active.cancelled = true; this.active.reject(abortError());
      this.worker?.postMessage({ type: 'cancel', id: this.active.id });
    }
  }
  pump() {
    if (this.disposed || this.active || !this.pending.size) return;
    const [channel, item] = this.pending.entries().next().value;
    this.pending.delete(channel); this.active = item;
    try {
      if (!this.worker) {
        this.worker = this.createWorker();
        const worker = this.worker;
        this.worker.onmessage = event => { if (this.worker === worker) this.message(event.data); };
        this.worker.onerror = () => {
          if (this.worker !== worker) return;
          this.worker?.terminate(); this.worker = null;
          this.finish(new Error('The native surface worker stopped. Retry the region.'));
        };
      }
      const record = { ...item.record };
      if (record.url) record.url = new URL(record.url, this.baseUrl).href;
      if (record.parts) record.parts = record.parts.map(part => ({ ...part, url: new URL(part.url, this.baseUrl).href }));
      this.worker.postMessage({ type: 'load', id: item.id, kind: item.kind, record });
    } catch (error) { this.finish(new Error(`The surface request could not start: ${error.message}`)); }
  }
  async message(data) {
    const item = this.active;
    if (!item || data.id !== item.id) return;
    if (data.type === 'done') { this.finish(data.error ? Object.assign(new Error(data.error), { name: data.aborted ? 'AbortError' : 'Error' }) : null, data.result); return; }
    if (item.cancelled) return;
    try {
      if (data.type === 'progress') item.onProgress?.(data);
      if (data.type === 'piece') {
        await item.onPiece?.(data.mesh, data.index, data.total);
        if (this.active === item && !item.cancelled) this.worker.postMessage({ type: 'ack', id: item.id, index: data.index });
      }
    } catch (error) {
      item.cancelled = true; item.reject(error); this.worker?.postMessage({ type: 'cancel', id: item.id });
    }
  }
  finish(error, result) {
    const item = this.active;
    if (!item) return;
    this.active = null;
    if (!item.cancelled) error ? item.reject(error) : item.resolve(result);
    this.pump();
  }
  dispose() {
    this.disposed = true;
    for (const item of this.pending.values()) item.reject(abortError());
    this.pending.clear();
    if (this.active && !this.active.cancelled) this.active.reject(abortError());
    this.active = null; this.worker?.terminate(); this.worker = null;
  }
}
