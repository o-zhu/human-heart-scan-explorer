import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { loadDebrisAttribute } from '../public/mesh-debris-cleanup-v25.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(values = [0, 0, 0, 255, 255, 255]) {
  const flags = Uint8Array.from(values), packed = gzipSync(flags);
  const indices = Uint32Array.from([0, 1, 2, 3, 4, 5]);
  const lod = { id: 'gentle', decodedSha256: 'a'.repeat(64) };
  const decoded = { vertexCount: 6, indexCount: 6, indexOffset: 0, buffer: indices.buffer };
  const profile = { lodId: 'gentle', sourceDecodedSha256: lod.decodedSha256,
    sourceVertexCount: 6, sourceTriangleCount: 2, removedTriangles: 1, removedComponents: 1,
    vertexFlags: { url: './assets/cleanup-v26/debris-gentle-vertices.raw.gz',
      compressedBytes: packed.length, decodedBytes: flags.length,
      sha256: hash(packed), decodedSha256: hash(flags) } };
  const manifest = { version: 2, donorId: 'ladaf-2021-17', profiles: [profile] };
  const calls = [];
  return { flags, packed, lod, decoded, profile, manifest, calls,
    fetcher: async url => { calls.push(url); return url.endsWith('.json')
      ? Response.json(manifest) : new Response(packed); } };
}

test('authenticated visibility flags hide complete components and preserve geometry', async () => {
  const f = fixture(), original = f.decoded.buffer.slice(0);
  const flags = await loadDebrisAttribute(f.lod, f.decoded, { fetcher: f.fetcher });
  assert.deepEqual(flags, f.flags);
  assert.deepEqual(f.decoded.buffer, original);
  assert.deepEqual(f.decoded.debrisReport, { removedTriangles: 1, removedComponents: 1,
    sourceDecodedSha256: f.lod.decodedSha256 });
});

test('legacy profiles never fetch or imply a matching debris filter', async () => {
  const f = fixture();
  assert.equal(await loadDebrisAttribute({ id: 'detail' }, f.decoded, { fetcher: f.fetcher }), null);
  assert.equal(f.calls.length, 0);
  assert.equal(f.decoded.debrisReport, undefined);
});

test('a filter for a different geometry is rejected before downloading flags', async () => {
  const f = fixture(); f.profile.sourceDecodedSha256 = 'b'.repeat(64);
  await assert.rejects(loadDebrisAttribute(f.lod, f.decoded, { fetcher: f.fetcher }), /does not match/);
  assert.equal(f.calls.length, 1);
});

test('corrupt compressed bytes never install a filter', async () => {
  const f = fixture(); f.packed[f.packed.length - 5] ^= 1;
  await assert.rejects(loadDebrisAttribute(f.lod, f.decoded, { fetcher: f.fetcher }), /checksum/);
  assert.equal(f.decoded.debrisReport, undefined);
});

test('declared stream lengths are enforced', async () => {
  const f = fixture(); f.profile.vertexFlags.compressedBytes--;
  await assert.rejects(loadDebrisAttribute(f.lod, f.decoded, { fetcher: f.fetcher }), /length/);
});

test('partial-face visibility cannot cut a retained structure', async () => {
  const f = fixture([0, 0, 255, 255, 255, 255]);
  await assert.rejects(loadDebrisAttribute(f.lod, f.decoded, { fetcher: f.fetcher }), /retained structure/);
  assert.equal(f.decoded.debrisReport, undefined);
});

test('nonbinary labels cannot silently become interpolation or arbitrary clipping', async () => {
  const f = fixture([0, 0, 0, 64, 64, 64]);
  await assert.rejects(loadDebrisAttribute(f.lod, f.decoded, { fetcher: f.fetcher }), /Invalid debris filter values/);
});

test('canceled cleanup cannot start transport or commit after its metadata response', async () => {
  for (const beforeStart of [true, false]) {
    const f = fixture(), abort = new AbortController();
    if (beforeStart) abort.abort();
    const fetcher = async url => { const response = await f.fetcher(url); abort.abort(); return response; };
    await assert.rejects(loadDebrisAttribute(f.lod, f.decoded, { fetcher, signal: abort.signal }), { name: 'AbortError' });
    assert.equal(f.calls.length, beforeStart ? 0 : 1);
    assert.equal(f.decoded.debrisReport, undefined);
  }
});

test('cancellation during a pending flag-stream read cancels the reader before validation', async () => {
  const f = fixture(), abort = new AbortController();let reads = 0, canceled = false;
  const fetcher = async url => url.endsWith('.json') ? Response.json(f.manifest) : {
    ok: true, body: { getReader: () => ({
      async read() { reads++; abort.abort(); return { value: f.packed, done: false }; },
      async cancel() { canceled = true; }, releaseLock() {}
    }) }
  };
  await assert.rejects(loadDebrisAttribute(f.lod, f.decoded, { fetcher, signal: abort.signal }), { name: 'AbortError' });
  assert.equal(reads, 1);assert.equal(canceled, true);assert.equal(f.decoded.debrisReport, undefined);
});
