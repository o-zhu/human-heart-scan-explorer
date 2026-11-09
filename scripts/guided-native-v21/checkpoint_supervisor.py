#!/usr/bin/env python3
"""Advance verified recovery controls during one active native run.

This is a companion to a running job, not a durable external scheduler or a Box
uploader. The existing collection credential is read once through hidden stdin
and supplied only through child-process stdin. Scientific data are unchanged.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import fcntl
import json
from pathlib import Path
import subprocess
import sys
import time

from upload import read_access

def stamp(): return datetime.now(timezone.utc).isoformat()

def worker_active(work):
    with (work/'runner.lock').open('a+') as lock:
        try:
            fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
            fcntl.flock(lock.fileno(),fcntl.LOCK_UN)
            return False
        except BlockingIOError:
            return True

def atomic_json(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_name(path.name+'.partial')
    temporary.write_text(json.dumps(data,indent=2)+'\n')
    temporary.replace(path)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--run',type=Path,required=True)
    p.add_argument('--out',type=Path,required=True)
    p.add_argument('--ledger',type=Path,required=True)
    p.add_argument('--status',type=Path,required=True)
    p.add_argument('--every-blocks',type=int,default=500)
    p.add_argument('--max-age-seconds',type=int,default=300)
    p.add_argument('--poll-seconds',type=int,default=30)
    p.add_argument('--once',action='store_true')
    a=p.parse_args()
    if a.every_blocks<1 or a.max_age_seconds<30 or not 5<=a.poll_seconds<=60:
        p.error('Require positive blocks, max age >=30 seconds, and poll 5–60 seconds.')
    a.status.parent.mkdir(parents=True,exist_ok=True)
    with a.status.with_suffix('.lock').open('a+') as owned:
        try: fcntl.flock(owned.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: p.error('A checkpoint supervisor already owns this status path.')
        access=read_access()
        stdin_json=json.dumps(access)+'\n';access.clear()
        last_count=-a.every_blocks;last_time=0.;last_result=None;cycles=0
        while True:
            progress=json.loads((a.run/'progress.json').read_text())
            active=worker_active(a.run)
            # A restart may be reloading its halos while the old progress file
            # still says paused. The OS lock establishes liveness independently.
            count=sum(1 for _ in (a.run/'records').glob('*.json'))
            due=(count>last_count and (count-last_count>=a.every_blocks or time.monotonic()-last_time>=a.max_age_seconds))
            terminal=not active
            if due or (terminal and count!=last_count):
                command=[sys.executable,str(Path(__file__).with_name('checkpoint_bank.py')),
                    '--run',str(a.run),'--out',str(a.out),'--ledger',str(a.ledger),'--upload']
                result=subprocess.run(command,input=stdin_json,text=True,capture_output=True)
                if result.returncode:
                    state=dict(updatedAt=stamp(),phase='checkpoint-retry',workerActive=active,
                        completedRecordFiles=count,checkpointCycles=cycles,returncode=result.returncode,
                        error=result.stderr.strip()[-1800:],lastSuccessfulCheckpoint=last_result)
                    atomic_json(a.status,state)
                    print(json.dumps(state),flush=True)
                    if a.once: return result.returncode
                else:
                    last_result=json.loads(result.stdout.strip())
                    last_count=last_result['completedRecords'];last_time=time.monotonic();cycles+=1
                    state=dict(updatedAt=stamp(),phase='verified-checkpoint',workerActive=active,
                        completedRecordFiles=count,checkpointCycles=cycles,lastSuccessfulCheckpoint=last_result)
                    atomic_json(a.status,state)
                    print(json.dumps({'updatedAt':state['updatedAt'],'phase':state['phase'],
                        'completedRecords':last_count,'checkpointCycles':cycles,
                        'controlSha256':last_result['control']['sha256']}),flush=True)
                    if a.once: return 0
            else:
                atomic_json(a.status,dict(updatedAt=stamp(),phase='monitoring',workerActive=active,
                    completedRecordFiles=count,checkpointCycles=cycles,lastSuccessfulCheckpoint=last_result))
            if terminal and last_count>=count:
                print(json.dumps({'updatedAt':stamp(),'phase':'worker-finished','completedRecords':count}),flush=True)
                return 0
            time.sleep(a.poll_seconds)

if __name__=='__main__': raise SystemExit(main())
