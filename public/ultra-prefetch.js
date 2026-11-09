/** Shared image transport, bounded RAM and resumable persistent Ultra storage. */
const MIB = 1024 * 1024;
// Reuse the v6 cache so an upgrade retains already downloaded source images.
const CACHE_NAME = 'heart-ladaf-hosted-ultra-v6';
const abortError = () => new DOMException('This scan request is no longer needed.', 'AbortError');
const checkAbort = signal => { if (signal?.aborted) throw abortError(); };
const safely = (callback, value) => { try { callback?.(value); } catch { /* A UI listener cannot strand a transfer. */ } };

/** Only encoded WebP blobs are retained on disk; the collection is never decoded en masse. */
export class EncodedSectionCache {
  constructor({memoryLimit = 12 * MIB, diskLimit = 640 * MIB,
               cacheStorage = globalThis.caches, storageManager = globalThis.navigator?.storage,
               cacheName = CACHE_NAME, onStats = () => {}} = {}) {
    this.memoryLimit = memoryLimit; this.diskLimit = diskLimit; this.baseDiskLimit = diskLimit;
    this.cacheStorage = cacheStorage; this.storageManager = storageManager; this.onStats = onStats;
    this.cacheName = cacheName; this.backgroundEnabled = true; this.backgroundWaiters = new Set();
    this.memory = new Map(); this.memoryBytes = 0;
    this.diskEntries = new Map(); this.diskBytes = 0;
    this.writes = new Map(); this.writeBytes = 0; this.expected = new Map();
    this.diskDisabled = !cacheStorage || diskLimit <= 0; this.writeBlockedReason = null;
    this.entryRevision = new Map(); this.revision = 0;
  }
  stats() {
    return {encodedBytes:this.memoryBytes, persistentBytes:this.diskBytes,
      persistentAvailable:!this.diskDisabled, persistentLimit:this.diskLimit,
      persistentWriteBlockedReason:this.writeBlockedReason};
  }
  notify(extra = {}) { safely(this.onStats, {...this.stats(),...extra}); }
  async storage() {
    if (this.diskDisabled) return null;
    if (!this.opening) this.opening = this.cacheStorage.open(this.cacheName).catch(() => {
      this.diskDisabled = true; this.notify(); return null;
    });
    return this.opening;
  }
  setBackgroundEnabled(enabled) {
    this.backgroundEnabled = Boolean(enabled);
    if (enabled) { for (const resolve of this.backgroundWaiters) resolve(); this.backgroundWaiters.clear(); }
  }
  async backgroundTurn() {
    while (!this.backgroundEnabled && !this.disposed)
      await new Promise(resolve => this.backgroundWaiters.add(resolve));
    if (this.disposed) throw abortError();
  }
  setDiskEntry(url, size) {
    const previous = this.diskEntries.get(url) || 0;
    this.diskEntries.delete(url); this.diskEntries.set(url, size); this.diskBytes += size - previous;
    this.entryRevision.set(url, ++this.revision);
  }
  async inventory() {
    if (this.inventoryTask) return this.inventoryTask;
    this.inventoryTask = (async () => {
      await this.backgroundTurn();
      const storage = await this.storage();
      if (!storage) return null;
      const entries = [], revision = this.revision; let scanned = 0;
      for (const request of await storage.keys()) {
        // Immutable, versioned manifest URLs already declare their byte lengths.
        // Cache.put is atomic; do not open >1,000 response bodies just to resume.
        // A selected read still checks the actual blob size before decoding it.
        if (scanned++ % 32 === 0) {
          await this.backgroundTurn();
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        const expectedSize = this.expected.get(request.url);
        if (expectedSize > 0 && expectedSize <= this.diskLimit) {
          entries.push({url:request.url,size:expectedSize,touched:0}); continue;
        }
        const response = await storage.match(request);
        const size = Number(response?.headers.get('x-heart-cache-bytes'));
        const touched = Number(response?.headers.get('x-heart-cache-touched')) || 0;
        if (!(size > 0) || size > this.diskLimit || (expectedSize != null && size !== expectedSize)) {
          if ((this.entryRevision.get(request.url) || 0) <= revision) await storage.delete(request);
          continue;
        }
        entries.push({url:request.url,size,touched});
      }
      entries.sort((a,b) => a.touched-b.touched);
      // Foreground reads/writes may complete during the inventory. Keep those
      // newer entries rather than clearing them when this optional scan finishes.
      for (const entry of entries) if ((this.entryRevision.get(entry.url) || 0) <= revision)
        this.setDiskEntry(entry.url, entry.size);
      await this.prune(storage,0); this.notify(); return storage;
    })().catch(error => { if (error.name !== 'AbortError') { this.diskDisabled = true; this.notify(); } return null; });
    return this.inventoryTask;
  }
  async prune(storage, additionalBytes) {
    for (const [url,size] of this.diskEntries) {
      if (this.diskBytes + additionalBytes <= this.diskLimit) break;
      // A prepared collection must not evict its beginning while downloading its end.
      if (this.expected.has(url)) continue;
      await storage.delete(url); this.diskEntries.delete(url); this.diskBytes -= size;
      this.entryRevision.set(url, ++this.revision);
    }
    return this.diskBytes + additionalBytes <= this.diskLimit;
  }
  async configureCollection(entries, {retry = false} = {}) {
    this.expected = new Map(entries.map(entry => [entry.url,entry.bytes]));
    const totalBytes = [...this.expected.values()].reduce((sum,size) => sum+size,0);
    // The declared budget accommodates this exact manifest plus cache metadata/headroom.
    this.diskLimit = Math.max(this.baseDiskLimit,totalBytes + 32 * MIB);
    if (retry) {
      this.writeBlockedReason = null;
      if (this.cacheStorage && this.baseDiskLimit > 0 && this.diskDisabled) {
        this.diskDisabled = false; this.opening = null; this.inventoryTask = null;
      }
    }
    await this.inventory();
    const persistedUrls = [...this.expected.keys()].filter(url => this.diskEntries.get(url) === this.expected.get(url));
    const completedBytes = persistedUrls.reduce((sum,url) => sum+this.expected.get(url),0);
    let availableBytes = null, storageReason = this.diskDisabled ? 'storage-unavailable' : this.writeBlockedReason;
    if (!storageReason && totalBytes > completedBytes && this.storageManager?.estimate) {
      try {
        const estimate = await this.storageManager.estimate();
        if (Number.isFinite(estimate.quota) && Number.isFinite(estimate.usage)) {
          availableBytes = Math.max(0,estimate.quota-estimate.usage);
          if (availableBytes < totalBytes-completedBytes+8*MIB) storageReason = 'quota';
        }
      } catch { /* A missing estimate is not a write failure; quota is still enforced by Cache.put. */ }
    }
    return {...this.stats(),persistedUrls,totalBytes,completedBytes,
      requiredBytes:Math.max(0,totalBytes-completedBytes),availableBytes,storageReason};
  }
  remember(url, blob) {
    if (this.memory.has(url)) this.memoryBytes -= this.memory.get(url).size;
    this.memory.delete(url);
    if (blob.size <= this.memoryLimit) { this.memory.set(url,blob); this.memoryBytes += blob.size; }
    while (this.memoryBytes > this.memoryLimit) {
      const [oldest,image] = this.memory.entries().next().value;
      this.memory.delete(oldest); this.memoryBytes -= image.size;
    }
    this.notify();
  }
  async invalidate(url) {
    if (this.memory.has(url)) { this.memoryBytes -= this.memory.get(url).size; this.memory.delete(url); }
    const storage = await this.storage(); await storage?.delete(url);
    if (this.diskEntries.has(url)) { this.diskBytes -= this.diskEntries.get(url); this.diskEntries.delete(url); }
    this.entryRevision.set(url, ++this.revision);
    this.notify({invalidatedUrl:url});
  }
  async get(url, signal) {
    checkAbort(signal);
    if (this.memory.has(url)) {
      const blob = this.memory.get(url); this.memory.delete(url); this.memory.set(url,blob);
      return {blob,cache:'encoded-memory'};
    }
    try {
      const storage = await this.storage(); checkAbort(signal);
      const response = await storage?.match(url); checkAbort(signal);
      if (!response) {
        if (this.diskEntries.has(url)) {
          this.diskBytes -= this.diskEntries.get(url); this.diskEntries.delete(url); this.notify({invalidatedUrl:url});
        }
        this.entryRevision.set(url, ++this.revision);
        return null;
      }
      const blob = await response.blob(); checkAbort(signal);
      if (this.expected.has(url) && blob.size !== this.expected.get(url)) { await this.invalidate(url); return null; }
      this.remember(url,blob);
      this.setDiskEntry(url, blob.size);
      return {blob,cache:'persistent'};
    } catch (error) { if (error.name === 'AbortError') throw error; return null; }
  }
  put(url, blob) {
    this.remember(url,blob);
    if (this.diskDisabled || this.writeBlockedReason || blob.size > this.diskLimit) return Promise.resolve(false);
    if (this.diskEntries.get(url) === blob.size) return Promise.resolve(true);
    if (this.writing?.url === url) return this.writing.promise;
    if (this.writes.has(url)) return this.writes.get(url).promise;
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    const job = {url,blob,promise,resolve}; this.writes.set(url,job); this.writeBytes += blob.size;
    // Pending optional writes have a separate RAM bound. The collection awaits
    // each commit, so it cannot outpace this queue or report uncommitted progress.
    while (this.writeBytes > Math.min(16*MIB,this.diskLimit)) {
      const [oldest,entry] = this.writes.entries().next().value;
      this.writes.delete(oldest); this.writeBytes -= entry.blob.size; entry.resolve(false);
    }
    void this.drain(); return promise;
  }
  async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      // Persisting a requested image must not wait for a full-bank inventory.
      const storage = await this.storage();
      if (!storage || this.diskDisabled) return;
      while (this.writes.size && !this.diskDisabled && !this.writeBlockedReason) {
        const [url,job] = this.writes.entries().next().value;
        this.writes.delete(url); this.writeBytes -= job.blob.size; this.writing = job;
        try {
          const previous = this.diskEntries.get(url) || 0;
          if (!await this.prune(storage,Math.max(0,job.blob.size-previous))) {
            this.writeBlockedReason = 'quota'; job.resolve(false); continue;
          }
          await storage.put(url,new Response(job.blob,{headers:{'Content-Type':'image/webp',
            'x-heart-cache-bytes':String(job.blob.size),'x-heart-cache-touched':String(Date.now())}}));
          this.setDiskEntry(url, job.blob.size);
          job.resolve(true); this.notify({persistedUrl:url,persistedSize:job.blob.size});
        } catch (error) {
          this.writeBlockedReason = error.name === 'QuotaExceededError' ? 'quota' : 'storage-unavailable';
          job.resolve(false);
        } finally { this.writing = null; }
      }
    } catch { this.writeBlockedReason = 'storage-unavailable'; }
    finally {
      this.draining = false;
      if (this.diskDisabled || this.writeBlockedReason) {
        for (const job of this.writes.values()) job.resolve(false);
        this.writes.clear(); this.writeBytes = 0; this.notify();
      } else if (this.writes.size) void this.drain();
    }
  }
  dispose() {
    this.disposed = true; this.setBackgroundEnabled(true);
    for (const job of this.writes.values()) job.resolve(false);
    this.writes.clear(); this.writeBytes = 0;
  }
}

