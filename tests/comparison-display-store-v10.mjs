import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { comparisonDisplayRequest } from '../server/comparison-display-store-v10.mjs';

const PREFIX = 'hoa-heart/comparison-display-v10/';
const API = '/api/comparison-display-v10/';
const PUBLIC = '/assets/donors/';
const gzName = 'ucl-zcr-2627/volume/low-clean.raw.gz';
const imageName = 'ucl-zcr-2628/echo/long-axis.webp';
const data = Uint8Array.from({ length: 80 }, (_, i) => i * 3);
const imageData = Uint8Array.from({ length: 52 }, (_, i) => 255 - i);
const hash = value => createHash('sha256').update(value).digest('hex');
const entry = (value, contentType) => ({ bytes: value.length, sha256: hash(value), contentType });
const index = {
  [gzName]: entry(data, 'application/octet-stream'),
  [imageName]: entry(imageData, 'image/webp'),
};
const open = { uploadsEnabled: true };
const req = (path, method = 'GET', body, headers) => new Request(`https://heart.example${path}`, {
  method, ...(body === undefined ? {} : { body }), headers,
});
function bucket() {
  const objects = new Map();
  const calls = { head: 0, get: 0, put: 0, list: 0 };
  return {
    objects, calls,
    async head(key) { calls.head++; return objects.get(key) ?? null; },
    async get(key) {
      calls.get++;
      const stored = objects.get(key);
      return stored ? { ...stored, body: new Blob([stored.data]).stream() } : null;
    },
    async put(key, value, options) {
      calls.put++;
      const stored = new Uint8Array(value);
      objects.set(key, {
        key, size: stored.byteLength, data: stored,
        httpEtag: '"storage-etag-differs-from-sha"',
        httpMetadata: options.httpMetadata, customMetadata: options.customMetadata,
      });
    },
    async list({ prefix, cursor, include }) {
      calls.list++;
      assert.deepEqual(include, ['customMetadata']);
      const all = [...objects.values()].filter(object => object.key.startsWith(prefix));
      const start = Number(cursor ?? 0), end = start + 2;
      return { objects: all.slice(start, end), truncated: end < all.length, cursor: String(end) };
    },
  };
}
const seed = (b, name = gzName, body = data) => comparisonDisplayRequest(req(API + name, 'PUT', body), b, index, open);

test('Only exact indexed public GET/HEAD paths intercept the static asset route', async () => {
  for (const path of [
    '/', '/assets/donors/ucl-zcr-2627/manifest.json',
    '/assets/donors/ucl-zcr-2629/volume/low-clean.raw.gz',
    PUBLIC + gzName + '.bak', PUBLIC + 'toString',
    '/api/comparison-display-v100/' + gzName,
  ]) assert.equal(await comparisonDisplayRequest(req(path), null, index), null, path);
  assert.equal(await comparisonDisplayRequest(req(PUBLIC + gzName, 'PUT', data), null, index, open), null);
  assert.equal(await comparisonDisplayRequest(req(PUBLIC + gzName), null, index, { servePublic: false }), null);
  assert.equal((await comparisonDisplayRequest(req(API + 'unknown.webp'), null, index)).status, 404);
  assert.equal((await comparisonDisplayRequest(req(PUBLIC + gzName), null, index)).status, 503);
});

test('Uploads are closed by default and only use the explicit API', async () => {
  const b = bucket();
  assert.equal((await comparisonDisplayRequest(req(API + gzName, 'PUT'), b, index)).status, 405);
  assert.equal((await comparisonDisplayRequest(req(API + gzName, 'DELETE'), b, index, open)).status, 405);
  assert.equal((await comparisonDisplayRequest(req(API + 'unlisted.gz', 'PUT', data), b, index, open)).status, 404);
  assert.equal(b.calls.put, 0);
  // Local DEV keeps static public files but still permits deliberate seed API checks.
  assert.equal((await comparisonDisplayRequest(req(API + gzName, 'PUT', data), b, index, {
    uploadsEnabled: true, servePublic: false,
  })).status, 201);
});

test('Manifest size, content type and SHA are validated before a write', async () => {
  const b = bucket();
  for (const value of [data.subarray(1), new Uint8Array(data.length + 1), new Uint8Array(data.length)]) {
    assert.equal((await seed(b, gzName, value)).status, 400);
  }
  assert.equal((await comparisonDisplayRequest(req(API + gzName, 'PUT', data, {
    'content-length': String(data.length + 1),
  }), b, index, open)).status, 400);
  for (const invalid of [
    { bytes: 0 }, { bytes: 16 * 1024 * 1024 + 1 }, { bytes: 1.5 },
    { sha256: 'not-a-sha' }, { contentType: 'text/html' },
  ]) {
    const bad = { [gzName]: { ...index[gzName], ...invalid } };
    assert.equal((await comparisonDisplayRequest(req(API + gzName, 'PUT', data), b, bad, open)).status, 500);
  }
  assert.equal(b.calls.put, 0);
});

