#!/usr/bin/env python3
"""Verify that a hosted build preserves every prepared reference-section asset.

This read-only preflight complements the immutable-bank staging checks. The
prepared v57 rasters are ordinary static files, intentionally omitted from Git;
a successful framework build alone cannot establish that they were restored.
No download, deletion, data repair or hosting-policy change is performed.
"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = 'docs/reference-sections-v57/asset-manifest.json'


def inspect_file(path, entry):
    if path.is_symlink():
        return 'symlink'
    if not path.is_file():
        return 'missing'
    if path.stat().st_size != entry['bytes']:
        return 'wrong-size'
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return None if digest.hexdigest() == entry['sha256'] else 'wrong-sha256'


def verify(root=ROOT):
    manifest_path = root / MANIFEST
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    if manifest.get('schemaVersion') != 1 or not isinstance(manifest.get('assets'), list):
        raise ValueError('Unsupported reference-section manifest')
    entries = [e for e in manifest['assets'] if e.get('group') == 'runtime' and e.get('redistribution') == 'permitted']
    if not entries:
        raise ValueError('No permitted runtime reference assets were found')
    seen, failures = set(), []
    for entry in entries:
        relative = PurePosixPath(entry['path'])
        if (relative.is_absolute() or '..' in relative.parts or '\\' in entry['path'] or
                not str(relative).startswith('public/assets/reference-sections-v57/') or
                str(relative) != entry['path'] or entry['path'] in seen or
                type(entry.get('bytes')) is not int or entry['bytes'] <= 0 or
                not re.fullmatch('[a-f0-9]{64}', entry.get('sha256', ''))):
            raise ValueError('Invalid or duplicate reference asset entry')
        seen.add(entry['path'])
        locations = {'source': root / relative,
                     'build': root / 'dist/client' / relative.relative_to('public')}
        for location, path in locations.items():
            failure = inspect_file(path, entry)
            if failure:
                failures.append({'path': entry['path'], 'location': location, 'error': failure})
    return {'verified': not failures,
            'manifest': MANIFEST,
            'manifestSha256': hashlib.sha256(manifest_bytes).hexdigest(),
            'runtimeAssets': len(entries),
            'runtimeBytes': sum(e['bytes'] for e in entries),
            'sourceAndBuildCompared': True,
            'sourceFailures': sum(f['location'] == 'source' for f in failures),
            'buildFailures': sum(f['location'] == 'build' for f in failures),
            'filesModified': False,
            'failures': failures}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--report', type=Path, help='Optional JSON receipt; source and build files remain read-only')
    args = parser.parse_args()
    try:
        result = verify(args.root.resolve())
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps({**result, 'failures': result['failures'][:10],
                          'additionalFailures': max(0, len(result['failures']) - 10)}))
        sys.exit(0 if result['verified'] else 1)
    except (OSError, ValueError, KeyError) as error:
        print(json.dumps({'verified': False, 'error': str(error), 'filesModified': False}))
        sys.exit(1)
