#!/usr/bin/env python3
"""Bounded source-section diagnostics for the two user-supplied cutaways.

Raw s4 source is memory mapped. This diagnostic changes no source intensities,
mesh, threshold, or published asset. Coordinates are zero-based source XYZ.
"""
from pathlib import Path
import argparse
import json
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle

ROOT = Path(__file__).resolve().parents[2]


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--source', type=Path, default=Path('/workspace/data/anatomy-v12/source-s4.npy'))
    p.add_argument('--out', type=Path, default=ROOT / 'docs/lumen-artifacts-v23')
    a = p.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    source = np.load(a.source, mmap_mode='r')
    window = (14640, 23545)
    fig, axes = plt.subplots(2, 3, figsize=(13, 12), constrained_layout=True)
    for ax, y in zip(axes[0], [286, 296, 306]):
        data = source[:, y, :]
        ax.imshow(data, cmap='gray', vmin=window[0], vmax=window[1], origin='upper')
        ax.set(title=f'Y = {y} (section {y+1}/475)', xlabel='Source x (s4 voxels)', ylabel='Source z (s4 voxels)')
        ax.set_xlim(100, 400); ax.set_ylim(340, 20)
        ax.add_patch(Rectangle((285, 130), 80, 160, fill=False, ec='#ed9d88', lw=1.3))
        ax.text(287, 126, 'Atrial candidate region', color='#ed9d88', fontsize=8)
    for ax, x in zip(axes[1], [235, 245, 255]):
        data = source[:, :, x]
        ax.imshow(data, cmap='gray', vmin=window[0], vmax=window[1], origin='upper')
        ax.set(title=f'X = {x} (section {x+1}/475)', xlabel='Source y (s4 voxels)', ylabel='Source z (s4 voxels)')
        ax.set_xlim(100, 400); ax.set_ylim(340, 20)
        ax.add_patch(Rectangle((210, 40), 130, 160, fill=False, ec='#91b3cb', lw=1.3))
        ax.text(212, 36, 'Outflow candidate region', color='#91b3cb', fontsize=8)
    fig.suptitle('Measured source sections near screenshot cut planes\n317.6 µm s4 raw source; common 14640–23545 display window; anatomical labels provisional', fontsize=12)
    fig.savefig(a.out / 's4-source-section-context.png', dpi=150)
    plt.close(fig)
    (a.out / 's4-source-section-context.json').write_text(json.dumps({
        'source': str(a.source), 'sourceShapeZYX': list(source.shape),
        'sourceDtype': str(source.dtype), 'spacingUm': 317.6,
        'displayWindowOriginalUnits': list(window),
        'screenshotSections': [{'axis': 'y', 'index0': 296}, {'axis': 'x', 'index0': 245}],
        'scope': 'Context only. Raw s4 differs from fine display bank; no tissue classification or removal is justified by this image alone.'
    }, indent=2) + '\n')


if __name__ == '__main__':
    main()
