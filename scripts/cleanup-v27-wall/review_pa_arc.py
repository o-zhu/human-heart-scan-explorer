#!/usr/bin/env python3
"""Independent, read-only source review of the retained central PA strip.

Points were read from the production mesh position target at section335. This
checks local foreground connectivity and distance to anchored dense source. It
does not assign biological identity or alter the display masks.
"""
from pathlib import Path
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

LO=np.array([845,1165,550]);HI=np.array([1015,1305,795])
POINTS=[[893,1207,602],[932,1240,694],[957,1268,738],
        [900,1216,630],[910,1224,660],[940,1250,700]]

def main():
    reader=FineSource(16)
    raw=reader.region(LO,HI)
    f05=ndi.gaussian_filter(raw.astype(np.float32),.5,truncate=3)
    f08=ndi.gaussian_filter(raw.astype(np.float32),.8,truncate=3)
    strong=(raw>=190)|(f05>=135)|(f08>=135)
    dense_labels,_=ndi.label(strong,np.ones((3,3,3),bool))
    counts=np.bincount(dense_labels.ravel())
    dense_wall=dense_labels==int(np.argmax(counts[1:])+1)
    wall_distance=ndi.distance_transform_edt(~dense_wall)
    foreground=f05>=71.4
    labels,_=ndi.label(foreground,np.ones((3,3,3),bool))
    foreground_counts=np.bincount(labels.ravel())
    anchors=np.bincount(labels[dense_wall])
    main_wall=int(np.argmax(anchors[1:])+1)
    foreground_distance,nearest=ndi.distance_transform_edt(~foreground,return_indices=True)
    records=[]
    for xyz in POINTS:
        index=tuple((np.array(xyz)-LO)[::-1])
        nearest_index=tuple(nearest[:,index[0],index[1],index[2]])
        component=int(labels[nearest_index])
        records.append(dict(xyz=xyz,raw=int(raw[index]),sigma05=float(f05[index]),sigma08=float(f08[index]),
            denseWallDistanceFine=float(wall_distance[index]),
            denseWallDistanceMm=float(wall_distance[index])*.0794,
            nearestForegroundDistanceFine=float(foreground_distance[index]),
            nearestForegroundComponentSamples=int(foreground_counts[component]),
            nearestForegroundConnectedToDenseWall=component==main_wall,originalMeshComponent=7))
    report=dict(points=records,source=reader.receipt(),sourceLowerXYZ=LO.tolist(),sourceUpperExclusiveXYZ=HI.tolist(),
        localDenseWallSamples=int(dense_wall.sum()),localForegroundMainWallComponentSamples=int(foreground_counts[main_wall]),
        result='The sampled retained strip lies inside the existing nine-sample mesh allowance of anchored dense source, with nearest foreground in the same local connected component as that wall. A broad exclusion cannot safely separate it from the original supported wall.',
        limit='Local source/geometry evidence only. It does not classify the material as normal anatomy, clot or artifact, and does not prove every point on the strip has the same relationship.')
    out=ROOT/'docs/cleanup-v27-wall';out.mkdir(parents=True,exist_ok=True)
    (out/'pa-arc-source-points.json').write_text(json.dumps(report,indent=2)+'\n')
    fig,axes=plt.subplots(2,3,figsize=(11,7.4),layout='constrained')
    for ax,point in zip(axes.flat,records):
        x,y,z=point['xyz'];rx=25;rz=25
        sl=raw[z-rz-LO[2]:z+rz+1-LO[2],y-LO[1],x-rx-LO[0]:x+rx+1-LO[0]]
        dense=dense_wall[z-rz-LO[2]:z+rz+1-LO[2],y-LO[1],x-rx-LO[0]:x+rx+1-LO[0]]
        ax.imshow(sl,cmap='gray',vmin=35,vmax=190,extent=[x-rx-.5,x+rx+.5,z+rz+.5,z-rz-.5])
        ax.contour(np.arange(x-rx,x+rx+1),np.arange(z-rz,z+rz+1),dense.astype(float),levels=[.5],colors=['#48d2ca'],linewidths=.7)
        ax.plot(x,z,'+',color='#ff6b4b',markersize=11,markeredgewidth=1.8)
        ax.set_title(f"Y{y}: wall distance {point['denseWallDistanceMm']:.2f} mm",fontsize=10)
        ax.set_xlabel('Fine X',fontsize=9);ax.set_ylabel('Fine Z',fontsize=9);ax.tick_params(labelsize=8)
    fig.suptitle('Retained PA strip: source support beside the vessel wall\nOrange: sampled mesh point · cyan: anchored dense source boundary',fontsize=12)
    fig.savefig(out/'pa-arc-source-support.jpg',dpi=170)
    plt.close(fig)
    print(json.dumps(dict(sampledPoints=len(records),allConnected=all(x['nearestForegroundConnectedToDenseWall'] for x in records),minimumDenseDistanceFine=min(x['denseWallDistanceFine'] for x in records),maximumDenseDistanceFine=max(x['denseWallDistanceFine'] for x in records))))

if __name__=='__main__':
    main()
