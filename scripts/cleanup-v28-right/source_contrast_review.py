#!/usr/bin/env python3
"""Show the immutable source, original boundary and selected local boundary."""
from pathlib import Path
import os
os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')
os.environ.setdefault('OMP_NUM_THREADS', '1')
import json
import numpy as np
from scipy import ndimage as ndi
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from adaptive_patch import FineSource, fields_for, threshold_plane, BASE

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/cleanup-v28-right/source'
OUT.mkdir(parents=True, exist_ok=True)
reader = FineSource(16)

for name, planes in [('tricuspid', [790, 880, 940]), ('pulmonary', [656, 696, 736])]:
    config = json.loads((ROOT / f'scripts/cleanup-v28-right/{name}-config.json').read_text())
    axis = config.get('sliceAxis', 1)
    horizontal = 1 if axis == 0 else 0
    lo, hi = np.array(config['lowerXYZ']), np.array(config['upperXYZ'])
    fields = fields_for(config)
    fig, axes = plt.subplots(3, 3, figsize=(14, 12), dpi=125, constrained_layout=True)
    for row, coordinate in enumerate(planes):
        read_lo, read_hi = lo.copy() - 3, hi.copy() + 3
        read_lo[axis], read_hi[axis] = coordinate - 3, coordinate + 4
        raw = reader.region(read_lo, read_hi)
        field = ndi.gaussian_filter(raw.astype(np.float32), .5, truncate=3)
        sl = (slice(3, -3), 3, slice(3, -3)) if axis == 1 else (slice(3, -3), slice(3, -3), 3)
        source, smooth = raw[sl], field[sl]
        threshold = threshold_plane(config, fields, coordinate)
        threshold = np.minimum(threshold, np.where(source >= 190, np.maximum(BASE, smooth - 1e-3), 255))
        removed = (smooth >= BASE) & (smooth < threshold)
        extent = [lo[horizontal] - .5, hi[horizontal] - .5, hi[2] - .5, lo[2] - .5]
        gx = np.arange(lo[horizontal], hi[horizontal]); gz = np.arange(lo[2], hi[2])
        for col, ax in enumerate(axes[row]):
            ax.imshow(source, cmap='gray', vmin=35, vmax=180, extent=extent, interpolation='nearest')
            if col == 1:
                ax.contour(gx, gz, smooth, levels=[BASE], colors=['#62d7f4'], linewidths=.45)
            if col == 2:
                overlay = np.zeros((*source.shape, 4), np.float32)
                overlay[removed] = [1., .15, .12, .45]
                ax.imshow(overlay, extent=extent, interpolation='nearest')
                ax.contour(gx, gz, smooth - threshold, levels=[0], colors=['#ffd76b'], linewidths=.45)
            ax.set_xlim(lo[horizontal], hi[horizontal] - 1)
            ax.set_ylim(hi[2] - 1, lo[2])
            ax.set_xlabel('Fine ' + 'XYZ'[horizontal] + ' sample')
            if col == 0:
                ax.set_ylabel('Fine Z sample · ' + 'XYZ'[axis] + '=' + str(coordinate))
            if row == 0:
                ax.set_title(['Unchanged display source', 'Original surface level 71.4', 'Selected local surface · excluded band in red'][col], fontsize=11)
    fig.suptitle(f'{name.capitalize()} source contrast review — 79.4 µm mapped uint8, not calibrated HU\n'
                 'Only traced interior polygons raise the level to 120; bright cores and original-level collars remain.', fontsize=13)
    fig.savefig(OUT / f'{name}-contrast-review.jpg', facecolor='white', pil_kwargs={'quality': 95})
    plt.close(fig)

