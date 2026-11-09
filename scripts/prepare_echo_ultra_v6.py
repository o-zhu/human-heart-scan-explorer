"""Reformat all Echo preset planes from the measured 79.4 µm display volume.

These are the existing, approximately aligned educational planes. This script
improves sampling fidelity, not anatomical registration. It does not hallucinate
detail, infer a cardiac cycle, or claim to simulate an acoustic acquisition.
WebP compression is bit-exact for the prepared 8-bit grayscale display pixels.
The source was already windowed and conservatively cleaned; it is not a
quantitative replacement for the original 16-bit scan.
"""
from pathlib import Path
import argparse
import hashlib
import json

import numpy as np
from PIL import Image, ImageDraw, ImageOps
from scipy.ndimage import map_coordinates

PROJECT = Path(__file__).resolve().parents[1]
SOURCE_SPACING_UM = 79.4
S4_SPACING_UM = 317.6
S2_PER_S4 = 4.0


def sample_plane(volume, origin_xyz, frame):
    """Keep the exact existing plane extent; record actual in-plane spacing."""
    center = np.asarray(frame['center'], dtype=float)
    right = np.asarray(frame['right'], dtype=float)
    up = np.asarray(frame['up'], dtype=float)
    width, height = float(frame['width']), float(frame['height'])
    nx = int(round(width * S2_PER_S4)) + 1
    ny = int(round(height * S2_PER_S4)) + 1
    result = np.zeros((ny, nx), dtype=np.uint8)
    columns = np.linspace(-width / 2, width / 2, nx)
    rows = np.linspace(height / 2, -height / 2, ny)
    for start in range(0, ny, 48):
        coords = (center[None, None, :] + columns[None, :, None] * right
                  + rows[start:start + 48, None, None] * up)
        coords = coords * S2_PER_S4 - origin_xyz
        result[start:start + 48] = map_coordinates(
            volume, [coords[..., 2], coords[..., 1], coords[..., 0]],
            order=1, mode='constant', cval=0, prefilter=False)
    return result, [width * S4_SPACING_UM / (nx - 1),
                    height * S4_SPACING_UM / (ny - 1)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path,
                        default=Path('/workspace/data/heart-atlas-cache'))
    args = parser.parse_args()
    metadata = json.loads((args.cache / 's2-clean-display.json').read_text())
    volume = np.load(args.cache / 's2-clean-display-u8.npy', mmap_mode='r')
    origin = np.asarray(metadata['originXYZ'], dtype=float)
    presets = json.loads((PROJECT / 'public/assets/echo-planes.json').read_text())
    out = PROJECT / 'public/assets/echo-ultra-v6'
    out.mkdir(parents=True, exist_ok=True)
    textures = {}
    digest_to_url = {}
    thumbs = []
    for key, preset in presets['frames'].items():
        pixels, actual_spacing = sample_plane(volume, origin, preset['voxelXYZ'])
        raw_digest = hashlib.sha256(pixels.tobytes()).hexdigest()
        target = out / f'{key}.webp'
        Image.fromarray(pixels).save(target, format='WEBP', lossless=True,
                                     quality=100, method=6, exact=True)
        decoded = np.asarray(Image.open(target).convert('L'))
        assert np.array_equal(pixels, decoded), f'Non-lossless encoding: {key}'
        # Exactly identical prepared images need only one downloadable asset.
        if raw_digest in digest_to_url:
            target.unlink()
            target = PROJECT / 'public' / digest_to_url[raw_digest].removeprefix('./')
        else:
            digest_to_url[raw_digest] = './' + str(target.relative_to(PROJECT / 'public'))
        world = preset['world']
        textures[key] = dict(
            url='./' + str(target.relative_to(PROJECT / 'public')),
            spacingUm=SOURCE_SPACING_UM, sourceSpacingUm=SOURCE_SPACING_UM,
            width=pixels.shape[1], height=pixels.shape[0],
            actualSpacingUmXY=actual_spacing,
            widthWorld=world.get('width', world.get('widthWorld')),
            heightWorld=world.get('height', world.get('heightWorld')),
            center=world['center'], right=world['right'], up=world['up'],
            normal=world['normal'], bytes=target.stat().st_size,
            decodedBytes=int(pixels.nbytes),
            sha256=hashlib.sha256(target.read_bytes()).hexdigest(),
            pixelSha256=raw_digest, maxDecodedPixelError=0,
            encoding='lossless WebP, grayscale display pixels',
            cleaned=True, confidence=preset.get('confidence', 'approximate'),
            note=preset.get('note', ''),
        )
        print(key, pixels.shape, target.stat().st_size, flush=True)
        thumb = ImageOps.contain(Image.fromarray(pixels).convert('RGB'), (240, 240))
        tile = Image.new('RGB', (260, 280), '#0b1013')
        tile.paste(thumb, ((260-thumb.width)//2, 22+(240-thumb.height)//2))
        ImageDraw.Draw(tile).text((10, 5), f'{key}  79.4 um', fill='#e7ddd0')
        thumbs.append(tile)
    unique = {entry['url']: entry['bytes'] for entry in textures.values()}
    manifest = dict(
        schemaVersion=2, version='echo-ultra-v6',
        dataset='LADAF-2021-17, complete heart',
        sourceUrl='https://human-organ-atlas.esrf.fr/datasets/1659197537',
        sourceSpacingUm=SOURCE_SPACING_UM, source='s2-clean-display-u8.npy',
        sourceOriginXYZ=metadata['originXYZ'], sourceShapeXYZ=metadata['shapeXYZ'],
        quantitativeIntensityData=False, interpolation='trilinear',
        compression='lossless after 8-bit display windowing and oblique reformat',
        coverage='Exact existing preset plane extent; only unmodified planes.',
        adjustedPlanes='Sampled from currently loaded volume with its actual resolution.',
        totalUniqueEncodedBytes=sum(unique.values()),
        totalDecodedBytes=sum(e['decodedBytes'] for e in textures.values()),
        textures=textures,
    )
    (PROJECT / 'public/assets/echo-textures.json').write_text(json.dumps(manifest, indent=2)+'\n')
    report_dir = PROJECT / 'docs/echo-v6'
    report_dir.mkdir(parents=True, exist_ok=True)
    sheet = Image.new('RGB', (4*260, 4*280), '#0b1013')
    for i, tile in enumerate(thumbs):
        sheet.paste(tile, ((i % 4)*260, (i//4)*280))
    sheet.save(report_dir / 'preset-contact-sheet.jpg', quality=92)
    print(json.dumps({'presetCount':len(textures), 'uniqueAssets':len(unique),
                      'encodedBytes':sum(unique.values()),
                      'decodedBytes':manifest['totalDecodedBytes']}))


if __name__ == '__main__':
    main()
