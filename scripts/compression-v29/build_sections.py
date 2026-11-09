#!/usr/bin/env python3
"""Versioned near-lossless cut faces with an absolute one-gray-level error bound.

Keep the original pixel grid, crops, spacing, black support, clipped white, and
the surface threshold (72/255) exactly. No blur, denoising or resampling occurs.
The original immutable WebPs are input only. A separate collection is required.
"""
from pathlib import Path
from io import BytesIO
from concurrent.futures import ProcessPoolExecutor, wait, FIRST_COMPLETED
import argparse, copy, hashlib, json, math, time
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]


def sha(b):
    return hashlib.sha256(b).hexdigest()


def quantize(a):
    # Odd values move down by one; 1 stays nonzero and 255 stays clipped white.
    return np.where(a == 255, 255, np.where(a == 1, 1, a & 254)).astype(np.uint8)


def encode_one(task):
    source, target, record, method, quality = task
    source, target = Path(source), Path(target)
    raw = source.read_bytes()
    assert len(raw) == record['bytes'] and sha(raw) == record['sha256'], f'Source image checksum mismatch: {source}'
    a = np.array(Image.open(BytesIO(raw)).convert('L'))
    assert sha(a.tobytes()) == record['sourceDisplaySha256'], f'Source display checksum mismatch: {source}'
    assert list(a.shape[::-1]) == record['crop'][2:]
    b = quantize(a)
    start = time.perf_counter()
    stream = BytesIO()
    Image.fromarray(b).save(stream, format='WEBP', lossless=True, quality=quality, method=method)
    encoded = stream.getvalue()
    encode_seconds = time.perf_counter() - start
    start = time.perf_counter()
    decoded = np.array(Image.open(BytesIO(encoded)).convert('L'))
    decode_seconds = time.perf_counter() - start
    assert np.array_equal(b, decoded), 'WebP transport unexpectedly changed quantized pixels.'
    error = decoded.astype(np.int16) - a.astype(np.int16)
    maximum = int(np.abs(error).max(initial=0))
    support_changes = int(((decoded == 0) != (a == 0)).sum())
    threshold_changes = int(((decoded >= 72) != (a >= 72)).sum())
    white_changes = int(((decoded == 255) != (a == 255)).sum())
    assert maximum <= 1 and support_changes == threshold_changes == white_changes == 0
    target.parent.mkdir(parents=True, exist_ok=True)
    target.with_suffix('.partial').write_bytes(encoded)
    target.with_suffix('.partial').replace(target)
    # For arbitrary thresholds, all classification changes are at odd levels;
    # this records their exact count instead of implying all thresholds survive.
    histogram = np.bincount(a.reshape(-1), minlength=256)
    changes = [int(histogram[t]) if t % 2 and t not in (1, 255) else 0 for t in range(256)]
    result = dict(path=record['path'], bytes=len(encoded), sha256=sha(encoded),
                  sourceBytes=len(raw), sourceSha256=record['sha256'],
                  sourceDisplaySha256=record['sourceDisplaySha256'], decodedDisplaySha256=sha(decoded.tobytes()),
                  pixelCount=int(a.size), maxAbsoluteError=maximum,
                  squaredErrorSum=int((error * error).sum(dtype=np.int64)),
                  signedErrorSum=int(error.sum(dtype=np.int64)),
                  zeroSupportChanges=support_changes, threshold72Changes=threshold_changes,
                  clippedWhiteChanges=white_changes, thresholdClassificationChanges=changes,
                  encodeSeconds=encode_seconds, decodeSeconds=decode_seconds,
                  encoder=dict(format='WEBP', lossless=True, quality=quality, method=method),
                  rule='floor-to-even except 0, 1, 255 preserved; no spatial resampling')
    target.with_suffix('.metrics.json').write_text(json.dumps(result) + '\n')
    return result


