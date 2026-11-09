#!/usr/bin/env python3
"""Bounded QA for an already built overview pilot, including the browser parser.

The source native bank is read only. Resume must reuse every mesh checkpoint
and asset byte-for-byte. A deliberately tiny export limit exercises multipart
HFM1 output and verifies that all ordered triangle positions/normals survive.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/guided-native-v21'))
import build_overview as builder


def read_hfm(path):
    raw = gzip.decompress(path.read_bytes())
    h = np.frombuffer(raw, '<u4', 8)
    assert tuple(h[:2]) == (0x314d4648, 1) and h[7] == 1
    points = np.frombuffer(raw, '<f4', int(h[2]) * 3, int(h[4])).reshape(-1, 3).copy()
    normals = np.frombuffer(raw, '<i2', int(h[2]) * 3, int(h[5])).reshape(-1, 3).copy()
    faces = np.frombuffer(raw, '<u4', int(h[3]), int(h[6])).reshape(-1, 3).copy()
    assert np.isfinite(points).all() and faces.max() < len(points)
    length = np.linalg.norm(normals.astype(np.float64) / 32767, axis=1)
    assert np.all((length > .9999) & (length < 1.0001))
    return points, normals, faces, [float(length.min()), float(length.max())]


def snapshot(paths):
    return {str(path): builder.digest(path) for path in paths}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--run', type=Path, required=True)
    p.add_argument('--overview', type=Path, required=True)
    p.add_argument('--report', type=Path, default=Path(__file__).with_name('overview-pilot-verification.json'))
    a = p.parse_args()
    first = json.loads((a.overview / 'manifest.json').read_text())
    settings = json.loads((a.overview / 'build.json').read_text())['settings']
    assert first['pilot'] and first['complete']
    assert first['peakProcessRssBytes'] < 300 * 1024**2
    original_files = list((a.run / 'tiles').glob('*.nbe.gz'))
    original_hashes = snapshot(original_files)
    checkpoints = list((a.overview / 'nodes').glob('*.npz')) + list((a.overview / 'assets').glob('*.hfm.gz'))
    saved_hashes = snapshot(checkpoints)
    command = [sys.executable, str(ROOT / 'scripts/guided-native-v21/build_overview.py'),
        '--run', str(a.run), '--out', str(a.overview), '--pilot',
        '--triangles', str(settings['triangles']), '--detail-triangles', str(settings['detailTriangles']),
        '--samples-per-leaf', str(settings['samplesPerLeaf']), '--reverse-samples', str(settings['reverseSamples']),
        '--group-blocks', str(settings['groupBlocks']), '--leaf-face-cap', str(settings['leafFaceCap']),
        '--merge-face-cap', str(settings['mergeFaceCap']), '--intermediate-factor', str(settings['intermediateFactor']),
        '--seed', str(settings['seed']), '--asset-mib', str(settings['assetBytes'] / 1024**2)]
    started = time.monotonic()
    resume = subprocess.run(command, capture_output=True, text=True, check=True)
    resume_seconds = time.monotonic() - started
    events = [json.loads(line) for line in resume.stdout.splitlines() if line.startswith('{')]
    assert not any(e['stage'] in ('overview-node', 'overview-lod') for e in events)
    assert snapshot(checkpoints) == saved_hashes

    parser_script = """
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {parseNativeMesh} from PARSER;
const paths = PATHS;
const result = paths.map(path => {
  const bytes = gunzipSync(readFileSync(path));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const mesh = parseNativeMesh(buffer, bytes.byteLength);
  return {name: path.split('/').pop(), vertices: mesh.vertexCount,
    triangles: mesh.indexCount / 3, positionFormat: mesh.positionFormat};
});
process.stdout.write(JSON.stringify(result));
""".replace('PARSER', json.dumps((ROOT / 'public/native-mesh-format.js').as_uri())).replace(
        'PATHS', json.dumps([str(a.overview / part['path']) for lod in first['lods'] for part in lod['parts']]))
    browser_parser = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', parser_script], text=True))
    source_part = a.overview / first['lods'][0]['parts'][0]['path']
    world, qnormal, faces, normal_range = read_hfm(source_part)
    points = builder.from_world(world)
    normals = (qnormal.astype(np.float64) / 32767)[:, [0, 2, 1]] * np.array([1, -1, 1])
    limit = 100_000
    split_dir = a.overview / 'split-limit-proof'
    split = builder.write_assets(split_dir, 'split-proof', points, faces, normals, limit)
    assert len(split) > 1 and all(part['compressedBytes'] < limit for part in split)
    triangle_positions, triangle_normals = [], []
    for part in split:
        pworld, pnormal, pfaces, _ = read_hfm(split_dir / part['path'])
        triangle_positions.append(pworld[pfaces])
        triangle_normals.append(pnormal[pfaces])
    assert np.array_equal(np.concatenate(triangle_positions).view(np.uint32), world[faces].view(np.uint32))
    assert np.array_equal(np.concatenate(triangle_normals), qnormal[faces])
    assert sum(part['triangles'] for part in split) == len(faces)
    assert snapshot(original_files) == original_hashes
    nodes = [json.loads(path.read_text()) for path in sorted((a.overview / 'nodes').glob('*.json'))]
    assert all(node['simplification']['frozenBoundaryExact'] for node in nodes)
    report = dict(schema='guided-native-overview-pilot-verification-v21.1', allChecksPassed=True,
        buildManifest=first,
        exactBoundaryChecks=dict(nodes=len(nodes), allFrozenBoundaryVerticesAndEdgesExact=True,
            weldedDuplicateVertices=sum(n['weldedDuplicateVertices'] for n in nodes)),
        resume=dict(seconds=resume_seconds, reusedCheckpoints=len(checkpoints),
            checkpointAndAssetHashesUnchanged=True, nodesOrLodsRecomputed=0),
        browserParser=dict(module='public/native-mesh-format.js', parsed=browser_parser),
        normalLengthRange=normal_range,
        multipart=dict(forcedMaximumCompressedBytes=limit, parts=len(split),
            largestCompressedPartBytes=max(p['compressedBytes'] for p in split),
            triangles=sum(p['triangles'] for p in split),
            orderedTrianglePositionsBitExact=True, orderedTriangleNormalsBitExact=True),
        nativeBankFilesUnchanged=len(original_files),
        builderSha256=builder.digest(ROOT / 'scripts/guided-native-v21/build_overview.py'),
        verificationScope='Eight-tile pilot only; full whole-organ merges were not run while native acquisition was resident.')
    builder.atomic_json(a.report, report)
    print(json.dumps(dict(allChecksPassed=True, firstRunPeakRssBytes=first['peakProcessRssBytes'],
        resumeSeconds=resume_seconds, multipartParts=len(split), report=str(a.report))))


if __name__ == '__main__':
    main()
