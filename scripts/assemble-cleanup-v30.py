#!/usr/bin/env python3
"""Assemble matched v30 surfaces/masks after source review; do not activate them."""
from copy import deepcopy
from pathlib import Path
import argparse
import gzip
import hashlib
import importlib.util
import json
import sys
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'public/assets/cleanup-v30'
DOCS = ROOT / 'docs/cleanup-v30'
FINE = 'e50ab70a52373dc774cf6077ef906a753e56b78b9f9b646fba2ffe7220ff338c'
GENTLE = '175548ddaad01c409d59d561df6018c5cb0c90752b2ec771899c255065398dae'
WALL = 'ac5d0d8771272e5bb14e0ae8ef13aea171c8abeda24d754e0345e1328aa5fbea'
FILE_LIMIT = 8 * 1024 ** 2
PART_LIMIT = 4 * 1024 ** 2
GPU_LIMIT = 128 * 1024 ** 2
MASK_LIMIT = 24 * 1024 ** 2
digest = lambda b: hashlib.sha256(b).hexdigest()
encode = lambda x: (json.dumps(x, indent=2) + '\n').encode()


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def read(path):
    return json.loads(path.read_text())


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--left-entry', type=Path, default=ROOT / 'public/assets/cleanup-v30-left/manifest-entry.json')
    p.add_argument('--right-entries', type=Path, default=ROOT / 'public/assets/cleanup-v30-right/manifest-entries.json')
    p.add_argument('--verify-only', action='store_true')
    args = p.parse_args()
    left_entry_path, right_path = args.left_entry.resolve(), args.right_entries.resolve()
    previous_surface_path = ROOT / 'public/assets/cleanup-v29/surface-manifest.json'
    previous_lumen_path = ROOT / 'public/assets/cleanup-v29/lumen-manifest.json'
    previous_surface, previous_lumen = read(previous_surface_path), read(previous_lumen_path)
    checks = module('v29_asset_checks', ROOT / 'scripts/assemble-cleanup-v29.py')
    fine_path = ROOT / 'public/assets/ultra-volume-v7.json'
    assert digest(fine_path.read_bytes()) == FINE
    assert previous_surface['sourceMeshDecodedSha256'] == GENTLE
    files = {}

    def reviewed_entry(entry):
        path = ROOT / entry['reviewPolicy']['path']
        assert digest(path.read_bytes()) == entry['reviewPolicy']['sha256']
        policy = read(path)
        for key in ('id', 'lowerFullFineXYZ', 'upperFullFineXYZ'):
            assert entry[key] == policy[key], (entry['id'], key)
        for key in ('surface', 'lowBandMask'):
            # A matching policy hash alone does not bind the delivered mesh to
            # that review. Compare every asset field, allowing only location.
            assert {k: v for k, v in entry[key].items() if k not in ('url', 'file')} == {k: v for k, v in policy[key].items() if k not in ('url', 'file')}, (entry['id'], key)
            assert Path(entry[key].get('url', entry[key].get('file'))).name == Path(policy[key].get('file', policy[key].get('url'))).name
        return path, policy

    def canonicalize(entry, source_dir=None):
        entry = deepcopy(entry)
        for key in ('surface', 'lowBandMask'):
            meta = entry[key]
            source = source_dir / meta['file'] if source_dir and 'file' in meta else checks.public_path(meta['url'])
            data, raw = checks.checked(source, meta)
            assert len(data) < (48 * 1024 ** 2 if key == 'surface' else FILE_LIMIT), source
            if key == 'surface':
                checks.check_mesh(raw, meta)
            else:
                checks.check_mask(raw, meta)
            name = source.name
            assert name not in files or files[name] == data, 'Conflicting canonical filename.'
            files[name] = data
            meta.pop('file', None)
            meta['url'] = './assets/cleanup-v30/' + name
            if key == 'surface' and len(data) >= FILE_LIMIT:
                meta['parts'] = []
                for number, start in enumerate(range(0, len(data), PART_LIMIT)):
                    chunk = data[start:start + PART_LIMIT]
                    chunk_name = name[:-3] + f'.part-{number:03d}.gz'
                    assert chunk_name not in files
                    files[chunk_name] = chunk
                    meta['parts'].append({'url': './assets/cleanup-v30/' + chunk_name,
                                          'compressedBytes': len(chunk), 'sha256': digest(chunk)})
        return entry

    left_entry = read(left_entry_path)
    left_path, left = reviewed_entry(left_entry)
    left_entry = canonicalize(left_entry)
    right = read(right_path)
    assert right['sourceHfmDecodedSha256'] == GENTLE
    assert len(right['replacements']) == 2
    for entry in right['replacements']:
        reviewed_entry(entry)
    right_entries = [canonicalize(x) for x in right['replacements']]
    # Exterior work from v29 remains an exact, already-reviewed immutable input.
    exterior = deepcopy(next(x for x in previous_surface['patches'] if x['id'] == 'right-perivascular-v29'))
    patches = [left_entry, *right_entries, exterior]
    assert len({x['id'] for x in patches}) == 4
    for i, a in enumerate(patches):
        for b in patches[i + 1:]:
            assert any(a['upperFullFineXYZ'][k] <= b['lowerFullFineXYZ'][k]
                       or b['upperFullFineXYZ'][k] <= a['lowerFullFineXYZ'][k]
                       for k in range(3)), (a['id'], b['id'], 'overlapping replacement boxes')
    budget = {'patches': len(patches),
              'surfaceDecodedBytes': sum(x['surface']['decodedBytes'] for x in patches),
              'maskDecodedBytes': sum(x['lowBandMask']['decodedBytes'] for x in patches),
              'compressedBytes': sum(x[k]['compressedBytes'] for x in patches for k in ('surface', 'lowBandMask')),
              'triangles': sum(x['surface']['triangles'] for x in patches),
              'vertices': sum(x['surface']['vertices'] for x in patches)}
    budget['combinedDecodedBytes'] = budget['surfaceDecodedBytes'] + budget['maskDecodedBytes']
    assert budget['combinedDecodedBytes'] <= GPU_LIMIT and budget['maskDecodedBytes'] <= MASK_LIMIT

    # Rebuild the frozen wall repair independently and test the actual packed
    # exclusions, including overlaps with the expanded LVOT/mitral crop.
    sys.path.insert(0, str(ROOT / 'scripts/fine-detail-v23'))
    from source import FineSource
    wall_module = module('frozen_v27_wall', ROOT / 'scripts/cleanup-v27-wall/restore_wall.py')
    reader = FineSource(cache_bricks=8)
    wa, wb, wall, wall_report = wall_module.restore_all_selections(reader)
    assert wall_report['restoreMaskSha256'] == WALL and int(wall.sum()) == 109928
    patch_checks = []
    policy_paths = []
    prior_mask_checks = []
    for patch in patches:
        review = patch['reviewPolicy']
        path = ROOT / review['path']
        assert digest(path.read_bytes()) == review['sha256']
        policy_paths.append(path)
        policy = read(path)
        assert policy['originalSourceModified'] is False and policy['sourceCalibratedHU'] is False
        assert policy['source']['sourceManifestSha256'] == FINE
        counts = policy['counts']
        assert counts['boxBoundaryNonBaselineSamples'] == 0
        for key in ('surface', 'lowBandMask'):
            meta = patch[key]
            data = files.get(Path(meta['url']).name)
            if data is None:
                data, raw = checks.checked(checks.public_path(meta['url']), meta)
            else:
                raw = gzip.decompress(data)
                assert len(data) == meta['compressedBytes'] and digest(data) == meta['sha256']
                assert len(raw) == meta['decodedBytes'] and digest(raw) == meta['decodedSha256']
            if key == 'surface':
                checks.check_mesh(raw, meta)
            else:
                checks.check_mask(raw, meta)
                overlap = checks.wall_overlap(meta, raw, wa, wb, wall)
                assert overlap == 0, patch['id']
                if patch['id'] != exterior['id']:
                    lo, hi = np.array(patch['lowerFullFineXYZ']), np.array(patch['upperFullFineXYZ'])
                    old = [x for x in previous_surface['patches'] if np.all(np.array(x['lowerFullFineXYZ']) >= lo) and np.all(np.array(x['upperFullFineXYZ']) <= hi)]
                    assert len(old) == 1, (patch['id'], 'prior region must be unambiguous')
                    old = old[0]
                    _, old_raw = checks.checked(checks.public_path(old['lowBandMask']['url']), old['lowBandMask'])
                    unpack = lambda buf, mask: np.unpackbits(np.frombuffer(buf, np.uint8).reshape(mask['storageDimensionsXYZ'][::-1]), axis=2, count=mask['dimensionsXYZ'][0], bitorder='little')
                    old_bits, new_bits = unpack(old_raw, old['lowBandMask']), unpack(raw, meta)
                    a, b = np.array(old['lowerFullFineXYZ']) - lo, np.array(old['upperFullFineXYZ']) - lo
                    region = tuple(slice(int(x), int(y)) for x, y in zip(a[::-1], b[::-1]))
                    lost = int(np.count_nonzero(old_bits & (1 - new_bits[region])))
                    assert lost == 0, (patch['id'], 'previous exclusions reappeared', lost)
                    prior_mask_checks.append({'id': patch['id'], 'previousId': old['id'], 'previousExcludedSamples': int(old_bits.sum()), 'previousExclusionsLost': lost})
                    del old_bits, new_bits, old_raw
        patch_checks.append({'id': patch['id'], 'sourcePolicySha256': review['sha256'],
                             'restoredWallOverlapSamples': overlap, 'boxBoundaryNonBaselineSamples': 0,
                             'reviewedCounts': deepcopy(counts)})

    lumen = deepcopy(previous_lumen)
    assert lumen['sourceManifestSha256'] == FINE
    lumen_checks = []
    for item in lumen['masks']:
        _, raw = checks.checked(checks.public_path(item['url']), item)
        checks.check_mask(raw, item)
        overlap = checks.wall_overlap(item, raw, wa, wb, wall)
        assert overlap == 0
        lumen_checks.append({'id': item['id'], 'sha256': item['sha256'],
                             'decodedSha256': item['decodedSha256'], 'restoredWallOverlapSamples': overlap})
    assert lumen['masks'] == previous_lumen['masks']
    surface = {**previous_surface, 'id': 'ladaf-reviewed-source-surfaces-v30', 'patches': patches,
               'predecessorManifestSha256': digest(previous_surface_path.read_bytes()),
               'processing': 'Source-intensity and spatial-coherence reconstruction in serially reviewed LVOT/mitral, pulmonary/outflow and RV/chordal regions. The full visible depth behind the reported cuts is included. Bounded fields retain the baseline source isovalue at replacement-box faces.',
               'sourceCalibratedHU': False, 'budget': budget,
               'reviewedUserSections': {'coronal': [190], 'sagittal': [293]}}
    surface.pop('replaces', None)
    lumen.update(id='ladaf-reviewed-lumen-display-v30', predecessorManifestSha256=digest(previous_lumen_path.read_bytes()),
                 surfaceRefinementManifestUrl='./assets/cleanup-v30/surface-manifest.json',
                 description='Exact v29 chamber/PV masks, with expanded matching source-coherence surfaces for the reviewed outflow and valve/chordal regions.',
                 buildProvenance={'scope': 'Canonical v30 assembly; all four prior chamber masks and the v29 exterior surface/mask are exact immutable inputs.',
                                  'assembler': 'scripts/assemble-cleanup-v30.py'})
    files['surface-manifest.json'] = encode(surface)
    files['lumen-manifest.json'] = encode(lumen)
    inputs = [Path(__file__), ROOT / 'scripts/assemble-cleanup-v29.py', previous_surface_path,
              previous_lumen_path, left_entry_path, left_path, right_path, fine_path, *policy_paths]
    receipt = {'sourceManifestSha256': FINE, 'sourceGeometrySha256': GENTLE, 'source': reader.receipt(),
               'inputSha256': {str(p.relative_to(ROOT)): digest(p.read_bytes()) for p in inputs},
               'outputs': [{'path': 'public/assets/cleanup-v30/' + name, 'bytes': len(data), 'sha256': digest(data)} for name, data in sorted(files.items())],
               'fourRegionsDisjoint': True,
               'budget': {**budget, 'maximumCombinedDecodedBytes': GPU_LIMIT, 'maximumMaskDecodedBytes': MASK_LIMIT},
               'eachNewHostedGzipObjectBelowBytes': FILE_LIMIT,
               'multipartChunkMaximumBytes': PART_LIMIT,
               'multipartSurfaceCount': sum(bool(x['surface'].get('parts')) for x in patches),
               'multipartTransportPreservesFullGzipBytes': True,
               'exactV29ExteriorReused': True, 'exactFourPriorLumenMasksReused': True,
               'restoredWallSamples': 109928, 'restoredWallMaskSha256': WALL, 'restoredWallOverlapSamples': 0,
               'patchChecks': patch_checks, 'priorLocalMaskChecks': prior_mask_checks, 'lumenChecks': lumen_checks, 'runtimeActivationChanged': False, 'sourceCalibratedHU': False,
               'limitations': ['Display exclusions do not establish histological identity.',
                              'Local surfaces are reversible reconstruction derivatives and are not a clinical segmentation.',
                              'Source, decoded-asset and rendering checks do not establish clinical completeness.']}
    if args.verify_only:
        for name, data in files.items():
            assert (PUBLIC / name).read_bytes() == data, name
        assert (DOCS / 'assembly.json').read_bytes() == encode(receipt)
    else:
        PUBLIC.mkdir(parents=True, exist_ok=True)
        DOCS.mkdir(parents=True, exist_ok=True)
        for name, data in files.items():
            (PUBLIC / name).write_bytes(data)
        (DOCS / 'assembly.json').write_bytes(encode(receipt))
    print(json.dumps({'verifyOnly': args.verify_only, 'newFiles': len(files), 'budget': budget,
                      'allFourDisjoint': True, 'restoredWallSamples': 109928}, indent=2))


if __name__ == '__main__':
    main()
