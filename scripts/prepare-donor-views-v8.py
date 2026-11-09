"""Prepare independent, provisional UCL-ZCR-2629 annotations and view planes.

The inputs are this donor's registered, measured display arrays. No geometry,
labels or textures are copied from LADAF-2021-17. Labels are deliberately
conservative tissue territories, not expert segmentation. Ambiguous valve and
root junctions stay unassigned. Every output records that limitation.
"""
from pathlib import Path
import argparse
import gzip
import hashlib
import json
import math
import subprocess

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage
from skimage.segmentation import watershed

ROOT = Path(__file__).resolve().parents[1]
SLUG = 'ucl-zcr-2629'
SPECIMEN = 'UCL-ZCR-2629'
DATASET = '2298522198'
SOURCE_URL = f'https://human-organ-atlas.esrf.fr/datasets/{DATASET}'
DOI = '10.15151/ESRF-DC-2299323295'
NOTE = ('Independent source-derived candidate for UCL-ZCR-2629. Regional landmarks '
        'were inspected in this donor\'s CT sections, but chamber identity, valve '
        'annuli and clinical echo correspondence have not been independently '
        'confirmed. Adjust the plane to inspect the measured anatomy.')
COLORS = ['#9ba9b0', '#eab3b4', '#8cc5e5', '#d1b4e6', '#80cdd0', '#e9cb87', '#9bd8a6']
LABELS = [
    (0, 'unclassified', 'Unassigned tissue', 'No anatomical identity asserted.'),
    (1, 'lv', 'LV candidate', 'Compact ventricular myocardial body on the lower-X / lower-Y side. The septal region follows a provisional display convention.'),
    (2, 'rv', 'RV candidate', 'Ventricular tissue around the adjacent crescent-like cavity. The muscular outflow remains provisional.'),
    (3, 'la', 'LA candidate', 'Thin folded atrial-side tissue adjoining the provisional LV inlet. Veins and appendage identity are not assigned.'),
    (4, 'ra', 'RA candidate', 'Pectinate atrial-side tissue adjoining the provisional RV inlet. Caval openings are not individually identified.'),
    (5, 'aortic-region', 'Aortic-region candidate', 'Connected proximal arterial-wall candidate on the lower-X side. Exact vessel identity and valve boundary remain unconfirmed.'),
    (6, 'pulmonary-region', 'Pulmonary-region candidate', 'Connected proximal arterial-wall candidate on the higher-X side. Exact vessel identity and valve boundary remain unconfirmed.'),
]


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')


def unit(value):
    value = np.asarray(value, float)
    return value / np.linalg.norm(value)


def rounded(value):
    return np.round(np.asarray(value, float), 12).tolist()


class Geometry:
    def __init__(self, metadata):
        self.metadata = metadata
        self.dimensions = np.array(metadata['highDimensionsXYZ'], int)
        self.span = self.dimensions - 1
        self.scale = float(max(self.span))
        self.spacing = float(metadata['highSpacingUm'])
        self.fine_spacing = float(metadata['fineSpacingUm'])
        self.longest_mm = float(metadata['longestMm'])
        self.extent = np.array(metadata['extent'], float)
        self.full_fine = np.array(metadata['fullFineDimensionsXYZ'], int)
        self.fine_scale = float(max(self.full_fine - 1))

    def point_world(self, p):
        p = np.asarray(p, float) - self.span / 2
        return p[[0, 2, 1]] * [1, 1, -1] / self.scale

    def vector_world(self, p):
        return np.asarray(p)[[0, 2, 1]] * [1, 1, -1]

    def world_source(self, p, fine=False, origin=None):
        p = np.asarray(p)
        scale = self.fine_scale if fine else self.scale
        span = self.full_fine - 1 if fine else self.span
        result = p[..., [0, 2, 1]] * [1, -1, 1] * scale + span / 2
        if origin is not None:
            result -= origin
        return result

    def frame(self, target, right, up):
        target = np.asarray(target, float)
        right = unit(right)
        up = unit(np.asarray(up) - right * np.dot(up, right))
        normal = unit(np.cross(right, up))
        corners = np.array([[x, y, z] for x in [0, self.span[0]]
                            for y in [0, self.span[1]] for z in [0, self.span[2]]])
        r, u = (corners - target) @ right, (corners - target) @ up
        rlo, rhi, ulo, uhi = r.min() - 1, r.max() + 1, u.min() - 1, u.max() + 1
        center = target + right * (rlo + rhi) / 2 + up * (ulo + uhi) / 2
        world = dict(center=rounded(self.point_world(center)), right=rounded(self.vector_world(right)),
                     up=rounded(self.vector_world(up)), normal=rounded(self.vector_world(normal)),
                     width=float((rhi-rlo)/self.scale), height=float((uhi-ulo)/self.scale),
                     target=rounded(self.point_world(target)))
        source = dict(center=rounded(center), right=rounded(right), up=rounded(up),
                      normal=rounded(normal), target=rounded(target))
        return world, source


