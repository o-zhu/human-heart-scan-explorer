#!/usr/bin/env python3
"""Restore explicitly permitted, checksummed Heart Explorer assets.

Python 3.9+, standard library only. This is a read-only network client: it sends
no credentials and never uploads. See docs/open-source/assets.md for the
release's license boundaries and optional datasets.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import http.client
import ipaddress
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = 'docs/open-source/asset-manifest.json'
DEFAULT_BASE_URL = 'https://human-heart-scan-explorer.zhuou557737.chatgpt.site'
SHA256 = re.compile(r'^[0-9a-f]{64}$')
GROUPS = ('runtime', 'fine-data')
CHUNK = 1024 * 1024
WINDOWS_RESERVED = {'CON', 'PRN', 'AUX', 'NUL', *('COM'+str(i) for i in range(1, 10)), *('LPT'+str(i) for i in range(1, 10))}


class AssetError(ValueError):
    """Invalid release metadata, unsafe destination, or failed integrity."""


def relative_path(value):
    """Reject unsafe paths rather than silently normalizing them away."""
    if not isinstance(value, str) or not value or value.startswith('/') or '\\' in value or ':' in value or '%' in value:
        raise AssetError('Invalid relative asset path')
    parts = value.split('/')
    if any(not part or part in ('.', '..') or part.startswith('.') or
           part.endswith(('.', ' ')) or part.split('.')[0].upper() in WINDOWS_RESERVED or
           any(ord(c) < 32 or ord(c) == 127 or c in '*?<>|"' for c in part) for part in parts):
        raise AssetError('Unsafe or nonportable asset path')
    return value


def validate_destination(value):
    relative_path(value)
    if not (value.startswith('public/assets/') or value.startswith('data/')):
        raise AssetError('Asset destinations must be beneath public/assets/ or data/')
    return value


def checked_path(root, relative, *, create_parents=False):
    """Every existing component below the selected root must be nonsymlink."""
    validate_destination(relative)
    root = Path(root).absolute()
    if root.is_symlink() or not root.is_dir():
        raise AssetError('The asset root must be an existing nonsymlink directory')
    current = root
    parts = relative.split('/')
    for index, part in enumerate(parts):
        current = current / part
        if current.is_symlink():
            raise AssetError('Symlink in asset destination: '+relative)
        if index < len(parts)-1:
            if current.exists() and not current.is_dir():
                raise AssetError('Non-directory in asset destination: '+relative)
            if create_parents:
                current.mkdir(exist_ok=True)
                if current.is_symlink():
                    raise AssetError('Symlink in asset destination: '+relative)
        elif current.exists() and not current.is_file():
            raise AssetError('Asset destination is not a regular file: '+relative)
    current.resolve(strict=False).relative_to(root.resolve())
    return current


def base_url(value):
    if not isinstance(value, str):
        raise AssetError('Invalid asset base URL')
    parsed = urlsplit(value)
    if not parsed.hostname or parsed.username is not None or parsed.password is not None or parsed.query or parsed.fragment or '\\' in value:
        raise AssetError('Asset base URL must omit credentials, queries and fragments')
    loopback = parsed.hostname.lower() == 'localhost'
    try:
        loopback = loopback or ipaddress.ip_address(parsed.hostname).is_loopback
    except ValueError:
        pass
    if parsed.scheme != 'https' and not (parsed.scheme == 'http' and loopback):
        raise AssetError('Use HTTPS; plain HTTP is allowed only for loopback testing')
    # Trigger validation of malformed/out-of-range ports.
    try:
        parsed.port
    except ValueError as exc:
        raise AssetError('Invalid asset base URL port') from exc
    if parsed.path and parsed.path != '/':
        relative_path(parsed.path.strip('/'))
    return value.rstrip('/')


def asset_url(base, source):
    if not isinstance(source, str) or not source.startswith('/') or source.startswith('//'):
        raise AssetError('Asset URL must be an absolute path on the selected base URL')
    relative_path(source[1:])
    return base_url(base)+'/'+quote(source[1:], safe='/._-')


def load_manifest(path):
    raw = json.loads(Path(path).read_text(encoding='utf-8'))
    if not isinstance(raw, dict) or raw.get('schemaVersion') != 1 or not isinstance(raw.get('assets'), list):
        raise AssetError('Expected asset manifest schemaVersion 1 with an assets array')
    seen = set()
    for entry in raw['assets']:
        if not isinstance(entry, dict):
            raise AssetError('Invalid asset manifest entry')
        path = validate_destination(entry.get('path'))
        identity = path.casefold()
        if identity in seen:
            raise AssetError('Duplicate or case-colliding asset destination: '+path)
        seen.add(identity)
        if entry.get('group') not in GROUPS or entry.get('redistribution') not in ('permitted', 'excluded'):
            raise AssetError('Asset must have an explicit group and redistribution decision: '+path)
        if entry['redistribution'] == 'permitted':
            if type(entry.get('bytes')) is not int or entry['bytes'] < 1 or not SHA256.fullmatch(entry.get('sha256', '')):
                raise AssetError('Permitted asset needs positive bytes and a SHA-256: '+path)
            if not isinstance(entry.get('license'), str) or not entry['license'].strip():
                raise AssetError('Permitted asset needs an explicit license: '+path)
            asset_url(DEFAULT_BASE_URL, entry.get('url'))
    base_url(raw.get('assetBaseUrl', DEFAULT_BASE_URL))
    return raw


def file_matches(path, entry):
    if not path.exists():
        return False
    if path.is_symlink():
        raise AssetError('Refusing symlink asset: '+entry['path'])
    flags = os.O_RDONLY | getattr(os, 'O_BINARY', 0) | getattr(os, 'O_NOFOLLOW', 0)
    descriptor = os.open(path, flags)
    with os.fdopen(descriptor, 'rb') as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size != entry['bytes']:
            return False
        digest = hashlib.sha256()
        for chunk in iter(lambda: stream.read(CHUNK), b''):
            digest.update(chunk)
        after = os.fstat(stream.fileno())
    final = path.lstat()
    if (before.st_size, before.st_mtime_ns, before.st_ino, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ino, after.st_ctime_ns) or (final.st_ino, final.st_mode, final.st_size, final.st_mtime_ns) != (after.st_ino, after.st_mode, after.st_size, after.st_mtime_ns):
        raise AssetError('Asset changed during verification: '+entry['path'])
    return digest.hexdigest() == entry['sha256']


class SameOriginRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        old, new = urlsplit(request.full_url), urlsplit(new_url)
        if (old.scheme, old.hostname, old.port) != (new.scheme, new.hostname, new.port) or new.username is not None or new.password is not None:
            raise AssetError('Refusing a cross-origin or credential-bearing asset redirect')
        if new.fragment:
            raise AssetError('Refusing an asset redirect containing a fragment')
        return super().redirect_request(request, response, code, message, headers, new_url)


def download_once(root, entry, url, *, timeout):
    target = checked_path(root, entry['path'], create_parents=True)
    temporary = None
    try:
        request = Request(url, headers={'Accept-Encoding': 'identity', 'User-Agent': 'HeartExplorer-AssetRestore/1'})
        with build_opener(SameOriginRedirect()).open(request, timeout=timeout) as response:
            if getattr(response, 'status', 200) != 200:
                raise AssetError('Asset server did not return HTTP 200')
            declared = response.headers.get('Content-Length')
            if declared is not None and (not declared.isdigit() or int(declared) != entry['bytes']):
                raise AssetError('Content-Length differs from the asset manifest')
            digest, count = hashlib.sha256(), 0
            with tempfile.NamedTemporaryFile(mode='wb', prefix='.'+target.name+'.part-', dir=target.parent, delete=False) as stream:
                temporary = Path(stream.name)
                while True:
                    # One extra byte detects an overlong stream without an
                    # unbounded disk write, even when Content-Length is absent.
                    chunk = response.read(min(CHUNK, entry['bytes']-count+1))
                    if not chunk:
                        break
                    count += len(chunk)
                    if count > entry['bytes']:
                        raise AssetError('Downloaded bytes exceed the asset manifest')
                    digest.update(chunk)
                    stream.write(chunk)
                stream.flush()
                os.fsync(stream.fileno())
            if count != entry['bytes'] or digest.hexdigest() != entry['sha256']:
                raise AssetError('Downloaded byte count or SHA-256 does not match the asset manifest')
        checked_path(root, entry['path'])
        os.replace(temporary, target)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def restore_asset(root, entry, base, *, dry_run=False, attempts=3, timeout=30):
    result = {'path': entry['path'], 'bytes': entry['bytes'], 'sha256': entry['sha256'], 'group': entry['group']}
    try:
        target = checked_path(root, entry['path'])
        if file_matches(target, entry):
            return dict(result, status='verified')
        if dry_run:
            return dict(result, status='invalid' if target.exists() else 'missing')
        url = asset_url(base, entry['url'])
        error = None
        for attempt in range(attempts):
            try:
                download_once(root, entry, url, timeout=timeout)
                return dict(result, status='downloaded')
            except HTTPError as exc:
                error = 'HTTP '+str(exc.code)
                if exc.code not in (408, 429) and exc.code < 500:
                    break
            except (URLError, TimeoutError, ConnectionError, http.client.HTTPException) as exc:
                error = type(exc).__name__+': transport failed'
            except AssetError as exc:
                error = str(exc)
                # Security/policy errors are permanent; integrity errors may
                # be transient transport/cache failures, bounded by attempts.
                if 'redirect' in error or 'Symlink' in error or 'destination' in error:
                    break
            if attempt+1 < attempts:
                time.sleep(min(.5 * (2 ** attempt), 2))
        return dict(result, status='failed', error=error or 'Asset transfer failed')
    except (OSError, AssetError) as exc:
        return dict(result, status='failed', error=str(exc))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, help='Asset manifest; defaults to docs/open-source/asset-manifest.json beneath the root')
    parser.add_argument('--root', type=Path, default=ROOT, help='Repository root to restore (default: this script\'s repository)')
    parser.add_argument('--group', choices=(*GROUPS, 'all'), help='Default: runtime for restoration/dry-run, all for --list')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--list', action='store_true', help='List group totals and license decisions without reading or downloading assets')
    mode.add_argument('--dry-run', action='store_true', help='Verify existing files and report missing/invalid assets without network or writes')
    parser.add_argument('--base-url', help='HTTPS mirror base; overrides the manifest base URL')
    parser.add_argument('--jobs', type=int, choices=range(1, 9), default=4, metavar='1..8')
    parser.add_argument('--attempts', type=int, choices=range(1, 4), default=3, metavar='1..3')
    parser.add_argument('--timeout', type=float, default=30, help='Per-request timeout in seconds, 1 to 120')
    parser.add_argument('--report', type=Path, help='Write a detailed JSON result outside the downloaded assets')
    args = parser.parse_args(argv)
    try:
        if not 1 <= args.timeout <= 120:
            raise AssetError('Timeout must be between 1 and 120 seconds')
        root = args.root.absolute()
        manifest_path = args.manifest or root / DEFAULT_MANIFEST
        manifest = load_manifest(manifest_path)
        base = base_url(args.base_url or manifest.get('assetBaseUrl', DEFAULT_BASE_URL))
        selected_group = args.group or ('all' if args.list else 'runtime')
        entries = [item for item in manifest['assets'] if selected_group == 'all' or item['group'] == selected_group]
        permitted = [item for item in entries if item['redistribution'] == 'permitted']
        excluded = [item for item in entries if item['redistribution'] == 'excluded']
        report = {'schemaVersion': 1, 'mode': 'list' if args.list else 'dry-run' if args.dry_run else 'restore',
                  'group': selected_group, 'assetBaseUrl': base, 'permittedCount': len(permitted),
                  'permittedBytes': sum(item['bytes'] for item in permitted),
                  'excludedCount': len(excluded), 'results': []}
        for group in GROUPS:
            selected = [item for item in permitted if item['group'] == group]
            if selected:
                total = sum(item['bytes'] for item in selected)
                print(f'{group}: {len(selected):,} permitted files, {total:,} bytes ({total / 1024**3:.3f} GiB)')
        print(f'Excluded by license decision: {len(excluded):,} files; never downloaded.')
        if not args.list:
            # Validate every selected destination before starting any network.
            for entry in permitted:
                checked_path(root, entry['path'])
            completed = {}
            with ThreadPoolExecutor(max_workers=args.jobs) as pool:
                jobs = {pool.submit(restore_asset, root, entry, base, dry_run=args.dry_run,
                                    attempts=args.attempts, timeout=args.timeout): entry for entry in permitted}
                for future in as_completed(jobs):
                    result = future.result()
                    completed[result['path']] = result
                    if not args.dry_run and (len(completed) % 25 == 0 or len(completed) == len(permitted)):
                        print(f'Checked {len(completed):,}/{len(permitted):,} assets', file=sys.stderr)
            report['results'] = [completed[item['path']] for item in permitted]
            counts = {name: sum(item['status'] == name for item in report['results'])
                      for name in ('verified', 'downloaded', 'missing', 'invalid', 'failed')}
            report['counts'] = counts
            print(', '.join(f'{name}: {count:,}' for name, count in counts.items()))
            failures = [item for item in report['results'] if item['status'] == 'failed']
            for result in failures[:10]:
                print('Failed '+result['path']+': '+result['error'], file=sys.stderr)
            if len(failures) > 10:
                print(f'{len(failures)-10} further failures; use --report for full details.', file=sys.stderr)
        else:
            report['groups'] = {group: {'count': sum(item['group'] == group for item in permitted),
                                      'bytes': sum(item['bytes'] for item in permitted if item['group'] == group)} for group in GROUPS}
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
        return 1 if report.get('counts', {}).get('failed', 0) else 0
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print('Asset restore stopped: '+str(exc), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
