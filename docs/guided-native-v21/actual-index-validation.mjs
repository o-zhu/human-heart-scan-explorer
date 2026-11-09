/**
 * Validate the actual immutable whole-bank index and its local overview assets.
 * No network, source changes, publishability overrides, or synthetic input data.
 *
 * Run:
 * node --expose-gc docs/guided-native-v21/actual-index-validation.mjs \
 *   [final-manifest-directory] [overview-directory] [report-json]
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateGuidedManifest, selectAvailableTile } from '../../public/native-edge-loader.js';
import { boundedRead, MAX_MANIFEST_BYTES } from '../../public/native-edge-worker.js';
import { parseNativeMesh } from '../../public/native-mesh-format.js';
import { WholeNativeViewer, SurfacePane } from '../../public/whole-native.js';

const here = dirname(fileURLToPath(import.meta.url));
const manifestDir = resolve(process.argv[2] || '{source-cache}/guided-native-v21/whole/final-manifest');
const overviewDir = resolve(process.argv[3] || '{source-cache}/guided-native-v21/whole/overview');
const reportPath = resolve(process.argv[4] || resolve(here, 'actual-index-validation.json'));
const site = 'https://human-heart-scan-explorer.zhuou557737.chatgpt.site';
const api = site + '/api/guided-native-v21/';
const expectedManifestSha256 = 'afc97dc2a7e8dca3304de4296a5d6436d733e0a0c1410b84f8b1e16da41e8e5a';
const started = performance.now();
const hash = value => createHash('sha256').update(value).digest('hex');
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const safeSum = (rows, key) => {
  let sum = 0, exact = 0n;
  for (const row of rows) {
    assert(Number.isSafeInteger(row[key]) && row[key] >= 0, key + ' is not a nonnegative safe integer');
    sum += row[key]; exact += BigInt(row[key]);
  }
  assert(Number.isSafeInteger(sum));
  assert.equal(BigInt(sum), exact, key + ' lost integer precision');
  return sum;
};

async function verifiedLocalGzip(path, record, limit) {
  const encoded = await readFile(path);
  const size = record.bytes ?? record.compressedBytes;
  assert(Number.isSafeInteger(size) && size > 0 && size <= limit);
  assert(Number.isSafeInteger(record.decodedBytes) && record.decodedBytes > 0 && record.decodedBytes <= limit);
  assert.equal(encoded.byteLength, size);
  assert.equal(hash(encoded), record.sha256);
  const decoded = await boundedRead(
    new Blob([encoded]).stream().pipeThrough(new DecompressionStream('gzip')),
    record.decodedBytes
  );
  assert.equal(decoded.byteLength, record.decodedBytes);
  assert.equal(hash(decoded), record.decodedSha256);
  return decoded;
}

// Execute the production budget guard and deliberately stop at the first real
// GPU allocation. This establishes the guard result, not device allocation,
// rendering, shader compatibility, or browser performance.
function passesActualGpuBudgetGuard(decoded, part, retainedBytes, stagedBytes) {
  const allocationBoundary = new Error('Intentional stop after the production GPU-budget guard');
  let reached = false;
  const pane = {
    lost: false, gpuBytes: retainedBytes,
    gl: { createVertexArray() { reached = true; throw allocationBoundary; } }
  };
  try {
    SurfacePane.prototype.upload.call(pane, decoded, part, stagedBytes);
    assert.fail('Expected to reach the allocation boundary');
  } catch (error) {
    if (error !== allocationBoundary) throw error;
  }
  assert(reached);
  return true;
}

const artifactPath = resolve(manifestDir, 'artifact.json');
const artifact = await readJson(artifactPath);
assert.equal(artifact.sha256, expectedManifestSha256);
assert.equal(artifact.publishable, true);
assert.equal(artifact.fixtureOnly, false);
assert.equal(artifact.completeScope, 'whole-plan');
const decodedIndex = await verifiedLocalGzip(resolve(manifestDir, 'manifest.json.gz'), artifact, MAX_MANIFEST_BYTES);
assert.equal(hash(await readFile(resolve(manifestDir, 'manifest.json'))), artifact.decodedSha256);
const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decodedIndex));
assert.equal(value.publishable, true);
assert.equal(value.fixtureOnly, false);
assert.equal(value.complete, true);
assert.equal(value.completeScope, 'whole-plan');
const baseUrl = artifact.suggestedManifestUrl;
assert.equal(baseUrl, api + 'manifest-' + artifact.sha256 + '.json.gz');
const validationStarted = performance.now();
const manifest = validateGuidedManifest(value, baseUrl);
const validatorMilliseconds = performance.now() - validationStarted;
assert.equal(manifest.tiles.length, 33046);
assert.equal(manifest.coverage.plannedBlocks, 37612);
assert.equal(manifest.coverage.completedBlocks, 37612);
assert.equal(manifest.coverage.emptyBlocks, 4566);
assert.equal(manifest.coverage.availableSurfaceBlocks, manifest.tiles.length);
assert.equal(manifest.tiles.length + manifest.coverage.emptyBlocks, manifest.coverage.completedBlocks);
for (const tile of manifest.tiles) {
  assert.equal(tile.key, tile.xyz.join('_'));
  assert.equal(tile.url, api + 'tiles/' + tile.key + '-' + tile.sha256 + '.nbe.gz');
  assert(/^[0-9a-f]{64}$/.test(tile.decodedSha256));
}
const totals = {
  nativeVertices: safeSum(manifest.tiles, 'vertices'),
  nativeTriangles: safeSum(manifest.tiles, 'triangles'),
  nativeCompressedBytes: safeSum(manifest.tiles, 'bytes'),
  nativeDecodedBytes: safeSum(manifest.tiles, 'decodedBytes')
};
for (const [key, sum] of Object.entries(totals)) assert.equal(sum, manifest.totals[key]);
for (const [key, count] of Object.entries(manifest.totals)) assert(Number.isSafeInteger(count) && count >= 0, key);
assert.equal(totals.nativeVertices, 6192976842);
assert.equal(totals.nativeTriangles, 12168077800);
assert.equal(totals.nativeCompressedBytes, 5810515698);
const contributionKeys = ['nativeOnlyEdgeVertices', 'blendedEdgeVertices', 'priorOnlyEdgeVertices'];
const contributionTotal = contributionKeys.reduce((sum, key) => sum + manifest.coverage[key], 0);
assert(Number.isSafeInteger(contributionTotal));
assert.equal(contributionTotal, totals.nativeVertices);
const choice = selectAvailableTile(manifest.tiles, manifest.defaultRegionXYZ);
assert.equal(choice.exact, true);
assert.equal(choice.distanceMm, 0);
assert(choice.tile.triangles > 0);

// Use the real controller's candidate normalization and label construction.
// These inert text sinks do not provide synthetic reconstruction metadata.
const elements = new Map();
const element = () => ({
  textContent: '', children: [], classList: { toggle() {} },
  append(...children) { this.children.push(...children); },
  replaceChildren(...children) { this.children = children; }
});
const get = id => {
  if (!elements.has(id)) elements.set(id, element());
  return elements.get(id);
};
const controller = {
  manifest, overviewChoices: new Map(), get,
  document: { createElement: element }, window: { location: { href: site + '/whole-native.html' } }
};
WholeNativeViewer.prototype.configureOverview.call(controller, baseUrl);
WholeNativeViewer.prototype.fillCoverage.call(controller);
assert.deepEqual([...controller.overviewChoices.keys()], ['overview', 'detail']);
assert.equal(controller.overviewRequestedId, 'overview');
assert.equal(get('overviewQualityControl').hidden, false);
const provenanceText = get('provenance').children[0].children.map(x => x.textContent).join('\n');
for (const key of contributionKeys) {
  assert(provenanceText.includes(new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(manifest.coverage[key])));
}

const localOverviewPath = resolve(overviewDir, 'manifest.json');
const localOverview = await readJson(localOverviewPath);
assert.equal(localOverview.complete, true);
const byHash = new Map(localOverview.lods.flatMap(lod => lod.parts.map(part => [part.sha256, part])));
const choices = [...controller.overviewChoices.values()];
const expectedGpuBytes = new Map(choices.map(lod => [lod.id,
  lod.parts.reduce((sum, p) => sum + p.vertices * 18 + p.triangles * 12, 0)
]));
const lodChecks = [];
for (const lod of choices) {
  const parts = [];
  let triangles = 0, vertices = 0, gpuBytes = 0, decodedBytes = 0;
  for (const part of lod.parts) {
    assert.equal(new URL(part.url).origin, site);
    assert(new URL(part.url).pathname.startsWith('/api/guided-native-v21/overview/'));
    const local = byHash.get(part.sha256);
    assert(local, 'No matching actual local overview artifact');
    assert.equal(part.decodedSha256, local.decodedSha256);
    assert.equal(part.decodedBytes, local.decodedBytes);
    assert.equal(part.bytes, local.compressedBytes);
    const path = resolve(overviewDir, local.path);
    const decoded = await verifiedLocalGzip(path, part, 128 * 1024 * 1024);
    assert.equal(decoded.byteOffset, 0);
    assert.equal(decoded.byteLength, decoded.buffer.byteLength);
    const mesh = parseNativeMesh(decoded.buffer, part.decodedBytes);
    assert.equal(mesh.positionFormat, 'float32');
    assert.equal(mesh.vertexCount, part.vertices);
    assert.equal(mesh.indexCount / 3, part.triangles);
    assert.equal(passesActualGpuBudgetGuard(mesh, part, 0, gpuBytes), true);
    for (const other of choices.filter(other => other.id !== lod.id)) {
      assert.equal(passesActualGpuBudgetGuard(mesh, part, expectedGpuBytes.get(other.id), gpuBytes), true);
    }
    const allocated = mesh.vertexCount * (mesh.positionBytes + 6) + mesh.indexCount * 4;
    parts.push({ path, url: part.url, sha256: part.sha256, decodedSha256: part.decodedSha256,
      compressedBytes: part.bytes, decodedBytes: decoded.byteLength,
      vertices: mesh.vertexCount, triangles: mesh.indexCount / 3, gpuBufferBytes: allocated,
      gzipAndDecodedHashesVerified: true, normalHfmParserPassed: true,
      normalInitialAndTransactionalGpuBudgetGuardsPassed: true });
    gpuBytes += allocated; decodedBytes += decoded.byteLength;
    triangles += mesh.indexCount / 3; vertices += mesh.vertexCount;
  }
  assert.equal(triangles, lod.triangles);
  assert.equal(decodedBytes, lod.decodedBytes);
  assert.equal(gpuBytes, expectedGpuBytes.get(lod.id));
  lodChecks.push({ id: lod.id, parts, vertices, triangles, decodedBytes, gpuBufferBytes: gpuBytes,
    decodedBudgetBytes: 128 * 1024 * 1024, decodedBudgetPassed: true });
  globalThis.gc?.();
}

const codeFiles = ['native-edge-loader.js', 'native-edge-worker.js', 'native-edge-format.js',
  'native-mesh-format.js', 'whole-native.js'];
const sourceHashes = Object.fromEntries(await Promise.all(codeFiles.map(async name => [
  name, hash(await readFile(resolve(here, '../../public', name)))
])));
const retainedAndReplacementGpuBytes = lodChecks.reduce((sum, lod) => sum + lod.gpuBufferBytes, 0);
const report = {
  schema: 'guided-native-actual-index-validation-v21.1',
  verifiedAtUtc: new Date().toISOString(), passed: true, fixtureDataUsed: false,
  publishableGateOverridden: false, sourceFilesChanged: false, networkRequests: 0,
  artifact: { path: resolve(manifestDir, 'manifest.json.gz'), sha256: artifact.sha256,
    compressedBytes: artifact.bytes, decodedSha256: artifact.decodedSha256,
    decodedBytes: artifact.decodedBytes, publishable: true, fixtureOnly: false,
    normalWorkerByteLimit: MAX_MANIFEST_BYTES, normalBoundedGzipReadPassed: true },
  normalValidatorPassed: true, validatorMilliseconds, nativeTileCount: manifest.tiles.length,
  nativeTileKeysAndUrlsNormalized: true, allAggregateSumsExactAgainstBigInt: true, totals,
  coverage: { plannedBlocks: manifest.coverage.plannedBlocks, completedBlocks: manifest.coverage.completedBlocks,
    emptyBlocks: manifest.coverage.emptyBlocks,
    ...Object.fromEntries(contributionKeys.map(key => [key, manifest.coverage[key]])),
    displayedNativeMetric: get('nativeMetric').textContent, displayedNativeNote: get('nativeNote').textContent,
    provenanceIntegerTextExact: true },
  defaultRegion: { requestedNativeXYZ: manifest.defaultRegionXYZ, exactAvailableTile: true,
    blockXYZ: choice.tile.xyz, triangles: choice.tile.triangles, sha256: choice.tile.sha256 },
  overviewChoices: get('overviewQuality').children.map(option => ({ id: option.value, label: option.textContent })),
  defaultOverviewId: controller.overviewRequestedId, lods: lodChecks,
  transactionalSwap: { normalGpuBudgetGuardPassedBothDirections: true,
    retainedAndReplacementGpuBytes, paneBudgetBytes: 128 * 1024 * 1024 },
  normalCodeSha256: sourceHashes,
  localOverviewManifest: { path: localOverviewPath, sha256: hash(await readFile(localOverviewPath)) },
  executionScope: [
    'Actual publishable whole-plan index and actual hash-matched local HFM artifacts.',
    'Production manifest validator, controller LOD normalization and coverage labels, worker bounded decompression, HFM parser, and GPU-budget guard.',
    'GPU guard probes stop at the first allocation boundary. No GPU memory was allocated and no browser, rendering, or FPS claim is made.',
    'Native tile bodies were not downloaded or re-meshed; the default tile resolves to an exact nonempty entry in the verified final index.'
  ],
  elapsedMilliseconds: performance.now() - started,
  processPeakRssBytes: process.resourceUsage().maxRSS * 1024
};
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ reportPath, passed: report.passed, manifestSha256: artifact.sha256,
  tiles: manifest.tiles.length, totals, defaultBlockXYZ: choice.tile.xyz,
  lods: lodChecks.map(({ id, triangles, decodedBytes, gpuBufferBytes }) => ({ id, triangles, decodedBytes, gpuBufferBytes })),
  retainedAndReplacementGpuBytes, elapsedMilliseconds: report.elapsedMilliseconds,
  processPeakRssBytes: report.processPeakRssBytes }));
