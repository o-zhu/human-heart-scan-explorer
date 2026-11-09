import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, cp, rm, readdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import * as released from '../server/coronary-store-v36.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = await readFile(new URL('../server/coronary-store-v36.mjs', import.meta.url), 'utf8');
const helper = new URL('../server/comparison-display-store-v10.mjs', import.meta.url).href;
async function fixturePolicy(policy) {
  const code = source.replace("'./comparison-display-store-v10.mjs'", JSON.stringify(helper))
    .replace(/export const coronaryV36ReleasePolicy = '[^']+';/,
      `export const coronaryV36ReleasePolicy = 'coronary-v36:${policy}';`);
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}
const [unseeded, seed, final] = await Promise.all(['unseeded', 'seed', 'read-only'].map(fixturePolicy));
const api = '/api/coronary-v36/', asset = '/assets/coronary-v36/';
const prefix = 'hoa-heart/coronary-v36/';
const name = 'ladaf-derived.raw.part-000.gz';
const bytes = gzipSync(Buffer.from('Measured derivative fixture, unchanged compressed bytes.'));
const digest = value => createHash('sha256').update(value).digest('hex');
const entry = value => ({ bytes: value.length, sha256: digest(value), contentType: 'application/octet-stream' });
const index = { [name]: entry(bytes) };
const token = 'dedicated-coronary-test-token-with-at-least-32-bytes';
const open = { uploadsEnabled: true, uploadToken: token };
const req = (route, method = 'GET', key, body = bytes, headers = {}) => new Request('https://example.test' + route, {
  method,
  ...(['PUT', 'POST', 'PATCH'].includes(method) ? { body } : {}),
  headers: { ...(key ? { 'X-Heart-Coronary-Upload': key } : {}), ...headers },
});
function bucket() {
  const objects = new Map();
  return { objects, writes: 0,
    async head(key) { return objects.get(key) || null; },
    async get(key) { const object = objects.get(key); return object ? { ...object, body: new Blob([object.data]).stream() } : null; },
    async put(key, data, options) {
      this.writes++;
      objects.set(key, { key, size: data.length, data: new Uint8Array(data), customMetadata: { ...options.customMetadata } });
    },
    async list({ prefix: scope }) { return { objects: [...objects.values()].filter(object => object.key.startsWith(scope)), truncated: false }; },
  };
}

test('release markers drive exports and neither unseeded nor final code can be reopened', async () => {
  assert.match(released.coronaryV36ReleasePolicy, /^coronary-v36:(?:unseeded|seed|read-only)$/);
  assert.equal(released.coronaryV36UploadsEnabled, released.coronaryV36ReleasePolicy.endsWith(':seed'));
  assert.equal(released.coronaryV36PublicServingEnabled, released.coronaryV36ReleasePolicy.endsWith(':read-only'));
  for (const store of [unseeded, final]) {
    const b = bucket();
    for (const route of [api + name, api + 'unknown.raw.gz', api + 'status', asset + name]) {
      for (const method of ['PUT', 'POST', 'PATCH', 'DELETE']) {
        const response = await store.coronaryV36Request(req(route, method, token), b, index, open);
        assert.equal(response.status, 405);
        assert.equal(response.headers.get('x-heart-coronary-policy'), store.coronaryV36ReleasePolicy);
      }
    }
    assert.equal(b.writes, 0);
  }
});

test('seed mode requires its exact dedicated token and an explicit option gate', async () => {
  const b = bucket();
  for (const options of [{}, { uploadToken: token }, { uploadsEnabled: true },
    { uploadsEnabled: true, uploadToken: 'short' }, { uploadsEnabled: true, uploadToken: ' '.repeat(40) }]) {
    assert.equal((await seed.coronaryV36Request(req(api + name, 'PUT', token), b, index, options)).status, 405);
  }
  for (const key of [undefined, 'incorrect', 'x'.repeat(token.length)]) {
    assert.equal((await seed.coronaryV36Request(req(api + name, 'PUT', key), b, index, open)).status, 403);
  }
  assert.equal((await seed.coronaryV36Request(req(api + name, 'PUT', undefined, bytes,
    { 'X-Heart-Native-Upload': token, 'X-Heart-Cleanup-Upload': token }), b, index, open)).status, 403);
  assert.equal(b.writes, 0);
});

