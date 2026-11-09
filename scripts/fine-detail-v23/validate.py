#!/usr/bin/env python3
"""Compare delivered gentle geometry with the previous main-view fine meshes.

Three fixed measured ROIs are geometric probes, not anatomical ground truth.
Nearest-triangle queries use an 8 mm padded ROI. Their maximum result must be
below that padding, which proves an excluded triangle cannot be nearer.
"""
from __future__ import annotations
import os
os.environ['OMP_NUM_THREADS']='1';os.environ['OPENBLAS_NUM_THREADS']='1'
import argparse
import gc
import gzip
import hashlib
import json
from pathlib import Path
import resource
import struct
import time

import numpy as np
from scipy import ndimage as ndi
import vtk
from PIL import Image,ImageDraw,ImageFont

from source import ROOT,FineSource
from compare import PREP,VALIDATE,RENDER,mesh_normals,write

ROIS=[('lv-inflow',[1160,1092,1152]),('rv-inflow',[928,744,1192]),('outer-wall',[1392,1032,1376])]
OUT=ROOT/'docs/fine-detail-v23'


def load_hfm(manifest,lod,path=None):
    if path is None:path=ROOT/'public'/lod['url'].removeprefix('./')
    assert PREP.digest(path)==lod['sha256']
    if lod.get('parts'):
        joined=hashlib.sha256();total=0
        for item in lod['parts']:
            p=ROOT/'public'/item['url'].removeprefix('./');b=p.read_bytes()
            assert len(b)==item['compressedBytes'] and hashlib.sha256(b).hexdigest()==item['sha256']
            joined.update(b);total+=len(b)
        assert total==lod['compressedBytes'] and joined.hexdigest()==lod['sha256']
    with gzip.open(path,'rb') as stream:raw=stream.read()
    assert len(raw)==lod['decodedBytes'] and hashlib.sha256(raw).hexdigest()==lod['decodedSha256']
    magic,version,nv,ni,po,no,io,res=struct.unpack_from('<8I',raw)
    assert (magic,version,res)==(0x314d4648,1,0) and ni%3==0
    assert nv==lod['vertices'] and ni==3*lod['triangles']
    assert po==32 and no==(po+6*nv+3)&~3 and io==(no+6*nv+3)&~3 and io+4*ni==len(raw)
    q=np.frombuffer(raw,'<u2',nv*3,po).reshape(nv,3);normals=np.frombuffer(raw,'<i2',nv*3,no).reshape(nv,3)
    faces=np.frombuffer(raw,'<u4',ni,io).reshape(-1,3)
    bounds=manifest['bounds'];lower=np.asarray(bounds['min']);width=np.asarray(bounds['max'])-lower
    points=np.empty((nv,3),np.float32);normal_error=0.;minimum_norm=10.
    for start in range(0,nv,300_000):
        world=lower+q[start:start+300_000].astype(np.float64)/65535*width
        points[start:start+len(world)]=world[:,[0,2,1]]*np.array([1,-1,1])*168.0104
        lengths=np.linalg.norm(normals[start:start+len(world)].astype(np.float32)/32767,axis=1)
        normal_error=max(normal_error,float(np.abs(lengths-1).max(initial=0)));minimum_norm=min(minimum_norm,float(lengths.min(initial=10)))
    assert normal_error<.00008 and minimum_norm>.99 and faces.max()<nv
    zeros=0
    for start in range(0,len(faces),300_000):
        f=faces[start:start+300_000]
        qa=q[f[:,0]].astype(np.int64);qb=q[f[:,1]].astype(np.int64);qc=q[f[:,2]].astype(np.int64)
        zeros+=int(np.all(np.cross(qb-qa,qc-qa)==0,axis=1).sum())
    assert zeros==0
    return points,faces,raw,dict(id=lod['id'],vertices=nv,triangles=ni//3,compressedBytes=lod['compressedBytes'],decodedBytes=len(raw),
                               sha256=lod['sha256'],decodedSha256=lod['decodedSha256'],zeroAreaTriangles=zeros,normalLengthMaximumError=normal_error)


