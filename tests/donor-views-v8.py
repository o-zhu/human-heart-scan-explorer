"""Verify source registration and exact pixel preservation of new donor assets.

Interpolation is independently calculated from the eight source voxels rather
than by importing the preparation script or its SciPy sampling function.
"""
from pathlib import Path
import argparse
import gzip
import hashlib
import json
import math

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source-root', type=Path, default=Path('/workspace/data/heart-donor-2298522198'))
parser.add_argument('--report', type=Path, default=ROOT/'docs/donors/ucl-zcr-2629/view-validation.json')
args = parser.parse_args()
assets = ROOT/'public/assets/donors/ucl-zcr-2629'
frames = json.loads((assets/'echo-planes.json').read_text())
echo = json.loads((assets/'echo-textures.json').read_text())
flows = json.loads((assets/'flow-views.json').read_text())
fine = json.loads((assets/'ultra-volume.json').read_text())
anatomy = json.loads((assets/'anatomy/manifest.json').read_text())
assert frames['datasetId'] == echo['datasetId'] == flows['datasetId'] == anatomy['datasetId'] == '2298522198'
assert frames['clinicalPresetsReviewed'] is False and anatomy['expertValidated'] is False
assert len(frames['frames']) == len(echo['textures']) == 13
assert len(flows['presets']) == 8 and len(fine['preparedPlanes']) == 4

source = None
if (args.source_root/'s2-clean-display-u8.npy').exists():
    source = np.load(args.source_root/'s2-clean-display-u8.npy', mmap_mode='r')
    assert list(source.shape[::-1]) == fine['sourceShapeXYZ']


def source_pixel(world):
    """Independent scalar world-to-source map and eight-corner interpolation."""
    d = fine['fullDimensionsXYZ'];origin = fine['sourceOriginXYZ'];scale = max(n-1 for n in d)
    x = world[0]*scale+(d[0]-1)/2-origin[0]
    y = -world[2]*scale+(d[1]-1)/2-origin[1]
    z = world[1]*scale+(d[2]-1)/2-origin[2]
    nz, ny, nx = source.shape
    if x < 0 or y < 0 or z < 0 or x > nx-1 or y > ny-1 or z > nz-1:
        return 0
    x0,y0,z0 = math.floor(x),math.floor(y),math.floor(z)
    fx,fy,fz = x-x0,y-y0,z-z0
    value = 0.
    for dz,wz in [(0,1-fz),(1,fz)]:
        for dy,wy in [(0,1-fy),(1,fy)]:
            for dx,wx in [(0,1-fx),(1,fx)]:
                value += int(source[min(z0+dz,nz-1),min(y0+dy,ny-1),min(x0+dx,nx-1)])*wx*wy*wz
    return math.floor(value+.5)


records = []
jobs = [(key, item, frames['frames'][key]['world']) for key,item in echo['textures'].items()]
jobs += [(p['id'],p['texture'],p['world']) for p in flows['presets']]
jobs += [('probe-'+p['id'],p,p['plane']) for p in fine['preparedPlanes']]
rng = np.random.default_rng(2298522198)
sample_count = 0;maximum_error = 0
for key,item,plane in jobs:
    path = ROOT/'public'/item['url'].removeprefix('./').removeprefix('/')
    data_bytes = path.read_bytes()
    assert len(data_bytes) == item['bytes']
    assert hashlib.sha256(data_bytes).hexdigest() == item['sha256'], key
    image = np.asarray(Image.open(path).convert('L'))
    assert image.shape == (item['height'],item['width'])
    assert hashlib.sha256(image.tobytes()).hexdigest() == item['pixelSha256'], key
    basis = np.array([plane[k] for k in ['right','up','normal']])
    assert np.max(np.abs(basis@basis.T-np.eye(3))) < 1e-9
    assert np.max(np.abs(np.cross(basis[0],basis[1])-basis[2])) < 1e-9
    assert item['sourceSpacingUm'] == 28.128 and item['cleaned'] is True
    assert item['width'] == math.ceil(plane['width']*fine['longestMm']*1000/fine['sourceSpacingUm'])+1
    assert item['height'] == math.ceil(plane['height']*fine['longestMm']*1000/fine['sourceSpacingUm'])+1
    error = 0;checked = 0
    if source is not None:
        h,w = image.shape
        points = [(0,0),(h-1,w-1),(0,w-1),(h-1,0),(h//2,w//2)]
        points += list(zip(rng.integers(0,h,200),rng.integers(0,w,200)))
        nonzero = np.flatnonzero(image > 65)
        for index in rng.choice(nonzero,min(400,len(nonzero)),replace=False):
            points.append((int(index//w),int(index%w)))
        for row,col in points:
            world = np.array(plane['center'])+np.array(plane['right'])*(col/(w-1)-.5)*plane['width']+np.array(plane['up'])*(.5-row/(h-1))*plane['height']
            expected = source_pixel(world)
            difference = abs(int(image[row,col])-expected)
            assert difference <= 1, (key,row,col,int(image[row,col]),expected)
            error = max(error,difference);checked += 1
        maximum_error = max(maximum_error,error);sample_count += checked
    records.append(dict(id=key,width=item['width'],height=item['height'],bytes=item['bytes'],losslessPixelHash=True,sourcePixelsChecked=checked,maxSourceError=error))

compressed = (assets/'anatomy/labels.raw.gz').read_bytes()
assert hashlib.sha256(compressed).hexdigest() == anatomy['compressedSha256']
raw = gzip.decompress(compressed)
assert hashlib.sha256(raw).hexdigest() == anatomy['sha256']
labels = np.frombuffer(raw,np.uint8).reshape(anatomy['dimensions'][::-1])
assert int(labels.max()) == 6 and set(np.unique(labels)) == set(range(7))
source_dims = np.array(anatomy['sourceDimensionsXYZ']);dims = np.array(anatomy['dimensions'])
for label in anatomy['labels'][1:]:
    assert int((labels == label['id']).sum()) == label['voxelCount']
    anchor = np.rint(np.array(label['referenceAnchorSourceXYZ'])/(source_dims-1)*(dims-1)).astype(int)
    assert int(labels[anchor[2],anchor[1],anchor[0]]) == label['id']
    assert 'candidate' in label['name'].lower() and 'Provisional' in label['confidence']

report = dict(passed=True,datasetId='2298522198',sourceSampled=source is not None,sourcePixelsChecked=sample_count,
              maxIndependentSourcePixelError=maximum_error,encodedAndPixelHashesVerified=len(records),
              preparedEchoPlanes=13,preparedFlowPlanes=8,preparedProbePlanes=4,
              annotationLabelsVerified=6,clinicalAccuracy='Not established; provisional source-guided candidates.',
              browserVerification='Not performed by this data test.',images=records)
args.report.parent.mkdir(parents=True,exist_ok=True)
args.report.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='images'},indent=2))
