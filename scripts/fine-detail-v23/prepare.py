#!/usr/bin/env python3
"""Resumable bounded fine-source extraction with gentler scalar filtering.

Each slab is independently verified and fingerprinted. It retains exact source
contour boundaries, then applies constrained QEM before welding. A pre-existing
fingerprint is never silently resumed under new settings or scientific code.
"""
from __future__ import annotations
import os
os.environ['OMP_NUM_THREADS']='1'
os.environ['OPENBLAS_NUM_THREADS']='1'
import argparse
import concurrent.futures
import ctypes
import gc
import hashlib
import importlib.util
import json
from pathlib import Path
import resource
import struct
import subprocess
import sys
import tempfile
import time

import numpy as np
from scipy import ndimage as ndi
import vtk

from source import FineSource, ROOT
from constrained_qem import build

SPEC=importlib.util.spec_from_file_location('fine23_previous',ROOT/'scripts/fine-surface-v19/prepare.py')
PREP=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(PREP)
HERE=Path(__file__).resolve().parent
DEFAULT=Path('/workspace/scratch/556c0933fbc6/fine-detail-v23')
SCHEMA='fine-detail-v23.1'


def release():
    gc.collect()
    try:ctypes.CDLL('libc.so.6').malloc_trim(0)
    except (OSError,AttributeError):pass


