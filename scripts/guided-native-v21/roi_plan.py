#!/usr/bin/env python3
"""Census a whole-organ coarse isosurface into native N5 block/Blosc-stream ROIs.

Only locally available data are read. The returned masks cover mixed threshold
cells in a smoothed prior, widened by explicit registration/denoising margins.
They are proposals, not evidence of native acquisition or native completeness.
"""
from __future__ import annotations
import argparse
import glob
import json
import math
import os
import time
from pathlib import Path
import numpy as np
from scipy.ndimage import gaussian_filter


def parse_args():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', default='/workspace/scratch/7d584d74921e/fine-surface-v19/fine-source-padded.npy')
    p.add_argument('--out', default='/workspace/data/guided-native-v21/roi_census')
    p.add_argument('--bands-um', type=float, nargs='+', default=[0, 79.4, 158.8, 317.6])
    p.add_argument('--threshold', type=float, default=.28)
    p.add_argument('--sigma', type=float, default=.8)
    p.add_argument('--registration-halo', type=float, default=4)
    p.add_argument('--denoise-halo', type=float, default=4)
    p.add_argument('--slab', type=int, default=32)
    p.add_argument('--thin-guard', action='store_true', help='Union unsmoothed .28 and smoothed .20 interfaces.')
    p.add_argument('--limit-slabs', type=int, default=0, help='Diagnostic partial census only; 0 covers all source.')
    return p.parse_args()


def atomic_json(path, value):
    tmp=Path(str(path)+'.tmp')
    tmp.write_text(json.dumps(value, indent=2)+'\n')
    os.replace(tmp, path)


def mixed_cells(values, threshold):
    high=values >= threshold
    low=high[:-1,:-1,:-1].copy()
    any_=low.copy()
    for dz,dy,dx in [(0,0,1),(0,1,0),(0,1,1),(1,0,0),(1,0,1),(1,1,0),(1,1,1)]:
        v=high[dz:high.shape[0]-1+dz,dy:high.shape[1]-1+dy,dx:high.shape[2]-1+dx]
        low &= v
        any_ |= v
    return any_ & ~low


def scatter_boxes(mask, coords, extra_native, origin_zyx, ratio_zyx, bin_zyx, dims_zyx):
    # A mixed prior cell maps to a native-space AABB. Cover every intersected bin,
    # including intervals longer than one quarter; this is not corner-only sampling.
    lows=[]; highs=[]
    for a in range(3):
        center=(coords[a]+origin_zyx[a]+.5)*ratio_zyx[a]-.5
        lo=np.floor((center-extra_native)/bin_zyx[a]).astype(np.int32)
        hi=np.floor((center+ratio_zyx[a]+extra_native)/bin_zyx[a]).astype(np.int32)
        lows.append(np.clip(lo,0,mask.shape[a]-1))
        highs.append(np.clip(hi,0,mask.shape[a]-1))
    for iz in range(int(np.max(highs[0]-lows[0],initial=0))+1):
        z=lows[0]+iz; zv=z<=highs[0]
        for iy in range(int(np.max(highs[1]-lows[1],initial=0))+1):
            y=lows[1]+iy; yv=zv & (y<=highs[1])
            for ix in range(int(np.max(highs[2]-lows[2],initial=0))+1):
                x=lows[2]+ix; valid=yv & (x<=highs[2])
                mask[z[valid],y[valid],x[valid]]=True


