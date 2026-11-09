#!/usr/bin/env python3
"""Topology/radius-constrained QEM and measured HFM1 encoding of an SFR1 patch.

All open boundaries are frozen by the same pinned reducer used for Gentle.
The radius is an accumulated original-vertex displacement limit, not an
anatomical error bound. Bidirectional finite samples measure delivered error.
"""
from pathlib import Path
import os,sys,json,gzip,struct,gc,hashlib,importlib.util,fcntl,ctypes,subprocess
os.environ.setdefault('OPENBLAS_NUM_THREADS','1');os.environ.setdefault('OMP_NUM_THREADS','1')
import numpy as np
import vtk
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/fine-detail-v23'))
sys.path.insert(0,str(ROOT/'scripts/cleanup-v28-right'))
from exact_transport import read_surface
from constrained_qem import simplify
from source import FineSource
spec=importlib.util.spec_from_file_location('validate28',ROOT/'scripts/fine-surface-v19/validate.py');V=importlib.util.module_from_spec(spec);spec.loader.exec_module(V)
WORK=Path('/workspace/data/cleanup-v28-qem');WORK.mkdir(parents=True,exist_ok=True)
def sha(x):return hashlib.sha256(x).hexdigest()

def inherited_component_cleanup(points,faces,policy):
    """Apply established compact-island criteria only to complete local pieces.

    Any component intersecting a crop face is protected, since its connectivity
    outside the patch is unknown. Long thin components are protected by PCA.
    The reviewed arterial4mm rule is deliberately not generalized here.
    """
    source=ROOT/'scripts/cleanup-v25/debris_components.cpp';libpath=WORK/'components.so'
    if not libpath.exists():subprocess.run(['g++','-O3','-std=c++17','-shared','-fPIC',str(source),'-o',str(libpath)],check=True)
    lib=ctypes.CDLL(str(libpath));nd=np.ctypeslib.ndpointer
    lib.debris_labels.argtypes=[ctypes.c_uint32]*2+[nd(np.uint32,1,flags='C_CONTIGUOUS')]*2;lib.debris_labels.restype=ctypes.c_uint32
    lib.debris_stats.argtypes=[ctypes.c_uint32]*3+[nd(np.uint16,1,flags='C_CONTIGUOUS'),nd(np.uint32,1,flags='C_CONTIGUOUS'),nd(np.uint32,1,flags='C_CONTIGUOUS'),nd(np.float64,1,flags='C_CONTIGUOUS'),nd(np.float64,2,flags='C_CONTIGUOUS')]
    f=np.ascontiguousarray(faces,np.uint32);labels=np.empty(len(points),np.uint32);nc=int(lib.debris_labels(len(points),len(f),f.ravel(),labels))
    length=FineSource(0).meta['longestMm'];bounds=policy['surface']['bounds'];lo=np.asarray(bounds['min'])*length;hi=np.asarray(bounds['max'])*length
    q=np.rint(np.clip((points-lo)/(hi-lo),0,1)*65535).astype(np.uint16);scale=np.ascontiguousarray((hi-lo)/65535,np.float64);stats=np.empty((nc,19),np.float64)
    lib.debris_stats(len(points),len(f),nc,q.ravel(),f.ravel(),labels,scale,stats)
    mean=stats[:,8:11]/np.maximum(stats[:,0,None],1);cov=np.zeros((nc,3,3),np.float64)
    for i,j,col in [(0,0,11),(1,1,12),(2,2,13),(0,1,14),(0,2,15),(1,2,16)]:cov[:,i,j]=cov[:,j,i]=stats[:,col]/np.maximum(stats[:,0],1)-mean[:,i]*mean[:,j]
    eig=np.maximum(np.linalg.eigvalsh(cov),0);spread=np.sqrt((eig[:,2]+.0397**2)/(eig[:,0]+.0397**2));diam=np.linalg.norm(stats[:,5:8]-stats[:,2:5],axis=1)
    remove=(diam<=.85)&(stats[:,1]<=1024)&(spread<3.)
    # This is the existing v26 compact perivalvular criterion, applied only if
    # the whole component lies inside its established fine-grid scope.
    center=(np.asarray(FineSource(0).meta['fullDimensionsXYZ'])-1)/2
    wlo=(stats[:,2:5]+lo);whi=(stats[:,5:8]+lo)
    fine_lo=wlo[:,[0,2,1]]*np.array([1,-1,1])/.0794+center
    fine_hi=whi[:,[0,2,1]]*np.array([1,-1,1])/.0794+center
    aa=np.minimum(fine_lo,fine_hi);bb=np.maximum(fine_lo,fine_hi)
    regional=np.all(aa>=[550,850,850],axis=1)&np.all(bb<=[1280,1250,1420],axis=1)
    remove|=regional&(diam<=1.5)&(stats[:,1]<=2048)&(spread<4.5)
    boundary=stats[:,18]>0;remove[boundary]=False;largest=int(np.argmax(stats[:,1]));remove[largest]=False
    keep=~remove[labels[f[:,0]]];filtered=f[keep];used=np.unique(filtered);mapping=np.zeros(len(points),np.uint32);mapping[used]=np.arange(len(used),dtype=np.uint32)
    result=dict(policy='Inherited v25 compact0.85mm/PCA<3/1024faces plus v26 perivalvularcompact1.5mm/PCA<4.5/2048faces inside establishedscope; no arterial4mm expansion.',inputComponents=nc,removedCompleteComponents=int(remove.sum()),removedTriangles=int((~keep).sum()),removedVertices=int(stats[remove,0].sum()),retainedCropBoundaryComponents=int(boundary.sum()),largestProtected=True,sourceCppSha256=sha(source.read_bytes()),scope='Closed complete components only; every component reaching a patch face retained. Component counts are evaluated beforeQEM on source-adaptive geometry, not the complete originalGentle mesh.')
    return points[used],mapping[filtered],result

