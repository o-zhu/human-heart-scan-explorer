"""Render actual production probe geometry/GLSL in native EGL (no browser).
This verifies geometry and shader output, not page layout or browser performance.
"""
from pathlib import Path
import ctypes as C, gzip, hashlib, json, re, subprocess
import numpy as np
from PIL import Image, ImageDraw
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'docs/probe-lab-v12';OUT.mkdir(exist_ok=True)
# Reuse the project's native surfaceless ES3 setup; do not execute its shader test.
setup=(ROOT/'scripts/verify-shader.py').read_text().split("create=fn('glCreateShader'")[0];exec(setup)
F=C.c_float
create=fn('glCreateShader',U,[U]);source=fn('glShaderSource',None,[U,I,C.POINTER(C.c_char_p),C.POINTER(I)]);compile_shader=fn('glCompileShader',None,[U]);getiv=fn('glGetShaderiv',None,[U,U,C.POINTER(I)]);getlog=fn('glGetShaderInfoLog',None,[U,I,C.POINTER(I),C.c_char_p])
text=(ROOT/'public/probe-scene.js').read_text();shaders=[];report={'scope':'Exact probe-scene.js GLSL and geometry in native offscreen EGL; not browser layout, pointer permission, speed or clinical validation.','shaderSha256':hashlib.sha256(text.encode()).hexdigest(),'shaders':[]}
for name,kind in [('VERTEX',0x8B31),('FRAGMENT',0x8B30)]:
 src=re.search(r'const '+name+r'=`([\s\S]*?)`;',text).group(1).encode();s=create(kind);ptr=C.c_char_p(src);source(s,1,C.byref(ptr),None);compile_shader(s);ok=I();getiv(s,0x8B81,C.byref(ok));log=C.create_string_buffer(16384);getlog(s,16384,None,log);assert ok.value,log.value.decode();shaders.append(s);report['shaders'].append({'name':name,'compiled':True,'log':log.value.decode()})
p=fn('glCreateProgram',U,[])()
for s in shaders:fn('glAttachShader',None,[U,U])(p,s)
fn('glLinkProgram',None,[U])(p);ok=I();fn('glGetProgramiv',None,[U,U,C.POINTER(I)])(p,0x8B82,C.byref(ok));log=C.create_string_buffer(16384);fn('glGetProgramInfoLog',None,[U,I,C.POINTER(I),C.c_char_p])(p,16384,None,log);assert ok.value,log.value.decode()
report['driver']=fn('glGetString',C.c_char_p,[U])(0x1F01).decode();fn('glUseProgram',None,[U])(p)
loc=fn('glGetUniformLocation',I,[U,C.c_char_p]);u1=fn('glUniform1f',None,[I,F]);u3=fn('glUniform3f',None,[I,F,F,F]);u4=fn('glUniform4f',None,[I,F,F,F,F]);um=fn('glUniformMatrix4fv',None,[I,I,U,P])
manifest=json.loads((ROOT/'public/assets/probe-context-v11/manifest.json').read_text());binary=gzip.decompress((ROOT/'public/assets/probe-context-v11'/manifest['dataFile']).read_bytes())
js="""import {createProbeMeshes,probeModelMatrix,probeDisplayScale,referenceTorsoPose,referenceTorsoCamera,REFERENCE_PROBE_VISUAL_SCALE} from './public/probe-scene.js';import {sanitizeProbeState,PROBE_REFERENCE_MM} from './public/probe-geometry.js';import {readFileSync} from 'node:fs';import {gunzipSync} from 'node:zlib';const manifest=JSON.parse(readFileSync('public/assets/probe-context-v11/manifest.json','utf8')),data=gunzipSync(readFileSync('public/assets/probe-context-v11/'+manifest.dataFile)),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const m of manifest.meshes){if(m.name==='skin')continue;const a=new Float32Array(data.buffer,data.byteOffset+m.offset,m.count*6);for(let j=0;j<a.length;j+=6)for(let i=0;i<3;i++){min[i]=Math.min(min[i],a[j+i]);max[i]=Math.max(max[i],a[j+i]);}}const p={originMm:[0,0,0],right:[1,0,0],normal:[0,1,0],beam:[0,0,-1]};console.log(JSON.stringify({meshes:Object.fromEntries(['phased','tee'].map(k=>[k,createProbeMeshes(k).map(m=>({...m,vertices:Array.from(m.vertices)}))])),compact:Array.from(probeModelMatrix(p,probeDisplayScale(PROBE_REFERENCE_MM))),poses:Object.fromEntries(['apical','parasternal'].map(preset=>{const state=sanitizeProbeState({preset});return[preset,Array.from(probeModelMatrix(referenceTorsoPose(state,manifest,null),REFERENCE_PROBE_VISUAL_SCALE))];})),cameras:Object.fromEntries(['front','oblique'].map(mode=>[mode,referenceTorsoCamera(mode,380/620,{min,max})]))}));"""
scene=json.loads(subprocess.check_output(['node','--input-type=module','-e',js],cwd=ROOT))
W,H=380,620
tex=U();fn('glGenTextures',None,[I,C.POINTER(U)])(1,C.byref(tex));fn('glBindTexture',None,[U,U])(0x0DE1,tex);fn('glTexImage2D',None,[U,I,I,I,I,I,U,U,P])(0x0DE1,0,0x8058,W,H,0,0x1908,0x1401,None)
fbo=U();fn('glGenFramebuffers',None,[I,C.POINTER(U)])(1,C.byref(fbo));fn('glBindFramebuffer',None,[U,U])(0x8D40,fbo);fn('glFramebufferTexture2D',None,[U,U,U,U,I])(0x8D40,0x8CE0,0x0DE1,tex,0)
depth=U();fn('glGenRenderbuffers',None,[I,C.POINTER(U)])(1,C.byref(depth));fn('glBindRenderbuffer',None,[U,U])(0x8D41,depth);fn('glRenderbufferStorage',None,[U,U,I,I])(0x8D41,0x81A6,W,H);fn('glFramebufferRenderbuffer',None,[U,U,U,U])(0x8D40,0x8D00,0x8D41,depth)
assert fn('glCheckFramebufferStatus',U,[U])(0x8D40)==0x8CD5
pos=fn('glGetAttribLocation',I,[U,C.c_char_p])(p,b'position');nloc=fn('glGetAttribLocation',I,[U,C.c_char_p])(p,b'normal');enable=fn('glEnableVertexAttribArray',None,[U]);enable(pos);enable(nloc)
buf=U();fn('glGenBuffers',None,[I,C.POINTER(U)])(1,C.byref(buf));fn('glBindBuffer',None,[U,U])(0x8892,buf)
fn('glEnable',None,[U])(0x0B71);fn('glDepthFunc',None,[U])(0x0203);fn('glEnable',None,[U])(0x0BE2);fn('glBlendFuncSeparate',None,[U,U,U,U])(0x0302,0x0303,1,0x0303)
def norm(a):return np.array(a)/np.linalg.norm(a)
def camera(eye,target,up,ref):
 f=norm(np.array(target)-eye);r=norm(np.cross(f,up));v=norm(np.cross(r,f))
 for key,value in [('eye',np.array(eye)/ref),('forward',f),('cameraRight',r),('cameraUp',v)]:u3(loc(p,key.encode()),*value)
 u1(loc(p,b'referenceMm'),ref);u1(loc(p,b'aspect'),W/H)
