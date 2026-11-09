#!/usr/bin/env python3
"""Offline, bounded manifest-compiler checks using a real hosted pilot.

Native receipts are the existing real uploader receipts. Unuploaded overview
and evidence files use explicit local fixtures with verified=false and the
reserved example.invalid origin. No fake production verification is created.
All mutation tests operate on private copies and leave the bank unchanged.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / 'scripts/guided-native-v21'
sys.path.insert(0, str(SCRIPTS))
import finalize_manifest as final


def write(path, item):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(item, indent=2) + '\n')


def fixture(path, sha, size):
    return dict(fixture=True, verified=False, verification='local-fixture-only',
        path=path, url='https://example.invalid' + final.API + path, sha256=sha, bytes=size)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--run', type=Path, required=True)
    p.add_argument('--overview', type=Path, required=True)
    p.add_argument('--work', type=Path, required=True)
    p.add_argument('--report', type=Path, default=Path(__file__).with_name('manifest-compiler-verification.json'))
    a = p.parse_args()
    a.work.mkdir(parents=True, exist_ok=True)
    source_hashes = {str(path): final.file_hash(path) for path in a.run.rglob('*') if path.is_file()}
    overview = json.loads(a.overview.read_text())
    fixture_rows = []
    for lod in overview['lods']:
        for index, part in enumerate(lod['parts']):
            remote = f"overview/fixture-{lod['id']}-{index}-{part['sha256']}.hfm.gz"
            fixture_rows.append(fixture(remote, part['sha256'], part['compressedBytes']))
    receipt_file = a.work / 'overview-receipts-FIXTURE-ONLY.json'
    write(receipt_file, dict(fixtureOnly=True, receipts=fixture_rows))
    base = [sys.executable, str(SCRIPTS / 'finalize_manifest.py'), '--run', str(a.run),
        '--overview', str(a.overview), '--allow-pilot']
    rows = []

    def run(command, expected=None):
        result = subprocess.run(command, capture_output=True, text=True)
        if expected is None:
            assert result.returncode == 0, result.stderr
            return json.loads(result.stdout)
        assert result.returncode != 0 and expected in result.stderr, (expected, result.stderr)
        return result.stderr.strip()

    dry = a.work / 'dry'
    dry_report = run([*base, '--out', str(dry), '--dry-run'])
    assert dry_report['verifiedNativeReceipts'] == 8 and len(dry_report['missingOverviewReceipts']) == 2
    assert not (dry / 'manifest.json').exists()
    rows.append(dict(check='Real native receipts and exact completed pilot plan', passed=True))
    # Completing a different small plan is insufficient to label it whole-plan,
    # even if the caller simply omits the explicit pilot switch.
    whole_command = [value for value in base if value != '--allow-pilot']
    rows.append(dict(check='Completed alternate small plan cannot be mislabeled whole-plan', passed=True,
        refusal=run([*whole_command, '--out', str(a.work/'rejected-whole-scope'), '--dry-run'],
                    'independently pinned whole-heart census plan')))
    out = a.work / 'fixture-result'
    full_command = [*base, '--overview-receipts', str(receipt_file), '--fixture-receipts', '--out', str(out)]
    first = run(full_command)
    first_evidence = (out / 'evidence.json.gz').read_bytes()
    first_index = (out / 'manifest.json.gz').read_bytes()
    assert first['artifact']['fixtureOnly'] and not first['publishable']
    assert first['completeScope'] == 'pilot-only'
    again = run(full_command)
    assert first_evidence == (out / 'evidence.json.gz').read_bytes()
    assert first_index == (out / 'manifest.json.gz').read_bytes()
    rows.append(dict(check='Deterministic JSON and gzip from identical evidence', passed=True))
    evidence_info = first['evidenceArtifact']
    evidence_receipt = a.work / 'evidence-receipt-FIXTURE-ONLY.json'
    write(evidence_receipt, fixture(evidence_info['suggestedRemotePath'], evidence_info['sha256'], evidence_info['bytes']))
    second = run([*full_command, '--evidence-receipt', str(evidence_receipt)])
    assert first_evidence == (out / 'evidence.json.gz').read_bytes()
    index = json.loads((out / 'manifest.json').read_text())
    assert index['evidenceLedger']['url'].startswith('https://example.invalid/')
    assert index['evidenceLedger']['verified'] is False and not index['publishable']
    assert gzip.decompress((out / 'manifest.json.gz').read_bytes()) == (out / 'manifest.json').read_bytes()
    assert all(set(t) == {'xyz', 'url', 'sha256', 'decodedSha256', 'bytes', 'decodedBytes', 'vertices', 'triangles'} for t in index['tiles'])
    assert 'objects' not in index['source'] and 'nativeReceipts' not in index
    rows.append(dict(check='Second-pass evidence link has no hash cycle; fixture publication stays disabled', passed=True))
    script = """
