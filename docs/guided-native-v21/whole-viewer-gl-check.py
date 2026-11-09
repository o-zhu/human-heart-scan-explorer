#!/usr/bin/env python3
"""Compile and exercise the actual Whole Native viewer shaders under Mesa EGL.

This is a bounded GLES3 scientific check, not a browser screenshot, interaction
check, anatomical validation, or FPS benchmark. It uses small known triangles
and, when present, the existing 30,000-triangle overview pilot.
"""
from __future__ import annotations
import os
os.environ.setdefault('LIBGL_ALWAYS_SOFTWARE', '1')
os.environ['LP_NUM_THREADS'] = '1'
os.environ['OPENBLAS_NUM_THREADS'] = '1'
os.environ['OMP_NUM_THREADS'] = '1'
import argparse
import ctypes as C
import gzip
import hashlib
import json
import math
from pathlib import Path
import re
import resource
import struct
import sys
import time
import numpy as np

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/native-surface-v20'))
from render_egl import SurfaceRenderer

GL=dict(TEXTURE_2D=0x0DE1,RGBA8=0x8058,RGBA32UI=0x8D70,RGBA=0x1908,RGBA_INTEGER=0x8D99,
        UNSIGNED_BYTE=0x1401,UNSIGNED_SHORT=0x1403,SHORT=0x1402,UNSIGNED_INT=0x1405,FLOAT=0x1406,
        FRAMEBUFFER=0x8D40,COLOR_ATTACHMENT0=0x8CE0,RENDERBUFFER=0x8D41,DEPTH_COMPONENT24=0x81A6,
        DEPTH_ATTACHMENT=0x8D00,FRAMEBUFFER_COMPLETE=0x8CD5,COLOR=0x1800,
        ARRAY_BUFFER=0x8892,ELEMENT_ARRAY_BUFFER=0x8893,STATIC_DRAW=0x88E4,
        COLOR_BUFFER_BIT=0x4000,DEPTH_BUFFER_BIT=0x0100,DEPTH_TEST=0x0B71,CULL_FACE=0x0B44,BLEND=0x0BE2)
sha=lambda data:hashlib.sha256(data).hexdigest()

def shaders(path):
    source=path.read_text(); result={}
    for name in ('vertex','fragment','pickFragment'):
        match=re.search(r'const\s+'+name+r'\s*=\s*`([^`]*)`;',source)
        if not match or '${' in match.group(1):raise ValueError('Shader extraction requires a literal template: '+name)
        result[name]=match.group(1)
    return result,sha(source.encode())

