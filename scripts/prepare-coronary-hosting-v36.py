#!/usr/bin/env python3
"""Verify/index/stage only the new immutable coronary derivative collection.

JSON manifests may nest volume, mesh and mask records. Each binary record uses
{url, compressedBytes (or bytes), sha256, parts?}. Independent gzip slab records
are ordinary leaves. A record with both a binary url and parts instead declares
opaque <=4 MiB transport segments of that unchanged parent gzip stream.
All gzip files must be manifest-accounted. Keep JSON/code in the static build;
omit only complete, hash-verified binary build copies. No source file is removed.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'public/assets/coronary-v36'
INDEX = ROOT / 'server/coronary-index-v36.json'
MAX_BYTES = 4 * 1024 * 1024
NAME = re.compile(r'[a-z0-9][a-z0-9-]*\.(?:raw|hfm|sfr|bits|mask)(?:\.part-[0-9]{3})?\.gz')
HASH = re.compile(r'[a-f0-9]{64}')
POLICIES = {'coronary-v36:unseeded', 'coronary-v36:seed', 'coronary-v36:read-only'}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 ** 2), b''):
            digest.update(block)
    return digest.hexdigest()


def object_name(url):
    require(isinstance(url, str), 'A coronary binary URL must be a string.')
    for prefix in ('./assets/coronary-v36/', '/assets/coronary-v36/'):
        if url.startswith(prefix):
            name = url[len(prefix):]
            require(NAME.fullmatch(name) is not None, 'Invalid coronary binary filename: ' + name)
            return name
    raise RuntimeError('Coronary binary URLs must use the coronary-v36 asset prefix.')


def metadata(record):
    name = object_name(record.get('url'))
    size = record.get('compressedBytes', record.get('bytes'))
    digest = record.get('sha256')
    require(type(size) is int and size > 0, 'Invalid binary size: ' + name)
    require(isinstance(digest, str) and HASH.fullmatch(digest) is not None, 'Invalid binary hash: ' + name)
    if 'compressedBytes' in record and 'bytes' in record:
        require(record['bytes'] == size, 'Conflicting binary sizes: ' + name)
    return name, {'bytes': size, 'sha256': digest, 'contentType': 'application/octet-stream'}


def verify_file(path, entry):
    require(path.is_file() and not path.is_symlink(), 'Missing or symbolic binary: ' + path.name)
    require(path.stat().st_size == entry['bytes'] and sha(path) == entry['sha256'],
            'Binary size/hash mismatch: ' + path.name)


def load_assets(asset_root=ASSETS):
    """Return immutable leaf index, full multipart parents and static manifests."""
    require(asset_root.is_dir() and not asset_root.is_symlink(), 'Coronary asset directory is unavailable.')
    manifests = sorted(asset_root.glob('*.json'))
    require(manifests, 'At least one coronary JSON manifest is required.')
    records, parents = {}, {}

    def add(name, entry):
        require(name not in records or records[name] == entry, 'Conflicting manifest records: ' + name)
        records[name] = entry

    def visit(value):
        if isinstance(value, list):
            for child in value:
                visit(child)
            return
        if not isinstance(value, dict):
            return
        url = value.get('url')
        own_binary = isinstance(url, str) and 'assets/coronary-v36/' in url and url.endswith('.gz')
        if own_binary:
            name, entry = metadata(value)
            verify_file(asset_root / name, entry)
            parts = value.get('parts')
            if parts is not None:
                require(isinstance(parts, list) and len(parts) > 0, 'Empty multipart record: ' + name)
                require('.part-' not in name, 'Nested multipart records are not supported.')
                require(name not in records, 'A multipart parent cannot also be a hosted object.')
                digest, size, part_names = hashlib.sha256(), 0, []
                with (asset_root / name).open('rb') as original:
                    for number, part in enumerate(parts):
                        require(isinstance(part, dict), 'Invalid multipart record: ' + name)
                        part_name, part_entry = metadata(part)
                        expected = name[:-3] + f'.part-{number:03d}.gz'
                        require(part_name == expected, 'Multipart names/order do not match: ' + name)
                        require(part_entry['bytes'] <= MAX_BYTES, 'Multipart object exceeds 4 MiB: ' + part_name)
                        require(not part.get('parts'), 'Nested multipart records are not supported.')
                        verify_file(asset_root / part_name, part_entry)
                        with (asset_root / part_name).open('rb') as stream:
                            for block in iter(lambda: stream.read(1024 ** 2), b''):
                                require(original.read(len(block)) == block, 'Multipart bytes differ from parent: ' + name)
                                digest.update(block)
                                size += len(block)
                        add(part_name, part_entry)
                        part_names.append(part_name)
                    require(original.read(1) == b'', 'Multipart stream does not cover its parent: ' + name)
                require(size == entry['bytes'] and digest.hexdigest() == entry['sha256'], 'Multipart identity mismatch: ' + name)
                parent = {**entry, 'parts': part_names}
                require(name not in parents or parents[name] == parent, 'Conflicting multipart parent: ' + name)
                parents[name] = parent
            else:
                require(name not in parents, 'A multipart parent cannot also be a hosted object.')
                require(entry['bytes'] <= MAX_BYTES, 'Binary needs <=4 MiB transport parts: ' + name)
                add(name, entry)
        for key, child in value.items():
            # Parts were checked in order and byte-for-byte against their parent.
            if not (own_binary and key == 'parts'):
                visit(child)

    for path in manifests:
        require(not path.is_symlink(), 'Symbolic JSON manifests are not supported.')
        visit(json.loads(path.read_text()))
    require(records, 'No coronary derivative objects are listed.')
    actual = {p.relative_to(asset_root).as_posix() for p in asset_root.rglob('*.gz')}
    require(actual == set(records) | set(parents), 'All coronary gzip files must be accounted for by JSON manifests.')
    return dict(sorted(records.items())), parents, manifests


def release_policy(root=ROOT):
    code = (root / 'server/coronary-store-v36.mjs').read_text()
    match = re.search(r"export const coronaryV36ReleasePolicy = '([^']+)';", code)
    require(match is not None and match.group(1) in POLICIES, 'Coronary release policy is invalid.')
    return match.group(1)


def runtime_files(extra=(), root=ROOT):
    public = root / 'public'
    names = {p.relative_to(public).as_posix() for p in public.glob('coronary-*')
             if p.is_file() and p.suffix in {'.js', '.css'}}
    for name in extra:
        path = public / name
        require(not Path(name).is_absolute() and '..' not in Path(name).parts,
                'Runtime files must be relative to public/.')
        require(path.is_file() and not path.is_symlink() and path.suffix in {'.js', '.css'},
                'A runtime file must be a regular JS or CSS file under public/.')
        names.add(name)
    return sorted(names)


def stage(index, parents, manifests, *, seed=False, extra_runtime=(), root=ROOT):
    policy = release_policy(root)
    expected_policy = 'coronary-v36:seed' if seed else 'coronary-v36:read-only'
    require(policy == expected_policy, 'Explicit seed/final mode must match the source release policy.')
    compiled = '\n'.join(p.read_text() for p in (root / 'dist/server').rglob('*.js'))
    require('Coronary reconstruction data is read-only.' in compiled, 'Coronary handler is missing from the built Worker.')
    require(policy in compiled, 'Built Worker has a stale coronary release policy.')
    require(all(other not in compiled for other in POLICIES - {policy}),
            'Built Worker contains conflicting coronary release policies.')
    require(all(item['sha256'] in compiled and name in compiled for name, item in index.items()),
            'Built Worker has a stale coronary object index.')
    client = root / 'dist/client'
    staged_assets = client / 'assets/coronary-v36'
    for directory in (root / 'dist', client, client / 'assets', staged_assets):
        require(directory.is_dir() and not directory.is_symlink(),
                'Coronary staging must use real build directories, never symbolic source aliases.')
    kept = ['assets/coronary-v36/' + p.name for p in manifests] + runtime_files(extra_runtime, root)
    for name in kept:
        source, target = root / 'public' / name, root / 'dist/client' / name
        require(target.is_file() and not target.is_symlink() and target.read_bytes() == source.read_bytes(),
                'Built client differs from reviewed source: ' + name)
    plan = []
    for name, entry in {**index, **parents}.items():
        source = root / 'public/assets/coronary-v36' / name
        target = root / 'dist/client/assets/coronary-v36' / name
        verify_file(source, entry)
        if target.exists() or target.is_symlink():
            verify_file(target, entry)
            plan.append((target, entry['bytes']))
    staged_gzip = {p.relative_to(staged_assets).as_posix() for p in staged_assets.rglob('*.gz')}
    require(staged_gzip <= set(index) | set(parents), 'Unexpected coronary gzip files are present in the static build.')
    # Validation is complete before any build copy is omitted.
    for path, _ in plan:
        path.unlink()
    report = {
        'verified': True, 'seed': seed, 'compiledReleasePolicy': policy,
        'publicServingEnabled': not seed, 'uploadsEnabled': seed,
        'objects': len(index), 'collectionBytes': sum(item['bytes'] for item in index.values()),
        'multipartParentCount': len(parents), 'multipartVerified': True,
        'removedNewBuildCopies': len(plan), 'bytesMovedOutOfStaticArchive': sum(size for _, size in plan),
        'retainedStaticFiles': kept, 'sourceFilesUnchanged': True, 'historicalBanksUnchanged': True,
    }
    out = root / '.sites-runtime/coronary-staging-v36.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2) + '\n')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--write-index', action='store_true')
    modes.add_argument('--stage', action='store_true')
    parser.add_argument('--seed', action='store_true', help='Explicit seed staging; never used for a final release.')
    parser.add_argument('--runtime-file', action='append', default=[], help='Additional public-relative JS/CSS to verify and keep.')
    args = parser.parse_args()
    require(not args.seed or args.stage, '--seed is valid only with --stage.')
    index, parents, manifests = load_assets()
    if args.write_index:
        INDEX.write_text(json.dumps(index, sort_keys=True, indent=2) + '\n')
        print(json.dumps({'objects': len(index), 'bytes': sum(v['bytes'] for v in index.values()),
                          'multipartParentCount': len(parents), 'sourceBanksChanged': False}))
        return
    require(json.loads(INDEX.read_text()) == index, 'Stored coronary index differs from the verified manifest assets.')
    print(json.dumps(stage(index, parents, manifests, seed=args.seed, extra_runtime=args.runtime_file)))


if __name__ == '__main__':
    main()
