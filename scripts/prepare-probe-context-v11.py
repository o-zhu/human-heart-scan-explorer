#!/usr/bin/env python3
"""Build a small, credited reference torso from the official BodyParts3D archive.
This asset is an adult male anatomical reference, not a registration to an atlas donor.
Requires numpy and vtk. Source inputs are cached outside the repository.
"""
import argparse, gzip, hashlib, io, json, zipfile
from pathlib import Path
import numpy as np
import vtk
from vtk.util.numpy_support import numpy_to_vtk, vtk_to_numpy

parser=argparse.ArgumentParser();parser.add_argument('--cache',type=Path,required=True);parser.add_argument('--output',type=Path,default=Path('public/assets/probe-context-v11'));args=parser.parse_args()
archive=args.cache/'bodyparts3d-thorax-source.zip';parts=args.cache/'partof_element_parts.txt'
z=zipfile.ZipFile(archive);names={Path(k).stem:k for k in z.namelist()};rows=[x.split('\t') for x in parts.read_text().splitlines()[1:]]

def make(ids):
 vs=[];fs=[];offset=0
 for ident in ids:
  v=[];f=[]
  for line in z.read(names[ident]).decode().splitlines():
   if line.startswith('v '):v.append([float(x) for x in line.split()[1:4]])
   elif line.startswith('f '):
    q=[int(x.split('/')[0])-1+offset for x in line.split()[1:]]
    for i in range(1,len(q)-1):f.append([q[0],q[i],q[i+1]])
  vs.extend(v);fs.extend(f);offset+=len(v)
 a=np.asarray(vs,dtype=np.float32);a=a[:,[0,2,1]];a[:,1]-=1220;a[:,2]=-a[:,2]-115
 poly=vtk.vtkPolyData();points=vtk.vtkPoints();points.SetData(numpy_to_vtk(a,deep=True));poly.SetPoints(points)
 conn=np.column_stack([np.full(len(fs),3),np.asarray(fs,dtype=np.int64)]).ravel();cells=vtk.vtkCellArray();cells.SetCells(len(fs),numpy_to_vtk(conn,deep=True,array_type=vtk.VTK_ID_TYPE));poly.SetPolys(cells)
 clean=vtk.vtkCleanPolyData();clean.SetInputData(poly);clean.Update();return clean.GetOutput()

def clip(poly,normal,point):
 plane=vtk.vtkPlane();plane.SetNormal(*normal);plane.SetOrigin(*point)
 c=vtk.vtkClipPolyData();c.SetInputData(poly);c.SetClipFunction(plane);c.Update();return c.GetOutput()

def simplify(poly,target):
 if poly.GetNumberOfCells()>target:
  d=vtk.vtkQuadricDecimation();d.SetInputData(poly);d.SetTargetReduction(1-target/poly.GetNumberOfCells());d.VolumePreservationOn();d.Update();poly=d.GetOutput()
 normals=vtk.vtkPolyDataNormals();normals.SetInputData(poly);normals.ConsistencyOn();normals.SplittingOff();normals.AutoOrientNormalsOn();normals.ComputePointNormalsOn();normals.Update();return normals.GetOutput()

def interleave(poly):
 p=vtk_to_numpy(poly.GetPoints().GetData()).astype(np.float32);n=vtk_to_numpy(poly.GetPointData().GetNormals()).astype(np.float32);f=vtk_to_numpy(poly.GetPolys().GetData()).reshape(-1,4)[:,1:]
 return np.concatenate([p[f],n[f]],axis=2).astype('<f4').reshape(-1,6)

def ids_for(label):return list(dict.fromkeys(x[2] for x in rows if x[1]==label))

skin=make(ids_for('skin'));skin=clip(skin,[0,1,0],[0,-200,0]);skin=clip(skin,[0,-1,0],[0,220,0]);skin=clip(skin,[1,0,0],[-220,0,0]);skin=clip(skin,[-1,0,0],[220,0,0])
locator=vtk.vtkCellLocator();locator.SetDataSet(skin);locator.BuildLocator()
height=[];xs=np.linspace(-150,150,61);ys=np.linspace(-180,190,75)
for y in ys:
 for x in xs:
  hit=[0.,0.,0.];pcoord=[0.,0.,0.];t=vtk.mutable(0.);sid=vtk.mutable(0)
  found=locator.IntersectWithLine([float(x),float(y),240.],[float(x),float(y),-160.],1e-5,t,hit,pcoord,sid)
  height.append(round(hit[2],3) if found else None)

spec=[('skin',['skin'],6500,[.58,.34,.23],.13),('bones',['rib cage','right clavicle','left clavicle'],16000,[.83,.80,.68],.92),('spine',['thoracic vertebral column'],3800,[.68,.70,.65],.85),('heart',['heart'],3800,[.60,.24,.24],.88)]
blob=bytearray();meshes=[]
for name,labels,target,color,alpha in spec:
 ids=list(dict.fromkeys(i for label in labels for i in ids_for(label)));poly=skin if name=='skin' else make(ids);poly=simplify(poly,target);a=interleave(poly);b=a.tobytes()
 meshes.append(dict(name=name,sourceElements=ids,offset=len(blob),count=len(a),triangles=len(a)//3,color=color,alpha=alpha));blob.extend(b)
 print(name,len(a)//3,len(b),flush=True)
args.output.mkdir(parents=True,exist_ok=True);out=args.output/'torso.bin.gz';out.write_bytes(gzip.compress(bytes(blob),compresslevel=9,mtime=0))
manifest={'schemaVersion':1,'title':'BodyParts3D reference thorax','source':'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html','sourceArchiveUrl':'https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/partof_BP3D_4.0_obj_99.zip','sourceArchiveSha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'license':'CC BY 4.0','licenseUrl':'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html','attribution':'BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International','modifications':'Selected thoracic reference meshes, clipped the skin to the torso, decimated meshes, recalculated normals and transformed coordinates for educational display. Not registered to any HiP-CT donor.','dataFile':'torso.bin.gz','sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'compressedBytes':out.stat().st_size,'decodedBytes':len(blob),'format':'Little-endian float32 interleaved XYZ position in millimetres, XYZ normal; non-indexed triangles','coordinateTransform':'[raw X, raw Z - 1220, -raw Y - 115]; X = patient left; Y = superior; Z = anterior','meshes':meshes,'skinHeight':{'width':len(xs),'height':len(ys),'xRange':[float(xs[0]),float(xs[-1])],'yRange':[float(ys[0]),float(ys[-1])],'values':height},'referenceHeartCenter':[20,5,8],'limitations':['Reference adult male anatomy, not donor-specific anatomy.','Skin contact sites and probe rays are illustrative and not clinical window registration.','Bone surfaces are orientation context only; they are not used in the CT-derived acoustic simulation.']}
(args.output/'manifest.json').write_text(json.dumps(manifest,separators=(',',':'))+'\n')
print('compressed',out.stat().st_size,'manifest',(args.output/'manifest.json').stat().st_size,flush=True)
