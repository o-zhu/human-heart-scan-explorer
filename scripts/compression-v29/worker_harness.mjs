/** Node-only harness: browser worker source runs unmodified with local file I/O. */
import { parentPort, workerData } from 'node:worker_threads';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
globalThis.self = { postMessage: (message, transfers) => parentPort.postMessage(message, transfers) };
let interrupted = false, requests = 0;
globalThis.fetch = async (url, { signal, priority }) => {
  if (priority !== 'low') throw new Error('Surface fetch must yield to active workspaces.');
  requests++;
  parentPort.postMessage({ type: 'test-fetch', url });
  if (workerData.pauseSecondPart && requests === 2 && !interrupted) {
    parentPort.postMessage({ type: 'test-blocked' });
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => {
      interrupted = true; reject(new DOMException('Yielding to lab', 'AbortError'));
    }, { once: true }));
  }
  const stream = createReadStream(fileURLToPath(url), { highWaterMark: 65536, signal });
  return new Response(Readable.toWeb(stream));
};
await import('../../public/fine-surface-worker.js');
parentPort.on('message', data => { void self.onmessage({ data }); });
parentPort.postMessage({ type: 'test-ready' });
