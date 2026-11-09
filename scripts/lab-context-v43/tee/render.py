"""TEE Lab skeleton native spatial review; production GLSL, actual resident CT.
This is scientific EGL rendering, not a browser screenshot or device-performance test.
"""
from pathlib import Path
import argparse
import json
import sys
import time
import numpy as np
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[3]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--input',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
args=p.parse_args()
harness=ROOT/'scripts/echo-face-v42/render_gallery.py'
# Reuse verified resident-data decoding, production GLSL compilation, matching
# camera/depth geometry passes and scan-sector replay. Do not invoke its atlas
# review loop or relabel Lab poses as Echo atlas entries.
ns={'__file__':str(harness),'__name__':'tee_lab_native_v43'}
saved=sys.argv;sys.argv=[str(harness),'--input',str(args.input),'--output',str(args.output)]
exec(compile(harness.read_text().split('started=time.monotonic();rendered=[]')[0],str(harness),'exec'),ns)
sys.argv=saved
for name in ['review','caps','cases','W','H','OUT','INPUT','cap_index','volume_pass','geometry_pass','read_pixels','texture','sha','replay_guides','font','driver']:
    globals()[name]=ns[name]
rows=[];started=time.monotonic();cell_w,cell_h=W//2,H//2;gallery=Image.new('RGB',(cell_w*4,94+(cell_h+52)*2+50),(9,16,20));g=ImageDraw.Draw(gallery)
g.text((18,12),f"{review['donor']} · TEE Lab · fitted skeleton",font=font(25,True),fill='#ecefe8')
g.text((18,47),'Same pose, camera, measured heart and CT cap · skeleton ON / OFF',font=font(16),fill='#a9bfc0')
g.text((18,70),f"Production EGL · {caps['sourceSpacingUm']:g} µm resident source · illustrative context",font=font(12),fill='#8da5a8')
for i,c in enumerate(cases):
    assert c['cameras']['on']==c['cameras']['off'],'Comparison cameras differ'
    assert c['guidesByCamera']['on']==c['guidesByCamera']['off'],'Comparison guides differ'
    assert not any(d.get('id','').startswith('bodyparts3d-') for d in c['drawsByCamera']['off']),'OFF draw list contains skeleton'
    assert sum(d.get('id') in ['bodyparts3d-bones','bodyparts3d-spine'] for d in c['drawsByCamera']['on'])==4,'ON draw list must include exactly two bone meshes, two cull passes'
    meta=cap_index[c['id']];raw=(INPUT/meta['file']).read_bytes();assert sha(raw)==meta['sha256']
    cap=np.frombuffer(raw,np.uint8).reshape(meta['height'],meta['width']).copy();texture(1,cap,True)
    camera=c['cameras']['on'];old_threshold=ns['threshold'];ns['threshold']=2
    volume_pass(c,camera,cap);background=read_pixels();ns['threshold']=old_threshold
    volume_pass(c,camera,cap);heart=read_pixels();heart_mask=np.any(heart!=background,axis=2)
    pixels={};images={}
    for key in ['on','off']:
        volume_pass(c,camera,cap);geometry_pass(c,camera,key);pixels[key]=read_pixels()
        image=replay_guides(Image.fromarray(pixels[key]),c['guidesByCamera'][key]);images[key]=image
    changed=np.any(pixels['on']!=pixels['off'],axis=2)
    stats={'id':c['id'],'heartPixels':int(np.count_nonzero(heart_mask)),
        'heartPixelsChangedBySkeleton':int(np.count_nonzero(changed&heart_mask)),
        'contextPixelsChanged':int(np.count_nonzero(changed&~heart_mask)),
        'skeletonTriangleCount':sum(ns['vertex_buffers'][d['file']]['count']//3 for d in c['drawsByCamera']['on'] if d.get('id') in ['bodyparts3d-bones','bodyparts3d-spine'])//2,
        'capSha256':meta['sha256'],'plane':c['plane'],'pose':c['pose'],'camera':camera,
        'glError':int(ns['gl_error']())}
    assert stats['heartPixels']>1000,(c['id'],'No visible measured heart')
    assert stats['heartPixelsChangedBySkeleton']==0,(c['id'],'Skeleton altered measured heart pixels',stats)
    assert stats['contextPixelsChanged']>100,(c['id'],'No visible surrounding skeleton',stats)
    assert stats['glError']==0
    pair=Image.new('RGB',(W*2,H+76),(9,16,20));d=ImageDraw.Draw(pair)
    pair.paste(images['on'],(0,50));pair.paste(images['off'],(W,50))
    d.text((14,9),c['name'],font=font(19,True),fill='#ecede5')
    d.text((14,31),'Skeleton on',font=font(13),fill='#b1c4c0');d.text((W+14,31),'Skeleton off · identical camera',font=font(13),fill='#b1c4c0')
    d.text((14,H+56),f"{stats['heartPixels']:,} heart pixels unchanged · fitted reference skeleton, not patient registration",font=font(12),fill='#98b3b6')
    filename=f"{c['id']}-skeleton-pair.jpg";pair.save(OUT/filename,quality=87,subsampling=0);stats['image']=filename
    for row,key in enumerate(['on','off']):
        x=i*cell_w;y=94+row*(cell_h+52)
        gallery.paste(images[key].resize((cell_w,cell_h),Image.Resampling.LANCZOS),(x,y+24))
        g.text((x+8,y+2),f"{c['code']} · skeleton {key}",font=font(13,True),fill='#c2d2cb')
        g.text((x+8,y+cell_h+29),'0 heart pixels altered',font=font(11),fill='#98b3b6')
    rows.append(stats);print(json.dumps({k:stats[k] for k in ['id','heartPixels','heartPixelsChangedBySkeleton','contextPixelsChanged','glError']}),flush=True)
g.text((16,gallery.height-40),'CT: Human Organ Atlas / ESRF · skeleton: BodyParts3D / DBCLS · CC BY 4.0',font=font(12),fill='#8da5a8')
g.text((16,gallery.height-21),'Resident-source native render; no browser/mobile FPS or clinical correspondence claims.',font=font(12),fill='#8da5a8')
gallery.save(OUT/'gallery.jpg',quality=87)
report={'passed':True,'scope':__doc__,'donor':review['donor'],'cases':len(rows),'renders':len(rows)*2,'sourceSpacingUm':caps['sourceSpacingUm'],
    'sourceHashes':review['sourceHashes'],'driver':driver,'exportSha256':sha((INPUT/'review.json').read_bytes()),'mprWorkerSha256':caps['workerSha256'],
    'sourceParts':caps['sourceParts'],'decodedSourceSha256':caps['decodedSourceSha256'],'sourceVoxelsModified':False,'model':review['models'],
    'heartMask':'Exact resident-volume color difference from the same production shader with threshold 2 (background only), before adding any context or probe. Skeleton ON/OFF comparison precedes shared guide strokes.',
    'checks':rows,'elapsedSeconds':round(time.monotonic()-started,2),
    'limitations':['Native EGL, not browser screenshot or physical-device validation.','Resident 317–318 µm measured display source; no fresh 79.4 µm volume or Ultra/local replacement meshes.','Fixed illustrative surrounding anatomy is not clinical patient registration.','Font callouts omitted; source probe/sector geometry and fitted bones preserved.']}
(OUT/'review.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'passed':True,'cases':len(rows),'seconds':report['elapsedSeconds'],'report':str(OUT/'review.json')}),flush=True)
