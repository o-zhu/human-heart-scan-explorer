#!/usr/bin/env python3
"""Independent frozen-base inclusion, storage and source-bank verification."""
from pathlib import Path
import gzip,hashlib,json,sys
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/fine-detail-v23'))
from source import FineSource

def sha(data):return hashlib.sha256(data).hexdigest()
def public(url):return ROOT/'public'/url.removeprefix('./')

def main():
    manifest_path=ROOT/'public/assets/cleanup-v26/lumen-manifest.json'
    meta=json.loads(manifest_path.read_text())
    old=json.loads((ROOT/'public/assets/cleanup-v25/lumen-manifest.json').read_text())
    reader=FineSource(cache_bricks=0);checks=[]
    for item in meta['masks']:
        encoded=public(item['url']).read_bytes();raw=gzip.decompress(encoded)
        assert sha(encoded)==item['sha256'] and sha(raw)==item['decodedSha256']
        assert len(encoded)==item['compressedBytes'] and len(raw)==item['decodedBytes']
        dimensions=np.array(item['dimensionsXYZ']);storage=np.array(item['storageDimensionsXYZ'])
        assert np.array_equal(storage,[(dimensions[0]+7)//8,dimensions[1],dimensions[2]])
        packed=np.frombuffer(raw,np.uint8).reshape(storage[::-1])
        popcount=np.unpackbits(np.arange(256,dtype=np.uint8)[:,None],axis=1).sum(1)
        assert int(popcount[packed].sum())==item['maskedVoxels']
        tail=int(dimensions[0]%8)
        if tail:assert not np.any(packed[:,:,-1]>>tail)
        lo=np.array(item['lowerFullFineXYZ']);hi=np.array(item['upperFullFineXYZ'])
        assert np.array_equal(hi-lo,dimensions)
        fixture=json.loads((ROOT/f'docs/cleanup-v26/{item["id"]}-bit-parity.json').read_text())
        for sample in fixture['samples']:
            x,y,z=np.array(sample['fineXYZ'])-lo
            assert bool((int(packed[z,y,x//8])>>(x&7))&1)==sample['excluded']
        frozen_id={'atrial':'atrial','arterial':'outflow'}.get(item['id'])
        inherited=0
        if frozen_id:
            base=next(x for x in old['masks'] if x['id']==frozen_id)
            base_encoded=public(base['url']).read_bytes();assert sha(base_encoded)==base['sha256']
            base_raw=gzip.decompress(base_encoded);assert sha(base_raw)==base['decodedSha256']
            source=np.frombuffer(base_raw,np.uint8).reshape(base['dimensionsXYZ'][::-1])
            offset=np.array(base['lowerFullFineXYZ'])-lo
            for z in range(source.shape[0]):
                yy,xx=np.nonzero(source[z]);x=xx+offset[0];y=yy+offset[1]
                assert np.all(((packed[z+offset[2],y,x//8]>>(x&7))&1)!=0)
                inherited+=len(x)
            assert inherited==base['maskedVoxels']
        # Reverify every immutable brick intersecting the mask and its largest
        # source-processing halo. This receipt is independent of cached builds.
        a=np.maximum(lo-40-reader.origin,0);b=np.minimum(hi+40-reader.origin,reader.shape)
        first=a//64;last=(b-1)//64
        for bz in range(int(first[2]),int(last[2])+1):
            for by in range(int(first[1]),int(last[1])+1):
                for bx in range(int(first[0]),int(last[0])+1):
                    key=int(bx+reader.counts[0]*(by+reader.counts[1]*bz))
                    if key not in reader.verified:reader.brick(bx,by,bz)
        policy=json.loads((ROOT/f'docs/cleanup-v26/{item["id"]}-mask-build.json').read_text())['policy']
        assert sha(json.dumps(policy,sort_keys=True,separators=(',',':')).encode())==item['policy']['fullPolicySha256']
        checks.append(dict(id=item['id'],logicalDimensionsXYZ=dimensions.tolist(),storageDimensionsXYZ=storage.tolist(),maskedVoxels=item['maskedVoxels'],inheritedV25MaskSamples= inherited,allInheritedSamplesStillExcluded=True,paddingZero=True,encodedAndDecodedHashesVerified=True,parityFixturesVerified=len(fixture['samples']),fullPolicyDigestVerified=True))
    report=dict(manifestSha256=sha(manifest_path.read_bytes()),masks=checks,totalDecodedBytes=sum(x['decodedBytes'] for x in meta['masks']),totalCompressedBytes=sum(x['compressedBytes'] for x in meta['masks']),source=reader.receipt(),scope='Independent actual-asset hash, storage, count, fixture, frozen-selection inclusion and source-context integrity checks. Source bricks cover each ROI plus forty real fine samples. This does not prove anatomical identity.')
    (ROOT/'docs/cleanup-v26/asset-validation.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report),flush=True)

if __name__=='__main__':main()
