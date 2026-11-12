/** Production DOM + real controller; asynchronous picks and frame presentation
 * are controlled. These tests do not claim browser layout or GPU coverage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { MeasurementControls } from '../public/measurement-controls.js';

const { parseHTML } = await import(pathToFileURL(process.argv[2] || '/tmp/heart-review-test-deps/node_modules/linkedom/esm/index.js'));
const html = await readFile(new URL('../page.html', import.meta.url), 'utf8');
const meta = { dimensions: [101, 101, 101], spacingUm: 1000 };
const sourceKey = 'measured-test-donor';
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function fixture() {
  const { document: doc, window: dom } = parseHTML(html);
  const canvas = doc.getElementById('volumeCanvas'), viewport = doc.getElementById('viewport');
  const button = doc.querySelector('[data-measure-controls] button');
  assert.ok(button, 'Measure must be wired into the production page');
  let now = 1000, nextTimer = 0, focused = doc.body, starts = 0, changes = 0;
  const timers = new Map(), observers = [], requests = [], previousFrames = [];
  const view = {
    Event: dom.Event, performance: { now: () => now },
    addEventListener: dom.addEventListener.bind(dom), removeEventListener: dom.removeEventListener.bind(dom),
    dispatchEvent: dom.dispatchEvent.bind(dom),
    setTimeout(fn, delay = 0) { const id = ++nextTimer; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    ResizeObserver: class {
      constructor(fn) { this.fn = fn; observers.push(this); }
      observe(node) { this.node = node; }
      disconnect() { this.disconnected = true; }
    },
  };
  Object.defineProperty(doc, 'defaultView', { value: view });
  Object.defineProperty(doc, 'hidden', { value: false, writable: true });
  Object.defineProperty(doc, 'pointerLockElement', { value: null, writable: true });
  Object.defineProperty(doc, 'activeElement', { get: () => focused });
  canvas.focus = () => { focused = canvas; }; button.focus = () => { focused = button; };
  // CSS pixels differ from the backing buffer, and the canvas is inset.
  let rect = { left: 100, top: 50, width: 400, height: 300 };
  canvas.width = 800; canvas.height = 600;
  canvas.getBoundingClientRect = () => rect;
  viewport.getBoundingClientRect = () => ({ left: 80, top: 20, width: 600, height: 400 });
  const previousFrameListener = frame => previousFrames.push(frame);
  const renderer = {
    canvas, loaded: true, settings: { mode: 0 }, autoRotate: true,
    presentedMeasurementFrame: {
      sourceKey, frameSerial: 1, frameRevision: 1, meta, mode: 0,
      basis: { eye: [0, 0, 2], forward: [0, 0, -1], right: [1, 0, 0], up: [0, 1, 0] },
      aspect: 4 / 3, width: 800, height: 600, cssWidth: 400, cssHeight: 300, extent: [1, 1, 1],
    },
    requestRender(reason) { requests.push(reason); },
    onMeasurementFrame: previousFrameListener,
  };
  const jobs = [], picker = {
    cancellations: 0, disposals: 0,
    pick(u, v, options) { const job = { ...deferred(), u, v, options }; jobs.push(job); return job.promise; },
    cancel() { this.cancellations++; }, dispose() { this.disposals++; },
  };
  const controls = new MeasurementControls({ renderer, viewport, button, meta, sourceKey, picker,
    onStart: () => starts++, onChange: () => changes++ });
  const event = (type, target, extras = {}) => {
    const e = new dom.Event(type, { bubbles: true, cancelable: true });
    Object.assign(e, extras); target.dispatchEvent(e); return e;
  };
  const pointer = (type, extras = {}) => event(type, canvas, {
    pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0,
    buttons: type === 'pointerdown' ? 1 : 0, clientX: 300, clientY: 200, ...extras,
  });
  const flush = async (elapsed = 100) => {
    now += elapsed;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
    await tick();
  };
  const tap = async (extras = {}) => { pointer('pointerdown', extras); pointer('pointerup', extras); await flush(); };
  const resolve = async (index, world, extras = {}) => {
    assert.ok(jobs[index], `Expected pick request ${index}`);
    jobs[index].resolve(world === null ? null : {
      world, sourceNormalized: world.map(n => n + .5), cutFace: false,
      frameRevision: renderer.presentedMeasurementFrame.frameRevision, sourceKey, ...extras,
    });
    await tick();
  };
  const present = patch => {
    renderer.presentedMeasurementFrame = { ...renderer.presentedMeasurementFrame, ...patch };
    renderer.onMeasurementFrame?.(renderer.presentedMeasurementFrame);
  };
  const complete = async () => {
    controls.start(); const next = jobs.length;
    await tap(); await resolve(next, [0, 0, 0]);
    await tap({ clientX: 350 }); await resolve(next + 1, [.3, .4, 0]);
  };
  return { doc, view, canvas, viewport, button, controls, renderer, picker, jobs, timers, observers, requests,
    previousFrameListener, previousFrames, event, pointer, flush, tap, resolve, present, complete,
    resize(next) { rect = { ...rect, ...next }; observers.forEach(observer => observer.fn()); },
    counts: () => ({ starts, changes }), close: () => controls.dispose() };
}

test('two surface clicks produce a millimeter label and the same button clears the line', async () => {
  const f = fixture();
  try {
    assert.equal(f.button.disabled, false);
    f.button.click(); assert.equal(f.controls.placing, true); assert.equal(f.renderer.autoRotate, false);
    assert.equal(f.doc.activeElement, f.canvas); assert.equal(f.counts().starts, 1);
    assert.equal(f.button.getAttribute('aria-pressed'), 'true');
    await f.tap(); await f.resolve(0, [0, 0, 0]);
    assert.equal(f.controls.points.length, 1); assert.match(f.controls.promptText.textContent, /second point/);
    assert.equal(f.controls.label.hidden, true);
    await f.tap({ clientX: 350 }); await f.resolve(1, [.3, .4, 0]);
    assert.equal(f.controls.placing, false); assert.equal(f.renderer.measurementPlacing, false);
    assert.equal(f.controls.label.textContent, '50.0 mm');
    assert.equal(f.controls.overlay.hidden, false); assert.equal(f.controls.prompt.hidden, true);
    assert.equal(f.button.textContent, 'Clear Measurements');
    assert.match(f.controls.announcement.textContent, /50\.0 millimeters/);
    f.button.click();
    assert.deepEqual(f.controls.points, []); assert.equal(f.controls.overlay.hidden, true);
    assert.equal(f.button.textContent, 'Measure'); assert.equal(f.button.getAttribute('aria-pressed'), 'false');
  } finally { f.close(); }
});

test('hover uses CSS canvas coordinates and a click gets a fresh surface sample', async () => {
  const f = fixture();
  try {
    f.controls.start(); f.pointer('pointermove', { clientX: 200, clientY: 125 }); await f.flush();
    assert.equal(f.jobs[0].u, .25); assert.equal(f.jobs[0].v, .25);
    assert.equal(f.jobs[0].options.toleranceCssPixels, 4);
    await f.resolve(0, [.1, .1, 0]);
    assert.deepEqual(f.controls.points, []); assert.deepEqual(f.controls.preview, [.1, .1, 0]);
    assert.equal(f.controls.overlay.style.left, '20px'); assert.equal(f.controls.overlay.style.top, '30px');
    assert.equal(f.controls.overlay.style.width, '400px');
    await f.tap({ clientX: 200, clientY: 125 });
    assert.equal(f.jobs.length, 2); assert.equal(f.controls.preview, null);
    const hit = [.12, .1, 0]; await f.resolve(1, hit); hit[0] = 100;
    assert.deepEqual(f.controls.points, [[.12, .1, 0]], 'accepted endpoints must own their coordinates');
  } finally { f.close(); }
});

test('orbit, pan, coalesced out-and-back motion and canceled pointers never place points', async () => {
  const f = fixture();
  try {
    f.controls.start();
    for (const kind of ['drag', 'coalesced', 'right', 'shift', 'cancel', 'lost']) {
      f.pointer('pointerdown', kind === 'right' ? { button: 2, buttons: 2 } : kind === 'shift' ? { shiftKey: true } : {});
      if (kind === 'drag') f.pointer('pointermove', { clientX: 310, buttons: 1 });
      if (kind === 'coalesced') f.pointer('pointermove', { buttons: 1, getCoalescedEvents: () => [{ clientX: 310, clientY: 200 }, { clientX: 300, clientY: 200 }] });
      if (kind === 'cancel' || kind === 'lost') f.pointer(kind === 'cancel' ? 'pointercancel' : 'lostpointercapture');
      const up = f.pointer('pointerup', kind === 'right' ? { button: 2 } : kind === 'shift' ? { shiftKey: true } : {});
      assert.equal(up.defaultPrevented, false, kind);
      await f.flush(); assert.equal(f.jobs.length, 0, kind);
    }
    assert.equal(f.controls.placing, true); assert.deepEqual(f.controls.points, []);
  } finally { f.close(); }
});

test('multitouch is rejected, then a new single touch can select with touch tolerance', async () => {
  const f = fixture();
  try {
    f.controls.start();
    f.pointer('pointerdown', { pointerType: 'touch' });
    f.pointer('pointerdown', { pointerId: 2, pointerType: 'touch', isPrimary: false });
    f.pointer('pointerup', { pointerId: 2, pointerType: 'touch', isPrimary: false });
    f.pointer('pointerup', { pointerType: 'touch' }); await f.flush();
    assert.equal(f.jobs.length, 0);
    await f.tap({ pointerType: 'touch' }); assert.equal(f.jobs.length, 1);
    assert.equal(f.jobs[0].options.toleranceCssPixels, 6);
    await f.resolve(0, [0, 0, 0]); assert.equal(f.controls.points.length, 1);
  } finally { f.close(); }
});

test('a second tap during readback preserves the accepted request without duplicating it', async () => {
  const f = fixture();
  try {
    f.controls.start(); await f.tap(); const first = f.jobs[0];
    await f.tap({ clientX: 350 });
    assert.equal(first.options.signal.aborted, false); assert.equal(f.jobs.length, 1);
    await f.resolve(0, [0, 0, 0]); assert.deepEqual(f.controls.points, [[0, 0, 0]]);
    await f.tap({ clientX: 350 }); await f.resolve(1, [.3, .4, 0]);
    assert.equal(f.controls.label.textContent, '50.0 mm'); assert.equal(f.controls.points.length, 2);
  } finally { f.close(); }
});

test('a camera or cutaway change during readback cannot commit the old click; a fresh retry works', async () => {
  const f = fixture();
  try {
    // Model a camera update that has not reached a displayed frame yet.
    let currentBasis = structuredClone(f.renderer.presentedMeasurementFrame.basis);
    f.renderer.basis = () => currentBasis;
    f.controls.start(); await f.tap();
    f.pointer('pointerdown'); f.pointer('pointermove', { clientX: 330, buttons: 1 });
    currentBasis = { ...currentBasis, eye: [.2, 0, 2] };
    f.pointer('pointerup', { clientX: 330 });
    await f.resolve(0, [.15, 0, 0]);
    assert.deepEqual(f.controls.points, []); assert.match(f.controls.promptText.textContent, /View changed/);
    await f.tap(); f.renderer.settings.clipAxis = 3; f.renderer.settings.clipOffset = .12;
    await f.resolve(1, [.1, 0, 0]);
    assert.deepEqual(f.controls.points, []); assert.match(f.controls.promptText.textContent, /Choose the point again/);
    // A fresh same-pose surface/frame upgrade is still eligible to complete.
    await f.tap(); f.present({ basis: currentBasis, frameSerial: 2, frameRevision: 2 });
    await f.resolve(2, [0, 0, 0]); assert.deepEqual(f.controls.points, [[0, 0, 0]]);
    await f.tap(); await f.resolve(3, [.3, .4, 0]); assert.equal(f.controls.label.textContent, '50.0 mm');
  } finally { f.close(); }
});

test('double-click reset is suppressed during placement and readback, then restored', async () => {
  const f = fixture(); let resets = 0;
  try {
    f.canvas.addEventListener('dblclick', () => resets++);
    f.controls.start();
    assert.equal(f.event('dblclick', f.canvas).defaultPrevented, true); assert.equal(resets, 0);
    await f.tap(); await f.resolve(0, [0, 0, 0]); await f.tap();
    assert.equal(f.event('dblclick', f.canvas).defaultPrevented, true); assert.equal(resets, 0);
    await f.resolve(1, [.3, .4, 0]);
    assert.equal(f.event('dblclick', f.canvas).defaultPrevented, false); assert.equal(resets, 1);
  } finally { f.close(); }
});

test('only the latest hover appears and leaving the canvas invalidates pending hover', async () => {
  const f = fixture();
  try {
    f.controls.start(); f.pointer('pointermove', { clientX: 200 }); await f.flush();
    f.pointer('pointermove', { clientX: 350 });
    await f.resolve(0, [-.2, 0, 0]); assert.equal(f.controls.preview, null);
    await f.flush(); assert.equal(f.jobs.length, 2); assert.equal(f.jobs[1].u, .625);
    await f.resolve(1, [.2, 0, 0]); assert.deepEqual(f.controls.preview, [.2, 0, 0]);
    f.pointer('pointermove', { clientX: 375 }); await f.flush();
    f.pointer('pointerleave'); assert.equal(f.jobs[2].options.signal.aborted, true);
    await f.resolve(2, [.3, 0, 0]); f.present({ frameSerial: 2 }); await f.flush();
    assert.equal(f.controls.preview, null); assert.equal(f.controls.overlay.hidden, true); assert.equal(f.jobs.length, 3);
  } finally { f.close(); }
});

test('Escape cancels pending placement and late readback cannot restore it', async () => {
  const f = fixture();
  try {
    f.controls.start(); await f.tap();
    const escape = f.event('keydown', f.doc, { key: 'Escape' });
    assert.equal(escape.defaultPrevented, true); assert.equal(f.doc.activeElement, f.button);
    assert.equal(f.jobs[0].options.signal.aborted, true); assert.equal(f.controls.placing, false);
    await f.resolve(0, [0, 0, 0]); assert.deepEqual(f.controls.points, []);
    f.button.click(); await f.tap(); f.button.click(); await f.resolve(1, [.1, 0, 0]);
    assert.equal(f.controls.placing, false); assert.deepEqual(f.controls.points, []);
  } finally { f.close(); }
});

test('source changes reject late endpoints and results explicitly belonging to another donor', async () => {
  const f = fixture();
  try {
    f.controls.start(); await f.tap(); await f.resolve(0, [0, 0, 0]); await f.tap();
    f.controls.setSource(meta, 'other-donor');
    await f.resolve(1, [.3, .4, 0]); assert.deepEqual(f.controls.points, []); assert.equal(f.controls.placing, false);
    f.present({ sourceKey: 'other-donor' }); f.controls.start(); await f.tap();
    await f.resolve(2, [.1, 0, 0]); assert.deepEqual(f.controls.points, []);
    await f.tap(); await f.resolve(3, [.1, 0, 0], { sourceKey: 'other-donor' });
    assert.deepEqual(f.controls.points, [[.1, 0, 0]]);
  } finally { f.close(); }
});

test('workspace changes retain a completed annotation but cancel unfinished placement', async () => {
  const f = fixture();
  try {
    await f.complete(); const points = structuredClone(f.controls.points);
    f.controls.setWorkspaceActive(false);
    assert.equal(f.controls.overlay.hidden, true); assert.equal(f.button.closest('[data-measure-controls]').hidden, true);
    f.controls.setWorkspaceActive(true);
    assert.deepEqual(f.controls.points, points); assert.equal(f.controls.label.textContent, '50.0 mm');
    assert.equal(f.controls.overlay.hidden, false);
    f.controls.clear(); f.controls.start(); await f.tap(); f.controls.setWorkspaceActive(false);
    await f.resolve(2, [0, 0, 0]); f.controls.setWorkspaceActive(true);
    assert.deepEqual(f.controls.points, []); assert.equal(f.controls.placing, false);
  } finally { f.close(); }
});

test('camera, canvas resize and equivalent-detail upgrades preserve millimeters; physical scale changes clear', async () => {
  const f = fixture();
  try {
    await f.complete(); const originalX = Number(f.controls.line.getAttribute('x2'));
    f.present({ basis: { ...f.renderer.presentedMeasurementFrame.basis, eye: [0, 0, 4] }, frameSerial: 2 });
    assert.ok(Number(f.controls.line.getAttribute('x2')) < originalX);
    assert.equal(f.controls.label.textContent, '50.0 mm'); assert.equal(f.previousFrames.length, 1);
    f.resize({ width: 800, height: 600 }); assert.equal(f.controls.overlay.hidden, true);
    f.present({ cssWidth: 800, cssHeight: 600, width: 1600, height: 1200, frameSerial: 3 });
    assert.equal(f.controls.overlay.hidden, false); assert.equal(f.controls.overlay.style.width, '800px');
    assert.equal(f.controls.label.textContent, '50.0 mm');
    f.controls.setSource({ dimensions: [201, 201, 201], spacingUm: 500 }, sourceKey);
    assert.equal(f.controls.points.length, 2); assert.equal(f.controls.label.textContent, '50.0 mm');
    f.controls.setSource({ dimensions: [101, 101, 101], spacingUm: 500 }, sourceKey);
    assert.deepEqual(f.controls.points, []); assert.equal(f.controls.overlay.hidden, true);
  } finally { f.close(); }
});

test('misses, readback errors and duplicate endpoints allow a clean retry', async () => {
  const f = fixture();
  try {
    f.controls.start(); await f.tap(); await f.resolve(0, null);
    assert.deepEqual(f.controls.points, []); assert.match(f.controls.promptText.textContent, /visible heart/);
    await f.tap(); f.picker.unavailableReason = 'readback'; await f.resolve(1, null);
    assert.match(f.controls.promptText.textContent, /Surface selection unavailable/);
    assert.match(f.controls.announcement.textContent, /temporarily unavailable/);
    f.picker.unavailableReason = null;
    await f.tap(); f.jobs[2].reject(new Error('readback unavailable')); await tick();
    assert.match(f.controls.promptText.textContent, /Try again/);
    await f.tap(); await f.resolve(3, [0, 0, 0]); await f.tap(); await f.resolve(4, [0, 0, 0]);
    assert.equal(f.controls.points.length, 1); assert.match(f.controls.promptText.textContent, /different second point/);
    await f.tap(); await f.resolve(5, [.3, .4, 0]); assert.equal(f.controls.label.textContent, '50.0 mm');
  } finally { f.close(); }
});

test('backgrounding, page suspension and focus loss invalidate pending input without late placement', async () => {
  const f = fixture();
  try {
    f.controls.start(); await f.tap(); f.event('blur', f.view);
    await f.resolve(0, [0, 0, 0]); assert.deepEqual(f.controls.points, []);
    await f.tap(); f.event('pagehide', f.view);
    await f.resolve(1, [.1, 0, 0]); assert.deepEqual(f.controls.points, []);
    await f.tap(); f.doc.hidden = true; f.event('visibilitychange', f.doc);
    await f.resolve(2, [.1, 0, 0]); assert.deepEqual(f.controls.points, []); assert.equal(f.controls.overlay.hidden, true);
    f.doc.hidden = false; f.event('visibilitychange', f.doc);
    await f.tap(); await f.resolve(3, [0, 0, 0]); assert.equal(f.controls.points.length, 1);
    f.doc.pointerLockElement = f.canvas; f.event('pointerlockchange', f.doc);
    assert.equal(f.controls.placing, false); assert.deepEqual(f.controls.points, []);
  } finally { f.close(); }
});

test('unsupported modes, missing calibration and context loss cannot produce measurements', async () => {
  const f = fixture();
  try {
    f.renderer.loaded = false; f.controls.sync(); assert.equal(f.button.disabled, true); assert.equal(f.controls.start(), false);
    f.renderer.loaded = true; f.controls.setSource({ dimensions: [101, 101, 101] }, sourceKey);
    assert.equal(f.controls.start(), false); f.controls.setSource(meta, sourceKey);
    f.renderer.settings.showPlanes = true; f.controls.sync(); assert.equal(f.controls.start(), false);
    f.renderer.settings.showPlanes = false; f.controls.sync();
    f.controls.start(); await f.tap(); f.renderer.settings.mode = 1; f.controls.sync();
    await f.resolve(0, [0, 0, 0]); assert.deepEqual(f.controls.points, []); assert.equal(f.button.disabled, true);
    f.renderer.settings.mode = 0; f.controls.sync(); f.controls.start(); await f.tap();
    f.event('webglcontextlost', f.canvas); await f.resolve(1, [0, 0, 0]);
    assert.deepEqual(f.controls.points, []); assert.equal(f.controls.placing, false); assert.equal(f.button.disabled, true);
  } finally { f.close(); }
});

test('out-of-canvas releases and points outside valid coordinates are ignored', async () => {
  const f = fixture();
  try {
    f.controls.start(); await f.tap({ clientX: 80 }); assert.equal(f.jobs.length, 0);
    f.resize({ width: 0 }); await f.tap(); assert.equal(f.jobs.length, 0);
    f.resize({ width: 400 }); await f.tap(); await f.resolve(0, [NaN, 0, 0]);
    assert.deepEqual(f.controls.points, []); assert.match(f.controls.promptText.textContent, /visible heart/);
  } finally { f.close(); }
});

test('dispose removes overlay/listeners, restores frame chaining and rejects late work', async () => {
  const f = fixture();
  f.controls.start(); await f.tap(); f.controls.dispose();
  assert.equal(f.doc.querySelector('.measurement-overlay'), null);
  assert.equal(f.doc.querySelector('.measurement-prompt'), null);
  assert.equal(f.renderer.onMeasurementFrame, f.previousFrameListener);
  assert.equal(f.renderer.measurementController, null); assert.equal(f.picker.disposals, 1);
  assert.ok(f.observers.every(observer => observer.disconnected)); assert.equal(f.timers.size, 0);
  await f.resolve(0, [0, 0, 0]); assert.deepEqual(f.controls.points, []);
  f.button.click(); await f.tap(); assert.equal(f.jobs.length, 1);
});
