#!/usr/bin/env python3
"""Independent source-only review; never edits production selections or assets.

The counterfactual omits one tiny threshold component to measure its halo's
influence. It is a diagnostic, not an accepted cleanup or tissue classification.
"""
from pathlib import Path
import hashlib
import json
import sys

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT/'scripts/fine-detail-v23'))
from source import FineSource
sys.path.insert(0, str(ROOT/'scripts/cleanup-v27'))
from build_masks import signed_fields, interpolate
from reviewed_selections import OPERATIONS

SELECTION = Path('{source-cache}/cleanup-v27/tricuspid-chordal-fringe-selection.npz')
LOCATION_MAP = Path('{source-cache}/cleanup-v27-wall/tricuspid-222-v26-locations.npz')
TARGETS = [
    ('island-a', [855, 839, 1157]),
    ('island-b', [873, 881, 1231]),
]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def mask_with_guard(guard):
    result = np.zeros(tuple((hi-lo)[::-1]), bool)
    for y in range(int(lo[1]), int(hi[1])):
        j = y-a[1]
        field = interpolate(fields, y)
        if field is None:
            continue
        allowed = (field <= op['expansion']) & ~guard[:,j,:]
        labels, _ = ndi.label(allowed, np.ones((3,3), bool))
        seeds = np.unique(labels[(field <= 0) & ~guard[:,j,:]])
        seeds = seeds[seeds != 0]
        chosen = allowed & support[:,j,:] & np.isin(labels, seeds)
        result[:,y-lo[1],:] = chosen[pad:-pad,pad:-pad]
    return result


def local_connectivity(center, island):
    radius = 24
    low = center-radius
    high = center+radius+1
    sl = tuple(slice(int(x),int(y)) for x,y in zip((low-a)[::-1],(high-a)[::-1]))
    local = f05[sl]
    local_island = island[sl]
    local_large = large[sl]
    seed_candidates = np.argwhere(local_island)
    seed = tuple(seed_candidates[np.argmax(local[local_island])])
    records = []
    for threshold in [71.4,80,90,100,110,120,130,135]:
        for neighbors in [6,26]:
            structure = ndi.generate_binary_structure(3, 1 if neighbors == 6 else 3)
            ids, _ = ndi.label(local >= threshold, structure)
            label = int(ids[seed])
            part = ids == label if label else np.zeros(local.shape,bool)
            touches = []
            for axis, name in enumerate(['Z','Y','X']):
                if np.take(part,0,axis=axis).any(): touches.append(name+'-')
                if np.take(part,-1,axis=axis).any(): touches.append(name+'+')
            records.append(dict(sigma05Threshold=threshold, neighbors=neighbors,
                seedAboveThreshold=bool(label), connectedSamples=int(part.sum()),
                reachesCropFaces=touches,
                intersectsStrongComponentAtLeast128Samples=bool((part&local_large).any())))
    return dict(lowerXYZ=low.tolist(), upperXYZ=high.tolist(),
                seedXYZ=(np.array(seed)[::-1]+low).tolist(), levels=records)


def serial_plot(name, center, island):
    radius = 28
    offsets = [-8,-4,0,4,8]
    fig, axes = plt.subplots(3,5,figsize=(15,9.5),layout='constrained')
    for row,(fixed,ax0,ax1) in enumerate([(1,0,2),(0,1,2),(2,0,1)]):
        for col,offset in enumerate(offsets):
            p = center.copy();p[fixed] += offset
            low=center-radius;high=center+radius+1
            low[fixed]=p[fixed];high[fixed]=p[fixed]+1
            sl=tuple(slice(int(x),int(y)) for x,y in zip((low-a)[::-1],(high-a)[::-1]))
            # Squeezing ZYX keeps the remaining axes in reversed XYZ order.
            img=raw[sl].squeeze();fg=(f05[sl]>=71.4).squeeze()
            dense=strong[sl].squeeze();tiny=island[sl].squeeze()
            ax=axes[row,col]
            extent=(low[ax0]-.5,high[ax0]-.5,high[ax1]-.5,low[ax1]-.5)
            ax.imshow(img,cmap='gray',vmin=0,vmax=220,extent=extent,interpolation='nearest')
            xx=np.arange(low[ax0],high[ax0]);zz=np.arange(low[ax1],high[ax1])
            if fg.any() and not fg.all(): ax.contour(xx,zz,fg,levels=[.5],colors=['#31cad4'],linewidths=.55)
            if dense.any() and not dense.all(): ax.contour(xx,zz,dense,levels=[.5],colors=['#f6a649'],linewidths=.6)
            if tiny.any(): ax.contour(xx,zz,tiny,levels=[.5],colors=['#ff3fb8'],linewidths=1.6)
            ax.plot(center[ax0],center[ax1],'+',color='#ff3fb8',markersize=7,markeredgewidth=.8)
            ax.set_title(f"{'XYZ'[fixed]} = {p[fixed]}",fontsize=10)
            ax.set_xlabel('XYZ'[ax0],fontsize=8);ax.set_ylabel('XYZ'[ax1],fontsize=8)
            ax.tick_params(labelsize=7)
    fig.suptitle(f"{name}: dense threshold island at {center.tolist()} | 79.4 µm display-source grid\n"
                 "Grayscale: source 0–220 | cyan: sigma0.5 ≥71.4 | orange: dense rule | magenta: reviewed tiny island",
                 fontsize=12)
    fig.savefig(OUT/(name+'-serial-source.jpg'),dpi=150,pil_kwargs={'quality':92})
    plt.close(fig)


