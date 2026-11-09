#!/usr/bin/env python3
"""Reversible source-field reconstruction inside serially reviewed lumen masks.

The uint8 source is a windowed phase-contrast volume, not calibrated HU.  It is
never modified.  Median/TV candidates remove local oscillations before surface
extraction; no single bright voxel receives unconditional protection.  Smooth
collars return to the original sigma0.5 / 71.4 field at every crop face.
"""
from pathlib import Path
import os,sys,json,gzip,hashlib,gc
os.environ.setdefault('OPENBLAS_NUM_THREADS','1');os.environ.setdefault('OMP_NUM_THREADS','1')
import numpy as np
from scipy import ndimage as ndi
from skimage.measure import marching_cubes
from skimage.restoration import denoise_tv_chambolle
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/fine-detail-v23'))
sys.path.insert(0,str(ROOT/'scripts/cleanup-v28-right'))
sys.path.insert(0,str(ROOT/'scripts/cleanup-v29-right'))
from source import FineSource
from adaptive_patch import write_surface,sha,BASE,smoothstep
from build_patch import fields_for,threshold_plane_single as linear_threshold_plane,threshold_plane as prior_threshold_plane

def threshold_plane_single(config,fields,index):
 """C1 convex interpolation avoids a shading kink at reviewed section anchors."""
 if config.get('serialInterpolation')!='c1-convex':
  return linear_threshold_plane(config,fields,index)
 lo=np.array(config['lowerXYZ']);hi=np.array(config['upperXYZ']);keys=sorted(fields);axis=config.get('sliceAxis',1)
 horizontal,vertical=[i for i in range(3) if i!=axis]
 shape=(hi[vertical]-lo[vertical],hi[horizontal]-lo[horizontal])
 if index<keys[0] or index>keys[-1]:return np.full(shape,BASE,np.float32)
 right=min(int(np.searchsorted(keys,index,side='right')),len(keys)-1);left=max(0,right-1)
 a,b=keys[left],keys[right];fraction=0 if a==b else (index-a)/(b-a)
 fraction=fraction*fraction*(3-2*fraction)
 distance=fields[a]*(1-fraction)+fields[b]*fraction
 weight=smoothstep(distance/config.get('polygonCollarSamples',12)).astype(np.float32)
 vv=np.arange(lo[vertical],hi[vertical])[:,None];hh=np.arange(lo[horizontal],hi[horizontal])[None,:]
 margin=np.minimum(np.minimum(hh-lo[horizontal],hi[horizontal]-1-hh),np.minimum(vv-lo[vertical],hi[vertical]-1-vv))
 margin=np.minimum(margin,min(index-lo[axis],hi[axis]-1-index))
 weight*=smoothstep(margin/config.get('boxCollarSamples',8))
 weight*=smoothstep(min(index-keys[0],keys[-1]-index)/config.get('endCollarSamples',12))
 return (BASE+(config['interiorThreshold']-BASE)*weight).astype(np.float32)

