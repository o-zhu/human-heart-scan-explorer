/** Production DOM and controlled pane dimensions; not a browser layout test. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { mountViewportControls, needsCompactControls } from '../public/viewport-controls.js';
import { TeeLabModule } from '../public/tee-lab.js';
import { ProbeLabModule } from '../public/probe-lab.js';
import { EchoModule } from '../public/echo.js';

const { parseHTML } = await import(pathToFileURL(process.argv[2] || '/tmp/heart-review-test-deps/node_modules/linkedom/esm/index.js'));
const html = await readFile(new URL('../page.html', import.meta.url), 'utf8');

function fixture(width = 800, height = 700) {
  const { document: doc, window: dom } = parseHTML(html);
  for (const [id, Module] of [['echoPanel', EchoModule], ['probePanel', ProbeLabModule], ['teePanel', TeeLabModule]]) {
    doc.getElementById(id).innerHTML = Module.prototype.template.call({ fineLabel: '79.4 µm' });
  }
  let active = doc.body;
  Object.defineProperty(doc, 'activeElement', { get: () => active });
  for (const node of doc.querySelectorAll('*')) node.focus = () => { active = node; };
  const frames = new Map(), resizes = [], mutations = [];
  let nextFrame = 0;
  const view = {
    requestAnimationFrame(fn) { frames.set(++nextFrame, fn); return nextFrame; },
    cancelAnimationFrame(id) { frames.delete(id); },
    addEventListener: dom.addEventListener.bind(dom),
    removeEventListener: dom.removeEventListener.bind(dom),
    ResizeObserver: class { constructor(fn) { this.fn = fn; resizes.push(this); } observe() {} disconnect() { this.disconnected = true; } },
    MutationObserver: class { constructor(fn) { this.fn = fn; this.nodes = []; mutations.push(this); } observe(node, options) { this.nodes.push({ node, options }); } disconnect() { this.disconnected = true; } },
  };
  const viewport = doc.getElementById('viewport');
  viewport.getBoundingClientRect = () => ({ width, height });
  const stop = mountViewportControls(doc, view);
  const menu = doc.getElementById('viewportControlMenu'), toggle = viewport.querySelector('.viewport-menu-toggle');
  toggle.focus = () => { active = toggle; };
  menu.querySelector('.viewport-menu-close').focus = () => { active = menu.querySelector('.viewport-menu-close'); };
  const flush = () => { for (const [id, fn] of [...frames]) { frames.delete(id); fn(); } };
  const event = (type, target, extra = {}) => { const evt = new dom.Event(type, { bubbles: true, cancelable: true }); Object.assign(evt, extra); target.dispatchEvent(evt); return evt; };
  const resize = (w, h) => { width = w; height = h; resizes.forEach(observer => observer.fn()); flush(); };
  const relocate = id => { const mount = doc.getElementById(id); mount.append(viewport); mutations.forEach(observer => observer.fn([{ target: mount, addedNodes: [viewport] }])); flush(); };
  return { doc, viewport, menu, toggle, stop, resize, relocate, event, resizes, mutations, frames };
}

test('pane size, rather than browser width, chooses compact mode including short fullscreen views', () => {
  for (const [w, h, expected] of [[850, 900, true], [851, 550, true], [851, 551, false], [390, 844, true], [1366, 500, true], [0, 0, false]]) {
    assert.equal(needsCompactControls(w, h), expected, `${w} × ${h}`);
  }
});

test('existing controls and listeners survive compacting and restoring, without changing hidden flags', () => {
  const f = fixture(1100, 800);
  const controls = f.viewport.querySelector('.viewer-controls');
  const heading = f.viewport.querySelector('.viewport-heading');
  const bottom = f.viewport.querySelector('.viewport-bottom');
  const reset = f.doc.getElementById('resetView');
  const detail = f.doc.getElementById('openReconstructionDetail');
  let clicks = 0;
  reset.addEventListener('click', () => clicks++);
  f.resize(700, 700);
  assert.equal(f.toggle.hidden, false);
  assert.equal(f.menu.hidden, true);
  assert.ok([controls, heading, bottom].every(node => f.menu.contains(node)));
  assert.equal(detail.hidden, true);
  f.event('click', reset);
  f.resize(1100, 800);
  assert.ok([controls, heading, bottom].every(node => node.parentElement === f.viewport));
  assert.equal(f.toggle.hidden, true);
  assert.equal(f.doc.getElementById('resetView'), reset);
  assert.equal(f.doc.getElementById('openReconstructionDetail'), detail);
  f.event('click', reset);
  assert.equal(clicks, 2);
  assert.equal(f.doc.querySelectorAll('#volumeCanvas').length, 1);
  assert.equal(f.doc.querySelectorAll('#resetView').length, 1);
  f.stop();
});

test('Escape, outside interaction and Detail dismiss the menu and reset nested popovers', () => {
  const f = fixture();
  f.event('click', f.toggle);
  assert.equal(f.menu.hidden, false);
  assert.equal(f.toggle.getAttribute('aria-expanded'), 'true');
  f.doc.getElementById('colorMenu').setAttribute('open', '');
  const key = f.event('keydown', f.menu, { key: 'Escape' });
  assert.equal(key.defaultPrevented, true);
  assert.equal(f.menu.hidden, true);
  assert.equal(f.doc.getElementById('colorMenu').hasAttribute('open'), false);
  assert.equal(f.doc.activeElement, f.toggle);
  f.event('click', f.toggle);
  f.doc.getElementById('viewMenu').setAttribute('open', '');
  f.event('pointerdown', f.doc.getElementById('volumeCanvas'));
  assert.equal(f.menu.hidden, true);
  assert.equal(f.doc.getElementById('viewMenu').hasAttribute('open'), false);
  f.event('click', f.toggle);
  f.event('click', f.doc.getElementById('openReconstructionDetail'));
  assert.equal(f.menu.hidden, true);
  f.stop();
});

test('the shared viewport carries its menu through all workspaces; TEE starts restore to their own mount', () => {
  const f = fixture();
  const teeStarts = f.doc.querySelector('#teeViewportMount > .workspace-starting-views');
  const tteStarts = f.doc.querySelector('#probePanel .workspace-starting-views');
  const tteParent = tteStarts.parentElement;
  const firstPreset = teeStarts.querySelector('button');
  let selections = 0;
  firstPreset.addEventListener('click', () => selections++);
  f.relocate('echoViewportMount');
  assert.equal(f.viewport.parentElement.id, 'echoViewportMount');
  f.event('click', f.toggle);
  f.relocate('teeViewportMount');
  assert.equal(f.menu.hidden, true);
  assert.equal(f.menu.contains(teeStarts), true);
  assert.equal(f.doc.getElementById('teePanel').contains(teeStarts), true);
  f.event('click', firstPreset);
  f.relocate('probeViewportMount');
  assert.equal(teeStarts.parentElement.id, 'teeViewportMount');
  assert.equal(tteStarts.parentElement, tteParent);
  f.relocate('reconstructionWorkspace');
  f.resize(1100, 800);
  assert.equal(f.viewport.querySelector('.viewer-controls').parentElement, f.viewport);
  assert.equal(selections, 1);
  assert.equal(f.doc.querySelectorAll('[data-tee-preset]').length, 4);
  assert.equal(f.doc.querySelectorAll('.viewport-menu-toggle').length, 1);
  f.stop();
});

test('hidden dimensions preserve the current state; cleanup restores nodes and disconnects observers', () => {
  const f = fixture();
  assert.ok(f.mutations.every(observer => observer.nodes.every(({ options }) => options.childList && !options.subtree)));
  f.resize(0, 0);
  assert.equal(f.viewport.classList.contains('viewport-controls-compact'), true);
  f.stop();
  assert.equal(f.viewport.querySelector('.viewport-menu-toggle'), null);
  assert.equal(f.viewport.querySelector('.viewer-controls').parentElement, f.viewport);
  assert.equal(f.viewport.classList.contains('viewport-controls-compact'), false);
  assert.ok([...f.resizes, ...f.mutations].every(observer => observer.disconnected));
  assert.equal(f.frames.size, 0);
});
