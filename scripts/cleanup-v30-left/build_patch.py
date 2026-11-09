#!/usr/bin/env python3
"""Bounded v30 compound source-field regularization around aortic and mitral fringe.

The original data are immutable windowed HiP-CT uint8, not calibrated HU. This
reconstructs an eroded source scalar field only in serially reviewed envelopes.
At all crop faces it is the exact original sigma.5 source isovalue. No caps,
inpainted voxels, dilation, or synthetic leaflet geometry are introduced.
"""
from pathlib import Path
import argparse,sys,hashlib,json,gzip,importlib.util,gc,time
import numpy as np
from scipy import ndimage as ndi
from skimage.measure import marching_cubes
from skimage.restoration import denoise_tv_chambolle
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/cleanup-v28-right'));sys.path.insert(0,str(ROOT/'scripts/fine-detail-v23'))
import adaptive_patch as A
from source import FineSource
SHA=lambda b:hashlib.sha256(b).hexdigest()

def read_mask(item,root):
 p=root/item.get('url',item.get('file')).removeprefix('./');enc=p.read_bytes();assert SHA(enc)==item['sha256'];raw=gzip.decompress(enc);assert SHA(raw)==item['decodedSha256']
 return np.unpackbits(np.frombuffer(raw,np.uint8).reshape(item['storageDimensionsXYZ'][::-1]),axis=2,count=item['dimensionsXYZ'][0],bitorder='little').astype(bool)

def fields(config):return [(r,A.fields_for(r)) for r in config['regions']]
def plane(config,ff,y):
 lo=np.array(config['lowerXYZ']);hi=np.array(config['upperXYZ']);out=np.zeros((hi[2]-lo[2],hi[0]-lo[0]),np.float32)
 for r,f in ff:
  a=np.array(r['lowerXYZ']);b=np.array(r['upperXYZ'])
  if a[1]<=y<b[1]:
   v=(A.threshold_plane(r,f,y)-A.BASE)/(r['interiorThreshold']-A.BASE)
   sl=(slice(a[2]-lo[2],b[2]-lo[2]),slice(a[0]-lo[0],b[0]-lo[0]));out[sl]=np.maximum(out[sl],v)
 return out

