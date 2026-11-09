"""Native EGL verification of production single/two-pass GLSL using measured Echo caps.

No browser automation. Timings are software-driver measurements at the stated
pixel counts, not user-device FPS claims.
"""
from pathlib import Path
import ctypes as C
import json, subprocess, time
import numpy as np
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[1]
base=ROOT/'scripts/render_flow_views_v5.py'
scope={'__file__':str(base),'__name__':'motion_cap_validation'}
exec(compile(base.read_text().split("results={'driver':")[0],str(base),'exec'),scope)
fn,U,I,F,P=(scope[name] for name in ['fn','U','I','F','P'])
active,bind,t2,param,gen=(scope[name] for name in ['active','bind','t2','param','gen'])
ui,uf,u2,u3=(scope[name] for name in ['ui','uf','u2','u3'])
use=scope['use']
sources=json.loads(subprocess.check_output(['node','--input-type=module','-e',
 'import {volumeShaderSources} from "./public/renderer.js"; console.log(JSON.stringify(volumeShaderSources));'],cwd=ROOT,text=True))

def compile_program(fragment):
 shaders=[]
 for kind,src in [(0x8B31,sources['vertex']),(0x8B30,fragment)]:
  shader=scope['create'](kind);data=C.c_char_p(src.encode());scope['source'](shader,1,C.byref(data),None);scope['compile_shader'](shader)
  ok=I();scope['getiv'](shader,0x8B81,C.byref(ok));log=C.create_string_buffer(32768);scope['getlog'](shader,32768,None,log)
  assert ok.value,log.value.decode();shaders.append(shader)
 program=fn('glCreateProgram',U,[])()
 for shader in shaders:fn('glAttachShader',None,[U,U])(program,shader)
 fn('glLinkProgram',None,[U])(program);ok=I();fn('glGetProgramiv',None,[U,U,C.POINTER(I)])(program,0x8B82,C.byref(ok));assert ok.value
 return program
programs={'volume':scope['programs']['after'],'composite':compile_program(sources['composite'])}

def target(width,height,zeros=False):
 texture=U();gen(1,C.byref(texture));active(0x84C6);bind(0x0DE1,texture)
 data=np.zeros((height,width,4),np.uint8) if zeros else None
 t2(0x0DE1,0,0x8058,width,height,0,0x1908,0x1401,None if data is None else data.ctypes.data)
 for name,value in [(0x2801,0x2601),(0x2800,0x2601),(0x2802,0x812F),(0x2803,0x812F)]:param(0x0DE1,name,value)
 framebuffer=U();fn('glGenFramebuffers',None,[I,C.POINTER(U)])(1,C.byref(framebuffer));fn('glBindFramebuffer',None,[U,U])(0x8D40,framebuffer)
 fn('glFramebufferTexture2D',None,[U,U,U,U,I])(0x8D40,0x8CE0,0x0DE1,texture,0)
 assert fn('glCheckFramebufferStatus',U,[U])(0x8D40)==0x8CD5
 return {'texture':texture,'framebuffer':framebuffer,'width':width,'height':height}
W,H=520,590;VW,VH=200,227
outputs={name:target(W,H) for name in ['reference','composite','legacy','mask','provenance']}
low=target(VW,VH);black=target(1,1,True)
frames=json.loads((ROOT/'public/assets/echo-planes.json').read_text())['frames']
manifest=json.loads((ROOT/'public/assets/echo-textures.json').read_text())['textures']

def camera(world,side=1):
 normal=np.asarray(world['normal']);r=np.asarray(world['right']);u=np.asarray(world['up']);center=np.asarray(world['center'])
 direction=scope['norm'](normal*side+r*.24*side+u*.10)
 camera_up=scope['norm'](u-direction*np.dot(direction,u));forward=-direction;right=scope['norm'](np.cross(forward,camera_up));camera_up=scope['norm'](np.cross(right,forward))
 return dict(eye=center+direction*1.55,forward=forward,right=right,up=camera_up)

