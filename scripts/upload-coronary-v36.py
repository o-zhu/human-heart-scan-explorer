#!/usr/bin/env python3
"""Seed or verify the separate immutable coronary derivative collection.

Choose --seed or --final explicitly. Site access JSON {siteUrl, bearer,
uploadToken} arrives only on hidden stdin. The token must be the dedicated
HEART_CORONARY_V36_UPLOAD_TOKEN; it is never included in checkpoints/receipts.
Final mode uploads no data and verifies that the retained token cannot write.
"""
import argparse
import concurrent.futures
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
API = '/api/coronary-v36/'
PUBLIC = '/assets/coronary-v36/'
UPLOAD_HEADER = 'X-Heart-Coronary-Upload'


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


hosting = module('coronary_hosting', 'prepare-coronary-hosting-v36.py')


def verify_reply(reply, name, expected, policy):
    hosting.require(reply.status_code == 200, f'Coronary GET failed (HTTP {reply.status_code}): {name}')
    hosting.require(len(reply.content) == expected['bytes']
                    and hashlib.sha256(reply.content).hexdigest() == expected['sha256'],
                    'Coronary GET byte identity failed: ' + name)
    hosting.require(reply.headers.get('x-content-sha256') == expected['sha256']
                    and reply.headers.get('content-encoding') is None,
                    'Coronary response must contain hash-identified opaque gzip bytes: ' + name)
    hosting.require(reply.headers.get('x-heart-coronary-policy') == policy,
                    'Hosted coronary release policy differs from the reviewed policy.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--seed', action='store_true')
    modes.add_argument('--final', action='store_true')
    parser.add_argument('--workers', type=int, default=3)
    parser.add_argument('--state', type=Path, default=ROOT / '.sites-runtime/coronary-upload-v36-state.json')
    parser.add_argument('--runtime-file', action='append', default=[], help='Additional public-relative JS/CSS to verify in final mode.')
    args = parser.parse_args()
    # Match the existing native uploader's httpx transport dependency, while
    # allowing --help and local staging checks without a network client setup.
    import httpx
    transport = module('coronary_upload_transport', 'upload-native-v20.py')
    hosting.require(1 <= args.workers <= 4, 'Use between one and four bounded upload workers.')
    index, parents, manifests = hosting.load_assets()
    hosting.require(json.loads(hosting.INDEX.read_text()) == index,
                    'Coronary index differs from the verified local manifest assets.')
    policy = 'coronary-v36:read-only' if args.final else 'coronary-v36:seed'
    hosting.require(hosting.release_policy() == policy, 'The selected upload mode differs from the local release policy.')
    fingerprint = hashlib.sha256(json.dumps(index, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    origin, headers = transport.read_access()
    # Reuse only the credential transport; its native-bank header is removed
    # before any request and is never sent to this or any historical collection.
    upload_token = headers.pop('X-Heart-Native-Upload')
    done = set()
    if args.seed and args.state.exists():
        old = json.loads(args.state.read_text())
        if old.get('siteUrl') == origin and old.get('indexSha256') == fingerprint:
            values = old.get('uploaded', [])
            hosting.require(isinstance(values, list) and all(isinstance(n, str) for n in values),
                            'Coronary upload checkpoint is invalid.')
            done = set(values) & set(index)
    started = time.monotonic()
    with httpx.Client(headers=headers, follow_redirects=False, http2=False,
                      limits=httpx.Limits(max_connections=args.workers, max_keepalive_connections=args.workers),
                      timeout=httpx.Timeout(90)) as client:
        before = transport.send(client, origin, 'GET', API + 'status')
        status = transport.json_response(before, 'Coronary inventory')
        hosting.require(before.headers.get('x-heart-coronary-policy') == policy,
                        'Hosted coronary release policy does not match the selected mode.')
        hosting.require(status.get('uploadsEnabled') is args.seed and status.get('expected') == len(index),
                        'Hosted coronary upload gate or index differs from the selected mode.')
        if args.seed:
            closed = transport.send(client, origin, 'GET', PUBLIC + next(iter(index)), limit=1024 ** 2)
            hosting.require(closed.status_code == 503 and closed.headers.get('x-heart-coronary-policy') == policy,
                            'Seed release must not publicly serve coronary binary objects.')
            client.headers[UPLOAD_HEADER] = upload_token

            def upload(name):
                data = (hosting.ASSETS / name).read_bytes()
                entry = index[name]
                hosting.require(len(data) == entry['bytes'] and hashlib.sha256(data).hexdigest() == entry['sha256'],
                                'Coronary file changed after verification: ' + name)
                reply = transport.send(client, origin, 'PUT', API + name, data=data)
                hosting.require(reply.status_code in (201, 204),
                                f'Coronary upload failed (HTTP {reply.status_code}): {name}')
                hosting.require(reply.headers.get('x-heart-coronary-policy') == policy,
                                'Coronary upload reached an unexpected release policy.')
                return name

            with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
                for name in pool.map(upload, [n for n in index if n not in done]):
                    done.add(name)
                    transport.checkpoint(args.state, origin, fingerprint, done)
                    print(json.dumps({'uploaded': len(done), 'total': len(index)}), flush=True)
            del client.headers[UPLOAD_HEADER]

        status_reply = transport.send(client, origin, 'GET', API + 'status')
        status = transport.json_response(status_reply, 'Coronary inventory')
        hosting.require(status.get('complete') is True and status.get('expected') == len(index)
                        and status.get('verified') == len(index)
                        and status.get('bytes') == sum(item['bytes'] for item in index.values())
                        and status.get('missingCount') == 0 and status.get('mismatchCount') == 0
                        and status.get('uploadsEnabled') is args.seed,
                        'Hosted coronary inventory does not match the complete indexed collection.')

        def readback(name):
            route = (PUBLIC if args.final else API) + name
            reply = transport.send(client, origin, 'GET', route, limit=hosting.MAX_BYTES)
            verify_reply(reply, name, index[name], policy)
            return {'path': route, 'bytes': index[name]['bytes'], 'sha256': index[name]['sha256']}

        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
            checks = list(pool.map(readback, index))
        kept, write_checks = [], []
        if args.final:
            kept = ['assets/coronary-v36/' + path.name for path in manifests]
            kept += hosting.runtime_files(args.runtime_file)
            for name in kept:
                expected = (ROOT / 'public' / name).read_bytes()
                reply = transport.send(client, origin, 'GET', '/' + name, limit=max(2 * 1024 ** 2, len(expected)))
                hosting.require(reply.status_code == 200 and reply.content == expected,
                                'Hosted coronary manifest/runtime differs from reviewed source: ' + name)
            client.headers[UPLOAD_HEADER] = upload_token
            for route in (API + next(iter(index)), API + 'unlisted.raw.gz', PUBLIC + next(iter(index))):
                for method in ('PUT', 'POST', 'PATCH', 'DELETE'):
                    reply = transport.send(client, origin, method, route, data=b'')
                    hosting.require(reply.status_code == 405, 'Final coronary bank accepted a write method.')
                    hosting.require(reply.headers.get('x-heart-coronary-policy') == policy,
                                    'Write rejection came from an unexpected release policy.')
                    write_checks.append({'path': route, 'method': method, 'status': 405})
            del client.headers[UPLOAD_HEADER]

    report = {
        'verified': True, 'indexSha256': fingerprint, 'objects': len(index), 'bytes': status['bytes'],
        'releasePolicy': policy, 'finalPublicReadback': args.final,
        'GETChecksums': f'{len(checks)}/{len(index)} matched', 'checks': checks,
        'activeStaticFilesChecked': kept, 'uploadsEnabled': status['uploadsEnabled'],
        'multipartParentCount': len(parents), 'writeRejections': write_checks,
        'seconds': time.monotonic() - started, 'sourceBanksChanged': False,
    }
    out = ROOT / 'docs/release-v36'
    out.mkdir(parents=True, exist_ok=True)
    (out / ('coronary-final-readback.json' if args.final else 'coronary-seed-readback.json')).write_text(
        json.dumps(report, indent=2) + '\n')
    print(json.dumps({key: value for key, value in report.items() if key not in {'checks', 'writeRejections'}}), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Do not expose credential input, request headers or response bodies.
        print('Coronary delivery validation failed; credentials were not printed.', file=sys.stderr)
        sys.exit(1)
