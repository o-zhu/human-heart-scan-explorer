#!/usr/bin/env python3
"""Audit connected mesh pieces intersecting screenshot-confirmed candidate ROIs."""
from pathlib import Path
import json
import sys
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).parent))
from fine_sections import mesh_points, Reader

REGIONS = {
    'outflow': ([930, 970, 250], [1110, 1130, 400]),
    'atrial': ([1100, 1000, 660], [1370, 1300, 1080]),
}
SEEDS = {
    'outflow_upper': [980, 1030, 298],
    'outflow_lower': [1010, 1060, 350],
    'atrial_round': [1230, 1184, 760],
    'atrial_long': [1220, 1184, 900],
}


def audit():
    r = Reader(); report = {}
    for lod in ['balanced', 'detail']:
        p, f, item = mesh_points(lod, r.meta)
        a = np.concatenate([f[:, 0], f[:, 1], f[:, 2]])
        b = np.concatenate([f[:, 1], f[:, 2], f[:, 0]])
        graph = coo_matrix((np.ones(len(a), np.uint8), (a,b)), shape=(len(p),len(p))).tocsr()
        nc, labels = connected_components(graph, directed=False)
        del graph,a,b
        counts = np.bincount(labels, minlength=nc)
        bbox_min = np.full((nc,3),np.inf)
        bbox_max = np.full((nc,3),-np.inf)
        for k in range(3):
            np.minimum.at(bbox_min[:,k],labels,p[:,k]); np.maximum.at(bbox_max[:,k],labels,p[:,k])
        triangle_counts = np.bincount(labels[f[:,0]],minlength=nc)
        regions={}
        for name,(lo,hi) in REGIONS.items():
            inside = np.all(p >= lo,axis=1) & np.all(p <= hi,axis=1)
            hitcount = np.bincount(labels[inside],minlength=nc)
            ids=np.flatnonzero(hitcount)
            ids=ids[np.argsort(hitcount[ids])[::-1]][:30]
            regions[name] = [dict(component=int(i),vertices=int(counts[i]),triangles=int(triangle_counts[i]),verticesInsideROI=int(hitcount[i]),boundsFullFineXYZ=[bbox_min[i].tolist(),bbox_max[i].tolist()]) for i in ids]
        seeds={}
        for name,s in SEEDS.items():
            d=np.sum((p-s)**2,axis=1); i=int(np.argmin(d)); label=int(labels[i])
            seeds[name]=dict(seedFullFineXYZ=s,nearestVertexFullFineXYZ=p[i].tolist(),distanceFineVoxels=float(np.sqrt(d[i])),component=label,vertices=int(counts[label]),triangles=int(triangle_counts[label]),boundsFullFineXYZ=[bbox_min[label].tolist(),bbox_max[label].tolist()])
        report[lod]=dict(components=int(nc),mainComponent=int(np.argmax(counts)),regions=regions,seeds=seeds)
        print(json.dumps(dict(lod=lod,components=int(nc),seeds=seeds)),flush=True)
    out=ROOT/'docs/lumen-artifacts-v23/mesh-component-audit.json'
    out.write_text(json.dumps(report,indent=2)+'\n')


if __name__=='__main__':audit()
