"""Verify one complete, current all-donor native evidence set without rendering.

Checks exact scenario coverage, runtime fingerprints, source-sheet/export
binding, raw CT pixels, both camera files, deliberate withholding and controller
handoffs. It does not assign anatomical identities or clinical pass grades.
"""
from pathlib import Path
import hashlib
import json
import subprocess
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'docs/echo-donor-qc-v6/native'
sha = lambda data: hashlib.sha256(data).hexdigest()
read = lambda path: json.loads(path.read_text())
registry_code = "import {TTE_ATLAS_VIEWS} from './public/tte-atlas-data.js';import {TEE_ATLAS_VIEWS} from './public/tee-atlas-data.js';console.log(JSON.stringify([...TTE_ATLAS_VIEWS,...TEE_ATLAS_VIEWS].map(v=>({id:v.id,mode:v.mode}))));"
expected = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', registry_code], cwd=ROOT))
expected_pairs = {(v['mode'], v['id']) for v in expected}
assert len(expected_pairs) == 56
donors = []
for donor in ['ladaf-2021-17', 's-20-28', 's-20-29']:
    directory = BASE / donor
    native_bytes = (directory / 'review.json').read_bytes()
    native = json.loads(native_bytes)
    audit_bytes = (directory / 'controller-audit.json').read_bytes()
    audit = json.loads(audit_bytes)
    sources = read(directory / 'source-review.json')
    assert native['views'] == 56 and native['renders'] == 112, donor
    assert native['passed'] and not native['staleSourceFiles'], donor
    assert audit['sourceStable'] and not audit['sourceChangedDuringAudit'], donor
    assert sha(audit_bytes) == native['controllerAuditSha256'], donor
    assert native['exportSha256'] == sources['exportSha256'], f'{donor}: stale source contact sheet'
    assert sources['sourceScriptSha256'] == sha((ROOT / 'scripts/echo-donor-qc-v6/source-contact-sheet.py').read_bytes()), donor
    for path, digest in native['sourceHashes'].items():
        assert sha((ROOT / path).read_bytes()) == digest, f'{donor}: runtime changed: {path}'
    assert {(v['mode'], v['id']) for v in native['acceptedViews']} == expected_pairs, donor
    assert len(native['acceptedViews']) == 56, donor
    assert not native['unexpectedUnavailable'], donor
    assert native['intentionalWithheld'] == ['tgrvinout'], donor
    assert native['unavailablePoses'] == ['tgrvinout'], donor
    assert all(row['handoff']['consistent'] for row in audit['rows']), donor
    for group in audit['summary']:
        for key in ['misaligned', 'handoffMismatches', 'skinContactFailures', 'beamTargetFailures', 'roiCenterOutsideSector', 'defaultMarkerFailures', 'unexpectedUnavailable']:
            assert group['baseline'][key] == 0, (donor, group['mode'], key)
    sheets = []
    for item in sources['outputs']:
        assert item['views'] == 28, (donor, item['mode'])
        assert sha((directory / item['file']).read_bytes()) == item['sha256'], donor
        sheets.append(item)
    assert {item['mode'] for item in sheets} == {'tte', 'tee'}
    caps = {cap['id']: cap for cap in native['cap']['metadata']}
    checks = {(c['mode'], c['id'], c['camera']): c for c in native['checks']}
    assert len(checks) == 112 and all(c['glError'] == 0 for c in checks.values()), donor
    acquired, outside, withheld, image_hashes = 0, 0, 0, {}
    for view in native['acceptedViews']:
        mode, ident = view['mode'], view['id']
        cap = caps[ident]
        if view['outsideScan']:
            outside += 1
            assert not cap['available'] and view['sourceRaster'] is None
            assert not (directory / f'{mode}-{ident}-ct-source.png').exists(), f'{donor}/{ident}: invented or stale CT file'
        else:
            acquired += 1
            assert cap['available'] and view['sourceRaster']
            path = directory / view['sourceRaster']
            with Image.open(path) as im:
                assert im.mode == 'L' and im.size == (cap['width'], cap['height'])
                assert sha(im.tobytes()) == cap['sha256'], f'{donor}/{ident}: source PNG pixels differ from exact MPR'
            image_hashes[path.name] = sha(path.read_bytes())
        if view['intentionalWithheld']:
            withheld += 1
            assert ident == 'tgrvinout' and not view['poseAvailable'] and view['pose'] is None
            assert view['acquisition']['sourcePlaneRetained']
            assert view['acquisition']['sourceConstraintRejectedCandidates'] > 0
            assert 'preserves this source section' in view['acquisition']['reason']
        else:
            assert view['poseAvailable'] and view['pose'] is not None
        for camera in ['probe', 'anatomy']:
            check = checks[(mode, ident, camera)]
            assert check.get('capSha256') == cap.get('sha256')
            path = directory / check['image']
            with Image.open(path) as im:
                assert im.size == tuple(native['dimensions'])
            image_hashes[path.name] = sha(path.read_bytes())
        pair = directory / f'{mode}-{ident}-pair.jpg'
        assert pair.exists()
        image_hashes[pair.name] = sha(pair.read_bytes())
    assert (acquired, outside, withheld) == (49, 7, 1), donor
    # A longitudinal plane can be anatomically useful but have its apex
    # cropped by the rectangular MPR field. This is distinct from a plane miss.
    frame = native['anatomy']['tee']['frame']
    reference_mm, apex = frame['referenceMm'], frame['landmarksMm']['apex']
    longitudinal = []
    for view in native['acceptedViews']:
        if view['id'] not in ['me5c', 'me4c', 'mecommissural', 'me2c', 'melax', 'deeptg5c', 'tg2c', 'tglax']:
            continue
        plane = view['plane']
        delta = [apex[i] - plane['center'][i] * reference_mm for i in range(3)]
        projection = lambda axis: sum(a * b for a, b in zip(delta, plane[axis]))
        margin = min(plane['width'] * reference_mm / 2 - abs(projection('right')),
                     plane['height'] * reference_mm / 2 - abs(projection('up')))
        assert margin >= -1e-5, f'{donor}/{view["id"]}: projected apex cropped by {abs(margin)}mm'
        longitudinal.append({'id': view['id'], 'apexProjectionFieldMarginMm': margin,
                             'apexPlaneResidualMm': abs(projection('normal')),
                             'clinicalCorrespondenceValidated': False})
    assert len(longitudinal) == 8
    donors.append({
        'donor': donor, 'views': 56, 'anchors': 112,
        'actualCtSections': acquired, 'outsideCoverage': outside,
        'acceptedVisibleEstimates': 55, 'intentionalWithheld': withheld, 'unexpectedUnavailable': 0,
        'nativeReviewSha256': sha(native_bytes), 'exportSha256': native['exportSha256'],
        'controllerAuditSha256': native['controllerAuditSha256'],
        'sourceReviewSha256': sha((directory / 'source-review.json').read_bytes()),
        'sourceSheets': sheets, 'sourceHashes': native['sourceHashes'],
        'sourceSpacingUm': native['sourceSpacingUm'], 'sourceDimensions': native['sourceDimensions'],
        'sourceManifestSha256': native['sourceManifestSha256'],
        'longitudinalTeeFieldChecks': longitudinal,
        'imageSha256': image_hashes,
    })
report = {
    'schemaVersion': 1, 'passed': True,
    'scope': 'Complete current native evidence and source-pixel integrity; anatomical/clinical review outcomes are recorded separately.',
    'views': 168, 'anchors': 336, 'actualCtSections': 147, 'outsideCoverage': 21,
    'acceptedVisibleEstimates': 165, 'intentionalWithheld': 3, 'unexpectedUnavailable': 0,
    'currentRuntimeFingerprints': True, 'sourceSheetsMatchExports': True, 'rawSourcePngPixelsMatchMpr': True,
    'checkerSha256': sha(Path(__file__).read_bytes()), 'donors': donors,
}
target = ROOT / 'docs/echo-donor-qc-v6/native-summary.json'
target.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({k: v for k, v in report.items() if k != 'donors'}))
