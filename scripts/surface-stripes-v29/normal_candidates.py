#!/usr/bin/env python3
"""Compare tessellation-independent normal weights without changing geometry."""
import os
os.environ.setdefault('OPENBLAS_NUM_THREADS','1')
from pathlib import Path
import argparse,hashlib,json,time
import numpy as np

ROOT=Path(__file__).resolve().parents[2]
def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(4*1024**2),b''):h.update(block)
    return h.hexdigest()
def main():
    p=argparse.ArgumentParser();p.add_argument('--input',type=Path,required=True);p.add_argument('--out',type=Path,required=True);args=p.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    manifest=json.loads((ROOT/'public/assets/fine-surface-v23/manifest.json').read_text());lod=manifest['lods'][0]
    assert digest(args.input)==lod['decodedSha256']
    raw=np.memmap(args.input,dtype='u1',mode='r');h=np.frombuffer(raw,'<u4',8);nv,ni=map(int,h[2:4]);assert nv==lod['vertices'] and ni==lod['triangles']*3
    q=np.ndarray((nv,3),'<u2',buffer=raw,offset=int(h[4]));old=np.ndarray((nv,3),'<i2',buffer=raw,offset=int(h[5]));faces=np.ndarray((ni//3,3),'<u4',buffer=raw,offset=int(h[6]))
    scale=np.asarray(manifest['extent'],np.float32)/65535
    area=np.lib.format.open_memmap(args.out/'area-sums.npy',mode='w+',dtype='<f4',shape=(nv,3));area[:]=0
    angle=np.lib.format.open_memmap(args.out/'angle-sums.npy',mode='w+',dtype='<f4',shape=(nv,3));angle[:]=0
    start=time.monotonic();batch=120_000
    for first in range(0,len(faces),batch):
        f=faces[first:first+batch];v=q[f].astype(np.float32)*scale
        cross=np.cross(v[:,1]-v[:,0],v[:,2]-v[:,0]);length=np.linalg.norm(cross,axis=1)
        unit=cross/np.maximum(length[:,None],1e-20)
        for c in range(3):
            a=v[:,(c+1)%3]-v[:,c];b=v[:,(c+2)%3]-v[:,c]
            w=np.arctan2(length,np.einsum('ij,ij->i',a,b))
            np.add.at(area,f[:,c],cross)
            np.add.at(angle,f[:,c],unit*w[:,None])
        if first%(batch*25)==0:print(json.dumps({'faces':first,'total':len(faces),'seconds':round(time.monotonic()-start,1)}),flush=True)
    outputs={}
    for name,sums in [('area',area),('angle',angle)]:
        out=np.lib.format.open_memmap(args.out/(name+'-normals.npy'),mode='w+',dtype='<i2',shape=(nv,3))
        sample_angles=[];fallback=0;band_angles=[];outside_angles=[];seam_vertex_count=0
        for first in range(0,nv,200_000):
            total=sums[first:first+200_000].copy();length=np.linalg.norm(total,axis=1);bad=length<1e-12
            prior=old[first:first+len(total)].astype(np.float32)/32767
            total/=np.maximum(length[:,None],1e-20);total[bad]=prior[bad];fallback+=int(bad.sum())
            # Resolve exceptional nonmanifold orientation against the unchanged
            # source normal. No face order, winding, or position is changed.
            flip=np.einsum('ij,ij->i',total,prior)<0;total[flip]*=-1
            out[first:first+len(total)]=np.rint(np.clip(total,-1,1)*32767).astype('<i2')
            a=np.degrees(np.arccos(np.clip(np.einsum('ij,ij->i',total,prior),-1,1)))
            fine_z=q[first:first+len(total),1].astype(np.float64)/65535*2116
            seam_distance=np.abs((fine_z-59+32)%64-32);band=seam_distance<2
            seam_vertex_count+=int(band.sum());sample_angles.extend(a[::97].tolist());band_angles.extend(a[band][::29].tolist());outside_angles.extend(a[~band][::97].tolist())
        out.flush();outputs[name]={'path':str(args.out/(name+'-normals.npy')),'sha256':digest(args.out/(name+'-normals.npy')),'fallbackVertices':fallback,'angularDifferenceDegreesPercentiles':np.percentile(sample_angles,[50,95,99,100]).tolist(),'seamBand2SamplesVertices':seam_vertex_count,'seamAngularDifferencePercentiles':np.percentile(band_angles,[50,95,99]).tolist(),'awayFromSeamAngularDifferencePercentiles':np.percentile(outside_angles,[50,95,99]).tolist()}
    report={'sourceDecodedSha256':lod['decodedSha256'],'vertices':nv,'triangles':ni//3,'positionsUnchanged':True,'indicesUnchanged':True,'sourceScalarsUnchanged':True,'slabSeamsFineZ':'59 + 64*k, original 64-cell slab construction','candidates':outputs,'seconds':time.monotonic()-start,'method':'Compare incident area-weighted and corner-angle-weighted normals over original quantized positions and identical indexed topology. Shading candidate only; no surface point moves.'}
    (args.out/'normal-candidates.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report),flush=True)
if __name__=='__main__':main()