def local_poly(points,faces,lower,upper,padding=8.):
    lo=np.asarray(lower)-padding;hi=np.asarray(upper)+padding
    chosen=[]
    for start in range(0,len(faces),300_000):
        f=faces[start:start+300_000];p=points[f]
        keep=(p.max(axis=1)>=lo).all(axis=1)&(p.min(axis=1)<=hi).all(axis=1)
        chosen.append(f[keep])
    f=np.concatenate(chosen);used,reverse=np.unique(f,return_inverse=True)
    return PREP.poly_from_arrays(points[used],reverse.astype(np.uint32).reshape(-1,3))


def source_queries(src,radius=80,count=12000):
    result=[]
    for index,(name,center) in enumerate(ROIS):
        center=np.asarray(center);lo=center-radius;hi=center+radius+1
        data=src.region(lo,hi);raw=PREP.contour(data.astype(np.float32),src.millimetres(lo),src.spacing_mm)
        rng=np.random.default_rng(23005000+index)
        samples=VALIDATE.sample_surface(raw,count*2,rng)
        minimum,maximum=src.millimetres(lo+5),src.millimetres(hi-1-5)
        samples=samples[((samples>=minimum)&(samples<=maximum)).all(axis=1)][:count]
        mask=data>=71.4;edt=ndi.distance_transform_edt(mask).astype(np.float32)
        thin=mask&(ndi.maximum_filter(edt,size=5)<=1.01)
        thin[:5]=False;thin[-5:]=False;thin[:,:5]=False;thin[:,-5:]=False;thin[:,:,:5]=False;thin[:,:,-5:]=False
        indices=np.argwhere(thin)
        if len(indices)>count:indices=indices[rng.choice(len(indices),count,replace=False)]
        centers=src.millimetres(indices[:,::-1]+lo)
        result.append(dict(id=name,centerFineXYZ=center.tolist(),originFineXYZ=lo.tolist(),shapeXYZ=(hi-lo).tolist(),
                           rawUint8Sha256=hashlib.sha256(data.tobytes()).hexdigest(),lowerMm=src.millimetres(lo),upperMm=src.millimetres(hi-1),
                           rawSurfaceSamples=samples,thinSupportCenters=centers,rawMesh=raw))
    return result


def measure(points,faces,queries,identity):
    values=[]
    for query in queries:
        mesh=local_poly(points,faces,query['lowerMm'],query['upperMm'])
        fn=VALIDATE.distance_function(mesh)
        raw=VALIDATE.distances(fn,query['rawSurfaceSamples']);thin=VALIDATE.distances(fn,query['thinSupportCenters'])
        assert max(raw.max(),thin.max())<8.,'Increase local padding to establish nearest-triangle coverage.'
        values.append(dict(id=query['id'],rawSourceSurfaceToMesh=VALIDATE.stats(raw),thinSupportCenterToMesh=VALIDATE.stats(thin),
                           thinSupportWithinOneFineSampleFraction=float((thin<=.0794).mean()),
                           thinSupportWithinTwoFineSamplesFraction=float((thin<=.1588).mean()),
                           localCandidateTriangles=mesh.GetNumberOfCells(),nearestQueryPaddingMm=8.))
        print(json.dumps(dict(asset=identity,**values[-1])),flush=True)
        del mesh,fn;gc.collect()
    return values


