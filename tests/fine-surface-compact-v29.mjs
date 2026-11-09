/** Full local transport lifecycle check; uses actual production JS/WASM worker. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { validateCompactManifest } from '../public/compact-surface-codec.js';

const directory = resolve(process.env.HEART_COMPACT_TEST_DIR || '/workspace/data/heart-v29-compress/mesh-compact');
const compact = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
compact.parts = compact.parts.map(part => ({ ...part, url: pathToFileURL(resolve(directory, part.path)).href }));
const payload = { compact, expectedBytes: compact.decodedBytes, decodedSha256: compact.decodedSha256 };
const harness = new URL('../scripts/compression-v29/worker_harness.mjs', import.meta.url);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('the compact manifest cannot impersonate source geometry by changing identity metadata', () => {
  for (const key of ['sourceDecodedSha256', 'positionSha256', 'indexSha256']) {
    assert.throws(() => validateCompactManifest({ ...compact, [key]: '0'.repeat(64) }), /source geometry/);
  }
});

test('a hidden compact load fetches nothing and can be cancelled without installing geometry', async () => {
  const worker = new Worker(harness, { workerData: {} });
  const messages = [];
  try {
    await new Promise((resolve, reject) => {
      worker.on('error', reject);
      worker.on('message', message => { messages.push(message); if (message.type === 'test-ready') resolve(); });
    });
    worker.postMessage({ ...payload, paused: true });
    await delay(120);
    assert.equal(messages.filter(m => m.type === 'test-fetch').length, 0);
    assert.equal(messages.some(m => m.buffer || m.error), false);
  } finally { await worker.terminate(); }
});

test('compact load retries only its interrupted block and holds completed geometry for the active lab', { timeout: 60000 }, async () => {
  const worker = new Worker(harness, { workerData: { pauseSecondPart: true } });
  const requests = [], gates = [];
  let releasedDownload = false, releasedCommit = false;
  try {
    const result = await new Promise((resolve, reject) => {
      worker.on('error', reject);
      worker.on('message', message => {
        if (message.type === 'test-ready') worker.postMessage(payload);
        else if (message.type === 'test-fetch') requests.push(message.url);
        else if (message.type === 'test-blocked') {
          worker.postMessage({ type: 'workspace-priority', paused: true });
          gates.push(delay(40).then(() => {
            assert.equal(requests.length, 2);
            releasedDownload = true;
            worker.postMessage({ type: 'workspace-priority', paused: false });
          }).catch(reject));
        } else if (message.type === 'progress' && message.loadedBytes === compact.compressedBytes) {
          worker.postMessage({ type: 'workspace-priority', paused: true });
          gates.push(delay(80).then(() => {
            releasedCommit = true;
            worker.postMessage({ type: 'workspace-priority', paused: false });
          }).catch(reject));
        } else if (message.error) reject(new Error(message.error));
        else if (message.buffer) resolve(message);
      });
    });
    assert.equal(releasedDownload, true);
    assert.equal(releasedCommit, true, 'Geometry cannot commit while a lab owns priority.');
    assert.equal(result.buffer.byteLength, compact.decodedBytes);
    assert.equal(result.geometrySourceSha256, '175548ddaad01c409d59d561df6018c5cb0c90752b2ec771899c255065398dae');
    assert.equal(requests.length, compact.parts.length + 1);
    assert.equal(requests.filter(url => url === compact.parts[0].url).length, 1);
    assert.equal(requests.filter(url => url === compact.parts[1].url).length, 2);
    assert.equal(result.vertexCount, compact.vertexCount);
    assert.equal(result.indexCount, compact.indexCount);
    await Promise.all(gates);
  } finally { await worker.terminate(); }
});
