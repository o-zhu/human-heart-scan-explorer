#!/usr/bin/env python3
"""Read bounded, hash-verified source planes and compare fine-mesh sections.

Input is the existing cleaned display bank, not calibrated HU. All coordinates
are full fine-source XYZ at 79.4 um. No published data or geometry is changed.
"""
from pathlib import Path
import argparse
from functools import lru_cache
import gzip
import hashlib
import json
import struct
import numpy as np
from scipy.ndimage import gaussian_filter
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.collections import LineCollection

ROOT = Path(__file__).resolve().parents[2]


class Reader:
    def __init__(self):
        self.manifest_path = ROOT / 'public/assets/ultra-volume-v7.json'
        self.meta = json.loads(self.manifest_path.read_text())
        self.origin = np.array(self.meta['sourceOriginXYZ'])
        self.shape = np.array(self.meta['sourceShapeXYZ'])
        self.counts = self.meta['brickCountsXYZ']
        self.loaded = set()

    @lru_cache(maxsize=12)
    def block(self, bx, by, bz):
        key = str(bx + self.counts[0] * (by + self.counts[1] * bz))
        item = self.meta['blocks'].get(key)
        if item is None:
            return None
        blob = (ROOT / 'data/ultra-volume-v7' / item['path']).read_bytes()
        assert hashlib.sha256(blob).hexdigest() == item['sha256']
        raw = gzip.decompress(blob)
        assert hashlib.sha256(raw).hexdigest() == item['rawSha256']
        self.loaded.add(key)
        return np.frombuffer(raw, dtype=np.uint8).reshape(65, 65, 65)

    def read(self, lo, hi):
        lo, hi = np.array(lo, dtype=int), np.array(hi, dtype=int)
        assert np.all(hi > lo)
        out = np.zeros(tuple((hi - lo)[::-1]), np.uint8)
        a, b = np.maximum(lo - self.origin, 0), np.minimum(hi - self.origin, self.shape)
        for bz in range(a[2] // 64, (b[2] + 63) // 64):
            for by in range(a[1] // 64, (b[1] + 63) // 64):
                for bx in range(a[0] // 64, (b[0] + 63) // 64):
                    block = self.block(bx, by, bz)
                    if block is None:
                        continue
                    base = np.array([bx, by, bz]) * 64
                    start, end = np.maximum(a, base), np.minimum(b, base + 64)
                    src = [slice(int(s), int(e)) for s, e in zip(start - base, end - base)]
                    dst = [slice(int(s), int(e)) for s, e in zip(start + self.origin - lo, end + self.origin - lo)]
                    out[tuple(dst[::-1])] = block[tuple(src[::-1])]
        return out


def mesh_points(lod, meta):
    manifest = json.loads((ROOT / 'public/assets/fine-surface-v19/manifest.json').read_text())
    item = next(i for i in manifest['lods'] if i['id'] == lod)
    raw = gzip.decompress((ROOT / 'public' / item['url'].lstrip('/')).read_bytes())
    assert hashlib.sha256(raw).hexdigest() == item['decodedSha256']
    _, _, nv, ni, po, no, io, _ = struct.unpack_from('<8I', raw)
    q = np.frombuffer(raw, '<u2', nv * 3, po).reshape(-1, 3)
    b = item.get('bounds', manifest['bounds'])
    p = np.array(b['min']) + q.astype(np.float64) / 65535 * (np.array(b['max']) - b['min'])
    scan = p[:, [0, 2, 1]] * [1, -1, 1] * meta['longestMm']
    xyz = scan / (meta['sourceSpacingUm'] / 1000) + (np.array(meta['fullDimensionsXYZ']) - 1) / 2
    f = np.frombuffer(raw, '<u4', ni, io).reshape(-1, 3).copy()
    return xyz, f, item


def plane_intersections(points, faces, axis, coordinate, shown_axes, limits):
    pv = points[:, axis]
    fvals = pv[faces]
    selected = faces[(fvals.min(axis=1) <= coordinate) & (fvals.max(axis=1) > coordinate)]
    triangles = points[selected]
    hits = []
    for tri in triangles:
        intersections = []
        for a, b in ((0, 1), (1, 2), (2, 0)):
            t1, t2 = tri[a], tri[b]
            if (t1[axis] <= coordinate < t2[axis]) or (t2[axis] <= coordinate < t1[axis]):
                t = (coordinate - t1[axis]) / (t2[axis] - t1[axis])
                intersections.append((t1 + t * (t2 - t1))[shown_axes])
        if len(intersections) == 2:
            xy = np.array(intersections)
            if np.all(xy.max(axis=0) >= np.array(limits)[:, 0]) and np.all(xy.min(axis=0) <= np.array(limits)[:, 1]):
                hits.append(xy)
    return np.array(hits)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, default=ROOT / 'docs/lumen-artifacts-v23')
    args = parser.parse_args(); args.out.mkdir(parents=True, exist_ok=True)
    r = Reader()
    # Each read includes only a six-voxel halo about one diagnostic section.
    cases = [
        dict(id='atrial-candidate', axis=1, coordinates=[1144, 1184, 1224], limits=[[1120, 1460], [500, 1100]], shown=[0, 2]),
        dict(id='outflow-candidate', axis=0, coordinates=[940, 980, 1020], limits=[[900, 1440], [240, 840]], shown=[1, 2]),
    ]
    meshes = [mesh_points(lod, r.meta) for lod in ['balanced', 'detail']]
    reports = []
    for case in cases:
        fig, axes = plt.subplots(3, 3, figsize=(12, 14), constrained_layout=True)
        for col, coordinate in enumerate(case['coordinates']):
            lo = np.zeros(3, dtype=int); hi = np.zeros(3, dtype=int)
            for axis, limit in zip(case['shown'], case['limits']):
                lo[axis], hi[axis] = limit
            lo[case['axis']], hi[case['axis']] = coordinate - 3, coordinate + 4
            slab = r.read(lo, hi)
            filtered = gaussian_filter(slab.astype(np.float32), .8, truncate=3)
            plane = np.take(slab, 3, axis=2-case['axis'])
            smoothed_plane = np.take(filtered, 3, axis=2-case['axis'])
            extent = [case['limits'][0][0], case['limits'][0][1], case['limits'][1][1], case['limits'][1][0]]
            for row in range(3):
                ax = axes[row, col]
                ax.imshow(plane, cmap='gray', vmin=0, vmax=255, extent=extent, interpolation='nearest')
                ax.set_xlim(*case['limits'][0]); ax.set_ylim(*case['limits'][1][::-1])
                ax.set_xlabel(f"Source {'xyz'[case['shown'][0]]} (79.4 µm voxels)")
                ax.set_ylabel('Source z (79.4 µm voxels)')
                if row == 0:
                    ax.set_title(f"Measured display field · {'XYZ'[case['axis']]}={coordinate}")
                    ax.contour(np.arange(lo[case['shown'][0]], hi[case['shown'][0]]), np.arange(lo[2], hi[2]), smoothed_plane, levels=[.28*255], colors=['#70cf84'], linewidths=.55)
                else:
                    points, faces, item = meshes[row-1]
                    segments = plane_intersections(points, faces, case['axis'], coordinate, case['shown'], case['limits'])
                    ax.add_collection(LineCollection(segments, colors='#ed9b80', linewidths=.5))
                    ax.set_title(f"{item['id'].capitalize()} mesh section (coral)")
            reports.append(dict(region=case['id'], axis='xyz'[case['axis']], coordinate=int(coordinate), boundsFullFineXYZ=[lo.tolist(), hi.tolist()], voxels=int(slab.size), maximum=int(plane.max()), median=float(np.median(plane)), aboveThreshold=int((smoothed_plane >= .28*255).sum())))
        fig.suptitle(f"{case['id'].replace('-', ' ').title()} — source and existing 79.4 µm mesh\nGreen: original v19 σ0.8 scalar isocontour at 0.28. Coral: shipped mesh/plane intersections. These are measured display units, not HU.", fontsize=11)
        fig.savefig(args.out / (case['id'] + '-fine-sections.png'), dpi=145)
        plt.close(fig)
    (args.out / 'fine-section-diagnostics.json').write_text(json.dumps(dict(sourceManifestSha256=hashlib.sha256(r.manifest_path.read_bytes()).hexdigest(), verifiedBricks=len(r.loaded), sections=reports, scope='Source intensity and mesh correspondence only; material identity and artifact status remain unverified.'), indent=2) + '\n')


if __name__ == '__main__':
    main()
