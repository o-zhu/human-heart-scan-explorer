#!/usr/bin/env python3
"""Bounded read-only timing of unchanged VTK closest-distance paths."""
import os,sys,resource
for key in ('OPENBLAS_NUM_THREADS','OMP_NUM_THREADS','MKL_NUM_THREADS','VTK_SMP_MAX_THREADS'):
 os.environ[key]='1'
os.environ['PYTHONDONTWRITEBYTECODE']='1';sys.dont_write_bytecode=True
resource.setrlimit(resource.RLIMIT_AS,(1024**3,1024**3))
from pathlib import Path
import gzip,hashlib,json,struct,time,gc
import numpy as np
ROOT=Path('{local-workspace}')
sys.path.insert(0,str(ROOT/'scripts/guided-native-v21'))
import build_overview as b
OUT=Path('{source-cache}/guided-native-v21/whole/overview')
RUN=OUT.parent/'run'
started=time.perf_counter()
meta=json.loads((OUT/'overview.json').read_text());part=meta['parts'][0]
encoded=(OUT/part['path']).read_bytes();assert hashlib.sha256(encoded).hexdigest()==part['sha256']
decoded=gzip.decompress(encoded);assert hashlib.sha256(decoded).hexdigest()==part['decodedSha256']
magic,version,nv,ni,po,no,io,flags=struct.unpack('<8I',decoded[:32])
assert (magic,version,flags)==(0x314d4648,1,1)
world=np.frombuffer(decoded,dtype='<f4',count=3*nv,offset=po).reshape(-1,3)
points=b.from_world(world);faces=np.frombuffer(decoded,dtype='<u4',count=ni,offset=io).reshape(-1,3).copy()
with np.load(OUT/'nodes/s064_0_0_0.npz',allow_pickle=False) as z:
 all_samples=z['referenceSamples'];indices=np.linspace(0,len(all_samples)-1,1024,dtype=np.int64);samples=all_samples[indices].copy()
del encoded,decoded,world,all_samples;gc.collect()
v=b.vtk_api()
start=time.perf_counter();poly=b.polydata(points,faces);poly_seconds=time.perf_counter()-start
implicit=v['vtkImplicitPolyDataDistance']()
start=time.perf_counter();implicit.SetInput(poly);set_input_seconds=time.perf_counter()-start
source=v['numpy_to_vtk'](np.ascontiguousarray(samples,np.float64),deep=False)
output=v['vtkDoubleArray']();output.SetNumberOfComponents(1);output.SetNumberOfTuples(len(samples))
start=time.perf_counter();implicit.FunctionValue(source,output);bulk_seconds=time.perf_counter()-start
bulk=np.abs(v['vtk_to_numpy'](output).copy())
# The same locator, same samples, same exact scalar function: isolate wrapper cost.
start=time.perf_counter();scalar=np.array([abs(implicit.FunctionValue(row)) for row in samples]);scalar_seconds=time.perf_counter()-start
assert np.array_equal(bulk,scalar)
del implicit,poly,source,output;gc.collect()
start=time.perf_counter();unchanged=b.closest_distances(points,faces,samples);helper_seconds=time.perf_counter()-start
assert np.array_equal(unchanged,bulk)
global_probe=dict(triangles=len(faces),vertices=len(points),actualOriginalReferenceSamples=len(samples),
 sampleSelection='1,024 evenly indexed original leaf samples from the actual completed root checkpoint; not an area-weighted runtime forecast',
 sampleSha256=hashlib.sha256(samples.tobytes()).hexdigest(),polydataSeconds=poly_seconds,
 setInputLocatorSeconds=set_input_seconds,bulkFunctionValueSeconds=bulk_seconds,
 scalarFunctionValueSeconds=scalar_seconds,unchangedHelperSeconds=helper_seconds,
 bulkAndScalarResultsBitIdentical=True,unchangedHelperResultsBitIdentical=True,
 outputDistanceSha256=hashlib.sha256(bulk.tobytes()).hexdigest(),maximumDistanceNativeVoxels=float(bulk.max()))
print(json.dumps({'stage':'global-probe','result':global_probe}),flush=True)
del points,faces,samples,unchanged,bulk,scalar;gc.collect()
try:
 import ctypes
 ctypes.CDLL(None).malloc_trim(0)
except Exception:pass
# One existing dense source leaf: measure repeat decode/weld and locator setup.
node_name='s002_36_20_14'
with np.load(OUT/'nodes'/f'{node_name}.npz',allow_pickle=False) as z:samples=z['referenceSamples'][:32].copy()
records=[]
for x in (36,37):
 for y in (20,21):
  for zz in (14,15):
   r=json.loads((RUN/'records'/f'{x}_{y}_{zz}.json').read_text())
   a=next(a for a in r['artifacts'] if a['role']=='overview')
   records.append(dict(a,coordinatesXYZ=[x,y,zz]))
builder=b.Builder.__new__(b.Builder);builder.run=RUN
start=time.perf_counter();points,faces,_,_=builder.decode_records(records);decode_seconds=time.perf_counter()-start
start=time.perf_counter();poly=b.polydata(points,faces);poly_seconds=time.perf_counter()-start
implicit=v['vtkImplicitPolyDataDistance']()
start=time.perf_counter();implicit.SetInput(poly);set_input_seconds=time.perf_counter()-start
source=v['numpy_to_vtk'](samples,deep=False);output=v['vtkDoubleArray']();output.SetNumberOfComponents(1);output.SetNumberOfTuples(len(samples))
start=time.perf_counter();implicit.FunctionValue(source,output);query_seconds=time.perf_counter()-start
leaf_probe=dict(node=node_name,originalOverviewTiles=len(records),triangles=len(faces),vertices=len(points),actualOriginalLeafSamples=len(samples),
 decodeAndExactWeldSeconds=decode_seconds,polydataSeconds=poly_seconds,setInputLocatorSeconds=set_input_seconds,bulkFunctionValueSeconds=query_seconds,
 caveat='These 32 reference samples lie on the original leaf surface; this isolates setup cost and is not the actual reverse-distance sample distribution.')
result=dict(schema='guided-native-overview-distance-timing-v21.1',readOnly=True,productionOutputsWritten=False,networkRequests=0,
 builderSha256=b.digest(Path(b.__file__)),overviewArtifactSha256=part['sha256'],addressSpaceLimitBytes=1024**3,
 globalProbe=global_probe,denseLeafProbe=leaf_probe,peakRssBytes=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024,
 totalSeconds=time.perf_counter()-started,
 conclusionScope='Concurrent local timing probe only. No full validation sample set, production array or scientific setting was changed.')
Path('{temporary-cache}').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result),flush=True)
