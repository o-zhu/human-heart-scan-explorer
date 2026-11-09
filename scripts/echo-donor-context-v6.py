#!/usr/bin/env python3
"""Reproduce S-20 support hulls and fixed-organ clearance from immutable source masks.

Checks the complete surfaces, including triangle interiors sampled at <=0.8 mm
edge spacing. The conservative lower bound subtracts both half a source support
cell diagonal and the sampling radius from the nearest boundary-cell distance.
The support already includes the documented conservative source margin. This
establishes exterior-envelope separation, not patient-anatomical registration.
"""
from pathlib import Path
import argparse,gzip,hashlib,json,math,subprocess,tempfile
import numpy as np
from scipy.ndimage import binary_erosion
from scipy.spatial import ConvexHull,cKDTree
ROOT=Path(__file__).resolve().parents[1]
P=argparse.ArgumentParser(description=__doc__)
P.add_argument('--output',type=Path,default=ROOT/'docs/echo-donor-context-v6')
P.add_argument('--write-support',action='store_true')
A=P.parse_args();A.output.mkdir(parents=True,exist_ok=True)
sha=lambda b:hashlib.sha256(b).hexdigest()
SUPPORT={};SOURCES={}
for donor in ['s-20-29','s-20-28']:
 m=json.loads((ROOT/f'public/assets/donors/{donor}/cleanup/manifest.json').read_text())
 packed=(ROOT/'public'/m['volumeUrl']).read_bytes();raw=gzip.decompress(packed)
 assert m['sha256'] in [sha(packed),sha(raw)],f'{donor}: source hash mismatch'
 dims=np.asarray(m['dimensions']);extent=np.asarray(m['physicalCenterExtentUm'])/1000
 support=np.frombuffer(raw,np.uint8).reshape(dims[::-1])>0
 boundary=np.stack(np.nonzero(support & ~binary_erosion(support)),axis=1)[:,::-1]
 xyz=(boundary/(dims-1)-.5)*extent
 world=xyz[:,[0,2,1]]*[1,1,-1]
 hull=ConvexHull(world);points=world[hull.vertices]
 SUPPORT[donor]={'referenceMm':float(extent.max()),'pointsMm':np.round(points,5).tolist(),
  'boundsMm':{'min':world.min(0).tolist(),'max':world.max(0).tolist()},'sourceSha256':m['sha256'],
  'supportDimensions':m['dimensions'],'voxelDiagonalMm':float(np.linalg.norm(extent/(dims-1)))}
 SOURCES[donor]=(m,support,world,hull)
if A.write_support:
 (ROOT/'public/echo-donor-support.js').write_text('/** Convex support vertices derived from each immutable retained-source support mask. */\nexport const ECHO_DONOR_SUPPORT='+json.dumps(SUPPORT,separators=(',',':'))+';\n')
else:
 existing=subprocess.check_output(['node','--input-type=module','-e',"import{ECHO_DONOR_SUPPORT as x}from './public/echo-donor-support.js';console.log(JSON.stringify(x))"],cwd=ROOT)
 actual=json.loads(existing)
 for donor,s in SUPPORT.items():
  assert np.allclose(actual[donor]['pointsMm'],s['pointsMm'],atol=1e-5),donor+' support hull changed'
