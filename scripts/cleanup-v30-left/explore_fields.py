#!/usr/bin/env python3
"""Compare actual source-field regularizers in two bounded reported fringe regions."""
from pathlib import Path
import sys,json,hashlib,time
import numpy as np
from scipy import ndimage as ndi
from skimage.restoration import denoise_tv_chambolle
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/fine-detail-v23'))
from source import FineSource
OUT=ROOT/'docs/cleanup-v30-left/source'
OUT.mkdir(parents=True,exist_ok=True)
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',17)
reader=FineSource(16);records=[]
for name,lower,upper in [('aortic',[1018,1104,916],[1176,1248,1076]),('mitral',[1110,1096,1030],[1320,1264,1310])]:
 lo=np.array(lower);hi=np.array(upper);pad=4
 rawpad=reader.region(lo-pad,hi+pad);raw=rawpad[pad:-pad,pad:-pad,pad:-pad].copy();sourcehash=hashlib.sha256(raw.tobytes()).hexdigest()
 base=ndi.gaussian_filter(rawpad.astype(np.float32),.5,truncate=3)[pad:-pad,pad:-pad,pad:-pad].copy()
 t=time.time();median=ndi.median_filter(rawpad,size=3);median=ndi.gaussian_filter(median.astype(np.float32),.5,truncate=3)[pad:-pad,pad:-pad,pad:-pad].copy();medsecs=time.time()-t
 t=time.time();tv=denoise_tv_chambolle(rawpad.astype(np.float32),weight=16,eps=0,max_num_iter=24,channel_axis=None)[pad:-pad,pad:-pad,pad:-pad].copy();tvsecs=time.time()-t
 fields=[('Source intensity',raw),('Gaussian .5 / level120',base),('Median3 + Gaussian .5 /130',median),('3D TV16 / level130',tv)]
 for y in [1120,1136,1152,1168,1184,1200,1216,1232]:
  if not lo[1]<=y<hi[1]:continue
  j=y-lo[1];w=(hi[0]-lo[0])*3;h=(hi[2]-lo[2])*3
  sheet=Image.new('RGB',(w*4,h+72),'#0e171a');d=ImageDraw.Draw(sheet)
  for col,(label,a) in enumerate(fields):
   p=a[:,j,:];rgb=np.repeat(raw[:,j,:,None],3,axis=2).astype(np.float32)
   if col:
    kept=p>=(120 if col==1 else 130);edge=kept & ~ndi.binary_erosion(kept);rgb[edge]=[80,235,170]
    rejected=(base[:,j,:]>=71.4)&~kept;rgb[rejected]=rgb[rejected]*.35+np.array([135,25,45])*.65
   im=Image.fromarray(np.clip(rgb,0,255).astype(np.uint8)).resize((w,h),Image.Resampling.NEAREST)
   sheet.paste(im,(col*w,72));d.text((col*w+8,8),label,font=font,fill='#e8ede9');d.text((col*w+8,31),f'{name} Y{y} X{lo[0]}–{hi[0]} Z{lo[2]}–{hi[2]}',font=font,fill='#a1c3be')
  sheet.save(OUT/(name+f'-y{y}-methods.jpg'),quality=96)
 records.append(dict(region=name,lowerXYZ=lower,upperXYZ=upper,sourceRoiSha256=sourcehash,medianSeconds=medsecs,tvSeconds=tvsecs,raw190Samples=int((raw>=190).sum()),foreground={label:int((a>=(120 if n==1 else 130 if n else 71.4)).sum()) for n,(label,a) in enumerate(fields)}))
 print(json.dumps(records[-1]),flush=True)
(OUT/'method-comparison.json').write_text(json.dumps(dict(source=reader.receipt(),regions=records,scope='Bounded contrast/regularizer comparison. Red rejected baseline support; green retained contour. No HU calibration.'),indent=2)+'\n')