def draw(a,color,alpha=1,gloss=.12,model=None):
 a=np.array(a,dtype=np.float32).reshape(-1,6);fn('glBufferData',None,[U,C.c_ssize_t,P,U])(0x8892,a.nbytes,a.ctypes.data,0x88E4);ptr=fn('glVertexAttribPointer',None,[U,I,U,U,I,P]);ptr(pos,3,0x1406,0,24,None);ptr(nloc,3,0x1406,0,24,12)
 m=np.asarray(model if model is not None else np.eye(4).ravel(),dtype=np.float32);um(loc(p,b'model'),1,0,m.ctypes.data);u4(loc(p,b'color'),*color,alpha);u1(loc(p,b'gloss'),gloss);fn('glDepthMask',None,[U])(int(alpha>.7));fn('glDrawArrays',None,[U,I,I])(4,0,len(a));fn('glDepthMask',None,[U])(1)
images=[];report['views']=[]
for mode in ['original probe','compact probe','chest front','chest oblique']:
 fn('glViewport',None,[I,I,I,I])(0,0,W,H);fn('glClearColor',None,[F,F,F,F])(.04,.075,.08,1);fn('glClear',None,[U])(0x4000|0x0100)
 if mode.endswith('probe'):
  camera([200,-300,140],[5,0,72],[0,0,1],170)
  for m in scene['meshes']['phased']:draw(m['vertices'],m['color'],gloss=m['gloss'],model=scene['compact'] if mode.startswith('compact') else None)
 else:
  basis=scene['cameras']['front' if mode.endswith('front') else 'oblique']
  for key,value in [('eye',basis['eye']),('forward',basis['forward']),('cameraRight',basis['right']),('cameraUp',basis['up'])]:u3(loc(p,key.encode()),*value)
  u1(loc(p,b'referenceMm'),400);u1(loc(p,b'aspect'),W/H)
  for m in manifest['meshes']:
   if m['name']=='skin':continue
   draw(np.frombuffer(binary,dtype='<f4',count=m['count']*6,offset=m['offset']),m['color'],m['alpha'],.08)
  for m in scene['meshes']['phased']:draw(m['vertices'],m['color'],gloss=m['gloss'],model=scene['poses']['apical'])
  for m in manifest['meshes']:
   if m['name']=='skin':draw(np.frombuffer(binary,dtype='<f4',count=m['count']*6,offset=m['offset']),m['color'],m['alpha'],.04)
 fn('glFinish',None,[])();rgba=np.zeros((H,W,4),np.uint8);fn('glReadPixels',None,[I,I,I,I,U,U,P])(0,0,W,H,0x1908,0x1401,rgba.ctypes.data);rgb=rgba[::-1,:,:3];print(mode,int(rgb.max()),int(np.count_nonzero(np.max(rgb,2)>30)));assert np.count_nonzero(np.max(rgb,2)>30)>500
 image=Image.fromarray(rgb.copy());ImageDraw.Draw(image).text((16,H-38),mode+' · production GLSL',fill='#ceddca');images.append(image);report['views'].append({'id':mode,'nonBackgroundPixels':int(np.count_nonzero(np.max(rgb,2)>70))})
report['compactProbePixelFraction']=round(report['views'][1]['nonBackgroundPixels']/report['views'][0]['nonBackgroundPixels'],4);assert report['compactProbePixelFraction']<.25
review=Image.new('RGB',(W*len(images),H));[review.paste(im,(i*W,0)) for i,im in enumerate(images)];review.save(OUT/'geometry-review.png');(OUT/'shader-verification.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
