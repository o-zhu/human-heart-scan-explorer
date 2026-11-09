#!/usr/bin/env python3
"""Independent delivered-bitset and local-mesh integrity checks."""
from pathlib import Path
import gzip,hashlib,importlib.util,json,sys
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
digest=lambda x:hashlib.sha256(x).hexdigest()

def read(item,base):
    encoded=(base/item.get('url',item.get('file')).removeprefix('./')).read_bytes()
    assert digest(encoded)==item['sha256']
    raw=gzip.decompress(encoded);assert digest(raw)==item['decodedSha256']
    assert len(raw)==item['decodedBytes'];return raw

def bits(item,base):
    a=np.frombuffer(read(item,base),np.uint8).reshape(item['storageDimensionsXYZ'][::-1])
    return np.unpackbits(a,axis=2,count=item['dimensionsXYZ'][0],bitorder='little').astype(bool)

def part(lo,hi,origin):return tuple(slice(int(a),int(b)) for a,b in zip((lo-origin)[::-1],(hi-origin)[::-1]))

def main():
    old=json.loads((ROOT/'public/assets/cleanup-v28/lumen-manifest.json').read_text())
    new=json.loads((ROOT/'public/assets/cleanup-v29-left/lumen-manifest.json').read_text())
    oa=next(x for x in old['masks'] if x['id']=='atrial');na=next(x for x in new['masks'] if x['id']=='atrial')
    ob=bits(oa,ROOT/'public');nb=bits(na,ROOT/'public')
    assert np.array_equal(oa['lowerFullFineXYZ'],na['lowerFullFineXYZ'])
    assert np.array_equal(oa['dimensionsXYZ'],na['dimensionsXYZ'])
    assert not np.any(ob&~nb),'No frozen exclusion may be silently removed.'
    difference=nb&~ob
    selection_path=ROOT/'docs/cleanup-v29-left/atrial/pulmonary-vein-residual-contour-correction-selection.npz'
    with np.load(selection_path) as d:lo=d['lowerXYZ'];hi=d['upperXYZ'];selected=d['mask']
    assert np.array_equal(difference[part(lo,hi,np.array(oa['lowerFullFineXYZ']))],selected)
    assert difference.sum()==selected.sum()==16979
    for item in new['masks']:
        if item['id']!='atrial':assert item==next(x for x in old['masks'] if x['id']==item['id'])
    sys.path.insert(0,str(ROOT/'scripts/fine-detail-v23'));from source import FineSource
    s=importlib.util.spec_from_file_location('frozen_repaired_wall',ROOT/'scripts/cleanup-v27-wall/restore_wall.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
    reader=FineSource(cache_bricks=8);ra,rb,restored,wr=m.restore_all_selections(reader)
    assert int(restored.sum())==109928 and wr['restoreMaskSha256']=='ac5d0d8771272e5bb14e0ae8ef13aea171c8abeda24d754e0345e1328aa5fbea'
    assert not np.any(nb[part(ra,rb,np.array(na['lowerFullFineXYZ']))]&restored)
    patch_path=ROOT/'docs/cleanup-v29-left/patch/lvot-perivalvular-refinement-policy.json';p=json.loads(patch_path.read_text())
    raw=read(p['surface'],patch_path.parent);header=np.frombuffer(raw,'<u4',8)
    assert int(header[0])==0x314d4648
    n=int(header[2]);ni=int(header[3]);assert n==p['surface']['vertexCount'] and ni==p['surface']['indexCount']
    indices=np.frombuffer(raw,'<u4',ni,int(header[6]));assert indices.max()<n and ni%3==0
    current=bits(p['lowBandMask'],patch_path.parent)
    prior=json.loads((ROOT/'docs/cleanup-v28-left/patch/lvot-perivalvular-refinement-policy.json').read_text())
    previous=bits(prior['lowBandMask'],ROOT/'public/assets/cleanup-v28')
    plo=np.array(p['lowerFullFineXYZ']);phi=np.array(p['upperFullFineXYZ'])
    oldlo=np.array(prior['lowerFullFineXYZ']);oldhi=np.array(prior['upperFullFineXYZ'])
    assert np.array_equal(previous,current[part(oldlo,oldhi,plo)])
    aa=np.maximum(ra,plo);bb=np.minimum(rb,phi)
    assert not np.any(current[part(aa,bb,plo)]&restored[part(aa,bb,ra)])
    assert p['counts']['lostProtected135Samples']==p['counts']['lostRaw190Samples']==0
    report=dict(atrialAdditionalSamples=int(difference.sum()),originalAtrialMaskSubsetExact=True,
      deliveredSelectionMatchesExactDifference=True,otherThreeMasksIdentical=True,
      preservedWallSamples=int(restored.sum()),preservedWallSha256=wr['restoreMaskSha256'],restoredWallOverlapSamples=0,
      previousLvotLowBandExactlyPreserved=True,deliveredMeshValid=True,meshVertices=n,meshTriangles=ni//3,
      meshEncodedSha256=p['surface']['sha256'],meshDecodedSha256=p['surface']['decodedSha256'],
      sourceManifestSha256=reader.receipt()['sourceManifestSha256'],sourceUnchanged=True,
      sourceDenseCorePreservation='Recorded during extraction: sigma0.5>=135 and raw>=190 losses both zero.',
      limitation='Source values are windowed uint8 display intensities, not calibrated HU; preservation does not establish clinical anatomy labels.')
    (ROOT/'docs/cleanup-v29-left/invariants.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))

if __name__=='__main__':main()
