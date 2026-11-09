#!/usr/bin/env python3
"""Package the two verified right-side candidates for root canonical assembly."""
from pathlib import Path
import json,hashlib,shutil,gzip
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'public/assets/cleanup-v30-right'
DOC=ROOT/'docs/cleanup-v30-right/selected'
def sha(b):return hashlib.sha256(b).hexdigest()
def main():
 OUT.mkdir(parents=True,exist_ok=True);DOC.mkdir(parents=True,exist_ok=True)
 entries=[]
 for name in ['pa','rv']:
  folder=Path('/workspace/data/cleanup-v30-right')/(name+'-selected')
  policy=json.loads((folder/'policy.json').read_text())
  assert policy['inheritedPrior']['priorLowBandLostSamples']==0
  assert policy['inheritedPrior']['sourceFieldMaskDisagreementSamples']==0
  assert all(v['changed']==0 and v['maximumAbsoluteDelta']==0 for v in policy['sixFaceSignedFieldAudit'].values())
  assert policy['counts']['addedForeground']==0
  assert policy['surface']['format']=='HFM1-gzip'
  policy['builder']='scripts/cleanup-v30-right/build_regularized.py'
  policy['builderSha256']=sha((ROOT/policy['builder']).read_bytes())
  policy['configFile']='scripts/cleanup-v30-right/'+name+'-selected.json'
  policy['configSha256']=sha((ROOT/policy['configFile']).read_bytes())
  policy['reviewScope']='Complete retained half-space in exact-camera coronal190/188/192 and oblique views, sagittal293/285/301; current deployed seam-corrected Gentle normals. Original CT cap values preserved. Source-derived display cleanup, not a clinical segmentation.'
  entry={k:policy[k] for k in ['id','lowerFullFineXYZ','upperFullFineXYZ','sourceSigmaFineSamples','sourceCalibratedHU']}
  for kind in ['surface','lowBandMask']:
   asset=policy[kind].copy();file=asset.pop('file');encoded=(folder/file).read_bytes()
   assert len(encoded)==asset['compressedBytes'] and sha(encoded)==asset['sha256']
   decoded=gzip.decompress(encoded);assert len(decoded)==asset['decodedBytes'] and sha(decoded)==asset['decodedSha256']
   (OUT/file).write_bytes(encoded);asset['url']='./assets/cleanup-v30-right/'+file;entry[kind]=asset
  report=DOC/(policy['id']+'-policy.json');report.write_text(json.dumps(policy,indent=2)+'\n')
  entry.update(reviewPolicy={'path':str(report.relative_to(ROOT)),'sha256':sha(report.read_bytes())},baselineDisplayIntensity=71.4,maximumReviewedDisplayIntensity=175 if name=='pa' else 165)
  entries.append(entry)
 source=json.loads((ROOT/'public/assets/cleanup-v29/surface-manifest.json').read_text())['sourceMeshDecodedSha256']
 result={'schema':'cleanup-v30-right-manifest-entries-v1','sourceHfmDecodedSha256':source,'replacements':entries}
 (OUT/'manifest-entries.json').write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps({'manifest':str(OUT/'manifest-entries.json'),'decodedGpuBytes':sum(e['surface']['gpuBytes']+e['lowBandMask']['decodedBytes'] for e in entries),'compressedBytes':sum(e['surface']['compressedBytes']+e['lowBandMask']['compressedBytes'] for e in entries)},indent=2))
if __name__=='__main__':main()
