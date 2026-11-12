/** Strict GL command/accounting fixture; not a browser or physical GPU test. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { StreamedSurfaceGeometry, SURFACE_UPLOAD_CHUNK_BYTES, waitForSurfaceGPU } from '../public/surface-gpu-stream.js';
import { drawIndexedTriangles } from '../public/mesh-draw.js';
import { FineSurfacePass } from '../public/fine-surface.js';

const turn = () => new Promise(resolve => setTimeout(resolve, 1));
async function until(check) {
  for (let i = 0; i < 100; i++) { if (check()) return; await turn(); }
  assert.fail('The expected asynchronous checkpoint was not reached.');
}
function fixture() {
  const calls = [], allocations = [], uploads = [], draws = [], created = [], deleted = [], fences = [], deletedFences = [];
  const stores = new Map(), elementBuffers = new Map(), attributes = new Map();
  let vao = null, arrayBuffer = null, next = 0, error = 0;
  const mode = { lost: false, fence: 'signaled', failAllocate: false, failUpload: false, allocationError: false, flushError: false };
  const gl = {
    ARRAY_BUFFER: 34962, ELEMENT_ARRAY_BUFFER: 34963, STATIC_DRAW: 35044,
    NO_ERROR: 0, OUT_OF_MEMORY: 1285, UNSIGNED_SHORT: 5123, SHORT: 5122, UNSIGNED_BYTE: 5121,
    UNSIGNED_INT: 5125, TRIANGLES: 4, SYNC_GPU_COMMANDS_COMPLETE: 37143,
    ALREADY_SIGNALED: 37146, TIMEOUT_EXPIRED: 37147, CONDITION_SATISFIED: 37148, WAIT_FAILED: 37149,
    TEXTURE_2D: 3553, TEXTURE_MIN_FILTER: 10241, TEXTURE_MAG_FILTER: 10240,
    TEXTURE_WRAP_S: 10242, TEXTURE_WRAP_T: 10243, NEAREST: 9728, CLAMP_TO_EDGE: 33071,
    createBuffer() {
      if (mode.failAllocate) return null;
      const buffer = { id: ++next }; created.push(buffer); stores.set(buffer, { size: 0, writes: [] }); return buffer;
    },
    deleteBuffer(buffer) { deleted.push(buffer); stores.delete(buffer); },
    bindVertexArray(value) { vao = value; calls.push(['vao', value]); },
    bindBuffer(target, buffer) {
      if (target === gl.ARRAY_BUFFER) arrayBuffer = buffer;
      else { assert.equal(target, gl.ELEMENT_ARRAY_BUFFER); elementBuffers.set(vao, buffer); }
      calls.push(['bind', target, buffer, vao]);
    },
    bufferData(target, data, usage) {
      assert.equal(usage, gl.STATIC_DRAW);
      const buffer = target === gl.ARRAY_BUFFER ? arrayBuffer : elementBuffers.get(vao);
      assert.ok(stores.has(buffer), 'Every allocation targets its own live bound buffer.');
      const size = typeof data === 'number' ? data : data.byteLength;
      allocations.push({ target, buffer, size, numeric: typeof data === 'number', vao });
      stores.get(buffer).size = size;
      if (typeof data !== 'number' && size < 128) stores.get(buffer).bytes = Array.from(data);
      if (mode.allocationError) error = gl.OUT_OF_MEMORY;
    },
    bufferSubData(target, offset, bytes) {
      assert.equal(target, gl.ARRAY_BUFFER);
      assert.ok(stores.has(arrayBuffer));
      assert.ok(offset >= 0 && offset + bytes.byteLength <= stores.get(arrayBuffer).size);
      const record = { buffer: arrayBuffer, offset, size: bytes.byteLength, vao,
        ...(bytes.byteLength < 128 ? { bytes: Array.from(bytes) } : {}) };
      uploads.push(record); stores.get(arrayBuffer).writes.push(record);
      if (mode.failUpload) throw new Error('Injected buffer upload failure.');
    },
    enableVertexAttribArray(location) { calls.push(['enable', vao, location]); },
    vertexAttribPointer(location, size, type, normalized, stride, offset) {
      assert.ok(vao); assert.ok(stores.has(arrayBuffer));
      if (!attributes.has(vao)) attributes.set(vao, new Map());
      attributes.get(vao).set(location, { buffer: arrayBuffer, size, type, normalized, stride, offset });
    },
    getError() { const result = error; error = 0; return result; },
    isContextLost: () => mode.lost,
    fenceSync(condition, flags) {
      assert.equal(condition, gl.SYNC_GPU_COMMANDS_COMPLETE); assert.equal(flags, 0);
      if (mode.fence === 'null') return null;
      const fence = { id: ++next }; fences.push(fence); calls.push(['fence', fence]); return fence;
    },
    flush() { calls.push(['flush']); if (mode.flushError) throw new Error('Injected flush failure.'); },
    clientWaitSync(fence, flags, timeout) {
      assert.ok(fences.includes(fence)); assert.equal(flags, 0); assert.equal(timeout, 0);
      calls.push(['poll', fence]);
      if (typeof mode.fence === 'function') return mode.fence(gl);
      return mode.fence === 'busy' ? gl.TIMEOUT_EXPIRED : mode.fence === 'failed' ? gl.WAIT_FAILED : gl.CONDITION_SATISFIED;
    },
    deleteSync(fence) { deletedFences.push(fence); },
    drawElements(primitive, count, type, offset) {
      assert.equal(primitive, gl.TRIANGLES); assert.equal(type, gl.UNSIGNED_INT);
      const buffer = elementBuffers.get(vao);
      assert.ok(stores.has(buffer)); assert.ok(offset + count * 4 <= stores.get(buffer).size);
      draws.push({ buffer, count, offset, vao });
    },
    createVertexArray: () => ({ id: 'vao-' + ++next }), deleteVertexArray() {},
    createTexture: () => ({ id: 'texture-' + ++next }), deleteTexture() {},
    createFramebuffer: () => ({ id: 'framebuffer-' + ++next }), deleteFramebuffer() {},
    bindTexture() {}, texParameteri() {}, deleteProgram() {}, getUniformLocation: (_program, name) => name,
  };
  return { gl, mode, calls, allocations, uploads, draws, created, deleted, stores, fences, deletedFences,
    elementBuffers, attributes, get vao() { return vao; }, get arrayBuffer() { return arrayBuffer; } };
}
const chunk = (kind, byteOffset, length, value = 0) => ({ kind, byteOffset, buffer: new Uint8Array(length).fill(value).buffer });
async function smallGeometry(f, vertexCount = 3, indexCount = 3) {
  const vao = { id: 'staged' }, geometry = new StreamedSurfaceGeometry(f.gl, { vertexCount, indexCount }, vao);
  await geometry.write(chunk('position', 0, vertexCount * 6, 11));
  await geometry.write(chunk('normal', 0, vertexCount * 6, 22));
  await geometry.write({ kind: 'index', byteOffset: 0, buffer: new Uint32Array(indexCount).buffer });
  return { vao, geometry };
}

test('actual Ultra allocation plan retains all indices in bounded whole-triangle buffers', async () => {
  const f = fixture(), layout = { vertexCount: 12_837_189, indexCount: 70_856_055 }, vao = { id: 'Ultra' };
  const geometry = new StreamedSurfaceGeometry(f.gl, layout, vao);
  for (const kind of ['position', 'normal', 'index']) {
    const unit = kind === 'index' ? 12 : 6, maximum = Math.floor(SURFACE_UPLOAD_CHUNK_BYTES / unit) * unit;
    const reusable = new ArrayBuffer(maximum);
    for (let offset = 0; offset < geometry.sizes[kind]; offset += maximum) {
      const remaining = geometry.sizes[kind] - offset;
      await geometry.write({ kind, byteOffset: offset, buffer: remaining >= maximum ? reusable : new ArrayBuffer(remaining) });
    }
  }
  assert.equal(geometry.ready, false);
  await geometry.finish(new Uint8Array(layout.vertexCount));
  const indices = f.allocations.filter(call => call.target === f.gl.ELEMENT_ARRAY_BUFFER);
  assert.equal(indices.length, 136);
  assert.ok(indices.every(call => !call.numeric && call.size <= SURFACE_UPLOAD_CHUNK_BYTES && call.size % 12 === 0));
  assert.equal(indices.reduce((sum, call) => sum + call.size, 0), 283_424_220);
  assert.deepEqual(f.allocations.filter(call => call.numeric).map(call => call.size), [77_023_134, 77_023_134, 12_837_189]);
  assert.ok(f.uploads.every(call => call.size <= SURFACE_UPLOAD_CHUNK_BYTES));
  assert.ok(f.allocations.every(call => call.size < 80_000_000), 'No monolithic full-model or 283MB index allocation.');
  f.gl.bindVertexArray(vao);
  assert.equal(geometry.draw(drawIndexedTriangles), 136);
  assert.equal(f.draws.reduce((sum, call) => sum + call.count, 0), layout.indexCount);
  assert.ok(f.draws.every(call => call.offset === 0 && call.count % 3 === 0));
  assert.deepEqual(f.draws.map(call => call.buffer), indices.map(call => call.buffer));
  geometry.dispose(); geometry.dispose();
  assert.deepEqual(new Set(f.deleted), new Set(f.created)); assert.equal(f.deleted.length, f.created.length);
  assert.deepEqual(new Set(f.deletedFences), new Set(f.fences));
});

test('a chunk is acknowledged only after an asynchronous nonblocking fence and cannot overlap another upload', async () => {
  const f = fixture(); f.mode.fence = 'busy';
  const geometry = new StreamedSurfaceGeometry(f.gl, { vertexCount: 6, indexCount: 3 }, { id: 'staged' });
  let acknowledged = false;
  const write = geometry.write(chunk('position', 0, 18)).then(() => { acknowledged = true; });
  await until(() => f.fences.length === 1);
  assert.equal(f.calls.some(call => call[0] === 'poll'), false, 'First fence poll waits for a later event-loop task.');
  await assert.rejects(geometry.write(chunk('position', 18, 18)), /upload order/);
  assert.equal(f.uploads.length, 1); assert.equal(geometry.received.position, 0); assert.equal(acknowledged, false);
  await until(() => f.calls.some(call => call[0] === 'poll'));
  assert.equal(acknowledged, false);
  f.mode.fence = 'signaled'; await write;
  assert.equal(geometry.received.position, 18); assert.equal(acknowledged, true);
  assert.deepEqual(f.deletedFences, f.fences);
  geometry.dispose();
});

test('working-view rendering between acknowledgements cannot redirect staging uploads or change its VAO', async () => {
  const f = fixture(), staging = { id: 'staged' }, working = { id: 'working' };
  const workingVertex = f.gl.createBuffer(), workingIndex = f.gl.createBuffer();
  f.gl.bindVertexArray(working); f.gl.bindBuffer(f.gl.ARRAY_BUFFER, workingVertex);
  f.gl.bufferData(f.gl.ARRAY_BUFFER, 48, f.gl.STATIC_DRAW); f.gl.vertexAttribPointer(0, 3, f.gl.UNSIGNED_SHORT, true, 0, 0);
  f.gl.bindBuffer(f.gl.ELEMENT_ARRAY_BUFFER, workingIndex); f.gl.bufferData(f.gl.ELEMENT_ARRAY_BUFFER, 12, f.gl.STATIC_DRAW);
  const geometry = new StreamedSurfaceGeometry(f.gl, { vertexCount: 6, indexCount: 6 }, staging);
  await geometry.write(chunk('position', 0, 18, 17));
  f.gl.bindVertexArray(working); f.gl.bindBuffer(f.gl.ARRAY_BUFFER, workingVertex);
  f.gl.bindBuffer(f.gl.ELEMENT_ARRAY_BUFFER, workingIndex);
  await geometry.write(chunk('position', 18, 18, 19));
  await geometry.write(chunk('normal', 0, 36, 23));
  const indexA = new Uint32Array([0, 2, 1]), indexB = new Uint32Array([3, 5, 4]);
  await geometry.write({ kind: 'index', byteOffset: 0, buffer: indexA.buffer });
  f.gl.bindVertexArray(working); f.gl.bindBuffer(f.gl.ELEMENT_ARRAY_BUFFER, workingIndex);
  await geometry.write({ kind: 'index', byteOffset: 12, buffer: indexB.buffer });
  await geometry.finish(Uint8Array.of(0, 0, 0, 255, 255, 255));
  assert.equal(f.vao, null); assert.equal(f.arrayBuffer, null);
  assert.equal(f.elementBuffers.get(working), workingIndex);
  assert.equal(f.attributes.get(working).get(0).buffer, workingVertex);
  assert.ok(f.uploads.every(call => call.vao === staging && call.buffer !== workingVertex));
  assert.deepEqual(f.uploads.slice(0, 2).map(call => [call.offset, call.size, call.bytes[0]]), [[0, 18, 17], [18, 18, 19]]);
  assert.deepEqual(geometry.indices.map(item => f.stores.get(item.buffer).bytes), [Array.from(new Uint8Array(indexA.buffer)), Array.from(new Uint8Array(indexB.buffer))]);
  f.gl.bindVertexArray(staging); geometry.draw(drawIndexedTriangles);
  assert.deepEqual(f.draws.map(call => [call.count, call.offset]), [[3, 0], [3, 0]]);
  geometry.dispose();
  assert.equal(f.deleted.includes(workingVertex), false); assert.equal(f.deleted.includes(workingIndex), false);
});

test('cleanup completion is exclusive and a partial or still-uploading surface cannot draw', async () => {
  const f = fixture(), { geometry } = await smallGeometry(f);
  assert.throws(() => geometry.draw(drawIndexedTriangles), /incomplete/);
  f.mode.fence = 'busy';
  const finish = geometry.finish(new Uint8Array(3));
  await until(() => f.uploads.some(call => call.size === 3));
  await assert.rejects(geometry.finish(new Uint8Array(3)), /complete streamed surface/);
  assert.equal(f.uploads.filter(call => call.size === 3).length, 1);
  assert.equal(geometry.ready, false); assert.throws(() => geometry.draw(drawIndexedTriangles), /incomplete/);
  f.mode.fence = 'signaled'; await finish;
  assert.equal(geometry.ready, true); assert.equal(geometry.uploading, false);
  geometry.dispose();
});

test('invalid layouts, attribute order, offsets and partial triangles fail before allocation', async () => {
  for (const layout of [{ vertexCount: 0, indexCount: 3 }, { vertexCount: 3, indexCount: 4 }, { vertexCount: Number.MAX_SAFE_INTEGER, indexCount: 3 }, { vertexCount: 30_000_000, indexCount: 120_000_000 }]) {
    assert.throws(() => new StreamedSurfaceGeometry(fixture().gl, layout, {}), /layout/);
  }
  for (const message of [chunk('normal',0,18), chunk('position',6,18), chunk('position',0,17), chunk('position',0,24), chunk('unknown',0,18), chunk('index',0,8), chunk('position',0,SURFACE_UPLOAD_CHUNK_BYTES+4)]) {
    const f = fixture(), geometry = new StreamedSurfaceGeometry(f.gl, { vertexCount: 3, indexCount: 3 }, {});
    await assert.rejects(geometry.write(message), /chunk|order/);
    assert.equal(f.created.length, 0); geometry.dispose();
  }
});

test('allocation, upload, fence creation, flush and fence wait failures release all staged storage', async () => {
  for (const failure of ['failAllocate', 'allocationError', 'failUpload', 'fence-null', 'flushError', 'fence-failed']) {
    const f = fixture(), geometry = new StreamedSurfaceGeometry(f.gl, { vertexCount: 3, indexCount: 3 }, {});
    if (failure.startsWith('fence-')) f.mode.fence = failure.slice(6); else f.mode[failure] = true;
    await assert.rejects(geometry.write(chunk('position',0,18)), error => error.resourceFailure === true && /storage|retain|upload|schedule|flush|finish/.test(error.message));
    assert.equal(geometry.disposed, true); assert.equal(geometry.ready, false); assert.equal(geometry.uploading, false);
    assert.deepEqual(new Set(f.deleted), new Set(f.created));
    assert.deepEqual(new Set(f.deletedFences), new Set(f.fences));
    assert.equal(f.vao, null); assert.equal(f.arrayBuffer, null);
  }
});

test('a failed index fence poisons the staged session so retry cannot append duplicate triangles', async () => {
  const f = fixture(), geometry = new StreamedSurfaceGeometry(f.gl, { vertexCount: 3, indexCount: 3 }, {});
  await geometry.write(chunk('position',0,18)); await geometry.write(chunk('normal',0,18));
  f.mode.fence = 'failed';
  await assert.rejects(geometry.write(chunk('index',0,12)), /finish/);
  const allocations = f.allocations.length;
  f.mode.fence = 'signaled';
  await assert.rejects(geometry.write(chunk('index',0,12)));
  assert.equal(f.allocations.length, allocations); assert.equal(geometry.indices.length, 0);
  assert.equal(geometry.received.index, 0); assert.throws(() => geometry.draw(drawIndexedTriangles), /incomplete/);
});

test('dispose or parent cancellation settles pending GPU work and deletes its fence promptly', async () => {
  for (const parentCancel of [false, true]) {
    const f = fixture(); f.mode.fence = 'busy';
    const abort = new AbortController(), geometry = new StreamedSurfaceGeometry(f.gl, { vertexCount: 3, indexCount: 3 }, {});
    const write = geometry.write(chunk('position',0,18), { signal: abort.signal });
    const rejected = assert.rejects(write, { name: 'AbortError' });
    await until(() => f.fences.length > 0);
    if (parentCancel) abort.abort(); else geometry.dispose();
    await rejected;
    assert.equal(geometry.disposed, true); assert.equal(geometry.received.position, 0);
    assert.deepEqual(f.deletedFences, f.fences); assert.deepEqual(f.deleted, f.created);
    assert.equal(getEventListeners(abort.signal, 'abort').length, 0);
    assert.equal(getEventListeners(geometry.abortController.signal, 'abort').length, 0);
  }
});

test('disposal during a cooperative or noncooperative workspace pause settles without starting allocations', async () => {
  for (const cooperative of [false, true]) {
    const f = fixture(), geometry = new StreamedSurfaceGeometry(f.gl, { vertexCount: 3, indexCount: 3 }, {});
    let entered = false, gateSignal, activeWaiters = 0;
    const waitForWorkspace = signal => { entered = true; gateSignal = signal; activeWaiters++;
      return new Promise((_resolve, reject) => {
        if (!cooperative) return;
        signal.addEventListener('abort', () => { activeWaiters--; reject(signal.reason); }, { once: true });
      });
    };
    const pending = geometry.write(chunk('position',0,18), { waitForWorkspace });
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    await until(() => entered); geometry.dispose(); await rejected;
    assert.equal(f.created.length, 0); assert.equal(f.fences.length, 0);
    assert.equal(getEventListeners(gateSignal, 'abort').length, 0);
    if (cooperative) assert.equal(activeWaiters, 0);
  }
});

test('context loss during staging stops acknowledgement and frees the candidate', async () => {
  const f = fixture(); f.mode.fence = 'busy';
  const geometry = new StreamedSurfaceGeometry(f.gl, { vertexCount: 3, indexCount: 3 }, {});
  const write = geometry.write(chunk('position',0,18));
  const rejected = assert.rejects(write, error => error.resourceFailure === true && /context/.test(error.message));
  await until(() => f.fences.length > 0); f.mode.lost = true; await rejected;
  assert.equal(geometry.ready, false); assert.equal(geometry.received.position, 0);
  assert.deepEqual(f.deleted, f.created); assert.deepEqual(f.deletedFences, f.fences);
});

test('GPU fences have a finite active timeout but exclude a suspended timer gap', async () => {
  const timed = fixture(); timed.mode.fence = 'busy';
  await assert.rejects(waitForSurfaceGPU(timed.gl, { timeoutMs: 0 }), error => error.resourceFailure === true && /too long/.test(error.message));
  assert.deepEqual(timed.deletedFences, timed.fences);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  let time = 0, polls = 0;
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => time } });
  try {
    const paused = fixture(); paused.mode.fence = gl => { if (polls++ === 0) { time = 600_000; return gl.TIMEOUT_EXPIRED; } return gl.CONDITION_SATISFIED; };
    await waitForSurfaceGPU(paused.gl, { timeoutMs: 150 });
    assert.equal(polls, 2); assert.deepEqual(paused.deletedFences, paused.fences);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'performance', descriptor); else delete globalThis.performance;
  }
});

test('the production pass allocates no mesh at construction and enables only a completely verified stream', async () => {
  const f = fixture(), source = 'a'.repeat(64);
  const layout = { vertexCount: 3, indexCount: 3, geometrySourceSha256: source,
    get buffer() { throw new Error('A streamed pass cannot request whole CPU geometry.'); } };
  const renderer = { gl: f.gl, uniforms: {}, createProgram: () => ({}), extent: [1,1,1],
    settings: { mode:0, cleanupEnabled:true, showPlanes:false, threshold:.28 } };
  const manifest = { extent:[1,1,1], threshold:.28, bounds:{min:[0,0,0],max:[1,1,1]} };
  const pass = new FineSurfacePass(renderer, layout, manifest, { id:'gentle' }, { streaming:true });
  assert.equal(f.allocations.length, 0); assert.equal(pass.enabled, false); assert.equal(pass.activeFor(renderer), false);
  await pass.uploadStreamChunk(chunk('position',0,18)); await pass.uploadStreamChunk(chunk('normal',0,18)); await pass.uploadStreamChunk(chunk('index',0,12));
  const completed = { geometrySourceSha256:source, debrisValidated:true, debrisFlags:new Uint8Array(3), debrisReport:{removedTriangles:0} };
  for (const invalid of [{...completed,debrisValidated:false},{...completed,geometrySourceSha256:'b'.repeat(64)}]) {
    await assert.rejects(pass.finishStream(invalid), /not verified/); assert.equal(pass.enabled, false);
  }
  await pass.finishStream(completed);
  assert.equal(pass.enabled, true); assert.equal(pass.activeFor(renderer), true); assert.equal(pass.hasDebrisMask, true);
  assert.equal(pass.debrisReport, completed.debrisReport);
  pass.dispose(); assert.deepEqual(new Set(f.deleted), new Set(f.created));
});
