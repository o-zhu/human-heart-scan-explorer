#!/usr/bin/env python3
"""Render actual prepared HFM meshes with the existing surfaceless EGL renderer.

An offline model review, not a browser or clinical-validation screenshot.
"""
from pathlib import Path
import ctypes as C
import gzip
import hashlib
import importlib.util
import json
import struct
import numpy as np
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[2]
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('heart_egl',ROOT/'scripts/native-surface-v20/render_egl.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
renderer=module.SurfaceRenderer(520,520)
manifest=json.loads((ROOT/'public/assets/probe-heart-v44/manifest.json').read_text())
directions=[[1.3,-1.8,.85],[-1.3,-.3,.85],[.3,.4,1.8]]
gallery=Image.new('RGB',(1560,1710),'#0b1015');draw=ImageDraw.Draw(gallery)
records=[]
for row,entry in enumerate(manifest['donors']):
 lod=entry['lod'];path=ROOT/'public'/lod['url'].removeprefix('./');encoded=path.read_bytes();raw=gzip.decompress(encoded)
 assert hashlib.sha256(encoded).hexdigest()==lod['sha256'] and hashlib.sha256(raw).hexdigest()==lod['decodedSha256']
 magic,ver,nv,ni,po,no,io,_=struct.unpack_from('<8I',raw)
 mn=np.array(entry['bounds']['min']);mx=np.array(entry['bounds']['max'])
 positions=mn+np.frombuffer(raw,dtype='<u2',count=nv*3,offset=po).reshape(nv,3)/65535*(mx-mn)
 normals=np.frombuffer(raw,dtype='<i2',count=nv*3,offset=no).reshape(nv,3)/32767
 faces=np.frombuffer(raw,dtype='<u4',count=ni,offset=io).reshape(-1,3)
 assert np.isfinite(positions).all() and np.linalg.norm(normals,axis=1).min()>.99
 # One fixed normalized scale and target across all donor review images.
 center=np.array([0.,0.,0.]);span=.63
 for col,d in enumerate(directions):
  direction=np.array(d,float);direction/=np.linalg.norm(direction);forward=-direction
  right=np.cross(forward,[0.,1.,0.]);right/=np.linalg.norm(right);up=np.cross(right,forward)
  for name,value in [('right',right),('up',up),('direction',direction)]:
   renderer.f('glUniform3f',None,[renderer.I,renderer.F,renderer.F,renderer.F])(renderer.location(renderer.program,name.encode()),*value)
  rgb=renderer.draw(positions,normals,faces,center,span)
  gallery.paste(Image.fromarray(rgb),(col*520,row*570+38))
  draw.text((col*520+16,row*570+12),f"{entry['donorId']} | source-space view {col+1}",fill='#e9e3da')
  records.append(dict(donor=entry['donorId'],view=col+1,direction=direction.tolist(),triangles=ni//3,encodedSha256=lod['sha256'],pixelsSha256=hashlib.sha256(rgb.tobytes()).hexdigest()))
gallery.save(HERE/'whole-heart-model-review.jpg',quality=93)
(HERE/'native-render-review.json').write_text(json.dumps(dict(renderer=renderer.driver,kind='Offline HFM/EGL model review, not browser rendering or clinical validation',records=records),indent=2)+'\n')
print(json.dumps(dict(output=str(HERE/'whole-heart-model-review.jpg'),renderer=renderer.driver,views=len(records))))
