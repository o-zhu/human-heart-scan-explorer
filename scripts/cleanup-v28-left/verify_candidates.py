#!/usr/bin/env python3
"""Verify published-input invariants and independently decode candidate outputs."""
from pathlib import Path
import gzip,hashlib,importlib.util,json,sys
import numpy as np
from scipy import ndimage as ndi
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/fine-detail-v23'))
from source import FineSource
spec=importlib.util.spec_from_file_location('left_v28_build',Path(__file__).with_name('build.py'))
build=importlib.util.module_from_spec(spec);spec.loader.exec_module(build)

def sha(data):return hashlib.sha256(data).hexdigest()

def main():
    reader=FineSource(16)
    expected_source='e50ab70a52373dc774cf6077ef906a753e56b78b9f9b646fba2ffe7220ff338c'
    expected_v27='d97ac73a657df879fdfb8c88004cb63a429b568455b45b2dfceb2ae6258742f8'
    assert reader.manifest_sha256==expected_source
    assert sha((ROOT/'public/assets/cleanup-v27/lumen-manifest.json').read_bytes())==expected_v27
    ra,rb,restored,restoration=build.restoration_footprint(reader)
    masks=[];candidates=[]
    for op in build.OPERATIONS:
        directory=ROOT/'docs/cleanup-v28-left/candidates'
        policy=json.loads((directory/(op['id']+'-policy.json')).read_text())
        path=directory/(op['id']+'-selection.npz');loaded=np.load(path)
        lo,hi,bits=loaded['lowerXYZ'],loaded['upperXYZ'],loaded['mask']
        assert bits.dtype==np.bool_ and bits.shape==tuple((hi-lo)[::-1])
        assert sha(bits.tobytes())==policy['logicalSelectionSha256']
        assert int(bits.sum())==policy['selectedSamples']
        aa=np.maximum(lo,ra);bb=np.minimum(hi,rb)
        overlap=0 if np.any(bb<=aa) else int(np.count_nonzero(bits[build.bbox_slice(aa,bb,lo)]&restored[build.bbox_slice(aa,bb,ra)]))
        assert overlap==0
        masks.append((lo,hi,bits))
        candidates.append(dict(id=op['id'],fileSha256=sha(path.read_bytes()),logicalSha256=sha(bits.tobytes()),selectedSamples=int(bits.sum()),restorationOverlap=overlap))
    # Manually reviewed source coordinates on the neighboring wall and selected
    # free object. Checking both classes prevents a shifted or mirrored mask
    # from passing merely because its voxel count looks plausible.
    probes=[
      dict(label='neighboring atrial wall',xyz=[1160,1260,865],source=110,excluded=False),
      dict(label='adjacent dense septal wall',xyz=[1290,1260,825],source=157,excluded=False),
      dict(label='pulmonary vein dense wall',xyz=[1343,1216,744],source=199,excluded=False),
      dict(label='restored irregular wall seed',xyz=[1125,990,990],source=145,excluded=False),
      dict(label='restored oval wall seed',xyz=[1268,938,995],source=162,excluded=False),
      dict(label='selected PV oval branch',xyz=[1324,1216,760],source=139,excluded=True),
      dict(label='selected late PV free sheet',xyz=[1260,1308,722],source=114,excluded=True),
      dict(label='early inlet selected body from production readback',xyz=[1240,802,530],source=125,excluded=True),
      dict(label='early inlet adjacent bright wall',xyz=[1220,780,540],source=148,excluded=False),
      dict(label='early inlet lower adjacent wall',xyz=[1180,820,560],source=162,excluded=False),
      dict(label='early inlet free upper lobe',xyz=[1253,840,458],source=91,excluded=True),
      dict(label='early inlet roof retained at terminal attachment',xyz=[1240,848,445],source=192,excluded=False),
    ]
    for probe in probes:
        p=np.array(probe['xyz']);value=int(reader.region(p,p+1)[0,0,0]);assert value==probe['source']
        selected=any(bool(bits[tuple((p-lo)[::-1])]) for lo,hi,bits in masks if np.all(p>=lo) and np.all(p<hi))
        assert selected==probe['excluded'],probe
    directory=ROOT/'docs/cleanup-v28-left/patch'
    policy_path=directory/'lvot-perivalvular-refinement-policy.json'
    patch=json.loads(policy_path.read_text());surface=patch['surface'];encoded=(directory/surface['file']).read_bytes()
    assert sha(encoded)==surface['sha256'];assert sha(gzip.decompress(encoded))==surface['decodedSha256']
    item=patch['lowBandMask'];encoded=(directory/item['file']).read_bytes();assert sha(encoded)==item['sha256']
    rawmask=gzip.decompress(encoded);assert sha(rawmask)==item['decodedSha256']
    packed=np.frombuffer(rawmask,np.uint8).reshape(item['storageDimensionsXYZ'][::-1])
    bits=np.unpackbits(packed,axis=2,bitorder='little')[:,:,:item['dimensionsXYZ'][0]].astype(bool)
    lo=np.array(item['lowerFullFineXYZ']);hi=np.array(item['upperFullFineXYZ']);raw=reader.region(lo-3,hi+3)
    assert sha(memoryview(raw))==patch['sourcePaddedRoiSha256']
    f=ndi.gaussian_filter(raw.astype(np.float32),.5,truncate=3)[3:-3,3:-3,3:-3]
    rawcore=raw[3:-3,3:-3,3:-3]
    assert sha(np.ascontiguousarray(rawcore))==patch['sourceRoiSha256']
    dense135=f>=135;raw190=(rawcore>=190)&(f>=71.4)
    dense_loss=int(np.count_nonzero(bits&dense135));raw_loss=int(np.count_nonzero(bits&raw190))
    assert dense_loss==0 and raw_loss==0
    boundary=np.concatenate([bits[0].ravel(),bits[-1].ravel(),bits[:,0,:].ravel(),bits[:,-1,:].ravel(),bits[:,:,0].ravel(),bits[:,:,-1].ravel()])
    assert not boundary.any()
    aa=np.maximum(lo,ra);bb=np.minimum(hi,rb)
    overlap=0 if np.any(bb<=aa) else int(np.count_nonzero(bits[build.bbox_slice(aa,bb,lo)]&restored[build.bbox_slice(aa,bb,ra)]))
    assert overlap==0
    report=dict(source=reader.receipt(),frozenV27ManifestUnchanged=True,wallRestorationSha256=restoration['restoreMaskSha256'],wallRestorationSamples=restoration['restoreSamples'],candidates=candidates,sourceCoordinateProbes=probes,
      patch=dict(policySha256=sha(policy_path.read_bytes()),surfaceFormat=surface['format'],surfaceSha256=surface['sha256'],sourcePaddedRoiSha256=patch['sourcePaddedRoiSha256'],lowBandMaskSamples=int(bits.sum()),retained135Samples=int(dense135.sum()),lost135Samples=dense_loss,retainedRaw190BaselineSamples=int(raw190.sum()),lostRaw190Samples=raw_loss,changedBoxBoundarySamples=int(boundary.sum()),restorationOverlap=overlap),
      verified=True,scope='Bitset/transport/source identity and source-core retention invariants. Production appearance and final integration are separately reviewed.')
    (ROOT/'docs/cleanup-v28-left/verification.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))

if __name__=='__main__':main()
