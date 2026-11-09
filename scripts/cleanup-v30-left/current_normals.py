#!/usr/bin/env python3
"""Use byte-verified current compact shading in exact original-geometry review caches."""
from pathlib import Path
import hashlib,json,struct,sys
import numpy as np
ROOT=Path(__file__).resolve().parents[2];CACHE=Path('/workspace/data/cleanup-v30-left/camera-geometry');HFM=Path('/workspace/data/heart-v29-compress/mesh-compact-consolidated-decoded.hfm')
def sha_file(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for block in iter(lambda:f.read(1024**2),b''):h.update(block)
 return h.hexdigest()
def update(cases):
 m=json.loads((ROOT/'public/assets/display-compact-v29/mesh-manifest.json').read_text());assert sha_file(HFM)==m['decodedSha256']
 raw=np.memmap(HFM,mode='r',dtype=np.uint8);head=struct.unpack_from('<8I',raw);assert list(head)==m['header'];normals=np.ndarray((head[2],3),'<i2',buffer=raw,offset=head[5]);assert hashlib.sha256(normals.tobytes()).hexdigest()==m['decodedNormalSha256']
 for case in cases:
  out=CACHE/case;p=out/'receipt.json';r=json.loads(p.read_text())
  if r.get('currentShadingDecodedSha256')==m['decodedSha256'] and sha_file(out/'normals.npy')==r['files']['normals.npy']:continue
  used=np.load(out/'used.npy',mmap_mode='r');tmp=out/'normals-current.tmp.npy';a=np.lib.format.open_memmap(tmp,mode='w+',dtype='<i2',shape=(len(used),3))
  for start in range(0,len(used),150000):a[start:start+150000]=normals[used[start:start+150000]]
  a.flush();del a;tmp.replace(out/'normals.npy');r['files']['normals.npy']=sha_file(out/'normals.npy');r['currentShadingDecodedSha256']=m['decodedSha256'];r['currentShadingNormalSha256']=m['decodedNormalSha256'];r['currentShadingManifestSha256']=sha_file(ROOT/'public/assets/display-compact-v29/mesh-manifest.json');r['attributePolicy']='Positions, indices and flags retain exact original geometry; normals are copied at the same original vertex IDs from verified current v29 compact shading. No surface vertex moves.';p.write_text(json.dumps(r,indent=2)+'\n');print(json.dumps({'case':case,'currentNormalBytesVerified':True,'vertices':len(used)}),flush=True)
if __name__=='__main__':update(sys.argv[1:] or [p.name for p in CACHE.iterdir() if p.is_dir()])
