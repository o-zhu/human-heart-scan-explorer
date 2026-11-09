#!/usr/bin/env python3
"""Compare reduced Gaussian smoothing on bounded verified fine-source regions.

These source-supported geometric tests have no anatomical ground-truth labels.
The original 79.4 µm bank already contains windowing and coarse support cleanup.
"""
from __future__ import annotations

import os
os.environ['OMP_NUM_THREADS'] = '1'
os.environ['OPENBLAS_NUM_THREADS'] = '1'
os.environ['LP_NUM_THREADS'] = '1'
import argparse
import gc
import hashlib
import importlib.util
import json
from pathlib import Path
import resource
import sys
import time

import numpy as np
from scipy import ndimage as ndi
from PIL import Image, ImageDraw, ImageFont
import vtk
from vtk.util.numpy_support import vtk_to_numpy

from source import FineSource, ROOT


def module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


PREP = module(ROOT / 'scripts/fine-surface-v19/prepare.py', 'fine23_original_prepare')
VALIDATE = module(ROOT / 'scripts/fine-surface-v19/validate.py', 'fine23_original_validate')
RENDER = module(ROOT / 'scripts/native-surface-v20/render_egl.py', 'fine23_surface_render')
OUT = ROOT / 'docs/fine-detail-v23'
ROIS = [
    ('lv-inflow', [1160, 1092, 1152]),
    ('rv-inflow', [928, 744, 1192]),
    ('outer-wall', [1392, 1032, 1376]),
]
SIGMAS = [0., .35, .5, .8]


