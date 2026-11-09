/** Actual control markup and click lifecycle; no network or graphics claims. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {CoronaryControls} from '../public/coronary-controls.js';
import {EchoModule} from '../public/echo.js';

const {parseHTML} = await import(pathToFileURL(process.argv[2] || '/tmp/heart-review-test-deps/node_modules/linkedom/esm/index.js'));
const html = await readFile(new URL('../page.html', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(check) { for (let i = 0; i < 20; i++) { if (check()) return; await tick(); } throw new Error('Expected control state was not reached.'); }

function fixture(options = {}) {
 const {document, window} = parseHTML(html), requests = [], committed = [], discarded = [], changes = [];
 const renderer = {
  camera: {yaw: .37, pitch: -.29, distance: 1.65, pan: [0, .1, -.1]},
  settings: {mode: 0, threshold: .371, coronaryReveal: false, clipAxis: 1, clipPosition: .41,
   clipFlip: 1, palette: 4, windowEnabled: true, windowLow: .16, windowHigh: .89,
   windowGamma: .7, capContrast: 1.2, cleanupEnabled: true, surfaceSmoothing: .19},
  data: new Uint8Array([0, 82, 176, 249]), cap: {data: new Uint8Array([12, 156]), width: 2, height: 1},
  fineSurface: {enabled: true, lod: {id: 'gentle'}},
  set(patch) { Object.assign(this.settings, patch); }
 };
 const controller = new CoronaryControls({renderer, document,
  prepare: options.prepare || (context => new Promise((resolve, reject) => requests.push({...context, resolve, reject}))),
  commit: options.commit || (value => committed.push(value)), discard: value => discarded.push(value),
  onChange: active => changes.push(active), onIntent: options.onIntent,
  context: {donorId: 'ladaf-2021-17', workspace: 'reconstruction', supported: options.supported !== false, samplingLabel: '317.6 µm Source Sampling.'}
 });
 const main = document.querySelector('#viewport [data-coronary-controls]');
 const click = (scope = main) => scope.querySelector('[data-coronary-label]').dispatchEvent(new window.Event('click', {bubbles: true, cancelable: true}));
 const mountEcho = () => {
  document.getElementById('echoPanel').innerHTML = EchoModule.prototype.template.call({fineLabel: '79.4 µm'});
  controller.sync(); return document.querySelector('#echoPanel [data-coronary-controls]');
 };
 return {document, window, renderer, controller, main, requests, committed, discarded, changes, click, mountEcho};
}

function savedView(renderer) {
 const {coronaryReveal, ...settings} = renderer.settings;
 return {settings: structuredClone(settings), camera: structuredClone(renderer.camera), source: renderer.data.slice(), cap: renderer.cap,
  fineSurface: renderer.fineSurface, fineEnabled: renderer.fineSurface.enabled};
}

test('Reveal commits once ready; Restore preserves exact threshold, camera, clip, window, cleanup, source and fine choice', async () => {
 const f = fixture(), before = savedView(f.renderer);
 f.click(); await until(() => f.requests.length === 1);
 assert.equal(f.controller.loading, true); assert.equal(f.renderer.settings.coronaryReveal, false);
 assert.equal(f.main.querySelector('button').getAttribute('aria-pressed'), 'false');
 assert.equal(f.main.querySelector('[data-coronary-label]').textContent, 'Cancel Preparation');
 assert.deepEqual(savedView(f.renderer), before);
 f.requests[0].onProgress({loaded: 52, total: 100});
 assert.match(f.main.querySelector('[data-coronary-status]').textContent, /50%/);
 const prepared = {field: new Uint8Array([0, 71, 160, 249])};
 const pending = f.controller.pending; f.requests[0].resolve(prepared); assert.equal(await pending, true);
 assert.deepEqual(f.committed, [prepared]); assert.equal(f.renderer.settings.coronaryReveal, true);
 assert.equal(f.controller.loading, false); assert.equal(f.controller.error, '');
 assert.equal(f.main.querySelector('[data-coronary-label]').textContent, 'Restore Surface Tissue');
 assert.equal(f.main.querySelector('button').getAttribute('aria-pressed'), 'true');
 assert.equal(f.main.querySelector('[data-coronary-status]').hidden, true);
 assert.match(f.main.querySelector('button').title, /intensity-based/);
 assert.match(f.main.querySelector('button').title, /317\.6 µm/);
 assert.deepEqual(savedView(f.renderer), before);
 f.click(); assert.equal(f.renderer.settings.coronaryReveal, false);
 assert.equal(f.main.querySelector('[data-coronary-label]').textContent, 'Reveal Coronaries');
 assert.deepEqual(savedView(f.renderer), before);
 assert.equal(f.changes.at(-1), false); f.controller.dispose();
});

test('late Echo mount gets one synchronized control beside the 3D controls, never in ultrasound', async () => {
 const f = fixture(); assert.equal(f.document.querySelectorAll('[data-coronary-controls]').length, 1);
 const echo = f.mountEcho(); f.controller.sync(); f.controller.sync();
 assert.equal(f.document.querySelectorAll('[data-coronary-controls]').length, 2);
 assert.ok(echo.closest('.echo-view-column')); assert.equal(f.document.querySelector('.echo-cine [data-coronary-controls]'), null);
 f.controller.setContext({workspace: 'echo'}); f.click(echo); await until(() => f.requests.length === 1);
 const pending = f.controller.pending; f.requests[0].resolve({id: 'prepared'}); await pending;
 for (const control of f.document.querySelectorAll('[data-coronary-controls]')) {
  assert.equal(control.querySelector('button').getAttribute('aria-pressed'), 'true');
  assert.equal(control.querySelector('[data-coronary-label]').textContent, 'Restore Surface Tissue');
 }
 f.controller.setContext({workspace: 'reconstruction'}); f.click();
 assert.equal(echo.querySelector('button').getAttribute('aria-pressed'), 'false'); f.controller.dispose();
});

test('a pending button cancels immediately and a late transport result can never activate it', async () => {
 const f = fixture(); f.click(); await until(() => f.requests.length === 1);
 const pending = f.controller.pending, first = f.requests[0]; f.click();
 assert.equal(first.signal.aborted, true); assert.equal(f.controller.loading, false);
 assert.equal(f.main.querySelector('[data-coronary-status]').hidden, true);
 const late = {id: 'late'}; first.resolve(late); assert.equal(await pending, false);
 assert.deepEqual(f.committed, []); assert.deepEqual(f.discarded, [late]);
 assert.equal(f.renderer.settings.coronaryReveal, false); f.controller.dispose();
});

test('only an explicit toggle consumes deferred restore intent; programmatic enable and suspension do not', async () => {
 let intents = 0;
 const f = fixture({onIntent: () => { intents++; }}), automatic = f.controller.enable();
 await until(() => f.requests.length === 1); assert.equal(intents, 0);
 f.controller.setContext({workspace: 'echo'}); f.requests[0].resolve({id: 'stale'}); await automatic;
 assert.equal(intents, 0); f.click(); await until(() => f.requests.length === 2); assert.equal(intents, 1);
 const pending = f.controller.pending; f.click(); assert.equal(intents, 2);
 f.requests[1].resolve({id: 'cancelled'}); await pending;
 f.controller.exit(); f.controller.sync(); assert.equal(intents, 2); f.controller.dispose();
});

test('tab changes cancel pending work and old completion cannot defeat a new request', async () => {
 const f = fixture(); const old = f.controller.enable(); await until(() => f.requests.length === 1);
 f.controller.setContext({workspace: 'echo'}); assert.equal(f.requests[0].signal.aborted, true);
 const latest = f.controller.enable(); await until(() => f.requests.length === 2);
 f.requests[0].resolve({id: 'old'}); assert.equal(await old, false);
 assert.equal(f.controller.loading, true); assert.equal(f.renderer.settings.coronaryReveal, false);
 f.requests[1].resolve({id: 'new'}); assert.equal(await latest, true);
 assert.deepEqual(f.committed, [{id: 'new'}]); assert.deepEqual(f.discarded, [{id: 'old'}]); f.controller.dispose();
});

test('failed preparation leaves the current model available and Retry uses a fresh request', async () => {
 const f = fixture(), before = savedView(f.renderer), pending = f.controller.enable();
 await until(() => f.requests.length === 1); f.requests[0].reject(new Error('Fixture transfer interrupted')); assert.equal(await pending, false);
 assert.equal(f.controller.error, 'Fixture transfer interrupted'); assert.equal(f.controller.loading, false);
 assert.equal(f.renderer.settings.coronaryReveal, false); assert.deepEqual(savedView(f.renderer), before);
 assert.equal(f.main.querySelector('[data-coronary-label]').textContent, 'Retry Coronary View');
 assert.equal(f.main.querySelector('[data-coronary-status]').hidden, false);
 f.click(); await until(() => f.requests.length === 2); const retry = f.controller.pending;
 assert.equal(f.controller.error, ''); f.requests[1].resolve({id: 'recovered'}); assert.equal(await retry, true);
 assert.equal(f.main.querySelector('[data-coronary-status]').hidden, true); assert.equal(f.renderer.settings.coronaryReveal, true); f.controller.dispose();
});

test('synchronous preparation and commit failures remain recoverable without active-state claims', async () => {
 const setup = fixture({prepare() { throw new Error('Fixture setup failed'); }});
 assert.equal(await setup.controller.enable(), false); assert.equal(setup.controller.loading, false);
 assert.equal(setup.controller.pending, null); assert.match(setup.controller.error, /setup failed/);
 assert.equal(setup.renderer.settings.coronaryReveal, false); setup.controller.dispose();
 const f = fixture({commit() { throw new Error('Fixture GPU allocation failed'); }}), before = savedView(f.renderer);
 const pending = f.controller.enable(); await until(() => f.requests.length === 1);
 f.requests[0].resolve({id: 'not-committed'}); assert.equal(await pending, false);
 assert.equal(f.renderer.settings.coronaryReveal, false); assert.deepEqual(savedView(f.renderer), before);
 assert.deepEqual(f.discarded, [{id: 'not-committed'}]); assert.match(f.controller.error, /allocation failed/); f.controller.dispose();
});

test('explicit threshold or Detail exit cancels pending work and cannot overwrite a newer threshold', async () => {
 const f = fixture(), pending = f.controller.enable(); await until(() => f.requests.length === 1);
 f.controller.exit(); f.renderer.set({threshold: .43});
 f.requests[0].resolve({id: 'late'}); assert.equal(await pending, false);
 assert.equal(f.renderer.settings.threshold, .43); assert.equal(f.renderer.settings.coronaryReveal, false);
 assert.deepEqual(f.committed, []); f.controller.dispose();
});

test('successful preference is suspended in labs, resumes in Echo, and is cleared for another donor', async () => {
 const f = fixture(), pending = f.controller.enable(); await until(() => f.requests.length === 1);
 f.requests[0].resolve({id: 'prepared'}); await pending;
 for (const workspace of ['probe', 'tee']) {
  f.controller.setContext({workspace}); assert.equal(f.renderer.settings.coronaryReveal, true);
  assert.equal(f.controller.active, false); assert.equal(f.main.hidden, true);
  assert.equal(await f.controller.enable(), false); assert.equal(f.requests.length, 1);
 }
 f.controller.setContext({workspace: 'echo'}); assert.equal(f.controller.active, true); assert.equal(f.main.hidden, false);
 f.controller.setContext({donorId: 'slicerheart-4d', supported: false});
 assert.equal(f.renderer.settings.coronaryReveal, false); assert.equal(f.main.hidden, true); f.controller.dispose();
});

test('unsupported source/backend never offers a no-op mode, and translucent mode cannot activate it', async () => {
 const unsupported = fixture({supported: false}); assert.equal(unsupported.main.hidden, true);
 assert.equal(await unsupported.controller.enable(), false); assert.equal(unsupported.requests.length, 0); unsupported.controller.dispose();
 const f = fixture(); f.renderer.set({mode: 1}); f.controller.sync();
 assert.equal(f.main.querySelector('button').disabled, true);
 assert.match(f.main.querySelector('button').title, /Whole Organ or Cutaway/);
 assert.equal(await f.controller.enable(), false); assert.equal(f.requests.length, 0); f.controller.dispose();
});

test('a donor change or dispose invalidates late work and removes active click handlers', async () => {
 const f = fixture(), pending = f.controller.enable(); await until(() => f.requests.length === 1);
 f.controller.setContext({donorId: 's-20-29', supported: false});
 assert.equal(f.requests[0].signal.aborted, true); f.requests[0].resolve({id: 'other-donor'}); await pending;
 assert.deepEqual(f.committed, []); assert.equal(f.renderer.settings.coronaryReveal, false);
 f.controller.setContext({donorId: 'ladaf-2021-17', supported: true});
 const second = f.controller.enable(); await until(() => f.requests.length === 2); f.controller.dispose();
 assert.equal(f.requests[1].signal.aborted, true); f.requests[1].resolve({id: 'disposed'}); assert.equal(await second, false);
 assert.equal(f.main.hidden, true); f.click(); await tick(); assert.equal(f.requests.length, 2); assert.deepEqual(f.committed, []);
});
