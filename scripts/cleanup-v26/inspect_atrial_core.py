#!/usr/bin/env python3
"""Inspect the remaining user-selected intraluminal atrial object in source planes."""
from pathlib import Path
import sys,numpy as np,json
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from scipy import ndimage as ndi
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/fine-detail-v23'))
from source import FineSource
reader=FineSource(cache_bricks=16)
lo=np.array([1170,1120,800]);hi=np.array([1430,1265,1060])
raw=reader.region(lo,hi);f=ndi.gaussian_filter(raw.astype(np.float32),.5,truncate=3)
fig,axes=plt.subplots(2,6,figsize=(20,8))
fig.suptitle('Residual LA core: original 79.4 µm source; cyan contour at sigma0.5 = 71.4',fontsize=15)
for ax,y in zip(axes.ravel(),[1140,1152,1168,1184,1196,1200,1208,1216,1228,1240,1252,1260]):
 ax.imshow(raw[:,y-lo[1],:],cmap='gray',vmin=20,vmax=190,extent=[lo[0],hi[0],hi[2],lo[2]])
 ax.contour(np.arange(lo[0],hi[0]),np.arange(lo[2],hi[2]),f[:,y-lo[1],:],[71.4],colors=['cyan'],linewidths=.5)
 ax.set_title(f'Fine Y {y}');ax.grid(alpha=.15)
fig.tight_layout();fig.savefig(ROOT/'docs/cleanup-v26/atrial-core-source.jpg',dpi=130);plt.close(fig)
(ROOT/'docs/cleanup-v26/atrial-core-source.json').write_text(json.dumps(reader.receipt(),indent=2)+'\n')
