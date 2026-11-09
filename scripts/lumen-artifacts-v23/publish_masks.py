#!/usr/bin/env python3
"""Package the reviewed, frozen display masks as small static 0/255 assets."""
from pathlib import Path
import gzip
import hashlib
import json
import numpy as np

ROOT = Path(__file__).resolve().parents[2]


def main():
    candidates=ROOT/'docs/lumen-artifacts-v23/candidates/manifest.json'
    review=json.loads(candidates.read_text())
    source=json.loads((ROOT/'public/assets/ultra-volume-v7.json').read_text())
    target=ROOT/'public/assets/lumen-cleanup-v23';target.mkdir(parents=True,exist_ok=True)
    masks=[]
    expected={'outflow':'320f226f34279dc4734176d8c57cc9572f4a14f44764a8c6a2fa669904198571','atrial':'c3eabe15a08bb92c7135b87c514714fdd66604cf2d88a827603873fc7bbc3a98'}
    for item in review['masks']:
        blob=(ROOT/item['file']).read_bytes()
        assert hashlib.sha256(blob).hexdigest()==expected[item['id']]==item['sha256']
        raw=gzip.decompress(blob)
        assert hashlib.sha256(raw).hexdigest()==item['rawSha256']
        data=np.frombuffer(raw,np.uint8).reshape(item['dimensionsXYZ'][::-1])
        assert np.isin(data,[0,1]).all()
        encoded_raw=(data*255).tobytes()
        encoded=gzip.compress(encoded_raw,compresslevel=9,mtime=0)
        name=item['id']+'-candidate.raw.gz';(target/name).write_bytes(encoded)
        z,y,x=np.nonzero(data);lower=np.array(item['boundsFullFineXYZ'][0])
        nonzero_bounds=[(np.array([x.min(),y.min(),z.min()])+lower).tolist(),(np.array([x.max(),y.max(),z.max()])+lower+1).tolist()]
        masks.append(dict(id=item['id'],label='Upper atrial candidate' if item['id']=='atrial' else 'Upper outflow candidate',
                          url='./assets/lumen-cleanup-v23/'+name,format='gzip-u8-zyx',dimensionsXYZ=item['dimensionsXYZ'],
                          lowerFullFineXYZ=item['boundsFullFineXYZ'][0],upperFullFineXYZ=item['boundsFullFineXYZ'][1],
                          nonzeroBoundsFullFineXYZ=nonzero_bounds,compressedBytes=len(encoded),decodedBytes=len(encoded_raw),
                          sha256=hashlib.sha256(encoded).hexdigest(),decodedSha256=hashlib.sha256(encoded_raw).hexdigest(),
                          maskedVoxels=item['maskedVoxels'],maskedVolumeMm3=item['maskedVoxels']*(source['sourceSpacingUm']/1000)**3,
                          protectedStrongOverlapVoxels=item['maskedAnchoredStrongSourceVoxels'],protectionGuardOverlapVoxels=item['maskedProtectionVoxels']))
    manifest=dict(version=1,id='ladaf-candidate-lumen-display-v23',donorId='ladaf-2021-17',defaultEnabled=False,
                  title='Candidate lumen material',
                  description='Optional 3D display exclusion of the two screenshot-reviewed intraluminal candidates. Measured material identity is uncertain; these are not proven acquisition artifacts. Original CT sections and source data remain unchanged.',
                  valueMeaning={'0':'show original','255':'hide candidate in optional 3D display'},sampling='nearest',
                  sourceManifestUrl='./assets/ultra-volume-v7.json',sourceManifestSha256=review['source']['sourceManifestSha256'],
                  sourceFullDimensionsXYZ=source['fullDimensionsXYZ'],sourceSpacingUm=source['sourceSpacingUm'],
                  longestMm=source['longestMm'],extent=json.loads((ROOT/'public/assets/fine-surface-v19/manifest.json').read_text())['extent'],
                  coordinateConvention='Main explorer endpoint convention: acquisition XYZ maps to world (x,z,-y).',
                  worldToFine='vec3(world.x, -world.z, world.y) * (longestMm / (sourceSpacingUm / 1000)) + (sourceFullDimensionsXYZ - 1) / 2',
                  fineToMaskUv='(fineXYZ - lowerFullFineXYZ + 0.5) / dimensionsXYZ; outside [lower-0.5, upper-0.5) returns zero; nearest R8 normalized sample > 0.5 means hide.',
                  policy=review['policy'],masks=masks,
                  limitations=['Material classification is unverified. Original display is the default.','The large attached atrial sheet, bright internal structure, and thin attachment on Y=1224 were deliberately retained.','Some protected or source-supported tiny fragments remain. No mask expansion was used to chase them.','Mask applies to optional 3D display and relevant density/shadow/cut-face paths only, never to 2D measured CT sections or raw data.'])
    (target/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps(dict(output=str(target.relative_to(ROOT)),masks=masks)),flush=True)


if __name__=='__main__':main()
