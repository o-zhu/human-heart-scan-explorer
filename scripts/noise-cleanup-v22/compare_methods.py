#!/usr/bin/env python3
"""Bounded cleanup comparisons on existing NBE1 tiles and saved native ROI fields.

Reads production inputs only. Writes this experiment's own report/images below
docs/noise-cleanup-v22. No source acquisition, production rewrite or deployment.
"""
from __future__ import annotations

import os
os.environ['OPENBLAS_NUM_THREADS'] = '1'
os.environ['OMP_NUM_THREADS'] = '1'
os.environ['LP_NUM_THREADS'] = '1'
import argparse
import gc
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import resource
import struct
import subprocess
import sys
import time

import numpy as np
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[2]
DATA = Path('/workspace/data/guided-native-v21')
OUT = ROOT / 'docs/noise-cleanup-v22'
SCALARS = DATA / 'denoise/surface-render'
SPACING_MM = .01985
T = float(np.float32(17133.4))
STRUCTURE = np.ones((3, 3, 3), bool)
METHODS = ('baseline', 'cc_rods', 'cc_rods_sheets', 'opening',
           'hysteresis', 'intensity_anchor', 'tv40', 'gaussian')
TITLES = ('TV16 original', 'Compact components; rods kept',
          'Compact components; rods + sheets kept', 'Opening, radius 1 voxel',
          'Hysteresis T ± 200', 'Same-T intensity anchor +200',
          'TV40, same threshold', 'Gaussian 1.5, same threshold')


def module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


CODEC = module(ROOT / 'scripts/guided-native-v21/edge_codec.py', 'cleanup_edge_codec')


def digest_bytes(value):
    return hashlib.sha256(value).hexdigest()


def sha(path):
    return digest_bytes(Path(path).read_bytes())


def array_sha(a):
    return digest_bytes(memoryview(np.ascontiguousarray(a)).cast('B'))


def rss():
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024


def write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.partial')
    temporary.write_text(json.dumps(data, indent=2, allow_nan=False) + '\n')
    temporary.replace(path)


def components(mask):
    """26-connected tissue components; sample-cell bbox and regularized PCA."""
    labels, n = ndi.label(mask, structure=STRUCTURE)
    count = np.bincount(labels.ravel(), minlength=n + 1)
    border = np.zeros(n + 1, bool)
    for face in (labels[0], labels[-1], labels[:, 0], labels[:, -1],
                 labels[:, :, 0], labels[:, :, -1]):
        border[np.unique(face)] = True
    boxes = ndi.find_objects(labels, max_label=n)
    diagonal = np.zeros(n + 1)
    rod = np.full(n + 1, np.inf)
    thin = np.full(n + 1, np.inf)
    for i, box in enumerate(boxes, 1):
        side = np.array([s.stop - s.start for s in box])
        diagonal[i] = np.linalg.norm(side) * SPACING_MM
        # Every potentially removable component is evaluated. Larger or cropped
        # components are protected independently and need no covariance work.
        if not border[i] and count[i] <= 4096:
            p = np.argwhere(labels[box] == i).astype(np.float64)
            p -= p.mean(axis=0)
            eigen = np.maximum(0, np.linalg.eigvalsh(p.T @ p / len(p))) + 1 / 12
            rod[i] = np.sqrt(eigen[2] / eigen[1])
            thin[i] = np.sqrt(eigen[2] / eigen[0])
    return dict(labels=labels, count=count, border=border, boxes=boxes,
                diagonal=diagonal, rod=rod, thin=thin, n=n)


def removal(c, maximum=512, diameter=.4, guard='thin'):
    take = (~c['border']) & (c['count'] <= maximum) & (c['diagonal'] <= diameter)
    if guard != 'none':
        take &= c[guard] < 3
    take[0] = False
    return take


def triangle_components(inside, labels):
    cases = CODEC.cases_from_inside(inside)
    shape = cases.shape
    owner = np.zeros(shape, np.int32)
    for x, y, z in CODEC.CORNERS:
        np.maximum(owner, labels[z:z + shape[0], y:y + shape[1], x:x + shape[2]], out=owner)
    weights = CODEC.TRI_COUNTS[cases]
    counts = np.bincount(owner.ravel(), weights=weights.ravel(), minlength=int(labels.max()) + 1).astype(np.int64)
    return owner, counts


