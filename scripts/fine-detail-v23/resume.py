#!/usr/bin/env python3
"""Capture/verify the numerical environment before resuming v23 slab work."""
from __future__ import annotations
import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import json
from pathlib import Path
import platform
import os
import subprocess
import sys
import time

import numpy as np
import scipy
import vtk

from source import ROOT, FineSource


def environment():
    source=FineSource(0)
    helper=ROOT/'scripts/fine-surface-v19/prepare.py'
    vendor=Path(__file__).parent/'vendor/Simplify.upstream.h'
    compiler=subprocess.run(['g++','--version'],check=True,text=True,capture_output=True).stdout.splitlines()[0]
    return dict(python=platform.python_version(),numpy=np.__version__,scipy=scipy.__version__,vtk=vtk.vtkVersion.GetVTKVersion(),
                compiler=compiler,sourceManifestSha256=source.manifest_sha256,
                importedV19PrepareSha256=hashlib.sha256(helper.read_bytes()).hexdigest(),
                upstreamQemSha256=hashlib.sha256(vendor.read_bytes()).hexdigest())


def verify(work,capture=False):
    work=Path(work);work.mkdir(parents=True,exist_ok=True);path=work/'environment.json';current=environment()
    if path.exists():
        previous=json.loads(path.read_text());assert previous['environment']==current,'Numerical environment changed; do not combine differently processed slabs.'
    else:
        assert capture,'Missing environment receipt; restore it with the checkpoint.'
        previous=dict(schema='fine-detail-v23-environment',environment=current,capturedAtUtc=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()))
        temporary=path.with_suffix('.json.partial');temporary.write_text(json.dumps(previous,indent=2)+'\n');temporary.replace(path)
    for path in (work/'slabs').glob('*.json'):
        item=json.loads(path.read_text());recovery=item.get('validationRecovery')
        if recovery is None:continue
        assert recovery['verified'] and recovery['numericPipelineChanged'] is False and recovery['verticesOrFacesChanged'] is False
        assert item['sha256']==recovery['unchangedOutputSha256']
        assert hashlib.sha256((Path(__file__).parent/'recover_slab.py').read_bytes()).hexdigest()==recovery['recoveryScriptSha256']
        assert hashlib.sha256((Path(__file__).parent/'diagnose_slab.py').read_bytes()).hexdigest()==recovery['diagnosisScriptSha256']
        for path_key,hash_key in [('boundaryProofPath','boundaryProofSha256'),('diagnosticPath','diagnosticSha256')]:
            assert hashlib.sha256((ROOT/recovery[path_key]).read_bytes()).hexdigest()==recovery[hash_key],'Missing or changed recovery evidence'
        for check in recovery['checks']:
            assert check['missingOriginalFrozenVertices']==0 and check['exactFrozenCoordinateMultisetPreserved'] and check['exactOpenEdgeMultisetPreserved']
    return previous


def active_legacy_runs(work):
    """Find this exact preparation script/work or its native reducer in /proc.

    A previously started direct prepare.py run does not hold our new lock.
    Its command line is inspected locally but never echoed into a receipt.
    """
    work=Path(work).resolve();script=(Path(__file__).parent/'prepare.py').resolve();found=[]
    reducer=(work/'bin/constrained-qem').resolve()
    for directory in Path('/proc').iterdir():
        if not directory.name.isdigit() or int(directory.name)==os.getpid():continue
        try:
            argv=[v.decode(errors='surrogateescape') for v in (directory/'cmdline').read_bytes().split(b'\0') if v]
            try:cwd=(directory/'cwd').resolve()
            except (OSError,PermissionError):cwd=None
            def absolute(value):
                path=Path(value)
                if path.is_absolute():return path.resolve()
                return (cwd/path).resolve() if cwd is not None else None
            if argv and absolute(argv[0])==reducer:
                found.append(dict(pid=int(directory.name),stage='native reduction'));continue
            relative_script=str(script.relative_to(ROOT))
            script_match=any(not arg.startswith('-') and arg.endswith('prepare.py') and
                             (absolute(arg)==script or (cwd is None and arg.removeprefix('./') in [relative_script,'prepare.py']))
                             for arg in argv)
            if not script_match:continue
            requested=None
            unresolved=False
            for index,arg in enumerate(argv):
                if arg=='--work' and index+1<len(argv):requested=absolute(argv[index+1]);unresolved=requested is None;break
                if arg.startswith('--work='):requested=absolute(arg.split('=',1)[1]);unresolved=requested is None;break
            if requested==work:found.append(dict(pid=int(directory.name),stage='preparation'))
            elif unresolved:found.append(dict(pid=int(directory.name),stage='preparation with unresolved relative work path'))
        except (OSError,PermissionError,ValueError):
            continue
    return found


@contextmanager
def exclusive_resume(work):
    work=Path(work).resolve();work.mkdir(parents=True,exist_ok=True)
    with (work/'resume.lock').open('a+b') as lock:
        try:fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError as error:raise RuntimeError('Another guarded v23 resume already holds this work-directory lock.') from error
        legacy=active_legacy_runs(work)
        if legacy:raise RuntimeError('This work directory is already active: '+', '.join(f"{item['stage']} PID{item['pid']}" for item in legacy))
        lock.seek(0);lock.truncate();lock.write(json.dumps(dict(pid=os.getpid(),work=str(work),startedAtUtc=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()))).encode());lock.flush()
        # Closing our descriptor releases the lock only after the last inherited
        # descriptor closes. An explicit LOCK_UN would also unlock a surviving
        # child that shares this open file description.
        yield lock.fileno()


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--work',type=Path,required=True)
    p.add_argument('--capture',action='store_true');p.add_argument('--workers',type=int,default=1);a=p.parse_args()
    if a.capture:
        receipt=verify(a.work,capture=True)
        print(json.dumps(receipt));return
    with exclusive_resume(a.work) as lock_fd:
        verify(a.work)
        config=json.loads((a.work/'configuration.json').read_text())
        for name,expected in config['scripts'].items():
            assert hashlib.sha256((Path(__file__).parent/name).read_bytes()).hexdigest()==expected,('Scientific script differs from saved configuration',name)
        # The child retains the same locked file description if the wrapper is
        # interrupted, so another guarded run cannot overlap it.
        subprocess.run([sys.executable,str(Path(__file__).parent/'prepare.py'),'--work',str(a.work),
                        '--sigma',str(config['sigmaVoxels']),'--radius-mm',str(config['conservativeRadiusLimitMm']),
                        '--slab-cells',str(config['slabCells']),'--workers',str(a.workers)],check=True,pass_fds=(lock_fd,))

if __name__=='__main__':main()
