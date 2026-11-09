"""Verify the served categorical annotation and preserved anatomical controls."""
from pathlib import Path
import gzip, hashlib, json
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
meta=json.loads((ROOT/'public/assets/anatomy/manifest.json').read_text())
# v17 only completes previously neutral LA cells. Keep testing the served asset
# against all v12 anatomical invariants and controls, not an obsolete filename.
assert meta['revision'] in ('surface-ownership-v12','la-exterior-v17')
asset=ROOT/'public'/meta['volumeUrl'].removeprefix('./')
packed=asset.read_bytes();raw=gzip.decompress(packed)
assert len(packed)==meta['compressedBytes']
assert len(raw)==meta['decodedBytes']==int(np.prod(meta['dimensions']))
assert hashlib.sha256(packed).hexdigest()==meta['compressedSha256']
assert hashlib.sha256(raw).hexdigest()==meta['sha256']
assert meta['dimensions']==[317,317,354] and meta['sourceDimensionsXYZ']==[475,475,530]
assert meta['supportsQuantification'] is False
labels=np.frombuffer(raw,np.uint8).reshape(tuple(meta['dimensions'][::-1]))
assert set(np.unique(labels))==set(range(7))
baseline_raw=gzip.decompress((ROOT/'docs/anatomy-v12/baseline/labels.raw.gz').read_bytes())
assert hashlib.sha256(baseline_raw).hexdigest()=='e15ebb51b895aa325fe1f71993f1acfe2af24cc1f1e67b1bd4e26b65cffde055'
baseline=np.frombuffer(baseline_raw,np.uint8).reshape(labels.shape)
# The intervention cannot recolor old atrial or arterial tissue, nor turn RV
# tissue into LV while repairing the specific RV-facing surface complaint.
assert np.array_equal(labels[baseline>=3],baseline[baseline>=3])
assert not np.any((baseline==2)&(labels!=2))
assert not np.any((baseline>0)&(labels==0))
counts=np.bincount(labels.ravel(),minlength=7)
scale=(np.array(meta['dimensions'])-1)/(np.array(meta['sourceDimensionsXYZ'])-1)
for label in meta['labels']:
    k=label['id']
    if not k:continue
    assert int(counts[k])==label['voxelCount']
    xyz=np.argwhere(labels==k)[:,::-1]
    bounds=np.array(label['boundsNormalizedXYZ'])*(np.array(meta['dimensions'])-1)
    assert np.allclose(bounds,[xyz.min(axis=0),xyz.max(axis=0)])
    x,y,z=np.rint(np.array(label['referenceAnchorSourceXYZ'])*scale).astype(int)
    assert labels[z,y,x]==k
verification=json.loads((ROOT/'docs/anatomy-v12/verification.json').read_text())
control_count=0
for group in verification['landmarkGroups'].values():
    for point in group['points']:
        x,y,z=np.rint(np.array(point['sourceXYZ'])*scale).astype(int)
        assert labels[z,y,x]==point['expected'],point['name']
        control_count+=1
assert control_count==43
surface=json.loads((ROOT/'docs/anatomy-v12/surface-review.json').read_text())
for view,report in surface.items():
    assert report['hybrid']['visiblePixels']==report['baseline']['visiblePixels'],view
    assert report['hybrid']['unclassifiedPixels']<report['baseline']['unclassifiedPixels']*.2,view
focused=json.loads((ROOT/'docs/anatomy-v12/rv-inflow-review.json').read_text())
preset=next(p for p in json.loads((ROOT/'public/assets/flow-views-v5.json').read_text())['presets'] if p['id']=='rv-inflow')
assert focused['sourcePlane']==preset['source']
assert focused['cameraDistance']==preset['cameraDistance']
assert focused['perspectiveFactor']==.32
assert focused['candidates']['hybrid']['lvLabelsInReviewRegion']==0
print(json.dumps({'verified':True,'revision':meta['revision'],'compressedBytes':len(packed),
 'decodedBytes':len(raw),'sourceControlPoints':control_count,
 'existingAtrialArterialIdentitiesPreserved':True,'existingRVTissuePreserved':True},indent=2))
