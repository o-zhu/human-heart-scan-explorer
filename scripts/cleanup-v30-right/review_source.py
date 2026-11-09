#!/usr/bin/env python3
"""Plot measured serial display samples, never modify the source bank."""
from pathlib import Path
import argparse, json, sys
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/fine-detail-v23'))
from source import FineSource

def main():
    p=argparse.ArgumentParser();p.add_argument('--axis',type=int,default=0);p.add_argument('--indices',default='600,640,680,720,760,800');p.add_argument('--lower',default='570,1000,480');p.add_argument('--upper',default='830,1440,1030');p.add_argument('--name',default='pulmonary-serial');a=p.parse_args()
    lower=np.array(list(map(int,a.lower.split(','))));upper=np.array(list(map(int,a.upper.split(','))));indices=list(map(int,a.indices.split(',')))
    fine=FineSource(cache_bricks=12);cols=3;rows=(len(indices)+2)//3
    fig,axs=plt.subplots(rows,cols,figsize=(15,5.3*rows),squeeze=False)
    other=[i for i in range(3) if i!=a.axis];extent=[lower[other[0]],upper[other[0]],upper[other[1]],lower[other[1]]]
    records=[]
    for ax,coordinate in zip(axs.ravel(),indices):
        lo=lower.copy();hi=upper.copy();lo[a.axis]=coordinate;hi[a.axis]=coordinate+1
        raw=np.take(fine.region(lo.tolist(),hi.tolist()),0,axis=2-a.axis)
        ax.imshow(raw,cmap='gray',vmin=0,vmax=255,extent=extent,interpolation='nearest');ax.set_title('XYZ'[a.axis]+' = '+str(coordinate)+' · measured display samples')
        ax.set_xlabel('XYZ'[other[0]]+' fine index');ax.set_ylabel('XYZ'[other[1]]+' fine index')
        records.append(dict(axis=a.axis,coordinate=coordinate,lower=lo.tolist(),upper=hi.tolist(),min=int(raw.min()),max=int(raw.max()),percentiles=np.percentile(raw,[5,25,50,75,95]).tolist()))
    for ax in axs.ravel()[len(indices):]:ax.axis('off')
    fig.suptitle('Original 79.4 µm windowed display source · not calibrated Hounsfield units',fontsize=15);fig.tight_layout()
    out=ROOT/'docs/cleanup-v30-right/source';out.mkdir(parents=True,exist_ok=True);fig.savefig(out/(a.name+'.png'),dpi=120);plt.close(fig)
    (out/(a.name+'.json')).write_text(json.dumps(dict(slices=records,source=fine.receipt(),sourceUnchanged=True),indent=2)+'\n')
if __name__=='__main__':main()
