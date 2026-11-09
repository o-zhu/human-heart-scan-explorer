#!/usr/bin/env python3
"""Sequential, bounded scientific EGL comparison; reads already cached N5 data.

This figure is a scientific rendering, not a browser screenshot. Each mesh is
rendered in a fresh subprocess, with no four-mesh resident scene.
"""
from __future__ import annotations
import os
os.environ['OPENBLAS_NUM_THREADS'] = '1'
os.environ['OMP_NUM_THREADS'] = '1'
os.environ['LP_NUM_THREADS'] = '1'
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import resource
import struct
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[3]
METHODS = ('raw', 'gaussian_1p5', 'tv800_16', 'tv800_40')
TITLES = ('Raw intensity surface', 'Gaussian 1.5 voxels', 'TV 800 · 16 iterations', 'TV 800 · 40 iterations')
CORE_ORIGIN_XYZ = (4490,3978,4618)
CORE_N, HALO, SPACING_MM, THRESHOLD, RSS_CAP_MIB = 108, 40, .01985, 17133.4, 500


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()


def peak_rss():
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024


def save_record(path, record):
    record['peakRssMiB'] = peak_rss()
    if record['peakRssMiB'] > RSS_CAP_MIB:
        raise RuntimeError(f"Peak RSS exceeded {RSS_CAP_MIB} MiB: {record['peakRssMiB']:.1f}")
    Path(path).write_text(json.dumps(record,indent=2)+'\n')


