#!/usr/bin/env python3
"""Bounded, restartable native-grid ROI isosurfaces and conservative comparisons.

The raw source is never filtered or quantized before contour extraction. Blocks
own disjoint cells and share samples; vertices are identified by integer source
grid edges, not a spatial merge tolerance. Arbitrary crop boundaries stay open.
All four native candidates retain exactly the reference triangle connectivity.
Run --stage self-test before a new source; --stage all runs heavyweight stages in
separate processes so temporary VTK/NumPy storage is returned to the OS.
"""
from __future__ import annotations

import argparse
import base64
import gc
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import resource
import struct
import subprocess
import sys
import time

import numpy as np
from scipy.ndimage import gaussian_filter, map_coordinates
from skimage.measure import _marching_cubes_lewiner_luts
import vtk
from vtk.util.numpy_support import numpy_to_vtk, vtk_to_numpy
import zstandard as zstd

ROOT = Path(__file__).resolve().parents[2]
WORK = Path('/workspace/data/native-surface-v20')
ASSETS = ROOT / 'public/assets/native-surface-v20'
DOCS = ROOT / 'docs/native-surface-v20'
THRESHOLD = 14640.0 + .28 * (23545.0 - 14640.0)
SPACING_UM = 19.85
VERSION = 'native-surface-v20.1'
CHUNK = 200_000

# Lorensen/Cline case table shipped by scikit-image under its BSD license.
# These axis-aligned edges yield an exact integer identity across every block.
CORNERS = np.array(((0,0,0),(1,0,0),(1,1,0),(0,1,0),
                    (0,0,1),(1,0,1),(1,1,1),(0,1,1)), np.int64)
EDGE_START = np.array(((0,0,0),(1,0,0),(0,1,0),(0,0,0),
                      (0,0,1),(1,0,1),(0,1,1),(0,0,1),
                      (0,0,0),(1,0,0),(1,1,0),(0,1,0)), np.int64)
EDGE_AXIS = np.array((0,1,0,1,0,1,0,1,2,2,2,2), np.int64)
TABLE = np.frombuffer(base64.decodebytes(_marching_cubes_lewiner_luts.CASESCLASSIC[1].encode()),
                      np.int8).reshape(_marching_cubes_lewiner_luts.CASESCLASSIC[0])


def sha_bytes(data):
    return hashlib.sha256(data).hexdigest()


def sha_file(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for piece in iter(lambda: stream.read(4 << 20), b''):
            h.update(piece)
    return h.hexdigest()


def write_json(path, item):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(item, indent=2, allow_nan=False) + '\n')
    temp.replace(path)


def peak_mib():
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024


def log(**item):
    print(json.dumps(item, allow_nan=False), flush=True)


class SliceSource:
    """Read at most one requested Z slab from a losslessly compressed cache."""
    def __init__(self, path):
        self.path = Path(path)
        self.meta = json.loads(self.path.read_text())
        self.shape = tuple(self.meta.get('shapeZYX') or self.meta['roiShapeXYZ'][::-1])
        self.origin = np.asarray(self.meta.get('roiOriginXYZ', self.meta.get('originXYZ', [0,0,0])), np.int64)
        spacing = self.meta.get('sourceSpacingUm', self.meta.get('spacingUm', SPACING_UM))
        self.spacing_um = float(spacing[0] if isinstance(spacing, list) else spacing)
        self.slices = self.meta.get('slices', [])
        self.npy_path = self.meta.get('npyPath') or self.meta.get('rawNpyPath')
        self.mapping = None
        self.verified = set()

    def resolve(self, path):
        path = Path(path)
        return path if path.is_absolute() else self.path.parent / path

    def read(self, z0, z1):
        if self.npy_path:
            if self.mapping is None:
                self.mapping = np.load(self.resolve(self.npy_path), mmap_mode='r')
                assert self.mapping.shape == self.shape and self.mapping.dtype == np.uint16
            return np.ascontiguousarray(self.mapping[z0:z1])
        result = np.empty((z1-z0, self.shape[1], self.shape[2]), np.uint16)
        for i in range(z0, z1):
            entry = self.slices[i]
            path = self.resolve(entry.get('path', entry.get('file')))
            encoded = path.read_bytes()
            if i not in self.verified and entry.get('sha256'):
                assert sha_bytes(encoded) == entry['sha256'], str(path)
            if path.suffix == '.gz':
                raw = gzip.decompress(encoded)
            elif path.suffix == '.zst':
                raw = zstd.ZstdDecompressor().decompress(encoded)
            else:
                raise ValueError(f'Unsupported lossless source slice: {path}')
            expected_hash = entry.get('rawSha256') or entry.get('decodedSha256')
            if i not in self.verified and expected_hash:
                assert sha_bytes(raw) == expected_hash, str(path)
            assert len(raw) == result[i-z0].nbytes
            result[i-z0] = np.frombuffer(raw, '<u2').reshape(self.shape[1:])
            self.verified.add(i)
        return result


def corner_samples(data):
    nz, ny, nx = np.array(data.shape) - 1
    return [data[z:z+nz, y:y+ny, x:x+nx] for x,y,z in CORNERS]


def contour_block(data, start_xyz, full_shape_xyz, threshold=THRESHOLD,retain_band=True):
    """Vectorized standard marching cubes, exact source-edge identities.

    The canonical edge interpolation is recomputed from uint16 endpoints in
    float64. No VTK float-coordinate inference or approximate point welding.
    Source values are integral and the threshold is fractional, preventing
    threshold-coincident grid vertices and their degenerate triangles.
    """
    samples = corner_samples(data)
    cases = np.zeros(samples[0].shape, np.uint8)
    for bit, sample in enumerate(samples):
        cases |= ((sample < threshold).astype(np.uint8) << bit)
    active = (cases != 0) & (cases != 255)
    zz, yy, xx = np.nonzero(active)
    if not len(xx):
        return (np.empty((0,3), np.float32), np.empty((0,3), np.uint32),
                np.empty(0, np.uint64), np.empty(0, np.uint32), np.empty((0,8), np.uint16))
    active_cases = cases[zz,yy,xx]
    table = TABLE[active_cases]
    valid = table >= 0
    active_row, table_col = np.nonzero(valid)
    edge = table[active_row,table_col].astype(np.int64)
    local_xyz = np.column_stack((xx,yy,zz))
    edge_local = local_xyz[active_row] + EDGE_START[edge]
    edge_global = edge_local + np.asarray(start_xyz)
    sx, sy, _sz = full_shape_xyz
    key = (((edge_global[:,2] * sy + edge_global[:,1]) * sx + edge_global[:,0]) * 3 + EDGE_AXIS[edge]).astype(np.uint64)
    keys, first, inverse = np.unique(key, return_index=True, return_inverse=True)
    faces = inverse.reshape(-1,3).astype(np.uint32)
    local = edge_local[first]
    axis = EDGE_AXIS[edge[first]]
    end = local.copy()
    end[np.arange(len(end)),axis] += 1
    low = data[local[:,2],local[:,1],local[:,0]].astype(np.float64)
    high = data[end[:,2],end[:,1],end[:,0]].astype(np.float64)
    assert np.all((low < threshold) != (high < threshold))
    t = (threshold-low)/(high-low)
    points = (local + np.asarray(start_xyz)).astype(np.float64)
    points[np.arange(len(points)),axis] += t
    cell_linear = ((zz*(data.shape[1]-1)+yy)*(data.shape[2]-1)+xx).astype(np.uint32)
    values = np.column_stack([sample[zz,yy,xx] for sample in samples]).astype('<u2') if retain_band else np.empty((0,8),np.uint16)
    return points.astype(np.float32), faces, keys, cell_linear, values


