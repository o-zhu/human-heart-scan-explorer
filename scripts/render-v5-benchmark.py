"""Render the actual GLSL in EGL; compare motion, acceleration and normal methods.

This is a shader/software-driver benchmark, not a user's browser FPS estimate.
The source display volume is retained outside the checkout for this test run.
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
programs={'before':program(OUT/'renderer-before.js'),'after':program(ROOT/'public/renderer.js')}
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
level=json.loads((ROOT/'public/assets/manifest.json').read_text())['levels']['high']
clean=np.frombuffer(gzip.decompress((ROOT/'public'/level['parts'][0]['url']).read_bytes()),np.uint8).reshape(530,475,475).copy()
assert level['parts'][0].get('predictor')=='delta-z'
for z in range(1,len(clean)):clean[z]+=clean[z-1]
assert hashlib.sha256(clean).hexdigest()==level['parts'][0]['rawSha256']
bounds=level['supportCompression']['boundsXYZ'];offset_crop=[max(0,b[0]-1) for b in bounds];end_crop=[min(d,b[1]+2) for d,b in zip([475,475,530],bounds)]
crop3=clean[offset_crop[2]:end_crop[2],offset_crop[1]:end_crop[1],offset_crop[0]:end_crop[0]].copy()
volumes={'original':(data,[0,0,0]),'full-clean':(clean,[0,0,0]),'crop-clean':(crop3,offset_crop)};loaded_volume='original'
cleanup=np.frombuffer(gzip.decompress((ROOT/'public/assets/cleanup/heart-support.raw.gz').read_bytes()),np.uint8).reshape(265,238,238).copy();texture3(2,cleanup)
texture3(3,np.zeros((1,1,1),np.uint8))
maxima=np.fromfile(OUT/'maxima.raw',np.uint8).reshape(67,60,60);texture3(4,maxima)
record=json.loads((ROOT/'public/assets/ultra-sections/manifest.json').read_text())['slices']['x'][237]
cap=np.asarray(Image.open(ROOT/'data/ultra-sections'/record['path']).convert('L')).copy()
texcap=U();gen(1,C.byref(texcap));active(0x84C1);bind(0x0DE1,texcap);t2(0x0DE1,0,0x8229,cap.shape[1],cap.shape[0],0,0x1903,0x1401,cap.ctypes.data)
for k,v in [(0x2801,0x2601),(0x2800,0x2601),(0x2802,0x812F),(0x2803,0x812F)]:param(0x0DE1,k,v)
output=U();gen(1,C.byref(output));active(0x84C5);bind(0x0DE1,output)
for k,v in [(0x2801,0x2601),(0x2800,0x2601)]:param(0x0DE1,k,v)
fbo=U();fn('glGenFramebuffers',None,[I,C.POINTER(U)])(1,C.byref(fbo));fn('glBindFramebuffer',None,[U,U])(0x8D40,fbo);fn('glFramebufferTexture2D',None,[U,U,U,U,I])(0x8D40,0x8CE0,0x0DE1,output,0)
buf=U();fn('glGenBuffers',None,[I,C.POINTER(U)])(1,C.byref(buf));fn('glBindBuffer',None,[U,U])(0x8892,buf)
verts=np.array([-1,-1,3,-1,-1,3],np.float32);fn('glBufferData',None,[U,C.c_ssize_t,P,U])(0x8892,verts.nbytes,verts.ctypes.data,0x88E4)
e=[474/529,1,474/529];offset=np.array([-1.,-.07,.35]);offset/=np.linalg.norm(offset)
forward=-offset;right=np.cross(forward,[0,1,0]);right=-right/np.linalg.norm(right);up=np.cross(right,forward)
pan=np.array([0,-.14,0]);eye=offset*(.59 if '--closeup' in sys.argv else 1.1)+pan
x0,y0,cw,ch=record['crop'];cu=(x0+(cw-1)/2)/1896;cv=(y0+(ch-1)/2)/2116
def render(which='after',smooth=1,moving=0,accelerated=True,w=700,h=595,step=None,cut=True,volume='original'):
 global loaded_volume
 voxels,voxel_offset=volumes[volume]
 if loaded_volume!=volume:
  active(0x84C0);bind(0x806F,volume_texture);t3(0x806F,0,0x8229,*voxels.shape[::-1],0,0x1903,0x1401,voxels.ctypes.data);loaded_volume=volume
 p=programs[which];use(p);pos=fn('glGetAttribLocation',I,[U,C.c_char_p])(p,b'position');fn('glEnableVertexAttribArray',None,[U])(pos);fn('glVertexAttribPointer',None,[U,I,U,U,I,P])(pos,2,0x1406,0,0,None)
 active(0x84C5);bind(0x0DE1,output);t2(0x0DE1,0,0x8058,w,h,0,0x1908,0x1401,None);assert fn('glCheckFramebufferStatus',U,[U])(0x8D40)==0x8CD5
 ints={'volume':0,'capTexture':1,'cleanupTexture':2,'cleanupReady':1,'cleanupEnabled':1,'anatomyReady':0,'anatomyTexture':3,'mode':0,'palette':4,'clipAxis':0 if cut else -1,'clipFlip':1,'showPlanes':0,'moving':moving,'capReady':1 if cut else 0,'surfaceSmoothing':smooth,'accelerationTexture':4,'accelerationReady':int(accelerated)}
 for n,v in ints.items():ui(p,n,v)
 floats={'fov':.32,'threshold':.28,'opacity':.8,'stepSize':step or .9/529,'clipPosition':.5,'planeDistance':0,'capContrast':1.8,'accelerationBlockSize':8}
 for n,v in floats.items():uf(p,n,v)
 vectors={'dimensions':[475,475,530],'textureDimensions':voxels.shape[::-1],'textureOffset':voxel_offset,'cleanupDimensions':[238,238,265],'anatomyDimensions':[1,1,1],'accelerationDimensions':[60,60,67],'extent':e,'eye':eye,'forward':forward,'right':right,'up':up,'planeNormal':[-1,0,0],'capCenter':[0,(cv-.5)*e[1],(.5-cu)*e[2]],'capRight':[0,0,-1],'capUp':[0,-1,0],'slicePositions':[.5,.5,.5]}
 for n,v in vectors.items():u3(p,n,v)
 u2(p,'resolution',[w,h]);u2(p,'capSize',[e[2]*(cw-1)/1896,e[1]*(ch-1)/2116])
 fn('glViewport',None,[I,I,I,I])(0,0,w,h)
 start=time.perf_counter();fn('glDrawArrays',None,[U,I,I])(4,0,3);fn('glFinish',None,[])();elapsed=(time.perf_counter()-start)*1000
 out=np.empty((h,w,4),np.uint8);fn('glReadPixels',None,[I,I,I,I,U,U,P])(0,0,w,h,0x1908,0x1401,out.ctypes.data);assert fn('glGetError',U,[])()==0
 return out[::-1].copy(),elapsed
results={'driver':driver,'sameGrid':{},'timings':{},'textureCrop':{}}
prefix='close-' if '--closeup' in sys.argv else ''
for name,args in [('previous-idle',{'which':'before','moving':0}),('previous-moving',{'which':'before','moving':1}),('normals-source',{'smooth':0}),('normals-cubic',{'smooth':1}),('normals-gaussian',{'smooth':2})]:
 image,elapsed=render(**args);Image.fromarray(image).save(OUT/(prefix+name+'.png'));print(name,round(elapsed,2),'ms',flush=True)
a,_=render(w=480,h=408,accelerated=False);b,_=render(w=480,h=408,accelerated=True);c,_=render(w=480,h=408,moving=1)
for key,image in [('acceleration',b),('motion',c)]:
 diff=np.abs(a.astype(np.int16)-image.astype(np.int16));results['sameGrid'][key]={'identical':bool(np.array_equal(a,image)),'max':int(diff.max()),'mean':float(diff.mean()),'changedPixels':int((diff!=0).any(axis=2).sum())};assert np.array_equal(a,image),(key,results['sameGrid'][key])
for smoothing in [0,1,2]:
 original,_=render(w=480,h=408,smooth=smoothing,volume='original');full,_=render(w=480,h=408,smooth=smoothing,volume='full-clean');cropped,_=render(w=480,h=408,smooth=smoothing,volume='crop-clean')
 for key,image in [('guarded-clean',full),('gpu-crop',cropped)]:
  diff=np.abs(original.astype(np.int16)-image.astype(np.int16));results['textureCrop'][key+'-smoothing-'+str(smoothing)]={'identical':bool(np.array_equal(original,image)),'max':int(diff.max()),'mean':float(diff.mean()),'changedPixels':int((diff!=0).any(axis=2).sum()),'pixelsAbove2':int((diff>2).any(axis=2).sum())}
  if key=='guarded-clean':assert np.array_equal(original,image),results['textureCrop'][key+'-smoothing-'+str(smoothing)]
for cut in [True,False]:
 for accelerated in [False,True]:
  timings=[]
  for trial in range(4):
   _,elapsed=render(w=480,h=408,accelerated=accelerated,cut=cut)
   if trial:timings.append(elapsed)
  results['timings'][('cut' if cut else 'whole')+('-skip' if accelerated else '-full')]=dict(medianMs=statistics.median(timings),trialsMs=timings,pixels=480*408)
print(json.dumps(results),flush=True)
(OUT/(prefix+'gpu-validation.json')).write_text(json.dumps(results,indent=2)+'\n')
names=['previous-idle','normals-cubic','normals-gaussian'];titles=['Previous surface lighting','Gentle · cubic normals','Smooth · Gaussian normals']
sheet=Image.new('RGB',(2100,650),'#10171b');draw=ImageDraw.Draw(sheet)
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',18)
for i,(name,title) in enumerate(zip(names,titles)):
 sheet.paste(Image.open(OUT/(prefix+name+'.png')).convert('RGB'),(700*i,42));draw.text((700*i+16,14),title,fill='#e4e9e9',font=font)
sheet.save(OUT/(prefix+'normal-comparison.jpg'),quality=94)
