#!/usr/bin/env python3
"""Numerical/tiling/performance checks for the local float32 TV accelerator.

Requires already acquired N5 objects in --native-cache; never downloads data.
Run from any directory. The output records hashes, geometry, versions, exact
comparison results, and isolated-process timings/RSS for 161-cubed arrays.
"""
from __future__ import annotations

import argparse
import hashlib
import itertools
import json
from pathlib import Path
import platform
import resource
import statistics
import subprocess
import sys
import time

import numpy as np
import skimage
from skimage.restoration import denoise_tv_chambolle as reference_tv

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/guided-native-v21'))
from tv_kernel import denoise_tv_chambolle as compiled_tv, kernel_metadata


def compare(actual, expected):
    difference = actual - expected
    return {
        'bitExact': bool(np.array_equal(actual.view(np.uint32), expected.view(np.uint32))),
        'differentSamples': int(np.count_nonzero(actual.view(np.uint32) != expected.view(np.uint32))),
        'maximumRawIntensityError': float(np.abs(difference).max()),
        'rmsRawIntensityError': float(np.sqrt(np.mean(difference.astype(np.float64) ** 2))),
    }


def benchmark(method, repeats):
    # Import both implementations in each fresh process for comparable baseline.
    kernel_metadata()
    rng = np.random.default_rng(7312)
    a = rng.integers(12000, 25000, (161,) * 3, dtype=np.uint16).astype(np.float32)
    baseline = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024
    function = reference_tv if method == 'skimage' else compiled_tv
    times = []
    digest = None
    for _ in range(repeats):
        started = time.perf_counter()
        out = function(a, weight=800.0, eps=0.0, max_num_iter=16, channel_axis=None)
        times.append(time.perf_counter() - started)
        digest = hashlib.sha256(out.tobytes()).hexdigest()
        del out
    return {
        'method': method, 'inputShapeZYX': list(a.shape), 'repeats': repeats,
        'seconds': times, 'medianSeconds': statistics.median(times),
        'processPeakRssBytes': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024,
        'baselinePeakRssBytes': baseline, 'outputSha256': digest,
        'inputSha256': hashlib.sha256(a.tobytes()).hexdigest(),
    }


