/** One active fetch/decode for the comparison; a newer choice replaces its pane's work. */
export class NativeMeshLoader {
  constructor({ createWorker = () => new Worker(new URL('./native-mesh-worker.js', import.meta.url), { type: 'module' }), baseUrl = globalThis.location?.href } = {}) {
    this.createWorker = createWorker; this.baseUrl = baseUrl; this.pending = new Map(); this.active = null; this.disposed = false;
  }
  load(pane, lod) {
    this.cancel(pane);
    if (this.disposed) return Promise.reject(new Error('Native surface loader is closed.'));
    return new Promise((resolve, reject) => { this.pending.set(pane, { pane, lod, resolve, reject }); this.pump(); });
  }
  cancel(pane) {
    const error = () => new DOMException('A newer surface was selected.', 'AbortError');
    const queued = this.pending.get(pane);
    if (queued) { this.pending.delete(pane); queued.reject(error()); }
    if (this.active?.pane === pane) {
      const item = this.active; this.active = null; item.worker.terminate(); item.reject(error());
    }
  }
  pump() {
    if (this.active || this.disposed || !this.pending.size) return;
    const [pane, item] = this.pending.entries().next().value; this.pending.delete(pane);
    let worker;
    try { worker = this.createWorker(); } catch (error) { item.reject(error); this.pump(); return; }
    this.active = item; item.worker = worker;
    const finish = (error, value) => {
      if (this.active !== item) return;
      this.active = null; worker.terminate();
      error ? item.reject(error) : item.resolve(value);
      this.pump();
    };
    worker.onmessage = ({ data }) => finish(data.error ? new Error(data.error) : null, data);
    worker.onerror = () => finish(new Error('Native surface decoding failed.'));
    const lod = item.lod;
    try {
      worker.postMessage({ url: new URL(lod.url, this.baseUrl).href, sha256: lod.sha256, decodedSha256: lod.decodedSha256, compressedBytes: lod.compressedBytes, expectedBytes: lod.decodedBytes });
    } catch { finish(new Error('Native surface decoding could not start.')); }
  }
  dispose() {
    this.disposed = true;
    for (const pane of [...this.pending.keys(), ...(this.active ? [this.active.pane] : [])]) this.cancel(pane);
  }
}
