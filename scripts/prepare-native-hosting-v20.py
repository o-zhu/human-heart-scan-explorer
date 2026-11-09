#!/usr/bin/env python3
"""Index native ROI meshes or verify/remove their redundant hosted build copies."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'public/assets/native-surface-v20'
INDEX = ROOT / 'server/native-surface-index-v20.json'

def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for piece in iter(lambda: stream.read(1 << 20), b''):
            h.update(piece)
    return h.hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--write-index', action='store_true')
    group.add_argument('--stage', action='store_true')
    args = parser.parse_args()
    if args.write_index:
        manifest = json.loads((ASSETS / 'manifest.json').read_text())
        index = {}
        for lod in manifest['lods']:
            name = Path(lod['url']).name
            assert name == lod['id'] + '.hfm.gz'
            asset = ASSETS / name
            assert 0 < asset.stat().st_size <= 32 * 1024 * 1024, 'Native meshes must fit bounded object requests.'
            assert asset.stat().st_size == lod['compressedBytes'] and sha(asset) == lod['sha256']
            index[name] = dict(bytes=lod['compressedBytes'], sha256=lod['sha256'], contentType='application/octet-stream')
        assert {'native.hfm.gz', 'normals.hfm.gz', 'gentle.hfm.gz', 'moderate.hfm.gz'} <= index.keys()
        INDEX.write_text(json.dumps(index, indent=2) + '\n')
        print(json.dumps(dict(indexedObjects=len(index), encodedBytes=sum(x['bytes'] for x in index.values()))))
        return
    index = json.loads(INDEX.read_text())
    assert index, 'Generate the immutable native collection index first.'
    removed = 0
    for name, record in index.items():
        assert name in ('overview.hfm.gz', 'native.hfm.gz', 'normals.hfm.gz', 'gentle.hfm.gz', 'moderate.hfm.gz', 'bilateral.hfm.gz')
        source = ASSETS / name
        assert source.is_file() and source.stat().st_size == record['bytes'] and sha(source) == record['sha256']
        target = ROOT / 'dist/client/assets/native-surface-v20' / name
        if target.exists():
            assert target.stat().st_size == record['bytes'] and sha(target) == record['sha256']
            target.unlink()
            removed += 1
    report = dict(verified=True, objects=len(index), removedBuildCopies=removed, streamedBytes=sum(x['bytes'] for x in index.values()), sourceFilesUnchanged=True)
    (ROOT / '.sites-runtime/native-staging-v20.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))

if __name__ == '__main__':
    main()
