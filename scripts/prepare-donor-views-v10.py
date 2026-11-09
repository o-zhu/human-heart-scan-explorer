"""Prepare donor-specific measured comparison planes without anatomical guesses.

The 13 echo compatibility keys and eight flow compatibility keys are routing
identifiers only. Their displayed names are geometric, and neither chamber
identity nor clinical echo registration is asserted. Every image is sampled
from the selected donor's own registered volume. No other donor's coordinates,
labels, textures, or chamber dimensions are reused.
"""
from pathlib import Path
import argparse
import gzip
import hashlib
import json
import math
import os
import subprocess

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage


ROOT = Path(__file__).resolve().parents[1]
DONORS = {
    'ucl-zcr-2337': ('UCL-ZCR-2337', '2298521860'),
    'ucl-zcr-2627': ('UCL-ZCR-2627', '2298522608'),
    'ucl-zcr-2628': ('UCL-ZCR-2628', '2298522707'),
    'ladaf-2020-31': ('LADAF-2020-31', '1966161627'),
    's-20-29': ('S-20-29', '1773963465'),
    's-20-28': ('S-20-28', '1966162746'),
}
# Retired UCL sources remain reproducible by explicit --slug; the ordinary
# current-release audit only needs the requested comparison donors.
ACTIVE_DONORS = ('s-20-29', 's-20-28')
# Source-only review found substantial adjacent lung in 2337. This box guides
# framing and geometric axes only; it neither deletes voxels nor labels tissue.
# Bounds were inspected on actual source level-4 XYZ sections (439,478,422 span).
FOCUS_REGIONS = {
    'ucl-zcr-2337': dict(boundsNormalizedXYZ=[[275/439, 95/478, 100/422],
                                             [435/439, 290/478, 320/422]],
                        note='Heart-focused field within a scan that also contains substantial adjacent lung tissue. No chamber identities assigned.'),
}
NOTE = ('Measured comparison plane derived independently from this donor. '
        'Chambers, valve attachments and inflow/outflow identities have not been '
        'assigned. The clinical ultrasound movie is an independent reference, '
        'not an anatomically registered or same-donor acquisition.')


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name+f'.pending-{os.getpid()}')
    temporary.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')
    temporary.replace(path)


def unit(vector):
    vector = np.asarray(vector, dtype=float)
    length = np.linalg.norm(vector)
    if not np.isfinite(length) or length < 1e-9:
        raise ValueError('Degenerate comparison frame')
    return vector / length


def rounded(vector):
    return np.asarray(vector, dtype=float).round(12).tolist()