def build(args):
    began = time.perf_counter()
    source_manifest_path = ROOT / 'public/assets/ultra-sections/manifest.json'
    source_bytes = source_manifest_path.read_bytes()
    manifest = json.loads(source_bytes)
    unique = {}
    for records in manifest['slices'].values():
        for record in records:
            if record['path'] in unique:
                assert unique[record['path']]['sha256'] == record['sha256']
            else:
                unique[record['path']] = record
    args.out.mkdir(parents=True, exist_ok=True)
    results, pending = {}, dict(unique)
    # Verified resumability is useful when source downloads and encoding overlap.
    for path, record in list(pending.items()):
        target = args.out / path
        metrics = target.with_suffix('.metrics.json')
        if target.is_file() and metrics.is_file():
            r = json.loads(metrics.read_text())
            if r['sourceSha256'] == record['sha256'] and r['encoder']['method'] == args.method and r['encoder']['quality'] == args.quality and sha(target.read_bytes()) == r['sha256']:
                results[path] = r
                del pending[path]
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        active = {}
        while pending or active:
            for path, record in list(pending.items()):
                if len(active) >= args.workers * 2:
                    break
                source = args.source / path
                if source.is_file() and source.stat().st_size == record['bytes']:
                    future = pool.submit(encode_one, (str(source), str(args.out / path), record, args.method, args.quality))
                    active[future] = path
                    del pending[path]
            if not active:
                if not args.wait_sources:
                    raise RuntimeError(f'{len(pending)} source images are missing; rerun with --wait-sources during a verified restore.')
                time.sleep(1)
                continue
            done, _ = wait(active, timeout=1, return_when=FIRST_COMPLETED)
            for future in done:
                path = active.pop(future)
                results[path] = future.result()
                if len(results) % 25 == 0 or len(results) == len(unique):
                    total = sum(r['bytes'] for r in results.values())
                    original = sum(r['sourceBytes'] for r in results.values())
                    print(json.dumps(dict(done=len(results), total=len(unique), bytes=total,
                                          sourceBytes=original, reductionPercent=100 * (1 - total / original),
                                          elapsedSeconds=time.perf_counter() - began)), flush=True)
    output = copy.deepcopy(manifest)
    output['version'] = 'v29-bounded-one-level'
    output['assetBaseUrl'] = args.base_url
    output['lossless'] = False
    output['compressionLossless'] = False
    output['codecLossless'] = True
    output['quality'] = args.quality
    output['format'] = 'image/webp'
    output['grayQuantizationStep'] = 2
    output['sourceManifestSha256'] = sha(source_bytes)
    output['sourceManifestPath'] = './assets/ultra-sections/manifest.json'
    output['compression'] = dict(name='Bounded one-level WebP', maxAbsoluteGrayError=1,
                                grayLevels=256, spatialResampling=False,
                                exactZeroSupport=True, exactClippedWhite=True,
                                exactThresholds=[0, 1, 72, 255],
                                note='The WebP bitstream losslessly stores a bounded display derivative. Original source pixels remain in the immutable source bank. Other thresholds may differ by one gray level.')
    for records in output['slices'].values():
        for record in records:
            r = results[record['path']]
            record['sourceBytes'] = record['bytes']
            record['sourceSha256'] = record['sha256']
            record['bytes'] = r['bytes']
            record['sha256'] = r['sha256']
            record['decodedDisplaySha256'] = r['decodedDisplaySha256']
    total_pixels = sum(r['pixelCount'] for r in results.values())
    squared_error = sum(r['squaredErrorSum'] for r in results.values())
    total_bytes = sum(r['bytes'] for r in results.values())
    source_total = sum(r['sourceBytes'] for r in results.values())
    output['totalBytes'] = total_bytes
    summary = dict(schema='heart-bounded-cut-face-bank-v29', uniqueImages=len(results),
                   pixelCount=total_pixels, sourceBytes=source_total, bytes=total_bytes,
                   reductionPercent=100 * (1 - total_bytes / source_total),
                   maxAbsoluteGrayError=max(r['maxAbsoluteError'] for r in results.values()),
                   rmsGrayError=(squared_error / total_pixels) ** .5,
                   meanGrayError=sum(r['signedErrorSum'] for r in results.values()) / total_pixels,
                   psnrDb=10 * math.log10(255 ** 2 / (squared_error / total_pixels)) if squared_error else None,
                   zeroSupportChanges=sum(r['zeroSupportChanges'] for r in results.values()),
                   threshold72Changes=sum(r['threshold72Changes'] for r in results.values()),
                   clippedWhiteChanges=sum(r['clippedWhiteChanges'] for r in results.values()),
                   thresholdClassificationChanges=[sum(r['thresholdClassificationChanges'][t] for r in results.values()) for t in range(256)],
                   sourceManifestSha256=sha(source_bytes), sourceBankModified=False,
                   encoder=dict(format='WEBP', lossless=True, quality=args.quality, method=args.method),
                   buildSeconds=time.perf_counter() - began,
                   note='Metrics cover every unique image; no crop, grid, spacing, section index, or 3D vertex coordinate changed.')
    (args.out / 'manifest.json').write_text(json.dumps(output, separators=(',', ':')) + '\n')
    (args.out / 'quality-summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    (ROOT / 'docs/compression-v29/section-build.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps({k:v for k,v in summary.items() if k != 'thresholdClassificationChanges'}, indent=2), flush=True)


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--source', type=Path, default=ROOT / 'data/ultra-sections')
    p.add_argument('--out', type=Path, default=Path('/workspace/data/heart-v29-compress/sections-compact'))
    p.add_argument('--base-url', default='/api/display-compact-v29/sections/')
    p.add_argument('--workers', type=int, default=4)
    p.add_argument('--method', type=int, default=4)
    p.add_argument('--quality', type=int, default=100)
    p.add_argument('--wait-sources', action='store_true')
    build(p.parse_args())