class CheckGL:
    def __init__(self,code,width=129,height=97):
        self.base=SurfaceRenderer(width,height)
        self.P,self.I,self.U,self.F=self.base.P,self.base.I,self.base.U,self.base.F
        self.f=self.base.f;self.width=width;self.height=height
        self.programs={name:self.compile(code['vertex'],code[name]) for name in ('fragment','pickFragment')}
        self.get_location=self.f('glGetUniformLocation',self.I,[self.U,C.c_char_p])
        self.driver={name:self.f('glGetString',C.c_char_p,[self.U])(value).decode()
                     for name,value in [('vendor',0x1F00),('renderer',0x1F01),('version',0x1F02),('shadingLanguage',0x8B8C)]}
        self.frames=[];self.meshes=[]
        self.error('initialization')
    def error(self,stage):
        value=self.f('glGetError',self.U,[])()
        if value:raise AssertionError(f'{stage}: GL error 0x{value:x}')
    def compile(self,vertex,fragment):
        U,I,P=self.U,self.I,self.P
        program=self.f('glCreateProgram',U,[])();objects=[]
        for kind,source in [(0x8B31,vertex),(0x8B30,fragment)]:
            shader=self.f('glCreateShader',U,[U])(kind);objects.append(shader);src=C.c_char_p(source.encode())
            self.f('glShaderSource',None,[U,I,C.POINTER(C.c_char_p),P])(shader,1,C.byref(src),None)
            self.f('glCompileShader',None,[U])(shader);ok=I();log=C.create_string_buffer(32768)
            self.f('glGetShaderiv',None,[U,U,C.POINTER(I)])(shader,0x8B81,C.byref(ok))
            self.f('glGetShaderInfoLog',None,[U,I,P,C.c_char_p])(shader,len(log),None,log)
            if not ok.value:raise AssertionError(log.value.decode())
            self.f('glAttachShader',None,[U,U])(program,shader)
        self.f('glLinkProgram',None,[U])(program);ok=I();log=C.create_string_buffer(32768)
        self.f('glGetProgramiv',None,[U,U,C.POINTER(I)])(program,0x8B82,C.byref(ok))
        self.f('glGetProgramInfoLog',None,[U,I,P,C.c_char_p])(program,len(log),None,log)
        if not ok.value:raise AssertionError(log.value.decode())
        for shader in objects:self.f('glDeleteShader',None,[U])(shader)
        return program
    def framebuffer(self,width,height,integer=False):
        U,I,P=self.U,self.I,self.P;texture,frame,depth=U(),U(),U()
        self.f('glGenTextures',None,[I,C.POINTER(U)])(1,C.byref(texture))
        self.f('glBindTexture',None,[U,U])(GL['TEXTURE_2D'],texture)
        self.f('glTexImage2D',None,[U,I,I,I,I,I,U,U,P])(GL['TEXTURE_2D'],0,GL['RGBA32UI'] if integer else GL['RGBA8'],width,height,0,
            GL['RGBA_INTEGER'] if integer else GL['RGBA'],GL['UNSIGNED_INT'] if integer else GL['UNSIGNED_BYTE'],None)
        for key in (0x2800,0x2801):self.f('glTexParameteri',None,[U,U,I])(GL['TEXTURE_2D'],key,0x2600)
        self.f('glGenFramebuffers',None,[I,C.POINTER(U)])(1,C.byref(frame))
        self.f('glBindFramebuffer',None,[U,U])(GL['FRAMEBUFFER'],frame)
        self.f('glFramebufferTexture2D',None,[U,U,U,U,I])(GL['FRAMEBUFFER'],GL['COLOR_ATTACHMENT0'],GL['TEXTURE_2D'],texture,0)
        self.f('glGenRenderbuffers',None,[I,C.POINTER(U)])(1,C.byref(depth))
        self.f('glBindRenderbuffer',None,[U,U])(GL['RENDERBUFFER'],depth)
        self.f('glRenderbufferStorage',None,[U,U,I,I])(GL['RENDERBUFFER'],GL['DEPTH_COMPONENT24'],width,height)
        self.f('glFramebufferRenderbuffer',None,[U,U,U,U])(GL['FRAMEBUFFER'],GL['DEPTH_ATTACHMENT'],GL['RENDERBUFFER'],depth)
        status=self.f('glCheckFramebufferStatus',U,[U])(GL['FRAMEBUFFER'])
        assert status==GL['FRAMEBUFFER_COMPLETE'],hex(status)
        result=dict(width=width,height=height,integer=integer,frame=frame,texture=texture,depth=depth)
        self.frames.append(result);self.error('framebuffer');return result
    def upload(self,positions,normals,indices,float_position=True,bounds=None):
        U,I,P=self.U,self.I,self.P
        positions=np.ascontiguousarray(positions,dtype=np.float32 if float_position else np.uint16)
        normals=np.ascontiguousarray(normals,np.int16);indices=np.ascontiguousarray(indices,np.uint32)
        vao=U();self.f('glGenVertexArrays',None,[I,C.POINTER(U)])(1,C.byref(vao));self.f('glBindVertexArray',None,[U])(vao)
        buffers=[]
        for slot,data,kind,normalized in [(0,positions,GL['FLOAT'] if float_position else GL['UNSIGNED_SHORT'],not float_position),(1,normals,GL['SHORT'],True)]:
            buffer=U();buffers.append(buffer);self.f('glGenBuffers',None,[I,C.POINTER(U)])(1,C.byref(buffer))
            self.f('glBindBuffer',None,[U,U])(GL['ARRAY_BUFFER'],buffer)
            self.f('glBufferData',None,[U,C.c_ssize_t,P,U])(GL['ARRAY_BUFFER'],data.nbytes,data.ctypes.data,GL['STATIC_DRAW'])
            self.f('glEnableVertexAttribArray',None,[U])(slot)
            self.f('glVertexAttribPointer',None,[U,I,U,U,I,P])(slot,3,kind,int(normalized),0,None)
        buffer=U();buffers.append(buffer);self.f('glGenBuffers',None,[I,C.POINTER(U)])(1,C.byref(buffer))
        self.f('glBindBuffer',None,[U,U])(GL['ELEMENT_ARRAY_BUFFER'],buffer)
        self.f('glBufferData',None,[U,C.c_ssize_t,P,U])(GL['ELEMENT_ARRAY_BUFFER'],indices.nbytes,indices.ctypes.data,GL['STATIC_DRAW'])
        self.f('glBindVertexArray',None,[U])(0)
        result=dict(vao=vao,buffers=buffers,count=indices.size,float=float_position,bounds=bounds or ([0,0,0],[1,1,1]))
        self.meshes.append(result);self.error('mesh upload');return result
    def uniforms(self,program,mesh,camera,aspect,cut):
        U,I,F=self.U,self.I,self.F;self.f('glUseProgram',None,[U])(program)
        v3={'Min':mesh['bounds'][0],'Max':mesh['bounds'][1],'Center':camera['center'],'Right':camera['right'],
            'Up':camera['up'],'View':camera['view'],'CutAxis':cut.get('axis',[1,0,0])}
        for name,value in v3.items():self.f('glUniform3f',None,[I,F,F,F])(self.get_location(program,('u'+name).encode()),*value)
        self.f('glUniform2f',None,[I,F,F])(self.get_location(program,b'uPan'),*camera.get('pan',[0,0]))
        for name,value in [('Span',camera['span']),('Aspect',aspect),('CutValue',cut.get('value',0)),('CutSign',cut.get('sign',1))]:
            self.f('glUniform1f',None,[I,F])(self.get_location(program,('u'+name).encode()),value)
        for name,value in [('FloatPosition',mesh['float']),('CutEnabled',cut.get('enabled',False))]:
            self.f('glUniform1i',None,[I,I])(self.get_location(program,('u'+name).encode()),int(value))
    def draw(self,target,meshes,camera,viewport=None,cut=None):
        U,I,F,P=self.U,self.I,self.F,self.P
        viewport=viewport or (0,0,target['width'],target['height'])
        self.f('glBindFramebuffer',None,[U,U])(GL['FRAMEBUFFER'],target['frame'])
        self.f('glViewport',None,[I,I,I,I])(*viewport)
        self.f('glEnable',None,[U])(GL['DEPTH_TEST']);self.f('glDepthFunc',None,[U])(0x0201)
        for flag in ('CULL_FACE','BLEND'):self.f('glDisable',None,[U])(GL[flag])
        self.f('glClearDepthf',None,[F])(1.)
        if target['integer']:
            self.f('glClearBufferuiv',None,[U,I,C.POINTER(U)])(GL['COLOR'],0,(U*4)(0,0,0,0))
            self.f('glClear',None,[U])(GL['DEPTH_BUFFER_BIT'])
        else:
            self.f('glClearColor',None,[F,F,F,F])(.027,.047,.060,1.)
            self.f('glClear',None,[U])(GL['COLOR_BUFFER_BIT']|GL['DEPTH_BUFFER_BIT'])
        program=self.programs['pickFragment' if target['integer'] else 'fragment']
        for mesh in meshes:
            self.uniforms(program,mesh,camera,viewport[2]/viewport[3],cut or {})
            self.f('glBindVertexArray',None,[U])(mesh['vao'])
            self.f('glDrawElements',None,[U,I,U,P])(4,mesh['count'],GL['UNSIGNED_INT'],None)
        self.f('glFinish',None,[])()
        result=np.empty((target['height'],target['width'],4),np.uint32 if target['integer'] else np.uint8)
        self.f('glReadPixels',None,[I,I,I,I,U,U,P])(0,0,target['width'],target['height'],GL['RGBA_INTEGER'] if target['integer'] else GL['RGBA'],
            GL['UNSIGNED_INT'] if target['integer'] else GL['UNSIGNED_BYTE'],result.ctypes.data)
        self.error('draw/readback');return result
    def close(self):
        U,I=self.U,self.I
        self.f('glBindVertexArray',None,[U])(0);self.f('glBindFramebuffer',None,[U,U])(GL['FRAMEBUFFER'],0)
        for mesh in self.meshes:
            for buffer in mesh['buffers']:self.f('glDeleteBuffers',None,[I,C.POINTER(U)])(1,C.byref(buffer))
            self.f('glDeleteVertexArrays',None,[I,C.POINTER(U)])(1,C.byref(mesh['vao']))
        for frame in self.frames:
            for name,kind in [('glDeleteTextures','texture'),('glDeleteFramebuffers','frame'),('glDeleteRenderbuffers','depth')]:
                self.f(name,None,[I,C.POINTER(U)])(1,C.byref(frame[kind]))
        for program in [*self.programs.values(),self.base.program]:self.f('glDeleteProgram',None,[U])(program)
        E=self.base.E;P=self.P
        E.eglMakeCurrent(self.base.display,None,None,None)
        E.eglDestroyContext.argtypes=[P,P];E.eglDestroyContext(self.base.display,self.base.context)
        E.eglTerminate.argtypes=[P];E.eglTerminate(self.base.display)

