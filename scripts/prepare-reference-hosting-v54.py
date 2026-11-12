#!/usr/bin/env python3
"""Omit exact superseded illustration build copies; retain every source file."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def stage():
    docs = ROOT / 'docs/reference-views-v54'
    retired = json.loads((docs / 'retired-illustrations.json').read_text())['entries']
    current = json.loads((docs / 'asset-manifest.json').read_text())['entries']
    assert len(retired) == len(current) == 56
    assert {(e['mode'], e['id']) for e in retired} == {(e['mode'], e['id']) for e in current}
    replacements = {item[key]['path']: item[key] for item in current for key in ('image', 'thumbnail')}
    # All replacements must be present, exact and bounded before retiring art.
    for path, meta in replacements.items():
        source = ROOT / path
        target = ROOT / 'dist/client' / Path(path).relative_to('public')
        assert source.is_file() and target.is_file() and not source.is_symlink() and not target.is_symlink()
        assert source.stat().st_size == target.stat().st_size == meta['bytes']
        assert sha(source) == sha(target) == meta['sha256']
    plan = []
    for item in retired:
        relative = Path(item['path'])
        assert relative.suffix == '.webp' and relative.name == item['id'] + '.webp'
        assert str(relative.parent) == {'tte': 'public/assets/tte-atlas/art-v1', 'tee': 'public/assets/tee-atlas/art-v2'}[item['mode']]
        assert item['path'] not in replacements
        source = ROOT / relative
        target = ROOT / 'dist/client' / relative.relative_to('public')
        assert source.is_file() and not source.is_symlink()
        assert source.stat().st_size == item['bytes'] and sha(source) == item['sha256']
        if target.exists():
            assert target.is_file() and not target.is_symlink()
            assert target.stat().st_size == item['bytes'] and sha(target) == item['sha256']
            plan.append((target, item['bytes']))
    for path, _ in plan:
        path.unlink()
    report = {'verified': True, 'replacementViews': 56, 'replacementFiles': len(replacements),
              'removedBuildCopies': len(plan), 'removedBuildBytes': sum(size for _, size in plan),
              'originalSourceFilesRetained': True, 'scientificAssetsChanged': False}
    receipt = ROOT / '.sites-runtime/reference-icon-staging-v54.json'
    receipt.parent.mkdir(exist_ok=True)
    receipt.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage', action='store_true', required=True)
    parser.parse_args()
    stage()
