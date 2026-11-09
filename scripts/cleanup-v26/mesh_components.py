#!/usr/bin/env python3
"""Read-only complete-mesh component analysis shared by v26 review tools."""
from pathlib import Path
import ctypes,gzip,hashlib,json,subprocess,sys,tempfile,time
import numpy as np

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/lumen-artifacts-v23'))
from mesh_transport import load_mesh_arrays
EXPECTED='175548ddaad01c409d59d561df6018c5cb0c90752b2ec771899c255065398dae'

def analyze():
    manifest=json.loads((ROOT/'public/assets/fine-surface-v23/manifest.json').read_text())
    lod=next(v for v in manifest['lods'] if v['id']=='gentle')
    assert lod['decodedSha256']==EXPECTED
    mesh=load_mesh_arrays(manifest,lod,ROOT)
    meta=json.loads((ROOT/'public/assets/ultra-volume-v7.json').read_text())
    positions,indices=mesh['positions'],mesh['indices']
    nv,nt=mesh['vertexCount'],mesh['indexCount']//3
    labels=np.empty(nv,np.uint32)
    scale=(np.array(mesh['bounds']['max'])-np.array(mesh['bounds']['min']))*meta['longestMm']/65535
    with tempfile.TemporaryDirectory(prefix='heart-components-v26-') as temp:
        binary=Path(temp)/'components.so'
        subprocess.run(['g++','-O3','-std=c++17','-shared','-fPIC',str(ROOT/'scripts/cleanup-v25/debris_components.cpp'),'-o',str(binary)],check=True)
        lib=ctypes.CDLL(str(binary));arr=np.ctypeslib.ndpointer
        lib.debris_labels.argtypes=[ctypes.c_uint32]*2+[arr(np.uint32,1,flags='C_CONTIGUOUS'),arr(np.uint32,1,flags='C_CONTIGUOUS')]
        lib.debris_labels.restype=ctypes.c_uint32
        lib.debris_stats.argtypes=[ctypes.c_uint32]*3+[arr(np.uint16,2,flags='C_CONTIGUOUS'),arr(np.uint32,1,flags='C_CONTIGUOUS'),arr(np.uint32,1,flags='C_CONTIGUOUS'),arr(np.float64,1,flags='C_CONTIGUOUS'),arr(np.float64,2,flags='C_CONTIGUOUS')]
        nc=int(lib.debris_labels(nv,nt,indices,labels));stats=np.empty((nc,19),np.float64)
        lib.debris_stats(nv,nt,nc,positions,indices,labels,scale,stats)
    diameter=np.linalg.norm(stats[:,5:8]-stats[:,2:5],axis=1)
    eigen=np.empty((nc,3),np.float64)
    for start in range(0,nc,20000):
        s=stats[start:start+20000];means=s[:,8:11]/s[:,0,None];cov=np.empty((len(s),3,3))
        for j in range(3):cov[:,j,j]=s[:,11+j]/s[:,0]-means[:,j]**2
        for k,(j,l) in enumerate(((0,1),(0,2),(1,2))):cov[:,j,l]=cov[:,l,j]=s[:,14+k]/s[:,0]-means[:,j]*means[:,l]
        eigen[start:start+len(s)]=np.maximum(np.linalg.eigvalsh(cov),0)
    spread=np.sqrt((eigen[:,2]+.0397**2)/(eigen[:,0]+.0397**2))
    offset=np.array(mesh['bounds']['min'])*meta['longestMm']
    low,high=stats[:,2:5]+offset,stats[:,5:8]+offset
    center=(low+high)/2
    # World is (source X, source Z, minus source Y), in physical millimetres.
    centers=center[:,[0,2,1]]*[1,-1,1]/.0794+(np.array(meta['fullDimensionsXYZ'])-1)/2
    fine_lo=low[:,[0,2,1]]*[1,-1,1]/.0794+(np.array(meta['fullDimensionsXYZ'])-1)/2
    fine_hi=high[:,[0,2,1]]*[1,-1,1]/.0794+(np.array(meta['fullDimensionsXYZ'])-1)/2
    fine_lo[:,1],fine_hi[:,1]=fine_hi[:,1].copy(),fine_lo[:,1].copy()
    main_id=int(stats[:,1].argmax())
    removed=(diameter<=.85)&(stats[:,1]<=1024)&(stats[:,18]==0)&(spread<3)
    removed[main_id]=False
    return dict(mesh=mesh,lod=lod,manifest=manifest,meta=meta,stats=stats,labels=labels,diameter=diameter,spread=spread,eigen=eigen,centers=centers,lower=fine_lo,upper=fine_hi,main_id=main_id,removed=removed)

def inspect():
    a=analyze();mesh=a['mesh'];stats=a['stats'];labels=a['labels']
    print('analyzed',len(stats),'components',flush=True)
    coords=np.array([[1188,943,756],[1217,916,899],[1250,1157,940],[1292,1147,898],[1325,1195,920],[1232,1210,992],[1293,1178,1021],[1185,1190,954],
                     [922,1140,487],[968,1157,558],[889,1211,612],[624,1142,549],[638,1093,576],
                     [992,1051,1001],[1020,1041,1034],[1166,1049,1127],[1139,1031,1186],
                     [652,987,1342],[602,911,1419],[652,991,1453],[615,952,1534]])
    bounds=mesh['bounds'];positions=mesh['positions']
    target_world=((coords-(np.array(a['meta']['fullDimensionsXYZ'])-1)/2)*.0794/a['meta']['longestMm'])[:,[0,2,1]]*[1,1,-1]
    target_q=(target_world-np.array(bounds['min']))/(np.array(bounds['max'])-np.array(bounds['min']))*65535
    nearest=np.zeros(len(coords),int);distance=np.full(len(coords),np.inf)
    for start in range(0,len(positions),250000):
        p=positions[start:start+250000].astype(float)
        for j,q in enumerate(target_q):
            d=((p-q)**2).sum(axis=1);k=int(d.argmin())
            if d[k]<distance[j]:distance[j]=d[k];nearest[j]=k+start
    records=[]
    for xyz,vertex in zip(coords,nearest):
        c=int(labels[vertex]);record=dict(sourceXYZ=xyz.tolist(),vertex=int(vertex),component=c,triangles=int(stats[c,1]),diameterMm=float(a['diameter'][c]),pca=float(a['spread'][c]),lower=a['lower'][c].tolist(),upper=a['upper'][c].tolist(),previouslyExcluded=bool(a['removed'][c]))
        records.append(record);print(json.dumps(record),flush=True)
    target=ROOT/'docs/cleanup-v26/component-locator.json';target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(records,indent=2)+'\n')

if __name__=='__main__':inspect()
