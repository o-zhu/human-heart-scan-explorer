#!/usr/bin/env python3
"""Package three targeted reference-artwork corrections against frozen v60.

The other 53 entry objects are carried over exactly; their historical reviews
are not represented as new review. Preview exports perform only uniform RGB
resampling/encoding and cannot switch the live atlas. Final writing rejects
pending reviews and binds acceptance to the exact 960px and 384px bytes.
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
BASE = ROOT / 'docs/reference-views-v60/asset-manifest.json'
BASE_SHA256 = 'c80b06ac5b51cdd7b6fe96eb2eed2de3ca364101f4947e67f8450c73a0c0c144'
GUIDELINES = ROOT / 'docs/reference-views-v60/GUIDELINES.md'
GUIDELINES_SHA256 = '4fb96365d833a55fc1dcd8fd6fd46dbc7ffac68d99ab7f0d4b7d0329304382fd'
MANIFEST = ROOT / 'docs/reference-views-v61/asset-manifest.json'
REGISTRY = ROOT / 'public/reference-artwork-v61.js'
TARGETS = ('tte:subcostal', 'tee:deeptg5c', 'tee:tglax')


def module(revision):
    spec = importlib.util.spec_from_file_location(f'reference_artwork_v{revision}', ROOT / f'scripts/prepare-reference-icons-v{revision}.py')
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


V60 = module(60)
require, sha, key, regular = V60.require, V60.sha, V60.key, V60.regular


def baseline():
    data = regular(BASE)
    require(sha(data) == BASE_SHA256, 'The frozen v60 manifest changed; do not silently rebase this targeted review.')
    require(sha(regular(GUIDELINES)) == GUIDELINES_SHA256, 'The historical v60 guidelines changed.')
    old = json.loads(data)
    require(old.get('revision') == 60 and old.get('count') == 56 and old.get('review_state') == 'complete', 'Expected the completed v60 baseline')
    with contextlib.redirect_stdout(io.StringIO()):
        # The v59 verifier also validates the frozen v58/v54 history.
        module(59).verify(SimpleNamespace())
        V60.verify(SimpleNamespace(historical=True))
    return old


def scope():
    return {
        'kind': 'targeted-follow-up',
        'newly_reviewed': list(TARGETS),
        'replacement_count': 3,
        'carried_over_count': 53,
        'carried_over_review_revision': 60,
        'independent_clinician_signoff': False,
        'description': 'Only subcostal four-chamber, deep transgastric five-chamber and transgastric long-axis receive a new source-based visual review. The other 53 entry objects and their historical review limitations are carried over unchanged from v60.',
    }


def registry_text(data, entries):
    text = V60.registry_text(data, entries).replace('v60 artwork manifest', 'v61 artwork manifest').replace('REFERENCE_ARTWORK_V60', 'REFERENCE_ARTWORK_V61')
    review_scope = ('export const REFERENCE_ARTWORK_REVIEW_SCOPE = Object.freeze({\n'
                    '  revision: 61, baselineRevision: 60, carriedOver: 53,\n'
                    '  newlyReviewed: Object.freeze(' + json.dumps(list(TARGETS)) + ')\n'
                    '});\n')
    return text.replace('const records = ', review_scope + 'const records = ', 1)


def read_records(path, preview=False):
    submitted = json.loads(regular(path))
    records = submitted if isinstance(submitted, list) else submitted['entries']
    require(isinstance(records, list), 'Provide an array of review records or an object with entries')
    identities = [key(record) for record in records]
    require(len(identities) == len(set(identities)), 'Duplicate review identity')
    require(set(identities) <= set(TARGETS), 'Only the three targeted artwork keys are permitted')
    require(0 < len(records) <= 3 if preview else set(identities) == set(TARGETS),
            'Preview accepts one to three targets; release requires exactly all three')
    return {key(record): record for record in records}


def encoded_master(record):
    identity = key(record)
    generation = copy.deepcopy(record['generation'])
    master = Path(generation.pop('output_path'))
    content = regular(master)
    require(generation.get('selected_master_sha256') == sha(content), identity + ': selected master changed')
    with Image.open(io.BytesIO(content)) as original:
        require(original.width == original.height and original.width >= 960, identity + ': square master >=960px required; no crop allowed')
        image = original.convert('RGB')
        outputs = {}
        for role, size, directory in [('image', 960, ''), ('thumbnail', 384, 'thumbs/')]:
            destination = f"public/assets/reference-views-v61/{directory}{record['mode']}-{record['id']}.webp"
            output = io.BytesIO()
            image.resize((size, size), Image.Resampling.LANCZOS).save(output, format='WEBP', quality=91, method=6)
            data = output.getvalue()
            outputs[role] = (V60.metadata(destination, data, size), data)
    refs = []
    for reference in generation.pop('references', []):
        reference = copy.deepcopy(reference)
        path = reference.pop('path', None)
        if path:
            file = Path(path)
            digest = sha(regular(file))
            require(reference.get('sha256') == digest, identity + ': reference identity changed: ' + file.name)
            reference.update(name=file.name, sha256=digest)
        refs.append(reference)
    generation['reference_inputs'] = refs or generation.get('reference_inputs', [])
    return outputs, generation, sha(content)


def preview(args):
    records = read_records(args.reviews, preview=True)
    directory = args.preview_dir.resolve()
    require(not directory.is_relative_to(ROOT / 'public'), 'Review previews must stay outside the published public directory')
    directory.mkdir(parents=True, exist_ok=True)
    results = []
    for identity, record in records.items():
        outputs, _, digest = encoded_master(record)
        result = {'key': identity, 'master_sha256': digest, 'review_status': 'pending actual pixel review', 'exports': {}}
        for role, (meta, data) in outputs.items():
            destination = directory / f"{record['mode']}-{record['id']}-{meta['width']}.webp"
            destination.write_bytes(data)
            result['exports'][role] = {**meta, 'preview_path': str(destination)}
        with Image.open(io.BytesIO(outputs['thumbnail'][1])) as thumb:
            compact = directory / f"{record['mode']}-{record['id']}-200.png"
            thumb.resize((200, 200), Image.Resampling.LANCZOS).save(compact, format='PNG')
            result['compact_preview'] = {'path': str(compact), 'sha256': sha(compact.read_bytes()), 'width': 200, 'height': 200}
        results.append(result)
    report = directory / 'preview-exports.json'
    report.write_text(json.dumps({'entries': results}, indent=2) + '\n')
    print(json.dumps({'preview_only': True, 'review_status': 'pending actual pixel review', 'report': str(report), 'entries': results}))


def validate_target(entry, old):
    identity = key(entry)
    require(identity in TARGETS and entry.get('disposition') == 'replace', identity + ': only targeted replacements are allowed')
    require(all(entry.get(field) == old[field] for field in V60.IDENTITY_FIELDS), identity + ': view identity changed')
    require(entry.get('previous_image') == old['image'] and entry.get('previous_thumbnail') == old['thumbnail'], identity + ': previous metadata does not identify v60 active assets')
    V60.checked_review(entry)
    for role, directory in [('image', ''), ('thumbnail', 'thumbs/')]:
        require(entry[role]['path'] == f"public/assets/reference-views-v61/{directory}{entry['mode']}-{entry['id']}.webp", identity + ': unexpected artwork path')
        require(entry[role]['sha256'] != old[role]['sha256'], identity + ': replacement is unchanged')
    references = entry['generation']['reference_inputs']
    require(all(isinstance(ref, dict) and ref.get('role') and re.fullmatch('[a-f0-9]{64}', ref.get('sha256', '')) for ref in references), identity + ': reference roles and hashes are required')


def validate_manifest(manifest, old):
    require(manifest.get('schema_version') == 2 and manifest.get('revision') == 61, 'Unexpected manifest schema or revision')
    require(manifest.get('review_state') == 'complete', 'The targeted review is incomplete')
    require(manifest.get('review_scope') == scope(), 'Targeted and historical review scopes must remain explicit')
    require(manifest.get('historical_manifest') == BASE.relative_to(ROOT).as_posix() and manifest.get('historical_manifest_sha256') == BASE_SHA256, 'Historical manifest identity mismatch')
    require(manifest.get('guidelines') == GUIDELINES.relative_to(ROOT).as_posix() and manifest.get('guidelines_sha256') == GUIDELINES_SHA256, 'Review guideline identity mismatch')
    entries = manifest.get('entries', [])
    require(len(entries) == len({key(entry) for entry in entries}) == manifest.get('count') == 56, 'Exactly 56 unique catalogue entries required')
    require([key(entry) for entry in entries] == [key(entry) for entry in old['entries']], 'Catalogue identity or order changed')
    for entry, previous in zip(entries, old['entries']):
        if key(entry) in TARGETS:
            validate_target(entry, previous)
        else:
            require(entry == previous, key(entry) + ': carried-over entry changed')


def prepare(args):
    old = baseline()
    records = read_records(args.reviews)
    entries, writes = [], {}
    for previous in old['entries']:
        identity = key(previous)
        if identity not in TARGETS:
            entries.append(copy.deepcopy(previous))
            continue
        record = records[identity]
        require(record.get('disposition') == 'replace', identity + ': unresolved disposition')
        outputs, generation, master_hash = encoded_master(record)
        entry = {field: previous[field] for field in V60.IDENTITY_FIELDS}
        entry.update(disposition='replace', review=copy.deepcopy(record['review']),
                     previous_image=copy.deepcopy(previous['image']), previous_thumbnail=copy.deepcopy(previous['thumbnail']),
                     generation=generation, source_png_sha256=master_hash)
        for role, (meta, data) in outputs.items():
            entry[role] = meta
            writes[meta['path']] = data
        validate_target(entry, previous)
        entries.append(entry)
    manifest = {
        'schema_version': 2, 'revision': 61, 'count': 56, 'review_state': 'complete',
        'scope': 'Targeted AI-assisted source comparison of three educational schematics; no independent clinician certification.',
        'review_scope': scope(),
        'encoding': '960px and 384px square WebP, quality 91, method 6. Uniform resampling and encoding only.',
        'historical_manifest': BASE.relative_to(ROOT).as_posix(), 'historical_manifest_sha256': BASE_SHA256,
        'guidelines': GUIDELINES.relative_to(ROOT).as_posix(), 'guidelines_sha256': GUIDELINES_SHA256,
        'entries': entries,
    }
    validate_manifest(manifest, old)
    data = (json.dumps(manifest, indent=2, ensure_ascii=False) + '\n').encode()
    writes[MANIFEST.relative_to(ROOT).as_posix()] = data
    writes[REGISTRY.relative_to(ROOT).as_posix()] = registry_text(data, entries).encode()
    if args.write:
        for relative, content in writes.items():
            destination = ROOT / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(content)
    print(json.dumps({'written': bool(args.write), 'views': 56, 'newly_reviewed': list(TARGETS),
                      'entries_carried_over_unchanged': 53, 'new_asset_bytes': sum(len(v) for p, v in writes.items() if p.endswith('.webp')),
                      'manifest_sha256': sha(data), 'runtime_activation_and_verification_required': True}))


def verify(_args):
    old = baseline()
    data = regular(MANIFEST)
    manifest = json.loads(data)
    validate_manifest(manifest, old)
    entries = manifest['entries']
    for entry in entries:
        for role, size in [('image', 960), ('thumbnail', 384)]:
            meta = entry[role]
            content = regular(ROOT / meta['path'])
            require(len(content) == meta['bytes'] and sha(content) == meta['sha256'], key(entry) + ': asset checksum mismatch')
            require(meta.get('width') == meta.get('height') == size, key(entry) + ': inconsistent dimensions')
            with Image.open(io.BytesIO(content)) as image:
                require(image.format == 'WEBP' and image.size == (size, size), key(entry) + ': incorrect encoding or size')
    require(regular(REGISTRY).decode() == registry_text(data, entries), 'The explicit v61 registry is stale')
    code = "import {TTE_ATLAS_VIEWS as t} from './public/tte-atlas-data.js';import {TEE_ATLAS_VIEWS as e} from './public/tee-atlas-data.js';console.log(JSON.stringify([...t,...e].map(({mode,id,illustration,thumbnail})=>({mode,id,illustration,thumbnail}))));"
    runtime = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', code], cwd=ROOT, text=True))
    mapped = {key(entry): entry for entry in entries}
    require(len(runtime) == 56 and [key(entry) for entry in runtime] == [key(entry) for entry in entries], 'Runtime catalogue identity or order changed')
    for entry in runtime:
        for role, field in [('image', 'illustration'), ('thumbnail', 'thumbnail')]:
            require(entry[field] == './' + mapped[key(entry)][role]['path'].removeprefix('public/'), key(entry) + ': active runtime selected wrong asset')
    print(json.dumps({'verified': True, 'views': 56, 'active_files': 112,
                      'newly_reviewed': list(TARGETS), 'replacements_in_this_revision': 3,
                      'entries_carried_over_unchanged': 53, 'historical_v54_v58_v59_v60_verified': True,
                      'current_runtime_checked': True, 'reviews_bound_to_exported_bytes': True,
                      'independent_clinician_signoff': False}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reviews', type=Path)
    parser.add_argument('--preview-dir', type=Path, help='Encode candidates for pixel review only; do not create a release')
    parser.add_argument('--write', action='store_true')
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    try:
        require(args.verify != bool(args.reviews), 'Choose --verify or --reviews FILE')
        require(not (args.verify and (args.write or args.preview_dir)), '--verify is read-only')
        require(not (args.preview_dir and args.write), 'Preview exports cannot write a release')
        if args.verify:
            verify(args)
        elif args.preview_dir:
            preview(args)
        else:
            prepare(args)
    except (OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError) as error:
        parser.exit(1, f'Cannot package reference artwork v61: {error}\n')