def clipped(poly,lo,hi):
    box=vtk.vtkBox();box.SetBounds(lo[0],hi[0],lo[1],hi[1],lo[2],hi[2])
    clip=vtk.vtkClipPolyData();clip.SetInputData(poly);clip.SetClipFunction(box);clip.InsideOutOn();clip.Update()
    triangle=vtk.vtkTriangleFilter();triangle.SetInputData(clip.GetOutput());triangle.Update()
    out=vtk.vtkPolyData();out.ShallowCopy(triangle.GetOutput());return out


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--work',type=Path,required=True)
    parser.add_argument('--phase',choices=['baseline','final'],default='final');args=parser.parse_args()
    vtk.vtkSMPTools.Initialize(2);started=time.monotonic();src=FineSource(48);queries=source_queries(src)
    report=dict(schema='fine-detail-v23-hosted-comparison',sourceSpacingUm=79.4,seed=23005000,
        methodology='Uniform-area samples of unsmoothed measured local source isosurfaces, plus geometrically thin original foreground voxel centers. Exact nearest point-to-triangle distance to decoded delivered assets. Identical source queries for all meshes.',
        limitations='Three targeted ROIs, not anatomically balanced or expert-annotated. Thin-support proxy contains anatomy and noise. Finite sampling is not a Hausdorff/clinical error bound. No claim of native19.85µm feature recovery.',
        thinSupportDefinition='Original foreground whose local5³ maximum EDT is≤1.01 fine voxels; five-sample collar excluded.',
        regions=[{k:v for k,v in q.items() if k in ['id','centerFineXYZ','originFineXYZ','shapeXYZ','rawUint8Sha256']} for q in queries],assets=[])
    old=json.loads((ROOT/'public/assets/fine-surface-v19/manifest.json').read_text())
    old_report=OUT/'hosted-baseline-comparison.json'
    renderer=RENDER.SurfaceRenderer(620,560) if args.phase=='final' else None
    sheet=Image.new('RGB',(1940,1950),'#081116') if renderer else None
    if sheet:
        draw=ImageDraw.Draw(sheet);font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',20)
        draw.text((20,20),'Source-supported detail comparison · same ROI/camera within each row · delivered quantized meshes',font=font,fill='#e2ecea')
    jobs=[(old,lod,None) for lod in old['lods'] if lod['id'] in ['balanced','detail']]
    if args.phase=='final':
        manifest=json.loads((ROOT/'public/assets/fine-surface-v23/manifest.json').read_text())
        jobs.append((manifest,manifest['lods'][0],args.work/'gentle.hfm.gz'))
    for manifest,lod,path in jobs:
        points,faces,raw,info=load_hfm(manifest,lod,path)
        info['regions']=measure(points,faces,queries,lod['id']);report['assets'].append(info)
        if renderer and lod['id'] in ['detail','gentle']:
            column=1 if lod['id']=='detail' else 2
            for row,query in enumerate(queries):
                local=local_poly(points,faces,query['lowerMm'],query['upperMm'],padding=0.)
                crop=clipped(local,query['lowerMm'],query['upperMm']);pp,ff,nn=mesh_normals(crop)
                image=renderer.draw(pp,nn,ff,src.millimetres(query['centerFineXYZ']),80*.0794*1.25,clip_z=.15)
                x,y=20+column*640,75+row*610
                draw.text((x,y),f'{query["id"]} · '+('Previous polished detail' if column==1 else 'Gentle detailed'),font=font,fill='#e2ecea')
                metric=next(r for r in info['regions'] if r['id']==query['id'])
                draw.text((x,y+27),f'Raw-surface p95 {metric["rawSourceSurfaceToMesh"]["p95Mm"]*1000:.0f} µm',font=font,fill='#aac0bc')
                sheet.paste(Image.fromarray(image),(x,y+54));del local,crop,pp,ff,nn,image
        del points,faces,raw;gc.collect()
        write(OUT/('hosted-baseline-comparison.json' if args.phase=='baseline' else 'hosted-comparison.json'),dict(report,source=src.receipt(),seconds=time.monotonic()-started,peakRssMiB=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024))
    if renderer:
        for row,query in enumerate(queries):
            pp,ff,nn=mesh_normals(query['rawMesh'])
            image=renderer.draw(pp,nn,ff,src.millimetres(query['centerFineXYZ']),80*.0794*1.25,clip_z=.15)
            x,y=20,75+row*610;draw.text((x,y),f'{query["id"]} · measured source',font=font,fill='#e2ecea')
            draw.text((x,y+27),'No additional filtering/simplification',font=font,fill='#aac0bc');sheet.paste(Image.fromarray(image),(x,y+54))
        draw.text((20,1915),'Scientific EGL renderings; no anatomical truth labels. More measured fine geometry includes residual noise.',font=font,fill='#aac0bc')
        sheet.save(OUT/'hosted-comparison.png')

if __name__=='__main__':main()