def mask_stats(mask, dims_zyx, ratio_estimate):
    coords=np.column_stack(np.nonzero(mask)).astype(np.int32)
    sizes=np.minimum(np.array([32,128,128]),np.asarray(dims_zyx)-coords*np.array([32,128,128]))
    raw_bytes=int(np.prod(sizes,axis=1,dtype=np.int64).sum()*2)
    full=np.zeros((math.ceil(dims_zyx[0]/128),mask.shape[1],mask.shape[2]),bool)
    full[coords[:,0]//4,coords[:,1],coords[:,2]]=True
    fc=np.column_stack(np.nonzero(full)).astype(np.int32)
    fs=np.minimum(128,np.asarray(dims_zyx)-fc*128)
    fullraw=int(np.prod(fs,axis=1,dtype=np.int64).sum()*2)
    return {'quarter_count':int(mask.sum()),'block_count':int(full.sum()),
            'raw_stream_bytes':raw_bytes,'raw_whole_block_bytes':fullraw,
            'estimated_encoded_stream_bytes':int(raw_bytes*ratio_estimate),
            'estimated_encoded_whole_block_bytes':int(fullraw*ratio_estimate),
            'quarter_savings_vs_whole_blocks_fraction':1-raw_bytes/fullraw if fullraw else 0,
            'fraction_total_native_raw':raw_bytes/(np.prod(dims_zyx,dtype=np.int64)*2)},coords,fc


def main():
    a=parse_args(); out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
    source=np.load(a.source,mmap_mode='r')
    dims=np.array([8480,7614,7614]); prior_dims=np.array([2120,1903,1903]);origin=np.array([59,355,443])
    ratio=dims/prior_dims; bins=np.array([32,128,128]); grid=tuple(np.ceil(dims/bins).astype(int))
    bands=list(a.bands_um)
    masks={f'band_{b:g}um':np.zeros(grid,bool) for b in bands}
    if a.thin_guard: masks['thin_guard_158.8um']=np.zeros(grid,bool)
    cache_files=glob.glob('/workspace/data/native-surface-v20/chunks-s0/*.n5')
    compression=[(os.path.getsize(p)-16)/(128**3*2) for p in cache_files]
    estimate=float(np.mean(compression)) if compression else .81
    start=time.time(); totalcells=0; guardcells=0; slabs=math.ceil((source.shape[0]-1)/a.slab)
    plane_cells=np.zeros(source.shape[0]-1,np.int64)
    plane_bounds=np.full((source.shape[0]-1,4),-1,np.int32)
    halo=max(4,math.ceil(3*a.sigma)+1)
    for si,z0 in enumerate(range(0,source.shape[0]-1,a.slab)):
        if a.limit_slabs and si>=a.limit_slabs:break
        z1=min(source.shape[0]-1,z0+a.slab)
        lo=max(0,z0-halo);hi=min(source.shape[0],z1+halo+1)
        filtered=gaussian_filter(np.asarray(source[lo:hi],dtype=np.float32),sigma=a.sigma,truncate=3.,mode='constant',cval=0.)
        core=filtered[z0-lo:z1-lo+1]
        mixed=mixed_cells(core,255*a.threshold)
        guard=None
        if a.thin_guard:
            guard=mixed | mixed_cells(core,255*.20) | mixed_cells(np.asarray(source[z0:z1+1]),255*a.threshold)
        for z in range(z1-z0):
            yy,xx=np.nonzero(mixed[z]);plane_cells[z0+z]=len(yy)
            if len(yy):plane_bounds[z0+z]=[int(xx.min()),int(yy.min()),int(xx.max()+1),int(yy.max()+1)]
        z,y,x=np.nonzero(mixed);z+=z0;coords=(z,y,x);totalcells+=len(z)
        if len(z):
            for b in bands:
                extra=b/19.85+a.registration_halo+a.denoise_halo
                scatter_boxes(masks[f'band_{b:g}um'],coords,extra,origin,ratio,bins,dims)
        if guard is not None:
            gz,gy,gx=np.nonzero(guard);gz+=z0;guardcells+=len(gz)
            if len(gz):scatter_boxes(masks['thin_guard_158.8um'],(gz,gy,gx),158.8/19.85+a.registration_halo+a.denoise_halo,origin,ratio,bins,dims)
        progress={'complete':False,'slabs_done':si+1,'slabs_total':slabs,'prior_z_completed':z1,
                  'elapsed_seconds':round(time.time()-start,2),'mixed_cells':totalcells,
                  'current_quarters':{name:int(m.sum()) for name,m in masks.items()}}
        atomic_json(out/'progress.json',progress)
        if si%4==0 or si==slabs-1:print(json.dumps(progress),flush=True)
        del filtered,core,mixed,guard,coords,z,y,x
    complete=not a.limit_slabs or a.limit_slabs>=slabs
    report={'schema':'guided-native-roi-v21.1','complete_whole_prior_census':complete,
            'source':a.source,'source_shape_zyx':list(source.shape),'prior_origin_xyz':origin[::-1].tolist(),
            'prior_full_dimensions_xyz':prior_dims[::-1].tolist(),'native_dimensions_xyz':dims[::-1].tolist(),
            'native_spacing_um':19.85,'native_full_raw_bytes':int(np.prod(dims,dtype=np.int64)*2),
            'native_full_block_count':60*60*67,'native_full_quarter_count':60*60*265,
            'mapping':'native_index=(prior_index+0.5)*(native_dimensions/prior_dimensions)-0.5',
            'mapping_caveat':'Approximate pyramid center-resize alignment; locally validated by parent. Registration halo remains explicit; old display dimensions must not be used.',
            'threshold_windowed':a.threshold,'threshold_raw_equivalent':14640+a.threshold*(23545-14640),
            'prior_gaussian_sigma_voxels':a.sigma,'registration_halo_native_voxels':a.registration_halo,
            'denoise_halo_native_voxels':a.denoise_halo,'mixed_surface_cells':totalcells,'thin_guard_surface_cells':guardcells,
            'compressed_ratio_estimate':estimate,'compression_sample_blocks':len(compression),
            'compression_caveat':'Estimate from four adjacent cached interior blocks; not a whole-organ measured encoded-byte census. Excludes small headers and HTTP overhead.',
            'coverage_caveat':'Covers current prior isosurfaces, including internal cavities. Cleaned sparse prior may omit disconnected tissue or features below prior resolution; native-only features outside fetched bands need a separate uncertainty/audit pass.',
            'elapsed_seconds':round(time.time()-start,2),'plans':{}}
    arrays={'prior_slice_mixed_cell_counts':plane_cells,'prior_slice_surface_bounds_xyxy':plane_bounds}
    for name,mask in masks.items():
        stats,q,b=mask_stats(mask,dims,estimate)
        report['plans'][name]=stats
        arrays[name]=mask
        # On-disk coordinates: native N5 x/y/z block address and quarter index.
        plan=np.column_stack((q[:,2],q[:,1],q[:,0]//4,q[:,0]%4)).astype(np.uint16)
        np.save(out/(name+'-quarters-xyzq.npy'),plan)
        np.save(out/(name+'-blocks-xyz.npy'),b[:,::-1].astype(np.uint16))
        arrays[name+'_per_quarter_z_xy_count']=mask.sum(axis=(1,2)).astype(np.uint16)
    np.savez_compressed(out/'occupancy.npz',**arrays)
    atomic_json(out/'census.json',report)
    atomic_json(out/'progress.json',{'complete':complete,'elapsed_seconds':round(time.time()-start,2),'plans':report['plans']})
    print(json.dumps(report,indent=2),flush=True)

if __name__=='__main__':main()