def assemble(caches, origin_xyz, shape_zyx, records):
    from source import decode_n5
    origin = np.asarray(origin_xyz, dtype=np.int64)
    shape = np.asarray(shape_zyx[::-1], dtype=np.int64)
    end = origin + shape
    result = np.empty(shape_zyx, dtype=np.float32)
    for xyz in itertools.product(*(range(int(a // 128), int((b - 1) // 128) + 1)
                                   for a, b in zip(origin, end))):
        name = '_'.join(map(str, xyz)) + '.n5'
        path = next((cache / name for cache in caches if (cache / name).exists()), None)
        if path is None:
            raise FileNotFoundError('Missing already acquired N5 block ' + name)
        encoded = path.read_bytes()
        records[xyz] = {
            'coordinatesXYZ': list(xyz), 'bytes': len(encoded),
            'sha256': hashlib.sha256(encoded).hexdigest(),
        }
        source = decode_n5(encoded)
        source_origin = np.asarray(xyz, dtype=np.int64) * 128
        lo = np.maximum(origin, source_origin)
        hi = np.minimum(end, source_origin + np.asarray(source.shape[::-1]))
        destination = tuple(slice(int(a), int(b)) for a, b in zip((lo - origin)[::-1], (hi - origin)[::-1]))
        selected = tuple(slice(int(a), int(b)) for a, b in zip((lo - source_origin)[::-1], (hi - source_origin)[::-1]))
        result[destination] = source[selected]
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--native-cache', type=Path, nargs='+')
    parser.add_argument('--out', type=Path)
    parser.add_argument('--benchmark-child', choices=('skimage', 'compiled'))
    parser.add_argument('--repeats', type=int, default=3)
    args = parser.parse_args()
    if args.benchmark_child:
        print(json.dumps(benchmark(args.benchmark_child, args.repeats)))
        return
    if args.native_cache is None or args.out is None:
        parser.error('--native-cache and --out are required for verification')
    report = {
        'schema': 'guided-native-tv-kernel-verification-v21.1',
        'referenceVersions': {'skimage': skimage.__version__, 'numpy': np.__version__},
        'platform': platform.platform(),
        'compiler': subprocess.check_output(['cc', '--version'], text=True).splitlines()[0],
        'parameters': {'weightRaw': 800, 'iterations': 16, 'epsilon': 0, 'dtype': 'float32'},
        'kernel': kernel_metadata(),
    }
    # A locally compiled cache path is not portable source evidence.
    report['kernel'].pop('library')
    report['benchmarks'] = []
    for method in ('skimage', 'compiled'):
        result = subprocess.check_output([
            sys.executable, str(Path(__file__).resolve()), '--benchmark-child', method,
            '--repeats', str(args.repeats),
        ], text=True)
        report['benchmarks'].append(json.loads(result))
    ref_bench, c_bench = report['benchmarks']
    assert ref_bench['outputSha256'] == c_bench['outputSha256']
    report['medianSpeedup'] = ref_bench['medianSeconds'] / c_bench['medianSeconds']

    rng = np.random.default_rng(20261106)
    report['smallCases'] = []
    for shape in ((1, 1, 1), (1, 7, 9), (2, 2, 2), (17, 19, 21)):
        for iterations in (1, 2, 3, 16, 40):
            a = rng.integers(0, 65536, shape, dtype=np.uint16).astype(np.float32)
            if shape == (17, 19, 21):
                a = a[:, ::-1, :]
            ref = reference_tv(a, weight=800, eps=0, max_num_iter=iterations)
            out = compiled_tv(a, weight=800, eps=0, max_num_iter=iterations)
            row = {'shapeZYX': list(shape), 'iterations': iterations, **compare(out, ref)}
            assert row['bitExact'], row
            report['smallCases'].append(row)

    h = 16
    core = (slice(h, h + 129),) * 3
    base_core_xyz = np.asarray((35, 30, 36), dtype=np.int64) * 128
    origin_xyz = base_core_xyz - h
    records = {}
    base = assemble(args.native_cache, origin_xyz, (161,) * 3, records)
    out_base = compiled_tv(base)
    report['nativeTiles'] = []
    report['sharedFaces'] = []
    ref = reference_tv(base, weight=800, eps=0, max_num_iter=16)
    result = compare(out_base, ref)
    assert result['bitExact'], result
    report['nativeTiles'].append({
        'coreOriginXYZ': base_core_xyz.tolist(), 'inputShapeZYX': [161] * 3,
        'inputSha256': hashlib.sha256(base.tobytes()).hexdigest(),
        'outputSha256': hashlib.sha256(out_base.tobytes()).hexdigest(), **result,
    })
    del ref
    for axis_zyx, axis_name in enumerate(('Z', 'Y', 'X')):
        axis_xyz = 2 - axis_zyx
        offset = np.zeros(3, np.int64)
        offset[axis_xyz] = 128
        adjacent = assemble(args.native_cache, origin_xyz + offset, (161,) * 3, records)
        out_adjacent = compiled_tv(adjacent)
        ref = reference_tv(adjacent, weight=800, eps=0, max_num_iter=16)
        result = compare(out_adjacent, ref)
        assert result['bitExact'], result
        report['nativeTiles'].append({
            'coreOriginXYZ': (base_core_xyz + offset).tolist(),
            'inputShapeZYX': [161] * 3,
            'inputSha256': hashlib.sha256(adjacent.tobytes()).hexdigest(),
            'outputSha256': hashlib.sha256(out_adjacent.tobytes()).hexdigest(), **result,
        })
        del ref
        left = list(core)
        right = list(core)
        left[axis_zyx] = h + 128
        right[axis_zyx] = h
        face = compare(out_base[tuple(left)].copy(), out_adjacent[tuple(right)].copy())
        assert face['bitExact'], face
        whole_shape = [161] * 3
        whole_shape[axis_zyx] += 128
        whole = assemble(args.native_cache, origin_xyz, tuple(whole_shape), records)
        out_whole = compiled_tv(whole)
        shifted_core = list(core)
        shifted_core[axis_zyx] = slice(h + 128, h + 257)
        left_whole = compare(out_base[core].copy(), out_whole[core].copy())
        right_whole = compare(out_adjacent[core].copy(), out_whole[tuple(shifted_core)].copy())
        assert left_whole['bitExact'] and right_whole['bitExact']
        report['sharedFaces'].append({
            'axis': axis_name, 'haloNativeSamples': h, 'faceShape': [129, 129],
            'adjacentFace': face, 'leftCoreVersusMonolithic': left_whole,
            'rightCoreVersusMonolithic': right_whole,
            'monolithicInputShapeZYX': whole_shape,
        })
        del adjacent, out_adjacent, whole, out_whole
    report['nativeSource'] = {
        'donor': 'LADAF-2021-17',
        'url': 'https://storage.googleapis.com/ucl-hip-ct-35a68e99feaae8932b1d44da0358940b/LADAF-2021-17/heart/19.85um_complete-organ_bm18/s0/',
        'spacingUm': 19.85, 'blocks': [records[k] for k in sorted(records)],
        'networkBytesDuringVerification': 0,
    }
    report['allChecksPassed'] = True
    report['scope'] = 'Numerical and seam equivalence to fixed TV800x16; no anatomical accuracy claim.'
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({
        'allChecksPassed': True, 'medianSpeedup': report['medianSpeedup'],
        'benchmarks': report['benchmarks'], 'nativeTiles': len(report['nativeTiles']),
        'sharedFaces': len(report['sharedFaces']), 'sourceBlocks': len(records),
        'report': str(args.out),
    }), flush=True)


if __name__ == '__main__':
    main()
