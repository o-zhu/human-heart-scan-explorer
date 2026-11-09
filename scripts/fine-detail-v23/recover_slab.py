#!/usr/bin/env python3
"""Recover byte-identical numeric output only after complete contour proof.

The original scientific pipeline and its strict assertion are left untouched.
This addendum distinguishes a new closed tangent vertex from a changed frozen
contour; it never moves a vertex, drops a face or relaxes contour equivalence.
"""
from __future__ import annotations
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import shutil
import time

import numpy as np

from source import ROOT
from prepare import PREP
from resume import exclusive_resume,verify
from diagnose_slab import coordinate_keys,edge_keys
from weld import open_plane_edges,remove_zero_area


def stored_edge_keys(coordinates):
    pairs=np.ascontiguousarray(coordinates,dtype='<f4').reshape(-1,2,3).view('V12').reshape(-1,2)
    pairs.sort(axis=1)
    return Counter(row.tobytes() for row in pairs)


def recover(work,z0,z1):
    work=Path(work);directory=work/'diagnostics'/f'{z0:04}-{z1:04}'
    with exclusive_resume(work):
        verify(work);config=json.loads((work/'configuration.json').read_text());meta=json.loads((work/'source-ready.json').read_text())
        canonical={k:v for k,v in config.items() if k!='fingerprint'}
        assert hashlib.sha256(json.dumps(canonical,sort_keys=True,separators=(',',':')).encode()).hexdigest()==config['fingerprint']
        for name,expected in config['scripts'].items():assert PREP.digest(Path(__file__).parent/name)==expected
        diagnostic=json.loads((directory/'diagnostic.json').read_text())
        assert diagnostic['fingerprint']==config['fingerprint'] and diagnostic['z0']==z0 and diagnostic['z1']==z1
        assert diagnostic['originalPrepareSha256']==config['scripts']['prepare.py']
        assert diagnostic['scientificExtractionCodeChanged'] is False and 'boundary count changed' in diagnostic['originalAssertion']
        assert diagnostic['diagnosisScriptSha256']==PREP.digest(Path(__file__).parent/'diagnose_slab.py')
        boundary_path=directory/'input-boundaries.npz';output_path=directory/'reducer-output.npz'
        assert PREP.digest(boundary_path)==diagnostic['inputBoundarySha256'] and PREP.digest(output_path)==diagnostic['outputSha256']
        with np.load(output_path) as data:points,faces=data['points'],data['faces']
        clean,zeros=remove_zero_area(points,faces);checks=[]
        with np.load(boundary_path) as original:
            for plane_record in diagnostic['planes']:
                name=plane_record['plane'];plane=np.float32(plane_record['planeMm'])
                frozen=original[name+'Frozen'];expected_edges=stored_edge_keys(original[name+'OpenEdgeCoordinates'])
                plane_indices=np.flatnonzero(points[:,2]==plane)
                expected=Counter(coordinate_keys(frozen));present=Counter(coordinate_keys(points[plane_indices]))
                assert not (expected-present),'An original frozen coordinate/multiplicity is missing.'
                boundary,edges,info=open_plane_edges(points,clean,plane)
                actual_edges=edge_keys(points,edges)
                assert actual_edges==expected_edges,'The original open contour is not bit-exact.'
                added=present-expected;non_open=np.setdiff1d(plane_indices,boundary)
                closed=Counter(coordinate_keys(points[non_open]))
                assert all(closed[key]>=count for key,count in added.items()),'An extra point changes the open contour.'
                assert sum(added.values())==plane_record['addedPlaneVertices']
                checks.append(dict(plane=name,originalFrozenVertices=len(frozen),outputPlaneVertices=len(plane_indices),
                                   missingOriginalFrozenVertices=0,addedClosedPlaneVertices=sum(added.values()),
                                   originalOpenEdges=sum(expected_edges.values()),outputOpenEdges=sum(actual_edges.values()),
                                   exactFrozenCoordinateMultisetPreserved=True,exactOpenEdgeMultisetPreserved=True))
        assert any(check['addedClosedPlaneVertices'] for check in checks),'No documented extra-closed-vertex discrepancy.'
        run=diagnostic['originalRun']
        assert run['vertices']==len(points) and run['triangles']==len(faces)
        assert run['reduction']['conservativeRadiusLimitMm']==config['conservativeRadiusLimitMm']
        assert run['reduction']['maximumConservativeRadiusMm']<=config['conservativeRadiusLimitMm']
        proof=ROOT/'docs/fine-detail-v23'/f'slab-{z0}-input-boundaries.npz';shutil.copyfile(boundary_path,proof)
        addendum=dict(schema='fine-detail-v23-validation-recovery',verified=True,z0=z0,z1=z1,
            numericPipelineChanged=False,verticesOrFacesChanged=False,
            reason='One unchanged reduction output acquired an additional closed tangent vertex on a plane after float32 staging; counting every plane vertex was stricter than preserving frozen vertices and open contours.',
            originalAssertion=diagnostic['originalAssertion'],originalConfigurationFingerprint=config['fingerprint'],
            originalPrepareSha256=diagnostic['originalPrepareSha256'],recoveryScriptSha256=PREP.digest(Path(__file__)),
            diagnosisScriptSha256=diagnostic['diagnosisScriptSha256'],
            diagnosticPath=f'docs/fine-detail-v23/slab-{z0}-diagnostic.json',
            diagnosticSha256=PREP.digest(ROOT/f'docs/fine-detail-v23/slab-{z0}-diagnostic.json'),
            boundaryProofPath=str(proof.relative_to(ROOT)),boundaryProofSha256=PREP.digest(proof),
            unchangedOutputSha256=diagnostic['outputSha256'],checks=checks,
            qualifiedAtUtc=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()))
        target=work/'slabs'/f'{z0:04}-{z1:04}.npz';assert not target.exists() and not target.with_suffix('.json').exists()
        temporary=target.with_suffix('.npz.recovery.partial');shutil.copyfile(output_path,temporary)
        assert PREP.digest(temporary)==diagnostic['outputSha256'];temporary.replace(target)
        info=dict(schema='fine-detail-v23.1',fingerprint=config['fingerprint'],z0=z0,z1=z1,sigmaVoxels=config['sigmaVoxels'],
            referenceVertices=run['referenceVertices'],referenceTriangles=run['referenceTriangles'],vertices=len(points),triangles=len(faces),
            removedZeroAreaTriangles=run['removedZeroAreaTriangles'],boundaryVerticesFrozen=True,
            topologyConstraint='Interior edge link condition; all original open boundary vertices frozen.',
            lowBoundaryVertices=run['lowBoundaryVertices'],highBoundaryVertices=run['highBoundaryVertices'],
            source=run['source'],reduction=run['reduction'],sha256=diagnostic['outputSha256'],bytes=target.stat().st_size,
            seconds=run['seconds'],peakParentRssMiB=None,peakParentRssCaveat='Not retained by the original failed assertion; native reducer peak is recorded.',
            validationRecovery=addendum)
        PREP.save_json(target.with_suffix('.json'),info)
        PREP.save_json(ROOT/'docs/fine-detail-v23'/f'slab-{z0}-recovery.json',addendum)
        # Re-inventory immutable completed receipts; the failed original master
        # stopped updating its ledger while queued workers finished later slabs.
        expected=[(z,min(z+config['slabCells'],meta['shapeZYX'][0]-1)) for z in range(0,meta['shapeZYX'][0]-1,config['slabCells'])]
        records=[]
        for lower,upper in expected:
            path=work/'slabs'/f'{lower:04}-{upper:04}.npz';item=json.loads(path.with_suffix('.json').read_text())
            assert item['fingerprint']==config['fingerprint'] and (item['z0'],item['z1'])==(lower,upper)
            assert path.stat().st_size==item['bytes'] and PREP.digest(path)==item['sha256'];records.append(item)
        ledger=dict(schema='fine-detail-v23.1',fingerprint=config['fingerprint'],slabCells=config['slabCells'],sigmaVoxels=config['sigmaVoxels'],
                    completedSlabs=len(records),plannedSlabs=len(expected),referenceTriangles=sum(s['referenceTriangles'] for s in records),
                    triangles=sum(s['triangles'] for s in records),slabs=records,partial=False,
                    inventoryAfterRecordedValidationRecovery=True,inventoryScriptSha256=PREP.digest(Path(__file__)))
        PREP.save_json(work/'extraction.json',ledger)
        PREP.save_json(ROOT/'docs/fine-detail-v23/progress.json',dict(ledger,configuration=config,workDirectory=str(work),
                       updatedAtUtc=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())))
        print(json.dumps(dict(recovered=True,z0=z0,z1=z1,unchangedOutputSha256=diagnostic['outputSha256'],checks=checks,
                              completedSlabs=len(records),triangles=ledger['triangles'],referenceTriangles=ledger['referenceTriangles'])))
        return ledger


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--work',type=Path,required=True);parser.add_argument('--z0',type=int,required=True);parser.add_argument('--z1',type=int,required=True)
    args=parser.parse_args();recover(args.work,args.z0,args.z1)
