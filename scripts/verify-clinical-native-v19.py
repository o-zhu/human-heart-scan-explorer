#!/usr/bin/env python3
"""Native EGL review of actual clinical assets using the production volume shader.

This checks the measured datasets' renderer presentation, without a browser,
data mutation, inferred segmentation, or a browser/device frame-rate claim.
"""
from pathlib import Path
import sys

REPO=Path(__file__).resolve().parents[1]
fixture=REPO/'tests/brightness-v12-render.py'
__file__=str(fixture)
if '--output' not in sys.argv:
    sys.argv += ['--output',str(REPO/'docs/clinical-v19/verification')]
setup=fixture.read_text().split('profiles = ')[0]
exec(compile(setup,str(fixture),'exec'))
import time
import math

W,H=640,640
public_file=lambda url:ROOT/'public'/url.lstrip('/')
unit=lambda v:np.asarray(v,dtype=float)/np.linalg.norm(v)


def frame_data(series):
    frame=series['frames'][series.get('defaultFrame',0)]
    blob=public_file(frame['url']).read_bytes()
    assert hashlib.sha256(blob).hexdigest()==frame['sha256']
    raw=gzip.decompress(blob)
    assert len(raw)==np.prod(series['dimensions'])==frame['decodedBytes']
    if frame.get('decodedSha256'):assert hashlib.sha256(raw).hexdigest()==frame['decodedSha256']
    return np.frombuffer(raw,np.uint8).reshape(*series['dimensions'][::-1]).copy()


def capture(series,axis=None,position=None,oblique=False,threshold=None,distance=None):
    p=programs['volume'];target(p,W,H)
    dims=np.array(series['dimensions']);spacing=np.array(series['spacingMm']);size=(dims-1)*spacing
    ex=np.array([size[0],size[2],size[1]])/max(size)
    initial=series.get('defaultSlice',{})
    axis=initial.get('axis',2) if axis is None else axis
    position=initial.get('position',.5) if position is None else position
    position=math.floor(position*(dims[axis]-1)+.5)/(dims[axis]-1)
    distance=series.get('defaultCameraDistance',1.65) if distance is None else distance
    source=np.array([.5,.5,.5]);source[axis]=position
    center=np.array([(source[0]-.5)*ex[0],(source[2]-.5)*ex[1],(.5-source[1])*ex[2]])
    right0=np.array([0,0,-1] if axis==0 else [1,0,0])
    up0=np.array([0,0,1] if axis==2 else [0,-1,0])
    normal=np.cross(right0,up0)
    direction=unit(normal+(.32*right0+.10*up0 if oblique else 0))
    forward=-direction;right=unit(np.cross(forward,up0));up=unit(np.cross(right,forward))
    profile_uniforms(p,series['displayWindow'])
    t=series['defaultThreshold'] if threshold is None else threshold
    for name,value in dict(cleanupReady=0,cleanupEnabled=0,anatomyReady=0,mode=0,palette=4,
                           clipAxis=axis,clipFlip=[1,0,1][axis],showPlanes=0,capReady=0,
                           capCleaned=0,skipCap=0,surfaceSmoothing=1,accelerationReady=0).items():ui(p,name,value)
    step=min(ex[0]/(dims[0]-1),ex[1]/(dims[2]-1),ex[2]/(dims[1]-1))*.9
    for name,value in dict(fov=.32,cameraAspect=W/H,threshold=t,opacity=.8,stepSize=step,
                           clipPosition=position,planeDistance=np.dot(normal,center)).items():uf(p,name,value)
    for name,value in dict(dimensions=dims,textureDimensions=dims,textureOffset=[0,0,0],
                           cleanupDimensions=[1,1,1],anatomyDimensions=[1,1,1],extent=ex,
                           planeNormal=normal,capCenter=[0,0,0],capRight=[1,0,0],capUp=[0,1,0],
                           eye=center+direction*distance,forward=forward,right=right,up=up,
                           slicePositions=source).items():u3(p,name,value)
    u2(p,'resolution',[W,H]);u2(p,'capSize',[1,1]);u2(p,'capRasterSize',[1,1])
    start=time.monotonic();image=pixels(W,H);seconds=time.monotonic()-start
    return image,dict(axis=axis,position=position,oblique=oblique,threshold=t,distance=distance,
                      normalizedExtent=ex.tolist(),stepSize=step,secondsOffline=seconds,
                      foregroundPixels=int((image[:,:,:3].max(axis=2)>25).sum()))


checks=[];captures={}
for bank in ['slicerheart','cmac']:
    manifest=json.loads((ROOT/f'public/assets/clinical-v19/{bank}/manifest.json').read_text())
    series_list=manifest['series'] if bank=='slicerheart' else [s for s in manifest['series'] if s['id']=='whole-heart-mri']
    for series in series_list:
        key=bank+'-'+series['id']
        data=frame_data(series);texture(0,data,True)
        variants=[('default',dict()),('oblique',dict(oblique=True)),
                  ('higher-threshold',dict(oblique=True,threshold=.44 if bank=='slicerheart' else .23))]
        for label,options in variants:
            image,metadata=capture(series,**options)
            Image.fromarray(image).save(OUT/(key+'-'+label+'.png'))
            captures[(key,label)]=image
            frame_index=series.get('defaultFrame',0)
            item=dict(series=key,variant=label,dimensions=series['dimensions'],spacingMm=series['spacingMm'],
                      frameIndex=frame_index,sourceFrameSha256=series['frames'][frame_index]['sha256'],**metadata)
            checks.append(item);print(json.dumps(item),flush=True)

font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',19)
small=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',13)
for key in sorted(set(k for k,label in captures)):
    sheet=Image.new('RGB',(3*W,H+73),(8,13,16));pen=ImageDraw.Draw(sheet)
    for col,label in enumerate(['default','oblique','higher-threshold']):
        item=next(c for c in checks if c['series']==key and c['variant']==label)
        sheet.paste(Image.fromarray(captures[(key,label)][:,:,:3]),(col*W,73))
        pen.text((col*W+12,10),label.replace('-',' ')+' · threshold '+str(item['threshold']),font=font,fill='#f0eae1')
        pen.text((col*W+12,40),key+' · production GLSL, measured phase '+str(item['frameIndex']),font=small,fill='#adc2c0')
    sheet.save(OUT/(key+'-comparison.jpg'),quality=95)

report=dict(passed=True,outputDimensions=[W,H],
            renderer=fn('glGetString',C.c_char_p,[U])(0x1F01).decode(),
            productionShaderSha256=hashlib.sha256(sources['volume'].encode()).hexdigest(),
            productionRendererSha256=hashlib.sha256((ROOT/'public/renderer.js').read_bytes()).hexdigest(),
            clinicalAppSha256=hashlib.sha256((ROOT/'public/clinical-app.js').read_bytes()).hexdigest(),
            checks=checks,
            limitations=['Native EGL presentation check, not browser automation or browser/device FPS.',
                         'No acquisition resolution, source intensities, or anatomical segmentation is inferred from thresholded surfaces.',
                         'The measured default phase, section and camera distance come from each series manifest; native planes are snapped to sample centers.',
                         'Anisotropic spacing is preserved using the same physical-extent calculation as VolumeRenderer.load.'])
(OUT/'clinical-native-render.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(dict(passed=True,captures=len(checks))),flush=True)
