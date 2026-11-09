#!/usr/bin/env python3
"""Restore immutable, manifest-verified review inputs; never write credentials.

The optional Sites service credential is supplied as one JSON line on hidden
stdin. Source objects retain their original URL, bytes, checksum, and identity.
"""
import argparse
import concurrent.futures
import hashlib
import json
from pathlib import Path
import sys
import termios
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--origin', required=True)
    parser.add_argument('--workers', type=int, default=12)
    parser.add_argument('--full-bank', action='store_true')
    parser.add_argument('--sections-only', action='store_true')
    parser.add_argument('--exterior-only', action='store_true')
    args = parser.parse_args()
    assert 1 <= args.workers <= 16
    original = termios.tcgetattr(sys.stdin.fileno())
    hidden = termios.tcgetattr(sys.stdin.fileno())
    hidden[3] &= ~termios.ECHO
    termios.tcsetattr(sys.stdin.fileno(), termios.TCSANOW, hidden)
    print('Ready for read-only source access JSON (hidden stdin).', flush=True)
    try:
        access = json.loads(sys.stdin.readline(32769))
    finally:
        termios.tcsetattr(sys.stdin.fileno(), termios.TCSANOW, original)
    headers = {'Accept-Encoding': 'identity'}
    if access.get('bearer'):
        headers['OAI-Sites-Authorization'] = 'Bearer ' + access['bearer']
    volume = json.loads((ROOT/'public/assets/ultra-volume-v7.json').read_text())
    images = json.loads((ROOT/'public/assets/ultra-sections/manifest.json').read_text())
    image_index = json.loads((ROOT/'server/ultra-upload-index.json').read_text())
    jobs = []
    # Requested screenshot/codec planes first. The source index is authoritative.
    selected = {'x/0190.webp','x/0237.webp','x/0312.webp','y/0293.webp','y/0315.webp','z/0209.webp','z/0265.webp'}
    entries = image_index.get('objects', image_index.get('files', image_index))
    if isinstance(entries, list):
        entries = {v.get('path', v.get('key')): v for v in entries}
    if args.sections_only:
        selected = set(entries)
    elif args.exterior_only:
        selected = set()
    for path in selected:
        entry = entries.get(path)
        if entry is None:
            # Some source indexes include a URL-key prefix.
            matches = [v for k,v in entries.items() if k.endswith('/'+path)]
            assert len(matches)==1, (path,list(entries)[:2])
            entry = matches[0]
        jobs.append((0, images['assetBaseUrl']+path, ROOT/'data/ultra-sections'/path, entry))
    counts = volume['brickCountsXYZ']; origin = volume['sourceOriginXYZ']
    regions = [([1000,900,600],[1460,1370,1410]),([570,1000,480],[830,1440,1030])]
    planes = [(0,760),(1,1172),(1,1260),(2,836)]
    if args.exterior_only:
        regions = [([496,756,576],[1044,1084,944])]
        planes = []
    for key,entry in volume['blocks'].items():
        if args.sections_only:
            break
        index = int(key); xyz=[index%counts[0],index//counts[0]%counts[1],index//(counts[0]*counts[1])]
        lo=[origin[a]+64*xyz[a] for a in range(3)]; hi=[v+64 for v in lo]
        priority = 4
        if any(all(lo[a]<upper[a] and hi[a]>lower[a] for a in range(3)) for lower,upper in regions): priority=1
        elif any(lo[a]<=q<hi[a] for a,q in planes): priority=2
        if priority<4 or args.full_bank:
            jobs.append((priority,volume['assetBaseUrl']+entry['path'],ROOT/'data/ultra-volume-v7'/entry['path'],entry))
    jobs.sort(key=lambda job:job[0])
    def obtain(job):
        priority,url,path,entry=job
        expected=entry.get('bytes',entry.get('size'))
        sha=entry['sha256']
        if path.exists() and path.stat().st_size==expected and hashlib.sha256(path.read_bytes()).hexdigest()==sha:
            return priority,expected,True
        request=urllib.request.Request(args.origin.rstrip('/')+url,headers=headers)
        for attempt in range(3):
            try:
                with urllib.request.urlopen(request,timeout=40) as response:
                    data=response.read(expected+1)
                assert len(data)==expected and hashlib.sha256(data).hexdigest()==sha, ('Source identity mismatch',url)
                path.parent.mkdir(parents=True,exist_ok=True)
                tmp=path.with_suffix(path.suffix+'.restore-partial')
                tmp.write_bytes(data);tmp.replace(path)
                return priority,len(data),False
            except urllib.error.HTTPError as error:
                if error.code in (401,403) or attempt==2: raise RuntimeError(f'HTTP {error.code} for {url}') from None
            except (OSError,TimeoutError):
                if attempt==2: raise
        raise RuntimeError(url)
    started=time.monotonic();done=0;size=0;reused=0
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        # Priority batches make source availability explicit to sibling reviewers.
        for priority in sorted(set(job[0] for job in jobs)):
            batch=[job for job in jobs if job[0]==priority]
            for result in pool.map(obtain,batch):
                done+=1;size+=result[1];reused+=result[2]
                if done%100==0:print(json.dumps({'verified':done,'planned':len(jobs),'bytes':size,'seconds':round(time.monotonic()-started,1)}),flush=True)
            print(json.dumps({'priorityComplete':priority,'objects':len(batch),'verifiedTotal':done}),flush=True)
    receipt={'schema':'heart-v29-source-restore','verifiedObjects':done,'encodedBytes':size,'reusedObjects':reused,'seconds':time.monotonic()-started,'sourceUnchanged':True,'credentialsRecorded':False}
    out=ROOT/'docs/release-v29';out.mkdir(parents=True,exist_ok=True)
    report_name = 'section-source-restore.json' if args.sections_only else 'exterior-source-restore.json' if args.exterior_only else 'source-restore.json'
    (out/report_name).write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt),flush=True)

if __name__=='__main__':main()