test('seed validates exact length/hash, is idempotent, and refuses immutable conflicts', async () => {
  const b = bucket();
  assert.equal((await seed.coronaryV36Request(req(api + name, 'PUT', token, bytes.subarray(1)), b, index, open)).status, 400);
  assert.equal((await seed.coronaryV36Request(req(api + name, 'PUT', token, new Uint8Array(bytes.length)), b, index, open)).status, 400);
  assert.equal((await seed.coronaryV36Request(req(api + name, 'PUT', token, bytes,
    { 'Content-Length': String(bytes.length + 1) }), b, index, open)).status, 400);
  assert.equal((await seed.coronaryV36Request(req(api + name, 'PUT', token), b, index, open)).status, 201);
  assert.equal((await seed.coronaryV36Request(req(api + name, 'PUT', token), b, index, open)).status, 204);
  assert.equal(b.writes, 1);
  const saved = b.objects.get(prefix + name);
  assert.equal(saved.customMetadata.collection, 'coronary-v36');
  assert.equal(saved.customMetadata.sourcePath, name);
  saved.customMetadata.sha256 = '0'.repeat(64);
  assert.equal((await seed.coronaryV36Request(req(api + name, 'PUT', token), b, index, open)).status, 409);
  assert.equal(b.writes, 1);
});

test('seed and unseeded binary public routes never fall through or serve data', async () => {
  const b = bucket();
  await seed.coronaryV36Request(req(api + name, 'PUT', token), b, index, open);
  for (const store of [unseeded, seed]) {
    for (const servePublic of [false, true]) {
      for (const route of [asset + name, asset + 'unlisted.raw.gz']) {
        assert.equal((await store.coronaryV36Request(req(route), b, index, { ...open, servePublic })).status, 503);
      }
    }
    assert.equal(await store.coronaryV36Request(req(asset + 'manifest.json'), b, index), null);
  }
  const readback = await seed.coronaryV36Request(req(api + name), b, index);
  assert.equal(readback.status, 200);
  assert.deepEqual(Buffer.from(await readback.arrayBuffer()), bytes);
});

test('final public GET/HEAD/conditional requests preserve exact opaque gzip identity', async () => {
  const b = bucket();
  await seed.coronaryV36Request(req(api + name, 'PUT', token), b, index, open);
  const response = await final.coronaryV36Request(req(asset + name + '?v=' + index[name].sha256.slice(0, 16)), b, index);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-content-sha256'), index[name].sha256);
  assert.equal(response.headers.get('x-heart-coronary-policy'), 'coronary-v36:read-only');
  assert.equal(response.headers.get('content-encoding'), null);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  const head = await final.coronaryV36Request(req(asset + name, 'HEAD'), b, index);
  assert.equal(head.headers.get('etag'), response.headers.get('etag'));
  assert.equal(head.headers.get('content-length'), String(bytes.length));
  assert.equal(await head.text(), '');
  const cached = await final.coronaryV36Request(req(asset + name, 'GET', undefined, bytes,
    { 'If-None-Match': response.headers.get('etag') }), b, index);
  assert.equal(cached.status, 304);
  const inventory = await (await final.coronaryV36Request(req(api + 'status'), b, index, open)).json();
  assert.equal(inventory.complete, true);
  assert.equal(inventory.uploadsEnabled, false);
  assert.equal(inventory.bytes, bytes.length);
  assert.equal(await final.coronaryV36Request(req(asset + name), b, index, { servePublic: false }), null);
  b.objects.get(prefix + name).customMetadata.sha256 = '0'.repeat(64);
  assert.equal((await final.coronaryV36Request(req(asset + name), b, index)).status, 503);
  assert.equal((await final.coronaryV36Request(req(asset + name, 'HEAD'), b, index)).status, 503);
});

test('only indexed bounded binary filenames enter this collection', async () => {
  const b = bucket();
  assert.equal((await seed.coronaryV36Request(req(api + 'unlisted.raw.gz', 'PUT', token), b, index, open)).status, 404);
  for (const badName of ['manifest.json', 'bad.webp', 'nested/file.raw.gz', 'UPPER.raw.gz']) {
    assert.equal((await seed.coronaryV36Request(req(api + badName, 'PUT', token), b,
      { [badName]: entry(bytes) }, open)).status, 500);
  }
  const oversize = { [name]: { ...entry(bytes), bytes: 4 * 1024 * 1024 + 1 } };
  assert.equal((await seed.coronaryV36Request(req(api + name, 'PUT', token), b, oversize, open)).status, 500);
  assert.equal((await final.coronaryV36Request(req(asset + 'unlisted.raw.gz'), b, index)).status, 404);
  assert.equal(b.writes, 0);
});

