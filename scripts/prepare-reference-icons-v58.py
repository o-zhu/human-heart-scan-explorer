#!/usr/bin/env python3
"""Package reviewed echo artwork and verify its complete, explicit view registry.

Only square resampling and WebP encoding are allowed here. Anatomical edits are
made with image_gen before review. A partial working manifest can be written
with --allow-pending, but the default release verification rejects it.
"""
import argparse
import hashlib
import io
import json
import re
import subprocess
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'docs/reference-views-v54/asset-manifest.json'
MANIFEST = ROOT / 'docs/reference-views-v58/asset-manifest.json'
REGISTRY = ROOT / 'public/reference-artwork-v58.js'
CHECKS = ('topology', 'view_identity', 'orientation', 'labels', 'phase', 'readability')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def key(entry):
    return entry['mode'] + ':' + entry['id']


def metadata(path, data, size):
    return {'path': path, 'width': size, 'height': size, 'bytes': len(data), 'sha256': sha(data)}


def registry_text(manifest_bytes, entries, complete):
    paths = {key(e): {'illustration': './' + e['image']['path'].removeprefix('public/'),
                     'thumbnail': './' + e['thumbnail']['path'].removeprefix('public/'),
                     'disposition': e['disposition']} for e in entries}
    return ("/** Generated from the v58 artwork manifest. No image-error fallback is used. */\n"
            f"export const REFERENCE_ARTWORK_MANIFEST_SHA256 = '{sha(manifest_bytes)}';\n"
            f"export const REFERENCE_ARTWORK_REVIEW_COMPLETE = {str(complete).lower()};\n"
            "const records = " + json.dumps(paths, indent=2, ensure_ascii=False) + ";\n"
            "export const REFERENCE_ARTWORK_V58 = Object.freeze(Object.fromEntries(\n"
            "  Object.entries(records).map(([key, value]) => [key, Object.freeze(value)])\n"
            "));\n\n"
            "export function referenceArtworkPaths(mode, id) {\n"
            "  const entry = REFERENCE_ARTWORK_V58[`${mode}:${id}`];\n"
            "  if (!entry) throw new Error(`Unknown reference artwork: ${mode}:${id}`);\n"
            "  return { illustration: entry.illustration, thumbnail: entry.thumbnail };\n"
            "}\n")


def checked_review(record, allow_pending):
    identity = key(record)
    disposition = record.get('disposition')
    require(disposition in ('pending', 'retain', 'replace'), identity + ': invalid disposition')
    review = record.get('review', {})
    if disposition == 'pending':
        require(allow_pending, identity + ': review is still pending')
        require(review.get('status') == 'pending', identity + ': ambiguous pending status')
        return False
    require(review.get('status') == 'pass', identity + ': accepted artwork needs a passing review')
    require(all(review.get('checks', {}).get(check) is True for check in CHECKS),
            identity + ': all anatomical and display gates must pass')
    for field in ('summary', 'phase', 'independent_review'):
        require(isinstance(review.get(field), str) and review[field].strip(), identity + ': missing ' + field)
    require(review.get('full_size_reviewed') is True and review.get('thumbnail_reviewed') is True,
            identity + ': full-size and thumbnail inspections are required')
    require(not review.get('hard_failures', []), identity + ': unresolved hard failure')
    sources = review.get('sources', [])
    require(sources and all(isinstance(s, dict) and s.get('url', '').startswith('https://') for s in sources),
            identity + ': source-backed review required')
    return True