def vertex_components(inside, labels):
    result = []
    for axis in range(3):
        a, b = CODEC.edge_slices(axis)
        crossing = inside[a] != inside[b]
        result.append(np.where(inside[a], labels[a], labels[b])[crossing])
    return np.concatenate(result)


def component_rows(c, triangle_count=None):
    rows = []
    for i, box in enumerate(c['boxes'], 1):
        rows.append(dict(id=i, foregroundSamples=int(c['count'][i]),
                         touchesOuterFace=bool(c['border'][i]),
                         sampleBoxOriginXYZ=[s.start for s in box][::-1],
                         sampleBoxShapeXYZ=[s.stop - s.start for s in box][::-1],
                         inclusiveSampleBoxDiagonalMm=float(c['diagonal'][i]),
                         rodElongation=float(c['rod'][i]) if np.isfinite(c['rod'][i]) else None,
                         rodOrSheetElongation=float(c['thin'][i]) if np.isfinite(c['thin'][i]) else None,
                         triangles=int(triangle_count[i]) if triangle_count is not None else None))
    return rows


def known_native_paths():
    paths = {}
    for folder in (DATA / 'pilot/run/tiles', DATA / 'whole/verification-samples'):
        for path in sorted(folder.glob('*.nbe.gz')):
            if '.lod.' not in path.name:
                paths[path.name.split('.')[0]] = path
    return paths


def verified_native(path):
    key = path.name.split('.')[0]
    record_path = DATA / 'whole/run/records' / (key + '.json')
    record = json.loads(record_path.read_text())
    expected = next(a for a in record['artifacts'] if a['role'] == 'native')
    payload = path.read_bytes()
    if len(payload) != expected['bytes'] or digest_bytes(payload) != expected['sha256']:
        raise ValueError('Native artifact differs from the completed production record: ' + key)
    inside, fractions, origin, step = CODEC.decode_native_edges(payload)
    if step != 1 or inside.shape != (129, 129, 129):
        raise ValueError('Expected a complete native tile')
    return payload, inside, fractions, origin, record, expected


