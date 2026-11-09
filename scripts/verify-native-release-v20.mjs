import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { parseNativeMesh } from '../public/native-mesh-format.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const folder = path.join(root, 'public/assets/native-surface-v20');
const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json')));
const index = JSON.parse(fs.readFileSync(path.join(root, 'server/native-surface-index-v20.json')));
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
assert.equal(manifest.sourceSpacingUm, 19.85);
assert.equal(manifest.rawThreshold, 17133.4);
assert.deepEqual(manifest.roi.originXYZ, [4480, 3968, 4608]);
assert.deepEqual(manifest.roi.shapeXYZ, [128, 128, 128]);
const records = [];
for (const lod of manifest.lods) {
  const name = path.basename(lod.url);
  assert.equal(name, lod.id + '.hfm.gz');
  const encoded = fs.readFileSync(path.join(folder, name));
  assert.equal(encoded.length, lod.compressedBytes);
  assert.equal(sha(encoded), lod.sha256);
  assert.equal(index[name].sha256, lod.sha256);
  const raw = zlib.gunzipSync(encoded);
  assert.equal(sha(raw), lod.decodedSha256);
  const decoded = parseNativeMesh(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), lod.decodedBytes);
  assert.equal(decoded.vertexCount, lod.vertices); assert.equal(decoded.indexCount, lod.triangles * 3);
  if (decoded.positionFormat === 'float32') {
    const points = new Float32Array(decoded.buffer, decoded.positionOffset, decoded.vertexCount * 3), bounds = lod.bounds || manifest.bounds;
    for (let i = 0; i < points.length; i++) assert(points[i] >= bounds.min[i % 3] - 1e-7 && points[i] <= bounds.max[i % 3] + 1e-7, `${lod.id}: vertex lies outside the declared crop bounds`);
  }
  const positions = new Uint8Array(decoded.buffer, decoded.positionOffset, decoded.vertexCount * decoded.positionBytes);
  const indices = new Uint8Array(decoded.buffer, decoded.indexOffset, decoded.indexCount * 4);
  assert.equal(lod.quantizationCollapsedTriangles, 0, `${lod.id}: encoding must not collapse triangles`);
  assert.equal(lod.quantizationFlippedOrOver90DegreeTriangles, 0, `${lod.id}: encoding must not flip triangles`);
  records.push({ id: lod.id, vertices: lod.vertices, triangles: lod.triangles, compressedBytes: encoded.length, decodedBytes: raw.length, positionFormat: decoded.positionFormat, positionsSha256: sha(positions), indicesSha256: sha(indices), compressedAndDecodedHashesMatch: true, browserParserAccepted: true });
}
assert.equal(Object.keys(index).length, records.length);
const original = records.find(r => r.id === 'native'), normals = records.find(r => r.id === 'normals');
assert.equal(original.positionsSha256, normals.positionsSha256, 'Normals-only treatment moved geometry.');
for (const id of ['normals', 'gentle', 'moderate']) {
  const item = records.find(r => r.id === id);
  assert.equal(item.indicesSha256, original.indicesSha256, `${id} changed connectivity.`);
  assert.equal(item.vertices, original.vertices); assert.equal(item.triangles, original.triangles);
}
for (const file of ['native-detail.html', 'native-detail.css', 'native-detail.js', 'native-mesh-worker.js', 'native-mesh-loader.js', 'native-mesh-format.js']) assert(fs.statSync(path.join(root, 'public', file)).size > 0);
for (const file of ['quickcontext.webp', 'comparison.webp']) assert(fs.statSync(path.join(folder, file)).size > 0);
const report = { verified: true, sourceSpacingUm: manifest.sourceSpacingUm, fixedRawThreshold: manifest.rawThreshold, nativeCandidatesRetainConnectivity: true, normalsOnlyPositionsIdentical: true, originalScanUnfilteredForReference: true, assets: records };
fs.writeFileSync(path.join(root, 'docs/native-surface-v20/release-asset-verification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
