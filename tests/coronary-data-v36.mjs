/** Production loader and gzip/predictor worker, with bounded in-memory files. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker as NodeWorker} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {CoronaryDataSource, CORONARY_LIMITS, validateCoronaryManifest} from '../public/coronary-data.js';

const hash = data => createHash('sha256').update(data).digest('hex');
const clone = value => structuredClone(value);
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(check) { for (let i = 0; i < 100; i++) { if (check()) return; await tick(); } throw new Error('Expected source state was not reached.'); }
const DONOR = 'ladaf-2021-17';

function bank() {
 const data = Uint8Array.from({length: 72}, (_, i) => (i * 37 + (i % 7) * 51) & 255), files = {}, parts = [];
 for (const [index, predictor] of ['none', 'delta-x', 'delta-z'].entries()) {
  const raw = data.slice(index * 24, (index + 1) * 24), encoded = raw.slice();
  if (predictor === 'delta-x') for (let row = 0; row < raw.length; row += 4) for (let x = 1; x < 4; x++) encoded[row + x] = (raw[row + x] - raw[row + x - 1]) & 255;
  if (predictor === 'delta-z') for (let i = 12; i < raw.length; i++) encoded[i] = (raw[i] - raw[i - 12]) & 255;
  const packed = new Uint8Array(gzipSync(encoded)), url = `./assets/coronary-v36/ladaf-fixture.raw.part-00${index}.gz`;
  files[url] = packed;
  parts.push({url, predictor, compressedBytes: packed.length, uncompressedBytes: raw.length, sha256: hash(packed), rawSha256: hash(raw)});
 }
 const profile = {donorId: DONOR, dimensions: [4, 3, 6], spacingUm: 317.6, sourceSpacingUm: 317.6,
  extent: [.6, 1, .4], threshold: .32, sourceWindow: [14640, 23545], processing: {method: 'transport fixture'},
  parts, compressedBytes: parts.reduce((sum, part) => sum + part.compressedBytes, 0), uncompressedBytes: data.length, rawSha256: hash(data)};
 return {data, files, manifest: {schemaVersion: 1, kind: 'coronary-reveal', donors: {[DONOR]: profile}}, profile};
}

function mockedLoader(fixture = bank(), options = {}) {
 const workers = [], fetches = [];
 class MockWorker {
  constructor(url, config) { this.url = url; this.config = config; workers.push(this); }
  postMessage(message) { this.message = message; }
  terminate() { this.terminated = true; }
  send(message) { this.onmessage?.({data: message}); }
 }
 const fetchImpl = options.fetchImpl || function (url, request) {
  assert.equal(this, globalThis, 'Native fetch must retain the Window/global receiver.');
  fetches.push({url, request}); return Promise.resolve(new Response(JSON.stringify(fixture.manifest)));
 };
 const source = new CoronaryDataSource({donorId: DONOR, fetchImpl, WorkerClass: options.WorkerClass || MockWorker});
 const ready = (worker, data = fixture.data) => worker.send({type: 'ready', donorId: DONOR, rawSha256: fixture.profile.rawSha256,
  data: data.slice().buffer});
 return {source, workers, fetches, fixture, ready};
}

const workerURL = new URL('../public/coronary-worker.js', import.meta.url).href;
const harness = `import {parentPort,workerData} from 'node:worker_threads';
import {webcrypto} from 'node:crypto';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
globalThis.self={postMessage:(message,transfer)=>parentPort.postMessage(message,transfer)};
globalThis.fetch=async function(input,options){
 if(this!==globalThis)throw new Error('Wrong fetch receiver');
 const parsed=new URL(input),key='.'+parsed.pathname.slice(parsed.pathname.indexOf('/assets/coronary-v36/'));
 const data=workerData.files[key];if(!data)return new Response('',{status:404});
 parentPort.postMessage({type:'fixture-fetch',url:key,redirect:options.redirect});
 let offset=0;const bytes=new Uint8Array(data);
 return new Response(new ReadableStream({pull(controller){if(offset===bytes.length){controller.close();return;}const end=Math.min(bytes.length,offset+7);controller.enqueue(bytes.subarray(offset,end));offset=end;}}));
};
await import(${JSON.stringify(workerURL)});
parentPort.on('message',message=>self.onmessage({data:message}));`;

function realLoader(fixture = bank()) {
 const requests = [], workers = [], manifestFetches = [], messages = [];
 class ActualWorker {
  constructor(url, options) {
   assert.equal(url.href, workerURL); assert.equal(options.type, 'module'); workers.push(this);
   this.thread = new NodeWorker(new URL('data:text/javascript,' + encodeURIComponent(harness)), {workerData: {files: fixture.files}});
   this.thread.on('message', message => {
    if (message.type === 'fixture-fetch') requests.push(message); else { messages.push(message); this.onmessage?.({data: message}); }
   });
   this.thread.on('error', error => this.onerror?.({message: error.message}));
  }
  postMessage(message) { this.thread.postMessage(message); }
  terminate() { this.terminated = true; void this.thread.terminate(); }
 }
 const source = new CoronaryDataSource({donorId: DONOR, WorkerClass: ActualWorker,
  fetchImpl: function (url) { assert.equal(this, globalThis); manifestFetches.push(url); return Promise.resolve(new Response(JSON.stringify(fixture.manifest))); }});
 return {source, workers, requests, manifestFetches, messages};
}

test('actual worker verifies all three predictors, returns exact source-derived bytes, and reuses only a completed cache', {timeout: 15000}, async () => {
 const fixture = bank(), original = fixture.data.slice(), f = realLoader(fixture), progress = [];
 try {
  const prepared = await f.source.prepare({onProgress: value => progress.push(value)});
  assert.deepEqual(prepared.data, original); assert.deepEqual(fixture.data, original);
  assert.equal(prepared.meta.donorId, DONOR); assert.equal(Object.isFrozen(prepared.meta.processing), true);
  assert.equal(f.requests.length, 3); assert.ok(f.requests.every(item => item.redirect === 'error'));
  assert.ok(progress.some(item => item.loaded === fixture.profile.compressedBytes));
  assert.equal(f.workers[0].terminated, true);
  const again = await f.source.prepare(); assert.equal(again, prepared); assert.equal(again.data, prepared.data);
  assert.equal(f.manifestFetches.length, 1); assert.equal(f.requests.length, 3); assert.equal(f.workers.length, 1);
 } finally { f.source.dispose(); }
});

test('identity, coordinate, namespace and allocation errors fail before any worker is constructed', async () => {
 const mutations = [
  f => { f.manifest.kind = 'other'; },
  f => { f.manifest.schemaVersion = 2; },
  f => { f.profile.donorId = 's-20-29'; },
  f => { f.profile.dimensions[0] = 4.5; },
  f => { f.profile.extent = [.4, 1, .6]; },
  f => { f.profile.spacingUm = [317.6, 317.6, 0]; },
  f => { f.profile.sourceWindow = [23545, 14640]; },
  f => { f.profile.threshold = 1.1; },
  f => { f.profile.processing = {}; },
  f => { f.profile.dimensions = [700, 700, 700]; f.profile.uncompressedBytes = 700 ** 3; },
  f => { f.profile.parts[0].url = 'https://fixture.invalid/assets/coronary-v36/remote.raw.part-000.gz'; },
  f => { f.profile.parts[0].url = './assets/coronary-v36/../outside.raw.part-000.gz'; },
  f => { f.profile.parts[0].url += '?download=1'; },
  f => { f.profile.parts[0].url = './assets/coronary-v36/%2e%2e.raw.part-000.gz'; },
  f => { f.profile.parts[1].url = f.profile.parts[0].url; },
  f => { f.profile.parts[0].predictor = 'delta-y'; },
  f => { f.profile.parts[0].uncompressedBytes++; f.profile.parts[1].uncompressedBytes--; },
  f => { f.profile.parts[0].compressedBytes = CORONARY_LIMITS.partBytes + 1; },
  f => { f.profile.rawSha256 = 'missing'; },
 ];
 for (const mutate of mutations) {
  const fixture = bank(); mutate(fixture); const f = mockedLoader(fixture);
  await assert.rejects(f.source.prepare()); assert.equal(f.workers.length, 0); assert.equal(f.source.cached, null); f.source.dispose();
 }
});

test('anisotropic source spacing uses source XYZ and the renderer XZY endpoint convention', () => {
 const fixture = bank(); fixture.profile.spacingUm = [100, 200, 300]; fixture.profile.extent = [.2, 1, 400 / 1500];
 assert.equal(validateCoronaryManifest(fixture.manifest, DONOR), fixture.profile);
 fixture.profile.extent = [.2, 400 / 1500, 1]; assert.throws(() => validateCoronaryManifest(fixture.manifest, DONOR), /coordinate extent/);
});

test('an oversized streaming manifest is stopped before parsing, buffering or creating a worker', async () => {
 let cancelled = false, produced = 0;
 const f = mockedLoader(bank(), {fetchImpl: async () => new Response(new ReadableStream({pull(controller) {
  produced += 32768; controller.enqueue(new Uint8Array(32768).fill(32));
 }, cancel() { cancelled = true; }}))});
 await assert.rejects(f.source.prepare(), /manifest exceeds/); assert.equal(cancelled, true);
 assert.ok(produced <= CORONARY_LIMITS.manifestBytes + 65536); assert.equal(f.workers.length, 0); f.source.dispose();
});

test('actual worker rejects encoded corruption, truncated/long transport, decoded corruption and whole-volume mismatch', {timeout: 20000}, async () => {
 const cases = [
  ['compressed checksum', f => { const part = f.profile.parts[0]; f.files[part.url][10] ^= 1; }],
  ['length did not match', f => { const part = f.profile.parts[0]; f.files[part.url] = f.files[part.url].subarray(0, -1); }],
  ['exceeds its declared length', f => { const part = f.profile.parts[0]; f.files[part.url] = new Uint8Array([...f.files[part.url], 0]); }],
  ['decoded part checksum', f => { f.profile.parts[1].rawSha256 = '0'.repeat(64); }],
  ['complete volume checksum', f => { f.profile.rawSha256 = '0'.repeat(64); }],
  ['exceeds its declared length', f => {
   const part = f.profile.parts[0], packed = new Uint8Array(gzipSync(new Uint8Array(part.uncompressedBytes + 1)));
   f.profile.compressedBytes += packed.length - part.compressedBytes; part.compressedBytes = packed.length; part.sha256 = hash(packed); f.files[part.url] = packed;
  }],
  ['length did not match', f => {
   const part = f.profile.parts[0], packed = new Uint8Array(gzipSync(new Uint8Array(part.uncompressedBytes - 1)));
   f.profile.compressedBytes += packed.length - part.compressedBytes; part.compressedBytes = packed.length; part.sha256 = hash(packed); f.files[part.url] = packed;
  }],
 ];
 for (const [expected, mutate] of cases) {
  const fixture = bank(); mutate(fixture); const f = realLoader(fixture);
  try { await assert.rejects(f.source.prepare(), new RegExp(expected)); assert.equal(f.source.cached, null); assert.equal(f.messages.some(message => message.type === 'ready'), false); }
  finally { f.source.dispose(); }
 }
});

test('a pre-aborted request does no fetch or work; abort also wins against an uncooperative manifest transport', async () => {
 const f = mockedLoader(), aborted = new AbortController(); aborted.abort();
 await assert.rejects(f.source.prepare({signal: aborted.signal}), {name: 'AbortError'}); assert.equal(f.fetches.length, 0);
 let release; const delayed = mockedLoader(bank(), {fetchImpl: () => new Promise(resolve => { release = resolve; })});
 const signal = new AbortController(), pending = delayed.source.prepare({signal: signal.signal}), rejected = assert.rejects(pending, {name: 'AbortError'});
 signal.abort(); await rejected; release(new Response(JSON.stringify(delayed.fixture.manifest))); await tick();
 assert.equal(delayed.workers.length, 0); assert.equal(delayed.source.cached, null); f.source.dispose(); delayed.source.dispose();
});

test('abort and supersede terminate workers; an old result cannot populate or replace the new cache', async () => {
 const f = mockedLoader(), firstAbort = new AbortController();
 const first = f.source.prepare({signal: firstAbort.signal}), firstRejected = assert.rejects(first, {name: 'AbortError'});
 await until(() => f.workers.length === 1); firstAbort.abort(); await firstRejected;
 assert.equal(f.workers[0].terminated, true); f.ready(f.workers[0]); assert.equal(f.source.cached, null);
 const second = f.source.prepare(), secondRejected = assert.rejects(second, {name: 'AbortError'});
 await until(() => f.workers.length === 2); const third = f.source.prepare(); await secondRejected;
 await until(() => f.workers.length === 3); assert.equal(f.workers[1].terminated, true);
 f.ready(f.workers[1]); assert.equal(f.source.cached, null); f.ready(f.workers[2]);
 const final = await third; assert.deepEqual(final.data, f.fixture.data); assert.equal(f.source.cached, final); f.source.dispose();
});

test('wrong donor, unexpected worker identity and wrong decoded lengths cannot become cached data', async () => {
 const f = mockedLoader(); await assert.rejects(f.source.prepare({donorId: 's-20-29'}), /donor identity/); assert.equal(f.fetches.length, 0);
 for (const bad of [{donorId: 's-20-29'}, {rawSha256: '0'.repeat(64)}, {data: new ArrayBuffer(71)}, {type: 'unknown'}]) {
  const pending = f.source.prepare(); await until(() => f.workers.at(-1)?.message && !f.workers.at(-1).terminated);
  f.workers.at(-1).send({type: 'ready', donorId: DONOR, rawSha256: f.fixture.profile.rawSha256, data: f.fixture.data.slice().buffer, ...bad});
  await assert.rejects(pending, /identity or length/); assert.equal(f.source.cached, null);
 }
 f.source.dispose();
});

test('failed worker is retryable, progress failures are isolated, and a detached cache triggers a fresh load', async () => {
 const f = mockedLoader(), first = f.source.prepare(); await until(() => f.workers.length === 1);
 f.workers[0].onerror({message: 'Fixture worker unavailable'}); await assert.rejects(first, /worker unavailable/);
 const retry = f.source.prepare({onProgress() { throw new Error('Fixture view disappeared'); }}); await until(() => f.workers.length === 2);
 f.workers[1].send({type: 'progress', loaded: 20}); f.ready(f.workers[1]); const prepared = await retry;
 structuredClone(prepared.data.buffer, {transfer: [prepared.data.buffer]}); assert.equal(prepared.data.byteLength, 0);
 const reloaded = f.source.prepare(); await until(() => f.workers.length === 3); f.ready(f.workers[2]);
 assert.deepEqual((await reloaded).data, f.fixture.data); f.source.dispose();
});
