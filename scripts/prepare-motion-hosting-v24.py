#!/usr/bin/env python3
"""Pin native CT pilot meshes or remove their verified redundant build copies.

Only the new .hfm.gz collection is indexed. The source files and static
manifest.json are retained. Existing source/display indices are never edited.
A previously populated index cannot silently be replaced with different bytes.

During staging only, the old ultra-sections manifest's redundant build copy is
compacted by removing JSON whitespace outside strings. The parsed build/source
values must agree first. This preserves key order, numeric literals, string
escapes and every source byte; it creates room within the static package cap.
Run this stage before the older v10 static-budget staging check.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'public/assets/motion-lab-v24/native-ct'
INDEX = ROOT / 'server/motion-ct-index-v24.json'
PUBLIC_ROUTE = '/assets/motion-lab-v24/native-ct/'
MAX_BYTES = 32 * 1024 * 1024
NAME = re.compile(r'[a-zA-Z0-9][a-zA-Z0-9_.-]*\.hfm\.gz')
EXPECTED_PHASES = (0, 5, 10, 15)


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for piece in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(piece)
    return digest.hexdigest()


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.pending')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def section_manifest_compaction():
    relative = Path('assets/ultra-sections/manifest.json')
    source, target = ROOT / 'public' / relative, ROOT / 'dist/client' / relative
    require(source.is_file() and target.is_file(), 'The source and built section manifests must exist before staging.')
    source_bytes, original = source.read_bytes(), target.read_bytes()
    source_value, built_value = json.loads(source_bytes), json.loads(original)
    require(source_value == built_value, 'The built section manifest differs from its source values.')
    # Scan instead of parse/serialize so the only removed bytes are insignificant
    # JSON whitespace; literal number spellings and key order remain unchanged.
    output, quoted, escaped = bytearray(), False, False
    for byte in original:
        if quoted:
            output.append(byte)
            if escaped:
                escaped = False
            elif byte == 92:
                escaped = True
            elif byte == 34:
                quoted = False
        elif byte == 34:
            quoted = True
            output.append(byte)
        elif byte not in (9, 10, 13, 32):
            output.append(byte)
    compact = bytes(output)
    require(not quoted and json.loads(compact) == source_value, 'Section manifest compaction changed JSON values.')
    require(source.read_bytes() == source_bytes, 'The section manifest source changed during verification.')
    report = dict(path=str(relative), originalBytes=len(original), compactedBytes=len(compact),
                  savedBytes=len(original) - len(compact), whitespaceOnly=True, objectValuesUnchanged=True,
                  keyOrderAndLiteralsUnchanged=True, sourceUnchanged=True,
                  sourceSha256=hashlib.sha256(source_bytes).hexdigest(), compactedSha256=hashlib.sha256(compact).hexdigest())
    return target, compact, report


def current_collection():
    manifest = json.loads((ASSETS / 'manifest.json').read_text())
    require(manifest.get('complete') is True, 'The CT producer must mark the final manifest complete before pinning assets.')
    frames = manifest.get('frames')
    require(isinstance(frames, list) and frames, 'The finished CT manifest must contain acquired frames.')
    require([frame.get('phase') for frame in frames] == list(EXPECTED_PHASES),
            'The v24 collection requires all four final phase pairs (00, 05, 10, 15); do not pin a provisional manifest.')
    index, phases = {}, set()
    for frame in frames:
        phase = frame.get('phase')
        require(isinstance(phase, (str, int)) and phase not in phases, 'Acquired CT phase identifiers must be unique.')
        phases.add(phase)
        for quality in ('overview', 'native'):
            record = frame.get(quality)
            require(isinstance(record, dict), 'Each acquired phase needs an overview/native matched pair.')
            url = urlsplit(record.get('url', ''))
            require(not url.scheme and not url.netloc and not url.query and not url.fragment
                    and url.path.startswith(PUBLIC_ROUTE), 'CT meshes must retain the dedicated public route.')
            name = url.path[len(PUBLIC_ROUTE):]
            require(bool(NAME.fullmatch(name)), 'Only flat .hfm.gz files belong in this bank.')
            require(name == f'{quality}-phase-{phase:02d}.hfm.gz', 'A CT mesh name must match its acquired phase and sampling level.')
            require(name not in index, 'Every acquired phase and sampling level needs its own immutable file.')
            count = record.get('compressedBytes', record.get('bytes'))
            digest = record.get('sha256')
            require(type(count) is int and 0 < count <= MAX_BYTES, 'CT meshes must fit 32 MiB bounded requests.')
            require(isinstance(digest, str) and bool(re.fullmatch('[a-f0-9]{64}', digest)), 'CT mesh checksums must be explicit.')
            asset = ASSETS / name
            require(asset.is_file() and asset.stat().st_size == count and sha(asset) == digest,
                    f'Local CT mesh size or SHA differs from the finished manifest: {name}')
            index[name] = dict(bytes=count, sha256=digest, contentType='application/octet-stream')
    require(set(index) == {path.name for path in ASSETS.glob('*.hfm.gz')},
            'CT collection files and the completed manifest must match exactly; no stale or unfinished mesh is accepted.')
    return dict(sorted(index.items())), len(frames)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--write-index', action='store_true')
    modes.add_argument('--stage', action='store_true')
    args = parser.parse_args()
    expected, frame_count = current_collection()
    if args.write_index:
        previous = json.loads(INDEX.read_text()) if INDEX.exists() else {}
        require(not previous or previous == expected,
                'The immutable CT index already pins different assets; use a new collection version.')
        atomic_json(INDEX, expected)
        print(json.dumps(dict(indexedObjects=len(expected), acquiredFrames=frame_count,
                              encodedBytes=sum(record['bytes'] for record in expected.values()), manifestRemainsStatic=True)))
        return

    index = json.loads(INDEX.read_text())
    require(index and index == expected, 'Generate and verify the immutable CT index before staging.')
    build = ROOT / 'dist/client/assets/motion-lab-v24/native-ct'
    require((build / 'manifest.json').is_file(), 'Build the site before staging the CT collection.')
    require((build / 'manifest.json').read_bytes() == (ASSETS / 'manifest.json').read_bytes(),
            'The built static CT manifest does not match its source.')
    require({path.name for path in build.glob('*.hfm.gz')} <= set(index),
            'An unindexed CT mesh is present in the static build.')
    # Complete every check before removing any redundant build artifact.
    targets = []
    for name, record in index.items():
        target = build / name
        if target.exists():
            require(target.is_file() and target.stat().st_size == record['bytes'] and sha(target) == record['sha256'],
                    f'The built CT mesh differs from the immutable index: {name}')
            targets.append(target)
    compact_target, compact_bytes, compact_report = section_manifest_compaction()
    pending = compact_target.with_name(compact_target.name + '.pending')
    pending.write_bytes(compact_bytes)
    pending.replace(compact_target)
    for target in targets:
        target.unlink()
    require(not tuple(build.glob('*.hfm.gz')), 'An unindexed CT mesh remains in the static build.')
    report = dict(verified=True, objects=len(index), acquiredFrames=frame_count,
                  removedBuildCopies=len(targets), streamedBytes=sum(record['bytes'] for record in index.values()),
                  sourceFilesUnchanged=True, manifestRemainsStatic=True,
                  publicRoute=PUBLIC_ROUTE, apiRoute='/api/motion-ct-v24/', prefix='hoa-heart/motion-ct-v24/',
                  sectionManifestCompaction=compact_report)
    atomic_json(ROOT / '.sites-runtime/motion-ct-staging-v24.json', report)
    print(json.dumps(report))


if __name__ == '__main__':
    main()