def prepare(args):
    base = json.loads(BASE.read_text())['entries']
    submitted = json.loads(args.reviews.read_text())
    records = submitted if isinstance(submitted, list) else submitted['entries']
    require(len(records) == len({key(e) for e in records}) == 56, 'Exactly 56 unique review records are required')
    by_key = {key(e): e for e in records}
    require(set(by_key) == {key(e) for e in base}, 'Review records must exactly match the existing catalogue')
    pending, entries, writes = [], [], {}
    for old in base:
        record = by_key[key(old)]
        complete = checked_review(record, args.allow_pending)
        if not complete:
            pending.append(key(old))
        # The historical manifest is immutable evidence, not current approval.
        entry = {field: old[field] for field in ('id', 'mode', 'name', 'source', 'table', 'view_number')}
        entry.update(disposition=record['disposition'], review=record['review'],
                     previous_image=old['image'], previous_thumbnail=old['thumbnail'])
        if record['disposition'] == 'replace':
            generation = dict(record.get('generation', {}))
            require(generation.get('tool') in ('image_gen', 'ChatGPT Image / image_gen'), key(old) + ': image_gen provenance required')
            require(generation.get('prompt', '').strip(), key(old) + ': exact generation prompt required')
            source = Path(generation.pop('output_path'))
            require(source.is_file() and not source.is_symlink(), key(old) + ': missing generated source')
            source_bytes = source.read_bytes()
            with Image.open(io.BytesIO(source_bytes)) as original:
                require(original.width == original.height and original.width >= 960,
                        key(old) + ': square master of at least 960px required; cropping is not permitted')
                image = original.convert('RGB')
                for role, size, directory in [('image', 960, ''), ('thumbnail', 384, 'thumbs/')]:
                    path = f"public/assets/reference-views-v58/{directory}{old['mode']}-{old['id']}.webp"
                    output = io.BytesIO()
                    image.resize((size, size), Image.Resampling.LANCZOS).save(output, format='WEBP', quality=91, method=6)
                    data = output.getvalue()
                    writes[path] = data
                    entry[role] = metadata(path, data, size)
            references = []
            for reference in generation.pop('references', []):
                reference = dict(reference)
                local = reference.pop('path', None)
                if local:
                    path = Path(local)
                    require(path.is_file() and not path.is_symlink(), key(old) + ': missing reference input')
                    reference.update(name=path.name, sha256=sha(path.read_bytes()))
                references.append(reference)
            generation['reference_inputs'] = references
            entry.update(source_png_sha256=sha(source_bytes), generation=generation)
            require(entry['image']['sha256'] != old['image']['sha256'], key(old) + ': replacement must have changed pixels')
        else:
            entry.update(image=old['image'], thumbnail=old['thumbnail'])
        entries.append(entry)
    manifest = {'schema_version': 1, 'revision': 58, 'count': 56,
                'review_state': 'complete' if not pending else 'pending-review',
                'scope': 'AI-assisted source comparison of educational schematics; not independent clinical certification.',
                'encoding': '960px and 384px square WebP, quality 91. Resampling and encoding only; no anatomy edits.',
                'historical_manifest': 'docs/reference-views-v54/asset-manifest.json',
                'entries': entries}
    manifest_bytes = (json.dumps(manifest, indent=2, ensure_ascii=False) + '\n').encode()
    writes[str(MANIFEST.relative_to(ROOT))] = manifest_bytes
    writes[str(REGISTRY.relative_to(ROOT))] = registry_text(manifest_bytes, entries, not pending).encode()
    # Validate all original bytes and the complete proposal before the first write.
    for old in base:
        for role in ('image', 'thumbnail'):
            data = (ROOT / old[role]['path']).read_bytes()
            require(len(data) == old[role]['bytes'] and sha(data) == old[role]['sha256'], 'Historical artwork changed: ' + key(old))
    if args.write:
        for relative, data in writes.items():
            path = ROOT / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
    print(json.dumps({'written': bool(args.write), 'views': 56, 'replacements': sum(e['disposition'] == 'replace' for e in entries),
                      'retained': sum(e['disposition'] == 'retain' for e in entries), 'pending': pending,
                      'production_ready': not pending, 'new_asset_bytes': sum(len(v) for k, v in writes.items() if k.endswith('.webp'))}))


