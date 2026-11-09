"""Compare the exact source target and contained free-lab ME4C alternatives.

This is trilinear sampling of hash-verified donor voxels, with a display-only
window. The dim region in a candidate panel lies outside its actual sector.
"""
from pathlib import Path
import importlib.util
import json
import hashlib
import numpy as np
from scipy.ndimage import map_coordinates
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('source_sweeps', Path(__file__).with_name('source-target-sweeps.py'))
source_sweeps = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source_sweeps)
INPUT = Path('/dev/shm/donor-context-qc/lab-me4c-source-review.json')
review = json.loads(INPUT.read_text())
data, dims, extent, receipt = source_sweeps.load_source(review['donorId'])
settings = json.loads((ROOT/'docs/echo-donor-qc-v6/native'/review['donorId']/'review.json').read_text())['display']
size = 620
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 16)
canvas = Image.new('RGB', (size*len(review['cases']), size+88), '#0a1317')
draw = ImageDraw.Draw(canvas)
for index, case in enumerate(review['cases']):
    center, right, up, normal = [np.array(case[k]) for k in ['centerMm','right','up','normal']]
    u = (np.linspace(-.5,.5,size)*case['widthMm'])[None,:,None]
    v = (np.linspace(.5,-.5,size)*case['heightMm'])[:,None,None]
    grid = center+u*right+v*up
    xyz = grid[..., [0,2,1]]*np.array([1,-1,1])
    xyz = (xyz/extent+.5)*(dims-1)
    raw = map_coordinates(data,[xyz[...,2],xyz[...,1],xyz[...,0]],order=1,mode='constant',cval=0,prefilter=False)
    pixels = raw.astype(float)/255
    if settings.get('windowEnabled'):
        pixels = np.clip((pixels-settings['windowLow'])/(settings['windowHigh']-settings['windowLow']),0,1)**settings['windowGamma']
    pixels = np.clip((pixels-.5)*settings.get('capContrast',1)+.5,0,1)
    if 'originMm' in case:
        delta=grid-np.array(case['originMm'])
        depth=np.linalg.norm(delta,axis=-1)
        cosine=np.sum(delta*np.array(case['beam']),axis=-1)/np.maximum(depth,1e-6)
        inside=(depth<=case['depthMm'])&(cosine>=np.cos(np.radians(case['sectorAngleDeg']/2)))
        pixels=np.where(inside,pixels,pixels*.22)
    frame=Image.fromarray(np.uint8(np.rint(pixels*255))).convert('RGB')
    fd=ImageDraw.Draw(frame)
    misses={}
    for key in ['apex','leftVentricle','rightVentricle','leftAtrium','rightAtrium','mitralRegion','tricuspidRegion']:
        q=np.array(review['landmarksMm'][key])-center
        miss=float(abs(np.dot(q,normal)));misses[key]=miss
        if miss>15:continue
        x=(np.dot(q,right)/case['widthMm']+.5)*(size-1)
        y=(.5-np.dot(q,up)/case['heightMm'])*(size-1)
        label={'leftVentricle':'LV','rightVentricle':'RV','leftAtrium':'LA','rightAtrium':'RA','mitralRegion':'MV','tricuspidRegion':'TV','apex':'apex'}[key]
        color=(236,181,118) if miss<4 else (119,161,172)
        fd.ellipse((x-3,y-3,x+3,y+3),outline=color,width=1)
        fd.text((x+5,y-7),label,fill=color,font=font)
    case['landmarkPlaneMissMm']=misses
    canvas.paste(frame,(index*size,0))
    draw.text((index*size+10,size+7),case['label'],font=font,fill='#edf0ea')
    if 'offsetMm' in case:draw.text((index*size+10,size+31),f"{case['angleDeg']:.2f} deg / {case['offsetMm']:.2f} mm | dim = outside 110 deg fan",font=font,fill='#b7c7c3')
    draw.text((index*size+10,size+55),'Measured source CT; approximate source guides',font=font,fill='#8ca5a5')
output=ROOT/'docs/echo-donor-context-v6/lab-me4c-source-comparison.jpg'
canvas.save(output,quality=93)
review.update({'sourceParts':receipt,'sourceDimensionsXYZ':dims.tolist(),'sourceExtentMmXYZ':extent.tolist(),'imageSha256':hashlib.sha256(output.read_bytes()).hexdigest(),'patientRegistered':False,'clinicalValidated':False})
(output.with_suffix('.json')).write_text(json.dumps(review,indent=2)+'\n')
print(json.dumps({'image':str(output),'cases':len(review['cases']),'sourcePartsVerified':len(receipt)}))
