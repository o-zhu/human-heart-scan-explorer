#!/usr/bin/env python3
"""Verify the two v44 orientation meshes and omit only their build copies.

Source meshes, the public manifest, URLs, and earlier storage collections are
unchanged. This script performs no uploads, deployment, or archive-budget check.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = 'assets/probe-heart-v44/manifest.json'
INDEX = 'server/probe-heart-index-v44.json'
POLICY_SOURCE = 'server/probe-heart-store-v44.mjs'
POLICIES = {'probe-heart-v44:seed', 'probe-heart-v44:read-only'}
MARKER = 'Probe whole-heart data is read-only.'
EXPECTED = {
    's-20-29.hfm.gz': {'bytes': 2880964,
                      'sha256': '1056b73b72c8243648c0c16b12d2ad1c198649b2b808a2dd18d12c981de028e3',
                      'contentType': 'application/octet-stream'},
    's-20-28.hfm.gz': {'bytes': 2865878,
                      'sha256': '1b656a9c7b86284e01c1ed32c86e6a5e458242326bff5d76541d0d2202875118',
                      'contentType': 'application/octet-stream'},
}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def safe_path(root, name, *, directory=False, missing=False):
    require(not Path(name).is_absolute() and '..' not in Path(name).parts,
            'Staging paths must remain inside the selected checkout.')
    current = root
    require(root.is_dir() and not root.is_symlink(), 'The checkout must be a real directory.')
    parts = Path(name).parts
    for index, part in enumerate(parts):
        current = current / part
        require(not current.is_symlink(), 'Refusing a symbolic staging path: '+name)
        if index < len(parts)-1 and current.exists():
            require(current.is_dir(), 'Non-directory in staging path: '+name)
    if not (missing and not current.exists()):
        require(current.is_dir() if directory else current.is_file(),
                'Missing or nonregular staging path: '+name)
    return current


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024*1024), b''):
            digest.update(block)
    return digest.hexdigest()


def verify_file(path, entry):
    require(path.is_file() and not path.is_symlink(), 'Missing or symbolic mesh: '+path.name)
    require(path.stat().st_size == entry['bytes'] and sha(path) == entry['sha256'],
            'Mesh byte length or SHA-256 does not match: '+path.name)


def load_index(root):
    index = json.loads(safe_path(root, INDEX).read_text(encoding='utf-8'))
    require(index == EXPECTED, 'The probe-heart index must contain exactly the two reviewed v44 meshes.')
    manifest_path = safe_path(root, 'public/'+MANIFEST)
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    require(manifest.get('schemaVersion') == 1 and manifest.get('format') == 'HFM1',
            'Unrecognized whole-heart model manifest.')
    donors = manifest.get('donors', [])
    require(isinstance(donors, list) and len(donors) == 3 and
            {item.get('donorId') for item in donors} == {'ladaf-2021-17','s-20-29','s-20-28'},
            'The whole-heart manifest must preserve the three source identities.')
    records = {item['donorId']:item for item in donors}
    require(records['ladaf-2021-17'].get('lod', {}).get('url') == './assets/fine-surface-v19/balanced.hfm.gz',
            'LADAF must keep its existing balanced mesh delivery path.')
    for name, entry in index.items():
        donor = name.removesuffix('.hfm.gz')
        lod = records[donor].get('lod', {})
        require(lod.get('url') == './assets/probe-heart-v44/'+name and
                lod.get('compressedBytes') == entry['bytes'] and lod.get('sha256') == entry['sha256'],
                'Whole-heart manifest differs from the reviewed mesh index: '+name)
        verify_file(safe_path(root, 'public/assets/probe-heart-v44/'+name), entry)
    return index, manifest_path


def validate_compiled(root, index, seed):
    source = safe_path(root, POLICY_SOURCE).read_text(encoding='utf-8')
    match = re.search(r"^export const probeHeartV44ReleasePolicy\s*=\s*'([^']+)';", source, re.MULTILINE)
    expected = 'probe-heart-v44:seed' if seed else 'probe-heart-v44:read-only'
    require(match is not None and match.group(1) == expected,
            'Explicit seed/final staging must match the source probe-heart release policy.')
    server = safe_path(root, 'dist/server', directory=True)
    compiled_parts = []
    for path in server.rglob('*.js'):
        checked = safe_path(root, path.relative_to(root).as_posix())
        compiled_parts.append(checked.read_text(encoding='utf-8'))
    compiled = '\n'.join(compiled_parts)
    require(MARKER in compiled, 'The built Worker is missing the probe-heart handler.')
    require(expected in compiled and all(other not in compiled for other in POLICIES-{expected}),
            'The built Worker has a stale or conflicting probe-heart release policy.')
    for name, entry in index.items():
        records = re.findall(r'[\"\x27`]'+re.escape(name)+r'[\"\x27`]\s*:\s*\{([^{}]*)\}', compiled)
        require(records, 'The built Worker is missing a probe-heart index record: '+name)
        for record in records:
            require(re.search(r'[\"\x27`]?bytes[\"\x27`]?\s*:\s*'+str(entry['bytes'])+r'\b', record) and
                    re.search(r'[\"\x27`]?sha256[\"\x27`]?\s*:\s*[\"\x27`]'+entry['sha256']+r'[\"\x27`]', record) and
                    re.search(r'[\"\x27`]?contentType[\"\x27`]?\s*:\s*[\"\x27`]application/octet-stream[\"\x27`]', record),
                    'The built Worker contains a stale probe-heart index record: '+name)
    return expected


def stage(*, root=ROOT, seed=False):
    root = Path(root).absolute()
    index, manifest_path = load_index(root)
    policy = validate_compiled(root, index, seed)
    safe_path(root, 'dist/client/assets/probe-heart-v44', directory=True)
    built_manifest = safe_path(root, 'dist/client/'+MANIFEST)
    require(built_manifest.read_bytes() == manifest_path.read_bytes(),
            'The built whole-heart manifest differs from source; rebuild before staging.')
    plan = []
    for name, entry in index.items():
        target = safe_path(root, 'dist/client/assets/probe-heart-v44/'+name, missing=True)
        if target.exists():
            verify_file(target, entry)
            plan.append((target,entry['bytes']))
    receipt = safe_path(root, '.sites-runtime/probe-heart-staging-v44.json', missing=True)
    # All sources, compiled policy/index, manifest, and available build copies
    # have passed before either mesh is removed. No unrelated file is selected.
    for path, _ in plan:
        path.unlink()
    report = {'verified':True, 'seed':seed, 'compiledReleasePolicy':policy,
              'publicServingEnabled':not seed, 'uploadsEnabled':seed,
              'objects':len(index), 'collectionBytes':sum(item['bytes'] for item in index.values()),
              'removedBuildCopies':len(plan), 'removedBuildBytes':sum(size for _,size in plan),
              'removedBuildPaths':[path.relative_to(root).as_posix() for path,_ in plan],
              'retainedManifest':MANIFEST, 'sourceManifestSha256':sha(manifest_path),
              'sourceFilesUnchanged':True, 'publicUrlsUnchanged':True, 'historicalBanksUnchanged':True}
    receipt.parent.mkdir(parents=True,exist_ok=True)
    receipt.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage', action='store_true', required=True)
    parser.add_argument('--seed', action='store_true', help='Explicit temporary seed build; never a public final release.')
    args = parser.parse_args(argv)
    try:
        print(json.dumps(stage(seed=args.seed),indent=2))
    except (OSError, ValueError, RuntimeError) as exc:
        parser.exit(2, 'Probe-heart staging stopped: '+str(exc)+'\n')


if __name__ == '__main__':
    main()
