#!/usr/bin/env python3
"""Bounded paired CT intensity-isosurface experiment; no geometric smoothing.

Regenerates four sampled acquired phases at one physical threshold from the
original CT and from its 2x2x2 voxel means. All extracted triangles are retained; no decimation or geometry smoothing.
These surfaces are not chamber/myocardium segmentations or clinical measurements.
"""
from pathlib import Path
import gzip, hashlib, json, struct, time, gc
import numpy as np
import vtk
from vtk.util.numpy_support import numpy_to_vtk, vtk_to_numpy

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path('/workspace/scratch/7d584d74921e/clinical-v19/slicerheart')
OUT = ROOT/'public/assets/motion-lab-v24/native-ct'
METRICS = ROOT/'docs/motion-lab-v24/native-ct-metrics.json'
PHASES = [0, 5, 10, 15]
THRESHOLD = 232.0
SPACING = np.array([0.599609375, 0.599609375, 0.7])
ORIGIN = np.array([-145.1999969482422, 8.94163990020752, 903.0999755859374])
CROP_ORIGIN = ORIGIN + SPACING*np.array([60,115,0])
DIMS = np.array([290,250,218])
CENTER = CROP_ORIGIN + SPACING*(DIMS-1)/2
WORLD_MM = float(np.max(SPACING*DIMS))


def sha(data): return hashlib.sha256(data).hexdigest()
def file_sha(path):
    h=hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(8*1024*1024),b''):h.update(block)
    return h.hexdigest()
def bounds(points): return {'min': points.min(axis=0).tolist(), 'max': points.max(axis=0).tolist()}
def mapped(points):
    p = (points-CENTER)/WORLD_MM
    return p[:,[0,2,1]]*np.array([1,1,-1])
def extract(values, spacing, origin):
    image = vtk.vtkImageData()
    image.SetDimensions(*values.shape[::-1])
    image.SetSpacing(*spacing)
    image.SetOrigin(*origin)
    image.GetPointData().SetScalars(numpy_to_vtk(np.ascontiguousarray(values).ravel(), deep=True))
    f = vtk.vtkFlyingEdges3D()
    f.SetInputData(image); f.SetValue(0,THRESHOLD)
    f.ComputeNormalsOff(); f.ComputeGradientsOff(); f.Update()
    p = vtk.vtkPolyData(); p.ShallowCopy(f.GetOutput())
    return p

def arrays(poly):
    points=vtk_to_numpy(poly.GetPoints().GetData())
    faces=vtk_to_numpy(poly.GetPolys().GetConnectivityArray()).reshape(-1,3)
    return points,faces

def samples(poly,n=6000,seed=2400):
    p,f=arrays(poly);rng=np.random.default_rng(seed)
    # Triangle-area-weighted random surface sampling, deterministic seeds.
    a=p[f[:,1]]-p[f[:,0]];b=p[f[:,2]]-p[f[:,0]]
    areas=np.linalg.norm(np.cross(a,b),axis=1)*.5
    ids=rng.choice(len(f),size=n,p=areas/areas.sum())
    tri=p[f[ids]];r=np.sqrt(rng.random(n));s=rng.random(n)
    return (1-r)[:,None]*tri[:,0]+(r*(1-s))[:,None]*tri[:,1]+(r*s)[:,None]*tri[:,2]

def distances(points,target):
    locator=vtk.vtkStaticCellLocator();locator.SetDataSet(target);locator.BuildLocator()
    out=np.empty(len(points));closest=[0.,0.,0.]
    cid=vtk.reference(0);sid=vtk.reference(0);d2=vtk.reference(0.)
    for i,p in enumerate(points):
        locator.FindClosestPoint(p,closest,cid,sid,d2);out[i]=np.sqrt(float(d2))
    return out

def stats(d):
    return {'samples':len(d),'meanMm':float(d.mean()),'rmsMm':float(np.sqrt(np.mean(d*d))),
            'p50Mm':float(np.quantile(d,.5)),'p95Mm':float(np.quantile(d,.95)),
            'p99Mm':float(np.quantile(d,.99)),'sampleMaxMm':float(d.max())}

def error(reference, simplified, seed):
    a=distances(samples(reference,seed=seed),simplified)
    b=distances(samples(simplified,seed=seed+1),reference)
    return {'referenceToDelivered':stats(a),'deliveredToReference':stats(b),
            'pooled':stats(np.concatenate([a,b])),
            'method':'6000 triangle-area-weighted samples per direction; exact point-to-triangle closest distances through vtkStaticCellLocator; deterministic seed; sample maximum is not a Hausdorff bound.'}

