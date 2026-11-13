#!/usr/bin/env python3
"""Enable the published v57 bank only after verifying every local asset.

Python 3.9+, standard library only. No network access, credentials or source-data
changes. Restore assets with scripts/fetch-assets.py first. --check never writes.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = 'docs/reference-sections-v57/asset-manifest.json'
MANIFEST_SHA256 = '5bb65aa069707e0e17b54f9b4eb26b4d856cbb64d4856a5995d37141a3601ce5'
CONFIG = 'docs/reference-sections-v57/prepared-bank-config.js'
CONFIG_SHA256 = '58588d5df6a9b54d7aa6c4b6cc563e6bbe2443fd6b1662ae49784a279f7b443d'
TEMPLATE_SHA256 = 'bbac42ab67cfe653ff0b4a13a44e402f3751e25f23c2f25ea4a288ef31746253'
TARGET = 'public/reference-sections-v57.js'


class BankError(ValueError):
    pass


def checked_path(root: Path, relative: str) -> Path:
    parts = relative.split('/')
    if not parts or any(p in ('', '.', '..') for p in parts) or '\\' in relative or ':' in relative:
        raise BankError('Unsafe relative path')
    root = root.absolute()
    if root.is_symlink() or not root.is_dir():
        raise BankError('Root must be an existing nonsymlink directory')
    target = root
    for part in parts:
        target = target / part
        if target.is_symlink():
            raise BankError('Refusing symlink: ' + relative)
    return target


def digest_file(path: Path) -> str:
    flags = os.O_RDONLY | getattr(os, 'O_BINARY', 0) | getattr(os, 'O_NOFOLLOW', 0)
    descriptor = os.open(path, flags)
    digest = hashlib.sha256()
    with os.fdopen(descriptor, 'rb') as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise BankError('Expected a regular file: ' + str(path))
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
        after = os.fstat(stream.fileno())
    final = path.lstat()
    identity = lambda s: (s.st_ino, s.st_mode, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
    if identity(before) != identity(after) or identity(after) != identity(final):
        raise BankError('File changed during verification: ' + str(path))
    return digest.hexdigest()


def verify_asset(root: Path, item: dict) -> None:
    relative = item['path']
    if not relative.startswith('public/assets/reference-sections-v57/'):
        raise BankError('Unexpected asset destination: ' + relative)
    target = checked_path(root, relative)
    if not target.is_file() or target.stat().st_size != item['bytes']:
        raise BankError('Missing or wrong-size asset: ' + relative)
    if digest_file(target) != item['sha256']:
        raise BankError('Asset checksum mismatch: ' + relative)


def verify_bank(root: Path) -> tuple[bytes, int, int]:
    manifest_path = checked_path(root, MANIFEST)
    raw = manifest_path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != MANIFEST_SHA256:
        raise BankError('The approved asset inventory has changed')
    manifest = json.loads(raw)
    assets = manifest['assets']
    if len(assets) != 272 or len({a['path'] for a in assets}) != 272:
        raise BankError('Expected 272 unique approved bank assets')
    config = checked_path(root, CONFIG).read_bytes()
    if hashlib.sha256(config).hexdigest() != CONFIG_SHA256:
        raise BankError('The approved configuration has changed')
    for item in assets:
        if item['redistribution'] != 'permitted' or item['group'] != 'runtime':
            raise BankError('Unexpected asset permission or group')
        verify_asset(root, item)
    return config, len(assets), sum(a['bytes'] for a in assets)


def activate(root: Path, config: bytes) -> bool:
    target = checked_path(root, TARGET)
    current = target.read_bytes()
    current_hash = hashlib.sha256(current).hexdigest()
    if current_hash == CONFIG_SHA256:
        return False
    if current_hash != TEMPLATE_SHA256:
        raise BankError('Refusing to overwrite a custom configuration')
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=target.parent, prefix='.reference-bank-', delete=False) as out:
            temporary = Path(out.name)
            out.write(config)
            out.flush()
            os.fsync(out.fileno())
        temporary.chmod(0o644)
        checked_path(root, TARGET)
        if target.read_bytes() != current:
            raise BankError('Configuration changed during activation')
        os.replace(temporary, target)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return True


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--check', action='store_true', help='Verify the entire bank without changing configuration')
    args = parser.parse_args(argv)
    try:
        config, count, size = verify_bank(args.root)
        changed = False if args.check else activate(args.root, config)
        print(json.dumps({'verified_assets': count, 'verified_bytes': size,
                          'configuration_changed': changed, 'check_only': args.check}))
        return 0
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print('Reference bank not enabled: ' + str(exc), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
