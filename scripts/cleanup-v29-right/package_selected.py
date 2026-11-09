#!/usr/bin/env python3
"""Verify and package the two reviewed v29 right-sided display patches.

Does not edit the canonical manifest or historical assets. Large pre-reduction
SFR references stay in the reproducible analysis directory, with hashes in the
verbatim policy copies. Only the selected runtime HFM/mask pairs are packaged.
"""
from pathlib import Path
import argparse
import gzip
import hashlib
import json
import shutil

ROOT = Path(__file__).resolve().parents[2]


def checked_file(path, meta):
    data = path.read_bytes()
    assert len(data) == meta['compressedBytes'], path
    assert hashlib.sha256(data).hexdigest() == meta['sha256'], path
    raw = gzip.decompress(data)
    assert len(raw) == meta['decodedBytes'], path
    assert hashlib.sha256(raw).hexdigest() == meta['decodedSha256'], path
    return data


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--pulmonary', type=Path, required=True)
    parser.add_argument('--exterior', type=Path, required=True)
    args = parser.parse_args()
    out = ROOT / 'public/assets/cleanup-v29-right'
    docs = ROOT / 'docs/cleanup-v29-right/patch'
    out.mkdir(parents=True, exist_ok=True)
    docs.mkdir(parents=True, exist_ok=True)
    entries = []
    for path in [args.pulmonary, args.exterior]:
        policy = json.loads(path.read_text())
        assert policy['originalSourceModified'] is False
        assert policy['sourceCalibratedHU'] is False
        assert policy['counts']['lostProtected155Samples'] == 0
        assert policy['counts']['lostRaw190Samples'] == 0
        assert policy['counts']['boxBoundaryNonBaselineSamples'] == 0
        entry = {
            'id': policy['id'],
            'lowerFullFineXYZ': policy['lowerFullFineXYZ'],
            'upperFullFineXYZ': policy['upperFullFineXYZ'],
            'reviewPolicy': {
                'path': str((docs / path.name).relative_to(ROOT)),
                'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            },
            'sourceSigmaFineSamples': policy['sourceSigmaFineSamples'],
            'baselineDisplayIntensity': policy['baselineThreshold'],
            'maximumReviewedDisplayIntensity': policy['counts']['maximumLocalThreshold'],
            'sourceCalibratedHU': False,
        }
        for kind in ['surface', 'lowBandMask']:
            metadata = policy[kind]
            data = checked_file(path.parent / metadata['file'], metadata)
            # Existing loader deliberately bounds any single gzip object.
            assert len(data) < 8 * 1024 * 1024
            (out / metadata['file']).write_bytes(data)
            entry[kind] = {k: v for k, v in metadata.items() if k != 'file'}
            entry[kind]['url'] = './assets/cleanup-v29-right/' + metadata['file']
        shutil.copyfile(path, docs / path.name)
        entries.append(entry)
    receipt = {
        'sourceHfmDecodedSha256': '175548ddaad01c409d59d561df6018c5cb0c90752b2ec771899c255065398dae',
        'replaceId': 'pulmonary-valve-lumen-surface',
        'replacement': entries[0],
        'append': entries[1],
        'sourceDataUnmodified': True,
        'sourceCalibratedHU': False,
        'referenceScope': 'Verbatim policies pin separately reproducible SFR analysis references; only the HFM and exact low-band mask are runtime assets.',
    }
    (out / 'manifest-entries.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps({entry['id']: {
        'surfaceBytes': entry['surface']['compressedBytes'],
        'maskBytes': entry['lowBandMask']['compressedBytes'],
        'triangles': entry['surface']['triangles'],
    } for entry in entries}, indent=2))


if __name__ == '__main__':
    main()
