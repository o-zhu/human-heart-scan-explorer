#!/usr/bin/env python3
"""Bounded actual79.4µm versus317.6µm source comparison in reviewed exterior ROI.

This assesses a possible future fine reconstruction. It does not produce or
claim a new whole-heart fine surface. No original source asset is modified.
"""
from pathlib import Path
import hashlib,json,sys
import numpy as np
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/coronary-v36/methods/fine-roi';OUT.mkdir(parents=True,exist_ok=True)
fixture=ROOT/'tests/reconstruction-detail-v35-native.py'
setup=fixture.read_text().split('\nchecks=[];source_checks=[]')[0]
setup=setup.replace('2400, 1600, 1500, 1000','1400, 800, 350, 200')
ns=dict(__file__=str(fixture),__name__='__experiment__')
sys.argv=[str(fixture),'--output',str(OUT)]
exec(compile(setup,str(fixture),'exec'),ns)
from prepare import load_source,guide,sha
sys.path.insert(0,str(ROOT/'scripts/fine-detail-v23'))
from source import FineSource
reader=FineSource(64)
lo=np.array([528,812,688]);hi=np.array([1033,1125,893])
fine=reader.region(lo,hi)
donor=next(d for d in ns['donors'] if d['id']=='ladaf-2021-17')
manifest=ns['read_json'](ns['public_path'](donor['manifestUrl']))
whole=load_source(manifest['levels']['high']);whole_hash=sha(whole)
coarse=whole[lo[2]//4:(hi[2]-1)//4+1,lo[1]//4:(hi[1]-1)//4+1,lo[0]//4:(hi[0]-1)//4+1].copy()
assert np.all((np.array(coarse.shape)-1)*4==np.array(fine.shape)-1)
camera=dict(yaw=float(np.arctan2(-.3,-1)),pitch=float(np.arcsin(.4/np.linalg.norm([-.3,.4,-1]))),roll=np.pi,distance=1.65,pan=[0,0,0])
ns['basis']=ns['node']('import {VolumeRenderer} from "./public/renderer.js";console.log(JSON.stringify(VolumeRenderer.prototype.basis.call({camera:'+json.dumps(camera)+'})));')
base=ns['configure']
def configure(program,*args,**kwargs):
    base(program,*args,**kwargs)
    for name in ['coronaryReady','cleanupReady','lumenCleanupReady','lumenCleanupEnabled','refinementReady','nativeReplacementEnabled']:
        ns['ui'](program,name,0)
ns['configure']=configure
world=dict(normal=[0,0,1],right=[1,0,0],up=[0,1,0],center=[0,0,0],width=1,height=1)
cleanup=dict(dimensions=[1,1,1]);images=[];checks=[]
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',18)
for label,field,spacing in [('317.6 µm Original',coarse,317.6),('79.4 µm Original',fine,79.4),('79.4 µm Guided ±6',np.clip(np.rint(guide(fine)),0,255).astype(np.uint8),79.4)]:
    level=dict(dimensions=list(field.shape[::-1]),spacingUm=spacing)
    ns['texture'](0,field,True)
    for threshold in [.32,.42]:
        pixels=ns['draw'](ns['programs']['volume'],ns['full'],level,cleanup,world,donor['displayWindow'],threshold,(1,1),clipped=False,ready=0)[:,:,:3]
        index=len(images);Image.fromarray(pixels).save(OUT/f'roi-{index}.jpg',quality=97)
        card=Image.new('RGB',(700,438),'#0b1317');card.paste(Image.fromarray(pixels).resize((700,400)),(0,38))
        ImageDraw.Draw(card).text((12,10),f'{label} · Threshold{threshold:.2f}',font=font,fill='#eeeeDF')
        images.append(card);checks.append(dict(label=label,threshold=threshold,grid=level['dimensions'],spacingUm=spacing,sha256=sha(field)))
sheet=Image.new('RGB',(1400,1314),'#0b1317')
for i,item in enumerate(images):sheet.paste(item,((i%2)*700,(i//2)*438))
sheet.save(OUT/'fine-source-comparison.jpg',quality=97)
report=dict(roiLowerFullFineXYZ=lo.tolist(),roiUpperFullFineXYZExclusive=hi.tolist(),camera=camera,fineSource=reader.receipt(),
            originalFullCoarseSourceSha256=whole_hash,originalFullCoarseSourceUnchanged=sha(whole)==whole_hash,
            physicalBoundsMatchExactly=True,sourceWindow=manifest['sourceWindow'],checks=checks,
            scope='Bounded source ROI coincident with previously reviewed right-perivascular region. Cropped-box edges are displayed; these are not invented organ closure surfaces. Demonstrates source sampling difference, not an installed full fine coronary model.')
(OUT/'fine-source-report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report),flush=True)