/** Reuse one bounded readback surface instead of reallocating it on every wheel step. */
export class SectionImageDecoder {
  constructor({surfaceLimit = 16 * MIB} = {}) { this.surfaceLimit = surfaceLimit; }
  release(surface) {
    if (!surface) return;
    const {canvas} = surface, bytes = canvas.width * canvas.height * 4;
    if (!this.disposed && bytes <= this.surfaceLimit && (!this.surface || bytes >= this.surface.canvas.width * this.surface.canvas.height * 4)) {
      if (this.surface) { this.surface.canvas.width = 1; this.surface.canvas.height = 1; }
      this.surface = surface;
    } else { canvas.width = 1; canvas.height = 1; }
  }
  async decode(blob, width, height, signal) {
    checkAbort(signal); if (this.disposed) throw abortError();
    const bitmap = await createImageBitmap(blob, {colorSpaceConversion:'none', premultiplyAlpha:'none'});
    let surface;
    try {
      checkAbort(signal); if (this.disposed) throw abortError();
      if (bitmap.width !== width || bitmap.height !== height) throw new Error('The scan texture has an incorrect crop size.');
      // A lease is exclusive. The compatibility path yields during extraction,
      // so overlapping decodes must never draw into the same readback surface.
      surface = this.surface; this.surface = null;
      if (!surface) {
        const canvas = typeof OffscreenCanvas === 'function'
          ? new OffscreenCanvas(width, height) : globalThis.document?.createElement('canvas');
        if (!canvas) { const e = new Error('Offscreen image decoding is unavailable.'); e.code = 'WORKER_UNSUPPORTED'; throw e; }
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        const context = canvas.getContext('2d', {willReadFrequently:true});
        if (!context) { canvas.width = 1; canvas.height = 1; const e = new Error('The scan texture decoder is unavailable.'); e.code = 'WORKER_UNSUPPORTED'; throw e; }
        surface = {canvas,context};
      } else {
        const {canvas,context} = surface;
        // Growing clears the backing store; smaller neighboring crops only
        // clear their used rectangle and retain the allocation and context.
        const grow = canvas.width < width || canvas.height < height;
        if (canvas.width < width) canvas.width = width;
        if (canvas.height < height) canvas.height = height;
        if (!grow) context.clearRect(0,0,width,height);
      }
      const {context} = surface;
      context.drawImage(bitmap, 0, 0);
      const rgba = context.getImageData(0, 0, width, height).data;
      const data = new Uint8Array(width * height);
      for (let start = 0; start < data.length; start += 524288) {
        checkAbort(signal);
        const end = Math.min(data.length, start + 524288);
        for (let i = start; i < end; i++) data[i] = rgba[4 * i];
        // Only the compatibility path runs here on the UI thread.
        if (globalThis.document && end < data.length) await new Promise(resolve => setTimeout(resolve, 0));
      }
      checkAbort(signal); return data;
    } finally { bitmap.close(); this.release(surface); }
  }
  dispose() {
    this.disposed = true;
    if (this.surface) { this.surface.canvas.width = 1; this.surface.canvas.height = 1; this.surface = null; }
  }
}

