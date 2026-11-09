"""Compact, display-windowed contact sheets of exact production MPR rasters.

This is a source-image review aid. It adds no anatomy, labels no unconfirmed
structure, and applies no clipping or cleanup beyond the exported source data.
The complete rectangular raster is shown without changing its aspect ratio.
"""
from pathlib import Path
import argparse
import hashlib
import json
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFont

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--input', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
sha = lambda b: hashlib.sha256(b).hexdigest()
review_bytes = (args.input/'review.json').read_bytes()
review = json.loads(review_bytes)
caps = json.loads((args.input/'caps.json').read_text())
if caps['exportSha256'] != sha(review_bytes):
    raise RuntimeError('Raster/geometry export hashes disagree.')
metadata = {c['id']:c for c in caps['caps']}
native_path = args.output/'review.json'
native = json.loads(native_path.read_text()) if native_path.exists() else {}
settings = native.get('display', {})
if not settings:
    raise RuntimeError('Render the native views first; their evidence supplies the exact donor display window.')
font_path = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
font = lambda size: ImageFont.truetype(font_path, size)
cols, size, caption, head = 4, 288, 58, 100
outputs = []
for mode in ['tte', 'tee']:
    cases = [c for c in review['cases'] if c['mode']==mode]
    sheet = Image.new('RGB', (cols*size, head+math.ceil(len(cases)/cols)*(size+caption)+35), '#0a1317')
    draw = ImageDraw.Draw(sheet)
    draw.text((15,12), f"{review['donor'].upper()} · {mode.upper()} · accepted source sections", font=font(23), fill='#edf0ea')
    draw.text((15,45), f"{caps['sourceSpacingUm']:g} µm measured display source · actual production MPR sampling", font=font(15), fill='#b7c7c3')
    draw.text((15,70), 'Full rectangular rasters with donor window/gamma; outside-scan views contain no CT.', font=font(13), fill='#8ca5a5')
    for index, case in enumerate(cases):
        x, y = (index%cols)*size, head+(index//cols)*(size+caption)
        cap = metadata[case['id']]
        if cap['available']:
            data = (args.input/cap['file']).read_bytes()
            if sha(data) != cap['sha256']:
                raise RuntimeError('MPR hash mismatch: '+case['id'])
            arr = np.frombuffer(data, np.uint8).reshape(cap['height'], cap['width']).astype(np.float32)/255
            if settings.get('windowEnabled'):
                low, high = settings.get('windowLow',0), settings.get('windowHigh',1)
                arr = np.clip((arr-low)/max(.0001, high-low),0,1)**settings.get('windowGamma',1)
            arr = np.clip((arr-.5)*settings.get('capContrast',1)+.5,0,1)
            image = Image.fromarray(np.uint8(np.rint(arr*255)))
            image.thumbnail((size-12, size-12),Image.Resampling.LANCZOS)
            sheet.paste(image, (x+(size-image.width)//2,y+(size-image.height)//2))
        else:
            draw.text((x+24,y+size//2-12), 'OUTSIDE ACQUIRED SCAN', font=font(15), fill='#caa97c')
        draw.text((x+10,y+size+4), case['id'], font=font(15), fill='#edf0ea')
        name = case.get('shortName') or case['name']
        fsize=12
        while fsize>8 and draw.textlength(name,font=font(fsize))>size-20:fsize-=1
        draw.text((x+10,y+size+25), name, font=font(fsize), fill='#9cb2b3')
        if not case.get('poseAvailable',True):
            draw.text((x+12,y+10),'SOURCE RETAINED · PROBE WITHHELD' if case.get('intentionalWithheld') else 'PROBE POSE UNAVAILABLE',font=font(11),fill='#ffbc98')
    draw.text((15,sheet.height-26), 'Source CT: Human Organ Atlas / ESRF · CC BY 4.0 · Camera orientation does not alter these sections.',font=font(12),fill='#88a0a3')
    path=args.output/f'{mode}-source-gallery.jpg'
    sheet.save(path,quality=90)
    outputs.append({'mode':mode,'file':path.name,'views':len(cases),'sha256':sha(path.read_bytes())})
receipt={'schemaVersion':1,'donor':review['donor'],'exportSha256':sha(review_bytes),
    'sampling':caps['sampling'],'sourceSpacingUm':caps['sourceSpacingUm'],
    'display':{k:settings.get(k) for k in ['windowEnabled','windowLow','windowHigh','windowGamma','capContrast']},
    'scope':__doc__,'sourceScriptSha256':sha(Path(__file__).read_bytes()),'outputs':outputs}
(args.output/'source-review.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({'donor':review['donor'],'sheets':outputs}))