import {readFileSync} from 'node:fs';
import {validateGuidedManifest} from MODULE;
const value=validateGuidedManifest(JSON.parse(readFileSync(FILE,'utf8')),'https://example.invalid/whole-native.html');
process.stdout.write(JSON.stringify({tiles:value.tiles.length,parts:value.overview.parts.length,scope:value.completeScope}));
""".replace('MODULE', json.dumps((ROOT / 'public/native-edge-loader.js').as_uri())).replace('FILE', json.dumps(str(out / 'manifest.json')))
    browser = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', script], text=True))
    assert browser == dict(tiles=8, parts=1, scope='pilot-only')
    rows.append(dict(check='Production browser manifest validator accepts compact multipart contract', passed=True))

    rows.append(dict(check='Fixture receipt rejected without explicit fixture option', passed=True,
        refusal=run([*base, '--overview-receipts', str(receipt_file), '--out', str(a.work / 'rejected-fixture')], 'Fixture receipts are forbidden')))
    rows.append(dict(check='Missing overview receipt rejected outside dry-run', passed=True,
        refusal=run([*base, '--out', str(a.work / 'rejected-missing')], 'Missing overview upload receipt')))

    def copy_run(name):
        destination = a.work / name
        if destination.exists():
            shutil.rmtree(destination)
        (destination / 'records').mkdir(parents=True)
        for name in ('run.json', 'progress.json', 'source-objects.jsonl'):
            shutil.copyfile(a.run / name, destination / name)
        for path in (a.run / 'records').glob('*.json'):
            shutil.copyfile(path, destination / 'records' / path.name)
        shutil.copytree(a.run / 'tiles', destination / 'tiles')
        return destination

    def reject_case(name, mutate, expected):
        destination = copy_run(name)
        mutate(destination)
        command = [sys.executable, str(SCRIPTS / 'finalize_manifest.py'), '--run', str(destination),
            '--overview', str(a.overview), '--allow-pilot', '--dry-run', '--out', str(a.work / (name + '-out'))]
        error = run(command, expected)
        rows.append(dict(check=name, passed=True, refusal=error))

    def edit_record(directory, change):
        path = sorted((directory / 'records').glob('*.json'))[0]
        value = json.loads(path.read_text())
        change(value)
        write(path, value)

    def incomplete(directory):
        path = directory / 'progress.json'
        item = json.loads(path.read_text())
        item['complete'] = False
        write(path, item)

    reject_case('Incomplete run rejected even in pilot mode', incomplete, 'Native run is incomplete')
    reject_case('Missing completed core rejected', lambda d: sorted((d / 'records').glob('*.json'))[0].unlink(), 'do not exactly cover')
    reject_case('Duplicate completed core rejected', lambda d: shutil.copyfile(sorted((d / 'records').glob('*.json'))[0], d / 'records/duplicate.json'), 'Duplicate or unplanned')
    reject_case('Foreign processing fingerprint rejected', lambda d: edit_record(d, lambda r: r.update(fingerprint='0' * 64)), 'foreign fingerprint')
    reject_case('Wrong remote SHA rejected', lambda d: edit_record(d, lambda r: r['artifacts'][0]['remote'].update(sha256='0' * 64)), 'receipt SHA or byte count differs')
    reject_case('Unverified remote receipt rejected', lambda d: edit_record(d, lambda r: r['artifacts'][0]['remote'].update(verified=False)), 'unverified or has a foreign URL')
    reject_case('Foreign remote origin rejected', lambda d: edit_record(d, lambda r: r['artifacts'][0]['remote'].update(url='https://example.invalid/foreign')), 'unverified or has a foreign URL')
    reject_case('Crossing accounting mismatch rejected', lambda d: edit_record(d, lambda r: r['surfaceContribution'].update(nativeOnlyEdgeVertices=r['surfaceContribution']['nativeOnlyEdgeVertices'] + 1)), 'contribution accounting disagree')

    def wrong_tile(directory):
        def change(record):
            r = record['artifacts'][0]['remote']
            r['path'] = 'tiles/1_1_1-' + r['sha256'] + '.nbe.gz'
            r['url'] = final.SITE_URL + final.API + r['path']
        edit_record(directory, change)
    reject_case('Receipt filename from another tile rejected', wrong_tile, 'different tile')

    ledger = a.work / 'source-ledger-duplicate-FIXTURE.jsonl'
    original = (a.run / 'source-objects.jsonl').read_bytes()
    ledger.write_bytes(original + original.splitlines(keepends=True)[0])
    metadata = json.loads((a.run / 'run.json').read_text())
    input_coords, _ = final.plan(Path(metadata['inputPlan']), 'test input')
    duplicate = final.source_ledger(ledger, input_coords)
    assert duplicate['uniqueObjects'] == 64 and duplicate['duplicateCoordinateObservations'] == 1
    conflict = json.loads(original.splitlines()[0])
    conflict['sha256'] = 'f' * 64
    ledger.write_bytes(original + json.dumps(conflict).encode() + b'\n')
    try:
        final.source_ledger(ledger, input_coords)
    except final.ManifestError as e:
        assert 'Conflicting source hashes' in str(e)
    else:
        raise AssertionError('Conflicting source data was accepted')
    rows.append(dict(check='Repeated source observations deduplicate; conflicting source hashes reject', passed=True))
    assert source_hashes == {str(path): final.file_hash(path) for path in a.run.rglob('*') if path.is_file()}
    report = dict(schema='guided-native-manifest-compiler-verification-v21.1', allChecksPassed=True,
        fixtureNotice='Only local overview/evidence receipt fixtures were used; verified=false and example.invalid. Native receipts were the real hosted pilot receipts. No network calls or uploads occurred.',
        checks=rows, productionNativeReceiptsValidated=dry_report['verifiedNativeReceipts'],
        sourceObjectsValidated=dry_report['sourceUniqueObjects'],
        nativeTriangles=dry_report['totals']['nativeTriangles'],
        surfaceContribution=dry_report['surfaceContribution'],
        viewer=dict(decodedBytes=second['artifact']['decodedBytes'], bytes=second['artifact']['bytes'],
            browser=browser, evidenceLedgerNotEmbedded=True),
        evidence=dict(decodedBytes=second['evidenceArtifact']['decodedBytes'], bytes=second['evidenceArtifact']['bytes'],
            secondPassBytesUnchanged=True),
        sourceBankUnchanged=True, compilerSha256=final.file_hash(SCRIPTS / 'finalize_manifest.py'))
    write(a.report, report)
    print(json.dumps(dict(allChecksPassed=True, checks=len(rows), viewer=report['viewer'], evidence=report['evidence'], report=str(a.report))))


if __name__ == '__main__':
    main()
