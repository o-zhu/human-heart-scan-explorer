"""Verify bounded LA completion and exact preservation of v12 region identities."""
from pathlib import Path
import gzip
import hashlib
import json
import numpy as np
from scipy.spatial import cKDTree

ROOT=Path(__file__).resolve().parents[1]
meta=json.loads((ROOT/'public/assets/anatomy/manifest.json').read_text())
assert meta['revision']=='la-exterior-v17'
assert meta['supportsQuantification'] is False
packed=(ROOT/'public'/meta['volumeUrl'].removeprefix('./')).read_bytes()
raw=gzip.decompress(packed)
assert len(packed)==meta['compressedBytes']
assert len(raw)==meta['decodedBytes']==35_573_106
assert hashlib.sha256(raw).hexdigest()==meta['sha256']
assert hashlib.sha256(packed).hexdigest()==meta['compressedSha256']
oldraw=gzip.decompress((ROOT/'public/assets/anatomy/labels-v12-da41d280d86b.raw.gz').read_bytes())
assert hashlib.sha256(oldraw).hexdigest()=='da41d280d86b5b458494e45f76435f457c771cfe4d7380d412f4109cf4940e44'
shape=tuple(meta['dimensions'][::-1])
old=np.frombuffer(oldraw,np.uint8).reshape(shape)
new=np.frombuffer(raw,np.uint8).reshape(shape)
changed=old!=new
assert changed.sum()==3096
assert np.all(old[changed]==0) and np.all(new[changed]==3)
assert np.array_equal(new[old>0],old[old>0])
for k in [1,2,4,5,6]:
    assert np.array_equal(new==k,old==k)

# Independently recompute physical nearest-region distances at changed cells.
# The KD tree avoids allocating two full-volume distance maps in this test.
spacing=(.3176*(np.array(meta['sourceDimensionsXYZ'])-1)/(np.array(meta['dimensions'])-1))[::-1]
queries=np.argwhere(changed)*spacing
la_points=np.argwhere(old==3)*spacing
la_distance=cKDTree(la_points).query(queries)[0]
assert la_distance.max()<=2.4+1e-6
other_distance=np.full(len(queries),np.inf)
for k in [1,2,4,5,6]:
    other_distance=np.minimum(other_distance,cKDTree(np.argwhere(old==k)*spacing).query(queries)[0])
assert np.all(other_distance>=la_distance+.95-1e-6)

counts=np.bincount(new.ravel(),minlength=7)
for label in meta['labels']:
    if label['id']:
        assert label['voxelCount']==int(counts[label['id']])
checks=json.loads((ROOT/'docs/anatomy-v17-la/verification.json').read_text())
scale=(np.array(meta['dimensions'])-1)/(np.array(meta['sourceDimensionsXYZ'])-1)
n=0
for group in checks['landmarkGroups'].values():
    for point in group['points']:
        x,y,z=np.rint(np.array(point['sourceXYZ'])*scale).astype(int)
        assert new[z,y,x]==point['expected'],point['name']
        n+=1
assert n==43
assert checks['addedCellsWithoutSourceTissue']==0
review=json.loads((ROOT/'docs/anatomy-v17-la/surface-review.json').read_text())
for name,view in review['views'].items():
    assert view['v12']['visiblePixels']==view['v17']['visiblePixels'],name
    assert view['v17']['laPixels']>view['v12']['laPixels'],name
    assert view['v17']['neutralPixels']<view['v12']['neutralPixels'],name
print(json.dumps({'verified':True,'revision':meta['revision'],'priorControls':n,
    'allNonzeroV12LabelsPreserved':True,'newLACells':int(changed.sum()),
    'maximumDistanceMm':float(la_distance.max()),
    'minimumCompetingRegionAdvantageMm':float((other_distance-la_distance).min()),
    'compressedBytes':len(packed)},indent=2))