def write(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.partial')
    temporary.write_text(json.dumps(obj, indent=2, allow_nan=False) + '\n')
    temporary.replace(path)


def mesh_normals(poly):
    normal = vtk.vtkPolyDataNormals()
    normal.SetInputData(poly)
    normal.ComputePointNormalsOn(); normal.ComputeCellNormalsOff()
    normal.SplittingOff(); normal.ConsistencyOn(); normal.AutoOrientNormalsOff()
    normal.Update()
    result = normal.GetOutput()
    points, faces = PREP.arrays(result)
    normals = vtk_to_numpy(result.GetPointData().GetNormals()).copy()
    return points, faces, normals


def run():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--radius', type=int, default=80)
    parser.add_argument('--samples', type=int, default=12000)
    parser.add_argument('--no-render', action='store_true')
    args = parser.parse_args()
    vtk.vtkSMPTools.Initialize(2)
    started = time.monotonic()
    source = FineSource(48)
    OUT.mkdir(parents=True, exist_ok=True)
    renderer = None if args.no_render else RENDER.SurfaceRenderer(580, 520)
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 21)
    small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 16)
    sheet = Image.new('RGB', (4 * 600 + 20, len(ROIS) * 600 + 110), '#081116')
    draw = ImageDraw.Draw(sheet)
    draw.text((20, 17), 'Gentler source filtering · same measured 79.4 µm region within each row', font=font, fill='#dbe6e5')
    report = dict(schema='fine-detail-v23-source-filter-comparison', radiusFineSamples=args.radius,
                  sourceThresholdEncoded=255 * .28, originalThresholdNormalized=.28, sourceDataModified=False,
                  scope='Three selected local regions; not anatomy-balanced. Before whole-organ mesh simplification.',
                  thinSupportDefinition='Original foreground whose EDT and all foreground within a 5³ local neighborhood have EDT <= 1.01 fine voxels. This geometric thin-support proxy is not an anatomical annotation.',
                  regions=[])
    for row, (name, center) in enumerate(ROIS):
        rng = np.random.default_rng(2300794 + row)
        center = np.asarray(center, dtype=int)
        lo, hi = center - args.radius, center + args.radius + 1
        halo = 4
        full = source.region(lo - halo, hi + halo).astype(np.float32)
        core = full[halo:-halo, halo:-halo, halo:-halo]
        raw_mask = core >= 255 * .28
        edt = ndi.distance_transform_edt(raw_mask).astype(np.float32)
        thin = raw_mask & (ndi.maximum_filter(edt, size=5) <= 1.01)
        collar = 5
        interior = np.zeros_like(raw_mask); interior[collar:-collar, collar:-collar, collar:-collar] = True
        thin &= interior
        raw = PREP.contour(np.ascontiguousarray(core), source.millimetres(lo), source.spacing_mm)
        raw_points = VALIDATE.sample_surface(raw, args.samples * 2, rng)
        point_min, point_max = source.millimetres(lo + collar), source.millimetres(hi - 1 - collar)
        raw_points = raw_points[((raw_points >= point_min) & (raw_points <= point_max)).all(axis=1)][:args.samples]
        region = dict(id=name, centerFineXYZ=center.tolist(), originFineXYZ=lo.tolist(), shapeXYZ=(hi-lo).tolist(),
                      rawUint8Sha256=hashlib.sha256(core.astype(np.uint8).tobytes()).hexdigest(),
                      originalForegroundSamples=int(raw_mask.sum()), thinSupportSamples=int(thin.sum()), candidates=[])
        for column, sigma in enumerate(SIGMAS):
            if sigma == 0:
                filtered = core
                poly = raw
            else:
                filtered = ndi.gaussian_filter(full, sigma, truncate=3., mode='constant', cval=0.)[halo:-halo, halo:-halo, halo:-halo]
                poly = PREP.contour(np.ascontiguousarray(filtered), source.millimetres(lo), source.spacing_mm)
            mask = filtered >= 255 * .28
            labels, components = ndi.label(mask, np.ones((3,3,3), bool))
            del labels
            function = VALIDATE.distance_function(poly)
            distances = VALIDATE.distances(function, raw_points)
            item = dict(sigmaVoxels=sigma, sigmaMicrometres=sigma*79.4, triangles=int(poly.GetNumberOfCells()),
                        foregroundSamples=int(mask.sum()), removedOriginalForegroundSamples=int((raw_mask & ~mask).sum()),
                        addedForegroundSamples=int((~raw_mask & mask).sum()), foregroundComponents26=int(components),
                        retainedThinSupportSamples=int((thin & mask).sum()),
                        thinSupportRetainedFraction=float((thin & mask).sum()/max(1,thin.sum())),
                        rawSurfaceToFiltered=VALIDATE.stats(distances))
            region['candidates'].append(item)
            if renderer:
                points, faces, normals = mesh_normals(poly)
                image = renderer.draw(points, normals, faces, source.millimetres(center), args.radius*source.spacing_mm*1.25, clip_z=.15)
                p = OUT / f'filter-{name}-sigma-{sigma:g}.png'; Image.fromarray(image).save(p)
                item['render'] = dict(path=p.name, sha256=hashlib.sha256(p.read_bytes()).hexdigest(),
                                      camera='Fixed SurfaceRenderer camera; same center/span and open source-Z cut within row.',
                                      clipZNormalized=.15, renderer=renderer.driver, notBrowserScreenshot=True)
                x, y = 20 + column*600, 65 + row*600
                title = 'No added smoothing' if sigma == 0 else f'Gaussian σ {sigma:g}'+(' · previous' if sigma == .8 else '')
                draw.text((x,y), f'{name} · {title}', font=small, fill='#e4ebea')
                draw.text((x,y+25), f'{item["triangles"]:,} triangles · thin support {item["thinSupportRetainedFraction"]:.1%}', font=small, fill='#a5b8b6')
                sheet.paste(Image.fromarray(image), (x,y+53))
                del points, faces, normals, image
            print(json.dumps(dict(region=name,**{k:v for k,v in item.items() if k!='render'})), flush=True)
            del function, distances, mask
            if sigma:
                del poly, filtered
            gc.collect()
        report['regions'].append(region)
        write(OUT/'source-filter-comparison.json', dict(report, source=source.receipt(), seconds=time.monotonic()-started,
                                                       peakRssMiB=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024))
        del full, core, raw, raw_mask, thin, edt, interior, raw_points
        gc.collect()
    if renderer:
        draw.text((20, sheet.height-36), 'Measured source geometry · unchanged threshold · no anatomical truth labels · before simplification · scientific EGL rendering',font=small,fill='#a5b8b6')
        sheet.save(OUT/'source-filter-comparison.png')
    print(json.dumps(dict(done=True, report=str(OUT/'source-filter-comparison.json'), seconds=time.monotonic()-started)), flush=True)


if __name__ == '__main__':
    run()
