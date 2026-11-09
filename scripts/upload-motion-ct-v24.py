#!/usr/bin/env python3
"""Seed or verify the new immutable motion CT collection using ordinary HTTPS.

Read one JSON line {siteUrl, uploadToken} from hidden stdin. Credentials are
never put in arguments, files or logs. The public site needs no service bearer.
The dedicated X-Heart-Motion-CT-Upload secret is still mandatory for seeding.
httpx requests never follow redirects and retry at most four times. After
seeding, --verify-read-only verifies every GET hash and the closed upload gate.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import termios
import time
from types import SimpleNamespace
from urllib.parse import urlsplit

import httpx

ROOT = Path(__file__).resolve().parents[1]
API = '/api/motion-ct-v24/'
PUBLIC = '/assets/motion-lab-v24/native-ct/'
MAX_BYTES = 32 * 1024 * 1024
RETRY_STATUS = {408, 429, 500, 502, 503, 504}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def local_assets():
    spec = importlib.util.spec_from_file_location('motion_ct_hosting', ROOT / 'scripts/prepare-motion-hosting-v24.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    expected, _ = module.current_collection()
    index = json.loads((ROOT / 'server/motion-ct-index-v24.json').read_text())
    require(index and index == expected, 'The CT index does not match the complete local collection.')
    digest = hashlib.sha256(json.dumps(index, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return index, module.ASSETS, digest


def read_access():
    previous = None
    if sys.stdin.isatty():
        descriptor = sys.stdin.fileno()
        previous = termios.tcgetattr(descriptor)
        hidden = termios.tcgetattr(descriptor)
        hidden[3] &= ~termios.ECHO
        termios.tcsetattr(descriptor, termios.TCSANOW, hidden)
        print('Ready for hidden motion CT access JSON on stdin.', flush=True)
    try:
        line = sys.stdin.readline(32769)
        require(len(line) <= 32768, 'Invalid motion CT access JSON.')
        access = json.loads(line)
        origin = access['siteUrl'].rstrip('/')
        parts = urlsplit(origin)
        require(isinstance(origin, str) and parts.scheme == 'https' and parts.hostname
                and parts.hostname.endswith('.chatgpt.site') and not parts.username and not parts.password
                and parts.port in (None, 443) and not parts.path and not parts.query and not parts.fragment
                and all(32 <= ord(char) <= 126 for char in origin), 'Invalid motion CT site origin.')
        token = access['uploadToken']
        require(isinstance(token, str) and 32 <= len(token) <= 8192
                and all(33 <= ord(char) <= 126 for char in token), 'Invalid dedicated motion CT upload token.')
        return origin, {'X-Heart-Motion-CT-Upload': token, 'Accept-Encoding': 'identity'}
    except (KeyError, ValueError, TypeError, AttributeError):
        raise RuntimeError('Invalid motion CT access JSON; credentials were not printed.') from None
    finally:
        if previous is not None:
            termios.tcsetattr(descriptor, termios.TCSANOW, previous)


def send(client, origin, method, path, *, data=None, limit=1024 * 1024):
    for attempt in range(4):
        try:
            with client.stream(method, origin + path, content=data) as reply:
                content = bytearray()
                for piece in reply.iter_raw():
                    require(len(content) + len(piece) <= limit, 'The site response exceeded its bounded size.')
                    content.extend(piece)
                result = SimpleNamespace(status=reply.status_code, headers=reply.headers, content=bytes(content))
            if result.status not in RETRY_STATUS or attempt == 3:
                return result
        except (httpx.RequestError, TimeoutError, OSError):
            if attempt == 3:
                raise RuntimeError('The motion CT API could not be reached after four attempts.') from None
        if attempt < 3:
            time.sleep(min(2 ** attempt, 4))


def checkpoint(path, origin, fingerprint, done):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.pending')
    temporary.write_text(json.dumps(dict(siteUrl=origin, indexSha256=fingerprint, uploaded=sorted(done)), indent=2) + '\n')
    temporary.replace(path)


def verify_object(response, name, record):
    require(response.status == 200 and len(response.content) == record['bytes']
            and hashlib.sha256(response.content).hexdigest() == record['sha256']
            and response.headers.get('x-content-sha256') == record['sha256']
            and response.headers.get('content-encoding') is None,
            f'Hosted CT GET verification failed for {name} (HTTP {response.status}).')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--probe', action='store_true', help='Read only the public static pilot manifest.')
    modes.add_argument('--verify-read-only', action='store_true', help='Verify GET checksums, then require PUT 405 and a closed gate.')
    parser.add_argument('--state', type=Path, default=ROOT / '.sites-runtime/motion-ct-upload-v24-state.json')
    args = parser.parse_args()
    if not args.probe:
        index, assets, fingerprint = local_assets()
    origin, headers = read_access()
    with httpx.Client(headers=headers, follow_redirects=False, http2=False,
                      limits=httpx.Limits(max_connections=1, max_keepalive_connections=1, keepalive_expiry=60),
                      timeout=httpx.Timeout(90)) as client:
        if args.probe:
            response = send(client, origin, 'GET', PUBLIC + 'manifest.json')
            require(response.status == 200, f'The public CT manifest is unavailable (HTTP {response.status}).')
            try:
                manifest = json.loads(response.content)
                require(isinstance(manifest.get('frames'), list) and manifest['frames'], 'The public CT manifest has no frames.')
            except (ValueError, AttributeError):
                raise RuntimeError('The public CT manifest is invalid.') from None
            print(json.dumps(dict(verified=True, publicManifest=True, acquiredFrames=len(manifest['frames']))))
            return

        done = set()
        if not args.verify_read_only:
            if args.state.exists():
                saved = json.loads(args.state.read_text())
                require(isinstance(saved, dict), 'The upload checkpoint is invalid.')
                if saved.get('siteUrl') == origin and saved.get('indexSha256') == fingerprint:
                    names = saved.get('uploaded')
                    require(isinstance(names, list) and all(isinstance(name, str) for name in names)
                            and set(names) <= set(index), 'The upload checkpoint has invalid names.')
                    done = set(names)
            for name, record in index.items():
                if name in done:
                    continue
                data = (assets / name).read_bytes()
                require(len(data) == record['bytes'] and hashlib.sha256(data).hexdigest() == record['sha256'],
                        f'The local CT file changed after validation: {name}.')
                response = send(client, origin, 'PUT', API + name, data=data)
                require(response.status in (201, 204), f'{name} was not accepted (HTTP {response.status}).')
                done.add(name)
                checkpoint(args.state, origin, fingerprint, done)
                print(json.dumps(dict(uploaded=len(done), objects=len(index))), flush=True)

        response = send(client, origin, 'GET', API + 'status')
        require(response.status == 200, f'The CT inventory is unavailable (HTTP {response.status}).')
        try:
            inventory = json.loads(response.content)
        except ValueError:
            raise RuntimeError('The CT inventory did not return valid JSON.') from None
        require(isinstance(inventory, dict) and inventory.get('complete') is True
                and inventory.get('expected') == len(index) and inventory.get('verified') == len(index)
                and inventory.get('bytes') == sum(record['bytes'] for record in index.values())
                and inventory.get('missingCount') == 0 and inventory.get('mismatchCount') == 0,
                'The hosted CT inventory does not match the immutable index.')
        # Both routes must retain opaque compressed bytes and the same pinned SHA.
        for name, record in index.items():
            for route in (API, PUBLIC):
                verify_object(send(client, origin, 'GET', route + name, limit=MAX_BYTES), name, record)
        if args.verify_read_only:
            name = next(iter(index))
            response = send(client, origin, 'PUT', API + name, data=(assets / name).read_bytes())
            require(response.status == 405 and inventory.get('uploadsEnabled') is False,
                    'The final motion CT release must reject PUT with 405 and declare uploadsEnabled false.')
        print(json.dumps(dict(verified=True, objects=len(index), bytes=inventory['bytes'],
                              indexSha256=fingerprint, apiAndPublicGETChecksums=True,
                              uploadsEnabled=inventory.get('uploadsEnabled'), readOnlyVerified=args.verify_read_only)), flush=True)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, ValueError):
        error = sys.exception()
        print(str(error) if isinstance(error, RuntimeError) else 'A local motion CT upload operation failed.', file=sys.stderr)
        sys.exit(1)
