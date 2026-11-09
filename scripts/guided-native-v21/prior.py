#!/usr/bin/env python3
"""Read the existing cleaned 79.4 µm prior through a small verified brick cache.

The 2.8 GB assembled temporary array is not needed by the native run. Every
requested prior sample comes from the existing manifest-indexed display bank.
This is a geometric guide; it is never relabeled as original native data.
"""
from collections import OrderedDict
import gzip
import hashlib
import json
from pathlib import Path

import numpy as np
from scipy.ndimage import gaussian_filter

ROOT = Path(__file__).resolve().parents[2]
NATIVE_DIMS = np.array([7614,7614,8480],np.float64)
PRIOR_DIMS = np.array([1903,1903,2120],np.float64)
RATIO = NATIVE_DIMS / PRIOR_DIMS


class PriorReader:
    def __init__(self, cache_blocks=24):
        self.manifest = json.loads((ROOT/'public/assets/ultra-volume-v7.json').read_text())
        self.origin = np.array(self.manifest['sourceOriginXYZ'],np.int64)
        self.shape = np.array(self.manifest['sourceShapeXYZ'],np.int64)
        self.counts = np.array(self.manifest['brickCountsXYZ'],np.int64)
        self.directory = ROOT/'data/ultra-volume-v7'
        self.cache_blocks = cache_blocks
        self.cache = OrderedDict()

    def brick(self, coord):
        key = tuple(map(int,coord))
        if key in self.cache:
            self.cache.move_to_end(key)
            return self.cache[key]
        index = key[0]+self.counts[0]*(key[1]+self.counts[1]*key[2])
        record = self.manifest['blocks'].get(str(index))
        if record is None:
            values = None
        else:
            encoded = (self.directory/record['path']).read_bytes()
            if hashlib.sha256(encoded).hexdigest() != record['sha256']:
                raise ValueError('Prior compressed brick hash mismatch')
            raw = gzip.decompress(encoded)
            if len(raw) != 65**3 or hashlib.sha256(raw).hexdigest() != record['rawSha256']:
                raise ValueError('Prior decoded brick hash mismatch')
            values = np.frombuffer(raw,np.uint8).reshape(65,65,65)
        self.cache[key] = values
        while len(self.cache) > self.cache_blocks:
            self.cache.popitem(last=False)
        return values

    def read(self, origin_xyz, shape_xyz):
        origin = np.asarray(origin_xyz,np.int64)
        shape = np.asarray(shape_xyz,np.int64)
        result = np.zeros(tuple(shape[::-1]),np.uint8)
        lower = np.maximum(origin,self.origin)
        upper = np.minimum(origin+shape,self.origin+self.shape)
        if np.any(upper <= lower):
            return result
        b0 = (lower-self.origin)//64
        b1 = (upper-1-self.origin)//64
        for z in range(b0[2],b1[2]+1):
            for y in range(b0[1],b1[1]+1):
                for x in range(b0[0],b1[0]+1):
                    c = np.array([x,y,z])
                    values = self.brick(c)
                    if values is None:
                        continue
                    start = self.origin+64*c
                    lo = np.maximum(lower,start)
                    hi = np.minimum(upper,start+64)
                    src = tuple(slice(int(a),int(b)) for a,b in zip((lo-start)[::-1],(hi-start)[::-1]))
                    dst = tuple(slice(int(a),int(b)) for a,b in zip((lo-origin)[::-1],(hi-origin)[::-1]))
                    result[dst] = values[src]
        return result

    def context(self, native_origin_xyz, native_shape_zyx, margin=8, sigma=.8):
        native_origin = np.asarray(native_origin_xyz,np.int64)
        native_shape = np.asarray(native_shape_zyx[::-1],np.int64)
        first = (native_origin+.5)/RATIO-.5
        last = (native_origin+native_shape-1+.5)/RATIO-.5
        lower = np.floor(first).astype(np.int64)-margin
        upper = np.ceil(last).astype(np.int64)+margin+1
        raw = self.read(lower,upper-lower)
        smoothed = gaussian_filter(raw.astype(np.float32), sigma=sigma, truncate=3., mode='constant', cval=0.)
        return raw,smoothed,lower


def sample_on_native_grid(values, prior_origin_xyz, native_origin_xyz, native_shape_zyx):
    """Separable trilinear sampling with globally identical axis calculations.

    Computing each axis from its original integer native index avoids tile-local
    affine roundoff changing an interpolated boundary sample between neighbors.
    """
    prior_origin = np.asarray(prior_origin_xyz,np.int64)
    native_origin = np.asarray(native_origin_xyz,np.int64)
    indices = []
    weights = []
    for axis,n in enumerate(native_shape_zyx[::-1]):
        global_index = np.arange(native_origin[axis],native_origin[axis]+n,dtype=np.float64)
        p = (global_index+.5)/RATIO[axis]-.5-prior_origin[axis]
        i = np.floor(p).astype(np.int64)
        if i.min(initial=0) < 0 or i.max(initial=0)+1 >= values.shape[2-axis]:
            raise ValueError('Prior interpolation context is too small')
        indices.append(i)
        weights.append((p-i).astype(np.float32))
    ix,iy,iz = indices
    wx,wy,wz = weights
    x = values[:,:,ix]*(1-wx)[None,None,:] + values[:,:,ix+1]*wx[None,None,:]
    y = x[:,iy,:]*(1-wy)[None,:,None] + x[:,iy+1,:]*wy[None,:,None]
    z = y[iz,:,:]*(1-wz)[:,None,None] + y[iz+1,:,:]*wz[:,None,None]
    return np.asarray(z,np.float32)