def build(config,out):
 out=Path(out);out.mkdir(parents=True,exist_ok=True)
 reader=FineSource(8);lo=np.array(config['lowerXYZ']);hi=np.array(config['upperXYZ']);dims=hi-lo
 assert np.prod(dims)<160_000_000
 pad=config.get('sourcePad',4);raw=reader.region(lo-pad,hi+pad);source_hash=sha(memoryview(raw));core=raw[pad:-pad,pad:-pad,pad:-pad]
 core_hash=sha(np.ascontiguousarray(core));print('read',config['id'],raw.shape,flush=True)
 base=ndi.gaussian_filter(raw.astype(np.float32),.5,truncate=3)[pad:-pad,pad:-pad,pad:-pad].copy()
 method=config['regularization']
 if method=='median':
  filtered=ndi.median_filter(raw,size=config.get('medianSize',3),mode='nearest')
  regular=ndi.gaussian_filter(filtered.astype(np.float32),config.get('sigma',.7),truncate=3)[pad:-pad,pad:-pad,pad:-pad].copy();del filtered
 elif method=='tv':
  smooth=ndi.gaussian_filter(raw.astype(np.float32),.5,truncate=3)
  regular=denoise_tv_chambolle(smooth,weight=config.get('tvWeight',22),max_num_iter=40,eps=2e-4,channel_axis=None)[pad:-pad,pad:-pad,pad:-pad].copy();del smooth
 elif method=='coherent-opening':
  grid=np.mgrid[-2:3,-2:3,-2:3];footprint=np.sum(grid*grid,axis=0)<=4
  opened=ndi.grey_opening(raw,footprint=footprint)
  opened=ndi.gaussian_filter(opened.astype(np.float32),.7,truncate=3)
  med=ndi.median_filter(raw,size=3,mode='nearest')
  med=ndi.gaussian_filter(med.astype(np.float32),.7,truncate=3)
  # Continuous bright sheets/tubes have sustained neighborhood support;
  # isolated phase-contrast peaks and narrow irregular fringe do not.
  support=ndi.gaussian_filter((raw>=config.get('coherentLevel',160)).astype(np.float32),1.25,truncate=3)
  support=smoothstep((support-.12)/.16)
  opened+=support*(med-opened)
  regular=opened[pad:-pad,pad:-pad,pad:-pad].copy();del opened,med,support
 elif method=='opening':
  grid=np.mgrid[-2:3,-2:3,-2:3];footprint=np.sum(grid*grid,axis=0)<=4
  filtered=ndi.grey_opening(raw,footprint=footprint)
  regular=ndi.gaussian_filter(filtered.astype(np.float32),.7,truncate=3)[pad:-pad,pad:-pad,pad:-pad].copy();del filtered
 elif method=='gaussian':
  regular=ndi.gaussian_filter(raw.astype(np.float32),config.get('sigma',1.1),truncate=3)[pad:-pad,pad:-pad,pad:-pad].copy()
 else:raise ValueError(method)
 coherence=None
 if any('incoherentThreshold' in z for z in config.get('additionalZones',[])):
  # Structure tensors distinguish coherent sheets/tubes from an irregular
  # multi-directional fringe. Only reviewed additional zones use this gate.
  smooth=ndi.gaussian_filter(raw.astype(np.float32),.8,truncate=3)
  gradients=np.gradient(smooth);del smooth
  moments=[]
  for a,b in [(0,0),(1,1),(2,2),(0,1),(0,2),(1,2)]:
   moments.append(ndi.gaussian_filter(gradients[a]*gradients[b],config.get('tensorSigma',2.5),truncate=3))
  del gradients;gc.collect()
  coherence=np.empty(raw.shape,np.float32)
  for k in range(0,raw.shape[0],8):
   sl=slice(k,min(k+8,raw.shape[0]));shape=moments[0][sl].shape
   tensor=np.empty((*shape,3,3),np.float32)
   for n,(a,b) in enumerate([(0,0),(1,1),(2,2),(0,1),(0,2),(1,2)]):
    tensor[...,a,b]=moments[n][sl];tensor[...,b,a]=moments[n][sl]
   eigen=np.linalg.eigvalsh(tensor);trace=np.sum(eigen,axis=-1)
   coherence[sl]=np.clip(1-3*eigen[...,0]/np.maximum(trace,1e-6),0,1)
  coherence=coherence[pad:-pad,pad:-pad,pad:-pad].copy();del moments,tensor,eigen,trace;gc.collect()
 print('regularized',method,flush=True)
 prior=None
 if config.get('priorId'):
  manifest=json.loads((ROOT/'public/assets/cleanup-v29/surface-manifest.json').read_text())
  entry=next(e for e in manifest['patches'] if e['id']==config['priorId'])
  policy_bytes=(ROOT/entry['reviewPolicy']['path']).read_bytes();assert sha(policy_bytes)==entry['reviewPolicy']['sha256']
  prior_policy=json.loads(policy_bytes);old_config=prior_policy['config'];old_lo=np.array(entry['lowerFullFineXYZ']);old_hi=np.array(entry['upperFullFineXYZ'])
  assert np.all(old_lo>=lo) and np.all(old_hi<=hi) and old_config.get('sliceAxis',1)==config.get('sliceAxis',0)
  mask_entry=entry['lowBandMask'];encoded=(ROOT/'public'/mask_entry['url'].removeprefix('./')).read_bytes();assert sha(encoded)==mask_entry['sha256']
  decoded=gzip.decompress(encoded);assert sha(decoded)==mask_entry['decodedSha256']
  packed=np.frombuffer(decoded,np.uint8).reshape(mask_entry['storageDimensionsXYZ'][::-1]);old_mask=np.unpackbits(packed,axis=2,bitorder='little')[:,:,:mask_entry['dimensionsXYZ'][0]].astype(bool)
  prior=dict(entry=entry,config=old_config,fields=fields_for(old_config),lo=old_lo,hi=old_hi,mask=old_mask,sourceFieldMaskDisagreementSamples=0,resurrectionPreventedSamples=0,priorLowBandLostSamples=0,priorMaskedVoxels=int(old_mask.sum()))
 fields=fields_for(config);extra_config={**config,'polygons':config['extraPolygons'],'interiorThreshold':config['extraThreshold'],'polygonCollarSamples':config.get('extraCollarSamples',10)} if config.get('extraPolygons') else None;extra_fields=fields_for(extra_config) if extra_config else None;zones=[({**config,**z},None) for z in config.get('additionalZones',[])];zones=[(z,fields_for(z)) for z,_ in zones];removed=np.zeros(base.shape,bool);counts=dict(originalForeground=0,refinedForeground=0,removedForeground=0,addedForeground=0,raw190Samples=0,lostRaw190Samples=0,boxBoundaryNonBaselineSamples=0);serial=[]
 axis=config.get('sliceAxis',0);sl=[slice(None)]*3
 faces={a+s:dict(samples=0,changed=0,maximumAbsoluteDelta=0.) for a in 'XYZ' for s in ['lower','upper']}
 for j,c in enumerate(range(lo[axis],hi[axis])):
  sl[2-axis]=j;s=tuple(sl);p=base[s];r=regular[s];smooth_threshold=threshold_plane_single(config,fields,c);w=(smooth_threshold-BASE)/(config['interiorThreshold']-BASE);threshold=np.maximum(smooth_threshold,threshold_plane_single(extra_config,extra_fields,c)) if extra_config else smooth_threshold
  for zone,zone_fields in zones:
   zth=threshold_plane_single(zone,zone_fields,c);zw=(zth-BASE)/(zone['interiorThreshold']-BASE)
   if 'incoherentThreshold' in zone:
    confidence=smoothstep((coherence[s]-zone.get('coherenceLow',.5))/(zone.get('coherenceHigh',.85)-zone.get('coherenceLow',.5)))
    zth+=zw*(1-confidence)*(zone['incoherentThreshold']-zone['interiorThreshold'])
   if config.get('zoneBlend')=='smooth-priority':
    threshold=zth+(threshold-BASE)*(1-zw);w=zw+w*(1-zw)
   else:w=np.maximum(w,zw);threshold=np.maximum(threshold,zth)
  # A monotone low-pass cut keeps the original occupied support. Optional
  # regularized filling is explicitly recorded; no synthetic chamber surface.
  r=np.minimum(p,r) if config.get('removeOnly',False) else r
  signed=p-BASE+w*(r-p)-(threshold-BASE)
  if prior and prior['lo'][axis]<=c<prior['hi'][axis]:
   other=[a for a in range(3) if a!=axis]
   osl=tuple(slice(prior['lo'][a]-lo[a],prior['hi'][a]-lo[a]) for a in other[::-1])
   oldp=p[osl];oldth=prior_threshold_plane(prior['config'],prior['fields'],c)
   oldth=np.minimum(oldth,np.where(core[s][osl]>=190,np.maximum(BASE,oldp-1e-3),255))
   old_signed=oldp-oldth;old_mask=np.take(prior['mask'],c-prior['lo'][axis],axis=2-axis)
   disagreement=int(np.count_nonzero(((oldp>=BASE)&(old_signed<0))!=old_mask));prior['sourceFieldMaskDisagreementSamples']+=disagreement
   assert disagreement==0
   prior['resurrectionPreventedSamples']+=int(np.count_nonzero(old_mask&(signed[osl]>=0)))
   # Inherit only verified exclusions. The old raw190 guard deliberately
   # made some POSITIVE samples just 0.001 above zero; importing that positive
   # field would defeat this pass's regularization and recreate bright speckle
   # islands through interpolation even though mask bits were unchanged.
   if config.get('inheritPriorMode')=='negative-samples':
    signed[osl]=np.where(old_mask,np.minimum(signed[osl],old_signed),signed[osl])
   else:signed[osl]=np.minimum(signed[osl],old_signed)
   prior['priorLowBandLostSamples']+=int(np.count_nonzero(old_mask&(signed[osl]>=0)))
  delta=signed-(p-BASE)
  for face_axis in range(3):
   for side in [0,1]:
    if face_axis==axis:
     if j not in [0,dims[axis]-1] or (side==0)!=(j==0):continue
     face_delta=delta
    else:
     plane_axis=list(reversed([a for a in range(3) if a!=axis])).index(face_axis)
     face_delta=np.take(delta,0 if side==0 else -1,axis=plane_axis)
    record=faces['XYZ'[face_axis]+('lower' if side==0 else 'upper')];record['samples']+=int(face_delta.size);record['changed']+=int(np.count_nonzero(face_delta));record['maximumAbsoluteDelta']=max(record['maximumAbsoluteDelta'],float(np.max(np.abs(face_delta))))
  before=p>=BASE;after=signed>=0;removed[s]=before&~after
  counts['originalForeground']+=int(before.sum());counts['refinedForeground']+=int(after.sum());counts['removedForeground']+=int(removed[s].sum());counts['addedForeground']+=int((~before&after).sum())
  bright=core[s]>=190;counts['raw190Samples']+=int(bright.sum());counts['lostRaw190Samples']+=int((bright&before&~after).sum())
  boundary=np.concatenate([w[0],w[-1],w[:,0],w[:,-1]]);counts['boxBoundaryNonBaselineSamples']+=int(np.count_nonzero(boundary))
  if c in fields:serial.append(dict(coordinate=int(c),removed=int(removed[s].sum()),added=int((~before&after).sum())))
  p[:]=signed
 assert counts['boxBoundaryNonBaselineSamples']==0
 assert all(f['changed']==0 for f in faces.values())
 # Original source masks remain separately enabled at runtime; these bits
 # synchronize cut faces/density/picking with new source-field exclusions.
 packed=np.packbits(removed,axis=2,bitorder='little');maskraw=packed.tobytes();encoded=gzip.compress(maskraw,9,mtime=0);maskfile=out/(config['id']+'-low-band.bits.gz');maskfile.write_bytes(encoded)
 np.save(out/'removed.npy',removed)
 del raw,core,regular,removed,packed,coherence;gc.collect()
 print('extracting',counts,flush=True)
 v,f,n,_=marching_cubes(base,level=0,allow_degenerate=False,gradient_direction='descent');v=v[:,::-1]+lo;n=n[:,::-1];del base;gc.collect()
 surface=write_surface(out/(config['id']+'.sfr.gz'),v,n,f,reader.meta,lo,hi)
 policy=dict(id=config['id'],surface=surface,lowerFullFineXYZ=lo.tolist(),upperFullFineXYZ=hi.tolist(),dimensionsXYZ=dims.tolist(),sourceSpacingUm=79.4,sourceSigmaFineSamples=.5,sourcePaddedRoiSha256=source_hash,sourceRoiSha256=core_hash,source=reader.receipt(),baselineThreshold=BASE,config=config,counts=counts,serial=serial,lowBandMask=dict(file=maskfile.name,format='gzip-bitset-x-zyx',lowerFullFineXYZ=lo.tolist(),upperFullFineXYZ=hi.tolist(),dimensionsXYZ=dims.tolist(),storageDimensionsXYZ=[int((dims[0]+7)//8),int(dims[1]),int(dims[2])],compressedBytes=len(encoded),decodedBytes=len(maskraw),sha256=sha(encoded),decodedSha256=sha(maskraw),maskedVoxels=counts['removedForeground']),unchangedBoxCollar=True,originalSourceModified=False,sourceCalibratedHU=False,method='Local '+method+' source-field regularization and source-contrast extraction with smoothly interpolated serial polygon weights. No unconditional bright-voxel immunity; genuine surfaces judged by neighboring source continuity.',limitations=['Reversible educational display reconstruction, not a clinical tissue label.','Original measurement bank and native mesh remain unchanged.','Fine-grid source cannot recover native19.85µm structure.','Unwelded collar matches the original scalar field.'])
 policy['sixFaceSignedFieldAudit']=faces
 if prior:policy['inheritedPrior']={k:prior[k] for k in ['sourceFieldMaskDisagreementSamples','resurrectionPreventedSamples','priorLowBandLostSamples','priorMaskedVoxels']};policy['inheritedPrior'].update(id=prior['entry']['id'],reviewPolicy=prior['entry']['reviewPolicy'],lowBandMaskSha256=prior['entry']['lowBandMask']['sha256'])
 path=out/'policy.json';path.write_text(json.dumps(policy,indent=2)+'\n');print(json.dumps(dict(policy=str(path),triangles=surface['triangles'],counts=counts)),flush=True)
if __name__=='__main__':
 import argparse
 p=argparse.ArgumentParser();p.add_argument('config',type=Path);p.add_argument('--output',type=Path,required=True);a=p.parse_args();build(json.loads(a.config.read_text()),a.output)