def main():
 p=argparse.ArgumentParser();p.add_argument('--method',choices=['median','tv','threshold'],default='median');p.add_argument('--threshold',type=float,default=130);p.add_argument('--core-collar',action='store_true');p.add_argument('--output',type=Path,required=True);p.add_argument('--config',type=Path,default=ROOT/'scripts/cleanup-v30-left/regions.json');args=p.parse_args();args.output.mkdir(parents=True,exist_ok=True)
 config=json.loads(args.config.read_text());lo=np.array(config['lowerXYZ']);hi=np.array(config['upperXYZ']);dims=hi-lo;pad=4;reader=FineSource(16)
 assert np.prod(dims)<70_000_000
 rawpad=reader.region(lo-pad,hi+pad);raw=rawpad[pad:-pad,pad:-pad,pad:-pad];rawsha=SHA(np.ascontiguousarray(raw));paddedsha=SHA(rawpad)
 baseline=ndi.gaussian_filter(rawpad.astype(np.float32),.5,truncate=3)[pad:-pad,pad:-pad,pad:-pad].copy()
 t=time.time()
 if args.method=='median':regular=ndi.gaussian_filter(ndi.median_filter(rawpad,size=3).astype(np.float32),.5,truncate=3)[pad:-pad,pad:-pad,pad:-pad].copy()
 elif args.method=='tv':regular=denoise_tv_chambolle(rawpad.astype(np.float32),weight=16,eps=0,max_num_iter=24,channel_axis=None)[pad:-pad,pad:-pad,pad:-pad].copy()
 else:regular=baseline.copy()
 regular_seconds=time.time()-t
 core_distance=None;coherent=None;coherent_count=0
 if args.core_collar:
  q=baseline>=150;coherent=np.zeros(q.shape,bool)
  directions=[(0,0,1),(0,1,0),(1,0,0),(0,1,1),(0,1,-1),(1,0,1),(1,0,-1),(1,1,0),(1,-1,0),(1,1,1),(1,1,-1),(1,-1,1),(1,-1,-1)]
  for direction in directions:
   support=q.copy()
   for step in [-2,-1,1,2]:support &= np.roll(q,tuple(step*v for v in direction),axis=(0,1,2))
   coherent |= support
  coherent &= raw>=170
  coherent |= regular>=155
  # Wrapped endpoints are never used as source support; field crop collars
  # independently return to baseline at all faces.
  for axis in range(3):
   sl=[slice(None)]*3;sl[axis]=slice(0,2);coherent[tuple(sl)]=False;sl[axis]=slice(-2,None);coherent[tuple(sl)]=False
  coherent_count=int(coherent.sum());core_distance=ndi.distance_transform_edt(~coherent).astype(np.float32)
  del q,support;gc.collect()

 # Preserve frozen old local field in its old exact crop. New fields can lower
 # the scalar further; regularization cannot resurrect prior excluded samples.
 legacy=[json.loads((ROOT/'scripts/cleanup-v28-left/lvot-patch-t120-config.json').read_text()),json.loads((ROOT/'scripts/cleanup-v29-left/lvot-proximal-region.json').read_text())]
 legacy_fields=[(r,A.fields_for(r)) for r in legacy];newfields=fields(config)
 spec=importlib.util.spec_from_file_location('frozen_wall',ROOT/'scripts/cleanup-v27-wall/restore_wall.py');wall=importlib.util.module_from_spec(spec);spec.loader.exec_module(wall)
 wa,wb,protected,wr=wall.restore_all_selections(reader);assert int(protected.sum())==109928 and wr['restoreMaskSha256']=='ac5d0d8771272e5bb14e0ae8ef13aea171c8abeda24d754e0345e1328aa5fbea'
 frozen=np.zeros(tuple(dims[::-1]),bool);aa=np.maximum(lo,wa);bb=np.minimum(hi,wb)
 if np.all(bb>aa):
  sl=tuple(slice(int(a),int(b)) for a,b in zip((aa-lo)[::-1],(bb-lo)[::-1]));ws=tuple(slice(int(a),int(b)) for a,b in zip((aa-wa)[::-1],(bb-wa)[::-1]));frozen[sl]=protected[ws]
 removed=np.zeros(tuple(dims[::-1]),bool);counts=dict(originalForeground=0,refinedForeground=0,removedForeground=0,raw190=0,removedRaw190=0,medianSupported190=0,removedMedianSupported190=0,fieldAdditions=0,boxBoundaryNonBaselineSamples=0,restoredWallOverlap=0,coherentMarkerSamples=coherent_count,removedCoherentMarkers=0);serial=[]
 # No universal raw190 guard in reviewed v30 envelopes. The tested median3
 # volume itself evaluates neighborhood support; dense isolated peaks may go.
 medsupport=ndi.median_filter(rawpad,size=3)[pad:-pad,pad:-pad,pad:-pad] if args.method!='median' else None
 for j,y in enumerate(range(lo[1],hi[1])):
  b=baseline[:,j,:];oldthreshold=np.full(b.shape,A.BASE,np.float32)
  for r,f in legacy_fields:
   a=np.array(r['lowerXYZ']);c=np.array(r['upperXYZ'])
   if a[1]<=y<c[1]:
    sl=(slice(a[2]-lo[2],c[2]-lo[2]),slice(a[0]-lo[0],c[0]-lo[0]));oldthreshold[sl]=np.maximum(oldthreshold[sl],A.threshold_plane(r,f,y))
  oldthreshold=np.minimum(oldthreshold,np.where(raw[:,j,:]>=190,np.maximum(A.BASE,b-1e-3),255))
  oldscalar=b-oldthreshold;w=plane(config,newfields,y)
  if args.core_collar:w*=A.smoothstep((core_distance[:,j,:]-1.5)/2.0)
  filtered=np.minimum(b,regular[:,j,:]);threshold=A.BASE+(args.threshold-A.BASE)*w
  newscalar=b+w*(filtered-b)-threshold;scalar=np.minimum(oldscalar,newscalar)
  guard=frozen[:,j,:];scalar[guard]=b[guard]-A.BASE
  original=b>=A.BASE;refined=scalar>=0;removed[:,j,:]=original&~refined
  supported=(raw[:,j,:]>=190)&((regular[:,j,:]>=155) if args.method=='median' else (medsupport[:,j,:]>=155))
  counts['originalForeground']+=int(original.sum());counts['refinedForeground']+=int(refined.sum());counts['removedForeground']+=int(removed[:,j,:].sum());counts['removedCoherentMarkers']+=int((removed[:,j,:]&coherent[:,j,:]).sum()) if coherent is not None else 0;counts['raw190']+=int((raw[:,j,:]>=190).sum());counts['removedRaw190']+=int(((raw[:,j,:]>=190)&removed[:,j,:]).sum());counts['medianSupported190']+=int(supported.sum());counts['removedMedianSupported190']+=int((supported&removed[:,j,:]).sum());counts['fieldAdditions']+=int((~original&refined).sum())
  edge=np.concatenate([scalar[0]-(b[0]-A.BASE),scalar[-1]-(b[-1]-A.BASE),scalar[:,0]-(b[:,0]-A.BASE),scalar[:,-1]-(b[:,-1]-A.BASE)])
  counts['boxBoundaryNonBaselineSamples']+=int((abs(edge)>1e-5).sum());counts['restoredWallOverlap']+=int((guard&removed[:,j,:]).sum())
  if y%16==0:serial.append(dict(y=y,removed=int(removed[:,j,:].sum()),newEnvelopeSamples=int((w>0).sum()),maximumThreshold=float(threshold.max())))
  baseline[:,j,:]=scalar
 print(json.dumps({'preExtractionCounts':counts}),flush=True)
 assert counts['fieldAdditions']==0 and counts['restoredWallOverlap']==0 and counts['boxBoundaryNonBaselineSamples']==0
 # Explicit prior mask inclusion: no previous low-band sample reappears.
 old=json.loads((ROOT/'public/assets/cleanup-v29/surface-manifest.json').read_text())['patches'][0];prior=read_mask(old['lowBandMask'],ROOT/'public');pa=np.array(old['lowerFullFineXYZ']);pb=np.array(old['upperFullFineXYZ']);sl=tuple(slice(int(a),int(b)) for a,b in zip((pa-lo)[::-1],(pb-lo)[::-1]));prior_lost=int((prior&~removed[sl]).sum());assert prior_lost==0
 maskraw=np.packbits(removed,axis=2,bitorder='little').tobytes();maskgz=gzip.compress(maskraw,9,mtime=0);mp=args.output/(config['id']+'-low-band.bits.gz');mp.write_bytes(maskgz)
 mask=dict(file=mp.name,format='gzip-bitset-x-zyx',lowerFullFineXYZ=lo.tolist(),upperFullFineXYZ=hi.tolist(),dimensionsXYZ=dims.tolist(),storageDimensionsXYZ=[int((dims[0]+7)//8),int(dims[1]),int(dims[2])],compressedBytes=len(maskgz),decodedBytes=len(maskraw),sha256=SHA(maskgz),decodedSha256=SHA(maskraw),maskedVoxels=counts['removedForeground'])
 del regular,raw,rawpad,frozen,protected,removed,prior,medsupport,coherent,core_distance;gc.collect()
 verts,faces,normals,_=marching_cubes(baseline,level=0,allow_degenerate=False,gradient_direction='descent');verts=verts[:,::-1]+lo;normals=normals[:,::-1];del baseline;gc.collect()
 surface=A.write_surface(args.output/(config['id']+'.sfr.gz'),verts,normals,faces,reader.meta,lo,hi)
 report=dict(id=config['id'],surface=surface,lowBandMask=mask,lowerFullFineXYZ=lo.tolist(),upperFullFineXYZ=hi.tolist(),dimensionsXYZ=dims.tolist(),source=reader.receipt(),sourceRoiSha256=rawsha,sourcePaddedRoiSha256=paddedsha,sourceSigmaFineSamples=.5,sourceSpacingUm=79.4,baselineThreshold=A.BASE,maximumReviewedDisplayIntensity=args.threshold,sourceCalibratedHU=False,originalSourceModified=False,unchangedBoxCollar=True,method=args.method,regularizer=dict(kind=args.method,medianWindow=[3,3,3] if args.method=='median' else None,tvWeight=16 if args.method=='tv' else None,tvIterations=24 if args.method=='tv' else None,seconds=regular_seconds),coreCollar=dict(enabled=args.core_collar,fullPreservationDistanceSamples=1.5,taperDistanceSamples=2.0,marker='Median3Gaussian.5 >=155 or raw>=170 supported by five consecutive Gaussian.5 >=150 samples along any of13 3D orientations'),config=config,configSha256=SHA(args.config.read_bytes()),counts=counts,serial=serial,preservationChecks=dict(priorLowBandLostSamples=prior_lost,restoredWallMaskSha256=wr['restoreMaskSha256'],restoredWallMaskSamples=109928,restoredWallLowBandOverlap=0),limitations=['Source-guided visualization cleanup, not clinically validated segmentation.','Bright isolated samples inside reviewed envelopes may be excluded if neighborhood support is insufficient.','Local source scalar can only decrease; no synthesized density or cap closure.','Crop collar is original source level but not welded to decimated whole-heart geometry.'])
 (args.output/(config['id']+'-policy.json')).write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(dict(method=args.method,counts=counts,surface=surface,preservation=report['preservationChecks'])),flush=True)
if __name__=='__main__':main()
