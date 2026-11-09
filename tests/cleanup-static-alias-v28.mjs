import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { cleanupStaticAliasRequest } from '../server/cleanup-static-alias-v28.mjs';

const root = new URL('../', import.meta.url);
const index = JSON.parse(await readFile(new URL('server/cleanup-static-alias-index-v28.json', root), 'utf8'));
const digest = data => createHash('sha256').update(data).digest('hex');

test('exact legacy allowlist redirects GET and HEAD within the same origin', () => {
  for (const [path, entry] of Object.entries(index)) {
    for (const method of ['GET', 'HEAD']) {
      const response = cleanupStaticAliasRequest(new Request('https://heart.example' + path + '?revision=27', { method }), index);
      assert.equal(response.status, 308);
      assert.equal(response.headers.get('location'), 'https://heart.example' + entry.target + '?revision=27');
      assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
      assert.equal(response.body, null);
    }
  }
});

test('unlisted paths and mutations are never intercepted; malformed aliases cannot redirect', () => {
  for (const path of ['/', '/assets/cleanup-v27/atrial.bits.gz', '/assets/cleanup-v26/rv.bits.gz',
    '/assets/cleanup-v28/rv.bits.gz', '/assets/cleanup-v27/rv.bits.gz/extra', '/api/fine-detail-v23/status']) {
    assert.equal(cleanupStaticAliasRequest(new Request('https://heart.example' + path), index), null);
  }
  const path = Object.keys(index)[0];
  for (const method of ['PUT', 'POST', 'DELETE', 'OPTIONS']) {
    assert.equal(cleanupStaticAliasRequest(new Request('https://heart.example' + path, { method }), index), null);
  }
  for (const target of ['https://elsewhere.example/secret', '/auth', '/assets/cleanup-v28/../rv.bits.gz']) {
    const response = cleanupStaticAliasRequest(new Request('https://heart.example' + path), {
      [path]: { ...index[path], target },
    });
    assert.equal(response.status, 500);
    assert.equal(response.headers.get('location'), null);
  }
});

test('each frozen old mask and retained canonical mask has the exact indexed bytes', async () => {
  assert.equal(Object.keys(index).length, 3);
  let savings = 0;
  for (const [path, entry] of Object.entries(index)) {
    const original = await readFile(new URL('public' + path, root));
    const canonical = await readFile(new URL('public' + entry.target, root));
    assert.deepEqual(original, canonical);
    assert.equal(original.length, entry.bytes);
    assert.equal(digest(original), entry.sha256);
    savings += original.length;
  }
  assert.equal(savings, 819741);
});

test('normal fetch follows legacy URLs to unchanged static GET/HEAD and conditional/range responses', async t => {
  const [path, entry] = Object.entries(index)[0];
  const bytes = await readFile(new URL('public' + entry.target, root));
  const seen = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1:' + server.address().port);
    const request = new Request(url, { method: req.method, headers: req.headers });
    const redirect = cleanupStaticAliasRequest(request, index);
    if (redirect) {
      res.writeHead(redirect.status, Object.fromEntries(redirect.headers));
      res.end();
      return;
    }
    if (url.pathname !== entry.target) { res.writeHead(404); res.end(); return; }
    seen.push({ method: req.method, query: url.search, range: req.headers.range, conditional: req.headers['if-none-match'] });
    res.setHeader('content-type', 'application/octet-stream');
    res.setHeader('cache-control', 'public, max-age=3600');
    res.setHeader('etag', '"' + entry.sha256 + '"');
    if (req.headers['if-none-match'] === '"' + entry.sha256 + '"') { res.writeHead(304); res.end(); return; }
    const body = req.headers.range === 'bytes=0-15' ? bytes.subarray(0, 16) : bytes;
    if (body.length !== bytes.length) { res.statusCode = 206; res.setHeader('content-range', 'bytes 0-15/' + bytes.length); }
    res.setHeader('content-length', body.length);
    res.end(req.method === 'HEAD' ? undefined : body);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = 'http://127.0.0.1:' + server.address().port + path + '?review=legacy';
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal(new URL(response.url).pathname, entry.target);
  assert.equal(response.headers.get('content-type'), 'application/octet-stream');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=3600');
  assert.equal(digest(Buffer.from(await response.arrayBuffer())), entry.sha256);
  const head = await fetch(url, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String(entry.bytes));
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  const conditional = await fetch(url, { headers: { 'if-none-match': '"' + entry.sha256 + '"' } });
  assert.equal(conditional.status, 304);
  const range = await fetch(url, { headers: { range: 'bytes=0-15' } });
  assert.equal(range.status, 206);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(0, 16));
  assert.deepEqual(seen.map(item => item.method), ['GET', 'HEAD', 'GET', 'GET']);
  assert.ok(seen.every(item => item.query === '?review=legacy'));
});
