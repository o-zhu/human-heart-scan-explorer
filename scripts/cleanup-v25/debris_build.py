#!/usr/bin/env python3
"""Build source-pinned, reversible Gentle whole-mesh detached-fragment flags.

Positions, normals and triangle indices are never edited. Connectivity is
computed before clipping. Requires Python + NumPy and a local C++ compiler;
the viewer consumes the generated ordinary gzip/JSON assets without either.
"""
from pathlib import Path
import argparse
import ctypes
import csv
import gzip
import hashlib
import json
import resource
import subprocess
import sys
import tempfile
import time
import numpy as np

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/lumen-artifacts-v23'))
from mesh_transport import load_mesh_arrays

EXPECTED='175548ddaad01c409d59d561df6018c5cb0c90752b2ec771899c255065398dae'
UINT_MAX=np.iinfo(np.uint32).max
ASSETS=ROOT/'public/assets/cleanup-v25'
DOCS=ROOT/'docs/cleanup-v25'
START=time.monotonic()

def log(message):
    print(json.dumps({'seconds':round(time.monotonic()-START,2),
      'peakRssMiB':round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024,1),
      'message':message}),flush=True)

def digest(data): return hashlib.sha256(data).hexdigest()

def write_gzip(name,data):
    path=ASSETS/name
    with path.open('wb') as target:
        with gzip.GzipFile(filename='',mode='wb',fileobj=target,compresslevel=9,mtime=0) as stream:
            stream.write(data)
    encoded=path.read_bytes()
    assert gzip.decompress(encoded)==data
    return {'url':'./assets/cleanup-v25/'+name,'compressedBytes':len(encoded),
      'decodedBytes':len(data),'sha256':digest(encoded),'decodedSha256':digest(data)}