export async function decodeSectionImage(blob, width, height, signal) {
  const decoder = new SectionImageDecoder();
  try { return await decoder.decode(blob,width,height,signal); }
  finally { decoder.dispose(); }
}

/** Bound physical bitmap work even when its cancelled caller has already returned. */
export class SectionDecodeQueue {
  constructor({concurrency = 2} = {}) {
    this.concurrency = Math.max(1,Math.min(2,concurrency));
    this.pending = []; this.active = new Set(); this.sequence = 0;
  }
  run(decode,{signal,priority = 0,onStart} = {}) {
    checkAbort(signal); if(this.disposed)return Promise.reject(abortError());
    return new Promise((resolve,reject)=>{
      const job={decode,signal,priority,order:++this.sequence,onStart,resolve,reject};
      const cleanup=()=>signal?.removeEventListener('abort',abort);
      const abort=()=>{
        if(job.cancelled)return;
        job.cancelled=true;cleanup();
        const at=this.pending.indexOf(job);if(at>=0)this.pending.splice(at,1);
        // An in-flight createImageBitmap cannot be stopped. Keep its physical
        // slot occupied until it finishes, while releasing the obsolete caller.
        reject(abortError());this.pump();
      };
      job.cleanup=cleanup;job.abort=abort;
      signal?.addEventListener('abort',abort,{once:true});
      if(signal?.aborted){abort();return;}
      this.pending.push(job);this.pump();
    });
  }
  pump() {
    if(this.disposed)return;
    this.pending.sort((a,b)=>a.priority-b.priority||a.order-b.order);
    while(this.active.size<this.concurrency&&this.pending.length){
      const job=this.pending.shift();if(job.cancelled)continue;
      this.active.add(job);safely(job.onStart);
      Promise.resolve().then(()=>{checkAbort(job.signal);return job.decode();}).then(
        result=>{if(!job.cancelled)job.resolve(result);},
        error=>{if(!job.cancelled)job.reject(error);}
      ).finally(()=>{job.cleanup();this.active.delete(job);this.pump();});
    }
  }
  dispose() {
    this.disposed=true;
    for(const job of [...this.pending,...this.active])job.abort();
    this.pending.length=0;
  }
}

