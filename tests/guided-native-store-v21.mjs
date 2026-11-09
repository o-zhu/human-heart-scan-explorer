import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { guidedNativeRequest as releasedGuidedNativeRequest, guidedNativeUploadsEnabled, GUIDED_NATIVE_API,
  GUIDED_NATIVE_PREFIX } from '../server/guided-native-store-v21.mjs';
import { nativeSurfaceUploadsEnabled } from '../server/native-surface-store-v20.mjs';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
// Exercise upload validation through an isolated seed fixture. The actual
// released module stays closed, including when its caller retains a secret.
const source = await readFile(new URL('../server/guided-native-store-v21.mjs', import.meta.url), 'utf8');
const seedSource = source.replace('export const guidedNativeUploadsEnabled = false;',
  'export const guidedNativeUploadsEnabled = true;');
assert.notEqual(source, seedSource, 'The released collection must have a false code gate');
const { guidedNativeRequest } = await import('data:text/javascript;base64,' + Buffer.from(seedSource).toString('base64'));
const origin = 'https://heart.test';
const token = 'guided-native-test-secret-'.repeat(3);
const payload = new Uint8Array(gzipSync('measured native surface checkpoint'));
const digest = data => createHash('sha256').update(data).digest('hex');
const hash = digest(payload);
const name = `tiles/35_30_36-${hash}.nbe.gz`;
const options = { uploadToken: token, uploadsEnabled: true };
const request = (method = 'GET', path = name, data = payload, secret = token, headers = {}) =>
  new Request(origin + GUIDED_NATIVE_API + path, { method,
    ...(method === 'PUT' ? { body: data } : {}),
    headers: { ...(method === 'PUT' && secret !== null ? { 'X-Heart-Guided-Upload': secret } : {}), ...headers },
  });

function bucket() {
  const objects = new Map();
  return { objects, puts: 0, heads: 0, gets: 0, beforePut: null,
    make(key, data, config) {
      const bytes = new Uint8Array(data);
      return { key, data: bytes, size: bytes.length,
        customMetadata: { ...config.customMetadata }, httpMetadata: { ...config.httpMetadata },
        checksums: { sha256: Uint8Array.from(Buffer.from(digest(bytes), 'hex')).buffer } };
    },
    async head(key) { this.heads++; return objects.get(key) || null; },
    async get(key) { this.gets++; const o = objects.get(key); return o && { ...o, body: new Blob([o.data]).stream() }; },
    async put(key, data, config) {
      this.puts++;
      assert.equal(config.onlyIf.get('If-None-Match'), '*');
      assert.equal(config.sha256, digest(data));
      assert.equal(config.httpMetadata.contentEncoding, undefined);
      this.beforePut?.(key, data, config);
      if (objects.has(key)) return null;
      const object = this.make(key, data, config);
      objects.set(key, object);
      return object;
    },
  };
}

test('The released code gate is closed and seed-fixture runtime access defaults to read-only', async () => {
  assert.equal(guidedNativeUploadsEnabled, false);
  assert.equal(nativeSurfaceUploadsEnabled, false);
  const b = bucket();
  for (const settings of [undefined, {}, { uploadToken: token },
    { uploadsEnabled: true }, { uploadsEnabled: true, uploadToken: 'short' },
    { uploadsEnabled: true, uploadToken: ' '.repeat(40) },
    { uploadsEnabled: false, uploadToken: token }]) {
    assert.equal((await guidedNativeRequest(request('PUT'), b, settings)).status, 405);
  }
  assert.equal(b.puts, 0);
});

test('An enabled public collection still requires its own matching upload secret', async () => {
  const b = bucket();
  for (const secret of [null, '', 'wrong', 'x'.repeat(token.length)]) {
    assert.equal((await guidedNativeRequest(request('PUT', name, payload, secret), b, options)).status, 403);
  }
  const r = request('PUT', name, payload, null, { 'X-Heart-Native-Upload': token });
  assert.equal((await guidedNativeRequest(r, b, options)).status, 403);
  assert.equal(b.puts, 0);
});

