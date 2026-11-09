import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNativeMesh, MAX_NATIVE_MESH_BYTES } from '../public/native-mesh-format.js';
import { NativeMeshLoader } from '../public/native-mesh-loader.js';
import { nativeSurfaceRequest, nativeSurfaceUploadsEnabled } from '../server/native-surface-store-v20.mjs';
import { createHash, webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

function mesh(float = false) {
  const count = 3, normalOffset = (32 + count * (float ? 12 : 6) + 3) & ~3, indexOffset = (normalOffset + count * 6 + 3) & ~3;
  const buffer = new ArrayBuffer(indexOffset + 12);
  new Uint32Array(buffer, 0, 8).set([0x314d4648, 1, count, 3, 32, normalOffset, indexOffset, float ? 1 : 0]);
  if (float) new Float32Array(buffer, 32, 9).set([-.5, 0, .2, .5, 0, .2, 0, .5, .2]);
  else new Uint16Array(buffer, 32, 9).set([0, 0, 0, 65535, 0, 0, 0, 65535, 0]);
  new Int16Array(buffer, normalOffset, 9).set([0, 0, 32767, 0, 0, 32767, 0, 0, 32767]);
  new Uint32Array(buffer, indexOffset, 3).set([0, 1, 2]);
  return buffer;
}
test('Both mesh encodings preserve their positions, normals and triangle indices', () => {
  for (const float of [false, true]) {
    const buffer = mesh(float), copy = Buffer.from(buffer).toString('hex'), result = parseNativeMesh(buffer, buffer.byteLength);
    assert.equal(result.positionFormat, float ? 'float32' : 'uint16');
    assert.equal(result.positionBytes, float ? 12 : 6);
    assert.equal(Buffer.from(result.buffer).toString('hex'), copy);
    assert.deepEqual([...new Uint32Array(result.buffer, result.indexOffset, result.indexCount)], [0, 1, 2]);
  }
});
test('Malformed and nonfinite meshes are rejected before GPU upload', () => {
  assert.throws(() => parseNativeMesh(mesh(), 99), /length/);
  let buffer = mesh(); new Uint32Array(buffer, 0, 8)[7] = 2; assert.throws(() => parseNativeMesh(buffer), /encoding/);
  buffer = mesh(); new Uint32Array(buffer).at(-1); new Uint32Array(buffer)[buffer.byteLength / 4 - 1] = 9; assert.throws(() => parseNativeMesh(buffer), /index/);
  buffer = mesh(true); new Float32Array(buffer, 32, 9)[1] = NaN; assert.throws(() => parseNativeMesh(buffer), /position/);
  assert.throws(() => parseNativeMesh(new ArrayBuffer(MAX_NATIVE_MESH_BYTES + 1)), /memory/);
});
const lod = id => ({ id, url: `./${id}.gz`, sha256: 'a'.repeat(64), decodedSha256: 'b'.repeat(64), compressedBytes: 10, decodedBytes: 100 });
function fakePool() {
  const workers = [];
  const loader = new NativeMeshLoader({ baseUrl: 'https://heart.test/native-detail.html', createWorker: () => {
    const worker = { stopped: false, postMessage(message) { this.message = message; }, terminate() { this.stopped = true; } }; workers.push(worker); return worker;
  } });
  return { loader, workers };
}
test('A newer selection cancels stale active decoding and late output cannot replace it', async () => {
  const { loader, workers } = fakePool();
  const first = loader.load('candidate', lod('native')); const rejected = assert.rejects(first, { name: 'AbortError' });
  const next = loader.load('candidate', lod('normals'));
  assert.equal(workers[0].stopped, true); assert.equal(workers.length, 2);
  workers[0].onmessage({ data: { result: 'stale' } });
  assert.equal(loader.active.lod.id, 'normals');
  workers[1].onmessage({ data: { result: 'current' } });
  assert.deepEqual(await next, { result: 'current' }); await rejected; loader.dispose();
});
test('Two panes share one active decoder and queued changes coalesce', async () => {
  const { loader, workers } = fakePool();
  const reference = loader.load('reference', lod('overview'));
  const pending = loader.load('candidate', lod('gentle')); const rejected = assert.rejects(pending, { name: 'AbortError' });
  const current = loader.load('candidate', lod('moderate'));
  assert.equal(workers.length, 1);
  workers[0].onmessage({ data: { result: 'overview' } }); await reference;
  assert.equal(workers.length, 2); assert.equal(workers[1].message.url, 'https://heart.test/moderate.gz');
  workers[1].onmessage({ data: { result: 'moderate' } }); await current; await rejected; loader.dispose();
});
test('Decoder errors release the queue and page teardown terminates work', async () => {
  const { loader, workers } = fakePool();
  const first = loader.load('reference', lod('overview')); const rejected = assert.rejects(first, /decoding/);
  const next = loader.load('candidate', lod('native')); const canceled = assert.rejects(next, { name: 'AbortError' });
  workers[0].onerror(); await rejected;
  assert.equal(workers.length, 2); loader.dispose(); await canceled; assert.equal(workers[1].stopped, true);
});
test('A synchronous decoder startup failure releases its worker and allows the next selection', async () => {
  const { loader, workers } = fakePool();
  const invalid = { ...lod('invalid'), url: 'https://[' };
  await assert.rejects(loader.load('candidate', invalid), /could not start/);
  assert.equal(workers[0].stopped, true);
  assert.equal(loader.active, null);
  const current = loader.load('candidate', lod('native'));
  assert.equal(workers.length, 2);
  workers[1].onmessage({ data: { result: 'native' } });
  assert.deepEqual(await current, { result: 'native' }); loader.dispose();
});

const payload = new Uint8Array([1, 2, 3, 4]), hash = createHash('sha256').update(payload).digest('hex');
const index = { 'native.hfm.gz': { bytes: 4, sha256: hash, contentType: 'application/octet-stream' } };
const api = 'https://heart.test/api/native-surface-v20/native.hfm.gz';
const token = 'unit-test-collection-secret-'.repeat(3);
function bucket() {
  const objects = new Map();
  return { objects,
    async head(key) { return objects.get(key) || null; },
    async get(key) { const o = objects.get(key); return o && { ...o, body: new Blob([o.data]).stream() }; },
    async put(key, data, options) { objects.set(key, { key, size: data.length, data, customMetadata: options.customMetadata }); },
    async list() { return { objects: [...objects.values()], truncated: false }; },
  };
}
test('Public Site native upload requires its own secret and cannot overwrite an immutable object', async () => {
  const b = bucket(), request = (body = payload, secret) => new Request(api, { method: 'PUT', body, headers: secret ? { 'X-Heart-Native-Upload': secret } : {} });
  assert.equal((await nativeSurfaceRequest(request(), b, index)).status, 405);
  assert.equal((await nativeSurfaceRequest(request(), b, index, { uploadToken: token, uploadsEnabled: true })).status, 403);
  assert.equal((await nativeSurfaceRequest(request(payload, 'wrong'), b, index, { uploadToken: token, uploadsEnabled: true })).status, 403);
  assert.equal((await nativeSurfaceRequest(request(new Uint8Array([2, 3, 4, 5]), token), b, index, { uploadToken: token, uploadsEnabled: true })).status, 400);
  assert.equal(b.objects.size, 0);
  assert.equal((await nativeSurfaceRequest(request(payload, token), b, index, { uploadToken: token, uploadsEnabled: true })).status, 201);
  assert.equal((await nativeSurfaceRequest(request(payload, token), b, index, { uploadToken: token, uploadsEnabled: true })).status, 204);
  const stored = [...b.objects.values()][0]; assert.equal(stored.customMetadata.collection, 'native-surface-v20');
  stored.customMetadata.sha256 = '0'.repeat(64);
  assert.equal((await nativeSurfaceRequest(request(payload, token), b, index, { uploadToken: token, uploadsEnabled: true })).status, 409);
});
test('The final release stays read-only even if the hosting platform retains a valid upload secret', async () => {
  assert.equal(nativeSurfaceUploadsEnabled, false);
  const b = bucket();
  const request = () => new Request(api, { method: 'PUT', body: payload, headers: { 'X-Heart-Native-Upload': token } });
  assert.equal((await nativeSurfaceRequest(request(), b, index, { uploadToken: token })).status, 405);
  assert.equal((await nativeSurfaceRequest(request(), b, index, { uploadToken: token, uploadsEnabled: nativeSurfaceUploadsEnabled })).status, 405);
  assert.equal(b.objects.size, 0);
});
test('Native objects retain exact public bytes, ETags and closed final upload gate', async () => {
  const b = bucket(); await nativeSurfaceRequest(new Request(api, { method: 'PUT', body: payload, headers: { 'X-Heart-Native-Upload': token } }), b, index, { uploadToken: token, uploadsEnabled: true });
  const url = 'https://heart.test/assets/native-surface-v20/native.hfm.gz';
  const response = await nativeSurfaceRequest(new Request(url), b, index);
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-encoding'), null);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), payload);
  assert.equal((await nativeSurfaceRequest(new Request(url, { headers: { 'If-None-Match': response.headers.get('etag') } }), b, index)).status, 304);
  assert.equal((await nativeSurfaceRequest(new Request(api, { method: 'PUT', body: payload }), b, index)).status, 405);
  assert.equal(await nativeSurfaceRequest(new Request('https://heart.test/assets/native-surface-v20/manifest.json'), b, index), null);
  assert.equal(await nativeSurfaceRequest(new Request('https://heart.test/assets/donors/s-20-29/foo.gz'), b, index), null);
});
