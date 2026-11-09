#!/usr/bin/env python3
"""Review-only, reversible masks of two screenshot-identified material patches.

The material is present in measured data. These are *display exclusions*, not
anatomical labels or assertions of artifact identity. Source volumes remain
unchanged. An ellipsoidal review envelope restricts seeded low-signal material;
the envelope alone never selects a voxel. Strong structures anchored outside
the envelope and a surrounding guard are protected. Masks are retained locally
for review before publication.
"""
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

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/fine-detail-v23'))
from source import FineSource

CASES=[
    dict(id='outflow',lower=[900,940,230],upper=[1130,1150,420],
         envelopes=[dict(center=[1005,1030,310],radius=[90,65,60])],
         seeds=[[980,1030,298],[1010,1040,320]],
         axis=0,planes=[940,980,1020]),
    dict(id='atrial',lower=[1140,1100,690],upper=[1320,1250,850],
         envelopes=[dict(center=[1235,1182,762],radius=[53,42,44])],
         reviewedLimits=[[1207,1100,690],[1320,1250,800]],
         seeds=[[1230,1184,760]],
         axis=1,planes=[1144,1184,1224]),
]


def sphere(radius):
    a=np.arange(-radius,radius+1)
    z,y,x=np.meshgrid(a,a,a,indexing='ij')
    return x*x+y*y+z*z<=radius*radius


