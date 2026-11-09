#!/usr/bin/env python3
"""Bounded source review for the user-requested extended lumen cleanup."""
from pathlib import Path
import sys
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/fine-detail-v23'))
from source import FineSource
OUT=ROOT/'docs/cleanup-v25'
OUT.mkdir(parents=True,exist_ok=True)

def main():
    r=FineSource(cache_bricks=16)
    cases=[('atrial-y',1,[1040,1080,1120,1152,1184,1216,1236,1260,1280,1320,1360,1400],[1060,500],[1490,1170]),
           ('outflow-y',1,[1000,1040,1080,1120,1160,1200,1240,1280,1320,1360,1400,1440],[700,100],[1250,730])]
    for name,axis,coordinates,lower,upper in cases:
        fig,axes=plt.subplots(3,4,figsize=(15,19),constrained_layout=True)
        shown=[i for i in range(3) if i!=axis]
        for ax,c in zip(axes.flat,coordinates):
            lo=np.zeros(3,dtype=int);hi=lo.copy()
            lo[shown]=lower;hi[shown]=upper;lo[axis]=c;hi[axis]=c+1
            p=np.take(r.region(lo,hi),0,axis=2-axis)
            ax.imshow(p,cmap='gray',vmin=40,vmax=200,extent=[lower[0],upper[0],upper[1],lower[1]],interpolation='nearest')
            ax.set(title=f'{"XYZ"[axis]}={c} · section {c/4+1:g}/475',xlabel=f'Fine {"xyz"[shown[0]]}',ylabel=f'Fine {"xyz"[shown[1]]}')
            ax.grid(alpha=.15)
        fig.suptitle('Measured 79.4 µm display source · '+name+' · review only',fontsize=15)
        fig.savefig(OUT/(name+'.jpg'),dpi=145);plt.close(fig)
        print(name,flush=True)

if __name__=='__main__':main()
