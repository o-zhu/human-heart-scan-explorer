import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cleanupV30Request, cleanupV30UploadsEnabled } from '../server/cleanup-store-v30.mjs';

const name = 'pulmonary-lumen-v30.hfm.gz';
const api = '/api/cleanup-v30/';
const asset = '/assets/cleanup-v30/';
const bytes = new Uint8Array([31, 139, 1, 2, 3]);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const index = { [name]: { bytes: bytes.length, sha256, contentType: 'application/octet-stream' } };
const token = 'separate-reconstruction-cleanup-test-secret';
const req = (path, method = 'GET', key, body = bytes) => new Request('https://example.test' + path, {
  method, ...(method === 'PUT' ? { body } : {}), headers: key ? { 'X-Heart-Cleanup-Upload': key } : {},
});
function bucket() {
  const objects = new Map();
  return { objects,
    async head(k) { return objects.get(k) || null; },
    async get(k) { const a = objects.get(k); return a ? { ...a, body: new Blob([a.data]).stream() } : null; },
    async put(k, data, opts) { objects.set(k, { key: k, size: data.length, data: new Uint8Array(data), customMetadata: opts.customMetadata }); },
    async list() { return { objects: [...objects.values()], truncated: false }; },
  };
}

test('closed runtime gate cannot be reopened by a retained secret', async () => {
  assert.equal(cleanupV30UploadsEnabled, false);
  const b = bucket();
  assert.equal((await cleanupV30Request(req(api + name, 'PUT', token), b, index, { uploadToken: token })).status, 405);
  for (const key of [undefined, 'incorrect']) {
    assert.equal((await cleanupV30Request(req(api + name, 'PUT', key), b, index, { uploadsEnabled: true, uploadToken: token })).status, 403);
  }
  assert.equal(b.objects.size, 0);
});

test('seed writes require exact length/hash and cannot mutate existing objects', async () => {
  const b = bucket(), open = { uploadsEnabled: true, uploadToken: token };
  assert.equal((await cleanupV30Request(req(api + name, 'PUT', token, new Uint8Array([0])), b, index, open)).status, 400);
  assert.equal((await cleanupV30Request(req(api + name, 'PUT', token, new Uint8Array(bytes.length)), b, index, open)).status, 400);
  assert.equal((await cleanupV30Request(req(api + name, 'PUT', token), b, index, open)).status, 201);
  assert.equal((await cleanupV30Request(req(api + name, 'PUT', token), b, index, open)).status, 204);
  assert.equal(b.objects.has('hoa-heart/cleanup-v30/' + name), true);
  const inventory = await (await cleanupV30Request(req(api + 'status'), b, index)).json();
  assert.equal(inventory.complete, true);
  assert.equal(inventory.uploadsEnabled, false);
  b.objects.get('hoa-heart/cleanup-v30/' + name).customMetadata.sha256 = '0'.repeat(64);
  assert.equal((await cleanupV30Request(req(api + name, 'PUT', token), b, index, open)).status, 409);
});

test('verified public bytes, HEAD and conditional GET share exact immutable identity', async () => {
  const b = bucket();
  await cleanupV30Request(req(api + name, 'PUT', token), b, index, { uploadsEnabled: true, uploadToken: token });
  assert.equal(await cleanupV30Request(req(asset + name), b, index, { servePublic: false }), null);
  const response = await cleanupV30Request(req(asset + name + '?v=' + sha256.slice(0, 16)), b, index);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-content-sha256'), sha256);
  assert.equal(response.headers.get('content-encoding'), null, 'The client must receive opaque compressed bytes.');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  const head = await cleanupV30Request(req(asset + name, 'HEAD'), b, index);
  assert.equal(head.headers.get('etag'), response.headers.get('etag'));
  assert.equal(head.headers.get('content-length'), String(bytes.length));
  assert.equal(await head.text(), '');
  const cached = await cleanupV30Request(new Request('https://example.test' + asset + name, {
    headers: { 'If-None-Match': response.headers.get('etag') },
  }), b, index);
  assert.equal(cached.status, 304);
  b.objects.get('hoa-heart/cleanup-v30/' + name).customMetadata.sha256 = '0'.repeat(64);
  assert.equal((await cleanupV30Request(req(asset + name), b, index)).status, 503);
});

test('new bank cannot admit metadata, public writes, unlisted data or historical routes', async () => {
  const b = bucket(), open = { uploadsEnabled: true, uploadToken: token };
  for (const path of ['/assets/cleanup-v29/' + name, '/api/display-compact-v29/status', '/assets/ultra-volume-v7/manifest.json', '/', asset + 'surface-manifest.json']) {
    assert.equal(await cleanupV30Request(req(path), b, index), null);
  }
  assert.equal(await cleanupV30Request(req(asset + name, 'PUT', token), b, index, open), null);
  assert.equal((await cleanupV30Request(req(api + 'unlisted.gz', 'PUT', token), b, index, open)).status, 404);
  const jsonIndex = { 'surface-manifest.json': { bytes: bytes.length, sha256, contentType: 'application/json' } };
  assert.equal((await cleanupV30Request(req(api + 'surface-manifest.json', 'PUT', token), b, jsonIndex, open)).status, 500);
  assert.equal(b.objects.size, 0);
});
