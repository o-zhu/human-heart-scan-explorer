#!/usr/bin/env python3
"""Bounded, reproducible checks of the native surface checkpoint architecture.

This verifies shared-face topology in the actual classic marching-cubes table,
then compares the encoded boundary masks and edge positions of adjacent pilot
tiles. It does not claim anatomical accuracy or complete whole-organ coverage.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
import hashlib
from itertools import combinations
import json
from pathlib import Path
import sys

import numpy as np
import scipy
import skimage

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/guided-native-v21'))

from edge_codec import (CORNERS, EDGE_AXIS, EDGE_START, TABLE,
                        decode_native_edges, edge_slices)
from refine import guide_for_core, missing_source_blocks


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def check_classic_faces():
    corners = np.asarray(CORNERS)
    starts = EDGE_START
    ends = starts.copy()
    ends[np.arange(12), EDGE_AXIS] += 1
    failures = []
    maximum_variants = 0
    for axis in range(3):
        tangent = [a for a in range(3) if a != axis]
        signatures = {}
        for side in (0, 1):
            face_corners = sorted(np.where(corners[:, axis] == side)[0],
                                  key=lambda k: tuple(corners[k, tangent]))
            face_edges = np.where((starts[:, axis] == side) &
                                  (ends[:, axis] == side))[0]
            labels = {int(e): tuple(sorted((tuple(starts[e, tangent]),
                                           tuple(ends[e, tangent]))))
                      for e in face_edges}
            groups = defaultdict(set)
            for case in range(256):
                pattern = tuple((case >> int(k)) & 1 for k in face_corners)
                entries = TABLE[case]
                triangles = entries[entries >= 0].reshape(-1, 3)
                segments = []
                for triangle in triangles:
                    for e, f in combinations(map(int, triangle), 2):
                        if e in labels and f in labels:
                            segments.append(tuple(sorted((labels[e], labels[f]))))
                groups[pattern].add(tuple(sorted(segments)))
            signatures[side] = groups
        for pattern in signatures[0]:
            lower, upper = signatures[0][pattern], signatures[1][pattern]
            maximum_variants = max(maximum_variants, len(lower), len(upper))
            if len(lower) != 1 or len(upper) != 1 or lower != upper:
                failures.append(dict(axisXYZ=axis, signs=list(pattern),
                                     lowerVariants=len(lower), upperVariants=len(upper)))
    assert not failures, failures
    return dict(passed=True, cubeCases=256, orientedFaces=6,
                orientedCubeFaceConfigurations=1536,
                oppositeFaceSignPatterns=48, compatibleNeighborCasePairs=12288,
                maximumContourVariantsForSharedSigns=maximum_variants,
                lookupTableSha256=hashlib.sha256(TABLE.tobytes()).hexdigest(),
                conclusion='Shared-face contour connectivity agrees for every compatible pair of classic cases.',
                limitation='This does not establish equivalence to the trilinear isosurface or anatomical topology.')


def face(data, normal_axis, side):
    inside, fractions, _, _ = data
    selection = [slice(None)] * 3
    selection[2-normal_axis] = 0 if side == 0 else -1
    result = [inside[tuple(selection)]]
    for axis in range(3):
        if axis == normal_axis:
            continue
        a, b = edge_slices(axis)
        crossing = inside[a] != inside[b]
        quantized = np.full(crossing.shape, -1, np.int8)
        quantized[crossing] = np.rint(fractions[axis]*32-.5).astype(np.int8)
        result.append(quantized[tuple(selection)])
    return result


def check_encoded_faces(pilot, records):
    roles = {}
    for role in ('native', 'overview'):
        decoded = {}
        for coordinates, record in records.items():
            artifact = next((a for a in record['artifacts'] if a['role'] == role), None)
            if artifact is not None:
                path = pilot / artifact['path']
                assert sha256(path) == artifact['sha256']
                decoded[coordinates] = decode_native_edges(path.read_bytes())
        pairs = 0
        shared_crossings = 0
        axis_pairs = [0, 0, 0]
        for coordinates, data in decoded.items():
            for axis in range(3):
                neighbor = list(coordinates)
                neighbor[axis] += 1
                neighbor = tuple(neighbor)
                if neighbor not in decoded:
                    continue
                first = face(data, axis, 1)
                second = face(decoded[neighbor], axis, 0)
                assert all(np.array_equal(a, b) for a, b in zip(first, second)), (role, coordinates, neighbor)
                pairs += 1
                axis_pairs[axis] += 1
                shared_crossings += sum(int(np.count_nonzero(a >= 0)) for a in first[1:])
        roles[role] = dict(passed=True, adjacentTilePairs=pairs, axisPairsXYZ=axis_pairs,
                           identicalSharedCrossings=shared_crossings,
                           matchingCornerMasks=True, matchingQuantizedEdgePositions=True)
    return roles


def check_guidance(pilot, records, config):
    totals = np.zeros(3, np.int64)
    per_tile = []
    guide_planes = []
    base = np.array(sorted(records)[0], np.int64)
    prior, weight = guide_for_core(base*128, config)
    for axis in range(3):
        neighbor = base.copy()
        neighbor[axis] += 1
        other_prior, other_weight = guide_for_core(neighbor*128, config)
        first = [slice(None)]*3
        second = first.copy()
        first[2-axis] = -1
        second[2-axis] = 0
        a, b = prior[tuple(first)], other_prior[tuple(second)]
        c, d = weight[tuple(first)], other_weight[tuple(second)]
        assert np.array_equal(a, b) and np.array_equal(c, d)
        guide_planes.append(dict(axisXYZ=axis, priorBitIdentical=True, weightBitIdentical=True))
    for coordinates, record in records.items():
        _, weights = guide_for_core(np.array(coordinates)*128, config)
        artifact = next((a for a in record['artifacts'] if a['role'] == 'native'), None)
        counts = np.zeros(3, np.int64)
        if artifact is not None:
            inside, _, _, step = decode_native_edges((pilot/artifact['path']).read_bytes())
            assert step == 1
            for axis in range(3):
                a, b = edge_slices(axis)
                crossing = inside[a] != inside[b]
                first, second = weights[a][crossing], weights[b][crossing]
                full = (first == 1) & (second == 1)
                prior_only = (first == 0) & (second == 0)
                counts += np.array([full.sum(), (~full & ~prior_only).sum(), prior_only.sum()])
        totals += counts
        per_tile.append(dict(coordinatesXYZ=list(coordinates), fullNativeCrossings=int(counts[0]),
                             blendedCrossings=int(counts[1]), priorOnlyCrossings=int(counts[2])))
    return dict(sharedPlanes=guide_planes, perTile=per_tile,
                fullNativeCrossings=int(totals[0]), blendedCrossings=int(totals[1]),
                priorOnlyCrossings=int(totals[2]),
                blendedFraction=float(totals[1]/max(1, totals.sum())),
                limitation='Crossings on tile boundaries are counted in each owning checkpoint. Counts are not surface areas.')


def check_missing_context():
    halo = 16
    coordinates = np.array([35, 30, 36])
    valid = np.zeros((129+2*halo,)*3, bool)
    weights = np.zeros((129,)*3, np.float32)
    tests = []
    for name, point, offsets in (
            ('zero native weight', None, []),
            ('interior dependency', (64,64,64), [(0,0,0)]),
            ('lower corner dependency', (0,0,0),
             [(x,y,z) for z in (-1,0) for y in (-1,0) for x in (-1,0)]),
            ('upper corner dependency', (128,128,128),
             [(x,y,z) for z in (0,1) for y in (0,1) for x in (0,1)])):
        weights.fill(0)
        if point is not None:
            weights[point] = 1
        actual = sorted(tuple(c) for c in missing_source_blocks(valid, weights, coordinates*128, halo))
        expected = sorted(tuple(coordinates+np.array(d)) for d in offsets)
        assert actual == expected, (name, actual, expected)
        tests.append(dict(case=name, requestedSourceBlocks=len(actual), passed=True))
    return dict(passed=True, cases=tests,
                conclusion='Nonzero native weight requests all source blocks in the finite dependency cube; zero native weight does not claim native support.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pilot', type=Path,
                        default=Path('{source-cache}/guided-native-v21/pilot/run'))
    parser.add_argument('--output', type=Path,
                        default=Path(__file__).with_name('architecture-review.json'))
    args = parser.parse_args()
    manifest = json.loads((args.pilot/'run.json').read_text())
    records = {}
    for path in sorted((args.pilot/'records').glob('*.json')):
        record = json.loads(path.read_text())
        records[tuple(record['coordinatesXYZ'])] = record
    assert records, 'Pilot has no completed tile records'
    result = dict(schema='guided-native-architecture-review-v21.1',
                  pilotRun=str(args.pilot), pilotFingerprint=manifest['fingerprint'],
                  pilotTiles=len(records), wholeOrganCompletionChecked=False,
                  runtimeVersions=dict(numpy=np.__version__, scipy=scipy.__version__, skimage=skimage.__version__),
                  reviewedFiles={p.name: sha256(p) for p in (ROOT/'scripts/guided-native-v21').glob('*.py')},
                  classicFaceCheck=check_classic_faces(),
                  encodedSharedFaces=check_encoded_faces(args.pilot, records),
                  guidance=check_guidance(args.pilot, records, manifest['config']),
                  missingContext=check_missing_context(),
                  pilotMeasurements=dict(
                    totalOutputBytes=sum(sum(a['bytes'] for a in r['artifacts']) for r in records.values()),
                    totalNativeTriangles=sum(r['nativeTriangles'] for r in records.values()),
                    totalKernelSeconds=sum(r['seconds'] for r in records.values()),
                    maximumWorkerPeakRssMiB=max(r['peakWorkerRssMiB'] for r in records.values()),
                    limitation='These adjacent pilot tiles are dense and are not a stratified estimate of whole-organ output size or run time.'),
                  finiteTVSupport=dict(iterations=16, stoppingEpsilon=0, conservativeHalo=16,
                    reasoning='The installed Chambolle update uses local forward gradients and backward divergence. Each iteration expands coordinate reach by at most one voxel. With fixed 16 iterations, the returned field has reach at most 15 voxels; halo16 is conservative. A positive stopping epsilon would introduce a tile-wide stopping decision.',
                    empiricalEvidence='{source-cache}/guided-native-v21/alignment/tv-finite-halo.json'),
                  reviewedRisks=[
                    dict(topic='Worker memory', status='fixed', detail='Runner now uses spawn so workers do not inherit and retain the resident native layer.'),
                    dict(topic='Following strips', status='fixed', detail='Runner now copies halo+1 planes instead of keeping a view backed by all 32 decoded planes.'),
                    dict(topic='Resume identity', status='fixed', detail='Fingerprint includes processing modules and the prior manifest, in addition to plans and configuration.'),
                    dict(topic='Disk reserve', status='capacity planning required', detail='The eager next-layer compressed cache can approach 3.1 GiB at 971 blocks, in addition to growing output and reserve.'),
                    dict(topic='Coverage accounting', status='separate metrics required', detail='Completed planned tiles are distinct from full native, blended, and prior-only surface crossings; a coarse guide cannot certify structures it never represented.'),
                    dict(topic='Mixed display LOD', status='renderer responsibility', detail='The same-step face checks do not prove watertight joins between native-step and overview-step neighbors; such joins need an explicit transition or coordinated refinement.'),
                    dict(topic='Scientific interpretation', status='documented limitation', detail='The 0.31015625 micrometre native edge-encoding bound is relative to the processed surface. It is not a denoising, registration, segmentation, or anatomical-accuracy bound.')])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(dict(output=str(args.output), classicFaces=result['classicFaceCheck']['passed'],
                          encodedFaces=result['encodedSharedFaces'],
                          fullNativeCrossings=result['guidance']['fullNativeCrossings'],
                          blendedCrossings=result['guidance']['blendedCrossings'],
                          priorOnlyCrossings=result['guidance']['priorOnlyCrossings']), indent=2))


if __name__ == '__main__':
    main()
