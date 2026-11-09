/** Verified prepared scalar data. No renderer, source array or view mutation. */
export const CORONARY_LIMITS = Object.freeze({
 manifestBytes: 128 * 1024,
 decodedBytes: 300 * 1024 * 1024,
 compressedBytes: 301 * 1024 * 1024,
 partBytes: 4 * 1024 * 1024,
 parts: 256,
});

const MANIFEST_URL = './assets/coronary-v36/manifest.json';
const PART_URL = /^\.\/assets\/coronary-v36\/[A-Za-z0-9][A-Za-z0-9._-]{0,190}\.raw\.part-\d{3,4}\.gz$/;
const HASH = /^[a-f0-9]{64}$/;
const DONORS = new Set(['ladaf-2021-17', 's-20-29', 's-20-28']);
const size = (value, maximum) => Number.isSafeInteger(value) && value > 0 && value <= maximum;
const triple = (value, check) => Array.isArray(value) && value.length === 3 && value.every(check);
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const spacing = value => positive(value) || triple(value, positive);
const abortError = () => new DOMException('Coronary preparation was cancelled.', 'AbortError');
const freeze = value => {
 if (value && typeof value === 'object' && !Object.isFrozen(value)) {
  for (const item of Object.values(value)) freeze(item);
  Object.freeze(value);
 }
 return value;
};

/** Validate again in the worker before allocating any large data array. */
export function validateCoronaryProfile(profile, donorId) {
 if (!DONORS.has(donorId) || !profile || typeof profile !== 'object' || Array.isArray(profile) ||
  (profile.donorId !== undefined && profile.donorId !== donorId)) throw new Error('Coronary donor identity did not match.');
 const dimensions = profile.dimensions;
 if (!triple(dimensions, value => Number.isSafeInteger(value) && value >= 2 && value <= CORONARY_LIMITS.decodedBytes) ||
  !spacing(profile.spacingUm) || !spacing(profile.sourceSpacingUm)) throw new Error('Invalid coronary source sampling.');
 const decoded = dimensions.reduce((a, b) => a * b, 1);
 if (!size(decoded, CORONARY_LIMITS.decodedBytes) || profile.uncompressedBytes !== decoded) throw new Error('Invalid coronary decoded length.');
 const axisSpacing = Array.isArray(profile.spacingUm) ? profile.spacingUm : [profile.spacingUm, profile.spacingUm, profile.spacingUm];
 const physical = dimensions.map((value, axis) => (value - 1) * axisSpacing[axis]), longest = Math.max(...physical);
 const extent = [physical[0] / longest, physical[2] / longest, physical[1] / longest];
 if (!triple(profile.extent, positive) || !Number.isFinite(longest) ||
  extent.some((value, axis) => Math.abs(value - profile.extent[axis]) > 1e-6)) throw new Error('Coronary coordinate extent did not match its source grid.');
 if (typeof profile.threshold !== 'number' || !Number.isFinite(profile.threshold) || profile.threshold < 0 || profile.threshold > 1 ||
  !Array.isArray(profile.sourceWindow) || profile.sourceWindow.length !== 2 ||
  !profile.sourceWindow.every(value => typeof value === 'number' && Number.isFinite(value)) || profile.sourceWindow[0] >= profile.sourceWindow[1]) throw new Error('Invalid coronary intensity provenance.');
 if (!(typeof profile.processing === 'string' && profile.processing.trim()) &&
  !(profile.processing && typeof profile.processing === 'object' && !Array.isArray(profile.processing) && Object.keys(profile.processing).length)) throw new Error('Coronary processing provenance is missing.');
 if (!HASH.test(profile.rawSha256 || '') || !size(profile.compressedBytes, CORONARY_LIMITS.compressedBytes) ||
  !Array.isArray(profile.parts) || !profile.parts.length || profile.parts.length > CORONARY_LIMITS.parts) throw new Error('Invalid coronary transport manifest.');
 const plane = dimensions[0] * dimensions[1], seen = new Set(); let packed = 0, raw = 0;
 for (const part of profile.parts) {
  if (!part || typeof part !== 'object' || typeof part.url !== 'string' || !PART_URL.test(part.url) || seen.has(part.url) ||
   !size(part.compressedBytes, CORONARY_LIMITS.partBytes) || !size(part.uncompressedBytes, decoded) || part.uncompressedBytes % plane !== 0 ||
   !HASH.test(part.sha256 || '') || !HASH.test(part.rawSha256 || '') || !['none', 'delta-x', 'delta-z'].includes(part.predictor)) throw new Error('Invalid coronary transport part.');
  seen.add(part.url); packed += part.compressedBytes; raw += part.uncompressedBytes;
  if (packed > CORONARY_LIMITS.compressedBytes || raw > decoded) throw new Error('Coronary transport exceeds its declared size.');
 }
 if (packed !== profile.compressedBytes || raw !== decoded) throw new Error('Coronary transport lengths did not match.');
 return profile;
}

