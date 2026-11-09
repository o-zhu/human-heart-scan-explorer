#!/usr/bin/env python3
"""Resume the manifest-bound v23 surface upload using hidden stdin credentials.

This new collection contains exact v19 originals and v23 transport parts. Old
collections stay read-only. Each successful object has a durable local receipt.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import time

import httpx

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('native_upload_transport', ROOT / 'scripts/upload-native-v20.py')
transport = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transport)
spec2 = importlib.util.spec_from_file_location('fine_hosting', ROOT / 'scripts/prepare-fine-hosting-v23.py')
hosting = importlib.util.module_from_spec(spec2)
spec2.loader.exec_module(hosting)
API = '/api/fine-detail-v23/'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify-read-only', action='store_true')
    parser.add_argument('--state', type=Path, default=ROOT / '.sites-runtime/fine-upload-v23-state.json')
    args = parser.parse_args()
    index = json.loads(hosting.INDEX.read_text())
    if not index:
        raise RuntimeError('The fine-detail index is empty.')
    for name, entry in index.items():
        source = hosting.safe_path(name, hosting.ASSETS)
        if (type(entry.get('bytes')) is not int or not 0 < entry['bytes'] <= 32 * 1024 * 1024
                or source.stat().st_size != entry['bytes'] or hosting.sha(source) != entry['sha256']):
            raise RuntimeError('A local fine-detail object does not match the index.')
    fingerprint = hashlib.sha256(json.dumps(index, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    origin, headers = transport.read_access()
    headers['X-Heart-Fine-Upload'] = headers.pop('X-Heart-Native-Upload')
    done = set()
    if args.state.exists():
        old = json.loads(args.state.read_text())
        if old.get('siteUrl') == origin and old.get('indexSha256') == fingerprint:
            done = set(old.get('uploaded', [])) & set(index)
    with httpx.Client(headers=headers, follow_redirects=False, http2=False,
                      limits=httpx.Limits(max_connections=1, max_keepalive_connections=1, keepalive_expiry=60),
                      timeout=httpx.Timeout(90)) as client:
        started = time.monotonic()
        if not args.verify_read_only:
            for name, entry in index.items():
                if name in done:
                    continue
                data = hosting.safe_path(name, hosting.ASSETS).read_bytes()
                if len(data) != entry['bytes'] or hashlib.sha256(data).hexdigest() != entry['sha256']:
                    raise RuntimeError('A fine-detail file changed after validation.')
                result = transport.send(client, origin, 'PUT', API + name, data=data)
                if result.status_code not in (201, 204):
                    raise RuntimeError(f'Fine-detail upload failed (HTTP {result.status_code}).')
                done.add(name)
                transport.checkpoint(args.state, origin, fingerprint, done)
                print(json.dumps(dict(uploaded=len(done), total=len(index), name=name,
                                      elapsedSeconds=round(time.monotonic() - started, 1))), flush=True)
        inventory = transport.json_response(transport.send(client, origin, 'GET', API + 'status'), 'Fine-detail inventory')
        if (inventory.get('complete') is not True or inventory.get('expected') != len(index)
                or inventory.get('verified') != len(index) or inventory.get('bytes') != sum(e['bytes'] for e in index.values())
                or inventory.get('missingCount') != 0 or inventory.get('mismatchCount') != 0):
            raise RuntimeError('The hosted fine-detail inventory does not match.')
        for name, entry in index.items():
            route = '/assets/' if args.verify_read_only else API
            response = transport.send(client, origin, 'GET', route + name, limit=32 * 1024 * 1024)
            if (response.status_code != 200 or len(response.content) != entry['bytes']
                    or hashlib.sha256(response.content).hexdigest() != entry['sha256']):
                raise RuntimeError(f'Fine-detail readback failed (HTTP {response.status_code}).')
        if args.verify_read_only:
            response = transport.send(client, origin, 'PUT', API + next(iter(index)), data=b'')
            if response.status_code != 405 or inventory.get('uploadsEnabled') is not False:
                raise RuntimeError('The final fine-detail collection is not read-only.')
        report = dict(verified=True, indexSha256=fingerprint, objects=len(index), bytes=inventory['bytes'],
                      readOnlyVerified=args.verify_read_only, GETChecksums=f'{len(index)}/{len(index)} matched')
        report_path = ROOT / '.sites-runtime/fine-upload-v23-verification.json'
        report_path.write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(report), flush=True)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, ValueError, AssertionError, KeyError):
        error = sys.exception()
        print(str(error) if isinstance(error, RuntimeError) else 'Fine-detail upload validation failed; credentials were not printed.', file=sys.stderr)
        sys.exit(1)
