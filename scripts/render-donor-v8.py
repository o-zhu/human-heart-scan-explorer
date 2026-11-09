"""Render the new donor through production GLSL in native offscreen EGL.

This checks actual hosted volume decoding, physical framing and fine cap inputs.
It is not browser automation or a measurement of interactive device frame rates.
"""
from pathlib import Path
import ctypes as C
import gzip
import hashlib
import json
import numpy as np
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs/donors/ucl-zcr-2629'
base=ROOT/'scripts/render_flow_views_v5.py'
scope={'__file__':str(base),'__name__':'donor_v8_egl'}
exec(compile(base.read_text().split('data=np.load')[0],str(base),'exec'),scope)
fn,U,I,F,P=(scope[k] for k in ['fn','U','I','F','P'])
active,bind,t2,param,gen=(scope[k] for k in ['active','bind','t2','param','gen'])
ui,uf,u2,u3=(scope[k] for k in ['ui','uf','u2','u3'])

manifest=json.loads((ROOT/'public/assets/donors/ucl-zcr-2629/manifest.json').read_text())
level=manifest['levels']['high'];dims=level['dimensions'];nx,ny,nz=dims
parts=[]
for part in level['parts']:
    encoded=(ROOT/'public'/part['url']).read_bytes()
    assert hashlib.sha256(encoded).hexdigest()==part['sha256']
    values=np.frombuffer(gzip.decompress(encoded),np.uint8).reshape(-1,ny,nx)
    if part.get('predictor')=='delta-z':values=np.add.accumulate(values,axis=0,dtype=np.uint8)
    assert hashlib.sha256(values.tobytes()).hexdigest()==part['rawSha256']
    parts.append(values)
volume=np.concatenate(parts,axis=0)
assert list(volume.shape[::-1])==dims
scope['texture3'](0,volume,True)
cleanup_meta=json.loads((ROOT/'public/assets/donors/ucl-zcr-2629/cleanup/manifest.json').read_text())
cleanup=np.frombuffer(gzip.decompress((ROOT/'public'/cleanup_meta['volumeUrl']).read_bytes()),np.uint8).reshape(cleanup_meta['dimensions'][::-1]).copy()
scope['texture3'](2,cleanup)
scope['texture3'](3,np.zeros((1,1,1),np.uint8));scope['texture3'](4,np.zeros((1,1,1),np.uint8))
texcap=U();gen(1,C.byref(texcap));active(0x84C1);bind(0x0DE1,texcap)
for name,value in [(0x2801,0x2601),(0x2800,0x2601),(0x2802,0x812F),(0x2803,0x812F)]:param(0x0DE1,name,value)
target=U();gen(1,C.byref(target));active(0x84C5);bind(0x0DE1,target)
fbo=U();fn('glGenFramebuffers',None,[I,C.POINTER(U)])(1,C.byref(fbo));fn('glBindFramebuffer',None,[U,U])(0x8D40,fbo)
fn('glFramebufferTexture2D',None,[U,U,U,U,I])(0x8D40,0x8CE0,0x0DE1,target,0)
buffer=U();fn('glGenBuffers',None,[I,C.POINTER(U)])(1,C.byref(buffer));fn('glBindBuffer',None,[U,U])(0x8892,buffer)
vertices=np.array([-1,-1,3,-1,-1,3],np.float32)
fn('glBufferData',None,[U,C.c_ssize_t,P,U])(0x8892,vertices.nbytes,vertices.ctypes.data,0x88E4)
frames=json.loads((ROOT/'public/assets/donors/ucl-zcr-2629/echo-planes.json').read_text())['frames']
textures=json.loads((ROOT/'public/assets/donors/ucl-zcr-2629/echo-textures.json').read_text())['textures']
def unit(a):return np.asarray(a)/np.linalg.norm(a)

