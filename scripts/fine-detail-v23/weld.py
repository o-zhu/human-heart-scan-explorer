#!/usr/bin/env python3
"""Weld only genuine open slab contours, preserving closed tangent components.

A closed surface may touch a slab plane at one point. That point has no seam
edge and must not be snapped to a different component in the adjacent slab.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import time

import numpy as np
from scipy.spatial import cKDTree

from source import ROOT
from prepare import PREP


def remove_zero_area(points,faces):
    valid=np.ones(len(faces),bool)
    for start in range(0,len(faces),400_000):
        f=faces[start:start+400_000]
        valid[start:start+len(f)]=np.linalg.norm(np.cross(points[f[:,1]]-points[f[:,0]],points[f[:,2]]-points[f[:,0]]),axis=1)>1e-12
    return faces[valid],int((~valid).sum())


def open_plane_edges(points,faces,plane):
    used=np.zeros(len(points),bool);used[faces]=True
    on=(points[:,2]==plane)&used;values=[];n=len(points)
    for a,b in [(0,1),(1,2),(2,0)]:
        keep=on[faces[:,a]]&on[faces[:,b]]&(faces[:,a]!=faces[:,b])
        edge=faces[keep][:,[a,b]];edge.sort(axis=1)
        values.append(edge[:,0].astype(np.uint64)*n+edge[:,1])
    keys,counts=np.unique(np.concatenate(values),return_counts=True)
    opened=keys[counts==1]
    edges=np.stack([opened//n,opened%n],axis=1).astype(np.uint32)
    vertices=np.unique(edges)
    return vertices,edges,dict(allPlaneVertices=int(on.sum()),openPlaneVertices=len(vertices),
                               closedTangentPlaneVertices=int(on.sum())-len(vertices),
                               openPlaneEdges=len(edges),overIncidentPlaneEdges=int((counts>2).sum()))


def run(work):
    started=time.monotonic();work=Path(work)
    extraction=json.loads((work/'extraction.json').read_text());meta=json.loads((work/'source-ready.json').read_text());config=json.loads((work/'configuration.json').read_text())
    assert not extraction['partial'] and extraction['fingerprint']==config['fingerprint']
    expected=[(z,min(z+config['slabCells'],meta['shapeZYX'][0]-1)) for z in range(0,meta['shapeZYX'][0]-1,config['slabCells'])]
    assert [(s['z0'],s['z1']) for s in extraction['slabs']]==expected
    extraction_hash=PREP.digest(work/'extraction.json');script_hash=PREP.digest(Path(__file__))
    target=work/'welded-reference.npz';record=work/'weld.json'
    if target.exists() and record.exists():
        old=json.loads(record.read_text())
        if old.get('extractionSha256')==extraction_hash and old.get('algorithmScriptSha256')==script_hash and PREP.digest(target)==old['sha256']:
            return old
    spacing=.0794;origin=(np.array(meta['paddedOriginXYZ'])-(np.array(meta['fullDimensionsXYZ'])-1)/2)*spacing
    blocks=[];face_blocks=[];total=0;previous=None;aliases={};seams=[];tolerance=.0001;zero_area_removed=0
    def canonical(index):
        index=int(index)
        while index in aliases:index=aliases[index]
        return index
    def alias(a,b):
        a,b=canonical(a),canonical(b)
        if a!=b:aliases[max(a,b)]=min(a,b)
    for item in extraction['slabs']:
        path=work/'slabs'/f"{item['z0']:04}-{item['z1']:04}.npz";assert PREP.digest(path)==item['sha256']
        with np.load(path) as data:points,faces=data['points'],data['faces']
        faces,zero_area=remove_zero_area(points,faces);zero_area_removed+=zero_area
        low=np.float32(origin[2]+item['z0']*spacing);high=np.float32(origin[2]+item['z1']*spacing)
        bottom,bottom_edges,bottom_info=open_plane_edges(points,faces,low)
        top,top_edges,top_info=open_plane_edges(points,faces,high)
        mapping=np.empty(len(points),np.uint32);new=np.ones(len(points),bool)
        exact=numerical=alias_count=0;displacement=0.
        if previous is not None:
            previous_points,previous_indices,previous_edges=previous
            assert bool(len(bottom))==bool(len(previous_points)),('Different open seam support',item['z0'])
            if len(bottom):
                current=points[bottom];forward,nearest=cKDTree(previous_points).query(current);backward,reverse=cKDTree(current).query(previous_points)
                assert max(forward.max(),backward.max())<=tolerance,(item['z0'],float(forward.max()),float(backward.max()),'Unmatched open contour')
                mapping[bottom]=previous_indices[nearest];new[bottom]=False
                before=len(aliases)
                for i,j in enumerate(reverse):alias(previous_indices[i],mapping[bottom[j]])
                mapping[bottom]=np.array([canonical(v) for v in mapping[bottom]],np.uint32)
                lookup={int(index):point for index,point in zip(previous_indices,previous_points)}
                previous_canonical=np.array([lookup[canonical(v)] for v in previous_indices]);current_canonical=np.array([lookup[int(v)] for v in mapping[bottom]])
                displacement=max(float(np.linalg.norm(previous_points-previous_canonical,axis=1).max()),float(np.linalg.norm(current-current_canonical,axis=1).max()))
                assert displacement<=tolerance
                exact=int((forward==0).sum());numerical=int((forward>0).sum());alias_count=len(aliases)-before
        mapping[new]=np.arange(total,total+int(new.sum()),dtype=np.uint32)
        blocks.append(points[new]);face_blocks.append(mapping[faces]);total+=int(new.sum())
        previous=(points[top].copy(),mapping[top].copy(),mapping[top_edges].copy())
        seams.append(dict(z=item['z0'],exactMatches=exact,numericalMatches=numerical,aliasedPreviousVertices=alias_count,
                          maximumWeldDisplacementMm=displacement,unmatched=0,bottom=bottom_info,top=top_info))
    points=np.concatenate(blocks);faces=np.concatenate(face_blocks);del blocks,face_blocks
    remap=np.arange(len(points),dtype=np.uint32)
    for index in aliases:remap[index]=canonical(index)
    faces=remap[faces];del remap
    valid=(faces[:,0]!=faces[:,1])&(faces[:,1]!=faces[:,2])&(faces[:,0]!=faces[:,2]);collapsed=int((~valid).sum());faces=faces[valid];del valid
    used=np.zeros(len(points),bool);used[faces]=True;remap=np.cumsum(used,dtype=np.uint32)-1
    points=points[used];faces=remap[faces]
    PREP.save_arrays(target,points=points,faces=faces)
    result=dict(schema='fine-detail-v23-weld',fingerprint=config['fingerprint'],vertices=len(points),triangles=len(faces),
                boundaryPolicy='Match only vertices incident to genuine open plane edges; retain closed components that merely touch a plane.',
                seams=seams,weldToleranceMm=tolerance,maximumWeldDisplacementMm=max(s['maximumWeldDisplacementMm'] for s in seams),
                degenerateTrianglesRemoved=collapsed,numericalBoundaryAliases=len(aliases),extractionSha256=extraction_hash,
                preWeldZeroAreaTrianglesRemoved=zero_area_removed,
                algorithmScriptSha256=script_hash,sha256=PREP.digest(target),seconds=time.monotonic()-started)
    PREP.save_json(record,result);PREP.save_json(ROOT/'docs/fine-detail-v23/weld.json',result)
    PREP.log(stage='gentle-weld',**{k:v for k,v in result.items() if k!='seams'})
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--work',type=Path,required=True);args=parser.parse_args();run(args.work)
