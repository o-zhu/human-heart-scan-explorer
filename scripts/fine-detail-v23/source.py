"""Bounded reads of the existing, immutable LADAF 79.4 µm display bank.

Coordinates are full fine-grid XYZ integer sample indices. Returned arrays are
ZYX. The bank's nonoverlapping 64³ cores own shared samples; absent/outside
samples use its documented zero background. Both stored and decoded checksums
are checked before a brick is consumed. No new full-volume array is assembled.
"""
from __future__ import annotations

from collections import OrderedDict
import gzip
import hashlib
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]


class FineSource:
    def __init__(self, cache_bricks=64):
        self.manifest_path = ROOT / 'public/assets/ultra-volume-v7.json'
        encoded = self.manifest_path.read_bytes()
        self.manifest_sha256 = hashlib.sha256(encoded).hexdigest()
        self.meta = json.loads(encoded)
        assert self.manifest_sha256 == 'e50ab70a52373dc774cf6077ef906a753e56b78b9f9b646fba2ffe7220ff338c'
        assert self.meta['sourceSpacingUm'] == 79.4
        assert self.meta['emptyValue'] == 0 and self.meta['brickSize'] == 64 and self.meta['storedEdge'] == 65
        self.origin = np.asarray(self.meta['sourceOriginXYZ'], dtype=np.int64)
        self.shape = np.asarray(self.meta['sourceShapeXYZ'], dtype=np.int64)
        self.counts = np.asarray(self.meta['brickCountsXYZ'], dtype=np.int64)
        self.full = np.asarray(self.meta['fullDimensionsXYZ'], dtype=np.int64)
        self.spacing_mm = self.meta['sourceSpacingUm'] / 1000
        self.cache_bricks = int(cache_bricks)
        assert 0 <= self.cache_bricks <= 128
        self.cache = OrderedDict()
        self.verified = set()
        self.decoded_reads = 0

    def brick(self, bx, by, bz):
        key = int(bx + self.counts[0] * (by + self.counts[1] * bz))
        if key in self.cache:
            self.cache.move_to_end(key)
            return self.cache[key]
        entry = self.meta['blocks'].get(str(key))
        if entry is None:
            return None
        path = ROOT / 'data/ultra-volume-v7' / entry['path']
        encoded = path.read_bytes()
        assert len(encoded) == entry['bytes'] and hashlib.sha256(encoded).hexdigest() == entry['sha256'], path
        raw = gzip.decompress(encoded)
        assert len(raw) == 65 ** 3 and hashlib.sha256(raw).hexdigest() == entry['rawSha256'], path
        array = np.frombuffer(raw, np.uint8).reshape(65, 65, 65)
        self.verified.add(key)
        self.decoded_reads += 1
        if self.cache_bricks:
            self.cache[key] = array
            while len(self.cache) > self.cache_bricks:
                self.cache.popitem(last=False)
        return array

    def region(self, lower_xyz, upper_xyz):
        lower = np.asarray(lower_xyz, dtype=np.int64)
        upper = np.asarray(upper_xyz, dtype=np.int64)
        width = upper - lower
        assert lower.shape == (3,) and upper.shape == (3,) and np.all(width > 0)
        assert int(np.prod(width)) < 256 * 1024 ** 2, 'Use a bounded subvolume.'
        result = np.zeros(tuple(int(n) for n in width[::-1]), np.uint8)
        a = np.maximum(lower - self.origin, 0)
        b = np.minimum(upper - self.origin, self.shape)
        if np.any(a >= b):
            return result
        brick_lo, brick_hi = a // 64, (b - 1) // 64
        for bz in range(int(brick_lo[2]), int(brick_hi[2]) + 1):
            for by in range(int(brick_lo[1]), int(brick_hi[1]) + 1):
                for bx in range(int(brick_lo[0]), int(brick_hi[0]) + 1):
                    source = self.brick(bx, by, bz)
                    if source is None:
                        continue
                    base = np.array([bx, by, bz]) * 64
                    lo = np.maximum(a, base)
                    hi = np.minimum(b, base + 64)
                    src_lo, src_hi = lo - base, hi - base
                    dst_lo, dst_hi = lo + self.origin - lower, hi + self.origin - lower
                    result[dst_lo[2]:dst_hi[2], dst_lo[1]:dst_hi[1], dst_lo[0]:dst_hi[0]] = source[src_lo[2]:src_hi[2], src_lo[1]:src_hi[1], src_lo[0]:src_hi[0]]
        return result

    def millimetres(self, full_xyz):
        return (np.asarray(full_xyz) - (self.full - 1) / 2) * self.spacing_mm

    def receipt(self):
        return dict(sourceManifest=str(self.manifest_path.relative_to(ROOT)), sourceManifestSha256=self.manifest_sha256,
                    verifiedUniqueBricks=len(self.verified), decodedBrickReads=self.decoded_reads,
                    cacheMaximumBricks=self.cache_bricks, cacheMaximumBytes=self.cache_bricks * 65 ** 3,
                    sourceSpacingUm=79.4, coordinateConvention='Original main-view fine-grid endpoint convention; acquisition XYZ maps to world (x,z,-y).',
                    sourceUnchanged=True, originalQuantitativeIntensities=False)
