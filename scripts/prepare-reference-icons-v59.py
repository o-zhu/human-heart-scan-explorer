#!/usr/bin/env python3
"""Package the targeted PLAX mitral follow-up without rewriting the v58 record.

Only tte:plax_mv receives a new review and two new WebP files. The other 55
manifest entry objects remain exact copies of v58, including their historical
review scope. A complete explicit v59 registry resolves all 56 current views.

  python3 scripts/prepare-reference-icons-v59.py --review /absolute/plax-review.json
  python3 scripts/prepare-reference-icons-v59.py --review /absolute/plax-review.json --write
  python3 scripts/prepare-reference-icons-v59.py --verify

The first command is a dry run. Packaging performs uniform resizing/encoding
only. It rejects pending reviews and does not generate, crop or repair anatomy.
"""
import argparse
import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import re
import subprocess
from types import SimpleNamespace

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'docs/reference-views-v58/asset-manifest.json'
BASE_SHA256 = '03a5f5b1bcd18bb8f0a1d1488162dd48cae90d3879b2da5a1bad2e39a95106d9'
MANIFEST = ROOT / 'docs/reference-views-v59/asset-manifest.json'
REGISTRY = ROOT / 'public/reference-artwork-v59.js'
TARGET = 'tte:plax_mv'
SPEC = importlib.util.spec_from_file_location('reference_artwork_v58', ROOT / 'scripts/prepare-reference-icons-v58.py')
V58 = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(V58)
require, sha, key = V58.require, V58.sha, V58.key


def baseline():
    data = BASE.read_bytes()
    require(sha(data) == BASE_SHA256, 'The frozen v58 manifest changed; do not silently rebase this targeted review.')
    manifest = json.loads(data)
    require(manifest.get('revision') == 58 and manifest.get('review_state') == 'complete', 'Expected the completed v58 baseline')
    # This checks every v54/v58 asset and the frozen v58 registry. It deliberately
    # does not compare a historical package with the newer live atlas mapping.
    with contextlib.redirect_stdout(io.StringIO()):
        V58.verify(SimpleNamespace(allow_pending=False))
    return manifest


def scope():
    return {
        'kind': 'targeted-follow-up',
        'newly_reviewed': [TARGET],
        'carried_over_count': 55,
        'carried_over_review_revision': 58,
        'description': 'Only TTE PLAX mitral focus receives a new source-based visual review. '
                       'The other 55 entry objects and their review limitations are carried over unchanged from v58; '
                       'they are not represented as newly reviewed or independently clinically certified.',
    }


def registry_text(manifest_bytes, entries):
    # Reuse the established explicit static registry format with a new revision
    # identity. There is no image-error fallback to a superseded illustration.
    return V58.registry_text(manifest_bytes, entries, True).replace('v58 artwork manifest', 'v59 artwork manifest').replace(
        'REFERENCE_ARTWORK_V58', 'REFERENCE_ARTWORK_V59')


def validate_target(record):
    require(key(record) == TARGET and record.get('disposition') == 'replace', 'Only an accepted replacement of tte:plax_mv is permitted')
    V58.checked_review(record, False)
    require(record['review'].get('original_findings'), 'Record the residual defect in the superseded v58 PLAX image')


def read_review(path):
    submitted = json.loads(path.read_text())
    if isinstance(submitted, list):
        require(len(submitted) == 1, 'The targeted update accepts exactly one review')
        record = submitted[0]
    elif isinstance(submitted, dict) and 'entries' in submitted:
        require(len(submitted['entries']) == 1, 'The targeted update accepts exactly one review')
        record = submitted['entries'][0]
    else:
        record = submitted
    require(isinstance(record, dict), 'Expected one review object')
    validate_target(record)
    return record