def file_sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(4*1024*1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def spacing3(value):
    result = np.repeat(float(value), 3) if np.isscalar(value) else np.asarray(value, dtype=float)
    if result.shape != (3,) or not np.all(np.isfinite(result)) or np.any(result <= 0):
        raise ValueError('Invalid physical voxel spacing')
    return result


class Geometry:
    """Physical coordinate conversion, including endpoint-aligned anisotropic grids."""

    def __init__(self, metadata):
        self.dimensions = np.asarray(metadata['highDimensionsXYZ'], dtype=int)
        self.span = self.dimensions - 1
        self.spacing = spacing3(metadata['highSpacingUm'])
        self.physical = self.span * self.spacing
        self.longest_um = float(max(self.physical))
        self.longest_mm = self.longest_um / 1000
        self.extent = self.physical[[0, 2, 1]] / self.longest_um
        self.fine_dimensions = np.asarray(metadata.get('fullFineDimensionsXYZ', self.dimensions), dtype=int)
        self.fine_spacing = spacing3(metadata.get('fineSpacingUm', self.spacing))
        self.focus_bounds = np.array([[0, 0, 0], self.span], dtype=float)
        if abs(self.longest_mm-float(metadata['longestMm'])) > .001:
            raise ValueError('Physical grid disagrees with browser longest extent')
        if not np.allclose((self.fine_dimensions-1)*self.fine_spacing, self.physical, rtol=0, atol=1e-5):
            raise ValueError('Fine and browser grids do not share physical endpoints')

    def point_world(self, source_xyz):
        physical = (np.asarray(source_xyz, dtype=float)-self.span/2)*self.spacing
        return physical[..., [0, 2, 1]]*[1, 1, -1]/self.longest_um

    @staticmethod
    def direction_world(physical_xyz):
        return np.asarray(physical_xyz, dtype=float)[..., [0, 2, 1]]*[1, 1, -1]

    def world_source(self, world, fine=False, origin=None):
        world = np.asarray(world, dtype=float)
        physical = world[..., [0, 2, 1]]*[1, -1, 1]*self.longest_um
        shape = self.fine_dimensions if fine else self.dimensions
        spacing = self.fine_spacing if fine else self.spacing
        result = physical/spacing + (shape-1)/2
        if origin is not None:
            result -= np.asarray(origin)
        return result

    def frame(self, target, right, up):
        """Target is high-grid XYZ; directions are unit physical-XYZ vectors."""
        target = np.asarray(target, dtype=float)
        right = unit(right)
        up = unit(np.asarray(up)-right*np.dot(up, right))
        normal = unit(np.cross(right, up))
        lo, hi = self.focus_bounds
        corners = np.array([[x, y, z] for x in [lo[0], hi[0]]
                            for y in [lo[1], hi[1]] for z in [lo[2], hi[2]]])
        delta = (corners-target)*self.spacing
        r, u = delta@right, delta@up
        padding = float(max(self.spacing))
        rlo, rhi = r.min()-padding, r.max()+padding
        ulo, uhi = u.min()-padding, u.max()+padding
        center = target + (right*(rlo+rhi)/2 + up*(ulo+uhi)/2)/self.spacing
        world = dict(center=rounded(self.point_world(center)), right=rounded(self.direction_world(right)),
                     up=rounded(self.direction_world(up)), normal=rounded(self.direction_world(normal)),
                     width=float((rhi-rlo)/self.longest_um), height=float((uhi-ulo)/self.longest_um),
                     target=rounded(self.point_world(target)))
        source = dict(center=rounded(center), target=rounded(target),
                      rightPhysicalXYZ=rounded(right), upPhysicalXYZ=rounded(up),
                      normalPhysicalXYZ=rounded(normal))
        return world, source


def measured_basis(volume, geometry):
    """A reproducible geometric frame from this donor's actual tissue support."""
    stride = max(1, int(math.ceil(max(volume.shape)/180)))
    sampled = np.asarray(volume[::stride, ::stride, ::stride])
    z, y, x = np.ogrid[:sampled.shape[0], :sampled.shape[1], :sampled.shape[2]]
    lo, hi = geometry.focus_bounds
    focus = ((x*stride >= lo[0]) & (x*stride <= hi[0]) & (y*stride >= lo[1]) &
             (y*stride <= hi[1]) & (z*stride >= lo[2]) & (z*stride <= hi[2]))
    positive = sampled[(sampled > 24) & focus]
    if len(positive) < 100:
        raise ValueError('Too little measured tissue to place comparison planes')
    threshold = max(48, float(np.percentile(positive, 45)))
    coords_zyx = np.argwhere((sampled >= threshold) & focus)
    coords = coords_zyx[:, ::-1]*stride
    weights = sampled[tuple(coords_zyx.T)].astype(float)
    center = np.average(coords, axis=0, weights=weights)
    points = (coords-center)*geometry.spacing
    covariance = (points*weights[:, None]).T@points/weights.sum()
    values, vectors = np.linalg.eigh(covariance)
    order = np.argsort(values)[::-1]
    major, right = vectors[:, order[0]], vectors[:, order[1]]
    if major[np.argmax(np.abs(major))] < 0:
        major = -major
    if right[np.argmax(np.abs(right))] < 0:
        right = -right
    across = unit(np.cross(major, right))
    right = unit(np.cross(across, major))
    major_span = np.percentile(points@major, [5, 95])
    offset_um = float((major_span[1]-major_span[0])*.18)
    review = dict(method='Intensity-weighted principal axes of this donor\'s sampled cleaned tissue; geometric axes only.',
                  sampleStride=stride, thresholdByte=threshold, sampledVoxelCount=len(coords),
                  centerSourceHighXYZ=rounded(center), majorPhysicalXYZ=rounded(major),
                  rightPhysicalXYZ=rounded(right), acrossPhysicalXYZ=rounded(across),
                  eigenvaluesUmSquared=values[order].tolist(), offsetUm=offset_um,
                  framingBoundsSourceHighXYZ=geometry.focus_bounds.tolist(),
                  anatomicalAxisClaim=False)
    return center, right, major, across, offset_um, review


def plane_definitions(basis, geometry):
    center, right, up, across, offset_um, _ = basis
    oblique = unit(right*math.cos(math.pi/6)+across*math.sin(math.pi/6))
    offset = up*offset_um/geometry.spacing
    side_offset = right*offset_um*.65/geometry.spacing
    # These internal keys preserve existing controls and bookmarks. Only the
    # neutral display names below are presented to the user, without assigning anatomy.
    echo = {
        'a4c': ('L1', 'Long section A', center, right, up),
        'a2c': ('L2', 'Long section B', center, across, up),
        'a3c': ('O1', 'Oblique long section', center, oblique, up),
        'plax': ('L3', 'Crossed long section', center, up, across),
        'psax_papillary': ('C1', 'Central cross section', center, right, across),
        'psax_mitral': ('C2', 'Offset cross section', center-offset, right, across),
        'subcostal': ('L4', 'Rotated long section', center, -up, right),
        'me4c': ('R1', 'Long section A · reverse', center, right, -up),
        'me2c': ('R2', 'Long section B · reverse', center, across, -up),
        'melax': ('R3', 'Oblique section · reverse', center, oblique, -up),
        'meavsax': ('C3', 'Offset cross section A', center-offset, right, -across),
        'bicaval': ('O2', 'Offset long section', center+side_offset, across, -up),
        'tgpapillary': ('C4', 'Offset cross section B', center+offset, -right, across),
    }
    flow = [
        ('rv-inflow', 'Long sections', 'Long section A', center, right, up),
        ('rv-outflow', 'Long sections', 'Long section B', center, across, up),
        ('ra-inflow', 'Cross sections', 'Central cross section', center, right, across),
        ('ra-outflow', 'Cross sections', 'Offset cross section', center-offset, right, across),
        ('lv-inflow', 'Oblique sections', 'Oblique long section', center, oblique, up),
        ('lv-outflow', 'Oblique sections', 'Oblique cross section', center, oblique, unit(up+across)),
        ('la-inflow', 'Offset sections', 'Offset long section A', center-side_offset, across, up),
        ('la-outflow', 'Offset sections', 'Offset cross section B', center+offset, right, across),
    ]
    return echo, flow


def sample_plane(volume, geometry, plane, fine=False, origin=None, source_order=None):
    spacing = float(min(geometry.fine_spacing if fine else geometry.spacing))
    width = int(math.ceil(plane['width']*geometry.longest_um/spacing))+1
    height = int(math.ceil(plane['height']*geometry.longest_um/spacing))+1
    result = np.zeros((height, width), dtype=np.uint8)
    xs = np.linspace(-plane['width']/2, plane['width']/2, width)
    ys = np.linspace(plane['height']/2, -plane['height']/2, height)
    center, right, up = [np.asarray(plane[k]) for k in ['center', 'right', 'up']]
    if source_order is None:
        source_order = fine and volume.nbytes > 512*1024*1024
    if source_order:
        # World Y is source Z. Sorting requests along that axis keeps the
        # working set within adjacent source slices instead of repeatedly
        # faulting across a multi-gigabyte memory map. The actual coordinate
        # expression and trilinear interpolation are identical to the row path.
        world_y = center[1]+xs[None, :]*right[1]+ys[:, None]*up[1]
        order = np.argsort(world_y.ravel(), kind='stable')
        del world_y
        flat = result.ravel()
        for start in range(0, len(order), 32768):
            ids = order[start:start+32768]
            rows, columns = np.divmod(ids, width)
            points = center+xs[columns, None]*right+ys[rows, None]*up
            q = geometry.world_source(points, fine=fine, origin=origin)
            flat[ids] = ndimage.map_coordinates(volume, [q[:, 2], q[:, 1], q[:, 0]],
                                               order=1, mode='constant', cval=0, prefilter=False)
        return result
    for start in range(0, height, 32):
        points = center+xs[None, :, None]*right+ys[start:start+32, None, None]*up
        q = geometry.world_source(points, fine=fine, origin=origin)
        result[start:start+32] = ndimage.map_coordinates(volume, [q[..., 2], q[..., 1], q[..., 0]],
                                                        order=1, mode='constant', cval=0, prefilter=False)
    return result


def texture(path, pixels, slug, spacing, plane, geometry):
    path.parent.mkdir(parents=True, exist_ok=True)
    unchanged = False
    if path.exists():
        try:
            unchanged = np.array_equal(pixels, np.asarray(Image.open(path).convert('L')))
        except OSError:
            pass
    stored = path
    if not unchanged:
        # Method 4 keeps exactly the same decoded pixels. On an existing
        # 1526x1909 measured plane it was only 0.47% larger than method 6 and
        # substantially faster, avoiding long preparation stalls.
        stored = path.with_name(path.name+f'.pending-{os.getpid()}')
        Image.fromarray(pixels).save(stored, format='WEBP', lossless=True, quality=100, method=4, exact=True)
    if not np.array_equal(pixels, np.asarray(Image.open(stored).convert('L'))):
        if stored != path:
            stored.unlink(missing_ok=True)
        raise ValueError('Measured WebP image was not lossless')
    if stored != path:
        stored.replace(path)
    return dict(url='./'+str(path.relative_to(ROOT/'public')), width=pixels.shape[1], height=pixels.shape[0],
                bytes=path.stat().st_size, sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                pixelSha256=hashlib.sha256(pixels.tobytes()).hexdigest(), spacingUm=spacing,
                sourceSpacingUm=spacing, spacingUmXY=[plane['width']*geometry.longest_um/(pixels.shape[1]-1),
                                                    plane['height']*geometry.longest_um/(pixels.shape[0]-1)],
                cleaned=True, lossless=True, geometricComparisonOnly=True)


def contact_sheet(items, path, specimen, columns=4):
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 14)
    small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 10)
    cw, ch = 360, 410
    image = Image.new('RGB', (columns*cw, math.ceil(len(items)/columns)*ch), '#0c1317')
    draw = ImageDraw.Draw(image)
    for i, (name, pixels) in enumerate(items):
        x, y = i % columns*cw, i//columns*ch
        tile = Image.fromarray(pixels).convert('RGB')
        tile.thumbnail((cw-16, ch-66), Image.Resampling.LANCZOS)
        image.paste(tile, (x+(cw-tile.width)//2, y+32+(ch-66-tile.height)//2))
        draw.text((x+8, y+8), name, font=font, fill='#edccbb')
        draw.text((x+8, y+ch-20), specimen+' | anatomy unassigned', font=small, fill='#9db3b8')
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, quality=94)


def neutral_anatomy(output, docs, common, geometry):
    """A tiny all-unassigned grid prevents borrowing any other donor's labels."""
    raw = bytes(8)
    packed = gzip.compress(raw, compresslevel=9, mtime=0)
    path = output/'anatomy/labels.raw.gz'; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(packed)
    manifest = dict(common, schemaVersion=2, revision=output.name+'-unassigned-v10',
                    title='Anatomy labels not assigned for this donor', dimensions=[2, 2, 2],
                    volumeUrl='./'+str(path.relative_to(ROOT/'public')), arrayOrder='ZYX; X fastest', dtype='uint8',
                    sourceDimensionsXYZ=geometry.dimensions.tolist(), sourceSpacingUm=geometry.spacing.tolist(),
                    labelGridSpacingUmXYZ=geometry.physical.tolist(), compressedBytes=len(packed), decodedBytes=len(raw),
                    sha256=hashlib.sha256(raw).hexdigest(), compressedSha256=hashlib.sha256(packed).hexdigest(),
                    sourceReviewed=False, expertValidated=False, segmentationAvailable=False,
                    method='All tissue remains unassigned. No segmentation from another specimen is reused.',
                    validation='No anatomical labels or quantitative chamber measurements are asserted.',
                    limitations=[NOTE], labels=[dict(id=0, key='unclassified', name='Unassigned tissue',
                    color='#9ba9b0', description='Chambers and vessels have not been identified in this donor.',
                    confidence='Unassigned', method='No chamber identity inferred')])
    write_json(output/'anatomy/manifest.json', manifest)
    write_json(docs/'anatomy-review.json', dict(common, segmentationAvailable=False, assignedVoxelCount=0,
                                             explanation='Comparison planes are available; chamber identity remains unassigned.'))


def prepare_probe(volume, geometry, frames, output, docs, slug, fine, origin, spacing):
    script = """
      import fs from 'node:fs';
      import {PROBE_PRESETS,PROBE_REFERENCE_MM,sanitizeProbeState,probePose,probeCapPlane,volumeGeometry} from './public/probe-geometry.js';
      const input=JSON.parse(fs.readFileSync(0,'utf8'));
      const g=volumeGeometry(input.meta),scale=g.longestMm/PROBE_REFERENCE_MM;
      const planes=PROBE_PRESETS.map(p=>{
        const frame={...input.frames[p.frame].world,referenceMm:g.longestMm};
        const state=sanitizeProbeState({preset:p.id,referenceMm:g.longestMm,depthMm:p.depthMm*scale,angleDeg:p.angleDeg,contactLocked:true,contactPositionMm:[0,0]});
        const pose=probePose(state,frame);return {id:p.id,state,pose,plane:probeCapPlane(pose,g)};
      });
      process.stdout.write(JSON.stringify(planes));
    """
    payload = dict(meta=dict(dimensions=geometry.dimensions.tolist(), spacingUm=geometry.spacing.tolist()), frames=frames['frames'])
    done = subprocess.run(['node', '--input-type=module', '-e', script], cwd=ROOT,
                          input=json.dumps(payload), capture_output=True, text=True, check=True)
    descriptors = json.loads(done.stdout)
    items, review = [], []
    for d in descriptors:
        pixels = sample_plane(volume, geometry, d['plane'], fine, origin)
        item = texture(output/'probe-textures'/f'{d["id"]}.webp', pixels, slug, spacing, d['plane'], geometry)
        item.update(id=d['id'], plane=d['plane']); items.append(item); review.append((d['id'], pixels))
    write_json(output/'probe-textures.json', dict(datasetId=frames['datasetId'], geometricComparisonOnly=True,
                                                 sourceSpacingUm=spacing, preparedPlanes=items))
    manifest_path = output/'ultra-volume.json'
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
        if str(manifest.get('datasetId', frames['datasetId'])) != frames['datasetId']:
            raise ValueError('Cannot attach probe images to a different donor')
        manifest['preparedPlanes'] = items
        write_json(manifest_path, manifest)
    write_json(docs/'probe-default-planes.json', descriptors)
    contact_sheet(review, docs/'probe-measured-review.jpg', frames['specimen'])
    return items


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--slug', choices=DONORS, required=True)
    parser.add_argument('--source-root', type=Path)
    parser.add_argument('--texture-volume', type=Path, help='Optional finer registered cleaned uint8 NPY')
    parser.add_argument('--texture-metadata', type=Path, help='Completion metadata for the finer registered display volume')
    parser.add_argument('--texture-origin', type=float, nargs=3, metavar=('X', 'Y', 'Z'))
    parser.add_argument('--inspect-only', action='store_true')
    args = parser.parse_args()
    specimen, dataset = DONORS[args.slug]
    cache = args.source_root or Path('/workspace/data')/f'heart-donor-{dataset}'
    output, docs = ROOT/'public/assets/donors'/args.slug, ROOT/'docs/donors'/args.slug
    geometry = Geometry(json.loads((cache/'browser-geometry.json').read_text()))
    focus = FOCUS_REGIONS.get(args.slug)
    if focus:
        geometry.focus_bounds = np.asarray(focus['boundsNormalizedXYZ'])*geometry.span
    high_path = cache/'display-high-clean-u8.npy'
    high_sha_before = file_sha256(high_path)
    high = np.load(high_path, mmap_mode='r')
    if tuple(high.shape) != tuple(geometry.dimensions[::-1]):
        raise ValueError('Donor high volume dimensions do not match its own geometry')
    basis = measured_basis(high, geometry)
    echo_defs, flow_defs = plane_definitions(basis, geometry)
    fine = args.texture_volume is not None
    volume_path = args.texture_volume or high_path
    origin = None
    if fine:
        metadata_path = args.texture_metadata or cache/'s2-clean-display.json'
        completed_path = cache/'fine-download.json'
        if not metadata_path.exists() or not completed_path.exists():
            raise RuntimeError('Fine-source completion markers are missing; wait for the source pipeline to finish')
        metadata = json.loads(metadata_path.read_text())
        completed = json.loads(completed_path.read_text())
        if completed.get('completeSupportedChunks') is not True or min(metadata_path.stat().st_mtime_ns, completed_path.stat().st_mtime_ns) < volume_path.stat().st_mtime_ns:
            raise RuntimeError('Fine-source completion markers precede the source array; staged writes may still be active')
        if metadata.get('cleaned') is not True or not np.array_equal(metadata['identity']['fullXYZ'], geometry.fine_dimensions):
            raise ValueError('Fine source does not match the registered display geometry')
        if '/'+specimen+'/' not in metadata['identity']['sourceHttp']:
            raise ValueError('Fine source metadata belongs to a different donor')
        origin = metadata['originXYZ']
        if args.texture_origin is not None and not np.allclose(args.texture_origin, origin, rtol=0, atol=1e-8):
            raise ValueError('Requested fine crop origin differs from the source metadata')
    source_sha_before = file_sha256(volume_path) if fine else high_sha_before
    volume = np.load(volume_path, mmap_mode='r') if fine else high
    if volume.dtype != np.uint8 or volume.ndim != 3:
        raise ValueError('Prepared plane source must be a registered uint8 display volume')
    if fine and list(volume.shape[::-1]) != metadata['shapeXYZ']:
        raise ValueError('Fine source array dimensions differ from its completion metadata')
    spacing = float(max(geometry.fine_spacing if fine else geometry.spacing))
    volume_manifest_path = output/'manifest.json'
    volume_manifest = json.loads(volume_manifest_path.read_text()) if volume_manifest_path.exists() else {}
    threshold = float(volume_manifest.get('defaultThreshold', .28))
    common = dict(datasetId=dataset, specimen=specimen, datasetUrl='https://human-organ-atlas.esrf.fr/datasets/'+dataset,
                  geometricComparisonOnly=True, anatomicIdentityAssigned=False, clinicalPresetsReviewed=False,
                  expertValidated=False, reviewStatus='Measured geometric comparison; anatomical identity unreviewed')
    source_record_path = docs/'source-metadata.json'
    if source_record_path.exists():
        source_record = json.loads(source_record_path.read_text())
        if str(source_record['id']) != dataset or source_record['SamplePatient_number'] != specimen:
            raise ValueError('Donor source record does not match requested specimen')
        common.update(sourceDoi=source_record['doi'], sourceLicense='CC BY 4.0',
                      sourceAttribution='Human Organ Atlas Collaboration / ESRF')
    frames = dict(common, schemaVersion=2, dimensionsXYZ=geometry.dimensions.tolist(), voxelSpacingMm=(geometry.spacing/1000).tolist(),
                  referenceMm=geometry.longest_mm, worldExtentXYZ=geometry.extent.tolist(),
                  worldMapping='Physical-centered source XYZ mapped to [X,Z,-Y], divided by longest voxel-center extent.',
                  validation=NOTE, limitations=[NOTE]+([focus['note']] if focus else []), landmarks={},
                  framingRegion=focus, geometricBasis=basis[-1], presetOverrides={}, frames={})
    textures = dict(common, schemaVersion=2, sourceSpacingUm=spacing, textures={})
    review = []
    for key, (code, name, target, right, up) in echo_defs.items():
        world, source = geometry.frame(target, right, up)
        override = dict(code=code, name=name, position='Measured comparison plane', description=NOTE)
        frames['presetOverrides'][key] = override
        frames['frames'][key] = dict(world=world, source=source, note=NOTE, confidence='Geometric only; anatomy unassigned',
                                     displayName=name, displayCode=code, displayPosition=override['position'],
                                     displayDescription=NOTE, geometricComparisonOnly=True)
        pixels = sample_plane(volume, geometry, world, fine, origin)
        review.append((code+' | '+name, pixels))
        if not args.inspect_only:
            textures['textures'][key] = texture(output/'echo-textures'/f'{key}.webp', pixels, args.slug, spacing, world, geometry)
    contact_sheet(review, docs/'echo-measured-review.jpg', specimen)
    write_json(docs/'geometric-plane-review.json', dict(common, sourceSpacingUm=spacing, **basis[-1]))
    if args.inspect_only:
        if file_sha256(volume_path) != source_sha_before or file_sha256(high_path) != high_sha_before:
            raise RuntimeError('Source volume changed during preparation; wait for the pipeline to finish and regenerate these views')
        print(f'INSPECT {specimen}: {docs}/echo-measured-review.jpg', flush=True)
        return
    write_json(output/'echo-planes.json', frames); write_json(output/'echo-textures.json', textures)
    print(f'ECHO READY {specimen}: 13 measured planes at {spacing:g} um', flush=True)
    flows = dict(common, schemaVersion=2, revision=args.slug+'-measured-v10', sourceSpacingUm=spacing,
                 title='Measured section comparisons', description='Eight independently placed planes through this donor\'s measured CT.',
                 note=NOTE, displayGroups=[], presets=[])
    group_map, flow_review = {}, []
    for key, group, name, target, right, up in flow_defs:
        world, source = geometry.frame(target, right, up)
        pixels = sample_plane(volume, geometry, world, fine, origin)
        tex = texture(output/'flow-textures'/f'{key}.webp', pixels, args.slug, spacing, world, geometry)
        preview = Image.fromarray(pixels); preview.thumbnail((320, 320), Image.Resampling.LANCZOS)
        preview_path = output/'flow-textures'/f'{key}-preview.webp'; preview.save(preview_path, format='WEBP', lossless=True, method=6)
        focus_ratio=float(max((geometry.focus_bounds[1]-geometry.focus_bounds[0])*geometry.spacing)/geometry.longest_um)
        camera_distance=max(.45,.98*focus_ratio)
        flows['presets'].append(dict(id=key, title=name, subtitle='Measured tissue and cavity boundaries', displayLabel=name,
             chamber=None, kind='Comparison', world=world, source=source, cameraDistance=camera_distance, closeDistance=camera_distance*.64,
             focusWidthMm=geometry.longest_mm*focus_ratio*.85, focusHeightMm=geometry.longest_mm*focus_ratio*.85,
             threshold=threshold, flip=False, previewUrl='./'+str(preview_path.relative_to(ROOT/'public')), texture=tex,
             description='Explore the measured walls, folds and spaces in this donor-specific section. Adjust its depth or angle to compare adjacent anatomy.',
             structures=['Measured tissue', 'Measured spaces', 'Anatomy unassigned'],
             review='A geometric starting plane calculated from this donor\'s own tissue distribution. No chamber or valve label is inferred.', note=NOTE,
             geometricComparisonOnly=True, anatomicIdentityAssigned=False))
        group_map.setdefault(group, []).append(key); flow_review.append((name, pixels))
    flows['displayGroups'] = [dict(key=str(i+1).zfill(2), name=name, presetIds=ids) for i, (name, ids) in enumerate(group_map.items())]
    write_json(output/'flow-views.json', flows)
    contact_sheet(flow_review, docs/'flow-measured-review.jpg', specimen)
    print(f'COMPARISONS READY {specimen}: 8 distinct measured planes', flush=True)
    neutral_anatomy(output, docs, common, geometry)
    probe = prepare_probe(volume, geometry, frames, output, docs, args.slug, fine, origin, spacing)
    total = sum(t['bytes'] for t in textures['textures'].values())+sum(p['texture']['bytes'] for p in flows['presets'])+sum(t['bytes'] for t in probe)
    if file_sha256(volume_path) != source_sha_before or file_sha256(high_path) != high_sha_before:
        raise RuntimeError('Source volume changed during preparation; wait for the pipeline to finish and regenerate these views')
    write_json(docs/'view-preparation.json', dict(common, sourceSpacingUm=spacing, fineSource=fine,
                 echoPlaneCount=13, flowPlaneCount=8, probePlaneCount=4, textureBytes=total,
                 sourceVolume=str(volume_path), sourceVolumeSha256=source_sha_before,
                 geometricBasisVolumeSha256=high_sha_before, sourceUnchangedThroughoutPreparation=True,
                 anatomicalLabelsAssigned=0, limitations=[NOTE]))
    print(f'VIEWS READY {specimen}: 13 echo, 8 comparison, 4 probe; {total:,} texture bytes; {spacing:g} um measured source', flush=True)


if __name__ == '__main__':
    main()
