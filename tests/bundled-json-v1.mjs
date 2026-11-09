import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { bundledJsonRequest, BUNDLED_JSON_PATHS, BUNDLED_JSON_POLICY } from '../server/bundled-json-v1.mjs';

const index = JSON.parse(readFileSync(new URL('../server/bundled-json-index-v1.json', import.meta.url)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const request = (path, options) => new Request('https://heart.example'+path, options);
const serve = (path, options, bundle=index) => bundledJsonRequest(request(path, options), bundle, { servePublic: true });
const first = BUNDLED_JSON_PATHS[0];
const changed = patch => ({ ...index, files: { ...index.files, [first]: { ...index.files[first], ...patch } } });

test('all eight real payloads preserve exact original bytes, lengths and checksums', async t => {
  assert.equal(BUNDLED_JSON_PATHS.length, 8);
  assert.deepEqual(Object.keys(index.files), BUNDLED_JSON_PATHS);
  for (const path of BUNDLED_JSON_PATHS) await t.test(path, async () => {
    const original = readFileSync(new URL('../public'+path, import.meta.url));
    const response = await serve(path+'?revision=preserved');
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), original);
    assert.equal(response.headers.get('content-length'), String(original.length));
    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.equal(response.headers.get('content-encoding'), null);
    assert.equal(response.headers.get('x-content-sha256'), hash(original));
    assert.equal(response.headers.get('etag'), `"sha256-${hash(original)}"`);
    assert.equal(response.headers.get('cache-control'), 'private, max-age=0, must-revalidate');
    assert.equal(response.headers.get('x-heart-json-transport'), BUNDLED_JSON_POLICY);
  });
});

test('HEAD and matching strong, weak, list and wildcard validators retain correct semantics', async () => {
  const head = await serve(first, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(head.headers.get('content-length'), String(index.files[first].rawLength));
  const etag = head.headers.get('etag');
  for (const method of ['GET', 'HEAD']) for (const validator of [etag, 'W/'+etag, `"other", W/${etag}`, '*']) {
    const response = await serve(first, { method, headers: { 'if-none-match': validator } });
    assert.equal(response.status, 304);
    assert.equal(await response.text(), '');
    assert.equal(response.headers.get('content-length'), null);
    assert.equal(response.headers.get('etag'), etag);
  }
  const nonmatch = await serve(first, { headers: { 'if-none-match': '"unrelated"' } });
  assert.equal(nonmatch.status, 200);
  assert.equal((await nonmatch.arrayBuffer()).byteLength, index.files[first].rawLength);
});

test('only the exact allowlist is served, and dev/default mode and all write methods fall through', async () => {
  assert.equal(await bundledJsonRequest(request(first), index), null);
  assert.equal(await bundledJsonRequest(request(first), index, { servePublic: false }), null);
  const extra = { ...index, files: { ...index.files, '/assets/arbitrary.json': index.files[first] } };
  for (const path of ['/assets/arbitrary.json', '/assets/tte-atlas/media.json/more', '/api/bundled-json-v1/upload', '/%61ssets/tte-atlas/media.json']) {
    assert.equal(await serve(path, undefined, extra), null);
  }
  for (const method of ['PUT', 'POST', 'PATCH', 'DELETE', 'OPTIONS']) {
    assert.equal(await serve(first, { method, ...(method==='PUT'?{body:'untrusted upload'}:{}) }), null);
  }
});

test('missing, malformed, truncated and corrupt entries fail closed even for HEAD and 304', async () => {
  const invalid = [
    {},
    { ...index, schemaVersion: 2 },
    { ...index, files: {} },
    changed({ rawLength: 0 }),
    changed({ rawLength: 2*1024*1024+1 }),
    changed({ gzipLength: 1024*1024+1 }),
    changed({ gzipBase64: index.files[first].gzipBase64.slice(0,-4) }),
    changed({ gzipSha256: '0'.repeat(64) }),
    changed({ rawSha256: '0'.repeat(64) }),
    changed({ rawLength: index.files[first].rawLength-1 }),
  ];
  for (const bundle of invalid) for (const method of ['GET', 'HEAD']) {
    const response = await serve(first, { method, headers: { 'if-none-match': '*' } }, bundle);
    assert.equal(response.status, 500);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    if (method==='HEAD') assert.equal(await response.text(), '');
  }
});

test('decompression refuses an expansion beyond declared output and detects invalid gzip bytes', async () => {
  const raw = Buffer.alloc(256*1024, 32), compressed = gzipSync(raw);
  const oversized = changed({ rawLength: 16, rawSha256: hash(raw.subarray(0,16)), gzipLength: compressed.length, gzipSha256: hash(compressed), gzipBase64: compressed.toString('base64') });
  assert.equal((await serve(first, undefined, oversized)).status, 500);
  compressed[compressed.length-1] ^= 255;
  const broken = changed({ rawLength: raw.length, rawSha256: hash(raw), gzipLength: compressed.length, gzipSha256: hash(compressed), gzipBase64: compressed.toString('base64') });
  assert.equal((await serve(first, undefined, broken)).status, 500);
});

test('Worker integration precedes other routes and is production-only', () => {
  const worker = readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8');
  const call = worker.indexOf('await bundledJsonRequest(');
  assert.ok(call>0 && call<worker.indexOf('await cleanupV30Request('));
  assert.match(worker.slice(call, call+160), /servePublic:\s*!import\.meta\.env\.DEV/);
  assert.match(worker, /import bundledJsonIndex from "\.\.\/server\/bundled-json-index-v1\.json"/);
});
