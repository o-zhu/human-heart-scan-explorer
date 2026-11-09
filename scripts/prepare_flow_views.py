"""Prepare source-reviewed chamber-flow planes and lossless oblique scan textures.

All geometry is specified in original s4 voxel-center coordinates (317.6 um).
Textures are trilinear reformats of the existing cleaned s2 display array,
sampled every 79.4 um in the plane. WebP is lossless after this reformat. The
source tissue is never replaced by an illustrative model or synthetic texture.
"""
from pathlib import Path
import argparse
import hashlib
import json
import math
import numpy as np
from scipy.ndimage import map_coordinates
from PIL import Image, ImageDraw, ImageFont

PROJECT = Path(__file__).resolve().parents[1]
SPAN = np.array([474., 474., 529.])
SCALE = 529.
SOURCE_UM = 317.6
SOURCE_BOUNDS = np.array([[109., 88., 14.], [402., 405., 512.]])


def unit(value):
    value = np.asarray(value, float)
    return value / np.linalg.norm(value)


def vec_world(value):
    x, y, z = value
    return np.array([x, z, -y])


def point_world(value):
    x, y, z = value
    return np.array([x - 237., z - 264.5, 237. - y]) / SCALE


def rounded(value):
    return [round(float(x), 12) for x in value]


def bounds_frame(target, right, up):
    """Project a conservative organ bounding box onto the plane, plus a guard."""
    right = unit(right)
    up = unit(np.asarray(up) - right * np.dot(right, up))
    normal = unit(np.cross(right, up))
    corners = np.array([[x, y, z] for x in SOURCE_BOUNDS[:, 0]
                        for y in SOURCE_BOUNDS[:, 1] for z in SOURCE_BOUNDS[:, 2]])
    r = (corners - target) @ right
    u = (corners - target) @ up
    rlo, rhi = np.floor(r.min()) - 4, np.ceil(r.max()) + 4
    ulo, uhi = np.floor(u.min()) - 4, np.ceil(u.max()) + 4
    center = target + right * (rlo + rhi) / 2 + up * (ulo + uhi) / 2
    return center, right, up, normal, float(rhi - rlo), float(uhi - ulo)


