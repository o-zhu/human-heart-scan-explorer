/** Bounded codec regressions: real gzip bytes, no full-mesh allocation required. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { decodeCompactSurface, inflateCompactBlock, validateCompactManifest } from '../public/compact-surface-codec.js';

const manifest = JSON.parse(await readFile(new URL('../public/assets/display-compact-v29/mesh-manifest.json', import.meta.url), 'utf8'));
const raw = Uint8Array.from({ length: 128 * 1024 }, (_, i) => (i * 29 + (i >>> 8)) & 255);
const packed = new Uint8Array(gzipSync(raw));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const tick = () => new Promise(resolve => setImmediate(resolve));

async function withGlobal(name, value, operation) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  try { return await operation(); }
  finally {
    if (original) Object.defineProperty(globalThis, name, original);
    else Reflect.deleteProperty(globalThis, name);
  }
}

test('bounded gzip chunks report actual decoded bytes without changing payload identity', async () => {
  const progress = [];
  const output = await inflateCompactBlock(packed, raw.length, async () => {}, count => progress.push(count));
  assert.equal(hash(output), hash(raw));
  assert.ok(progress.length > 0);
  assert.equal(progress.at(-1), raw.length);
  assert.ok(progress.every((count, index) => count > (progress[index - 1] || 0) && count <= raw.length));
});

test('compact inflation retains completed bytes and waits when a lab takes priority', { timeout: 5000 }, async () => {
  let paused = false, resume, started, settled = false;
  const progress = [], pauseGate = new Promise(resolve => { resume = resolve; });
  const firstChunk = new Promise(resolve => { started = resolve; });
  const output = inflateCompactBlock(packed, raw.length, async () => { if (paused) await pauseGate; }, count => {
    progress.push(count);
    if (progress.length === 1) { paused = true; started(); }
  }).then(bytes => { settled = true; return bytes; });
  await firstChunk;
  try {
    await tick();
    assert.equal(settled, false);
    assert.equal(progress.length, 1, 'No additional decoded bytes are consumed during the pause.');
  } finally { paused = false; resume(); }
  assert.equal(hash(await output), hash(raw));
});

test('bounded inflate rejects truncated, oversized and inconsistent payloads', async () => {
  await assert.rejects(inflateCompactBlock(packed, raw.length - 1), /exceeds its manifest/);
  await assert.rejects(inflateCompactBlock(packed, raw.length + 1), /length did not match/);
  await assert.rejects(inflateCompactBlock(packed.subarray(0, packed.length - 4), raw.length));
  await assert.rejects(inflateCompactBlock(Uint8Array.of(0, 0), raw.length), /compression/);
  await assert.rejects(inflateCompactBlock(packed, 8 * 1024 * 1024 + 1), /block length/);
});

test('compact capability failures happen before allocating or downloading the full mesh', async () => {
  assert.equal(validateCompactManifest(manifest).vertexCount, manifest.vertexCount);
  let downloads = 0;
  const loadPart = async () => { downloads++; throw new Error('Unexpected download'); };
  await withGlobal('crypto', undefined, async () => {
    await assert.rejects(decodeCompactSurface(manifest, { loadPart }), /SHA-256/);
  });
  for (const decoder of [undefined, class { constructor() { throw new Error('unsupported gzip'); } }]) {
    await withGlobal('crypto', webcrypto, () => withGlobal('DecompressionStream', decoder, async () => {
      await assert.rejects(decodeCompactSurface(manifest, { loadPart }), /cannot decompress gzip/);
      await assert.rejects(inflateCompactBlock(packed, raw.length), /cannot decompress gzip/);
    }));
  }
  assert.equal(downloads, 0);
});
