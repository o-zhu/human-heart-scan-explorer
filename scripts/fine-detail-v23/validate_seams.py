#!/usr/bin/env python3
"""Verify seam-edge incidence under the exact existing numerical weld rule."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import time

import numpy as np
from scipy.spatial import cKDTree

from source import ROOT
from prepare import PREP
from weld import open_plane_edges,remove_zero_area


def plane_edges(points,faces,indices,roots,base):
    mapping=np.full(len(points),-1,np.int64);mapping[indices]=roots
    on=mapping[faces]
    valid=np.ones(len(faces),bool)
    for a,b in [(0,1),(1,2),(2,0)]:valid&=(on[:,a]<0)|(on[:,b]<0)|(on[:,a]!=on[:,b])
    values=[]
    for a,b in [(0,1),(1,2),(2,0)]:
        keep=valid&(on[:,a]>=0)&(on[:,b]>=0)
        lo=np.minimum(on[keep,a],on[keep,b]).astype(np.uint64);hi=np.maximum(on[keep,a],on[keep,b]).astype(np.uint64)
        values.append(lo*np.uint64(base)+hi)
    return np.unique(np.concatenate(values),return_counts=True)


def encoded_nonzero(points,faces,meta):
    extent=np.asarray(meta['extent']);world=points.astype(np.float64)[:,[0,2,1]]*np.array([1,1,-1])/meta['longestMm']
    q=np.rint(np.clip((world+extent/2)/extent,0,1)*65535).astype(np.int64)
    good=np.ones(len(faces),bool)
    for start in range(0,len(faces),400_000):
        f=faces[start:start+400_000];good[start:start+len(f)]=np.any(np.cross(q[f[:,1]]-q[f[:,0]],q[f[:,2]]-q[f[:,0]])!=0,axis=1)
    return faces[good]


def run(work):
    started=time.monotonic();meta=json.loads((work/'source-ready.json').read_text());config=json.loads((work/'configuration.json').read_text())
    records=[]
    for path in sorted((work/'slabs').glob('*.json')):
        record=json.loads(path.read_text())
        if record.get('fingerprint')==config['fingerprint']:records.append(record)
    origin=(np.array(meta['paddedOriginXYZ'])-(np.array(meta['fullDimensionsXYZ'])-1)/2)*.0794
    report=dict(schema='fine-detail-v23-seam-audit',fingerprint=config['fingerprint'],weldToleranceMm=.0001,
        scope='Boundary vertex aliasing and edge incidence before HFM quantization; not a whole-organ anatomical/topology guarantee.',seams=[])
    for left,right in zip(records,records[1:]):
        if left['z1']!=right['z0']:continue
        z=left['z1'];plane=np.float32(origin[2]+z*.0794)
        path_a=work/'slabs'/f"{left['z0']:04}-{left['z1']:04}.npz";path_b=work/'slabs'/f"{right['z0']:04}-{right['z1']:04}.npz"
        assert PREP.digest(path_a)==left['sha256'] and PREP.digest(path_b)==right['sha256']
        with np.load(path_a) as a, np.load(path_b) as b:
            ap,af=a['points'],a['faces'];bp,bf=b['points'],b['faces']
        af,azero=remove_zero_area(ap,af);bf,bzero=remove_zero_area(bp,bf)
        ai,_,ainfo=open_plane_edges(ap,af,plane);bi,_,binfo=open_plane_edges(bp,bf,plane)
        assert bool(len(ai))==bool(len(bi))
        if not len(ai):
            report['seams'].append(dict(z=z,leftVertices=0,rightVertices=0,unmatchedOpenEdges=0,combinedBoundaryEdges=0,combinedOverIncidentEdges=0));continue
        da,forward=cKDTree(ap[ai]).query(bp[bi]);db,backward=cKDTree(bp[bi]).query(ap[ai])
        max_distance=float(max(da.max(),db.max()));assert max_distance<=.0001,(z,max_distance,len(ai),len(bi),int((da>.0001).sum()),int((db>.0001).sum()))
        parent=np.arange(len(ai))
        def root(i):
            while parent[i]!=i:
                parent[i]=parent[parent[i]];i=parent[i]
            return int(i)
        for i,j in enumerate(forward[backward]):
            x,y=root(i),root(int(j))
            if x!=y:parent[max(x,y)]=min(x,y)
        canonical=np.array([root(i) for i in range(len(ai))],np.int64)
        ae,ac=plane_edges(ap,af,ai,canonical,len(ai))
        be,bc=plane_edges(bp,bf,bi,canonical[forward],len(ai))
        left_open=ae[ac==1];right_open=be[bc==1]
        unmatched=int(len(np.setxor1d(left_open,right_open)))
        combined=np.concatenate([ae,be]);keys,inverse=np.unique(combined,return_inverse=True)
        counts=np.zeros(len(keys),np.int64);np.add.at(counts,inverse,np.concatenate([ac,bc]))
        over=int((counts>2).sum());remaining=over
        if over:
            # Apply the same canonical seam coordinates and zero-area encoding
            # cull as the final mesh. This does not alter any checkpoint.
            aq=ap.copy();bq=bp.copy();aq[ai]=ap[ai[canonical]];bq[bi]=ap[ai[canonical[forward]]]
            aqf=encoded_nonzero(aq,af,meta);bqf=encoded_nonzero(bq,bf,meta)
            aeq,acq=plane_edges(aq,aqf,ai,canonical,len(ai));beq,bcq=plane_edges(bq,bqf,bi,canonical[forward],len(ai))
            qkeys,qindex=np.unique(np.concatenate([aeq,beq]),return_inverse=True);qcounts=np.zeros(len(qkeys),np.int64)
            np.add.at(qcounts,qindex,np.concatenate([acq,bcq]));remaining=int((qcounts>2).sum())
        rec=dict(z=z,leftVertices=len(ai),rightVertices=len(bi),aliasedLeftVertices=int((canonical!=np.arange(len(ai))).sum()),
                 leftClosedTangentVerticesPreserved=ainfo['closedTangentPlaneVertices'],rightClosedTangentVerticesPreserved=binfo['closedTangentPlaneVertices'],
                 leftZeroAreaFacesExcluded=azero,rightZeroAreaFacesExcluded=bzero,
                 maximumNearestCoordinateDifferenceMm=max_distance,leftOpenEdges=len(left_open),rightOpenEdges=len(right_open),
                 unmatchedOpenEdges=unmatched,combinedBoundaryEdges=int((counts==1).sum()),combinedOverIncidentEdges=over,
                 overIncidentEdgesRemainingAfterEncodingCull=remaining,overIncidentEdgesResolvedByEncodingCull=over-remaining)
        assert not unmatched and not rec['combinedBoundaryEdges'],rec
        report['seams'].append(rec)
    expected_seams=(meta['shapeZYX'][0]-2)//config['slabCells']
    report.update(complete=len(report['seams'])==expected_seams,checkedSeams=len(report['seams']),
                  unmatchedOpenEdges=sum(s['unmatchedOpenEdges'] for s in report['seams']),
                  combinedBoundaryEdges=sum(s['combinedBoundaryEdges'] for s in report['seams']),
                  combinedOverIncidentEdges=sum(s['combinedOverIncidentEdges'] for s in report['seams']),
                  overIncidentEdgesRemainingAfterEncodingCull=sum(s.get('overIncidentEdgesRemainingAfterEncodingCull',0) for s in report['seams']),
                  extractionSha256=PREP.digest(work/'extraction.json'),
                  seconds=time.monotonic()-started)
    PREP.save_json(ROOT/'docs/fine-detail-v23/seam-audit.json',report)
    print(json.dumps({k:v for k,v in report.items() if k!='seams'}))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--work',type=Path,required=True);args=parser.parse_args();run(args.work)
