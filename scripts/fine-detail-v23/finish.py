#!/usr/bin/env python3
"""Encode the welded gentle mesh with bounded arrays and multipart transport.

No final whole-object simplification or vertex smoothing is applied. Only
zero-area encoded faces and unused vertices are removed. Large temporary HFM
gzip stays outside public; public holds the indexed byte parts and manifest.
"""
from __future__ import annotations
import os
os.environ['OMP_NUM_THREADS']='1'
os.environ['OPENBLAS_NUM_THREADS']='1'
import argparse
import gc
import gzip
import hashlib
import json
from pathlib import Path
import resource
import struct
import time

import numpy as np
from source import ROOT, FineSource
from prepare import PREP, release
from resume import verify as verify_environment

BATCH=400_000
PART_BYTES=24*1024**2


def preflight(work,config,meta,extraction,weld):
    canonical={key:value for key,value in config.items() if key!='fingerprint'}
    assert hashlib.sha256(json.dumps(canonical,sort_keys=True,separators=(',',':')).encode()).hexdigest()==config['fingerprint'],'Configuration fingerprint does not match its content'
    assert extraction['fingerprint']==config['fingerprint'] and not extraction['partial']
    assert config['sourceManifestSha256']==FineSource(0).manifest_sha256==meta['sourceManifestSha256']
    for name,expected in config['scripts'].items():
        assert PREP.digest(Path(__file__).parent/name)==expected,('Scientific code changed during run',name)
    expected=[(z,min(z+config['slabCells'],meta['shapeZYX'][0]-1)) for z in range(0,meta['shapeZYX'][0]-1,config['slabCells'])]
    assert [(s['z0'],s['z1']) for s in extraction['slabs']]==expected,'Noncontiguous source coverage'
    assert extraction['completedSlabs']==extraction['plannedSlabs']==len(expected)
    for item in extraction['slabs']:
        assert item['fingerprint']==config['fingerprint']
        path=work/'slabs'/f"{item['z0']:04}-{item['z1']:04}.npz"
        assert json.loads(path.with_suffix('.json').read_text())==item
        assert path.stat().st_size==item['bytes'] and PREP.digest(path)==item['sha256'],path
    assert weld['extractionSha256']==PREP.digest(work/'extraction.json'),'Weld belongs to a different extraction ledger'
    assert weld['algorithmScriptSha256']==PREP.digest(Path(__file__).parent/'weld.py'),'Welder differs from the verified receipt'
    assert PREP.digest(work/'welded-reference.npz')==weld['sha256']
    audit_path=ROOT/'docs/fine-detail-v23/seam-audit.json';audit=json.loads(audit_path.read_text())
    assert audit['complete'] and audit['fingerprint']==config['fingerprint'] and audit['extractionSha256']==weld['extractionSha256']
    assert audit['unmatchedOpenEdges']==0 and audit['combinedBoundaryEdges']==0 and audit['overIncidentEdgesRemainingAfterEncodingCull']==0
    environment_receipt=verify_environment(work)
    dependencies=dict(environment=environment_receipt['environment'],extractionFingerprint=config['fingerprint'],
                      extractionSha256=weld['extractionSha256'],weldedSha256=weld['sha256'],
                      weldReceiptSha256=PREP.digest(work/'weld.json'),welderScriptSha256=weld['algorithmScriptSha256'],
                      seamAuditSha256=PREP.digest(audit_path),
                      encoderScriptSha256=PREP.digest(Path(__file__)),
                      resumeScriptSha256=PREP.digest(Path(__file__).parent/'resume.py'))
    recoveries=[item for item in extraction['slabs'] if item.get('validationRecovery')]
    if recoveries:
        reviews={}
        for item in recoveries:
            review_path=ROOT/'docs/fine-detail-v23'/f"slab-{item['z0']}-independent-review.json"
            review=json.loads(review_path.read_text())
            assert review['recoveryAssessment']['supported'] and review['evidence']['replayedReducerOutput']['sha256']==item['sha256']
            reviews[str(item['z0'])]=PREP.digest(review_path)
        dependencies['independentRecoveryReviewSha256']=reviews
    fingerprint=hashlib.sha256(json.dumps(dependencies,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    receipt=dict(schema='fine-detail-v23-final-preflight',verified=True,slabsVerified=len(expected),
                 fullProcessingFingerprint=fingerprint,dependencies=dependencies,
                 checkedAtUtc=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()))
    PREP.save_json(ROOT/'docs/fine-detail-v23/final-preflight.json',receipt)
    return receipt


def morton10(q):
    output=np.zeros(len(q),np.uint32)
    for bit in range(10):
        for axis in range(3):output|=((q[:,axis]>>bit)&1)<<(3*bit+axis)
    return output


def encode(work,assets):
    started=time.monotonic();config=json.loads((work/'configuration.json').read_text());meta=json.loads((work/'source-ready.json').read_text())
    extraction=json.loads((work/'extraction.json').read_text());weld=json.loads((work/'weld.json').read_text())
    verification=preflight(work,config,meta,extraction,weld)
    joined=np.load(work/'welded-reference.npz');points=joined['points'];faces=joined['faces'];joined.close()
    original_nv,original_nf=len(points),len(faces)
    extent=np.asarray(meta['extent'],np.float64);minimum=-extent/2
    quantized=np.empty((len(points),3),'<u2')
    max_error=0.;squared_error=0.
    for start in range(0,len(points),BATCH):
        p=points[start:start+BATCH].astype(np.float64)[:,[0,2,1]]*np.array([1,1,-1])/meta['longestMm']
        q=np.rint(np.clip((p-minimum)/extent,0,1)*65535).astype('<u2')
        quantized[start:start+len(p)]=q
        error=np.linalg.norm((minimum+q.astype(np.float64)/65535*extent-p)*meta['longestMm'],axis=1)
        max_error=max(max_error,float(error.max(initial=0)));squared_error+=float(np.dot(error,error))
    quantization_bound_mm=float(np.linalg.norm(extent*meta['longestMm']/65535/2))
    assert max_error<=quantization_bound_mm+1e-8,('A point was clipped outside the unchanged source bounds',max_error)
    valid=np.ones(len(faces),bool);float_zero=0;quantization_only_zero=0
    for start in range(0,len(faces),BATCH):
        f=faces[start:start+BATCH]
        q0=quantized[f[:,0]].astype(np.int64);q1=quantized[f[:,1]].astype(np.int64);q2=quantized[f[:,2]].astype(np.int64)
        real_valid=np.linalg.norm(np.cross(points[f[:,1]]-points[f[:,0]],points[f[:,2]]-points[f[:,0]]),axis=1)>1e-12
        quant_valid=np.any(np.cross(q1-q0,q2-q0)!=0,axis=1)
        float_zero+=int((~real_valid).sum());quantization_only_zero+=int((real_valid&~quant_valid).sum())
        valid[start:start+len(f)]=real_valid&quant_valid
    removed=int((~valid).sum());faces=faces[valid];del valid,q0,q1,q2,real_valid,quant_valid
    # Original contour orientation survives every constrained edge collapse.
    # Average unit face normals; no smoothing of vertex positions takes place.
    normals=np.zeros_like(points,np.float32)
    for start in range(0,len(faces),BATCH):
        f=faces[start:start+BATCH]
        cross=np.cross(points[f[:,1]]-points[f[:,0]],points[f[:,2]]-points[f[:,0]])
        length=np.linalg.norm(cross,axis=1);unit=cross/np.maximum(length[:,None],1e-20)
        for corner in range(3):np.add.at(normals,f[:,corner],unit)
    lengths=np.linalg.norm(normals,axis=1);bad=lengths<1e-8
    incident=np.zeros(len(points),bool);incident[faces]=True;bad&=incident
    fallback=int(bad.sum())
    if fallback:
        largest=np.zeros(len(points),np.float32)
        for start in range(0,len(faces),BATCH):
            f=faces[start:start+BATCH]
            area=np.linalg.norm(np.cross(points[f[:,1]]-points[f[:,0]],points[f[:,2]]-points[f[:,0]]),axis=1)
            for corner in range(3):np.maximum.at(largest,f[:,corner],area)
        for start in range(0,len(faces),BATCH):
            f=faces[start:start+BATCH]
            cross=np.cross(points[f[:,1]]-points[f[:,0]],points[f[:,2]]-points[f[:,0]])
            area=np.linalg.norm(cross,axis=1)
            for corner in range(3):
                v=f[:,corner];choose=bad[v]&(area>=largest[v])&(area>0)
                normals[v[choose]]=cross[choose]/area[choose,None]
        del largest
    normals/=np.maximum(np.linalg.norm(normals,axis=1,keepdims=True),1e-20)
    used_lengths=np.linalg.norm(normals[incident],axis=1)
    assert np.isfinite(normals).all() and np.all(used_lengths>.99),'An incident vertex has an undefined normal'
    del points,lengths,bad,incident,cross,length,unit,used_lengths;release()
    # Spatial face order plus first-use vertex order keeps compression useful
    # without allocating the full three-corner float geometry simultaneously.
    keys=np.empty(len(faces),np.uint32)
    for start in range(0,len(faces),BATCH):
        f=faces[start:start+BATCH]
        center=(quantized[f[:,0]].astype(np.uint32)+quantized[f[:,1]]+quantized[f[:,2]])//3
        keys[start:start+len(f)]=morton10(center>>6)
    order=np.argsort(keys,kind='stable');faces=faces[order];del keys,order,center
    first=np.full(len(quantized),np.iinfo(np.uint64).max,np.uint64)
    for start in range(0,len(faces),BATCH):
        f=faces[start:start+BATCH]
        np.minimum.at(first,f.ravel(),np.arange(start*3,(start+len(f))*3,dtype=np.uint64))
    used=first!=np.iinfo(np.uint64).max
    order=np.argsort(first,kind='stable')[:int(used.sum())]
    mapping=np.empty(len(quantized),np.uint32);mapping[order]=np.arange(len(order),dtype=np.uint32)
    quantized=quantized[order]
    normal_q=np.ascontiguousarray(np.rint(np.clip(normals[order][:,[0,2,1]]*np.array([1,1,-1]),-1,1)*32767),dtype='<i2')
    faces=mapping[faces]
    del normals,first,used,order,mapping,f;release()
    nv,nf=len(quantized),len(faces)
    pos_offset=32;normal_offset=(pos_offset+quantized.nbytes+3)&~3;index_offset=(normal_offset+normal_q.nbytes+3)&~3
    decoded_bytes=index_offset+faces.nbytes
    assert decoded_bytes<=512*1024**2,('Detailed mesh exceeds agreed decode bound',decoded_bytes)
    header=struct.pack('<8I',0x314d4648,1,nv,nf*3,pos_offset,normal_offset,index_offset,0)
    decoded_hash=hashlib.sha256();gzip_path=work/'gentle.hfm.gz';temporary=gzip_path.with_suffix('.gz.partial')
    with temporary.open('wb') as stream:
        with gzip.GzipFile(filename='',fileobj=stream,mode='wb',compresslevel=9,mtime=0) as zipped:
            def emit(data):
                raw=memoryview(data).cast('B')
                for start in range(0,len(raw),8*1024**2):
                    block=raw[start:start+8*1024**2];decoded_hash.update(block);zipped.write(block)
            emit(header);emit(quantized);emit(bytes(normal_offset-pos_offset-quantized.nbytes));emit(normal_q);emit(bytes(index_offset-normal_offset-normal_q.nbytes));emit(faces.astype('<u4',copy=False))
    temporary.replace(gzip_path)
    assert gzip_path.stat().st_size<=256*1024**2,('Detailed mesh exceeds agreed transport bound',gzip_path.stat().st_size)
    assets.mkdir(parents=True,exist_ok=True);parts=[]
    with gzip_path.open('rb') as stream:
        for number in range(1,100):
            data=stream.read(PART_BYTES)
            if not data:break
            # Hosting's immutable binary collection accepts .gz paths. These
            # are ordered byte ranges, not independently decodable gzip files.
            path=assets/f'gentle.part-{number:03}.gz';path.write_bytes(data)
            parts.append(dict(url=f'./assets/fine-surface-v23/{path.name}',compressedBytes=len(data),sha256=hashlib.sha256(data).hexdigest()))
    assert sum(p['compressedBytes'] for p in parts)==gzip_path.stat().st_size
    lod=dict(id='gentle',label='Gentle detailed surface',parts=parts,
             vertices=nv,triangles=nf,compressedBytes=gzip_path.stat().st_size,decodedBytes=decoded_bytes,
             sha256=PREP.digest(gzip_path),decodedSha256=decoded_hash.hexdigest(),
             trianglesBeforeEncoding=original_nf,verticesBeforeEncoding=original_nv,
             removedZeroAreaTriangles=float_zero,quantizationCollapsedTriangles=quantization_only_zero,totalZeroAreaTrianglesRemoved=removed,normalFallbackVertices=fallback,
             quantizationMaximumMm=max_error,quantizationRmsMm=(squared_error/original_nv)**.5)
    credits=json.loads((ROOT/'public/assets/manifest.json').read_text())
    manifest=dict(schemaVersion=1,format='HFM1',donorId='ladaf-2021-17',sourceSpacingUm=79.4,threshold=.28,
        **{key:credits[key] for key in ['datasetUrl','doiUrl','attribution','license','licenseUrl']},
        extent=meta['extent'],referenceDimensionsXYZ=[475,475,530],
        bounds=dict(min=(-extent/2).tolist(),max=(extent/2).tolist()),lods=[lod],
        processing=dict(experimental=True,source='Existing verified cleaned/windowed 79.4 µm display bank. Not a native 19.85 µm extraction or quantitative-HU reconstruction.',
            sourceManifest=meta['sourceManifest'],sourceManifestSha256=meta['sourceManifestSha256'],verifiedSourceBricks=meta['verifiedBlocks'],
            coordinateConvention='Unchanged main-view endpoint convention; acquisition XYZ maps to world (x,z,-y).',
            densityGaussianSigmaVoxels=config['sigmaVoxels'],densityGaussianSigmaMm=config['sigmaVoxels']*.0794,
            originalPolishedGaussianSigmaVoxels=.8,thresholdNormalized=.28,
            meshVertexSmoothingIterations=0,finalWholeObjectSimplification=False,
            referenceTriangles=extraction['referenceTriangles'],weldedTriangles=weld['triangles'],
            frozenSlabBoundaries=True,slabCells=config['slabCells'],
            reduction='Constrained local quadric edge collapse; open boundaries and slab-plane coordinates frozen. Interior edge-link and tetrahedron constraints retain local components/handles. No triangle budget overrides constraints.',
            conservativeOriginalVertexRadiusLimitMm=config['conservativeRadiusLimitMm'],
            displacementCaveat='The conservative radius bounds accumulated mesh-vertex movement during reduction. It excludes scalar filtering, quantization and anatomical uncertainty; it is not a clinical accuracy claim.',
            weldToleranceMm=weld['weldToleranceMm'],maximumWeldDisplacementMm=weld['maximumWeldDisplacementMm'],
            zeroNormalPolicy='Average incident unit face normals; cancelling normals use the largest incident nondegenerate face. Shading only.',
            degenerateFacePolicy='Zero-area MC faces removed before constrained reduction. Encoded zero-area faces and unused vertices removed after welding.',
            multipartTransport='Ordered byte ranges of one gzip HFM1 object; every part, joined gzip and decoded payload have SHA256 checksums.',
            sourceDataChanged=False,expertValidated=False,processingFingerprint=config['fingerprint']))
    manifest['processing']['encoderScriptSha256']=PREP.digest(Path(__file__))
    manifest['processing']['fullProcessingFingerprint']=verification['fullProcessingFingerprint']
    PREP.save_json(assets/'manifest.json',manifest)
    report=dict(schema='fine-detail-v23-encoding',configuration=config,extraction=extraction,weld=weld,
                manifest=manifest,seconds=time.monotonic()-started,peakRssMiB=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024,
                sourceBankUnchanged=True,fullGzipInScratch=str(gzip_path),publicContainsOnlyIndexedParts=True,
                positionQuantizationBoundMm=quantization_bound_mm,finalPreflight=verification)
    PREP.save_json(ROOT/'docs/fine-detail-v23/preparation.json',report)
    PREP.log(stage='gentle-encoded',**lod,seconds=report['seconds'],peakRssMiB=report['peakRssMiB'])
    return manifest


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--work',type=Path,required=True)
    parser.add_argument('--assets',type=Path,default=ROOT/'public/assets/fine-surface-v23');args=parser.parse_args()
    encode(args.work,args.assets)