def presets():
    hinges = np.array(json.loads((PROJECT / 'docs/anatomy/boundary-landmarks.json').read_text())['tricuspidHingeSourceXYZ'])
    center = hinges.mean(0)
    _, _, vh = np.linalg.svd(hinges - center)
    normal = vh[-1] * np.sign(vh[-1, 2])
    right = unit(np.array([1., 0., 0.]) - normal * normal[0])
    up = np.cross(normal, right)
    tricuspid = center - 5 * normal
    common = 'These are anatomical starting views of a fixed, partly collapsed specimen. The plane is manually placed; it is not a segmented valve annulus or a clinical ultrasound window.'
    return [
        dict(id='rv-inflow', chamber='RV', kind='Inflow', title='RV inflow', subtitle='Tricuspid apparatus',
             description='An oblique long section follows the right atrial outlet into the right ventricular cavity. Rotate slightly to look behind the cut face at the leaflet and chordal region.',
             structures=['Tricuspid region', 'RV cavity', 'Subvalvular tissue'],
             target=[232., 186., 298.], right=[1., 0., .18], up=[0., -.13, -1.],
             focus=[230., 270.], cameraDistance=.94, closeDistance=.63, flip=False,
             review='The open right-heart cavity, thin free wall and tricuspid-side folds were reviewed in Y150–200 and X195–282 source sections. Individual leaflets are not assigned names.', note=common),
        dict(id='rv-outflow', chamber='RV', kind='Outflow', title='RV outflow', subtitle='Pulmonary valve & infundibulum',
             description='The cut follows the muscular outlet toward the pulmonary root. The cusp profiles are best inspected near the superior end of the outflow tract.',
             structures=['RV outflow tract', 'Pulmonary root', 'Cusp region'],
             target=[174., 292., 226.], right=[1., 0., 0.], up=[0., 0., -1.],
             focus=[180., 220.], cameraDistance=.80, closeDistance=.55, flip=False,
             review='Y260, 275, 290 and 305 candidates were compared with X145–190 sections. Y292 preserves the thin cusp profiles and their muscular outlet connection more clearly than the more anterior candidates.', note=common),
        dict(id='ra-inflow', chamber='RA', kind='Inflow', title='RA inflow', subtitle='Caval-side atrial wall',
             description='A broad atrial view toward the preserved venous-entry side. Follow the thin atrial wall and its folds, then turn toward the inferior outlet.',
             structures=['Right atrial cavity', 'Venous entry region', 'Atrial folds'],
             target=[245., 187., 175.], right=[1., 0., 0.], up=[0., .26, -1.],
             focus=[235., 260.], cameraDistance=.97, closeDistance=.66, flip=False,
             review='The right atrial cavity and superior venous-side continuity were reviewed in Y175–225 and X237–310 sections. Preserved vessel ends are truncated; this view does not claim that both complete caval veins are visible.', note=common),
        dict(id='ra-outflow', chamber='RA', kind='Outflow', title='RA outflow', subtitle='Tricuspid opening, atrial side',
             description='Look toward the tricuspid opening from the atrial side. The cut sits just above a best-fit plane through the reviewed hinge region, leaving the ventricular side in view.',
             structures=['Tricuspid opening', 'Leaflet margins', 'RV beyond the opening'],
             target=tricuspid, right=right, up=up,
             focus=[185., 180.], cameraDistance=.78, closeDistance=.53, flip=True,
             review='A plane was fitted to 14 previously reviewed tricuspid hinge landmarks, then moved 1.588 mm toward the atrium. Four nearby sections were compared. The hinge landmarks have a 1.84 mm RMS departure from the flat plane, so the view is not an annular measurement.', note=common),
        dict(id='lv-inflow', chamber='LV', kind='Inflow', title='LV inflow', subtitle='Mitral apparatus & chordal region',
             description='A long-axis cut through the mitral-side entrance and the collapsed left ventricular cavity. The oblique 3D angle exposes the tissue behind the cut face.',
             structures=['Mitral region', 'Chordal region', 'LV myocardium'],
             target=[290., 273., 288.], right=[.9, .2, 0.], up=[.37, .02, -1.],
             focus=[195., 240.], cameraDistance=.86, closeDistance=.58, flip=False,
             review='The left atrial/LV connection and subvalvular tissue were reviewed in X260–335 and Y250–325 planes. The LV lumen is markedly collapsed, so it does not resemble a distended clinical chamber.', note=common),
        dict(id='lv-outflow', chamber='LV', kind='Outflow', title='LV outflow', subtitle='Aortic valve & outflow tract',
             description='Follow the LV outflow tract into the aortic root. This oblique cut shows the bright arterial wall, cusp profiles and adjacent aortomitral region.',
             structures=['LV outflow tract', 'Aortic cusps', 'Aortomitral region'],
             target=[260., 265., 270.], right=[math.cos(math.pi / 6), math.sin(math.pi / 6), 0.], up=[.20, .02, -1.],
             focus=[195., 240.], cameraDistance=.86, closeDistance=.56, flip=False,
             review='Long-axis candidate rotations of −30, −10, +10 and +30 degrees were compared. The +30 degree source-XY direction includes the cusp profiles and LV continuation with less ventricular foreshortening. Source-paper valve figures support the regional identification.', note=common),
        dict(id='la-inflow', chamber='LA', kind='Inflow', title='LA inflow', subtitle='Pulmonary venous entry region',
             description='A lateral atrial cut across the preserved pulmonary venous entry region. Inspect the folded atrial lining and the transition into the short vessel ends.',
             structures=['Left atrial cavity', 'Venous entry region', 'Atrial folds'],
             target=[310., 302., 190.], right=[0., 1., 0.], up=[0., 0., -1.],
             focus=[195., 235.], cameraDistance=.88, closeDistance=.59, flip=False,
             review='X300, 310, 320 and 330 planes were compared. X310 shows continuity between the atrial cavity and the preserved venous-side openings; it does not show or individually identify all four pulmonary veins.', note=common),
        dict(id='la-outflow', chamber='LA', kind='Outflow', title='LA outflow', subtitle='Mitral opening, atrial side',
             description='View the mitral-side outlet from above the ventricular cavity. Use the close-up and a small rotation to inspect the folded leaflet tissue below the cut.',
             structures=['Mitral opening', 'Leaflet tissue', 'LV beyond the opening'],
             target=[306., 272., 262.], right=[0., 1., 0.], up=[1., 0., .38],
             focus=[175., 185.], cameraDistance=.76, closeDistance=.51, flip=False,
             review='Four nearby oblique levels centered at source Z262, 270, 277 and 285 were compared. The most atrial level leaves the leaflet/subvalvular region behind the plane rather than cutting deeply through it.', note=common),
    ]


