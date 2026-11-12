#!/usr/bin/env python3
"""Reproduce existing immutable display bricks from the original public N5 s2.

This restores only bricks required by an exported reference-plane plan into a
private build directory. It never reads the Site/R2 route, changes a scientific
manifest, changes a window/mask, or accepts a mismatch as a new identity.
First run --proof for all donors; a normal run verifies every decoded AND
encoded brick against the retained manifest before atomic installation.
Requires NumPy and the system libblosc (or the blosc2 Python module).
"""
from __future__ import annotations

import argparse
from collections import OrderedDict
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
import ctypes
import ctypes.util
from datetime import datetime, timezone
import gzip
import hashlib
import itertools
import json
import math
import os
import resource
from pathlib import Path
import struct
import threading
import time
import urllib.error
import urllib.request

import numpy as np

SOURCE_BASE = 'https://storage.googleapis.com/ucl-hip-ct-35a68e99feaae8932b1d44da0358940b/'
DONORS = {
    'ladaf-2021-17': ('public/assets/ultra-volume-v7.json', 'public/assets/cleanup/manifest.json',
                     'LADAF-2021-17/heart/19.85um_complete-organ_bm18/s2/', 'data/ultra-volume-v7'),
    's-20-29': ('public/assets/donors/s-20-29/ultra-volume.json', 'public/assets/donors/s-20-29/cleanup/manifest.json',
                'S-20-29/heart/19.89um_complete-organ_bm18/s2/', 'data/donors/s-20-29/ultra-volume'),
    's-20-28': ('public/assets/donors/s-20-28/ultra-volume.json', 'public/assets/donors/s-20-28/cleanup/manifest.json',
                'S-20-28/heart/19.85um_complete-organ_bm18/s2/', 'data/donors/s-20-28/ultra-volume'),
}
MAX_N5_BYTES = 128**3 * 2 + 65536
sha = lambda data: hashlib.sha256(data).hexdigest()
now = lambda: datetime.now(timezone.utc).isoformat()


def write_atomic(path: Path, data: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + f'.{os.getpid()}.{threading.get_ident()}.partial')
    try:
        with temporary.open('wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def write_json(path, value):
    write_atomic(path, (json.dumps(value, indent=2) + '\n').encode())


class Decoder:
    def __init__(self):
        library = ctypes.util.find_library('blosc')
        if library:
            self.library = ctypes.CDLL(library)
            self.fn = self.library.blosc_decompress_ctx
            self.fn.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t, ctypes.c_int]
            self.fn.restype = ctypes.c_int
            self.kind = 'system libblosc, bounded destination, one thread per context'
        else:
            import blosc2
            self.blosc2 = blosc2
            self.kind = 'blosc2 Python module, validated decoded length'

    def decode(self, payload):
        if len(payload) < 32 or len(payload) > MAX_N5_BYTES:
            raise ValueError('Invalid bounded N5 payload length')
        mode, ndim = struct.unpack('>HH', payload[:4])
        dims = struct.unpack('>III', payload[4:16])
        if mode != 0 or ndim != 3 or any(d < 1 or d > 128 for d in dims):
            raise ValueError(f'Unsupported N5 header: {mode}, {ndim}, {dims}')
        expected = math.prod(dims) * 2
        raw_bytes, _, compressed_bytes = struct.unpack('<III', payload[20:32])
        if raw_bytes != expected or compressed_bytes != len(payload)-16:
            raise ValueError('Blosc header does not match the N5 block')
        if hasattr(self, 'fn'):
            source = ctypes.create_string_buffer(payload[16:])
            destination = ctypes.create_string_buffer(expected)
            count = self.fn(source, destination, expected, 1)
            if count != expected:
                raise ValueError(f'Blosc decoded length mismatch: {count} != {expected}')
            raw = destination.raw
        else:
            raw = self.blosc2.decompress(payload[16:])
            if len(raw) != expected:
                raise ValueError('Blosc decoded length mismatch')
        return np.frombuffer(raw, dtype='>u2').reshape(dims[::-1]), sha(raw)


