#!/usr/bin/env python3
"""Compose labeled comparisons from unchanged lossless scientific readbacks."""
from pathlib import Path
import argparse
from PIL import Image,ImageDraw,ImageFont

parser=argparse.ArgumentParser()
parser.add_argument('--readbacks',action='append',required=True,type=Path)
parser.add_argument('--output',required=True,type=Path)
args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',22)
for directory in args.readbacks:
    for before_path in sorted(directory.glob('*-v26.png')):
        case=before_path.name.removesuffix('-v26.png')
        before=Image.open(before_path).convert('RGB')
        after=Image.open(directory/(case+'-v27.png')).convert('RGB')
        assert before.size==after.size
        width,height=before.size
        sheet=Image.new('RGB',(2*width,height+64),'#0b1317')
        sheet.paste(before,(0,64));sheet.paste(after,(width,64))
        draw=ImageDraw.Draw(sheet)
        draw.text((18,18),'v26 · Before',font=font,fill='#efece0')
        draw.text((width+18,18),'v27 · Updated',font=font,fill='#efece0')
        sheet.save(args.output/(case+'-comparison.jpg'),quality=97,subsampling=0)
