#!/usr/bin/env python3
"""Build the public asset manifest from reviewed paths and immutable indexes.

No files are downloaded. A runtime list is an explicitly reviewed JSON array
of asset records with path, license and redistribution decision. This script
does not decide ownership from a public URL or from a filename.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('heart_asset_fetch', Path(__file__).with_name('fetch-assets.py'))
FETCH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FETCH)

# These exact six routes are the portable viewer's active HOA banks.
# Retired UCL/LADAF donors and clinical/noncommercial media are not selected.
BANKS = (
    ('ladaf-2021-17', '/api/ultra/v4/', 'data/ultra-sections', 'server/ultra-upload-index.json'),
    ('ladaf-2021-17', '/api/ultra-volume/v7/', 'data/ultra-volume-v7', 'server/ultra-volume-index-v7.json'),
    ('s-20-29', '/api/donors/s-20-29/ultra/', 'data/donors/s-20-29/ultra-sections', 'server/donors/s-20-29/ultra-index.json'),
    ('s-20-29', '/api/donors/s-20-29/volume/', 'data/donors/s-20-29/ultra-volume', 'server/donors/s-20-29/volume-index.json'),
    ('s-20-28', '/api/donors/s-20-28/ultra/', 'data/donors/s-20-28/ultra-sections', 'server/donors/s-20-28/ultra-index.json'),
    ('s-20-28', '/api/donors/s-20-28/volume/', 'data/donors/s-20-28/ultra-volume', 'server/donors/s-20-28/volume-index.json'),
)
SOURCES = {
    'ladaf-2021-17': ('https://human-organ-atlas.esrf.fr/datasets/1659197537', 'https://doi.org/10.15151/ESRF-DC-1634390196'),
    's-20-29': ('https://human-organ-atlas.esrf.fr/datasets/1773963465', 'https://doi.org/10.15151/ESRF-DC-1773964017'),
    's-20-28': ('https://human-organ-atlas.esrf.fr/datasets/1966162746', 'https://doi.org/10.15151/ESRF-DC-1966163810'),
}
COMPACT_ROOTS = {
    'mesh': 'data/display-compact-v29/mesh',
    'sections': 'data/display-compact-v29/sections',
    'cleanup': 'public/assets/cleanup-v29',
}
COMPACT_METADATA = ('sections-manifest.json', 'mesh-manifest.json', 'surface-manifest.json')


def indexed_entry(donor, prefix, destination, index_path, name, record):
    FETCH.relative_path(name)
    if not isinstance(record, dict) or type(record.get('bytes')) is not int or record['bytes'] < 1 or not FETCH.SHA256.fullmatch(record.get('sha256', '')):
        raise FETCH.AssetError('Invalid immutable bank entry: '+index_path+'/'+name)
    path = FETCH.validate_destination(destination+'/'+name)
    return {'path': path, 'url': prefix+name, 'bytes': record['bytes'], 'sha256': record['sha256'],
            'group': 'fine-data' if path.startswith('data/') else 'runtime',
            'redistribution': 'permitted', 'license': 'CC-BY-4.0',
            'sourceId': donor, 'sourceUrls': list(SOURCES[donor]), 'derived': True,
            'attribution': 'Individual dataset creators; Human Organ Atlas Collaboration / ESRF. Preserve the linked dataset DOI and the project processing/modification notices.',
            'sourceIndex': index_path, 'sourceIndexKey': name,
            'fallback': 'The main viewer retains its resident preview when optional fine data is absent; missing fine blocks cannot provide exact high-resolution arbitrary sections.'}


def fine_entries(root):
    entries = []
    for donor, prefix, destination, index_path in BANKS:
        index = json.loads((root / index_path).read_text(encoding='utf-8'))
        if not isinstance(index, dict) or not index:
            raise FETCH.AssetError('Invalid scan bank index: '+index_path)
        for name, record in index.items():
            entries.append(indexed_entry(donor, prefix, destination, index_path, name, record))
    index_path = 'server/display-compact-index-v29.json'
    if (root / index_path).is_file():
        compact = json.loads((root / index_path).read_text(encoding='utf-8'))
        for name, record in compact.items():
            if name in COMPACT_METADATA:
                destination, suffix = 'public/assets/display-compact-v29', name
            else:
                group, separator, suffix = name.partition('/')
                if not separator or group not in COMPACT_ROOTS:
                    raise FETCH.AssetError('Unknown compact bank path: '+name)
                destination = COMPACT_ROOTS[group]
            item = indexed_entry('ladaf-2021-17', '/api/display-compact-v29/', destination, index_path, suffix, record)
            item['url'] = '/api/display-compact-v29/'+name
            item['sourceIndexKey'] = name
            entries.append(item)
    return entries


def runtime_entries(root, reviewed):
    if not isinstance(reviewed, list):
        raise FETCH.AssetError('Runtime selection must be a JSON array of reviewed asset records')
    output = []
    for item in reviewed:
        if not isinstance(item, dict):
            raise FETCH.AssetError('Invalid reviewed asset record')
        entry = dict(item)
        path = FETCH.validate_destination(entry.get('path'))
        if not path.startswith('public/assets/'):
            raise FETCH.AssetError('Reviewed runtime entries must use public/assets/')
        if entry.get('redistribution') not in ('permitted', 'excluded'):
            raise FETCH.AssetError('Runtime selection needs an explicit license decision: '+path)
        entry['group'] = 'runtime'
        if entry['redistribution'] == 'permitted':
            if not entry.get('license'):
                raise FETCH.AssetError('Missing reviewed license: '+path)
            source = FETCH.checked_path(root, path)
            if not source.is_file():
                raise FETCH.AssetError('Cannot inventory missing runtime asset: '+path)
            digest = hashlib.sha256()
            with source.open('rb') as stream:
                for chunk in iter(lambda: stream.read(FETCH.CHUNK), b''):
                    digest.update(chunk)
            entry['bytes'] = source.stat().st_size
            entry['sha256'] = digest.hexdigest()
            entry.setdefault('url', '/'+path[len('public/'):])
        output.append(entry)
    return output


def merge_entries(entries):
    merged = {}
    for entry in entries:
        key = entry['path'].casefold()
        prior = merged.get(key)
        if prior:
            if prior['path'] != entry['path'] or any(prior.get(field) != entry.get(field) for field in ('bytes', 'sha256', 'redistribution', 'license')):
                raise FETCH.AssetError('Conflicting asset identity or license: '+entry['path'])
            # Keep reviewed runtime metadata and public URL, while retaining
            # an exact bank mapping for reproducibility when both describe it.
            for field in ('sourceIndex', 'sourceIndexKey'):
                if field in entry:
                    prior.setdefault(field, entry[field])
        else:
            merged[key] = dict(entry)
    return sorted(merged.values(), key=lambda item: item['path'])


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--runtime-list', type=Path, help='Explicitly reviewed JSON asset records')
    parser.add_argument('--fine-data', action='store_true', help='Include six active HOA banks plus the v29 display bank')
    parser.add_argument('--base-url', default=FETCH.DEFAULT_BASE_URL)
    parser.add_argument('--output', type=Path, help='Output JSON; otherwise stdout')
    args = parser.parse_args(argv)
    if not args.runtime_list and not args.fine_data:
        parser.error('Choose --runtime-list, --fine-data, or both; no unknown assets are included automatically')
    try:
        entries = []
        root = args.root.absolute()
        if args.runtime_list:
            entries.extend(runtime_entries(root, json.loads(args.runtime_list.read_text(encoding='utf-8'))))
        if args.fine_data:
            entries.extend(fine_entries(root))
        assets = merge_entries(entries)
        output = {'schemaVersion': 1, 'assetBaseUrl': FETCH.base_url(args.base_url), 'assets': assets}
        encoded = json.dumps(output, indent=2)+'\n'
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(encoded, encoding='utf-8')
        else:
            print(encoded, end='')
        return 0
    except (OSError, ValueError) as exc:
        parser.exit(2, 'Asset inventory stopped: '+str(exc)+'\n')


if __name__ == '__main__':
    raise SystemExit(main())
