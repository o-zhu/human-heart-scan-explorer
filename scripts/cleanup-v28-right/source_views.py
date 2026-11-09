#!/usr/bin/env python3
"""Bounded source review for user-requested PA/chordal cleanup.

All coordinates are immutable full fine-grid XYZ; source data are mapped
display intensities, not calibrated Hounsfield units. This script only reads.
"""
from pathlib import Path
import os,sys,json
os.environ.setdefault('OPENBLAS_NUM_THREADS','1')
os.environ.setdefault('OMP_NUM_THREADS','1')
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from scipy import ndimage as ndi
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/fine-detail-v23'))
from source import FineSource
OUT=ROOT/'docs/cleanup-v28-right/source'
OUT.mkdir(parents=True,exist_ok=True)
reader=FineSource(16)

def plane(axis,index,lower,upper):
    a=np.array(lower); b=np.array(upper); a[axis]=index; b[axis]=index+1
    raw=reader.region(a,b)
    return np.squeeze(raw,axis=2-axis)

def serial(axis,indices,lower,upper,name,cols=3):
    rows=(len(indices)+cols-1)//cols
    fig,axs=plt.subplots(rows,cols,figsize=(6*cols,7*rows),squeeze=False)
    horiz=1 if axis==0 else 0; vert=2
    for ax,index in zip(axs.ravel(),indices):
        raw=plane(axis,index,lower,upper)
        ax.imshow(raw,cmap='gray',vmin=35,vmax=180,extent=[lower[horiz],upper[horiz],upper[vert],lower[vert]])
        ax.set_title(f'Fine {"XYZ"[axis]}={index}; card section {index/4+1:g}')
        ax.set_xlabel('XYZ'[horiz]);ax.set_ylabel('Z')
        ax.grid(alpha=.2,color='cornflowerblue');ax.set_xticks(np.arange((lower[horiz]//100+1)*100,upper[horiz],100));ax.set_yticks(np.arange((lower[vert]//100+1)*100,upper[vert],100))
    for ax in list(axs.ravel())[len(indices):]:ax.set_visible(False)
    fig.suptitle(name+' — immutable 79.4 µm mapped source; display window35–180',fontsize=15)
    fig.tight_layout();fig.savefig(OUT/(name+'.jpg'),dpi=125);plt.close(fig)

if __name__=='__main__':
    serial(0,[744,772,800],[0,650,300],[1,1450,1300],'pa-x194-overview')
    serial(0,[1220,1248,1276],[0,650,300],[1,1450,1300],'pa-x313-overview')
    serial(1,[960,1004,1048],[400,0,900],[1150,1,1700],'tricuspid-y263-overview')
    (OUT/'receipt.json').write_text(json.dumps(reader.receipt(),indent=2)+'\n')
