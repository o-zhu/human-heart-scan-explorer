#!/usr/bin/env python3
"""Prepare exact, camera-visible Gentle attributes separately from native GL."""
from pathlib import Path
import argparse,gzip,hashlib,json,sys,gc
import numpy as np
from review_geometry import cull_review_triangles
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/lumen-artifacts-v23'))
from mesh_transport import load_mesh_arrays
CACHE=Path('/workspace/data/cleanup-v28/camera-geometry')
def sha_file(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(1024**2),b''):h.update(b)
    return h.hexdigest()
def main():
    p=argparse.ArgumentParser();p.add_argument('case');a=p.parse_args()
    case=next(c for c in json.loads((ROOT/'scripts/cleanup-v28/review-cameras.json').read_text()) if c['id']==a.case)
    out=CACHE/a.case;out.mkdir(parents=True,exist_ok=True)
    manifest=json.loads((ROOT/'public/assets/fine-surface-v23/manifest.json').read_text());lod=next(x for x in manifest['lods'] if x['id']=='gentle')
    flag_item=json.loads((ROOT/'public/assets/cleanup-v26/debris-manifest.json').read_text())['profiles'][0]['vertexFlags']
    prior=out/'receipt.json'
    if prior.exists():
        r=json.loads(prior.read_text())
        if r['camera']==case and r['sourceDecodedSha256']==lod['decodedSha256'] and r['flagSha256']==flag_item['sha256'] and r['cullingCodeSha256']==sha_file(ROOT/'scripts/cleanup-v28/review_geometry.py') and all(sha_file(out/n)==h for n,h in r['files'].items()):
            print(json.dumps(dict(case=a.case,cached=True,triangles=r['triangles'])));return
    arrays=load_mesh_arrays(manifest,lod);arrays,culling=cull_review_triangles(arrays,case,720,840)
    flag_encoded=(ROOT/'public'/flag_item['url'].removeprefix('./')).read_bytes();assert hashlib.sha256(flag_encoded).hexdigest()==flag_item['sha256']
    flags=np.frombuffer(gzip.decompress(flag_encoded),np.uint8);assert hashlib.sha256(flags).hexdigest()==flag_item['decodedSha256']
    indices=arrays['indices'];selected=np.zeros(arrays['vertexCount'],bool)
    for start in range(0,len(indices),1_000_000):selected[indices[start:start+1_000_000]]=True
    used=np.flatnonzero(selected);mapping=np.empty(arrays['vertexCount'],np.uint32);mapping[used]=np.arange(len(used),dtype=np.uint32)
    for name,source in [('positions',arrays['positions']),('normals',arrays['normals']),('flags',flags)]:
        shape=(len(used),3) if name!='flags' else (len(used),)
        target=np.lib.format.open_memmap(out/(name+'.npy'),mode='w+',dtype=source.dtype,shape=shape)
        for start in range(0,len(used),150_000):target[start:start+150_000]=source[used[start:start+150_000]]
        target.flush();del target
    target=np.lib.format.open_memmap(out/'indices.npy',mode='w+',dtype='<u4',shape=(len(indices),))
    for start in range(0,len(indices),1_000_000):target[start:start+1_000_000]=mapping[indices[start:start+1_000_000]]
    target.flush();del target
    record=dict(camera=case,bounds=arrays['bounds'],vertices=len(used),triangles=len(indices)//3,
      sourceDecodedSha256=lod['decodedSha256'],flagSha256=flag_item['sha256'],transport=arrays['_transport'],reviewCulling=culling,
      cullingCodeSha256=sha_file(ROOT/'scripts/cleanup-v28/review_geometry.py'),
      files={n+'.npy':sha_file(out/(n+'.npy')) for n in ['positions','normals','indices','flags']},
      attributePolicy='Only unused vertices compacted and indices exactly remapped. Quantized positions, normals and flags copied without change.')
    prior.write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(dict(case=a.case,triangles=record['triangles'],vertices=record['vertices'],culling=culling)),flush=True)
if __name__=='__main__':main()