def extract(work, source_path, block_cells):
    started = time.monotonic()
    source = SliceSource(source_path)
    assert source.spacing_um == SPACING_UM, 'Native extraction requires true 19.85 µm source spacing'
    nz,ny,nx = source.shape
    blocks = work/'blocks'; blocks.mkdir(parents=True, exist_ok=True)
    bands = work/'surface-band'; bands.mkdir(parents=True, exist_ok=True)
    records = []
    source_hash = sha_file(source_path)
    for z0 in range(0,nz-1,block_cells):
        z1 = min(z0+block_cells,nz-1)
        slab = source.read(z0,z1+1)
        for y0 in range(0,ny-1,block_cells):
            y1 = min(y0+block_cells,ny-1)
            for x0 in range(0,nx-1,block_cells):
                x1 = min(x0+block_cells,nx-1)
                name = f'{x0:04}_{y0:04}_{z0:04}'
                mesh_path = blocks/f'{name}.npz'; record_path = blocks/f'{name}.json'
                if record_path.exists() and mesh_path.exists():
                    record = json.loads(record_path.read_text())
                    if (record.get('schema')==VERSION and record.get('sourceManifestSha256')==source_hash
                        and record.get('endExclusiveCellXYZ')==[x1,y1,z1] and record['sha256']==sha_file(mesh_path)):
                        records.append(record); continue
                data = slab[:,y0:y1+1,x0:x1+1]
                points, faces, keys, cell_ids, values = contour_block(data, (x0,y0,z0), (nx,ny,nz))
                np.savez_compressed(mesh_path, points=points, faces=faces, keys=keys)
                # Lossless *surface-contributing* raw checkpoint: all eight
                # original uint16 corner values of every crossing cell.
                band_path = bands/f'{name}.npz'
                np.savez_compressed(band_path, cellIds=cell_ids, cornerValues=values)
                with np.load(band_path) as check:
                    assert np.array_equal(check['cellIds'],cell_ids)
                    assert np.array_equal(check['cornerValues'],values)
                record = dict(schema=VERSION, sourceManifestSha256=source_hash,
                    startXYZ=[x0,y0,z0], endExclusiveCellXYZ=[x1,y1,z1],
                    sampleShapeZYX=list(data.shape), cells=int((x1-x0)*(y1-y0)*(z1-z0)),
                    minimum=int(data.min()), maximum=int(data.max()), activeCells=len(cell_ids),
                    vertices=len(points), triangles=len(faces), sha256=sha_file(mesh_path),
                    peakRssMiB=peak_mib(),
                    band=dict(path=str(band_path.relative_to(work)),compressedBytes=band_path.stat().st_size,
                        decodedBytes=cell_ids.nbytes+values.nbytes,sha256=sha_file(band_path),
                        rawCornerSha256=sha_bytes(values.tobytes()),roundTripExact=True))
                write_json(record_path,record); records.append(record)
                log(stage='extract-block',origin=[x0,y0,z0],triangles=len(faces),activeCells=len(cell_ids),peakRssMiB=peak_mib())
                del points,faces,keys,cell_ids,values
        del slab
    report = dict(schema=VERSION, sourceManifestSha256=source_hash, sourceManifest=str(source_path),
        shapeZYX=list(source.shape),roiOriginXYZ=source.origin.tolist(),sourceSpacingUm=source.spacing_um,
        rawThreshold=THRESHOLD,normalizedThreshold=.28,sourceWindow=[14640,23545],blockCells=block_cells,
        ownedCells=sum(r['cells'] for r in records),expectedCells=(nx-1)*(ny-1)*(nz-1),
        activeCells=sum(r['activeCells'] for r in records),
        triangles=sum(r['triangles'] for r in records),
        rawSampleValuesChanged=False,scalarSmoothing=False,decimation=False,componentRemoval=False,
        outerCropCapped=False,cellOwnership='Disjoint integer cells; shared endpoint samples; no outside-crop zero padding.',
        caseAmbiguity='Standard marching-cubes cases. This is a fixed-threshold intensity surface, not an anatomical segmentation.',
        surfaceBand=dict(blocks=len(records),roundTripExact=all(r['band']['roundTripExact'] for r in records),
            compressedBytes=sum(r['band']['compressedBytes'] for r in records),
            decodedBytes=sum(r['band']['decodedBytes'] for r in records),
            scope='Every active cell retains all eight original uint16 samples. Full lossless slices retain gradient neighborhoods and other thresholds.'),
        peakRssMiB=peak_mib(),seconds=time.monotonic()-started,blocks=records)
    assert report['ownedCells'] == report['expectedCells']
    write_json(work/'extraction.json',report); write_json(DOCS/'geometry-extraction.json',report)
    log(stage='extraction-complete',triangles=report['triangles'],peakRssMiB=peak_mib())


def weld(work):
    started=time.monotonic()
    extraction=json.loads((work/'extraction.json').read_text())
    keys_all=[];points_all=[];faces_all=[];offset=0
    for record in extraction['blocks']:
        x,y,z=record['startXYZ'];path=work/'blocks'/f'{x:04}_{y:04}_{z:04}.npz'
        with np.load(path) as data:
            points=data['points'];keys=data['keys'];faces=data['faces']
        keys_all.append(keys);points_all.append(points);faces_all.append(faces+offset);offset+=len(keys)
    keys_all=np.concatenate(keys_all);points_all=np.concatenate(points_all);faces_all=np.concatenate(faces_all)
    keys,first,inverse=np.unique(keys_all,return_index=True,return_inverse=True)
    points=points_all[first]
    max_alias=0.
    for lo in range(0,len(points_all),CHUNK):
        max_alias=max(max_alias,float(np.max(np.abs(points_all[lo:lo+CHUNK]-points[inverse[lo:lo+CHUNK]]),initial=0)))
    assert max_alias == 0., 'Shared edge interpolation is not bit-identical'
    faces=inverse[faces_all].astype(np.uint32)
    np.save(work/'reference-points.npy',points);np.save(work/'reference-faces.npy',faces);np.save(work/'reference-keys.npy',keys)
    record=dict(schema=VERSION,verticesBeforeWeld=len(keys_all),vertices=len(points),triangles=len(faces),
        exactIntegerEdgeWeld=True,sharedEdgeAliases=len(keys_all)-len(keys),maximumWeldMovementUm=0.,
        sharedVertexCoordinatesBitIdentical=True,spatialWeldTolerance=None,
        indicesSha256=sha_bytes(faces.tobytes()),pointsSha256=sha_bytes(points.tobytes()),
        peakRssMiB=peak_mib(),seconds=time.monotonic()-started)
    write_json(work/'weld.json',record);write_json(DOCS/'geometry-weld.json',record);log(stage='weld-complete',**record)