def native_metrics(output):
    started = time.perf_counter()
    records = []
    boundary_faces = {}
    for key, path in known_native_paths().items():
        tick = time.perf_counter()
        payload, inside, fractions, origin, source, expected = verified_native(path)
        c = components(inside)
        owner, triangles = triangle_components(inside, c['labels'])
        if int(triangles.sum()) != expected['triangles']:
            raise ValueError('Triangle accounting differs from the stored native artifact')
        sweep = []
        for volume in (64, 512, 4096):
            for diameter in (.2, .4, .8):
                for guard in ('none', 'rod', 'thin'):
                    take = removal(c, volume, diameter, guard)
                    sweep.append(dict(maximumForegroundSamples=volume,
                                      inclusiveSampleBoxDiagonalLimitMm=diameter,
                                      guard=guard, removedComponents=int(take.sum()),
                                      removedForegroundSamples=int(c['count'][take].sum()),
                                      removedTriangles=int(triangles[take].sum())))
        # Preserve exact signs on all six outer tile faces. Unconditional face
        # retention also preserves the original NBE crossing codes on these faces.
        take = removal(c, guard='thin')
        clean = inside & ~take[c['labels']]
        for axis in range(3):
            for side in (0, -1):
                if not np.array_equal(np.take(inside, side, axis), np.take(clean, side, axis)):
                    raise ValueError('Cleanup changed an outer face')
        boundary_faces[key] = tuple(np.take(inside, side, axis).copy()
                                    for axis in range(3) for side in (0, -1))
        rows = component_rows(c, triangles)
        records.append(dict(tile=key, path=str(path), sourceRecord=str(DATA / 'whole/run/records' / (key + '.json')),
                            sha256=expected['sha256'], compressedBytes=len(payload),
                            productionFingerprint=source['fingerprint'], originXYZ=origin.tolist(),
                            foregroundSamples=int(inside.sum()), nativeTriangles=int(triangles.sum()),
                            components26=c['n'], borderComponents=int(c['border'][1:].sum()),
                            interiorComponents=int((~c['border'][1:]).sum()),
                            currentTileAllSixFacesExact=True, sweep=sweep,
                            components=rows, seconds=time.perf_counter() - tick))
        del payload, inside, fractions, c, owner, triangles, clean
        gc.collect()
    # The existing 2x2x2 native pilot gives 12 real adjacent-face comparisons.
    neighbor_checks = []
    for key, faces in boundary_faces.items():
        xyz = [int(v) for v in key.split('_')]
        for xyz_axis in range(3):
            other = xyz.copy()
            other[xyz_axis] += 1
            neighbor = '_'.join(map(str, other))
            if neighbor not in boundary_faces:
                continue
            array_axis = 2 - xyz_axis
            exact = np.array_equal(faces[2 * array_axis + 1], boundary_faces[neighbor][2 * array_axis])
            neighbor_checks.append(dict(first=key, second=neighbor, axisXYZ=xyz_axis,
                                        originalAndCleanedSignsExact=exact))
            if not exact:
                raise ValueError('Neighbor sign masks differ')
    report = dict(schema='native-noise-cleanup-comparison-v22.1',
                  inputScope='13 existing verified native tiles; intentionally selected, not anatomy-balanced',
                  nativeGeometry='NBE1 signs and original five-bit crossings; classic marching-cubes table',
                  connectivity=26, spacingMm=SPACING_MM,
                  diameterDefinition='Euclidean diagonal of inclusive sample-cell bbox: (max-min+1)*spacing; not exact mesh diameter',
                  pcaDefinition='Population sample-center covariance; add 1/12 voxel^2 to all eigenvalues; rod=sqrt(max/middle), thin=sqrt(max/min)',
                  candidateRule='Remove only count<=512 AND inclusive bbox diagonal<=0.4mm AND not outer-face touching AND selected PCA elongation<3',
                  coordinatePolicy='Skip all original triangles in removed foreground components; retained vertices/cases/normals are unchanged',
                  records=records, neighborChecks=neighbor_checks,
                  seconds=time.perf_counter() - started, peakRssMiB=rss(),
                  limitations=['Component membership is measured; anatomical validity is not.',
                               'Boundary-touching and connected clutter intentionally remain.',
                               'PCA protects straight rods and sheets but is not a guarantee for curved, branching or subvoxel tissue.',
                               'No threshold persistence is recoverable from one NBE1 sign mask.'])
    write_json(output / 'native-components.json', report)
    print(json.dumps(dict(stage='native', tiles=len(records), neighborChecks=len(neighbor_checks),
                          seconds=report['seconds'], peakRssMiB=rss())), flush=True)


