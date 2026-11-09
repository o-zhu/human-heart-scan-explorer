import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { motionCTRequest, MOTION_CT_API, MOTION_CT_PUBLIC } from '../server/motion-ct-store-v24.mjs';

const PREFIX = 'hoa-heart/motion-ct-v24/';
const name = 'native-phase-00.hfm.gz';
const data = Uint8Array.from({ length: 96 }, (_, index) => index * 7);
const digest = createHash('sha256').update(data).digest('hex');
const index = { [name]: { bytes: data.length, sha256: digest, contentType: 'application/octet-stream' } };
const token = 'test-only-motion-ct-collection-secret-0000';
const open = { uploadsEnabled: true, uploadToken: token };
const headers = { 'X-Heart-Motion-CT-Upload': token };
const request = (route, method = 'GET', body, options = {}) => new Request('https://heart.example' + route, {
  method, ...(body === undefined ? {} : { body }), headers: options,
});

function memoryBucket() {
  const objects = new Map();
  let writes = 0;
  return {
    objects,
    get writes() { return writes; },
    async head(key) { return objects.get(key) ?? null; },
    async get(key) {
      const object = objects.get(key);
      return object ? { ...object, body: new Blob([object.data]).stream() } : null;
    },
    async put(key, value, options) {
      writes++;
      const stored = new Uint8Array(value);
      objects.set(key, { key, size: stored.length, data: stored, ...options });
    },
    async list({ prefix }) {
      assert.equal(prefix, PREFIX);
      return { objects: [...objects.values()].filter(object => object.key.startsWith(prefix)), truncated: false };
    },
  };
}

test('The new upload gate requires both an explicit enable and its dedicated runtime secret', async () => {
  const bucket = memoryBucket();
  for (const options of [{}, { uploadsEnabled: true }, { uploadsEnabled: true, uploadToken: 'short' },
    { uploadsEnabled: false, uploadToken: token }]) {
    assert.equal((await motionCTRequest(request(MOTION_CT_API + name, 'PUT', data, headers), bucket, index, options)).status, 405);
  }
  for (const unauthorized of [{}, { 'X-Heart-Native-Upload': token }, { 'X-Heart-Motion-CT-Upload': 'x'.repeat(token.length) }]) {
    const response = await motionCTRequest(request(MOTION_CT_API + name, 'PUT', data, unauthorized), bucket, index, open);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(bucket.writes, 0);
});

test('Only the new exact indexed routes intercept; the CT manifest remains static', async () => {
  for (const path of ['/', '/api/native-surface-v20/' + name, '/api/guided-native-v21/' + name,
    '/assets/donors/' + name, MOTION_CT_PUBLIC + 'manifest.json', MOTION_CT_PUBLIC + 'unknown.hfm.gz']) {
    assert.equal(await motionCTRequest(request(path), null, index), null, path);
  }
  assert.equal(await motionCTRequest(request(MOTION_CT_PUBLIC + name), null, index, { servePublic: false }), null);
  assert.equal(await motionCTRequest(request(MOTION_CT_PUBLIC + name, 'PUT', data, headers), null, index, open), null);
  assert.equal((await motionCTRequest(request(MOTION_CT_API + 'unknown.hfm.gz', 'PUT', data, headers), null, index, open)).status, 404);
});

test('Size/SHA pins reject changed data and existing objects cannot be overwritten', async () => {
  const bucket = memoryBucket();
  for (const wrong of [data.subarray(1), new Uint8Array(data.length + 1), new Uint8Array(data.length)]) {
    assert.equal((await motionCTRequest(request(MOTION_CT_API + name, 'PUT', wrong, headers), bucket, index, open)).status, 400);
  }
  const put = () => motionCTRequest(request(MOTION_CT_API + name, 'PUT', data, headers), bucket, index, open);
  assert.equal((await put()).status, 201);
  assert.equal((await put()).status, 204);
  assert.equal(bucket.writes, 1);
  const stored = bucket.objects.get(PREFIX + name);
  assert.equal(stored.customMetadata.collection, 'motion-ct-v24');
  assert.equal(stored.customMetadata.sha256, digest);
  assert.equal(stored.httpMetadata.contentEncoding, undefined);
  stored.customMetadata.sha256 = 'conflicting';
  assert.equal((await put()).status, 409);
  assert.equal(bucket.writes, 1);
});

test('Public/API reads stay byte-identical and the final gate rejects a retained secret', async () => {
  const bucket = memoryBucket();
  await motionCTRequest(request(MOTION_CT_API + name, 'PUT', data, headers), bucket, index, open);
  const closed = { uploadsEnabled: false, uploadToken: token };
  for (const route of [MOTION_CT_PUBLIC, MOTION_CT_API]) {
    const response = await motionCTRequest(request(route + name), bucket, index, closed);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-content-sha256'), digest);
    assert.equal(response.headers.get('content-encoding'), null);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), data);
  }
  const status = await (await motionCTRequest(request(MOTION_CT_API + 'status'), bucket, index, closed)).json();
  assert.equal(status.complete, true);
  assert.equal(status.verified, 1);
  assert.equal(status.uploadsEnabled, false);
  assert.equal((await motionCTRequest(request(MOTION_CT_API + name, 'PUT', data, headers), bucket, index, closed)).status, 405);
  assert.equal(bucket.writes, 1);
});
