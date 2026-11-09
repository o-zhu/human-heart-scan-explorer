#!/usr/bin/env python3
"""Render verified HFM overview parts as a bounded scientific exterior/cutaway.

No network, browser, source decoding, reconstruction or simplification occurs.
The completed whole overview must already exist. --allow-pilot permits only an
explicitly labelled smoke render in a separate output directory. Raster and
composition run sequentially in monitored subprocesses; triangle batches and
memory-mapped assets avoid a resident whole mesh. This is a display-LOD figure,
not a native-grid surface figure, browser screenshot or anatomical validation.
"""
from __future__ import annotations

import os
os.environ['OPENBLAS_NUM_THREADS']='1'
os.environ['OMP_NUM_THREADS']='1'
os.environ['LP_NUM_THREADS']='1'
os.environ.setdefault('LIBGL_ALWAYS_SOFTWARE','1')

import argparse
import ctypes
import gc
import hashlib
import importlib.util
import json
import math
import mmap
from pathlib import Path, PurePosixPath
import re
import resource
import struct
import subprocess
import sys
import tempfile
import threading
import time
import zlib

ROOT=Path(__file__).resolve().parents[2]
MIB=1024**2
WORLD_MM=8479*.01985
WHOLE_PLAN_SHA256='3be68c22b4f7a000b6e17b4c159f4d9a630b52884ea434624fc70c25999c6e94'
WHOLE_RUN_FINGERPRINT='44a31c3adeb20e5a9a3d31f6868f9c92479920f533d2ea3c486e22b4aefa584a'
DIMENSIONS=[7614,7614,8480]
NATIVE_CENTER=[3806.5,3806.5,4239.5]
SHA=re.compile(r'^[0-9a-f]{64}$',re.ASCII)


def require(condition,message):
    if not condition:raise ValueError(message)


def digest(data):return hashlib.sha256(data).hexdigest()


def file_hash(path,maximum=128*MIB):
    require(path.is_file() and not path.is_symlink(),'A required local evidence file is missing or a symbolic link.')
    h=hashlib.sha256();size=0
    with path.open('rb') as stream:
        for data in iter(lambda:stream.read(MIB),b''):
            size+=len(data);require(size<=maximum,'Local evidence exceeds its size bound.');h.update(data)
    return h.hexdigest(),size


def read_json(path,maximum):
    require(path.is_file() and not path.is_symlink(),'A required local JSON file is missing or a symbolic link.')
    with path.open('rb') as stream:raw=stream.read(maximum+1)
    require(len(raw)<=maximum,'JSON evidence exceeds its size bound.')
    def pairs(items):
        result={}
        for key,value in items:
            require(key not in result,'Duplicate JSON evidence key.');result[key]=value
        return result
    value=json.loads(raw,object_pairs_hook=pairs,parse_constant=lambda _:(_ for _ in ()).throw(ValueError('Nonfinite JSON evidence.')))
    require(isinstance(value,dict),'Expected a JSON evidence object.')
    return value,digest(raw)


def child(root,name):
    require(isinstance(name,str) and name and '\\' not in name,'Invalid relative evidence path.')
    p=PurePosixPath(name)
    require(not p.is_absolute() and str(p)==name and all(v not in ('.','..') for v in p.parts),'Unsafe evidence path.')
    result=root.joinpath(*p.parts)
    require(result.resolve().is_relative_to(root.resolve()) and not result.is_symlink(),'Evidence path escapes its root.')
    return result