export function validateCoronaryManifest(manifest, donorId) {
 if (!manifest || manifest.schemaVersion !== 1 || manifest.kind !== 'coronary-reveal' ||
  !manifest.donors || typeof manifest.donors !== 'object' || Array.isArray(manifest.donors) || !Object.hasOwn(manifest.donors, donorId)) throw new Error('Unsupported coronary manifest or donor.');
 return validateCoronaryProfile(manifest.donors[donorId], donorId);
}

/** Stream into an exact-sized destination. Never accept a truncated or longer field. */
export async function readCoronaryExact(stream, target, offset, length, onProgress, signal) {
 if (!stream?.getReader) throw new Error('Streaming coronary loading is unavailable.');
 const reader = stream.getReader(); let used = 0;
 const cancelled = () => { void reader.cancel(abortError()).catch(() => {}); };
 signal?.addEventListener('abort', cancelled, {once: true});
 try {
  for (;;) {
   if (signal?.aborted) throw abortError();
   const item = await reader.read();
   if (signal?.aborted) throw abortError();
   if (item.done) break;
   if (!(item.value instanceof Uint8Array) || used + item.value.byteLength > length) throw new Error('Coronary data exceeds its declared length.');
   target.set(item.value, offset + used); used += item.value.byteLength; onProgress?.(used);
  }
  if (used !== length) throw new Error('Coronary data length did not match.');
 } catch (error) { await reader.cancel().catch(() => {}); throw error; }
 finally { signal?.removeEventListener('abort', cancelled); reader.releaseLock(); }
}

