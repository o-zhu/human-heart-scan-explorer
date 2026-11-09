#!/usr/bin/env python3
"""Native, finite-halo surface refinement guided by the existing whole heart.

The prior selects neighborhoods and supplies a continuous far field. The native
field uses fixed-iteration total variation denoising. Actual original s0 samples
are required throughout the filter dependency of every nonzero native weight.
"""
from __future__ import annotations

import json
from pathlib import Path
import resource
import time

import numpy as np
from scipy.ndimage import distance_transform_edt, maximum_filter
from tv_kernel import denoise_tv_chambolle

from edge_codec import encode_native_edges, edge_slices
from prior import PriorReader, sample_on_native_grid

_PRIOR = None


def mixed_cells(values, threshold):
    high = values >= threshold
    all_high = high[:-1,:-1,:-1].copy()
    any_high = all_high.copy()
    for z in range(2):
        for y in range(2):
            for x in range(2):
                a = high[z:z+high.shape[0]-1,y:y+high.shape[1]-1,x:x+high.shape[2]-1]
                all_high &= a
                any_high |= a
    return any_high & ~all_high


def guide_for_core(core_origin, config):
    global _PRIOR
    if _PRIOR is None:
        _PRIOR = PriorReader(cache_blocks=24)
    raw, smooth, origin = _PRIOR.context(core_origin,(129,129,129),margin=8,sigma=.8)
    mixed = mixed_cells(smooth,255*.28)
    if config.get('thinGuard',True):
        mixed |= mixed_cells(raw,255*.28)
        mixed |= mixed_cells(smooth,255*.20)
    corners = np.zeros(raw.shape,bool)
    for z in range(2):
        for y in range(2):
            for x in range(2):
                corners[z:z+mixed.shape[0],y:y+mixed.shape[1],x:x+mixed.shape[2]] |= mixed
    if corners.any():
        distance = distance_transform_edt(~corners).astype(np.float32)
        distance = sample_on_native_grid(distance,origin,core_origin,(129,129,129))*4
        inner = float(config.get('nativeBandInnerVoxels',8))
        outer = float(config.get('nativeBandOuterVoxels',12))
        u = np.clip((outer-distance)/(outer-inner),0,1)
        weight = u*u*(3-2*u)
    else:
        weight = np.zeros((129,129,129),np.float32)
    prior = sample_on_native_grid(smooth,origin,core_origin,(129,129,129))
    prior = np.float32(14640) + prior*np.float32((23545-14640)/255)
    return prior,weight


def missing_source_blocks(valid, weight, core_origin, halo):
    demand = np.zeros_like(valid)
    core = (slice(halo,halo+129),)*3
    demand[core] = weight > 0
    # TV's finite local dependency is bounded by this conservative cube.
    wanted = maximum_filter(demand,size=2*halo+1,mode='constant',cval=False)
    missing = wanted & ~valid
    if not missing.any():
        return []
    origin = np.asarray(core_origin)-halo
    end = origin+np.array(valid.shape[::-1])
    result = []
    block = np.asarray(core_origin)//128
    for dz in (-1,0,1):
        for dy in (-1,0,1):
            for dx in (-1,0,1):
                c = block+np.array([dx,dy,dz])
                lo = np.maximum(c*128,origin)
                hi = np.minimum(c*128+128,end)
                if np.any(hi <= lo):
                    continue
                s = tuple(slice(int(a),int(b)) for a,b in zip((lo-origin)[::-1],(hi-origin)[::-1]))
                if missing[s].any():
                    if np.any(c < 0) or np.any(c >= np.array([60,60,67])):
                        raise ValueError('Requested native filter context exceeds the observed source')
                    result.append(c.tolist())
    return result


def process_tile(raw, valid, core_xyz, halo, outdir, config):
    start = time.monotonic()
    core_origin = np.asarray(core_xyz,np.int64)*128
    if raw.shape != (129+2*halo,)*3 or valid.shape != raw.shape:
        raise ValueError('Native tile halo geometry differs from its configuration')
    iterations = int(config.get('tvIterations',16))
    if halo < iterations:
        raise ValueError('TV iteration dependency exceeds the supplied native halo')
    prior, weight = guide_for_core(core_origin,config)
    missing = missing_source_blocks(valid,weight,core_origin,halo)
    if missing:
        return dict(needsSource=missing)
    core = (slice(halo,halo+129),)*3
    if weight.any():
        filtered = denoise_tv_chambolle(raw.astype(np.float32),
            weight=float(config.get('tvWeightRaw',800)), eps=0,
            max_num_iter=iterations, channel_axis=None)
        field = prior+weight*(filtered[core]-prior)
        del filtered
    else:
        field = prior
    field = np.ascontiguousarray(field,np.float32)
    threshold = float(np.float32(config.get('thresholdRaw',17133.4)))
    if abs(threshold-17133.4) > .01:
        raise ValueError('This audited guide is defined only for raw threshold 17133.4')
    empty = bool(field.min() >= threshold or field.max() < threshold)
    name = '_'.join(map(str,core_xyz))
    output = Path(outdir)
    artifacts = []
    native_meta = None
    contribution = dict(nativeOnlyEdgeVertices=0,blendedEdgeVertices=0,priorOnlyEdgeVertices=0)
    if not empty:
        signs = field >= threshold
        for axis in range(3):
            a,b = edge_slices(axis)
            crossing = signs[a] != signs[b]
            wa,wb = weight[a][crossing],weight[b][crossing]
            native_only = (wa == 1) & (wb == 1)
            prior_only = (wa == 0) & (wb == 0)
            contribution['nativeOnlyEdgeVertices'] += int(native_only.sum())
            contribution['priorOnlyEdgeVertices'] += int(prior_only.sum())
            contribution['blendedEdgeVertices'] += int(len(wa)-native_only.sum()-prior_only.sum())
        path = output/(name+'.nbe.gz')
        native_meta = encode_native_edges(field,core_origin,path,threshold=threshold)
        artifacts.append(dict(path='tiles/'+path.name,role='native',**native_meta))
    # A separate, explicitly coarser display LOD. The native bank above retains
    # all standard marching-cubes cells; this auxiliary LOD is never the archive.
    lod_path = output/(name+'.lod.nbe.gz')
    lod_meta = encode_native_edges(field[::4,::4,::4],core_origin,lod_path,
        threshold=threshold,step=4)
    artifacts.append(dict(path='tiles/'+lod_path.name,role='overview',**lod_meta))
    return dict(empty=empty,artifacts=artifacts,
        nativeVertices=0 if native_meta is None else native_meta['vertices'],
        nativeTriangles=0 if native_meta is None else native_meta['triangles'],
        nativeWeightNonzeroPoints=int(np.count_nonzero(weight)),
        nativeWeightFullPoints=int(np.count_nonzero(weight == 1)),
        coreSamples=129**3,nativeSourceSamplingPreserved=True,
        surfaceContribution=contribution,
        seconds=time.monotonic()-start,
        peakWorkerRssMiB=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024)
