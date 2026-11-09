/** Production volume upload with a recording/failing driver; no physical GPU claim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { VolumeRenderer } from '../public/renderer.js';
import { buildAcceleration } from '../public/render-v5-acceleration.js';

const stateKeys = ['texture', 'data', 'meta', 'dimensions', 'extent', 'loaded', 'textureDimensions', 'textureOffset', 'textureBytes', 'acceleration', 'accelerationTexture', 'camera', 'settings', 'cap', 'cameraQuality', 'sectionQuality'];
const volume = (dimensions, spacingUm = 100) => ({
  data: Uint8Array.from({ length: dimensions.reduce((a, b) => a * b, 1) }, (_, i) => i * 29 & 255),
  meta: { dimensions, spacingUm },
});

function fixture({ max = 64, failure = null, loaded = true } = {}) {
  const initial = volume([4, 4, 4]), oldTexture = { id: 'working-volume' }, oldAccelerationTexture = { id: 'working-maxima' };
  const textures = new Map([[oldTexture, initial.data.slice()], [oldAccelerationTexture, Uint8Array.of(255)]]);
  const bindings = new Map([[100, oldTexture], [104, oldAccelerationTexture]]);
  const created = [], deleted = [], uploads = [], parameters = [], renders = [];
  let unit = 100, error = 0, attempts = 0, renderer;
  const gl = {
    NO_ERROR: 0, OUT_OF_MEMORY: 1285, MAX_3D_TEXTURE_SIZE: 'max', TEXTURE0: 100, TEXTURE4: 104,
    TEXTURE_3D: '3d', UNPACK_ALIGNMENT: 'alignment', R8: 'r8', RED: 'red', UNSIGNED_BYTE: 'u8',
    TEXTURE_MIN_FILTER: 'min', TEXTURE_MAG_FILTER: 'mag', TEXTURE_WRAP_S: 's', TEXTURE_WRAP_T: 't', TEXTURE_WRAP_R: 'r',
    LINEAR: 'linear', NEAREST: 'nearest', CLAMP_TO_EDGE: 'edge',
    getParameter(key) { assert.equal(key, this.MAX_3D_TEXTURE_SIZE); return max; },
    createTexture() {
      attempts++;
      if (failure === 'allocate-volume' || failure === 'allocate-acceleration' && attempts === 2) return null;
      const texture = { id: 'candidate-' + attempts }; created.push(texture); textures.set(texture, null); return texture;
    },
    activeTexture(value) { unit = value; },
    bindTexture(target, texture) { assert.equal(target, this.TEXTURE_3D); bindings.set(unit, texture); },
    pixelStorei(parameter, value) { assert.equal(parameter, this.UNPACK_ALIGNMENT); assert.equal(value, 1); },
    texParameteri(target, parameter, value) {
      assert.equal(target, this.TEXTURE_3D);
      parameters.push({ texture: bindings.get(unit), parameter, value });
      if (failure === 'parameters') throw new Error('Fixture driver parameter failure');
    },
    texImage3D(target, level, format, x, y, z, border, type, dataType, data) {
      assert.equal(target, this.TEXTURE_3D); assert.equal(level, 0); assert.equal(format, this.R8);
      assert.equal(border, 0); assert.equal(type, this.RED); assert.equal(dataType, this.UNSIGNED_BYTE);
      const texture = bindings.get(unit);
      uploads.push({ texture, dimensions: [x, y, z], data, stateDuringUpload: Object.fromEntries(stateKeys.map(key => [key, renderer[key]])) });
      if (failure === 'upload-throw') throw new Error('Fixture driver upload failure');
      if (failure === 'upload-volume' && uploads.length === 1 || failure === 'upload-acceleration' && uploads.length === 2) {
        textures.set(texture, null); error = this.OUT_OF_MEMORY; return;
      }
      textures.set(texture, data.slice());
    },
    getError() { const result = error; error = 0; return result; },
    deleteTexture(texture) {
      deleted.push(texture); textures.delete(texture);
      for (const [key, value] of bindings) if (value === texture) bindings.set(key, null);
    },
  };
  renderer = Object.assign(Object.create(VolumeRenderer.prototype), {
    gl, ...initial, dimensions: initial.meta.dimensions, extent: [1, 1, 1], loaded,
    texture: oldTexture, textureDimensions: initial.meta.dimensions, textureOffset: [0, 0, 0], textureBytes: initial.data.length,
    acceleration: buildAcceleration(initial.data, initial.meta.dimensions, 2), accelerationTexture: oldAccelerationTexture,
    camera: { yaw: .3, pitch: .1, roll: Math.PI, distance: 1.65, pan: [.1, .2, .3] },
    settings: { mode: 0, threshold: .28, clipAxis: 1, clipPosition: .6 }, cap: { key: 'current-cut-face' },
    cameraQuality: true, sectionQuality: false,
    requestRender(reason) { renders.push({ reason, texture: this.texture, data: this.data, meta: this.meta }); },
  });
  const before = Object.fromEntries(stateKeys.map(key => [key, renderer[key]]));
  return { renderer, before, gl, created, deleted, uploads, parameters, renders, textures, bindings, initial, attempts: () => attempts };
}

function assertPreserved(f) {
  for (const key of stateKeys) assert.equal(f.renderer[key], f.before[key], key + ' must retain the working view');
  assert.deepEqual(f.textures.get(f.before.texture), f.initial.data);
  assert.equal(f.bindings.get(f.gl.TEXTURE0), f.before.texture);
  assert.equal(f.bindings.get(f.gl.TEXTURE4), f.before.accelerationTexture);
  assert.ok(!f.deleted.includes(f.before.texture));
  assert.ok(!f.deleted.includes(f.before.accelerationTexture));
  assert.equal(f.renders.length, 0);
}

test('failed volume allocation, parameter setup and driver upload preserve the complete working preview', () => {
  for (const failure of ['allocate-volume', 'parameters', 'upload-throw', 'upload-volume']) {
    const f = fixture({ failure }), next = volume([8, 6, 4], [100, 200, 300]), bytes = next.data.slice();
    assert.throws(() => f.renderer.load(next.data, next.meta), /allocate|parameter|upload|WebGL/);
    assertPreserved(f);
    assert.deepEqual(next.data, bytes, 'The source array is not altered by driver failure.');
    assert.deepEqual(f.deleted, f.created, 'Only candidate textures are released.');
  }
});

test('a failed first load never marks the renderer loaded or publishes new source metadata', () => {
  const f = fixture({ failure: 'upload-volume', loaded: false }), next = volume([8, 6, 4]);
  assert.throws(() => f.renderer.load(next.data, next.meta), /WebGL/);
  assertPreserved(f);
  assert.equal(f.renderer.loaded, false);
});

test('a hardware size rejection performs no allocation and leaves the existing volume intact', () => {
  const f = fixture({ max: 4 }), next = volume([5, 3, 3]);
  assert.throws(() => f.renderer.load(next.data, next.meta), /3D texture limit/);
  assert.equal(f.attempts(), 0); assert.equal(f.uploads.length, 0);
  assertPreserved(f);
});

test('a valid replacement commits exact source pixels and acceleration only after both uploads pass', () => {
  const f = fixture(), next = volume([8, 6, 4], [100, 200, 300]);
  const acceleration = buildAcceleration(next.data, next.meta.dimensions, 2), original = next.data.slice();
  f.renderer.load(next.data, next.meta, acceleration);
  assert.equal(f.uploads.length, 2);
  for (const upload of f.uploads) {
    for (const key of stateKeys) assert.equal(upload.stateDuringUpload[key], f.before[key], key + ' cannot publish before all uploads succeed');
  }
  assert.equal(f.renderer.texture, f.created[0]); assert.equal(f.renderer.accelerationTexture, f.created[1]);
  assert.equal(f.renderer.data, next.data); assert.equal(f.renderer.meta, next.meta);
  assert.equal(f.renderer.dimensions, next.meta.dimensions); assert.deepEqual(f.renderer.extent, [.7, .9, 1]);
  assert.equal(f.renderer.acceleration, acceleration); assert.equal(f.uploads[1].data, acceleration.maxima);
  assert.equal(f.uploads[0].data, next.data); assert.deepEqual(f.textures.get(f.renderer.texture), original); assert.deepEqual(next.data, original);
  assert.deepEqual(new Set(f.deleted), new Set([f.before.texture, f.before.accelerationTexture]));
  assert.equal(f.renderer.camera, f.before.camera); assert.equal(f.renderer.settings, f.before.settings); assert.equal(f.renderer.cap, f.before.cap);
  assert.deepEqual(f.renders, [{ reason: undefined, texture: f.renderer.texture, data: next.data, meta: next.meta }]);
  for (const [texture, filter] of [[f.created[0], f.gl.LINEAR], [f.created[1], f.gl.NEAREST]]) {
    const params = f.parameters.filter(item => item.texture === texture);
    assert.equal(params.find(item => item.parameter === f.gl.TEXTURE_MIN_FILTER).value, filter);
    assert.equal(params.find(item => item.parameter === f.gl.TEXTURE_MAG_FILTER).value, filter);
    assert.deepEqual(params.filter(item => ['s', 't', 'r'].includes(item.parameter)).map(item => item.value), ['edge', 'edge', 'edge']);
  }
});

test('acceleration allocation or upload failure discards both candidates and preserves the old source grid', () => {
  for (const failure of ['allocate-acceleration', 'upload-acceleration']) {
    const f = fixture({ failure }), next = volume([8, 6, 4]), acceleration = buildAcceleration(next.data, next.meta.dimensions, 2);
    assert.throws(() => f.renderer.load(next.data, next.meta, acceleration), /acceleration/);
    assertPreserved(f);
    assert.deepEqual(new Set(f.deleted), new Set(f.created));
  }
});

test('valid GPU cropping changes storage only; all source arrays, offsets and physical frames remain exact', () => {
  const f = fixture({ max: 4 }), next = volume([7, 9, 11], [100, 200, 300]);
  const crop = { dimensions: [3, 4, 3], offset: [1, 2, 3], data: new Uint8Array(36) };
  let index = 0;
  for (let z = 0; z < 3; z++) for (let y = 0; y < 4; y++) for (let x = 0; x < 3; x++) crop.data[index++] = next.data[x + 1 + 7 * (y + 2 + 9 * (z + 3))];
  f.renderer.load(next.data, next.meta, null, crop);
  assert.equal(f.renderer.data, next.data); assert.equal(f.renderer.meta, next.meta); assert.equal(f.renderer.dimensions, next.meta.dimensions);
  assert.deepEqual(f.renderer.extent, [.2, 1, 1600 / 3000]);
  assert.equal(f.renderer.textureDimensions, crop.dimensions); assert.equal(f.renderer.textureOffset, crop.offset); assert.equal(f.renderer.textureBytes, crop.data.length);
  assert.deepEqual(f.uploads[0].dimensions, crop.dimensions); assert.equal(f.uploads[0].data, crop.data);
  assert.deepEqual(f.textures.get(f.renderer.texture), crop.data);
  assert.equal(f.renderer.acceleration, null); assert.equal(f.renderer.accelerationTexture, f.before.accelerationTexture);
});

test('an invalid crop and mismatching acceleration retain the full-volume fallback semantics', () => {
  const f = fixture(), next = volume([8, 6, 4]);
  f.renderer.load(next.data, next.meta, f.before.acceleration, { dimensions: [2, 2, 2], offset: [-1, 0, 0], data: new Uint8Array(8) });
  assert.equal(f.uploads.length, 1); assert.equal(f.uploads[0].data, next.data);
  assert.equal(f.renderer.textureDimensions, next.meta.dimensions); assert.deepEqual(f.renderer.textureOffset, [0, 0, 0]);
  assert.equal(f.renderer.textureBytes, next.data.length); assert.equal(f.renderer.acceleration, null);
});

test('first load and source-grid changes preserve the existing render-quality intent rules', () => {
  for (const [loaded, sectionQuality, sameGrid, expected] of [[false, false, false, 'scene'], [true, true, false, 'scene'], [true, true, true, undefined], [true, false, false, undefined]]) {
    const f = fixture({ loaded }); f.renderer.sectionQuality = sectionQuality;
    const next = volume(sameGrid ? [4, 4, 4] : [8, 6, 4]);
    f.renderer.load(next.data, next.meta);
    assert.equal(f.renders[0].reason, expected);
    assert.equal(f.renderer.camera, f.before.camera);
  }
});
