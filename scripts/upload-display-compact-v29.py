#!/usr/bin/env python3
"""Seed and read back a new bounded, immutable display-only collection.

Source-bank routes and source files are not changed. Credentials arrive on
hidden stdin, remain in memory, and are excluded from all durable receipts.
"""
import argparse, concurrent.futures, hashlib, importlib.util, json, re, sys, time
from pathlib import Path
import httpx

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('native_upload_transport',ROOT/'scripts/upload-native-v20.py')
transport = importlib.util.module_from_spec(spec); spec.loader.exec_module(transport)
API = '/api/display-compact-v29/'

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--mesh-root',type=Path,required=True)
    p.add_argument('--section-root',type=Path,required=True)
    p.add_argument('--cleanup-root',type=Path,default=ROOT/'public/assets/cleanup-v29')
    p.add_argument('--workers',type=int,default=4)
    p.add_argument('--verify-read-only',action='store_true')
    p.add_argument('--state',type=Path,default=ROOT/'.sites-runtime/compact-upload-v29-state.json')
    args=p.parse_args(); assert 1<=args.workers<=8
    index=json.loads((ROOT/'server/display-compact-index-v29.json').read_text())
    assert index and any(k.startswith('mesh/') for k in index) and any(k.startswith('sections/') for k in index)
    paths={}
    for name,item in index.items():
        assert re.fullmatch(r'(?:(?:sections|surface|mesh)-manifest\.json|mesh/[a-z0-9_.-]+\.gz|sections/(?:[xyz]/[0-9]+|empty)\.webp|cleanup/[a-z0-9-]+\.(?:hfm|sfr|bits|raw)\.gz)',name),name
        if name in ('sections-manifest.json','mesh-manifest.json','surface-manifest.json'):
            root=ROOT/'public/assets/display-compact-v29';relative=name
        else:
            group,relative=name.split('/',1)
            root={'mesh':args.mesh_root,'sections':args.section_root,'cleanup':args.cleanup_root}[group]
        path=root/relative
        assert root.resolve() in path.resolve().parents and not path.is_symlink()
        assert 0<item['bytes']<=8*1024**2 and path.stat().st_size==item['bytes'] and transport.sha_file(path)==item['sha256'],name
        paths[name]=path
    fingerprint=hashlib.sha256(json.dumps(index,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    origin,headers=transport.read_access()
    headers['X-Heart-Compact-Upload']=headers.pop('X-Heart-Native-Upload')
    done=set()
    if args.state.exists():
        old=json.loads(args.state.read_text())
        if old.get('siteUrl')==origin and old.get('indexSha256')==fingerprint:done=set(old.get('uploaded',[]))&set(index)
    started=time.monotonic()
    with httpx.Client(headers=headers,follow_redirects=False,http2=False,
                     limits=httpx.Limits(max_connections=args.workers,max_keepalive_connections=args.workers,keepalive_expiry=60),
                     timeout=httpx.Timeout(90)) as client:
        def upload(name):
            data=paths[name].read_bytes();item=index[name]
            assert len(data)==item['bytes'] and hashlib.sha256(data).hexdigest()==item['sha256']
            result=transport.send(client,origin,'PUT',API+name,data=data)
            if result.status_code not in (201,204):raise RuntimeError(f'Compact display upload failed (HTTP {result.status_code}): {name}')
            return name
        if not args.verify_read_only:
            with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
                for name in pool.map(upload,[n for n in index if n not in done]):
                    done.add(name);transport.checkpoint(args.state,origin,fingerprint,done)
                    if len(done)%50==0:print(json.dumps({'uploaded':len(done),'total':len(index),'seconds':round(time.monotonic()-started,1)}),flush=True)
        inventory=transport.json_response(transport.send(client,origin,'GET',API+'status'),'Compact display inventory')
        assert inventory['complete'] and inventory['expected']==len(index) and inventory['verified']==len(index) and inventory['bytes']==sum(i['bytes'] for i in index.values())
        checks=[]
        def readback(name):
            item=index[name];reply=transport.send(client,origin,'GET',API+name,limit=8*1024**2)
            if reply.status_code!=200 or len(reply.content)!=item['bytes'] or hashlib.sha256(reply.content).hexdigest()!=item['sha256']:
                raise RuntimeError('Compact display readback failed: '+name)
            return name
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
            for name in pool.map(readback,index):
                checks.append(name)
                if len(checks)%100==0:print(json.dumps({'readbackVerified':len(checks),'total':len(index),'seconds':round(time.monotonic()-started,1)}),flush=True)
        if args.verify_read_only:
            denied=transport.send(client,origin,'PUT',API+next(iter(index)),data=b'')
            assert denied.status_code==405 and inventory['uploadsEnabled'] is False
        report={'verified':True,'indexSha256':fingerprint,'objects':len(index),'bytes':inventory['bytes'],'readOnlyVerified':args.verify_read_only,'GETChecksums':f'{len(checks)}/{len(index)} matched','seconds':time.monotonic()-started,'sourceBanksChanged':False}
        out=ROOT/'docs/release-v29';out.mkdir(parents=True,exist_ok=True)
        (out/('compact-final-readback.json' if args.verify_read_only else 'compact-seed-readback.json')).write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps(report),flush=True)

if __name__=='__main__':
    try:main()
    except (RuntimeError,OSError,ValueError,AssertionError,KeyError):
        error=sys.exception()
        print(str(error) if isinstance(error,RuntimeError) else 'Compact display validation failed; credentials were not printed.',file=sys.stderr)
        sys.exit(1)
