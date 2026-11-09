"""Measured-source reformat helpers. Source arrays are opened read-only.

This is geometric correspondence exploration, not diagnostic image processing.
The resident volume is windowed uint8, not calibrated CT Hounsfield units.
"""
from pathlib import Path
import gzip, hashlib, json, math
import numpy as np
from scipy.ndimage import map_coordinates
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/tee-plane-qc-v2'
MM=.3176
SCALE=529.
COLORS=np.array([[135,146,152],[227,109,115],[84,166,230],[242,179,107],[99,199,186],[196,153,232],[97,204,224]],float)

def read(name): return json.loads((ROOT/name).read_text())
def write(name,data):
 p=ROOT/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(data,indent=2)+'\n')
def unit(x):
 x=np.asarray(x,float);return x/np.linalg.norm(x)
def source_point(w):
 x,y,z=w;return np.array([x*SCALE+237,237-z*SCALE,y*SCALE+264.5])
def world_point(p):
 x,y,z=p;return np.array([x-237,z-264.5,237-y])/SCALE
def source_vec(w):
 x,y,z=w;return np.array([x,-z,y])
def world_vec(p):
 x,y,z=p;return np.array([x,z,-y])
def source_frame(f):
 return dict(center=source_point(f['center']),right=source_vec(f['right']),up=source_vec(f['up']),normal=source_vec(f['normal']),width=f['width']*SCALE,height=f['height']*SCALE)
def world_frame(f):
 return dict(center=world_point(f['center']).tolist(),right=world_vec(f['right']).tolist(),up=world_vec(f['up']).tolist(),normal=world_vec(f['normal']).tolist(),width=float(f['width']/SCALE),height=float(f['height']/SCALE),displayMirrorX=False,displayRotate180=False)
def frame(center,right,up,width=380,height=470):
 up=unit(up);right=unit(np.asarray(right)-up*np.dot(up,right))
 return dict(center=np.asarray(center,float),right=right,up=up,normal=unit(np.cross(right,up)),width=float(width),height=float(height))
def rotate(x,axis,degrees):
 axis=unit(axis);t=np.deg2rad(degrees);x=np.asarray(x)
 return x*np.cos(t)+np.cross(axis,x)*np.sin(t)+axis*np.dot(axis,x)*(1-np.cos(t))
def rotated(f,yaw=0,pitch=0,offset_mm=0,pivot=None):
 r=rotate(f['right'],f['up'],yaw);u=rotate(f['up'],r,pitch);n=unit(np.cross(r,u))
 center=np.array(f['center'],float)
 if pivot is not None:
  pivot=np.array(pivot);center=pivot+r*np.dot(center-pivot,f['right'])+u*np.dot(center-pivot,f['up'])+n*np.dot(center-pivot,f['normal'])
 center=center+n*(offset_mm/MM)
 return frame(center,r,u,f['width'],f['height'])
def fitted_plane(points,weights=None,up_hint=(0,0,1),right_hint=None,width=380,height=470):
 points=np.array(points,float);weights=np.ones(len(points)) if weights is None else np.array(weights,float)
 center=np.average(points,axis=0,weights=weights)
 _,_,vh=np.linalg.svd((points-center)*np.sqrt(weights[:,None]));n=vh[-1]
 up=unit(np.asarray(up_hint)-n*np.dot(up_hint,n));right=unit(np.cross(up,n))
 if right_hint is not None and np.dot(right,right_hint)<0:right=-right
 return frame(center,right,up,width,height)
def load_volume():
 meta=read('public/assets/manifest.json')['levels']['high'];dims=meta['dimensions'];part=meta['parts'][0]
 data=gzip.decompress((ROOT/'public'/part['url']).read_bytes());a=np.frombuffer(data,np.uint8).reshape(dims[::-1]).copy()
 if part.get('predictor')=='delta-z':np.cumsum(a,axis=0,dtype=np.uint8,out=a)
 sha=hashlib.sha256(a.tobytes()).hexdigest();assert sha==part['rawSha256'],(sha,part['rawSha256'])
 a.flags.writeable=False
 return a,dict(url=part['url'],decodedSha256=sha,dimensionsXYZ=dims,spacingMm=MM,displayValues='uint8 windowed source; no HU calibration')
def load_labels():
 meta=read('public/assets/anatomy/manifest.json');a=np.frombuffer(gzip.decompress((ROOT/'public'/meta['volumeUrl'].removeprefix('./')).read_bytes()),np.uint8).reshape(meta['dimensions'][::-1]);return a
def grid(f,size=400):
 nx=size;ny=round(size*f['height']/f['width'])
 # Cap tall tiles without distorting their pixel aspect ratio.
 if ny>size:nx=round(size*f['width']/f['height']);ny=size
 x=np.linspace(-f['width']/2,f['width']/2,nx);y=np.linspace(f['height']/2,-f['height']/2,ny)
 return f['center'][None,None,:]+x[None,:,None]*f['right']+y[:,None,None]*f['up']
def sample(volume,f,size=400,labels=None):
 q=grid(f,size);a=map_coordinates(volume,[q[...,2],q[...,1],q[...,0]],order=1,mode='constant',cval=0,prefilter=False)
 if labels is None:return a
 fact=(np.array(labels.shape[::-1])-1)/np.array([474,474,529]);t=q*fact
 b=map_coordinates(labels,[t[...,2],t[...,1],t[...,0]],order=0,mode='constant',cval=0,prefilter=False)
 return a,b
def image(a,labels=None,tint=.35):
 # Fixed display transform for every candidate. No candidate-specific enhancement.
 g=np.clip((a.astype(float)-18)/170,0,1)**.85
 rgb=np.repeat((g*255)[...,None],3,axis=2)
 if labels is not None:
  color=COLORS[labels]*g[...,None];rgb=rgb*(1-tint)+color*tint
 return Image.fromarray(np.uint8(np.clip(rgb,0,255)))
def font(size=17):
 try:return ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',size)
 except OSError:return ImageFont.load_default()
def contact_sheet(items,path,title='',cols=4,cell=390,row=445):
 rows=math.ceil(len(items)/cols);sheet=Image.new('RGB',(cols*cell,rows*row+60),(9,16,20));d=ImageDraw.Draw(sheet)
 d.text((14,14),title,font=font(20),fill=(218,230,230))
 for i,(im,caption,detail) in enumerate(items):
  x=(i%cols)*cell;y=60+(i//cols)*row
  d.text((x+12,y+8),caption[:55],font=font(16),fill=(234,187,158))
  d.text((x+12,y+31),detail[:62],font=font(12),fill=(151,175,187))
  im=im.copy();im.thumbnail((cell-16,row-69));sheet.paste(im,(x+(cell-im.width)//2,y+62))
 path=Path(path);path.parent.mkdir(parents=True,exist_ok=True);sheet.save(path,quality=91)

if __name__=='__main__':
 volume,meta=load_volume();labels=load_labels();views=read('docs/tee-plane-qc-v2/baselines.json')['views'];items=[]
 for key,v in views.items():
  if v['frame'].get('outsideScan'):continue
  f=source_frame(v['frame']);a,b=sample(volume,f,430,labels)
  items.append((image(a,b),f"{v['aseNumber']:02d} {key}",v['name']))
 contact_sheet(items,OUT/'baseline-source-sections.jpg','v44 baseline • actual 317.6 µm measured source + approximate regional tint',cols=4)
 write('docs/tee-plane-qc-v2/source-provenance.json',meta)
 print('Loaded source',meta['dimensionsXYZ'],'range',int(volume.min()),int(volume.max()),'wrote',len(items),'baseline sections')