def build():
    out=ROOT/'docs/lumen-artifacts-v23/candidates'
    out.mkdir(parents=True,exist_ok=True)
    reader=FineSource(cache_bricks=16); entries=[]
    for case in CASES:
        lo,hi=np.array(case['lower']),np.array(case['upper'])
        raw=reader.region(lo,hi)
        field=ndi.gaussian_filter(raw.astype(np.float32),.8,truncate=3)
        strong=(field>=135)|(raw>=190)
        envelope=np.zeros(raw.shape,bool)
        z,y,x=np.ogrid[lo[2]:hi[2],lo[1]:hi[1],lo[0]:hi[0]]
        for item in case['envelopes']:
            c,r=np.array(item['center']),np.array(item['radius'])
            envelope |= ((x-c[0])/r[0])**2+((y-c[1])/r[1])**2+((z-c[2])/r[2])**2<=1
        if 'reviewedLimits' in case:
            lower,upper=case['reviewedLimits']
            envelope &= (x>=lower[0])&(x<upper[0])&(y>=lower[1])&(y<upper[1])&(z>=lower[2])&(z<upper[2])
        # Strong structures anchored outside the reviewed object envelope are
        # protected with a 0.318-mm guard. Isolated bright specks entirely within
        # the candidate material do not become artificial floating leftovers.
        strong_labels,strong_n=ndi.label(strong,structure=np.ones((3,3,3),bool))
        anchored_ids=np.unique(strong_labels[~envelope]);anchored_ids=anchored_ids[anchored_ids!=0]
        anchored_strong=np.isin(strong_labels,anchored_ids)
        del strong_labels
        # The gentler v23 surface uses sigma0.5. Preserve any additional strong
        # attachment it resolves as well; this can only reduce the exclusion.
        field05=ndi.gaussian_filter(raw.astype(np.float32),.5,truncate=3)
        strong05=(field05>=135)|(raw>=190)
        labels05,n05=ndi.label(strong05,structure=np.ones((3,3,3),bool))
        ids05=np.unique(labels05[~envelope]);ids05=ids05[ids05!=0]
        anchored05=np.isin(labels05,ids05)
        del field05,strong05,labels05
        protected=ndi.binary_dilation(anchored_strong|anchored05,structure=sphere(4))
        candidates=(field>=.28*255)&envelope&~protected
        labels,n=ndi.label(candidates,structure=np.ones((3,3,3),bool))
        chosen=set(); seed_report=[]
        for seed in case['seeds']:
            p=np.array(seed)-lo; q=p[::-1]
            crop=tuple(slice(max(0,int(i-8)),min(n,int(i+9))) for i,n in zip(q,raw.shape))
            local_labels=labels[crop]
            weights=np.bincount(local_labels.ravel())
            if len(weights)>1:
                weights[0]=0; selected=int(np.argmax(weights)); chosen.add(selected)
            else:selected=0
            seed_report.append(dict(fullFineXYZ=seed,selectedComponent=selected))
        core=np.isin(labels,list(chosen))
        # Extend through the subvoxel surface boundary, but never through the
        # strong-source protection or the reviewed envelope.
        mask=ndi.binary_dilation(core,structure=sphere(2))&envelope&~protected
        selected_source=raw[core]
        blob=gzip.compress(np.ascontiguousarray(mask.astype(np.uint8)).tobytes(),compresslevel=9,mtime=0)
        path=out/(case['id']+'-candidate-mask.raw.gz')
        if path.exists():
            previous=np.frombuffer(gzip.decompress(path.read_bytes()),np.uint8).reshape(mask.shape)!=0
            assert not np.any(mask&~previous),'Compatibility revision must not expand the reviewed exclusion.'
        path.write_bytes(blob)
        report=dict(id=case['id'],boundsFullFineXYZ=[lo.tolist(),hi.tolist()],dimensionsXYZ=(hi-lo).tolist(),
                    format='gzip-u8-zyx',valueMeaning={'0':'show original material','1':'hide reviewed candidate material in optional 3D display'},
                    file=str(path.relative_to(ROOT)),sha256=hashlib.sha256(blob).hexdigest(),rawSha256=hashlib.sha256(mask.astype(np.uint8).tobytes()).hexdigest(),bytes=len(blob),
                    coreVoxels=int(core.sum()),maskedVoxels=int(mask.sum()),protectedVoxels=int(protected.sum()),
                    maskedStrongSourceVoxels=int((mask&strong).sum()),maskedAnchoredStrongSourceVoxels=int((mask&anchored_strong).sum()),maskedAnchoredSigma05StrongVoxels=int((mask&anchored05).sum()),maskedProtectionVoxels=int((mask&protected).sum()),
                    sourceCorePercentiles=np.percentile(selected_source,[0,10,25,50,75,90,100]).tolist() if len(selected_source) else [],
                    sourceCoreMean=float(selected_source.mean()) if len(selected_source) else None,
                    seedSelection=seed_report,envelopes=case['envelopes'],reviewedLimits=case.get('reviewedLimits'),strongComponents=int(strong_n),protectedStrongComponents=int(len(anchored_ids)))
        entries.append(report)
        shown=[i for i in range(3) if i!=case['axis']]
        fig,axes=plt.subplots(2,3,figsize=(12,10),constrained_layout=True)
        for col,coordinate in enumerate(case['planes']):
            axis=2-case['axis']; index=coordinate-lo[case['axis']]
            p=np.take(raw,index,axis=axis); m=np.take(mask,index,axis=axis); pr=np.take(protected,index,axis=axis)
            extent=[lo[shown[0]],hi[shown[0]],hi[shown[1]],lo[shown[1]]]
            for row in range(2):
                ax=axes[row,col];ax.imshow(p,cmap='gray',vmin=0,vmax=255,extent=extent)
                ax.set_title(f"{'XYZ'[case['axis']]}={coordinate} · {'measured source' if row==0 else 'candidate display mask (coral)'}")
                if row:
                    rgba=np.zeros((*m.shape,4));rgba[m]=[1,.15,.08,.65]
                    ax.imshow(rgba,extent=extent)
                    ax.contour(np.arange(lo[shown[0]],hi[shown[0]]),np.arange(lo[shown[1]],hi[shown[1]]),pr,levels=[.5],colors=['#71afec'],linewidths=.25)
                ax.set_xlabel(f"Source {'xyz'[shown[0]]} (79.4 µm voxels)");ax.set_ylabel(f"Source {'xyz'[shown[1]]}")
        fig.suptitle(f"{case['id'].title()}: candidate material display exclusion — review only\nCoral: seeded candidate material; blue: anchored high-intensity source + 0.318 mm guard. Original source is unchanged.",fontsize=11)
        fig.savefig(out/(case['id']+'-mask-source-review.png'),dpi=145);plt.close(fig)
        print(json.dumps(report),flush=True)
        del raw,field,strong,anchored_strong,anchored05,protected,envelope,candidates,labels,core,mask
    manifest=dict(status='review-only',defaultEnabled=False,source=reader.receipt(),
                  disclaimer='Measured intraluminal material of uncertain identity. Not proven acquisition artifact. Exclusions are optional 3D display controls; all quantitative data and 2D source sections stay unchanged.',
                  policy=dict(fieldGaussianSigmaFineVoxels=.8,fieldThreshold=.28*255,strongFilteredValue=135,strongRawValue=190,strongProtection='Every strong-signal connected component extending outside the reviewed object envelope, plus guard, using the union from sigma0.8 and sigma0.5 fields. Bright isolated specks wholly within candidate material may be included.',compatibilityProtectionSigmas=[.8,.5],strongProtectionRadiusFineVoxels=4,maskBoundaryRadiusFineVoxels=2,connectivity=26,selection='Connected source foreground touching reviewed seeds within local ellipsoidal envelopes; anchored strong structures and neighborhoods excluded. Atrial long sheet and all attachments outside compact round-nodule envelope preserved. No global component or chamber deletion.'),masks=entries)
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')


if __name__=='__main__':build()
