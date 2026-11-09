#!/usr/bin/env python3
"""Build bounded candidate additions; never mutates frozen or active assets.

The callable build_operation(reader, operation) returns lower XYZ, exclusive
upper XYZ, boolean ZYX exclusion and an auditable policy. Source and original
geometry remain immutable. The parent build owns integration into the four
versioned lumen masks.
"""
from pathlib import Path
import argparse
import gc
import hashlib
import importlib.util
import json
import sys
import time
import numpy as np
from scipy import ndimage as ndi
from matplotlib.path import Path as Polygon

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/fine-detail-v23'))
from source import FineSource
selection_spec=importlib.util.spec_from_file_location('left_sheet_selections_v28',Path(__file__).with_name('selections.py'))
selection_module=importlib.util.module_from_spec(selection_spec);selection_spec.loader.exec_module(selection_module)
OPERATIONS=selection_module.OPERATIONS

def digest(data): return hashlib.sha256(data).hexdigest()

def bbox_slice(lo, hi, origin):
    return tuple(slice(int(a),int(b)) for a,b in zip((lo-origin)[::-1],(hi-origin)[::-1]))

def signed_fields(polygons,lo,hi):
    z,x=np.mgrid[lo[2]:hi[2],lo[0]:hi[0]]
    points=np.column_stack([x.ravel(),z.ravel()])
    fields={}
    for y,vertices in polygons.items():
        inside=Polygon(vertices).contains_points(points).reshape(z.shape)
        fields[y]=(ndi.distance_transform_edt(~inside)-ndi.distance_transform_edt(inside)).astype(np.float32)
    return fields

def interpolate(fields,y):
    keys=sorted(fields)
    if y<keys[0] or y>keys[-1]: return None
    right=min(int(np.searchsorted(keys,y,side='right')),len(keys)-1)
    left=max(0,right-1)
    a,b=keys[left],keys[right]
    t=0 if a==b else (y-a)/(b-a)
    return fields[a]*(1-t)+fields[b]*t

