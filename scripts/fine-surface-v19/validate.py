#!/usr/bin/env python3
"""Measure the v19 surface approximation in source millimetres.

Distances are finite area-weighted samples, not a Hausdorff bound or clinical
validation. The dense source comparison uses five spatially separated slabs;
the full-object comparison uses the welded, topology-preserved intermediate.
Original source pixels are read only. Quantized hosted meshes are tested as
served, so the final encoding is included in the distance measurements.
"""
from pathlib import Path
import argparse
import gc
import gzip
import hashlib
import importlib.util
import json
import struct
import time

import numpy as np
from scipy.ndimage import gaussian_filter
import vtk
from vtk.util.numpy_support import numpy_to_vtk, vtk_to_numpy

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('surface_prepare',HERE/'prepare.py')
prep=importlib.util.module_from_spec(spec);spec.loader.exec_module(prep)
ROOT=prep.ROOT


def stats(values):
    values=np.asarray(values,dtype=np.float64)
    return dict(samples=len(values),meanMm=float(values.mean()),rmsMm=float(np.sqrt(np.mean(values**2))),
                medianMm=float(np.median(values)),p95Mm=float(np.quantile(values,.95)),
                p99Mm=float(np.quantile(values,.99)),maximumSampledMm=float(values.max()))


def sample_surface(poly,n,rng,z_interval=None):
    points=vtk_to_numpy(poly.GetPoints().GetData())
    faces=vtk_to_numpy(poly.GetPolys().GetConnectivityArray()).reshape(-1,3)
    if z_interval is not None:
        z=points[faces,2]
        faces=faces[(z.min(axis=1)>=z_interval[0])&(z.max(axis=1)<=z_interval[1])]
    vertices=points[faces]
    areas=np.linalg.norm(np.cross(vertices[:,1]-vertices[:,0],vertices[:,2]-vertices[:,0]),axis=1)*.5
    good=areas>0
    faces=faces[good];areas=areas[good]
    chosen=rng.choice(len(faces),size=n,replace=True,p=areas/areas.sum())
    chosen=points[faces[chosen]]
    u=np.sqrt(rng.random(n));v=rng.random(n)
    return chosen[:,0]*(1-u[:,None])+chosen[:,1]*(u*(1-v))[:,None]+chosen[:,2]*(u*v)[:,None]


def distance_function(poly):
    function=vtk.vtkImplicitPolyDataDistance();function.SetInput(poly)
    return function


def distances(function,samples):
    source=numpy_to_vtk(np.ascontiguousarray(samples,dtype=np.float64),deep=False)
    out=vtk.vtkDoubleArray();out.SetNumberOfComponents(1);out.SetNumberOfTuples(len(samples))
    function.FunctionValue(source,out)
    return np.abs(vtk_to_numpy(out).copy())


