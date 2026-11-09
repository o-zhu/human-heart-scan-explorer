#!/usr/bin/env python3
"""Bounded real-leaf and synthetic incidence checks; no full overview build.

Reads eight completed step-4 overview artifacts only. All generated checkpoints
remain separate from the immutable bank. No acquisition, uploads or runner work.
"""
import os
os.environ['OPENBLAS_NUM_THREADS'] = '1'
os.environ['OMP_NUM_THREADS'] = '1'
import argparse
import gc
import hashlib
import json
from pathlib import Path
import resource
import subprocess
import sys
import time

import numpy as np

REPO = Path(__file__).resolve().parents[2]
SCRIPTS = REPO/'scripts/guided-native-v21'
sys.path.insert(0,str(SCRIPTS))
sys.path.insert(0,'{source-cache}/fine-surface-v19-python')
import build_overview as builder
from edge_codec import mesh_native_edges


def python_filter(points,faces,proposals,fixed,cell):
    parent = np.arange(len(points),dtype=np.uint32)
    cells = np.floor(points/cell).astype(np.int64)
    def root(i):
        while parent[i] != i:
            i = int(parent[i])
        return i
    accepted = []
    for u,v in proposals:
        a,c = root(int(u)),root(int(v))
        if a == c or fixed[a] or fixed[c] or not np.array_equal(cells[a],cells[c]):
            continue
        mapped = np.array([[root(int(i)) for i in face] for face in faces])
        live = ((mapped[:,0] != mapped[:,1]) & (mapped[:,0] != mapped[:,2])
                & (mapped[:,1] != mapped[:,2]))
        if np.any(live & np.any(mapped == a,axis=1) & np.any(mapped == c,axis=1)):
            accepted.append([a,c]);parent[c] = a
    return np.array(accepted,np.int32).reshape(-1,2),np.array([root(i) for i in range(len(points))],np.uint32)


def filter_checks():
    rng = np.random.default_rng(2132)
    for _ in range(80):
        points = rng.integers(0,64,(12,3)).astype(np.float32)
        faces = rng.integers(0,12,(20,3),dtype=np.int32)
        proposals = rng.integers(0,12,(50,2),dtype=np.int32)
        fixed = rng.random(12) < .2
        expected,parents = python_filter(points,faces,proposals,fixed,32)
        accepted,actual,_ = builder.filter_collapse_proposals(points,faces,proposals,fixed,32)
        assert np.array_equal(accepted,expected) and np.array_equal(actual,parents)
    points = np.array([[0,0,0],[1,0,0],[0,1,0],[1,1,0],[2,1,0],[2,0,0]],np.float32)
    faces = np.array([[0,1,2],[2,3,4],[4,5,0]],np.int32)
    proposals = np.array([[0,1],[0,2],[0,4],[0,5]],np.int32)
    accepted,_,info = builder.filter_collapse_proposals(points,faces,proposals,np.zeros(6,bool))
    assert accepted.tolist() == [[0,1],[0,4]] and info['rejectedNotCurrentEdge'] == 2
    cases = [dict(fixed=np.zeros(1,bool)),dict(proposals=np.array([[-1,1]],np.int32)),
             dict(proposals=np.array([[0.,1.]])),dict(cell=0),dict(points=np.full((6,3),np.nan)),
             dict(points=np.full((6,3),1e20))]
    for change in cases:
        values = dict(points=points,faces=faces,proposals=proposals,fixed=np.zeros(6,bool),cell=32)
        values.update(change)
        try:
            builder.filter_collapse_proposals(**values)
        except ValueError:
            pass
        else:
            raise AssertionError('Malformed C-boundary input was accepted')
    return dict(randomReferenceComparisons=80,collapsedFaceDoesNotCreateCurrentEdge=True,
                malformedInputsRejected=len(cases),allPassed=True)