report={'revision':'specimen-context-clearance-v6','method':__doc__,'donors':{}}
body_report={'revision':'specimen-torso-clearance-v6','donors':{}}
with tempfile.TemporaryDirectory(prefix='heart-context-',dir='/dev/shm') as td:
 code="""
import{getEchoDonorCalibration}from './public/echo-donor-calibration.js';
import{createTeeContextModel}from './public/tee-context-geometry.js';
import{createTteContextModel}from './public/tte-atlas-geometry.js';
import{decodeEchoReferenceAnatomy,createEchoAnatomyContext,worldToBodyReference,sampleEchoBodySkin}from './public/echo-anatomy-context-v2.js';
import{readFileSync,writeFileSync}from 'node:fs';
const path=process.argv[1];
const referenceAnatomy=await decodeEchoReferenceAnatomy({manifestBytes:readFileSync('public/assets/probe-context-v11/manifest.json'),compressedBytes:readFileSync('public/assets/probe-context-v11/torso.bin.gz')});
for(const donorId of ['s-20-29','s-20-28']){
 const c=getEchoDonorCalibration(donorId),m=createTeeContextModel({donorId,referenceMm:c.referenceMm});
 const meshes=m.meshes.map(x=>{writeFileSync(path+'/'+donorId+'-'+x.id+'.f32',Buffer.from(x.vertices.buffer,x.vertices.byteOffset,x.vertices.byteLength));return{id:x.id,count:x.vertices.length,alpha:x.alpha};});
 const body=createEchoAnatomyContext({baseModel:createTteContextModel({donorId,referenceMm:c.referenceMm}),referenceAnatomy});
 const bodyMeshes=body.meshes.filter(x=>x.id.startsWith('bodyparts3d-')).map(x=>{writeFileSync(path+'/'+donorId+'-'+x.id+'.f32',Buffer.from(x.vertices.buffer,x.vertices.byteOffset,x.vertices.byteLength));return{id:x.id};});
 const points=c.sourceSupportPointsMm.map(p=>worldToBodyReference(p,body));let missingSkinIntersections=0,minimumAnteriorSkinGapMm=Infinity;
 for(const p of points){const skin=sampleEchoBodySkin(body,p[0],p[1]);if(!skin)missingSkinIntersections++;else minimumAnteriorSkinGapMm=Math.min(minimumAnteriorSkinGapMm,(skin.bodyPointMm[2]-p[2])*body.bodyTransform.scale);}
 const bodyPlacement={bodyTransform:body.bodyTransform,sourceHullVertices:points.length,referenceBounds:{min:[0,1,2].map(k=>Math.min(...points.map(p=>p[k]))),max:[0,1,2].map(k=>Math.max(...points.map(p=>p[k])))},missingSkinIntersections,minimumAnteriorSkinGapMm,referenceSkinSha256:body.skinSurface.sourceSha256};
 writeFileSync(path+'/'+donorId+'.json',JSON.stringify({meshes,bodyMeshes,bodyPlacement,calibration:{...c,sourceSupportPointsMm:undefined},landmarksMm:m.landmarksMm,frame:m.frame,tractSamples:m.tractSamples}));
}
"""
 subprocess.run(['node','--input-type=module','-e',code,td],cwd=ROOT,check=True)
 for donor,(m,support,world,hull) in SOURCES.items():
  model=json.loads(Path(td,f'{donor}.json').read_text());tree=cKDTree(world)
  dims=np.asarray(m['dimensions']);extent=np.asarray(m['physicalCenterExtentUm'])/1000
  guard=SUPPORT[donor]['voxelDiagonalMm']/2
  entry={'sourceMaskSha256':m['sha256'],'boundaryCells':len(world),'hullVertices':len(SUPPORT[donor]['pointsMm']),
   'cellDiagonalMm':guard*2,'triangleSampleMaximumEdgeMm':.8,'calibration':model['calibration'],'meshes':{}}
  for mesh in model['meshes']:
   v=np.fromfile(Path(td,f'{donor}-{mesh["id"]}.f32'),'<f4').reshape(-1,6)[:,:3]
   triangles=v.reshape(-1,3,3);length=np.linalg.norm(triangles-np.roll(triangles,1,axis=1),axis=2).max(1)
   subdivisions=np.maximum(1,np.ceil(length/.8).astype(int));minimum=float('inf');inside=0;total=0
   for n in np.unique(subdivisions):
    t=triangles[subdivisions==n]
    bary=np.array([(i/n,j/n)for i in range(n+1)for j in range(n+1-i)])
    points=(t[:,None,0,:]+bary[None,:,0,None]*(t[:,None,1,:]-t[:,None,0,:])+bary[None,:,1,None]*(t[:,None,2,:]-t[:,None,0,:])).reshape(-1,3)
    distance,_=tree.query(points,workers=2);minimum=min(minimum,float(distance.min()));total+=len(points)
    source=points[:,[0,2,1]]*[1,-1,1]
    ijk=np.rint((source/extent+.5)*(dims-1)).astype(int);valid=np.all((ijk>=0)&(ijk<dims),axis=1)
    q=ijk[valid];inside+=int(support[q[:,2],q[:,1],q[:,0]].sum())
   lower=minimum-guard-.8
   # Every triangle must lie completely outside one plane of the source
   # convex hull. A positive bound rules out placing an organ in a cavity as
   # well as intersecting tissue, without relying on interior sampling.
   hull_separation=float('inf')
   for begin in range(0,len(triangles),160):
    planes=triangles[begin:begin+160]@hull.equations[:,:3].T+hull.equations[:,3]
    hull_separation=min(hull_separation,float(planes.min(axis=1).max(axis=1).min()))
   entry['meshes'][mesh['id']]={'triangles':len(triangles),'samples':total,'minimumBoundaryCellDistanceMm':minimum,'conservativeSurfaceClearanceMm':lower,'samplesInsideSupport':inside,
    'continuousConvexEnvelopeSeparationMm':hull_separation-guard}
   assert inside==0 and lower>0, f'{donor} {mesh["id"]}: retained-source envelope overlap ({lower})'
   assert hull_separation>guard,f'{donor} {mesh["id"]}: triangle enters convex source envelope'
  report['donors'][donor]=entry
  print(donor,'min conservative mesh clearance mm',min(x['conservativeSurfaceClearanceMm']for x in entry['meshes'].values()),flush=True)
  body_entry=model['bodyPlacement'];body_entry['sourceMaskSha256']=m['sha256'];body_entry['meshes']={}
  for mesh in model['bodyMeshes']:
   triangles=np.fromfile(Path(td,f'{donor}-{mesh["id"]}.f32'),'<f4').reshape(-1,6)[:,:3].reshape(-1,3,3)
   separation=float('inf');failed=0
   for begin in range(0,len(triangles),160):
    planes=triangles[begin:begin+160]@hull.equations[:,:3].T+hull.equations[:,3]
    margin=planes.min(axis=1).max(axis=1)-guard
    separation=min(separation,float(margin.min()));failed+=int((margin<=2).sum())
   body_entry['meshes'][mesh['id']]={'triangles':len(triangles),'continuousConvexEnvelopeSeparationMm':separation,'trianglesWithout2MmGuard':failed}
   assert failed==0,f'{donor}: reference thorax lacks the 2 mm source-envelope guard'
  assert body_entry['missingSkinIntersections']==0 and body_entry['minimumAnteriorSkinGapMm']>0
  body_report['donors'][donor]=body_entry
  print(donor,'min reference bone clearance mm',body_entry['meshes']['bodyparts3d-bones']['continuousConvexEnvelopeSeparationMm'],flush=True)
report['sourceHashes']={p:sha((ROOT/p).read_bytes())for p in ['public/echo-donor-calibration.js','public/echo-donor-support.js','public/tee-context-geometry.js','public/echo-anatomy-context-v2.js','scripts/echo-donor-context-v6.py','docs/anatomy-donors-v17/source-guides.json']}
(A.output/'clearance.json').write_text(json.dumps(report,indent=2)+'\n')
body_report['sourceHashes']=report['sourceHashes']
(A.output/'body-placement.json').write_text(json.dumps(body_report,indent=2)+'\n')
