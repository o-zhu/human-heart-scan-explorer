"""Small surfaceless EGL renderer for actual scientific triangle comparisons.

Uses the same Mesa/EGL path as the project's native rendering audits. It has no
X server dependency and does not claim to be a browser screenshot.
"""
import ctypes as C
import numpy as np


class SurfaceRenderer:
    def __init__(self,width=800,height=650):
        self.width,self.height=width,height
        self.E=C.CDLL('libEGL.so.1');self.P,self.I,self.U,self.F=C.c_void_p,C.c_int,C.c_uint,C.c_float
        E=self.E;P,I,U,F=self.P,self.I,self.U,self.F
        E.eglGetProcAddress.argtypes=[C.c_char_p];E.eglGetProcAddress.restype=P
        get_display=C.CFUNCTYPE(P,U,P,C.POINTER(I))(E.eglGetProcAddress(b'eglGetPlatformDisplayEXT'))
        self.display=get_display(0x31DD,None,None)
        E.eglInitialize.argtypes=[P,C.POINTER(I),C.POINTER(I)];E.eglInitialize.restype=U
        major,minor=I(),I();assert E.eglInitialize(self.display,C.byref(major),C.byref(minor))
        E.eglBindAPI.argtypes=[U];E.eglBindAPI.restype=U;assert E.eglBindAPI(0x30A0)
        attrs=(I*9)(0x3033,1,0x3040,0x40,0x3024,8,0x3023,8,0x3038)
        E.eglChooseConfig.argtypes=[P,C.POINTER(I),C.POINTER(P),I,C.POINTER(I)];E.eglChooseConfig.restype=U
        config,n=P(),I();assert E.eglChooseConfig(self.display,attrs,C.byref(config),1,C.byref(n)) and n.value
        E.eglCreateContext.argtypes=[P,P,P,C.POINTER(I)];E.eglCreateContext.restype=P
        self.context=E.eglCreateContext(self.display,config,None,(I*3)(0x3098,3,0x3038))
        E.eglMakeCurrent.argtypes=[P,P,P,P];E.eglMakeCurrent.restype=U
        assert self.context and E.eglMakeCurrent(self.display,None,None,self.context)
        vertex='''#version 300 es
precision highp float;
layout(location=0)in vec3 p;layout(location=1)in vec3 n;
uniform vec3 right,up,direction;uniform float aspect;
out vec3 normal;out vec3 point;
void main(){normal=n;point=p;
 gl_Position=vec4(dot(p,right)/(.82*aspect),dot(p,up)/.82,-dot(p,direction)*.5,1.);
}'''
        fragment='''#version 300 es
precision highp float;
in vec3 normal;in vec3 point;uniform vec3 direction;uniform float clipZ;
out vec4 fragColor;
void main(){if(point.z>clipZ)discard;vec3 n=normalize(normal);if(!gl_FrontFacing)n=-n;
 vec3 l=normalize(direction+vec3(-.45,.25,.7));
 float diffuse=max(dot(n,l),0.);float fill=max(dot(n,normalize(vec3(-.7,-.2,.2))),0.);
 vec3 color=vec3(.80,.46,.29)*(.26+.68*diffuse+.16*fill);
 float spec=pow(max(dot(n,normalize(l+direction)),0.),30.)*.10;
 fragColor=vec4(pow(max(color+spec,vec3(0.)),vec3(.85)),1.);
}'''
        self.program=self.compile(vertex,fragment)
        self.f('glUseProgram',None,[U])(self.program)
        self.location=self.f('glGetUniformLocation',I,[U,C.c_char_p])
        direction=np.array([1.3,-1.8,.85],float);direction/=np.linalg.norm(direction)
        forward=-direction;right=np.cross(forward,[0,0,1]);right/=np.linalg.norm(right);up=np.cross(right,forward)
        for name,value in [('right',right),('up',up),('direction',direction)]:
            self.f('glUniform3f',None,[I,F,F,F])(self.location(self.program,name.encode()),*value)
        self.f('glUniform1f',None,[I,F])(self.location(self.program,b'aspect'),width/height)
        tex,fb,depth=U(),U(),U()
        self.f('glGenTextures',None,[I,C.POINTER(U)])(1,C.byref(tex));self.f('glBindTexture',None,[U,U])(0x0DE1,tex)
        self.f('glTexImage2D',None,[U,I,I,I,I,I,U,U,P])(0x0DE1,0,0x8058,width,height,0,0x1908,0x1401,None)
        for key,val in [(0x2801,0x2600),(0x2800,0x2600)]:self.f('glTexParameteri',None,[U,U,I])(0x0DE1,key,val)
        self.f('glGenFramebuffers',None,[I,C.POINTER(U)])(1,C.byref(fb));self.f('glBindFramebuffer',None,[U,U])(0x8D40,fb)
        self.f('glFramebufferTexture2D',None,[U,U,U,U,I])(0x8D40,0x8CE0,0x0DE1,tex,0)
        self.f('glGenRenderbuffers',None,[I,C.POINTER(U)])(1,C.byref(depth));self.f('glBindRenderbuffer',None,[U,U])(0x8D41,depth)
        self.f('glRenderbufferStorage',None,[U,U,I,I])(0x8D41,0x81A6,width,height)
        self.f('glFramebufferRenderbuffer',None,[U,U,U,U])(0x8D40,0x8D00,0x8D41,depth)
        assert self.f('glCheckFramebufferStatus',U,[U])(0x8D40)==0x8CD5
        self.f('glViewport',None,[I,I,I,I])(0,0,width,height);self.f('glEnable',None,[U])(0x0B71)
        self.f('glDepthFunc',None,[U])(0x0203);self.f('glClearDepthf',None,[F])(1.)
        self.driver=self.f('glGetString',C.c_char_p,[U])(0x1F01).decode()

    def f(self,name,restype,args):
        return C.CFUNCTYPE(restype,*args)(self.E.eglGetProcAddress(name.encode()))

    def compile(self,vertex,fragment):
        U,I,P=self.U,self.I,self.P
        program=self.f('glCreateProgram',U,[])()
        for kind,source in [(0x8B31,vertex),(0x8B30,fragment)]:
            shader=self.f('glCreateShader',U,[U])(kind);src=C.c_char_p(source.encode())
            self.f('glShaderSource',None,[U,I,C.POINTER(C.c_char_p),P])(shader,1,C.byref(src),None)
            self.f('glCompileShader',None,[U])(shader);ok=I();text=C.create_string_buffer(32768)
            self.f('glGetShaderiv',None,[U,U,C.POINTER(I)])(shader,0x8B81,C.byref(ok))
            self.f('glGetShaderInfoLog',None,[U,I,P,C.c_char_p])(shader,32768,None,text);assert ok.value,text.value.decode()
            self.f('glAttachShader',None,[U,U])(program,shader)
        self.f('glLinkProgram',None,[U])(program);ok=I();self.f('glGetProgramiv',None,[U,U,C.POINTER(I)])(program,0x8B82,C.byref(ok));assert ok.value
        return program

    def draw(self,points,normals,faces,center,span,clip_z=1.):
        P,I,U,F=self.P,self.I,self.U,self.F
        positions=np.ascontiguousarray((points-center)/span,dtype=np.float32)
        normals=np.ascontiguousarray(normals,dtype=np.float32);indices=np.ascontiguousarray(faces,dtype=np.uint32)
        vao=U();self.f('glGenVertexArrays',None,[I,C.POINTER(U)])(1,C.byref(vao));self.f('glBindVertexArray',None,[U])(vao)
        buffers=[]
        for slot,value in enumerate([positions,normals]):
            buffer=U();self.f('glGenBuffers',None,[I,C.POINTER(U)])(1,C.byref(buffer));buffers.append(buffer)
            self.f('glBindBuffer',None,[U,U])(0x8892,buffer);self.f('glBufferData',None,[U,C.c_ssize_t,P,U])(0x8892,value.nbytes,value.ctypes.data,0x88E4)
            self.f('glEnableVertexAttribArray',None,[U])(slot);self.f('glVertexAttribPointer',None,[U,I,U,U,I,P])(slot,3,0x1406,0,0,None)
        buffer=U();self.f('glGenBuffers',None,[I,C.POINTER(U)])(1,C.byref(buffer));buffers.append(buffer)
        self.f('glBindBuffer',None,[U,U])(0x8893,buffer);self.f('glBufferData',None,[U,C.c_ssize_t,P,U])(0x8893,indices.nbytes,indices.ctypes.data,0x88E4)
        self.f('glUniform1f',None,[I,F])(self.location(self.program,b'clipZ'),clip_z)
        self.f('glClearColor',None,[F,F,F,F])(.035,.047,.058,1.);self.f('glClear',None,[U])(0x4000|0x0100)
        self.f('glDrawElements',None,[U,I,U,P])(4,indices.size,0x1405,None);self.f('glFinish',None,[])()
        result=np.empty((self.height,self.width,4),np.uint8)
        self.f('glReadPixels',None,[I,I,I,I,U,U,P])(0,0,self.width,self.height,0x1908,0x1401,result.ctypes.data)
        assert self.f('glGetError',U,[])()==0
        self.f('glBindVertexArray',None,[U])(0)
        for buffer in buffers:self.f('glDeleteBuffers',None,[I,C.POINTER(U)])(1,C.byref(buffer))
        self.f('glDeleteVertexArrays',None,[I,C.POINTER(U)])(1,C.byref(vao))
        return result[::-1,:,:3].copy()