def json_write(path,value):
    path.write_text(json.dumps(value,indent=2,allow_nan=False)+'\n')

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--diameter-mm',type=float,default=.85)
    parser.add_argument('--max-triangles',type=int,default=1024)
    parser.add_argument('--max-spread-ratio',type=float,default=3.)
    parser.add_argument('--audit-data-dir',type=Path,default=None,
      help='Optional directory outside the checkout for the full component CSV ledger.')
    args=parser.parse_args()
    assert .1<=args.diameter_mm<=1.2 and 4<=args.max_triangles<=4096
    assert 1<=args.max_spread_ratio<=4
    ASSETS.mkdir(parents=True,exist_ok=True); DOCS.mkdir(parents=True,exist_ok=True)
    manifest_path=ROOT/'public/assets/fine-surface-v23/manifest.json'
    manifest=json.loads(manifest_path.read_text())
    source=next(v for v in manifest['lods'] if v['id']=='gentle')
    assert source['decodedSha256']==EXPECTED
    meta_path=ROOT/'public/assets/ultra-volume-v7.json'
    meta=json.loads(meta_path.read_text())
    log('Verifying and decoding the ten-part Gentle HFM stream')
    mesh=load_mesh_arrays(manifest,source,ROOT)
    positions,indices=mesh['positions'],mesh['indices']
    nv,nt=mesh['vertexCount'],mesh['indexCount']//3
    source_position_hash=digest(positions)
    source_normal_hash=digest(mesh['normals'])
    source_index_hash=digest(indices)
    labels=np.empty(nv,dtype=np.uint32)
    bounds=mesh['bounds']; longest=float(meta['longestMm'])
    scale=(np.array(bounds['max'])-np.array(bounds['min']))*longest/65535
    with tempfile.TemporaryDirectory(prefix='heart-debris-v25-') as temp:
        binary=Path(temp)/'debris_components.so'
        subprocess.run(['g++','-O3','-std=c++17','-shared','-fPIC',
          str(Path(__file__).with_name('debris_components.cpp')),'-o',str(binary)],check=True)
        lib=ctypes.CDLL(str(binary))
        arr=np.ctypeslib.ndpointer
        lib.debris_labels.argtypes=[ctypes.c_uint32,ctypes.c_uint32,
          arr(np.uint32,1,flags='C_CONTIGUOUS'),arr(np.uint32,1,flags='C_CONTIGUOUS')]
        lib.debris_labels.restype=ctypes.c_uint32
        lib.debris_stats.argtypes=[ctypes.c_uint32]*3+[
          arr(np.uint16,2,flags='C_CONTIGUOUS'),arr(np.uint32,1,flags='C_CONTIGUOUS'),
          arr(np.uint32,1,flags='C_CONTIGUOUS'),arr(np.float64,1,flags='C_CONTIGUOUS'),
          arr(np.float64,2,flags='C_CONTIGUOUS')]
        log('Union-find over the complete, uncut triangle graph')
        nc=int(lib.debris_labels(nv,nt,indices,labels))
        log({'connectedComponents':nc,'unreferencedVertices':int(np.count_nonzero(labels==UINT_MAX))})
        stats=np.empty((nc,19),dtype=np.float64)
        lib.debris_stats(nv,nt,nc,positions,indices,labels,scale,stats)
    assert int(stats[:,0].sum())==int(np.count_nonzero(labels!=UINT_MAX))
    assert int(stats[:,1].sum())==nt
    main_id=int(stats[:,1].argmax())
    extent=stats[:,5:8]-stats[:,2:5]
    diameter=np.linalg.norm(extent,axis=1)
    eigvals=np.empty((nc,3),dtype=np.float64)
    for start in range(0,nc,20000):
        s=stats[start:start+20000]; means=s[:,8:11]/s[:,0,None]
        cov=np.empty((len(s),3,3))
        for j in range(3): cov[:,j,j]=s[:,11+j]/s[:,0]-means[:,j]**2
        for k,(j,l) in enumerate(((0,1),(0,2),(1,2))):
            cov[:,j,l]=cov[:,l,j]=s[:,14+k]/s[:,0]-means[:,j]*means[:,l]
        eigvals[start:start+len(s)]=np.maximum(np.linalg.eigvalsh(cov),0)
    # Half a source voxel is a finite sampling floor, not a spatial dilation.
    regularizer_mm=float(manifest['sourceSpacingUm'])/2000
    spread=np.sqrt((eigvals[:,2]+regularizer_mm**2)/(eigvals[:,0]+regularizer_mm**2))
    base=(stats[:,1]<=args.max_triangles)&(stats[:,18]==0)&(spread<args.max_spread_ratio)
    base[main_id]=False
    def selection(d): return base&(diameter<=d)
    def totals(mask):
        return {'removedComponents':int(mask.sum()),'removedVertices':int(stats[mask,0].sum()),
          'removedTriangles':int(stats[mask,1].sum()),'removedSurfaceAreaMm2':float(stats[mask,17].sum()),
          'removedTriangleFraction':float(stats[mask,1].sum()/nt)}
    thresholds=[]
    for d in sorted(set([.35,.6,.85,1.,1.2,args.diameter_mm])):
        thresholds.append({'maximumBoundingBoxDiagonalMm':d,**totals(selection(d))})
    removed=selection(args.diameter_mm)
    log({'thresholdComparisons':thresholds,'selected':totals(removed),
      'mainComponent':{'id':main_id,'vertices':int(stats[main_id,0]),'triangles':int(stats[main_id,1])}})
    flags=np.zeros(nv,dtype=np.uint8)
    valid=labels!=UINT_MAX
    flags[valid]=removed[labels[valid]].astype(np.uint8)*255
    del valid
    # The three vertices of every face MUST agree. This also verifies worker-side
    # interpolated flags cannot clip a retained component or leave mixed faces.
    face_keep=np.empty(nt,dtype=np.uint8)
    for start in range(0,nt,250000):
        f=indices.reshape(-1,3)[start:start+250000]
        values=flags[f]
        assert np.all(values[:,0]==values[:,1]) and np.all(values[:,0]==values[:,2])
        face_keep[start:start+len(f)]=values[:,0]==0
    assert int(np.count_nonzero(face_keep==0))==int(stats[removed,1].sum())
    assert not removed[main_id]
    assert digest(positions)==source_position_hash and digest(mesh['normals'])==source_normal_hash
    assert digest(indices)==source_index_hash
    vertex_asset=write_gzip('debris-gentle-vertices.raw.gz',memoryview(flags))
    packed=np.packbits(face_keep,bitorder='little')
    face_asset=write_gzip('debris-gentle-faces.keep.gz',memoryview(packed))
    policy={'id':'compact-detached-components-v25','maximumBoundingBoxDiagonalMm':args.diameter_mm,
      'maximumTriangles':args.max_triangles,'maximumRegularizedPcaSpreadRatioExclusive':args.max_spread_ratio,
      'pcaRegularizerMm':regularizer_mm,'connectivity':'shared vertices in the complete uncut HFM mesh',
      'protectLargestComponent':True,'protectQuantizedVolumeBoundary':True,
      'positionsChanged':False,'normalsChanged':False,'indicesChanged':False,
      'classification':'display cleanup candidates; not anatomically validated material labels'}
    profile={'lodId':'gentle','sourceDecodedSha256':EXPECTED,'sourceSha256':source['sha256'],
      'sourceVertexCount':nv,'sourceTriangleCount':nt,'vertexFlags':vertex_asset,
      'vertexFlagEncoding':{'0':'retain','255':'exclude','indexing':'original HFM vertex order'},
      'faceKeepMask':{**face_asset,'bitOrder':'little','bit1':'retain','indexing':'original HFM triangle order'},
      'policy':policy,**totals(removed),'retainedTriangles':int(nt-stats[removed,1].sum())}
    json_write(ASSETS/'debris-manifest.json',{'version':1,'donorId':manifest['donorId'],
      'profiles':[profile],'sourceSpacingUm':manifest['sourceSpacingUm']})
    # The optional 1.4M-row ledger is a reproducible scientific intermediate,
    # not a browser or git payload. Aggregate evidence is always retained above.
    ledger=None
    if args.audit_data_dir is not None:
        audit_dir=args.audit_data_dir.resolve()
        assert audit_dir!=ROOT and ROOT not in audit_dir.parents,'Keep the full ledger outside the checkout.'
        audit_dir.mkdir(parents=True,exist_ok=True)
        ledger_path=audit_dir/'debris-components.csv.gz'
        with gzip.open(ledger_path,'wt',newline='') as stream:
            writer=csv.writer(stream)
            writer.writerow(['component','vertices','triangles','bbox_diagonal_mm','pca_spread_ratio',
              'surface_area_mm2','removed','min_world_x_mm','min_world_y_mm','min_world_z_mm',
              'max_world_x_mm','max_world_y_mm','max_world_z_mm'])
            offset=np.array(bounds['min'])*longest
            for c,s in enumerate(stats):
                writer.writerow([c,int(s[0]),int(s[1]),round(float(diameter[c]),6),round(float(spread[c]),6),
                  round(float(s[17]),6),int(removed[c]),*[round(float(v),6) for v in s[2:5]+offset],
                  *[round(float(v),6) for v in s[5:8]+offset]])
        ledger_hash=hashlib.sha256()
        with ledger_path.open('rb') as stream:
            for chunk in iter(lambda:stream.read(1024**2),b''): ledger_hash.update(chunk)
        ledger={'path':str(ledger_path),'bytes':ledger_path.stat().st_size,
          'sha256':ledger_hash.hexdigest(),'componentRows':nc,'optionalSupplement':True}
    def record(c):
        return {'id':int(c),'vertices':int(stats[c,0]),'triangles':int(stats[c,1]),
          'bboxDiagonalMm':float(diameter[c]),'pcaSpreadRatio':float(spread[c]),
          'surfaceAreaMm2':float(stats[c,17]),'excluded':bool(removed[c])}
    report={'schemaVersion':1,'sourceManifestSha256':digest(manifest_path.read_bytes()),
      'physicalMetadataSha256':digest(meta_path.read_bytes()),'sourceSpacingUm':manifest['sourceSpacingUm'],
      'componentLedger':ledger,
      'worldUnitMm':longest,'sourceDecodedSha256':EXPECTED,'componentCount':nc,
      'unreferencedVertices':int(np.count_nonzero(labels==UINT_MAX)),'profile':profile,
      'thresholdComparisons':thresholds,'largestComponent':record(main_id),
      'largestRetainedComponents':[record(c) for c in np.argsort(stats[:,1])[-20:][::-1]],
      'largestRemovedComponents':[record(c) for c in np.flatnonzero(removed)[np.argsort(stats[removed,1])[-20:]][::-1]],
      'protectedByShapeWithinSelectedSize':totals((diameter<=args.diameter_mm)&(spread>=args.max_spread_ratio)),
      'arraySha256':{'positions':source_position_hash,'normals':source_normal_hash,'indices':source_index_hash},
      'validation':{'everyTriangleHasUniformFlag':True,'mainComponentRetained':True,
        'sourceArraysByteIdentical':True,'allTransportChecksumsVerified':True,
        'faceAndVertexMaskCountsMatch':True,'fullDecodedMeshWrittenToDisk':False},
      'transport':mesh['_transport'],'elapsedSeconds':time.monotonic()-START,
      'peakRssMiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024}
    json_write(DOCS/'debris-audit.json',report)
    log({'finished':True,'manifest':str(ASSETS/'debris-manifest.json'),**totals(removed)})

if __name__=='__main__': main()
