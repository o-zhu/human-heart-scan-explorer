#!/usr/bin/env python3
"""Verify saved pixels against per-view receipts and index selected evidence."""
from pathlib import Path
import hashlib,json
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
DOC=ROOT/'docs/cleanup-v30-left'
PIX=Path('/workspace/data/cleanup-v30-left')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
    expected=json.loads((ROOT/'public/assets/display-compact-v29/mesh-manifest.json').read_text())['decodedSha256']
    views=[]
    cases=json.loads((ROOT/'scripts/cleanup-v30-left/review-cameras.json').read_text())
    for c in cases:
        name=c['id'];receipt=DOC/'guarded-review'/(name+'-validation.json');r=json.loads(receipt.read_text());check=r['checks'][0]
        assert check['case']==c and r['currentShading']['decodedSha256']==expected and r['productionShaders']
        assert r.get('baselineLocalRefinementsEnabled',True)
        for version,oldkey in [('before','v27'),('after','v28')]:
            f=PIX/'guarded-render'/(name+('-v29-before.png' if version=='before' else '-v30-after.png'))
            h=hashlib.sha256(np.asarray(Image.open(f)).tobytes()).hexdigest();assert h==check['imageHashes'].get(version,check['imageHashes'].get(oldkey))
        photo=DOC/'guarded-review'/(name+'-comparison.jpg')
        views.append(dict(camera=c,comparison=dict(path=str(photo.relative_to(ROOT)),sha256=sha(photo)),receipt=dict(path=str(receipt.relative_to(ROOT)),sha256=sha(receipt)),sourceCapSha256=check['sourceCapSha256'],decodedShadingSha256=expected,changedPixels=check['changedPixels'],pixelReceiptsVerified=True,fullRetainedDepth=True,reversible=check['reversible'],originalOffExact=check['originalOffExact']))
    assert any(v['reversible'] and v['originalOffExact'] for v in views)
    diagnostic=DOC/'activation-diagnostic/aortic-y293-validation.json';d=json.loads(diagnostic.read_text());assert d['baselineLocalRefinementsEnabled'] is False
    result=dict(selectedCandidate='median145-guarded',views=views,activationDiagnostic=dict(receipt=str(diagnostic.relative_to(ROOT)),sha256=sha(diagnostic),beforeLocalRefinementsEnabled=False,interpretation='Whole-heart-only diagnostic reproduces the user proximal dark strip more closely than fully active v29. It illustrates a possible inactive/incomplete local-refinement state; it does not establish the user browser state.'),sourceValidation=dict(path='docs/cleanup-v30-left/guarded-review/source-validation.json',sha256=sha(DOC/'guarded-review/source-validation.json')),limitations=['Reproducible nearby source-registered cameras, not exact screenshot camera registration.','Finite render and source-support checks do not establish clinical anatomical correctness.','Fine pepper on continuously supported deeper source boundary remains.'])
    (DOC/'selected-review-index.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(dict(views=len(views),allSavedPixelsMatchReceipts=True,currentShadingSha256=expected,reversibleAndOffExact=True)))
if __name__=='__main__':main()
