#!/usr/bin/env node
/** Exercise the actual browser decoder against every generated transport block. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { decodeCompactSurface, validateCompactManifest, decodeCompactBlock } from '../../public/compact-surface-codec.js';

const directory = resolve(process.argv[2] || '/workspace/data/heart-v29-compress/mesh-compact');
const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const began = performance.now();
let calls = 0, gates = 0, previousProgress = 0;
const result = await decodeCompactSurface(manifest, {
  loadPart: async part => { calls++; return readFile(resolve(directory, part.path)); },
  waitForWorkspace: async () => { gates++; },
  onProgress: progress => {
    assert.ok(progress.loadedBytes >= previousProgress);
    assert.ok(progress.loadedBytes <= progress.totalBytes);
    previousProgress = progress.loadedBytes;
  },
  hash: async bytes => sha(bytes),
});
assert.equal(calls, manifest.parts.length);
assert.equal(previousProgress, manifest.compressedBytes);
assert.ok(gates > calls * 3, 'Workspace gating must cover fetch, inflate, decode and installation.');
const { bytes, positionOffset, normalOffset, indexOffset, vertexCount, indexCount } = result;
assert.equal(sha(bytes), manifest.decodedSha256);
assert.equal(sha(bytes.subarray(positionOffset, positionOffset + vertexCount * 6)), manifest.positionSha256);
assert.equal(sha(bytes.subarray(indexOffset, indexOffset + indexCount * 4)), manifest.indexSha256);
assert.equal(sha(bytes.subarray(normalOffset, normalOffset + vertexCount * 6)), manifest.decodedNormalSha256);
const elapsed = performance.now() - began;

// Reject unbounded sizes, gaps/overlap and a broken decoded checksum declaration
// before allocating or fetching; invalid block identity cannot alter output.
for (const mutate of [
  m => { m.decodedBytes = 2 ** 31; },
  m => { m.parts[0].count = 0; },
  m => { m.parts[1].start++; },
  m => { m.parts[0].compressedBytes = 2 ** 30; },
  m => { m.parts[0].sha256 = 'invalid'; },
  m => { m.positionBytesExact = false; },
  m => { m.parts.pop(); },
]) {
  const bad = structuredClone(manifest); mutate(bad);
  assert.throws(() => validateCompactManifest(bad));
}
assert.throws(() => decodeCompactBlock(new Uint8Array(24), {kind: 1, start: 0, count: 1}, new Uint8Array(64), result));
const report = {
  schema: 'heart-compact-browser-decoder-check-v29', passed: true,
  environment: `Node ${process.version}; the same JS/WASM and DecompressionStream decoder used by the browser worker`,
  parts: calls, workspaceGateChecks: gates, bytesTransferred: manifest.compressedBytes,
  decodedBytes: bytes.length, decodedSha256: sha(bytes),
  positionBytesExact: true, indexBytesExact: true, triangleCornerOrderExact: true,
  decodedNormalSha256: manifest.decodedNormalSha256,
  decodeAndHashMilliseconds: elapsed,
  maxResidentSetMiB: process.resourceUsage().maxRSS / 1024,
  note: 'Local file reads, gzip, meshopt, normal reconstruction, all part hashes and final full-buffer hash are included. This is not a browser network timing or a slow-device benchmark.',
};
const reportPath = resolve(dirname(new URL(import.meta.url).pathname), '../../docs/compression-v29/mesh-decoder-check.json');
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
