#!/usr/bin/env python3
"""Replay an unchanged failed slab and capture exact boundary diagnostics.

This tool does not bypass the original check or write a successful checkpoint.
It records the original reducer output when the original assertion fails.
"""
from __future__ import annotations
import argparse
from collections import Counter
import json
from pathlib import Path
import struct
import sys
import time

import numpy as np

import prepare
from source import ROOT
from weld import open_plane_edges,remove_zero_area


def coordinate_keys(points):
    return [row.tobytes() for row in np.ascontiguousarray(points,dtype='<f4')]


def edge_keys(points,edges):
    pairs=np.ascontiguousarray(points[edges],dtype='<f4').reshape(-1,2,3).view('V12').reshape(-1,2)
    pairs.sort(axis=1)
    return Counter(row.tobytes() for row in pairs)


def diagnose(work,z0,z1):
    work=Path(work);directory=work/'diagnostics'/f'{z0:04}-{z1:04}';directory.mkdir(parents=True,exist_ok=True)
    config=json.loads((work/'configuration.json').read_text());meta=json.loads((work/'source-ready.json').read_text())
    origin=(np.array(meta['paddedOriginXYZ'])-(np.array(meta['fullDimensionsXYZ'])-1)/2)*.0794
    planes=[np.float32(origin[2]+z0*.0794),np.float32(origin[2]+z1*.0794)]
    original_run=prepare.subprocess.run;before={}
    def inspect_then_run(command,*args,**kwargs):
        if str(command[0])==str(work/'bin/constrained-qem'):
            path=Path(command[1])
            with path.open('rb') as stream:nv,nf=struct.unpack('<QQ',stream.read(16))
            points=np.memmap(path,'<f4',mode='r',offset=16,shape=(nv,3))
            faces=np.memmap(path,'<u4',mode='r',offset=16+nv*12,shape=(nf,3))
            f,zeros=remove_zero_area(points,faces)
            arrays={}
            for name,plane in zip(['lower','upper'],planes):
                indices,edges,info=open_plane_edges(points,f,plane)
                frozen=np.asarray(points[points[:,2]==plane]).copy()
                before[name]=dict(frozen=frozen,edgeKeys=edge_keys(points,edges),plane=float(plane),info=info)
                arrays[name+'Frozen']=frozen;arrays[name+'OpenEdgeCoordinates']=np.asarray(points[edges]).copy()
            before['inputZeroAreaFaces']=zeros
            prepare.PREP.save_arrays(directory/'input-boundaries.npz',**arrays)
            del points,faces,f
        return original_run(command,*args,**kwargs)
    prepare.subprocess.run=inspect_then_run
    try:
        prepare.slab(work,z0,z1)
    except AssertionError as error:
        tb=error.__traceback__
        while tb and tb.tb_frame.f_code.co_name!='slab':tb=tb.tb_next
        assert tb is not None and 'boundary count changed' in str(error),('Unexpected failure',str(error))
        values=tb.tb_frame.f_locals;points,faces=values['points'],values['faces']
        prepare.PREP.save_arrays(directory/'reducer-output.npz',points=points,faces=faces)
        clean,zeros=remove_zero_area(points,faces);report=[]
        for name,plane in zip(['lower','upper'],planes):
            frozen=before[name]['frozen'];plane_indices=np.flatnonzero(points[:,2]==plane)
            original=Counter(coordinate_keys(frozen));present=Counter(coordinate_keys(points[plane_indices]))
            added=present-original;missing=original-present
            boundary,edges,info=open_plane_edges(points,clean,plane)
            after_edges=edge_keys(points,edges)
            non_open=np.setdiff1d(plane_indices,boundary);available=Counter(coordinate_keys(points[non_open]))
            closed_extra=all(available[key]>=count for key,count in added.items())
            extra_coordinates=[dict(xyzMm=np.frombuffer(key,'<f4').tolist(),multiplicity=count) for key,count in added.items()]
            report.append(dict(plane=name,planeMm=float(plane),originalFrozenVertices=len(frozen),outputPlaneVertices=len(plane_indices),
                               missingOriginalFrozenVertices=sum(missing.values()),addedPlaneVertices=sum(added.values()),
                               originalOpenEdges=sum(before[name]['edgeKeys'].values()),outputOpenEdges=sum(after_edges.values()),
                               missingOpenEdges=sum((before[name]['edgeKeys']-after_edges).values()),addedOpenEdges=sum((after_edges-before[name]['edgeKeys']).values()),
                               everyAddedVertexCanBeAssignedToClosedGeometry=closed_extra,addedCoordinates=extra_coordinates))
        summary=dict(schema='fine-detail-v23-slab-diagnostic',z0=z0,z1=z1,fingerprint=config['fingerprint'],
                     originalAssertion=str(error),scientificExtractionCodeChanged=False,checkpointRecovered=False,
                     diagnosisScriptSha256=prepare.PREP.digest(Path(__file__)),originalPrepareSha256=prepare.PREP.digest(Path(prepare.__file__)),
                     inputBoundarySha256=prepare.PREP.digest(directory/'input-boundaries.npz'),outputSha256=prepare.PREP.digest(directory/'reducer-output.npz'),
                     inputZeroAreaFaces=before['inputZeroAreaFaces'],outputZeroAreaFaces=zeros,planes=report,
                     originalRun=dict(source=values['source_receipt'],reduction=values['reduction'],referenceVertices=values['original_vertices'],referenceTriangles=values['original_faces'],
                                      removedZeroAreaTriangles=values['removed_zero'],vertices=len(points),triangles=len(faces),
                                      lowBoundaryVertices=len(values['frozen_low']),highBoundaryVertices=len(values['frozen_high']),seconds=time.monotonic()-values['started']))
        prepare.PREP.save_json(directory/'diagnostic.json',summary)
        prepare.PREP.save_json(ROOT/'docs/fine-detail-v23/slab-1536-diagnostic.json',summary)
        print(json.dumps(summary),flush=True)
        return summary
    finally:prepare.subprocess.run=original_run
    raise AssertionError('Slab did not reproduce the recorded failure; inspect its ordinary checkpoint.')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--work',type=Path,required=True);parser.add_argument('--z0',type=int,required=True);parser.add_argument('--z1',type=int,required=True)
    args=parser.parse_args();diagnose(args.work,args.z0,args.z1)
