"""Fetch and losslessly decode the supported authentic HOA N5 s2 volume.

The existing conservative organ-support plan selects 832 public N5 bricks.
Each brick is cached unchanged and decoded into a sparse NumPy uint16 volume;
unfetched background bricks remain zero. No scan values are synthesized.
"""
from pathlib import Path
import argparse
import concurrent.futures
import hashlib
import json
import struct
import time
import urllib.request

import blosc2
import numpy as np

PROJECT = Path(__file__).resolve().parents[1]
SOURCE = ('https://storage.googleapis.com/'
          'ucl-hip-ct-35a68e99feaae8932b1d44da0358940b/'
          'LADAF-2021-17/heart/19.85um_complete-organ_bm18/')
DIMENSIONS = (1903, 1903, 2120)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-root', type=Path, required=True)
    parser.add_argument('--support', type=Path,
                        default=PROJECT/'public/assets/ultra-support.json')
    parser.add_argument('--workers', type=int, default=16)
    parser.add_argument('--prioritize-z', type=int, default=363)
    args = parser.parse_args()
    root = args.data_root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    cache = root/'chunks-s2'
    cache.mkdir(exist_ok=True)
    support = json.loads(args.support.read_text())
    keys = set(k for planes in support['slices'].values()
               for plane in planes for k in plane)
    first = set(support['slices']['z'][args.prioritize_z])
    keys = sorted(keys, key=lambda k: (k not in first, k))
    coords = [(k % 15, (k // 15) % 15, k // 225) for k in keys]
    destination = root/'s2-supported-u16.npy'
    mode = 'r+' if destination.exists() else 'w+'
    volume = np.lib.format.open_memmap(destination, mode=mode,
                                      dtype=np.uint16,
                                      shape=DIMENSIONS[::-1])
    records_path = root/'s2-download-results.json'
    records = []
    started = time.monotonic()
    blosc2.set_nthreads(1)

    def fetch_decode(coord):
        x, y, z = coord
        path = cache/f'{x}_{y}_{z}.n5'
        hit = path.exists()
        for attempt in range(5):
            try:
                if path.exists():
                    payload = path.read_bytes()
                else:
                    with urllib.request.urlopen(SOURCE+f's2/{x}/{y}/{z}',
                                                timeout=60) as response:
                        payload = response.read()
                    temporary = path.with_suffix('.tmp')
                    temporary.write_bytes(payload)
                    temporary.replace(path)
                mode, ndim = struct.unpack('>HH', payload[:4])
                assert mode == 0 and ndim == 3, (coord, mode, ndim)
                dims = struct.unpack('>III', payload[4:16])
                raw = blosc2.decompress(payload[16:])
                assert len(raw) == int(np.prod(dims))*2, (coord, dims)
                decoded = np.frombuffer(raw, dtype='>u2').reshape(dims[::-1])
                dx, dy, dz = [min(b, n-i*128) for b, n, i in
                              zip(dims, DIMENSIONS, coord)]
                volume[z*128:z*128+dz, y*128:y*128+dy, x*128:x*128+dx] = decoded[:dz,:dy,:dx]
                return {'coord':coord, 'bytes':len(payload),
                        'sha256':hashlib.sha256(payload).hexdigest(),
                        'dimensionsXYZ':dims, 'cached':hit}
            except Exception as error:
                if attempt == 4:
                    return {'coord':coord, 'bytes':0, 'error':str(error)}
                time.sleep(min(2**attempt, 4))

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(fetch_decode, coord) for coord in coords]
        for future in concurrent.futures.as_completed(futures):
            result = future.result()
            records.append(result)
            if len(records) % 32 == 0 or result['bytes'] == 0:
                records_path.write_text(json.dumps(records, indent=2)+'\n')
                print(f"{len(records)}/{len(coords)} chunks; "
                      f"{sum(r['bytes'] for r in records)/1e6:.1f} MB; "
                      f"{time.monotonic()-started:.1f}s", flush=True)
    volume.flush()
    records_path.write_text(json.dumps(records, indent=2)+'\n')
    failures = [r for r in records if not r['bytes']]
    summary = {
        'sourceHttp':SOURCE, 'sourceScale':'s2',
        'dimensionsXYZ':DIMENSIONS, 'dtype':'uint16',
        'arrayOrder':'ZYX; X fastest', 'spacingUm':79.4,
        'supportPlan':str(args.support.resolve()),
        'chunks':len(records), 'failedChunks':failures,
        'compressedBytes':sum(r['bytes'] for r in records),
        'elapsedSeconds':round(time.monotonic()-started, 2),
        'unfetchedBackgroundValue':0,
    }
    (root/'s2-supported-volume.json').write_text(json.dumps(summary, indent=2)+'\n')
    print(json.dumps(summary), flush=True)
    if failures:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