test('A final false code gate cannot be reopened by a retained token or caller option', async () => {
  const b = bucket();
  assert.equal(guidedNativeUploadsEnabled, false);
  assert.equal((await releasedGuidedNativeRequest(request('PUT'), b, options)).status, 405);
  assert.equal(b.puts, 0);
});

test('Content addressing verifies uploaded bytes and repeated identical uploads are idempotent', async () => {
  const b = bucket();
  assert.equal((await guidedNativeRequest(request('PUT', name, new Uint8Array([1,2,3])), b, options)).status, 400);
  assert.equal(b.objects.size, 0);
  assert.equal((await guidedNativeRequest(request('PUT'), b, options)).status, 201);
  assert.equal((await guidedNativeRequest(request('PUT'), b, options)).status, 204);
  assert.equal(b.puts, 1);
  assert.deepEqual([...b.objects.keys()], [GUIDED_NATIVE_PREFIX + name]);
  const object = b.objects.get(GUIDED_NATIVE_PREFIX + name);
  assert.equal(object.customMetadata.collection, 'guided-native-v21');
  object.customMetadata.sha256 = '0'.repeat(64);
  assert.equal((await guidedNativeRequest(request('PUT'), b, options)).status, 409);
  assert.equal(b.puts, 1);
});

test('The conditional put closes the race without replacing a conflicting winner', async () => {
  for (const same of [true, false]) {
    const b = bucket();
    b.beforePut = (key, data, config) => {
      const object = b.make(key, same ? data : new Uint8Array([9,8,7]), config);
      b.objects.set(key, object);
    };
    const response = await guidedNativeRequest(request('PUT'), b, options);
    assert.equal(response.status, same ? 204 : 409);
    const object = b.objects.get(GUIDED_NATIVE_PREFIX + name);
    assert.deepEqual(object.data, same ? payload : new Uint8Array([9,8,7]));
  }
});

test('GET and HEAD are public, preserve opaque gzip bytes, and support conditional reads', async () => {
  const b = bucket();
  await guidedNativeRequest(request('PUT'), b, options);
  const response = await releasedGuidedNativeRequest(request(), b);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-encoding'), null);
  assert.equal(response.headers.get('content-type'), 'application/octet-stream');
  assert.match(response.headers.get('cache-control'), /public.*immutable.*no-transform/);
  assert.equal(response.headers.get('x-content-sha256'), hash);
  assert.equal(response.headers.get('content-length'), String(payload.length));
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), payload);
  const head = await releasedGuidedNativeRequest(request('HEAD'), b);
  assert.equal(head.status, 200);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  const etag = response.headers.get('etag');
  for (const value of [etag, `W/${etag}`, '*', `"other", ${etag}`]) {
    const cached = await guidedNativeRequest(request('GET', name, payload, null, { 'If-None-Match': value }), b);
    assert.equal(cached.status, 304);
    assert.equal(cached.headers.get('content-length'), null);
  }
  const changed = await guidedNativeRequest(request('GET', name, payload, null, { 'If-None-Match': '"other"' }), b);
  assert.equal(changed.status, 200);
  assert.deepEqual(new Uint8Array(await changed.arrayBuffer()), payload);
});

test('Stored checksum or metadata corruption is never served or overwritten', async () => {
  for (const mutate of [o => { o.customMetadata.sourcePath = 'elsewhere'; },
    o => { o.checksums.sha256 = new Uint8Array(32).buffer; },
    o => { o.size = 4*1024*1024+1; }, o => { delete o.checksums.sha256; }]) {
    const b = bucket();
    await guidedNativeRequest(request('PUT'), b, options);
    mutate(b.objects.get(GUIDED_NATIVE_PREFIX+name));
    assert.equal((await guidedNativeRequest(request(), b)).status, 503);
    assert.equal((await guidedNativeRequest(request('HEAD'), b)).status, 503);
    assert.equal((await guidedNativeRequest(request('PUT'), b, options)).status, 409);
    assert.equal(b.puts, 1);
  }
});

