#!/usr/bin/env python3
"""Stream a complete guided native reconstruction with bounded rolling storage.

Source layers remain compressed on disk. A bounded decoded LRU supplies current
tiles while thin overlapping strips connect adjacent layers. Completed tiles
release source blocks after their last dependent core succeeds. Input objects
are hashed and output checkpoints are atomic; failures never use an overview
substitution.
"""
from __future__ import annotations

import argparse
from collections import OrderedDict
import concurrent.futures as futures
import ctypes
import fcntl
import hashlib
import json
import multiprocessing
import os
from pathlib import Path
import shutil
import struct
import sys
import threading
import time

import blosc2
import numpy as np

from source import NativeSource, decode_n5, parse_header, decode_stream, DIMENSIONS_XYZ


def struct_dimensions(encoded):
    return struct.unpack('>III', encoded[4:16])


def atomic_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.partial')
    temporary.write_text(json.dumps(data, indent=2) + '\n')
    temporary.replace(path)


def file_hash(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(4 * 1024**2), b''):
            h.update(chunk)
    return h.hexdigest()


def initialize_worker():
    blosc2.set_nthreads(1)


def trim_allocator():
    # A useful optimization after bounded arrays have been released; correctness
    # and the storage limit do not depend on this glibc-specific hint.
    try:
        ctypes.CDLL(None).malloc_trim(0)
    except (AttributeError, OSError):
        pass


def work_tile(raw, valid, coord, halo, output, config):
    from refine import process_tile
    try:
        return process_tile(raw, valid, coord, halo, output, config)
    finally:
        trim_allocator()