def verify(args):
    data = MANIFEST.read_bytes()
    manifest = json.loads(data)
    entries = manifest['entries']
    base = {key(e): e for e in json.loads(BASE.read_text())['entries']}
    require(len(entries) == len({key(e) for e in entries}) == manifest['count'] == 56, 'Incomplete or duplicated catalogue')
    require({key(e) for e in entries} == set(base), 'Manifest identity mismatch')
    complete = True
    for entry in entries:
        complete = checked_review(entry, args.allow_pending) and complete
        old = base[key(entry)]
        for role in ('image', 'thumbnail'):
            meta = entry[role]
            expected = (f"public/assets/reference-views-v58/{'thumbs/' if role == 'thumbnail' else ''}{entry['mode']}-{entry['id']}.webp"
                        if entry['disposition'] == 'replace' else old[role]['path'])
            require(meta['path'] == expected, key(entry) + ': unexpected asset path')
            path = ROOT / meta['path']
            require(path.is_file() and not path.is_symlink(), key(entry) + ': missing regular asset')
            content = path.read_bytes()
            require(len(content) == meta['bytes'] and sha(content) == meta['sha256'], key(entry) + ': asset checksum mismatch')
            with Image.open(io.BytesIO(content)) as image:
                require(image.format == 'WEBP' and image.size == ((960, 960) if role == 'image' else (384, 384)),
                        key(entry) + ': wrong dimensions or encoding')
            require(entry['previous_' + role] == old[role], key(entry) + ': original identity changed')
            require(sha((ROOT / old[role]['path']).read_bytes()) == old[role]['sha256'], key(entry) + ': original bytes changed')
            if entry['disposition'] != 'replace':
                require(meta == old[role], key(entry) + ': retained artwork changed')
        if entry['disposition'] == 'replace':
            require(re.fullmatch('[a-f0-9]{64}', entry.get('source_png_sha256', '')), key(entry) + ': missing master hash')
            require(entry.get('generation', {}).get('prompt', '').strip(), key(entry) + ': missing prompt')
    require(manifest['review_state'] == ('complete' if complete else 'pending-review'), 'Review state mismatch')
    require(REGISTRY.read_text() == registry_text(data, entries, complete), 'Runtime registry is stale; regenerate it')
    # Verify the frozen v58 package independently of later live catalogue revisions.
    # A newer packager owns verification of the current TTE/TEE runtime mapping.
    code = "import {REFERENCE_ARTWORK_V58 as records,referenceArtworkPaths} from './public/reference-artwork-v58.js';console.log(JSON.stringify(Object.keys(records).map(identity=>{const [mode,id]=identity.split(':');return {mode,id,...referenceArtworkPaths(mode,id)};})));"
    runtime = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', code], cwd=ROOT, text=True))
    require(len(runtime) == 56 and {key(e) for e in runtime} == set(base), 'Frozen v58 registry identity mismatch')
    mapped = {key(e): e for e in entries}
    for entry in runtime:
        for role, field in [('image', 'illustration'), ('thumbnail', 'thumbnail')]:
            require(entry[field] == './' + mapped[key(entry)][role]['path'].removeprefix('public/'), key(entry) + ': frozen v58 mapping mismatch')
    print(json.dumps({'verified': True, 'views': 56, 'assets': 112, 'original_assets_preserved': 112,
                      'review_complete': complete, 'registry_scope': 'frozen-v58',
                      'current_runtime_checked': False,
                      'replacements': sum(e['disposition'] == 'replace' for e in entries)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reviews', type=Path)
    parser.add_argument('--write', action='store_true')
    parser.add_argument('--verify', action='store_true')
    parser.add_argument('--allow-pending', action='store_true', help='Development only; output cannot be claimed release-ready.')
    args = parser.parse_args()
    require(args.verify != bool(args.reviews), 'Choose exactly one of --verify or --reviews FILE')
    require(not (args.verify and args.write), '--verify is read-only')
    verify(args) if args.verify else prepare(args)