LANDMARKS = {
    'lv_mid_cavity_candidate': [98, 109, 275],
    'rv_mid_cavity_candidate': [165, 190, 277],
    'lv_apical_region': [109, 111, 412],
    'rv_apical_region': [168, 180, 390],
    'lv_inlet_candidate': [99, 139, 205],
    'rv_inlet_candidate': [178, 190, 204],
    'left_atrial_candidate': [68, 145, 129],
    'right_atrial_candidate': [225, 177, 145],
    'lower_x_arterial_hinge_candidate': [92, 111, 183],
    'higher_x_arterial_hinge_candidate': [214, 104, 183],
}


def echo_definitions():
    # Approximate common plane fitted to this donor's four candidate territories.
    points = np.array([LANDMARKS[k] for k in ['lv_mid_cavity_candidate', 'rv_mid_cavity_candidate',
                                            'left_atrial_candidate', 'right_atrial_candidate']], float)
    center = points.mean(0)
    _, _, vt = np.linalg.svd(points-center)
    normal = vt[-1]
    right = unit(points[1]-points[0])
    right = unit(right-normal*np.dot(right, normal))
    up = unit(np.cross(normal, right))
    if up[2] < 0:
        up = -up
    long_up = [-.045, -.02, 1]
    two_right = [-.70, .71, -.03]
    return {
        'a4c': (center, right, up),
        'a2c': ([95, 125, 255], two_right, long_up),
        'a3c': ([100, 115, 255], [.25, 1, 0], long_up),
        'plax': ([99, 127, 250], [0, 0, -1], [0, -1, .08]),
        'psax_papillary': ([137, 148, 275], [1, 0, .045], [0, -1, -.02]),
        'psax_mitral': ([137, 148, 211], [1, 0, .045], [0, -1, -.02]),
        'me4c': (center, right, -up),
        'me2c': ([95, 125, 255], two_right, -np.array(long_up)),
        'melax': ([100, 115, 255], [.25, 1, 0], -np.array(long_up)),
        'subcostal': (center, -up, -right),
        'meavsax': ([147, 112, 183], [1, 0, 0], [0, 1, .08]),
        'bicaval': ([222, 169, 147], [0, 1, 0], [0, 0, -1]),
        'tgpapillary': ([137, 148, 275], [-1, 0, -.045], [0, -1, -.02]),
    }