class RollingRun:
    def __init__(self, args):
        self.args = args
        self.root = args.work
        self.root.mkdir(parents=True, exist_ok=True)
        self.cache = self.root / 'next-layer-cache'
        self.cache.mkdir(exist_ok=True)
        self.output = self.root / 'tiles'
        self.output.mkdir(exist_ok=True)
        self.input_coords = {tuple(map(int, c)) for c in np.load(args.plan)}
        self.core_coords = {tuple(map(int, c)) for c in np.load(args.core_plan or args.plan)}
        if not self.core_coords <= self.input_coords:
            raise ValueError('Every core must be covered by the source input plan')
        self.by_z = {}
        for c in self.input_coords:
            self.by_z.setdefault(c[2], set()).add(c)
        self.config = json.loads(args.config.read_text())
        self.halo = int(self.config['halo'])
        if not 1 <= self.halo <= 31:
            raise ValueError('Rolling strips require a halo of 1–31 samples')
        self.source = NativeSource(args.download_workers, [self.cache, *args.cached_source])
        self.current = {}
        self.current_decoded = OrderedDict()
        self.current_tails = {}
        self.current_uses = {}
        self.stopping = threading.Event()
        self.previous = {}
        self.following = {}
        self.extra = {}
        self.records = {}
        self.completed = {}
        self.uploader = None
        if args.upload:
            from upload import UploadClient, read_access
            self.uploader = UploadClient.from_access(read_access(), workers=args.upload_workers)
        self.start = time.monotonic()
        self.fingerprint = hashlib.sha256(json.dumps(dict(
            inputPlan=file_hash(args.plan), corePlan=file_hash(args.core_plan or args.plan),
            configuration=self.config,
            processingCode={name:file_hash(Path(__file__).parent/name)
                for name in ('source.py','prior.py','edge_codec.py','refine.py','tv_kernel.py','tv_kernel.c')},
            priorManifest=file_hash(Path(__file__).resolve().parents[2]/'public/assets/ultra-volume-v7.json')),
            sort_keys=True).encode()).hexdigest()
        manifest = self.root / 'run.json'
        if manifest.exists():
            prior = json.loads(manifest.read_text())
            if prior['fingerprint'] != self.fingerprint:
                raise ValueError('Existing checkpoint belongs to a different plan or processing configuration')
        for record in (self.root / 'records').glob('*.json'):
            item = json.loads(record.read_text())
            if item.get('fingerprint') != self.fingerprint:
                raise ValueError('Tile checkpoint configuration differs')
            c = tuple(item['coordinatesXYZ'])
            # A missing or changed artifact is never counted as completed.
            paths = item.get('artifacts', [])
            def retained(p):
                local = self.root/p['path']
                if local.is_file():
                    return file_hash(local) == p['sha256']
                receipt = p.get('remote',{})
                if receipt.get('verified') and receipt.get('sha256') == p['sha256'] and receipt.get('bytes') == p['bytes']:
                    from upload import validate_remote_path, SITE_URL, API
                    validate_remote_path(receipt['path'],p['sha256'])
                    return receipt.get('url') == SITE_URL+API+receipt['path']
                return False
            if all(retained(p) for p in paths):
                self.completed[c] = item
        atomic_json(manifest, dict(schema='guided-native-run-v21.1', fingerprint=self.fingerprint,
            inputBlocks=len(self.input_coords), coreBlocks=len(self.core_coords), config=self.config,
            inputPlan=str(args.plan), corePlan=str(args.core_plan or args.plan),
            sourceSpacingUm=19.85, nativeDimensionsXYZ=list(DIMENSIONS_XYZ)))

    def source_path(self, coord):
        name = '_'.join(map(str, coord)) + '.n5'
        return next((p / name for p in self.source.cache_dirs if (p / name).exists()), None)

    def obtain(self, coord, stage, keep_path=False):
        path = self.source_path(coord)
        cached = path is not None
        if cached:
            encoded = path.read_bytes()
            generation = None
        else:
            encoded, generation = self.source.request(coord)
        expected = tuple(min(128, n - c * 128) for n, c in zip(DIMENSIONS_XYZ, coord))[::-1]
        if keep_path:
            if (len(encoded) < 32 or struct.unpack('>HH',encoded[:4]) != (0,3)
                    or struct_dimensions(encoded)[::-1] != expected):
                raise ValueError('Unexpected retained N5 source header')
            _,_,_,typesize,nbytes,_,cbytes = struct.unpack('<BBBBIII',encoded[16:32])
            if typesize != 2 or nbytes != int(np.prod(expected))*2 or len(encoded) != cbytes+16:
                raise ValueError('Retained N5 source size differs from its header')
            # Full validated decompression happens on first use (including tails).
            values = None
        elif stage and struct_dimensions(encoded) == (128,128,128):
            metadata = parse_header(encoded[:48])
            if len(encoded) != metadata['cbytes'] + 16:
                raise ValueError('Incomplete next-layer N5 object')
            values = decode_stream(metadata, 0,
                encoded[metadata['starts'][0]+16:metadata['ends'][0]+16])
        else:
            values = decode_n5(encoded)
        if not keep_path and values.shape != ((32,128,128) if stage and expected == (128,128,128) else expected):
            raise ValueError(f'Unexpected source shape for {coord}')
        record = dict(coordinatesXYZ=list(coord), bytes=len(encoded), cached=cached,
            sha256=hashlib.sha256(encoded).hexdigest(), generation=generation)
        if stage or keep_path:
            if not cached:
                deadline = time.monotonic()+120
                while shutil.disk_usage(self.root).free < len(encoded) + self.args.reserve_mib * 1024**2:
                    if keep_path or time.monotonic() > deadline or self.stopping.wait(.2):
                        raise RuntimeError('Checkpoint preserved: insufficient room for compressed source storage')
                path = self.cache / ('_'.join(map(str, coord)) + '.n5')
                temporary = path.with_suffix('.part')
                temporary.write_bytes(encoded)
                temporary.replace(path)
            result = path if keep_path else values[:self.halo + 1].copy()
        else:
            result = values
            # Remove only this run's reproducible, already-decoded rolling cache.
            if path is not None and path.parent == self.cache:
                path.unlink()
        return coord, result, record

    def obtain_previous_tail(self, coord):
        c, values, record = self.obtain(coord,False)
        # Return only the strip from each future. Ordered map may retain later
        # completed results behind a slow earlier request; never retain full
        # decoded blocks in those futures.
        return c,values[-self.halo:].copy(),record

    def current_values(self, coord):
        if coord in self.current_decoded:
            self.current_decoded.move_to_end(coord)
            return self.current_decoded[coord]
        encoded = self.current[coord].read_bytes()
        if hashlib.sha256(encoded).hexdigest() != self.records[coord]['sha256']:
            raise ValueError('Retained source cache changed before decoding')
        values = decode_n5(encoded)
        self.current_decoded[coord] = values
        while len(self.current_decoded) > self.args.decoded_cache_blocks:
            self.current_decoded.popitem(last=False)
        return values

    def retire_current(self, coord):
        # Keep the next layer's overlap before deleting only our reproducible
        # source cache. Original research inputs in other directories stay put.
        values = self.current_values(coord)
        self.current_tails[coord] = values[-self.halo:].copy()
        path = self.current.pop(coord)
        self.current_decoded.pop(coord,None)
        if path.parent == self.cache:
            path.unlink()

    def release_dependencies(self, core):
        for dy in (-1,0,1):
            for dx in (-1,0,1):
                coord = (core[0]+dx,core[1]+dy,core[2])
                if coord in self.current_uses:
                    self.current_uses[coord] -= 1
                    if self.current_uses[coord] == 0 and coord in self.current:
                        self.retire_current(coord)

    def record_source(self, item):
        c = tuple(item['coordinatesXYZ'])
        if c not in self.records:
            self.records[c] = item
            with (self.root / 'source-objects.jsonl').open('a') as stream:
                stream.write(json.dumps(item, separators=(',', ':')) + '\n')

    def store_result(self, coord, result):
        started = time.monotonic()
        if self.uploader is not None:
            for artifact in result.get('artifacts',[]):
                if artifact.get('role') != 'native':
                    continue
                remote = 'tiles/'+'_'.join(map(str,coord))+'-'+artifact['sha256']+'.nbe.gz'
                artifact['remote'] = self.uploader.upload(self.root/artifact['path'],remote,artifact['sha256'])
        result['storageSeconds'] = time.monotonic()-started
        return result

    def checkpoint_result(self, coord, result):
        result.update(coordinatesXYZ=list(coord),fingerprint=self.fingerprint)
        atomic_json(self.root/'records'/('_'.join(map(str,coord))+'.json'),result)
        self.completed[coord] = result
        # A durable receipt follows a complete public GET checksum comparison.
        # Persist that retrieval information before evicting only our derivative.
        if self.uploader is not None:
            for artifact in result.get('artifacts',[]):
                if artifact.get('role') == 'native' and artifact.get('remote',{}).get('verified'):
                    path = self.root/artifact['path']
                    if file_hash(path) != artifact['sha256']:
                        raise ValueError('Native artifact changed after upload verification; file retained')
                    path.unlink()
        self.release_dependencies(coord)

    def copy_region(self, raw, valid, origin, array, array_origin):
        lo = np.maximum(origin, array_origin)
        hi = np.minimum(origin + np.array(raw.shape[::-1]), array_origin + np.array(array.shape[::-1]))
        if np.any(hi <= lo):
            return
        dst = tuple(slice(int(a), int(b)) for a, b in zip((lo-origin)[::-1], (hi-origin)[::-1]))
        src = tuple(slice(int(a), int(b)) for a, b in zip((lo-array_origin)[::-1], (hi-array_origin)[::-1]))
        raw[dst] = array[src]
        valid[dst] = True

    def assemble(self, c):
        n = 129 + 2 * self.halo
        raw = np.zeros((n, n, n), np.uint16)
        valid = np.zeros(raw.shape, bool)
        origin = np.array(c) * 128 - self.halo
        for dz in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    key = (c[0]+dx, c[1]+dy, c[2]+dz)
                    collection = self.previous if dz == -1 else self.following if dz == 1 else self.current
                    a = self.current_values(key) if dz == 0 and key in self.current else collection.get(key)
                    base = np.array(key) * 128
                    if a is not None:
                        if dz == -1:
                            base[2] += 128 - len(a)
                        self.copy_region(raw, valid, origin, a, base)
                    elif key in self.extra:
                        self.copy_region(raw, valid, origin, self.extra[key], base)
        return raw, valid

    def progress(self, phase, z=None, error=None):
        records = list(self.completed.values())
        item = dict(schema='guided-native-progress-v21.1', phase=phase, zLayer=z,
            complete=phase == 'complete', plannedInputBlocks=len(self.input_coords),
            plannedCoreBlocks=len(self.core_coords), completedCoreBlocks=len(self.completed),
            plannedTileCompletionFraction=len(self.completed)/len(self.core_coords),
            nonemptyTiles=sum(not r.get('empty', False) for r in records),
            outputBytes=sum(sum(a.get('bytes', 0) for a in r.get('artifacts', [])) for r in records),
            verifiedHostedNativeObjects=sum(a.get('remote',{}).get('verified',False) for r in records for a in r.get('artifacts',[])),
            networkBytesThisRun=self.source.network_bytes, requestsThisRun=self.source.requests,
            retriesThisRun=self.source.retries, elapsedSeconds=time.monotonic()-self.start,
            surfaceContribution={name:sum(r.get('surfaceContribution',{}).get(name,0) for r in records)
                for name in ('nativeOnlyEdgeVertices','blendedEdgeVertices','priorOnlyEdgeVertices')},
            diskFreeBytes=shutil.disk_usage(self.root).free, error=error)
        item['decodedSourceCacheBlocks'] = len(self.current_decoded)
        item['residentSourceArrayBytes'] = sum(a.nbytes for bank in
            (self.current_decoded,self.previous,self.following,self.current_tails,self.extra)
            for a in bank.values())
        atomic_json(self.root / 'progress.json', item)
        print(json.dumps(item, separators=(',', ':')), flush=True)
        trim_allocator()

    def run(self):
        z_values = sorted({c[2] for c in self.core_coords if c not in self.completed})
        if not z_values:
            self.progress('complete')
            return
        net = futures.ThreadPoolExecutor(max_workers=self.args.download_workers)
        uploads = futures.ThreadPoolExecutor(max_workers=self.args.upload_workers)
        cpu = futures.ProcessPoolExecutor(max_workers=self.args.workers, initializer=initialize_worker,
            mp_context=multiprocessing.get_context('spawn'))
        previous_z = None
        try:
            for z in z_values:
                cores = {c for c in self.core_coords if c[2] == z and c not in self.completed}
                if previous_z != z-1:
                    self.previous = {}
                    # Resume/start requires only a single preceding layer once.
                    needed_previous = self.by_z.get(z-1, set())
                    for c, a, record in net.map(self.obtain_previous_tail, sorted(needed_previous)):
                        self.previous[c] = a
                        self.record_source(record)
                self.current = {}
                self.current_decoded.clear()
                self.current_tails = {}
                self.current_uses = {c:sum((c[0]+dx,c[1]+dy,z) in cores
                    for dy in (-1,0,1) for dx in (-1,0,1)) for c in self.by_z.get(z,set())}
                self.following = {}
                for c, a, record in net.map(lambda c: self.obtain(c, False, True), sorted(self.by_z.get(z, set()))):
                    self.current[c] = a
                    self.record_source(record)
                for c, uses in self.current_uses.items():
                    if uses == 0:
                        self.retire_current(c)
                trim_allocator()
                next_coords = self.by_z.get(z+1, set())
                downloading = {net.submit(self.obtain, c, True): c for c in sorted(next_coords)}
                pending = set(cores)
                processing = {}
                uploading = {}
                dependencies = {c: {(c[0]+dx, c[1]+dy, z+1) for dy in (-1,0,1) for dx in (-1,0,1)} & next_coords for c in cores}
                last_report = 0.
                self.progress('reconstructing', z)
                while downloading or pending or processing or uploading:
                    all_jobs = set(downloading) | set(processing) | set(uploading)
                    done = futures.wait(all_jobs, timeout=.1, return_when=futures.FIRST_COMPLETED).done if all_jobs else set()
                    for job in done:
                        if job in downloading:
                            del downloading[job]
                            c, a, record = job.result()
                            self.following[c] = a
                            self.record_source(record)
                        elif job in uploading:
                            c = uploading.pop(job)
                            self.checkpoint_result(c,job.result())
                        else:
                            c = processing.pop(job)
                            result = job.result()
                            if result.get('needsSource'):
                                for needed in result['needsSource']:
                                    needed = tuple(needed)
                                    if needed not in self.extra:
                                        _, values, record = self.obtain(needed, False)
                                        self.extra[needed] = values
                                        self.record_source(record)
                                pending.add(c)
                                continue
                            if self.uploader is not None and not result.get('empty',False):
                                uploading[uploads.submit(self.store_result,c,result)] = c
                            else:
                                self.checkpoint_result(c,result)
                    ready = [c for c in pending if dependencies[c] <= self.following.keys()]
                    room = max(0,self.args.workers*2-len(processing)) if len(uploading)<2*self.args.upload_workers else 0
                    for c in sorted(ready)[:room]:
                        if shutil.disk_usage(self.root).free < self.args.reserve_mib * 1024**2:
                            raise RuntimeError('Checkpoint preserved: output storage reserve reached')
                        raw, valid = self.assemble(c)
                        task = cpu.submit(work_tile, raw, valid, c, self.halo, str(self.output), self.config)
                        processing[task] = c
                        pending.remove(c)
                    now = time.monotonic()
                    if now - last_report > 15:
                        self.progress('reconstructing', z)
                        last_report = now
                self.previous.clear()
                self.following.clear()
                for c in list(self.current):
                    self.retire_current(c)
                self.previous = self.current_tails
                self.current_tails = {}
                previous_z = z
                self.current.clear()
                self.current_decoded.clear()
                self.following.clear()
                self.extra.clear()
                atomic_json(self.root / 'layers' / f'{z:03}.json', dict(z=z, complete=True,
                    fingerprint=self.fingerprint, coreBlocks=len(cores)))
            if len(self.completed) != len(self.core_coords):
                raise RuntimeError('Coverage incomplete after all scheduled layers')
            self.progress('complete')
        except BaseException as error:
            self.progress('paused', error=str(error))
            raise
        finally:
            self.stopping.set()
            net.shutdown(wait=True, cancel_futures=True)
            cpu.shutdown(wait=True, cancel_futures=True)
            uploads.shutdown(wait=True,cancel_futures=True)
            self.source.close()
            if self.uploader is not None:
                self.uploader.close()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--plan', type=Path, required=True)
    p.add_argument('--core-plan', type=Path)
    p.add_argument('--config', type=Path, required=True)
    p.add_argument('--work', type=Path, required=True)
    p.add_argument('--workers', type=int, default=4)
    p.add_argument('--download-workers', type=int, default=64)
    p.add_argument('--reserve-mib', type=int, default=512)
    p.add_argument('--decoded-cache-blocks',type=int,default=32)
    p.add_argument('--upload',action='store_true',help='Read hidden collection credentials and verify native storage before local eviction')
    p.add_argument('--upload-workers',type=int,default=32)
    p.add_argument('--cached-source', type=Path, action='append', default=[
        Path('/workspace/data/native-surface-v20/chunks-s0'),
        Path('/workspace/data/guided-native-v21/network-pilot')])
    a = p.parse_args()
    if not 1 <= a.workers <= 8 or not 1 <= a.download_workers <= 64:
        p.error('Use 1–8 processing workers and 1–64 network workers')
    if not 1 <= a.decoded_cache_blocks <= 64:
        p.error('Use a decoded source cache of 1–64 blocks')
    if not 1 <= a.upload_workers <= 64:
        p.error('Use 1–64 verified concurrent uploads')
    # Operating guard only: it does not change the scientific fingerprint.
    # The kernel releases flock on every exit, including a crash. Keep the same
    # lock-file inode so a later process cannot bypass a held lock by recreation.
    a.work.mkdir(parents=True, exist_ok=True)
    with (a.work / 'runner.lock').open('a+') as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            p.error('Another native reconstruction worker owns this work directory; do not start a duplicate.')
        lock.seek(0)
        lock.truncate()
        lock.write(json.dumps(dict(pid=os.getpid(), startedAtUnix=time.time(),
            work=str(a.work.resolve()), plan=str(a.plan.resolve()))) + '\n')
        lock.flush()
        RollingRun(a).run()


if __name__ == '__main__':
    main()