def setup(work,sigma,radius,slab_cells):
    work.mkdir(parents=True,exist_ok=True)
    src=FineSource(0)
    config=dict(schema=SCHEMA,sourceManifestSha256=src.manifest_sha256,sigmaVoxels=sigma,
                threshold=.28,gaussianTruncate=3.,slabCells=slab_cells,
                conservativeRadiusLimitMm=radius,qemAggressiveness=7.,
                frozenBoundaries=True,interiorEdgeLinkConstraint=True,
                scripts={name:PREP.digest(HERE/name) for name in ['source.py','constrained_qem.py','constrained_qem.cpp','prepare.py']})
    config['fingerprint']=hashlib.sha256(json.dumps(config,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    path=work/'configuration.json'
    if path.exists():assert json.loads(path.read_text())==config,'Different immutable configuration; use a new work directory.'
    else:PREP.save_json(path,config)
    meta=dict(schema=SCHEMA,sourceManifestSha256=src.manifest_sha256,sourceManifest='public/assets/ultra-volume-v7.json',
              sourceSpacingUm=79.4,sourceShapeXYZ=src.shape.tolist(),sourceOriginXYZ=src.origin.tolist(),
              paddedOriginXYZ=(src.origin-1).tolist(),shapeZYX=(src.shape+2)[::-1].tolist(),
              fullDimensionsXYZ=src.full.tolist(),extent=src.meta['extent'],longestMm=src.meta['longestMm'],
              sourceWindow=src.meta['sourceWindow'],threshold=.28,verifiedBlocks=len(src.meta['blocks']),
              fullVolumeAssembled=False,sourceUnchanged=True)
    PREP.save_json(work/'source-ready.json',meta)
    build(work/'bin')
    return config,meta


def slab(work,z0,z1):
    work=Path(work);config=json.loads((work/'configuration.json').read_text());meta=json.loads((work/'source-ready.json').read_text())
    target=work/'slabs'/f'{z0:04}-{z1:04}.npz';record=target.with_suffix('.json')
    if target.exists() and record.exists():
        info=json.loads(record.read_text())
        assert info['fingerprint']==config['fingerprint']
        if PREP.digest(target)==info['sha256']:return info
    started=time.monotonic();vtk.vtkSMPTools.Initialize(2);src=FineSource(32)
    origin=np.array(meta['paddedOriginXYZ']);shape=np.array(meta['shapeZYX'][::-1]);halo=4
    lo=origin.copy();lo[2]+=z0-halo
    hi=origin+shape;hi[2]=origin[2]+z1+halo+1
    # X/Y outer padding already supplies the bank's documented empty value.
    data=src.region(lo,hi).astype(np.float32)
    filtered=ndi.gaussian_filter(data,config['sigmaVoxels'],truncate=3.,mode='constant',cval=0.)
    core=np.ascontiguousarray(filtered[halo:-halo]);del data,filtered
    mesh_origin=src.millimetres(origin+np.array([0,0,z0]))
    mesh=PREP.contour(core,mesh_origin,src.spacing_mm);del core
    points,faces=PREP.arrays(mesh);del mesh
    original_vertices,original_faces=len(points),len(faces)
    # Exact zero-area MC faces have no measurable surface. Removing them before
    # QEM avoids zero normals; orphan points are compacted deterministically.
    good=np.ones(len(faces),bool)
    for start in range(0,len(faces),500_000):
        f=faces[start:start+500_000]
        good[start:start+len(f)]=np.linalg.norm(np.cross(points[f[:,1]]-points[f[:,0]],points[f[:,2]]-points[f[:,0]]),axis=1)>1e-12
    removed_zero=int((~good).sum());faces=faces[good];del good
    used=np.zeros(len(points),bool);used[faces]=True
    mapping=np.cumsum(used,dtype=np.uint32)-1;points=points[used];faces=mapping[faces];del mapping,used
    lower=np.float32(mesh_origin[2]);upper=np.float32(mesh_origin[2]+(z1-z0)*src.spacing_mm)
    points[np.abs(points[:,2]-lower)<1e-5,2]=lower
    points[np.abs(points[:,2]-upper)<1e-5,2]=upper
    frozen_low=points[points[:,2]==lower].copy();frozen_high=points[points[:,2]==upper].copy()
    source_receipt=src.receipt();del src
    target.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f'slab-{z0:04}-',dir=work) as temp:
        temp=Path(temp);raw=temp/'source.bin';out=temp/'output.bin'
        with raw.open('wb') as stream:
            stream.write(struct.pack('<QQ',len(points),len(faces)))
            points.astype('<f4',copy=False).tofile(stream);faces.astype('<u4',copy=False).tofile(stream)
        del points,faces;release()
        binary=work/'bin/constrained-qem';binary.chmod(0o755)
        if original_faces:
            completed=subprocess.run([str(binary),str(raw),str(out),'1',str(config['conservativeRadiusLimitMm']),str(config['qemAggressiveness'])],check=True,text=True,capture_output=True)
            reduction=json.loads(completed.stdout)
            with out.open('rb') as stream:
                nv,nf=struct.unpack('<QQ',stream.read(16));points=np.fromfile(stream,dtype='<f4',count=nv*3).reshape(nv,3);faces=np.fromfile(stream,dtype='<u4',count=nf*3).reshape(nf,3)
                assert not stream.read(1)
        else:
            points=np.empty((0,3),np.float32);faces=np.empty((0,3),np.uint32);reduction={}
    assert np.isfinite(points).all()
    for frozen,value in [(frozen_low,lower),(frozen_high,upper)]:
        present=points[points[:,2]==value]
        assert len(present)==len(frozen),(z0,'boundary count changed')
        if len(present):
            assert np.array_equal(np.sort(present.view('V12').ravel()),np.sort(frozen.view('V12').ravel())),(z0,'frozen contour moved')
    PREP.save_arrays(target,points=points,faces=faces)
    info=dict(schema=SCHEMA,fingerprint=config['fingerprint'],z0=z0,z1=z1,sigmaVoxels=config['sigmaVoxels'],
              referenceVertices=original_vertices,referenceTriangles=original_faces,
              vertices=len(points),triangles=len(faces),removedZeroAreaTriangles=removed_zero,
              boundaryVerticesFrozen=True,topologyConstraint='Interior edge link condition; all open boundary vertices frozen.',
              lowBoundaryVertices=len(frozen_low),highBoundaryVertices=len(frozen_high),
              source=source_receipt,reduction=reduction,sha256=PREP.digest(target),
              bytes=target.stat().st_size,seconds=time.monotonic()-started,
              peakParentRssMiB=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024)
    PREP.save_json(record,info);PREP.log(stage='slab',**{k:v for k,v in info.items() if k not in ['source']})
    return info


def extract(work,config,meta,workers,start=None,stop=None):
    n=meta['shapeZYX'][0]-1;step=config['slabCells']
    tasks=[(str(work),z,min(n,z+step)) for z in range(0,n,step) if (start is None or z>=start) and (stop is None or z<stop)]
    results=[]
    with concurrent.futures.ProcessPoolExecutor(max_workers=workers,max_tasks_per_child=1) as pool:
        futures={pool.submit(slab,*task):task for task in tasks}
        for future in concurrent.futures.as_completed(futures):
            results.append(future.result());results.sort(key=lambda i:i['z0'])
            ledger=dict(schema=SCHEMA,fingerprint=config['fingerprint'],slabCells=step,sigmaVoxels=config['sigmaVoxels'],
                        completedSlabs=len(results),plannedSlabs=len(tasks),
                        referenceTriangles=sum(i['referenceTriangles'] for i in results),triangles=sum(i['triangles'] for i in results),
                        slabs=results,partial=len(results)!=len(tasks))
            PREP.save_json(work/'extraction.json',ledger)
            PREP.save_json(ROOT/'docs/fine-detail-v23/progress.json',dict(
                ledger,configuration=config,workDirectory=str(work),
                checkpointPolicy='Atomic per-slab mesh and SHA256 receipt. Resume only the exact configuration fingerprint.',
                updatedAtUtc=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())))
    return results


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--work',type=Path,default=DEFAULT)
    p.add_argument('--stage',choices=['extract','slab','weld'],default='extract')
    p.add_argument('--sigma',type=float,default=.5)
    p.add_argument('--radius-mm',type=float,default=.6352)
    p.add_argument('--slab-cells',type=int,default=32)
    p.add_argument('--workers',type=int,default=1)
    p.add_argument('--start',type=int);p.add_argument('--stop',type=int)
    a=p.parse_args()
    config,meta=setup(a.work,a.sigma,a.radius_mm,a.slab_cells)
    if a.stage=='slab':slab(a.work,a.start,a.stop)
    elif a.stage=='extract':extract(a.work,config,meta,a.workers,a.start,a.stop)
    elif a.stage=='weld':
        ledger=json.loads((a.work/'extraction.json').read_text())
        assert not ledger['partial'] and ledger['slabs'][0]['z0']==0 and ledger['slabs'][-1]['z1']==meta['shapeZYX'][0]-1
        PREP.weld_slabs(a.work)

if __name__=='__main__':main()
