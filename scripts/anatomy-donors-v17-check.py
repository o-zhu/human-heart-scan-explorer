"""Validate S-donor annotation assets and original-source registration.

This checks internal consistency and recorded source-review points. It does not
measure segmentation accuracy against expert ground truth.
"""
from pathlib import Path
import argparse, gzip, hashlib, json
import numpy as np
from scipy import ndimage as ndi

ROOT=Path(__file__).resolve().parents[1]
DOCS=ROOT/'docs/anatomy-donors-v17'

def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(4*1024**2),b''):h.update(block)
    return h.hexdigest()

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--data-root',type=Path,default=Path('/workspace/data'))
    p.add_argument('--work',type=Path,default=Path('/workspace/data/anatomy-s-v17'))
    args=p.parse_args();points=json.loads((DOCS/'holdout-source-points.json').read_text())['points'];all_results={}
    for slug in ['s-20-29','s-20-28']:
        d=ROOT/'public/assets/donors'/slug;meta=json.loads((d/'anatomy/manifest.json').read_text())
        dims=np.array(meta['dimensions']);src=np.array(meta['sourceDimensionsXYZ'])
        path=ROOT/'public'/meta['volumeUrl'].removeprefix('./');packed=path.read_bytes();raw=gzip.decompress(packed)
        labels=np.frombuffer(raw,np.uint8).reshape(tuple(dims[::-1]))
        assert len(raw)==int(np.prod(dims))==meta['decodedBytes']
        assert len(packed)==meta['compressedBytes'] and len(packed)<2_000_000
        assert hashlib.sha256(raw).hexdigest()==meta['sha256']
        assert hashlib.sha256(packed).hexdigest()==meta['compressedSha256']
        assert path.name.startswith('labels-v17-') and path.name.endswith('.raw.gz')
        assert set(np.unique(labels))==set(range(7))
        assert [entry['id'] for entry in meta['labels']]==list(range(7))
        assert meta['expertValidated'] is False and meta['supportsQuantification'] is False
        assert meta['geometricComparisonOnly'] is True and meta['clinicalPresetsReviewed'] is False
        assert meta['sourceReviewed'] is True and meta['segmentationAvailable'] is True
        assert meta['specimen']==slug.upper()
        assert meta['datasetId'] in meta['datasetUrl']
        assert meta['sourceCoordinateOffsetToOriginalS4XYZ']==[-.375]*3
        np.testing.assert_allclose(meta['labelGridSpacingUmXYZ'],np.array(meta['sourceSpacingUm'])*(src-1)/(dims-1),rtol=1e-10)
        # Original all-neutral asset remains intact for any previously cached
        # immutable R2 comparison-display index. The new file has a new URL.
        old=gzip.decompress((d/'anatomy/labels.raw.gz').read_bytes())
        assert old==bytes(8)
        support=np.load(args.work/slug/'annotation-support.npy',mmap_mode='r')
        assert not np.any((labels>0)&~support)
        provenance=json.loads((DOCS/slug/'source-provenance.json').read_text())
        source=args.data_root/('heart-donor-'+meta['datasetId'])/'source-high-u16.npy'
        assert digest(source)==provenance['sourceSha256']
        original=np.load(source,mmap_mode='r')
        assert original.dtype==np.uint16 and list(original.shape[::-1])==provenance['originalDimensionsXYZ']
        records=[]
        for point in points[slug]:
            xyz=np.array(point['sourceXYZ']);index=np.rint((xyz+.375)/(src-1)*(dims-1)).astype(int)
            actual=int(labels[index[2],index[1],index[0]]);expected=point['expectedRegion']
            r=dict(point,actualRegion=actual,matched=actual==expected,sourceIntensity=int(original[xyz[2],xyz[1],xyz[0]]))
            if slug=='s-20-28' and point['name']=='Pulmonary basal wall':
                r.update(role='Targeted refinement control after initial 12/13 holdout result',initialRegion=0)
            else:r['role']='Withheld source-review identity point'
            records.append(r)
        assert all(r['matched'] for r in records),records
        counts=np.bincount(labels.ravel(),minlength=7)
        components={}
        for k in range(1,7):
            cc,n=ndi.label(labels==k,structure=ndi.generate_binary_structure(3,2));size=np.bincount(cc.ravel());size[0]=0
            components[str(k)]={'components':int(n),'largestComponentVoxels':int(size.max()),'totalVoxels':int(counts[k]),'largestComponentFraction':float(size.max()/counts[k])}
            assert int(counts[k])==meta['labels'][k]['voxelCount'] and counts[k]>1000
        result={'asset':path.name,'compressedBytes':len(packed),'decodedBytes':len(raw),'gzipHashAndRoundTrip':True,
            'allSixRegionIdsPresent':True,'originalSourceUnchanged':True,'originalNeutralAssetUnchanged':True,
            'physicalRegistrationVerified':True,'outsideAnnotationSupportVoxels':0,'expertValidated':False,
            'notAnAccuracyEstimate':True,'pointChecks':{'matched':sum(r['matched'] for r in records),'total':len(records),'records':records},
            'connectivity':components,'sourceSha256':provenance['sourceSha256'],'rawSha256':meta['sha256']}
        (DOCS/slug/'checks.json').write_text(json.dumps(result,indent=2)+'\n');all_results[slug]=result
        print(slug,f'{len(packed):,} compressed bytes; {len(raw):,} decoded; 13/13 source control points; registration/hash/support checks passed')
    (DOCS/'checks-summary.json').write_text(json.dumps({k:{'compressedBytes':v['compressedBytes'],'decodedBytes':v['decodedBytes'],'pointChecks':v['pointChecks']['matched'],'expertValidated':False} for k,v in all_results.items()},indent=2)+'\n')

if __name__=='__main__':main()
