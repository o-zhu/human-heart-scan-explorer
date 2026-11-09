from pathlib import Path
import json,sys
import numpy as np
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parents[2];out=ROOT/'docs/cleanup-v30-left/source';out.mkdir(parents=True,exist_ok=True)
m=json.loads((ROOT/'public/assets/ultra-sections/manifest.json').read_text());f=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',17)
for name,bounds,ys in [('aortic-deep', [1018,900,1212,1090],[880,904,928,952,976,1000,1024,1048]),('mitral',[1070,1030,1350,1390],[1040,1080,1120,1160,1200,1240,1280,1320])]:
 l,z,r,b=bounds;w=(r-l)*2;h=(b-z)*2;sheet=Image.new('RGB',(w*4,(h+35)*2),'#101a1c')
 for k,y in enumerate(ys):
  e=m['slices']['y'][y//4];a=Image.new('L',(1897,2117));a.paste(Image.open(ROOT/'data/ultra-sections'/e['path']).convert('L'),e['crop'][:2]);im=a.crop(tuple(bounds)).convert('RGB').resize((w,h),Image.Resampling.NEAREST);d=ImageDraw.Draw(im)
  for x in range((l//50+1)*50,r,50):d.line(((x-l)*2,0,(x-l)*2,h),fill='#2e4e4d');d.text(((x-l)*2+2,2),str(x),font=f,fill='#78c9cb')
  for zz in range((z//50+1)*50,b,50):d.line((0,(zz-z)*2,w,(zz-z)*2),fill='#2e4e4d');d.text((0,(zz-z)*2+2),str(zz),font=f,fill='#78c9cb')
  px=(k%4)*w;py=(k//4)*(h+35);sheet.paste(im,(px,py+35));ImageDraw.Draw(sheet).text((px+10,py+8),f'{name} Y{y}',font=f,fill='white')
 sheet.save(out/(name+'-serial-grid.jpg'),quality=97)
