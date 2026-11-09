# Preliminary source-position diagnostics

These v25 images use the cameras in `scripts/cleanup-v26/locate_residual.py`.
They supported source-coordinate lookup before the v26 refinement. They are
not the final acceptance comparisons; those are under `../render/`.

Full float RGBA source-position rasters are stored as regenerable `.npz`
intermediates under `{source-cache}/cleanup-v26/`. Lossless v25 images are
under `{source-cache}/cleanup-v26/locate/`; these compact JPEGs preserve the
viewing reference in the repository. The diagnostic writes positions through
the actual production projection, masks and depth buffer.