def scalar_variants():
    source = json.loads((SCALARS / 'source-record.json').read_text())
    fields = {}
    for key in ('raw', 'tv800_16', 'tv800_40', 'gaussian_1p5'):
        a = np.load(SCALARS / (key + '.npy'), allow_pickle=False)
        if a.shape != (108, 108, 108) or a.dtype != np.dtype('<f4') or array_sha(a) != source['methods'][key]['coreFloat32LeSha256']:
            raise ValueError('Saved scientific core differs from its source record: ' + key)
        fields[key] = a
    tv = fields['tv800_16']
    base = tv >= T
    c = components(base)
    variants = {'baseline': dict(field=tv, threshold=T, mask=base, labels=c['labels'], keep=None)}
    for key, guard in (('cc_rods', 'rod'), ('cc_rods_sheets', 'thin')):
        keep = ~removal(c, guard=guard)
        variants[key] = dict(field=tv, threshold=T, mask=base & keep[c['labels']], labels=c['labels'], keep=keep)
    opened = ndi.binary_opening(base, structure=ndi.generate_binary_structure(3, 1), iterations=1)
    # Binary opening has a two-sample dependency. Hold that outer collar fixed
    # rather than interpreting absent input outside this saved core as background.
    opened[:2] = base[:2]
    opened[-2:] = base[-2:]
    opened[:, :2] = base[:, :2]
    opened[:, -2:] = base[:, -2:]
    opened[:, :, :2] = base[:, :, :2]
    opened[:, :, -2:] = base[:, :, -2:]
    variants['opening'] = dict(field=tv, threshold=T, mask=opened, topology_mask=opened, keep=None)
    weak = tv >= T - 200
    weak_c = components(weak)
    seeded = np.zeros(weak_c['n'] + 1, bool)
    seeded[np.unique(weak_c['labels'][tv >= T + 200])] = True
    seeded |= weak_c['border']
    seeded[0] = False
    variants['hysteresis'] = dict(field=tv, threshold=T - 200, mask=weak & seeded[weak_c['labels']],
                                  labels=weak_c['labels'], keep=seeded)
    seeded_base = np.zeros(c['n'] + 1, bool)
    seeded_base[np.unique(c['labels'][tv >= T + 200])] = True
    seeded_base |= c['border'] | (c['thin'] >= 3)
    seeded_base[0] = False
    variants['intensity_anchor'] = dict(field=tv, threshold=T, mask=base & seeded_base[c['labels']],
                                        labels=c['labels'], keep=seeded_base)
    for key, field_key in (('tv40', 'tv800_40'), ('gaussian', 'gaussian_1p5')):
        field = fields[field_key]
        variants[key] = dict(field=field, threshold=T, mask=field >= T, keep=None)
    return source, fields, variants, c


def scalar_metrics(output):
    started = time.perf_counter()
    source, fields, variants, c = scalar_variants()
    base = variants['baseline']['mask']
    core = (slice(2, -2),) * 3
    results = []
    for method in METHODS:
        candidate = variants[method]['mask']
        labels, n = ndi.label(candidate, STRUCTURE)
        results.append(dict(method=method, foregroundSamples=int(candidate.sum()),
                            components26=n, removedFromTV16=int((base & ~candidate).sum()),
                            addedToTV16=int((~base & candidate).sum()),
                            inner104CubedDisagreementFraction=float(np.mean(base[core] != candidate[core])),
                            retainedCoordinateRule='Original TV16 triangles retained exactly' if method in ('baseline', 'cc_rods', 'cc_rods_sheets', 'intensity_anchor') else 'Boundary coordinates can change',
                            maskSha256=array_sha(candidate)))
        del labels
    report = dict(schema='native-scalar-noise-comparison-v22.1', sourceRecord=str(SCALARS / 'source-record.json'),
                  sourceRecordSha256=sha(SCALARS / 'source-record.json'),
                  source=source, thresholdRaw=T, methods=results,
                  openingDefinition='One binary erosion and dilation, 6-neighbor cross radius1; outer two-sample collar held fixed. Keep original fractions on unchanged crossing edges; newly created edges use midpoint bins.',
                  hysteresisDefinition='26-connected weak set TV16>=T-200 seeded by TV16>=T+200; weak components touching crop faces retained',
                  intensityAnchorDefinition='Original TV16>=T components; retain if any sample>=T+200, outer-face touching, or rod/sheet elongation>=3. No lower threshold.',
                  componentStatistics=component_rows(c),
                  caveats=['Scalar cores are standalone denoising before production guide blending.',
                           'Thresholds are original stored-intensity units, not established HU.',
                           'Smoothing and opening can change connected tissue, not only disconnected particles.',
                           'No anatomical ground truth or independent test set is supplied.'],
                  seconds=time.perf_counter() - started, peakRssMiB=rss())
    write_json(output / 'scalar-methods.json', report)
    # Exact original source sections, with binary-label disagreement overlaid.
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    fig, axes = plt.subplots(3, len(METHODS), figsize=(24, 9), constrained_layout=True)
    for row, axis in enumerate((0, 1, 2)):
        raw = np.take(fields['raw'], 54, axis=axis)
        b = np.take(base, 54, axis=axis)
        for col, method in enumerate(METHODS):
            ax = axes[row, col]
            m = np.take(variants[method]['mask'], 54, axis=axis)
            ax.imshow(raw, cmap='gray', vmin=14640, vmax=23545, interpolation='nearest', origin='lower')
            if m.any() and not m.all():
                ax.contour(m, levels=[.5], colors=['#ffce73'], linewidths=.45)
            overlay = np.zeros((*m.shape, 4))
            overlay[b & ~m] = [1, .12, .15, .9]
            overlay[~b & m] = [0, .8, 1, .9]
            ax.imshow(overlay, interpolation='nearest', origin='lower')
            ax.set_xticks([])
            ax.set_yticks([])
            if row == 0:
                ax.set_title(TITLES[col], fontsize=10, wrap=True)
            if col == 0:
                ax.set_ylabel(('Z', 'Y', 'X')[row] + ' = origin + 54')
    fig.suptitle('Same measured 108³ ROI · gold: candidate contour · red: removed from TV16 · cyan: added\nOriginal native intensities in every panel; no anatomical labels. Opening and changed thresholds can alter supported tissue.', fontsize=14)
    fig.savefig(output / 'scalar-section-comparison.png', dpi=110)
    plt.close(fig)
    print(json.dumps(dict(stage='scalar', seconds=time.perf_counter() - started, peakRssMiB=rss())), flush=True)