def prepare(args):
    import gc
    import blosc2
    import numpy as np
    from scipy.ndimage import gaussian_filter
    from skimage.restoration import denoise_tv_chambolle
    blosc2.set_nthreads(1)
    roots = (args.data_root/'network-pilot',args.legacy_cache)
    origin = np.array(CORE_ORIGIN_XYZ)-HALO
    shape = np.array([CORE_N+HALO*2]*3)
    end = origin+shape
    raw = np.empty(tuple(shape[::-1]),np.float32)
    provenance = []
    for z in range(origin[2]//128,(end[2]-1)//128+1):
        for y in range(origin[1]//128,(end[1]-1)//128+1):
            for x in range(origin[0]//128,(end[0]-1)//128+1):
                name=f'{x}_{y}_{z}.n5'
                path=next((root/name for root in roots if (root/name).exists()),None)
                if path is None: raise FileNotFoundError(f'Cached native context is missing: {name}')
                payload=path.read_bytes();mode,ndim,nx,ny,nz=struct.unpack('>HHIII',payload[:16])
                if (mode,ndim)!=(0,3): raise ValueError(f'Unsupported N5 header in {name}')
                decoded=blosc2.decompress(payload[16:])
                block=np.frombuffer(decoded,dtype='>u2').reshape(nz,ny,nx)
                start=np.array([x,y,z])*128
                lo,hi=np.maximum(origin,start),np.minimum(end,start+block.shape[::-1])
                dst=tuple(slice(int(a),int(b)) for a,b in zip((lo-origin)[::-1],(hi-origin)[::-1]))
                src=tuple(slice(int(a),int(b)) for a,b in zip((lo-start)[::-1],(hi-start)[::-1]))
                raw[dst]=block[src]
                provenance.append(dict(xyz=[x,y,z],bytes=len(payload),sha256=hashlib.sha256(payload).hexdigest()))
                del payload,decoded,block
    record=dict(coreOriginXYZ=list(CORE_ORIGIN_XYZ),coreShapeZYX=[CORE_N]*3,
        contextOriginXYZ=origin.tolist(),contextShapeZYX=shape.tolist(),realSourceHalo=HALO,
        sourceSpacingUm=19.85,thresholdRaw=float(np.float32(THRESHOLD)),sourceBlocks=provenance,
        contextFloat32LeSha256=hashlib.sha256(memoryview(raw).cast('B')).hexdigest(),methods={})
    crop=(slice(HALO,-HALO),)*3
    for method in METHODS:
        started=time.perf_counter()
        if method=='raw': field=raw
        elif method=='gaussian_1p5': field=gaussian_filter(raw,1.5,radius=6,mode='nearest')
        else: field=denoise_tv_chambolle(raw,weight=800,max_num_iter=16 if method=='tv800_16' else 40,eps=0,channel_axis=None)
        core=np.ascontiguousarray(field[crop],dtype='<f4')
        np.save(args.work/(method+'.npy'),core)
        record['methods'][method]=dict(filterSeconds=time.perf_counter()-started,
            coreFloat32LeSha256=hashlib.sha256(memoryview(core).cast('B')).hexdigest())
        print(json.dumps({'stage':'prepare','method':method,'peakRssMiB':peak_rss()}),flush=True)
        if method!='raw': del field
        del core
        gc.collect()
    save_record(args.work/'source-record.json',record)


def render(args):
    import numpy as np
    import skimage
    from skimage.measure import marching_cubes
    from PIL import Image
    render_path=ROOT/'scripts/native-surface-v20/render_egl.py'
    spec=importlib.util.spec_from_file_location('heart_scientific_egl',render_path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    field=np.load(args.work/(args.method+'.npy'))
    vertices,triangles,_,_=marching_cubes(field,float(np.float32(THRESHOLD)),allow_degenerate=False)
    xyz=np.ascontiguousarray(vertices[:,[2,1,0]],dtype='<f4')
    faces=np.ascontiguousarray(triangles[:,[0,2,1]],dtype='<u4')
    del field,vertices,triangles
    points=np.ascontiguousarray(xyz*np.float32(SPACING_MM),np.float32)
    normals=np.zeros_like(points)
    for start in range(0,len(faces),50000):
        ids=faces[start:start+50000]
        a,b,c=points[ids[:,0]],points[ids[:,1]],points[ids[:,2]]
        face_normals=np.cross(b-a,c-a)
        for corner in range(3):np.add.at(normals,ids[:,corner],face_normals)
    length=np.linalg.norm(normals,axis=1)
    fallback=length<=1e-15
    normals[fallback]=[0,0,1]
    normals[~fallback]/=length[~fallback,None]
    geometry_hash=hashlib.sha256();geometry_hash.update(memoryview(xyz).cast('B'));geometry_hash.update(memoryview(faces).cast('B'))
    renderer=module.SurfaceRenderer(width=620,height=600)
    span=(CORE_N-1)*SPACING_MM
    center=np.array([span/2]*3,np.float32)
    clip_local_z=54
    clip_normalized=(clip_local_z-(CORE_N-1)/2)/(CORE_N-1)
    outputs={}
    for name,clip in [('full',1.),('section',clip_normalized)]:
        pixels=renderer.draw(points,normals,faces,center,span,clip_z=clip)
        destination=args.work/f'{args.method}-{name}.png'
        Image.fromarray(pixels).save(destination,optimize=True)
        outputs[name]=dict(path=destination.name,sha256=sha(destination))
        del pixels
    record=dict(method=args.method,vertices=len(points),triangles=len(faces),
        geometrySha256=geometry_hash.hexdigest(),
        geometryHashLayout='Concatenated local native XYZ float32 little-endian vertices, then uint32 little-endian triangle indices; XYZ axis swap accompanied by reversed triangle winding.',
        positionsMmFloat32LeSha256=hashlib.sha256(memoryview(points).cast('B')).hexdigest(),
        normalsFloat32LeSha256=hashlib.sha256(memoryview(normals).cast('B')).hexdigest(),
        normalPolicy='Area-weighted incident triangle normals; no geometry smoothing. Exact cancellation falls back to +Z.',
        fallbackNormalVertices=int(fallback.sum()),rendererPath=str(render_path.relative_to(ROOT)),
        rendererSha256=sha(render_path),rendererDriver=renderer.driver,
        versions=dict(numpy=np.__version__,skimage=skimage.__version__),
        frameSizePixels=[620,600],orthographicHalfHeightMm=.82*span,
        cropCenterLocalMm=center.tolist(),cropSampleCenterSpanMm=span,
        cameraDirectionUnnormalized=[1.3,-1.8,.85],cameraWorldUp=[0,0,1],
        primaryLight='normalize(cameraDirection + [-0.45,0.25,0.7])',
        fillLight='normalize([-0.7,-0.2,0.2])',surfaceRgb=[.80,.46,.29],backgroundRgb=[.035,.047,.058],
        fullViewClipNormalizedZ=1.,sectionClipNormalizedZ=clip_normalized,
        sectionLocalNativeZ=clip_local_z,sectionGlobalNativeZ=CORE_ORIGIN_XYZ[2]+clip_local_z,
        clipping='Discard fragments above the common Z plane; no cap is synthesized.',outputs=outputs)
    save_record(args.work/(args.method+'-render.json'),record)
    print(json.dumps({'stage':'render','method':args.method,'triangles':len(faces),'peakRssMiB':peak_rss()}),flush=True)


def compose(args):
    from PIL import Image,ImageDraw,ImageFont
    def font(size):return ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',size)
    records=[json.loads((args.work/(method+'-render.json')).read_text()) for method in METHODS]
    source=json.loads((args.work/'source-record.json').read_text())
    width=4*620+56;height=1462
    figure=Image.new('RGB',(width,height),'#091019');draw=ImageDraw.Draw(figure)
    draw.text((32,23),'Native surface filtering · matched 3D scientific renderings',font=font(32),fill='#e5ece7')
    draw.text((32,70),'Same 108³ native core, 19.85 µm spacing, threshold 17,133.4 · 40 real source samples of context on every side',font=font(20),fill='#9db3b2')
    for col,(method,title,record) in enumerate(zip(METHODS,TITLES,records)):
        x=28+col*620
        draw.text((x+18,112),title,font=font(23),fill='#d5e3dc')
        draw.text((x+18,147),f"{record['triangles']:,} triangles",font=font(18),fill='#9bb3b1')
        for row,name in enumerate(['full','section']):
            image=Image.open(args.work/f'{method}-{name}.png').convert('RGB')
            figure.paste(image,(x,180+row*610))
            label='Full measured crop' if row==0 else 'Same open section · native Z = 4672'
            draw.text((x+14,185+row*610),label,font=font(16),fill='#a6b6b8')
    draw.text((32,1412),'Lossy filtering can remove small structures. Common camera, lighting and area-weighted normals; no mesh smoothing or simplification.',font=font(18),fill='#a8bab8')
    draw.text((32,1439),'EGL scientific rendering · not a browser screenshot · physical crop span 2.124 mm between sample centers · anatomical accuracy not established',font=font(17),fill='#849c9f')
    destination=args.output/'surface-comparison.png'
    figure.save(destination,optimize=True)
    expected=json.loads((args.output/'measurements.json').read_text())['selectedRegion']['methods']
    for record in records:
        if record['triangles']!=expected[record['method']]['triangles']:
            raise RuntimeError('Rendered geometry count differs from the denoising measurement.')
    result=dict(schema='native-denoising-scientific-render-v21.1',notBrowserScreenshot=True,
        input=source,methods=records,allMethodsShareCameraLightingCropNormalPolicy=True,
        processingOrder='Prepare scalar cores; exit. Render each method in a fresh serial subprocess; exit. Compose images.',
        memoryCapMiB=RSS_CAP_MIB,maximumMeasuredChildRssMiB=max([source['peakRssMiB']]+[r['peakRssMiB'] for r in records]),
        figure=dict(path='surface-comparison.png',width=width,height=height,bytes=destination.stat().st_size,sha256=sha(destination)))
    public_path=ROOT/'public/assets/guided-native-v21/surface-comparison.webp'
    public_path.parent.mkdir(parents=True,exist_ok=True)
    size=(1800,round(height*1800/width))
    derivative=figure.resize(size,Image.Resampling.LANCZOS)
    derivative.save(public_path,'WEBP',quality=86,method=6)
    if public_path.stat().st_size>250000:raise RuntimeError('Public figure exceeds the 250 kB budget')
    result['publicDerivative']=dict(path=str(public_path.relative_to(ROOT)),width=size[0],height=size[1],
        bytes=public_path.stat().st_size,sha256=sha(public_path),format='WebP',quality=86,
        resampling='Lanczos',sourceFigureSha256=result['figure']['sha256'])
    save_record(args.output/'surface-render-record.json',result)
    print(json.dumps({'stage':'compose','figureBytes':destination.stat().st_size,'peakRssMiB':peak_rss(),'maximumChildRssMiB':result['maximumMeasuredChildRssMiB']}),flush=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage',choices=['prepare','render','compose'])
    parser.add_argument('--method',choices=METHODS)
    parser.add_argument('--data-root',type=Path,default=Path('{source-cache}/guided-native-v21'))
    parser.add_argument('--legacy-cache',type=Path,default=Path('{source-cache}/native-surface-v20/chunks-s0'))
    parser.add_argument('--work',type=Path,default=Path('{source-cache}/guided-native-v21/denoise/surface-render'))
    parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parent)
    args=parser.parse_args();args.work.mkdir(parents=True,exist_ok=True);args.output.mkdir(parents=True,exist_ok=True)
    if args.stage=='prepare':prepare(args)
    elif args.stage=='render':render(args)
    elif args.stage=='compose':compose(args)
    else:
        common=[sys.executable,str(Path(__file__).resolve()),'--data-root',str(args.data_root),'--legacy-cache',str(args.legacy_cache),'--work',str(args.work),'--output',str(args.output)]
        subprocess.run(common+['--stage','prepare'],check=True)
        for method in METHODS:subprocess.run(common+['--stage','render','--method',method],check=True)
        subprocess.run(common+['--stage','compose'],check=True)


if __name__=='__main__':main()
