#!/usr/bin/env python3
"""Prepare an experimental whole-heart mesh from verified79.4um source bricks.

Source intensities are never edited. A separate mildly filtered scalar field
defines the derived display surface. Slab boundaries are frozen during the
first simplification, then welded before whole-object LOD generation.
"""
from pathlib import Path
import argparse
import concurrent.futures
import gzip
import hashlib
import json
import math
import os
import struct
import subprocess
import sys
import tempfile
import time

import numpy as np
from scipy.ndimage import gaussian_filter
from scipy.spatial import cKDTree
import vtk
from vtk.util.numpy_support import numpy_to_vtk, numpy_to_vtkIdTypeArray, vtk_to_numpy

ROOT=Path(__file__).resolve().parents[2]
DEFAULT_WORK=Path('/workspace/scratch/7d584d74921e/fine-surface-v19')
ASSET=ROOT/'public/assets/fine-surface-v19'
DOCS=ROOT/'docs/fine-surface-v19'
SCHEMA='fine-surface-v19.1'

def digest(path):
 h=hashlib.sha256()
 with Path(path).open('rb') as stream:
  for block in iter(lambda:stream.read(8*1024*1024),b''):h.update(block)
 return h.hexdigest()

def save_json(path,value):
 Path(path).parent.mkdir(parents=True,exist_ok=True)
 path=Path(path)
 temporary=path.with_suffix(path.suffix+'.partial')
 temporary.write_text(json.dumps(value,indent=2)+'\n');temporary.replace(path)

def save_arrays(path,**values):
 path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
 with tempfile.NamedTemporaryFile(dir=path.parent,prefix=path.name+'.',suffix='.partial',delete=False) as stream:
  temporary=Path(stream.name);np.savez(stream,**values)
 temporary.replace(path)

def log(**value):print(json.dumps(value),flush=True)

def source_manifest():
 path=ROOT/'public/assets/ultra-volume-v7.json'
 return json.loads(path.read_text()),digest(path)