def mesh_field(field, threshold, output, name, topology_mask=None):
    temporary = output / 'work' / (name + '.nbe.gz')
    if topology_mask is None:
        meta = CODEC.encode_native_edges(field, (0, 0, 0), temporary, threshold=threshold)
    else:
        # A binary morphology control must not needlessly reset the excellent
        # original subvoxel crossings. Existing unchanged edges keep their exact
        # fractions; genuinely new edges have no source crossing and use .5.
        original = field >= threshold
        inside = np.asarray(topology_mask, bool)
        if np.any(inside & ~original):
            raise ValueError('The opening control must be anti-extensive')
        packed_mask = np.packbits(inside.ravel(), bitorder='little').tobytes()
        streams, counts = [], []
        unchanged = new = 0
        for axis in range(3):
            a, b = CODEC.edge_slices(axis)
            crossings = inside[a] != inside[b]
            common = (original[a] != original[b])[crossings]
            fraction = np.full(int(crossings.sum()), .5, np.float64)
            low = field[a][crossings][common].astype(np.float64)
            high = field[b][crossings][common].astype(np.float64)
            fraction[common] = (threshold - low) / (high - low)
            q = np.clip(np.floor(fraction * 32), 0, 31).astype(np.uint8)
            streams.append(CODEC.pack5(q))
            counts.append(len(q))
            unchanged += int(common.sum())
            new += int((~common).sum())
        threshold_bits = struct.unpack('<I', struct.pack('<f', threshold))[0]
        spacing_bits = struct.unpack('<I', struct.pack('<f', SPACING_MM * 1000))[0]
        header = struct.pack('<16I', CODEC.MAGIC, 1, *inside.shape[::-1], 5,
                             len(packed_mask), *counts, 0, 0, 0,
                             threshold_bits, spacing_bits, 0)
        decoded = header + packed_mask + b''.join(streams)
        encoded = gzip.compress(decoded, compresslevel=4, mtime=0)
        temporary.parent.mkdir(parents=True, exist_ok=True)
        temporary.write_bytes(encoded)
        meta = dict(format='NBE1', sha256=digest_bytes(encoded), decodedSha256=digest_bytes(decoded),
                    bytes=len(encoded), decodedBytes=len(decoded),
                    crossingRule='Original fractions retained on unchanged edges; midpoint quantization bins on newly created binary-opening edges',
                    unchangedOriginalCrossings=unchanged, newMidpointCrossings=new,
                    binaryMaskSha256=array_sha(inside), sourceFieldSha256=array_sha(field))
    payload = temporary.read_bytes()
    points, faces = CODEC.mesh_native_edges(payload)
    return points, faces, meta