/** Also used directly as the fallback if worker canvas support is unavailable. */
export class SectionImageBackend {
  constructor({fetchImpl = (...args) => fetch(...args), decodeImpl,
               decodeConcurrency = globalThis.document || globalThis.navigator?.deviceMemory <= 2 ? 1 : 2,
               onStats = () => {}, cacheOptions = {}} = {}) {
    this.fetchImpl = fetchImpl;
    if (!decodeImpl) this.decoder = new SectionImageDecoder();
    this.decodeImpl = decodeImpl || ((...args) => this.decoder.decode(...args));
    this.decodeQueue = new SectionDecodeQueue({concurrency:decodeConcurrency});
    this.cache = new EncodedSectionCache({...cacheOptions, onStats});
  }
  configureCollection(entries,options) { return this.cache.configureCollection(entries,options); }
  setBackgroundEnabled(enabled) { this.cache.setBackgroundEnabled(enabled); }
  dispose() { this.cache.dispose(); this.decodeQueue.dispose(); this.decoder?.dispose(); }
  async load({url, record, priority = 0, decode = true, localOnly = false}, {signal, onProgress} = {}) {
    checkAbort(signal);
    safely(onProgress, {stage:'cache', receivedBytes:0, estimatedBytes:record.bytes});
    let entry = await this.cache.get(url, signal);
    let receivedBytes = 0, persistence;
    if (!entry) {
      // During input, warm only files already on this device. A cache miss
      // must never turn a local decode into a competing network download.
      if (localOnly) { const error = new Error('This scan image is not stored locally.'); error.name = 'CacheMissError'; throw error; }
      const response = await this.fetchImpl(url, {signal, cache:'force-cache',
        priority:priority <= 0 ? 'high' : priority >= 25 ? 'low' : 'auto'});
      if (!response.ok) throw new Error(`This scan section could not load (${response.status}).`);
      let blob;
      if (response.body?.getReader && record.bytes > 0) {
        const reader = response.body.getReader(), bytes = new Uint8Array(record.bytes);
        let lastProgress = 0;
        try {
          for (;;) {
            const {value, done} = await reader.read(); checkAbort(signal);
            if (done) break;
            if (receivedBytes + value.byteLength > bytes.length) throw new Error('The scan section has an unexpected encoded size.');
            bytes.set(value, receivedBytes); receivedBytes += value.byteLength;
            if (Date.now() - lastProgress > 45) {
              safely(onProgress, {stage:'loading', receivedBytes, estimatedBytes:record.bytes}); lastProgress = Date.now();
            }
          }
        } catch (error) {
          try { await reader.cancel(error); } catch { /* The fetch may already have been aborted. */ }
          throw error;
        } finally { reader.releaseLock(); }
        blob = new Blob([bytes], {type:'image/webp'});
      } else { blob = await response.blob(); receivedBytes = blob.size; }
      checkAbort(signal);
      if (record.bytes && receivedBytes !== record.bytes) throw new Error('The hosted scan section is incomplete. Please try again.');
      persistence = this.cache.put(url,blob); entry = {blob,cache:'fetch'};
    }
    if (record.bytes && entry.blob.size !== record.bytes) throw new Error('The cached scan section has an incorrect size.');
    if (!decode) {
      safely(onProgress,{stage:'persist',receivedBytes,estimatedBytes:record.bytes,cached:entry.cache !== 'fetch'});
      const persisted = await (persistence || this.cache.put(url,entry.blob)); checkAbort(signal);
      return {encodedOnly:true,persisted,persistenceReason:this.cache.writeBlockedReason || (this.cache.diskDisabled ? 'storage-unavailable' : null),
        receivedBytes,encodedCacheHit:entry.cache !== 'fetch',cache:entry.cache,...this.cache.stats()};
    }
    const progress={receivedBytes,estimatedBytes:record.bytes,cached:entry.cache !== 'fetch'};
    safely(onProgress,{...progress,stage:'decode-queued'});
    const data = await this.decodeQueue.run(()=>this.decodeImpl(entry.blob,record.crop[2],record.crop[3],signal),{
      signal,priority,onStart:()=>safely(onProgress,{...progress,stage:'decode'})});
    checkAbort(signal);
    return {data, receivedBytes, encodedCacheHit:entry.cache !== 'fetch', cache:entry.cache, ...this.cache.stats()};
  }
}

