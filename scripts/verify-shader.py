from pathlib import Path
import ctypes as C,re,json
E=C.CDLL('libEGL.so.1');P=C.c_void_p;I=C.c_int;U=C.c_uint
E.eglGetProcAddress.argtypes=[C.c_char_p];E.eglGetProcAddress.restype=P
getDisplay=C.CFUNCTYPE(P,U,P,C.POINTER(I))(E.eglGetProcAddress(b'eglGetPlatformDisplayEXT'))
display=getDisplay(0x31DD,None,None)
E.eglInitialize.argtypes=[P,C.POINTER(I),C.POINTER(I)];E.eglInitialize.restype=U
major,minor=I(),I();assert E.eglInitialize(display,C.byref(major),C.byref(minor)), 'EGL init unavailable'
E.eglBindAPI.argtypes=[U];E.eglBindAPI.restype=U;assert E.eglBindAPI(0x30A0)
attrs=(I*9)(0x3033,1,0x3040,0x40,0x3024,8,0x3023,8,0x3038)
E.eglChooseConfig.argtypes=[P,C.POINTER(I),C.POINTER(P),I,C.POINTER(I)];E.eglChooseConfig.restype=U
config,n=P(),I();assert E.eglChooseConfig(display,attrs,C.byref(config),1,C.byref(n)) and n.value
E.eglCreateContext.argtypes=[P,P,P,C.POINTER(I)];E.eglCreateContext.restype=P
context=E.eglCreateContext(display,config,None,(I*3)(0x3098,3,0x3038));assert context,'ES3 context unavailable'
E.eglMakeCurrent.argtypes=[P,P,P,P];E.eglMakeCurrent.restype=U;assert E.eglMakeCurrent(display,None,None,context)
def fn(name,restype,args):return C.CFUNCTYPE(restype,*args)(E.eglGetProcAddress(name.encode()))
create=fn('glCreateShader',U,[U]);source=fn('glShaderSource',None,[U,I,C.POINTER(C.c_char_p),C.POINTER(I)]);compile=fn('glCompileShader',None,[U]);getiv=fn('glGetShaderiv',None,[U,U,C.POINTER(I)]);getlog=fn('glGetShaderInfoLog',None,[U,I,C.POINTER(I),C.c_char_p])
text=(Path(__file__).resolve().parents[1]/'public/renderer.js').read_text();shaders=[];results=[]
for name,kind in [('vertexSource',0x8B31),('fragmentSource',0x8B30)]:
 src=re.search(r'const '+name+r' = `([\s\S]*?)`;',text).group(1).encode();s=create(kind);ptr=C.c_char_p(src);source(s,1,C.byref(ptr),None);compile(s);ok=I();getiv(s,0x8B81,C.byref(ok));log=C.create_string_buffer(16384);getlog(s,16384,None,log);results.append({'shader':name,'compiled':bool(ok.value),'log':log.value.decode()});assert ok.value,results;shaders.append(s)
createp=fn('glCreateProgram',U,[]);attach=fn('glAttachShader',None,[U,U]);link=fn('glLinkProgram',None,[U]);getp=fn('glGetProgramiv',None,[U,U,C.POINTER(I)]);p=createp()
for s in shaders:attach(p,s)
link(p);ok=I();getp(p,0x8B82,C.byref(ok));assert ok.value,'Program link failed';print(json.dumps({'EGL':[major.value,minor.value],'shaders':results,'linked':True}))
