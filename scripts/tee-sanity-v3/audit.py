"""Independent regional-anatomy audit of every current TEE atlas plane.

The labels are tissue-ownership annotations, not blood pools or valve labels.
Their areas are screening evidence, never clinical accuracy or chamber volume.
All source and annotation arrays are loaded read-only and verified by hash.
"""
from pathlib import Path
import sys, json, gzip, hashlib
import numpy as np
from scipy.ndimage import map_coordinates
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/tee-plane-qc-v2'))
from common import load_volume, load_labels, read, source_frame, sample, image, font, MM

OUT = ROOT / 'docs/tee-sanity-v3'
NAMES = ['Neutral', 'LV', 'RV', 'LA', 'RA', 'Aorta', 'PA']
COLORS = [(155,169,176),(227,109,115),(84,166,230),(242,179,107),(99,199,186),(196,153,232),(97,204,224)]

def track_points(track):
    # Stored source observations are [z, x, y, rx, ry].
    return np.asarray([[p[1], p[2], p[0]] for p in track['points']], float)

def metrics(a,b,f,tracks,threshold=40):
    tissue = a > threshold
    count = max(1,int(tissue.sum()))
    area_mm2 = f['width']*MM/(a.shape[1]-1)*f['height']*MM/(a.shape[0]-1)
    regions = {NAMES[i]:dict(tissuePixels=int(((b==i)&tissue).sum()),areaMm2=round(float(((b==i)&tissue).sum()*area_mm2),3),fraction=round(float(((b==i)&tissue).sum()/count),6)) for i in range(7)}
    track = {}
    for k,t in tracks.items():
        q=track_points(t)-f['center'];d=np.abs(q@f['normal'])*MM
        in_fov=(np.abs(q@f['right'])<=f['width']/2)&(np.abs(q@f['up'])<=f['height']/2)
        track[NAMES[int(k)]]=dict(sourceObservations=len(q),within5mm=int(((d<=5)&in_fov).sum()),within10mm=int(((d<=10)&in_fov).sum()),minimumDistanceMm=round(float(d.min()),3),medianDistanceMm=round(float(np.median(d)),3),maximumDistanceMm=round(float(d.max()),3))
    return dict(sourceTissueThreshold=threshold,sourceTissuePixels=int(tissue.sum()),regionalTissue=regions,approximateCavityTracks=track)

def make_sheet(items,path,title):
    cellw,rowh=560,580
    canvas=Image.new('RGB',(2*cellw,len(items)*rowh+76),(10,16,20));d=ImageDraw.Draw(canvas)
    d.text((16,12),title,font=font(19),fill=(225,230,230))
    d.text((16,39),'Same measured source | regional tissue ownership; not blood-pool or valve segmentation',font=font(13),fill=(150,173,181))
    for row,(key,v,a,b,m) in enumerate(items):
        y=76+row*rowh
        d.text((14,y+5),f"{v['aseNumber']:02d} {key} · {v['name']}",font=font(16),fill=(238,194,171))
        for col,im in enumerate([image(a),image(a,b,.74)]):
            im.thumbnail((cellw-24,rowh-94))
            canvas.paste(im,(col*cellw+(cellw-im.width)//2,y+37+(rowh-94-im.height)//2))
        x=16
        for i,n in enumerate(NAMES):
            text=f"{n}: {100*m['regionalTissue'][n]['fraction']:.1f}%"
            d.text((x,y+rowh-36),text,font=font(13),fill=COLORS[i]);x+=158
    canvas.save(path,quality=92)

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    volume,source=load_volume();labels=load_labels();manifest=read('public/assets/anatomy/manifest.json')
    labelhash=hashlib.sha256(labels.tobytes()).hexdigest();assert labelhash==manifest['sha256']
    labels.flags.writeable=False
    catalog=read('public/assets/tee-atlas/plane-fit-v2.json')
    prior=read('docs/tee-plane-qc-v2/baselines.json')['views'];tracks=read('docs/anatomy/cavity-tracks.json')
    rows=[];report={}
    for key,v in prior.items():
        if key not in catalog['views']:
            report[key]=dict(aseNumber=v['aseNumber'],name=v['name'],outsideScan=True,disposition='No acquired CT target; must remain explicitly outside scan.')
            continue
        c=catalog['views'][key];f=source_frame(c['frame']);a,b=sample(volume,f,760,labels);m=metrics(a,b,f,tracks)
        report[key]=dict(aseNumber=v['aseNumber'],name=v['name'],currentStatus=c['status'],summary=c['summary'],remainingLimits=c['remainingLimits'],metrics=m)
        rows.append((key,v,a,b,m))
        print(f"{v['aseNumber']:02d} {key:14} "+' '.join(f"{n}:{100*m['regionalTissue'][n]['fraction']:4.1f}" for n in NAMES[1:]),flush=True)
    for i in range(0,len(rows),6):make_sheet(rows[i:i+6],OUT/f'current-source-labels-{i//6+1}.jpg',f'Current TEE atlas source and segmentation audit · plate {i//6+1}')
    doc=dict(schemaVersion=1,datasetId=catalog['datasetId'],source=source,labelRevision=manifest['revision'],labelDecodedSha256=labelhash,labelDimensionsXYZ=manifest['dimensions'],sampling='Exact current world plane converted to source coordinates; trilinear uint8 scalar; nearest-neighbor categorical label; same endpoint registration as viewer.',limitations=['Regional labels are approximate tissue ownership, not expert reference, blood pools, valves, individual vessels or appendages.','Compact shared septal core is colored LV by convention; raw LV/RV tissue fractions cannot decide correctness on their own.','Areas and track proximity are screening evidence for manual source inspection, not clinical accuracy or chamber-volume measurements.','The displayed source bank is windowed uint8 at 317.6 micrometers; not calibrated Hounsfield units.'],views=report)
    (OUT/'all-view-audit.json').write_text(json.dumps(doc,indent=2)+'\n')

if __name__=='__main__':main()
