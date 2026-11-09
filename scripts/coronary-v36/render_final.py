#!/usr/bin/env python3
"""Render final prepared fields through the production alternate-volume path."""
from pathlib import Path
import gc, hashlib, json, sys
import numpy as np
from PIL import Image,ImageDraw,ImageFont

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/coronary-v36/methods/final'
OUT.mkdir(parents=True,exist_ok=True)
fixture=ROOT/'tests/reconstruction-detail-v35-native.py'
setup=fixture.read_text().split('\nchecks=[];source_checks=[]')[0]
setup=setup.replace('2400, 1600, 1500, 1000','1200, 1200, 300, 300')
ns=dict(__file__=str(fixture),__name__='__experiment__')
sys.argv=[str(fixture),'--output',str(OUT)]
exec(compile(setup,str(fixture),'exec'),ns)
from prepare import load_source,sha
manifest=json.loads((ROOT/'public/assets/coronary-v36/manifest.json').read_text())
U,I,C=ns['U'],ns['I'],ns['C']
field_texture=U();ns['fn']('glGenTextures',None,[I,C.POINTER(U)])(1,C.byref(field_texture))
ns['active'](0x84C8);ns['bind'](0x806F,field_texture)
for key,value in [(0x2801,0x2601),(0x2800,0x2601),(0x2802,0x812F),(0x2803,0x812F),(0x8072,0x812F)]:ns['param'](0x806F,key,value)
configure_base=ns['configure'];active_field=False;smoothing=1;entry=None
def configure(program,*args,**kwargs):
    configure_base(program,*args,**kwargs)
    ns['ui'](program,'coronaryTexture',8)
    ns['ui'](program,'coronaryReady',int(active_field))
    ns['u3'](program,'coronaryDimensions',entry['dimensions'])
    ns['uf'](program,'coronaryThreshold',entry['threshold'])
    ns['ui'](program,'surfaceSmoothing',smoothing)
ns['configure']=configure
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',17)
small=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',14)
checks=[]
for donor in ns['donors']:
    if donor['id'] not in manifest['donors']:continue
    entry=manifest['donors'][donor['id']]
    source_meta=ns['read_json'](ns['public_path'](donor['manifestUrl']));level=source_meta['levels']['high']
    source=load_source(level);field=load_source(entry)
    assert sha(source)==entry['sourceRawSha256'] and sha(field)==entry['rawSha256']
    ns['texture'](0,source,True)
    ns['active'](0x84C8);ns['bind'](0x806F,field_texture)
    ns['t3'](0x806F,0,0x8229,*field.shape[::-1],0,0x1903,0x1401,field.ctypes.data)
    cleanup=ns['read_json'](ns['public_path'](donor['cleanupManifestUrl']))
    mask=np.frombuffer(ns['gzip'].decompress(ns['public_path'](cleanup['volumeUrl']).read_bytes()),np.uint8).reshape(cleanup['dimensions'][::-1]).copy()
    ns['texture'](2,mask);ns['current_donor']=donor['id']
    world=dict(normal=[0,0,1],right=[1,0,0],up=[0,1,0],center=[0,0,0],width=1,height=1)
    variants=[('Original Baseline',False,source_meta['defaultThreshold'],1),
              ('Higher Threshold Only',False,entry['processing']['sourceThresholdReveal'],1),
              ('Prepared Reveal',True,source_meta['defaultThreshold'],1),
              ('Reveal · Softer Normals',True,source_meta['defaultThreshold'],2)]
    for view,yaw in [('front',.32),('rear',.32+np.pi)]:
        camera=dict(yaw=yaw,pitch=.12,roll=np.pi,distance=1.65,pan=[0,0,0])
        ns['basis']=ns['node']('import {VolumeRenderer} from "./public/renderer.js";console.log(JSON.stringify(VolumeRenderer.prototype.basis.call({camera:'+json.dumps(camera)+'})));')
        rendered=[]
        for label,active_field,threshold,smoothing in variants:
            common=[level,cleanup,world,donor['displayWindow'],threshold,(1,1)]
            pixels=ns['draw'](ns['programs']['volume'],ns['full'],*common,clipped=False,ready=0)[:,:,:3]
            rendered.append(pixels)
            name=f'{donor["id"]}-{view}-{len(rendered)-1}'
            Image.fromarray(pixels).save(OUT/(name+'.jpg'),quality=96)
        sheet=Image.new('RGB',(1440,400),'#0b1317');draw=ImageDraw.Draw(sheet)
        for index,(pixels,(label,*_)) in enumerate(zip(rendered,variants)):
            sheet.paste(Image.fromarray(pixels).resize((360,360)),(index*360,40))
            draw.text((index*360+10,12),label,font=font,fill='#ecebdd')
        sheet.save(OUT/f'{donor["id"]}-{view}-comparison.jpg',quality=96)
        if view=='front':
            # Fixed screen-space windows inspect upper wall and ventricular
            # surface branches; these crops do not assign vessel identities.
            boxes={'upper-wall':[590,200,890,560],'surface-branches':[500,600,800,960]}
            if donor['id']=='s-20-29':boxes={'upper-wall':[420,130,720,490],'surface-branches':[400,480,700,840]}
            if donor['id']=='s-20-28':boxes={'upper-wall':[440,120,740,480],'surface-branches':[480,480,780,840]}
            for crop,box in boxes.items():
                detail=Image.new('RGB',(1200,400),'#0b1317');pen=ImageDraw.Draw(detail)
                for index,(pixels,(label,*_)) in enumerate(zip(rendered,variants)):
                    detail.paste(Image.fromarray(pixels).crop(box),(index*300,40))
                    pen.text((index*300+8,12),label,font=small,fill='#ecebdd')
                detail.save(OUT/f'{donor["id"]}-{crop}-detail.png')
        checks.append(dict(donor=donor['id'],view=view,camera=camera,grid=[1200,1200],
                           originalSourceSha256=sha(source),sourceHashUnchanged=sha(source)==entry['sourceRawSha256'],
                           derivedSha256=sha(field),actualProductionCoronaryTexturePath=True,
                           labels=[v[0] for v in variants],originalThreshold=source_meta['defaultThreshold'],
                           revealThreshold=entry['processing']['sourceThresholdReveal'],derivedThreshold=entry['threshold']))
        print(json.dumps(checks[-1]),flush=True)
    del source,field,mask;gc.collect()
(OUT/'native-final-report.json').write_text(json.dumps(dict(passed=True,checks=checks,
    shaderSha256=hashlib.sha256(json.dumps(ns['sources'],sort_keys=True).encode()).hexdigest(),
    scope='Actual measured source and final prepared banks through current production GLSL in native EGL. Matching cameras, source cleanup, dimensions and sampling. Not browser, Safari, clinical validation or acquired-resolution gain.'),indent=2)+'\n')
