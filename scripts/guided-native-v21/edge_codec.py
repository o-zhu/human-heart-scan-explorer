#!/usr/bin/env python3
"""Compact native-grid surface checkpoints without solid interior intensity data.

NBE1 retains a one-bit corner classification and five-bit crossing positions on
the original X/Y/Z grid edges. The standard marching-cubes connectivity is
implicit. Bin-center quantization moves each crossing by at most 1/64 voxel
(0.31015625 µm at this source spacing), and cannot collapse it onto a grid node.
This bound is relative to the processed scalar isosurface, not anatomy accuracy.
"""
from __future__ import annotations

import base64
import gzip
import hashlib
from pathlib import Path
import struct

import numpy as np
from skimage.measure import _marching_cubes_lewiner_luts

MAGIC = 0x3145424e
BITS = 5
SPACING_UM = 19.85
CORNERS = ((0,0,0), (1,0,0), (1,1,0), (0,1,0), (0,0,1), (1,0,1), (1,1,1), (0,1,1))
EDGE_START = np.array(((0,0,0),(1,0,0),(0,1,0),(0,0,0),
    (0,0,1),(1,0,1),(0,1,1),(0,0,1),(0,0,0),(1,0,0),(1,1,0),(0,1,0)), np.int32)
EDGE_AXIS = np.array((0,1,0,1,0,1,0,1,2,2,2,2), np.int8)
TABLE = np.frombuffer(base64.decodebytes(_marching_cubes_lewiner_luts.CASESCLASSIC[1].encode()), np.int8).reshape(256,16)
TRI_COUNTS = (TABLE >= 0).sum(axis=1) // 3


def pack5(values):
    values = np.asarray(values, np.uint8)
    return np.packbits(((values[:, None] >> np.arange(BITS, dtype=np.uint8)) & 1).ravel(), bitorder='little').tobytes()


def unpack5(data, count):
    bits = np.unpackbits(np.frombuffer(data, np.uint8), bitorder='little')[:count*BITS].reshape(count, BITS)
    return np.sum(bits << np.arange(BITS, dtype=np.uint8), axis=1, dtype=np.uint8)


def cases_from_inside(inside):
    # The established Heart Explorer convention marks the lower-density side.
    shape = np.array(inside.shape) - 1
    cases = np.zeros(tuple(shape), np.uint8)
    for bit, (x,y,z) in enumerate(CORNERS):
        cases |= ((~inside[z:z+shape[0],y:y+shape[1],x:x+shape[2]]).astype(np.uint8) << bit)
    return cases


def edge_slices(axis):
    a = [slice(None)]*3
    b = a.copy()
    a[2-axis] = slice(None, -1)
    b[2-axis] = slice(1, None)
    return tuple(a), tuple(b)


def encode_native_edges(field, origin_xyz, path, threshold=17133.4, step=1):
    field = np.asarray(field, np.float32)
    if field.ndim != 3 or min(field.shape) < 2 or max(field.shape) > 129 or not np.isfinite(field).all():
        raise ValueError('NBE1 requires a finite native block of 2–129 samples per axis')
    threshold = float(np.float32(threshold))
    if step not in (1,2,4,8):
        raise ValueError('Unsupported overview sampling step')
    inside = field >= threshold
    mask = np.packbits(inside.ravel(), bitorder='little').tobytes()
    counts = []
    streams = []
    maximum_error = 0.
    squared_error = 0.
    for axis in range(3):
        a, b = edge_slices(axis)
        crossing = inside[a] != inside[b]
        low = field[a][crossing].astype(np.float64)
        high = field[b][crossing].astype(np.float64)
        fraction = (threshold-low)/(high-low)
        if not np.all((fraction >= 0) & (fraction <= 1)):
            raise ValueError('Invalid crossing interpolation')
        quantized = np.clip(np.floor(fraction*32), 0, 31).astype(np.uint8)
        restored = (quantized.astype(np.float64)+.5)/32
        error = np.abs(restored-fraction)
        maximum_error = max(maximum_error, float(error.max(initial=0)))
        squared_error += float(np.dot(error, error))
        counts.append(len(quantized))
        packed = pack5(quantized)
        if not np.array_equal(unpack5(packed, len(quantized)), quantized):
            raise ValueError('Crossing-bit packing round trip failed')
        streams.append(packed)
    threshold_bits = struct.unpack('<I', struct.pack('<f', threshold))[0]
    spacing_bits = struct.unpack('<I', struct.pack('<f', SPACING_UM*step))[0]
    header = struct.pack('<16I', MAGIC, 1, *field.shape[::-1], BITS, len(mask),
        *counts, *map(int, origin_xyz), threshold_bits, spacing_bits, 0 if step == 1 else step)
    decoded = header + mask + b''.join(streams)
    encoded = gzip.compress(decoded, compresslevel=4, mtime=0)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix+'.part')
    temporary.write_bytes(encoded)
    temporary.replace(path)
    cases = cases_from_inside(inside)
    return dict(format='NBE1', bytes=len(encoded), decodedBytes=len(decoded),
        sha256=hashlib.sha256(encoded).hexdigest(), decodedSha256=hashlib.sha256(decoded).hexdigest(),
        sampleShapeZYX=list(field.shape), originXYZ=list(map(int, origin_xyz)),
        vertices=sum(counts), triangles=int(TRI_COUNTS[cases].sum()), activeCells=int(np.count_nonzero((cases != 0) & (cases != 255))),
        edgeCountsXYZ=counts, crossingBits=BITS, sourceSpacingUm=SPACING_UM,
        samplingStepNative=step, meshSampleSpacingUm=SPACING_UM*step,
        maximumEncodingMovementUm=maximum_error*SPACING_UM*step,
        rmsEncodingMovementUm=(squared_error/max(1,sum(counts)))**.5*SPACING_UM*step,
        encodingMovementBoundUm=SPACING_UM*step/64,
        connectivity='Standard marching-cubes cases; original native integer grid edges')


