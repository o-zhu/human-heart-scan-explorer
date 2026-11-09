"""Offscreen visual QA of the actual flow module camera/cap frames and GLSL.
Uses the EGL setup from render-v5-benchmark.py; images are evidence of source
registration and framing, not browser performance measurements.
"""
from pathlib import Path
import ctypes as C, gzip, json, re, time, statistics, sys, hashlib
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[1]
OUT=Path('/workspace/data/heart-render-v5');OUT.mkdir(exist_ok=True)
E=C.CDLL('libEGL.so.1');P=C.c_void_p;I=C.c_int;U=C.c_uint;F=C.c_float
E.eglGetProcAddress.argtypes=[C.c_char_p];E.eglGetProcAddress.restype=P
get_display=C.CFUNCTYPE(P,U,P,C.POINTER(I))(E.eglGetProcAddress(b'eglGetPlatformDisplayEXT'))
display=get_display(0x31DD,None,None)
E.eglInitialize.argtypes=[P,C.POINTER(I),C.POINTER(I)];E.eglInitialize.restype=U
major,minor=I(),I();assert E.eglInitialize(display,C.byref(major),C.byref(minor))
E.eglBindAPI.argtypes=[U];E.eglBindAPI.restype=U;assert E.eglBindAPI(0x30A0)
attrs=(I*9)(0x3033,1,0x3040,0x40,0x3024,8,0x3023,8,0x3038)
E.eglChooseConfig.argtypes=[P,C.POINTER(I),C.POINTER(P),I,C.POINTER(I)];E.eglChooseConfig.restype=U
config,n=P(),I();assert E.eglChooseConfig(display,attrs,C.byref(config),1,C.byref(n)) and n.value
E.eglCreateContext.argtypes=[P,P,P,C.POINTER(I)];E.eglCreateContext.restype=P
context=E.eglCreateContext(display,config,None,(I*3)(0x3098,3,0x3038));assert context
E.eglMakeCurrent.argtypes=[P,P,P,P];E.eglMakeCurrent.restype=U;assert E.eglMakeCurrent(display,None,None,context)
def fn(name,restype,args):return C.CFUNCTYPE(restype,*args)(E.eglGetProcAddress(name.encode()))
create=fn('glCreateShader',U,[U]);source=fn('glShaderSource',None,[U,I,C.POINTER(C.c_char_p),C.POINTER(I)]);compile_shader=fn('glCompileShader',None,[U]);getiv=fn('glGetShaderiv',None,[U,U,C.POINTER(I)]);getlog=fn('glGetShaderInfoLog',None,[U,I,C.POINTER(I),C.c_char_p])
def program(path):
 text=path.read_text();shaders=[]
 for name,kind in [('vertexSource',0x8B31),('fragmentSource',0x8B30)]:
  src=re.search(r'const '+name+r' = `([\s\S]*?)`;',text).group(1).encode();s=create(kind);ptr=C.c_char_p(src);source(s,1,C.byref(ptr),None);compile_shader(s);ok=I();getiv(s,0x8B81,C.byref(ok));log=C.create_string_buffer(16384);getlog(s,16384,None,log);assert ok.value,log.value.decode();shaders.append(s)
 p=fn('glCreateProgram',U,[])()
 for s in shaders:fn('glAttachShader',None,[U,U])(p,s)
 fn('glLinkProgram',None,[U])(p);ok=I();fn('glGetProgramiv',None,[U,U,C.POINTER(I)])(p,0x8B82,C.byref(ok));assert ok.value
 return p
