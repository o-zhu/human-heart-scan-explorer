#!/usr/bin/env python3
"""Small independent geometric checks plus generated-asset integrity checks."""
from pathlib import Path
import ctypes
import gzip
import hashlib
import json
import subprocess
import tempfile
import numpy as np

ROOT=Path(__file__).resolve().parents[2]

def main():
    points=[]; faces=[]; expected=[]
    octa_faces=np.array([[0,2,4],[2,1,4],[1,3,4],[3,0,4],
                         [2,0,5],[1,2,5],[3,1,5],[0,3,5]],dtype=np.uint32)
    def octa(center,axes):
        first=len(points)
        p=np.array(center)+np.array([[axes[0],0,0],[-axes[0],0,0],
          [0,axes[1],0],[0,-axes[1],0],[0,0,axes[2]],[0,0,-axes[2]]])
        points.extend(p.tolist()); faces.extend((octa_faces+first).tolist())
        expected.append(list(range(first,first+6)))
    octa([2000,2000,2000],[1000,1000,1000])  # Largest component, attached branch below.
    octa([5000,5000,5000],[40,40,40])         # Compact detached speck, excluded.
    octa([6000,5000,5000],[400,10,10])        # Thin rod, under size bound, protected by PCA.
    octa([7000,5000,5000],[250,250,10])       # Thin sheet, under size bound, protected by PCA.
    octa([9000,5000,5000],[700,700,700])      # Larger compact structure, protected by extent.
    octa([10,10000,10000],[10,10,10])        # Quantized outer boundary, protected.
    first=len(points)
    points.extend([[3100,2000,2000],[3150,2050,2000],[3150,2000,2050]])
    faces.extend([[0,first,first+1],[0,first+1,first+2],[0,first+2,first],[first,first+2,first+1]])
    expected[0].extend(range(first,first+3))
    points.append([12345,12345,12345])      # Unreferenced vertex, not a component.
    q=np.array(points,dtype=np.uint16); f=np.array(faces,dtype=np.uint32).reshape(-1)
    labels=np.empty(len(q),dtype=np.uint32); scale=np.full(3,.001)
    with tempfile.TemporaryDirectory(prefix='heart-debris-check-') as temp:
        binary=Path(temp)/'debris.so'
        subprocess.run(['g++','-O3','-std=c++17','-shared','-fPIC',
          str(Path(__file__).with_name('debris_components.cpp')),'-o',str(binary)],check=True)
        lib=ctypes.CDLL(str(binary)); arr=np.ctypeslib.ndpointer
        lib.debris_labels.argtypes=[ctypes.c_uint32]*2+[
          arr(np.uint32,1,flags='C_CONTIGUOUS'),arr(np.uint32,1,flags='C_CONTIGUOUS')]
        lib.debris_labels.restype=ctypes.c_uint32
        lib.debris_stats.argtypes=[ctypes.c_uint32]*3+[
          arr(np.uint16,2,flags='C_CONTIGUOUS'),arr(np.uint32,1,flags='C_CONTIGUOUS'),
          arr(np.uint32,1,flags='C_CONTIGUOUS'),arr(np.float64,1,flags='C_CONTIGUOUS'),
          arr(np.float64,2,flags='C_CONTIGUOUS')]
        nc=lib.debris_labels(len(q),len(f)//3,f,labels)
        assert nc==6 and labels[-1]==np.iinfo(np.uint32).max
        assert len(set(int(labels[e[0]]) for e in expected))==6
        for e in expected: assert np.all(labels[e]==labels[e[0]])
        stats=np.empty((nc,19),dtype=np.float64)
        lib.debris_stats(len(q),len(f)//3,nc,q,f,labels,scale,stats)
    reference=[]
    for e in expected:
        c=int(labels[e[0]]); p=q[e].astype(np.float64)*scale
        s=stats[c]; assert s[0]==len(e)
        assert np.allclose(s[2:5],p.min(axis=0)) and np.allclose(s[5:8],p.max(axis=0))
        cov=np.cov(p,rowvar=False,bias=True)
        means=s[8:11]/s[0]
        actual=np.diag(s[11:14]/s[0]-means**2)
        for k,(i,j) in enumerate(((0,1),(0,2),(1,2))):
            actual[i,j]=actual[j,i]=s[14+k]/s[0]-means[i]*means[j]
        assert np.allclose(actual,cov,rtol=1e-8,atol=1e-11)
        eig=np.maximum(np.linalg.eigvalsh(cov),0)
        spread=float(np.sqrt((eig[-1]+.0397**2)/(eig[0]+.0397**2)))
        diameter=float(np.linalg.norm(p.max(axis=0)-p.min(axis=0)))
        reference.append(bool(diameter<=.85 and spread<3 and s[18]==0 and c!=int(stats[:,1].argmax())))
    assert reference==[False,True,False,False,False,False]
    source=json.loads((ROOT/'public/assets/cleanup-v25/debris-manifest.json').read_text())
    profile=source['profiles'][0]; loaded={}
    for key in ['vertexFlags','faceKeepMask']:
        item=profile[key]; raw=(ROOT/'public'/item['url'].removeprefix('./')).read_bytes()
        assert len(raw)==item['compressedBytes'] and hashlib.sha256(raw).hexdigest()==item['sha256']
        decoded=gzip.decompress(raw)
        assert len(decoded)==item['decodedBytes'] and hashlib.sha256(decoded).hexdigest()==item['decodedSha256']
        loaded[key]=np.frombuffer(decoded,dtype=np.uint8)
    flags=loaded['vertexFlags']; assert len(flags)==profile['sourceVertexCount']
    assert set(np.unique(flags))<={0,255}
    assert int(np.count_nonzero(flags))==profile['removedVertices']
    bits=np.unpackbits(loaded['faceKeepMask'],bitorder='little')
    assert int(np.count_nonzero(bits[:profile['sourceTriangleCount']]==0))==profile['removedTriangles']
    assert np.all(bits[profile['sourceTriangleCount']:]==0)
    report={'passed':True,'syntheticChecks':['shared-vertex connectivity','unreferenced vertices',
      'C++ covariance agrees with independent NumPy covariance','compact detached speck excluded',
      'main and attached branch retained','subthreshold rod retained','subthreshold sheet retained',
      'large compact component retained','quantized boundary component retained'],
      'assetChecks':['compressed hashes and lengths','decoded hashes and lengths','vertex flag domain and count',
        'face mask bit order, count and padding'],
      'sourceDecodedSha256':profile['sourceDecodedSha256']}
    (ROOT/'docs/cleanup-v25/debris-validation.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))

if __name__=='__main__': main()
