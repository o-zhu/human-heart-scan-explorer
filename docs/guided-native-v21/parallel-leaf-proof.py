#!/usr/bin/env python3
import os
os.environ['PYTHONDONTWRITEBYTECODE']='1'
os.environ['OPENBLAS_NUM_THREADS']='1';os.environ['OMP_NUM_THREADS']='1';os.environ['MKL_NUM_THREADS']='1'
import argparse,hashlib,importlib.util,json,resource,subprocess,sys,tempfile,time
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[2]
WRAPPER=ROOT/'scripts/guided-native-v21/precompute_leaves.py'
spec=importlib.util.spec_from_file_location('heart_leaf_precompute',WRAPPER)
wrapper=importlib.util.module_from_spec(spec);sys.modules[spec.name]=wrapper;spec.loader.exec_module(wrapper)
BASE=Path('{temporary-cache}')
RUN=Path('{source-cache}/guided-native-v21/pilot/run')
COMMON=['--run',str(RUN),'--pilot','--triangles','1000','--detail-triangles','2000',
        '--samples-per-leaf','64','--reverse-samples','32','--rss-limit-mib','280']

def args_for(out,workers=2):
    return wrapper.parser().parse_args([*COMMON,'--out',str(out),'--workers',str(workers)])

def stage_original(out):
    args=args_for(out);module=wrapper.load_builder(args.builder,args.python_path);b=module.Builder(args)
    span=1<<int(max(max(r['coordinatesXYZ']) for r in b.records)).bit_length()
    root=b.node(b.records,(0,0,0),span);result=b.finish(root)
    print(json.dumps({'stage':'original','fingerprint':b.fingerprint,'nodes':len(b.nodes),
        'peakRssBytes':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024,'triangles':root['triangles']}),flush=True)

def stage_fault(out):
    try:wrapper.precompute(args_for(out,1),proof_fail_node='s004_36_28_36')
    except RuntimeError as error:
        if 'Intentional precompute failure' not in str(error):raise
    else:raise AssertionError('The intentional failed leaf did not fail')
    report=json.loads((out/'leaf-precompute-report.json').read_text())
    assert report['complete'] is False and report['sharedMetadataUnchangedByWorkers'] and report['allWorkersClosedBeforeReturn']
    assert (out/'nodes/s004_32_28_36.json').exists() and not (out/'nodes/s004_36_28_36.json').exists()
    print(json.dumps({'stage':'expected-failure','checkpointsPreserved':True,'aggregatePeakUpperBoundBytes':report['aggregatePeakUpperBoundBytes']}),flush=True)

def clean(value):
    if isinstance(value,dict):return {k:clean(v) for k,v in value.items() if k not in ('seconds','elapsedSeconds','peakProcessRssBytes','nodeRecordsCanonicalSha256')}
    if isinstance(value,list):return [clean(v) for v in value]
    return value