def restoration_footprint(reader):
    spec=importlib.util.spec_from_file_location('frozen_v27_wall_repair',ROOT/'scripts/cleanup-v27-wall/restore_wall.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    lo,hi,bits,report=module.restore_all_selections(reader)
    assert report['restoreMaskSha256']=='ac5d0d8771272e5bb14e0ae8ef13aea171c8abeda24d754e0345e1328aa5fbea'
    return lo,hi,bits,report

def build_operation(reader,op,repair=None):
    margin=9;pad=13
    points=np.array([p for polygon in op['polygons'].values() for p in polygon])
    ys=sorted(op['polygons'])
    lo=np.array([points[:,0].min()-margin-2,ys[0],points[:,1].min()-margin-2],int)
    hi=np.array([points[:,0].max()+margin+3,ys[-1]+1,points[:,1].max()+margin+3],int)
    result=np.zeros(tuple((hi-lo)[::-1]),bool)
    fields=signed_fields(op['polygons'],lo-pad,hi+pad)
    totals=dict(selectedSamples=0,selectedSourceForegroundSamples=0,selectedDenseObjectSamples=0,protectedDenseOutsideObjectOverlapSamples=0,protectedCollarOverlapSamples=0,additionalVersusTenSampleGuardSamples=0)
    serial=[]
    for start in range(int(lo[1]),int(hi[1]),24):
        stop=min(start+24,int(hi[1]))
        a=lo-pad;b=hi+pad;a[1]=start-pad;b[1]=stop+pad
        raw=reader.region(a,b)
        f05=ndi.gaussian_filter(raw.astype(np.float32),.5,truncate=3)
        f08=ndi.gaussian_filter(raw.astype(np.float32),.8,truncate=3)
        strong=(raw>=190)|(f05>=135)|(f08>=135)
        protected=strong.copy()
        for j,y in enumerate(range(start-pad,stop+pad)):
            field=interpolate(fields,y)
            if field is not None: protected[:,j,:]&=field>0
        distance=ndi.distance_transform_edt(~protected)
        support=ndi.distance_transform_edt(~(f05>=71.4))<=margin
        for y in range(start,stop):
            j=y-(start-pad);field=interpolate(fields,y)
            core=field<=0;envelope=field<=op['expansion']
            allowed=envelope&(distance[:,j,:]>op['guard'])
            labels,_=ndi.label(allowed,np.ones((3,3),bool))
            seeds=np.unique(labels[core&allowed]);seeds=seeds[seeds!=0]
            selected=allowed&support[:,j,:]&np.isin(labels,seeds)
            crop=(slice(pad,-pad),slice(pad,-pad));q=selected[crop]
            result[:,y-lo[1],:]=q
            record=dict(y=y,
              selectedSamples=int(q.sum()),
              selectedSourceForegroundSamples=int(np.count_nonzero(q&(f05[pad:-pad,j,pad:-pad]>=71.4))),
              selectedDenseObjectSamples=int(np.count_nonzero(q&strong[pad:-pad,j,pad:-pad])),
              protectedDenseOutsideObjectOverlapSamples=int(np.count_nonzero(q&protected[pad:-pad,j,pad:-pad])),
              protectedCollarOverlapSamples=int(np.count_nonzero(q&(distance[pad:-pad,j,pad:-pad]<=op['guard']))),
              additionalVersusTenSampleGuardSamples=int(np.count_nonzero(q&(distance[pad:-pad,j,pad:-pad]<=10))))
            for key in totals: totals[key]+=record[key]
            if y in fields: serial.append(record)
        del raw,f05,f08,strong,protected,distance,support;gc.collect()
        print(json.dumps(dict(operation=op['id'],slabY=[start,stop])),flush=True)
    restore_overlap=0
    if repair is not None:
        ra,rb,restored,_=repair;aa=np.maximum(lo,ra);bb=np.minimum(hi,rb)
        if np.all(bb>aa): restore_overlap=int(np.count_nonzero(result[bbox_slice(aa,bb,lo)]&restored[bbox_slice(aa,bb,ra)]))
        assert restore_overlap==0, 'Candidate would cross a frozen wall-restoration footprint.'
    assert result.any()
    assert totals['protectedDenseOutsideObjectOverlapSamples']==0
    assert totals['protectedCollarOverlapSamples']==0
    policy={**op,**totals,'lowerFullFineXYZ':lo.tolist(),'upperFullFineXYZ':hi.tolist(),
      'logicalSelectionSha256':digest(result.tobytes()),
      'meshSupportMarginFineSamples':margin,'sourcePaddingFineSamples':pad,
      'restoredWallFootprintOverlapSamples':restore_overlap,
      'serialChecks':serial,
      'explicitSelectedObjectException':True,
      'method':'Serial source-traced free-sheet polygons with interpolated signed-distance boundaries. Nine-sample source isovalue support allowance. Four-sample 3D guard around raw>=190 or sigma0.5/0.8>=135 source outside the selected object. A connected attachment elsewhere no longer rejects the free sheet on the entire plane.',
      'intensityUnits':'Windowed display-u8; not calibrated HU.',
      'sourceIdentity':'Unverified material identity; reversible user-requested visualization selection.',
      'unchanged':'Original 2D source pixels and original mesh positions, normals and indices.'}
    return lo,hi,result,policy

def build_all(reader=None,output=None):
    reader=reader or FineSource(cache_bricks=32)
    repair=restoration_footprint(reader)
    output=Path(output or ROOT/'docs/cleanup-v28-left/candidates');output.mkdir(parents=True,exist_ok=True)
    records=[]
    for op in OPERATIONS:
        lo,hi,bits,policy=build_operation(reader,op,repair)
        path=output/(op['id']+'-selection.npz')
        np.savez_compressed(path,lowerXYZ=lo,upperXYZ=hi,mask=bits)
        (output/(op['id']+'-policy.json')).write_text(json.dumps(policy,indent=2)+'\n')
        records.append(dict(operation=op['id'],maskId=op['mask'],file=str(path.relative_to(ROOT)),sha256=digest(path.read_bytes()),**{k:policy[k] for k in ('logicalSelectionSha256','lowerFullFineXYZ','upperFullFineXYZ','selectedSamples','selectedSourceForegroundSamples','additionalVersusTenSampleGuardSamples','restoredWallFootprintOverlapSamples')}))
        del bits;gc.collect()
    receipt=dict(source=reader.receipt(),wallRestorationSha256=repair[3]['restoreMaskSha256'],operations=records)
    (output/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    return receipt

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path);args=parser.parse_args()
    print(json.dumps(build_all(output=args.output),indent=2))