def write_mesh(poly,name):
    normals=vtk.vtkPolyDataNormals();normals.SetInputData(poly)
    normals.ComputePointNormalsOn();normals.ComputeCellNormalsOff()
    normals.SplittingOff();normals.ConsistencyOn();normals.AutoOrientNormalsOff();normals.Update()
    p=normals.GetOutput();points,faces=arrays(p)
    n=vtk_to_numpy(p.GetPointData().GetNormals())[:,[0,2,1]]*np.array([1,1,-1])
    pos=np.asarray(mapped(points),dtype='<f4')
    norm=np.asarray(np.rint(np.clip(n,-1,1)*32767),dtype='<i2')
    idx=np.asarray(faces,dtype='<u4').ravel()
    noff=32+pos.nbytes;ioff=(noff+norm.nbytes+3)&~3
    data=struct.pack('<8I',0x314d4648,1,len(pos),len(idx),32,noff,ioff,1)+pos.tobytes()+norm.tobytes()+bytes(ioff-noff-norm.nbytes)+idx.tobytes()
    compressed=gzip.compress(data,compresslevel=9,mtime=0)
    (OUT/name).write_bytes(compressed)
    return {'url':'/assets/motion-lab-v24/native-ct/'+name,'sha256':sha(compressed),'decodedSha256':sha(data),
            'compressedBytes':len(compressed),'decodedBytes':len(data),'bounds':bounds(pos),
            'triangles':len(faces),'vertices':len(pos),'positionFormat':'float32','normalFormat':'snorm16',
            'format':'HFM1','compression':'gzip','positionEncodingMaxErrorMm':float(np.max(np.linalg.norm(pos.astype(float)-mapped(points),axis=1))*WORLD_MM)}


