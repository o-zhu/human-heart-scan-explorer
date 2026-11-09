#!/usr/bin/env python3
"""Independently verify the shipped bitsets against the frozen prior masks.

This checks the encoded products, not the selection-builder implementation:
all changed logical samples must lie inside reviewed footprints, restoration
must exactly match its published per-patch hashes, and overlapping masks must
not hide the restored wall again. Source arrays and mesh parts are immutable.
"""
from pathlib import Path
import gzip
import hashlib
import json
import subprocess
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
BASELINE = '310ac98b35a1e4e909208fbf67acade939f47c38'
def digest(data):
    return hashlib.sha256(data).hexdigest()

def read_collection(version):
    path = ROOT / f'public/assets/cleanup-{version}/lumen-manifest.json'
    manifest = json.loads(path.read_text())
    masks = {}
    for item in manifest['masks']:
        compressed = (ROOT / 'public' / item['url'].removeprefix('./')).read_bytes()
        assert len(compressed) == item['compressedBytes']
        assert digest(compressed) == item['sha256']
        raw = gzip.decompress(compressed)
        assert len(raw) == item['decodedBytes']
        assert digest(raw) == item['decodedSha256']
        masks[item['id']] = (item, np.frombuffer(raw, np.uint8).reshape(item['storageDimensionsXYZ'][::-1]))
    return manifest, masks

def region(mask, lower, upper):
    item, packed = mask
    lower, upper = np.asarray(lower), np.asarray(upper)
    origin = np.asarray(item['lowerFullFineXYZ'])
    end = np.asarray(item['upperFullFineXYZ'])
    a, b = np.maximum(lower, origin), np.minimum(upper, end)
    result = np.zeros(tuple((upper-lower)[::-1]), bool)
    if not np.all(b > a):
        return result
    local_a, local_b = a-origin, b-origin
    rows = packed[local_a[2]:local_b[2], local_a[1]:local_b[1]]
    bits = np.unpackbits(rows, axis=2, count=item['dimensionsXYZ'][0], bitorder='little')
    target = tuple(slice(int(x),int(y)) for x,y in zip((a-lower)[::-1],(b-lower)[::-1]))
    result[target] = bits[:,:,local_a[0]:local_b[0]]
    return result

def footprint(shape, lower, upper, boxes):
    result = np.zeros(shape, bool)
    for lo, hi in boxes:
        a, b = np.maximum(lower,lo), np.minimum(upper,hi)
        if np.all(b > a):
            slices = tuple(slice(int(x),int(y)) for x,y in zip((a-lower)[::-1],(b-lower)[::-1]))
            result[slices] = True
    return result

old_manifest, old = read_collection('v26')
new_manifest, new = read_collection('v27')
assert new_manifest['predecessorManifestSha256'] == digest((ROOT/'public/assets/cleanup-v26/lumen-manifest.json').read_bytes())
assert new_manifest['sourceManifestSha256'] == old_manifest['sourceManifestSha256']
assert set(old) == set(new) == {'atrial','arterial','valve-region','rv'}
repair = json.loads((ROOT/'docs/cleanup-v27-wall/restoration-all-selections.json').read_text())
patches = repair['patches']
assert len(patches) == 2
restore_boxes = [(p['restoreLowerXYZ'],p['restoreUpperExclusiveXYZ']) for p in patches]
checks = []
for name,(item,packed) in new.items():
    lo, hi = np.array(item['lowerFullFineXYZ']), np.array(item['upperFullFineXYZ'])
    old_item = old[name][0]
    assert np.all(np.array(old_item['lowerFullFineXYZ']) >= lo)
    assert np.all(np.array(old_item['upperFullFineXYZ']) <= hi)
    boxes = [(op['lowerFullFineXYZ'],op['upperFullFineXYZ']) for op in item['policy']['operations']]
    counts = dict(added=0,restored=0,selected=0)
    for z in range(int(lo[2]),int(hi[2]),16):
        a, b = lo.copy(), hi.copy()
        a[2], b[2] = z,min(z+16,int(hi[2]))
        before, after = region(old[name],a,b),region(new[name],a,b)
        added, restored = after & ~before,before & ~after
        assert not np.any(added & ~footprint(added.shape,a,b,boxes)),(name,'addition outside reviewed footprints')
        assert not np.any(restored & ~footprint(restored.shape,a,b,restore_boxes)),(name,'restoration outside wall footprints')
        counts['added'] += int(added.sum())
        counts['restored'] += int(restored.sum())
        counts['selected'] += int(after.sum())
    policy = item['policy']
    assert counts['added'] == policy['addedDisplayExclusionSamples']
    assert counts['restored'] == policy['restoredPriorExclusionSamples']
    assert counts['selected'] == item['maskedVoxels']
    assert counts['selected'] == old_item['maskedVoxels']+counts['added']-counts['restored']
    checks.append(dict(mask=name,**counts,changesConfinedToReviewedFootprints=True))

patch_checks = []
for patch in patches:
    a, b = patch['restoreLowerXYZ'],patch['restoreUpperExclusiveXYZ']
    actual = region(old['atrial'],a,b) & ~region(new['atrial'],a,b)
    assert int(actual.sum()) == patch['restoreSamples'],patch['patch']
    assert digest(actual.tobytes()) == patch['restoreMaskSha256'],patch['patch']
    for name in new:
        assert not np.any(actual & region(new[name],a,b)),(patch['patch'],name,'re-excludes restored wall')
    patch_checks.append(dict(patch=patch['patch'],restoredSamples=int(actual.sum()),exactRestorationHash=True,noMaskReexcludesRestoredWall=True))

protected_paths = ['public/assets/fine-surface-v23','public/assets/ultra-volume-v7.json',
    'public/assets/guided-native-v21','public/assets/cleanup-v26',
    'server/ultra-volume-index-v7.json','server/fine-detail-index-v23.json']
changed = subprocess.check_output(['git','-C',str(ROOT),'diff','--name-only',BASELINE,'--',*protected_paths])
assert not changed,changed.decode()
report = dict(passed=True,baselineCommit=BASELINE,manifestSha256=digest((ROOT/'public/assets/cleanup-v27/lumen-manifest.json').read_bytes()),
    masks=checks,wallPatches=patch_checks,protectedSourceAndPriorFilesUnchanged=True,
    scope='Independent logical bitset comparison against the published v26 baseline. Every addition/clearance is confined to its reviewed footprint, wall clearance hashes match the source-review receipts, and every mask retains wall visibility. This does not establish tissue identity or anatomical validation.')
(ROOT/'docs/release-v27/mask-region-validation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
