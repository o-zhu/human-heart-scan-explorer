#!/usr/bin/env python3
"""Independent decoded-asset invariants for the native ROI comparison."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import struct

import numpy as np
from reconstruct import ROOT,WORK,ASSETS,DOCS,CHUNK,SPACING_UM,crosses,topology,sha_file,write_json,peak_mib


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work',type=Path,default=WORK);parser.add_argument('--assets',type=Path,default=ASSETS)
    args=parser.parse_args();manifest=json.loads((args.assets/'manifest.json').read_text())
    reference_points=np.load(args.work/'reference-points.npy');reference_faces=np.load(args.work/'reference-faces.npy')
    topo,pinned=topology(reference_points,reference_faces,manifest['roi']['shapeXYZ'])
    assert topo['nonmanifoldEdges']==0 and topo['zeroAreaTriangles']==0
    assert topo['unexpectedInteriorBoundaryEdges']==0, 'A block seam or unsupported internal opening is present'
    longest_um=max(manifest['roi']['physicalSizeMm'])*1000
    reference_world=None;reference_index_hash=None;checks=[]
    for lod in manifest['lods']:
        path=args.assets/Path(lod['url']).name;blob=path.read_bytes()
        assert len(blob)==lod['compressedBytes'] and hashlib.sha256(blob).hexdigest()==lod['sha256']
        raw=gzip.decompress(blob);assert len(raw)==lod['decodedBytes']
        assert hashlib.sha256(raw).hexdigest()==lod['decodedSha256']
        magic,version,nv,ni,p,n,i,flag=struct.unpack_from('<8I',raw)
        assert magic==0x314d4648 and version==1 and flag in (0,1)
        assert nv==lod['vertices'] and ni==lod['triangles']*3
        assert p==32 and n%4==0 and i%4==0
        position_bytes=12 if flag else 6
        assert p+nv*position_bytes<=n and n+nv*6<=i and i+ni*4==len(raw)
        positions=np.frombuffer(raw,'<f4' if flag else '<u2',nv*3,p).reshape(nv,3)
        bounds=lod.get('bounds',manifest['bounds']);lo=np.array(bounds['min']);hi=np.array(bounds['max'])
        world=positions.astype(np.float64) if flag else lo+positions.astype(np.float64)/65535*(hi-lo)
        normal=np.frombuffer(raw,'<i2',nv*3,n).reshape(nv,3).astype(np.float64)/32767
        faces=np.frombuffer(raw,'<u4',ni,i).reshape(-1,3)
        assert np.isfinite(world).all() and np.isfinite(normal).all() and faces.max()<nv
        assert np.all(world>=lo) and np.all(world<=hi), (lod['id'],'outside measured ROI')
        normal_error=float(np.max(np.abs(np.linalg.norm(normal,axis=1)-1)))
        assert normal_error<.00006
        zero=0;flips=0
        for start in range(0,len(faces),CHUNK):
            end=min(start+CHUNK,len(faces));cross=crosses(world,faces,start,end)
            zero+=int((np.linalg.norm(cross,axis=1)<=1e-20).sum())
            if lod['id'] in ('normals','gentle','moderate'):
                original=crosses(reference_world,faces,start,end)
                flips+=int((np.einsum('ij,ij->i',original,cross)<=0).sum())
        assert zero==0 and flips==0,(lod['id'],zero,flips)
        index_hash=hashlib.sha256(raw[i:]).hexdigest();position_hash=hashlib.sha256(raw[p:p+nv*position_bytes]).hexdigest()
        item=dict(id=lod['id'],fileSha256=lod['sha256'],positionFormat=lod['positionFormat'],
            decodedHashVerified=True,finite=True,indicesValid=True,allVerticesWithinRoi=True,
            zeroAreaTriangles=zero,flippedOrOver90DegreeTriangles=flips,
            maximumQuantizedNormalLengthError=normal_error,positionBytesSha256=position_hash,indexBytesSha256=index_hash)
        if lod['id']=='native':
            reference_world=world.copy();reference_index_hash=index_hash;native_position_hash=position_hash
        if lod['id'] in ('normals','gentle','moderate'):
            assert index_hash==reference_index_hash and np.array_equal(faces,reference_faces)
            assert np.array_equal(world[pinned],reference_world[pinned])
            movement=np.linalg.norm(world-reference_world,axis=1)*longest_um
            cap=0 if lod['id']=='normals' else (.25 if lod['id']=='gentle' else .5)*SPACING_UM
            assert float(movement.max())<=cap
            item.update(exactSameIndicesAsNative=True,cropBoundaryCoordinatesBitIdentical=True,
                maximumDecodedVertexMovementUm=float(movement.max()),maximumAllowedMovementUm=cap)
            if lod['id']=='normals':
                assert position_hash==native_position_hash
                item['positionBytesIdenticalToNative']=True
        checks.append(item)
    band=json.loads((args.work/'surface-band-deduplicated.json').read_text())
    assert band['allEightActiveCellValuesReconstructedExactly']
    assert band['compressedBytes']<band['fullLosslessSliceCompressedBytes']
    report=dict(passed=True,checks=checks,topology=topo,
        rawSourceThreshold=manifest['rawThreshold'],rawSourceResampled=False,
        blockSeamCheck='Every boundary edge lies on an outer ROI face; zero unexpected interior boundary edges.',
        sharedBoundaryAliases=manifest['validation']['weld']['sharedEdgeAliases'],
        sourceBand=dict(format=band['format'],compressedBytes=band['compressedBytes'],
            decodedBytes=band['decodedBytes'],activeCells=band['activeCells'],
            allEightActiveCellValuesReconstructedExactly=True),
        scientificScope='Exact encoded-asset integrity, all-vertex displacement, fixed connectivity, crop pinning, face orientation and seam checks. Does not establish anatomical segmentation correctness or absence of every geometric self-intersection.',
        peakRssMiB=peak_mib())
    write_json(DOCS/'geometry-validation.json',report)
    # Metadata enrichment only: preserve the stable binary asset bytes.
    manifest['validation']['encodedAssets']=report
    manifest['validation']['normals']['topology']=topo
    manifest['sourceStorage']=dict(rawBytes=band['fullRawSliceBytes'],losslessSliceBytes=band['fullLosslessSliceCompressedBytes'],
        losslessSliceCount=128,rawValuesUnchanged=True,surfaceBandCompressedBytes=band['compressedBytes'],
        surfaceBandDecodedBytes=band['decodedBytes'],surfaceBandUniqueSampleInstances=band['uniqueContributingSamplesPerBlockSum'],
        surfaceBandRoundTripExact=True,surfaceBandFormat=band['format'],surfaceBandActiveCells=band['activeCells'],
        scope=band['scope'])
    manifest['roi']['description']='Morphology-selected folded tissue/cavity interface; no expert-validated valve, chordal or chamber label.'
    manifest['overviewComparison']=dict(actualSourceSamples=True,sourceSpacingUm=317.6,nativeIndexFactor=16,
        assumedCenterTranslationNativeXYZ=[0,0,0],registrationValidated=False,
        caveat='N5 metadata specifies factor16. A scale-center translation was not independently established; zero-origin index scaling is used for the overview, so exact voxelwise registration is not claimed.')
    manifest['figures']={}
    for name in ['comparison.webp','quickcontext.webp','native-source-slice.png']:
        path=args.assets/name
        if path.exists():manifest['figures'][name]=dict(url='./assets/native-surface-v20/'+name,bytes=path.stat().st_size,sha256=sha_file(path))
    manifest['workingMemory']=dict(maximumRecordedFinalPipelineStageRssMiB=max(
        json.loads((args.work/name).read_text()).get('peakRssMiB',0) for name in ['extraction.json','weld.json','normals.json','gentle.json','moderate.json','bilateral.json','surface-band-deduplicated.json']),
        note='Peak resident set measured per separate preparation process; browser memory and whole-machine cache are different measurements.')
    write_json(args.assets/'manifest.json',manifest);write_json(DOCS/'geometry-summary.json',manifest)
    print(json.dumps(dict(passed=True,meshes=len(checks),unexpectedInteriorBoundaryEdges=topo['unexpectedInteriorBoundaryEdges'],peakRssMiB=peak_mib())),flush=True)


if __name__=='__main__':main()
