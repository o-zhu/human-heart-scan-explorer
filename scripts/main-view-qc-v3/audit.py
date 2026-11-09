"""Source and approximate-region checks of main-view starting planes.

Uses the unchanged measured resident source, not the labels as generated tissue.
Labels describe approximate wall ownership; their area is not chamber volume or
an anatomical accuracy measure. Source arrays and historical frames stay frozen.
"""
from pathlib import Path
import argparse, copy, gzip, hashlib, importlib.util, json, math, sys
import numpy as np
from scipy.ndimage import map_coordinates
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/main-view-qc-v3'
spec = importlib.util.spec_from_file_location('tee_qc_common', ROOT/'scripts/tee-plane-qc-v2/common.py')
qc = importlib.util.module_from_spec(spec); spec.loader.exec_module(qc)
MM = qc.MM
REGIONS = ['neutral','LV','RV','LA','RA','aorta','pulmonary']
ORDER = ['rv-inflow','rv-outflow','lv-inflow','lv-outflow','ra-inflow','ra-outflow','la-inflow','la-outflow']

def serial(value):
    if isinstance(value, np.ndarray): return value.tolist()
    if isinstance(value, np.generic): return value.item()
    raise TypeError(type(value).__name__)

def write(name, data):
    p=OUT/name; p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(json.dumps(data,indent=2,default=serial)+'\n')

def sources():
    volume,meta=qc.load_volume(); lm=qc.read('public/assets/anatomy/manifest.json')
    compressed=(ROOT/'public'/lm['volumeUrl'].removeprefix('./')).read_bytes()
    assert hashlib.sha256(compressed).hexdigest()==lm['compressedSha256']
    raw=gzip.decompress(compressed); assert hashlib.sha256(raw).hexdigest()==lm['sha256']
    labels=np.frombuffer(raw,np.uint8).reshape(lm['dimensions'][::-1])
    labels.flags.writeable=False
    meta['labels']={k:lm[k] for k in ['revision','sha256','dimensions','registration','septalDisplayConvention','limitations']}
    presets={p['id']:p for p in qc.read('public/assets/flow-views-v5.json')['presets']}
    return volume,labels,meta,presets

def frame_of(p):
    f=qc.source_frame(p['world']); f['target']=qc.source_point(p['world']['target']);return f

def region_metrics(volume,labels,f,size=400):
    a,b=qc.sample(volume,f,size,labels); support=a>=72
    count=np.bincount(b[support].ravel(),minlength=7)
    area=f['width']*f['height']*MM**2/(a.shape[0]*a.shape[1])
    return {'pixelCount':int(support.sum()),'regionPixels':dict(zip(REGIONS,map(int,count))),
      'regionFractionOfThresholdedSection':dict(zip(REGIONS,(count/max(1,count.sum())).round(6).tolist())),
      'sampledAreaMm2':dict(zip(REGIONS,(count*area).round(3).tolist())),
      'pixelThreshold':72,'raster':list(a.shape[::-1]),
      'interpretation':'Approximate tissue-label support in this resampled rectangle; not chamber area, segmentation accuracy or valve validation.'}

def focus_frame(f,p,scale=1):
    g=copy.deepcopy(f);g['center']=np.asarray(f['target'])
    g['width']=p['focusWidthMm']/MM*scale;g['height']=p['focusHeightMm']/MM*scale
    return g

def baseline():
    volume,labels,meta,presets=sources();items=[];focusitems=[];rows={}
    for key in ORDER:
        p=presets[key];f=frame_of(p);g=focus_frame(f,p)
        a,b=qc.sample(volume,f,440,labels);fa,fb=qc.sample(volume,g,440,labels)
        m=region_metrics(volume,labels,f);fm=region_metrics(volume,labels,g)
        rows[key]={'preset':p,'sourceFrame':f,'fullPlane':m,'focus':fm}
        frac=m['regionFractionOfThresholdedSection'];ff=fm['regionFractionOfThresholdedSection']
        items.append((qc.image(a,b,.68),key,f"RV {frac['RV']:.0%} · LV {frac['LV']:.0%} · PA {frac['pulmonary']:.0%}"))
        focusitems.append((qc.image(fa,fb,.68),key,f"RV {ff['RV']:.0%} · LV {ff['LV']:.0%} · PA {ff['pulmonary']:.0%}"))
    qc.contact_sheet(items,OUT/'baseline-source-regions.jpg','Original main-view planes · actual source + approximate wall regions',cols=4,cell=400,row=525)
    qc.contact_sheet(focusitems,OUT/'baseline-target-regions.jpg','Original target crops · same measured sections; tissue fractions are not accuracy',cols=4,cell=400,row=500)
    write('baseline-review.json',{'source':meta,'views':rows})
    for key,row in rows.items():print(key, row['focus']['regionFractionOfThresholdedSection'])

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('command',choices=['baseline']);args=ap.parse_args()
    if args.command=='baseline':baseline()
