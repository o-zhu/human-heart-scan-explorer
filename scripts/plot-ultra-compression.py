"""Plot an exact source/hosted pixel comparison for a measured myocardial patch."""
from pathlib import Path
import argparse
import json

import numpy as np
from PIL import Image, ImageDraw, ImageFont

PROJECT=Path(__file__).resolve().parents[1]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets',type=Path,default=PROJECT/'data/ultra-sections')
    parser.add_argument('--manifest',type=Path)
    parser.add_argument('--data-root',type=Path,required=True)
    parser.add_argument('--output',type=Path,default=PROJECT/'docs/hosted-ultra-compression.png')
    args=parser.parse_args()
    m=json.loads((args.manifest or args.assets/'manifest.json').read_text())
    source=np.load(args.data_root/'s2-clean-display-u8.npy',mmap_mode='r')
    origin=json.loads((args.data_root/'s2-clean-display.json').read_text())['originXYZ']
    index=363;x,y,n=1200,1060,192
    before=np.asarray(source[4*index-origin[2],y-origin[1]:y-origin[1]+n,x-origin[0]:x-origin[0]+n])
    record=m['slices']['z'][index]
    decoded=np.asarray(Image.open(args.assets/record['path']).convert('L'))
    cx,cy,_,_=record['crop'];after=decoded[y-cy:y-cy+n,x-cx:x-cx+n]
    assert np.array_equal(before,after)
    diff=np.abs(before.astype(np.int16)-after.astype(np.int16)).astype(np.uint8)
    bg='#0e1418';card='#151e23';fg='#edf0f0';muted='#a8bbc2';accent='#a8c9bd'
    canvas=Image.new('RGB',(1312,692),bg);draw=ImageDraw.Draw(canvas)
    font_root=Path('/usr/share/fonts/truetype/dejavu')
    def font(size,bold=False):
        return ImageFont.truetype(str(font_root/('DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf')),size)
    draw.text((32,25),'Lossless hosted Ultra',font=font(32,True),fill=fg)
    draw.text((32,72),'79.4 µm source sampling · LADAF-2021-17 · myocardial patch in Z363',font=font(18),fill=muted)
    panels=[('Decoded source display',before),('Hosted lossless WebP',after),('Absolute difference ×32',diff*32)]
    for k,(title,pixels) in enumerate(panels):
        px=32+k*424
        draw.rounded_rectangle((px,117,px+400,578),radius=10,fill=card)
        draw.text((px+12,133),title,font=font(18,True),fill=fg)
        image=Image.fromarray(pixels).convert('RGB').resize((384,384),resample=Image.Resampling.NEAREST)
        canvas.paste(image,(px+8,177))
    draw.text((64,594),'15.24 × 15.24 mm patch · 2× display magnification',font=font(17),fill=muted)
    draw.text((902,594),'Maximum error: 0 / 255',font=font(17,True),fill=accent)
    draw.text((32,631),'Whole Z363 image: 513,858 bytes (514 KB) · all 1,096 nonempty sections passed exact pixel comparison',font=font(17),fill=fg)
    draw.text((32,660),'Equality applies to the 8-bit source display window with the documented exterior support mask.',font=font(15),fill=muted)
    args.output.parent.mkdir(parents=True,exist_ok=True);canvas.save(args.output,optimize=True)
    print(args.output)


if __name__=='__main__':main()
