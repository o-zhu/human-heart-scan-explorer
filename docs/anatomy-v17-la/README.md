# LADAF-2021-17: conservative LA exterior completion

This revision adds color to small, previously neutral parts of the left-atrial exterior. It preserves every pre-existing nonzero v12 region label. The previous RV-facing septal correction, LV exterior completion, atrial boundaries, arterial identities and all 43 retained source-review controls therefore remain intact.

The annotations remain **approximate educational regional associations**. This is a targeted coverage improvement; it is not an expert-validated chamber segmentation, a histological boundary map, or a basis for chamber-volume or wall-thickness measurements.

## Source and finding

The original LADAF-2021-17 uint16 s4 source was reused from the cached, hash-recorded N5 blocks. Its array is ZYX 530 × 475 × 475 at 317.6 µm voxel-center spacing. The categorical annotation grid remains XYZ 317 × 317 × 354, registered to exactly the same first and last voxel centers. Source N5 block provenance is retained in `../anatomy-v12/source-chunks.json`; this revision records the complete source-array hash in `packaging.json`.

Review of the original source showed thin folded walls and covering in the existing LA territory that were visible in measured tissue but missed by the previous smoothed working-grid threshold. At this grid size, point sampling and smoothing can miss a narrow tissue segment even when an original source voxel inside that annotation cell is above the display isovalue. A source-occupancy check recovers these cells without changing the CT data or surface geometry.

The incomplete areas include portions of an ostial rim surrounded by the existing LA territory and small exterior patches. Completing nearby measured tissue does **not** independently identify that ostium as a specific pulmonary vein. Its identity and the remaining LA–vascular/valvular transitions remain provisional.

## Methods compared

All three candidates were evaluated against the same immutable v12 labels and original tissue support. None changes any existing nonzero region.

| Approach | Added LA cells | Cells inside the competing-region exclusion margin | Decision |
| --- | ---: | ---: | --- |
| Nearest LA within 3.5 mm | 4,578 | 1,054 | Rejected: extends into disputed neighboring boundaries |
| Morphological closing, four 18-connected iterations | 2,207 | 294 | Rejected: shape-based closure can bridge folds and enters disputed boundaries |
| Source-connected completion with physical collar and region guard | 3,096 | 0 | Selected |

The selected method requires all of the following:

1. The annotation cell was neutral in v12.
2. At least one original uint16 source voxel assigned to that cell is at or above 17,100. The source is neither filtered nor rescaled for this occupancy test.
3. The cell is no more than 2.4 mm from an existing LA label.
4. The nearest competing region is at least 0.95 mm farther away than the nearest LA region.
5. A six-neighbor, intensity-weighted path through source-supported cells connects it to the existing LA territory within a bounded path cost.

The path calculation reuses the v12 working intensities solely to guide annotation continuity. It does not alter source intensity values. Of the 3,096 new cells, 1,219 were below the older smoothed working-grid threshold but contained measured original-source tissue. The new cells increase the LA annotation count by approximately 0.67%; all other regional counts remain identical.

## Before/after review

Six original uint16 section comparisons are included as `source-z-130.jpg`, `source-z-170.jpg`, `source-z-210.jpg`, `source-z-250.jpg`, `source-z-280.jpg`, and `source-y-352.jpg`. Each image shows the uncolored source, v12 labels, and selected v17 labels with the same intensity window and source pixels. Y=352 corresponds to the section index visible in the user's screenshot; the native camera is a controlled scientific review view, not a recreation of the browser camera.

Four native source-derived projections use the original s4 volume and the published cleanup mask. For each camera, the ray-surface intersections and shading are computed once, then recolored before/after. No surface is moved, enlarged or invented to increase color coverage.

| Fixed native view | LA-colored pixels before → after | Neutral pixels before → after | Reduction of neutral pixels |
| --- | ---: | ---: | ---: |
| Posterior exterior | 55,878 → 57,030 | 5,426 → 4,274 | 21.2% |
| Lateral exterior | 73,690 → 75,017 | 6,885 → 5,558 | 19.3% |
| Superior exterior | 77,505 → 79,036 | 5,388 → 3,857 | 28.4% |
| Y=352 posterior cut | 6,828 → 6,939 | 357 → 246 | 31.1% |

These figures measure coverage in four fixed source-surface projections. They are not overlap scores against an expert segmentation, and they do not establish clinical accuracy. Neutral tissue remains at uncertain boundaries and outside the narrow permitted LA collar.

## Preservation checks

- Every nonzero v12 categorical byte is identical in v17; only 0 → 3 changes are allowed.
- All 43 pre-existing source-review controls still match. These include both previously independent controls and prior correction controls; they are not 43 new independent validation points.
- An independent asset test recomputes nearest-region physical distances at every changed cell using KD trees, verifies the 2.4 mm collar and 0.95 mm guard, and checks hashes and region counts.
- Density volume, high-resolution slice textures, cleanup, smoothing, camera registration, shader thresholds and rendering geometry are unchanged.
- The compressed asset uses a new content-derived filename. Existing cached v12 bytes cannot silently serve as v17.

## Reproduction

With the cached original source and v12 working volume available:

```bash
python scripts/anatomy-v17-la-refine.py all \
  --source {source-cache}/anatomy-v12/source-s4.npy \
  --previous-work {source-cache}/anatomy-v12 \
  --work {source-cache}/anatomy-v17-la
python tests/anatomy-v12-asset.py
python tests/anatomy-v17-la-asset.py
```

The script requires NumPy, SciPy, Pillow and a C++ compiler with OpenMP for the native scientific review renders. The source blocks and source hash are inherited from the v12 provenance record; no browser, synthetic anatomy, trained segmentation model or source re-registration is involved.

Machine-readable parameters and results are in `method-comparison.json`, `verification.json`, `surface-review.json`, and `packaging.json`. `baseline-manifest-v12.json` retains the exact metadata preceding this refinement.
