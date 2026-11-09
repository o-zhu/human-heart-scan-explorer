#!/usr/bin/env python3
"""Bounded, reversible source-derived surface refinement.

This replaces the low-isovalue surface locally, rather than punching holes in
it. Only reviewed interior polygons raise the threshold. The box collar and
polygon boundary remain at the original 71.4 mapped-intensity isovalue. The
immutable source is display uint8, NOT calibrated HU. No clinical material
classification is implied.
"""
from pathlib import Path
import os,sys,json,gzip,hashlib,struct,gc
os.environ.setdefault('OPENBLAS_NUM_THREADS','1')
os.environ.setdefault('OMP_NUM_THREADS','1')
import numpy as np
from scipy import ndimage as ndi
from matplotlib.path import Path as Polygon
from skimage.measure import marching_cubes
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/fine-detail-v23'))
from source import FineSource
BASE=71.4

def sha(data):return hashlib.sha256(data).hexdigest()
def smoothstep(x):
    x=np.clip(x,0,1);return x*x*(3-2*x)
def fields_for(config):
    lo=np.array(config['lowerXYZ']);hi=np.array(config['upperXYZ'])
    axis=config.get('sliceAxis',1);horizontal=1 if axis==0 else 0
    assert axis in (0,1)
    z,x=np.mgrid[lo[2]:hi[2],lo[horizontal]:hi[horizontal]]
    pts=np.column_stack([x.ravel(),z.ravel()]);fields={}
    for y,poly in config['polygons'].items():
        p=Polygon(poly).contains_points(pts).reshape(x.shape)
        fields[int(y)]=(ndi.distance_transform_edt(p)-ndi.distance_transform_edt(~p)).astype(np.float32)
    return fields
def threshold_plane(config,fields,y):
    lo=np.array(config['lowerXYZ']);hi=np.array(config['upperXYZ']);keys=sorted(fields)
    axis=config.get('sliceAxis',1);horizontal=1 if axis==0 else 0
    shape=(hi[2]-lo[2],hi[horizontal]-lo[horizontal]);weight=np.zeros(shape,np.float32)
    if y<keys[0] or y>keys[-1]:return weight+BASE
    r=min(int(np.searchsorted(keys,y,side='right')),len(keys)-1);l=max(0,r-1)
    a,b=keys[l],keys[r];t=0 if a==b else (y-a)/(b-a)
    d=fields[a]*(1-t)+fields[b]*t
    taper=config.get('polygonCollarSamples',12)
    weight=smoothstep(d/taper).astype(np.float32)
    # Every axis ends at the original source level, including 3-D corners.
    z=np.arange(lo[2],hi[2])[:,None];x=np.arange(lo[horizontal],hi[horizontal])[None,:]
    margin=np.minimum(np.minimum(x-lo[horizontal],hi[horizontal]-1-x),np.minimum(z-lo[2],hi[2]-1-z))
    margin=np.minimum(margin,min(y-lo[axis],hi[axis]-1-y))
    weight*=smoothstep(margin/config.get('boxCollarSamples',8))
    weight*=smoothstep(min(y-keys[0],keys[-1]-y)/config.get('endCollarSamples',12))
    return (BASE+(config['interiorThreshold']-BASE)*weight).astype(np.float32)

def world_from_fine(points,meta):
    q=(points-(np.asarray(meta['fullDimensionsXYZ'])-1)/2)*.0794/meta['longestMm']
    return (q[:,[0,2,1]]*np.array([1,1,-1])).astype('<f4')

