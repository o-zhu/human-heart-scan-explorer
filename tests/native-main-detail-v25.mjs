import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {nativeIndexToMainWorld, mainWorldToNativeIndex, nativeTileMainBounds, registerNativePiece, NativeRegionState, NativeMainDetailController} from '../public/native-main-detail.js';
import {nativeToWorld} from '../public/native-edge-loader.js';

const dims = [7614, 7614, 8480], prior = [1903, 1903, 2120];
const near = (a, b, epsilon = 1e-10) => a.forEach((n, i) => assert.ok(Math.abs(n - b[i]) < epsilon, `${n} != ${b[i]}`));
// Main source positions are copied by index, not resized to the display dimensions.
for (const fine of [[0, 0, 0], [948, 948, 1058], [1896, 1896, 2116], [444, 356, 60], [1013.25, 1137.75, 908.125]]) {
  const native = fine.map((n, i) => (n + .5) * dims[i] / prior[i] - .5);
  const expected = [(fine[0] - 948) / 2116, (fine[2] - 1058) / 2116, -(fine[1] - 948) / 2116];
  near(nativeIndexToMainWorld(native), expected);
  near(mainWorldToNativeIndex(expected), native, 1e-9);
}
// Original source centers are not the main display centers. This catches a
// tempting direct native-world overlay, which offsets X/Y by 0.2382 mm.
near(nativeIndexToMainWorld([3806.5, 3806.5, 4239.5]), [3 / 2116, 1.5 / 2116, -3 / 2116]);
const fineManifest = JSON.parse(await readFile(new URL('../public/assets/ultra-volume-v7.json', import.meta.url)));
assert.deepEqual(fineManifest.fullDimensionsXYZ, [1897, 1897, 2117]);
assert.deepEqual(fineManifest.sourceOriginXYZ, [444, 356, 60]);
const record = {xyz: [30, 30, 30], key: '30_30_30'};
const bounds = nativeTileMainBounds(record.xyz);
for (let i = 0; i < 3; i++) assert.ok(bounds.min[i] < bounds.max[i]);
assert.throws(() => nativeTileMainBounds([60, 0, 0]));

function piece() {
  const vertexCount = 3, indexCount = 3, positionOffset = 32, normalOffset = 68, indexOffset = 88;
  const buffer = new ArrayBuffer(100);
  const positions = new Float32Array(buffer, positionOffset, 9), normals = new Int16Array(buffer, normalOffset, 9);
  for (let i = 0; i < 3; i++) { positions.set(nativeToWorld([3900 + i, 3900, 3900]), i * 3); normals.set([18918, 18918, 18918], i * 3); }
  new Uint32Array(buffer, indexOffset, 3).set([0, 1, 2]);
  return {buffer, vertexCount, indexCount, positionOffset, normalOffset, indexOffset, positionFormat: 'float32', positionBytes: 12};
}
const mesh = registerNativePiece(piece());
near([...new Float32Array(mesh.buffer, mesh.positionOffset, 3)], nativeIndexToMainWorld([3900, 3900, 3900]), 3e-8);
const normal = new Int16Array(mesh.buffer, mesh.normalOffset, 3);
assert.ok(Math.abs(Math.hypot(...normal) - 32767) < 1);
assert.ok(normal[0] > normal[1]); // inverse transpose of the slightly different X/Z scale
assert.throws(() => registerNativePiece({...piece(), positionFormat: 'uint16'}));

