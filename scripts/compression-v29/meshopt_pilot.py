#!/usr/bin/env python3
"""Compare exact triangle sequence and bounded-normal meshoptimizer transport."""
from pathlib import Path
import sys,struct,json,zlib,time,hashlib
import numpy as np
sys.path.insert(0,'/tmp/heart-meshopt-v29')
import meshoptimizer as mo

ROOT=Path(__file__).resolve().parents[2]

def oct_encode(n,bits):
    f=n.astype(np.float64);f/=np.maximum(1e-20,np.abs(f).sum(axis=1))[:,None]
    xy=f[:,:2].copy();neg=f[:,2]<0
    xy[neg]=(1-np.abs(xy[neg,::-1]))*np.where(xy[neg]<0,-1,1)
    scale=2**(bits-1)-1
    return np.rint(xy*scale).astype('<i2')

def oct_decode(xy,bits):
    f=xy.astype(np.float64)/(2**(bits-1)-1)
    z=1-np.abs(f).sum(axis=1);neg=z<0
    f[neg]=(1-np.abs(f[neg,::-1]))*np.where(f[neg]<0,-1,1)
    n=np.column_stack([f,z]);n/=np.maximum(1e-20,np.linalg.norm(n,axis=1))[:,None]
    return np.rint(n*32767).astype('<i2')

def measure():
    path=Path('/workspace/data/heart-v29-compress/original.hfm')
    a=np.memmap(path,dtype=np.uint8,mode='r');_,_,nv,ni,po,no,io,_=struct.unpack('<8I',a[:32])
    p=np.ndarray((nv,3),dtype='<u2',buffer=a,offset=po);n=np.ndarray((nv,3),dtype='<i2',buffer=a,offset=no);f=np.ndarray((ni//3,3),dtype='<u4',buffer=a,offset=io)
    length=150000
    p=np.concatenate([p[s:s+length] for s in [0,nv//2,nv-length]])
    n=np.concatenate([n[s:s+length] for s in [0,nv//2,nv-length]])
    f=np.concatenate([f[s:s+length] for s in [0,len(f)//2,len(f)-length]])
    rows=[]
    for name,kind,data in [('positions','vertex',np.column_stack([p,np.zeros(len(p),dtype='<u2')]).astype('<u2')),
                           ('normals','vertex',np.column_stack([n,np.zeros(len(n),dtype='<i2')]).astype('<i2')),
                           *[(f'normals-oct-{bits}','vertex',oct_encode(n,bits)) for bits in [16,14,12,11,10]],
                           ('index-triangles','index',f.reshape(-1)),('index-sequence','sequence',f.reshape(-1))]:
        if kind=='vertex':
            b=mo.encode_vertex_buffer(data);back=mo.decode_vertex_buffer(len(data),data.dtype.itemsize*data.shape[1],b).view(data.dtype).reshape(data.shape)
        elif kind=='index':
            b=mo.encode_index_buffer(data,vertex_count=nv);back=mo.decode_index_buffer(len(data),4,b)
        else:
            b=mo.encode_index_sequence(data,vertex_count=nv);back=mo.decode_index_sequence(len(data),4,b)
        row=dict(candidate=name,codecBytes=len(b),gzipBytes=len(zlib.compress(b,6)),decodedBytes=data.nbytes,equal=bool(np.array_equal(data,back)))
        if kind=='index' and not row['equal']:
            shaped=back.reshape(-1,3);rotate=np.zeros(len(f),dtype=np.uint8)
            for k in [1,2]:rotate[np.all(np.roll(shaped,k,axis=1)==f,axis=1)]=k
            assert all(np.all(np.roll(shaped[rotate==k],k,axis=1)==f[rotate==k]) for k in [0,1,2])
            row['rotationBitsGzipBytes']=len(zlib.compress(rotate.tobytes(),6));row['cyclicRotationsOnly']=True
        if 'oct' in name:
            bits=int(name.rsplit('-',1)[1]);restored=oct_decode(data,bits).astype(np.float64);orig=n.astype(np.float64)
            restored/=np.linalg.norm(restored,axis=1)[:,None];orig/=np.maximum(1e-20,np.linalg.norm(orig,axis=1))[:,None]
            angles=np.rad2deg(np.arccos(np.clip((orig*restored).sum(axis=1),-1,1)))
            row['angularErrorDegrees']=dict(max=float(angles.max()),rms=float(np.sqrt(np.mean(angles**2))),p99=float(np.quantile(angles,.99)))
        rows.append(row);print(json.dumps(row),flush=True)
    for bits in [16,14,12,11,10]:
        octa=oct_encode(n,bits)
        unsigned=(octa.astype(np.int32)+(2**(bits-1)-1)).astype(np.uint32)
        interleaved=unsigned[:,0] | (unsigned[:,1]<<bits)
        planes=interleaved.view(np.uint8).reshape(-1,4)[:,:int(np.ceil(bits*2/8))].T.copy()
        packed=planes.tobytes();gz=zlib.compress(packed,6)
        restored=oct_decode(octa,bits).astype(np.int32)
        residual=n.astype(np.int32)-restored
        r8=residual.astype(np.int8)
        row=dict(candidate=f'oct{bits}-planes',codecBytes=len(packed),gzipBytes=len(gz),decodedBytes=n.nbytes,
                 maxResidual=int(np.abs(residual).max()), exactResidualGzipBytes=len(zlib.compress(residual.astype('<i2').T.copy().view(np.uint8).tobytes(),6)))
        if np.abs(residual).max()<=127:row['exactResidualInt8GzipBytes']=len(zlib.compress(r8.T.copy().tobytes(),6))
        rows.append(row);print(json.dumps(row),flush=True)
    (ROOT/'docs/compression-v29/meshopt-pilot.json').write_text(json.dumps(dict(schema='heart-meshopt-pilot-v29',rows=rows),indent=2)+'\n')

if __name__=='__main__':measure()
