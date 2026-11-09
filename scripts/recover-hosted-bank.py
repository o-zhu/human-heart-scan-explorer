#!/usr/bin/env python3
"""Recover an exact manifest-bound scan bank for a portable local export.

Site service access is read from hidden stdin and kept in memory. Existing
files are reused only after their size and SHA-256 match the serving index.
Requires httpx[socks]; the exported local viewer itself needs only Python.
"""
import argparse
import concurrent.futures
import hashlib
import json
import pathlib
import re
import sys
import termios
import time
import httpx

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--index',type=pathlib.Path,required=True)
p.add_argument('--asset-root',type=pathlib.Path,required=True)
p.add_argument('--route',required=True)
p.add_argument('--workers',type=int,default=16)
a=p.parse_args()
assert 1<=a.workers<=32
assert re.fullmatch(r'/api/(?:ultra/v4|ultra-volume/v7|donors/(?:s-20-29|s-20-28)/(?:ultra|volume))/',a.route)
index=json.loads(a.index.read_text())
root=a.asset_root.resolve();root.mkdir(parents=True,exist_ok=True)
for name,record in index.items():
    assert re.fullmatch(r'(?:(?:[xyz]/\d{4}|empty)\.webp|\d{2}/\d{2}/\d{2}\.gz)',name)
    assert type(record['bytes']) is int and record['bytes']>0
    assert re.fullmatch(r'[a-f0-9]{64}',record['sha256'])
fd=sys.stdin.fileno();old=termios.tcgetattr(fd);hidden=termios.tcgetattr(fd);hidden[3]&=~termios.ECHO
termios.tcsetattr(fd,termios.TCSANOW,hidden)
print('Ready for Site service access JSON on stdin (input is hidden).',flush=True)
try:access=json.loads(sys.stdin.readline())
finally:termios.tcsetattr(fd,termios.TCSANOW,old)
origin=access['siteUrl'].rstrip('/');bearer=access['bearer']
assert re.fullmatch(r'https://[a-z0-9.-]+\.chatgpt\.site',origin)
assert '\r' not in bearer and '\n' not in bearer
headers={'OAI-Sites-Authorization':'Bearer '+bearer}
started=time.monotonic();total_bytes=0
with httpx.Client(headers=headers,follow_redirects=False,http2=False,
                  limits=httpx.Limits(max_connections=a.workers,max_keepalive_connections=a.workers,keepalive_expiry=60),
                  timeout=httpx.Timeout(90)) as client:
    def recover(name):
        record=index[name];path=root/name
        def valid(data):return len(data)==record['bytes'] and hashlib.sha256(data).hexdigest()==record['sha256']
        if path.exists() and valid(path.read_bytes()):return 0
        for attempt in range(5):
            try:
                reply=client.get(origin+a.route+name)
                if reply.status_code==200:
                    if not valid(reply.content):raise RuntimeError('Source bank checksum mismatch: '+name)
                    path.parent.mkdir(parents=True,exist_ok=True)
                    partial=path.with_suffix(path.suffix+'.partial');partial.write_bytes(reply.content);partial.replace(path)
                    return len(reply.content)
                if reply.status_code not in (408,429,500,502,503,504):
                    raise RuntimeError(f'Source bank refused {name}: HTTP {reply.status_code}')
            except httpx.RequestError:
                if attempt==4:raise RuntimeError('Source bank transport failed for '+name) from None
            if attempt<4:time.sleep(min(2**attempt,8))
        raise RuntimeError('Source bank retries exhausted for '+name)
    with concurrent.futures.ThreadPoolExecutor(max_workers=a.workers) as pool:
        futures=[pool.submit(recover,name) for name in index]
        for count,future in enumerate(concurrent.futures.as_completed(futures),1):
            total_bytes+=future.result()
            if count%200==0 or count==len(index):
                print(json.dumps({'verifiedFiles':count,'of':len(index),'downloadedBytes':total_bytes,'seconds':round(time.monotonic()-started,1)}),flush=True)
print(json.dumps({'verified':True,'objects':len(index),'bytes':sum(x['bytes'] for x in index.values()),'downloadedBytes':total_bytes}),flush=True)