programs={'after':program(ROOT/'public/renderer.js')}
driver=fn('glGetString',C.c_char_p,[U])(0x1F01).decode()
use=fn('glUseProgram',None,[U]);loc=fn('glGetUniformLocation',I,[U,C.c_char_p]);u1i=fn('glUniform1i',None,[I,I]);u1f=fn('glUniform1f',None,[I,F]);u2f=fn('glUniform2f',None,[I,F,F]);u3f=fn('glUniform3f',None,[I,F,F,F])
def ui(p,n,v):u1i(loc(p,n.encode()),v)
def uf(p,n,v):u1f(loc(p,n.encode()),v)
def u2(p,n,a):u2f(loc(p,n.encode()),*a)
def u3(p,n,a):u3f(loc(p,n.encode()),*a)
gen=fn('glGenTextures',None,[I,C.POINTER(U)]);bind=fn('glBindTexture',None,[U,U]);param=fn('glTexParameteri',None,[U,U,I]);active=fn('glActiveTexture',None,[U]);fn('glPixelStorei',None,[U,I])(0x0CF5,1)
t3=fn('glTexImage3D',None,[U,I,I,I,I,I,I,U,U,P]);t2=fn('glTexImage2D',None,[U,I,I,I,I,I,U,U,P])
def texture3(slot,data,linear=False):
 tex=U();gen(1,C.byref(tex));active(0x84C0+slot);bind(0x806F,tex);t3(0x806F,0,0x8229,*data.shape[::-1],0,0x1903,0x1401,data.ctypes.data)
 for k,v in [(0x2801,0x2601 if linear else 0x2600),(0x2800,0x2601 if linear else 0x2600),(0x2802,0x812F),(0x2803,0x812F),(0x8072,0x812F)]:param(0x806F,k,v)
 return tex
data=np.load(OUT/'original-u8.npy',mmap_mode='r');volume_texture=texture3(0,data,True)
cleanup=np.frombuffer(gzip.decompress((ROOT/'public/assets/cleanup/heart-support.raw.gz').read_bytes()),np.uint8).reshape(265,238,238).copy();texture3(2,cleanup)
texture3(3,np.zeros((1,1,1),np.uint8))
maxima=np.fromfile(OUT/'maxima.raw',np.uint8).reshape(67,60,60);texture3(4,maxima)

REPORT=ROOT/'docs';RESULT=Path('/workspace/data/flow-views-v5');RESULT.mkdir(exist_ok=True)
meta=json.loads((ROOT/'public/assets/flow-views-v5.json').read_text())
texcap=U();gen(1,C.byref(texcap));active(0x84C1);bind(0x0DE1,texcap)
for k,v in [(0x2801,0x2601),(0x2800,0x2601),(0x2802,0x812F),(0x2803,0x812F)]:param(0x0DE1,k,v)
output=U();gen(1,C.byref(output));active(0x84C5);bind(0x0DE1,output)
for k,v in [(0x2801,0x2601),(0x2800,0x2601)]:param(0x0DE1,k,v)
fbo=U();fn('glGenFramebuffers',None,[I,C.POINTER(U)])(1,C.byref(fbo));fn('glBindFramebuffer',None,[U,U])(0x8D40,fbo);fn('glFramebufferTexture2D',None,[U,U,U,U,I])(0x8D40,0x8CE0,0x0DE1,output,0)
buf=U();fn('glGenBuffers',None,[I,C.POINTER(U)])(1,C.byref(buf));fn('glBindBuffer',None,[U,U])(0x8892,buf)
verts=np.array([-1,-1,3,-1,-1,3],np.float32);fn('glBufferData',None,[U,C.c_ssize_t,P,U])(0x8892,verts.nbytes,verts.ctypes.data,0x88E4)
def norm(v):return np.asarray(v)/np.linalg.norm(v)
def render_flow(preset,close=False,moving=0,w=520,h=590):
 world=preset['world'];side=-1 if preset['flip'] else 1
 normal=np.array(world['normal']);r=np.array(world['right']);u=np.array(world['up']);target=np.array(world['target'])
 direction=norm(normal*side+r*.24*side+u*.10)
 camera_up=norm(u-direction*np.dot(direction,u));forward=-direction;right=norm(np.cross(forward,camera_up));camera_up=norm(np.cross(right,forward))
 eye=target+direction*preset['closeDistance' if close else 'cameraDistance']
 cap=np.asarray(Image.open(ROOT/'public'/preset['texture']['url']).convert('L')).copy()
 active(0x84C1);bind(0x0DE1,texcap);t2(0x0DE1,0,0x8229,cap.shape[1],cap.shape[0],0,0x1903,0x1401,cap.ctypes.data)
 p=programs['after'];use(p);pos=fn('glGetAttribLocation',I,[U,C.c_char_p])(p,b'position');fn('glEnableVertexAttribArray',None,[U])(pos);fn('glVertexAttribPointer',None,[U,I,U,U,I,P])(pos,2,0x1406,0,0,None)
 active(0x84C5);bind(0x0DE1,output);t2(0x0DE1,0,0x8058,w,h,0,0x1908,0x1401,None);assert fn('glCheckFramebufferStatus',U,[U])(0x8D40)==0x8CD5
 ints={'volume':0,'capTexture':1,'cleanupTexture':2,'cleanupReady':1,'cleanupEnabled':1,'anatomyReady':0,'anatomyTexture':3,'mode':0,'palette':4,'clipAxis':3,'clipFlip':int(preset['flip']),'showPlanes':0,'moving':moving,'capReady':1,'surfaceSmoothing':1,'accelerationTexture':4,'accelerationReady':1}
 for name,value in ints.items():ui(p,name,value)
 floats={'fov':.32,'threshold':preset['threshold'],'opacity':.8,'stepSize':.9/529,'clipPosition':.5,'planeDistance':np.dot(normal*side,world['center']),'capContrast':1.65,'accelerationBlockSize':8}
 for name,value in floats.items():uf(p,name,value)
 vectors={'dimensions':[475,475,530],'textureDimensions':[475,475,530],'textureOffset':[0,0,0],'cleanupDimensions':[238,238,265],'anatomyDimensions':[1,1,1],'accelerationDimensions':[60,60,67],'extent':[474/529,1,474/529],'eye':eye,'forward':forward,'right':right,'up':camera_up,'planeNormal':normal*side,'capCenter':world['center'],'capRight':r,'capUp':u,'slicePositions':[.5,.5,.5]}
 for name,value in vectors.items():u3(p,name,value)
 u2(p,'resolution',[w,h]);u2(p,'capSize',[world['width'],world['height']]);fn('glViewport',None,[I,I,I,I])(0,0,w,h)
 fn('glDrawArrays',None,[U,I,I])(4,0,3);fn('glFinish',None,[])()
 result=np.empty((h,w,4),np.uint8);fn('glReadPixels',None,[I,I,I,I,U,U,P])(0,0,w,h,0x1908,0x1401,result.ctypes.data);assert fn('glGetError',U,[])()==0
 return result[::-1].copy()