def draw(kind,out,world,cam,skip=0,cleaned=1,scene=None,cap_ready=1,cleanup_dims=(238,238,265)):
 program=programs[kind];use(program);fn('glBindFramebuffer',None,[U,U])(0x8D40,out['framebuffer']);fn('glViewport',None,[I,I,I,I])(0,0,out['width'],out['height'])
 pos=fn('glGetAttribLocation',I,[U,C.c_char_p])(program,b'position');fn('glEnableVertexAttribArray',None,[U])(pos);fn('glVertexAttribPointer',None,[U,I,U,U,I,P])(pos,2,0x1406,0,0,None)
 integers={'volume':0,'capTexture':1,'cleanupTexture':2,'cleanupReady':1,'cleanupEnabled':1,'anatomyReady':0,'anatomyTexture':3,'mode':0,'palette':4,
  'clipAxis':3,'clipFlip':0,'showPlanes':0,'capReady':cap_ready,'capCleaned':cleaned,'skipCap':skip,'surfaceSmoothing':1,'accelerationTexture':4,'accelerationReady':0,'sceneTexture':5}
 for name,value in integers.items():ui(program,name,value)
 for name,value in {'fov':.32,'cameraAspect':W/H,'threshold':.28,'opacity':.8,'stepSize':.9/529,'clipPosition':.5,
  'planeDistance':np.dot(world['normal'],world['center']),'capContrast':1.65,'accelerationBlockSize':8}.items():uf(program,name,value)
 vectors={'dimensions':[475,475,530],'textureDimensions':[475,475,530],'textureOffset':[0,0,0],'cleanupDimensions':cleanup_dims,
  'anatomyDimensions':[1,1,1],'accelerationDimensions':[60,60,67],'extent':[474/529,1,474/529],
  'planeNormal':world['normal'],'capCenter':world['center'],'capRight':world['right'],'capUp':world['up'],'slicePositions':[.5,.5,.5],**cam}
 for name,value in vectors.items():u3(program,name,value)
 u2(program,'resolution',[out['width'],out['height']]);u2(program,'capSize',[world['width'],world['height']])
 if scene is not None:active(0x84C5);bind(0x0DE1,scene['texture'])
 start=time.perf_counter();fn('glDrawArrays',None,[U,I,I])(4,0,3);fn('glFinish',None,[])();elapsed=(time.perf_counter()-start)*1000
 assert fn('glGetError',U,[])()==0,(kind,'GL error')
 pixels=np.empty((out['height'],out['width'],4),np.uint8)
 fn('glReadPixels',None,[I,I,I,I,U,U,P])(0,0,out['width'],out['height'],0x1908,0x1401,pixels.ctypes.data)
 return pixels[::-1].copy(),elapsed

