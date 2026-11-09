#!/usr/bin/env python3
"""Lossless transport of eight fixed JSON files inside the production Worker.

--write-index generates deterministic gzip/base64 from exact public source bytes.
--stage validates source, index and built Worker, then removes only redundant
build copies. Existing lexical compaction is accepted; all literals and key
order must still agree. All public source files remain untouched.
"""
import argparse
import base64
import gzip
import hashlib
import importlib.util
import io
import json
from pathlib import Path

# The staging contract uses assertions for consistency with the existing
# lexical compactor. Never permit Python -O/PYTHONOPTIMIZE to disable guards.
if not __debug__:
    raise RuntimeError('Bundled JSON validation requires Python assertions; do not use -O or PYTHONOPTIMIZE.')

ROOT = Path(__file__).resolve().parents[1]
INDEX = Path('server/bundled-json-index-v1.json')
POLICY = 'bundled-json-v1:exact-source:read-only'
CATALOGS = (
    'assets/donors/s-20-28/ultra-volume.json',
    'assets/donors/s-20-29/ultra-volume.json',
    'assets/ultra-volume-v7.json',
    'assets/tte-atlas/media.json',
    'assets/ultra-support.json',
    'assets/ultra-sections/manifest.json',
    'assets/donors/s-20-28/ultra-sections.json',
    'assets/donors/s-20-29/ultra-sections.json',
)
MAX_RAW = 2 * 1024 * 1024
MAX_GZIP = 1024 * 1024
spec = importlib.util.spec_from_file_location('tee_catalog_compactor', ROOT/'scripts/prepare-tee-hosting-v4.py')
compactor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compactor)
compact = compactor.compact


def sha(data):
    return hashlib.sha256(data).hexdigest()


def checked_file(root, relative):
    path = root/relative
    assert path.is_file() and not path.is_symlink(), f'Missing or linked file: {path}'
    assert path.resolve().is_relative_to(root.resolve()), f'Path escapes root: {path}'
    return path


def create_index(root=ROOT):
    entries = {}
    for relative in CATALOGS:
        raw = checked_file(root/'public', relative).read_bytes()
        assert 0 < len(raw) <= MAX_RAW, f'Source length outside bound: {relative}'
        json.loads(raw)
        compressed = gzip.compress(raw, compresslevel=9, mtime=0)
        assert 0 < len(compressed) <= MAX_GZIP, f'Compressed length outside bound: {relative}'
        entries['/'+relative] = dict(
            rawLength=len(raw), rawSha256=sha(raw),
            gzipLength=len(compressed), gzipSha256=sha(compressed),
            gzipBase64=base64.b64encode(compressed).decode('ascii'),
        )
    return dict(schemaVersion=1, encoding='gzip+base64', policy=POLICY, files=entries)


def decoded_entry(entry):
    assert isinstance(entry, dict)
    assert type(entry['rawLength']) is int and 0 < entry['rawLength'] <= MAX_RAW
    assert type(entry['gzipLength']) is int and 0 < entry['gzipLength'] <= MAX_GZIP
    encoded = entry['gzipBase64']
    assert isinstance(encoded, str) and len(encoded) == 4*((entry['gzipLength']+2)//3)
    compressed = base64.b64decode(encoded, validate=True)
    assert base64.b64encode(compressed).decode('ascii') == encoded, 'Noncanonical base64.'
    assert len(compressed) == entry['gzipLength'] and sha(compressed) == entry['gzipSha256']
    with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as stream:
        raw = stream.read(entry['rawLength']+1)
    assert len(raw) == entry['rawLength'] and sha(raw) == entry['rawSha256']
    return raw


def prepare_stage(root=ROOT):
    index_path = checked_file(root, str(INDEX))
    index = json.loads(index_path.read_bytes())
    assert index.get('schemaVersion') == 1 and index.get('encoding') == 'gzip+base64'
    assert index.get('policy') == POLICY
    assert set(index['files']) == {'/'+name for name in CATALOGS}, 'Bundle allowlist changed.'
    # Vite inlines the imported index. Refuse a build made before this handler
    # and exact index were integrated, rather than deleting its static sources.
    worker = checked_file(root, 'dist/server/index.js').read_text()
    assert POLICY in worker and 'x-heart-json-transport' in worker and 'DecompressionStream' in worker, \
        'Built Worker lacks the lossless JSON handler; rebuild before staging.'
    plans, reports = [], []
    for relative in CATALOGS:
        entry = index['files']['/'+relative]
        original = checked_file(root/'public', relative).read_bytes()
        assert decoded_entry(entry) == original, f'Bundle does not match exact source: {relative}'
        assert entry['gzipBase64'] in worker and entry['rawSha256'] in worker, \
            f'Built Worker does not contain the exact bundled payload: {relative}'
        target = root/'dist/client'/relative
        assert not target.is_symlink(), f'Linked build file: {relative}'
        assert target.resolve().is_relative_to((root/'dist/client').resolve())
        built = None
        if target.exists():
            assert target.is_file(), f'Build target is not a file: {relative}'
            built = target.read_bytes()
            assert compact(built) == compact(original), f'Build JSON differs beyond whitespace: {relative}'
        plans.append((relative, original, built))
        reports.append(dict(path=relative, sourceBytes=len(original), sourceSha256=sha(original),
                            buildBytes=len(built) if built is not None else 0,
                            alreadyStaged=built is None, gzipBytes=entry['gzipLength'],
                            base64Bytes=len(entry['gzipBase64'])))
    return plans, dict(verified=True, exactSourceBytes=True, whitespaceOnlyBuildDifference=True,
                       sourceFilesUnchanged=True, builtWorkerVerified=True, files=reports,
                       removedBytes=sum(r['buildBytes'] for r in reports))


def stage(root=ROOT):
    plans, report = prepare_stage(root)
    # All eight entries, source bytes and build copies pass before any removal.
    # Recheck the plan immediately before deleting to detect concurrent edits.
    for relative, original, built in plans:
        assert checked_file(root/'public', relative).read_bytes() == original, 'Source changed during validation.'
        target = root/'dist/client'/relative
        if built is None:
            assert not target.exists(), f'Build target appeared during validation: {relative}'
        else:
            assert not target.is_symlink() and target.read_bytes() == built, f'Build changed during validation: {relative}'
    for relative, _, built in plans:
        if built is not None:
            (root/'dist/client'/relative).unlink()
    for relative, original, _ in plans:
        assert (root/'public'/relative).read_bytes() == original, 'Source changed during staging.'
    receipt = root/'.sites-runtime/bundled-json-staging-v1.json'
    receipt.parent.mkdir(parents=True, exist_ok=True)
    receipt.write_text(json.dumps(report, indent=2)+'\n')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--write-index', action='store_true')
    group.add_argument('--stage', action='store_true')
    args = parser.parse_args()
    if args.write_index:
        index = create_index()
        data = (json.dumps(index, separators=(',', ':'), ensure_ascii=True)+'\n').encode()
        target = ROOT/INDEX
        temporary = target.with_name(target.name+'.pending')
        temporary.write_bytes(data)
        temporary.replace(target)
        report = dict(verified=True, fileCount=len(index['files']), indexBytes=len(data),
                      sourceBytes=sum(e['rawLength'] for e in index['files'].values()),
                      gzipBytes=sum(e['gzipLength'] for e in index['files'].values()),
                      base64Bytes=sum(len(e['gzipBase64']) for e in index['files'].values()))
    else:
        report = stage()
    print(json.dumps(report))


if __name__ == '__main__':
    main()