def load_hosted(item,manifest,longest_mm):
    path=ROOT/'public'/item['url'].removeprefix('./').lstrip('/')
    payload=path.read_bytes();assert hashlib.sha256(payload).hexdigest()==item['sha256']
    data=gzip.decompress(payload);assert hashlib.sha256(data).hexdigest()==item['decodedSha256']
    magic,version,nv,ni,po,no,io,res=struct.unpack_from('<8I',data)
    assert (magic,version,res)==(0x314d4648,1,0)
    assert ni%3==0 and (po%4,no%4,io%4)==(0,0,0)
    assert po==32 and no>=po+nv*6 and io>=no+nv*6 and io+ni*4==len(data)
    bounds=item.get('bounds',manifest['bounds']);minimum=np.array(bounds['min']);width=np.array(bounds['max'])-minimum
    world=minimum+np.frombuffer(data,dtype='<u2',count=nv*3,offset=po).reshape(nv,3)/65535.*width
    source=world[:,[0,2,1]]*np.array([1,-1,1])*longest_mm
    normals=np.frombuffer(data,dtype='<i2',count=nv*3,offset=no).reshape(nv,3)/32767.
    faces=np.frombuffer(data,dtype='<u4',count=ni,offset=io).reshape(-1,3)
    assert faces.max()<nv and np.isfinite(source).all()
    assert np.all(np.linalg.norm(normals,axis=1)>.99)
    area2=np.linalg.norm(np.cross(source[faces[:,1]]-source[faces[:,0]],source[faces[:,2]]-source[faces[:,0]]),axis=1)
    info=dict(id=item['id'],vertices=nv,triangles=ni//3,compressedBytes=len(payload),decodedBytes=len(data),
              sha256=item['sha256'],decodedSha256=item['decodedSha256'],
              zeroAreaTrianglesAfterQuantization=int((area2<1e-12).sum()),
              normalizedNormalLengthRange=[float(np.linalg.norm(normals,axis=1).min()),float(np.linalg.norm(normals,axis=1).max())])
    return prep.poly_from_arrays(source,faces),info


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work',type=Path,default=prep.DEFAULT_WORK)
    parser.add_argument('--samples',type=int,default=50000)
    parser.add_argument('--local-samples',type=int,default=12000)
    parser.add_argument('--output',type=Path,default=ROOT/'docs/fine-surface-v19/validation.json')
    args=parser.parse_args();vtk.vtkSMPTools.Initialize(2)
    started=time.monotonic();rng=np.random.default_rng(1900794)
    meta=json.loads((args.work/'source-ready.json').read_text())
    manifest=json.loads((prep.ASSET/'manifest.json').read_text())
    report=dict(schemaVersion=1,seed=1900794,sourceSpacingUm=meta['sourceSpacingUm'],
                methodology='Uniform-area random surface points; exact point-to-triangle distance through vtkImplicitPolyDataDistance. Quantized hosted HFM1 tested after decoding.',
                clinicalValidation=False,hausdorffBound=False,assets=[],fullObject=[],localSource=[])
    meshes={};functions={};mesh_samples={}
    for item in manifest['lods']:
        mesh,record=load_hosted(item,manifest,meta['longestMm'])
        meshes[item['id']]=mesh;functions[item['id']]=distance_function(mesh)
        mesh_samples[item['id']]=sample_surface(mesh,args.samples,rng)
        report['assets'].append(record)
    welded=np.load(args.work/'welded-reference.npz')
    reference=prep.poly_from_arrays(welded['points'],welded['faces']);del welded
    reference_samples=sample_surface(reference,args.samples,rng)
    function=distance_function(reference)
    for lod in meshes:
        result=dict(lod=lod,hostedToWelded=stats(distances(function,mesh_samples[lod])),
                    weldedToHosted=stats(distances(functions[lod],reference_samples)))
        report['fullObject'].append(result);print(json.dumps(dict(stage='full-object',**result)),flush=True)
    del reference,function,reference_samples;gc.collect()

    data=np.load(args.work/'fine-source-padded.npy',mmap_mode='r');spacing=meta['sourceSpacingUm']/1000
    base=(np.array(meta['paddedOriginXYZ'])-(np.array(meta['fullDimensionsXYZ'])-1)/2)*spacing
    sigma=manifest['processing']['densityGaussianSigmaVoxels'];halo=4
    # Distributed narrow slabs keep memory bounded while covering basal,
    # ventricular and apical portions of the acquired source crop.
    for center in [320,704,1088,1472,1856]:
        z0=center-8;z1=center+8
        raw=np.asarray(data[z0:z1+1],dtype=np.float32).copy()
        smoothed=gaussian_filter(np.asarray(data[z0-halo:z1+halo+1],dtype=np.float32),sigma=sigma,truncate=3.,mode='constant',cval=0.)[halo:-halo].copy()
        origin=base.copy();origin[2]+=z0*spacing
        raw_mesh=prep.contour(raw,origin,spacing);smooth_mesh=prep.contour(smoothed,origin,spacing)
        interior=(origin[2]+2*spacing,origin[2]+14*spacing)
        raw_points=sample_surface(raw_mesh,args.local_samples,rng,interior)
        smooth_points=sample_surface(smooth_mesh,args.local_samples,rng,interior)
        raw_function=distance_function(raw_mesh);smooth_function=distance_function(smooth_mesh)
        result=dict(paddedSourceZRange=[z0,z1],interiorSourceMm=list(interior),rawTriangles=int(raw_mesh.GetNumberOfCells()),
                    smoothedTriangles=int(smooth_mesh.GetNumberOfCells()),
                    rawToSmoothed=stats(distances(smooth_function,raw_points)),
                    smoothedToRaw=stats(distances(raw_function,smooth_points)),lods=[])
        for lod in meshes:
            # Reverse samples are restricted to the common local interior;
            # the local contour includes a two-voxel halo outside that region.
            points=sample_surface(meshes[lod],args.local_samples,rng,interior)
            result['lods'].append(dict(id=lod,rawToHosted=stats(distances(functions[lod],raw_points)),
                smoothedToHosted=stats(distances(functions[lod],smooth_points)),
                hostedToRaw=stats(distances(raw_function,points)),hostedToSmoothed=stats(distances(smooth_function,points))))
        report['localSource'].append(result)
        print(json.dumps(dict(stage='local-source',**result)),flush=True)
        del raw,smoothed,raw_mesh,smooth_mesh,raw_function,smooth_function,raw_points,smooth_points;gc.collect()
    report['seconds']=time.monotonic()-started
    report['limits']=[
      'Full-object reference already includes sigma-0.8-voxel Gaussian surface filtering and the topology-preserving slab simplification; its distances isolate the final LOD/quantization stage.',
      'Dense unsmoothed-source comparisons cover five 16-cell slabs, not every acquired voxel or every small anatomical feature.',
      'Local contour-to-contour and hosted-to-local-source distances can overestimate error if the closest counterpart lies outside the finite slab halo. Raw-local-source to the full hosted object does not have that target-cropping limitation.',
      'Sampled distance is neither a maximum geometric guarantee nor evidence of preserved valve/chordal topology.',
      'The canonical input is the existing cleaned, windowed uint8 79.4 µm display bank, not the original quantitative 19.85 µm acquisition.',
      'Smoothing and QEM simplification are lossy derived-display operations; source CT images and existing Ultra cut faces are unchanged.'
    ]
    prep.save_json(args.output,report);print(json.dumps(dict(passed=True,output=str(args.output),seconds=report['seconds'])),flush=True)


if __name__=='__main__':main()