def atomic_json(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    require(not path.is_symlink(),'Output cannot replace a symbolic link.')
    temporary=path.with_name(path.name+'.partial')
    with temporary.open('w') as stream:
        json.dump(value,stream,indent=2,allow_nan=False);stream.write('\n');stream.flush();os.fsync(stream.fileno())
    os.replace(temporary,path)


def trim():
    gc.collect()
    try:ctypes.CDLL('libc.so.6').malloc_trim(0)
    except (AttributeError,OSError):pass


def inputs(args):
    manifest,manifest_hash=read_json(args.manifest,8*MIB)
    require(manifest.get('schema')=='guided-native-overview-v21.1','Unsupported overview manifest schema.')
    require(manifest.get('complete') is True and manifest.get('completeInputCorePlan') is True,'A completed overview of its complete input plan is required.')
    require(manifest.get('pilot') is args.allow_pilot,'Pilot scope requires --allow-pilot; whole mode rejects a pilot overview.')
    require(manifest.get('donorId')=='ladaf-2021-17' and manifest.get('nativeSourceSpacingUm')==19.85 and manifest.get('inputOverviewSampleSpacingUm')==79.4,'Foreign source or display sampling geometry.')
    require(manifest.get('displayLodIsLossy') is True and manifest.get('nativeBankModified') is False,'Overview must declare display loss and preservation of the native archive.')
    transform=manifest['coordinateTransform']
    require(transform.get('nativeDimensionsXYZ')==DIMENSIONS and transform.get('nativeXYZCenter')==NATIVE_CENTER
        and transform.get('scaleNativeVoxels')==8479 and transform.get('positionFormat')=='float32'
        and transform.get('hfmPositionFlag')==1,'Overview coordinate transform differs from the audited HFM world frame.')
    source,source_hash=read_json(child(args.manifest.parent,manifest['inputManifest']),64*MIB)
    require(source_hash==manifest.get('inputManifestFileSha256'),'Overview input-manifest checksum changed.')
    require(source.get('completeCorePlan') is True and source.get('corePlanCoordinateSetVerified') is True
        and source.get('pilot') is args.allow_pilot,'Overview input plan lacks complete coordinate verification or has another scope.')
    count=manifest['inputOverviewBlocks']
    require(type(count) is int and count>0 and source.get('plannedCoreBlocks')==source.get('completedOverviewBlocks')==count
        and len(source.get('records',[]))==count,'Overview input coverage counts disagree.')
    if not args.allow_pilot:
        require(count==37612 and source.get('runFingerprint')==WHOLE_RUN_FINGERPRINT and source.get('corePlanSha256')==WHOLE_PLAN_SHA256,
            'Whole-heart rendering requires the independently pinned whole processing run and census plan.')
    source_summary={key:source.get(key) for key in ('runFingerprint','runManifestSha256','corePlanSha256',
        'sourceObjectLedgerSha256','plannedCoreBlocks','completedOverviewBlocks','sourceConfiguration')}
    del source;trim()
    lods=[v for v in manifest.get('lods',[]) if v.get('id')==args.lod]
    require(len(lods)==1,'The requested display LOD is missing or duplicated.')
    lod=lods[0];parts=lod.get('parts')
    require(isinstance(parts,list) and 1<=len(parts)<=16,'A bounded overview part list is required.')
    require(type(lod.get('triangles')) is int and 0<lod['triangles']<=3_000_000,'Display triangle count exceeds this bounded renderer.')
    require(sum(p.get('triangles',0) for p in parts)==lod['triangles'],'Part triangle counts differ from the display LOD.')
    require(sum(p.get('decodedBytes',0) for p in parts)<=128*MIB,'Combined decoded display assets exceed 128 MiB.')
    for part in parts:
        require(part.get('format')=='HFM1' and part.get('positionFormat')=='float32' and part.get('positionFlag')==1,'Only float32-position HFM1 display parts are supported.')
        require(type(part.get('compressedBytes')) is int and 0<part['compressedBytes']<=32*MIB
            and type(part.get('decodedBytes')) is int and 32<part['decodedBytes']<=128*MIB,'Invalid HFM object bounds.')
        require(SHA.fullmatch(part.get('sha256','')) is not None and SHA.fullmatch(part.get('decodedSha256','')) is not None,'Invalid HFM evidence checksum.')
        require(part.get('collapsedTriangles')==0 and part.get('flippedTriangles')==0 and part.get('losslessGzipRoundTrip') is True,'HFM publication checks do not support an unchanged display mesh.')
        child(args.manifest.parent,part['path'])
    return manifest,manifest_hash,source_summary,lod


def decode_part(path,descriptor,destination):
    """Verify compressed and decoded bytes while writing one temporary mmap file."""
    decoder=zlib.decompressobj(31);compressed=hashlib.sha256();decoded=hashlib.sha256();cs=ds=0
    with path.open('rb') as stream,destination.open('xb') as output:
        while data:=stream.read(64*1024):
            cs+=len(data);require(cs<=descriptor['compressedBytes'],'HFM compressed input exceeds its declared size.')
            compressed.update(data)
            while data:
                chunk=decoder.decompress(data,MIB);data=decoder.unconsumed_tail
                ds+=len(chunk);require(ds<=descriptor['decodedBytes'],'HFM gzip exceeds its declared decoded size.')
                decoded.update(chunk);output.write(chunk)
                require(not decoder.unused_data,'Concatenated or trailing HFM gzip data are forbidden.')
        require(decoder.eof,'HFM gzip stream is incomplete.')
    require(cs==descriptor['compressedBytes'] and compressed.hexdigest()==descriptor['sha256'],'HFM compressed SHA/size mismatch.')
    require(ds==descriptor['decodedBytes'] and decoded.hexdigest()==descriptor['decodedSha256'],'HFM decoded SHA/size mismatch.')


def arrays(path,descriptor):
    import numpy as np
    memory=np.memmap(path,mode='r',dtype=np.uint8)
    h=struct.unpack('<8I',memory[:32])
    magic,version,n,count,po,no,io,flag=h
    require((magic,version,flag)==(0x314d4648,1,1) and n==descriptor['vertices'] and count==3*descriptor['triangles'],'HFM header counts or format differ from its manifest.')
    require(po==32 and no==(po+n*12+3)&~3 and io==(no+n*6+3)&~3 and io+count*4==len(memory),'HFM array offsets or length are inconsistent.')
    points=np.ndarray((n,3),dtype='<f4',buffer=memory,offset=po)
    normals=np.ndarray((n,3),dtype='<i2',buffer=memory,offset=no)
    faces=np.ndarray((count//3,3),dtype='<u4',buffer=memory,offset=io)
    return memory,points,normals,faces,h


def evict(memory):
    if hasattr(memory._mmap,'madvise') and hasattr(mmap,'MADV_DONTNEED'):memory._mmap.madvise(mmap.MADV_DONTNEED)


def basis(yaw,pitch):
    return dict(right=[math.cos(yaw),0,-math.sin(yaw)],
        up=[-math.sin(pitch)*math.sin(yaw),math.cos(pitch),-math.sin(pitch)*math.cos(yaw)],
        view=[math.sin(yaw)*math.cos(pitch),math.sin(pitch),math.cos(yaw)*math.cos(pitch)])


def module(path,name):
    spec=importlib.util.spec_from_file_location(name,path);loaded=importlib.util.module_from_spec(spec);spec.loader.exec_module(loaded);return loaded


def raster(args):
    import numpy as np
    from PIL import Image
    manifest,manifest_hash,source,lod=inputs(args)
    started=time.monotonic();args.output.mkdir(parents=True,exist_ok=True)
    require(not args.output.is_symlink(),'Output directory cannot be a symbolic link.')
    camera=basis(args.yaw,args.pitch);rotation=np.asarray([camera['right'],camera['up'],camera['view']],np.float64)
    minimum=np.full(3,np.inf);maximum=-minimum.copy();projected_min=minimum.copy();projected_max=maximum.copy()
    descriptors=[];normal_zero_count=0
    helpers=ROOT/'docs/guided-native-v21/whole-viewer-gl-check.py'
    gl_module=module(helpers,'whole_overview_egl_helper');shader_path=ROOT/'public/whole-native.js'
    code,shader_source_hash=gl_module.shaders(shader_path)
    with tempfile.TemporaryDirectory(prefix='whole-overview-render-',dir=args.output) as temporary:
        temporary=Path(temporary)
        for index,part in enumerate(lod['parts']):
            decoded=temporary/f'part-{index:02}.hfm';decode_part(child(args.manifest.parent,part['path']),part,decoded)
            memory,points,normals,faces,header=arrays(decoded,part)
            for start in range(0,len(points),65536):
                p=points[start:start+65536];require(np.isfinite(p).all(),'Display positions contain nonfinite values.')
                minimum=np.minimum(minimum,p.min(axis=0));maximum=np.maximum(maximum,p.max(axis=0))
                projected=p@rotation.T;projected_min=np.minimum(projected_min,projected.min(axis=0));projected_max=np.maximum(projected_max,projected.max(axis=0))
                normal_zero_count+=int(np.count_nonzero(~np.any(normals[start:start+65536],axis=1)))
                del p,projected;evict(memory)
            for start in range(0,len(faces),args.batch_triangles):
                require(int(faces[start:start+args.batch_triangles].max())<len(points),'HFM triangle references an invalid vertex.');evict(memory)
            descriptors.append(dict(part,temporaryName=decoded.name,header=list(header)))
            del points,normals,faces;memory._mmap.close();del memory
        require(np.isfinite(minimum).all() and np.all(maximum>minimum),'The overview has no finite three-dimensional extent.')
        require(np.all(minimum>=np.asarray(manifest['bounds']['min'])-1e-5)
            and np.all(maximum<=np.asarray(manifest['bounds']['max'])+1e-5),'Overview geometry lies outside the declared full-source world bounds.')
        center_projected=(projected_min+projected_max)/2
        camera['center']=(center_projected@rotation).tolist();camera['pan']=[0,0]
        camera['span']=float(max(projected_max[0]-projected_min[0],projected_max[1]-projected_min[1])*1.16)
        camera['yawRadians']=args.yaw;camera['pitchRadians']=args.pitch
        cut_value=float(projected_min[2]+args.cut_fraction*(projected_max[2]-projected_min[2]))
        cut=dict(enabled=True,axis=camera['view'],value=cut_value,sign=1)
        trim();gl=gl_module.CheckGL(code,width=1,height=1);U,I,F,P=gl.U,gl.I,gl.F,gl.P;f=gl.f;C=ctypes
        target=gl.framebuffer(args.panel_size,args.panel_size);program=gl.programs['fragment'];driver=gl.driver
        vao=U();f('glGenVertexArrays',None,[I,C.POINTER(U)])(1,C.byref(vao));f('glBindVertexArray',None,[U])(vao)
        buffers=[];capacity=args.batch_triangles*3
        for slot,width,kind in ((0,12,0x1406),(1,6,0x1402)):
            buffer=U();buffers.append(buffer);f('glGenBuffers',None,[I,C.POINTER(U)])(1,C.byref(buffer))
            f('glBindBuffer',None,[U,U])(0x8892,buffer)
            f('glBufferData',None,[U,C.c_ssize_t,P,U])(0x8892,capacity*width,None,0x88E8)
            f('glEnableVertexAttribArray',None,[U])(slot)
            f('glVertexAttribPointer',None,[U,I,U,U,I,P])(slot,3,kind,int(slot==1),0,None)
        outputs={}
        try:
            for label,clipping in (('exterior',{}),('cutaway',cut)):
                f('glBindFramebuffer',None,[U,U])(0x8D40,target['frame']);f('glViewport',None,[I,I,I,I])(0,0,args.panel_size,args.panel_size)
                f('glEnable',None,[U])(0x0B71);f('glDepthFunc',None,[U])(0x0201)
                for value in (0x0B44,0x0BE2):f('glDisable',None,[U])(value)
                f('glClearDepthf',None,[F])(1.);f('glClearColor',None,[F,F,F,F])(.027,.047,.060,1.)
                f('glClear',None,[U])(0x4000|0x0100)
                gl.uniforms(program,dict(float=True,bounds=([0,0,0],[1,1,1])),camera,1,clipping)
                f('glBindVertexArray',None,[U])(vao);drawn=0;batches=0
                for part in descriptors:
                    memory,points,normals,faces,_=arrays(temporary/part['temporaryName'],part)
                    for start in range(0,len(faces),args.batch_triangles):
                        indices=faces[start:start+args.batch_triangles].reshape(-1)
                        position=np.ascontiguousarray(points[indices],dtype=np.float32)
                        normal=np.ascontiguousarray(normals[indices],dtype=np.int16)
                        for buffer,data in zip(buffers,(position,normal)):
                            f('glBindBuffer',None,[U,U])(0x8892,buffer)
                            f('glBufferSubData',None,[U,C.c_ssize_t,C.c_ssize_t,P])(0x8892,0,data.nbytes,data.ctypes.data)
                        f('glDrawArrays',None,[U,I,I])(4,0,len(indices));f('glFinish',None,[])()
                        drawn+=len(indices)//3;batches+=1
                        del indices,position,normal;evict(memory)
                    del points,normals,faces;memory._mmap.close();del memory
                require(drawn==lod['triangles'],'Raster pass did not submit every display triangle.')
                pixels=np.empty((args.panel_size,args.panel_size,4),np.uint8)
                f('glReadPixels',None,[I,I,I,I,U,U,P])(0,0,args.panel_size,args.panel_size,0x1908,0x1401,pixels.ctypes.data);gl.error('scientific render')
                pixels=pixels[::-1].copy();mask=np.any(pixels[:,:,:3]!=[7,12,15],axis=2)
                visible=int(mask.sum());require(visible>100,'The scientific view contains no useful surface coverage.')
                rows=np.flatnonzero(mask.any(axis=1));cols=np.flatnonzero(mask.any(axis=0))
                path=args.output/(label+'.png');Image.fromarray(pixels[:,:,:3]).save(path,optimize=True)
                outputs[label]=dict(path=path.name,sha256=file_hash(path)[0],bytes=path.stat().st_size,
                    rgbaPixelSha256=digest(pixels.tobytes()),submittedTriangles=drawn,batches=batches,
                    foregroundPixels=visible,foregroundPixelBounds=[int(cols[0]),int(rows[0]),int(cols[-1]),int(rows[-1])])
                del pixels,mask,rows,cols;trim()
        finally:
            f('glBindVertexArray',None,[U])(0)
            for buffer in buffers:f('glDeleteBuffers',None,[I,C.POINTER(U)])(1,C.byref(buffer))
            f('glDeleteVertexArrays',None,[I,C.POINTER(U)])(1,C.byref(vao));gl.close()
    require(outputs['exterior']['rgbaPixelSha256']!=outputs['cutaway']['rgbaPixelSha256'],'The cutaway did not change the rendered surface.')
    normal_native=[camera['view'][0],-camera['view'][2],camera['view'][1]]
    native_offset=cut_value*8479+sum(a*b for a,b in zip(normal_native,NATIVE_CENTER))
    report=dict(schema='guided-native-whole-scientific-render-v21.1',scope='pilot-only' if args.allow_pilot else 'whole-plan',
        notBrowserScreenshot=True,displayLodNotNativeGrid=True,source='LADAF-2021-17',nativeSourceSpacingUm=19.85,
        inputOverviewSamplingUm=79.4,displayLodIsLossy=True,manifestSha256=manifest_hash,overviewFingerprint=manifest['fingerprint'],
        sourceIdentity=source,lod=args.lod,lodTriangles=lod['triangles'],lodVertices=lod['vertices'],
        coverageCompleteForRecordedPlan=True,wholeAnatomicalCoverageEstablished=False,
        parts=[{k:v for k,v in p.items() if k!='temporaryName'} for p in descriptors],
        coordinateTransform=manifest['coordinateTransform'],worldMillimetersPerUnit=WORLD_MM,
        geometryWorldBounds=dict(min=minimum.tolist(),max=maximum.tolist()),projectedWorldBounds=dict(min=projected_min.tolist(),max=projected_max.tolist()),
        camera=camera,orthographicSpanMm=camera['span']*WORLD_MM,frameSizePixels=[args.panel_size,args.panel_size],
        cutaway=dict(normalWorld=camera['view'],offsetWorld=cut_value,normalNativeXYZ=normal_native,offsetNativeVoxels=native_offset,
            retainedInequality='dot(world, normalWorld) <= offsetWorld',retainedDepthFraction=args.cut_fraction,
            planePolicy='Oblique plane normal to the viewing direction; no anatomical orientation or chamber assignment is inferred.',caps=False),
        normalPolicy='Stored HFM signed-int16 normals, normalized by GLES; identical normal data for both views. No recomputation or geometry modification.',
        zeroStoredNormals=normal_zero_count,geometryModification=False,extraSmoothing=False,extraSimplification=False,
        networkRequests=0,sourceIntensityBytesRead=0,nativeGridPayloadBytesRead=0,
        renderer=dict(driver=driver,shaderSource='public/whole-native.js',shaderSourceSha256=shader_source_hash,
            shaderSha256={k:digest(v.encode()) for k,v in code.items()},helperSource='docs/guided-native-v21/whole-viewer-gl-check.py',
            helperSha256=file_hash(helpers)[0],baseRendererSha256=file_hash(ROOT/'scripts/native-surface-v20/render_egl.py')[0],
            scriptSha256=file_hash(Path(__file__))[0],backend='Surfaceless Mesa EGL/GLES3',triangleBatchSize=args.batch_triangles,
            meshMemoryPolicy='Verified gzip to temporary mmap; expanded small triangle batches; fixed reusable GL buffers; mapped pages released between batches.'),
        outputs=outputs,peakRssMiB=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024,seconds=time.monotonic()-started,
        limitations=['This simplified 79.4 micrometre display LOD is not the native-grid surface archive.',
            'The source uses lossy denoising and coarse-prior guidance; weak structures and structures outside the guide can be absent.',
            'Display simplification can change topology. The figure does not validate anatomy, volume coverage, mobile interaction or FPS.'])
    require(report['peakRssMiB']<args.rss_limit_mib,'Raster subprocess exceeded its RSS budget.')
    atomic_json(args.output/'render-record.json',report)
    print(json.dumps(dict(stage='raster',scope=report['scope'],triangles=lod['triangles'],peakRssMiB=report['peakRssMiB'],seconds=report['seconds'])),flush=True)


def nice_scale(span_mm):
    desired=span_mm*.18;power=10**math.floor(math.log10(desired))
    return max(v*power for v in (1,2,5) if v*power<=desired) if desired>=power else power/2


def compose(args):
    from PIL import Image,ImageDraw,ImageFont
    record,_=read_json(args.output/'render-record.json',2*MIB)
    n=args.panel_size;gap=28;width=2*n+3*gap;top=164;bottom=126;height=top+n+bottom
    image=Image.new('RGB',(width,height),'#071018');draw=ImageDraw.Draw(image)
    font_path='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
    font=lambda size:ImageFont.truetype(font_path,size)
    pilot=record['scope']=='pilot-only'
    title='PILOT · display surface smoke test' if pilot else 'Whole-heart refinement · display overview'
    draw.text((gap,22),title,font=font(32),fill='#ecf2ed')
    draw.text((gap,70),f'LADAF-2021-17 · 19.85 µm source · 79.4 µm overview sampling + lossy mesh simplification · {record["lodTriangles"]:,} triangles',font=font(19),fill='#afc3c5')
    draw.text((gap,103),'Actual archived display surfaces · matched orthographic camera, lighting and stored normals · open cut, no cap',font=font(18),fill='#99b1b5')
    scale_mm=nice_scale(record['orthographicSpanMm']);scale_pixels=scale_mm/record['orthographicSpanMm']*n
    camera=record['camera'];right,up=camera['right'],camera['up']
    axes=[('X',[1,0,0],'#e6a3a0'),('Y',[0,0,-1],'#a7c6a4'),('Z',[0,1,0],'#a4bfd8')]
    for col,name in enumerate(('exterior','cutaway')):
        x=gap+col*(n+gap);path=args.output/record['outputs'][name]['path']
        require(file_hash(path)[0]==record['outputs'][name]['sha256'],'A scientific panel changed before composition.')
        with Image.open(path) as panel:image.paste(panel.convert('RGB'),(x,top))
        label='Exterior · all display triangles' if name=='exterior' else f'Open cutaway · rear {100*args.cut_fraction:g}% of view-depth range retained'
        draw.text((x,top-34),label,font=font(21),fill='#d5e3de')
        sx=x+26;sy=top+n-30
        draw.line((sx,sy,sx+scale_pixels,sy),fill='#e4eeea',width=4)
        draw.line((sx,sy-6,sx,sy+6),fill='#e4eeea',width=2);draw.line((sx+scale_pixels,sy-6,sx+scale_pixels,sy+6),fill='#e4eeea',width=2)
        draw.text((sx,sy-29),f'{scale_mm:g} mm',font=font(18),fill='#dce7e4')
        ox=x+n-88;oy=top+n-82
        for label,axis,color in axes:
            dx=48*sum(a*b for a,b in zip(axis,right));dy=-48*sum(a*b for a,b in zip(axis,up));ex=ox+dx;ey=oy+dy
            draw.line((ox,oy,ex,ey),fill=color,width=3);draw.ellipse((ex-3,ey-3,ex+3,ey+3),fill=color)
            draw.text((ex+5,ey-11),label,font=font(17),fill=color)
        draw.text((x+n-174,top+n-25),'Acquisition axes',font=font(14),fill='#90a6ad')
    draw.text((gap,top+n+24),'Display LOD, not a native-grid figure. Denoising, prior guidance and simplification can alter or remove structures.',font=font(19),fill='#b2c3c5')
    draw.text((gap,top+n+58),'Scientific EGL rendering · no inferred chamber labels · anatomical accuracy is not established · not a browser screenshot',font=font(18),fill='#92aaaf')
    prefix='pilot-overview' if pilot else 'whole-overview'
    destination=args.output/(prefix+'.png');image.save(destination,optimize=True)
    output=dict(path=destination.name,sha256=file_hash(destination)[0],bytes=destination.stat().st_size,width=width,height=height)
    record['figure']=output;record['scaleBar']=dict(lengthMm=scale_mm,lengthPixels=scale_pixels,physicalProjection='Orthographic, identical in both panels')
    record['annotationPolicy']='Only source, display sampling, acquisition axes, physical scale and viewing-plane labels; no inferred chamber labels.'
    record['compositionPeakRssMiB']=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024
    require(record['compositionPeakRssMiB']<args.rss_limit_mib,'Composition subprocess exceeded its RSS budget.')
    atomic_json(args.output/'render-record.json',record)
    print(json.dumps(dict(stage='compose',figure=output,peakRssMiB=record['compositionPeakRssMiB'])),flush=True)


def run_monitored(command):
    # Each child guards its own actual RSS. This remains correct when the host
    # wraps subprocess PIDs in a launcher or translates /proc namespaces.
    child_process=subprocess.run(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    out,error=child_process.stdout,child_process.stderr
    if out:print(out,end='',flush=True)
    require(child_process.returncode==0,error.strip() or 'Scientific rendering subprocess failed.')
    return max(json.loads(line).get('peakRssMiB',0) for line in out.splitlines() if line.startswith('{'))


def start_rss_guard(limit):
    stop=threading.Event()
    def watch():
        while not stop.wait(.05):
            maximum=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024
            if maximum>=limit:
                os.write(2,f'Scientific renderer stopped at its {limit} MiB actual-process RSS limit.\n'.encode())
                os._exit(137)
    thread=threading.Thread(target=watch,name='scientific-render-rss-guard',daemon=True);thread.start()
    return stop


def main():
    parser=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--manifest',type=Path,default=Path('{source-cache}/guided-native-v21/whole/overview/manifest.json'))
    parser.add_argument('--output',type=Path,default=ROOT/'docs/guided-native-v21/whole-overview-render')
    parser.add_argument('--lod',choices=('overview','detail'),default='overview')
    parser.add_argument('--allow-pilot',action='store_true')
    parser.add_argument('--panel-size',type=int,default=960)
    parser.add_argument('--batch-triangles',type=int,default=30000)
    parser.add_argument('--cut-fraction',type=float,default=.5,help='Retained rear fraction of the measured view-depth range')
    parser.add_argument('--yaw',type=float,default=.48,help='Common camera yaw in radians')
    parser.add_argument('--pitch',type=float,default=.28,help='Common camera pitch in radians')
    parser.add_argument('--rss-limit-mib',type=int,default=225,help='Per-child monitored RSS limit, at most 225 MiB; parent stays small')
    parser.add_argument('--stage',choices=('raster','compose'),help=argparse.SUPPRESS)
    args=parser.parse_args()
    try:
        require(480<=args.panel_size<=1200 and 1000<=args.batch_triangles<=50000,'Use bounded panel and triangle-batch sizes.')
        require(64<=args.rss_limit_mib<=225,'Child RSS limit must be 64–225 MiB.')
        require(math.isfinite(args.cut_fraction) and .1<=args.cut_fraction<=.9 and math.isfinite(args.yaw) and math.isfinite(args.pitch),'Invalid finite camera or section parameters.')
        require(args.manifest.is_file(),'Completed overview manifest is not present; run this command only after the overview builder finishes.')
        if args.allow_pilot:require(args.output.resolve()!= (ROOT/'docs/guided-native-v21/whole-overview-render').resolve(),'Pilot output must use a separate explicitly named directory.')
        if args.stage:
            stop=start_rss_guard(args.rss_limit_mib)
            try:
                if args.stage=='raster':raster(args)
                else:compose(args)
            finally:stop.set()
        else:
            command=[sys.executable,str(Path(__file__).resolve()),*sys.argv[1:]]
            maximums={stage:run_monitored([*command,'--stage',stage]) for stage in ('raster','compose')}
            record,_=read_json(args.output/'render-record.json',2*MIB)
            record['watchdog']=dict(childLimitMiB=args.rss_limit_mib,actualChildPeaksMiB=maximums,
                method='Each child polls its own RUSAGE_SELF peak RSS every 50 ms; external launcher PIDs are not used.',
                parentPeakRssMiB=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024,stagesSequential=True)
            require(record['watchdog']['parentPeakRssMiB']+max(maximums.values())<250,'Combined renderer/orchestrator RSS exceeded the concurrent budget.')
            atomic_json(args.output/'render-record.json',record)
            print(json.dumps(dict(scope=record['scope'],figure=str(args.output/record['figure']['path']),
                record=str(args.output/'render-record.json'),wholeRenderExecuted=not args.allow_pilot)),flush=True)
    except (ValueError,OSError,KeyError,TypeError,AssertionError,zlib.error) as error:
        print(f'Scientific overview rendering stopped: {error}',file=sys.stderr);return 1
    return 0


if __name__=='__main__':raise SystemExit(main())
