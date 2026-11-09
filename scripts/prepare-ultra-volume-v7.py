"""Prepare sparse, lossless 79.4 um display-density bricks and default probe cuts.

The one-voxel positive halo gives every trilinear sample its eight original
neighbors without a second brick request. Zero bricks are implicit. Source
intensities are the existing cleaned/windowed uint8 display values, not new
segmentation, extrapolation, or quantitative raw acquisition values.
"""
import argparse
import concurrent.futures
import gzip
import hashlib
import json
import math
import pathlib
import time
import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates

ROOT = pathlib.Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--cache', type=pathlib.Path, default=pathlib.Path('/workspace/data/heart-atlas-cache'))
p.add_argument('--workers', type=int, default=8)
p.add_argument('--skip-bricks', action='store_true')
args = p.parse_args()
meta = json.loads((args.cache / 's2-clean-display.json').read_text())
volume = np.load(args.cache / 's2-clean-display-u8.npy', mmap_mode='r')
origin = np.asarray(meta['originXYZ'], dtype=float)
full = np.asarray(meta['identity']['fullXYZ'], dtype=int)
shape = np.asarray(meta['shapeXYZ'], dtype=int)
assert tuple(shape[::-1]) == volume.shape and volume.dtype == np.uint8
longest = int(max(full - 1))
spacing = 79.4
brick = 64
edge = brick + 1
counts = np.ceil(shape / brick).astype(int)
out = ROOT / 'data/ultra-volume-v7'
out.mkdir(parents=True, exist_ok=True)
sha = lambda data: hashlib.sha256(data).hexdigest()


def make_brick(position):
    bx, by, bz = position
    x, y, z = bx * brick, by * brick, bz * brick
    source = volume[z:z+edge, y:y+edge, x:x+edge]
    if not source.any():
        return None
    data = np.zeros((edge, edge, edge), np.uint8)
    data[:source.shape[0], :source.shape[1], :source.shape[2]] = source
    raw = data.tobytes()
    encoded = gzip.compress(raw, compresslevel=3, mtime=0)
    path = f'{bz:02d}/{by:02d}/{bx:02d}.gz'
    target = out / path
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists() or target.read_bytes() != encoded:
        target.write_bytes(encoded)
    ident = int(bx + counts[0] * (by + counts[1] * bz))
    return str(ident), dict(path=path, bytes=len(encoded), sha256=sha(encoded), rawSha256=sha(raw))


manifest_path = ROOT / 'public/assets/ultra-volume-v7.json'
if not args.skip_bricks:
    start = time.monotonic()
    jobs = [(x, y, z) for z in range(counts[2]) for y in range(counts[1]) for x in range(counts[0])]
    entries = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        for i, result in enumerate(pool.map(make_brick, jobs), 1):
            if result:
                entries[result[0]] = result[1]
            if i % 750 == 0 or i == len(jobs):
                print(json.dumps({'processed': i, 'total': len(jobs), 'nonempty': len(entries), 'seconds': round(time.monotonic()-start, 1)}), flush=True)
    manifest = dict(schemaVersion=1, version='heart-ultra-volume-v7', sourceSpacingUm=spacing,
                    sourceOriginXYZ=meta['originXYZ'], sourceShapeXYZ=meta['shapeXYZ'], fullDimensionsXYZ=full.tolist(),
                    longestMm=longest*spacing/1000, extent=[(full[0]-1)/longest, (full[2]-1)/longest, (full[1]-1)/longest],
                    brickSize=brick, storedEdge=edge, brickCountsXYZ=counts.tolist(),
                    codec='gzip-u8-zyx-positive-halo', decodedBrickBytes=edge**3, emptyValue=0,
                    assetBaseUrl='/api/ultra-volume/v7/', source='s2-clean-display-u8.npy',
                    cleaned=True, quantitativeIntensityData=False, sourceWindow=meta['identity']['window'],
                    sourceMaskSha256=meta['identity']['maskSha256'],
                    totalEncodedBytes=sum(e['bytes'] for e in entries.values()), blocks=entries)
    manifest_path.write_text(json.dumps(manifest, separators=(',', ':'))+'\n')
    server = {entry['path']: {'bytes': entry['bytes'], 'sha256': entry['sha256']} for entry in entries.values()}
    (ROOT / 'server/ultra-volume-index-v7.json').write_text(json.dumps(server, separators=(',', ':'))+'\n')
    print(json.dumps({'bricks':len(entries), 'encodedBytes':manifest['totalEncodedBytes'], 'sourceBytes':int(volume.nbytes)}), flush=True)
else:
    manifest = json.loads(manifest_path.read_text())

# Cache exact default probe planes for a fast first comparison. Arbitrary planes
# are still sampled from bricks; these images are never substituted off-plane.
presets = json.loads((ROOT / 'docs/probe-v7-default-planes.json').read_text())['presets']
prepared = []
images = ROOT / 'public/assets/probe-ultra-v7'
images.mkdir(parents=True, exist_ok=True)
for name, preset in presets.items():
    plane = preset['plane']
    w = int(math.ceil(plane['width'] * longest)) + 1
    h = int(math.ceil(plane['height'] * longest)) + 1
    pixels = np.zeros((h, w), np.uint8)
    columns = np.linspace(-plane['width']/2, plane['width']/2, w)
    rows = np.linspace(plane['height']/2, -plane['height']/2, h)
    center, right, up = (np.asarray(plane[k], dtype=float) for k in ('center', 'right', 'up'))
    for start in range(0, h, 32):
        points = center[None,None,:] + columns[None,:,None]*right + rows[start:start+32,None,None]*up
        coords = np.stack((points[...,0]*longest+(full[0]-1)/2,
                           -points[...,2]*longest+(full[1]-1)/2,
                           points[...,1]*longest+(full[2]-1)/2), axis=-1)-origin
        pixels[start:start+32] = map_coordinates(volume, [coords[...,2],coords[...,1],coords[...,0]], order=1,mode='constant',cval=0,prefilter=False)
    target = images / f'{name}.webp'
    Image.fromarray(pixels).save(target, format='WEBP', lossless=True, quality=100, method=4)
    assert np.array_equal(np.asarray(Image.open(target).convert('L')), pixels)
    prepared.append(dict(id=name, plane=plane, width=w, height=h, sourceSpacingUm=spacing,
                         spacingUmXY=[plane['width']*manifest['longestMm']*1000/(w-1), plane['height']*manifest['longestMm']*1000/(h-1)],
                         url='./assets/probe-ultra-v7/'+name+'.webp', bytes=target.stat().st_size,
                         sha256=sha(target.read_bytes()), pixelSha256=sha(pixels.tobytes()), cleaned=True))
    print(json.dumps({'preset':name,'shape':[w,h],'bytes':target.stat().st_size}), flush=True)
manifest['preparedPlanes'] = prepared
manifest_path.write_text(json.dumps(manifest, separators=(',', ':'))+'\n')
summary = {k:manifest[k] for k in ['version','sourceSpacingUm','sourceShapeXYZ','brickSize','storedEdge','totalEncodedBytes','cleaned','quantitativeIntensityData']}
summary.update(nonemptyBrickCount=len(manifest['blocks']), implicitEmptyBrickCount=int(np.prod(counts))-len(manifest['blocks']),
               preparedPlaneCount=len(prepared), preparedEncodedBytes=sum(i['bytes'] for i in prepared),
               encoding='Lossless uint8 display-density bricks; no added or inferred image detail.')
(ROOT / 'docs/ultra-volume-v7-preparation.json').write_text(json.dumps(summary, indent=2)+'\n')
print(json.dumps(summary), flush=True)