def compact(policy_path,radius=.1588,samples=12000):
    policy_path=Path(policy_path);report=json.loads(policy_path.read_text());item=report.get('surfaceReference',report['surface']);path=policy_path.parent/item['file']
    assert item['format']=='SFR1-gzip','Supply the original SFR1 source policy.'
    raw=read_surface(path,item)
    magic,version,nv,ni,po,no,io,_=struct.unpack_from('<8I',raw);assert (magic,version)==(0x31524653,1)
    length=FineSource(0).meta['longestMm']
    points=np.frombuffer(raw,'<f4',nv*3,po).reshape(nv,3).copy()*length
    faces=np.frombuffer(raw,'<u4',ni,io).reshape(-1,3).copy()
    del raw;gc.collect()
    points,faces,component_cleanup=inherited_component_cleanup(points,faces,report);gc.collect()
    # Avoid concurrent large reducer peaks when separate agents reuse this CLI.
    with (WORK/'serial.lock').open('w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        simplified,triangles,reduction=simplify(points,faces,WORK,radius_mm=radius,target=1)
    print(json.dumps({'stage':'reduced','id':report['id'],**reduction}),flush=True)
    vtk.vtkSMPTools.Initialize(1)
    ref=V.prep.poly_from_arrays(points,faces);rng=np.random.default_rng(2800714)
    reference_samples=V.sample_surface(ref,samples,rng)
    bounds=item['bounds'];minimum=np.array(bounds['min']);maximum=np.array(bounds['max']);world=simplified/length
    positions=np.rint(np.clip((world-minimum)/(maximum-minimum),0,1)*65535).astype('<u2')
    decoded=(minimum+positions.astype(np.float64)/65535*(maximum-minimum))*length
    quant_mm=float(np.linalg.norm(decoded-simplified,axis=1).max())
    # Reject quantization-collapsed faces (zero-area only; no component filtering).
    keep=np.ones(len(triangles),bool)
    for start in range(0,len(triangles),100000):
        t=triangles[start:start+100000];a=positions[t[:,0]].astype(np.int64);b=positions[t[:,1]].astype(np.int64);c=positions[t[:,2]].astype(np.int64)
        keep[start:start+len(t)]=np.any(np.cross(b-a,c-a)!=0,axis=1)
    quant_zero=int((~keep).sum());triangles=triangles[keep]
    used=np.unique(triangles);orphan_vertices=int(len(positions)-len(used))
    mapping=np.zeros(len(positions),np.uint32);mapping[used]=np.arange(len(used),dtype=np.uint32)
    triangles=mapping[triangles];positions=positions[used];decoded=decoded[used]
    del mapping,used
    candidate=V.prep.poly_from_arrays(decoded,triangles)
    source_to=V.stats(V.distances(V.distance_function(candidate),reference_samples))
    candidate_samples=V.sample_surface(candidate,samples,rng)
    to_source=V.stats(V.distances(V.distance_function(ref),candidate_samples))
    del ref,candidate,reference_samples,candidate_samples,points,faces;gc.collect()
    assert source_to['p95Mm']<.0794 and to_source['p95Mm']<.0794
    assert max(source_to['maximumSampledMm'],to_source['maximumSampledMm'])<radius+.01
    # Average oriented unit-face normals without smoothing positions.
    normals=np.zeros(decoded.shape,np.float32)
    for start in range(0,len(triangles),100000):
        t=triangles[start:start+100000];n=np.cross(decoded[t[:,1]]-decoded[t[:,0]],decoded[t[:,2]]-decoded[t[:,0]])
        n/=np.maximum(np.linalg.norm(n,axis=1)[:,None],1e-20)
        for i in range(3):np.add.at(normals,t[:,i],n)
    norm=np.linalg.norm(normals,axis=1);bad=norm<1e-8;normal_fallbacks=int(bad.sum())
    if normal_fallbacks:
        largest=np.zeros(len(normals),np.float32)
        for start in range(0,len(triangles),100000):
            t=triangles[start:start+100000];n=np.cross(decoded[t[:,1]]-decoded[t[:,0]],decoded[t[:,2]]-decoded[t[:,0]])
            area=np.linalg.norm(n,axis=1)
            for i in range(3):
                v=t[:,i];choose=bad[v]&(area>largest[v])&(area>1e-20)
                normals[v[choose]]=n[choose]/area[choose,None];np.maximum.at(largest,v,area)
        norm=np.linalg.norm(normals,axis=1)
    assert norm.min()>1e-8
    normals=np.rint(normals/norm[:,None]*32767).astype('<i2')
    indices=np.asarray(triangles,dtype='<u4').ravel();po=32;no=(po+positions.nbytes+3)&~3;io=(no+normals.nbytes+3)&~3
    assert po%4==no%4==io%4==0
    raw=struct.pack('<8I',0x314d4648,1,len(positions),len(indices),po,no,io,0)+positions.tobytes()+bytes(no-po-positions.nbytes)+normals.tobytes()+bytes(io-no-normals.nbytes)+indices.tobytes()
    encoded=gzip.compress(raw,9,mtime=0);out=policy_path.parent/(report['id']+'.hfm.gz');out.write_bytes(encoded)
    report['surfaceReference']=item
    report['inheritedDetachedDisplayCleanup']=component_cleanup
    report['surface']=dict(item,format='HFM1-gzip',file=out.name,vertices=len(positions),triangles=len(indices)//3,vertexCount=len(positions),indexCount=len(indices),positionOffset=po,normalOffset=no,indexOffset=io,compressedBytes=len(encoded),decodedBytes=len(raw),sha256=sha(encoded),decodedSha256=sha(raw),positionEncoding='uint16 normalized in local world bounds',gpuBytes=positions.nbytes+normals.nbytes+indices.nbytes)
    report['meshReduction']=dict(**reduction,deliveredSourceToSurface=source_to,deliveredSurfaceToSource=to_source,quantizationMaximumErrorMm=quant_mm,quantizationZeroAreaFacesRemoved=quant_zero,orphanVerticesCompacted=orphan_vertices,cancellingNormalFallbacks=normal_fallbacks,finiteSampleSeed=2800714,limitation='Sampled surface distances are not a Hausdorff or clinical accuracy bound; the QEM original-vertex radius is a separate conservative constraint.')
    policy_path.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'stage':'delivered','id':report['id'],'triangles':report['surface']['triangles'],'gzipBytes':len(encoded),'gpuBytes':report['surface']['gpuBytes'],'sourceTo':source_to,'toSource':to_source}),flush=True)
    return report
if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('policy',type=Path);p.add_argument('--radius-mm',type=float,default=.1588);p.add_argument('--samples',type=int,default=12000);a=p.parse_args();compact(a.policy,a.radius_mm,a.samples)