def native_to_world(point):
    p=np.asarray(point,np.float64)-[3806.5,3806.5,4239.5]
    return p[[0,2,1]]*[1,1,-1]/8479

def camera(center,span,yaw=0,pitch=0):
    return dict(center=np.asarray(center,float),span=span,right=[math.cos(yaw),0,-math.sin(yaw)],
        up=[-math.sin(pitch)*math.sin(yaw),math.cos(pitch),-math.sin(pitch)*math.cos(yaw)],
        view=[math.sin(yaw)*math.cos(pitch),math.sin(pitch),math.cos(yaw)*math.cos(pitch)],pan=[0,0])

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=Path(__file__).with_suffix('.json'))
    parser.add_argument('--pilot',type=Path,default=Path('{source-cache}/guided-native-v21/overview-pilot-proof3/assets/overview.hfm.gz'))
    parser.add_argument('--image',type=Path,default=Path(__file__).with_name('whole-viewer-gl.png'))
    args=parser.parse_args();began=time.monotonic();source=ROOT/'public/whole-native.js';code,source_hash=shaders(source)
    report=dict(schema='whole-native-gl-check-v21.2',scope='Actual shader compile/link, GLES3 raster/clip/integer-pick checks under surfaceless Mesa. Not a browser screenshot, interaction validation, FPS claim, or anatomical accuracy test.',
        source='public/whole-native.js',sourceSha256=source_hash,shaderSha256={name:sha(text.encode()) for name,text in code.items()},passed=False)
    gl=None
    try:
        gl=CheckGL(code);report['driver']=gl.driver;report['programsCompiledAndLinked']=['vertex+fragment','vertex+pickFragment']
        width,height=gl.width,gl.height
        rgba=gl.framebuffer(width,height);full_pick=gl.framebuffer(width,height,True);single_pick=gl.framebuffer(1,1,True)
        expected=np.array([4544,4032,4672],np.uint32);center=native_to_world(expected)
        points=np.array([center+[-.02,-.02,0],center+[.04,-.02,0],center+[-.02,.04,0]],np.float32)
        normals=np.tile([0,0,32767],(3,1)).astype(np.int16);indices=np.array([0,1,2],np.uint32);cam=camera(center,.12)
        mesh=gl.upload(points,normals,indices)
        image=gl.draw(rgba,[mesh],cam);background=gl.draw(rgba,[],cam);mask=np.any(image!=background,axis=2)
        assert int(mask.sum())>100
        picks=gl.draw(full_pick,[mesh],cam);assert np.array_equal(mask,picks[:,:,3]==1)
        mid=(width//2,height//2);assert picks[mid[1],mid[0]].tolist()==[*map(int,expected),1],picks[mid[1],mid[0]].tolist()
        assert picks[0,0].tolist()==[0,0,0,0]
        tests=[]
        for x,y in [(mid[0],mid[1]),(0,0),(width-1,height-1),(50,43),(74,43),(50,60),(60,53)]:
            pixel=gl.draw(single_pick,[mesh],cam,viewport=(-x,-y,width,height))[0,0]
            assert np.array_equal(pixel,picks[y,x]),(x,y,pixel,picks[y,x])
            if pixel[3]:
                world=center+np.array([(x+.5-width/2)*cam['span']/height,(y+.5-height/2)*cam['span']/height,0])
                native=np.array([world[0]*8479+3806.5,-world[2]*8479+3806.5,world[1]*8479+4239.5])
                predicted=np.clip(np.floor(native+.5),[0,0,0],[7613,7613,8479]).astype(np.uint32)
                assert np.array_equal(pixel[:3],predicted),(pixel,predicted)
            tests.append(dict(pixelXY=[x,y],integerRGBA=pixel.tolist()))
        report['picking']=dict(framebuffer='RGBA32UI + DEPTH_COMPONENT24',viewportOffsetEquivalent=True,backgroundRGBA=[0,0,0,0],
            expectedCenterNativeXYZ=expected.tolist(),centerActualRGBA=picks[mid[1],mid[0]].tolist(),samples=tests)
        quantized=np.array([[0,0,0],[65535,0,0],[0,65535,0]],np.uint16)
        quant=gl.upload(quantized,normals,indices,False,(points.min(axis=0),points.max(axis=0)))
        quant_image=gl.draw(rgba,[quant],cam);quant_picks=gl.draw(full_pick,[quant],cam)
        assert np.array_equal(image,quant_image)
        assert np.array_equal(picks,quant_picks)
        report['positionBranches']=dict(float32Rendered=True,normalizedUint16Rendered=True,identicalColorPixels=True,identicalIntegerPicks=True,visiblePixels=int(mask.sum()),centerColorRGBA=image[mid[1],mid[0]].tolist())
        cut=dict(enabled=True,axis=[1,0,0],value=float(center[0]),sign=1)
        cut_image=gl.draw(rgba,[mesh],cam,cut=cut);left=np.any(cut_image!=background,axis=2)
        left_pick=gl.draw(full_pick,[mesh],cam,cut=cut)
        cut['sign']=-1;right=np.any(gl.draw(rgba,[mesh],cam,cut=cut)!=background,axis=2)
        right_pick=gl.draw(full_pick,[mesh],cam,cut=cut)
        assert 0<int(left.sum())<int(mask.sum()) and 0<int(right.sum())<int(mask.sum())
        assert not left[:,mid[0]+1:].any() and not right[:,:mid[0]].any()
        assert np.array_equal(left|right,mask)
        clipped_pick_tests=[]
        for sign,visible,full in [(1,left,left_pick),(-1,right,right_pick)]:
            assert np.array_equal(visible,full[:,:,3]==1)
            assert not full[~visible].any(), 'Hidden or background pixels must return zero coordinates.'
            assert np.array_equal(full[visible],picks[visible])
            cut['sign']=sign
            for x,y in [(mid[0],mid[1]),(0,0),(width-1,height-1),(50,43),(74,43),(50,60),(60,53)]:
                pixel=gl.draw(single_pick,[mesh],cam,viewport=(-x,-y,width,height),cut=cut)[0,0]
                assert np.array_equal(pixel,full[y,x]),(sign,x,y,pixel,full[y,x])
                clipped_pick_tests.append(dict(sign=sign,pixelXY=[x,y],integerRGBA=pixel.tolist()))
        outside=dict(enabled=True,axis=[1,0,0],value=float(center[0]-.1),sign=1)
        assert np.array_equal(gl.draw(rgba,[mesh],cam,cut=outside),background)
        assert not gl.draw(full_pick,[mesh],cam,cut=outside).any()
        outside['value']=float(center[0]+.1);assert np.array_equal(gl.draw(rgba,[mesh],cam,cut=outside),image)
        report['clipping']=dict(unclippedPixels=int(mask.sum()),positiveSignPixels=int(left.sum()),negativeSignPixels=int(right.sum()),
            flippedUnionEqualsUnclipped=True,fullyClippedEqualsBackground=True,cutBeyondMeshPreservesImage=True,
            renderAndPickCoverageIdentical=True,hiddenPixelsPickZero=True,visibleCoordinatesUnchanged=True,
            viewportOffsetClippedSamples=clipped_pick_tests,
            pickingPolicy='The actual render and integer-pick fragments use the identical section discard rule and cut uniforms.')
        near=gl.upload(points+[0,0,.02],normals,indices)
        nearer_expected=expected.copy();nearer_expected[1]=int(np.floor(expected[1]-.02*8479+.5))
        for order in ([mesh,near],[near,mesh]):
            picked=gl.draw(single_pick,order,cam,viewport=(-mid[0],-mid[1],width,height))[0,0]
            assert picked.tolist()==[*map(int,nearer_expected),1],picked
        # A Y section removes the front surface while preserving the one behind it.
        # Both color and integer passes must reveal the same remaining geometry.
        remove_front=dict(enabled=True,axis=[0,0,-1],value=-float(center[2])-.01,sign=-1)
        for order in ([mesh,near],[near,mesh]):
            assert np.array_equal(gl.draw(rgba,order,cam,cut=remove_front),image)
            assert np.array_equal(gl.draw(full_pick,order,cam,cut=remove_front),picks)
            picked=gl.draw(single_pick,order,cam,viewport=(-mid[0],-mid[1],width,height),cut=remove_front)[0,0]
            assert picked.tolist()==[*map(int,expected),1],picked
        report['depthPicking']=dict(drawOrderIndependent=True,nearerNativeXYZ=nearer_expected.tolist(),
            clippedFrontRevealsRearColorAndPick=True,clippedNativeAxis='Y',remainingNativeXYZ=expected.tolist(),
            clippedOnePixelPickDrawOrderIndependent=True)
        if args.pilot.exists():
            encoded=args.pilot.read_bytes()
            with gzip.open(args.pilot,'rb') as f:decoded=f.read(8*1024**2+1)
            assert len(decoded)<=8*1024**2,'Pilot exceeds this bounded check.'
            h=struct.unpack('<8I',decoded[:32]);assert h[0:2]==(0x314d4648,1) and h[7]==1
            vertices,index_count,po,no,io=h[2:7];assert io+index_count*4==len(decoded)
            p=np.frombuffer(decoded,'<f4',vertices*3,po).reshape(-1,3);n=np.frombuffer(decoded,'<i2',vertices*3,no).reshape(-1,3)
            faces=np.frombuffer(decoded,'<u4',index_count,io);assert np.isfinite(p).all() and faces.max()<vertices
            actual=gl.upload(p,n,faces);actual_center=(p.min(axis=0)+p.max(axis=0))*.5;span=float(np.max(np.ptp(p,axis=0))*1.65)
            picture_frame=gl.framebuffer(320,240);picture=gl.draw(picture_frame,[actual],camera(actual_center,span,.48,.28))
            blank=gl.draw(picture_frame,[],camera(actual_center,span,.48,.28));visible=int(np.any(picture!=blank,axis=2).sum());assert visible>100
            from PIL import Image
            args.image.parent.mkdir(parents=True,exist_ok=True);Image.fromarray(picture[::-1,:,:3]).save(args.image)
            report['actualHfmPilot']=dict(path=str(args.pilot),compressedSha256=sha(encoded),decodedSha256=sha(decoded),vertices=vertices,
                triangles=index_count//3,floatPositionBranch=True,visiblePixels=visible,width=320,height=240,image=str(args.image),imageSha256=sha(args.image.read_bytes()))
        else:report['actualHfmPilot']=dict(skipped=True,reason='Optional pilot artifact is not available.')
        gl.error('final checks');current,_=shaders(source)
        assert current==code,'Actual shader strings changed during verification; rerun required.'
        report['shaderStringsUnchangedDuringCheck']=True;report['passed']=True
    except Exception as error:
        report['error']=str(error)
        raise
    finally:
        if gl is not None:gl.close()
        report['elapsedSeconds']=time.monotonic()-began
        report['peakProcessRssMiB']=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024
        if report['peakProcessRssMiB']>300:report['passed']=False;report['memoryLimitExceeded']=True
        args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(report,indent=2)+'\n')
    assert report['passed'],'GL check failed or exceeded 300 MiB.'
    print(json.dumps({k:report[k] for k in ('passed','driver','positionBranches','picking','clipping','depthPicking','peakProcessRssMiB','elapsedSeconds')},indent=2))
    return 0

if __name__=='__main__':
    sys.exit(main())
