#!/usr/bin/env python3
"""Package the complete v60 review and verify its exact runtime asset mapping.

Only uniform resampling/encoding occurs here. Every review must be tied to
the actual exported image and thumbnail bytes; a prompt or a high total score
alone cannot satisfy a release gate. Historical assets/manifests stay intact.
"""
import argparse
import copy
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'docs/reference-views-v59/asset-manifest.json'
DIRECTORY = ROOT / 'docs/reference-views-v60'
MANIFEST = DIRECTORY / 'asset-manifest.json'
REGISTRY = ROOT / 'public/reference-artwork-v60.js'
DOMAINS = ('view', 'topology', 'walls', 'valves', 'attachments', 'labels', 'style', 'thumbnail')
IDENTITY_FIELDS = ('id', 'mode', 'name', 'source', 'table', 'view_number')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def key(entry):
    return entry['mode'] + ':' + entry['id']


def regular(path):
    require(path.is_file() and not path.is_symlink(), f'Missing regular file: {path}')
    return path.read_bytes()


def metadata(path, data, size):
    return {'path': path, 'width': size, 'height': size, 'bytes': len(data), 'sha256': sha(data)}


def registry_text(data, entries):
    records = {key(e): {'illustration': './' + e['image']['path'].removeprefix('public/'),
                        'thumbnail': './' + e['thumbnail']['path'].removeprefix('public/'),
                        'disposition': e['disposition']} for e in entries}
    return ("/** Generated from the v60 artwork manifest. No image-error fallback is used. */\n"
            f"export const REFERENCE_ARTWORK_MANIFEST_SHA256 = '{sha(data)}';\n"
            "export const REFERENCE_ARTWORK_REVIEW_COMPLETE = true;\n"
            "const records = " + json.dumps(records, indent=2, ensure_ascii=False) + ";\n"
            "export const REFERENCE_ARTWORK_V60 = Object.freeze(Object.fromEntries(\n"
            "  Object.entries(records).map(([key, value]) => [key, Object.freeze(value)])\n"
            "));\n\n"
            "export function referenceArtworkPaths(mode, id) {\n"
            "  const entry = REFERENCE_ARTWORK_V60[`${mode}:${id}`];\n"
            "  if (!entry) throw new Error(`Unknown reference artwork: ${mode}:${id}`);\n"
            "  return { illustration: entry.illustration, thumbnail: entry.thumbnail };\n"
            "}\n")


def checked_review(entry):
    identity = key(entry)
    review = entry.get('review', {})
    require(entry.get('disposition') in ('retain', 'replace'), identity + ': unresolved disposition')
    require(review.get('status') == 'pass', identity + ': review is not accepted')
    scores = review.get('domain_scores', {})
    require(set(scores) == set(DOMAINS) and all(type(scores[d]) is int and scores[d] == 2 for d in DOMAINS),
            identity + ': all eight domains must be resolved; a total cannot hide a failed domain')
    require(review.get('total_score') == 16, identity + ': inconsistent score total')
    require(all(review.get('checks', {}).get(d) is True for d in DOMAINS), identity + ': a hard gate is unresolved')
    require(not review.get('hard_failures'), identity + ': hard failures remain')
    for field in ('summary', 'phase', 'independent_review'):
        require(isinstance(review.get(field), str) and review[field].strip(), identity + ': missing ' + field)
    require(review.get('boundary_inventory') and isinstance(review['boundary_inventory'], list), identity + ': boundary inventory required')
    require(all(review.get(field) is True for field in ('full_size_reviewed', 'thumbnail_reviewed', 'compact_size_reviewed')),
            identity + ': actual 960px, 384px and 200px review is required')
    sources = review.get('sources', [])
    require(sources and all(isinstance(s, dict) and s.get('url', '').startswith('https://') for s in sources),
            identity + ': exact source evidence is required')
    require(review.get('initial_audit'), identity + ': fresh original-image audit is required')
    exported = review.get('export_review', {})
    require(exported.get('status') == 'pass' and exported.get('observations'), identity + ': exported pixels are not reviewed')
    for role in ('image', 'thumbnail'):
        require(exported.get(role + '_sha256') == entry[role]['sha256'], identity + ': review is not bound to exact ' + role + ' bytes')
    if entry['disposition'] == 'replace':
        require(re.fullmatch('[a-f0-9]{64}', entry.get('source_png_sha256', '')), identity + ': missing selected master hash')
        generation = entry.get('generation', {})
        require(generation.get('tool') == 'image_gen', identity + ': original image-edit provenance required')
        require(generation.get('selected_master_sha256') == entry['source_png_sha256'],
                identity + ': selected master identity mismatch')
        require(generation.get('prompt', '').strip(), identity + ': exact final prompt required')
        require(generation.get('reference_inputs'), identity + ': reference identities required')
        require(generation.get('attempts'), identity + ': generation and rejection history required')


