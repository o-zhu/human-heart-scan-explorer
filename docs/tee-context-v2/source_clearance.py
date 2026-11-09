#!/usr/bin/env python3
"""Check authored context against a coarse *source-heart* envelope.

These are numerical distances between an illustrative organ and a thresholded
source envelope, not anatomical measurements of this donor's missing organs.
The source files are only read. Use the same /tmp fixture as render_review.py.
"""
from pathlib import Path
import argparse
import gzip
import hashlib
import json
import numpy as np
from scipy.ndimage import distance_transform_edt, map_coordinates, gaussian_filter
from scipy.interpolate import LinearNDInterpolator
from skimage.measure import marching_cubes

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--data', default='{temporary-cache}')
args = parser.parse_args()
data = Path(args.data)
model = json.loads((data / 'model.json').read_text())
manifest = json.loads((ROOT / 'public/assets/manifest.json').read_text())
level = manifest['levels']['low']
part = level['parts'][0]
compressed = (ROOT / 'public' / part['url']).read_bytes()
assert hashlib.sha256(compressed).hexdigest() == part['sha256']
volume = np.frombuffer(gzip.decompress(compressed), np.uint8).reshape(level['dimensions'][::-1])
if part.get('predictor') == 'delta-z':
    volume = np.cumsum(volume, axis=0, dtype=np.uint8)
extent = np.array(level['physicalCenterExtentUm']) / 1000
span = np.array(level['dimensions']) - 1
spacing = extent / span
distance = distance_transform_edt(volume < 72, sampling=spacing[::-1])


def coordinates(world):
    return (world[:, [0, 2, 1]] * np.array([1, -1, 1]) / extent + .5) * span


def sample(points):
    q = coordinates(points)
    inside = np.logical_and(q >= 0, q <= span).all(axis=1)
    values = map_coordinates(distance, q[:, ::-1].T, order=1, mode='constant', cval=999)
    return values, inside


centers = np.array([s['pointMm'] for s in model['tractSamples'] if s['level'] in ['ue', 'me', 'le', 'junction']])
center_distances, center_inside = sample(centers)
wall = np.fromfile(data / 'esophagus.f32', np.float32).reshape(-1, 6)[:, :3]
wall_distances, wall_inside = sample(wall)

# Sample the actually generated diaphragm, rather than repeating its formula.
frame = model['frame']
matrix = np.array([frame['left'], frame['superior'], frame['anterior']]).T
origin = np.array(frame['originMm'])
dia = np.unique(np.fromfile(data / 'diaphragm.f32', np.float32).reshape(-1, 6)[:, :3], axis=0)
local_dia = (dia - origin) @ matrix / frame['scale']
height = LinearNDInterpolator(local_dia[:, [0, 2]], local_dia[:, 1])
v, _, _, _ = marching_cubes(gaussian_filter(volume.astype(np.float32), .65), 71.4, step_size=3, allow_degenerate=False)
v = (v[:, ::-1] / span - .5) * extent
world = v[:, [0, 2, 1]] * np.array([1, 1, -1])
local = (world - origin) @ matrix / frame['scale']
gap = local[:, 1] - height(local[:, [0, 2]])
hiatus = ((local[:, 0]-12)/9.2)**2 + ((local[:, 2]+29)/7.6)**2 <= 1
gap[hiatus] = np.nan

report = dict(
    scope='Numerical clearance between authored illustrative context and a coarse thresholded source-heart envelope; not donor anatomy, patient registration or clinical collision validation.',
    source=part['url'], compressedSourceSha256=part['sha256'],
    sourceSpacingMmXYZ=spacing.tolist(), tissueThresholdByte=72,
    centerlineMinimumSampledDistanceMm=float(center_distances[center_inside].min()),
    esophagealWallMinimumSampledDistanceMm=float(wall_distances[wall_inside].min()),
    esophagealExpandedVerticesWithin03mmOfCoarseTissue=int(np.count_nonzero(wall_distances < .3)),
    esophagealExpandedVertices=int(len(wall)),
    diaphragmMinimumVerticalGapToCoarseEnvelopeMm=float(np.nanmin(gap) * frame['scale']),
    diaphragmGapMethod='Generated diaphragm triangles linearly interpolated in body L/A; source envelope from Gaussian0.65 low-volume threshold71.4, marching cubes step3; actual hiatus excluded.',
    caveat='Source pixels and the procedural organ are distinct. Positive coarse clearance does not prove contact clearance against every fine source fold or every steered probe pose.'
)
assert report['esophagealExpandedVerticesWithin03mmOfCoarseTissue'] == 0
assert report['diaphragmMinimumVerticalGapToCoarseEnvelopeMm'] > 3
(Path(__file__).resolve().parent / 'source-clearance.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps(report, indent=2))
