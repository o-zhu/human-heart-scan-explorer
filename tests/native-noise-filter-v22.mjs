/** Bounded synthetic checks; no source downloads or scientific-bank mutations.
 * Optional receipt: NATIVE_NOISE_REVIEW_REPORT=docs/noise-cleanup-v22/code-review.json
 * node --test tests/native-noise-filter-v22.mjs
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { covarianceEigenvalues, classifyNativeTissue, NATIVE_CLEANUP } from '../public/native-noise-filter.js';
import { parseNativeEdges, meshNativeEdges } from '../public/native-edge-format.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_FILES = [
  'public/native-noise-filter.js', 'public/native-edge-format.js',
  'public/native-edge-worker.js', 'public/native-edge-table.js',
  'scripts/guided-native-v21/edge_codec.py', 'tests/native-noise-filter-v22.mjs',
];
const hash = value => createHash('sha256').update(value).digest('hex');
const sourceHashes = () => Object.fromEntries(SOURCE_FILES.map(path => [path, hash(readFileSync(resolve(ROOT, path)))]));
const startedHashes = sourceHashes(), startedAt = new Date().toISOString(), checks = [];
const bytesOf = view => new Uint8Array(view.buffer, view.byteOffset, view.byteLength);

function sampleGrid(n = 33) {
  const mask = new Uint8Array(n ** 3), at = (x, y, z) => (z * n + y) * n + x;
  const box = (x0, y0, z0, dx, dy, dz, value = 1) => {
    assert(x0 >= 0 && y0 >= 0 && z0 >= 0 && x0 + dx <= n && y0 + dy <= n && z0 + dz <= n);
    for (let z = z0; z < z0 + dz; z++) for (let y = y0; y < y0 + dy; y++) for (let x = x0; x < x0 + dx; x++) mask[at(x, y, z)] = value;
  };
  return { n, mask, at, box };
}

// Independent small NBE1 fixture. Bit 1 is foreground; every sign-changing
// edge receives a valid nonendpoint crossing, varied across all 32 bins.
function fixture(grid, step = 1) {
  const { n, mask, at } = grid, packedMask = new Uint8Array(Math.ceil(mask.length / 8)), streams = [], counts = [];
  for (let i = 0; i < mask.length; i++) if (mask[i]) packedMask[i >> 3] |= 1 << (i & 7);
  for (let axis = 0; axis < 3; axis++) {
    const dims = [n, n, n], values = []; dims[axis]--;
    for (let z = 0; z < dims[2]; z++) for (let y = 0; y < dims[1]; y++) for (let x = 0; x < dims[0]; x++) {
      if (mask[at(x, y, z)] !== mask[at(x + (axis === 0), y + (axis === 1), z + (axis === 2))]) values.push((3 * x + 5 * y + 7 * z + axis) % 32);
    }
    const stream = new Uint8Array(Math.ceil(values.length * 5 / 8));
    for (let i = 0; i < values.length; i++) for (let bit = 0; bit < 5; bit++) stream[(i * 5 + bit) >> 3] |= ((values[i] >> bit) & 1) << ((i * 5 + bit) & 7);
    counts.push(values.length); streams.push(stream);
  }
  const buffer = new ArrayBuffer(64 + packedMask.length + streams.reduce((sum, stream) => sum + stream.length, 0));
  const header = new DataView(buffer);
  [0x3145424e, 1, n, n, n, 5, packedMask.length, ...counts, 0, 0, 0, 0, 0, step === 1 ? 0 : step].forEach((v, i) => header.setUint32(i * 4, v, true));
  header.setFloat32(52, 17133.4, true); header.setFloat32(56, 19.85 * step, true);
  let offset = 64;
  for (const stream of [packedMask, ...streams]) { new Uint8Array(buffer, offset, stream.length).set(stream); offset += stream.length; }
  return parseNativeEdges(buffer);
}

function meshViews(mesh) {
  return {
    positions: new Float32Array(mesh.buffer, mesh.positionOffset, mesh.vertexCount * 3),
    normals: new Int16Array(mesh.buffer, mesh.normalOffset, mesh.vertexCount * 3),
    indices: new Uint32Array(mesh.buffer, mesh.indexOffset, mesh.indexCount),
  };
}
const faceKeys = indices => Array.from({ length: indices.length / 3 }, (_, i) => `${indices[3 * i]},${indices[3 * i + 1]},${indices[3 * i + 2]}`);
function multiply(a, b) {
  return Array.from({ length: 9 }, (_, i) => {
    const r = Math.floor(i / 3), c = i % 3;
    return a[3 * r] * b[c] + a[3 * r + 1] * b[3 + c] + a[3 * r + 2] * b[6 + c];
  });
}

test('Jacobi agrees with analytic eigenvalues of deterministic rotated covariance matrices', () => {
  const fixed = [
    { args: [0, 0, 0, 0, 0, 0], expected: [0, 0, 0] },
    { args: [9, 1, 4, 0, 0, 0], expected: [1, 4, 9] },
    { args: [1, 1, 0, 1, 0, 0], expected: [0, 0, 2] },
    { args: [2, 2, 2, 1, 1, 1], expected: [1, 1, 4] },
  ];
  for (const item of fixed) covarianceEigenvalues(...item.args).forEach((v, i) => assert(Math.abs(v - item.expected[i]) < 1e-12));
  let state = 205932, maxAbsoluteError = 0;
  const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 4000; i++) {
    const a = random() * 6.28, b = random() * 6.28, c = random() * 6.28;
    const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
    const q = multiply(multiply([ca, -sa, 0, sa, ca, 0, 0, 0, 1], [cb, 0, sb, 0, 1, 0, -sb, 0, cb]), [1, 0, 0, 0, cc, -sc, 0, sc, cc]);
    const diagonal = [i % 7 === 0 ? 0 : random() * 100, random() * 100, random() * 100].sort((a, b) => a - b);
    const matrix = Array.from({ length: 9 }, (_, j) => {
      const r = Math.floor(j / 3), c = j % 3;
      return q[3 * r] * diagonal[0] * q[3 * c] + q[3 * r + 1] * diagonal[1] * q[3 * c + 1] + q[3 * r + 2] * diagonal[2] * q[3 * c + 2];
    });
    const actual = covarianceEigenvalues(matrix[0], matrix[4], matrix[8], matrix[1], matrix[2], matrix[5]);
    actual.forEach((v, j) => { maxAbsoluteError = Math.max(maxAbsoluteError, Math.abs(v - diagonal[j])); });
  }
  assert(maxAbsoluteError < 1e-10);
  checks.push({ name: 'Jacobi analytic-reference comparison', passed: true, fixedMatrices: fixed.length, rotatedCovariances: 4000, maxAbsoluteError, tolerance: 1e-10 });
});

test('A small negative cavity surface remains while a detached positive tissue island is suppressed', () => {
  const g = sampleGrid();
  g.box(2, 2, 2, 10, 10, 10); g.box(5, 5, 5, 3, 3, 3, 0); g.box(20, 20, 20, 3, 3, 3);
  const parsed = fixture(g), before = hash(parsed.bytes), cleanup = classifyNativeTissue(parsed);
  assert.equal(cleanup.stats.components, 2); assert.equal(cleanup.stats.removedComponents, 1); assert.equal(cleanup.stats.removedSamples, 27);
  for (let i = 0; i < g.mask.length; i++) if (cleanup.removedSamples[i]) assert.equal(g.mask[i], 1, 'A background sample must never be selected as a tissue island.');
  const original = meshNativeEdges(parsed, { size: 32 }), cleaned = meshNativeEdges(parsed, { size: 32, cleanup });
  const a = meshViews(original), b = meshViews(cleaned), retained = new Set(faceKeys(b.indices));
  const rawPoint = i => [a.positions[3 * i] * 8479 + 3806.5, -a.positions[3 * i + 2] * 8479 + 3806.5, a.positions[3 * i + 1] * 8479 + 4239.5];
  let cavityTriangles = 0;
  for (let i = 0; i < a.indices.length; i += 3) {
    const triangle = [a.indices[i], a.indices[i + 1], a.indices[i + 2]];
    if (triangle.every(v => rawPoint(v).every(p => p >= 4 - 1e-3 && p <= 8 + 1e-3))) {
      assert(retained.has(triangle.join(',')), 'A legitimate cavity-wall triangle was removed.'); cavityTriangles++;
    }
  }
  assert(cavityTriangles > 0); assert.equal(hash(parsed.bytes), before);
  checks.push({ name: 'Foreground sign and negative-cavity distinction', passed: true, cavityTrianglesPreserved: cavityTriangles, compactIslandSamplesRemoved: 27, sourceBytesUnchanged: true });
});

test('All six outer faces and a corner-connected diagonal strand are retained', () => {
  const g = sampleGrid();
  for (const [x, y, z, dx, dy, dz] of [[0, 8, 8, 2, 1, 1], [31, 8, 8, 2, 1, 1], [16, 0, 8, 1, 2, 1], [16, 31, 8, 1, 2, 1], [16, 16, 0, 1, 1, 2], [16, 16, 31, 1, 1, 2]]) g.box(x, y, z, dx, dy, dz);
  for (let i = 0; i <= 4; i++) g.mask[g.at(i, i, i)] = 1;
  g.mask[g.at(16, 16, 16)] = 1;
  const cleanup = classifyNativeTissue(fixture(g));
  assert.equal(cleanup.stats.components, 8); assert.equal(cleanup.stats.boundaryProtectedComponents, 7);
  assert.equal(cleanup.stats.removedSamples, 1); assert.equal(cleanup.removedSamples[g.at(16, 16, 16)], 1);
  for (let i = 0; i < g.mask.length; i++) if (g.mask[i] && i !== g.at(16, 16, 16)) assert.equal(cleanup.removedSamples[i], 0);
  checks.push({ name: 'Six-face censoring and 26-connected diagonal continuation', passed: true, boundaryComponentsRetained: 7, diagonalStrandSamples: 5, interiorSingletonRemoved: true });
});

test('Exact-threshold rods and flat sheets remain protected after translation; shorter shapes do not get an unsupported guarantee', () => {
  const cases = [];
  for (const offset of [4, 120]) {
    const g = sampleGrid(129);
    g.box(offset, 4, 4, 3, 1, 1); g.box(4, offset, 10, 3, 3, 1); g.box(4, 4, 20, 2, 2, 1);
    const cleanup = classifyNativeTissue(fixture(g));
    assert.equal(cleanup.stats.components, 3); assert.equal(cleanup.stats.shapeProtectedComponents, 2);
    assert.equal(cleanup.stats.removedComponents, 1); assert.equal(cleanup.stats.removedSamples, 4);
    assert.equal(cleanup.removedSamples[g.at(offset + 1, 4, 4)], 0); assert.equal(cleanup.removedSamples[g.at(5, offset + 1, 10)], 0);
    cases.push({ sampleOffset: offset, protectedRodSamples: 3, protectedSheetSamples: 9, belowThresholdCompactSheetSamplesRemoved: 4 });
  }
  checks.push({ name: 'PCA threshold and sample-coordinate translation', passed: true, criterion: 'sqrt((lambda_max + 1/12) / (lambda_min + 1/12)) >= 3, with conservative 1e-10 guard', cases });
});

test('The 512-sample bound is inclusive and the geometric gate uses inclusive sample support', () => {
  const g = sampleGrid();
  g.box(2, 2, 2, 8, 8, 8); g.box(20, 20, 20, 8, 8, 8); g.mask[g.at(28, 20, 20)] = 1;
  const cleanup = classifyNativeTissue(fixture(g));
  assert.equal(cleanup.stats.removedSamples, 512); assert.equal(cleanup.stats.removedComponents, 1); assert.equal(cleanup.stats.sizeProtectedComponents, 1);
  const lines = sampleGrid(); lines.box(2, 4, 4, 20, 1, 1); lines.box(2, 12, 4, 21, 1, 1);
  // Disable only the shape veto to isolate the independent support-diagonal gate.
  const geometry = classifyNativeTissue(fixture(lines), { ...NATIVE_CLEANUP, protectedAnisotropy: 1e6 });
  assert.equal(geometry.stats.removedSamples, 20); assert.equal(geometry.stats.sizeProtectedComponents, 1);
  const mm = NATIVE_CLEANUP.sourceSpacingUm / 1000;
  checks.push({ name: 'Inclusive count and support-diagonal limits', passed: true, includedSampleCount: 512, excludedSampleCount: 513, supportDiagonalsMm: [Math.hypot(20, 1, 1) * mm, Math.hypot(21, 1, 1) * mm], shapeVetoDisabledOnlyForGeometryGate: true });
});

test('Eight rendering pieces partition the original faces and preserve source bytes, positions and every referenced normal', () => {
  const g = sampleGrid();
  g.box(4, 4, 4, 3, 3, 3); g.box(4, 20, 4, 12, 1, 1); g.box(20, 20, 10, 6, 6, 1);
  g.box(0, 5, 5, 2, 2, 2); g.box(22, 2, 20, 10, 10, 10); g.box(25, 5, 23, 3, 3, 3, 0);
  g.box(15, 28, 15, 2, 2, 2); // Rejected island crosses two internal piece planes.
  const parsed = fixture(g), before = hash(parsed.bytes), cleanup = classifyNativeTissue(parsed);
  assert.equal(cleanup.stats.removedComponents, 2); assert.equal(cleanup.stats.removedSamples, 35);
  const sharedMaps = [new Map(), new Map()];
  let sourceTriangles = 0, removedTriangles = 0, referencedNormalComparisons = 0, unusedNormalMismatches = 0, sharedReferencedVertices = 0;
  for (const z of [0, 16]) for (const y of [0, 16]) for (const x of [0, 16]) {
    const options = { start: [x, y, z], size: 16 };
    const original = meshNativeEdges(parsed, options), cleaned = meshNativeEdges(parsed, { ...options, cleanup }), removed = meshNativeEdges(parsed, { ...options, cleanup, cleanupView: 'removed' });
    const a = meshViews(original), b = meshViews(cleaned), c = meshViews(removed);
    assert.deepEqual(bytesOf(a.positions), bytesOf(b.positions)); assert.deepEqual(bytesOf(a.positions), bytesOf(c.positions));
    assert.equal(cleaned.triangles + removed.triangles, original.triangles);
    assert.equal(cleaned.sourceTriangles, original.triangles); assert.equal(removed.sourceTriangles, original.triangles);
    assert.equal(cleaned.suppressedTriangles, removed.triangles); assert.equal(removed.suppressedTriangles, removed.triangles);
    const allFaces = new Set(faceKeys(a.indices)), retainedFaces = new Set(faceKeys(b.indices)), rejectedFaces = new Set(faceKeys(c.indices));
    assert.equal(allFaces.size, original.triangles); assert.equal(retainedFaces.size, cleaned.triangles); assert.equal(rejectedFaces.size, removed.triangles);
    for (const key of rejectedFaces) { assert(allFaces.has(key)); assert(!retainedFaces.has(key)); }
    for (const key of retainedFaces) assert(allFaces.has(key));
    for (const [variant, views] of [b, c].entries()) {
      const used = new Set(views.indices), bits = new Uint32Array(views.positions.buffer, views.positions.byteOffset, views.positions.length);
      for (const index of used) {
        for (let k = 0; k < 3; k++) assert.equal(views.normals[3 * index + k], a.normals[3 * index + k]);
        referencedNormalComparisons++;
        const key = `${bits[3 * index]},${bits[3 * index + 1]},${bits[3 * index + 2]}`, normal = `${views.normals[3 * index]},${views.normals[3 * index + 1]},${views.normals[3 * index + 2]}`;
        if (sharedMaps[variant].has(key)) { assert.equal(sharedMaps[variant].get(key), normal); sharedReferencedVertices++; }
        else sharedMaps[variant].set(key, normal);
      }
    }
    const used = new Set(b.indices);
    for (let i = 0; i < original.vertexCount; i++) if (!used.has(i) && [0, 1, 2].some(k => a.normals[3 * i + k] !== b.normals[3 * i + k])) unusedNormalMismatches++;
    sourceTriangles += original.triangles; removedTriangles += removed.triangles;
  }
  assert.equal(hash(parsed.bytes), before); assert(sharedReferencedVertices > 0);
  checks.push({ name: 'Eight-piece exact subset and geometry retention', passed: true, syntheticSampleShapeXYZ: [33, 33, 33], pieces: 8, sourceTriangles, removedTriangles, sourceBytesUnchanged: true, allPositionBytesUnchanged: true, facePartitionExact: true, exactReferencedNormalComparisons: referencedNormalComparisons, sharedReferencedVertices, unusedNormalMismatches, unusedNormalScope: 'Unreferenced vertex normals need not match; no retained or rejected rendered vertex normal differed.' });
});

test('Non-native sampling and incomplete masks are rejected before classification', () => {
  const g = sampleGrid(); g.box(4, 4, 4, 3, 3, 3);
  assert.throws(() => classifyNativeTissue(fixture(g, 4)), /intact native tissue mask/);
  const parsed = fixture(g);
  assert.throws(() => classifyNativeTissue({ ...parsed, bytes: parsed.bytes.subarray(0, 64) }), /intact native tissue mask/);
  assert.throws(() => classifyNativeTissue(parsed, { ...NATIVE_CLEANUP, sourceSpacingUm: 79.4 }), /settings are invalid/);
  checks.push({ name: 'Native geometry and mask validation', passed: true, rejectedCases: ['step-4 overview', 'truncated sign mask', 'foreign physical spacing'] });
});

after(() => {
  const endedHashes = sourceHashes(), sourceStableDuringRun = JSON.stringify(startedHashes) === JSON.stringify(endedHashes);
  const report = {
    schema: 'native-noise-filter-v22-code-review', startedAt, completedAt: new Date().toISOString(),
    passed: checks.length === 7 && sourceStableDuringRun, completedChecks: checks.length, expectedChecks: 7,
    nodeVersion: process.version, sourceStableDuringRun, sourceHashes: startedHashes,
    sourceBankModified: false, sourceAcquisitionPerformed: false, profile: NATIVE_CLEANUP,
    scope: 'Synthetic mathematical and implementation invariants. No anatomical validation, browser performance measurement, or full-volume reprocessing.',
    reviewedSemantics: {
      sign: 'NBE1 bit 1 is field >= threshold, confirmed against edge_codec.py; filtering labels foreground tissue, not background cavities.',
      cellSuppression: 'Any two foreground corners of one cube are 26-adjacent, so a cell cannot contain both a retained and rejected foreground component under this classifier.',
      border: 'Whole-tile components touching any outer sample face are retained; internal rendering-piece boundaries do not affect classification.',
      shape: 'Square-root ratio of regularized covariance eigenvalues, with 1/12 sample-support variance. This is a principal-axis spread ratio, not a raw eigenvalue ratio.',
      geometry: 'Positions are unchanged for every allocated vertex. Normals are unchanged for vertices referenced by each selected face subset; unused normals may differ.',
    },
    checks,
    limitations: [
      'Small compact real tissue can meet the rejection rule; connectivity and shape do not establish anatomical truth.',
      'Attached clutter survives this component-only filter.',
      'PCA protects globally anisotropic rods and flat sheets, not every curved strand or sheet.',
      'The 0.4 mm gate describes inclusive sample support, not a strict decoded-surface diameter.',
      'removedVolumeMm3 is sample count times voxel volume, not an independently measured anatomical tissue volume.',
      'The synthetic partition fixture is 33 cubed; separate cached-data verification covers production 129-cubed tiles.',
      'No claim is made that all unused packed-normal bytes or all output buffer bytes remain identical.',
    ],
  };
  if (process.env.NATIVE_NOISE_REVIEW_REPORT) writeFileSync(resolve(process.env.NATIVE_NOISE_REVIEW_REPORT), JSON.stringify(report, null, 2) + '\n');
  assert.equal(sourceStableDuringRun, true, 'Reviewed source changed during the test; rerun the receipt against one stable version.');
  assert.equal(checks.length, 7, 'Not all review checks completed.');
});
