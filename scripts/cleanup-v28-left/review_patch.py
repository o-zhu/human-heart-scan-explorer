#!/usr/bin/env python3
"""Inspect local LVOT intensity boundaries without editing measured CT."""
from pathlib import Path
import argparse,importlib.util,json,sys
import numpy as np
from scipy import ndimage as ndi
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/fine-detail-v23'))
from source import FineSource
spec=importlib.util.spec_from_file_location('v28_adaptive_patch_reference',ROOT/'scripts/cleanup-v28-right/adaptive_patch.py')
patch=importlib.util.module_from_spec(spec);spec.loader.exec_module(patch)

def main(config_path=None,output=None):
    config=json.loads(Path(config_path or ROOT/'scripts/cleanup-v28-left/lvot-patch-config.json').read_text())
    fields=patch.fields_for(config);lo=np.array(config['lowerXYZ']);hi=np.array(config['upperXYZ'])
    out=Path(output or ROOT/'docs/cleanup-v28-left/patch-review');out.mkdir(parents=True,exist_ok=True)
    reader=FineSource(16);records=[]
    for y in [980,1000,1020,1044,1060,1080]:
        a=lo.copy();b=hi.copy();a[1]=y-3;b[1]=y+4
        raw=reader.region(a,b);source=raw[:,3,:];f=ndi.gaussian_filter(raw.astype(np.float32),.5,truncate=3)[:,3,:]
        threshold=patch.threshold_plane(config,fields,y)
        threshold=np.minimum(threshold,np.where(source>=190,np.maximum(patch.BASE,f-1e-3),255))
        old=f>=patch.BASE;new=f>=threshold;removed=old&~new;strong=f>=135
        assert not (strong&~new).any()
        fig,ax=plt.subplots(1,1,figsize=(7,10),constrained_layout=True)
        extent=[lo[0],hi[0]-1,hi[2]-1,lo[2]]
        ax.imshow(source,cmap='gray',vmin=25,vmax=205,extent=extent,interpolation='nearest')
        rgba=np.zeros((*source.shape,4));rgba[removed]=[.05,.8,1,.48]
        ax.imshow(rgba,extent=extent,interpolation='nearest')
        ax.contour(np.arange(lo[0],hi[0]),np.arange(lo[2],hi[2]),f-threshold,levels=[0],colors=['#ffef7d'],linewidths=.55)
        ax.set(title=f'LVOT refined source boundary · Y={y}, section {y/4+1:g}\nCyan: low-contrast fringe · Yellow: new source surface',xlabel='Fine X',ylabel='Fine Z')
        ax.grid(alpha=.15);fig.savefig(out/f'lvot-y{y}.jpg',dpi=130);plt.close(fig)
        records.append(dict(y=y,sourcePlaneSha256=patch.sha(np.ascontiguousarray(source)),originalForeground=int(old.sum()),refinedForeground=int(new.sum()),removedForeground=int(removed.sum()),protected135Samples=int(strong.sum()),lostProtected135Samples=int((strong&~new).sum()),maximumThreshold=float(threshold.max())))
    (out/'validation.json').write_text(json.dumps(dict(source=reader.receipt(),serial=records,scope='Serial display-isovalue review, not tissue classification or clinical validation.'),indent=2)+'\n')
    print(json.dumps(records,indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--config',type=Path)
    parser.add_argument('--output',type=Path)
    args=parser.parse_args()
    main(args.config,args.output)