def baseline():
    data = regular(BASE)
    base = json.loads(data)
    require(base.get('revision') == 59 and base.get('count') == 56, 'Unexpected baseline')
    require(len(base['entries']) == len({key(e) for e in base['entries']}) == 56, 'Invalid baseline catalogue')
    for entry in base['entries']:
        for role in ('image', 'thumbnail'):
            previous = entry[role]
            content = regular(ROOT / previous['path'])
            require(sha(content) == previous['sha256'] and len(content) == previous['bytes'], key(entry) + ': historical bytes changed')
    return data, base


def validate_manifest(manifest, base_data, base):
    require(manifest.get('schema_version') == 2 and manifest.get('revision') == 60, 'Unexpected schema/revision')
    entries = manifest.get('entries', [])
    require(len(entries) == len({key(e) for e in entries}) == manifest.get('count') == 56, 'Exactly 56 unique entries required')
    require([key(e) for e in entries] == [key(e) for e in base['entries']], 'Catalogue identity or order changed')
    require(manifest.get('review_state') == 'complete', 'Review is not complete')
    require(manifest.get('historical_manifest') == BASE.relative_to(ROOT).as_posix()
            and manifest.get('historical_manifest_sha256') == sha(base_data), 'Historical manifest identity mismatch')
    require(manifest.get('guidelines_sha256') == sha(regular(DIRECTORY / 'GUIDELINES.md')), 'Guidelines fingerprint changed')
    scope = manifest.get('review_scope', {})
    require(scope.get('newly_reviewed') == [key(e) for e in entries] and scope.get('carried_over_review_count') == 0,
            'Every current image needs a fresh review')
    require(scope.get('independent_clinician_signoff') is False, 'Do not imply unperformed clinical certification')
    require(scope.get('retained_asset_count') == sum(e.get('disposition') == 'retain' for e in entries)
            and scope.get('replacement_count') == sum(e.get('disposition') == 'replace' for e in entries),
            'Review-scope counts do not match the actual dispositions')
    for entry, old in zip(entries, base['entries']):
        require(all(entry.get(field) == old[field] for field in IDENTITY_FIELDS), key(entry) + ': view identity changed')
        checked_review(entry)
        for role, directory in [('image', ''), ('thumbnail', 'thumbs/')]:
            require(entry['previous_' + role] == old[role], key(entry) + ': wrong original identity')
            expected = (f"public/assets/reference-views-v60/{directory}{entry['mode']}-{entry['id']}.webp"
                        if entry['disposition'] == 'replace' else old[role]['path'])
            require(entry[role]['path'] == expected, key(entry) + ': unexpected asset path')
            if entry['disposition'] == 'retain':
                require(entry[role] == old[role], key(entry) + ': retained image bytes changed')
        if entry['disposition'] == 'replace':
            require(entry['image']['sha256'] != old['image']['sha256'], key(entry) + ': replacement is unchanged')


def prepare(args):
    base_data, base = baseline()
    submitted = json.loads(regular(args.reviews))
    records = submitted if isinstance(submitted, list) else submitted['entries']
    require(len(records) == len({key(e) for e in records}) == 56, 'Exactly 56 unique accepted reviews required')
    by_key = {key(e): e for e in records}
    require(set(by_key) == {key(e) for e in base['entries']}, 'Reviews do not match the catalogue')
    entries, writes = [], {}
    for old in base['entries']:
        record = by_key[key(old)]
        entry = {field: old[field] for field in IDENTITY_FIELDS}
        entry.update(disposition=record['disposition'], review=copy.deepcopy(record['review']),
                     previous_image=copy.deepcopy(old['image']), previous_thumbnail=copy.deepcopy(old['thumbnail']))
        if entry['disposition'] == 'replace':
            generation = copy.deepcopy(record['generation'])
            master = Path(generation.pop('output_path'))
            master_bytes = regular(master)
            require(generation.get('selected_master_sha256') == sha(master_bytes),
                    key(entry) + ': selected master changed after review')
            with Image.open(io.BytesIO(master_bytes)) as original:
                require(original.width == original.height and original.width >= 960, key(entry) + ': square master >=960px required; no crop allowed')
                image = original.convert('RGB')
                for role, size, directory in [('image', 960, ''), ('thumbnail', 384, 'thumbs/')]:
                    path = f"public/assets/reference-views-v60/{directory}{entry['mode']}-{entry['id']}.webp"
                    output = io.BytesIO()
                    image.resize((size, size), Image.Resampling.LANCZOS).save(output, format='WEBP', quality=91, method=6)
                    data = output.getvalue()
                    writes[path] = data
                    entry[role] = metadata(path, data, size)
            refs = []
            for reference in generation.pop('references', []):
                reference = copy.deepcopy(reference)
                path = reference.pop('path', None)
                if path:
                    file = Path(path)
                    digest = sha(regular(file))
                    require(reference.get('sha256') == digest,
                            key(entry) + ': generation reference changed or lacks its recorded input hash: ' + file.name)
                    reference.update(name=file.name, sha256=digest)
                refs.append(reference)
            generation['reference_inputs'] = refs or generation.get('reference_inputs', [])
            entry.update(source_png_sha256=sha(master_bytes), generation=generation)
        else:
            entry.update(image=copy.deepcopy(old['image']), thumbnail=copy.deepcopy(old['thumbnail']))
        checked_review(entry)
        entries.append(entry)
    manifest = {
        'schema_version': 2, 'revision': 60, 'count': 56, 'review_state': 'complete',
        'scope': 'Fresh AI-assisted source comparison and visual QC of all 56 educational schematics; no independent clinician certification.',
        'review_scope': {'newly_reviewed': [key(e) for e in entries], 'carried_over_review_count': 0,
                         'retained_asset_count': sum(e['disposition'] == 'retain' for e in entries),
                         'replacement_count': sum(e['disposition'] == 'replace' for e in entries),
                         'independent_clinician_signoff': False},
        'encoding': '960px and 384px square WebP, quality 91, method 6. Uniform resampling and encoding only.',
        'historical_manifest': BASE.relative_to(ROOT).as_posix(), 'historical_manifest_sha256': sha(base_data),
        'guidelines_sha256': sha(regular(DIRECTORY / 'GUIDELINES.md')), 'entries': entries,
    }
    validate_manifest(manifest, base_data, base)
    data = (json.dumps(manifest, indent=2, ensure_ascii=False) + '\n').encode()
    writes[MANIFEST.relative_to(ROOT).as_posix()] = data
    writes[REGISTRY.relative_to(ROOT).as_posix()] = registry_text(data, entries).encode()
    if args.write:
        for path, content in writes.items():
            destination = ROOT / path
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(content)
    print(json.dumps({'written': bool(args.write), 'views': 56, 'replacements': manifest['review_scope']['replacement_count'],
                      'retained': manifest['review_scope']['retained_asset_count'], 'fresh_review_count': 56,
                      'manifest_sha256': sha(data), 'new_asset_bytes': sum(len(v) for p, v in writes.items() if p.endswith('.webp'))}))