def sample_plane(volume, origin, frame, scale=4.):
    center, right, up, _, width, height = frame
    nx, ny = int(round(width * scale)) + 1, int(round(height * scale)) + 1
    result = np.zeros((ny, nx), np.uint8)
    xs = np.linspace(-width / 2, width / 2, nx)
    ys = np.linspace(height / 2, -height / 2, ny)
    # Bounded rows avoid large coordinate arrays even on the full source cache.
    for row in range(0, ny, 64):
        q = ((center[None, None, :] + xs[None, :, None] * right
              + ys[row:row + 64, None, None] * up) * scale - origin)
        a = map_coordinates(volume, [q[..., 2], q[..., 1], q[..., 0]],
                            order=1, mode='constant', cval=0, prefilter=False)
        result[row:row + 64] = a
    return result


def focused_preview(data, frame, target, focus, size=520):
    center, right, up, _, width, height = frame
    center_u = (np.dot(np.asarray(target) - center, right) / width + .5) * (data.shape[1] - 1)
    center_v = (.5 - np.dot(np.asarray(target) - center, up) / height) * (data.shape[0] - 1)
    physical_span = max(focus)
    span_u = physical_span / width * (data.shape[1] - 1)
    span_v = physical_span / height * (data.shape[0] - 1)
    x, y = np.meshgrid(np.linspace(center_u - span_u / 2, center_u + span_u / 2, size),
                       np.linspace(center_v - span_v / 2, center_v + span_v / 2, size))
    view = map_coordinates(data, [y, x], order=1, mode='constant', cval=0, prefilter=False)
    return Image.fromarray(view)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-root', type=Path, default=Path('/workspace/data/heart-atlas-cache'))
    parser.add_argument('--output', type=Path, default=PROJECT / 'public/assets')
    parser.add_argument('--docs', type=Path, default=PROJECT / 'docs')
    args = parser.parse_args()
    source = args.data_root / 's2-clean-display-u8.npy'
    source_meta = json.loads((args.data_root / 's2-clean-display.json').read_text())
    volume = np.load(source, mmap_mode='r')
    origin = np.array(source_meta['originXYZ'], float)
    out = args.output / 'flow-textures'
    out.mkdir(parents=True, exist_ok=True)
    result = {'schemaVersion': 1, 'revision': 'source-reviewed-flow-v5',
              'specimen': 'LADAF-2021-17', 'datasetUrl': 'https://human-organ-atlas.esrf.fr/datasets/1659197537',
              'doi': '10.15151/ESRF-DC-1634390196', 'sourceSpacingUm': 79.4,
              'sourceWindow': [14640, 23545], 'coordinateSystem': 's4 voxel-center XYZ, 317.6 um; first and last voxel centers registered to the viewer',
              'sourceDimensionsXYZ': [475, 475, 530], 'boundsSourceXYZ': SOURCE_BOUNDS.tolist(),
              'boundsWorldXYZ': [rounded(point_world([SOURCE_BOUNDS[0, 0], SOURCE_BOUNDS[1, 1], SOURCE_BOUNDS[0, 2]])),
                                 rounded(point_world([SOURCE_BOUNDS[1, 0], SOURCE_BOUNDS[0, 1], SOURCE_BOUNDS[1, 2]]))],
              'sampling': 'Trilinear oblique reformat of the existing windowed s2 display array. Lossless WebP preserves the resulting 8-bit plane pixels; original quantitative uint16 voxels are not supplied.',
              'sourceSupport': 'Existing conservative clean-scan support. Omitted exterior is zero; no texture synthesis.',
              'references': [{'title': 'Original complete-heart dataset', 'url': 'https://human-organ-atlas.esrf.fr/datasets/1659197537'},
                             {'title': 'Brunet et al., Radiology 2024', 'url': 'https://pubmed.ncbi.nlm.nih.gov/39012246/'},
                             {'title': 'Brunet et al., source anatomy and valve figures, 2023 preprint', 'url': 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10592740/'}],
              'presets': []}
    validation = {'allLosslessRoundTrips': True, 'allFramesOrthonormal': True, 'allPixelStepsUm': 79.4,
                  'sourceArray': source.name, 'coordinateOriginXYZ': source_meta['originXYZ'], 'textures': []}
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 19)
    small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 13)
    thumb_width, cell_height = 520, 615
    sheet = Image.new('RGB', (4 * thumb_width, 2 * cell_height), '#0d1418')
    draw = ImageDraw.Draw(sheet)
    for i, item in enumerate(presets()):
        target = np.array(item.pop('target'), float)
        frame = bounds_frame(target, item.pop('right'), item.pop('up'))
        center, right, up, normal, width, height = frame
        data = sample_plane(volume, origin, frame)
        path = out / f'{item["id"]}.webp'
        Image.fromarray(data).save(path, format='WEBP', lossless=True, quality=100, method=6, exact=True)
        decoded = np.asarray(Image.open(path).convert('L'))
        error = int(np.abs(data.astype(np.int16) - decoded.astype(np.int16)).max())
        assert error == 0
        assert np.max(np.abs(np.stack([right, up, normal]) @ np.stack([right, up, normal]).T - np.eye(3))) < 1e-12
        raw_hash = hashlib.sha256(data.tobytes()).hexdigest()
        focus = item.pop('focus')
        preview = focused_preview(data, frame, target, focus)
        # Review figures apply a display contrast only; encoded cap pixels above remain exact.
        gray = np.array(preview, float) / 255
        preview_rgb = Image.fromarray((np.clip((gray - .08) / .82, 0, 1) * 255).astype('uint8')).convert('RGB')
        thumb = preview_rgb.resize((192, 192), Image.Resampling.LANCZOS)
        thumb_path = out / f'{item["id"]}-preview.webp'
        thumb.save(thumb_path, format='WEBP', lossless=True, method=6)
        item['world'] = {'center': rounded(point_world(center)), 'right': rounded(vec_world(right)),
                         'up': rounded(vec_world(up)), 'normal': rounded(vec_world(normal)),
                         'width': width / SCALE, 'height': height / SCALE, 'target': rounded(point_world(target))}
        item['source'] = {'center': rounded(center), 'right': rounded(right), 'up': rounded(up),
                          'normal': rounded(normal), 'width': width, 'height': height, 'target': rounded(target)}
        item['focusWidthMm'] = focus[0] * SOURCE_UM / 1000
        item['focusHeightMm'] = focus[1] * SOURCE_UM / 1000
        item['threshold'] = .28
        item['texture'] = {'url': f'./assets/flow-textures/{path.name}', 'width': data.shape[1], 'height': data.shape[0],
                           'bytes': path.stat().st_size, 'spacingUm': 79.4,
                           'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'decodedSha256': raw_hash,
                           'format': 'lossless WebP', 'maximumRoundTripError': error}
        item['previewUrl'] = f'./assets/flow-textures/{thumb_path.name}'
        result['presets'].append(item)
        validation['textures'].append({'id': item['id'], 'bytes': path.stat().st_size,
                                        'dimensionsXY': [data.shape[1], data.shape[0]], 'maximumRoundTripError': error,
                                        'planePixelStepUm': [width * SOURCE_UM / (data.shape[1] - 1), height * SOURCE_UM / (data.shape[0] - 1)],
                                        'decodedSha256': raw_hash})
        ox, oy = (i % 4) * thumb_width, (i // 4) * cell_height
        sheet.paste(preview_rgb, (ox, oy + 56))
        draw.text((ox + 14, oy + 10), item['title'], fill='#f2ede4', font=font)
        draw.text((ox + 14, oy + 34), item['subtitle'], fill='#a9bebc', font=small)
        draw.text((ox + 14, oy + 584), f'79.4 µm source · {path.stat().st_size / 1000:.0f} KB lossless · manually placed plane', fill='#97a5aa', font=small)
        scale_pixels = 10 / (max(focus) * .3176) * thumb_width
        draw.line((ox + 18, oy + 557, ox + 18 + scale_pixels, oy + 557), fill='#efe8df', width=2)
        draw.text((ox + 18, oy + 535), '10 mm', fill='#efe8df', font=small)
        print(json.dumps({'id': item['id'], 'textureBytes': path.stat().st_size, 'dimensions': list(data.shape[::-1]), 'losslessError': error}), flush=True)
    (args.output / 'flow-views-v5.json').write_text(json.dumps(result, indent=2) + '\n')
    validation['totalTextureBytes'] = sum(t['bytes'] for t in validation['textures'])
    validation['defaultViewOnlyDownloadsOneTexture'] = True
    (args.docs / 'flow-views-validation-v5.json').write_text(json.dumps(validation, indent=2) + '\n')
    sheet.save(args.docs / 'flow-views-source-review-v5.jpg', quality=96)


if __name__ == '__main__':
    main()
