#!/usr/bin/env python3
"""Index and stage exact original/gentle HFM transport files without changing source bytes."""
import argparse
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'public/assets'
INDEX = ROOT / 'server/fine-detail-index-v23.json'


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for piece in iter(lambda: stream.read(1 << 20), b''):
            h.update(piece)
    return h.hexdigest()


def safe_path(name, root):
    assert re.fullmatch(r'fine-surface-v(?:19|23)/[a-z0-9_.-]+\.gz', name), name
    p = root / name
    assert not p.is_symlink() and root.resolve() in p.resolve().parents, name
    return p


def validate_stage_configuration(seed):
    source = (ROOT / 'server/fine-detail-store-v23.mjs').read_text()
    match = re.search(r'^export const fineDetailPublicServingEnabled\s*=\s*(true|false);', source, re.MULTILINE)
    if not match:
        raise RuntimeError('Cannot verify the fine-detail public-serving gate before staging.')
    serves_public = match.group(1) == 'true'
    if seed and serves_public:
        raise RuntimeError('Seed staging requires fineDetailPublicServingEnabled=false so existing v19 files remain served from static assets until R2 verification.')
    if not seed and not serves_public:
        raise RuntimeError('Final staging requires fineDetailPublicServingEnabled=true before removing static copies. Rebuild after changing the gate.')
    return serves_public


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--write-index', action='store_true')
    group.add_argument('--stage', action='store_true')
    parser.add_argument('--seed', action='store_true', help='Keep original v19 files static until verified R2 population.')
    args = parser.parse_args()
    if args.write_index:
        index = {}
        for version in (19, 23):
            path = ASSETS / f'fine-surface-v{version}/manifest.json'
            if version == 23 and not path.exists():
                continue
            manifest = json.loads(path.read_text())
            for lod in manifest['lods']:
                for entry in lod.get('parts') or [lod]:
                    url = entry['url']
                    assert url.startswith('./assets/'), url
                    name = url.removeprefix('./assets/')
                    source = safe_path(name, ASSETS)
                    size = source.stat().st_size
                    assert 0 < size <= 32 * 1024 * 1024, 'Split transport into bounded objects.'
                    assert size == entry['compressedBytes'] and sha(source) == entry['sha256'], name
                    index[name] = dict(bytes=size, sha256=entry['sha256'], contentType='application/octet-stream')
        assert {'fine-surface-v19/balanced.hfm.gz', 'fine-surface-v19/detail.hfm.gz'} <= index.keys()
        INDEX.write_text(json.dumps(index, indent=2, sort_keys=True) + '\n')
        print(json.dumps(dict(objects=len(index), bytes=sum(v['bytes'] for v in index.values()))))
        return
    serves_public = validate_stage_configuration(args.seed)
    index = json.loads(INDEX.read_text())
    removed = 0
    build = ROOT / 'dist/client/assets'
    assert build.is_dir(), 'Build the Site before staging.'
    for name, entry in index.items():
        source = safe_path(name, ASSETS)
        assert source.stat().st_size == entry['bytes'] and sha(source) == entry['sha256'], name
        target = safe_path(name, build)
        if args.seed and name.startswith('fine-surface-v19/'):
            if (not target.is_file() or target.stat().st_size != entry['bytes']
                    or sha(target) != entry['sha256']):
                raise RuntimeError('Seed staging requires a matching static build copy of ' + name + '. Rebuild before staging.')
            continue
        if target.exists():
            assert target.stat().st_size == entry['bytes'] and sha(target) == entry['sha256'], name
            target.unlink()
            removed += 1
    report = dict(verified=True, seed=args.seed, publicServingEnabled=serves_public, objects=len(index), removedBuildCopies=removed,
                  indexedBytes=sum(v['bytes'] for v in index.values()), sourceFilesUnchanged=True,
                  publicUrlsUnchanged=True)
    output = ROOT / '.sites-runtime/fine-detail-staging-v23.json'
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