W,H=520,600
def render(key,cut=True):
    world=frames[key]['world'];normal=np.array(world['normal']);right=np.array(world['right']);up=np.array(world['up']);center=np.array(world['center'])
    direction=unit(normal+right*.28+up*.08);forward=-direction;right=unit(np.cross(forward,up));up=unit(np.cross(right,forward))
    if not cut:
        # Exact initial reconstruction camera; Echo intentionally uses probe-up.
        direction=np.array([np.sin(.32)*np.cos(.12),np.sin(.12),np.cos(.32)*np.cos(.12)])
        forward=-direction;right=-unit(np.cross(forward,[0,1,0]));up=unit(np.cross(right,forward));center=np.zeros(3)
    cap=np.asarray(Image.open(ROOT/'public'/textures[key]['url']).convert('L')).copy()
    active(0x84C1);bind(0x0DE1,texcap);t2(0x0DE1,0,0x8229,cap.shape[1],cap.shape[0],0,0x1903,0x1401,cap.ctypes.data)
    active(0x84C5);bind(0x0DE1,target);t2(0x0DE1,0,0x8058,W,H,0,0x1908,0x1401,None)
    assert fn('glCheckFramebufferStatus',U,[U])(0x8D40)==0x8CD5
    program=scope['programs']['after'];scope['use'](program)
    pos=fn('glGetAttribLocation',I,[U,C.c_char_p])(program,b'position');fn('glEnableVertexAttribArray',None,[U])(pos)
    fn('glVertexAttribPointer',None,[U,I,U,U,I,P])(pos,2,0x1406,0,0,None)
    for name,value in {'volume':0,'capTexture':1,'cleanupTexture':2,'cleanupReady':1,'cleanupEnabled':1,'anatomyReady':0,'anatomyTexture':3,'mode':0,'palette':4,'clipAxis':3 if cut else -1,'clipFlip':0,'showPlanes':0,'capReady':int(cut),'capCleaned':1,'skipCap':0,'surfaceSmoothing':1,'accelerationTexture':4,'accelerationReady':0}.items():ui(program,name,value)
    for name,value in {'fov':.32,'cameraAspect':W/H,'threshold':manifest['defaultThreshold'],'opacity':.8,'stepSize':.9/max(dims),'clipPosition':.5,'planeDistance':np.dot(normal,center),'capContrast':1.65}.items():uf(program,name,value)
    L=max(n-1 for n in dims)
    for name,value in {'dimensions':dims,'textureDimensions':dims,'textureOffset':[0,0,0],'cleanupDimensions':cleanup_meta['dimensions'],'anatomyDimensions':[1,1,1],'extent':[(nx-1)/L,(nz-1)/L,(ny-1)/L],'planeNormal':normal,'capCenter':center,'capRight':world['right'],'capUp':world['up'],'eye':center+direction*1.55,'forward':forward,'right':right,'up':up,'slicePositions':[.5,.5,.5]}.items():u3(program,name,value)
    u2(program,'resolution',[W,H]);u2(program,'capSize',[world['width'],world['height']])
    fn('glViewport',None,[I,I,I,I])(0,0,W,H);fn('glDrawArrays',None,[U,I,I])(4,0,3);fn('glFinish',None,[])()
    pixels=np.empty((H,W,4),np.uint8);fn('glReadPixels',None,[I,I,I,I,U,U,P])(0,0,W,H,0x1908,0x1401,pixels.ctypes.data)
    assert fn('glGetError',U,[])()==0
    image=pixels[::-1].copy();coverage=int((image[:,:,:3].max(axis=2)>80).sum());assert coverage>10000,(key,coverage)
    return Image.fromarray(image).convert('RGB'),{'frame':key,'cutaway':cut,'capPixels':list(cap.shape[::-1]),'tissuePixels':coverage,'glError':0}

sheet=Image.new('RGB',(W*3,H+70),'#0c1317');draw=ImageDraw.Draw(sheet);checks=[]
for index,(key,cut,title) in enumerate([('a4c',False,'Whole specimen'),('a4c',True,'Independent long-axis candidate'),('plax',True,'Independent valve-region candidate')]):
    image,check=render(key,cut);checks.append(check);sheet.paste(image,(W*index,70))
    draw.text((W*index+14,12),title,fill='#eee8dd');draw.text((W*index+14,34),'112.512 µm volume / 28.128 µm measured cut face',fill='#94afa7')
sheet.save(OUT/'production-shader-review.jpg',quality=94)
report={'passed':True,'driver':scope['driver'],'datasetId':'2298522198','volumeDimensionsXYZ':dims,'volumeRawSha256':hashlib.sha256(volume.tobytes()).hexdigest(),'shaderSha256':hashlib.sha256((ROOT/'public/renderer.js').read_bytes()).hexdigest(),'checks':checks,'scope':'Production GLSL and actual encoded source assets in native EGL. No browser/device speed or clinical frame validation claim.'}
(OUT/'production-shader-validation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report),flush=True)
