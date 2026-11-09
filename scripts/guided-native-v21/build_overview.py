#!/usr/bin/env python3
"""Build a bounded, resumable display LOD from a completed native surface bank.

Only role=overview, samplingStepNative=4 NBE1 artifacts are read. The immutable
native bank is never edited. Exact lattice welding and boundary-preserving
intermediate decimation precede a final, explicitly lossy whole-mesh QEM pass.
No original whole-bank mesh is assembled in memory.

Example after the reconstruction has completed and released its native layer:
  python scripts/guided-native-v21/build_overview.py \
      --run /workspace/data/guided-native-v21/whole/run \
      --out /workspace/data/guided-native-v21/whole/overview

Use --pilot for a partial study, and --detail-triangles 2500000 for a second LOD.
The source manifest, per-node checkpoints, sampled errors and HFM1 checksums
remain in --out. Individual gzip assets are always smaller than --asset-mib.
"""
from __future__ import annotations

import argparse
import ctypes
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
import tempfile
import time

import numpy as np

from edge_codec import decode_native_edges, mesh_native_edges

DIMENSIONS = np.array((7614, 7614, 8480), np.int64)
SPACING_UM = 19.85
WORLD_SCALE = 8479.0
CHUNK = 100_000
LATTICE_BITS = 18
VERSION = 'guided-native-overview-v21.1'
_COLLAPSE_LIBRARY = None


def collapse_library():
    global _COLLAPSE_LIBRARY
    if _COLLAPSE_LIBRARY is None:
        source = Path(__file__).with_name('overview_collapse.c')
        key = hashlib.sha256(source.read_bytes()+b'c11-O3-v1').hexdigest()
        directory = Path(tempfile.gettempdir())/'guided-native-overview-kernel'
        directory.mkdir(exist_ok=True)
        library = directory/(key+'.so')
        if not library.exists():
            pending = library.with_suffix('.'+str(os.getpid())+'.part')
            try:
                subprocess.run(['cc','-O3','-std=c11','-fPIC','-shared',str(source),'-o',str(pending)],
                    check=True,capture_output=True,text=True)
                pending.replace(library)
            finally:
                pending.unlink(missing_ok=True)
        _COLLAPSE_LIBRARY = ctypes.CDLL(str(library))
        fn = _COLLAPSE_LIBRARY.overview_filter_collapses
        fn.argtypes = [ctypes.c_uint32,ctypes.c_uint32,ctypes.c_void_p,
            ctypes.c_uint32,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,
            ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p]
        fn.restype = ctypes.c_int64
    return _COLLAPSE_LIBRARY


def filter_collapse_proposals(points,faces,proposals,fixed,cell=32):
    points,faces,proposals,fixed = map(np.asarray,(points,faces,proposals,fixed))
    if (points.ndim != 2 or points.shape[1] != 3 or not 0 < len(points) < 2**31
            or not np.isfinite(points).all() or np.any(points < 0)):
        raise ValueError('Collapse-filter points must be finite nonnegative XYZ rows')
    if not math.isfinite(float(cell)) or cell <= 0:
        raise ValueError('Collapse-filter cell width must be positive and finite')
    if fixed.shape != (len(points),) or fixed.dtype.kind not in 'bui' or np.any((fixed != 0)&(fixed != 1)):
        raise ValueError('Collapse-filter fixed mask must have one boolean per vertex')
    for name,array,width in (('faces',faces,3),('proposals',proposals,2)):
        if array.ndim != 2 or array.shape[1] != width or array.dtype.kind not in 'iu':
            raise ValueError(f'Collapse-filter {name} must contain integer index rows')
        if len(array) and (np.any(array < 0) or int(array.max()) >= len(points)):
            raise ValueError(f'Collapse-filter {name} index is out of range')
    if len(faces) > (2**32-1)//3 or len(proposals) > 2**32-1:
        raise ValueError('Collapse-filter counts exceed their uint32 API bounds')
    faces = np.ascontiguousarray(faces,np.uint32)
    proposals = np.ascontiguousarray(proposals,np.uint32)
    fixed = np.ascontiguousarray(fixed,np.uint8)
    grid = np.floor(points/cell)
    if not np.isfinite(grid).all() or np.any(grid >= 1 << LATTICE_BITS):
        raise ValueError('Collapse-filter global cells exceed the exact key range')
    grid = grid.astype(np.uint64)
    keys = np.ascontiguousarray(grid[:,0] | (grid[:,1]<<LATTICE_BITS) | (grid[:,2]<<(2*LATTICE_BITS)))
    accepted = np.empty_like(proposals)
    parent = np.empty(len(points),np.uint32)
    stats = np.zeros(6,np.uint64)
    size = collapse_library().overview_filter_collapses(len(points),len(faces),faces.ctypes.data,
        len(proposals),proposals.ctypes.data,fixed.ctypes.data,keys.ctypes.data,
        accepted.ctypes.data,parent.ctypes.data,stats.ctypes.data)
    if size < 0:
        raise ValueError(f'Bounded collapse incidence filter failed ({size})')
    return accepted[:size].astype(np.int32),parent,dict(proposedCollapses=len(proposals),
        acceptedCollapses=int(stats[0]),rejectedFrozen=int(stats[1]),rejectedDifferentGlobalCell=int(stats[2]),
        rejectedNotCurrentEdge=int(stats[3]),alreadyMerged=int(stats[4]),incidenceVisits=int(stats[5]))


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for part in iter(lambda: stream.read(4 * 1024**2), b''):
            h.update(part)
    return h.hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = path.with_suffix(path.suffix + '.part')
    pending.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')
    pending.replace(path)