def deduplicate_band(work,source_path):
    """Lossless active cells + each contributing raw sample stored once/block."""
    source=SliceSource(source_path);extraction=json.loads((work/'extraction.json').read_text())
    out=work/'surface-band-deduplicated';out.mkdir(exist_ok=True)
    records=[]
    for record in extraction['blocks']:
        x0,y0,z0=record['startXYZ'];x1,y1,z1=record['endExclusiveCellXYZ']
        raw=source.read(z0,z1+1)[:,y0:y1+1,x0:x1+1]
        with np.load(work/record['band']['path']) as old:
            cell_ids=old['cellIds'];expected_values=old['cornerValues']
        cell_shape=np.array(raw.shape)-1;active=np.zeros(tuple(cell_shape),bool)
        active.ravel()[cell_ids]=True
        used=np.zeros(raw.shape,bool)
        for x,y,z in CORNERS:
            used[z:z+cell_shape[0],y:y+cell_shape[1],x:x+cell_shape[2]]|=active
        cell_mask=np.packbits(active.ravel(),bitorder='little').tobytes()
        sample_mask=np.packbits(used.ravel(),bitorder='little').tobytes()
        values=np.asarray(raw[used],dtype='<u2')
        header=struct.pack('<8I',0x3142534e,1,raw.shape[2],raw.shape[1],raw.shape[0],len(cell_ids),len(values),32)
        payload=header+cell_mask+sample_mask+values.tobytes()
        encoded=zstd.ZstdCompressor(level=9).compress(payload)
        path=out/f'{x0:04}_{y0:04}_{z0:04}.nsb.zst';path.write_bytes(encoded)
        restored=zstd.ZstdDecompressor().decompress(encoded);assert restored==payload
        cbytes=(int(np.prod(cell_shape))+7)//8;sbytes=(raw.size+7)//8
        decoded_active=np.unpackbits(np.frombuffer(restored,np.uint8,cbytes,32),bitorder='little')[:active.size].reshape(active.shape).astype(bool)
        decoded_used=np.unpackbits(np.frombuffer(restored,np.uint8,sbytes,32+cbytes),bitorder='little')[:used.size].reshape(used.shape).astype(bool)
        decoded_values=np.frombuffer(restored,'<u2',len(values),32+cbytes+sbytes)
        sparse=np.zeros(raw.shape,np.uint16);sparse[decoded_used]=decoded_values
        reconstructed=np.column_stack([a[decoded_active] for a in corner_samples(sparse)]).astype('<u2')
        assert np.array_equal(decoded_active,active) and np.array_equal(decoded_used,used)
        assert np.array_equal(decoded_values,raw[used]) and np.array_equal(reconstructed,expected_values)
        expected_crossing=np.minimum.reduce(corner_samples(raw))<THRESHOLD
        expected_crossing &= np.maximum.reduce(corner_samples(raw))>=THRESHOLD
        assert np.array_equal(active,expected_crossing)
        item=dict(startXYZ=[x0,y0,z0],sampleShapeZYX=list(raw.shape),activeCells=len(cell_ids),
            uniqueContributingSamples=len(values),availableSamples=raw.size,
            cellMaskBytes=cbytes,sampleMaskBytes=sbytes,uniqueSampleValueBytes=values.nbytes,
            compressedBytes=len(encoded),decodedBytes=len(payload),path=str(path.relative_to(work)),
            sha256=sha_bytes(encoded),decodedSha256=sha_bytes(payload),rawCornerSha256=sha_bytes(reconstructed.tobytes()),
            exactRawSampleRoundTrip=True,allEightActiveCellValuesReconstructedExactly=True,
            oldCompressedBytes=record['band']['compressedBytes'],oldDecodedBytes=record['band']['decodedBytes'])
        records.append(item)
    report=dict(schema='native-surface-band-v20.2',format='NSB1-zstd',blocks=records,
        blockOwnership='64-cell extraction blocks; a boundary sample may be present in both adjacent blocks, but never duplicated within one block.',
        activeCells=sum(r['activeCells'] for r in records),uniqueContributingSamplesPerBlockSum=sum(r['uniqueContributingSamples'] for r in records),
        previousEightCornerSampleCount=sum(r['activeCells']*8 for r in records),
        compressedBytes=sum(r['compressedBytes'] for r in records),decodedBytes=sum(r['decodedBytes'] for r in records),
        previousCompressedBytes=sum(r['oldCompressedBytes'] for r in records),previousDecodedBytes=sum(r['oldDecodedBytes'] for r in records),
        fullRawSliceBytes=source.meta.get('rawBytes'),fullLosslessSliceCompressedBytes=source.meta.get('encodedSliceBytes'),
        allEightActiveCellValuesReconstructedExactly=True,rawValuesChanged=False,
        scope='Exact threshold17133.4 crossing cells and their raw corners only. Full immutable compressed slices remain the source for gradient halos, different thresholds and independently rerunning the extraction.',
        payload='32-byte little-endian header magicNSB1/version1/sampleXYZ/activeCells/uniqueSamples/headerBytes; little-bit-order active-cell mask; sample mask; once-per-block uint16 little-endian sample values in ZYX scan order.',
        peakRssMiB=peak_mib())
    write_json(work/'surface-band-deduplicated.json',report);write_json(DOCS/'geometry-surface-band.json',report)
    log(stage='surface-band-deduplicated',compressedBytes=report['compressedBytes'],previousCompressedBytes=report['previousCompressedBytes'],uniqueContributingSamples=report['uniqueContributingSamplesPerBlockSum'],peakRssMiB=peak_mib())


def polydata(points,faces):
    poly=vtk.vtkPolyData();pts=vtk.vtkPoints();pts.SetData(numpy_to_vtk(np.ascontiguousarray(points,dtype=np.float32),deep=False));poly.SetPoints(pts)
    cells=vtk.vtkCellArray();offsets=np.arange(0,faces.size+1,3,dtype=np.int32)
    cells.SetData(numpy_to_vtk(offsets,deep=True),numpy_to_vtk(np.ascontiguousarray(faces,dtype=np.int32).ravel(),deep=True));poly.SetPolys(cells)
    return poly


def crosses(points,faces,lo,hi):
    f=faces[lo:hi]
    return np.cross(points[f[:,1]].astype(np.float64)-points[f[:,0]],points[f[:,2]].astype(np.float64)-points[f[:,0]])


def geometry_normals(points,faces):
    normal=np.zeros_like(points,dtype=np.float64)
    largest=np.zeros(len(points),np.float64);fallback=np.zeros_like(points,dtype=np.float32)
    for lo in range(0,len(faces),CHUNK):
        hi=min(len(faces),lo+CHUNK);cross=crosses(points,faces,lo,hi);area=np.linalg.norm(cross,axis=1)
        for i in range(3):
            vertex=faces[lo:hi,i];np.add.at(normal,vertex,cross)
            # This loop's fallback is only used for exactly cancelling sums.
            better=area>largest[vertex]
            np.maximum.at(largest,vertex,area)
            use=better & (area>=largest[vertex])
            fallback[vertex[use]]=cross[use]/np.maximum(area[use,None],1e-30)
    length=np.linalg.norm(normal,axis=1);bad=length<1e-15
    normal[bad]=fallback[bad]
    length=np.linalg.norm(normal,axis=1)
    assert np.all(length>0), 'Isolated vertex without a normal'
    return (normal/length[:,None]).astype(np.float32),int(bad.sum())