class Recovery:
    def __init__(self, args, donor, decoder, plan):
        self.args, self.donor, self.decoder = args, donor, decoder
        manifest_path, support_path, source_path, target_path = DONORS[donor]
        self.manifest_path = args.repo / manifest_path
        self.manifest_bytes = self.manifest_path.read_bytes()
        self.manifest = json.loads(self.manifest_bytes)
        m = self.manifest
        if (m['brickSize'], m['storedEdge'], m['decodedBrickBytes'], m['codec']) != (64, 65, 65**3, 'gzip-u8-zyx-positive-halo'):
            raise ValueError('Unsupported original fine-brick geometry')
        self.source_url = SOURCE_BASE + source_path
        if donor != 'ladaf-2021-17' and m['sourceHttp'] != self.source_url:
            raise ValueError('Original source URL differs from the retained manifest')
        support = json.loads((args.repo / support_path).read_text())
        self.support_path = args.repo / 'public' / support['volumeUrl'].removeprefix('/')
        mask_bytes = gzip.decompress(self.support_path.read_bytes())
        if sha(mask_bytes) != m['sourceMaskSha256']:
            raise ValueError('Existing support mask does not match the fine bank')
        self.mask = np.frombuffer(mask_bytes, np.uint8).reshape(tuple(support['dimensions'][::-1]))
        self.full = np.array(m['fullDimensionsXYZ'], dtype=int)
        self.origin = np.array(m['sourceOriginXYZ'], dtype=int)
        self.shape = np.array(m['sourceShapeXYZ'], dtype=int)
        self.counts = np.array(m['brickCountsXYZ'], dtype=int)
        self.ledger = {}
        if donor == 'ladaf-2021-17':
            # Preserve the original multiplication/division order exactly.
            self.indices = [np.floor(np.arange(n)*(s-1)/(n-1)+.5).astype(int)
                            for n, s in zip(self.full, support['dimensions'])]
            self.source_dims = np.array([1903, 1903, 2120])
            original_plan = json.loads((args.repo/'public/assets/ultra-support.json').read_text())
            approved = {k for planes in original_plan['slices'].values() for plane in planes for k in plane}
            self.approved = {(k % 15, (k//15) % 15, k//225) for k in approved}
            low, high = m['sourceWindow']
            values = np.arange(65536, dtype=np.float32)
            self.lut = np.rint(np.clip((values-low)*255/(high-low), 0, 255)).astype(np.uint8)
            self.window_method = 'prepare_hosted_sections.py float32 subtract, multiply255, divide, clip, rint'
        else:
            # Exact endpoint registration and integer ties-to-even lookup from
            # prepare-donor-v10.py, without rerunning or changing cleanup.
            self.indices = [np.floor(np.arange(n)/(n-1)*(s-1)+.5).astype(int)
                            for n, s in zip(self.full, support['dimensions'])]
            attributes = json.loads((args.repo/f'docs/donors/{donor}/s2-attributes.json').read_text())
            self.source_dims = np.array(attributes['dimensions'], dtype=int)
            records = json.loads((args.repo/f'docs/donors/{donor}/source-fine-chunks.json').read_text())['records']
            self.ledger = {tuple(r['coordinateXYZ']): r for r in records}
            self.approved = set(self.ledger)
            low, high = m['sourceWindow']
            if int(low) != low or int(high) != high or high <= low:
                raise ValueError('Recovery requires the retained integral source window')
            denominator = int(high-low)
            numerator = np.clip(np.arange(65536, dtype=np.int64)-int(low), 0, denominator)*255
            whole, remainder = np.divmod(numerator, denominator)
            increment = (2*remainder > denominator) | ((2*remainder == denominator) & (whole % 2 == 1))
            self.lut = (whole+increment).astype(np.uint8)
            self.window_method = 'prepare-donor-v10.py exact integer linear quantization, nearest/ties-to-even'
        # Recompute the original compact-mask-derived crop as a provenance gate.
        zz, yy, xx = np.where(self.mask)
        limits = []
        for axis, positions in enumerate((xx, yy, zz)):
            valid = np.flatnonzero((self.indices[axis] >= positions.min()) & (self.indices[axis] <= positions.max()))
            limits.append((int(valid.min()//2*2), int(min(self.full[axis]-1, (int(valid.max())+1)//2*2))))
        if [a for a, _ in limits] != m['sourceOriginXYZ'] or [b-a+1 for a, b in limits] != m['sourceShapeXYZ']:
            raise ValueError('Support crop differs from the immutable fine bank')
        source = next(s for s in plan['sources'] if s['donorId'] == donor)
        if source['fineManifestSha256'] != sha(self.manifest_bytes):
            raise ValueError('Plane export references a different source manifest')
        self.ids = sorted({str(i) for row in plan['rows'] if row['donorId'] == donor and not row['outsideScan']
                           for role in ['ct', 'face'] for i in row[role]['sourceBrickIds']}, key=int)
        if not self.ids or any(i not in m['blocks'] for i in self.ids):
            raise ValueError('Invalid exported source-brick selection')
        if args.proof:
            self.ids = sorted(self.ids, key=lambda i: m['blocks'][i]['bytes'], reverse=True)[:args.proof]
        self.cache_root = args.build_root/'original-source'/donor
        self.output_root = args.build_root/'recovered'/target_path
        self.receipt_path = args.build_root/'recovery-receipts'/f'{donor}-{"proof" if args.proof else "complete"}.json'
        self.chunk_records, self.brick_records = {}, {}
        self.stop = threading.Event()
        self.clean_cache = OrderedDict()
        self.clean_bytes = 0
        self.started = time.monotonic()

    def bounds(self, ident):
        i = int(ident)
        bx, by, bz = i % self.counts[0], (i//self.counts[0]) % self.counts[1], i//(self.counts[0]*self.counts[1])
        local = np.array([bx, by, bz])*64
        return self.origin+local, self.origin+np.minimum(local+65, self.shape)

    def overlaps(self, lo, hi):
        bounded_hi = np.minimum(hi, self.source_dims)
        if np.any(bounded_hi <= lo):
            return
        for c in itertools.product(*(range(int(a//128), int((b-1)//128)+1) for a, b in zip(lo, bounded_hi))):
            begin = np.array(c)*128
            first, last = np.maximum(lo, begin), np.minimum(bounded_hi, begin+128)
            indexes = [self.indices[a][first[a]:last[a]] for a in range(3)]
            if not self.mask[indexes[2][0]:indexes[2][-1]+1, indexes[1][0]:indexes[1][-1]+1, indexes[0][0]:indexes[0][-1]+1].any():
                continue
            if c not in self.approved:
                if self.donor == 'ladaf-2021-17':
                    continue  # Original supported-u16 array left these chunks zero.
                raise ValueError(f'{self.donor}: nonempty source coordinate absent from original ledger: {c}')
            yield c, first, last

    def get_source(self, coord):
        if self.stop.is_set():
            raise RuntimeError('Recovery canceled after a source failure')
        name = '_'.join(map(str, coord))+'.n5'
        target = self.cache_root/name
        expected = self.ledger.get(coord)
        url = self.source_url + '/'.join(map(str, coord))
        if expected and expected['url'] != url:
            raise ValueError('Original URL ledger mismatch')
        cached = target.exists()
        # Reuse the independently verified first ordinary GCS access probe.
        probe = self.args.build_root/'original-source-probe'/self.donor/name
        payload = target.read_bytes() if cached else probe.read_bytes() if probe.exists() else None
        attempts = 0
        response_evidence = None
        network_started = time.monotonic()
        if payload is None:
            for attempt in range(3):
                if self.stop.is_set():
                    raise RuntimeError('Recovery canceled')
                attempts += 1
                try:
                    with urllib.request.urlopen(url, timeout=60) as response:
                        response_evidence = {'status': response.status,
                            'headers': {key: response.headers.get(key) for key in
                                ['Content-Length', 'Content-Type', 'ETag', 'x-goog-generation', 'x-goog-hash']}}
                        if response.status != 200:
                            raise ValueError(f'Original source returned {response.status}')
                        advertised = response.headers.get('Content-Length')
                        if advertised and int(advertised) > MAX_N5_BYTES:
                            raise ValueError('Original source exceeds a bounded N5 block')
                        if expected and advertised and int(advertised) != expected['bytes']:
                            raise ValueError('Original source declared byte count changed')
                        payload = response.read(MAX_N5_BYTES+1)
                        if len(payload) > MAX_N5_BYTES:
                            raise ValueError('Original source exceeds a bounded N5 block')
                    break
                except urllib.error.HTTPError as error:
                    # Do not retry or change route/headers after access denial.
                    if error.code not in [429, 500, 502, 503, 504] or attempt == 2:
                        raise
                except (TimeoutError, urllib.error.URLError):
                    if attempt == 2:
                        raise
                time.sleep(min(4, 2**attempt))
        digest = sha(payload)
        if expected and (len(payload) != expected['bytes'] or digest != expected['sha256']):
            evidence = self.preserve_source_failure(coord, payload, expected, response_evidence,
                                                    'encoded identity mismatch', cached)
            raise ValueError(f'Original source encoded identity mismatch: {coord}; '
                             f'expected {expected["bytes"]} bytes/{expected["sha256"]}, '
                             f'observed {len(payload)} bytes/{digest}; evidence: {evidence}')
        try:
            array, raw_digest = self.decoder.decode(payload)
        except ValueError as error:
            evidence = self.preserve_source_failure(coord, payload, expected, response_evidence,
                                                    f'N5 decode failure: {error}', cached)
            raise ValueError(f'Original source decode failed: {coord}; evidence: {evidence}') from error
        if expected and raw_digest != expected['decodedSha256']:
            evidence = self.preserve_source_failure(coord, payload, expected, response_evidence,
                                                    'decoded identity mismatch', cached)
            raise ValueError(f'Original source decoded identity mismatch: {coord}; evidence: {evidence}')
        expected_shape = tuple(np.minimum(128, self.source_dims-np.array(coord)*128)[::-1])
        # Original N5 edge blocks may store a full padded 128^3 block. The
        # original donor generator accepts that header and clips to acquired
        # source bounds; require enough data, never import the padding.
        if any(actual < required for actual, required in zip(array.shape, expected_shape)):
            evidence = self.preserve_source_failure(coord, payload, expected, response_evidence,
                                                    'block does not cover acquired source extent', cached)
            raise ValueError(f'Original source dimensions do not cover the acquired extent: '
                             f'{coord}: {array.shape} < {expected_shape}; evidence: {evidence}')
        record = {'coordinateXYZ': list(coord), 'url': url, 'bytes': len(payload), 'sha256': digest,
                  'decodedSha256': raw_digest, 'dimensionsXYZ': list(array.shape[::-1]),
                  'sourceExtentXYZ': [int(d) for d in expected_shape[::-1]],
                  'ignoredPaddingXYZ': [int(a-b) for a, b in zip(array.shape[::-1], expected_shape[::-1])],
                  'priorSourceLedgerMatched': bool(expected), 'cacheHit': cached, 'networkAttempts': attempts,
                  'networkSeconds': round(time.monotonic()-network_started, 6) if attempts else 0}
        if not cached:
            write_atomic(target, payload)
        write_json(target.with_suffix('.json'), record)
        return record

    def preserve_source_failure(self, coord, payload, expected, response, reason, cached):
        # A rejected body is diagnostic evidence only. It never enters the verified
        # cache, and preserving it does not retry or weaken an identity failure.
        name = '_'.join(map(str, coord)) + f'-{time.time_ns()}'
        prefix = self.args.build_root/'original-source-failures'/self.donor/name
        write_atomic(prefix.with_suffix('.n5'), payload)
        write_json(prefix.with_suffix('.json'), {'recordedAt': now(), 'reason': reason,
            'coordinateXYZ': list(coord), 'url': self.source_url + '/'.join(map(str, coord)),
            'response': response, 'cacheHit': cached, 'observedBytes': len(payload),
            'observedSha256': sha(payload), 'expected': expected,
            'acceptedIntoVerifiedCache': False})
        return str(prefix.with_suffix('.json'))

    def checkpoint(self, status):
        write_json(self.receipt_path, {'schemaVersion': 1, 'donorId': self.donor, 'status': status,
            'updatedAt': now(), 'elapsedSeconds': round(time.monotonic()-self.started, 3),
            'workers':self.args.workers, 'processCpuSeconds':time.process_time(),
            'processPeakRssBytes':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024,
            'networkBytesThisRun':sum(r['bytes'] for r in self.chunk_records.values() if r['networkAttempts']),
            'networkRequestsThisRun':sum(r['networkAttempts'] for r in self.chunk_records.values()),
            'fineManifestSha256': sha(self.manifest_bytes), 'sourceMaskSha256': self.manifest['sourceMaskSha256'],
            'sourceOriginXYZ': self.origin.tolist(), 'sourceShapeXYZ': self.shape.tolist(),
            'sourceWindow': self.manifest['sourceWindow'], 'windowMethod': self.window_method,
            'sourceUrl': self.source_url, 'sourceDimsXYZ': self.source_dims.tolist(), 'decoder': self.decoder.kind,
            'planSha256': self.args.plan_sha256, 'requiredBrickCount': len(self.ids),
            'sourceChunkCount': len(self.chunk_records), 'verifiedBrickCount': len(self.brick_records),
            'outputRoot': str(self.output_root), 'sourceChunks': sorted(self.chunk_records.values(), key=lambda r:r['coordinateXYZ'][::-1]),
            'bricks': sorted(self.brick_records.values(), key=lambda r:int(r['id'])),
            'sourceManifestsModified': False, 'sourceWindowOrMaskChanged': False})

    def download(self, coords):
        pending = set()
        iterator = iter(sorted(coords, key=lambda c:c[::-1]))
        with ThreadPoolExecutor(max_workers=self.args.workers) as pool:
            try:
                for _ in range(self.args.workers):
                    c = next(iterator, None)
                    if c is not None:
                        pending.add(pool.submit(self.get_source, c))
                while pending:
                    done, pending = wait(pending, return_when=FIRST_COMPLETED)
                    for future in done:
                        record = future.result()
                        self.chunk_records[tuple(record['coordinateXYZ'])] = record
                        c = next(iterator, None)
                        if c is not None:
                            pending.add(pool.submit(self.get_source, c))
                    if len(self.chunk_records) % 32 < len(done) or not pending:
                        self.checkpoint('acquiring-original-source')
                        print(json.dumps({'donor':self.donor, 'phase':'original-source', 'ready':len(self.chunk_records), 'total':len(coords)}), flush=True)
            except BaseException:
                self.stop.set()
                for future in pending:
                    future.cancel()
                self.checkpoint('failed-source-acquisition')
                raise

    def cleaned_chunk(self, coord):
        if coord in self.clean_cache:
            value = self.clean_cache.pop(coord)
            self.clean_cache[coord] = value
            return value
        target = self.cache_root/('_'.join(map(str,coord))+'.n5')
        payload = target.read_bytes()
        record = self.chunk_records[coord]
        if sha(payload) != record['sha256']:
            raise ValueError('Cached original source changed after verification')
        array, digest = self.decoder.decode(payload)
        if digest != record['decodedSha256']:
            raise ValueError('Cached decoded source changed after verification')
        begin = np.array(coord)*128
        hi = np.minimum(np.minimum(begin+np.array(array.shape[::-1]), self.full), self.source_dims)
        length = hi-begin
        values = self.lut[array[:length[2], :length[1], :length[0]]]
        ix = [self.indices[a][begin[a]:hi[a]] for a in range(3)]
        values[self.mask[np.ix_(ix[2], ix[1], ix[0])] == 0] = 0
        expected = self.ledger.get(coord)
        if expected:
            lo, last = np.maximum(begin,self.origin)-begin, np.minimum(hi,self.origin+self.shape)-begin
            retained = values[lo[2]:last[2],lo[1]:last[1],lo[0]:last[0]]
            if sha(retained.tobytes()) != expected['retainedDisplaySha256']:
                raise ValueError(f'Original masked/windowed source ledger mismatch: {coord}')
        self.clean_cache[coord] = values
        self.clean_bytes += values.nbytes
        while self.clean_bytes > self.args.cache_mib*1024**2 and len(self.clean_cache)>1:
            _, old = self.clean_cache.popitem(last=False)
            self.clean_bytes -= old.nbytes
        return values

    def run(self):
        coords = {c for ident in self.ids for c, _, _ in self.overlaps(*self.bounds(ident))}
        print(json.dumps({'donor':self.donor, 'phase':'plan', 'bricks':len(self.ids), 'originalChunks':len(coords),
                          'maskMatched':True, 'cropMatched':True, 'proof':bool(self.args.proof)}), flush=True)
        if self.args.plan_only:
            return
        self.download(coords)
        try:
            for ident in self.ids:
                entry = self.manifest['blocks'][ident]
                output = self.output_root/entry['path']
                if output.exists():
                    encoded = output.read_bytes()
                    if len(encoded) != entry['bytes'] or sha(encoded) != entry['sha256']:
                        raise ValueError(f'Existing immutable output conflicts: {ident}')
                    raw = gzip.decompress(encoded)
                    if len(raw) != 65**3 or sha(raw) != entry['rawSha256']:
                        raise ValueError(f'Existing immutable raw output conflicts: {ident}')
                    reused = True
                else:
                    lo, hi = self.bounds(ident)
                    data = np.zeros((65,65,65), dtype=np.uint8)
                    for c, first, last in self.overlaps(lo,hi):
                        chunk = self.cleaned_chunk(c)
                        a, b = first-np.array(c)*128, last-np.array(c)*128
                        dest0, dest1 = first-lo, last-lo
                        data[dest0[2]:dest1[2],dest0[1]:dest1[1],dest0[0]:dest1[0]] = chunk[a[2]:b[2],a[1]:b[1],a[0]:b[0]]
                    raw = data.tobytes()
                    if sha(raw) != entry['rawSha256']:
                        raise ValueError(f'Immutable brick raw SHA-256 mismatch: {ident}')
                    encoded = gzip.compress(raw, compresslevel=3, mtime=0)
                    if len(encoded) != entry['bytes'] or sha(encoded) != entry['sha256']:
                        raise ValueError(f'Raw brick is exact but immutable gzip bytes differ: {ident}')
                    write_atomic(output, encoded)
                    reused = False
                self.brick_records[ident] = {'id':ident, 'path':entry['path'], 'bytes':len(encoded),
                                            'sha256':sha(encoded), 'rawSha256':sha(raw), 'reusedVerifiedOutput':reused}
                if len(self.brick_records)%128==0 or len(self.brick_records)==len(self.ids):
                    self.checkpoint('verified-proof' if self.args.proof else 'reconstructing-exact-bricks')
                    print(json.dumps({'donor':self.donor, 'phase':'verified-bricks', 'ready':len(self.brick_records), 'total':len(self.ids)}), flush=True)
            self.checkpoint('verified-proof' if self.args.proof else 'complete')
            print(json.dumps({'donor':self.donor, 'phase':'complete', 'proof':bool(self.args.proof),
                              'verifiedBricks':len(self.brick_records), 'outputRoot':str(self.output_root), 'receipt':str(self.receipt_path)}), flush=True)
        except BaseException:
            self.checkpoint('failed-brick-verification')
            raise


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument('--planes', type=Path, required=True)
    parser.add_argument('--build-root', type=Path, required=True)
    parser.add_argument('--donor', choices=['all',*DONORS], default='all')
    parser.add_argument('--proof', type=int, default=0, help='Verify only this many largest required bricks per donor first')
    parser.add_argument('--workers', type=int, default=8)
    parser.add_argument('--cache-mib', type=int, default=96)
    parser.add_argument('--plan-only', action='store_true')
    args=parser.parse_args()
    args.repo=args.repo.resolve();args.planes=args.planes.resolve();args.build_root=args.build_root.resolve()
    if args.build_root.is_relative_to(args.repo):
        parser.error('--build-root must be private staging outside the repository')
    if not 1<=args.workers<=16 or not 8<=args.cache_mib<=256 or args.proof<0:
        parser.error('workers must be 1–16; cache-mib 8–256; proof nonnegative')
    plan_bytes=args.planes.read_bytes()
    args.plan_sha256=sha(plan_bytes)
    plan=json.loads(plan_bytes)
    decoder=Decoder()
    for donor in DONORS if args.donor=='all' else [args.donor]:
        Recovery(args,donor,decoder,plan).run()


if __name__=='__main__':
    main()
