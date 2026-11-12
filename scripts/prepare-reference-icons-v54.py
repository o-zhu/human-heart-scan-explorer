#!/usr/bin/env python3
"""Package reviewed ChatGPT Image outputs without altering their anatomy.

Only uniform resampling and WebP encoding are performed. Source figures used
as generation references remain outside the repository. Requires Pillow and
Node; original generated PNGs and their QC manifests are explicit inputs.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'public/assets/reference-views-v54'
SOURCES = {
    'tte': 'https://www.asecho.org/wp-content/uploads/2019/01/2019_Comprehensive-TTE.pdf',
    'tee': 'https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf',
}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', required=True, type=Path)
    parser.add_argument('--partial', action='store_true', help='Preview available images; do not write the release manifest.')
    args = parser.parse_args()
    source = args.source_dir.resolve()
    code = "import {TTE_ATLAS_VIEWS} from './public/tte-atlas-data.js';import {TEE_ATLAS_VIEWS} from './public/tee-atlas-data.js';console.log(JSON.stringify([...TTE_ATLAS_VIEWS,...TEE_ATLAS_VIEWS]));"
    views = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', code], cwd=ROOT, text=True))
    records = {}
    for manifest in sorted(source.glob('*manifest*.json')):
        data = json.loads(manifest.read_text())
        for record in data if isinstance(data, list) else data.get('records', []):
            name = record.get('output') or record.get('output_path')
            if name and record.get('status') in ('approved', 'qc_pass'):
                records[Path(name).name] = record
    plan, missing = [], []
    for view in views:
        code = ('tte-' + str(view['tableRow']).replace('.', '-')) if view['mode'] == 'tte' else f"tee-{view['aseNumber']:02}"
        path = source / (code + '.png')
        if not path.exists() and code == 'tte-2-17':
            path = source / 'tte-2-17a.png'
        if not path.is_file() or (not args.partial and path.name not in records):
            missing.append(view['id'])
            continue
        plan.append((view, path, records.get(path.name)))
    if missing and not args.partial:
        raise SystemExit('Missing approved images/provenance: ' + ', '.join(missing))
    (DEST / 'thumbs').mkdir(parents=True, exist_ok=True)
    entries = []
    for view, path, record in plan:
        image = Image.open(path).convert('RGB')
        if image.width != image.height:
            raise SystemExit('Square source required; no cropping is permitted: ' + path.name)
        name = f"{view['mode']}-{view['id']}.webp"
        assets = {}
        for key, size, folder in [('image', 960, DEST), ('thumbnail', 384, DEST / 'thumbs')]:
            out = folder / name
            if not out.exists() or out.stat().st_mtime < path.stat().st_mtime:
                image.resize((size, size), Image.Resampling.LANCZOS).save(out, quality=91, method=6)
            assets[key] = {'path': str(out.relative_to(ROOT)), 'width': size, 'height': size, 'bytes': out.stat().st_size, 'sha256': sha(out)}
        if record:
            references = []
            for ref in record.get('references', record.get('refs', [])):
                ref = Path(ref)
                references.append({'name': ref.name, 'sha256': sha(ref)})
            entries.append({'id': view['id'], 'mode': view['mode'], 'name': view['name'], 'source': SOURCES[view['mode']],
                            'table': '2' if view['mode'] == 'tte' else '10', 'view_number': view.get('tableRow', view.get('aseNumber')),
                            'source_png_sha256': sha(path), **assets, 'generation': {'tool': 'ChatGPT Image / image_gen',
                            'prompt': record['prompt'], 'reference_inputs': references},
                            'qc': {'status': record['status'], 'review': record.get('qc', ''), 'revisions': record.get('revisions', record.get('regenerations', []))}})
    if not args.partial:
        out = ROOT / 'docs/reference-views-v54/asset-manifest.json'
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps({'schema_version': 1, 'count': len(entries), 'artwork': 'Original AI-generated educational schematics; source figures are internal references only.',
                                  'encoding': 'Square resampling only: 960px image, 384px thumbnail, WebP quality91. No manual anatomy edits.',
                                  'entries': entries}, indent=2) + '\n')
    print(json.dumps({'prepared': len(plan), 'expected': len(views), 'missing': missing, 'release_manifest': not args.partial}))


if __name__ == '__main__':
    main()
