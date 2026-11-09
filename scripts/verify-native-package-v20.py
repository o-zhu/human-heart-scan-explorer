#!/usr/bin/env python3
"""Verify static native-study files and both compressed/uncompressed package limits."""
import argparse
import gzip
import hashlib
import json
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LIMIT = 256 * 1024 * 1024
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--archive', type=Path)
args = parser.parse_args()
files = ['native-detail.html', 'native-detail.css', 'native-detail.js', 'native-mesh-worker.js', 'native-mesh-loader.js', 'native-mesh-format.js', 'assets/native-surface-v20/manifest.json', 'assets/native-surface-v20/quickcontext.webp', 'assets/native-surface-v20/comparison.webp']
expected = {name: hashlib.sha256((ROOT / 'public' / name).read_bytes()).hexdigest() for name in files}
index = json.loads((ROOT / 'server/native-surface-index-v20.json').read_text())
seen = set()
compressed = uncompressed = None
if args.archive:
    compressed = args.archive.stat().st_size
    assert compressed < LIMIT, 'Compressed package exceeds hosting limit.'
    uncompressed = 0
    with gzip.open(args.archive, 'rb') as stream:
        for piece in iter(lambda: stream.read(4 << 20), b''):
            uncompressed += len(piece)
    assert uncompressed < LIMIT, 'Uncompressed tar package exceeds hosting limit.'
    with tarfile.open(args.archive, 'r:gz') as archive:
        for member in archive:
            if not member.isfile() or not member.name.startswith('dist/client/'):
                continue
            name = member.name.removeprefix('dist/client/')
            if name in expected:
                assert hashlib.sha256(archive.extractfile(member).read()).hexdigest() == expected[name], name
                seen.add(name)
            assert name not in {'assets/native-surface-v20/' + key for key in index}, 'A streamed mesh remained in the static package.'
else:
    for name, checksum in expected.items():
        assert hashlib.sha256((ROOT / 'dist/client' / name).read_bytes()).hexdigest() == checksum, name
        seen.add(name)
    assert all(not (ROOT / 'dist/client/assets/native-surface-v20' / name).exists() for name in index)
assert seen == set(expected)
report = dict(verified=True, nativeStaticFiles=len(seen), separateImmutableMeshes=len(index), archiveCompressedBytes=compressed, archiveUncompressedBytes=uncompressed, hostingLimitBytes=LIMIT, uncompressedHeadroomBytes=LIMIT-uncompressed if uncompressed else None)
output = ROOT / '.sites-runtime' / ('native-package-v20.json' if args.archive else 'native-build-v20.json')
output.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
