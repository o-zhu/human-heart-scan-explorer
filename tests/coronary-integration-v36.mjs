/** Actual app boot/tab/DOM handlers, reusing the established I/O boot fixture.
 * The release gate is injected per case; source preparation and GPU allocation
 * are controlled dependencies. Binary verification has its own worker suite.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {activeCoronaryField} from '../public/coronary-rendering.js';

const fixtureURL = new URL('./app-boot-v8.mjs', import.meta.url);
const fixtureText = await readFile(fixtureURL, 'utf8');
const harnesses = new Map();
async function harness(ready) {
 if (harnesses.has(ready)) return harnesses.get(ready);
 let text = fixtureText.slice(0, fixtureText.indexOf("test('Automatic download"));
 text = text.replace("import {CORONARY_REVEAL_READY} from '../public/coronary-release.js';", `const CORONARY_REVEAL_READY=${ready};`);
 text = text.replace("import {CoronaryDataSource} from '../public/coronary-data.js';", `
 class CoronaryDataSource {
  constructor({donorId}){this.donorId=donorId;this.requests=[];}
  prepare({signal,onProgress}){return new Promise((resolve,reject)=>{
   const abort=()=>reject(new DOMException('Fixture cancelled','AbortError'));
   signal.addEventListener('abort',abort,{once:true});
   const finish=()=>{signal.removeEventListener('abort',abort);resolve({data:new Uint8Array(125).fill(150),meta:{donorId:this.donorId,dimensions:[5,5,5],extent:[1,1,1],threshold:.5,sourceSpacingUm:317.6,rawSha256:'a'.repeat(64)}});};
   this.requests.push({signal,onProgress,finish});if(signal.aborted)abort();
  });}
  dispose(){}
 }
 `);
 text = text.replace('const domPath=process.argv[2];', "const domPath=process.argv[2]||'/tmp/heart-review-test-deps/node_modules/linkedom/esm/index.js';");
 text = text.replace('return {main,loadLevel,switchTab,ensureModuleData,', `return {main,loadLevel,switchTab,ensureModuleData,
  coronary(){return {controls:coronaryControls,source:coronarySource,pendingRestore:restoredCoronary,ready:coronaryRestoreReady};},
  installNative(controller){nativeMainDetailController=controller;},
  cleanup(enabled){return setCleanupMode(enabled);},
  detailChoice(){cancelCoronaryRestore();},
 `);
 text = text.replace('close(){volumeLoader.cancel();', 'close(){coronaryControls?.dispose();coronarySource?.dispose();volumeLoader.cancel();');
 text = text.replace(/from '(\.\.?\/[^']+)'/g, (_, path) => `from '${new URL(path, fixtureURL).href}'`);
 text = text.replaceAll('import.meta.url', JSON.stringify(fixtureURL.href));
 text += '\nexport {environment,firstPreview,until};\n';
 const module = await import('data:text/javascript,' + encodeURIComponent(text));
 harnesses.set(ready, module); return module;
}

async function environment(options = {}, ready = true) {
 const h = await harness(ready), e = h.environment(options);
 e.renderer.gl = {};
 const load = e.renderer.load;
 e.renderer.load = function (data, meta) { this.data = data; this.dimensions = meta.dimensions; load.call(this, data, meta); };
 e.renderer.setCoronaryData = function (data, meta) { this.coronaryField = {data, meta, texture: {fixture: true}}; };
 e.renderer.coronaryActive = function () { return activeCoronaryField(this); };
 return {...e, firstPreview: () => h.firstPreview(e), until: h.until};
}

const input = (e, id, value) => {
 const element = e.document.getElementById(id); element.value = String(value);
 element.dispatchEvent(new e.window.Event('input', {bubbles: true}));
};
const toggle = e => e.document.querySelector('[data-coronary-label]').dispatchEvent(new e.window.Event('click', {bubbles: true, cancelable: true}));
async function finishBoot(e) {
 const {boot} = await e.firstPreview(); e.finishCleanup(); e.workers[1].finish(); await boot;
}

test('seed release stays hidden and cannot restore or download a prepared field', async () => {
 const e = await environment({saved: {module: 'reconstruction', settings: {coronaryReveal: true}}}, false);
 try {
  await finishBoot(e); const state = e.api.coronary();
  assert.equal(state.controls.available, false); assert.equal(state.source.requests.length, 0);
  assert.equal(e.document.querySelector('[data-coronary-controls]').hidden, true);
  assert.notEqual(e.renderer.settings.coronaryReveal, true);
 } finally { e.close(); }
});

test('a newer manual threshold or Detail choice defeats a saved reveal while base detail is still loading', async () => {
 for (const choice of ['threshold', 'detail']) {
  const e = await environment({saved: {module: 'reconstruction', settings: {coronaryReveal: true, threshold: .37}}});
  try {
   const {boot} = await e.firstPreview();
   assert.equal(e.api.coronary().pendingRestore, true); assert.equal(e.api.coronary().source.requests.length, 0);
   if (choice === 'threshold') input(e, 'threshold', .43); else e.api.detailChoice();
   e.workers[1].finish(); await boot;
   assert.equal(e.api.coronary().pendingRestore, false); assert.equal(e.api.coronary().source.requests.length, 0);
   assert.notEqual(e.renderer.settings.coronaryReveal, true);
   if (choice === 'threshold') assert.equal(e.renderer.settings.threshold, .43);
  } finally { e.close(); }
 }
});

test('clicking Reveal then Cancel before startup completes cannot be undone by deferred restoration', async () => {
 const e = await environment({saved: {module: 'reconstruction', settings: {coronaryReveal: true}}});
 try {
  const {boot} = await e.firstPreview(); toggle(e);
  await e.until(() => e.api.coronary().source.requests.length === 1);
  assert.equal(e.renderer.coronaryPreparing, true); toggle(e);
  assert.equal(e.api.coronary().source.requests[0].signal.aborted, true); assert.equal(e.renderer.coronaryPreparing, false);
  e.workers[1].finish(); await boot;
  assert.equal(e.api.coronary().source.requests.length, 1); assert.equal(e.api.coronary().pendingRestore, false);
  assert.notEqual(e.renderer.settings.coronaryReveal, true);
 } finally { e.close(); }
});

test('a shared lab keeps reveal intent deferred, then activates on return and survives Echo/lab round trips', async () => {
 const e = await environment({saved: {module: 'probe', probe: {preset: 'plax'}, settings: {coronaryReveal: true, threshold: .37}}});
 try {
  await finishBoot(e); assert.equal(e.api.state().currentTab, 'probe');
  assert.equal(e.api.coronary().pendingRestore, true); assert.equal(e.api.coronary().source.requests.length, 0);
  e.api.switchTab('reconstruction'); await e.until(() => e.api.coronary().source.requests.length === 1);
  e.api.coronary().source.requests[0].finish(); await e.until(() => e.renderer.settings.coronaryReveal === true);
  assert.equal(e.api.coronary().pendingRestore, false); assert.ok(e.renderer.coronaryActive());
  const camera = structuredClone(e.renderer.camera), threshold = e.renderer.settings.threshold;
  const echo = e.api.switchTab('echo'); e.finishEcho(); await echo;
  assert.ok(e.renderer.coronaryActive()); await e.api.switchTab('probe');
  assert.equal(e.renderer.settings.coronaryReveal, true); assert.equal(e.renderer.coronaryActive(), null);
  e.api.switchTab('reconstruction'); assert.ok(e.renderer.coronaryActive());
  assert.deepEqual(e.renderer.camera, camera); assert.equal(e.renderer.settings.threshold, threshold);
  assert.equal(e.api.coronary().source.requests.length, 1);
 } finally { e.close(); }
});

test('toggle updates native-detail compatibility immediately and preserves acquired cap/source arrays', async () => {
 const e = await environment();
 try {
  await finishBoot(e); let nativeSyncs = 0;
  e.api.installNative({sync() { nativeSyncs++; }});
  const source = e.renderer.data, sourceBytes = source.slice(), cap = {data: new Uint8Array([11, 92, 215]), width: 3, height: 1};
  e.renderer.cap = cap; const camera = structuredClone(e.renderer.camera), threshold = e.renderer.settings.threshold;
  toggle(e); await e.until(() => e.api.coronary().source.requests.length === 1);
  assert.equal(e.renderer.coronaryPreparing, true); const beforeCommit = nativeSyncs;
  e.api.coronary().source.requests[0].finish(); await e.until(() => e.renderer.settings.coronaryReveal === true);
  assert.ok(nativeSyncs > beforeCommit); assert.equal(e.renderer.coronaryPreparing, false);
  assert.equal(e.renderer.data, source); assert.deepEqual(source, sourceBytes); assert.equal(e.renderer.cap, cap);
  assert.equal(e.renderer.settings.threshold, threshold); assert.deepEqual(e.renderer.camera, camera);
  toggle(e); assert.equal(e.renderer.settings.coronaryReveal, false); assert.equal(e.renderer.cap, cap);
 } finally { e.close(); }
});

test('changing tabs cancels an uncommitted request without activating it in a lab', async () => {
 const e = await environment();
 try {
  await finishBoot(e); toggle(e); await e.until(() => e.api.coronary().source.requests.length === 1);
  const request = e.api.coronary().source.requests[0], pending = e.api.coronary().controls.pending;
  await e.api.switchTab('probe'); assert.equal(request.signal.aborted, true); request.finish(); await pending;
  assert.notEqual(e.renderer.settings.coronaryReveal, true); assert.equal(e.renderer.coronaryField, undefined);
  assert.equal(e.renderer.coronaryPreparing, false); e.api.switchTab('reconstruction');
  assert.equal(e.api.coronary().source.requests.length, 1);
 } finally { e.close(); }
});

test('coronary normal smoothing is independent, and original-scan cleanup comparison exits reveal', async () => {
 const e = await environment();
 try {
  await finishBoot(e); e.renderer.settings.surfaceSmoothing = 1; toggle(e);
  await e.until(() => e.api.coronary().source.requests.length === 1); e.api.coronary().source.requests[0].finish();
  await e.until(() => e.renderer.settings.coronaryReveal === true);
  assert.equal(e.document.getElementById('surfaceSmoothing').value, '2');
  input(e, 'surfaceSmoothing', 0); assert.equal(e.renderer.settings.coronarySmoothing, 0); assert.equal(e.renderer.settings.surfaceSmoothing, 1);
  toggle(e); assert.equal(e.document.getElementById('surfaceSmoothing').value, '1');
  toggle(e); await e.until(() => e.api.coronary().source.requests.length === 2); e.api.coronary().source.requests[1].finish();
  await e.until(() => e.renderer.settings.coronaryReveal === true);
  const comparison = e.api.cleanup(false); assert.equal(e.renderer.settings.coronaryReveal, false);
  assert.equal(e.api.coronary().pendingRestore, false); await e.until(() => e.workers.length === 3); e.workers[2].finish(); await comparison;
  assert.equal(e.renderer.settings.cleanupEnabled, false);
 } finally { e.close(); }
});
