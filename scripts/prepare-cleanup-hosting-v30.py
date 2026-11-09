#!/usr/bin/env python3
"""Index/stage the new reviewed reconstruction without modifying source banks."""
import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / 'server/cleanup-index-v30.json'
ASSETS = ROOT / 'public/assets/cleanup-v30'


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 ** 2), b''):
            h.update(block)
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--write-index', action='store_true')
    mode.add_argument('--stage', action='store_true')
    parser.add_argument('--seed', action='store_true')
    args = parser.parse_args()
    manifest = json.loads((ASSETS / 'surface-manifest.json').read_text())
    multipart = {}
    for patch in manifest['patches']:
        meta = patch['surface']
        if not meta.get('parts'):
            continue
        name = Path(meta['url']).name
        source = ASSETS / name
        assert source.stat().st_size == meta['compressedBytes'] and sha(source) == meta['sha256']
        chunks = []
        for number, item in enumerate(meta['parts']):
            part_name = name[:-3] + f'.part-{number:03d}.gz'
            assert item['url'] == './assets/cleanup-v30/' + part_name
            path = ASSETS / part_name
            assert 0 < item['compressedBytes'] <= 4 * 1024 ** 2
            assert path.stat().st_size == item['compressedBytes'] and sha(path) == item['sha256']
            chunks.append(path.read_bytes())
        assert b''.join(chunks) == source.read_bytes(), 'Multipart transport changed the reviewed gzip bytes.'
        multipart[name] = meta
    if args.write_index:
        index = {}
        for path in sorted(ASSETS.glob('*.gz')):
            if path.name in multipart:
                continue
            assert re.fullmatch(r'[a-z0-9-]+\.(?:hfm|sfr|bits|raw)(?:\.part-[0-9]{3})?\.gz', path.name), path.name
            assert not path.is_symlink() and 0 < path.stat().st_size <= 8 * 1024 ** 2
            index[path.name] = {'bytes': path.stat().st_size, 'sha256': sha(path), 'contentType': 'application/octet-stream'}
        assert index, 'No reconstruction assets have been assembled.'
        INDEX.write_text(json.dumps(index, sort_keys=True, indent=2) + '\n')
        print(json.dumps({'objects': len(index), 'bytes': sum(v['bytes'] for v in index.values()), 'sourceBanksChanged': False}))
        return

    index = json.loads(INDEX.read_text())
    assert index, 'An empty reconstruction index cannot be staged.'
    code = (ROOT / 'server/cleanup-store-v30.mjs').read_text()
    policy = re.search(r"export const cleanupV30ReleasePolicy = '([^']+)';", code).group(1)
    assert policy in {'cleanup-v30:unseeded', 'cleanup-v30:seed', 'cleanup-v30:read-only'}
    serves, uploads = policy.endswith(':read-only'), policy.endswith(':seed')
    runtime = (ROOT / 'public/local-surface-refinement.js').read_text()
    if args.seed:
        assert not serves, 'Seed must not serve an unverified reconstruction.'
        assert "./assets/cleanup-v29/surface-manifest.json" in runtime, 'Seed must retain the verified live reconstruction.'
    else:
        assert serves and not uploads, 'Final bank must serve verified data with uploads disabled.'
        assert "./assets/cleanup-v30/surface-manifest.json" in runtime, 'Final runtime must use the reviewed reconstruction.'
    compiled = '\n'.join(p.read_text() for p in (ROOT / 'dist/server').rglob('*.js'))
    assert 'Reconstruction cleanup upload is not authorized.' in compiled
    assert policy in compiled, 'Built Worker has a stale cleanup release policy.'
    assert all(other not in compiled for other in {'cleanup-v30:unseeded', 'cleanup-v30:seed', 'cleanup-v30:read-only'} - {policy}), 'Built Worker contains conflicting cleanup release policies.'
    assert all(v['sha256'] in compiled for v in index.values()), 'Built Worker has a stale reconstruction index.'
    for name in ['local-surface-refinement.js', 'lumen-cleanup-v23.js', 'fine-surface.js',
                 'assets/cleanup-v30/surface-manifest.json', 'assets/cleanup-v30/lumen-manifest.json']:
        assert (ROOT / 'dist/client' / name).read_bytes() == (ROOT / 'public' / name).read_bytes(), 'Built client differs from reviewed source: ' + name
    plans = []
    for name, item in index.items():
        source = ASSETS / name
        target = ROOT / 'dist/client/assets/cleanup-v30' / name
        assert source.stat().st_size == item['bytes'] and sha(source) == item['sha256'], name
        if target.exists():
            assert not target.is_symlink() and target.stat().st_size == item['bytes'] and sha(target) == item['sha256'], name
            plans.append((target, item['bytes']))
    for name, meta in multipart.items():
        target = ROOT / 'dist/client/assets/cleanup-v30' / name
        if target.exists():
            assert not target.is_symlink() and target.stat().st_size == meta['compressedBytes'] and sha(target) == meta['sha256']
            plans.append((target, meta['compressedBytes']))
    # Selected assets are in the canonical collection. Experimental variants
    # remain in source for reproduction, not in the bounded hosted archive.
    for directory in ['cleanup-v30-left', 'cleanup-v30-right']:
        base = ROOT / 'public/assets' / directory
        if not base.exists():
            continue
        for source in base.rglob('*'):
            if not source.is_file() or source.suffix not in ('.gz', '.json'):
                continue
            target = ROOT / 'dist/client/assets' / directory / source.relative_to(base)
            if target.exists():
                assert not target.is_symlink() and target.stat().st_size == source.stat().st_size and sha(target) == sha(source)
                plans.append((target, target.stat().st_size))
    for path, _ in plans:
        path.unlink()
    report = {'verified': True, 'seed': args.seed, 'compiledReleasePolicy': policy, 'publicServingEnabled': serves,
              'uploadsEnabled': uploads, 'objects': len(index),
              'collectionBytes': sum(v['bytes'] for v in index.values()),
              'multipartSurfaceCount': len(multipart), 'multipartVerified': True,
              'removedNewBuildCopies': len(plans), 'bytesMovedOutOfStaticArchive': sum(size for _, size in plans),
              'sourceFilesUnchanged': True, 'historicalBanksUnchanged': True}
    out = ROOT / '.sites-runtime/cleanup-staging-v30.json'
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
