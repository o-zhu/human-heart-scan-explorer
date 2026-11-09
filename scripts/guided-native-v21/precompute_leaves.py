#!/usr/bin/env python3
"""Precompute verified overview leaves; the original builder later merges them.

This wrapper does not change Builder code, settings, fingerprints or numerical
methods. Only the parent calls Builder.__init__. Spawn workers may write their
assigned leaf NPZ/JSON checkpoints, and no shared builder metadata.
"""
from __future__ import annotations
import os
os.environ['PYTHONDONTWRITEBYTECODE']='1'
os.environ['OPENBLAS_NUM_THREADS']='1'
os.environ['OMP_NUM_THREADS']='1'
os.environ['MKL_NUM_THREADS']='1'
import argparse
import concurrent.futures as cf
import ctypes
import fcntl
import gc
import hashlib
import importlib.util
import json
import math
import multiprocessing as mp
from pathlib import Path
import resource
import sys
import tempfile
import threading
import time
sys.dont_write_bytecode=True

MIB=1024**2
DEFAULT_BUILDER=Path('/workspace/sites/hi-p-ct-heart-atlas/scripts/guided-native-v21/build_overview.py')
_WORKER=None
_ALLOWED_WRITES=set()
_ALLOWED_DIRECTORY=None
_AUDITED_WRITES=0

def digest(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda:stream.read(MIB),b''):h.update(block)
    return h.hexdigest()

def code_identity(path):
    return {str(p):digest(p) for p in (path,path.with_name('edge_codec.py'),path.with_name('overview_collapse.c'))}

def check_code(identity):
    if any(digest(path)!=expected for path,expected in identity.items()):
        raise RuntimeError('Frozen builder/codec/C source changed; no mixed-code precompute is allowed.')

def load_builder(path,python_path):
    sys.path.insert(0,str(python_path));sys.path.insert(0,str(path.parent))
    spec=importlib.util.spec_from_file_location('leaf_precompute_builder',path)
    module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)
    return module

