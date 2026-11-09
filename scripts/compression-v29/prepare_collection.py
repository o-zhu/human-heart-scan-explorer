#!/usr/bin/env python3
"""Prepare small app manifests and a repeatable mesh/section upload index.

This performs no upload and does not alter upload gates. The parent release
process can merge the flat index with its independently reviewed cleanup assets.
"""
from pathlib import Path
import argparse, copy, hashlib, json

ROOT = Path(__file__).resolve().parents[2]


def file_sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda: f.read(1024 * 1024), b''):
            h.update(b)
    return h.hexdigest()


def prepare(args):
    mesh = json.loads((args.mesh / 'manifest.json').read_text())
    sections = json.loads((args.sections / 'manifest.json').read_text())
    mesh['assetBaseUrl'] = '/api/display-compact-v29/mesh/'
    sections['assetBaseUrl'] = '/api/display-compact-v29/sections/'
    sections.pop('baseUrl', None)
    sections['compressionLossless'] = False
    sections['codecLossless'] = True
    sections['quality'] = 100
    (args.mesh / 'manifest.json').write_text(json.dumps(mesh, indent=2) + '\n')
    (args.sections / 'manifest.json').write_text(json.dumps(sections, separators=(',', ':')) + '\n')
    index = {}
    def add(key, path, expected_size, expected_hash, content_type):
        assert path.is_file() and path.stat().st_size == expected_size, f'Incorrect asset size: {path}'
        assert file_sha(path) == expected_hash, f'Incorrect asset checksum: {path}'
        assert expected_size <= 8 * 1024 * 1024, f'Asset exceeds immutable-store object limit: {key}'
        index[key] = dict(bytes=expected_size, sha256=expected_hash, contentType=content_type)
    for part in mesh['parts']:
        add('mesh/' + part['path'], args.mesh / part['path'], part['compressedBytes'], part['sha256'], 'application/octet-stream')
    for records in sections['slices'].values():
        for record in records:
            key = 'sections/' + record['path']
            if key not in index:
                add(key, args.sections / record['path'], record['bytes'], record['sha256'], 'image/webp')
    source = json.loads((ROOT / 'public/assets/fine-surface-v23/manifest.json').read_text())
    wrapper = copy.deepcopy(source)
    original = next(lod for lod in source['lods'] if lod['id'] == 'gentle')
    lod = copy.deepcopy(original)
    for key in ['url', 'parts', 'sha256']:
        lod.pop(key, None)
    lod.update(compressedBytes=mesh['compressedBytes'], decodedBytes=mesh['decodedBytes'],
               decodedSha256=mesh['decodedSha256'], sourceDecodedSha256=mesh['sourceDecodedSha256'],
               compactTransport=mesh)
    wrapper['lods'] = [lod]
    wrapper['displayTransportVersion'] = 'v29'
    wrapper['sourceManifest'] = './assets/fine-surface-v23/manifest.json'
    wrapper['displayProcessing'] = dict(geometry='Exact original quantized positions, vertex order and triangle corner order',
                                        shading=mesh['shadingCorrection'],
                                        normalQuantization=mesh['normalQuantization'])
    args.public.mkdir(parents=True, exist_ok=True)
    (args.public / 'mesh-manifest.json').write_text(json.dumps(mesh, indent=2) + '\n')
    (args.public / 'surface-manifest.json').write_text(json.dumps(wrapper, indent=2) + '\n')
    (args.public / 'sections-manifest.json').write_text(json.dumps(sections, separators=(',', ':')) + '\n')
    args.index.parent.mkdir(parents=True, exist_ok=True)
    args.index.write_text(json.dumps(index, sort_keys=True, separators=(',', ':')) + '\n')
    # A directory tree for the release owner's index-driven uploader. Only keys
    # in the index are uploaded; metrics sidecars and full decoded meshes are not.
    args.collection.mkdir(parents=True, exist_ok=True)
    for key, target in [('mesh', args.mesh), ('sections', args.sections)]:
        link = args.collection / key
        if link.is_symlink():
            assert link.resolve() == target.resolve()
        elif not link.exists():
            link.symlink_to(target.resolve(), target_is_directory=True)
        else:
            raise RuntimeError(f'Refusing to replace existing collection directory: {link}')
    receipt = dict(schema='heart-display-compression-collection-v29', entries=len(index),
                   bytes=sum(row['bytes'] for row in index.values()),
                   meshEntries=sum(key.startswith('mesh/') for key in index),
                   sectionEntries=sum(key.startswith('sections/') for key in index),
                   indexSha256=file_sha(args.index), sourceBanksModified=False,
                   uploaded=False, activated=False, cleanupEntriesMerged=False)
    (ROOT / 'docs/compression-v29/collection-prepare.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt, indent=2))


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--mesh', type=Path, default=Path('/workspace/data/heart-v29-compress/mesh-compact'))
    p.add_argument('--sections', type=Path, default=Path('/workspace/data/heart-v29-compress/sections-compact'))
    p.add_argument('--public', type=Path, default=ROOT / 'public/assets/display-compact-v29')
    p.add_argument('--index', type=Path, default=Path('/workspace/data/heart-v29-compress/display-index.json'))
    p.add_argument('--collection', type=Path, default=Path('/workspace/data/heart-v29-compress/collection'))
    prepare(p.parse_args())