def save_mesh(path, points, faces, samples=None, weights=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = path.with_suffix(path.suffix + '.part')
    values = dict(points=np.ascontiguousarray(points, np.float32),
                  faces=np.ascontiguousarray(faces, np.uint32))
    if samples is not None:
        values['referenceSamples'] = np.asarray(samples, np.float64)
        values['referenceWeights'] = np.asarray(weights, np.float64)
    with pending.open('wb') as stream:
        np.savez_compressed(stream, **values)
    pending.replace(path)


def log(stage, **values):
    print(json.dumps(dict(stage=stage, **values), separators=(',', ':')), flush=True)


def vtk_api():
    # Import only the small modules used here, rather than all of VTK.
    from vtkmodules.vtkCommonCore import vtkPoints, vtkDoubleArray, vtkVersion
    from vtkmodules.vtkCommonDataModel import vtkPolyData, vtkCellArray
    from vtkmodules.vtkFiltersCore import vtkDecimatePro, vtkImplicitPolyDataDistance
    from vtkmodules.util.numpy_support import numpy_to_vtk, vtk_to_numpy
    return locals()


def polydata(points, faces):
    v = vtk_api()
    result = v['vtkPolyData']()
    p = v['vtkPoints']()
    dtype = np.float64 if np.asarray(points).dtype == np.float64 else np.float32
    p.SetData(v['numpy_to_vtk'](np.ascontiguousarray(points, dtype), deep=True))
    result.SetPoints(p)
    cells = v['vtkCellArray']()
    offsets = np.arange(0, faces.size + 1, 3, dtype=np.int32)
    cells.SetData(v['numpy_to_vtk'](offsets, deep=True),
                  v['numpy_to_vtk'](np.ascontiguousarray(faces, np.int32).ravel(), deep=True))
    result.SetPolys(cells)
    return result


def vtk_arrays(poly):
    v = vtk_api()
    if not poly.GetNumberOfCells():
        return np.empty((0, 3), np.float32), np.empty((0, 3), np.uint32)
    return (v['vtk_to_numpy'](poly.GetPoints().GetData()).astype(np.float32, copy=True),
            v['vtk_to_numpy'](poly.GetPolys().GetConnectivityArray()).reshape(-1, 3).astype(np.uint32, copy=True))


def lattice_keys(points):
    scaled = points * np.float32(16)
    q = np.rint(scaled).astype(np.uint64)
    if not np.array_equal(q.astype(np.float32), scaled) or np.any(q >= 1 << LATTICE_BITS):
        raise ValueError('Intermediate vertices left the exact step-4 1/16-native lattice')
    return q[:, 0] | (q[:, 1] << LATTICE_BITS) | (q[:, 2] << (2 * LATTICE_BITS))


def compact(points, faces):
    if not len(faces):
        return np.empty((0, 3), np.float32), np.empty((0, 3), np.uint32)
    used, inverse = np.unique(faces, return_inverse=True)
    return np.ascontiguousarray(points[used], np.float32), inverse.reshape(-1, 3).astype(np.uint32)


def clean_faces(points, faces):
    if not np.isfinite(points).all():
        raise ValueError('A simplification stage produced nonfinite positions')
    keep = (faces[:, 0] != faces[:, 1]) & (faces[:, 1] != faces[:, 2]) & (faces[:, 2] != faces[:, 0])
    for start in range(0, len(faces), CHUNK):
        selected = faces[start:start + CHUNK]
        a = points[selected[:, 0]].astype(np.float64)
        cross = np.cross(points[selected[:, 1]] - a, points[selected[:, 2]] - a)
        keep[start:start + len(selected)] &= np.any(cross != 0, axis=1)
    removed = int(len(faces) - np.count_nonzero(keep))
    points, faces = compact(points, faces[keep])
    return points, faces, removed


def weld(parts):
    if not parts:
        return np.empty((0, 3), np.float32), np.empty((0, 3), np.uint32), 0, 0
    point_arrays, face_arrays = [], []
    offset = 0
    for points, faces in parts:
        point_arrays.append(points)
        face_arrays.append(faces + np.uint32(offset))
        offset += len(points)
    points = np.concatenate(point_arrays)
    faces = np.concatenate(face_arrays)
    keys = lattice_keys(points)
    _, first, inverse = np.unique(keys, return_index=True, return_inverse=True)
    merged = len(points) - len(first)
    points = points[first]
    faces = inverse[faces].astype(np.uint32)
    points, faces, removed = clean_faces(points, faces)
    return points, faces, merged, removed


def frozen_signature(points, faces, lo, hi):
    """Exact boundary coordinates and triangle edges on each group plane."""
    keys = lattice_keys(points)
    signatures = []
    for axis in range(3):
        for plane in (lo[axis], hi[axis]):
            on = points[:, axis] == plane
            vertices = np.sort(keys[on])
            edges = []
            for a, b in ((0, 1), (1, 2), (2, 0)):
                select = on[faces[:, a]] & on[faces[:, b]]
                edge = np.sort(keys[faces[select][:, (a, b)]], axis=1)
                if len(edge):
                    edges.append(edge)
            if edges:
                edge, counts = np.unique(np.concatenate(edges), axis=0, return_counts=True)
                # Decimation may add harmless interior chords on this plane.
                # Only one-face edges are the actual shared group seam.
                edge = edge[counts == 1]
            else:
                edge = np.empty((0, 2), np.uint64)
            signatures.append((vertices, edge))
    return signatures


def frozen_equal(a, b):
    return all(np.array_equal(x[0], y[0]) and np.array_equal(x[1], y[1]) for x, y in zip(a, b))


def frozen_ring(points, faces, lo, hi):
    """Freeze every group-plane vertex and every vertex of its incident faces.

    The full original face layer is retained, not merely a count of seam
    vertices. Recomputing this at each parent releases obsolete child seams.
    """
    plane = np.any((points == lo) | (points == hi), axis=1)
    incident = np.any(plane[faces], axis=1)
    fixed = plane.copy()
    fixed[faces[incident].ravel()] = True
    protected = np.all(fixed[faces], axis=1)
    return fixed, protected, int(plane.sum()), int(incident.sum())


def clean_cluster_faces(points, faces, protected):
    """Remove collapsed/repeated free faces without changing the frozen layer.

    Same-winding repetitions collapse to one face. Opposite free windings cancel
    in pairs; any remaining winding keeps one representative. This is expressly
    a lossy display operation, including possible component/topology loss.
    Original protected faces retain their multiplicity and orientation.
    """
    keep = (faces[:,0] != faces[:,1]) & (faces[:,1] != faces[:,2]) & (faces[:,2] != faces[:,0])
    for start in range(0,len(faces),CHUNK):
        selected = faces[start:start+CHUNK]
        a = points[selected[:,0]].astype(np.float64)
        cross = np.cross(points[selected[:,1]]-a,points[selected[:,2]]-a)
        keep[start:start+len(selected)] &= np.any(cross != 0,axis=1)
    if not keep[protected].all():
        raise ValueError('A protected boundary-ring face was collapsed')
    collapsed = int(len(faces)-np.count_nonzero(keep))
    faces, protected = faces[keep], protected[keep]
    if not len(faces):
        return np.empty((0,3),np.uint32), dict(removedDegenerateFaces=collapsed,
            removedSameWindingDuplicates=0,removedOppositeWindingFaces=0)
    canonical_faces = np.sort(faces,axis=1)
    order = np.lexsort((canonical_faces[:,2],canonical_faces[:,1],canonical_faces[:,0]))
    ordered = canonical_faces[order]
    starts = np.r_[0,np.flatnonzero(np.any(ordered[1:] != ordered[:-1],axis=1))+1]
    counts = np.diff(np.r_[starts,len(faces)])
    group = np.repeat(np.arange(len(starts)),counts)
    parity = ((faces[:,0] > faces[:,1]).astype(np.int8)
              + (faces[:,0] > faces[:,2]) + (faces[:,1] > faces[:,2])) & 1
    signs = 1-2*parity
    net = np.add.reduceat(signs[order].astype(np.int32),starts)
    fixed_counts = np.add.reduceat(protected[order].astype(np.int32),starts)
    candidates = ((signs[order] == np.sign(net)[group])
                  & (fixed_counts[group] == 0) & (net[group] != 0))
    chosen = np.minimum.reduceat(np.where(candidates,order,len(faces)),starts)
    selected = np.concatenate((np.flatnonzero(protected),chosen[chosen < len(faces)]))
    selected.sort()
    free = fixed_counts == 0
    cancelled = int(np.sum(counts[free]-np.abs(net[free])))
    repeated = int(np.sum(np.maximum(np.abs(net[free])-1,0)))
    # A free face cannot equal an all-fixed face: no free point maps to a fixed
    # representative. Keep the check explicit if this routine is reused.
    if np.any((fixed_counts != 0) & (fixed_counts != counts)):
        raise ValueError('A free face collided with protected boundary geometry')
    return faces[selected],dict(removedDegenerateFaces=collapsed,
        removedSameWindingDuplicates=repeated,removedOppositeWindingFaces=cancelled)


def cluster_locked(points, faces, lo, hi, cell, fixed=None, protected=None):
    """Deterministic free-vertex clustering on a bounded global native grid.

    A representative is an actual free source point nearest its cluster centroid,
    with exact lattice-key tie breaking. Fixed/free sets never merge; disjoint
    cells cannot select the same source point. No snapping or tolerant weld is
    needed, and no representative can appear on a group plane.
    """
    if fixed is None or protected is None:
        fixed,protected,_,_ = frozen_ring(points,faces,lo,hi)
    free = np.flatnonzero(~fixed)
    remap = np.arange(len(points),dtype=np.uint32)
    clusters = 0
    maximum_move = 0.0
    if len(free):
        grid = np.floor(points[free]/float(cell)).astype(np.uint64)
        keys = grid[:,0] | (grid[:,1] << LATTICE_BITS) | (grid[:,2] << (2*LATTICE_BITS))
        order = np.argsort(keys,kind='stable')
        sorted_keys = keys[order]
        starts = np.r_[0,np.flatnonzero(sorted_keys[1:] != sorted_keys[:-1])+1]
        counts = np.diff(np.r_[starts,len(free)])
        clusters = len(starts)
        centers = np.add.reduceat(points[free[order]].astype(np.float64),starts,axis=0)/counts[:,None]
        group = np.repeat(np.arange(clusters),counts)
        distance = np.sum((points[free[order]]-centers[group])**2,axis=1)
        preference = np.lexsort((lattice_keys(points[free[order]]),distance,group))
        first = np.r_[True,group[preference][1:] != group[preference][:-1]]
        chosen = free[order[preference[first]]]
        if fixed[chosen].any() or np.any((points[chosen] <= lo)|(points[chosen] >= hi)):
            raise ValueError('A free cluster selected a fixed or non-interior representative')
        remap[free[order]] = chosen[group]
        for start in range(0,len(free),CHUNK):
            selected = free[start:start+CHUNK]
            movement = np.linalg.norm(points[selected].astype(np.float64)-points[remap[selected]],axis=1)
            maximum_move = max(maximum_move,float(movement.max(initial=0)))
    if not np.array_equal(remap[fixed],np.flatnonzero(fixed)):
        raise ValueError('Clustering changed a frozen vertex identity')
    result_faces,removed = clean_cluster_faces(points,remap[faces],protected)
    result_points,result_faces = compact(points,result_faces)
    lattice_keys(result_points)
    return result_points,result_faces,dict(method='global-grid-vertex-clustering',
        globalGridOriginNativeXYZ=[0,0,0],cellNativeVoxels=float(cell),cellUm=float(cell*SPACING_UM),
        representative='Actual free source point nearest cluster centroid; lattice-key tie break',
        freeVertices=int(len(free)),freeClusters=int(clusters),fixedVertices=int(fixed.sum()),
        protectedOriginalFaces=int(protected.sum()),maximumVertexMovementNativeVoxels=maximum_move,
        topologyPreserved=False,**removed)


def replay_locked(points,faces,target,lo,hi,cell=32):
    """Use unconstrained QEM only to propose an explicitly constrained replay.

    The C filter accepts current free/free edges within one global cell. Replay
    recomputes QEM from the original input for this accepted subsequence. Free
    positions are quantized and confined to that same cell and the strict group
    interior; fixed ring identities and faces must remain bit exact.
    """
    import fast_simplification
    from fast_simplification import _replay
    fixed,protected,_,_ = frozen_ring(points,faces,lo,hi)
    if fixed.all() or not len(faces):
        return points,faces,dict(method='constrained-qem-replay',acceptedCollapses=0,
            frozenBoundaryExact=True,reason='No free vertices')
    proposal_target = max(4,min(int(target),len(faces)-1))
    proposed_points,proposed_faces,proposals = fast_simplification.simplify(
        points,faces.astype(np.int32),target_count=proposal_target,agg=7.0,return_collapses=True)
    proposed_triangles = len(proposed_faces)
    del proposed_points,proposed_faces
    accepted,parent,filter_info = filter_collapse_proposals(points,faces,proposals,fixed,cell)
    del proposals
    if not len(accepted):
        return points,faces,dict(method='constrained-qem-replay',**filter_info,
            unconstrainedProposalTriangles=proposed_triangles,frozenBoundaryExact=True)
    # Use the installed raw replay, not its public helper's extra isolated-point
    # merging. Every union here must be one accepted by our own current-edge test.
    original_faces = np.ascontiguousarray(faces,np.int32)
    _replay.load_int32(len(points),len(faces),len(accepted),np.ascontiguousarray(points,np.float32),
        original_faces,np.ascontiguousarray(accepted,np.int32))
    _replay.replay()
    result = np.asarray(_replay.return_points(),np.float32).copy()
    mapping = np.asarray(_replay.compute_indice_mapping(accepted,len(points)),np.int64)
    if mapping.shape != (len(points),) or np.any(mapping < 0) or np.any(mapping >= len(result)):
        raise ValueError('QEM replay returned an invalid original-to-output mapping')
    if not np.array_equal(mapping,mapping[parent]):
        raise ValueError('QEM replay mapping differs from the accepted current-edge unions')
    fixed_indices = np.flatnonzero(fixed)
    if (len(np.unique(mapping[fixed_indices])) != len(fixed_indices)
            or not np.array_equal(result[mapping[fixed_indices]],points[fixed_indices])):
        raise ValueError('Constrained QEM replay changed a fixed vertex')
    if not np.isfinite(result).all():
        raise ValueError('Constrained QEM replay produced nonfinite coordinates')
    roots = np.flatnonzero(parent == np.arange(len(points)))
    if len(roots) != len(result) or len(np.unique(mapping[roots])) != len(result):
        raise ValueError('Replay compact identities disagree with accepted union-find roots')
    root_for_output = np.empty(len(result),np.int64)
    root_for_output[mapping[roots]] = roots
    fixed_output = np.zeros(len(result),bool)
    fixed_output[mapping[fixed_indices]] = True
    free_output = np.flatnonzero(~fixed_output)
    original_grid = np.floor(points[root_for_output[free_output]]/cell).astype(np.int64)
    cell_lo = original_grid*(cell*16)
    cell_hi = (original_grid+1)*(cell*16)-1
    lower = np.maximum(cell_lo,np.asarray(lo,np.int64)*16+1)
    upper = np.minimum(cell_hi,np.asarray(hi,np.int64)*16-1)
    if np.any(lower > upper):
        raise ValueError('QEM cell does not intersect the strict group interior')
    # Clip before multiplication so even a large finite unconstrained QEM
    # position cannot overflow the integer lattice conversion.
    free_positions = np.clip(result[free_output].astype(np.float64),lower/16,upper/16)
    q = np.clip(np.rint(free_positions*16).astype(np.int64),lower,upper)
    result[free_output] = q.astype(np.float32)/16
    fixed_keys = lattice_keys(result[mapping[fixed_indices]])
    collision = np.isin(lattice_keys(result[free_output]),fixed_keys)
    # Original surviving free source coordinates are distinct from all fixed
    # coordinates and remain in the same global cell. This deterministic fallback
    # handles an accidental quantized coincidence without merging into the ring.
    restored = free_output[collision]
    result[restored] = points[root_for_output[restored]]
    if np.isin(lattice_keys(result[free_output]),fixed_keys).any():
        raise ValueError('A quantized free QEM representative collided with a fixed vertex')
    if np.any((result[free_output] <= lo)|(result[free_output] >= hi)):
        raise ValueError('A free QEM point lies on/outside a group plane')
    if not np.array_equal(np.floor(result[free_output]/cell).astype(np.int64),original_grid):
        raise ValueError('A free QEM point left its bounded global cell')
    mapped = mapping[faces]
    keys = lattice_keys(result)
    _,first,inverse = np.unique(keys,return_index=True,return_inverse=True)
    coincident_free_welds = len(result)-len(first)
    result = result[first]
    mapped = inverse[mapped].astype(np.uint32)
    if not np.array_equal(result[mapped[protected]],points[faces[protected]]):
        raise ValueError('QEM changed an original protected face or its winding')
    maximum_move = 0.0
    for start in range(0,len(points),CHUNK):
        selection = np.arange(start,min(start+CHUNK,len(points)))
        movement = np.linalg.norm(points[selection].astype(np.float64)-result[inverse[mapping[selection]]],axis=1)
        maximum_move = max(maximum_move,float(movement.max(initial=0)))
    # Filtering a proposal schedule can invalidate its original flip tests. Drop
    # inverted free faces explicitly; the immutable ring cannot be inverted.
    flipped = np.zeros(len(faces),bool)
    for start in range(0,len(faces),CHUNK):
        a = points[faces[start:start+CHUNK]].astype(np.float64)
        z = result[mapped[start:start+CHUNK]].astype(np.float64)
        old_normal = np.cross(a[:,1]-a[:,0],a[:,2]-a[:,0])
        new_normal = np.cross(z[:,1]-z[:,0],z[:,2]-z[:,0])
        flipped[start:start+len(a)] = np.einsum('ij,ij->i',old_normal,new_normal) < 0
    if flipped[protected].any():
        raise ValueError('QEM inverted a protected face')
    cleaned,removed = clean_cluster_faces(result,mapped[~flipped],protected[~flipped])
    result,cleaned = compact(result,cleaned)
    before = frozen_signature(points,faces,lo,hi)
    if not frozen_equal(before,frozen_signature(result,cleaned,lo,hi)):
        raise ValueError('Constrained QEM changed the exact group boundary signature')
    return result,cleaned,dict(method='constrained-qem-replay',fastSimplificationVersion=fast_simplification.__version__,
        **filter_info,unconstrainedProposalTriangles=proposed_triangles,
        globalCellNativeVoxels=cell,globalCellUm=cell*SPACING_UM,
        currentTriangleWithThreeDistinctRootsRequired=True,fixedFreeUnionsForbidden=True,
        positionRule='QEM replay; free-only 1/16 quantization and same-global-cell/strict-group clamp',
        fixedCollisionSourcePointFallbacks=len(restored),removedFlippedFreeFaces=int(flipped.sum()),
        coincidentFreeVerticesWelded=coincident_free_welds,
        currentEdgeConstraintScope='Accepted QEM proposals; post-quantization coincident free vertices may additionally weld',
        maximumVertexMovementNativeVoxels=maximum_move,topologyPreserved=False,
        selfIntersectionFreeEstablished=False,
        frozenBoundaryExact=True,**removed)


def simplify_locked(points, faces, target, lo, hi, cluster_max_cell=16,qem_cell=32,qem_passes=2,
                    allow_parent_cluster=False):
    if len(faces) <= target or not len(faces):
        return points, faces, dict(method='unchanged', frozenBoundaryExact=True)
    before = frozen_signature(points, faces, lo, hi)
    fixed,protected,plane_vertices,incident_faces = frozen_ring(points,faces,lo,hi)
    floor = int(protected.sum())
    trials = []
    # At whole-bank ratios near one percent, VTK's topological constraints were
    # measured to miss heavily and sometimes change the exact seam. Do not spend
    # that work on an evidently unreachable target below the immutable ring.
    if target >= floor and target >= len(faces)*.25:
        v = vtk_api()
        poly = polydata(points,faces)
        dec = v['vtkDecimatePro']()
        dec.SetInputData(poly)
        dec.SetTargetReduction(1.0-target/len(faces))
        dec.PreserveTopologyOn();dec.SplittingOff();dec.BoundaryVertexDeletionOff()
        dec.SetFeatureAngle(180.0);dec.SetMaximumError(1e30);dec.Update()
        result,triangles = vtk_arrays(dec.GetOutput())
        result,triangles,removed = clean_faces(result,triangles)
        exact = frozen_equal(before,frozen_signature(result,triangles,lo,hi))
        trials.append(dict(method='vtkDecimatePro',triangles=len(triangles),frozenBoundaryExact=exact))
        if exact and len(triangles) <= target:
            return result,triangles,dict(method='vtkDecimatePro',vtkVersion=v['vtkVersion'].GetVTKVersion(),
                preserveTopology=True,splitting=False,boundaryVertexDeletion=False,
                frozenBoundaryExact=True,removedDegenerateFaces=removed,targetReached=True,
                frozenFaceFloor=floor,trials=trials)
        del result,triangles,dec,poly
    best_points,best_faces = points,faces
    chosen = dict(method='unchanged-no-free-reduction')
    for cell in (4,8,16,32):
        if cell > cluster_max_cell:
            break
        result,triangles,attempt = cluster_locked(points,faces,lo,hi,cell,fixed,protected)
        exact = frozen_equal(before,frozen_signature(result,triangles,lo,hi))
        if not exact:
            raise ValueError('Locked clustering changed the exact group boundary signature')
        trials.append(dict(method=attempt['method'],cellNativeVoxels=cell,
            triangles=len(triangles),frozenBoundaryExact=True))
        if len(triangles) < len(best_faces):
            best_points,best_faces,chosen = result,triangles,attempt
        if len(best_faces) <= target:
            break
    clustering = chosen
    replay_trials = []
    # A target below the protected floor is unreachable. Retain a free-interior
    # allowance instead of driving every proposal toward an impossible zero.
    effective_target = target if target >= floor else floor+max(32,target)
    for iteration in range(qem_passes):
        if len(best_faces) <= effective_target:
            break
        result,triangles,attempt = replay_locked(best_points,best_faces,
            max(4,effective_target-floor),lo,hi,cell=qem_cell)
        replay_trials.append(dict(**attempt,inputTriangles=len(best_faces),triangles=len(triangles)))
        if len(triangles) >= len(best_faces):
            break
        best_points,best_faces = result,triangles
    if replay_trials and any(a['triangles'] < a['inputTriangles'] for a in replay_trials):
        chosen = dict(method='global-grid-clustering-and-constrained-qem-replay',
            clustering=clustering,qemGlobalCellNativeVoxels=qem_cell,qemPasses=replay_trials,
            topologyPreserved=False)
    parent_fallback = False
    if (allow_parent_cluster and floor <= target and len(best_faces) > target
            and qem_cell > cluster_max_cell):
        result,triangles,attempt = cluster_locked(points,faces,lo,hi,qem_cell,fixed,protected)
        exact = frozen_equal(before,frozen_signature(result,triangles,lo,hi))
        if not exact:
            raise ValueError('Bounded parent clustering changed the exact group seam')
        trials.append(dict(method='parent-global-grid-clustering-fallback',
            cellNativeVoxels=qem_cell,triangles=len(triangles),frozenBoundaryExact=True))
        if len(triangles) < len(best_faces):
            best_points,best_faces = result,triangles
            chosen = dict(**attempt)
            chosen['method'] = 'parent-global-grid-clustering-fallback'
            chosen['previousConstrainedReplayTriangles'] = replay_trials[-1]['triangles'] if replay_trials else None
            parent_fallback = True
    return best_points,best_faces,dict(**chosen,frozenBoundaryExact=True,
        frozenPlaneVertices=plane_vertices,frozenIncidentFaces=incident_faces,
        frozenFaceFloor=floor,targetReached=len(best_faces) <= target,
        targetBelowFrozenFloor=target < floor,triangleBudgetExcess=max(0,len(best_faces)-target),
        primaryClusteringCellLimitNativeVoxels=cluster_max_cell,
        maximumClusteringCellNativeVoxels=qem_cell if parent_fallback else cluster_max_cell,
        parentCellFallbackUsed=parent_fallback,parentCellFallbackAllowed=allow_parent_cluster,
        effectiveTriangleTarget=effective_target,attemptedConstrainedReplayPasses=replay_trials,
        trials=trials)


def surface_samples(points, faces, count, seed):
    if not len(faces) or count <= 0:
        return np.empty((0, 3), np.float64), 0.0
    areas = np.empty(len(faces), np.float64)
    for start in range(0, len(faces), CHUNK):
        f = faces[start:start + CHUNK]
        a = points[f[:, 0]].astype(np.float64)
        areas[start:start + len(f)] = .5 * np.linalg.norm(np.cross(points[f[:, 1]] - a, points[f[:, 2]] - a), axis=1)
    total = float(areas.sum())
    if total == 0:
        return np.empty((0, 3), np.float64), 0.0
    rng = np.random.default_rng(seed)
    indices = np.searchsorted(np.cumsum(areas), rng.random(count) * total, side='right')
    p = points[faces[indices]].astype(np.float64)
    u, t = np.sqrt(rng.random(count)), rng.random(count)
    sample = p[:, 0] * (1 - u[:, None]) + p[:, 1] * (u * (1 - t))[:, None] + p[:, 2] * (u * t)[:, None]
    return sample, total


def closest_distances(points, faces, samples):
    if not len(samples):
        return np.empty(0, np.float64)
    if not len(faces):
        raise ValueError('No triangles remain for a nonempty distance comparison')
    v = vtk_api()
    implicit = v['vtkImplicitPolyDataDistance']()
    implicit.SetInput(polydata(points, faces))
    source = v['numpy_to_vtk'](np.ascontiguousarray(samples, np.float64), deep=False)
    output = v['vtkDoubleArray']()
    output.SetNumberOfComponents(1)
    output.SetNumberOfTuples(len(samples))
    implicit.FunctionValue(source, output)
    return np.abs(v['vtk_to_numpy'](output).copy())


def distance_stats(values, weights=None):
    values = np.asarray(values, np.float64) * SPACING_UM
    if not len(values):
        return dict(samples=0)
    weights = np.ones(len(values), np.float64) if weights is None else np.asarray(weights, np.float64)
    order = np.argsort(values)
    cdf = np.cumsum(weights[order]) / weights.sum()
    quantiles = np.interp((.5, .95, .99), cdf, values[order])
    return dict(samples=len(values), meanUm=float(np.average(values, weights=weights)),
        rmsUm=float(np.sqrt(np.average(values**2, weights=weights))),
        medianUm=float(quantiles[0]), p95Um=float(quantiles[1]), p99Um=float(quantiles[2]),
        maximumSampledUm=float(values.max()))


def inspect_run(run, pilot):
    raw_manifest = (run / 'run.json').read_bytes()
    manifest = json.loads(raw_manifest)
    progress = json.loads((run / 'progress.json').read_text())
    if not pilot and not progress.get('complete'):
        raise ValueError('The native run is incomplete; use --pilot only for an explicitly partial study')
    if manifest.get('nativeDimensionsXYZ') != DIMENSIONS.tolist():
        raise ValueError('Native source geometry differs from LADAF-2021-17')
    records = []
    seen = set()
    for path in sorted((run / 'records').glob('*.json')):
        encoded = path.read_bytes()
        record = json.loads(encoded)
        coord = tuple(record['coordinatesXYZ'])
        if record.get('fingerprint') != manifest['fingerprint'] or coord in seen:
            raise ValueError('Mismatched or duplicate completed tile record')
        seen.add(coord)
        artifacts = [a for a in record.get('artifacts', []) if a.get('role') == 'overview']
        if len(artifacts) != 1:
            raise ValueError(f'Expected exactly one overview checkpoint for {coord}')
        item = artifacts[0]
        if item.get('samplingStepNative') != 4 or item.get('format') != 'NBE1':
            raise ValueError('Overview welding is restricted to step-4 NBE1 artifacts')
        relative = Path(item['path'])
        if relative.is_absolute() or '..' in relative.parts:
            raise ValueError('Artifact path must be relative to the native run')
        artifact = run / relative
        if artifact.stat().st_size != item['bytes'] or digest(artifact) != item['sha256']:
            raise ValueError(f'Overview checkpoint hash differs: {relative}')
        records.append(dict(coordinatesXYZ=list(coord), path=relative.as_posix(),
            bytes=item['bytes'], sha256=item['sha256'], triangles=item['triangles'],
            vertices=item['vertices'], recordSha256=hashlib.sha256(encoded).hexdigest()))
    if not records:
        raise ValueError('No completed overview records were found')
    if not pilot and len(records) != manifest['coreBlocks']:
        raise ValueError('Completed overview records do not cover the complete core plan')
    plan_path = Path(manifest['corePlan'])
    plan_hash = None
    if plan_path.exists():
        plan_hash = digest(plan_path)
        planned = {tuple(map(int, xyz)) for xyz in np.load(plan_path, allow_pickle=False)}
        if (not pilot and seen != planned) or not seen <= planned:
            raise ValueError('Overview record coordinates differ from the source core plan')
    records.sort(key=lambda r: tuple(r['coordinatesXYZ']))
    source = dict(schema=VERSION + '-inputs', donorId='ladaf-2021-17',
        runFingerprint=manifest['fingerprint'], runManifestSha256=hashlib.sha256(raw_manifest).hexdigest(),
        corePlanSha256=plan_hash, corePlanCoordinateSetVerified=plan_hash is not None,
        sourceObjectLedgerSha256=digest(run / 'source-objects.jsonl') if (run / 'source-objects.jsonl').exists() else None,
        completeCorePlan=bool(progress.get('complete') and len(records) == manifest['coreBlocks']),
        pilot=bool(pilot), plannedCoreBlocks=manifest['coreBlocks'], completedOverviewBlocks=len(records),
        nativeDimensionsXYZ=DIMENSIONS.tolist(), sourceSpacingUm=SPACING_UM,
        overviewSamplingStepNative=4, overviewSampleSpacingUm=79.4,
        sourceConfiguration=manifest['config'], records=records)
    return records, source


class Builder:
    def __init__(self, args):
        self.args = args
        sys.path.insert(0,str(args.python_path))
        self.run = args.run.resolve()
        self.out = args.out.resolve()
        if self.out == self.run or any(self.out == self.run / name or self.run / name in self.out.parents for name in ('tiles', 'records')):
            raise ValueError('Overview output must not replace native checkpoints')
        self.out.mkdir(parents=True, exist_ok=True)
        self.records, self.source = inspect_run(self.run, args.pilot)
        self.total_faces = sum(r['triangles'] for r in self.records)
        self.target = max(args.triangles, args.detail_triangles or 0)
        if args.merge_face_cap < self.target:
            raise ValueError('--merge-face-cap must be at least the largest final target')
        settings = dict(triangles=args.triangles, detailTriangles=args.detail_triangles,
            groupBlocks=args.group_blocks, leafFaceCap=args.leaf_face_cap,
            intermediateFactor=args.intermediate_factor,
            samplesPerLeaf=args.samples_per_leaf, reverseSamples=args.reverse_samples,
            assetBytes=int(args.asset_mib * 1024**2), seed=args.seed,
            boundaryMethod='exact-seam-check-with-frozen-ring-global-grid-clustering-fallback',
            maximumClusterCellNativeVoxels=args.cluster_max_cell,
            qemGlobalCellNativeVoxels=args.qem_cell,qemPasses=args.qem_passes,
            parentClusteringFallback='Same QEM cell, only non-leaf nodes with frozen floor within budget',
            finalMethod='fast_simplification-agg7', pilot=args.pilot)
        self.input_hash = hashlib.sha256(canonical(self.source)).hexdigest()
        self.fingerprint = hashlib.sha256(canonical(dict(input=self.input_hash, settings=settings,
            codeSha256=digest(__file__), edgeCodecSha256=digest(Path(__file__).with_name('edge_codec.py')),
            collapseFilterSha256=digest(Path(__file__).with_name('overview_collapse.c'))))).hexdigest()
        state = self.out / 'build.json'
        previous_state = json.loads(state.read_text()) if state.exists() else {}
        if previous_state and previous_state.get('fingerprint') != self.fingerprint:
            raise ValueError('Existing overview checkpoints have different inputs/settings/code; use another --out directory')
        # This cap only refuses an allocation. It never selects an algorithm or
        # changes a target, coordinate, sample, face or output byte. Keep all
        # numerical/input/code settings in the identity, but permit a measured
        # operational-cap change to resume already verified checkpoints.
        self.merge_cap_history = list(previous_state.get('mergeFaceCapsObserved',[]))
        if not self.merge_cap_history or self.merge_cap_history[-1] != args.merge_face_cap:
            self.merge_cap_history.append(args.merge_face_cap)
        atomic_json(self.out / 'input-manifest.json', self.source)
        atomic_json(state, dict(schema=VERSION, fingerprint=self.fingerprint,
            inputManifestCanonicalSha256=self.input_hash,
            inputManifestFileSha256=digest(self.out / 'input-manifest.json'), settings=settings,
            operationalLimits=dict(mergeFaceCap=args.merge_face_cap),
            mergeFaceCapsObserved=self.merge_cap_history,
            operationalCapExcludedFromGeometryIdentity=True))
        self.leaves = []
        self.nodes = []
        self.started = time.monotonic()

    def decode_records(self, records):
        parts = []
        for r in records:
            encoded = (self.run / r['path']).read_bytes()
            if hashlib.sha256(encoded).hexdigest() != r['sha256']:
                raise ValueError('An overview artifact changed during construction')
            inside, _, origin, step = decode_native_edges(encoded)
            if step != 4 or tuple(origin) != tuple(np.asarray(r['coordinatesXYZ']) * 128) or inside.shape != (33, 33, 33):
                raise ValueError('Overview checkpoint geometry differs from its record')
            p, f = mesh_native_edges(encoded)
            if len(f) != r['triangles'] or len(p) != r['vertices']:
                raise ValueError('Overview mesh count differs from its record')
            parts.append((p, f))
        return weld(parts)

    def node(self, records, origin, span):
        name = f's{span:03d}_' + '_'.join(map(str, origin))
        path = self.out / 'nodes' / (name + '.npz')
        record_path = path.with_suffix('.json')
        raw_faces = sum(r['triangles'] for r in records)
        leaf = span <= self.args.group_blocks and raw_faces <= self.args.leaf_face_cap
        if span == 1:
            leaf = True
            if raw_faces > self.args.leaf_face_cap:
                raise ValueError('One overview tile exceeds --leaf-face-cap')
        lo = np.asarray(origin, np.int64) * 128
        hi = (np.asarray(origin, np.int64) + span) * 128
        if leaf:
            self.leaves.append(dict(name=name, records=records, lo=lo.tolist(), hi=hi.tolist(), checkpoint=path))
        children = []
        if not leaf:
            half = span // 2
            groups = {}
            for r in records:
                child = tuple((np.asarray(r['coordinatesXYZ']) // half * half).tolist())
                groups.setdefault(child, []).append(r)
            for child in sorted(groups):
                children.append(self.node(groups[child], child, half))
        if path.exists() and record_path.exists():
            prior = json.loads(record_path.read_text())
            if prior.get('fingerprint') == self.fingerprint and digest(path) == prior['sha256']:
                self.nodes.append(prior)
                return prior
        started = time.monotonic()
        pending_faces = 0
        if leaf:
            points, faces, welded, removed = self.decode_records(records)
            sample, area = surface_samples(points, faces, self.args.samples_per_leaf,
                self.args.seed + int(hashlib.sha256(name.encode()).hexdigest()[:8], 16))
            weights = np.full(len(sample), area / max(1, len(sample)), np.float64)
        else:
            pending_faces = sum(c['triangles'] for c in children)
            if pending_faces > self.args.merge_face_cap:
                audit = dict(schema=VERSION+'-merge-budget',name=name,fingerprint=self.fingerprint,
                    assembled=False,pendingChildTriangles=pending_faces,mergeFaceCap=self.args.merge_face_cap,
                    maximumClusterCellNativeVoxels=self.args.cluster_max_cell,
                    children=[dict(name=c['name'],triangles=c['triangles'],target=c['targetTriangles'],
                        frozenFaceFloor=c['simplification'].get('frozenFaceFloor',0),
                        targetReached=c['triangles'] <= c['targetTriangles']) for c in children],
                    reason='Children exceed the assembly cap after bounded reduction; checkpoints are preserved.')
                atomic_json(self.out/'budget-preflight.json',audit)
                raise MemoryError(f'{name} needs {pending_faces:,} checkpoint triangles; '
                    f'the bounded merge cap is {self.args.merge_face_cap:,}. Checkpoints are retained. '
                    'No oversized mesh was assembled; inspect budget-preflight.json before revising the bounded reduction.')
            parts, samples, sample_weights = [], [], []
            for child in children:
                with np.load(self.out / child['path'], allow_pickle=False) as data:
                    parts.append((data['points'], data['faces']))
                    samples.append(data['referenceSamples'])
                    sample_weights.append(data['referenceWeights'])
            points, faces, welded, removed = weld(parts)
            sample = np.concatenate(samples)
            weights = np.concatenate(sample_weights)
            del parts, samples, sample_weights
        input_vertices, input_faces = len(points), len(faces)
        proportional = self.target * self.args.intermediate_factor * raw_faces / max(1, self.total_faces)
        budget = max(32, min(len(faces), int(math.ceil(proportional))))
        points, faces, simplification = simplify_locked(points, faces, budget, lo, hi,
            cluster_max_cell=self.args.cluster_max_cell,qem_cell=self.args.qem_cell,qem_passes=self.args.qem_passes,
            allow_parent_cluster=not leaf)
        lattice_keys(points)
        save_mesh(path, points, faces, sample, weights)
        node_record = dict(schema=VERSION + '-node', fingerprint=self.fingerprint,
            name=name, path=path.relative_to(self.out).as_posix(), sha256=digest(path),
            originBlockXYZ=list(origin), spanBlocks=span, leaf=leaf,
            children=[c['name'] for c in children], inputOverviewBlocks=len(records),
            originalOverviewTriangles=raw_faces, inputVertices=input_vertices,
            inputTriangles=input_faces,pendingChildTriangles=pending_faces,
            mergeFaceCapAtBuild=self.args.merge_face_cap,weldedDuplicateVertices=welded,
            removedDegenerateFaces=removed, targetTriangles=budget,
            vertices=len(points), triangles=len(faces), simplification=simplification,
            referenceSamples=len(sample), referenceAreaNativeVoxelSquared=float(weights.sum()),
            seconds=time.monotonic() - started)
        atomic_json(record_path, node_record)
        self.nodes.append(node_record)
        log('overview-node', name=name, leaf=leaf, inputTriangles=input_faces,
            triangles=len(faces), target=budget, boundaryExact=simplification['frozenBoundaryExact'])
        del points, faces, sample, weights
        gc.collect()
        return node_record

    def reverse_errors(self, samples, reference_samples):
        """Exact closest-triangle distances with bounded source-group locators."""
        if not len(samples):
            return dict(samples=0)
        from scipy.spatial import cKDTree
        # A point on the reference mesh gives a valid initial upper bound.
        best = cKDTree(reference_samples.astype(np.float64)).query(samples)[0] + 1e-9
        visited = 0
        for leaf in self.leaves:
            lo, hi = np.asarray(leaf['lo']), np.asarray(leaf['hi'])
            box = np.linalg.norm(np.maximum(np.maximum(lo - samples, samples - hi), 0), axis=1)
            chosen = np.flatnonzero(box <= best + 1e-6)
            if not len(chosen):
                continue
            points, faces, _, _ = self.decode_records(leaf['records'])
            if len(faces):
                best[chosen] = np.minimum(best[chosen], closest_distances(points, faces, samples[chosen]))
                visited += 1
            del points, faces
        return dict(**distance_stats(best), sourceGroupsVisited=visited,
            method='Closest triangle over all original overview groups, with exact group-AABB lower-bound pruning')

    def finish(self, root):
        sys.path.insert(0, str(self.args.python_path))
        import fast_simplification
        if root['triangles'] > self.args.merge_face_cap:
            raise MemoryError('Verified root checkpoint exceeds the current operational allocation cap; no root mesh was loaded')
        with np.load(self.out / root['path'], allow_pickle=False) as data:
            reference_points, reference_faces = data['points'], data['faces']
            samples, weights = data['referenceSamples'], data['referenceWeights']
        lods = [('overview', self.args.triangles)]
        if self.args.detail_triangles:
            lods.append(('detail', self.args.detail_triangles))
        assets = []
        for name, target in lods:
            record_path = self.out / (name + '.json')
            if record_path.exists():
                prior = json.loads(record_path.read_text())
                if prior.get('fingerprint') == self.fingerprint and all(
                    (self.out / p['path']).is_file() and digest(self.out / p['path']) == p['sha256'] for p in prior['parts']):
                    assets.append(prior)
                    continue
            started = time.monotonic()
            if len(reference_faces) > target:
                points, faces = fast_simplification.simplify(reference_points, reference_faces.astype(np.int32),
                    target_count=target, agg=7.0, verbose=False)
                points = points.astype(np.float32)
                faces = faces.astype(np.uint32)
            else:
                points, faces = reference_points.copy(), reference_faces.copy()
            points, faces, removed = clean_faces(points, faces)
            if not len(faces):
                raise ValueError('Display simplification removed the entire nonempty overview')
            points, faces = spatial_order(points, faces)
            normals, repaired = geometry_normals(points, faces)
            parts = write_assets(self.out / 'assets', name, points, faces, normals,
                int(self.args.asset_mib * 1024**2))
            # Include float32 world-position storage in the measured distances.
            stored_points = from_world(to_world(points))
            forward = closest_distances(stored_points, faces, samples)
            output_samples, _ = surface_samples(stored_points, faces, self.args.reverse_samples,
                self.args.seed + (1 if name == 'overview' else 2))
            reverse = self.reverse_errors(output_samples.astype(np.float64), samples)
            result = dict(schema=VERSION + '-lod', fingerprint=self.fingerprint,
                id=name, targetTriangles=target, vertices=len(points), triangles=len(faces),
                removedDegenerateFaces=removed, repairedCancellingNormals=repaired,
                parts=[dict(p, path='assets/' + p['path']) for p in parts],
                simplification=dict(method='fast_simplification', version=fast_simplification.__version__,
                    aggressiveness=7.0, inputTriangles=len(reference_faces), topologyPreserved=False),
                sampledDistances=dict(originalOverviewToStoredDisplay=distance_stats(forward, weights),
                    storedDisplayToOriginalOverview=reverse,
                    forwardSampling='Uniform-area samples within every original leaf group; statistics weighted by group surface area',
                    reverseSampling='Uniform-area samples on the float32-stored display surface',
                    reference='Step-4/79.4um NBE1 overview of the processed native-plus-prior field',
                    hausdorffBound=False, anatomicalAccuracyClaim=False),
                seconds=time.monotonic() - started)
            atomic_json(record_path, result)
            assets.append(result)
            log('overview-lod', id=name, triangles=len(faces), parts=len(parts),
                compressedBytes=sum(p['compressedBytes'] for p in parts),
                p95Um=result['sampledDistances']['originalOverviewToStoredDisplay']['p95Um'])
            del points, faces, normals, stored_points, forward, output_samples
            gc.collect()
        result = dict(schema=VERSION, fingerprint=self.fingerprint, complete=True,
            completeInputCorePlan=self.source['completeCorePlan'], pilot=self.args.pilot,
            donorId='ladaf-2021-17', nativeBankModified=False, displayLodIsLossy=True,
            nativeSourceSpacingUm=SPACING_UM, inputOverviewSampleSpacingUm=79.4,
            inputOverviewTriangles=self.total_faces, inputOverviewBlocks=len(self.records),
            inputManifestCanonicalSha256=self.input_hash,
            inputManifestFileSha256=digest(self.out / 'input-manifest.json'),
            inputManifest='input-manifest.json', rootCheckpoint=root['path'],
            hierarchy=dict(nodes=len(self.nodes), leafGroups=len(self.leaves),
                exactLatticeNativeVoxels=1 / 16, latticeKeyBitsPerAxis=LATTICE_BITS,
                frozenGroupBoundariesVerified=True, checkpoints='nodes/',
                finalIntermediateTriangles=root['triangles'],mergeFaceCap=self.args.merge_face_cap,
                mergeFaceCapsObserved=self.merge_cap_history,
                operationalCapExcludedFromGeometryIdentity=True,
                maximumNodeInputTriangles=max(n['inputTriangles'] for n in self.nodes),
                maximumPendingChildTriangles=max(n.get('pendingChildTriangles',0) for n in self.nodes),
                primaryClusteringCellLimitNativeVoxels=self.args.cluster_max_cell,
                maximumClusterCellNativeVoxels=max(n['simplification'].get('maximumClusteringCellNativeVoxels',0) for n in self.nodes),
                qemGlobalCellNativeVoxels=self.args.qem_cell,
                vertexClusteringNodes=sum('clustering' in n['simplification']['method'] for n in self.nodes),
                constrainedQemNodes=sum('constrained-qem' in n['simplification']['method'] for n in self.nodes),
                parentClusteringFallbackNodes=sum(n['simplification'].get('parentCellFallbackUsed',False) for n in self.nodes),
                nodeRecordsCanonicalSha256=hashlib.sha256(canonical(sorted(self.nodes,key=lambda n:n['name']))).hexdigest(),
                collapseFilterSourceSha256=digest(Path(__file__).with_name('overview_collapse.c')),
                intermediateTargetMissNodes=sum(n['triangles']>n['targetTriangles'] for n in self.nodes),
                intermediateTopologyPreserved=False),
            coordinateTransform=dict(nativeDimensionsXYZ=DIMENSIONS.tolist(),
                nativeXYZCenter=((DIMENSIONS - 1) / 2).tolist(), scaleNativeVoxels=WORLD_SCALE,
                worldXYZ='((nativeX-3806.5),(nativeZ-4239.5),-(nativeY-3806.5))/8479',
                handedness='right-handed rotation', positionFormat='float32',
                normalFormat='normalized signed int16 XYZ', indexFormat='uint32',
                hfmVersion=1, hfmPositionFlag=1),
            bounds=dict(min=(-((DIMENSIONS - 1)[[0, 2, 1]] / WORLD_SCALE) / 2).tolist(),
                max=(((DIMENSIONS - 1)[[0, 2, 1]] / WORLD_SCALE) / 2).tolist()),
            lods=assets, peakProcessRssBytes=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024,
            elapsedSeconds=time.monotonic() - self.started,
            limitations=['The display LOD samples the processed field at 79.4um and is simplified; it is not the native surface archive.',
                'QEM simplification can remove real thin structures and alter topology.',
                'Intermediate vertex clustering can collapse components and cancel free duplicate faces; exact node seams are retained.',
                'Constrained QEM and parent cell clustering do not establish manifold topology or absence of self-intersections.',
                'Sampled distances are relative to the encoded overview surface, not raw CT anatomy or a Hausdorff bound.'])
        atomic_json(self.out / 'manifest.json', result)
        return result


def spatial_order(points, faces):
    codes = np.zeros(len(faces), np.uint32)
    for start in range(0, len(faces), CHUNK):
        f = faces[start:start + CHUNK]
        centers = (points[f[:, 0]] + points[f[:, 1]] + points[f[:, 2]]) / 3
        q = np.clip(centers / DIMENSIONS * 1023, 0, 1023).astype(np.uint32)
        c = np.zeros(len(f), np.uint32)
        for bit in range(10):
            for axis in range(3):
                c |= ((q[:, axis] >> bit) & 1) << (3 * bit + axis)
        codes[start:start + len(f)] = c
    faces = faces[np.argsort(codes, kind='stable')]
    used, first = np.unique(faces, return_index=True)
    order = used[np.argsort(first)]
    mapping = np.empty(len(points), np.uint32)
    mapping[order] = np.arange(len(order), dtype=np.uint32)
    return points[order], mapping[faces]


def geometry_normals(points, faces):
    normals = np.zeros((len(points), 3), np.float64)
    largest = np.zeros(len(points), np.float64)
    fallback = np.zeros((len(points), 3), np.float64)
    for start in range(0, len(faces), CHUNK):
        f = faces[start:start + CHUNK]
        a = points[f[:, 0]].astype(np.float64)
        cross = np.cross(points[f[:, 1]] - a, points[f[:, 2]] - a)
        area = np.linalg.norm(cross, axis=1)
        for corner in range(3):
            vertex = f[:, corner]
            np.add.at(normals, vertex, cross)
            np.maximum.at(largest, vertex, area)
            take = area >= largest[vertex]
            fallback[vertex[take]] = cross[take] / area[take, None]
    length = np.linalg.norm(normals, axis=1)
    bad = length < 1e-15
    normals[bad] = fallback[bad]
    length = np.linalg.norm(normals, axis=1)
    if np.any(length == 0):
        raise ValueError('An isolated or degenerate vertex has no valid normal')
    return (normals / length[:, None]).astype(np.float32), int(bad.sum())


def to_world(points):
    centered = np.asarray(points, np.float64) - (DIMENSIONS - 1) / 2
    return np.ascontiguousarray(centered[:, [0, 2, 1]] * np.array([1, 1, -1]) / WORLD_SCALE, dtype='<f4')


def from_world(points):
    return np.asarray(points, np.float64)[:, [0, 2, 1]] * np.array([1, -1, 1]) * WORLD_SCALE + (DIMENSIONS - 1) / 2


def write_hfm(path, points, faces, normals):
    world = to_world(points)
    normal = np.ascontiguousarray(np.rint(np.clip(normals[:, [0, 2, 1]] * np.array([1, 1, -1]), -1, 1) * 32767), dtype='<i2')
    indices = np.ascontiguousarray(faces, '<u4')
    po = 32
    no = (po + world.nbytes + 3) & ~3
    io = (no + normal.nbytes + 3) & ~3
    header = struct.pack('<8I', 0x314d4648, 1, len(points), faces.size, po, no, io, 1)
    decoded_hash = hashlib.sha256()
    decoded_bytes = io + indices.nbytes
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = path.with_suffix(path.suffix + '.part')
    with pending.open('wb') as raw:
        with gzip.GzipFile(filename='', fileobj=raw, mode='wb', compresslevel=6, mtime=0) as stream:
            for payload in (header, memoryview(world).cast('B'), b'\0' * (no - po - world.nbytes),
                            memoryview(normal).cast('B'), b'\0' * (io - no - normal.nbytes), memoryview(indices).cast('B')):
                decoded_hash.update(payload)
                stream.write(payload)
    check, checked_bytes = hashlib.sha256(), 0
    with gzip.open(pending, 'rb') as stream:
        for part in iter(lambda: stream.read(4 * 1024**2), b''):
            checked_bytes += len(part)
            check.update(part)
    if check.digest() != decoded_hash.digest() or checked_bytes != decoded_bytes:
        raise ValueError('HFM1 gzip round trip failed')
    restored = from_world(world)
    error = np.linalg.norm(restored - points, axis=1) * SPACING_UM
    collapsed, flipped = 0, 0
    for start in range(0, len(faces), CHUNK):
        f = faces[start:start + CHUNK]
        a = points[f[:, 0]].astype(np.float64)
        b = restored[f[:, 0]]
        before = np.cross(points[f[:, 1]] - a, points[f[:, 2]] - a)
        after = np.cross(restored[f[:, 1]] - b, restored[f[:, 2]] - b)
        collapsed += int(np.count_nonzero(~np.any(after != 0, axis=1)))
        flipped += int(np.count_nonzero(np.einsum('ij,ij->i', before, after) <= 0))
    if collapsed or flipped:
        raise ValueError('Float32 world encoding collapsed or reversed a display triangle')
    pending.replace(path)
    return dict(path=path.name, format='HFM1', positionFormat='float32', positionFlag=1,
        vertices=len(points), triangles=len(faces), compressedBytes=path.stat().st_size,
        decodedBytes=decoded_bytes, sha256=digest(path), decodedSha256=decoded_hash.hexdigest(),
        float32PositionMaximumErrorUm=float(error.max(initial=0)),
        float32PositionRmsErrorUm=float(np.sqrt(np.mean(error**2))) if len(error) else 0,
        collapsedTriangles=collapsed, flippedTriangles=flipped, losslessGzipRoundTrip=True)


def write_assets(directory, name, points, faces, normals, maximum_bytes):
    results = []

    def part(selected, label):
        used, inverse = np.unique(selected, return_inverse=True)
        path = directory / (label + '.hfm.gz')
        info = write_hfm(path, points[used], inverse.reshape(-1, 3).astype(np.uint32), normals[used])
        if info['compressedBytes'] < maximum_bytes:
            results.append(info)
            return
        path.unlink()
        if len(selected) < 2:
            raise ValueError('Asset byte limit is too small for one triangle')
        # Spatial ordering was already applied; the two halves keep that order.
        middle = len(selected) // 2
        part(selected[:middle], label + '-a')
        part(selected[middle:], label + '-b')

    part(faces, name)
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', type=Path, default=Path('/workspace/data/guided-native-v21/whole/run'))
    parser.add_argument('--out', type=Path, default=Path('/workspace/data/guided-native-v21/whole/overview'))
    parser.add_argument('--triangles', type=int, default=1_250_000)
    parser.add_argument('--detail-triangles', type=int, default=0)
    parser.add_argument('--group-blocks', type=int, default=4)
    parser.add_argument('--leaf-face-cap', type=int, default=750_000)
    parser.add_argument('--merge-face-cap', type=int, default=6_000_000)
    parser.add_argument('--intermediate-factor', type=float, default=2.0)
    parser.add_argument('--cluster-max-cell',type=int,choices=(4,8,16,32),default=16,
        help='Maximum global clustering cell width in native voxels; default 16, with exact frozen group rings')
    parser.add_argument('--qem-cell',type=int,choices=(16,32),default=32,
        help='Global native-voxel cell confining constrained QEM replay; never crosses frozen rings')
    parser.add_argument('--qem-passes',type=int,choices=(0,1,2),default=2,
        help='Maximum refreshed constrained QEM proposal passes after bounded clustering')
    parser.add_argument('--samples-per-leaf', type=int, default=256)
    parser.add_argument('--reverse-samples', type=int, default=4096)
    parser.add_argument('--asset-mib', type=float, default=32.0)
    parser.add_argument('--seed', type=int, default=210794)
    parser.add_argument('--python-path', type=Path, default=Path('/workspace/data/fine-surface-v19-python'))
    parser.add_argument('--pilot', action='store_true')
    parser.add_argument('--nodes-only', action='store_true', help='Checkpoint hierarchy without final simplification/export')
    args = parser.parse_args()
    if args.group_blocks < 1 or args.group_blocks & (args.group_blocks - 1):
        parser.error('--group-blocks must be a positive power of two')
    if min(args.triangles, args.leaf_face_cap, args.merge_face_cap, args.samples_per_leaf) < 1:
        parser.error('Triangle caps and sample count must be positive')
    if args.detail_triangles < 0 or args.reverse_samples < 0 or args.intermediate_factor < 1 or not 0 < args.asset_mib <= 32:
        parser.error('Invalid detail, sample, intermediate, or asset-size setting')
    builder = Builder(args)
    span = 1 << int(max(max(r['coordinatesXYZ']) for r in builder.records)).bit_length()
    root = builder.node(builder.records, (0, 0, 0), span)
    if args.nodes_only:
        log('overview-hierarchy-complete', root=root['path'], triangles=root['triangles'])
        return
    result = builder.finish(root)
    log('overview-complete', inputBlocks=result['inputOverviewBlocks'],
        inputTriangles=result['inputOverviewTriangles'],
        outputTriangles={x['id']: x['triangles'] for x in result['lods']},
        peakProcessRssBytes=result['peakProcessRssBytes'], manifest=str(builder.out / 'manifest.json'))


if __name__ == '__main__':
    main()