const freed = [], state = new NativeRegionState({maxBytes: 16, disposePiece: p => freed.push(p.id)});
let revision = state.begin();
for (let i = 0; i < 8; i++) state.add(revision, i, 1, () => ({id: 'A' + i, indexCount: 3}));
state.commit(revision, record, {pieces: 8, triangles: 8});
const original = state.current;
revision = state.begin(); state.add(revision, 0, 1, () => ({id: 'failed', indexCount: 3}));
assert.throws(() => state.commit(revision, record, {pieces: 8, triangles: 8}), /complete/);
assert.equal(state.current, original); state.cancel(); assert.deepEqual(freed, ['failed']);
revision = state.begin(); let allocated = false;
assert.throws(() => state.add(revision, 0, 9, () => { allocated = true; }), /budget/);
assert.equal(allocated, false); assert.equal(state.current, original);
state.cancel(); const stale = revision; revision = state.begin();
assert.throws(() => state.add(stale, 0, 1, () => ({})), {name: 'AbortError'});
for (let i = 0; i < 8; i++) state.add(revision, i, 1, () => ({id: 'B' + i, indexCount: 3}));
state.commit(revision, {...record, xyz: [31, 30, 30]}, {pieces: 8, triangles: 8});
assert.equal(state.bytes, 8); assert.equal(freed.length, 9); state.clear(); assert.equal(state.bytes, 0); assert.equal(freed.length, 17);

// Integration: fake GPU/loader exercises atomic install, failure, show/hide,
// same-camera load, explicit focus, and base/native shader-state restoration.
const calls = [], gl = new Proxy({NO_ERROR: 0, isContextLost: () => false, getError: () => 0}, {get(target, key) { if (key in target) return target[key]; if (String(key).startsWith('create')) return () => ({}); if (String(key).toUpperCase() === key) return key; return (...args) => calls.push([key, ...args]); }});
const renderer = {gl, settings: {}, canvas: {style: {}, addEventListener() {}, removeEventListener() {}}, camera: {pan: [0, 0, 0], distance: 1.4}, requestRender() {}, onChange() {}};
const pass = renderer.fineSurface = {lod: {id: 'gentle'}, activeFor: () => true, nativeUniforms: {nativeReplacementEnabled: 'enabled', nativePatchPass: 'pass', nativeRegionMin: 'min', nativeRegionMax: 'max'}, boundsMin: 'boundsMin', boundsMax: 'boundsMax', debrisEnabled: 'debris'};
let fail = false, duringLoad = () => {};
const loader = {cancel() {}, dispose() {}, async loadTile(record, {onPiece}) { for (let i = 0; i < 8; i++) { if (fail && i === 4) throw new Error('test interrupted transfer'); if(i === 3) duringLoad(); onPiece(piece(), i, 8); } return {pieces: 8, triangles: 8}; }};
const controller = new NativeMainDetailController({renderer, donor: {id: 'ladaf-2021-17'}, loader});
controller.manifest = {tiles: [record]};
const cameraBefore = structuredClone(renderer.camera), at = nativeIndexToMainWorld([3900, 3900, 3900]);
assert.equal(await controller.loadAt(at), true); assert.deepEqual(renderer.camera, cameraBefore);
assert.equal(controller.hasActiveRegion(), true); const installed = controller.state.current;
fail = true; assert.equal(await controller.loadAt(at), false); assert.equal(controller.state.current, installed);
controller.bindBase(pass); assert.ok(calls.some(c => c[0] === 'uniform1i' && c[1] === 'enabled' && c[2] === 1));
controller.draw(pass); assert.deepEqual(calls.at(-1), ['uniform1i', 'pass', 0]);
controller.visible = false; controller.bindBase(pass); assert.equal(controller.hasActiveRegion(), false); assert.equal(controller.state.current, installed);
controller.visible = true; controller.focus(); assert.equal(renderer.camera.distance, .08);
renderer.settings.debrisCleanupEnabled = false; assert.equal(controller.hasActiveRegion(), false); assert.equal(controller.state.current, installed);
renderer.settings.debrisCleanupEnabled = true; assert.equal(controller.hasActiveRegion(), true);
fail = false; duringLoad = () => { controller.visible = false; };
assert.equal(await controller.loadAt(at), true); assert.equal(controller.visible, false); assert.equal(controller.hasActiveRegion(), false);
controller.visible = true; assert.equal(controller.hasActiveRegion(), true);
controller.clear(); assert.equal(controller.hasActiveRegion(), false); assert.equal(controller.state.bytes, 0); controller.dispose();
console.log('Native main-detail v25: source registration, normals, bounds, atomic replacement, budget, failure preservation, visibility, camera and shader-state checks passed.');