def write_surface(path,vertices,normals,faces,meta,lo,hi):
    vertices=world_from_fine(vertices,meta)
    normals=(normals[:,[0,2,1]]*np.array([1,1,-1])).astype(np.float32)
    lengths=np.linalg.norm(normals,axis=1);normals/=lengths[:,None]
    encoded_normals=np.rint(np.clip(normals,-1,1)*32767).astype('<i2')
    faces=np.asarray(faces,dtype='<u4')
    # skimage emits array-ZYX positions. Reversing ZYX->XYZ flips handedness;
    # make triangle orientation agree with the returned outward normals.
    n=vertices[faces[:,1]]-vertices[faces[:,0]];m=vertices[faces[:,2]]-vertices[faces[:,0]]
    alignment=np.einsum('ij,ij->i',np.cross(n,m),normals[faces[:,0]])
    if np.median(alignment)<0:faces=faces[:,[0,2,1]].copy()
    del n,m,alignment
    po=32;no=po+vertices.nbytes;io=(no+encoded_normals.nbytes+3)&~3
    header=struct.pack('<8I',0x31524653,1,len(vertices),faces.size,po,no,io,0)
    payload=header+vertices.tobytes()+encoded_normals.tobytes()+bytes(io-no-encoded_normals.nbytes)+faces.tobytes()
    packed=gzip.compress(payload,6,mtime=0);path.write_bytes(packed)
    corners=world_from_fine(np.array([lo,hi-1]),meta)
    return dict(format='SFR1-gzip',file=path.name,vertices=len(vertices),triangles=len(faces),
      vertexCount=len(vertices),indexCount=faces.size,positionOffset=po,normalOffset=no,indexOffset=io,
      compressedBytes=len(packed),decodedBytes=len(payload),sha256=sha(packed),decodedSha256=sha(payload),
      bounds={'min':corners.min(axis=0).tolist(),'max':corners.max(axis=0).tolist()},
      positionEncoding='float32 world XYZ',normalEncoding='int16 normalized world XYZ',indexEncoding='uint32',
      winding='Triangle geometric normal agrees with outward encoded normal')

