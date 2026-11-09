#!/usr/bin/env python3
"""Check frozen masks against the new sigma0.5 source contour, without expanding them."""
from pathlib import Path
import gzip
import hashlib
import json
import sys
import numpy as np
from scipy import ndimage as ndi
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/fine-detail-v23'))
sys.path.insert(0,str(Path(__file__).parent))
from source import FineSource
from build_candidate_masks import CASES,sphere


def main():
    public=ROOT/'public/assets/lumen-cleanup-v23/manifest.json'
    manifest=json.loads(public.read_text())
    reader=FineSource(cache_bricks=16);checks=[]
    fig,axes=plt.subplots(1,2,figsize=(10,6),constrained_layout=True)
    for column,case in enumerate(CASES):
        item=next(i for i in manifest['masks'] if i['id']==case['id'])
        blob=(ROOT/'public'/item['url'].removeprefix('./')).read_bytes()
        assert hashlib.sha256(blob).hexdigest()==item['sha256']
        rawmask=gzip.decompress(blob)
        assert hashlib.sha256(rawmask).hexdigest()==item['decodedSha256']
        mask=np.frombuffer(rawmask,np.uint8).reshape(item['dimensionsXYZ'][::-1])!=0
        lo,hi=np.array(case['lower']),np.array(case['upper'])
        raw=reader.region(lo,hi)
        field08=ndi.gaussian_filter(raw.astype(np.float32),.8,truncate=3)
        field05=ndi.gaussian_filter(raw.astype(np.float32),.5,truncate=3)
        z,y,x=np.ogrid[lo[2]:hi[2],lo[1]:hi[1],lo[0]:hi[0]]
        envelope=np.zeros(raw.shape,bool)
        for e in case['envelopes']:
            c,r=np.array(e['center']),np.array(e['radius'])
            envelope|=((x-c[0])/r[0])**2+((y-c[1])/r[1])**2+((z-c[2])/r[2])**2<=1
        if 'reviewedLimits' in case:
            a,b=case['reviewedLimits'];envelope&=(x>=a[0])&(x<b[0])&(y>=a[1])&(y<b[1])&(z>=a[2])&(z<b[2])
        strong05=(field05>=135)|(raw>=190)
        lab,n=ndi.label(strong05,structure=np.ones((3,3,3),bool))
        ids=np.unique(lab[~envelope]);ids=ids[ids!=0]
        anchored05=np.isin(lab,ids);del lab
        protected05=ndi.binary_dilation(anchored05,structure=sphere(4))
        eligible05=(field05>=.28*255)&envelope&~protected05
        labels,n=ndi.label(eligible05,structure=np.ones((3,3,3),bool))
        chosen=set()
        for seed in case['seeds']:
            q=(np.array(seed)-lo)[::-1]
            crop=tuple(slice(max(0,int(i-8)),min(n,int(i+9))) for i,n in zip(q,raw.shape))
            weights=np.bincount(labels[crop].ravel())
            if len(weights)>1:
                weights[0]=0;chosen.add(int(np.argmax(weights)))
        core05=np.isin(labels,list(chosen))
        allcandidate=int(core05.sum());unmasked=int((core05&~mask).sum())
        # Quantitative boundary support rather than a claim that the entire
        # organ's fine structures are classified or anatomically validated.
        boundary05=core05&~ndi.binary_erosion(core05,structure=ndi.generate_binary_structure(3,1))
        boundary_total=int(boundary05.sum());boundary_masked=int((boundary05&mask).sum())
        check=dict(id=case['id'],sourceSigmaFineVoxels=.5,sourceThreshold=.28,
                   selectedCandidateVoxels=allcandidate,selectedCandidateCoveredVoxels=allcandidate-unmasked,
                   selectedCandidateCoverage=(allcandidate-unmasked)/allcandidate,
                   candidateBoundaryVoxels=boundary_total,candidateBoundaryCoveredVoxels=boundary_masked,
                   candidateBoundaryCoverage=boundary_masked/boundary_total,
                   maskedAnchoredStrongSigma05Voxels=int((mask&anchored05).sum()),
                   maskedGuardSigma05Voxels=int((mask&protected05).sum()),
                   outsideReviewedEnvelopeMaskedVoxels=int((mask&~envelope).sum()),
                   maskExpanded=False)
        check['protectionCompatible']=check['maskedAnchoredStrongSigma05Voxels']==0
        check['scopeCompatible']=check['outsideReviewedEnvelopeMaskedVoxels']==0
        check['candidateCoverageAbove99Percent']=check['selectedCandidateCoverage']>.99
        if case['id']=='atrial':
            check['thinAttachmentPlaneY1224MaskedVoxels']=int(mask[:,1224-lo[1],:].sum())
            check['longSheetZ800AndBeyondMaskedVoxels']=int(mask[800-lo[2]:].sum())
            assert check['thinAttachmentPlaneY1224MaskedVoxels']==0
            assert check['longSheetZ800AndBeyondMaskedVoxels']==0
        checks.append(check)
        axis=2-case['axis'];index=case['planes'][1]-lo[case['axis']]
        plane=np.take(raw,index,axis=axis)
        p05,p08,pm=[np.take(a,index,axis=axis) for a in [field05,field08,mask]]
        shown=[i for i in range(3) if i!=case['axis']]
        extent=[lo[shown[0]],hi[shown[0]],hi[shown[1]],lo[shown[1]]]
        ax=axes[column];ax.imshow(plane,cmap='gray',vmin=0,vmax=255,extent=extent)
        rgba=np.zeros((*pm.shape,4));rgba[pm]=[1,.15,.08,.4];ax.imshow(rgba,extent=extent)
        coords=[np.arange(lo[i],hi[i]) for i in shown]
        ax.contour(*coords,p08,levels=[.28*255],colors=['#65ce8c'],linewidths=.5)
        ax.contour(*coords,p05,levels=[.28*255],colors=['#7ac8ff'],linewidths=.5)
        ax.set_title(case['id'].title()+' candidate at screenshot plane')
        ax.set_xlabel(f"Full fine source {'xyz'[shown[0]]}");ax.set_ylabel('Full fine source z')
        print(json.dumps(check),flush=True)
    fig.suptitle('Frozen display masks against gentler source filtering\nCoral: optional exclusion. Green: σ0.8 contour. Blue: σ0.5 contour. No mask expansion.',fontsize=11)
    fig.savefig(ROOT/'docs/lumen-artifacts-v23/sigma05-source-compatibility.png',dpi=150);plt.close(fig)
    report=dict(passed=all(c['protectionCompatible'] and c['scopeCompatible'] and c['candidateCoverageAbove99Percent'] for c in checks),source=reader.receipt(),manifestSha256=hashlib.sha256(public.read_bytes()).hexdigest(),checks=checks,
                scope='Local candidate-mask/source-contour correspondence and protection checks only. New whole-organ mesh visual verification is separate. Material identity remains unknown.')
    (ROOT/'docs/lumen-artifacts-v23/sigma05-source-compatibility.json').write_text(json.dumps(report,indent=2)+'\n')


if __name__=='__main__':main()