async function readManifest(response, signal) {
 if (!response?.ok) throw new Error(`Coronary manifest could not load (${response?.status || 'network'}).`);
 const header = response.headers?.get('content-length');
 if (header !== null && header !== undefined && Number(header) > CORONARY_LIMITS.manifestBytes) throw new Error('Coronary manifest exceeds the supported size.');
 if (!response.body?.getReader) throw new Error('Streaming coronary manifest loading is unavailable.');
 const reader = response.body.getReader(), chunks = []; let length = 0;
 const cancelled = () => { void reader.cancel(abortError()).catch(() => {}); };
 signal.addEventListener('abort', cancelled, {once: true});
 try {
  for (;;) {
   if (signal.aborted) throw abortError();
   const item = await reader.read(); if (signal.aborted) throw abortError(); if (item.done) break;
   if (!(item.value instanceof Uint8Array) || length + item.value.byteLength > CORONARY_LIMITS.manifestBytes) throw new Error('Coronary manifest exceeds the supported size.');
   length += item.value.byteLength; chunks.push(item.value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
 } catch (error) { await reader.cancel().catch(() => {}); throw error; }
 finally { signal.removeEventListener('abort', cancelled); reader.releaseLock(); }
}

export class CoronaryDataSource {
 constructor({donorId, fetchImpl = (...args) => globalThis.fetch(...args), WorkerClass = globalThis.Worker} = {}) {
  if (!DONORS.has(donorId)) throw new Error('This donor has no supported coronary source.');
  this.donorId = donorId; this.fetchImpl = fetchImpl; this.WorkerClass = WorkerClass;
  this.sequence = 0; this.operation = null; this.cached = null;
 }

 cancel() { ++this.sequence; this.operation?.cancel(); this.operation = null; }

 prepare({signal, onProgress = () => {}, donorId = this.donorId} = {}) {
  if (donorId !== this.donorId) return Promise.reject(new Error('Coronary donor identity did not match.'));
  if (signal?.aborted) return Promise.reject(abortError());
  this.cancel();
  if (this.cached && this.cached.data.byteLength === this.cached.meta.uncompressedBytes) return Promise.resolve(this.cached);
  if (typeof this.WorkerClass !== 'function') return Promise.reject(new Error('This browser cannot prepare the coronary surface.'));
  const sequence = this.sequence, internal = new AbortController(); let worker, finished = false;
  return new Promise((resolve, reject) => {
   const cleanup = () => {
    signal?.removeEventListener('abort', cancelled); worker?.terminate(); worker = null;
    if (this.operation === operation) this.operation = null;
   };
   const fail = error => { if (!finished) { finished = true; cleanup(); reject(error); } };
   const cancelled = () => { internal.abort(); fail(abortError()); };
   const operation = {cancel: cancelled}; this.operation = operation;
   signal?.addEventListener('abort', cancelled, {once: true});
   if (signal?.aborted) { cancelled(); return; }
   const current = () => !finished && !internal.signal.aborted && sequence === this.sequence;
   const progress = value => { if (current()) { try { onProgress(value); } catch { /* UI callbacks cannot corrupt a verified load. */ } } };
   void (async () => {
    try {
     // Calling as a global method (also for an injected native fetch) preserves
     // Safari's required Window receiver.
     const response = await this.fetchImpl.call(globalThis, MANIFEST_URL, {signal: internal.signal, cache: 'no-cache', redirect: 'error'});
     if (!current()) return;
     const manifest = await readManifest(response, internal.signal); if (!current()) return;
     const profile = validateCoronaryManifest(manifest, this.donorId);
     const meta = freeze({...structuredClone(profile), donorId: this.donorId});
     progress({loaded: 0, total: profile.compressedBytes});
     worker = new this.WorkerClass(new URL('./coronary-worker.js', import.meta.url), {type: 'module'});
     worker.onmessage = event => {
      if (!current()) return;
      const message = event.data;
      if (message?.type === 'progress') {
       const loaded = Math.max(0, Math.min(meta.compressedBytes, Number(message.loaded) || 0));
       progress({loaded, total: meta.compressedBytes, ...(typeof message.message === 'string' ? {message: message.message.slice(0, 180)} : {})}); return;
      }
      if (message?.type === 'error') { fail(new Error(message.message || 'The coronary surface could not be prepared.')); return; }
      if (message?.type !== 'ready' || message.donorId !== this.donorId || message.rawSha256 !== meta.rawSha256 ||
       !(message.data instanceof ArrayBuffer) || message.data.byteLength !== meta.uncompressedBytes) {
       fail(new Error('Prepared coronary data identity or length did not match.')); return;
      }
      const prepared = Object.freeze({data: new Uint8Array(message.data), meta});
      this.cached = prepared; finished = true; cleanup(); resolve(prepared);
     };
     worker.onerror = event => fail(new Error(event.message || 'The coronary preparation worker could not start.'));
     worker.onmessageerror = () => fail(new Error('The prepared coronary data could not be received.'));
     worker.postMessage({type: 'prepare', donorId: this.donorId, profile: meta, baseUrl: new URL('./', import.meta.url).href});
    } catch (error) { if (current()) fail(error); }
   })();
  });
 }

 dispose() { this.cancel(); this.cached = null; }
}
