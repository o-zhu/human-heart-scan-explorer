#!/usr/bin/env python3
"""Seed the manifest-bound native surface files on this Site.

Access JSON {siteUrl, bearer, uploadToken} arrives on hidden stdin and is never
written to disk or printed. Requests are sequential, bounded to four attempts,
and never follow redirects. Requires httpx (httpx[socks] for a SOCKS proxy).
Use --probe for only a manifest GET; --verify-read-only uploads no new files
and requires every indexed GET checksum, a complete read-only status, and PUT
405. The five base surfaces are required; bilateral is the only optional file.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import termios
import time
from types import SimpleNamespace
from urllib.parse import urlsplit

import httpx

ROOT = Path(__file__).resolve().parents[1]
API = '/api/native-surface-v20/'
BASE_NAMES = ('overview.hfm.gz', 'native.hfm.gz', 'normals.hfm.gz',
              'gentle.hfm.gz', 'moderate.hfm.gz')
NAMES = BASE_NAMES + ('bilateral.hfm.gz',)
MAX_BYTES = 32 * 1024 * 1024
JSON_LIMIT = 1024 * 1024
RETRY_STATUS = {408, 429, 500, 502, 503, 504}


def read_json(path, description):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        raise RuntimeError(f'{description} could not be read.') from None


def sha_file(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for piece in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(piece)
    return digest.hexdigest()


def validate_assets(index_path, asset_root):
    index = read_json(index_path, 'The native surface index')
    if (not isinstance(index, dict) or not set(BASE_NAMES) <= set(index)
            or not set(index) <= set(NAMES)):
        raise RuntimeError('The index must contain the five base surfaces and only optional bilateral.')
    root = asset_root.resolve()
    for name in index:
        meta = index[name]
        if (not isinstance(meta, dict)
                or type(meta.get('bytes')) is not int
                or not 0 < meta['bytes'] <= MAX_BYTES
                or not isinstance(meta.get('sha256'), str)
                or not re.fullmatch(r'[a-f0-9]{64}', meta['sha256'])
                or meta.get('contentType') not in ('application/octet-stream', 'application/gzip')):
            raise RuntimeError(f'Invalid index metadata for {name}.')
        source = (root / name).resolve()
        if source.parent != root or not source.is_file():
            raise RuntimeError(f'The local indexed file {name} is unavailable.')
        if source.stat().st_size != meta['bytes'] or sha_file(source) != meta['sha256']:
            raise RuntimeError(f'The local size or checksum does not match for {name}.')
    fingerprint = hashlib.sha256(json.dumps(index, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return index, root, fingerprint


def read_access():
    previous = None
    if sys.stdin.isatty():
        fd = sys.stdin.fileno()
        previous = termios.tcgetattr(fd)
        hidden = termios.tcgetattr(fd)
        hidden[3] &= ~termios.ECHO
        termios.tcsetattr(fd, termios.TCSANOW, hidden)
    print('Ready for Site service access JSON on stdin (input is hidden).', flush=True)
    try:
        line = sys.stdin.readline(32769)
        if len(line) > 32768:
            raise ValueError('oversized input')
        access = json.loads(line)
        origin = access['siteUrl'].rstrip('/')
        parts = urlsplit(origin)
        if (any(ord(char) < 32 or ord(char) > 126 for char in origin)
                or parts.scheme != 'https' or not parts.hostname
                or not parts.hostname.endswith('.chatgpt.site')
                or parts.username or parts.password or parts.port not in (None, 443)
                or parts.path or parts.query or parts.fragment):
            raise ValueError('invalid origin')
        bearer, upload_token = access['bearer'], access['uploadToken']
        for value in (bearer, upload_token):
            if (not isinstance(value, str) or not value
                    or any(ord(char) < 32 or ord(char) > 126 for char in value)):
                raise ValueError('invalid credential')
        if len(upload_token) < 32:
            raise ValueError('invalid upload token')
        return origin, {
            'OAI-Sites-Authorization': 'Bearer ' + bearer,
            'X-Heart-Native-Upload': upload_token,
            'Accept-Encoding': 'identity',
        }
    except (ValueError, KeyError, TypeError, AttributeError):
        raise RuntimeError('Invalid Site access JSON; credentials were not printed.') from None
    finally:
        if previous is not None:
            termios.tcsetattr(fd, termios.TCSANOW, previous)


def send(client, origin, method, path, *, data=None, limit=JSON_LIMIT):
    for attempt in range(4):
        try:
            with client.stream(method, origin + path, content=data) as reply:
                content = bytearray()
                for piece in reply.iter_raw():
                    if len(content) + len(piece) > limit:
                        raise RuntimeError('The Site response exceeded its bounded size.')
                    content.extend(piece)
                result = SimpleNamespace(status_code=reply.status_code,
                                         headers=reply.headers, content=bytes(content))
            if result.status_code not in RETRY_STATUS or attempt == 3:
                return result
        except (httpx.RequestError, TimeoutError, OSError):
            if attempt == 3:
                raise RuntimeError('The Site API could not be reached after four attempts.') from None
        if attempt < 3:
            time.sleep(min(2 ** attempt, 4))


def json_response(response, description):
    if response.status_code != 200:
        raise RuntimeError(f'{description} unavailable (HTTP {response.status_code}).')
    try:
        return json.loads(response.content)
    except ValueError:
        raise RuntimeError(f'{description} did not return valid JSON.') from None


def checkpoint(path, origin, fingerprint, done):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps({'siteUrl': origin, 'indexSha256': fingerprint,
                                     'uploaded': sorted(done)}, indent=2) + '\n')
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--index', type=Path, default=ROOT / 'server/native-surface-index-v20.json')
    parser.add_argument('--asset-root', type=Path, default=ROOT / 'public/assets/native-surface-v20')
    parser.add_argument('--state', type=Path, default=ROOT / '.sites-runtime/native-upload-v20-state.json')
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--probe', action='store_true')
    modes.add_argument('--verify-read-only', action='store_true')
    args = parser.parse_args()
    if not args.probe:
        index, root, fingerprint = validate_assets(args.index, args.asset_root)
        names = tuple(name for name in NAMES if name in index)
    origin, headers = read_access()
    with httpx.Client(headers=headers, follow_redirects=False, http2=False,
                      limits=httpx.Limits(max_connections=1, max_keepalive_connections=1,
                                          keepalive_expiry=60),
                      timeout=httpx.Timeout(90)) as client:
        if args.probe:
            result = send(client, origin, 'GET', '/assets/manifest.json')
            valid = result.status_code == 200 and 'json' in result.headers.get('content-type', '')
            if valid:
                json_response(result, 'The Site manifest')
            print(json.dumps({'status': result.status_code, 'bytes': len(result.content),
                              'json': valid}), flush=True)
            return 0 if valid else 1

        done = set()
        if not args.verify_read_only:
            if args.state.exists():
                saved = read_json(args.state, 'The upload checkpoint')
                if not isinstance(saved, dict):
                    raise RuntimeError('The upload checkpoint is invalid.')
                if saved.get('siteUrl') == origin and saved.get('indexSha256') == fingerprint:
                    uploaded = saved.get('uploaded')
                    if (not isinstance(uploaded, list) or not all(isinstance(name, str) for name in uploaded)
                            or not set(uploaded) <= set(names)):
                        raise RuntimeError('The upload checkpoint names are invalid.')
                    done = set(uploaded)
            started = time.monotonic()
            for name in names:
                if name in done:
                    continue
                data = (root / name).read_bytes()
                # Recheck immediately before PUT in case a local reconstruction changed.
                if len(data) != index[name]['bytes'] or hashlib.sha256(data).hexdigest() != index[name]['sha256']:
                    raise RuntimeError(f'The local file changed after validation: {name}.')
                result = send(client, origin, 'PUT', API + name, data=data)
                if result.status_code not in (201, 204):
                    raise RuntimeError(f'{name} was not accepted (HTTP {result.status_code}).')
                done.add(name)
                checkpoint(args.state, origin, fingerprint, done)
                print(json.dumps({'uploaded': len(done), 'of': len(names),
                                  'elapsedSeconds': round(time.monotonic() - started, 1)}), flush=True)

        inventory = json_response(send(client, origin, 'GET', API + 'status'), 'Native storage inventory')
        if (not isinstance(inventory, dict) or inventory.get('complete') is not True
                or inventory.get('expected') != len(names) or inventory.get('verified') != len(names)
                or inventory.get('bytes') != sum(meta['bytes'] for meta in index.values())
                or inventory.get('missingCount') != 0 or inventory.get('mismatchCount') != 0):
            raise RuntimeError('Native storage inventory does not match the indexed collection.')
        for name in names:
            result = send(client, origin, 'GET', API + name, limit=MAX_BYTES)
            if (result.status_code != 200 or len(result.content) != index[name]['bytes']
                    or hashlib.sha256(result.content).hexdigest() != index[name]['sha256']):
                raise RuntimeError(f'Hosted GET verification failed for {name} (HTTP {result.status_code}).')
        if args.verify_read_only:
            result = send(client, origin, 'PUT', API + names[0], data=(root / names[0]).read_bytes())
            if result.status_code != 405:
                raise RuntimeError(f'Final native API must reject uploads with HTTP 405; received {result.status_code}.')
            if inventory.get('uploadsEnabled') is not False:
                raise RuntimeError('Final native storage inventory must declare uploadsEnabled false.')
        print(json.dumps({'verified': True, 'objects': len(names),
                          'bytes': inventory['bytes'], 'indexSha256': fingerprint,
                          'GETChecksums': f'{len(names)}/{len(names)} matched', 'uploadsEnabled': inventory.get('uploadsEnabled'),
                          'readOnlyVerified': args.verify_read_only}), flush=True)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (RuntimeError, OSError):
        # Deliberately omit traceback/context: neither credentials nor response
        # bodies should appear in failed uploader logs.
        error = sys.exception()
        print(str(error) if isinstance(error, RuntimeError) else 'A local upload file operation failed.', file=sys.stderr)
        sys.exit(1)