test('Streaming bodies cannot exceed the manifest length', async () => {
  const b = bucket();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(data);
      controller.enqueue(new Uint8Array([1]));
      controller.close();
    },
  });
  const request = new Request('https://heart.example' + API + gzName, {
    method: 'PUT', body, duplex: 'half',
  });
  assert.equal((await comparisonDisplayRequest(request, b, index, open)).status, 400);
  assert.equal(b.calls.put, 0);
});

test('Manifest-matched writes are idempotent and conflicting existing objects stay immutable', async () => {
  const b = bucket();
  assert.equal((await seed(b)).status, 201);
  assert.equal((await seed(b)).status, 204);
  assert.equal(b.calls.put, 1);
  const stored = b.objects.get(PREFIX + gzName);
  assert.equal(stored.customMetadata.sha256, index[gzName].sha256);
  assert.equal(stored.httpMetadata.contentType, 'application/octet-stream');
  assert.equal(stored.httpMetadata.contentEncoding, undefined);
  stored.customMetadata.sha256 = 'wrong';
  assert.equal((await seed(b)).status, 409);
  assert.equal(b.calls.put, 1);
});

test('Public and API reads return identical opaque bytes and manifest-defined headers', async () => {
  const b = bucket();
  await seed(b);
  await seed(b, imageName, imageData);
  for (const [name, expectedData] of [[gzName, data], [imageName, imageData]]) {
    for (const route of [PUBLIC, API]) {
      const response = await comparisonDisplayRequest(req(route + name + '?cache=v10'), b, index);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), index[name].contentType);
      assert.equal(response.headers.get('content-length'), String(expectedData.length));
      assert.equal(response.headers.get('x-content-sha256'), index[name].sha256);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('content-encoding'), null);
      assert.equal(response.headers.get('etag'), `"sha256-${index[name].sha256}"`);
      assert.equal(response.headers.get('cache-control'), 'private, max-age=0, must-revalidate');
      assert.deepEqual(new Uint8Array(await response.arrayBuffer()), expectedData);
      const head = await comparisonDisplayRequest(req(route + name, 'HEAD'), b, index);
      assert.equal(head.status, 200);
      assert.equal(head.headers.get('content-length'), String(expectedData.length));
      assert.equal((await head.arrayBuffer()).byteLength, 0);
    }
  }
});

test('SHA revalidation supports weak/list/wildcard validators without fetching the object body', async () => {
  const b = bucket();
  await seed(b);
  const etag = `"sha256-${index[gzName].sha256}"`;
  for (const validator of [etag, `W/${etag}`, `"unrelated", W/${etag}`, '*']) {
    const response = await comparisonDisplayRequest(req(PUBLIC + gzName, 'GET', undefined, {
      'if-none-match': validator,
    }), b, index);
    assert.equal(response.status, 304);
    assert.equal(response.headers.get('etag'), etag);
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  }
  assert.equal(b.calls.get, 0);
  const changed = await comparisonDisplayRequest(req(PUBLIC + gzName, 'GET', undefined, {
    'if-none-match': '"previous-sha"',
  }), b, index);
  assert.equal(changed.status, 200);
  assert.deepEqual(new Uint8Array(await changed.arrayBuffer()), data);
  assert.equal(b.calls.get, 1);
});

test('Missing or mismatched stored objects fail closed, including conditional GET', async () => {
  const b = bucket();
  assert.equal((await comparisonDisplayRequest(req(PUBLIC + gzName), b, index)).status, 503);
  await seed(b);
  const stored = b.objects.get(PREFIX + gzName);
  stored.size++;
  for (const method of ['GET', 'HEAD']) {
    assert.equal((await comparisonDisplayRequest(req(API + gzName, method), b, index)).status, 503);
  }
  stored.size--;
  stored.customMetadata.sha256 = 'wrong';
  assert.equal((await comparisonDisplayRequest(req(PUBLIC + gzName, 'GET', undefined, {
    'if-none-match': `"sha256-${index[gzName].sha256}"`,
  }), b, index)).status, 503);
});

test('Status walks every inventory page, verifies known objects and reports missing/mismatched entries', async () => {
  const b = bucket();
  await seed(b);
  await seed(b, imageName, imageData);
  b.objects.set(PREFIX + 'unlisted.gz', { key: PREFIX + 'unlisted.gz', size: 5, customMetadata: {} });
  let response = await comparisonDisplayRequest(req(API + 'status'), b, index);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  let status = await response.json();
  assert.deepEqual(status, {
    complete: true, expected: 2, verified: 2, bytes: 132, uploadsEnabled: false,
    missingCount: 0, mismatchCount: 0, missing: [], mismatched: [],
  });
  assert.equal(b.calls.list, 2);
  b.objects.get(PREFIX + gzName).customMetadata.sha256 = 'wrong';
  b.objects.delete(PREFIX + imageName);
  status = await (await comparisonDisplayRequest(req(API + 'status'), b, index, open)).json();
  assert.equal(status.complete, false);
  assert.equal(status.verified, 0);
  assert.equal(status.bytes, 0);
  assert.equal(status.uploadsEnabled, true);
  assert.deepEqual(status.missing, [imageName]);
  assert.deepEqual(status.mismatched, [gzName]);
});