results={'driver':driver,'shaderSha256':hashlib.sha256((ROOT/'public/renderer.js').read_bytes()).hexdigest(),'dimensions':[520,590],'palette':'Tissue / space','smoothing':'Gentle','renderedPresets':[],'limitation':'Offscreen software EGL images verify actual GLSL framing; these are not browser speed measurements.'}
for item in meta['presets']:
 image=render_flow(item);Image.fromarray(image).save(RESULT/(item['id']+'-gpu.png'))
 changed=int((np.max(image[:,:,:3],axis=2)>40).sum());assert changed>1000,(item['id'],'empty view')
 results['renderedPresets'].append({'id':item['id'],'nonBackgroundPixels':changed,'glError':0})
 print(item['id'],changed,flush=True)
for ident in ['rv-outflow','lv-outflow']:
 item=next(p for p in meta['presets'] if p['id']==ident);a=render_flow(item,True);b=render_flow(item,True,moving=1);assert np.array_equal(a,b)
 Image.fromarray(a).save(RESULT/(ident+'-gpu-close.png'));results.setdefault('closeViewChecks',[]).append({'id':ident,'sameGridMotionIdentical':True,'glError':0})
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',20)
small=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',13)
sheet=Image.new('RGB',(4*520,2*650),'#0c1317');draw=ImageDraw.Draw(sheet)
for index,item in enumerate(meta['presets']):
 x=(index%4)*520;y=(index//4)*650;sheet.paste(Image.open(RESULT/(item['id']+'-gpu.png')).convert('RGB'),(x,y+55));draw.text((x+14,y+9),item['title']+' · '+item['subtitle'],font=font,fill='#eee8dd');draw.text((x+14,y+35),'Actual GLSL · 317.6 µm volume + 79.4 µm cut face',font=small,fill='#9caaad')
sheet.save(REPORT/'flow-views-gpu-review-v5.jpg',quality=93)
(REPORT/'flow-views-gpu-validation-v5.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results),flush=True)