def leaf_partition(records,origin,span,args):
    """Mirror Builder.node's exact partition, including adaptive dense leaves."""
    raw_faces=sum(r['triangles'] for r in records)
    leaf=span<=args.group_blocks and raw_faces<=args.leaf_face_cap
    if span==1:
        if raw_faces>args.leaf_face_cap:raise ValueError('One overview tile exceeds --leaf-face-cap')
        leaf=True
    if leaf:
        yield dict(records=records,origin=tuple(origin),span=span,
                   name=f's{span:03d}_'+'_'.join(map(str,origin)))
        return
    half=span//2;groups={}
    for record in records:
        child=tuple(int(n)//half*half for n in record['coordinatesXYZ'])
        groups.setdefault(child,[]).append(record)
    for child in sorted(groups):yield from leaf_partition(groups[child],child,half,args)

def validate_leaf(job,args):
    records,origin,span=job['records'],job['origin'],job['span']
    if not records or span<1 or span&(span-1) or len(origin)!=3:
        raise ValueError('Invalid leaf partition job')
    if any(int(n)%span for n in origin):raise ValueError('Leaf origin is not grid aligned')
    if any(any(not origin[i]<=r['coordinatesXYZ'][i]<origin[i]+span for i in range(3)) for r in records):
        raise ValueError('A record is outside its assigned leaf')
    raw=sum(r['triangles'] for r in records)
    if not ((span<=args.group_blocks and raw<=args.leaf_face_cap) or (span==1 and raw<=args.leaf_face_cap)):
        raise ValueError('Worker was assigned a non-leaf; parent merges are forbidden')
    if job['name']!=f's{span:03d}_'+'_'.join(map(str,origin)):
        raise ValueError('Leaf path identity mismatch')

def audit_writes(event,args):
    """Enforce the child's file-write scope, including unexpected future calls."""
    global _AUDITED_WRITES
    paths=[]
    if event=='open':
        path,mode,flags=args
        write=(isinstance(mode,str) and any(x in mode for x in 'wax+')) or (isinstance(flags,int) and flags&(os.O_WRONLY|os.O_RDWR|os.O_CREAT|os.O_TRUNC|os.O_APPEND))
        if write and not isinstance(path,int):paths=[path]
    elif event in ('os.rename','os.link'):paths=list(args[:2])
    elif event in ('os.remove','os.unlink','os.rmdir'):paths=[args[0]]
    elif event=='os.mkdir':
        if Path(args[0]).resolve()!=_ALLOWED_DIRECTORY:
            raise PermissionError('Leaf worker cannot create a directory outside nodes/')
        return
    for path in paths:
        if Path(path).resolve() not in _ALLOWED_WRITES:
            raise PermissionError(f'Leaf worker cannot mutate shared/unassigned file: {path}')
    if paths:_AUDITED_WRITES+=1

def worker_init(state,peaks,slots,worker_limit):
    global _WORKER
    check_code(state['code'])
    module=load_builder(Path(state['builder']),Path(state['args']['python_path']))
    # Parent already compiled this exact C key. Warm imports before installing
    # the strict file-write audit, with bytecode writes disabled everywhere.
    module.collapse_library();module.vtk_api()
    import fast_simplification
    from fast_simplification import _replay
    with slots.get_lock():slot=slots.value;slots.value+=1
    if slot>=len(peaks):raise RuntimeError('Unexpected extra pool worker')
    _WORKER=(state,module,slot)
    def watch():
        while True:
            peak=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024
            with peaks.get_lock():peaks[slot]=peak
            if peak>worker_limit:
                os.write(2,b'Leaf worker exceeded its own RSS allowance. Checkpoints retained.\n');os._exit(137)
            time.sleep(.025)
    threading.Thread(target=watch,name='leaf-rss-budget',daemon=True).start()
    sys.addaudithook(audit_writes)

def worker_leaf(job):
    global _ALLOWED_WRITES,_ALLOWED_DIRECTORY,_AUDITED_WRITES
    state,module,slot=_WORKER;args=argparse.Namespace(**state['args'])
    validate_leaf(job,args);check_code(state['code'])
    directory=Path(state['out'])/'nodes';npz=directory/(job['name']+'.npz');record=npz.with_suffix('.json')
    _ALLOWED_DIRECTORY=directory.resolve()
    _ALLOWED_WRITES={p.resolve() for p in (npz,record,npz.with_suffix('.npz.part'),record.with_suffix('.json.part'))}
    _AUDITED_WRITES=0
    if job.get('_proof_fail_before_node'):raise RuntimeError('Intentional precompute failure for resume proof')
    builder=module.Builder.__new__(module.Builder)
    builder.args=args;builder.run=Path(state['run']);builder.out=Path(state['out'])
    builder.total_faces=state['total_faces'];builder.target=state['target'];builder.fingerprint=state['fingerprint']
    builder.leaves=[];builder.nodes=[];builder.started=time.monotonic()
    result=builder.node(job['records'],job['origin'],job['span'])
    if not result['leaf'] or result['children'] or result['name']!=job['name'] or result['fingerprint']!=state['fingerprint']:
        raise RuntimeError('Worker produced a non-leaf or foreign checkpoint')
    if len(builder.leaves)!=1 or len(builder.nodes)!=1:
        raise RuntimeError('Worker traversed outside its unique assigned leaf')
    check_code(state['code'])
    output=dict(name=result['name'],sha256=result['sha256'],triangles=result['triangles'],
                workerSlot=slot,peakRssBytes=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024,
                auditedWriteOperations=_AUDITED_WRITES)
    del builder,result;gc.collect()
    try:ctypes.CDLL('libc.so.6').malloc_trim(0)
    except (OSError,AttributeError):pass
    return output

def resources():
    result={'affinityCpus':len(os.sched_getaffinity(0))}
    for name in ('cpu.max','memory.max','memory.current'):
        path=Path('/sys/fs/cgroup')/name
        if path.exists():result[name]=path.read_text().strip()
    return result

def validate_args(args):
    if args.workers not in (1,2,3,4):raise ValueError('Use one to four bounded leaf workers')
    if args.group_blocks<1 or args.group_blocks&(args.group_blocks-1):raise ValueError('group-blocks must be a power of two')
    if min(args.triangles,args.leaf_face_cap,args.merge_face_cap,args.samples_per_leaf)<1:
        raise ValueError('Triangle caps and samples must be positive')
    if args.detail_triangles<0 or args.reverse_samples<0 or args.intermediate_factor<1 or not 0<args.asset_mib<=32:
        raise ValueError('Invalid builder arguments')
    if args.rss_limit_mib<128 or args.rss_limit_mib>2048:raise ValueError('Use a 128–2048 MiB aggregate precompute budget')

def precompute(args,proof_fail_node=None):
    validate_args(args);args.run=args.run.resolve();args.out=args.out.resolve();args.builder=args.builder.resolve()
    identity=code_identity(args.builder);module=load_builder(args.builder,args.python_path)
    lock_path=Path(tempfile.gettempdir())/('heart-overview-leaves-'+hashlib.sha256(str(args.out).encode()).hexdigest()+'.lock')
    with lock_path.open('a+b') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        builder=module.Builder(args)
        source=builder.source;complete=bool(source['completeCorePlan']);fingerprint=builder.fingerprint
        if not args.pilot and not complete:raise ValueError('Production leaves require the complete core plan')
        span=1<<int(max(max(r['coordinatesXYZ']) for r in builder.records)).bit_length()
        jobs=list(leaf_partition(builder.records,(0,0,0),span,args))
        names=[j['name'] for j in jobs]
        if len(set(names))!=len(names):raise RuntimeError('Duplicate leaf path in partition')
        coordinates=[tuple(r['coordinatesXYZ']) for j in jobs for r in j['records']]
        if len(coordinates)!=len(builder.records) or len(set(coordinates))!=len(coordinates):
            raise RuntimeError('Leaf partition lost or duplicated input records')
        for job in jobs:validate_leaf(job,args)
        expected_coordinates={tuple(r['coordinatesXYZ']) for r in builder.records}
        if set(coordinates)!=expected_coordinates:raise RuntimeError('Leaf partition differs from input coordinates')
        del coordinates,expected_coordinates
        (args.out/'nodes').mkdir(exist_ok=True)
        if (args.out/'nodes').is_symlink():raise ValueError('Nodes directory cannot be a symbolic link')
        module.collapse_library()  # Precompile once before any child is spawned.
        state=dict(args=vars(args).copy(),run=str(builder.run),out=str(builder.out),total_faces=builder.total_faces,
                   target=builder.target,fingerprint=fingerprint,builder=str(args.builder),code=identity)
        shared_paths=[args.out/'input-manifest.json',args.out/'build.json']
        shared_before={p.name:digest(p) for p in shared_paths}
        existing_children={p.pid for p in mp.active_children()}
        report=dict(schema='heart-overview-parallel-leaves-v21.1',fingerprint=fingerprint,code=identity,
            scriptSha256=digest(__file__),pilot=args.pilot,completeCorePlan=complete,inputRecords=len(builder.records),
            leaves=len(jobs),workers=args.workers,resourcesBefore=resources(),
            numericalMethodsUnchanged=True,leafPartitionCoversInputsExactly=True,sharedMetadataSha256Before=shared_before,
            parentMergesExecuted=False,finalQemExecuted=False,completedLeaves=[],complete=False)
        # The complete record inventory stays only in the parent; each submitted
        # task carries its own small subset. Bound queued futures to 2*workers.
        ctx=mp.get_context('spawn');peaks=ctx.Array('Q',args.workers,lock=True);slots=ctx.Value('I',0)
        reserve=16*MIB;budget=args.rss_limit_mib*MIB
        parent_peak=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024
        worker_limit=(budget-parent_peak-reserve)//args.workers
        if worker_limit<64*MIB:raise MemoryError('RSS budget cannot accommodate parent plus bounded worker imports')
        info=resources();current=info.get('memory.current');maximum=info.get('memory.max')
        if current and maximum and maximum!='max' and int(maximum)-int(current)<budget+128*MIB:
            raise MemoryError('Not enough cgroup headroom for the requested bounded pilot; native run was not touched')
        started=time.monotonic();maximum_aggregate=0;pool=None;failure=None;pending={}
        try:
            pool=cf.ProcessPoolExecutor(max_workers=args.workers,mp_context=ctx,initializer=worker_init,
                initargs=(state,peaks,slots,worker_limit))
            iterator=iter(jobs)
            def submit():
                try:job=next(iterator)
                except StopIteration:return False
                if job['name']==proof_fail_node:job={**job,'_proof_fail_before_node':True}
                pending[pool.submit(worker_leaf,job)]=job['name'];return True
            for _ in range(2*args.workers):
                if not submit():break
            while pending:
                parent_peak=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024
                with peaks.get_lock():aggregate=parent_peak+sum(peaks)+reserve
                maximum_aggregate=max(maximum_aggregate,aggregate)
                if aggregate>budget:raise MemoryError('Aggregate parent/worker RSS allowance exceeded')
                done,_=cf.wait(pending,timeout=.05,return_when=cf.FIRST_COMPLETED)
                for future in done:
                    expected=pending.pop(future);result=future.result()
                    if result['name']!=expected:raise RuntimeError('Worker returned another leaf identity')
                    report['completedLeaves'].append(result)
                    with peaks.get_lock():peaks[result['workerSlot']]=max(peaks[result['workerSlot']],result['peakRssBytes'])
                    submit()
            report['complete']=True
        except BaseException as error:
            failure=error;report['error']=f'{type(error).__name__}: {error}'
            for future in pending:future.cancel()
            if isinstance(error,(MemoryError,KeyboardInterrupt)):
                for child in mp.active_children():
                    if child.pid not in existing_children:child.terminate()
        finally:
            if pool is not None:pool.shutdown(wait=True,cancel_futures=True)
            check_code(identity)
            shared_after={p.name:digest(p) for p in shared_paths}
            report['sharedMetadataSha256After']=shared_after
            report['sharedMetadataUnchangedByWorkers']=shared_after==shared_before
            with peaks.get_lock():worker_peaks=list(peaks)
            report['workerPeakRssBytes']=worker_peaks
            report['parentPeakRssBytes']=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024
            report['helperRssReserveBytes']=reserve
            report['aggregatePeakUpperBoundBytes']=max(maximum_aggregate,report['parentPeakRssBytes']+sum(worker_peaks)+reserve)
            report['seconds']=time.monotonic()-started
            report['allWorkersClosedBeforeReturn']=not any(p.pid not in existing_children for p in mp.active_children())
            if not report['sharedMetadataUnchangedByWorkers'] or not report['allWorkersClosedBeforeReturn']:
                failure=RuntimeError('Leaf worker isolation/closure verification failed');report['complete']=False
            if report['aggregatePeakUpperBoundBytes']>budget:
                failure=MemoryError('Measured aggregate RSS upper bound exceeded budget');report['complete']=False
            module.atomic_json(args.out/'leaf-precompute-report.json',report)
        if failure is not None:raise failure
        print(json.dumps({k:report[k] for k in ('complete','leaves','workers','seconds','aggregatePeakUpperBoundBytes','sharedMetadataUnchangedByWorkers','allWorkersClosedBeforeReturn')}),flush=True)
        return report

def parser():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--builder',type=Path,default=DEFAULT_BUILDER)
    p.add_argument('--run',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    p.add_argument('--workers',type=int,default=4);p.add_argument('--rss-limit-mib',type=int,default=1536)
    p.add_argument('--triangles',type=int,default=1_250_000);p.add_argument('--detail-triangles',type=int,default=0)
    p.add_argument('--group-blocks',type=int,default=4);p.add_argument('--leaf-face-cap',type=int,default=750_000)
    p.add_argument('--merge-face-cap',type=int,default=6_000_000);p.add_argument('--intermediate-factor',type=float,default=2.0)
    p.add_argument('--cluster-max-cell',type=int,choices=(4,8,16,32),default=16)
    p.add_argument('--qem-cell',type=int,choices=(16,32),default=32);p.add_argument('--qem-passes',type=int,choices=(0,1,2),default=2)
    p.add_argument('--samples-per-leaf',type=int,default=256);p.add_argument('--reverse-samples',type=int,default=4096)
    p.add_argument('--asset-mib',type=float,default=32.);p.add_argument('--seed',type=int,default=210794)
    p.add_argument('--python-path',type=Path,default=Path('/workspace/data/fine-surface-v19-python'))
    p.add_argument('--pilot',action='store_true');p.add_argument('--nodes-only',action='store_true')
    return p

def main():
    try:precompute(parser().parse_args())
    except Exception as error:
        print(f'Leaf precompute stopped safely: {type(error).__name__}: {error}',file=sys.stderr);return 1
    return 0

if __name__=='__main__':raise SystemExit(main())