def resume_check(output):
    run = Path('{source-cache}/guided-native-v21/pilot/run-compiled-hosted')
    command = [sys.executable,str(SCRIPTS/'build_overview.py'),'--run',str(run),'--out',str(output),
        '--pilot','--nodes-only','--triangles','30000','--detail-triangles','60000',
        '--samples-per-leaf','128','--reverse-samples','0']
    subprocess.run(command,check=True,capture_output=True,text=True)
    state = json.loads((output/'build.json').read_text())
    before = {p.name:(builder.digest(p),p.stat().st_mtime_ns) for p in (output/'nodes').glob('*.npz')}
    subprocess.run([*command,'--merge-face-cap','5000000'],check=True,capture_output=True,text=True)
    after_state = json.loads((output/'build.json').read_text())
    assert state['fingerprint'] == after_state['fingerprint']
    assert before == {p.name:(builder.digest(p),p.stat().st_mtime_ns) for p in (output/'nodes').glob('*.npz')}
    assert after_state['mergeFaceCapsObserved'][-2:] == [6000000,5000000]
    changed = subprocess.run([*command,'--cluster-max-cell','8'],capture_output=True,text=True)
    assert changed.returncode and 'different inputs/settings/code' in changed.stderr
    return dict(checkpoints=len(before),operationalCapChangePreservesFingerprintAndCheckpointBytes=True,
                numericalSettingChangeRejected=True,observedCapHistory=after_state['mergeFaceCapsObserved'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out',type=Path,default=Path('{source-cache}/guided-native-v21/overview-fallback-qa'))
    args = parser.parse_args()
    code_key = hashlib.sha256((SCRIPTS/'build_overview.py').read_bytes()
        +(SCRIPTS/'overview_collapse.c').read_bytes()).hexdigest()[:12]
    args.out = args.out/code_key
    args.out.mkdir(parents=True,exist_ok=True)
    checks = filter_checks()
    resume = resume_check(args.out/'resume-pilot')
    run = Path('{source-cache}/guided-native-v21/whole/run')
    parts,inputs = [],[]
    original_hashes = {}
    for z in (14,15):
        for y in (20,21):
            for x in (36,37):
                key = f'{x}_{y}_{z}'
                record_path = run/'records'/f'{key}.json'
                record = json.loads(record_path.read_text())
                artifact = next(v for v in record['artifacts'] if v['role'] == 'overview')
                path = run/artifact['path']
                assert artifact['samplingStepNative'] == 4 and artifact['sha256'] == builder.digest(path)
                original_hashes[path] = builder.digest(path)
                original_hashes[record_path] = builder.digest(record_path)
                parts.append(mesh_native_edges(path.read_bytes()))
                inputs.append(dict(xyz=[x,y,z],bytes=artifact['bytes'],sha256=artifact['sha256'],
                    recordSha256=original_hashes[record_path]))
    points,faces,welded,removed = builder.weld(parts)
    del parts
    gc.collect()
    assert len(faces) == 448650 and len(faces) <= 750000
    samples,area = builder.surface_samples(points,faces,256,2101)
    weights = np.full(len(samples),area/len(samples),np.float64)
    original_samples_sha = hashlib.sha256(samples.tobytes()).hexdigest()
    rows = []
    for name,lo,hi,parent_mode in (
        ('complete-dense-leaf',np.array([36,20,14])*128,np.array([38,22,16])*128,False),
        ('released-child-plane-parent-stress',np.zeros(3,np.int64),np.full(3,16384),True)):
        before = builder.frozen_signature(points,faces,lo,hi)
        started = time.monotonic()
        p,f,method = builder.simplify_locked(points,faces,4487,lo,hi,allow_parent_cluster=parent_mode)
        elapsed = time.monotonic()-started
        assert builder.frozen_equal(before,builder.frozen_signature(p,f,lo,hi))
        builder.lattice_keys(p)
        assert np.isfinite(p).all()
        _,_,degenerate = builder.clean_faces(p,f)
        assert degenerate == 0
        if parent_mode:
            assert method['parentCellFallbackUsed'] and len(f) <= 4487
        else:
            assert method['frozenFaceFloor'] == 25988 and not method['parentCellFallbackUsed']
            assert method['targetBelowFrozenFloor']
        checkpoint = args.out/(name+'.npz')
        builder.save_mesh(checkpoint,p,f,samples,weights)
        with np.load(checkpoint,allow_pickle=False) as stored:
            assert np.array_equal(stored['referenceSamples'],samples)
            assert np.array_equal(stored['referenceWeights'],weights)
        forward = builder.distance_stats(builder.closest_distances(p,f,samples))
        reverse_samples,_ = builder.surface_samples(p,f,128,2102)
        reverse = builder.distance_stats(builder.closest_distances(points,faces,reverse_samples))
        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024
        assert peak < 300*1024**2
        rows.append(dict(name=name,sourceIsCompleteEightTileLeaf=True,
            parentStressIsNotACompleteParentMesh=parent_mode,
            inputVertices=len(points),inputTriangles=len(faces),targetTriangles=4487,
            vertices=len(p),triangles=len(f),reductionFraction=1-len(f)/len(faces),
            exactBoundarySignature=True,finitePositions=True,nondegenerateFaces=True,
            referenceSamplesBeforeAnyLossSha256=original_samples_sha,referenceSamplesPreservedExactly=True,
            forwardSampledDistances=forward,reverseSampledDistances=reverse,
            hausdorffBound=False,anatomicalAccuracyClaim=False,method=method,
            simplifySeconds=elapsed,peakProcessRssBytes=peak,checkpointSha256=builder.digest(checkpoint)))
        del p,f,reverse_samples
        gc.collect()
    assert all(builder.digest(path) == value for path,value in original_hashes.items())
    report = dict(schema='guided-native-overview-fallback-verification-v21.1',allChecksPassed=True,
        scope='One complete dense leaf and the same source with artificial child planes released; no full bank/global merge',
        inputArtifacts=inputs,weldedDuplicateVertices=welded,originalDegeneratesRemoved=removed,
        incidenceFilter=checks,resume=resume,cases=rows,originalBankFilesUnchanged=True,
        nativeGridBankModified=False,originalIntensityDownloads=0,uploads=0,
        defaultMergeFaceCap=6000000,defaultPrimaryClusterCellNativeVoxels=16,
        constrainedQemAndConditionalParentCellNativeVoxels=32,
        fullHierarchyFitEstablished=False,
        hierarchyBudget='When children meet proportional budgets, eight child ceilings/min32 add at most248 faces to the 5M aggregate target; actual protected-floor misses are measured and checked before every allocation.',
        builderSha256=builder.digest(SCRIPTS/'build_overview.py'),
        collapseFilterSha256=builder.digest(SCRIPTS/'overview_collapse.c'))
    path = Path(__file__).with_name('overview-fallback-verification.json')
    path.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(dict(allChecksPassed=True,report=str(path),cases=[{k:r[k] for k in
        ('name','inputTriangles','triangles','simplifySeconds','peakProcessRssBytes')} for r in rows])))


if __name__ == '__main__':
    main()