def assemble(work):
 work.mkdir(parents=True,exist_ok=True)
 source,source_hash=source_manifest()
 path=work/'fine-source-padded.npy';ready=work/'source-ready.json'
 if ready.exists():
  info=json.loads(ready.read_text())
  assert info['sourceManifestSha256']==source_hash
  try:
   assert list(np.load(path,mmap_mode='r').shape)==info['shapeZYX']
   assert digest(path)==info['paddedFileSha256'],'derived source checkpoint hash mismatch'
   return info
  except (ValueError,OSError,AssertionError):
   # Only our derived checkpoint is rebuilt; immutable bank files are read-only.
   ready.unlink()
 start=time.monotonic()
 shape=np.array(source['sourceShapeXYZ'])+2
 # The virtual zero border follows this source bank's documented empty value.
 # Freshly truncated file regions are zero; present block cores are copied in.
 data=np.lib.format.open_memmap(path,mode='w+',dtype=np.uint8,shape=tuple(int(v) for v in shape[::-1]))
 counts=np.array(source['brickCountsXYZ']);src_shape=np.array(source['sourceShapeXYZ'])
 encoded=0
 for i,(key,entry) in enumerate(sorted(source['blocks'].items(),key=lambda pair:int(pair[0]))):
  encoded_path=ROOT/'data/ultra-volume-v7'/entry['path'];payload=encoded_path.read_bytes()
  assert hashlib.sha256(payload).hexdigest()==entry['sha256'],entry['path']
  raw=gzip.decompress(payload)
  assert hashlib.sha256(raw).hexdigest()==entry['rawSha256'],entry['path']
  block=np.frombuffer(raw,np.uint8).reshape(65,65,65)
  index=int(key);bx=index%counts[0];by=(index//counts[0])%counts[1];bz=index//(counts[0]*counts[1])
  start_xyz=np.array([bx,by,bz])*64;stop=np.minimum(src_shape,start_xyz+64);width=stop-start_xyz
  if np.all(width>0):
   x,y,z=start_xyz+1;w,h,d=width
   data[z:z+d,y:y+h,x:x+w]=block[:d,:h,:w]
  encoded+=len(payload)
  if (i+1)%512==0:log(stage='assemble',blocks=i+1,total=len(source['blocks']))
 data.flush();del data
 info=dict(schema=SCHEMA,sourceManifestSha256=source_hash,sourceManifest='public/assets/ultra-volume-v7.json',
  sourceSpacingUm=source['sourceSpacingUm'],sourceShapeXYZ=source['sourceShapeXYZ'],
  sourceOriginXYZ=source['sourceOriginXYZ'],paddedOriginXYZ=(np.array(source['sourceOriginXYZ'])-1).tolist(),
  shapeZYX=shape[::-1].tolist(),fullDimensionsXYZ=source['fullDimensionsXYZ'],extent=source['extent'],
  longestMm=source['longestMm'],sourceWindow=source['sourceWindow'],threshold=.28,
  verifiedBlocks=len(source['blocks']),encodedBytes=encoded,paddedFileSha256=digest(path),seconds=time.monotonic()-start)
 save_json(ready,info);log(stage='source-ready',**info)
 return info

def poly_from_arrays(points,faces):
 p=vtk.vtkPolyData();v=vtk.vtkPoints();v.SetData(numpy_to_vtk(np.ascontiguousarray(points,dtype=np.float32),deep=True));p.SetPoints(v)
 assert len(points)<2**31 and 3*len(faces)<2**31
 cells=vtk.vtkCellArray();offsets=np.arange(0,3*len(faces)+1,3,dtype=np.int32)
 cells.SetData(numpy_to_vtk(offsets,deep=True),numpy_to_vtk(np.ascontiguousarray(faces,dtype=np.int32).ravel(),deep=True));p.SetPolys(cells)
 return p

def arrays(poly):
 points=vtk_to_numpy(poly.GetPoints().GetData()).astype(np.float32,copy=True)
 faces=vtk_to_numpy(poly.GetPolys().GetConnectivityArray()).reshape(-1,3).astype(np.uint32,copy=True)
 return points,faces

def contour(data,origin,spacing):
 image=vtk.vtkImageData();image.SetDimensions(*data.shape[::-1]);image.SetSpacing(spacing,spacing,spacing);image.SetOrigin(*origin)
 image.GetPointData().SetScalars(numpy_to_vtk(data.ravel(),deep=False))
 iso=vtk.vtkFlyingEdges3D();iso.SetInputData(image);iso.SetValue(0,255*.28)
 iso.ComputeNormalsOff();iso.ComputeGradientsOff();iso.ComputeScalarsOff();iso.InterpolateAttributesOff();iso.Update()
 output=vtk.vtkPolyData();output.ShallowCopy(iso.GetOutput());return output

def extract_slab(task):
 work,z0,z1,sigma,error=task;work=Path(work)
 out=work/'slabs'/f'{z0:04}-{z1:04}.npz';record=out.with_suffix('.json')
 if out.exists() and record.exists():
  info=json.loads(record.read_text())
  if info['sigmaVoxels']==sigma and info['decimationAbsoluteErrorMm']==error and digest(out)==info['sha256']:return info
 vtk.vtkSMPTools.Initialize(3)
 started=time.monotonic();meta=json.loads((work/'source-ready.json').read_text())
 data=np.load(work/'fine-source-padded.npy',mmap_mode='r');halo=max(4,int(math.ceil(3*sigma))+1)
 lo=max(0,z0-halo);hi=min(data.shape[0],z1+halo+1)
 filtered=gaussian_filter(np.asarray(data[lo:hi],dtype=np.float32),sigma=sigma,truncate=3.,mode='constant',cval=0.)
 core=np.ascontiguousarray(filtered[z0-lo:z1-lo+1]);del filtered
 spacing=meta['sourceSpacingUm']/1000
 origin=(np.array(meta['paddedOriginXYZ'])-(np.array(meta['fullDimensionsXYZ'])-1)/2)*spacing
 origin[2]+=z0*spacing
 reference=contour(core,origin,spacing)
 count=int(reference.GetNumberOfCells());vertices=int(reference.GetNumberOfPoints())
 if not count:
  points=np.empty((0,3),np.float32);faces=np.empty((0,3),np.uint32)
 else:
  # Frozen contour boundaries make adjacent slabs independently reproducible.
  # Topology preservation is kept in this first pass; the final QEM LOD is a
  # separately measured lossy display approximation.
  dec=vtk.vtkDecimatePro();dec.SetInputData(reference);dec.SetTargetReduction(.98)
  dec.PreserveTopologyOn();dec.BoundaryVertexDeletionOff();dec.SplittingOff();dec.SetFeatureAngle(60)
  dec.SetErrorIsAbsolute(True);dec.SetAbsoluteError(error);dec.AccumulateErrorOn();dec.Update()
  points,faces=arrays(dec.GetOutput())
  lower=np.float32(origin[2]);upper=np.float32(origin[2]+(z1-z0)*spacing)
  # Canonical boundary z removes harmless floating addition differences.
  points[np.abs(points[:,2]-lower)<1e-5,2]=lower
  points[np.abs(points[:,2]-upper)<1e-5,2]=upper
 save_arrays(out,points=points,faces=faces)
 info=dict(schema=SCHEMA,z0=z0,z1=z1,sigmaVoxels=sigma,sigmaMm=sigma*spacing,
  referenceVertices=vertices,referenceTriangles=count,vertices=len(points),triangles=len(faces),
  decimationAbsoluteErrorMm=error,topologyPreservedInSlab=True,boundaryVerticesFrozen=True,
  seconds=time.monotonic()-started,sha256=digest(out))
 save_json(record,info);log(stage='slab',**info)
 return info

def extract(work,workers,sigma,error,slab_cells):
 meta=assemble(work);nz=meta['shapeZYX'][0]
 tasks=[(str(work),z,min(nz-1,z+slab_cells),sigma,error) for z in range(0,nz-1,slab_cells)]
 with concurrent.futures.ProcessPoolExecutor(max_workers=workers) as pool:
  results=list(pool.map(extract_slab,tasks))
 save_json(work/'extraction.json',dict(schema=SCHEMA,slabCells=slab_cells,sigmaVoxels=sigma,
  sourceSpacingUm=meta['sourceSpacingUm'],decimationAbsoluteErrorMm=error,
  referenceTriangles=sum(p['referenceTriangles'] for p in results),triangles=sum(p['triangles'] for p in results),slabs=results))
 return results

def weld_slabs(work):
 out=work/'welded-reference.npz'
 extraction_hash=digest(work/'extraction.json')
 if out.exists() and (work/'weld.json').exists():
  cached=json.loads((work/'weld.json').read_text())
  if cached.get('extractionSha256')==extraction_hash and digest(out)==cached['sha256']:
   return np.load(out)
 info=json.loads((work/'extraction.json').read_text());meta=json.loads((work/'source-ready.json').read_text())
 spacing=meta['sourceSpacingUm']/1000
 origin=(np.array(meta['paddedOriginXYZ'])-(np.array(meta['fullDimensionsXYZ'])-1)/2)*spacing
 point_blocks=[];face_blocks=[];total=0;previous=None;seams=[];aliases={}
 tolerance=1e-4 # millimetres: 0.1 µm, below position encoding precision
 def canonical(index):
  index=int(index)
  while index in aliases:index=aliases[index]
  return index
 def alias(a,b):
  a,b=canonical(a),canonical(b)
  if a!=b:aliases[max(a,b)]=min(a,b)
 for item in info['slabs']:
  chunk=np.load(work/'slabs'/f"{item['z0']:04}-{item['z1']:04}.npz")
  points=chunk['points'];faces=chunk['faces'];mapping=np.empty(len(points),np.uint32)
  low=np.float32(origin[2]+item['z0']*spacing);high=np.float32(origin[2]+item['z1']*spacing)
  bottom=np.flatnonzero(points[:,2]==low);top=np.flatnonzero(points[:,2]==high)
  new=np.ones(len(points),bool);exact=0;numerical=0;displacement=0.;alias_count=0
  if previous is not None:
   previous_points,previous_indices=previous
   assert bool(len(bottom))==bool(len(previous_points)),'inconsistent empty slab boundary'
   if len(bottom):
    current_points=points[bottom]
    forward,nearest=cKDTree(previous_points).query(current_points)
    backward,reverse=cKDTree(current_points).query(previous_points)
    assert max(forward.max(),backward.max())<=tolerance,(item['z0'],float(forward.max()),float(backward.max()),'unmatched slab contour')
    mapping[bottom]=previous_indices[nearest];new[bottom]=False
    # A contour point that rounds onto the slab boundary can occur only on one
    # side. Unify both directions so a tiny duplicate is not left as a crack.
    before=len(aliases)
    for i,other in enumerate(reverse):alias(previous_indices[i],mapping[bottom[other]])
    mapping[bottom]=np.array([canonical(v) for v in mapping[bottom]],dtype=np.uint32)
    lookup={int(idx):point for idx,point in zip(previous_indices,previous_points)}
    canonical_previous=np.array([lookup[canonical(v)] for v in previous_indices])
    canonical_current=np.array([lookup[int(v)] for v in mapping[bottom]])
    displacement=max(float(np.linalg.norm(previous_points-canonical_previous,axis=1).max()),
                     float(np.linalg.norm(current_points-canonical_current,axis=1).max()))
    assert displacement<=tolerance,(item['z0'],displacement,'seam tolerance exceeded')
    exact=int((forward==0).sum());numerical=int((forward>0).sum());alias_count=len(aliases)-before
  mapping[new]=np.arange(total,total+new.sum(),dtype=np.uint32)
  point_blocks.append(points[new]);face_blocks.append(mapping[faces]);total+=int(new.sum())
  previous=(points[top].copy(),mapping[top].copy())
  seams.append(dict(z=item['z0'],exactMatches=exact,numericalMatches=numerical,aliasedPreviousVertices=alias_count,
   maximumWeldDisplacementMm=displacement,unmatched=0))
 points=np.concatenate(point_blocks);faces=np.concatenate(face_blocks)
 remap=np.arange(len(points),dtype=np.uint32)
 for index in aliases:remap[index]=canonical(index)
 faces=remap[faces]
 valid=(faces[:,0]!=faces[:,1])&(faces[:,1]!=faces[:,2])&(faces[:,0]!=faces[:,2])
 collapsed=int((~valid).sum());faces=faces[valid]
 used=np.zeros(len(points),bool);used[faces]=True
 remap=np.cumsum(used,dtype=np.uint32)-1;points=points[used];faces=remap[faces]
 save_arrays(out,points=points,faces=faces)
 save_json(work/'weld.json',dict(vertices=len(points),triangles=len(faces),seams=seams,exactFrozenBoundaryWeld=False,
  weldToleranceMm=tolerance,maximumWeldDisplacementMm=max(s['maximumWeldDisplacementMm'] for s in seams),
  degenerateTrianglesRemoved=collapsed,numericalBoundaryAliases=len(aliases),
  extractionSha256=extraction_hash,sha256=digest(out)))
 log(stage='weld',vertices=len(points),triangles=len(faces))
 return dict(points=points,faces=faces)

def decimate(poly,target):
 if poly.GetNumberOfCells()<=target:return poly
 dec=vtk.vtkQuadricDecimation();dec.SetInputData(poly);dec.SetTargetReduction(1-target/poly.GetNumberOfCells())
 dec.VolumePreservationOn();dec.SetBoundaryWeightFactor(100.);dec.Update()
 result=vtk.vtkPolyData();result.ShallowCopy(dec.GetOutput());return result

def simplify_full(work,target):
 import fast_simplification
 input_path=work/'welded-reference.npz';out=work/'detail-fast.npz';record=work/'detail-fast.json'
 fingerprint=digest(input_path);method='fast_simplification-0.1.13-agg7'
 if record.exists() and out.exists():
  info=json.loads(record.read_text())
  if info.get('weldedSha256')==fingerprint and info.get('targetTriangles')==target and info.get('method')==method and digest(out)==info.get('sha256'):
   return info
 started=time.monotonic();data=np.load(input_path)
 points=np.asarray(data['points'],dtype=np.float64);faces=np.asarray(data['faces'],dtype=np.int32);del data
 log(stage='fast-qem-start',vertices=len(points),triangles=len(faces),target=target)
 points,faces=fast_simplification.simplify(points,faces,target_count=target,agg=7.,verbose=False)
 save_arrays(out,points=points.astype(np.float32),faces=faces.astype(np.uint32))
 info=dict(method=method,packageVersion=fast_simplification.__version__,weldedSha256=fingerprint,
  targetTriangles=target,vertices=len(points),triangles=len(faces),seconds=time.monotonic()-started,sha256=digest(out))
 save_json(record,info);log(stage='fast-qem-finished',**info);return info

def spatial_order(points,faces,normals):
 centers=points[faces].mean(axis=1);bounds=np.ptp(points,axis=0);q=np.clip((centers-points.min(axis=0))/np.maximum(bounds,1e-6)*1023,0,1023).astype(np.uint32)
 morton=np.zeros(len(faces),np.uint32)
 for bit in range(10):
  for axis in range(3):morton|=((q[:,axis]>>bit)&1)<<(3*bit+axis)
 faces=faces[np.argsort(morton,kind='stable')]
 used,first=np.unique(faces,return_index=True);order=used[np.argsort(first)];mapping=np.zeros(len(points),np.uint32);mapping[order]=np.arange(len(order),dtype=np.uint32)
 return points[order],mapping[faces],normals[order]

def write_hfm(poly,lod,meta,asset_dir):
 normals_filter=vtk.vtkPolyDataNormals();normals_filter.SetInputData(poly);normals_filter.ComputePointNormalsOn();normals_filter.ComputeCellNormalsOff()
 normals_filter.SplittingOff();normals_filter.ConsistencyOn();normals_filter.AutoOrientNormalsOff();normals_filter.Update()
 poly=normals_filter.GetOutput();points,faces=arrays(poly);normals=vtk_to_numpy(poly.GetPointData().GetNormals()).astype(np.float32,copy=True)
 triangles_before_encoding=len(faces)
 # A few nearly doubled, very thin sheets have cancelling point normals.
 # Use their largest incident nondegenerate face instead of shipping a zero
 # normal that the GPU cannot normalize. This affects shading, not positions.
 cross=np.cross(points[faces[:,1]]-points[faces[:,0]],points[faces[:,2]]-points[faces[:,0]])
 area2=np.linalg.norm(cross,axis=1);valid=area2>1e-12
 removed_degenerate=int((~valid).sum());faces=faces[valid];cross=cross[valid];area2=area2[valid]
 lengths=np.linalg.norm(normals,axis=1);bad=lengths<1e-8;repaired=int(bad.sum())
 if repaired:
  largest=np.zeros(len(points),np.float32);np.maximum.at(largest,faces.ravel(),np.repeat(area2,3))
  repaired=int((bad&(largest>0)).sum())
  for corner in range(3):
   vertex=faces[:,corner];choose=bad[vertex]&(area2>=largest[vertex])
   normals[vertex[choose]]=cross[choose]/area2[choose,None]
 normals/=np.maximum(np.linalg.norm(normals,axis=1,keepdims=True),1e-20)
 del cross,area2,lengths
 # AcquisitionXYZ -> current rendererXYZ is a right-handed rotation.
 points=points[:,[0,2,1]]*np.array([1,1,-1],np.float32)/meta['longestMm']
 normals=normals[:,[0,2,1]]*np.array([1,1,-1],np.float32)
 points,faces,normals=spatial_order(points,faces,normals)
 extent=np.array(meta['extent']);minimum=-extent/2;maximum=extent/2
 quantized=np.rint(np.clip((points-minimum)/extent,0,1)*65535).astype('<u2')
 reconstructed=minimum+quantized.astype(np.float64)/65535*extent
 errors=np.linalg.norm(points-reconstructed,axis=1)*meta['longestMm']
 quantized_cross=np.cross(reconstructed[faces[:,1]]-reconstructed[faces[:,0]],reconstructed[faces[:,2]]-reconstructed[faces[:,0]])
 valid=np.linalg.norm(quantized_cross,axis=1)>1e-20
 quantization_collapsed=int((~valid).sum());faces=faces[valid]
 normal_q=np.rint(np.clip(normals,-1,1)*32767).astype('<i2')
 pos_offset=32;normal_offset=(pos_offset+quantized.nbytes+3)&~3;index_offset=(normal_offset+normal_q.nbytes+3)&~3
 payload=bytearray(index_offset+faces.nbytes)
 struct.pack_into('<8I',payload,0,0x314d4648,1,len(points),faces.size,pos_offset,normal_offset,index_offset,0)
 payload[pos_offset:pos_offset+quantized.nbytes]=quantized.tobytes();payload[normal_offset:normal_offset+normal_q.nbytes]=normal_q.tobytes();payload[index_offset:]=faces.astype('<u4').tobytes()
 asset_dir.mkdir(parents=True,exist_ok=True);path=asset_dir/f'{lod}.hfm.gz'
 with path.open('wb') as stream:
  with gzip.GzipFile(filename='',fileobj=stream,mode='wb',compresslevel=9,mtime=0) as zipped:zipped.write(payload)
 item=dict(id=lod,label='Fine surface' if lod=='balanced' else 'Fine surface · detail',url=f'./assets/fine-surface-v19/{path.name}',
  vertices=len(points),triangles=len(faces),compressedBytes=path.stat().st_size,decodedBytes=len(payload),sha256=digest(path),
  decodedSha256=hashlib.sha256(payload).hexdigest(),quantizationMaximumMm=float(errors.max()),quantizationRmsMm=float(np.sqrt(np.mean(errors**2))))
 item.update(trianglesBeforeEncoding=triangles_before_encoding,removedZeroAreaTriangles=removed_degenerate,
  normalFallbackVertices=repaired,normalFallbackFraction=repaired/len(points),quantizationCollapsedTriangles=quantization_collapsed)
 log(stage='asset',**item);return item

def finish(work,detail_faces,balanced_faces,asset_dir):
 meta=assemble(work)
 detail_path=work/'detail-reference.vtp'
 detail_record=work/'detail-ready.json'
 joined=weld_slabs(work)
 del joined
 weld_hash=digest(work/'welded-reference.npz')
 cached=json.loads(detail_record.read_text()) if detail_record.exists() else {}
 method='fast_simplification-0.1.13-agg7'
 if detail_path.exists() and cached.get('weldedSha256')==weld_hash and cached.get('targetTriangles')==detail_faces and cached.get('method')==method and digest(detail_path)==cached.get('sha256'):
  reader=vtk.vtkXMLPolyDataReader();reader.SetFileName(str(detail_path));reader.Update();detail=vtk.vtkPolyData();detail.ShallowCopy(reader.GetOutput())
 else:
  # The fast QEM's native buffers are released when this child exits. Building
  # the compact VTK LOD afterwards keeps the 8 GiB preparation budget bounded.
  subprocess.run([sys.executable,str(Path(__file__).resolve()),'--stage','simplify','--work',str(work),'--detail-faces',str(detail_faces)],check=True)
  joined=np.load(work/'detail-fast.npz');detail=poly_from_arrays(joined['points'],joined['faces']);del joined
  writer=vtk.vtkXMLPolyDataWriter();writer.SetFileName(str(detail_path));writer.SetInputData(detail);writer.SetDataModeToAppended();writer.SetCompressorTypeToZLib();writer.Write()
  save_json(detail_record,dict(weldedSha256=weld_hash,targetTriangles=detail_faces,method=method,sha256=digest(detail_path)))
  log(stage='detail-checkpoint',triangles=detail.GetNumberOfCells())
 lods=[write_hfm(detail,'detail',meta,asset_dir)]
 balanced=decimate(detail,balanced_faces);lods.insert(0,write_hfm(balanced,'balanced',meta,asset_dir))
 writer=vtk.vtkXMLPolyDataWriter();writer.SetFileName(str(work/'balanced-reference.vtp'));writer.SetInputData(balanced);writer.SetDataModeToAppended();writer.SetCompressorTypeToZLib();writer.Write()
 extraction=json.loads((work/'extraction.json').read_text());weld=json.loads((work/'weld.json').read_text())
 source_credit=json.loads((ROOT/'public/assets/manifest.json').read_text())
 manifest=dict(schemaVersion=1,format='HFM1',donorId='ladaf-2021-17',sourceSpacingUm=meta['sourceSpacingUm'],threshold=.28,
  datasetUrl=source_credit['datasetUrl'],doiUrl=source_credit['doiUrl'],attribution=source_credit['attribution'],
  license=source_credit['license'],licenseUrl=source_credit['licenseUrl'],
  extent=meta['extent'],referenceDimensionsXYZ=[475,475,530],bounds=dict(min=(-np.array(meta['extent'])/2).tolist(),max=(np.array(meta['extent'])/2).tolist()),lods=lods,
  processing=dict(experimental=True,source='Existing verified cleaned/windowed 79.4 µm source volume; not a 19.85 µm extraction.',
   sourceManifest=meta['sourceManifest'],sourceManifestSha256=meta['sourceManifestSha256'],verifiedSourceBricks=meta['verifiedBlocks'],
   coordinateConvention='Existing Ultra endpoint convention; acquisitionXYZ maps to world(x,z,-y), centered on the full source grid. No new registration correction.',
   densityGaussianSigmaVoxels=extraction['sigmaVoxels'],densityGaussianSigmaMm=extraction['sigmaVoxels']*meta['sourceSpacingUm']/1000,
   referenceTriangles=extraction['referenceTriangles'],slabSimplificationTriangles=extraction['triangles'],weldedTriangles=weld['triangles'],
   frozenSlabBoundaries=True,slabTopologyPreserved=True,weldToleranceMm=weld['weldToleranceMm'],maximumWeldDisplacementMm=weld['maximumWeldDisplacementMm'],
   finalSimplification='Whole-object fast_simplification 0.1.13 quadric error simplification (aggressiveness 7) creates detail; VTK quadric decimation with its volume-preservation option creates compact. Lossy, not topology-guaranteed.',
   positionQuantizationBits=16,normalQuantizationBits=16,
   zeroNormalPolicy='A cancelling point normal uses the largest incident nondegenerate face normal; this only changes shading.',
   degenerateFacePolicy='Remove zero-area source triangles and triangles collapsed to zero area by position quantization; individual counts recorded for each LOD.',
   sourceDataChanged=False,expertValidated=False))
 save_json(asset_dir/'manifest.json',manifest);save_json(DOCS/'preparation.json',dict(source=meta,extraction=extraction,weld=weld,
  wholeObjectSimplification=json.loads((work/'detail-fast.json').read_text()),manifest=manifest))
 return manifest

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--stage',choices=['assemble','extract','simplify','finish','all'],default='all')
 p.add_argument('--work',type=Path,default=DEFAULT_WORK);p.add_argument('--workers',type=int,default=2)
 p.add_argument('--sigma',type=float,default=.8);p.add_argument('--slab-cells',type=int,default=64);p.add_argument('--slab-error-mm',type=float,default=.0794)
 p.add_argument('--detail-faces',type=int,default=2_000_000);p.add_argument('--balanced-faces',type=int,default=500_000);p.add_argument('--assets',type=Path,default=ASSET)
 a=p.parse_args()
 if a.stage in ['assemble','all']:assemble(a.work)
 if a.stage in ['extract','all']:extract(a.work,a.workers,a.sigma,a.slab_error_mm,a.slab_cells)
 if a.stage=='simplify':simplify_full(a.work,a.detail_faces)
 if a.stage in ['finish','all']:finish(a.work,a.detail_faces,a.balanced_faces,a.assets)

if __name__=='__main__':main()
