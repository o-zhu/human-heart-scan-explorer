#!/usr/bin/env python3
"""Retrieve and decode the exact HOA complete-heart N5 s4 volume.

Source: dataset 1659197537, DOI 10.15151/ESRF-DC-1634390196.
No credentials are required for this public Google Cloud Storage mirror.
Run before prepare-volume.py. Cache downloads are resumable.
"""
import argparse
import concurrent.futures
import hashlib
import json
import pathlib
import struct
import time
import urllib.request

import blosc2
import numpy as np

BASE = 'https://storage.googleapis.com/ucl-hip-ct-35a68e99feaae8932b1d44da0358940b/LADAF-2021-17/heart/19.85um_complete-organ_bm18/'
EXPECTED_DIMS = [475, 475, 530]


def download(url, path):
    if path.exists() and path.stat().st_size > 16:
        return path
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=35) as response:
                data = response.read()
            partial = path.with_suffix(path.suffix + '.part')
            partial.write_bytes(data)
            partial.replace(path)
            return path
        except Exception:
            if attempt == 2:
                raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=pathlib.Path, default=pathlib.Path('.cache/hoa-heart'))
    parser.add_argument('--workers', type=int, default=12)
    args = parser.parse_args()
    root = args.cache.resolve()
    chunks = root / 'chunks'
    chunks.mkdir(parents=True, exist_ok=True)

    download(BASE + 'attributes.json', root / 'n5-attributes.json')
    download(BASE + 's4/attributes.json', root / 's4_attributes.json')
    attrs = json.loads((root / 's4_attributes.json').read_text())
    if attrs['dimensions'] != EXPECTED_DIMS or attrs['dataType'] != 'uint16' or attrs['blockSize'] != [128, 128, 128] or attrs['compression']['type'] != 'blosc':
        raise ValueError(f'Public mirror metadata changed; inspect before proceeding: {attrs}')

    coords = [(x, y, z) for z in range(5) for y in range(4) for x in range(4)]

    def fetch(coord):
        x, y, z = coord
        return download(BASE + f's4/{x}/{y}/{z}', chunks / f'{x}_{y}_{z}.bin')

    started = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(24, args.workers))) as pool:
        jobs = [pool.submit(fetch, coord) for coord in coords]
        for index, job in enumerate(concurrent.futures.as_completed(jobs), start=1):
            path = job.result()
            print(f'{index}/80 chunks: {path.name} ({time.monotonic()-started:.1f}s)', flush=True)

    nx, ny, nz = EXPECTED_DIMS
    volume = np.lib.format.open_memmap(root / 's4-volume-u16.npy', mode='w+', dtype=np.uint16, shape=(nz, ny, nx))
    provenance = []
    for x, y, z in coords:
        path = chunks / f'{x}_{y}_{z}.bin'
        payload = path.read_bytes()
        mode, ndims = struct.unpack('>HH', payload[:4])
        if mode != 0 or ndims != 3:
            raise ValueError(f'Unsupported N5 chunk header: {path}')
        dims = struct.unpack('>III', payload[4:16])
        raw = blosc2.decompress(payload[16:])
        if len(raw) != int(np.prod(dims)) * 2:
            raise ValueError(f'Decompressed chunk length mismatch: {path}')
        # N5 primitive uint16 values use big-endian encoding. X is fastest.
        chunk = np.frombuffer(raw, dtype='>u2').reshape(dims[::-1])
        # This producer pads boundary blocks to 128^3. Trim only padding beyond
        # the exact dimensions declared by the source's s4/attributes.json.
        dx, dy, dz = min(dims[0], nx-x*128), min(dims[1], ny-y*128), min(dims[2], nz-z*128)
        volume[z*128:z*128+dz, y*128:y*128+dy, x*128:x*128+dx] = chunk[:dz, :dy, :dx]
        provenance.append({'path': path.name, 'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest(), 'dimensionsXYZ': list(dims)})
    volume.flush()
    (root / 's4-chunk-provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
    print(f'Ready: {root / "s4-volume-u16.npy"}; ZYX shape {volume.shape}, uint16, 317.6 µm spacing.', flush=True)


if __name__ == '__main__':
    main()