def decode_native_edges(encoded):
    decoded = gzip.decompress(encoded)
    if len(decoded) < 64:
        raise ValueError('Truncated NBE1 header')
    h = struct.unpack('<16I', decoded[:64])
    if h[0:2] != (MAGIC, 1) or h[5] != 5 or h[15] not in (0,2,4,8) or not all(2 <= v <= 129 for v in h[2:5]):
        raise ValueError('Unsupported NBE1 header')
    shape = tuple(h[2:5][::-1])
    count = int(np.prod(shape))
    mask_bytes = (count+7)//8
    if h[6] != mask_bytes:
        raise ValueError('NBE1 corner-mask length differs from geometry')
    cursor = 64+mask_bytes
    inside = np.unpackbits(np.frombuffer(decoded,np.uint8,mask_bytes,64), bitorder='little')[:count].reshape(shape).astype(bool)
    fractions = []
    for axis, n in enumerate(h[7:10]):
        a,b = edge_slices(axis)
        if np.count_nonzero(inside[a] != inside[b]) != n:
            raise ValueError('NBE1 edge count differs from corner classification')
        length = (n*5+7)//8
        if cursor+length > len(decoded):
            raise ValueError('Truncated NBE1 crossing stream')
        fractions.append((unpack5(decoded[cursor:cursor+length],n).astype(np.float32)+.5)/32)
        cursor += length
    if cursor != len(decoded):
        raise ValueError('Trailing bytes in NBE1')
    return inside, fractions, np.array(h[10:13],np.int32), h[15] or 1


def mesh_native_edges(encoded):
    """Reference decoder for QA and parent LOD construction; one block at a time."""
    inside, fractions, origin, step = decode_native_edges(encoded)
    points = []
    indices = []
    offset = 0
    for axis in range(3):
        a,b = edge_slices(axis)
        crossing = inside[a] != inside[b]
        z,y,x = np.nonzero(crossing)
        p = np.column_stack((x,y,z)).astype(np.float32)
        p[:,axis] += fractions[axis]
        points.append(p*step+origin)
        lookup = np.full(crossing.shape,-1,np.int32)
        lookup[crossing] = np.arange(offset,offset+len(p),dtype=np.int32)
        indices.append(lookup)
        offset += len(p)
    cases = cases_from_inside(inside)
    z,y,x = np.nonzero((cases != 0) & (cases != 255))
    entries = TABLE[cases[z,y,x]]
    rows, cols = np.nonzero(entries >= 0)
    edge = entries[rows,cols]
    starts = np.column_stack((x[rows],y[rows],z[rows])) + EDGE_START[edge]
    flat = np.empty(len(edge),np.uint32)
    for axis in range(3):
        select = EDGE_AXIS[edge] == axis
        xyz = starts[select]
        mapped = indices[axis][xyz[:,2],xyz[:,1],xyz[:,0]]
        if np.any(mapped < 0):
            raise ValueError('Marching-cubes case references a non-crossing edge')
        flat[select] = mapped
    return np.concatenate(points), flat.reshape(-1,3)
