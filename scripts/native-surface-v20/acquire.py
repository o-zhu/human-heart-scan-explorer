#!/usr/bin/env python3
"""Bounded, resumable acquisition of original LADAF-2021-17 s0 N5 voxels.

Original Blosc/Zstd blocks and individually gzip-compressed little-endian uint16
Z slices are both retained and SHA256 checked. No intensity conversion, support
mask, resampling or source smoothing is applied. At most one 128-plane slab is
assembled. This tool deliberately has a download ceiling and no whole-heart mode.
"""
import argparse
import concurrent.futures
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import struct
import threading
import time
import urllib.request

import blosc2
import numpy as np

SOURCE = 'https://storage.googleapis.com/ucl-hip-ct-35a68e99feaae8932b1d44da0358940b/LADAF-2021-17/heart/19.85um_complete-organ_bm18/'
SHAPE_XYZ = (7614, 7614, 8480)
BLOCK = 128
SPACING_UM = 19.85


def sha(data):
    return hashlib.sha256(data).hexdigest()


def atomic(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.part')
    temporary.write_bytes(data)
    os.replace(temporary, path)


def dump(path, data):
    atomic(path, (json.dumps(data, indent=2) + '\n').encode())


def decode(payload):
    if len(payload) < 16:
        raise ValueError('Incomplete N5 header')
    mode, ndim = struct.unpack('>HH', payload[:4])
    if (mode, ndim) != (0, 3):
        raise ValueError(f'Unexpected N5 block header: {mode}, {ndim}')
    dims = struct.unpack('>III', payload[4:16])
    raw = blosc2.decompress(payload[16:])
    if len(raw) != math.prod(dims) * 2:
        raise ValueError('Decoded N5 byte count does not match block dimensions')
    return np.frombuffer(raw, dtype='>u2').reshape(dims[::-1])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-root', type=Path, required=True)
    parser.add_argument('--origin', type=int, nargs=3, required=True, metavar=('X', 'Y', 'Z'))
    parser.add_argument('--shape', type=int, nargs=3, default=(128, 128, 128), metavar=('X', 'Y', 'Z'))
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--max-download-mib', type=float, default=300)
    parser.add_argument('--docs-path', type=Path)
    args = parser.parse_args()
    origin, shape = np.array(args.origin), np.array(args.shape)
    if np.any(origin < 0) or np.any(shape < 2) or np.any(origin + shape > SHAPE_XYZ):
        parser.error('ROI outside source bounds or smaller than two samples')
    if math.prod(shape.tolist()) * 2 > 512 * 1024**2:
        parser.error('ROI exceeds the explicit 512 MiB raw acquisition bound')
    root = args.data_root
    root.mkdir(parents=True, exist_ok=True)
    cache = root / 'chunks-s0'
    cache.mkdir(exist_ok=True)
    manifest_path = root / 'source-ready.json'
    source_metadata = []
    for name in ('attributes.json', 's0/attributes.json'):
        path = root / ('source-' + name.replace('/', '-'))
        if not path.exists():
            with urllib.request.urlopen(SOURCE + name, timeout=45) as response:
                atomic(path, response.read())
        content = path.read_bytes()
        metadata = json.loads(content)
        if name == 'attributes.json' and metadata.get('resolution') != [19.85]*3:
            raise ValueError('Source spacing changed')
        if name == 's0/attributes.json' and (metadata.get('dimensions') != list(SHAPE_XYZ) or metadata.get('dataType') != 'uint16' or metadata.get('blockSize') != [128]*3):
            raise ValueError('Source geometry, dtype or chunk shape changed')
        source_metadata.append({'url': SOURCE + name, 'path': str(path.resolve()), 'sha256': sha(content), 'metadata': metadata})
    chunks = [(x,y,z) for z in range(origin[2]//BLOCK, (origin[2]+shape[2]-1)//BLOCK+1)
              for y in range(origin[1]//BLOCK, (origin[1]+shape[1]-1)//BLOCK+1)
              for x in range(origin[0]//BLOCK, (origin[0]+shape[0]-1)//BLOCK+1)]
    # Reserve the full raw byte size per in-flight network request. This is an
    # upper bound for ordinary incompressible uint16 blocks plus codec overhead.
    max_download = int(args.max_download_mib * 1024**2)
    accounting = {'downloaded': 0, 'reserved': 0}
    lock = threading.Lock()
    started = time.monotonic()
    blosc2.set_nthreads(1)

    def obtain(coords):
        path = cache / ('_'.join(map(str, coords)) + '.n5')
        sidecar = path.with_suffix('.json')
        cached = path.exists()
        if cached:
            payload = path.read_bytes()
            if sidecar.exists() and json.loads(sidecar.read_text())['sha256'] != sha(payload):
                raise ValueError(f'Cached block checksum mismatch: {path}')
        else:
            reservation = BLOCK**3*2 + 65536
            with lock:
                if accounting['downloaded'] + accounting['reserved'] + reservation > max_download:
                    raise RuntimeError('Explicit maximum download budget reached')
                accounting['reserved'] += reservation
            try:
                for attempt in range(3):
                    try:
                        with urllib.request.urlopen(SOURCE + 's0/' + '/'.join(map(str,coords)), timeout=45) as response:
                            payload = response.read(reservation + 1)
                        if len(payload) > reservation:
                            raise RuntimeError('Unexpected source block size exceeds reserved budget')
                        decode(payload)
                        atomic(path, payload)
                        break
                    except Exception:
                        if attempt == 2:
                            raise
                with lock:
                    accounting['downloaded'] += len(payload)
            finally:
                with lock:
                    accounting['reserved'] -= reservation
        block = decode(payload)
        record = {'coordinatesXYZ': list(map(int,coords)), 'url': SOURCE + 's0/' + '/'.join(map(str,coords)), 'path': str(path.resolve()), 'bytes': len(payload), 'sha256': sha(payload), 'shapeZYX': list(block.shape), 'sourceDataType': 'uint16-big-endian', 'cached': cached}
        dump(sidecar, record)
        print(json.dumps({'event':'block','xyz':record['coordinatesXYZ'],'bytes':len(payload),'cached':cached}), flush=True)
        return record

    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1,min(args.workers,8))) as pool:
        records = list(pool.map(obtain, chunks))
    record_map = {tuple(r['coordinatesXYZ']): r for r in records}
    slices = []
    # Slabs align to original N5 z blocks; never assemble the complete ROI.
    for cz in sorted({c[2] for c in chunks}):
        z0 = max(int(origin[2]), cz*BLOCK)
        z1 = min(int(origin[2]+shape[2]), (cz+1)*BLOCK)
        slab = np.empty((z1-z0, int(shape[1]), int(shape[0])), dtype='<u2')
        for cx,cy,zz in chunks:
            if zz != cz:
                continue
            block = decode(Path(record_map[(cx,cy,cz)]['path']).read_bytes())
            x0=max(int(origin[0]),cx*BLOCK);x1=min(int(origin[0]+shape[0]),cx*BLOCK+block.shape[2])
            y0=max(int(origin[1]),cy*BLOCK);y1=min(int(origin[1]+shape[1]),cy*BLOCK+block.shape[1])
            slab[:,y0-origin[1]:y1-origin[1],x0-origin[0]:x1-origin[0]] = block[z0-cz*BLOCK:z1-cz*BLOCK,y0-cy*BLOCK:y1-cy*BLOCK,x0-cx*BLOCK:x1-cx*BLOCK]
        for k in range(slab.shape[0]):
            global_z=z0+k
            raw=slab[k].tobytes(order='C')
            encoded=gzip.compress(raw,compresslevel=6,mtime=0)
            path=root/'slices'/f'z{global_z:05d}.u16.gz'
            if path.exists():
                existing=path.read_bytes()
                if gzip.decompress(existing) != raw:
                    raise ValueError(f'Existing lossless slice differs from source: {path}')
                encoded=existing
            else:
                atomic(path,encoded)
            # Verify both representation and physical slice mapping.
            if gzip.decompress(encoded) != raw:
                raise ValueError('Slice lossless round-trip failed')
            slices.append({'zIndex':global_z,'path':str(path.resolve()),'bytes':len(encoded),'rawBytes':len(raw),'sha256':sha(encoded),'rawSha256':sha(raw)})
        print(json.dumps({'event':'slice-slab','zRangeHalfOpen':[z0,z1],'slicesVerified':len(slices)}),flush=True)
    manifest={'schema':'native-surface-source-v20.1','donor':'LADAF-2021-17','sourceUrl':SOURCE,'sourceLevel':'s0','sourceSpacingUm':SPACING_UM,'sourceDimensionsXYZ':list(SHAPE_XYZ),'roiOriginXYZ':origin.tolist(),'shapeZYX':shape[::-1].tolist(),'roiBoundsXYZHalfOpen':[origin.tolist(),(origin+shape).tolist()],'voxelCenterSpanMm':((shape-1)*SPACING_UM/1000).tolist(),'encoding':'gzip-little-endian-uint16-zyx','originalValuesPreserved':True,'resampled':False,'sourceMetadata':source_metadata,'chunks':records,'slices':slices,'rawBytes':int(math.prod(shape.tolist())*2),'encodedSliceBytes':sum(r['bytes'] for r in slices),'encodedChunkBytes':sum(r['bytes'] for r in records),'networkDownloadedBytes':accounting['downloaded'],'maximumSlabBytes':min(int(shape[2]),BLOCK)*int(shape[1])*int(shape[0])*2,'elapsedSeconds':time.monotonic()-started,'nativeToOverviewIndexFactor':16,'registrationCaveat':'Existing viewer uses endpoint-aligned scale indices. A subvoxel center translation between N5 scale levels has not been independently established. Native ROI has exact original s0 integer indices.','thresholdComparison':{'normalizedThreshold':0.28,'sourceWindow':[14640,23545],'rawThreshold':17133.4,'independentOfDisplayWindow':True}}
    dump(manifest_path,manifest)
    if args.docs_path:
        dump(args.docs_path,manifest)
    print(json.dumps({'event':'complete','manifest':str(manifest_path.resolve()),'rawBytes':manifest['rawBytes'],'sliceBytes':manifest['encodedSliceBytes'],'downloadedBytes':accounting['downloaded'],'seconds':manifest['elapsedSeconds']}),flush=True)


if __name__ == '__main__':
    main()