test('other routes and historical collection gates are untouched', async () => {
  const b = bucket();
  for (const route of ['/', '/assets/cleanup-v30/' + name, '/api/cleanup-v30/status',
    '/api/native-surface-v20/' + name, '/assets/ultra-volume-v7/manifest.json']) {
    assert.equal(await seed.coronaryV36Request(req(route, 'PUT', token), b, index, open), null);
  }
  assert.equal(b.writes, 0);
  const worker = await readFile(path.join(root, 'worker/index.ts'), 'utf8');
  assert.match(worker, /import coronaryV36Index from "\.\.\/server\/coronary-index-v36\.json"/);
  assert.match(worker, /coronaryV36Request\(request, env\.BUCKET, coronaryV36Index/);
  assert.match(worker, /HEART_CORONARY_V36_UPLOAD_TOKEN/);
  assert.match(worker, /if \(coronaryReconstruction\) return coronaryReconstruction/);
});

const prepare = path.join(root, 'scripts/prepare-coronary-hosting-v36.py');
function python(fixture, args) {
  return spawnSync('python3', [path.join(fixture, 'scripts/prepare-coronary-hosting-v36.py'), ...args], {
    encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
}
const record = (name, data) => ({ url: './assets/coronary-v36/' + name, compressedBytes: data.length,
  sha256: digest(data), uncompressedBytes: 32, rawSha256: 'a'.repeat(64) });
async function stagingFixture(policy = 'read-only', multipart = false) {
  const dir = await mkdtemp(path.join(tmpdir(), 'heart-coronary-v36-'));
  for (const child of ['scripts', 'server', 'public/assets/coronary-v36', 'dist/server']) await mkdir(path.join(dir, child), { recursive: true });
  await cp(prepare, path.join(dir, 'scripts/prepare-coronary-hosting-v36.py'));
  await writeFile(path.join(dir, 'server/coronary-store-v36.mjs'), source.replace(/coronary-v36:(?:unseeded|seed|read-only)/, 'coronary-v36:' + policy));
  const data = gzipSync(Buffer.from('The exact scalar derivative uses independent gzip slabs.'));
  const name0 = 'ladaf-derived.raw.part-000.gz';
  const name1 = 'ladaf-derived.raw.part-001.gz';
  let manifest;
  if (multipart) {
    const split = Math.ceil(data.length / 2);
    const parent = 'ladaf-derived.raw.gz';
    await writeFile(path.join(dir, 'public/assets/coronary-v36', parent), data);
    await writeFile(path.join(dir, 'public/assets/coronary-v36', name0), data.subarray(0, split));
    await writeFile(path.join(dir, 'public/assets/coronary-v36', name1), data.subarray(split));
    manifest = { surface: { ...record(parent, data), parts: [record(name0, data.subarray(0, split)), record(name1, data.subarray(split))] } };
  } else {
    await writeFile(path.join(dir, 'public/assets/coronary-v36', name0), data);
    await writeFile(path.join(dir, 'public/assets/coronary-v36', name1), bytes);
    manifest = { kind: 'coronary-reveal', donors: { ladaf: { predictor: 'delta-x', parts: [record(name0, data), record(name1, bytes)] } } };
  }
  await writeFile(path.join(dir, 'public/assets/coronary-v36/manifest.json'), JSON.stringify(manifest));
  await writeFile(path.join(dir, 'public/coronary-reveal-v36.js'), 'export const displayMode = "coronary";\n');
  const indexed = python(dir, ['--write-index']);
  assert.equal(indexed.status, 0, indexed.stderr);
  const writtenIndex = JSON.parse(await readFile(path.join(dir, 'server/coronary-index-v36.json'), 'utf8'));
  await cp(path.join(dir, 'public'), path.join(dir, 'dist/client'), { recursive: true });
  // Minimal compiled-worker fixture isolates staging checks from the framework
  // build; production Worker bundling is also checked by the release workflow.
  await writeFile(path.join(dir, 'dist/server/index.js'),
    `const policy = 'coronary-v36:${policy}';\nconst index = ${JSON.stringify(writtenIndex)};\n` +
    'const marker = "Coronary reconstruction data is read-only.";\n');
  return { dir, manifest, index: writtenIndex, names: [name0, name1] };
}

test('staging supports independent gzip slabs and keeps byte-identical JSON/runtime', async () => {
  const fixture = await stagingFixture();
  try {
    const result = python(fixture.dir, ['--stage']);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.objects, 2);
    assert.equal(report.multipartParentCount, 0);
    assert.equal(report.removedNewBuildCopies, 2);
    assert.equal(report.uploadsEnabled, false);
    assert.deepEqual(await readdir(path.join(fixture.dir, 'dist/client/assets/coronary-v36')), ['manifest.json']);
    for (const name of fixture.names) assert.ok((await readFile(path.join(fixture.dir, 'public/assets/coronary-v36', name))).length);
    assert.equal(await readFile(path.join(fixture.dir, 'dist/client/coronary-reveal-v36.js'), 'utf8'),
      await readFile(path.join(fixture.dir, 'public/coronary-reveal-v36.js'), 'utf8'));
    assert.equal(python(fixture.dir, ['--stage']).status, 0, 'Staging is idempotent.');
  } finally { await rm(fixture.dir, { recursive: true, force: true }); }
});

test('opaque multipart parents are verified but never included in the upload index', async () => {
  const fixture = await stagingFixture('read-only', true);
  try {
    assert.deepEqual(Object.keys(fixture.index), fixture.names);
    const result = python(fixture.dir, ['--stage']);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.multipartParentCount, 1);
    assert.equal(report.removedNewBuildCopies, 3);
    fixture.manifest.surface.parts.reverse();
    await writeFile(path.join(fixture.dir, 'public/assets/coronary-v36/manifest.json'), JSON.stringify(fixture.manifest));
    assert.notEqual(python(fixture.dir, ['--write-index']).status, 0, 'Reordering opaque parts must fail.');
  } finally { await rm(fixture.dir, { recursive: true, force: true }); }
});

test('staging requires explicit seed mode, correct compiled policy and complete identity before deletion', async () => {
  const fixture = await stagingFixture('seed');
  try {
    assert.notEqual(python(fixture.dir, ['--stage']).status, 0);
    const damaged = path.join(fixture.dir, 'dist/client/assets/coronary-v36', fixture.names[1]);
    const original = await readFile(damaged);
    await writeFile(damaged, Buffer.alloc(original.length));
    assert.notEqual(python(fixture.dir, ['--stage', '--seed']).status, 0);
    assert.ok((await readFile(path.join(fixture.dir, 'dist/client/assets/coronary-v36', fixture.names[0]))).length,
      'No earlier build copy is deleted when a later identity fails.');
    await writeFile(damaged, original);
    const compiled = path.join(fixture.dir, 'dist/server/index.js');
    const compiledOriginal = await readFile(compiled, 'utf8');
    await writeFile(compiled, compiledOriginal.replace('coronary-v36:seed', 'coronary-v36:read-only'));
    assert.notEqual(python(fixture.dir, ['--stage', '--seed']).status, 0);
    await writeFile(compiled, compiledOriginal);
    const result = python(fixture.dir, ['--stage', '--seed']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).publicServingEnabled, false);
  } finally { await rm(fixture.dir, { recursive: true, force: true }); }
});