def flow_definitions():
    return [
        dict(id='rv-inflow', chamber='RV', kind='Inflow', title='RV inflow candidate', subtitle='Atrioventricular junction candidate',
             target=[178, 190, 215], right=[0, 1, 0], up=[.12, 0, -1], focus=[145, 180],
             description='Inspect the measured folds and subvalvular region at the candidate right-sided inlet.',
             structures=['Candidate RV inlet', 'Measured folds', 'Subvalvular tissue']),
        dict(id='rv-outflow', chamber='RV', kind='Outflow', title='RV outflow candidate', subtitle='Higher-X arterial-root connection',
             target=[214, 104, 183], right=[1, 0, .44], up=[.44, -.80, -1], focus=[135, 170],
             description='An oblique section follows the higher-X arterial hinge toward the adjacent ventricular territory.',
             structures=['Arterial hinge candidate', 'Cusp-like profiles', 'Ventricular continuation']),
        dict(id='ra-inflow', chamber='RA', kind='Inflow', title='RA inflow candidate', subtitle='Pectinate atrial-side tissue',
             target=[229, 181, 140], right=[0, 1, 0], up=[0, 0, -1], focus=[150, 175],
             description='Explore the folded atrial-side tissue and preserved openings. Individual caval veins are not identified.',
             structures=['Atrial wall candidate', 'Pectinate folds', 'Preserved openings']),
        dict(id='ra-outflow', chamber='RA', kind='Outflow', title='RA outflow candidate', subtitle='Inlet viewed from the atrial side',
             target=[177, 188, 201], right=[1, 0, -.12], up=[0, 1, .10], focus=[140, 145], flip=True,
             description='An approximate transverse section just above the candidate right ventricular inlet.',
             structures=['Inlet opening candidate', 'Leaflet-like folds', 'Ventricular tissue']),
        dict(id='lv-inflow', chamber='LV', kind='Inflow', title='LV inflow candidate', subtitle='Lower-X atrioventricular region',
             target=[99, 139, 208], right=[0, 1, 0], up=[0, -.12, -1], focus=[140, 175],
             description='A long section through the lower-X atrial connection and candidate ventricular inlet.',
             structures=['Candidate LV inlet', 'Valve-region folds', 'Compact myocardium']),
        dict(id='lv-outflow', chamber='LV', kind='Outflow', title='LV outflow candidate', subtitle='Lower-X arterial-root connection',
             target=[92, 111, 191], right=[1, 0, .06], up=[0, .03, -1], focus=[130, 165],
             description='A long-axis reference through the lower-X arterial hinge and its ventricular continuation.',
             structures=['Arterial hinge candidate', 'Cusp-like profiles', 'Ventricular continuation']),
        dict(id='la-inflow', chamber='LA', kind='Inflow', title='LA inflow candidate', subtitle='Folded atrial-side tissue',
             target=[64, 150, 124], right=[0, 1, 0], up=[0, 0, -1], focus=[155, 175],
             description='Inspect the thin atrial-side tissue and preserved openings. Pulmonary vein identities are not assigned.',
             structures=['Atrial wall candidate', 'Folded lining', 'Preserved openings']),
        dict(id='la-outflow', chamber='LA', kind='Outflow', title='LA outflow candidate', subtitle='Inlet viewed from the atrial side',
             target=[99, 139, 198], right=[1, 0, -.05], up=[0, 1, .12], focus=[135, 145], flip=True,
             description='An approximate transverse cut near the candidate left ventricular inlet.',
             structures=['Inlet opening candidate', 'Leaflet-like folds', 'Ventricular tissue']),
    ]


def sample_plane(volume, geometry, plane, fine=False, origin=None):
    spacing = geometry.fine_spacing if fine else geometry.spacing
    width = int(math.ceil(plane['width']*geometry.longest_mm*1000/spacing))+1
    height = int(math.ceil(plane['height']*geometry.longest_mm*1000/spacing))+1
    result = np.zeros((height, width), np.uint8)
    xs = np.linspace(-plane['width']/2, plane['width']/2, width)
    ys = np.linspace(plane['height']/2, -plane['height']/2, height)
    c, r, u = [np.array(plane[k]) for k in ['center', 'right', 'up']]
    for start in range(0, height, 64):
        points = c+xs[None, :, None]*r+ys[start:start+64, None, None]*u
        q = geometry.world_source(points, fine=fine, origin=origin)
        values = ndimage.map_coordinates(volume, [q[..., 2], q[..., 1], q[..., 0]],
                                         order=1, mode='constant', cval=0, prefilter=False)
        result[start:start+64] = values
    return result


