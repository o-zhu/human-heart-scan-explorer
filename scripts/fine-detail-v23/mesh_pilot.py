#!/usr/bin/env python3
"""Measure constrained QEM behavior before committing the whole-heart build."""
from __future__ import annotations
import os
os.environ['OMP_NUM_THREADS']='1'
os.environ['OPENBLAS_NUM_THREADS']='1'
import argparse
import gc
import json
from pathlib import Path
import time

import numpy as np
from scipy import ndimage as ndi, sparse
from scipy.sparse.csgraph import connected_components
import vtk
from PIL import Image, ImageDraw, ImageFont

from source import FineSource, ROOT
from compare import PREP, VALIDATE, RENDER, mesh_normals, write
from constrained_qem import simplify


def clean(points,faces):
    cross=np.cross(points[faces[:,1]]-points[faces[:,0]],points[faces[:,2]]-points[faces[:,0]])
    good=np.linalg.norm(cross,axis=1)>1e-12
    f=faces[good]
    used=np.unique(f);mapping=np.zeros(len(points),np.uint32);mapping[used]=np.arange(len(used),dtype=np.uint32)
    return points[used],mapping[f],int((~good).sum())


def topology(points,faces):
    nv=len(points)
    edges=np.concatenate([faces[:,[0,1]],faces[:,[1,2]],faces[:,[2,0]]])
    edges.sort(axis=1)
    ids=edges[:,0].astype(np.uint64)*nv+edges[:,1]
    unique,counts=np.unique(ids,return_counts=True)
    graph=sparse.coo_matrix((np.ones(len(edges),np.uint8),(edges[:,0],edges[:,1])),shape=(nv,nv)).tocsr()
    components,_=connected_components(graph,directed=False)
    return dict(vertices=nv,faces=len(faces),edges=len(unique),euler=int(nv-len(unique)+len(faces)),
                components=int(components),boundaryEdges=int((counts==1).sum()),nonmanifoldEdges=int((counts>2).sum()))


def main():
    p=argparse.ArgumentParser();p.add_argument('--radius',type=int,default=64);p.add_argument('--sigma',type=float,default=.35);a=p.parse_args()
    vtk.vtkSMPTools.Initialize(2)
    out=ROOT/'docs/fine-detail-v23';out.mkdir(parents=True,exist_ok=True)
    work=Path('/workspace/scratch/556c0933fbc6/fine-detail-v23');work.mkdir(parents=True,exist_ok=True)
    src=FineSource(48);renderer=RENDER.SurfaceRenderer(580,520)
    centers=[('lv-inflow',[1160,1092,1152]),('rv-inflow',[928,744,1192]),('outer-wall',[1392,1032,1376])]
    radii=[.1588,.3176,.6352]
    sheet=Image.new('RGB',(2420,1910),'#081116');draw=ImageDraw.Draw(sheet)
    font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',19)
    draw.text((20,18),f'σ{a.sigma:g} source geometry · constrained mesh reduction · same camera within each row',font=font,fill='#e0ecea')
    report=dict(schema='fine-detail-v23-mesh-pilot',sigmaVoxels=a.sigma,targetRatio=.02,
                boundaryPolicy='All mesh boundary vertices are frozen.',
                linkPolicy='Interior two-face edge-link constraint with tetrahedron preservation.',
                radiusMeaning='Conservative accumulated original-vertex displacement bound, not an anatomical error bound.',regions=[])
    for row,(name,c) in enumerate(centers):
        start=time.monotonic();c=np.array(c);lo=c-a.radius;hi=c+a.radius+1
        full=src.region(lo-4,hi+4).astype(np.float32)
        filt=ndi.gaussian_filter(full,a.sigma,truncate=3,mode='constant')[4:-4,4:-4,4:-4]
        reference=PREP.contour(np.ascontiguousarray(filt),src.millimetres(lo),src.spacing_mm)
        points,faces=PREP.arrays(reference);points,faces,removed=clean(points,faces);reference=PREP.poly_from_arrays(points,faces)
        initial=topology(points,faces)
        rng=np.random.default_rng(23003176+row)
        samples=VALIDATE.sample_surface(reference,10000,rng)
        boundary=np.unique(faces[np.isclose(points[faces,2],src.millimetres(lo)[2]).any(axis=1)])
        rec=dict(id=name,originFineXYZ=lo.tolist(),shapeXYZ=(hi-lo).tolist(),reference=initial,zeroAreaRemoved=removed,candidates=[])
        candidates=[('Filtered source',points,faces,None)]
        for radius in radii:
            sp,sf,record=simplify(points,faces,work,radius_mm=radius,target=max(1,int(len(faces)*.02)))
            candidate=PREP.poly_from_arrays(sp,sf)
            record['topology']=topology(sp,sf)
            record['sourceToCandidate']=VALIDATE.stats(VALIDATE.distances(VALIDATE.distance_function(candidate),samples))
            record['sameComponents']=record['topology']['components']==initial['components']
            record['sameEuler']=record['topology']['euler']==initial['euler']
            record['sameBoundaryEdges']=record['topology']['boundaryEdges']==initial['boundaryEdges']
            assert record['sameComponents'] and record['sameEuler'] and record['sameBoundaryEdges'],record
            candidates.append((f'Radius limit {radius:g} mm',sp,sf,record))
            rec['candidates'].append(record)
            print(json.dumps(dict(region=name,**record)),flush=True)
            del candidate
        for col,(title,cp,cf,record) in enumerate(candidates):
            mesh=PREP.poly_from_arrays(cp,cf);pp,ff,nn=mesh_normals(mesh)
            image=renderer.draw(pp,nn,ff,src.millimetres(c),a.radius*src.spacing_mm*1.25,clip_z=.15)
            x,y=20+col*600,62+row*600
            draw.text((x,y),f'{name} · {title}',font=font,fill='#e0ecea')
            draw.text((x,y+25),f'{len(cf):,} triangles'+(f' · p95 {record["sourceToCandidate"]["p95Mm"]*1000:.1f} µm' if record else ''),font=font,fill='#a4b7b5')
            sheet.paste(Image.fromarray(image),(x,y+52))
            del mesh,pp,ff,nn,image
        rec['seconds']=time.monotonic()-start;report['regions'].append(rec)
        write(out/f'mesh-pilot-sigma-{a.sigma:g}.json',dict(report,source=src.receipt()))
        del candidates,full,filt,reference,points,faces,samples
        gc.collect()
    draw.text((20,sheet.height-36),'Geometric constraints preserve measured fine structure and noise alike. Unchanged intensity threshold; no anatomical truth labels.',font=font,fill='#a4b7b5')
    sheet.save(out/f'mesh-pilot-sigma-{a.sigma:g}.png')

if __name__=='__main__':main()
