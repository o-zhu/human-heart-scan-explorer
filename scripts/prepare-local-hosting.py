#!/usr/bin/env python3
"""Keep exact ignored, interrupted local-transfer fragments out of deployment.

These are not application assets. Never remove their public source copies,
alter a tracked file, or broaden the allowlist to ordinary assets.
"""
from pathlib import Path
import argparse
import hashlib
import json
import subprocess

ROOT = Path(__file__).resolve().parents[1]
FRAGMENTS = (
    'assets/donors/s-20-28/volume/.high-clean-03.raw.gz.2RkQmc',
    'assets/fine-surface-v23/.gentle.part-002.gz.dINZTH',
    'assets/fine-surface-v23/.gentle.part-008.gz.EnGkt6',
    'assets/motion-lab-v24/native-ct/.native-phase-15.hfm.gz.burbGp',
    'assets/fine-surface-v23/.gentle.part-002.gz.hOSlaD',
    'assets/fine-surface-v23/.gentle.part-008.gz.75mT1k',
    'assets/native-surface-v20/.normals.hfm.gz.CQTR1B',
)
# One interrupted synchronization copy observed only inside dist. It is never
# an application URL. Remove it only after its complete counterpart is verified
# byte-for-byte against source and the fragment matches that source's prefix.
BUILD_ONLY_FRAGMENTS = (
    ('assets/volume-v5/.heart-high-clean.raw.gz.uHyZaC',
     'assets/volume-v5/heart-high-clean.raw.gz'),
)


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1 << 20), b''):
            value.update(block)
    return value.hexdigest()


def stage():
    plans = []
    for relative in FRAGMENTS:
        source = ROOT / 'public' / relative
        built = ROOT / 'dist/client' / relative
        if not built.exists():
            continue
        assert source.is_file() and built.is_file()
        assert not source.is_symlink() and not built.is_symlink()
        tracked = subprocess.run(['git', 'ls-files', '--error-unmatch', str(source.relative_to(ROOT))], cwd=ROOT, capture_output=True)
        ignored = subprocess.run(['git', 'check-ignore', '-q', str(source.relative_to(ROOT))], cwd=ROOT)
        assert tracked.returncode != 0 and ignored.returncode == 0, 'A fragment is now a source asset; do not remove its build copy.'
        assert source.stat().st_size == built.stat().st_size
        assert digest(source) == digest(built), 'Build/source fragment mismatch.'
        plans.append((built, built.stat().st_size))
    for relative, complete_relative in BUILD_ONLY_FRAGMENTS:
        built = ROOT / 'dist/client' / relative
        if not built.exists():
            continue
        complete = ROOT / 'dist/client' / complete_relative
        source = ROOT / 'public' / complete_relative
        assert all(p.is_file() and not p.is_symlink() for p in (built, complete, source))
        tracked = subprocess.run(['git', 'ls-files', '--error-unmatch', str(built.relative_to(ROOT))], cwd=ROOT, capture_output=True)
        ignored = subprocess.run(['git', 'check-ignore', '-q', str(built.relative_to(ROOT))], cwd=ROOT)
        assert tracked.returncode != 0 and ignored.returncode == 0
        assert complete.stat().st_size == source.stat().st_size and digest(complete) == digest(source)
        fragment = built.read_bytes()
        assert 0 <= len(fragment) < source.stat().st_size
        with source.open('rb') as stream:
            assert stream.read(len(fragment)) == fragment
        plans.append((built, len(fragment)))
    for built, _ in plans:
        built.unlink()
    print(json.dumps({'verified': True, 'removedBuildFragments': len(plans), 'bytesExcluded': sum(size for _, size in plans), 'publicSourceFilesUnchanged': True, 'trackedAssetsUnchanged': True}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage', action='store_true', required=True)
    parser.parse_args()
    stage()
