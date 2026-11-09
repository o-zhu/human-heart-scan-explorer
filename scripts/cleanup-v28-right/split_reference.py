#!/usr/bin/env python3
"""Split the two pinned dense reference gzip streams without recompression."""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
import tempfile

from exact_transport import MAX_PART_BYTES, read_encoded, read_surface, require

ROOT = Path(__file__).resolve().parents[2]
PATCH = ROOT / 'docs/cleanup-v28-right/patch'
NAMES = ('pulmonary-valve-lumen-surface', 'tricuspid-core-surface')


def sha_file(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def split(name, archive):
    policy_path = PATCH / f'{name}-policy.json'
    policy_hash = sha_file(policy_path)
    item = json.loads(policy_path.read_text())['surfaceReference']
    logical = PATCH / item['file']
    archive.mkdir(parents=True, exist_ok=True)
    saved = archive / logical.name
    if not logical.exists():
        read_surface(logical, item)
        require(saved.is_file() and sha_file(saved) == item['sha256'], 'Missing exact whole-stream archive.')
        return {'file': logical.name, 'alreadySplit': True, 'archive': str(saved)}
    require(logical.stat().st_size == item['compressedBytes'] and sha_file(logical) == item['sha256'], 'Reference differs from pinned policy.')
    # Stage and verify the absent-whole-file loading path before changing the
    # original location. Each part is an exact contiguous encoded byte range.
    with tempfile.TemporaryDirectory(prefix='reference-parts-', dir=PATCH) as tmp:
        stage = Path(tmp)
        parts = []
        with logical.open('rb') as stream:
            while True:
                block = stream.read(MAX_PART_BYTES)
                if not block:
                    break
                filename = f'{logical.name}.part-{len(parts) + 1:03d}'
                (stage / filename).write_bytes(block)
                parts.append({'file': filename, 'bytes': len(block), 'sha256': hashlib.sha256(block).hexdigest()})
        sidecar = {'version': 1, 'format': 'concatenated-encoded-parts', 'file': logical.name,
                   'compressedBytes': item['compressedBytes'], 'sha256': item['sha256'],
                   'decodedBytes': item['decodedBytes'], 'decodedSha256': item['decodedSha256'], 'parts': parts}
        sidecar_name = logical.name + '.parts.json'
        (stage / sidecar_name).write_text(json.dumps(sidecar, indent=2) + '\n')
        read_surface(stage / logical.name, item)
        for part in parts:
            destination = PATCH / part['file']
            require(not destination.exists() or sha_file(destination) == part['sha256'], 'Existing part has different bytes.')
            shutil.move(str(stage / part['file']), str(destination))
        shutil.move(str(stage / sidecar_name), str(PATCH / sidecar_name))
    if saved.exists():
        require(saved.stat().st_size == item['compressedBytes'] and sha_file(saved) == item['sha256'], 'Archive collision.')
        logical.unlink()  # An independently verified exact whole copy exists.
    else:
        shutil.move(str(logical), str(saved))
    read_surface(logical, item)
    require(sha_file(saved) == item['sha256'] and sha_file(policy_path) == policy_hash, 'Archive or pinned policy changed.')
    return {'file': logical.name, 'compressedBytes': item['compressedBytes'], 'sha256': item['sha256'],
            'partBytes': [p['bytes'] for p in parts], 'archive': str(saved), 'policySha256': policy_hash}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive-dir', type=Path, required=True)
    args = parser.parse_args()
    require(ROOT not in args.archive_dir.resolve().parents, 'Whole streams must be archived outside the repository.')
    print(json.dumps([split(name, args.archive_dir) for name in NAMES], indent=2))
