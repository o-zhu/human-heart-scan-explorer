/** Exercise the native page's real DOM bindings and loader with a small GPU fixture. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { NativeMeshLoader } from '../public/native-mesh-loader.js';
import { parseNativeMesh } from '../public/native-mesh-format.js';

const entry = process.argv[2];
if (!entry) throw new Error('Pass the installed LinkeDOM ESM entry point.');
const { parseHTML } = await import(pathToFileURL(entry));
const html = await readFile(new URL('../public/native-detail.html', import.meta.url), 'utf8');
const code = (await readFile(new URL('../public/native-detail.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\s*$/gm, '').replace(/\nboot\(\)\.catch[^\n]*;\s*$/, '');
const settle = () => new Promise(resolve => setImmediate(resolve));

function decodedMesh() {
  const buffer = new ArrayBuffer(100);
  new Uint32Array(buffer, 0, 8).set([0x314d4648, 1, 3, 3, 32, 68, 88, 1]);
  new Float32Array(buffer, 32, 9).set([-.4, -.4, 0, .4, -.4, 0, 0, .4, 0]);
  new Int16Array(buffer, 68, 9).set([0, 0, 32767, 0, 0, 32767, 0, 0, 32767]);
  new Uint32Array(buffer, 88, 3).set([0, 1, 2]);
  return parseNativeMesh(buffer, 100);
}

async function fixture() {
  const { document, window } = parseHTML(html), workers = [], draws = [], frames = [];
  Object.defineProperty(window.HTMLSelectElement.prototype, 'value', {
    configurable: true, get() { return this._testValue ?? this.querySelector('option')?.value ?? ''; },
    set(value) { this._testValue = String(value); },
  });
  window.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ width: 600, height: 400 });
  window.HTMLCanvasElement.prototype.getContext = function () {
    const canvas = this;
    return new Proxy({ NO_ERROR: 0, getError: () => 0,
      getShaderParameter: () => true, getProgramParameter: () => true,
      createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}), createVertexArray: () => ({}),
      drawElements: (...args) => draws.push({ canvas: canvas.id, args }),
    }, { get(target, key) { return key in target ? target[key] : /^[A-Z_]+$/.test(key) ? 1 : () => {}; } });
  };
  const manifest = {
    donorId: 'ladaf-2021-17', sourceSpacingUm: 19.85, defaultMethod: 'normals', rawThreshold: 12345,
    roi: { shapeXYZ: [16, 16, 16], originXYZ: [1, 2, 3], physicalSizeMm: [.29775, .29775, .29775], description: 'test region' },
    extent: [1, 1, 1], bounds: { min: [-.5, -.5, -.5], max: [.5, .5, .5] },
    processing: { quantization: 'Float32 positions', source: 'Measured source' }, attribution: 'Fixture', license: 'CC BY 4.0',
    lods: ['overview', 'native', 'normals', 'gentle', 'moderate', 'bilateral'].map(id => ({
      id, label: `Surface ${id}`, url: `./assets/native-surface-v20/${id}.hfm.gz`,
      sourceSpacingUm: id === 'overview' ? 317.6 : 19.85, compressedBytes: 64, decodedBytes: 100,
      sha256: 'a'.repeat(64), decodedSha256: 'b'.repeat(64), triangles: 1,
      maximumGeometryDisplacementUm: id === 'gentle' ? 4 : id === 'moderate' ? 8 : 0,
    })),
  };
  class Loader extends NativeMeshLoader {
    constructor() { super({ baseUrl: 'https://fixture.invalid/native-detail.html', createWorker: () => {
      const worker = { stopped: false, postMessage(message) { this.message = message; }, terminate() { this.stopped = true; } };
      workers.push(worker); return worker;
    } }); }
  }
  const api = new Function('document', 'window', 'NativeMeshLoader', 'fetch', 'ResizeObserver', 'requestAnimationFrame', 'location', code + '\nreturn {boot, panes};')(
    document, window, Loader,
    async url => { assert.equal(url, './assets/native-surface-v20/manifest.json'); return new Response(JSON.stringify(manifest)); },
    class { observe() {} disconnect() {} }, fn => { frames.push(fn); }, { reload() {} });
  await api.boot(); await settle();
  const complete = async index => { workers[index].onmessage({ data: decodedMesh() }); await settle(); };
  const choose = async id => { const select = document.getElementById('candidateChoice'); select.value = id; select.dispatchEvent(new window.Event('change')); await settle(); };
  const draw = () => { for (const frame of frames.splice(0)) frame(); };
  return { api, document, workers, draws, complete, choose, draw, get: id => document.getElementById(id) };
}

test('native page keeps selected methods, committed geometry and readiness consistent through rapid changes and failed loads', async () => {
  const f = await fixture();
  assert.equal(f.get('referenceChoice').value, 'overview');
  assert.equal(f.get('candidateChoice').value, 'normals');
  assert.equal(f.get('candidateChoice').querySelectorAll('option').length, 6);
  assert.match(f.get('regionSize').textContent, /0.30 × 0.30 × 0.30 mm/);
  assert.match(f.get('provenance').textContent, /1, 2, 3/);
  assert.equal(f.workers.length, 1, 'Two panes must share one active decoder.');
  await f.complete(0);
  assert.equal(f.get('referenceLabel').textContent, 'Surface overview');
  assert.equal(f.get('candidateChoice').getAttribute('aria-busy'), 'true');
  assert.match(f.get('pageStatus').textContent, /Preparing/, 'Finishing one pane cannot mark the still-loading comparison ready.');
  await f.complete(1); f.draw();
  assert.equal(f.get('candidateLabel').textContent, 'Surface normals');
  assert.equal(f.get('movementMetric').textContent, '0 µm');
  assert.ok(f.draws.some(draw => draw.canvas === 'referenceCanvas'));
  assert.ok(f.draws.some(draw => draw.canvas === 'candidateCanvas'));

  await f.choose('gentle'); await f.choose('moderate');
  assert.equal(f.workers[2].stopped, true);
  await f.complete(2);
  assert.equal(f.get('candidateLabel').textContent, 'Surface normals', 'Late canceled decoding must not replace committed geometry.');
  await f.complete(3);
  assert.equal(f.get('candidateLabel').textContent, 'Surface moderate');
  assert.equal(f.get('movementMetric').textContent, '8.000 µm');

  await f.choose('gentle'); await f.choose('moderate');
  assert.equal(f.workers[4].stopped, true);
  assert.equal(f.get('candidateChoice').hasAttribute('aria-busy'), false, 'Returning to the displayed surface must clear pending state.');
  assert.match(f.get('pageStatus').textContent, /Linked views ready/);
  assert.equal(f.workers.length, 5, 'Returning to the displayed surface must reuse its GPU geometry.');

  await f.choose('bilateral');
  f.workers[5].onmessage({ data: { error: 'Fixture transfer interrupted.' } }); await settle();
  assert.equal(f.get('candidateChoice').value, 'moderate', 'A failed replacement must restore the displayed method in the selector.');
  assert.equal(f.get('candidateLabel').textContent, 'Surface moderate');
  assert.equal(f.get('movementMetric').textContent, '8.000 µm');
  assert.equal(f.get('candidateChoice').hasAttribute('aria-busy'), false);
  assert.match(f.get('pageStatus').textContent, /previous surface remains available/);
  assert.equal(f.get('staticComparison').hidden, false);
});