def build_patch(reader,config,out_dir):
    """Return patch metadata; write surface, exact low-band bitset, and policy.

    upperXYZ is exclusive. Runtime replacement bounds enclose samples from
    lowerXYZ through upperXYZ-1 inclusive. Geometry is source-isosurface only;
    there are no invented caps closing the rectangular crop.
    """
    out_dir=Path(out_dir);out_dir.mkdir(parents=True,exist_ok=True)
    lo=np.asarray(config['lowerXYZ'],int);hi=np.asarray(config['upperXYZ'],int)
    assert np.all(hi-lo>20) and np.prod(hi-lo)<70_000_000
    assert BASE<config['interiorThreshold']<=120
    pad=3;raw=reader.region(lo-pad,hi+pad)
    source_hash=sha(memoryview(raw))
    smoothed=ndi.gaussian_filter(raw.astype(np.float32),.5,truncate=3)[pad:-pad,pad:-pad,pad:-pad].copy()
    source_core=raw[pad:-pad,pad:-pad,pad:-pad]
    raw_core_hash=sha(np.ascontiguousarray(source_core))
    fields=fields_for(config);dims=hi-lo
    removed=np.zeros(tuple(dims[::-1]),bool)
    counts={'originalForeground':0,'refinedForeground':0,'removedForeground':0,'protected135Samples':0,'lostProtected135Samples':0,'raw190Samples':0,'lostRaw190Samples':0,'maximumLocalThreshold':BASE,'boxBoundaryNonBaselineSamples':0}
    serial=[]
    slice_axis=config.get('sliceAxis',1)
    for j,y in enumerate(range(lo[slice_axis],hi[slice_axis])):
        sl=(slice(None),j,slice(None)) if slice_axis==1 else (slice(None),slice(None),j)
        p=smoothed[sl];threshold=threshold_plane(config,fields,y)
        baseline=p>=BASE;refined=p>=threshold
        # Every high raw core stays inside (even with partial-volume smoothing).
        dense=source_core[sl]>=190
        threshold=np.minimum(threshold,np.where(dense,np.maximum(BASE,p-1e-3),255))
        refined=p>=threshold;removed[sl]=baseline&~refined
        counts['originalForeground']+=int(baseline.sum());counts['refinedForeground']+=int(refined.sum());counts['removedForeground']+=int(removed[sl].sum())
        strong=p>=135;counts['protected135Samples']+=int(strong.sum());counts['lostProtected135Samples']+=int(np.count_nonzero(strong&~refined))
        counts['raw190Samples']+=int(dense.sum());counts['lostRaw190Samples']+=int(np.count_nonzero(dense&baseline&~refined))
        counts['maximumLocalThreshold']=max(counts['maximumLocalThreshold'],float(threshold.max()))
        boundary=np.concatenate([threshold[0],threshold[-1],threshold[:,0],threshold[:,-1]])
        counts['boxBoundaryNonBaselineSamples']+=int(np.count_nonzero(abs(boundary-BASE)>1e-4))
        if y in fields:serial.append({'fine'+'XYZ'[slice_axis]:int(y),'removedForeground':int(removed[sl].sum()),'maximumThreshold':float(threshold.max())})
        p-=threshold
    assert counts['lostProtected135Samples']==0 and counts['lostRaw190Samples']==0
    assert counts['boxBoundaryNonBaselineSamples']==0
    packed_mask=np.packbits(removed,axis=2,bitorder='little');mask_raw=packed_mask.tobytes();mask_gz=gzip.compress(mask_raw,9,mtime=0)
    mask_path=out_dir/(config['id']+'-low-band.bits.gz');mask_path.write_bytes(mask_gz)
    del raw,source_core,removed,packed_mask;gc.collect()
    verts,faces,normals,_=marching_cubes(smoothed,level=0,allow_degenerate=False,gradient_direction='descent')
    # MC normals/positions use array order ZYX, then acquisitionXYZ.
    verts=verts[:,::-1]+lo;normals=normals[:,::-1]
    del smoothed;gc.collect()
    surface=write_surface(out_dir/(config['id']+'.sfr.gz'),verts,normals,faces,reader.meta,lo,hi)
    report=dict(id=config['id'],surface=surface,lowerFullFineXYZ=lo.tolist(),upperFullFineXYZ=hi.tolist(),dimensionsXYZ=dims.tolist(),
      sourceSigmaFineSamples=.5,sourceSigmaTruncate=3,sourceSpacingUm=79.4,sourcePaddedRoiSha256=source_hash,sourceRoiSha256=raw_core_hash,
      source=reader.receipt(),baselineThreshold=BASE,config=config,counts=counts,serial=serial,
      lowBandMask=dict(file=mask_path.name,format='gzip-bitset-x-zyx',lowerFullFineXYZ=lo.tolist(),upperFullFineXYZ=hi.tolist(),dimensionsXYZ=dims.tolist(),storageDimensionsXYZ=[int((dims[0]+7)//8),int(dims[1]),int(dims[2])],compressedBytes=len(mask_gz),decodedBytes=len(mask_raw),sha256=sha(mask_gz),decodedSha256=sha(mask_raw),maskedVoxels=counts['removedForeground']),
      unchangedBoxCollar=True,originalSourceModified=False,sourceCalibratedHU=False,
      limitations=['Local display refinement, not a clinical tissue label.','Original mesh remains available; replacement is reversible.','Boundary matches original source isovalue but is not welded to the decimated original mesh.','Fine-grid resampling cannot recover native 19.85 µm structure.'],
      method='Raise the source sigma 0.5 isovalue only inside serially reviewed polygons, with cubic smoothstep collars on polygon distance, box faces and the selected slice-axis endpoints. Extract the complete zero isosurface of source minus local threshold, so retained cores receive a source-derived surface instead of holes in the old low-threshold surface.')
    (out_dir/(config['id']+'-policy.json')).write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'id':config['id'],'triangles':surface['triangles'],'compressedBytes':surface['compressedBytes'],'counts':counts}),flush=True)
    return report

if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('config',type=Path);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    config=json.loads(a.config.read_text());reader=FineSource(16);build_patch(reader,config,a.output)