def prepare(args):
    old_manifest = baseline()
    record = read_review(args.review)
    old = next(e for e in old_manifest['entries'] if key(e) == TARGET)
    entry = {field: old[field] for field in ('id', 'mode', 'name', 'source', 'table', 'view_number')}
    entry.update(disposition='replace', review=copy.deepcopy(record['review']),
                 previous_image=copy.deepcopy(old['image']), previous_thumbnail=copy.deepcopy(old['thumbnail']))
    generation = copy.deepcopy(record.get('generation', {}))
    require(generation.get('tool') in ('image_gen', 'ChatGPT Image / image_gen'), 'image_gen provenance is required')
    require(isinstance(generation.get('prompt'), str) and generation['prompt'].strip(), 'The exact final prompt is required')
    require(generation.get('output_path'), 'A selected generated master path is required')
    master = Path(generation.pop('output_path'))
    require(master.is_file() and not master.is_symlink(), 'The selected master must be a regular file')
    master_bytes = master.read_bytes()
    writes = {}
    with Image.open(io.BytesIO(master_bytes)) as original:
        require(original.width == original.height and original.width >= 960,
                'A square master of at least 960px is required; cropping is not permitted')
        image = original.convert('RGB')
        for role, size, directory in [('image', 960, ''), ('thumbnail', 384, 'thumbs/')]:
            path = f'public/assets/reference-views-v59/{directory}tte-plax_mv.webp'
            output = io.BytesIO()
            image.resize((size, size), Image.Resampling.LANCZOS).save(output, format='WEBP', quality=91, method=6)
            data = output.getvalue()
            writes[path] = data
            entry[role] = V58.metadata(path, data, size)
    require(entry['image']['sha256'] != old['image']['sha256'], 'The replacement must differ from the superseded v58 pixels')
    references = []
    for reference in generation.pop('references', []):
        reference = dict(reference)
        local = reference.pop('path', None)
        if local:
            path = Path(local)
            require(path.is_file() and not path.is_symlink(), 'Missing regular reference input')
            reference.update(name=path.name, sha256=sha(path.read_bytes()))
        references.append(reference)
    generation['reference_inputs'] = references
    entry.update(source_png_sha256=sha(master_bytes), generation=generation)
    entries = [entry if key(previous) == TARGET else copy.deepcopy(previous) for previous in old_manifest['entries']]
    manifest = {
        'schema_version': 1,
        'revision': 59,
        'count': 56,
        'review_state': 'complete',
        'scope': 'AI-assisted source comparison of educational schematics; not independent clinical certification.',
        'review_scope': scope(),
        'encoding': '960px and 384px square WebP, quality 91. Resampling and encoding only; no anatomy edits.',
        'historical_manifest': BASE.relative_to(ROOT).as_posix(),
        'historical_manifest_sha256': BASE_SHA256,
        'entries': entries,
    }
    validate_manifest(manifest, old_manifest)
    manifest_bytes = (json.dumps(manifest, indent=2, ensure_ascii=False) + '\n').encode()
    writes[MANIFEST.relative_to(ROOT).as_posix()] = manifest_bytes
    writes[REGISTRY.relative_to(ROOT).as_posix()] = registry_text(manifest_bytes, entries).encode()
    if args.write:
        for relative, data in writes.items():
            path = ROOT / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
    print(json.dumps({'written': bool(args.write), 'views': 56, 'newly_reviewed': [TARGET],
                      'replacements_in_this_revision': 1, 'entries_carried_over_unchanged': 55,
                      'new_asset_bytes': sum(len(data) for path, data in writes.items() if path.endswith('.webp')),
                      'manifest_sha256': sha(manifest_bytes),
                      'runtime_verification_required': True}))