test('Only bounded canonical tile coordinates and safe content-addressed object names are accepted', async () => {
  const b = bucket();
  for (const path of [`tiles/60_0_0-${hash}.nbe.gz`, `tiles/0_60_0-${hash}.nbe.gz`,
    `tiles/0_0_67-${hash}.nbe.gz`, `tiles/-1_0_0-${hash}.nbe.gz`, `tiles/01_0_0-${hash}.nbe.gz`,
    `tiles/1_2_3-${hash.toUpperCase()}.nbe.gz`, `tiles/1_2_3-${hash}.nbe.gz/extra`,
    `tiles%2f1_2_3-${hash}.nbe.gz`, `overview/_bad-${hash}.hfm.gz`,
    `overview/${'x'.repeat(81)}-${hash}.hfm.gz`, `overview/a.b-${hash}.hfm.gz`,
    `overview/%2fsecret-${hash}.hfm.gz`, `manifest-${hash}.json`, `${name}?alternate=1`, 'status']) {
    assert.equal((await guidedNativeRequest(request('PUT', path), b, options)).status, 404, path);
  }
  for (const path of [`tiles/0_0_0-${hash}.nbe.gz`, `tiles/59_59_66-${hash}.nbe.gz`,
    `overview/whole_lod-0-${hash}.hfm.gz`, `manifest-${hash}.json.gz`]) {
    assert.equal((await guidedNativeRequest(request('PUT', path), b, options)).status, 201, path);
  }
});

test('Tile and larger-object limits are enforced before storage, including unbounded request bodies', async () => {
  const b = bucket();
  for (const [path, limit] of [[name, 4*1024*1024], [`manifest-${hash}.json.gz`, 32*1024*1024],
    [`overview/whole-${hash}.hfm.gz`, 32*1024*1024]]) {
    assert.equal((await guidedNativeRequest(request('PUT', path, payload, token,
      { 'Content-Length': String(limit+1) }), b, options)).status, 413);
  }
  for (const declared of ['0', '-1', 'NaN', '1.5', '01']) {
    assert.equal((await guidedNativeRequest(request('PUT', name, payload, token,
      { 'Content-Length': declared }), b, options)).status, 400);
  }
  assert.equal((await guidedNativeRequest(request('PUT', name, payload, token,
    { 'Content-Length': String(payload.length+1) }), b, options)).status, 400);
  assert.equal((await guidedNativeRequest(request('PUT', name, new Uint8Array(4*1024*1024+1)), b, options)).status, 413);
  assert.equal((await guidedNativeRequest(request('PUT', name, new Uint8Array()), b, options)).status, 400);
  assert.equal(b.puts, 0);
});

test('Unsupported methods, absent objects, missing storage, and unrelated routes fail safely', async () => {
  const b = bucket();
  assert.equal((await guidedNativeRequest(request(), b)).status, 404);
  assert.equal((await guidedNativeRequest(request(), null)).status, 503);
  for (const method of ['POST', 'DELETE', 'PATCH', 'OPTIONS']) {
    assert.equal((await guidedNativeRequest(request(method), b, options)).status, 405);
  }
  for (const path of ['/api/native-surface-v20/native.hfm.gz', '/api/comparison-display-v10/x.gz',
    '/assets/donors/s-20-29/x.gz', '/api/guided-native-v210/test']) {
    assert.equal(await guidedNativeRequest(new Request(origin+path), b, options), null);
  }
  b.head = async () => { throw new Error('storage internals'); };
  const response = await guidedNativeRequest(request('HEAD'), b);
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /storage internals/);
});
