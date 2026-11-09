#!/usr/bin/env python3
"""Decode one verified Gentle buffer and retain only two bounded review ROIs."""
from pathlib import Path
import os,sys,json,gzip,gc
os.environ.setdefault('OPENBLAS_NUM_THREADS','1')
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/lumen-artifacts-v23'))
from mesh_transport import load_mesh_arrays
sys.path.insert(0,str(ROOT/'scripts/fine-detail-v23'))
from source import FineSource
from adaptive_patch import world_from_fine
OUT=Path('/workspace/data/cleanup-v28-right');OUT.mkdir(parents=True,exist_ok=True)
manifest=json.loads((ROOT/'public/assets/fine-surface-v23/manifest.json').read_text())
lod=next(x for x in manifest['lods'] if x['id']=='gentle')
arrays=load_mesh_arrays(manifest,lod)
reader=FineSource(0)
flags_item=json.loads((ROOT/'public/assets/cleanup-v26/debris-manifest.json').read_text())['profiles'][0]['vertexFlags']
flags=np.frombuffer(gzip.decompress((ROOT/'public'/flags_item['url'].removeprefix('./')).read_bytes()),np.uint8)
minimum=np.array(arrays['bounds']['min']);maximum=np.array(arrays['bounds']['max'])
faces=arrays['indices'].reshape(-1,3)
for name,lo,hi in [('tricuspid',[540,600,980],[900,1100,1410]),('pulmonary',[550,1000,500],[850,1410,1030])]:
    corners=world_from_fine(np.array([lo,hi]),reader.meta);lower=corners.min(axis=0);upper=corners.max(axis=0)
    kept=[]
    for start in range(0,len(faces),100_000):
        face=faces[start:start+100_000]
        p=minimum+arrays['positions'][face].astype(np.float32)/65535*(maximum-minimum)
        yes=np.all(p.max(axis=1)>=lower,axis=1)&np.all(p.min(axis=1)<=upper,axis=1)
        kept.append(face[yes].copy())
    indices=np.concatenate(kept).ravel();used,reindex=np.unique(indices,return_inverse=True)
    np.savez_compressed(OUT/(name+'-gentle-roi.npz'),positions=arrays['positions'][used],normals=arrays['normals'][used],indices=reindex.astype(np.uint32),flags=flags[used],boundsMin=minimum,boundsMax=maximum,lowerXYZ=lo,upperXYZ=hi)
    print(json.dumps({'id':name,'vertices':len(used),'triangles':len(indices)//3}),flush=True)
    del indices,used,reindex,kept;gc.collect()
(OUT/'gentle-transport.json').write_text(json.dumps(arrays['_transport'],indent=2)+'\n')
