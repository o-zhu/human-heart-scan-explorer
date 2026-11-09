import {SectionImageBackend} from './ultra-prefetch.js';

const active = new Map();
let backend;
const createBackend = (cacheOptions,decodeConcurrency) => new SectionImageBackend({cacheOptions,decodeConcurrency,
  onStats:stats => self.postMessage({type:'stats', stats})});
self.onmessage = async ({data:message}) => {
  if (message.type === 'configure-backend') {
    if (!backend) backend = createBackend(message.cacheOptions,message.decodeConcurrency);
    backend.setBackgroundEnabled(message.backgroundEnabled !== false); return;
  }
  backend ||= createBackend();
  if (message.type === 'background-policy') { backend.setBackgroundEnabled(message.enabled); return; }
  if (message.type === 'cancel') { active.get(message.id)?.abort(); return; }
  if (!['load','configure-collection'].includes(message.type)) return;
  const controller = new AbortController(); active.set(message.id, controller);
  try {
    if (message.type === 'load' && message.request.decode !== false && (typeof OffscreenCanvas !== 'function' || typeof createImageBitmap !== 'function')) {
      const error = new Error('Worker image decoding is unavailable.'); error.code = 'WORKER_UNSUPPORTED'; throw error;
    }
    const result = message.type === 'configure-collection'
      ? await backend.configureCollection(message.request.entries,{retry:message.request.retry})
      : await backend.load(message.request, {signal:controller.signal,
        onProgress:progress => self.postMessage({type:'progress', id:message.id, progress})});
    if (controller.signal.aborted) return;
    if (result.data) {
      const data = result.data.buffer;
      self.postMessage({type:'result',id:message.id,result:{...result,data}},[data]);
    } else self.postMessage({type:'result',id:message.id,result});
  } catch (error) {
    self.postMessage({type:'error', id:message.id, name:error.name, code:error.code, message:error.message});
  } finally { active.delete(message.id); }
};
