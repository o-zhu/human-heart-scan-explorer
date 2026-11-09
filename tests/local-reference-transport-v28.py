#!/usr/bin/env python3
"""Exact final-stream roundtrip and small malformed-transport checks."""
from pathlib import Path
import argparse
import copy
import gzip
import hashlib
import json
import struct
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/cleanup-v28-right'))
from exact_transport import MAX_PART_BYTES, read_encoded, read_surface


def sha(value):
    return hashlib.sha256(value).hexdigest()


def expect_failure(call):
    try:
        call()
    except (ValueError, OSError):
        return
    raise AssertionError('Malformed transport was accepted.')


def fixture_checks():
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / 'fixture.sfr.gz'
        decoded = b'exact encoded-byte transport\x00' * 100
        encoded = gzip.compress(decoded, mtime=0)
        item = {'compressedBytes': len(encoded), 'sha256': sha(encoded),
                'decodedBytes': len(decoded), 'decodedSha256': sha(decoded)}
        cut = len(encoded) // 2
        parts = []
        for i, data in enumerate((encoded[:cut], encoded[cut:]), 1):
            name = f'{path.name}.part-{i:03d}'
            (path.parent / name).write_bytes(data)
            parts.append({'file': name, 'bytes': len(data), 'sha256': sha(data)})
        metadata = {'version': 1, 'format': 'concatenated-encoded-parts', 'file': path.name,
                    'compressedBytes': len(encoded), 'sha256': sha(encoded), 'parts': parts}
        sidecar = Path(str(path) + '.parts.json')
        def write(value):
            sidecar.write_text(json.dumps(value))
        write(metadata)
        assert read_surface(path, item) == decoded
        expect_failure(lambda: read_encoded(path, item, max_bytes=len(encoded) - 1))
        expect_failure(lambda: read_surface(path, item, max_decoded_bytes=len(decoded) - 1))
        wrong = copy.deepcopy(metadata); wrong['parts'][0]['file'] = '../outside'; write(wrong)
        expect_failure(lambda: read_encoded(path, item))
        wrong = copy.deepcopy(metadata); wrong['parts'].reverse(); write(wrong)
        expect_failure(lambda: read_encoded(path, item))
        write(metadata)
        first = path.parent / parts[0]['file']; original = first.read_bytes()
        first.write_bytes(b'X' + original[1:])
        expect_failure(lambda: read_encoded(path, item))
        first.unlink()
        expect_failure(lambda: read_encoded(path, item))
        first.write_bytes(original)
        path.write_bytes(encoded)
        assert read_surface(path, item) == decoded
        path.write_bytes(b'X' + encoded[1:])
        expect_failure(lambda: read_encoded(path, item))  # no silent fallback
    return 7


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive-dir', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    reports = []
    folder = ROOT / 'docs/cleanup-v28-right/patch'
    for name in ('pulmonary-valve-lumen-surface', 'tricuspid-core-surface'):
        policy_path = folder / f'{name}-policy.json'
        policy = json.loads(policy_path.read_text()); item = policy['surfaceReference']
        path = folder / item['file']
        assert not path.exists(), 'Roundtrip must exercise fresh-checkout split loading.'
        metadata = json.loads(Path(str(path) + '.parts.json').read_text())
        assert all(p['bytes'] <= MAX_PART_BYTES for p in metadata['parts'])
        encoded = read_encoded(path, item)
        if args.archive_dir:
            with (args.archive_dir / path.name).open('rb') as stream:
                offset = 0
                for block in iter(lambda: stream.read(1024 * 1024), b''):
                    assert encoded[offset:offset + len(block)] == block
                    offset += len(block)
                assert offset == len(encoded)
        raw = read_surface(path, item)
        header = struct.unpack_from('<8I', raw)
        assert header[:2] == (0x31524653, 1)
        assert header[2:4] == (item['vertexCount'], item['indexCount'])
        reports.append({'file': path.name, 'compressedBytes': len(encoded), 'sha256': sha(encoded),
                        'decodedBytes': len(raw), 'decodedSha256': sha(raw),
                        'parts': metadata['parts'], 'policySha256': sha(policy_path.read_bytes()),
                        'exactArchiveComparison': bool(args.archive_dir), 'freshCheckoutRoundtrip': True})
        del encoded, raw
    report = {'version': 1, 'scope': 'Transport only; no scientific or runtime asset changes.',
              'malformedFixtureRejections': fixture_checks(), 'streams': reports}
    if args.output:
        args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
