#!/usr/bin/env python3
"""Build reversible, source-pinned face masks for the two published v21 HFM LODs.

This changes no source HFM, point, normal, native tile, or upload gate. Opposite
orientations of exactly the same vertex triple cancel in pairs. If a group has
one orientation left, retain its earliest original face and deduplicate that
orientation. Unique faces are untouched. Mask bits refer to original triangle
indices, so applying a mask in increasing index order preserves face order.

This is display-geometry cleanup, not tissue/artifact classification: coincident
sheets can represent thin features collapsed by the existing display reduction.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import gc
import gzip
import hashlib
import json
import os
from pathlib import Path
import resource
import struct
import time

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

ROOT = Path(__file__).resolve().parents[2]
MM_PER_WORLD_UNIT = 8479 * 19.85 / 1000
SOURCES = {
    'overview': {
        'sha256': 'f4d04fcc0eca1beda15f78794debb84c370b937cb64230a6b33ca583f3a2664e',
        'decodedSha256': 'a79ed6db80689d4c5a5b91c6feda8ba44195046d13ecbf72cb4eaedd74e19122',
        'vertices': 369031, 'triangles': 1499999,
        'url': 'https://human-heart-scan-explorer.zhuou557737.chatgpt.site/api/guided-native-v21/overview/whole-overview-0-f4d04fcc0eca1beda15f78794debb84c370b937cb64230a6b33ca583f3a2664e.hfm.gz',
    },
    'detail': {
        'sha256': 'b690678f8a19fa24e5237e499275e8ac8aa94f1002365d441d6468e0f12cd2ef',
        'decodedSha256': '2ecd1073efa32094823df8fbcd0c7aa1899891f3ffea1d5ede80b113c52cef6c',
        'vertices': 699001, 'triangles': 2500000,
        'url': 'https://human-heart-scan-explorer.zhuou557737.chatgpt.site/api/guided-native-v21/overview/whole-detail-0-b690678f8a19fa24e5237e499275e8ac8aa94f1002365d441d6468e0f12cd2ef.hfm.gz',
    },
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def encoded_json(value):
    return (json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + '\n').encode()


def atomic_bytes(path, data, immutable=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and immutable:
        if path.read_bytes() != data:
            raise ValueError(f'Existing immutable output differs: {path}')
        return
    temporary = path.with_name(path.name + f'.{os.getpid()}.partial')
    with temporary.open('xb') as out:
        out.write(data)
        out.flush()
        os.fsync(out.fileno())
    os.replace(temporary, path)


def cancellation_mask(faces, vertex_count):
    bits = max(1, int(vertex_count - 1).bit_length())
    if 3 * bits > 63 or faces.ndim != 2 or faces.shape[1] != 3:
        raise ValueError('Unsupported bounded triangle index shape/range.')
    canonical = np.sort(faces, axis=1)
    keys = ((canonical[:, 0].astype(np.uint64) << (2 * bits)) |
            (canonical[:, 1].astype(np.uint64) << bits) |
            canonical[:, 2].astype(np.uint64))
    del canonical
    order = np.argsort(keys, kind='stable')
    sorted_keys = keys[order]
    starts = np.r_[0, np.flatnonzero(sorted_keys[1:] != sorted_keys[:-1]) + 1]
    counts = np.diff(np.r_[starts, len(faces)])
    parity = (((faces[:, 0] > faces[:, 1]).astype(np.uint8) +
               (faces[:, 0] > faces[:, 2]).astype(np.uint8) +
               (faces[:, 1] > faces[:, 2]).astype(np.uint8)) & 1)
    odd = np.add.reduceat(parity[order].astype(np.int32), starts)
    even = counts - odd
    balance = even - odd
    # Stable grouping preserves original indices within each canonical triple.
    group_id = np.repeat(np.arange(len(starts)), counts)
    wanted_odd = balance < 0
    candidate = parity[order] == wanted_odd[group_id]
    first = np.minimum.reduceat(np.where(candidate, order, len(faces)), starts)
    keep = np.zeros(len(faces), np.bool_)
    keep[first[balance != 0]] = True
    unique = counts == 1
    if not np.all(keep[order[starts[unique]]]):
        raise AssertionError('A unique face was changed.')
    kept_per_group = np.add.reduceat(keep[order].astype(np.int32), starts)
    if not np.array_equal(kept_per_group, (balance != 0).astype(np.int32)):
        raise AssertionError('Cancellation group accounting failed.')
    opposite_removed = int((2 * np.minimum(even, odd)).sum())
    same_removed = int(np.maximum(np.abs(balance) - 1, 0).sum())
    if opposite_removed + same_removed != int((~keep).sum()):
        raise AssertionError('Removed triangle accounting failed.')
    mixed = (odd > 0) & (even > 0)
    report = {
        'canonicalFaceGroups': len(starts),
        'originalUniqueFaceGroups': int(unique.sum()),
        'originalExcessDuplicateFaces': int((counts - 1).sum()),
        'mixedOrientationGroups': int(mixed.sum()),
        'sameOrientationOnlyDuplicateGroups': int(((counts > 1) & ~mixed).sum()),
        'fullyCanceledGroups': int((balance == 0).sum()),
        'removedOppositePairTriangles': opposite_removed,
        'removedSameOrientationDuplicateTriangles': same_removed,
        'uniqueFacesRetainedExactly': True,
        'representativePolicy': 'Earliest original face in the remaining majority orientation.',
    }
    return keep, report


def topology(points, faces):
    """Bounded edge/face connectivity audit; no repair or self-intersection test."""
    nf = len(faces)
    if not nf:
        return {'triangles': 0, 'faceConnectedComponents': 0}
    bits = int(len(points) - 1).bit_length()
    a = faces.reshape(-1)
    b = faces[:, [1, 2, 0]].reshape(-1)
    low = np.minimum(a, b).astype(np.uint64)
    high = np.maximum(a, b).astype(np.uint64)
    keys = (((low << bits) | high) << 1) | (a > b).astype(np.uint64)
    del a, b, low, high
    order = np.argsort(keys)
    sorted_keys = keys[order]
    del keys
    pairs = sorted_keys >> 1
    starts = np.r_[0, np.flatnonzero(pairs[1:] != pairs[:-1]) + 1]
    counts = np.diff(np.r_[starts, len(pairs)])
    direction = np.add.reduceat((sorted_keys & 1).astype(np.int32), starts)
    del sorted_keys
    same = pairs[1:] == pairs[:-1]
    del pairs
    rows = (order[:-1][same] // 3).astype(np.int32)
    cols = (order[1:][same] // 3).astype(np.int32)
    del same
    graph = coo_matrix((np.ones(len(rows), np.bool_), (rows, cols)), shape=(nf, nf)).tocsr()
    del rows, cols
    nc, labels = connected_components(graph, directed=False)
    del graph
    edge_component = labels[(order[starts] // 3).astype(np.int32)]
    del order, starts
    sizes = np.bincount(labels, minlength=nc)
    boundary = np.bincount(edge_component[counts == 1], minlength=nc)
    nonmanifold = np.bincount(edge_component[counts > 2], minlength=nc)
    bad_winding = np.bincount(edge_component[(counts == 2) & (direction != 1)], minlength=nc)
    summary = {
        'triangles': nf, 'faceConnectedComponents': int(nc),
        'largestFaceConnectedComponentTriangles': int(sizes.max()),
        'largestFaceConnectedTriangleFraction': float(sizes.max() / nf),
        'uniqueEdges': len(counts), 'boundaryEdges': int((counts == 1).sum()),
        'nonmanifoldEdgesAboveTwoFaces': int((counts > 2).sum()),
        'sameDirectionTwoFaceEdges': int(((counts == 2) & (direction != 1)).sum()),
        'maximumIncidentFaces': int(counts.max()),
        'edgeIncidenceHistogram': {str(int(k)): int(v) for k, v in zip(*np.unique(counts, return_counts=True))},
        'componentsWithBoundaryEdges': int((boundary > 0).sum()),
        'componentsWithNonmanifoldEdges': int((nonmanifold > 0).sum()),
    }
    del counts, direction, edge_component
    volumes = np.zeros(nc, np.float64)
    zero = np.zeros(nc, np.int64)
    near_zero = 0
    for j in range(0, nf, 150000):
        f = faces[j:j + 150000]
        p = points[f].astype(np.float64)
        cross = np.cross(p[:, 1] - p[:, 0], p[:, 2] - p[:, 0])
        square = np.einsum('ij,ij->i', cross, cross)
        vol = np.einsum('ij,ij->i', p[:, 0], np.cross(p[:, 1], p[:, 2])) / 6
        lab = labels[j:j + len(f)]
        volumes += np.bincount(lab, weights=vol, minlength=nc)
        zero += np.bincount(lab, weights=square == 0, minlength=nc).astype(np.int64)
        near_zero += int((square <= 4e-32).sum())
    regular = (boundary == 0) & (nonmanifold == 0) & (bad_winding == 0) & (zero == 0)
    summary['exactZeroAreaFaces'] = int(zero.sum())
    summary['nearZeroAreaFacesAtWorldAreaLe1e_16'] = near_zero
    summary['edgeClosedConsistentNondegenerateComponents'] = int(regular.sum())
    for name, sign in [('Positive', volumes > 1e-15), ('Negative', volumes < -1e-15), ('NearZero', np.abs(volumes) <= 1e-15)]:
        selected = regular & sign
        summary['regular' + name + 'VolumeComponents'] = int(selected.sum())
        summary['regular' + name + 'VolumeTriangles'] = int(sizes[selected].sum())
    # Vertex-touch connectivity differs from connectivity across a complete edge.
    rows = np.concatenate((faces[:, 0], faces[:, 1]))
    cols = np.concatenate((faces[:, 1], faces[:, 2]))
    graph = coo_matrix((np.ones(len(rows), np.bool_), (rows, cols)), shape=(len(points), len(points))).tocsr()
    del rows, cols
    _, vertex_labels = connected_components(graph, directed=False)
    vertex_counts = np.bincount(vertex_labels[faces[:, 0]])
    summary['vertexConnectedComponentsWithFaces'] = int(np.count_nonzero(vertex_counts))
    summary['largestVertexConnectedComponentTriangles'] = int(vertex_counts.max())
    summary['largestVertexConnectedTriangleFraction'] = float(vertex_counts.max() / nf)
    summary['componentDefinition'] = 'Face connectivity across any full shared edge; vertex-touch connectivity reported separately.'
    summary['signedVolumeCaveat'] = 'Edge closure and winding do not establish a non-self-intersecting solid, nesting, tissue identity, or artifact identity.'
    return summary


def self_check():
    faces = np.array([[0, 1, 2], [3, 4, 5], [4, 5, 3], [6, 7, 8], [6, 8, 7],
                      [9, 10, 11], [9, 11, 10], [10, 11, 9], [11, 9, 10],
                      [12, 14, 13], [12, 13, 14], [14, 13, 12]], np.uint32)
    keep, report = cancellation_mask(faces, 15)
    assert np.array_equal(np.flatnonzero(keep), [0, 1, 5, 9])
    assert report['removedOppositePairTriangles'] == 6
    assert report['removedSameOrientationDuplicateTriangles'] == 2
    packed = np.packbits(keep, bitorder='little')
    assert np.array_equal(np.unpackbits(packed, bitorder='little')[:len(keep)], keep)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, default=Path('/workspace/data/guided-native-v21/whole/overview/assets'))
    parser.add_argument('--out', type=Path, default=ROOT / 'public/assets/noise-cleanup-v22')
    parser.add_argument('--report', type=Path, default=ROOT / 'docs/noise-cleanup-v22/overview-audit.json')
    parser.add_argument('--module', type=Path, default=ROOT / 'public/overview-noise-filters.js')
    parser.add_argument('--indices-dir', type=Path, default=Path('/workspace/data/noise-cleanup-v22/overview-filter'))
    args = parser.parse_args()
    self_check()
    records = []
    audits = []
    started = time.monotonic()
    for name, source in SOURCES.items():
        encoded = (args.source_dir / (name + '.hfm.gz')).read_bytes()
        if sha(encoded) != source['sha256']:
            raise ValueError(f'{name} source HFM does not match the pinned published artifact.')
        decoded = gzip.decompress(encoded)
        if sha(decoded) != source['decodedSha256']:
            raise ValueError('Source decoded checksum mismatch.')
        magic, version, nv, count, po, no, io, flags = struct.unpack('<8I', decoded[:32])
        if (magic, version, flags, nv, count) != (0x314d4648, 1, 1, source['vertices'], source['triangles'] * 3):
            raise ValueError('Unexpected HFM header.')
        if po != 32 or no != po + nv * 12 or io != ((no + nv * 6 + 3) & ~3) or io + count * 4 != len(decoded):
            raise ValueError('Unexpected HFM layout or byte count.')
        points = np.ndarray((nv, 3), dtype='<f4', buffer=decoded, offset=po)
        faces = np.ndarray((count // 3, 3), dtype='<u4', buffer=decoded, offset=io)
        if faces.max() >= nv or np.any((faces[:, 0] == faces[:, 1]) | (faces[:, 1] == faces[:, 2]) | (faces[:, 2] == faces[:, 0])):
            raise ValueError('Source contains invalid/repeated vertex indices.')
        keep, cancellation = cancellation_mask(faces, nv)
        indices = np.flatnonzero(keep).astype('<u4')
        assert np.all(indices[1:] > indices[:-1])
        raw_mask = np.packbits(keep, bitorder='little').tobytes()
        mask_bytes = gzip.compress(raw_mask, compresslevel=9, mtime=0)
        mask_name = f'{name}.keep-{sha(mask_bytes)}.bin.gz'
        atomic_bytes(args.out / mask_name, mask_bytes, immutable=True)
        recovered = gzip.decompress((args.out / mask_name).read_bytes())
        unpacked = np.unpackbits(np.frombuffer(recovered, np.uint8), bitorder='little')
        assert recovered == raw_mask and np.array_equal(unpacked[:len(faces)], keep) and not np.any(unpacked[len(faces):])
        raw_indices = indices.tobytes()
        index_bytes = gzip.compress(raw_indices, compresslevel=9, mtime=0)
        index_path = args.indices_dir / f'{name}.retained-indices-{sha(index_bytes)}.u32.gz'
        atomic_bytes(index_path, index_bytes, immutable=True)
        assert gzip.decompress(index_path.read_bytes()) == raw_indices
        before = topology(points, faces)
        after = topology(points, faces[indices])
        record = {
            'id': name, 'sourceSha256': source['sha256'], 'sourceDecodedSha256': source['decodedSha256'],
            'sourceUrl': source['url'], 'originalTriangles': len(faces),
            'retainedTriangles': len(indices), 'removedTriangles': int((~keep).sum()),
            'mask': {'url': '/assets/noise-cleanup-v22/' + mask_name, 'bytes': len(mask_bytes),
                     'sha256': sha(mask_bytes), 'decodedBytes': len(raw_mask), 'decodedSha256': sha(raw_mask)},
            'bitOrder': 'little', 'bit1': 'retain', 'triangleIndexing': 'zero-based original HFM triangle order',
            'retainedTriangleIndexSha256': sha(raw_indices),
        }
        records.append(record)
        audits.append({**record, 'cancellation': cancellation, 'before': before, 'after': after,
            'literalRetainedIndices': {'path': str(index_path), 'format': 'gzip little-endian uint32',
                'entries': len(indices), 'bytes': len(index_bytes), 'sha256': sha(index_bytes),
                'decodedBytes': len(raw_indices), 'decodedSha256': sha(raw_indices)},
            'geometryPreservation': {'positionsChanged': False, 'storedNormalsChanged': False,
                'retainedFacesReordered': False, 'retainedIndicesStrictlyIncreasing': True,
                'sourcePositionBytesSha256': sha(decoded[po:no]), 'sourceNormalBytesSha256': sha(decoded[no:no + nv * 6]),
                'nativeBankChanged': False, 'sourceHfmChanged': False},
            'maskRoundTripVerified': True})
        print(json.dumps({'lod': name, 'originalTriangles': len(faces), 'retainedTriangles': len(indices),
                          'removedTriangles': int((~keep).sum()), 'maskBytes': len(mask_bytes),
                          'maskDecodedBytes': len(raw_mask), 'afterBoundaryEdges': after['boundaryEdges'],
                          'afterNonmanifoldEdges': after['nonmanifoldEdgesAboveTwoFaces']}), flush=True)
        del encoded, decoded, points, faces, keep, indices, raw_indices, raw_mask, unpacked
        gc.collect()
    manifest = {'schema': 'heart-overview-face-filter-v22.1', 'experimental': True,
        'method': 'Exact opposite-face pair cancellation, then same-orientation deduplication.',
        'scope': 'The two existing lossy whole-heart display LODs only; no native-grid tissue classification.',
        'positionsModified': False, 'normalsModified': False, 'retainedFaceOrderModified': False,
        'nativeBankModified': False, 'records': records}
    atomic_bytes(args.out / 'manifest.json', encoded_json(manifest))
    module = ('// Generated from assets/noise-cleanup-v22/manifest.json; immutable source hashes pin every mask.\n'
              'export const OVERVIEW_FACE_FILTERS = Object.freeze(' +
              json.dumps(records, sort_keys=True, separators=(',', ':'), allow_nan=False) + ');\n')
    atomic_bytes(args.module, module.encode())
    audit = {'schema': 'heart-overview-filter-audit-v22.1', 'createdAtUtc': datetime.now(timezone.utc).isoformat(),
        'generatorSha256': sha(Path(__file__).read_bytes()), 'method': manifest['method'],
        'syntheticOrientationAndBitOrderChecksPassed': True, 'records': audits,
        'publicMaskBytes': sum(r['mask']['bytes'] for r in records),
        'publicMaskDecodedBytes': sum(r['mask']['decodedBytes'] for r in records),
        'sourcePins': SOURCES, 'seconds': round(time.monotonic() - started, 3),
        'peakRssMiB': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024,
        'limitations': [
            'Opposing faces are exactly coincident in this display representation; cancellation is not evidence of absent tissue.',
            'A coincident sheet may represent a true thin structure collapsed by prior display sampling or simplification.',
            'Surviving coordinates, connectivity and stored normals are unchanged; deleting faces can expose boundaries.',
            'Neither original nor filtered meshes are guaranteed closed, manifold, consistently oriented or free of self-intersections.',
            'Signed volume must not classify open/nonmanifold components or distinguish anatomy from artifacts.',
            'No native 19.85 micrometre NBE artifact, source intensity, threshold, original HFM or upload gate is modified.',
            'Scientific render comparisons and user-facing labeling are required before enabling a default.',
        ]}
    atomic_bytes(args.report, encoded_json(audit))
    print(json.dumps({'manifest': str(args.out / 'manifest.json'), 'report': str(args.report),
                      'publicMaskBytes': audit['publicMaskBytes'], 'publicMaskDecodedBytes': audit['publicMaskDecodedBytes'],
                      'seconds': audit['seconds'], 'peakRssMiB': audit['peakRssMiB']}), flush=True)


if __name__ == '__main__':
    main()
