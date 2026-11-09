"""Check largest native section crops and codec cost; no browser automation."""
from pathlib import Path
import hashlib
import io
import json
import statistics
import time
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
rows = []
for donor, manifest_path, images in [
    ('LADAF-2021-17', 'public/assets/ultra-sections/manifest.json', 'data/ultra-sections'),
    ('S-20-29', 'public/assets/donors/s-20-29/ultra-sections.json', 'data/donors/s-20-29/ultra-sections'),
    ('S-20-28', 'public/assets/donors/s-20-28/ultra-sections.json', 'data/donors/s-20-28/ultra-sections'),
]:
    manifest = json.loads((ROOT / manifest_path).read_text())
    records = [record for axis in manifest['slices'].values() for record in axis if not record.get('empty')]
    record = max(records, key=lambda item: item['crop'][2] * item['crop'][3])
    path = Path(images) / record['path']
    encoded = (ROOT / path).read_bytes()
    assert len(encoded) == record['bytes']
    assert hashlib.sha256(encoded).hexdigest() == record['sha256']
    times = []
    for _ in range(8):
        started = time.perf_counter()
        image = Image.open(io.BytesIO(encoded)).convert('L')
        pixels = image.tobytes()
        times.append((time.perf_counter() - started) * 1000)
    assert list(image.size) == record['crop'][2:]
    assert hashlib.sha256(pixels).hexdigest() == record['sourceDisplaySha256']
    rows.append(dict(donor=donor, path=str(path), crop=record['crop'],
                     encodedBytes=len(encoded), decodedBytes=len(pixels),
                     encodedSha256Matches=True, sourcePixelsSha256Matches=True,
                     cpuDecodeMedianMs=round(statistics.median(times), 3),
                     cpuDecodeSamplesMs=[round(value, 3) for value in times],
                     imageDimensionsXYZ=manifest['imageDimensionsXYZ']))

report = dict(kind='Local largest-crop native dataset check',
              description='Pillow WebP decode and SHA-256 source-pixel checks. CPU codec timing only; no browser, GPU or network measurement.',
              samples=rows)
(ROOT / 'docs/ultra-native-v15-check.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