test('unindexed gzip and oversized unsplit objects cannot enter the hosted archive', async () => {
  const fixture = await stagingFixture();
  try {
    await writeFile(path.join(fixture.dir, 'public/assets/coronary-v36/unlisted.raw.gz'), bytes);
    assert.notEqual(python(fixture.dir, ['--write-index']).status, 0);
    await rm(path.join(fixture.dir, 'public/assets/coronary-v36/unlisted.raw.gz'));
    const large = Buffer.alloc(4 * 1024 * 1024 + 1, 1);
    const largeName = 'large-derived.raw.gz';
    await writeFile(path.join(fixture.dir, 'public/assets/coronary-v36', largeName), large);
    fixture.manifest.extra = record(largeName, large);
    await writeFile(path.join(fixture.dir, 'public/assets/coronary-v36/manifest.json'), JSON.stringify(fixture.manifest));
    assert.notEqual(python(fixture.dir, ['--write-index']).status, 0);
  } finally { await rm(fixture.dir, { recursive: true, force: true }); }
});

test('staging cannot delete source files through a symbolic build alias', async () => {
  const fixture = await stagingFixture();
  try {
    const staged = path.join(fixture.dir, 'dist/client/assets/coronary-v36');
    const original = path.join(fixture.dir, 'public/assets/coronary-v36');
    await rm(staged, { recursive: true });
    await symlink(original, staged, 'dir');
    assert.notEqual(python(fixture.dir, ['--stage']).status, 0);
    for (const name of fixture.names) assert.ok((await readFile(path.join(original, name))).length);
  } finally { await rm(fixture.dir, { recursive: true, force: true }); }
});