def verify(args):
    base_data, base = baseline()
    data = regular(MANIFEST)
    manifest = json.loads(data)
    validate_manifest(manifest, base_data, base)
    for entry in manifest['entries']:
        for role, size in [('image', 960), ('thumbnail', 384)]:
            meta = entry[role]
            content = regular(ROOT / meta['path'])
            require(sha(content) == meta['sha256'] and len(content) == meta['bytes'], key(entry) + ': hash/size mismatch')
            require(meta.get('width') == meta.get('height') == size, key(entry) + ': bad dimension metadata')
            with Image.open(io.BytesIO(content)) as image:
                require(image.format == 'WEBP' and image.size == (size, size), key(entry) + ': wrong image encoding/dimensions')
    require(regular(REGISTRY).decode() == registry_text(data, manifest['entries']), 'Explicit registry is stale')
    historical = bool(getattr(args, 'historical', False))
    code = ("import {REFERENCE_ARTWORK_V60 as records} from './public/reference-artwork-v60.js';console.log(JSON.stringify(Object.entries(records).map(([key,value])=>({mode:key.split(':')[0],id:key.split(':')[1],...value}))));"
            if historical else
            "import {TTE_ATLAS_VIEWS as t} from './public/tte-atlas-data.js';import {TEE_ATLAS_VIEWS as e} from './public/tee-atlas-data.js';console.log(JSON.stringify([...t,...e].map(({mode,id,illustration,thumbnail})=>({mode,id,illustration,thumbnail}))));")
    runtime = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', code], cwd=ROOT, text=True))
    mapped = {key(e): e for e in manifest['entries']}
    require(len(runtime) == 56 and {key(e) for e in runtime} == set(mapped), 'Runtime catalogue incomplete')
    for entry in runtime:
        for role, field in [('image', 'illustration'), ('thumbnail', 'thumbnail')]:
            require(entry[field] == './' + mapped[key(entry)][role]['path'].removeprefix('public/'), key(entry) + ': runtime selected wrong asset')
    print(json.dumps({'verified': True, 'views': 56, 'active_files': 112, 'fresh_review_count': 56,
                      'replacement_count': manifest['review_scope']['replacement_count'], 'current_runtime_checked': not historical,
                      'frozen_registry_checked': True, 'historical_package_verified': historical,
                      'historical_manifest_and_assets_preserved': True, 'all_eight_domains_resolved': True,
                      'reviews_bound_to_exported_bytes': True, 'independent_clinician_signoff': False}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reviews', type=Path)
    parser.add_argument('--write', action='store_true')
    parser.add_argument('--verify', action='store_true')
    parser.add_argument('--historical', action='store_true', help='Verify the frozen v60 registry and assets without comparing a newer active atlas')
    args = parser.parse_args()
    require(args.verify != bool(args.reviews), 'Choose --verify or --reviews FILE')
    require(not (args.verify and args.write), '--verify is read-only')
    require(not args.historical or args.verify, '--historical applies only to --verify')
    verify(args) if args.verify else prepare(args)