def topology(points,faces,shape_xyz):
    """O(F) edge inspection; no pairwise geometry-distance matrix."""
    nv=len(points)
    edges=np.concatenate((faces[:,[0,1]],faces[:,[1,2]],faces[:,[2,0]])).astype(np.uint64)
    edges.sort(axis=1)
    packed=edges[:,0]*np.uint64(nv)+edges[:,1];del edges
    unique,counts=np.unique(packed,return_counts=True);del packed
    boundary=unique[counts==1];nonmanifold=unique[counts>2]
    ba=points[(boundary//nv).astype(np.int64)];bb=points[(boundary%nv).astype(np.int64)]
    upper=np.asarray(shape_xyz)-1
    boundary_on_crop=np.any(((ba==0)&(bb==0))|((ba==upper)&(bb==upper)),axis=1)
    unexpected_boundary=int((~boundary_on_crop).sum())
    pinned=np.zeros(nv,bool)
    for selected in (boundary,nonmanifold):
        pinned[(selected//nv).astype(np.int64)]=True;pinned[(selected%nv).astype(np.int64)]=True
    roi_boundary=np.any((points==0)|(points==np.asarray(shape_xyz)-1),axis=1)
    pinned|=roi_boundary
    # Connectivity is counted with VTK's surface graph, without dropping regions.
    poly=polydata(points,faces);conn=vtk.vtkPolyDataConnectivityFilter();conn.SetInputData(poly)
    conn.SetExtractionModeToAllRegions();conn.ColorRegionsOff();conn.Update()
    components=int(conn.GetNumberOfExtractedRegions());del conn,poly
    zero=0;area=0.
    for lo in range(0,len(faces),CHUNK):
        a=np.linalg.norm(crosses(points,faces,lo,min(lo+CHUNK,len(faces))),axis=1)
        zero+=int(np.sum(a<=1e-20));area+=float(a.sum()/2)
    result=dict(vertices=nv,triangles=len(faces),edges=len(unique),components=components,
        eulerCharacteristic=nv-len(unique)+len(faces),boundaryEdges=len(boundary),nonmanifoldEdges=len(nonmanifold),
        unexpectedInteriorBoundaryEdges=unexpected_boundary,
        roiBoundaryVertices=int(roi_boundary.sum()),pinnedVertices=int(pinned.sum()),zeroAreaTriangles=zero,
        areaMm2=area*(SPACING_UM/1000)**2,
        boundaryPolicy='Every topological boundary and nonmanifold edge endpoint is pinned; the ROI is deliberately open.')
    return result,pinned


def validate_change(reference,points,faces,pinned):
    distance=np.linalg.norm(points.astype(np.float64)-reference,axis=1)*SPACING_UM
    flipped=0;degenerate=0;minimum_dot=1.;max_angle=0.
    for lo in range(0,len(faces),CHUNK):
        hi=min(lo+CHUNK,len(faces));a=crosses(reference,faces,lo,hi);b=crosses(points,faces,lo,hi)
        la=np.linalg.norm(a,axis=1);lb=np.linalg.norm(b,axis=1)
        valid=(la>1e-20)&(lb>1e-20)
        degenerate+=int((lb<=1e-20).sum())
        dot=np.einsum('ij,ij->i',a,b);flipped+=int(((dot<=0)&(la>1e-20)).sum())
        if np.any(valid):
            cos=np.clip(dot[valid]/la[valid]/lb[valid],-1,1);minimum_dot=min(minimum_dot,float(cos.min()))
    return dict(maximumVertexDisplacementUm=float(distance.max(initial=0)),
        p95VertexDisplacementUm=float(np.quantile(distance,.95)),medianVertexDisplacementUm=float(np.median(distance)),
        rmsVertexDisplacementUm=float(np.sqrt(np.mean(distance**2))),
        zeroAreaTriangles=degenerate,flippedOrOver90DegreeTriangles=flipped,
        maximumFaceNormalRotationDeg=math.degrees(math.acos(minimum_dot)),
        boundaryCoordinatesUnchanged=bool(np.array_equal(reference[pinned],points[pinned])),
        indicesUnchanged=True,verticesUnchanged=len(points)==len(reference),
        topologyUnchanged=True,
        boundScope='Exact all-vertex displacement bounds corresponding barycentric triangle points because connectivity is unchanged. It does not certify absence of self-intersection.')


def normals_stage(work,source_path):
    started=time.monotonic();source=SliceSource(source_path)
    points=np.load(work/'reference-points.npy');faces=np.load(work/'reference-faces.npy')
    ordinary,fallbacks=geometry_normals(points,faces);np.save(work/'native-normals.npy',ordinary)
    topo,pinned=topology(points,faces,source.shape[::-1]);np.save(work/'pinned.npy',pinned)
    normals=np.empty_like(points)
    # Only the shading field is blurred. The contour, connectivity and every
    # source byte remain exactly as in the unsmoothed native reference.
    sigma=.5;halo=3
    for z0 in range(0,source.shape[0]-1,64):
        z1=min(source.shape[0]-1,z0+64)
        ids=np.flatnonzero((points[:,2]>=z0)&((points[:,2]<z1) if z1<source.shape[0]-1 else (points[:,2]<=z1)))
        if not len(ids):continue
        lo=max(0,z0-halo);hi=min(source.shape[0],z1+halo+1)
        field=gaussian_filter(source.read(lo,hi).astype(np.float32),sigma=sigma,truncate=3.,mode='nearest')
        coords=points[ids][:,::-1].astype(np.float64);coords[:,0]-=lo
        for axis in range(3):
            grad=np.gradient(field,axis=axis)
            normals[ids,2-axis]=-map_coordinates(grad,coords.T,order=1,mode='nearest',prefilter=False)
            del grad
        del field
    length=np.linalg.norm(normals,axis=1);weak=length<1e-10
    normals[weak]=ordinary[weak]
    normals/=np.maximum(np.linalg.norm(normals,axis=1,keepdims=True),1e-20)
    # Keep winding orientation at noise-scale ambiguous crossings.
    reversed_mask=np.einsum('ij,ij->i',normals,ordinary)<0
    normals[reversed_mask]*=-1
    np.save(work/'normals-normals.npy',normals)
    report=dict(schema=VERSION,topology=topo,geometryNormalFallbackVertices=fallbacks,
        gradientNormalSigmaVoxels=sigma,gradientNormalSigmaUm=sigma*SPACING_UM,
        gradientHaloVoxels=halo,gradientNormalWeakFallbackVertices=int(weak.sum()),
        gradientOrientationAlignedVertices=int(reversed_mask.sum()),
        normalOnlyGeometryIdentical=True,normalOnlyMaximumDisplacementUm=0.,
        pointsSha256=sha_bytes(points.tobytes()),indicesSha256=sha_bytes(faces.tobytes()),
        scalarContourBlurred=False,peakRssMiB=peak_mib(),seconds=time.monotonic()-started)
    write_json(work/'normals.json',report);write_json(DOCS/'geometry-normals.json',report);log(stage='normals-complete',**report)


def smooth(work,method):
    started=time.monotonic();reference=np.load(work/'reference-points.npy');faces=np.load(work/'reference-faces.npy');pinned=np.load(work/'pinned.npy')
    iterations,passband,cap=(10,.3,.25) if method=='gentle' else (20,.2,.5)
    poly=polydata(reference,faces)
    filt=vtk.vtkWindowedSincPolyDataFilter();filt.SetInputData(poly);filt.SetNumberOfIterations(iterations);filt.SetPassBand(passband)
    filt.BoundarySmoothingOff();filt.FeatureEdgeSmoothingOff();filt.NonManifoldSmoothingOff();filt.NormalizeCoordinatesOn();filt.Update()
    points=vtk_to_numpy(filt.GetOutput().GetPoints().GetData()).astype(np.float64)
    newfaces=vtk_to_numpy(filt.GetOutput().GetPolys().GetConnectivityArray()).reshape(-1,3)
    assert np.array_equal(newfaces,faces),'Smoothing changed connectivity'
    delta=points-reference;length=np.linalg.norm(delta,axis=1)
    # Reserve a small float32 roundoff margin so the persisted arrays obey the
    # advertised cap, rather than allowing an unexplained numerical overshoot.
    rounding_margin=2*np.finfo(np.float32).eps*max(1.,float(np.abs(reference).max()))
    effective_cap=max(0.,cap-rounding_margin)
    delta*=np.minimum(1.,effective_cap/np.maximum(length,1e-30))[:,None];delta[pinned]=0
    points=(reference+delta).astype(np.float32)
    del poly,filt,newfaces,delta,length
    shape_xyz=np.array(json.loads((work/'extraction.json').read_text())['shapeZYX'][::-1])
    outside=np.any((points<0)|(points>shape_xyz-1),axis=1)
    outside_count=int(outside.sum())
    # Sinc interpolation can overshoot the crop even when its edge vertices
    # are pinned. Restore those interior vertices, rather than clipping their
    # encoded positions or extending the advertised measured region.
    points[outside]=reference[outside]
    # Restore all vertices of any newly degenerate/flipped face. Re-evaluate
    # until stable; restoring neighbors can expose a further incident face.
    restored=np.zeros(len(points),bool);rounds=0
    for _ in range(20):
        bad=[]
        for lo in range(0,len(faces),CHUNK):
            hi=min(lo+CHUNK,len(faces));a=crosses(reference,faces,lo,hi);b=crosses(points,faces,lo,hi)
            reject=(np.einsum('ij,ij->i',a,b)<=0)|(np.linalg.norm(b,axis=1)<=1e-20)
            if np.any(reject):bad.append(faces[lo:hi][reject].ravel())
        if not bad:break
        ids=np.unique(np.concatenate(bad));fresh=~restored[ids]
        if not np.any(fresh):raise AssertionError('Degenerate source or unstable triangle restoration')
        points[ids]=reference[ids];restored[ids]=True;rounds+=1
    else:raise AssertionError('Triangle restoration did not converge')
    report=validate_change(reference,points,faces,pinned)
    assert report['maximumVertexDisplacementUm']<=cap*SPACING_UM
    assert report['flippedOrOver90DegreeTriangles']==0 and report['zeroAreaTriangles']==0
    assert report['boundaryCoordinatesUnchanged']
    assert np.all(points>=0) and np.all(points<=shape_xyz-1)
    np.save(work/f'{method}-points.npy',points)
    normal,fallback=geometry_normals(points,faces);np.save(work/f'{method}-normals.npy',normal)
    report.update(schema=VERSION,id=method,method='vtkWindowedSincPolyDataFilter',iterations=iterations,
        passBand=passband,maximumAllowedDisplacementUm=cap*SPACING_UM,
        float32RoundingMarginUm=float(rounding_margin*SPACING_UM),
        roiOvershootRestoredVertices=outside_count,allVerticesWithinMeasuredRoi=True,
        clampRelativeTo='Unsmoothed native reference, after all filter iterations',
        triangleRestorationRounds=rounds,triangleSafetyRestoredVertices=int(restored.sum()),
        normalFallbackVertices=fallback,pointsSha256=sha_bytes(points.tobytes()),indicesSha256=sha_bytes(faces.tobytes()),
        peakRssMiB=peak_mib(),seconds=time.monotonic()-started)
    write_json(work/f'{method}.json',report);write_json(DOCS/f'geometry-{method}.json',report);log(stage='smooth-complete',**report)


def surface_samples(points,faces,count=20_000,seed=20261106):
    rng=np.random.default_rng(seed);area=np.empty(len(faces),np.float64)
    for lo in range(0,len(faces),CHUNK):
        hi=min(lo+CHUNK,len(faces));area[lo:hi]=np.linalg.norm(crosses(points,faces,lo,hi),axis=1)
    chosen=rng.choice(len(faces),size=count,p=area/area.sum());f=faces[chosen]
    a=np.sqrt(rng.random(count));b=rng.random(count)
    return ((1-a)[:,None]*points[f[:,0]]+(a*(1-b))[:,None]*points[f[:,1]]+(a*b)[:,None]*points[f[:,2]])


def sampled_distances(samples,points,faces):
    poly=polydata(points,faces);locator=vtk.vtkStaticCellLocator();locator.SetDataSet(poly);locator.BuildLocator()
    closest=[0.,0.,0.];cell_id=vtk.reference(0);sub_id=vtk.reference(0);distance=vtk.reference(0.)
    values=np.empty(len(samples),np.float64)
    for i,p in enumerate(samples):
        locator.FindClosestPoint(p,closest,cell_id,sub_id,distance);values[i]=math.sqrt(float(distance))*SPACING_UM
    assert np.isfinite(values).all()
    return dict(samples=len(values),medianUm=float(np.median(values)),p95Um=float(np.quantile(values,.95)),
        p99Um=float(np.quantile(values,.99)),maximumSampledUm=float(values.max()),rmsUm=float(np.sqrt(np.mean(values**2))))


def bilateral(work,source_path):
    """Explicit, separately labeled scalar denoising; topology can change."""
    started=time.monotonic();source=SliceSource(source_path);nz,ny,nx=source.shape
    spatial=.65;range_sigma=600.;radius=2
    target=np.lib.format.open_memmap(work/'bilateral-field.npy',mode='w+',dtype=np.float32,shape=source.shape)
    original_above=0;filtered_above=0;lost=0;gained=0;max_value_change=0.
    offsets=[]
    for dz in range(-radius,radius+1):
        for dy in range(-radius,radius+1):
            for dx in range(-radius,radius+1):
                if dx or dy or dz:offsets.append((dz,dy,dx,math.exp(-(dx*dx+dy*dy+dz*dz)/(2*spatial*spatial))))
    for z0 in range(0,nz,64):
        z1=min(nz,z0+64);lo=max(0,z0-radius);hi=min(nz,z1+radius)
        raw=source.read(lo,hi);padded=np.pad(raw.astype(np.float32),radius,mode='edge')
        oz=z0-lo+radius;center=padded[oz:oz+z1-z0,radius:radius+ny,radius:radius+nx]
        numerator=center.copy();denominator=np.ones_like(center)
        for dz,dy,dx,weight in offsets:
            neighbor=padded[oz+dz:oz+dz+z1-z0,radius+dy:radius+dy+ny,radius+dx:radius+dx+nx]
            w=neighbor-center;np.square(w,out=w);w*=(-.5/(range_sigma**2));np.exp(w,out=w);w*=weight
            numerator+=w*neighbor;denominator+=w
        filtered=numerator/denominator
        # Keep original values at the cropped boundary; we never invent a cap
        # or use a nonexistent outside-crop measurement. The transition band
        # is reported explicitly as a potential local filtering artifact.
        filtered[:,:radius,:]=center[:,:radius,:];filtered[:,-radius:,:]=center[:,-radius:,:]
        filtered[:,:,:radius]=center[:,:,:radius];filtered[:,:,-radius:]=center[:,:,-radius:]
        for local_z in range(z1-z0):
            if z0+local_z<radius or z0+local_z>=nz-radius:filtered[local_z]=center[local_z]
        a=center>=THRESHOLD;b=filtered>=THRESHOLD
        original_above+=int(a.sum());filtered_above+=int(b.sum());lost+=int((a&~b).sum());gained+=int((~a&b).sum())
        max_value_change=max(max_value_change,float(np.max(np.abs(filtered-center))));target[z0:z1]=filtered
        del raw,padded,center,numerator,denominator,filtered,a,b
    target.flush();del target
    field=np.load(work/'bilateral-field.npy',mmap_mode='r')
    points_all=[];faces_all=[];keys_all=[];offset=0
    for z0 in range(0,nz-1,64):
        z1=min(z0+64,nz-1)
        p,f,k,_i,_v=contour_block(field[z0:z1+1],(0,0,z0),(nx,ny,nz),retain_band=False)
        points_all.append(p);faces_all.append(f+offset);keys_all.append(k);offset+=len(p)
    keys_all=np.concatenate(keys_all);points_all=np.concatenate(points_all);faces_all=np.concatenate(faces_all)
    _keys,first,inverse=np.unique(keys_all,return_index=True,return_inverse=True)
    points=points_all[first];faces=inverse[faces_all].astype(np.uint32)
    for lo in range(0,len(points_all),CHUNK):assert np.array_equal(points_all[lo:lo+CHUNK],points[inverse[lo:lo+CHUNK]])
    del points_all,faces_all,keys_all,inverse,first,_keys,field
    normals,_fallback=geometry_normals(points,faces);topo,_pin=topology(points,faces,(nx,ny,nz))
    np.save(work/'bilateral-points.npy',points);np.save(work/'bilateral-faces.npy',faces);np.save(work/'bilateral-normals.npy',normals)
    reference=np.load(work/'reference-points.npy');reference_faces=np.load(work/'reference-faces.npy')
    ref_to_filtered=sampled_distances(surface_samples(reference,reference_faces),points,faces)
    filtered_to_ref=sampled_distances(surface_samples(points,faces,seed=20261107),reference,reference_faces)
    report=dict(schema=VERSION,id='bilateral',label='Native · noise-reduction experiment',
        scalarSmoothing=True,method='3D intensity bilateral filter followed by the same raw-value isosurface threshold',
        sourceSpacingUm=source.spacing_um,resampled=False,rawThreshold=THRESHOLD,
        sigmaSpatialVoxels=spatial,sigmaSpatialUm=spatial*SPACING_UM,sigmaRangeRawIntensity=range_sigma,radiusVoxels=radius,
        rawBoundaryBandVoxels=radius,boundaryBandCaveat='The two-voxel raw boundary band preserves measured crop edges but its transition can show a local filtering artifact.',
        originalRawSamplesChanged=False,maximumDerivedScalarValueChange=max_value_change,
        thresholdedSamples=dict(rawAbove=original_above,filteredAbove=filtered_above,aboveToBelow=lost,belowToAbove=gained,
            rawAboveRetainedFraction=(original_above-lost)/original_above),
        topology=topo,topologyPreserved=False,componentRemoval=False,decimation=False,
        surfaceDistances=dict(method='20,000 deterministic area-weighted barycentric samples per direction, closest triangle via vtkStaticCellLocator; sampled, not a Hausdorff guarantee.',
            rawToFiltered=ref_to_filtered,filteredToRaw=filtered_to_ref),
        conclusion='The filter can remove noise-scale components and can also remove real weak thin structures. Compare with native reference and the untouched source slice; no anatomical no-loss guarantee.',
        peakRssMiB=peak_mib(),seconds=time.monotonic()-started)
    write_json(work/'bilateral.json',report);write_json(DOCS/'geometry-bilateral.json',report);log(stage='bilateral-complete',**report)


def encode_hfm(points,faces,normals,id,label,shape_xyz,spacing_um,asset_dir):
    """ROI-centered coordinates, local quantization bounds, unchanged indices."""
    extent_vox=np.asarray(shape_xyz,dtype=np.float64)-1
    scale=float(extent_vox.max())
    world=(points.astype(np.float64)-extent_vox/2)[:,[0,2,1]]*np.array([1,1,-1])/scale
    world_normals=normals[:,[0,2,1]]*np.array([1,1,-1],np.float32)
    extent=extent_vox[[0,2,1]]/scale;low=-extent/2;high=extent/2
    quantized=np.rint(np.clip((world-low)/extent,0,1)*65535).astype('<u2')
    reconstructed=low+quantized.astype(np.float64)/65535*extent
    errors=np.linalg.norm(world-reconstructed,axis=1)*scale*spacing_um
    collapsed=0;flips=0
    for lo in range(0,len(faces),CHUNK):
        hi=min(lo+CHUNK,len(faces));a=crosses(world,faces,lo,hi);b=crosses(reconstructed,faces,lo,hi)
        collapsed+=int((np.linalg.norm(b,axis=1)<=1e-20).sum());flips+=int((np.einsum('ij,ij->i',a,b)<=0).sum())
    attempted_u16=dict(maximumErrorUm=float(errors.max(initial=0)),collapsedTriangles=collapsed,
                       flippedOrOver90DegreeTriangles=flips)
    position_format='uint16';position_flag=0;positions=quantized
    if collapsed or flips:
        # Preserve every native triangle when uint16 local quantization would
        # collapse a small one. The new standalone viewer explicitly supports
        # this HFM1 flag; the original v19 parser is deliberately unchanged.
        position_format='float32';position_flag=1;positions=world.astype('<f4')
        reconstructed=positions.astype(np.float64)
        errors=np.linalg.norm(world-reconstructed,axis=1)*scale*spacing_um
        collapsed=0;flips=0
        for lo in range(0,len(faces),CHUNK):
            hi=min(lo+CHUNK,len(faces));a=crosses(world,faces,lo,hi);b=crosses(reconstructed,faces,lo,hi)
            collapsed+=int((np.linalg.norm(b,axis=1)<=1e-20).sum());flips+=int((np.einsum('ij,ij->i',a,b)<=0).sum())
    assert collapsed==0 and flips==0, 'Mesh encoding must not collapse or flip source triangles'
    normal_q=np.rint(np.clip(world_normals,-1,1)*32767).astype('<i2')
    pos_offset=32;normal_offset=(pos_offset+positions.nbytes+3)&~3;index_offset=(normal_offset+normal_q.nbytes+3)&~3
    payload=bytearray(index_offset+faces.nbytes)
    struct.pack_into('<8I',payload,0,0x314d4648,1,len(points),faces.size,pos_offset,normal_offset,index_offset,position_flag)
    payload[pos_offset:pos_offset+positions.nbytes]=positions.tobytes();payload[normal_offset:normal_offset+normal_q.nbytes]=normal_q.tobytes();payload[index_offset:]=faces.astype('<u4').tobytes()
    path=asset_dir/f'{id}.hfm.gz';asset_dir.mkdir(parents=True,exist_ok=True)
    with path.open('wb') as stream:
        with gzip.GzipFile(filename='',fileobj=stream,mode='wb',compresslevel=9,mtime=0) as zip_stream:zip_stream.write(payload)
    check=gzip.decompress(path.read_bytes());assert check==payload;del check
    # Quantization is openly measured rather than quietly deleting faces.
    item=dict(id=id,label=label,url=f'./assets/native-surface-v20/{path.name}',
        format='HFM1',positionFormat=position_format,positionFlag=position_flag,
        vertices=len(points),triangles=len(faces),compressedBytes=path.stat().st_size,decodedBytes=len(payload),
        sha256=sha_file(path),decodedSha256=sha_bytes(payload),bounds=dict(min=low.tolist(),max=high.tolist()),
        sourceSpacingUm=spacing_um,quantizationMaximumUm=float(errors.max(initial=0)),
        quantizationRmsUm=float(np.sqrt(np.mean(errors**2))),quantizationCollapsedTriangles=collapsed,
        quantizationFlippedOrOver90DegreeTriangles=flips,uint16EncodingAudit=attempted_u16,
        removedTriangles=0,losslessCompressionRoundTrip=True)
    log(stage='encode',**item);return item


def baseline(work,source_path,overview_path):
    """Contour actual s4 samples in a physical crop, with open exact ROI limits."""
    source=SliceSource(source_path);meta=json.loads(Path(overview_path).read_text())
    p=Path(meta['npyPath']);p=p if p.is_absolute() else Path(overview_path).parent/p
    volume=np.load(p,mmap_mode='r')
    factor=float(meta.get('nativeDownsampleFactor',16))
    origin=np.asarray(meta.get('originXYZ',[0,0,0]),dtype=np.float64)
    lo=np.floor((source.origin-origin)/factor).astype(int)
    hi=np.ceil((source.origin+np.array(source.shape[::-1])-1-origin)/factor).astype(int)
    assert np.all(lo>=0) and np.all(hi<np.array(volume.shape[::-1]))
    crop=np.ascontiguousarray(volume[lo[2]:hi[2]+1,lo[1]:hi[1]+1,lo[0]:hi[0]+1])
    points,faces,_keys,_ids,_values=contour_block(crop,[0,0,0],crop.shape[::-1],THRESHOLD)
    points=(points+lo)*factor+origin-source.origin
    poly=polydata(points,faces)
    # vtkClipPolyData clips triangles at six planes without generating caps.
    for axis in range(3):
        for side in range(2):
            plane=vtk.vtkPlane();normal=[0,0,0];normal[axis]=1 if side==0 else -1
            point=[0,0,0];point[axis]=0 if side==0 else source.shape[2-axis]-1
            plane.SetNormal(*normal);plane.SetOrigin(*point)
            clip=vtk.vtkClipPolyData();clip.SetInputData(poly);clip.SetClipFunction(plane);clip.SetValue(0);clip.Update()
            out=vtk.vtkPolyData();out.DeepCopy(clip.GetOutput());poly=out
    tri=vtk.vtkTriangleFilter();tri.SetInputData(poly);tri.Update()
    points=vtk_to_numpy(tri.GetOutput().GetPoints().GetData()).astype(np.float32)
    faces=vtk_to_numpy(tri.GetOutput().GetPolys().GetConnectivityArray()).reshape(-1,3).astype(np.uint32)
    normal,_=geometry_normals(points,faces)
    np.save(work/'overview-points.npy',points);np.save(work/'overview-faces.npy',faces);np.save(work/'overview-normals.npy',normal)
    report=dict(schema=VERSION,id='overview',sourceSpacingUm=source.spacing_um*factor,
        sourcePath=str(p),sourceSha256=meta.get('sha256'),actualSourceSamples=True,upsampled=False,
        rawThreshold=THRESHOLD,sourceGridOriginXYZ=origin.tolist(),cropSampleStartXYZ=lo.tolist(),cropSampleEndXYZ=hi.tolist(),
        vertices=len(points),triangles=len(faces),surfaceClippedToNativeRoi=True,cropCapped=False,
        sourceDescription=meta.get('description','Actual source s4 pyramid samples, separate from the native extraction'),
        peakRssMiB=peak_mib())
    write_json(work/'overview.json',report);write_json(DOCS/'geometry-overview.json',report);log(stage='baseline-complete',**report)


def package(work,source_path):
    source=SliceSource(source_path);shape=source.shape[::-1];faces=np.load(work/'reference-faces.npy');reference=np.load(work/'reference-points.npy')
    titles={'native':'Native reference','normals':'Native · smooth lighting','gentle':'Native · gentle geometry','moderate':'Native · moderate geometry','overview':'317.6 µm overview','bilateral':'Native · noise-reduction experiment'}
    lods=[]
    for id in ['overview','native','normals','gentle','moderate','bilateral']:
        if id in ('overview','bilateral'):
            if not (work/f'{id}-points.npy').exists():continue
            p=np.load(work/f'{id}-points.npy');f=np.load(work/f'{id}-faces.npy');n=np.load(work/f'{id}-normals.npy')
        else:
            p=reference if id in ('native','normals') else np.load(work/f'{id}-points.npy')
            f=faces;n=np.load(work/f'{id}-normals.npy')
        item=encode_hfm(p,f,n,id,titles[id],shape,source.spacing_um,ASSETS)
        item['sourceSpacingUm']=source.spacing_um*(16 if id=='overview' else 1)
        item['maximumGeometryDisplacementUm']=None if id=='bilateral' else (0 if id in ('native','normals','overview') else json.loads((work/f'{id}.json').read_text())['maximumVertexDisplacementUm'])
        item['shadingOnly']=id=='normals';item['decimated']=False;item['scalarSmoothing']=id=='bilateral'
        item['sameTopologyAsNative']=id in ('native','normals','gentle','moderate')
        if id=='bilateral':item['surfaceDistances']=json.loads((work/'bilateral.json').read_text())['surfaceDistances']
        lods.append(item)
        del p,f,n
    extent=(np.array(shape)-1)[[0,2,1]]/max(np.array(shape)-1)
    normals_report=json.loads((work/'normals.json').read_text())
    source_credit=json.loads((ROOT/'public/assets/manifest.json').read_text())
    validation=dict(weld=json.loads((work/'weld.json').read_text()),normals=normals_report,
        gentle=json.loads((work/'gentle.json').read_text()),moderate=json.loads((work/'moderate.json').read_text()))
    if (work/'bilateral.json').exists():validation['bilateral']=json.loads((work/'bilateral.json').read_text())
    manifest=dict(schemaVersion=1,format='HFM1',id=VERSION,donorId='ladaf-2021-17',sourceSpacingUm=source.spacing_um,
        threshold=.28,rawThreshold=THRESHOLD,sourceWindow=[14640,23545],
        roi=dict(originXYZ=source.origin.tolist(),shapeXYZ=list(shape),sourceShapeZYX=list(source.shape),
            physicalSizeMm=((np.array(shape)-1)*source.spacing_um/1000).tolist(),
            description=source.meta.get('roiDescription',source.meta.get('description','Targeted native-source crop')),
            boundsAreSampleCenters=True,outerBoundaryOpen=True),
        extent=extent.tolist(),bounds=dict(min=(-extent/2).tolist(),max=(extent/2).tolist()),
        cameraTarget=[0,0,0],coordinateConvention='ROI-centered acquisition XYZ maps to renderer (x,z,-y), normalized by longest ROI sample-center extent.',
        lods=lods,defaultMethod='normals',totalCompressedBytes=sum(l['compressedBytes'] for l in lods),
        processing=dict(experimental=True,source='Original native uint16 19.85 µm acquisition samples within a targeted ROI.',
            contour='Blockwise marching cubes, exact global grid-edge identity weld, unchanged source threshold.',
            referenceScalarSmoothing=False,scalarSmoothingOnly=['bilateral'] if 'bilateral' in validation else [],sourceQuantization=False,decimation=False,componentRemoval=False,holeFilling=False,
            surfaceBandLossless=True,rawSlicesLossless=True,fullOrganReconstruction=False,
            gradientNormalsSigmaVoxels=.5,geometryDisplacementLimitsUm=dict(gentle=.25*SPACING_UM,moderate=.5*SPACING_UM),
            smoothingTopology='All four native candidates retain identical indices and vertex count. Geometric self-intersections are not exhaustively certified.',
            quantization='ROI-local uint16 positions where they preserve every face, otherwise float32 positions; signed 16-bit normals. Measured errors are recorded per candidate. Gzip is lossless after mesh encoding.',
            expertValidated=False),validation=validation,
        datasetUrl=source_credit['datasetUrl'],doiUrl=source_credit['doiUrl'],attribution=source_credit['attribution'],
        license=source_credit['license'],licenseUrl=source_credit['licenseUrl'])
    write_json(ASSETS/'manifest.json',manifest);write_json(DOCS/'geometry-summary.json',manifest)
    log(stage='package-complete',totalCompressedBytes=manifest['totalCompressedBytes'],peakRssMiB=peak_mib())


def render(work,source_path):
    """Matched scientific views rendered directly from the measured meshes."""
    from PIL import Image, ImageDraw, ImageFont
    from render_egl import SurfaceRenderer
    source=SliceSource(source_path);reference=np.load(work/'reference-points.npy');faces=np.load(work/'reference-faces.npy')
    shape=np.asarray(source.shape[::-1]);center=(shape-1)/2;span=float(max(shape-1))
    width,height=800,650
    renderer=SurfaceRenderer(width,height)
    titles=[('overview','317.6 µm source overview'),('native','19.85 µm native reference'),('normals','Native: smooth lighting only'),('gentle','Native: gentle ≤4.963 µm'),('moderate','Native: moderate ≤9.925 µm'),('bilateral','Native: noise-reduction experiment')]
    images=[]
    for id,title in titles:
        if id in ('overview','bilateral'):
            if not (work/f'{id}-points.npy').exists():continue
            p=np.load(work/f'{id}-points.npy');f=np.load(work/f'{id}-faces.npy')
        else:p=reference if id in ('native','normals') else np.load(work/f'{id}-points.npy');f=faces
        n=np.load(work/f'{id}-normals.npy')
        data=renderer.draw(p,n,f,center,span)
        img=Image.fromarray(data);images.append((id,title,img))
        img.save(DOCS/f'geometry-{id}-view.png')
        clipped=Image.fromarray(renderer.draw(p,n,f,center,span,clip_z=0.))
        clipped.save(DOCS/f'geometry-{id}-cutaway.png')
        del p,f,n,data,clipped
    # A labeled contact sheet keeps exactly the same physical camera and light.
    font_path='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
    try:font=ImageFont.truetype(font_path,23);small=ImageFont.truetype(font_path,17)
    except OSError:font=small=ImageFont.load_default()
    show_source_in_sheet=len(images)<6
    columns=3;rows=math.ceil((len(images)+int(show_source_in_sheet))/columns);header=128;cell_h=height+74
    sheet=Image.new('RGB',(width*columns,header+rows*cell_h),'#0b1016');draw=ImageDraw.Draw(sheet)
    draw.text((28,22),'LADAF-2021-17 · targeted native 19.85 µm reconstruction',font=font,fill='#e6edf3')
    draw.text((28,58),'Same source threshold, crop, camera and lighting · open crop boundaries · no decimation',font=small,fill='#a9bac8')
    physical=(shape-1)*source.spacing_um/1000
    draw.text((28,86),f'{physical[0]:.3f} × {physical[1]:.3f} × {physical[2]:.3f} mm crop · Raw-threshold texture includes noise; no anatomical segmentation',font=small,fill='#a9bac8')
    for i,(id,title,img) in enumerate(images):
        x=(i%columns)*width;y=header+(i//columns)*cell_h
        sheet.paste(img,(x,y+48));draw.text((x+22,y+12),title,font=font,fill='#e6edf3')
        text=('Actual coarser pyramid samples; center offset uncertain' if id=='overview' else
              'Filtered scalar field; topology/detail can change' if id=='bilateral' else 'Identical connectivity; no removed components')
        draw.text((x+22,y+height+51),text,font=small,fill='#a9bac8')
    # Show actual original samples, not a projection or simulated texture.
    plane=source.read(source.shape[0]//2,source.shape[0]//2+1)[0]
    encoded=np.rint(np.clip((plane.astype(np.float32)-14640)/(23545-14640),0,1)*255).astype(np.uint8)
    Image.fromarray(encoded).save(DOCS/'geometry-native-source-slice.png')
    if show_source_in_sheet:
        i=len(images);x=(i%columns)*width;y=header+(i//columns)*cell_h
        draw.text((x+22,y+12),'Actual native source · middle Z slice',font=font,fill='#e6edf3')
        scale_up=min((width-80)/encoded.shape[1],(height-80)/encoded.shape[0])
        source_image=Image.fromarray(encoded).convert('RGB').resize((round(encoded.shape[1]*scale_up),round(encoded.shape[0]*scale_up)),Image.Resampling.NEAREST)
        sheet.paste(source_image,(x+(width-source_image.width)//2,y+48+(height-source_image.height)//2))
        draw.text((x+22,y+height+51),'Original uint16 samples; fixed display window only',font=small,fill='#a9bac8')
    sheet.save(DOCS/'geometry-comparison.png')
    # Lightweight fallback is a real render of these same meshes, not a proxy
    # claiming to contain the interactive reconstruction.
    web=sheet.copy();web.thumbnail((1800,1400),Image.Resampling.LANCZOS)
    quality=82
    ASSETS.mkdir(parents=True,exist_ok=True)
    while True:
        web.save(ASSETS/'comparison.webp',format='WEBP',quality=quality,method=6)
        if (ASSETS/'comparison.webp').stat().st_size<500_000 or quality<=50:break
        quality-=8
    Image.fromarray(encoded).save(ASSETS/'native-source-slice.png')
    write_json(DOCS/'geometry-render.json',dict(schema=VERSION,actualMeshRenders=True,generatedIllustration=False,
        image='geometry-comparison.png',matchedCamera=True,matchedLighting=True,matchedThreshold=THRESHOLD,
        cameraPosition=(center+np.array([1.3,-1.8,.85])*span).tolist(),cameraFocalPoint=center.tolist(),
        parallelScaleVoxels=span*.82,sourceSliceLocalZ=source.shape[0]//2,peakRssMiB=peak_mib(),
        renderer=renderer.driver,renderScope='Native surfaceless EGL scientific mesh render; not a browser screenshot or device FPS measurement.'))
    log(stage='render-complete',path=str(DOCS/'geometry-comparison.png'),peakRssMiB=peak_mib())


def self_test():
    # Slab decomposition must reproduce a one-block contour exactly, including
    # its connectivity after edge-identity remapping. This checks seams/caps.
    z,y,x=np.indices((35,31,29));data=(16000+x*53+y*17-z*9).astype(np.uint16)
    fullp,fullf,fullk,_i,_v=contour_block(data,(0,0,0),data.shape[::-1])
    allp=[];allf=[];allk=[];offset=0
    for z0 in range(0,34,8):
        z1=min(34,z0+8)
        p,f,k,_i,_v=contour_block(data[z0:z1+1],(0,0,z0),data.shape[::-1])
        allp.append(p);allf.append(f+offset);allk.append(k);offset+=len(p)
    allp=np.concatenate(allp);allf=np.concatenate(allf);allk=np.concatenate(allk)
    keys,first,inverse=np.unique(allk,return_index=True,return_inverse=True)
    points=allp[first];faces=inverse[allf]
    assert np.array_equal(keys,fullk) and np.array_equal(points,fullp)
    assert np.array_equal(allp,points[inverse])
    def canonical(f):
        f=np.sort(f,axis=1);return f[np.lexsort((f[:,2],f[:,1],f[:,0]))]
    assert np.array_equal(canonical(faces),canonical(fullf))
    image=vtk.vtkImageData();image.SetDimensions(*data.shape[::-1]);image.GetPointData().SetScalars(numpy_to_vtk(data.ravel(),deep=False))
    contour=vtk.vtkFlyingEdges3D();contour.SetInputData(image);contour.SetValue(0,THRESHOLD);contour.Update()
    assert contour.GetOutput().GetNumberOfCells()==len(fullf)
    assert contour.GetOutput().GetNumberOfPoints()==len(fullp)
    log(stage='self-test',passed=True,triangles=len(fullf),blockAndMonolithicIdentical=True,vtkFlyingEdgesCountsMatch=True)


def main():
    global ASSETS,DOCS
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage',choices=['all','self-test','extract','band','weld','normals','gentle','moderate','bilateral','overview','package','render'],default='all')
    parser.add_argument('--work',type=Path,default=WORK);parser.add_argument('--source',type=Path,default=WORK/'source-ready.json')
    parser.add_argument('--overview-source',type=Path,default=WORK/'overview-source.json');parser.add_argument('--block-cells',type=int,default=128)
    parser.add_argument('--assets',type=Path,default=ASSETS);parser.add_argument('--docs',type=Path,default=DOCS)
    args=parser.parse_args();ASSETS=args.assets;DOCS=args.docs
    args.work.mkdir(parents=True,exist_ok=True);DOCS.mkdir(parents=True,exist_ok=True)
    vtk.vtkSMPTools.Initialize(2)
    if args.stage=='all':
        stages=['self-test','extract','band','weld','normals','gentle','moderate','bilateral']
        if args.overview_source.exists():stages+=['overview']
        stages+=['package','render']
        for stage in stages:
            subprocess.run([sys.executable,str(Path(__file__).resolve()),'--stage',stage,'--work',str(args.work),
                '--source',str(args.source),'--overview-source',str(args.overview_source),'--block-cells',str(args.block_cells),
                '--assets',str(ASSETS),'--docs',str(DOCS)],check=True)
    elif args.stage=='self-test':self_test()
    elif args.stage=='extract':extract(args.work,args.source,args.block_cells)
    elif args.stage=='band':deduplicate_band(args.work,args.source)
    elif args.stage=='weld':weld(args.work)
    elif args.stage=='normals':normals_stage(args.work,args.source)
    elif args.stage in ('gentle','moderate'):smooth(args.work,args.stage)
    elif args.stage=='bilateral':bilateral(args.work,args.source)
    elif args.stage=='overview':baseline(args.work,args.source,args.overview_source)
    elif args.stage=='package':package(args.work,args.source)
    elif args.stage=='render':render(args.work,args.source)


if __name__=='__main__':
    main()
