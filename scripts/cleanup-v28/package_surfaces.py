#!/usr/bin/env python3
"""Package reviewed local source surfaces; leave original meshes and banks exact."""
from pathlib import Path
import gzip,hashlib,json,shutil

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'public/assets/cleanup-v28'
DOCS=ROOT/'docs/cleanup-v28'
FINE='e50ab70a52373dc774cf6077ef906a753e56b78b9f9b646fba2ffe7220ff338c'
GENTLE='175548ddaad01c409d59d561df6018c5cb0c90752b2ec771899c255065398dae'
POLICIES=[
 'docs/cleanup-v28-left/patch/lvot-perivalvular-refinement-policy.json',
 'docs/cleanup-v28-right/patch/tricuspid-core-surface-policy.json',
 'docs/cleanup-v28-right/patch/pulmonary-valve-lumen-surface-policy.json',
]
sha=lambda b:hashlib.sha256(b).hexdigest()

def package():
    OUT.mkdir(parents=True,exist_ok=True);DOCS.mkdir(parents=True,exist_ok=True)
    assert sha((ROOT/'public/assets/ultra-volume-v7.json').read_bytes())==FINE
    fine=json.loads((ROOT/'public/assets/fine-surface-v23/manifest.json').read_text())
    assert next(x for x in fine['lods'] if x['id']=='gentle')['decodedSha256']==GENTLE
    patches=[];reports=[]
    for name in POLICIES:
        path=ROOT/name;policy=json.loads(path.read_text())
        assert policy['source']['sourceManifestSha256']==FINE
        assert policy['sourceSpacingUm']==79.4 and policy['sourceCalibratedHU'] is False
        assert policy['originalSourceModified'] is False and policy['unchangedBoxCollar'] is True
        assert policy['counts']['lostProtected135Samples']==policy['counts']['lostRaw190Samples']==0
        assert policy['counts']['boxBoundaryNonBaselineSamples']==0
        assert policy['surface']['format']=='HFM1-gzip'
        assert policy['inheritedDetachedDisplayCleanup']['largestProtected'] is True
        patch={k:policy[k] for k in ['id','lowerFullFineXYZ','upperFullFineXYZ']}
        patch['reviewPolicy']={'path':name,'sha256':sha(path.read_bytes())}
        patch['sourceSigmaFineSamples']=policy['sourceSigmaFineSamples']
        patch['baselineDisplayIntensity']=policy['baselineThreshold']
        patch['maximumReviewedDisplayIntensity']=policy['counts']['maximumLocalThreshold']
        patch['sourceCalibratedHU']=False
        for kind in ['surface','lowBandMask']:
            item=policy[kind];source=path.parent/item['file'];encoded=source.read_bytes()
            assert len(encoded)==item['compressedBytes'] and sha(encoded)==item['sha256']
            decoded=gzip.decompress(encoded)
            assert len(decoded)==item['decodedBytes'] and sha(decoded)==item['decodedSha256']
            target=OUT/item['file'];shutil.copyfile(source,target)
            patch[kind]={k:v for k,v in item.items() if k!='file'}
            patch[kind]['url']='./assets/cleanup-v28/'+target.name
        patches.append(patch)
        reports.append(dict(id=policy['id'],policy=patch['reviewPolicy'],counts=policy['counts'],
          inheritedDetachedDisplayCleanup=policy['inheritedDetachedDisplayCleanup'],meshReduction=policy['meshReduction'],
          sourceRoiSha256=policy['sourceRoiSha256'],sourcePaddedRoiSha256=policy['sourcePaddedRoiSha256']))
    decoded=sum(p[k]['decodedBytes'] for p in patches for k in ['surface','lowBandMask'])
    masks=sum(p['lowBandMask']['decodedBytes'] for p in patches)
    compressed=sum(p[k]['compressedBytes'] for p in patches for k in ['surface','lowBandMask'])
    assert decoded<=128*1024**2 and masks<=16*1024**2
    for i,a in enumerate(patches):
        for b in patches[i+1:]:
            assert any(a['upperFullFineXYZ'][d]<=b['lowerFullFineXYZ'][d] or b['upperFullFineXYZ'][d]<=a['lowerFullFineXYZ'][d] for d in range(3)),(a['id'],b['id'])
    manifest=dict(version=1,id='ladaf-reviewed-source-surfaces-v28',donorId='ladaf-2021-17',
      sourceManifestSha256=FINE,sourceMeshDecodedSha256=GENTLE,sourceSpacingUm=79.4,
      threshold=.28,extent=fine['extent'],patches=patches,
      activation='Atomic replacement only on the matching Ultra-high Fidelity surface with tissue, detached-debris and reviewed-lumen cleanup enabled. Original geometry remains available.',
      processing='Local source-gradient isosurfaces with serially reviewed intensity envelopes and smooth collars; compact detached fragments use the established display-cleanup rules.',
      limitations=['Windowed HiP-CT values are not calibrated Hounsfield units.','Original source arrays, CT cards and source mesh payloads remain unchanged.','Patch borders retain the original extraction isovalue but are not welded to the decimated original surface.','Preserved high-intensity cores and measured mesh-distance checks do not establish clinical anatomical validity.','These 79.4 µm patches do not add native 19.85 µm sampling.'])
    path=OUT/'surface-manifest.json';path.write_text(json.dumps(manifest,indent=2)+'\n')
    report=dict(manifestSha256=sha(path.read_bytes()),patches=reports,totalCompressedBytes=compressed,
      totalDecodedBytes=decoded,totalMaskBytes=masks,totalTriangles=sum(p['surface']['triangles'] for p in patches),
      originalSourceAndGeometryUnchanged=True,publicationState='Packaged; final visual and runtime validation required.')
    (DOCS/'surface-build.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k!='patches'},indent=2))

if __name__=='__main__':package()