def validate_manifest(manifest, old_manifest):
    entries = manifest.get('entries', [])
    old_entries = old_manifest['entries']
    require(manifest.get('schema_version') == 1 and manifest.get('revision') == 59, 'Unexpected manifest version')
    require(manifest.get('review_state') == 'complete', 'The targeted review is not complete')
    require(len(entries) == len({key(e) for e in entries}) == manifest.get('count') == 56, 'Exactly 56 unique entries are required')
    require([key(e) for e in entries] == [key(e) for e in old_entries], 'Catalogue identity or order changed')
    require(manifest.get('historical_manifest') == BASE.relative_to(ROOT).as_posix()
            and manifest.get('historical_manifest_sha256') == BASE_SHA256, 'Historical manifest identity mismatch')
    require(manifest.get('review_scope') == scope(), 'The targeted versus carried-over review scope is ambiguous')
    for entry, old in zip(entries, old_entries):
        if key(entry) != TARGET:
            require(entry == old, key(entry) + ': carried-over entry changed')
            continue
        validate_target(entry)
        require(all(entry.get(field) == old[field] for field in ('id', 'mode', 'name', 'source', 'table', 'view_number')),
                'The targeted view identity changed')
        require(entry.get('previous_image') == old['image'] and entry.get('previous_thumbnail') == old['thumbnail'],
                'Previous PLAX metadata must identify the exact v58 image and thumbnail')
        require(re.fullmatch('[a-f0-9]{64}', entry.get('source_png_sha256', '')), 'Missing accepted master hash')
        require(entry.get('generation', {}).get('prompt', '').strip(), 'Missing exact final prompt')
        for role, directory in [('image', ''), ('thumbnail', 'thumbs/')]:
            require(entry[role]['path'] == f'public/assets/reference-views-v59/{directory}tte-plax_mv.webp',
                    'Unexpected targeted artwork path')
        require(entry['image']['sha256'] != old['image']['sha256'], 'The targeted image has not changed')


def verify(args):
    old_manifest = baseline()
    data = MANIFEST.read_bytes()
    manifest = json.loads(data)
    validate_manifest(manifest, old_manifest)
    entries = manifest['entries']
    for entry in entries:
        for role, size in [('image', 960), ('thumbnail', 384)]:
            meta = entry[role]
            path = ROOT / meta['path']
            require(path.is_file() and not path.is_symlink(), key(entry) + ': missing regular asset')
            content = path.read_bytes()
            require(len(content) == meta['bytes'] and sha(content) == meta['sha256'], key(entry) + ': asset checksum mismatch')
            require(meta.get('width') == meta.get('height') == size, key(entry) + ': inconsistent dimension metadata')
            with Image.open(io.BytesIO(content)) as image:
                require(image.format == 'WEBP' and image.size == (size, size), key(entry) + ': wrong dimensions or encoding')
    require(REGISTRY.read_text() == registry_text(data, entries), 'The explicit v59 registry is stale; regenerate it')
    # v59 is now historical. Validate its frozen registry without comparing the newer runtime.
    code = "import {REFERENCE_ARTWORK_V59 as records} from './public/reference-artwork-v59.js';console.log(JSON.stringify(Object.entries(records).map(([key,value])=>({mode:key.split(':')[0],id:key.split(':')[1],...value}))));"
    runtime = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', code], cwd=ROOT, text=True))
    mapped = {key(entry): entry for entry in entries}
    require(len(runtime) == 56 and {key(entry) for entry in runtime} == set(mapped), 'The frozen v59 catalogue is incomplete')
    for entry in runtime:
        for role, field in [('image', 'illustration'), ('thumbnail', 'thumbnail')]:
            require(entry[field] == './' + mapped[key(entry)][role]['path'].removeprefix('public/'),
                    key(entry) + ': frozen v59 mapping mismatch')
    print(json.dumps({'verified': True, 'views': 56, 'assets': 112,
                      'newly_reviewed': [TARGET], 'replacements_in_this_revision': 1,
                      'entries_carried_over_unchanged': 55, 'historical_v58_verified': True,
                      'current_runtime_checked': False, 'frozen_registry_checked': True, 'historical_package_verified': True}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--review', '--reviews', dest='review', type=Path)
    parser.add_argument('--write', action='store_true')
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    try:
        require(args.verify != bool(args.review), 'Choose exactly one of --verify or --review FILE')
        require(not (args.verify and args.write), '--verify is read-only')
        verify(args) if args.verify else prepare(args)
    except (OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError) as error:
        parser.exit(1, f'Cannot package PLAX follow-up: {error}\n')
