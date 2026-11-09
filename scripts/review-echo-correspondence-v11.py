"""Audit exact scalar display permutations and make native-data comparison sheets.

This is a scientific data/layout review, not browser QA or anatomical validation.
Prepared CT bytes and movie bytes are read only; output is documentation.
"""
from pathlib import Path
import hashlib
import json
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/'docs/echo-v11'
OUT.mkdir(parents=True, exist_ok=True)
planes = json.loads((ROOT/'public/assets/echo-planes.json').read_text())
textures = json.loads((ROOT/'public/assets/echo-textures.json').read_text())['textures']
media = json.loads((ROOT/'public/assets/echo-media-v6.json').read_text())
clips = {c['preset']: c for c in media['clips']}
records = []

def local(url):
    return ROOT/'public'/url.removeprefix('./').split('?',1)[0]

def permute(data, frame):
    a = data
    if frame.get('displayRotate180'): a = a[::-1, ::-1]
    if frame.get('displayMirrorX'): a = a[:, ::-1]
    return np.ascontiguousarray(a)

def panel(sheet, im, x, y, width=310, height=300):
    im = im.copy().convert('RGB')
    im.thumbnail((width,height), Image.Resampling.LANCZOS)
    sheet.paste(im,(x+(width-im.width)//2,y+(height-im.height)//2))

sets = [
 ('tte',['plax','psax_papillary','psax_mitral','a4c','a2c','a3c','subcostal']),
 ('tee',['me4c','me2c','melax','meavsax','bicaval','tgpapillary']),
]
for family, keys in sets:
    row_h, col_w = 350, 330
    sheet = Image.new('RGB',(3*col_w,len(keys)*row_h+50),(9,15,18))
    draw=ImageDraw.Draw(sheet)
    for col,title in enumerate(['Original CT presentation','Reviewed CT presentation','Independent reference poster']):
        draw.text((col*col_w+10,12),title,fill='#d0ddd6')
    for row,key in enumerate(keys):
        f=planes['frames'][key]; item=textures[key]
        path=local(item['url']); density=np.array(Image.open(path).convert('L'))
        corrected=permute(density,f)
        assert np.array_equal(permute(corrected,f),density), f'{key}: inverse changed source values'
        assert density.shape==(item['height'],item['width'])
        source_hash=hashlib.sha256(path.read_bytes()).hexdigest()
        if item.get('sha256'): assert source_hash==item['sha256'], f'{key}: stored bytes changed'
        y=45+row*row_h
        status=planes['correspondence']['views'][key]['status']
        draw.text((12,y),f'{key} | CT {status}',fill='#d1ad96')
        panel(sheet,Image.fromarray(density),10,y+25)
        panel(sheet,Image.fromarray(corrected),col_w+10,y+25)
        clip=clips.get(key)
        if clip: panel(sheet,Image.open(local(clip['poster'])),col_w*2+10,y+25)
        else: draw.text((col_w*2+20,y+145),'No matching recording',fill='#a4b4b7')
        records.append({'key':key,'sourceImageSha256':source_hash,'sourceScalarSha256':hashlib.sha256(density.tobytes()).hexdigest(),
                        'displayScalarSha256':hashlib.sha256(corrected.tobytes()).hexdigest(),
                        'mirrorX':f.get('displayMirrorX',False),'rotate180':f.get('displayRotate180',False),
                        'pixelValuesPreservedExactly':True,'sourceDimensions':[item['width'],item['height']],
                        'reviewStatus':status,'movie':clip['id'] if clip else None,
                        'clinicalRegistrationVerified':False})
    sheet.save(OUT/f'{family}-correspondence-review.jpg',quality=92)
report={'revision':'echo-correspondence-v11','reviewedDate':'2026-11-05','preparedPlanes':len(records),
        'sourceLabelsChecked':len(media['clips']),'displayCorrections':sum(r['mirrorX'] or r['rotate180'] for r in records),
        'validation':'Exact scalar permutation round-trip and unchanged immutable source-image checksums. Native source planes and movie posters inspected; labels checked with publishers. No browser QA or expert clinical registration.','planes':records}
(OUT/'data-orientation-audit.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:report[k] for k in ['preparedPlanes','sourceLabelsChecked','displayCorrections']}))