reader=FineSource(cache_bricks=16)
op=next(x for x in OPERATIONS if x['id']=='tricuspid-chordal-fringe')
saved=np.load(SELECTION);lo=saved['lowerXYZ'];hi=saved['upperXYZ'];selected=saved['mask'];pad=13
a=lo-pad;b=hi+pad
raw=reader.region(a,b)
f05=ndi.gaussian_filter(raw.astype(np.float32),.5,truncate=3)
f08=ndi.gaussian_filter(raw.astype(np.float32),.8,truncate=3)
strong=(raw>=190)|(f05>=135)|(f08>=135)
labels,n=ndi.label(strong,np.ones((3,3,3),bool))
sizes=np.bincount(labels.ravel())
large=(sizes[labels]>=128)&strong
distance,nearest=ndi.distance_transform_edt(~strong,return_indices=True)
large_distance=ndi.distance_transform_edt(~large)
support=ndi.distance_transform_edt(~(f05>=71.4))<=9
fields=signed_fields(op['polygons'],a,b)
current=mask_with_guard(distance<=10)
assert np.array_equal(current,selected), 'The source/recipe no longer matches the saved selection.'

locations=np.load(LOCATION_MAP)['locations']
rounded=np.floor(locations[:,:,:3]+.5).astype(int)
valid=(locations[:,:,3]>0)&np.all(rounded>=lo,axis=2)&np.all(rounded<hi,axis=2)
visible=rounded[valid]
visible_index=tuple((visible-lo).T[::-1])
components=locations[:,:,3][valid].astype(int)-1

records=[]
for name,target in TARGETS:
    target=np.array(target);q=tuple((target-a)[::-1])
    nearest_zyx=tuple(int(t[q]) for t in nearest)
    label=int(labels[nearest_zyx]);island=labels==label
    coords=np.argwhere(island);xyz=coords[:,::-1]+a
    center=np.rint(xyz.mean(axis=0)).astype(int)
    other=strong&~island
    other_distance=ndi.distance_transform_edt(~other)
    counter=mask_with_guard(other_distance<=10)
    extra=counter&~current
    assert not (current&~counter).any()
    local_pixels=np.linalg.norm(visible-target,axis=1)<=15
    visible_extra=extra[visible_index]
    all_extra_xyz=np.argwhere(extra)[:,::-1]+lo
    foreground_connectivity=local_connectivity(center,island)
    record=dict(id=name,targetXYZ=target.tolist(),thresholdIslandXYZ=xyz.tolist(),
        localStrongComponentId=label,strongComponentSamples=int(sizes[label]),
        sourceValues=[dict(xyz=(p[::-1]+a).tolist(),raw=int(raw[tuple(p)]),
                          sigma05=float(f05[tuple(p)]),sigma08=float(f08[tuple(p)])) for p in coords],
        distanceAtTargetToAnyDenseCore=float(distance[q]),
        distanceAtTargetToOtherDenseCore=float(other_distance[q]),
        distanceAtTargetToDenseComponentAtLeast128Samples=float(large_distance[q]),
        minimumIslandDistanceToOtherDenseCore=float(other_distance[island].min()),
        minimumIslandDistanceToDenseComponentAtLeast128Samples=float(large_distance[island].min()),
        foregroundConnectivity=foreground_connectivity,
        hypotheticalOmitOnlyThisThresholdIsland=dict(
            additionalSelectedFineSamples=int(extra.sum()),
            boundsXYZ=[all_extra_xyz.min(axis=0).tolist(),(all_extra_xyz.max(axis=0)+1).tolist()] if extra.any() else None,
            additionalV26FirstSurfacePixels=int(visible_extra.sum()),
            additionalMainComponent7Pixels=int((visible_extra&(components==7)).sum()),
            additionalPixelsWithin15FineSamplesOfTarget=int((visible_extra&local_pixels).sum()),
            originalRetainedPixelsWithin15FineSamplesOfTarget=int((local_pixels&~current[visible_index]).sum())),
        guardChanged=False,productionSelectionChanged=False,
        classification='Undetermined; inspect serial source and connectivity evidence before any selection.')
    records.append(record)
    serial_plot(name,center,island)
    print(json.dumps({k:v for k,v in record.items() if k not in ('foregroundConnectivity','sourceValues')}),flush=True)

result=dict(source=reader.receipt(),sourceBoundsXYZ=[a.tolist(),b.tolist()],
    sourceRawSha256=hashlib.sha256(raw.tobytes()).hexdigest(),
    sampledForegroundThreshold=71.4,denseRule='raw>=190 OR Gaussian(sigma0.5)>=135 OR Gaussian(sigma0.8)>=135; truncate3',
    sourceArrayAxes='ZYX',coordinates='Full original fine-grid XYZ sample indices; 79.4 µm spacing',
    selectionFileSha256=sha(SELECTION),locationMapSha256=sha(LOCATION_MAP),
    reviewedOperationSha256=hashlib.sha256(json.dumps(op,sort_keys=True,separators=(',',':')).encode()).hexdigest(),
    fullOperationVsSavedSlabSelectionDifferingSamples=int(np.count_nonzero(current!=selected)),
    productionSelectionChanged=False,sourceValuesChanged=False,records=records,
    limitations=['Display-encoded source, not original quantitative acquisition intensities.',
                 'Local threshold connectivity does not identify chordae, tissue, clot or artifact.',
                 'Counterfactual removal of dense islands is diagnostic only; current guard remains unchanged.',
                 'Pixel counts use the old v26 first visible surface map and exclude newly exposed deeper surfaces.'])
(OUT/'tricuspid-island-review.json').write_text(json.dumps(result,indent=2)+'\n')
