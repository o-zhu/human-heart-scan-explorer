#!/usr/bin/env python3
"""Independent v28 bitset deltas and preservation of the two restored walls."""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
fixture=ROOT/'tests/lumen-mask-regions-v27.py'
exec(compile(fixture.read_text().split("old_manifest, old =")[0],str(fixture),'exec'))
BASELINE='b299904716841ea26e173f6ae19e66cd4d9c84f3'
old_manifest,old=read_collection('v27');new_manifest,new=read_collection('v28');_,pre_repair=read_collection('v26')
assert new_manifest['predecessorManifestSha256']==digest((ROOT/'public/assets/cleanup-v27/lumen-manifest.json').read_bytes())
assert new_manifest['sourceManifestSha256']==old_manifest['sourceManifestSha256']
assert set(old)==set(new)=={'atrial','arterial','valve-region','rv'}
checks=[]
for name,(item,packed) in new.items():
    lo,hi=np.array(item['lowerFullFineXYZ']),np.array(item['upperFullFineXYZ'])
    assert np.all(lo<=old[name][0]['lowerFullFineXYZ']) and np.all(hi>=old[name][0]['upperFullFineXYZ'])
    policies=[json.loads((ROOT/op['policy']).read_text()) for op in item['policy']['operations']]
    boxes=[(p['lowerFullFineXYZ'],p['upperFullFineXYZ']) for p in policies]
    added=selected=0
    for z in range(int(lo[2]),int(hi[2]),16):
        a,b=lo.copy(),hi.copy();a[2],b[2]=z,min(z+16,int(hi[2]))
        before,after=region(old[name],a,b),region(new[name],a,b)
        assert not np.any(before&~after),(name,'unintended clearing of prior review')
        difference=after&~before
        assert not np.any(difference&~footprint(difference.shape,a,b,boxes)),(name,'changes beyond traced source')
        added+=int(difference.sum());selected+=int(after.sum())
    assert added==item['policy']['addedDisplayExclusionSamples'] and selected==item['maskedVoxels']
    checks.append(dict(mask=name,added=added,selected=selected,priorBitsRetained=True,changesConfinedToReviewedFootprints=True))
repairs=json.loads((ROOT/'docs/cleanup-v27-wall/restoration-all-selections.json').read_text())['patches'];wall_checks=[]
surface_path=ROOT/'public/assets/cleanup-v28/surface-manifest.json';surface=json.loads(surface_path.read_text()) if surface_path.exists() else None
local_masks=[]
if surface:
    for patch in surface['patches']:
        item=patch['lowBandMask'];encoded=(ROOT/'public'/item['url'].removeprefix('./')).read_bytes();assert digest(encoded)==item['sha256'];raw=gzip.decompress(encoded);assert digest(raw)==item['decodedSha256'];m={**item,'lowerFullFineXYZ':patch['lowerFullFineXYZ'],'upperFullFineXYZ':patch['upperFullFineXYZ']};local_masks.append((patch['id'],(m,np.frombuffer(raw,np.uint8).reshape(item['storageDimensionsXYZ'][::-1]))))
for patch in repairs:
    a,b=patch['restoreLowerXYZ'],patch['restoreUpperExclusiveXYZ'];restored=region(pre_repair['atrial'],a,b)&~region(old['atrial'],a,b)
    assert int(restored.sum())==patch['restoreSamples'] and digest(restored.tobytes())==patch['restoreMaskSha256']
    for name in new:assert not np.any(restored&region(new[name],a,b)),(name,'hides restored wall')
    for name,m in local_masks:assert not np.any(restored&region(m,a,b)),(name,'surface low-band hides restored wall')
    wall_checks.append(dict(patch=patch['patch'],restoredSamples=int(restored.sum()),exactRestorationHash=True,noObjectOrSurfaceMaskReexcludesRestoredWall=True))
protected=['public/assets/fine-surface-v23','public/assets/ultra-volume-v7.json','public/assets/guided-native-v21','public/assets/cleanup-v26','public/assets/cleanup-v27','server/ultra-volume-index-v7.json','server/fine-detail-index-v23.json']
changed=subprocess.check_output(['git','-C',str(ROOT),'diff','--name-only',BASELINE,'--',*protected]);assert not changed,changed.decode()
report=dict(passed=True,baselineCommit=BASELINE,manifestSha256=digest((ROOT/'public/assets/cleanup-v28/lumen-manifest.json').read_bytes()),masks=checks,wallPatches=wall_checks,localSurfaceMasksChecked=len(local_masks),protectedSourceAndPriorFilesUnchanged=True,scope='Independent encoded bitset comparison, actual prior restored-wall footprints and archived hashes. Original scalar data and original geometry stay unchanged; new local surfaces are separate reversible display assets. Not anatomical or clinical validation.')
out=ROOT/'docs/release-v28/mask-region-validation.json';out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