out_dir=ROOT/'docs/renderer-motion-v7';out_dir.mkdir(exist_ok=True)
sheet=Image.new('RGB',(W*3,(H+48)*2),'#0c1317');labels=ImageDraw.Draw(sheet);checks=[]
for row,ident in enumerate(['a4c','me4c']):
 world=frames[ident]['world'];cam=camera(world)
 cap=np.asarray(Image.open(ROOT/'public'/manifest[ident]['url']).convert('L')).copy()
 active(0x84C1);bind(0x0DE1,scope['texcap']);t2(0x0DE1,0,0x8229,cap.shape[1],cap.shape[0],0,0x1903,0x1401,cap.ctypes.data)
 # Warm the shader paths before recording the small offscreen timing sample.
 draw('volume',outputs['reference'],world,cam);draw('volume',low,world,cam,skip=1);draw('composite',outputs['composite'],world,cam,scene=low)
 reference,idle_ms=draw('volume',outputs['reference'],world,cam)
 _,old_motion_ms=draw('volume',low,world,cam,skip=0)
 legacy,_=draw('composite',outputs['legacy'],world,cam,scene=low,cap_ready=0)
 _,volume_ms=draw('volume',low,world,cam,skip=1)
 moving,cap_ms=draw('composite',outputs['composite'],world,cam,scene=low)
 mask_image,_=draw('composite',outputs['mask'],world,cam,scene=black)
 mask=np.max(mask_image[:,:,:3],axis=2)>0;assert int(mask.sum())>10000,(ident,'no useful cap coverage')
 diff=np.abs(moving.astype(np.int16)-reference.astype(np.int16))[:,:,:3][mask]
 legacy_diff=np.abs(legacy.astype(np.int16)-reference.astype(np.int16))[:,:,:3][mask]
 assert int(diff.max())<=1,(ident,'motion cap differs from full-resolution reference',int(diff.max()))
 assert float(legacy_diff.mean())>float(diff.mean())+.5,(ident,'fixture did not expose the old resolution loss')
 # A cap already cleaned at source resolution must survive an empty coarse mask.
 scope['texture3'](2,np.zeros((1,1,1),np.uint8))
 clean_image,_=draw('composite',outputs['provenance'],world,cam,scene=black,cleaned=1,cleanup_dims=(1,1,1))
 assert np.array_equal(clean_image,mask_image)
 erased,_=draw('composite',outputs['provenance'],world,cam,scene=black,cleaned=0,cleanup_dims=(1,1,1))
 assert not np.any(erased[:,:,:3])
 ordinary_clean,_=draw('volume',outputs['provenance'],world,cam,cleaned=1,cleanup_dims=(1,1,1))
 assert np.max(np.abs(ordinary_clean.astype(np.int16)-reference.astype(np.int16))[:,:,:3][mask])<=1
 scope['texture3'](2,scope['cleanup'])
 # Viewed from the retained side, the clipping plane is behind surfaces and must not paint over them.
 backside,_=draw('composite',outputs['provenance'],world,camera(world,-1),scene=black)
 assert not np.any(backside[:,:,:3]),(ident,'backside cap incorrectly overlaid')
 for column,(title,image) in enumerate([('Idle / full source sampling',reference),('Previous motion: whole image reduced',legacy),('New motion: full-resolution cut face',moving)]):
  x,y=column*W,row*(H+48);sheet.paste(Image.fromarray(image).convert('RGB'),(x,y+48));labels.text((x+12,y+9),ident.upper()+' | '+title,fill='#e9e4da')
  labels.text((x+12,y+27),f'{W} x {H} output; moving volume {VW} x {VH}',fill='#91a6ad')
 checks.append({'preset':ident,'capTexturePixels':[int(cap.shape[1]),int(cap.shape[0])],'verifiedCapPixels':int(mask.sum()),
  'capDifferenceFromIdle':{'maxChannelDifference':int(diff.max()),'meanAbsoluteChannelDifference':float(diff.mean())},
  'previousReducedCanvasCapMeanDifference':float(legacy_diff.mean()),'fineCleanupProvenancePass':True,'backsideOcclusionPass':True,'glError':0,
  'softwareTimingMs':{'idleFull':idle_ms,'previousMotionVolume':old_motion_ms,'newMotionVolume':volume_ms,'newMotionComposite':cap_ms,'newMotionTotal':volume_ms+cap_ms}})
 print(json.dumps(checks[-1]),flush=True)
sheet.save(out_dir/'cut-face-motion-comparison.jpg',quality=94)
report={'passed':True,'driver':scope['driver'],'outputPixels':[W,H],'movingVolumePixels':[VW,VH],'checks':checks,
 'scope':'Actual production GLSL, measured Echo images and original scalar volume in native offscreen EGL. The software-driver timing sample is not a browser FPS measurement.'}
(out_dir/'shader-validation.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'passed':True,'checks':len(checks),'report':str(out_dir/'shader-validation.json')}),flush=True)
