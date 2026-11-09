#!/usr/bin/env python3
"""Verify the new immutable pilot/mesh assets in staging or a Sites archive."""
from pathlib import Path
import argparse
import hashlib
import json
import tarfile

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_LIMIT = 256 * 1024 * 1024


def sha(data):
    return hashlib.sha256(data).hexdigest()


def inventory():
    entries = {}
    for name in ['clinical-v19/cmac', 'clinical-v19/slicerheart', 'fine-surface-v19']:
        relative = 'assets/' + name + '/manifest.json'
        content = (ROOT / 'public' / relative).read_bytes()
        manifest = json.loads(content)
        entries[relative] = {'bytes': len(content), 'sha256': sha(content)}
        frames = manifest.get('lods') or [frame for series in manifest['series'] for frame in series['frames']]
        for frame in frames:
            path = frame['url'].removeprefix('./').lstrip('/')
            assert path.startswith('assets/' + name + '/') and '..' not in path.split('/'), path
            record = {'bytes': frame['compressedBytes'], 'sha256': frame['sha256']}
            assert path not in entries or entries[path] == record, path
            entries[path] = record
    return entries


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path)
    args = parser.parse_args()
    entries = inventory()
    checked = set()
    if args.archive:
        size = args.archive.stat().st_size
        assert size <= ARCHIVE_LIMIT, f'Archive is {size} bytes; hosting limit is {ARCHIVE_LIMIT}.'
        with tarfile.open(args.archive, 'r:gz') as archive:
            for member in archive:
                if not member.isfile() or not member.name.startswith('dist/client/'):
                    continue
                path = member.name.removeprefix('dist/client/')
                if path not in entries:
                    continue
                assert path not in checked, f'Duplicate asset in archive: {path}'
                record = entries[path]
                assert member.size == record['bytes'], path
                assert sha(archive.extractfile(member).read()) == record['sha256'], path
                checked.add(path)
    else:
        size = None
        for path, record in entries.items():
            asset = ROOT / 'dist/client' / path
            assert asset.is_file() and asset.stat().st_size == record['bytes'], path
            assert sha(asset.read_bytes()) == record['sha256'], path
            checked.add(path)
    assert checked == set(entries), sorted(set(entries) - checked)
    result = {'verified': True, 'newAssetsChecked': len(checked),
              'manifestAndEncodedAssetBytes': sum(e['bytes'] for e in entries.values()),
              'archiveBytes': size, 'archiveLimitBytes': ARCHIVE_LIMIT,
              'archiveHeadroomBytes': ARCHIVE_LIMIT - size if size is not None else None}
    output = ROOT / '.sites-runtime' / ('v19-archive-verification.json' if args.archive else 'v19-staging-verification.json')
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
