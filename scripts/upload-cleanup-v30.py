#!/usr/bin/env python3
"""Seed/read back only the new immutable reconstruction collection.

Access JSON arrives on hidden stdin. It is never included in durable receipts.
Final mode checks public bytes, active runtime files and the closed upload gate.
"""
import argparse
import concurrent.futures
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
import time
import httpx

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('native_upload_transport', ROOT / 'scripts/upload-native-v20.py')
transport = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transport)
API = '/api/cleanup-v30/'


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--final', action='store_true')
    p.add_argument('--workers', type=int, default=3)
    p.add_argument('--state', type=Path, default=ROOT / '.sites-runtime/cleanup-upload-v30-state.json')
    args = p.parse_args()
    assert 1 <= args.workers <= 4
    index = json.loads((ROOT / 'server/cleanup-index-v30.json').read_text())
    assert index
    paths = {}
    for name, item in index.items():
        assert re.fullmatch(r'[a-z0-9-]+\.(?:hfm|sfr|bits|raw)(?:\.part-[0-9]{3})?\.gz', name), name
        path = ROOT / 'public/assets/cleanup-v30' / name
        assert not path.is_symlink() and 0 < item['bytes'] <= 8 * 1024 ** 2
        assert path.stat().st_size == item['bytes'] and transport.sha_file(path) == item['sha256'], name
        paths[name] = path
    fingerprint = hashlib.sha256(json.dumps(index, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    origin, headers = transport.read_access()
    upload_token = headers.pop('X-Heart-Native-Upload')
    done = set()
    if args.state.exists():
        old = json.loads(args.state.read_text())
        if old.get('siteUrl') == origin and old.get('indexSha256') == fingerprint:
            done = set(old.get('uploaded', [])) & set(index)
    started = time.monotonic()
    with httpx.Client(headers=headers, follow_redirects=False, http2=False,
                      limits=httpx.Limits(max_connections=args.workers, max_keepalive_connections=args.workers),
                      timeout=httpx.Timeout(90)) as client:
        if not args.final:
            client.headers['X-Heart-Cleanup-Upload'] = upload_token

            def upload(name):
                data = paths[name].read_bytes()
                reply = transport.send(client, origin, 'PUT', API + name, data=data)
                if reply.status_code not in (201, 204):
                    raise RuntimeError(f'Reconstruction upload failed (HTTP {reply.status_code}): {name}')
                return name

            with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
                for name in pool.map(upload, [n for n in index if n not in done]):
                    done.add(name)
                    transport.checkpoint(args.state, origin, fingerprint, done)
                    print(json.dumps({'uploaded': len(done), 'total': len(index)}), flush=True)
            del client.headers['X-Heart-Cleanup-Upload']
        status = transport.json_response(transport.send(client, origin, 'GET', API + 'status'), 'Reconstruction inventory')
        assert status['complete'] and status['expected'] == len(index) and status['verified'] == len(index)
        assert status['bytes'] == sum(i['bytes'] for i in index.values())
        assert status['uploadsEnabled'] is (not args.final)

        def readback(name):
            route = ('/assets/cleanup-v30/' if args.final else API) + name
            reply = transport.send(client, origin, 'GET', route, limit=8 * 1024 ** 2)
            item = index[name]
            assert reply.status_code == 200, (route, reply.status_code)
            assert len(reply.content) == item['bytes'] and hashlib.sha256(reply.content).hexdigest() == item['sha256'], route
            assert reply.headers.get('x-content-sha256') == item['sha256'] and reply.headers.get('content-encoding') is None
            assert reply.headers.get('x-heart-cleanup-policy') == ('cleanup-v30:read-only' if args.final else 'cleanup-v30:seed')
            return {'path': route, 'bytes': item['bytes'], 'sha256': item['sha256']}

        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
            checks = list(pool.map(readback, index))
        static = []
        if args.final:
            static = ['app.js', 'clinical-app.js', 'workbench.css', 'section-names.js', 'volume-picking.js',
                      'fine-surface.js', 'refinement.css',
                      'local-surface-refinement.js', 'lumen-cleanup-v23.js',
                      'assets/cleanup-v30/surface-manifest.json', 'assets/cleanup-v30/lumen-manifest.json']
            for name in static:
                expected = (ROOT / 'public' / name).read_bytes()
                reply = transport.send(client, origin, 'GET', '/' + name, limit=2 * 1024 ** 2)
                assert reply.status_code == 200 and reply.content == expected, name
            reply = client.put(origin + API + next(iter(index)), content=b'',
                               headers={'X-Heart-Cleanup-Upload': upload_token})
            assert reply.status_code == 405
        report = {'verified': True, 'indexSha256': fingerprint, 'objects': len(index), 'bytes': status['bytes'],
                  'finalPublicReadback': args.final, 'GETChecksums': f'{len(checks)}/{len(index)} matched',
                  'checks': checks, 'activeStaticFilesChecked': static, 'uploadsEnabled': status['uploadsEnabled'],
                  'seconds': time.monotonic() - started, 'sourceBanksChanged': False}
        if args.final:
            report['retainedTokenWriteStatus'] = 405
        out = ROOT / 'docs/release-v30'
        out.mkdir(parents=True, exist_ok=True)
        (out / ('cleanup-final-readback.json' if args.final else 'cleanup-seed-readback.json')).write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps({k: v for k, v in report.items() if k != 'checks'}), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Reconstruction delivery validation failed; credentials were not printed.', file=sys.stderr)
        sys.exit(1)
