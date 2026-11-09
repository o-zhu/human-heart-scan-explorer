#!/usr/bin/env python3
"""Check that resumed scientific work cannot overlap a live guarded run."""
from pathlib import Path
import argparse
import json
import subprocess
import sys
import tempfile

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts/fine-detail-v23'))
from resume import active_legacy_runs,exclusive_resume,verify


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--active-work',type=Path);args=parser.parse_args()
    result=dict(schema='fine-detail-v23-resume-check',passed=False)
    with tempfile.TemporaryDirectory(prefix='fine23-lock-check-') as directory:
        work=Path(directory)
        with exclusive_resume(work) as descriptor:
            child=subprocess.Popen([sys.executable,'-c','import sys; print("ready",flush=True); sys.stdin.readline()'],
                                   pass_fds=(descriptor,),stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
            assert child.stdout.readline().strip()=='ready'
        try:
            try:
                with exclusive_resume(work):raise AssertionError('Inherited child lock was lost when wrapper descriptor closed')
            except RuntimeError:
                result['inheritedChildRetainsLock']=True
        finally:
            child.communicate('\n',timeout=10);assert child.returncode==0
        with exclusive_resume(work):result['lockAvailableAfterChildExit']=True
        receipt=verify(work,capture=True);receipt['environment']['vtk']='different-test-version'
        (work/'environment.json').write_text(json.dumps(receipt))
        try:
            verify(work);raise AssertionError('Numerical environment change was accepted')
        except AssertionError as error:
            assert 'Numerical environment changed' in str(error)
            result['environmentMismatchRejected']=True
    if args.active_work:
        active=active_legacy_runs(args.active_work)
        result['activeLegacyDetected']=bool(active)
        if active:
            try:
                with exclusive_resume(args.active_work):raise AssertionError('Concurrent legacy extraction was accepted')
            except RuntimeError:result['activeLegacyResumeRejected']=True
    result['passed']=True
    (ROOT/'docs/fine-detail-v23/resume-check.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result))

if __name__=='__main__':main()
