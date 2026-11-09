#!/usr/bin/env python3
"""Verify exact RMR1 delivery, then omit only its redundant full build copy.

The original full RMA1 gzip, all scientific source masks, and every source
manifest remain unchanged in public/. This stage does not write any bank.
"""
if not __debug__:
    raise RuntimeError('Byte-identity verification requires assertions; run without Python optimization.')

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'public'
BUILT = ROOT / 'dist/client'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage', action='store_true', required=True)
    parser.parse_args()
    # Rebuild only in memory: canonical sources, every original mask byte,
    # reference bounds/first occurrences/edge padding, full RMA1 identity, both
    # gzip payloads, and the durable provenance receipt must all match exactly.
    check = subprocess.run(
        [sys.executable, str(ROOT / 'scripts/prepare-reviewed-mask-atlas-v32.py'), '--check'],
        cwd=ROOT, capture_output=True, text=True, check=True,
    )
    proof = json.loads(check.stdout.strip().splitlines()[-1])
    assert proof['verified'] and proof['checkOnly'] and proof['mismatchedBytes'] == 0
    manifest_path = 'assets/reviewed-mask-v32/manifest.json'
    manifest = json.loads((PUBLIC / manifest_path).read_text())
    assert manifest['transport']['format'] == 'RMR1-gzip'
    assert manifest['transport']['url'] == './assets/reviewed-mask-v32/atlas.refs.gz'
    assert manifest['asset']['url'] == './assets/reviewed-mask-v32/atlas.bin.gz'
    assert manifest['asset']['decodedSha256'] == proof['referenceReconstructedFullAtlasSha256']
    runtime_path = 'reviewed-mask-atlas.js'
    runtime = (PUBLIC / runtime_path).read_text()
    assert 'RMR1-gzip' in runtime and re.search(r'0x31524d52', runtime, re.I)
    assert re.search(r'\.transport\b', runtime), 'Runtime must select the reviewed reference transport.'
    assert manifest['asset']['decodedSha256'] in runtime, 'Runtime must pin the exact final RMA1 identity.'
    for name in [manifest_path, runtime_path, 'assets/reviewed-mask-v32/atlas.refs.gz']:
        source, built = PUBLIC / name, BUILT / name
        assert not built.is_symlink() and built.is_file(), 'Missing reviewed build asset: ' + name
        assert built.read_bytes() == source.read_bytes(), 'Build differs from reviewed source: ' + name
    for key in ['asset', 'transport']:
        meta = manifest[key]
        source = PUBLIC / meta['url'].removeprefix('./')
        data = source.read_bytes()
        assert not source.is_symlink() and len(data) == meta['compressedBytes'] and sha(data) == meta['sha256']
    target = BUILT / 'assets/reviewed-mask-v32/atlas.bin.gz'
    removed = 0
    if target.exists():
        data = target.read_bytes()
        assert not target.is_symlink() and len(data) == manifest['asset']['compressedBytes']
        assert sha(data) == manifest['asset']['sha256']
        removed = len(data)
        target.unlink()
    report = {
        'verified': True, 'sourceByteProof': proof,
        'sourceFilesUnchanged': True, 'banksChanged': False,
        'transport': manifest['transport'], 'originalFullAtlas': manifest['asset'],
        'removedBuildPath': 'dist/client/assets/reviewed-mask-v32/atlas.bin.gz',
        'removedBuildBytes': removed,
        'newTransportBytes': manifest['transport']['compressedBytes'],
        'netStaticSavingsBytes': manifest['asset']['compressedBytes'] - manifest['transport']['compressedBytes'],
        'originalFullSourceRetained': True,
        'runtimeReferenceTransportVerified': True,
    }
    receipt = ROOT / '.sites-runtime/reviewed-mask-staging-v32.json'
    receipt.parent.mkdir(parents=True, exist_ok=True)
    receipt.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