def normals_for(points, faces):
    normal = np.zeros_like(points)
    for start in range(0, len(faces), 40000):
        ids = faces[start:start + 40000]
        a, b, c = points[ids[:, 0]], points[ids[:, 1]], points[ids[:, 2]]
        n = np.cross(b - a, c - a)
        for k in range(3):
            np.add.at(normal, ids[:, k], n)
    length = np.linalg.norm(normal, axis=1)
    normal[length <= 1e-15] = [0, 0, 1]
    normal[length > 1e-15] /= length[length > 1e-15, None]
    return normal


def render(output, method, native=None):
    started = time.perf_counter()
    if native:
        path = known_native_paths()[native]
        payload, inside, fractions, origin, source, expected = verified_native(path)
        c = components(inside)
        points, faces = CODEC.mesh_native_edges(payload)
        points -= origin
        span_samples = 128
        if method == 'baseline':
            keep = None
        else:
            take = removal(c, guard='rod' if method == 'cc_rods' else 'thin')
            keep = take if method == 'removed' else ~take
        labels = c['labels']
        input_info = dict(nativeArtifact=str(path), sha256=expected['sha256'], sourceOriginXYZ=origin.tolist())
        prefix = native + '-' + method
    else:
        source, fields, variants, c = scalar_variants()
        variant = variants[method]
        points, faces, meta = mesh_field(variant['field'], variant['threshold'], output, method,
                                        topology_mask=variant.get('topology_mask'))
        inside = variant['field'] >= variant['threshold']
        labels = variant.get('labels')
        keep = variant.get('keep')
        span_samples = 107
        input_info = dict(sourceRecord=str(SCALARS / 'source-record.json'), sourceOriginXYZ=source['coreOriginXYZ'],
                          fieldHash=array_sha(variant['field']), threshold=variant['threshold'], encodedMesh=meta)
        prefix = 'scalar-' + method
    unfiltered_triangles = len(faces)
    # Preserve original face normals for every retained component. Components
    # deleted here share no vertices with retained foreground components.
    points = np.ascontiguousarray(points, np.float32)
    normal = normals_for(points, faces)
    keep_face = np.ones(len(faces), bool)
    if keep is not None:
        owner = vertex_components(inside, labels)
        triangle_owner = owner[faces[:, 0]]
        if not (np.array_equal(triangle_owner, owner[faces[:, 1]]) and np.array_equal(triangle_owner, owner[faces[:, 2]])):
            raise ValueError('One triangle touches multiple 26-connected tissue components')
        keep_face = keep[triangle_owner]
        faces = faces[keep_face]
    coordinate_hash = array_sha(points)
    points_mm = points * np.float32(SPACING_MM)
    renderer_module = module(ROOT / 'scripts/native-surface-v20/render_egl.py', 'cleanup_egl')
    renderer = renderer_module.SurfaceRenderer(width=600, height=560)
    span = span_samples * SPACING_MM
    center = np.array([span / 2] * 3, np.float32)
    clip_z = (span_samples // 2 - span_samples / 2) / span_samples
    pixels = renderer.draw(points_mm, normal, faces, center, span, clip_z=clip_z)
    from PIL import Image
    destination = output / 'renders' / (prefix + '.png')
    destination.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(pixels).save(destination, optimize=True)
    record = dict(method=method, nativeTile=native, input=input_info,
                  unfilteredTriangles=unfiltered_triangles, renderedTriangles=len(faces),
                  originalVertexBufferSha256=coordinate_hash,
                  retainedFaceMaskSha256=array_sha(keep_face),
                  normalPolicy='Original area-weighted face normals retained for component-subset variants; no smoothing.',
                  maximumRetainedCoordinateMovementVoxels=0 if keep is not None or method == 'baseline' else None,
                  camera='Same renderer, center, span and open local-Z middle section within each source ROI',
                  clipNormalizedZ=clip_z, cropSpanMm=span, geometryModification='triangle subset only' if keep is not None else 'input scalar geometry',
                  driver=renderer.driver, image=dict(path=str(destination.relative_to(output)), sha256=sha(destination)),
                  seconds=time.perf_counter() - started, peakRssMiB=rss())
    write_json(output / 'renders' / (prefix + '.json'), record)
    print(json.dumps(dict(stage='render', item=prefix, triangles=len(faces), peakRssMiB=rss())), flush=True)


def compose(output):
    from PIL import Image, ImageDraw, ImageFont
    font_path = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
    font = lambda n: ImageFont.truetype(font_path, n)
    def figure(items, columns, title, footer, destination):
        rows = (len(items) + columns - 1) // columns
        canvas = Image.new('RGB', (columns * 600 + 40, rows * 630 + 160), '#091019')
        draw = ImageDraw.Draw(canvas)
        draw.text((24, 18), title, font=font(27), fill='#e2ece8')
        for i, (name, label) in enumerate(items):
            row, col = divmod(i, columns)
            x, y = 20 + 600 * col, 75 + 630 * row
            record = json.loads((output / 'renders' / (name + '.json')).read_text())
            draw.text((x + 10, y), label, font=font(18), fill='#d5e3dc')
            draw.text((x + 10, y + 27), f"{record['renderedTriangles']:,} triangles", font=font(16), fill='#9db3b2')
            with Image.open(output / 'renders' / (name + '.png')) as panel:
                canvas.paste(panel.convert('RGB'), (x, y + 54))
        draw.text((24, canvas.height - 65), footer, font=font(17), fill='#afc0be')
        draw.text((24, canvas.height - 37), 'Measured geometry; fixed camera/light/section within each ROI. Scientific EGL rendering, not a browser screenshot. No anatomical truth labels.', font=font(16), fill='#8ba2a4')
        canvas.save(output / destination, optimize=True)
    figure([('scalar-' + m, title) for m, title in zip(METHODS, TITLES)], 4,
           'Native cleanup alternatives · exact same 108³ source ROI · open middle section',
           'CC = complete interior foreground components ≤512 samples and inclusive bbox diagonal ≤0.4 mm; boundary components retained.',
           'scalar-surface-comparison.png')
    native_items = []
    for tile in ('32_31_22', '35_30_36'):
        for method, title in (('baseline', 'Original'), ('cc_rods', 'Rods protected'),
                              ('cc_rods_sheets', 'Rods + sheets protected'), ('removed', 'Removed fragments only')):
            native_items.append((tile + '-' + method, tile + ' · ' + title))
    figure(native_items, 4, 'Actual production NBE1 tiles · retained vertices and triangles stay in place',
           'Identical coordinate buffers and retained normals. Removed fragments are candidates; small real tissue may satisfy the same size/shape rule.',
           'native-component-comparison.png')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage', choices=('native', 'scalar', 'render', 'compose'))
    parser.add_argument('--output', type=Path, default=OUT)
    parser.add_argument('--method', choices=(*METHODS, 'removed'))
    parser.add_argument('--native', choices=('32_31_22', '35_30_36'))
    args = parser.parse_args()
    # Restrict every mutation to the explicitly assigned experiment directory.
    output = args.output.resolve()
    if output != OUT.resolve():
        raise ValueError('This bounded experiment writes only docs/noise-cleanup-v22')
    output.mkdir(parents=True, exist_ok=True)
    if args.stage == 'native':
        native_metrics(output)
    elif args.stage == 'scalar':
        scalar_metrics(output)
    elif args.stage == 'render':
        if args.method is None:
            parser.error('--method is required for rendering')
        render(output, args.method, args.native)
    elif args.stage == 'compose':
        compose(output)
    else:
        common = [sys.executable, '-B', str(Path(__file__).resolve())]
        for stage in ('native', 'scalar'):
            subprocess.run(common + ['--stage', stage], check=True)
        for method in METHODS:
            subprocess.run(common + ['--stage', 'render', '--method', method], check=True)
        for native in ('32_31_22', '35_30_36'):
            for method in ('baseline', 'cc_rods', 'cc_rods_sheets', 'removed'):
                subprocess.run(common + ['--stage', 'render', '--method', method, '--native', native], check=True)
        subprocess.run(common + ['--stage', 'compose'], check=True)


if __name__ == '__main__':
    main()
