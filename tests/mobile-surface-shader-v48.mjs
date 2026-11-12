/** Safari-safe component interpolation, verified against every preserved face.
 * This reads the original HFM as a stream: it never retains a whole Ultra mesh.
 * Set HEART_SHADER_EVIDENCE to write the independently measured asset result.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createGunzip, gunzipSync } from 'node:zlib';
import { Readable } from 'node:stream';
import { fineSurfaceShaderSources } from '../public/fine-surface.js';

const root = new URL('../', import.meta.url);
const asset = path => new URL('public/' + path.replace(/^\.\//, ''), root);
const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('component visibility avoids flat-varying emulation on browsers without an extension', () => {
  assert.match(fineSurfaceShaderSources.vertex, /\bout float removedDebris;/);
  assert.match(fineSurfaceShaderSources.fragment, /\bin float removedDebris;/);
  assert.doesNotMatch(fineSurfaceShaderSources.vertex, /\bflat\s+out\s+float\s+removedDebris/);
  assert.doesNotMatch(fineSurfaceShaderSources.fragment, /\bflat\s+in\s+float\s+removedDebris/);
  // For identical triangle attributes, perspective correction and clipping
  // retain the component decision. Include tiny edge weights and near/far w.
  for (const flag of [0, 1]) for (const bary of [[1,0,0],[0,1,0],[0,0,1],[.1,.2,.7],[1e-8,.5,.5-1e-8]]) {
    for (const w of [[1,1,1],[.01,10,.25],[10,.01,10]]) {
      const numerator = bary.reduce((v, b, i) => v + b * flag / w[i], 0);
      const denominator = bary.reduce((v, b, i) => v + b / w[i], 0);
      assert.equal(numerator / denominator > .5, flag === 1);
    }
  }
});

test('all 23,618,685 preserved Ultra faces have one exact component decision', async () => {
  const manifest = await json('public/assets/fine-surface-v23/manifest.json');
  const lod = manifest.lods.find(item => item.id === 'gentle');
  const cleanup = await json('public/assets/cleanup-v26/debris-manifest.json');
  const profile = cleanup.profiles.find(item => item.lodId === 'gentle');
  const pinnedSource = '175548ddaad01c409d59d561df6018c5cb0c90752b2ec771899c255065398dae';
  assert.equal(lod.decodedSha256, pinnedSource);
  assert.equal(profile.sourceDecodedSha256, pinnedSource);
  const decoded = {};
  for (const key of ['vertexFlags', 'faceKeepMask']) {
    const item = profile[key], packed = await readFile(asset(item.url));
    assert.equal(packed.length, item.compressedBytes);
    assert.equal(sha(packed), item.sha256);
    const bytes = gunzipSync(packed);
    assert.equal(bytes.length, item.decodedBytes);
    assert.equal(sha(bytes), item.decodedSha256);
    decoded[key] = bytes;
  }
  const flags = decoded.vertexFlags, keep = decoded.faceKeepMask;
  for (const flag of flags) assert.ok(flag === 0 || flag === 255);
  const packedHash = createHash('sha256'), rawHash = createHash('sha256');
  let packedBytes = 0, rawBytes = 0, triangle = 0, removed = 0, indexOffset;
  let largestDecodedChunk = 0, carry = Buffer.alloc(0), header = Buffer.alloc(0);
  async function* parts() {
    for (const part of lod.parts) {
      let size = 0;
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(asset(part.url), { highWaterMark: 256 * 1024 })) {
        size += chunk.length; packedBytes += chunk.length;
        hash.update(chunk); packedHash.update(chunk); yield chunk;
      }
      assert.equal(size, part.compressedBytes);
      assert.equal(hash.digest('hex'), part.sha256);
    }
  }
  const stream = Readable.from(parts()).pipe(createGunzip({ chunkSize: 256 * 1024 }));
  for await (const chunk of stream) {
    const chunkStart = rawBytes;
    rawBytes += chunk.length; rawHash.update(chunk);
    largestDecodedChunk = Math.max(largestDecodedChunk, chunk.length);
    if (header.length < 32) {
      header = Buffer.concat([header, chunk.subarray(0, 32 - header.length)]);
      if (header.length < 32) continue;
      assert.equal(header.readUInt32LE(0), 0x314d4648);
      assert.equal(header.readUInt32LE(4), 1);
      assert.equal(header.readUInt32LE(8), flags.length);
      assert.equal(header.readUInt32LE(12), lod.triangles * 3);
      indexOffset = header.readUInt32LE(24);
      assert.equal(indexOffset + lod.triangles * 12, lod.decodedBytes);
    }
    if (rawBytes <= indexOffset) continue;
    let indices = chunk.subarray(Math.max(0, indexOffset - chunkStart));
    if (carry.length) indices = Buffer.concat([carry, indices]);
    const whole = indices.length - indices.length % 12;
    for (let at = 0; at < whole; at += 12) {
      const a = indices.readUInt32LE(at), b = indices.readUInt32LE(at + 4), c = indices.readUInt32LE(at + 8);
      assert.ok(a < flags.length && b < flags.length && c < flags.length);
      assert.equal(flags[a], flags[b]); assert.equal(flags[a], flags[c]);
      const exclude = flags[a] === 255;
      assert.equal((keep[triangle >>> 3] >>> (triangle & 7) & 1) === 0, exclude);
      removed += Number(exclude); triangle++;
    }
    // Copy only the incomplete face so a tiny remainder cannot retain a chunk.
    carry = Buffer.from(indices.subarray(whole));
  }
  assert.equal(carry.length, 0);
  assert.equal(rawBytes, lod.decodedBytes);
  assert.equal(rawHash.digest('hex'), pinnedSource);
  assert.equal(packedBytes, lod.compressedBytes);
  assert.equal(packedHash.digest('hex'), lod.sha256);
  assert.equal(triangle, lod.triangles);
  assert.equal(removed, profile.removedTriangles);
  const evidence = {
    schema: 'heart-surface-component-interpolation-v48',
    sourceDecodedSha256: pinnedSource,
    sourceDecodedBytes: rawBytes,
    vertexFlagsSha256: profile.vertexFlags.decodedSha256,
    faceKeepMaskSha256: profile.faceKeepMask.decodedSha256,
    trianglesChecked: triangle,
    removedTriangles: removed,
    retainedTriangles: triangle - removed,
    mixedDecisionTriangles: 0,
    mismatchedFaceKeepDecisions: 0,
    largestDecodedStreamChunkBytes: largestDecodedChunk,
    fullDecodedMeshRetained: false,
    conclusion: 'Ordinary and flat interpolation have identical binary visibility decisions on every validated triangle.',
    limitation: 'Asset and shader regression proof; not a physical iPad or Safari GPU test.'
  };
  if (process.env.HEART_SHADER_EVIDENCE) await writeFile(process.env.HEART_SHADER_EVIDENCE, JSON.stringify(evidence, null, 2) + '\n');
});