/** One shared worker; pixels are transferred, rather than copied to the main thread. */
export class SectionTransport {
  constructor({onStats = () => {}, backendOptions = {}} = {}) {
    this.onStats = onStats; this.backendOptions = backendOptions;
    this.jobs = new Map(); this.nextId = 0; this.workerDisabled = false;
    this.backgroundEnabled = true;
  }
  setBackgroundEnabled(enabled) {
    this.backgroundEnabled = Boolean(enabled);
    this.worker?.postMessage({type:'background-policy', enabled:this.backgroundEnabled});
    this.fallback?.setBackgroundEnabled(this.backgroundEnabled);
  }
  workerInstance() {
    if (this.disposed || this.workerDisabled || typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function') return null;
    if (this.worker) return this.worker;
    try {
      const worker = new Worker(new URL('./ultra-cache-worker.js', import.meta.url), {type:'module'});
      worker.onmessage = ({data:message}) => {
        if (message.type === 'stats') { safely(this.onStats, {...message.stats, decodeWorker:true}); return; }
        const job = this.jobs.get(message.id); if (!job) return;
        if (message.type === 'progress') { safely(job.onProgress, message.progress); return; }
        this.jobs.delete(message.id); job.cleanup();
        if (message.type === 'error') {
          const error = new Error(message.message); error.name = message.name || 'Error'; error.code = message.code;
          job.reject(error);
        } else {
          const result = {...message.result};
          if (result.data instanceof ArrayBuffer) result.data = new Uint8Array(result.data);
          safely(this.onStats, {...result, data:undefined, decodeWorker:true}); job.resolve(result);
        }
      };
      worker.onerror = event => { event.preventDefault?.(); this.failWorker(); }; this.worker = worker;
      const options = this.backendOptions.cacheOptions || {}, cacheOptions = {};
      for (const key of ['cacheName', 'memoryLimit', 'diskLimit']) if (options[key] !== undefined) cacheOptions[key] = options[key];
      worker.postMessage({type:'configure-backend', cacheOptions, backgroundEnabled:this.backgroundEnabled,
        decodeConcurrency:this.backendOptions.decodeConcurrency ?? (globalThis.navigator?.deviceMemory<=2?1:2)});
      return worker;
    } catch { this.workerDisabled = true; return null; }
  }
  failWorker() {
    this.worker?.terminate(); this.worker = null; this.workerDisabled = true;
    for (const job of this.jobs.values()) {
      job.cleanup(); const error = new Error('Worker image decoding is unavailable.'); error.code = 'WORKER_UNSUPPORTED'; job.reject(error);
    }
    this.jobs.clear();
  }
  load(request,options) { return this.request('load',request,options); }
  configureCollection(entries,{retry = false} = {}) { return this.request('configure-collection',{entries,retry}); }
  async request(type,request, {signal, onProgress} = {}) {
    if (this.disposed) throw abortError();
    checkAbort(signal);
    const worker = this.workerInstance();
    if (worker) {
      try {
        return await new Promise((resolve, reject) => {
          const id = ++this.nextId;
          const abort = () => { this.jobs.delete(id); signal?.removeEventListener('abort', abort); worker.postMessage({type:'cancel', id}); reject(abortError()); };
          const cleanup = () => signal?.removeEventListener('abort', abort);
          this.jobs.set(id, {resolve, reject, cleanup, onProgress});
          signal?.addEventListener('abort', abort, {once:true});
          if (signal?.aborted) { abort(); return; }
          worker.postMessage({type, id, request});
        });
      } catch (error) {
        if (error.code !== 'WORKER_UNSUPPORTED') throw error;
        this.failWorker(); if (this.disposed) throw abortError(); checkAbort(signal);
      }
    }
    this.fallback ||= new SectionImageBackend({...this.backendOptions,
      onStats:stats => safely(this.onStats, {...stats, decodeWorker:false})});
    this.fallback.setBackgroundEnabled(this.backgroundEnabled);
    const result = type === 'configure-collection'
      ? await this.fallback.configureCollection(request.entries,{retry:request.retry})
      : await this.fallback.load(request,{signal,onProgress});
    safely(this.onStats, {...result, data:undefined, decodeWorker:false}); return result;
  }
  dispose() { this.disposed = true; this.failWorker(); this.fallback?.dispose(); }
}
