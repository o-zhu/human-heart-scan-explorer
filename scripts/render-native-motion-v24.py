#!/usr/bin/env python3
"""Scientific matched-camera rendering of the generated CT meshes (EGL)."""
from pathlib import Path
import sys,gzip,struct,json
import numpy as np
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts/native-surface-v20'))
from render_egl import SurfaceRenderer
ASSETS=ROOT/'public/assets/motion-lab-v24/native-ct'
OUT=ROOT.parent/'analysis';OUT.mkdir(exist_ok=True)
m=json.loads((ASSETS/'manifest.json').read_text());f=m['frames'][0]
r=SurfaceRenderer(width=1000,height=820)
try:
    font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',25)
    small=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',20)
except OSError:font=small=ImageFont.load_default()
canvas=Image.new('RGB',(2000,990),(9,12,15));draw=ImageDraw.Draw(canvas)
for i,key in enumerate(['overview','native']):
    record=f[key];raw=gzip.decompress((ASSETS/Path(record['url']).name).read_bytes())
    _,_,nv,ni,po,no,io,flags=struct.unpack('<8I',raw[:32]);assert flags==1
    p=np.frombuffer(raw,dtype='<f4',count=nv*3,offset=po).reshape(-1,3)
    n=np.frombuffer(raw,dtype='<i2',count=nv*3,offset=no).reshape(-1,3).astype(np.float32)/32767
    faces=np.frombuffer(raw,dtype='<u4',count=ni,offset=io).reshape(-1,3)
    # Fixed inverse world-axis mapping yields normalized RAS for the Z-up renderer.
    p=p[:,[0,2,1]]*np.array([1,-1,1]);n=n[:,[0,2,1]]*np.array([1,-1,1])
    im=r.draw(p,n,faces,np.zeros(3),.72)
    canvas.paste(Image.fromarray(im),(i*1000,90))
    title='2× voxel-mean overview' if key=='overview' else 'Original native sampling'
    draw.text((i*1000+30,18),title,font=font,fill=(244,234,216))
    spacing='1.199 × 1.199 × 1.400 mm' if key=='overview' else '0.600 × 0.600 × 0.700 mm'
    draw.text((i*1000+30,54),f'{spacing}  |  {record["triangles"]:,} triangles',font=small,fill=(183,192,198))
draw.text((30,916),'Acquired phase 0 · Identical camera, scale, illumination and stored-intensity threshold (232)',font=small,fill=(232,225,211))
draw.text((30,949),'All extracted triangles retained. No geometry smoothing. Intensity isosurfaces; not anatomical segmentations.',font=small,fill=(183,192,198))
path=OUT/'native-ct-phase0-comparison.png';canvas.save(path)
(OUT/'native-ct-render-info.json').write_text(json.dumps({'image':path.name,'renderer':r.driver,'cameraDirectionRas':[1.3,-1.8,.85],'spanNormalized':.72,'phase':0,'threshold':232,'matchedCamera':True,'decimation':False,'geometrySmoothing':False},indent=2)+'\n')
print(path)
