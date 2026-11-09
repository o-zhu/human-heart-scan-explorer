#!/usr/bin/env python3
"""Exact camera-frustum cache from a shared verified read-only HFM mmap."""
from pathlib import Path
import argparse, gzip, hashlib, json, struct, sys
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/cleanup-v28'))
from review_geometry import cull_review_triangles
CACHE=Path('/workspace/data/cleanup-v30-right/camera-geometry')
ORIGINAL=Path('/workspace/data/heart-v29-compress/original.hfm')

def sha_file(path):
    h=hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(1024**2),b''):h.update(block)
    return h.hexdigest()

def main():
    p=argparse.ArgumentParser();p.add_argument('case');a=p.parse_args()
    case=next(c for c in json.loads((ROOT/'scripts/cleanup-v30-right/review-cameras.json').read_text()) if c['id']==a.case)
    out=CACHE/a.case;out.mkdir(parents=True,exist_ok=True)
    manifest=json.loads((ROOT/'public/assets/fine-surface-v23/manifest.json').read_text());lod=next(x for x in manifest['lods'] if x['id']=='gentle')
    item=json.loads((ROOT/'public/assets/cleanup-v26/debris-manifest.json').read_text())['profiles'][0]['vertexFlags']
    prior=out/'receipt.json';culling_hash=sha_file(ROOT/'scripts/cleanup-v28/review_geometry.py')
    if prior.exists():
        r=json.loads(prior.read_text())
        if r['camera']==case and r['sourceDecodedSha256']==lod['decodedSha256'] and r['flagSha256']==item['sha256'] and r['cullingCodeSha256']==culling_hash and 'used.npy' in r['files'] and all(sha_file(out/n)==h for n,h in r['files'].items()):
            print(json.dumps(dict(case=a.case,cached=True,triangles=r['triangles'])));return
    assert ORIGINAL.stat().st_size==lod['decodedBytes']
    assert sha_file(ORIGINAL)==lod['decodedSha256']
    raw=np.memmap(ORIGINAL,mode='r',dtype=np.uint8)
    magic,version,nv,ni,po,no,io,reserved=struct.unpack_from('<8I',raw)
    assert (magic,version,reserved)==(0x314d4648,1,0)
    assert nv==lod['vertices'] and ni==lod['triangles']*3
    assert po+nv*6<=no and no+nv*6<=io and io+ni*4==len(raw)
    positions=np.ndarray((nv,3),'<u2',buffer=raw,offset=po)
    normals=np.ndarray((nv,3),'<i2',buffer=raw,offset=no)
    indices=np.ndarray((ni,),'<u4',buffer=raw,offset=io)
    arrays=dict(positions=positions,normals=normals,indices=indices,bounds=lod.get('bounds',manifest['bounds']),vertexCount=nv,indexCount=ni,
      _transport=dict(source='Shared read-only HFM mmap',path=str(ORIGINAL),decodedBytes=len(raw),decodedSha256=lod['decodedSha256'],decodedBufferCount=0,floatPositionArrayAllocated=False))
    arrays,culling=cull_review_triangles(arrays,case,720,840)
    encoded=(ROOT/'public'/item['url'].removeprefix('./')).read_bytes();assert hashlib.sha256(encoded).hexdigest()==item['sha256']
    flags=np.frombuffer(gzip.decompress(encoded),np.uint8);assert hashlib.sha256(flags).hexdigest()==item['decodedSha256']
    indices=arrays['indices'];selected=np.zeros(nv,bool)
    for start in range(0,len(indices),1_000_000):selected[indices[start:start+1_000_000]]=True
    used=np.flatnonzero(selected).astype('<u4');mapping=np.empty(nv,np.uint32);mapping[used]=np.arange(len(used),dtype=np.uint32)
    np.save(out/'used.npy',used)
    for name,source in [('positions',positions),('normals',normals),('flags',flags)]:
        shape=(len(used),3) if name!='flags' else (len(used),)
        target=np.lib.format.open_memmap(out/(name+'.npy'),mode='w+',dtype=source.dtype,shape=shape)
        for start in range(0,len(used),150_000):target[start:start+150_000]=source[used[start:start+150_000]]
        target.flush();del target
    target=np.lib.format.open_memmap(out/'indices.npy',mode='w+',dtype='<u4',shape=(len(indices),))
    for start in range(0,len(indices),1_000_000):target[start:start+1_000_000]=mapping[indices[start:start+1_000_000]]
    target.flush();del target
    record=dict(camera=case,bounds=arrays['bounds'],vertices=len(used),triangles=len(indices)//3,
      sourceDecodedSha256=lod['decodedSha256'],flagSha256=item['sha256'],transport=arrays['_transport'],reviewCulling=culling,cullingCodeSha256=culling_hash,
      files={n+'.npy':sha_file(out/(n+'.npy')) for n in ['positions','normals','indices','flags','used']},
      attributePolicy='Only unused vertices compacted and indices exactly remapped. Quantized positions, normals and flags copied without change. used.npy stores original vertex IDs.')
    prior.write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(dict(case=a.case,triangles=record['triangles'],vertices=record['vertices'],culling=culling)),flush=True)
if __name__=='__main__':main()
