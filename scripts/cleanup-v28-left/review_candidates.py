#!/usr/bin/env python3
"""Independent serial-source comparison of frozen and proposed sheet display."""
from pathlib import Path
import hashlib
import importlib.util
import json
import sys
import numpy as np
from scipy import ndimage as ndi
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/fine-detail-v23'))
from source import FineSource
from selections import OPERATIONS
from build import signed_fields,interpolate,bbox_slice
spec=importlib.util.spec_from_file_location('v27_source_review_reference',ROOT/'scripts/cleanup-v27/source_review.py')
baseline=importlib.util.module_from_spec(spec);spec.loader.exec_module(baseline)

def main():
    out=ROOT/'docs/cleanup-v28-left/candidate-review';out.mkdir(parents=True,exist_ok=True)
    reader=FineSource(cache_bricks=32);_,items=baseline.load_masks('v27')
    records=[]
    plane_lists={
      'pulmonary-vein-complete-sheet':[1216,1248,1260,1288,1300,1308,1320,1332],
      'appendage-complete-free-sheet':[1232,1248,1260,1276,1292,1304,1312],
      'atrial-inlet-early-continuation':[756,764,780,796,812,820,828,840,848,856],
    }
    for op in OPERATIONS:
        file=ROOT/'docs/cleanup-v28-left/candidates'/(op['id']+'-selection.npz')
        loaded=np.load(file);lo=loaded['lowerXYZ'];hi=loaded['upperXYZ'];bits=loaded['mask']
        fields=signed_fields(op['polygons'],lo,hi)
        sums=dict(previouslyVisibleCoreSourceSamples=0,newlyHiddenCoreSourceSamples=0,remainingCoreSourceSamples=0,uniqueAdditionalMaskSamples=0)
        serial=[]
        for y in range(int(lo[1]),int(hi[1])):
            a=lo.copy();b=hi.copy();a[1]=y-3;b[1]=y+4
            raw=reader.region(a,b);source=raw[:,3,:]
            f05=ndi.gaussian_filter(raw.astype(np.float32),.5,truncate=3)[:,3,:]
            old=baseline.plane_mask(items,lo,hi,y)
            new=bits[:,y-lo[1],:]
            core=(interpolate(fields,y)<=0)&(f05>=71.4)
            previous=core&~old
            record=dict(y=y,previouslyVisibleCoreSourceSamples=int(previous.sum()),newlyHiddenCoreSourceSamples=int(np.count_nonzero(previous&new)),remainingCoreSourceSamples=int(np.count_nonzero(previous&~new)),uniqueAdditionalMaskSamples=int(np.count_nonzero(new&~old)))
            for key in sums:sums[key]+=record[key]
            if y in plane_lists[op['id']]:
                serial.append(record)
                fig,ax=plt.subplots(1,1,figsize=(10,7),constrained_layout=True)
                extent=[lo[0],hi[0]-1,hi[2]-1,lo[2]]
                ax.imshow(source,cmap='gray',vmin=25,vmax=205,extent=extent,interpolation='nearest')
                rgba=np.zeros((*old.shape,4));rgba[old]=[1,.33,.05,.18];rgba[new&~old]=[.05,.8,1,.5]
                ax.imshow(rgba,extent=extent,interpolation='nearest')
                ax.contour(np.arange(lo[0],hi[0]),np.arange(lo[2],hi[2]),interpolate(fields,y),levels=[0],colors=['#ffef7d'],linewidths=.5)
                ax.set(title=f"{op['id']} · fine Y={y} (section {y/4+1:g})\nOrange: frozen v27 · Cyan: added exclusion · Yellow: reviewed object contour",xlabel='Fine X',ylabel='Fine Z')
                ax.grid(alpha=.18)
                fig.savefig(out/(op['id']+f'-y{y}.jpg'),dpi=130);plt.close(fig)
        fraction=sums['newlyHiddenCoreSourceSamples']/max(1,sums['previouslyVisibleCoreSourceSamples'])
        records.append(dict(operation=op['id'],**sums,newlyHiddenFractionOfPreviouslyVisibleSelectedCoreSource=round(fraction,6),serialChecks=serial,selectionSha256=hashlib.sha256(file.read_bytes()).hexdigest()))
    report=dict(source=reader.receipt(),comparisons=records,scope='Source-space display exclusion and retained core contrast. This does not establish anatomical identity or prove final mesh fidelity; production rendering is a separate gate.')
    (out/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))

if __name__=='__main__':main()
