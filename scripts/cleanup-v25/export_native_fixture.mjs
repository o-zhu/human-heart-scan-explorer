/** One checksum-pinned production tile, using the exact browser decoder. */
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {parseNativeEdges, meshNativeEdges} from '../../public/native-edge-format.js';
import {classifyNativeTissue} from '../../public/native-noise-filter.js';
import {registerNativePiece, nativeTileMainBounds} from '../../public/native-main-detail.js';

const output = resolve(process.argv[2]); await mkdir(output, {recursive: true});
const source = JSON.parse(await readFile(new URL('../../docs/noise-cleanup-v22/native-components.json', import.meta.url)));
const record = source.records.find(item => item.tile === '35_30_36');
const encoded = await readFile(record.path), sha = value => createHash('sha256').update(value).digest('hex');
assert.equal(sha(encoded), record.sha256);
const bytes = gunzipSync(encoded), parsed = parseNativeEdges(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const cleanup = classifyNativeTissue(parsed), pieces = [];
let index = 0, triangles = 0, sourceTriangles = 0;
for (const z of [0, 64]) for (const y of [0, 64]) for (const x of [0, 64]) {
  const mesh = registerNativePiece(meshNativeEdges(parsed, {start: [x, y, z], size: 64, local: false, cleanup, cleanupView: 'cleaned'}));
  const file = `piece-${index++}.hfm`; await writeFile(join(output, file), new Uint8Array(mesh.buffer));
  const {buffer, ...metadata} = mesh;
  pieces.push({file, sha256: sha(new Uint8Array(buffer)), bytes: buffer.byteLength, ...metadata});
  triangles += mesh.indexCount / 3; sourceTriangles += mesh.sourceTriangles;
}
assert.equal(sourceTriangles, record.nativeTriangles);
const xyz = record.tile.split('_').map(Number);
const report = {source: {tile: record.tile, path: record.path, sha256: record.sha256, encodedBytes: encoded.byteLength, decodedSha256: sha(bytes)}, bounds: nativeTileMainBounds(xyz), pieces, triangles, sourceTriangles, cleanup: cleanup.stats};
await writeFile(join(output, 'native-fixture.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({tile: record.tile, triangles, sourceTriangles, pieceBytes: pieces.reduce((n, p) => n + p.bytes, 0)}));
