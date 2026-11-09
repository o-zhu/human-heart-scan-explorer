#!/usr/bin/env python3
"""Deduplicate three byte-identical built masks while preserving legacy URLs.

Source public files and all manifest bytes remain unchanged. The new Worker
returns exact same-origin 308 aliases for just these three historical paths.
Run after the framework build and before the display staging budget gate.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[1]
INDEX_NAME = 'server/cleanup-static-alias-index-v28.json'
NAMES = ('arterial', 'rv', 'valve-region')
STATIC_LIMIT = 252 * 1024 * 1024 + 256 * 1024


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def require(value, message):
    if not value:
        raise RuntimeError(message)


def safe_path(root, url):
    require(re.fullmatch(r'/assets/cleanup-v(?:27|28)/(?:arterial|rv|valve-region)\.bits\.gz', url), 'Unsafe alias path: ' + url)
    path = root / url.removeprefix('/')
    require(root.resolve() in path.resolve().parents and not path.is_symlink(), 'Alias path escapes its root or is a symlink.')
    return path


def inventory_size(directory):
    return sum(path.stat().st_size for path in directory.rglob('*') if path.is_file())


def reference_audit(root):
    # Include the entire shipped text surface, plus entry/Worker code. Historic
    # manifests keep their old URLs because the redirect preserves accessibility.
    roots = [root / 'public', root / 'app', root / 'worker']
    paths = [root / 'page.html']
    for folder in roots:
        paths.extend(path for path in folder.rglob('*') if path.is_file()
                     and path.suffix in {'.js', '.mjs', '.ts', '.tsx', '.html', '.css', '.json'})
    references = []
    patterns = [f'assets/cleanup-v27/{name}.bits.gz' for name in NAMES]
    for path in sorted(set(paths)):
        if not path.exists():
            continue
        # String search only, with bounded memory even for large scan manifests.
        found = set(); overlap = ''
        with path.open(encoding='utf-8', errors='strict') as stream:
            for block in iter(lambda: stream.read(1 << 16), ''):
                text = overlap + block
                found.update(pattern for pattern in patterns if pattern in text)
                overlap = text[-256:]
        if found:
            references.append(dict(file=path.relative_to(root).as_posix(), paths=sorted(found)))
    return references


def verify_built_handler(root, index):
    compiled = '\n'.join(path.read_text() for path in (root / 'dist/server').rglob('*.js'))
    require('Invalid cleanup static alias.' in compiled and all(url in compiled and entry['target'] in compiled and entry['sha256'] in compiled for url, entry in index.items()),
            'Built Worker does not contain the current alias handler and exact paths. Rebuild before staging.')


def verify(root, require_built_alias=False):
    index_path = root / INDEX_NAME
    index = json.loads(index_path.read_text())
    expected = {f'/assets/cleanup-v27/{name}.bits.gz' for name in NAMES}
    require(set(index) == expected, 'The alias index must contain exactly the three reviewed duplicate masks.')
    worker = (root / 'worker/index.ts').read_text()
    require('cleanupStaticAliasRequest(request, cleanupStaticAliasIndex)' in worker
            and 'server/cleanup-static-alias-index-v28.json' in worker,
            'Worker source does not install the reviewed alias handler.')
    if require_built_alias:
        verify_built_handler(root, index)
    plans = []
    for url, entry in sorted(index.items()):
        require(entry['target'] == url.replace('/cleanup-v27/', '/cleanup-v28/'), 'Unexpected canonical mask path.')
        require(isinstance(entry['bytes'], int) and 0 < entry['bytes'] <= 1024 * 1024 and re.fullmatch('[a-f0-9]{64}', entry['sha256']), 'Invalid alias integrity record.')
        original = safe_path(root / 'public', url)
        canonical = safe_path(root / 'public', entry['target'])
        duplicate = safe_path(root / 'dist/client', url)
        retained = safe_path(root / 'dist/client', entry['target'])
        for path in (original, canonical, retained):
            require(path.is_file() and path.stat().st_size == entry['bytes'] and sha(path) == entry['sha256'], 'Missing or mismatched required mask: ' + str(path))
        if duplicate.exists():
            require(duplicate.is_file() and duplicate.stat().st_size == entry['bytes'] and sha(duplicate) == entry['sha256'], 'Mismatched duplicate build copy: ' + str(duplicate))
        plans.append(dict(url=url, target=entry['target'], bytes=entry['bytes'], sha256=entry['sha256'],
                          presentInBuild=duplicate.exists(), buildPath=duplicate))
    if not require_built_alias and any(not plan['presentInBuild'] for plan in plans):
        verify_built_handler(root, index)
    # The active debris flags and both versions' remaining manifest/source files
    # are deliberately outside the removable allowlist.
    return index_path, plans


def run(root, stage=False):
    index_path, plans = verify(root, require_built_alias=stage)
    before_static = inventory_size(root / 'dist/client')
    before_total = inventory_size(root / 'dist')
    removed = 0
    # Verification above is transactional: no deletion occurs if even the last
    # canonical/duplicate copy or the fresh Worker fails its integrity check.
    if stage:
        for plan in plans:
            if plan['presentInBuild']:
                plan['buildPath'].unlink()
                removed += 1
    removable_bytes = sum(plan['bytes'] for plan in plans if plan['presentInBuild'])
    expected_static = before_static - removable_bytes
    expected_total = before_total - removable_bytes
    actual_static = inventory_size(root / 'dist/client')
    actual_total = inventory_size(root / 'dist')
    if stage:
        require(actual_static == expected_static and actual_total == expected_total, 'Unexpected staged size change.')
        verify(root, require_built_alias=True)
    report = dict(verified=True, mode='stage' if stage else 'check', indexSha256=sha(index_path),
                  aliases=[{key: value for key, value in plan.items() if key != 'buildPath'} for plan in plans],
                  indexedDuplicateBytes=sum(plan['bytes'] for plan in plans),
                  bytesSavedByDeduplication=removable_bytes, removedBuildCopies=removed,
                  beforeStaticBytes=before_static, projectedStaticBytes=expected_static,
                  remainingStaticBytes=actual_static, staticBudgetBytes=STATIC_LIMIT,
                  projectedStaticHeadroomBytes=STATIC_LIMIT-expected_static,
                  beforeDistBytes=before_total, projectedDistBytes=expected_total, remainingDistBytes=actual_total,
                  sourceFilesUnchanged=True, sourceManifestsUnchanged=True, activeV26DebrisFilesRetained=True,
                  historicalUrlsPreserved='Exact same-origin 308 redirects; normal GET/HEAD fetch reaches byte-identical static v28 masks.',
                  permissionsAndStorageUnchanged=True, referenceAudit=reference_audit(root),
                  localTestsAndExports='All frozen public source files remain present; no local fixture or export is removed.',
                  limitations='Final archive size and live redirected response bytes must still be checked after publication.')
    output = root / '.sites-runtime/cleanup-static-alias-staging-v28.json'
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--check', action='store_true')
    group.add_argument('--stage', action='store_true')
    args = parser.parse_args()
    run(ROOT, stage=args.stage)