def write_texture(path, data, url, spacing, plane, geometry):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(data).save(path, format='WEBP', lossless=True, quality=100, method=6, exact=True)
    decoded = np.asarray(Image.open(path).convert('L'))
    if not np.array_equal(decoded, data):
        raise ValueError('Lossless texture round trip failed.')
    return dict(url=url, width=data.shape[1], height=data.shape[0], bytes=path.stat().st_size,
                sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                pixelSha256=hashlib.sha256(data.tobytes()).hexdigest(),
                spacingUm=spacing, sourceSpacingUm=geometry.fine_spacing,
                spacingUmXY=[plane['width']*geometry.longest_mm*1000/(data.shape[1]-1),
                             plane['height']*geometry.longest_mm*1000/(data.shape[0]-1)],
                cleaned=True, lossless=True)


def make_contact_sheet(items, out, columns=4, labels=None):
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 17)
    small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 12)
    cell_w, cell_h = 400, 550
    sheet = Image.new('RGB', (columns*cell_w, math.ceil(len(items)/columns)*cell_h), '#0c1317')
    draw = ImageDraw.Draw(sheet)
    for i, (name, data) in enumerate(items):
        x, y = i % columns*cell_w, i//columns*cell_h
        image = Image.fromarray(data).convert('RGB')
        image.thumbnail((cell_w-18, cell_h-76), Image.Resampling.LANCZOS)
        sheet.paste(image, (x+(cell_w-image.width)//2, y+40))
        draw.text((x+12, y+9), name, font=font, fill='#e9c3ad')
        draw.text((x+12, y+cell_h-25), 'UCL-ZCR-2629 · provisional source plane', font=small, fill='#9db3b8')
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out, quality=93)


def prepared_probe_planes(source, geometry, frames, origin, output, docs):
    """Use the actual browser pose implementation, avoiding a second geometry model."""
    javascript = """
      import fs from 'node:fs';
      import {PROBE_PRESETS,PROBE_REFERENCE_MM,sanitizeProbeState,probePose,probeCapPlane,volumeGeometry} from './public/probe-geometry.js';
      const input=JSON.parse(fs.readFileSync(0,'utf8'));
      const geometry=volumeGeometry(input.meta),scale=geometry.longestMm/PROBE_REFERENCE_MM;
      const planes=PROBE_PRESETS.map(p=>{
        const frame={...input.frames[p.frame].world,referenceMm:geometry.longestMm};
        const state=sanitizeProbeState({preset:p.id,referenceMm:geometry.longestMm,depthMm:p.depthMm*scale,angleDeg:p.angleDeg,contactLocked:true,contactPositionMm:[0,0]});
        const pose=probePose(state,frame);return {id:p.id,state,pose,plane:probeCapPlane(pose,geometry)};
      });
      process.stdout.write(JSON.stringify(planes));
    """
    payload = dict(meta=dict(dimensions=geometry.dimensions.tolist(), spacingUm=geometry.spacing), frames=frames['frames'])
    completed = subprocess.run(['node', '--input-type=module', '-e', javascript], cwd=ROOT,
                               input=json.dumps(payload), capture_output=True, text=True, check=True)
    descriptors = json.loads(completed.stdout)
    items, review = [], []
    for descriptor in descriptors:
        key, plane = descriptor['id'], descriptor['plane']
        pixels = sample_plane(source, geometry, plane, True, origin)
        entry = write_texture(output/'probe-textures'/f'{key}.webp', pixels,
                              f'./assets/donors/{SLUG}/probe-textures/{key}.webp', geometry.fine_spacing, plane, geometry)
        entry.update(id=key, plane=plane)
        items.append(entry);review.append((key, pixels))
    manifest_path = output/'ultra-volume.json'
    manifest = json.loads(manifest_path.read_text())
    if abs(float(manifest['sourceSpacingUm'])-geometry.fine_spacing) > 1e-8:
        raise ValueError('Prepared probe source spacing differs from the brick volume.')
    manifest['preparedPlanes'] = items
    write_json(manifest_path, manifest)
    write_json(docs/'probe-default-planes.json', descriptors)
    write_json(docs/'probe-prepared-textures.json', items)
    make_contact_sheet(review, docs/'probe-fine-review.jpg')
    print('PROBE READY', sum(item['bytes'] for item in items), flush=True)


def anatomy_candidates(high, geometry, output, docs):
    """Intersect anatomical spatial priors with an independent gradient watershed.

    The prior is hand specified for this donor, not a learned classifier. Only
    agreeing tissue voxels survive, and broad valve/junction belts stay neutral.
    """
    shape = (305, 195, 193)
    working = ndimage.zoom(high, np.array(shape)/high.shape, order=1, prefilter=False)
    density = ndimage.gaussian_filter(working.astype(np.float32), .55)
    z = np.linspace(0, geometry.span[2], shape[0])[:, None, None]
    y = np.linspace(0, geometry.span[1], shape[1])[None, :, None]
    x = np.linspace(0, geometry.span[0], shape[2])[None, None, :]
    tissue = density > 65
    prior = np.zeros(shape, np.uint8)
    # A continuous compact myocardial envelope; its shared septal assignment
    # is a display convention, not proof of a separable LV/RV tissue boundary.
    zs = [185, 220, 270, 320, 365, 405, 440]
    cx = np.interp(z.ravel(), zs, [97, 98, 101, 107, 110, 112, 116])[:, None, None]
    cy = np.interp(z.ravel(), zs, [107, 104, 106, 108, 115, 123, 130])[:, None, None]
    rx = np.interp(z.ravel(), zs, [88, 102, 108, 107, 91, 60, 12])[:, None, None]
    ry = np.interp(z.ravel(), zs, [79, 92, 99, 97, 84, 55, 12])[:, None, None]
    ventricular_ellipse = ((x-cx)/rx)**2+((y-cy)/ry)**2
    ventricular = (z > 212) & (z < 439)
    prior[tissue & ventricular & (ventricular_ellipse < .96)] = 1
    prior[tissue & ventricular & (ventricular_ellipse > 1.08) & (z < 412) & (x+y > 205)] = 2
    la = ((x-70)/69)**2+((y-150)/85)**2+((z-119)/91)**2
    ra = ((x-226)/51)**2+((y-181)/66)**2+((z-137)/72)**2
    prior[tissue & (la < .94) & (z < 185)] = 3
    prior[tissue & (ra < .94) & (z < 192) & (y > 135)] = 4
    # Arterial identities are candidates. Restrict color to connected walls
    # around the inspected lumen routes and stop above ambiguous hinge tissue.
    routes = [
        (5, [45, 85, 135, 175], [117, 99, 80, 90], [64, 88, 101, 110], [24, 26, 28, 33]),
        (6, [30, 80, 130, 175], [201, 201, 213, 213], [72, 85, 111, 105], [26, 29, 31, 34]),
    ]
    vessel_masks = []
    for label, levels, xs, ys, radii in routes:
        vx = np.interp(z.ravel(), levels, xs)[:, None, None]
        vy = np.interp(z.ravel(), levels, ys)[:, None, None]
        radius = np.interp(z.ravel(), levels, radii)[:, None, None]
        region = tissue & (((x-vx)**2+(y-vy)**2) < radius**2) & (z > min(levels)) & (z < max(levels))
        components, count = ndimage.label(region)
        sizes = np.bincount(components.ravel());sizes[0] = 0
        if count:
            region = components == sizes.argmax()
        vessel_masks.append(region)
        prior[region] = label
    # Valve belts and the small interventricular ambiguity band deliberately
    # remain zero even if later edge propagation would suggest a label.
    allowed = (prior > 0)
    markers = np.zeros(shape, np.int32)
    erosion = ndimage.generate_binary_structure(3, 1)
    seed_counts = {}
    for label in range(1, 7):
        core = ndimage.binary_erosion(prior == label, structure=erosion, iterations=2)
        if not core.any():
            raise ValueError(f'No retained tissue seed for {label}')
        markers[core] = label
        seed_counts[str(label)] = int(core.sum())
    gradient = ndimage.gaussian_gradient_magnitude(density, .8)
    edge = watershed(gradient, markers, mask=tissue & ndimage.binary_dilation(allowed, iterations=2),
                     connectivity=1, watershed_line=True).astype(np.uint8)
    result = np.where((prior == edge) & allowed, prior, 0).astype(np.uint8)
    # Retain connected core territories, dropping isolated colored specks.
    for label in range(1, 7):
        components, count = ndimage.label(result == label)
        if not count:
            raise ValueError(f'Candidate {label} was lost')
        counts = np.bincount(components.ravel());counts[0] = 0
        keep = counts > max(20, counts.max()*.0002)
        result[(result == label) & ~keep[components]] = 0
    out = output/'anatomy';out.mkdir(parents=True, exist_ok=True)
    raw = result.tobytes();packed = gzip.compress(raw, compresslevel=9, mtime=0)
    (out/'labels.raw.gz').write_bytes(packed)
    dimensions = list(shape[::-1])
    manifest = dict(schemaVersion=2, revision='ucl-zcr-2629-provisional-v8',
                    title='Provisional source-guided tissue regions', specimen=SPECIMEN,
                    datasetId=DATASET, datasetUrl=SOURCE_URL, sourceDoi=DOI,
                    sourceLicense='CC BY 4.0', sourceAttribution='Human Organ Atlas Collaboration / ESRF',
                    dimensions=dimensions, volumeUrl=f'./assets/donors/{SLUG}/anatomy/labels.raw.gz',
                    arrayOrder='ZYX in NumPy; X-fastest bytes', dtype='uint8',
                    registration='Endpoints of this grid match the registered browser volume and level-2 physical voxel centers.',
                    sourceDimensionsXYZ=geometry.dimensions.tolist(), sourceSpacingUm=geometry.spacing,
                    labelGridSpacingUmXYZ=(geometry.span*geometry.spacing/(np.array(dimensions)-1)).tolist(),
                    sourceReviewed=True, clinicalPresetsReviewed=False, expertValidated=False,
                    compressedBytes=len(packed), decodedBytes=len(raw),
                    sha256=hashlib.sha256(raw).hexdigest(), compressedSha256=hashlib.sha256(packed).hexdigest(),
                    method='This donor\'s inspected spatial territories intersected with an independent intensity-gradient seeded watershed; disagreements, valve belts and ambiguous roots remain neutral.',
                    rendering='Only measured tissue is tinted. Empty lumen is never filled by labels.',
                    validation='Source-only visual review of orthogonal sections and candidate overlays. Agreement is an algorithmic consistency check, not anatomical accuracy or independent validation.',
                    limitations=[NOTE, 'No expert labels or trained cardiac model were available.',
                                 'LV/RV, atrial and arterial identities are provisional morphology-based hypotheses.',
                                 'Valve attachments, caval veins, individual pulmonary veins and coronary vessels remain unassigned.',
                                 'No quantitative chamber, vessel, wall-thickness or diagnostic measurements are supported.'],
                    labels=[])
    for label, key, name, description in LABELS:
        record = dict(id=label, key=key, name=name, color=COLORS[label], description=description,
                      confidence='Unassigned' if label == 0 else 'Provisional; no expert confirmation',
                      method='Source-specific morphology and watershed agreement')
        if label:
            coords = np.argwhere(result == label)[:, ::-1]
            lo, hi = coords.min(0), coords.max(0)
            anchor = coords[len(coords)//2]/(np.array(dimensions)-1)*geometry.span
            record.update(voxelCount=int(len(coords)), boundsNormalizedXYZ=[(lo/(np.array(dimensions)-1)).tolist(), (hi/(np.array(dimensions)-1)).tolist()], referenceAnchorSourceXYZ=rounded(anchor))
        manifest['labels'].append(record)
    write_json(out/'manifest.json', manifest)
    report = dict(datasetId=DATASET, dimensionsXYZ=dimensions, tissueVoxels=int(tissue.sum()),
                  assignedTissueVoxels=int((result > 0).sum()), unknownTissueVoxels=int((tissue & (result == 0)).sum()),
                  methodComparison=dict(priorAssigned=int((prior > 0).sum()), watershedAssigned=int((edge > 0).sum()),
                                        disagreementsRetainedAsUnknown=int(((prior != edge) & allowed).sum()), seedCounts=seed_counts),
                  labelCounts={str(k): int((result == k).sum()) for k in range(1, 7)},
                  calibrationLandmarksSourceHighXYZ=LANDMARKS, quantitativeAccuracy='Not measured; no expert ground truth.')
    write_json(docs/'anatomy-review.json', report)
    # Source plus overlay gives a reviewable record of actual boundaries.
    rgb = np.array([[int(c[i:i+2], 16) for i in [1, 3, 5]] for c in COLORS])
    panels = []
    for axis, value in [('Z', 145), ('Z', 235), ('Z', 300), ('Z', 370), ('Y', 110), ('Y', 185), ('X', 100), ('X', 200)]:
        idx = round(value/geometry.span['XYZ'.index(axis)]*(dimensions['XYZ'.index(axis)]-1))
        gray = working[idx] if axis == 'Z' else working[:, idx, :] if axis == 'Y' else working[:, :, idx]
        lab = result[idx] if axis == 'Z' else result[:, idx, :] if axis == 'Y' else result[:, :, idx]
        base = np.repeat(gray[..., None], 3, -1).astype(float)
        colored = np.where((lab > 0)[..., None], base*.43+rgb[lab]*.57, base)
        pair = np.concatenate([base.astype('uint8'), colored.astype('uint8')], 1)
        panels.append((f'{axis}={value}: source / candidate', pair))
    make_contact_sheet(panels, docs/'anatomy-candidate-review.jpg', columns=2)
    print('ANATOMY', json.dumps(report['labelCounts']), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, default=Path('/workspace/data/heart-donor-2298522198'))
    parser.add_argument('--output', type=Path, default=ROOT/'public/assets/donors'/SLUG)
    parser.add_argument('--docs', type=Path, default=ROOT/'docs/donors'/SLUG)
    parser.add_argument('--preview-only', action='store_true')
    parser.add_argument('--skip-anatomy', action='store_true')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True);args.docs.mkdir(parents=True, exist_ok=True)
    geometry = Geometry(json.loads((args.source_root/'browser-geometry.json').read_text()))
    high = np.load(args.source_root/'display-high-clean-u8.npy', mmap_mode='r')
    source = high;origin = None;fine = not args.preview_only
    if fine:
        metadata = json.loads((args.source_root/'s2-clean-display.json').read_text())
        origin = np.asarray(metadata['originXYZ'])
        source = np.load(args.source_root/'s2-clean-display-u8.npy', mmap_mode='r')
    frames = dict(schemaVersion=2, datasetId=DATASET, specimen=SPECIMEN, datasetUrl=SOURCE_URL,
                  sourceReviewed=True, clinicalPresetsReviewed=False, expertValidated=False,
                  voxelSpacingMm=geometry.spacing/1000, dimensionsXYZ=geometry.dimensions.tolist(),
                  worldExtentXYZ=geometry.extent.tolist(), referenceMm=geometry.longest_mm,
                  worldMapping='Registered high-grid XYZ mapped to [X, Z, -Y], centered and divided by longest voxel-center extent.',
                  validation=NOTE, limitations=[NOTE, 'No body or probe registration is available.'],
                  landmarks={k: dict(voxelXYZ=v, confidence='provisional source landmark') for k, v in LANDMARKS.items()}, frames={})
    echo_textures = dict(schemaVersion=2, datasetId=DATASET, specimen=SPECIMEN, sourceSpacingUm=geometry.fine_spacing, textures={})
    review = []
    for key, (target, right, up) in echo_definitions().items():
        world, src = geometry.frame(target, right, up)
        frames['frames'][key] = dict(world=world, source=src, confidence='provisional source-derived reference', note=NOTE)
        pixels = sample_plane(source, geometry, world, fine, origin)
        if fine:
            echo_textures['textures'][key] = write_texture(args.output/'echo-textures'/f'{key}.webp', pixels,
                f'./assets/donors/{SLUG}/echo-textures/{key}.webp', geometry.fine_spacing, world, geometry)
        review.append((key, pixels))
    write_json(args.output/'echo-planes.json', frames)
    if fine:
        write_json(args.output/'echo-textures.json', echo_textures)
    make_contact_sheet(review, args.docs/('echo-fine-review.jpg' if fine else 'echo-candidate-review.jpg'))
    if fine:
        prepared_probe_planes(source, geometry, frames, origin, args.output, args.docs)
    flows = dict(schemaVersion=2, revision='ucl-zcr-2629-source-candidates-v8', datasetId=DATASET,
                 specimen=SPECIMEN, datasetUrl=SOURCE_URL, doi=DOI, sourceSpacingUm=geometry.fine_spacing,
                 sourceReviewed=True, clinicalPresetsReviewed=False, expertValidated=False, note=NOTE, presets=[])
    flow_review = []
    for item in flow_definitions():
        world, src = geometry.frame(item.pop('target'), item.pop('right'), item.pop('up'))
        pixels = sample_plane(source, geometry, world, fine, origin)
        focus = item.pop('focus')
        item.update(world=world, source=src, focusWidthMm=focus[0]*geometry.spacing/1000,
                    focusHeightMm=focus[1]*geometry.spacing/1000, cameraDistance=.82,
                    closeDistance=.52, threshold=.28, flip=item.get('flip', False),
                    review='New donor source sections and these oblique candidate reformats were inspected. The anatomical names remain provisional; these are not independently validated valve windows.', note=NOTE)
        if fine:
            item['texture'] = write_texture(args.output/'flow-textures'/f'{item["id"]}.webp', pixels,
                f'./assets/donors/{SLUG}/flow-textures/{item["id"]}.webp', geometry.fine_spacing, world, geometry)
        # Thumbnail focuses the selected target, not the entire physical field.
        target = np.array(world['target'])-world['center']
        uc = np.dot(target, world['right'])/world['width']+.5
        vc = .5-np.dot(target, world['up'])/world['height']
        span = max(focus)/geometry.scale
        xx, yy = np.meshgrid((uc+np.linspace(-.5,.5,240)*span/world['width'])*(pixels.shape[1]-1),
                             (vc+np.linspace(-.5,.5,240)*span/world['height'])*(pixels.shape[0]-1))
        preview = ndimage.map_coordinates(pixels, [yy,xx], order=1, mode='constant', cval=0, prefilter=False)
        path = args.output/'flow-textures'/f'{item["id"]}-preview.webp';path.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(preview).save(path, format='WEBP', lossless=True, method=6)
        item['previewUrl'] = f'./assets/donors/{SLUG}/flow-textures/{path.name}'
        flows['presets'].append(item);flow_review.append((item['id'], preview))
    if fine:
        write_json(args.output/'flow-views.json', flows)
    make_contact_sheet(flow_review, args.docs/('flow-fine-review.jpg' if fine else 'flow-candidate-review.jpg'))
    if not args.skip_anatomy:
        anatomy_candidates(high, geometry, args.output, args.docs)
    write_json(args.docs/'view-preparation.json', dict(datasetId=DATASET, fine=fine, sourceReviewed=True,
        clinicalPresetsReviewed=False, spacingUm=geometry.fine_spacing if fine else geometry.spacing,
        echoPlaneCount=len(frames['frames']), flowPlaneCount=len(flows['presets']), limitations=[NOTE],
        textureBytes=sum(t['bytes'] for t in echo_textures['textures'].values())+sum(p.get('texture',{}).get('bytes',0) for p in flows['presets'])))
    print('VIEWS READY', 'fine' if fine else 'preview', flush=True)


if __name__ == '__main__':
    main()
