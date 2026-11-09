#!/usr/bin/env python3
"""Use verified currently deployed Gentle normals in exact geometry fixtures.

Only normals change; used.npy maps each review vertex to the original index.
This is a fixture update, never a scientific-source or production-asset edit.
"""
from pathlib import Path
import argparse,hashlib,json,struct
import numpy as np

SOURCE=Path('/workspace/data/heart-v29-compress/mesh-compact-consolidated-decoded.hfm')
EXPECTED='ef468a2ebf15f11cf57f8443e7d3555f8d53fc1a43b9582125bbbabe304d6ad8'
CACHE=Path('/workspace/data/cleanup-v30-right/camera-geometry')

def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()

def main():
 p=argparse.ArgumentParser();p.add_argument('cases',nargs='+');a=p.parse_args()
 assert sha(SOURCE)==EXPECTED
 raw=np.memmap(SOURCE,dtype=np.uint8,mode='r')
 magic,version,nv,ni,po,no,io,reserved=struct.unpack_from('<8I',raw)
 assert (magic,version,reserved)==(0x314d4648,1,0)
 normals=np.ndarray((nv,3),'<i2',buffer=raw,offset=no)
 for name in a.cases:
  folder=CACHE/name;receipt=json.loads((folder/'receipt.json').read_text())
  ids=np.load(folder/'used.npy',mmap_mode='r')
  target=np.lib.format.open_memmap(folder/'normals.npy',mode='r+')
  assert target.shape==(len(ids),3)
  for start in range(0,len(ids),100000):target[start:start+100000]=normals[ids[start:start+100000]]
  target.flush();del target
  receipt['files']['normals.npy']=sha(folder/'normals.npy')
  receipt['shadingNormalsDecodedSha256']=EXPECTED
  receipt['attributePolicy']='Original source positions, exact indices and debris flags; current deployed seam-corrected Gentle normals mapped by original vertex IDs. No view-dependent geometry omission beyond conservative frustum culling.'
  (folder/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
  print(json.dumps({'case':name,'vertices':len(ids),'normalSource':EXPECTED}),flush=True)

if __name__=='__main__':main()