def main():
    OUT.mkdir(parents=True,exist_ok=True);METRICS.parent.mkdir(parents=True,exist_ok=True)
    rawpath=SOURCE/'source-zyxt-int16.raw'
    for path,expected in [(SOURCE/'TruncalValve_4DCT.seq.nrrd','7573f1bc7ca92d7d1012eecf98211cfd9939c1d22d87aee1db91c8ab72031cfb'),(rawpath,'25cd532d9692c9e5852ce421f3d3e98a40d190086e3e91f8fa8347ebf803ca68')]:
        if file_sha(path)!=expected:raise RuntimeError(f'Source checksum mismatch: {path}')
    raw=np.memmap(rawpath,dtype='<i2',mode='r',shape=(218,391,512,21))
    support_min=CROP_ORIGIN-SPACING/2;support_max=CROP_ORIGIN+SPACING*(DIMS-.5)
    corners=np.array([[x,y,z] for x in [support_min[0],support_max[0]] for y in [support_min[1],support_max[1]] for z in [support_min[2],support_max[2]]])
    header=(SOURCE/'source-header.txt').read_bytes()
    manifest={'schemaVersion':1,'id':'slicerheart-native-ct-motion-v24','phaseCount':0,'originalPhaseIndices':[],
      'acquiredUniquePhaseCount':20,'omittedDuplicatePhase':20,'knownPhysicalTimestamps':False,
      'description':'Four acquired CT phases: native sampling versus 2×2×2 voxel means, at matched stored-intensity threshold 232. Both surfaces retain every extracted triangle without decimation. Threshold surfaces are not anatomical segmentations. No geometry smoothing or temporal interpolation.',
      'worldMm':WORLD_MM,'bounds':bounds(mapped(corners)),'coordinateMapping':'(RAS x, RAS z, -RAS y), centered on the fixed physical crop center, divided by worldMm',
      'fixedCropCenterRasMm':CENTER.tolist(),'cropOriginRasMm':CROP_ORIGIN.tolist(),
      'nativeSpacingXyzMm':SPACING.tolist(),'overviewSpacingXyzMm':(2*SPACING).tolist(),
      'nativeDimensionsXyz':DIMS.tolist(),'overviewDimensionsXyz':(DIMS//2).tolist(),
      'thresholdStoredIntensity':THRESHOLD,'displayWindow':[-200,1000],'normalizedDisplayThreshold':.36,
      'overviewMethod':'2×2×2 arithmetic mean in float32; physical sample location is block center. This paired comparison precedes the uint8 display quantization of the existing overview volume.',
      'simplification':{'applied':False,'method':'none','preservesConnectivity':True,'geometrySmoothing':False,'normalsOnly':'point normals computed for display; no vertex-position smoothing'},
      'source':{'url':'https://github.com/SlicerHeart/SlicerHeart/releases/download/TestingData/TruncalValve_4DCT.seq.nrrd','file':'TruncalValve_4DCT.seq.nrrd','sha256':'7573f1bc7ca92d7d1012eecf98211cfd9939c1d22d87aee1db91c8ab72031cfb','bytes':1267650314,'headerSha256':sha(header),'header':header.decode(),'checksumsVerifiedAgainstOriginalFiles':True,'rawSha256':'25cd532d9692c9e5852ce421f3d3e98a40d190086e3e91f8fa8347ebf803ca68','rawBytes':rawpath.stat().st_size,'rawShapeZyxt':[218,391,512,21],'rawDtype':'little-endian int16','cropXyzHalfOpen':[[60,350],[115,365],[0,218]],'clinicalContext':'Adolescent with repaired truncus arteriosus, as described in the SlicerHeart sample registry; not a healthy reference subject.'},
      'frames':[],'complete':False}
    metrics={'schemaVersion':1,'thresholdStoredIntensity':THRESHOLD,'triangleCap':None,'frames':[],
       'limitations':['Threshold surfaces include structures and intensity noise outside cardiac tissue; these are not anatomical segmentations.','All extracted triangles are retained. Float32 normalized positions and int16 normals are delivery encodings; no geometry smoothing or decimation was applied.','Distances quantify delivery simplification and sampling effects, not anatomical accuracy or clinical validity.','Frame indices are acquisition indices; physical times and RR percentage were not supplied. Phase 20 duplicates phase 0.'],
       'software':{'numpy':np.__version__,'vtk':vtk.vtkVersion.GetVTKVersion()}}
    t0=time.time()
    for pi,phase in enumerate(PHASES):
        t=time.time();v=np.asarray(raw[:218,115:365,60:350,phase],dtype=np.float32)
        mean=v.reshape(109,2,125,2,145,2).mean(axis=(1,3,5))
        native=extract(v,SPACING,CROP_ORIGIN);overview=extract(mean,SPACING*2,CROP_ORIGIN+SPACING/2)
        full={'native':native,'overview':overview};frame={'phase':phase,'index':pi};fm={'phase':phase,'surfaces':{}}
        print('phase',phase,'extracted', {k:p.GetNumberOfCells() for k,p in full.items()},'seconds',round(time.time()-t,2),flush=True)
        delivered={}
        for key,poly in full.items():
            td=time.time();p=poly;delivered[key]=p
            rec=write_mesh(p,f'{key}-phase-{phase:02d}.hfm.gz')
            rec['sourceTriangles']=poly.GetNumberOfCells();rec['sourceVertices']=poly.GetNumberOfPoints()
            frame[key]=rec
            print('phase',phase,key,'delivered',rec['triangles'],'compressedBytes',rec['compressedBytes'],'seconds',round(time.time()-td,2),flush=True)
            fm['surfaces'][key]={'sourceTriangles':poly.GetNumberOfCells(),'sourceVertices':poly.GetNumberOfPoints(),'deliveredTriangles':p.GetNumberOfCells(),'deliveredVertices':p.GetNumberOfPoints(),'simplificationError':error(poly,p,24000+phase*10+(0 if key=='native' else 2))}
            frame[key]['simplificationErrorMm']=fm['surfaces'][key]['simplificationError']['pooled']
        fm['nativeVersusOverviewFullSurfaceDistance']={
          'nativeToOverview':stats(distances(samples(native,seed=25000+phase),overview)),
          'overviewToNative':stats(distances(samples(overview,seed=26000+phase),native)),
          'method':'6000 triangle-area-weighted samples in each direction; original unsimplified intensity surfaces; mm; sampled maximum, not Hausdorff.'}
        fm['seconds']=round(time.time()-t,3);metrics['frames'].append(fm)
        manifest['frames'].append(frame);manifest['phaseCount']=len(manifest['frames']);manifest['originalPhaseIndices']=[f['phase'] for f in manifest['frames']]
        manifest['compressedMeshBytes']=sum(f[k]['compressedBytes'] for f in manifest['frames'] for k in ['native','overview'])
        manifest['complete']=len(manifest['frames'])==len(PHASES)
        (OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
        METRICS.write_text(json.dumps(metrics,indent=2)+'\n')
        print('PHASE_READY',phase,'totalBytes',manifest['compressedMeshBytes'],'elapsed',round(time.time()-t0,2),flush=True)
        del v,mean,native,overview,full,delivered,poly,p;gc.collect()
    metrics['totalSeconds']=round(time.time()-t0,3)
    METRICS.write_text(json.dumps(metrics,indent=2)+'\n')
    if manifest['compressedMeshBytes']>160_000_000: raise RuntimeError('Asset budget exceeded')
    print('COMPLETE',manifest['compressedMeshBytes'],flush=True)

if __name__=='__main__':main()
