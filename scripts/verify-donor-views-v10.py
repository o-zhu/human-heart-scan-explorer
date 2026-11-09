"""Verify donor separation, measured images, neutral labels and complete view assets."""
from pathlib import Path
import argparse
import gzip
import hashlib
import importlib.util
import json

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('donor_views', ROOT/'scripts/prepare-donor-views-v10.py')
views = importlib.util.module_from_spec(spec)
spec.loader.exec_module(views)


def read(path):
    return json.loads(path.read_text())


def image_check(item, directory, donor_hashes):
    path = ROOT/'public'/item['url'].removeprefix('./')
    assert path.is_relative_to(directory), f'Cross-donor image URL: {path}'
    assert path.is_file(), f'Missing image: {path}'
    data = path.read_bytes()
    assert hashlib.sha256(data).hexdigest() == item['sha256']
    pixels = np.asarray(Image.open(path).convert('L'))
    assert list(pixels.shape[::-1]) == [item['width'], item['height']]
    assert hashlib.sha256(pixels.tobytes()).hexdigest() == item['pixelSha256']
    assert np.count_nonzero(pixels) > 20, f'Empty measured image: {path}'
    donor_hashes.add(item['pixelSha256'])


def frame_check(item):
    p = item['world']
    r, u, n = [np.asarray(p[k]) for k in ['right', 'up', 'normal']]
    assert max(abs(np.linalg.norm(v)-1) for v in [r, u, n]) < 1e-8
    assert abs(r@u) < 1e-8
    assert np.max(np.abs(np.cross(r, u)-n)) < 1e-8
    assert p['width'] > 0 and p['height'] > 0


def verify(slug, specimen, dataset):
    directory = ROOT/'public/assets/donors'/slug
    frames, textures, flow, anatomy, probe = [read(directory/p) for p in [
        'echo-planes.json', 'echo-textures.json', 'flow-views.json', 'anatomy/manifest.json', 'probe-textures.json']]
    for manifest in [frames, textures, flow, anatomy, probe]:
        assert manifest['datasetId'] == dataset
        assert manifest['geometricComparisonOnly'] is True
    assert frames['clinicalPresetsReviewed'] is False and flow['anatomicIdentityAssigned'] is False
    assert len(frames['frames']) == len(textures['textures']) == 13
    assert set(frames['frames']) == set(textures['textures'])
    assert len(flow['presets']) == 8 and len(probe['preparedPlanes']) == 4
    assert set(sum([g['presetIds'] for g in flow['displayGroups']], [])) == {p['id'] for p in flow['presets']}
    geometry = views.Geometry(read(ROOT/'docs/donors'/slug/'browser-geometry.json'))
    hashes = set()
    for key, frame in frames['frames'].items():
        frame_check(frame)
        assert frame['displayName'] and frame['displayCode']
        residual = np.max(np.abs(geometry.world_source(frame['world']['center'])-frame['source']['center']))
        assert residual < 1e-6
        image_check(textures['textures'][key], directory, hashes)
    for p in flow['presets']:
        frame_check(p)
        assert p['chamber'] is None and p['anatomicIdentityAssigned'] is False
        assert (ROOT/'public'/p['previewUrl'].removeprefix('./')).is_file()
        image_check(p['texture'], directory, hashes)
    for i, a in enumerate(flow['presets']):
        n1, t1 = np.array(a['world']['normal']), np.array(a['world']['target'])
        for b in flow['presets'][i+1:]:
            n2, t2 = np.array(b['world']['normal']), np.array(b['world']['target'])
            coincident = abs(n1@n2) > 1-1e-8 and abs(n1@(t1-t2)) < 1e-8
            assert not coincident, f'Duplicate comparison planes: {slug}: {a["id"]} / {b["id"]}'
    for p in probe['preparedPlanes']:
        image_check(p, directory, hashes)
    label_path = ROOT/'public'/anatomy['volumeUrl'].removeprefix('./')
    assert gzip.decompress(label_path.read_bytes()) == bytes(8)
    assert anatomy['segmentationAvailable'] is False and len(anatomy['labels']) == 1 and anatomy['labels'][0]['id'] == 0
    report = dict(datasetId=dataset, specimen=specimen, passed=True, echoPlaneCount=13,
                  distinctComparisonPlanes=8, probePlaneCount=4, verifiedMeasuredImages=25,
                  donorIsolatedURLs=True, imageHashesMatch=True, anatomicalLabelsAssigned=0,
                  sourceSpacingUm=textures['sourceSpacingUm'], clinicalPresetsReviewed=False)
    views.write_json(ROOT/'docs/donors'/slug/'view-validation.json', report)
    return report, hashes


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--slug', action='append', choices=views.DONORS, help='Verify a completed donor while other donors are preparing')
    args = parser.parse_args()
    results, all_hashes = [], []
    for slug in args.slug or views.ACTIVE_DONORS:
        specimen, dataset = views.DONORS[slug]
        report, hashes = verify(slug, specimen, dataset)
        assert all(not hashes.intersection(other) for other in all_hashes), 'Images shared across donors'
        results.append(report); all_hashes.append(hashes)
    print(json.dumps(dict(passed=True, donors=results, crossDonorPixelDuplicates=0)))