def verify(reference,candidate,leaf_only=False):
    expected=sorted((reference/'nodes').glob('*.json'))
    if leaf_only:expected=[p for p in expected if json.loads(p.read_text())['leaf']]
    checks=[]
    for p in expected:
        q=candidate/'nodes'/p.name;a=json.loads(p.read_text());b=json.loads(q.read_text())
        assert clean(a)==clean(b),(p.name,'node metadata differs beyond timing')
        x=p.with_suffix('.npz');y=q.with_suffix('.npz')
        assert wrapper.digest(x)==wrapper.digest(y)==a['sha256']==b['sha256'],p.name
        checks.append({'node':a['name'],'sha256':a['sha256'],'numericalMetadataIdentical':True,'npzBytesIdentical':True})
    if not leaf_only:
        for directory in (reference,candidate):
            nodes=sorted((json.loads(p.read_text()) for p in (directory/'nodes').glob('*.json')),key=lambda n:n['name'])
            canonical=json.dumps(nodes,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
            manifest=json.loads((directory/'manifest.json').read_text())
            assert hashlib.sha256(canonical).hexdigest()==manifest['hierarchy']['nodeRecordsCanonicalSha256'],'Actual node-record provenance hash is invalid'
        for name in ('input-manifest.json','build.json','overview.json','detail.json','manifest.json'):
            assert clean(json.loads((reference/name).read_text()))==clean(json.loads((candidate/name).read_text())),name
        for p in (reference/'assets').glob('*.gz'):
            assert wrapper.digest(p)==wrapper.digest(candidate/'assets'/p.name),p.name
    return checks

def main():
    global BASE
    parser=argparse.ArgumentParser();parser.add_argument('--stage',choices=('original','fault'));parser.add_argument('--out',type=Path)
    parser.add_argument('--base',type=Path,help='Fresh output directory for a repeat proof')
    options=parser.parse_args()
    if options.stage=='original':stage_original(options.out);return
    if options.stage=='fault':stage_fault(options.out);return
    BASE=options.base or Path(tempfile.mkdtemp(prefix='heart-overview-leaf-proof-'))
    BASE.mkdir(exist_ok=True)
    if any((BASE/name).exists() for name in ('reference','parallel','resume')):
        raise RuntimeError('Proof directory already contains outputs; choose a fresh directory instead of deleting them')
    began=time.monotonic();identity=wrapper.code_identity(wrapper.DEFAULT_BUILDER);phases=[]
    def run(label,command):
        start=time.monotonic();r=subprocess.run(command,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        if r.returncode:raise RuntimeError(f'{label} failed: '+r.stderr+'\n'+r.stdout)
        lines=[json.loads(s) for s in r.stdout.splitlines() if s.startswith('{')]
        phases.append({'phase':label,'seconds':time.monotonic()-start,'summary':lines[-1] if lines else {},'stderr':r.stderr})
        print(json.dumps(phases[-1]),flush=True)
    reference=BASE/'reference';parallel=BASE/'parallel';resume=BASE/'resume'
    run('original-sequential',[sys.executable,__file__,'--stage','original','--out',str(reference)])
    run('parallel-leaf-precompute',[sys.executable,str(WRAPPER),*COMMON,'--out',str(parallel),'--workers','2'])
    before=verify(reference,parallel,leaf_only=True)
    parallel_precompute=json.loads((parallel/'leaf-precompute-report.json').read_text())
    assert parallel_precompute['complete'] and parallel_precompute['workers']==2
    assert parallel_precompute['sharedMetadataUnchangedByWorkers'] and parallel_precompute['allWorkersClosedBeforeReturn']
    assert len(set(r['workerSlot'] for r in parallel_precompute['completedLeaves']))==2,'Both workers must execute an actual leaf.'
    leaf_mtimes={p.name:p.stat().st_mtime_ns for p in (parallel/'nodes').glob('*') if p.suffix in ('.json','.npz')}
    run('original-after-pool-closed',[sys.executable,__file__,'--stage','original','--out',str(parallel)])
    after=verify(reference,parallel)
    assert all((parallel/'nodes'/name).stat().st_mtime_ns==mtime for name,mtime in leaf_mtimes.items()),'Normal traversal rewrote a valid precomputed leaf'
    run('intentional-worker-failure',[sys.executable,__file__,'--stage','fault','--out',str(resume)])
    failed=json.loads((resume/'leaf-precompute-report.json').read_text())
    survivor=resume/'nodes/s004_32_28_36.npz';survivor_hash=wrapper.digest(survivor);survivor_time=survivor.stat().st_mtime_ns
    run('resume-completed-leaves',[sys.executable,str(WRAPPER),*COMMON,'--out',str(resume),'--workers','2'])
    assert wrapper.digest(survivor)==survivor_hash and survivor.stat().st_mtime_ns==survivor_time
    resumed=verify(reference,resume,leaf_only=True);resume_report=json.loads((resume/'leaf-precompute-report.json').read_text())
    wrapper.check_code(identity)
    parent_peak=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024
    child_peaks=[p['summary'].get('aggregatePeakUpperBoundBytes',p['summary'].get('peakRssBytes',0)) for p in phases]
    aggregate=max(child_peaks)+parent_peak
    assert aggregate<=300*wrapper.MIB,(aggregate,'Combined proof/orchestrator/workers exceed 300 MiB')
    result={'schema':'heart-overview-parallel-leaf-proof-v21.1','passed':True,'pilotOnly':True,'inputTiles':8,
        'builderCodeSha256':identity,'numericalMethodsUnchanged':True,'twoWorkersExecutedDistinctLeaves':True,
        'leafChecks':before,'allNodeChecks':after,'resumeChecks':resumed,'exactCompressedMeshAssets':True,
        'metadataDifferenceAllowlist':['seconds','elapsedSeconds','peakProcessRssBytes','nodeRecordsCanonicalSha256 (contains real node timings; independently recomputed and verified)'],
        'actualNodeRecordProvenanceHashesRecomputedAndVerified':True,
        'sharedMetadataUnchangedByWorkers':True,'normalTraversalReusedVerifiedLeafBytes':True,
        'workerFailurePreservedCompletedCheckpoint':True,'resumePreservedCompletedCheckpointMtime':True,
        'allWorkersClosedBeforeParentMerges':True,'phases':phases,
        'proofParentPeakRssBytes':parent_peak,'maximumConcurrentRssUpperBoundBytes':aggregate,
        'seconds':time.monotonic()-began,'outputs':{'reference':str(reference),'parallel':str(parallel),'resume':str(resume)}}
    (BASE/'proof.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'passed':True,'report':str(BASE/'proof.json'),'maximumConcurrentRssUpperBoundMiB':aggregate/wrapper.MIB,
        'seconds':result['seconds']}),flush=True)

if __name__=='__main__':main()
