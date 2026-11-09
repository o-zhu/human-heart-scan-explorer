# v29 targeted LVOT and LA/PV refinement

## Result and integration

The reviewed LVOT change removes the low-contrast jagged fringe immediately
proximal to the aortic valve in the supplied sagittal 294 view. The LA/PV change
removes small residual fragments from the already selected free sheet by fixing
inconsistent serial contour anchors. The large upright PV/atrial feature is
retained because its production-coordinate readback traces onto the
source-supported wall. Removing it wholesale would repeat the earlier scraped
wall problem.

The parent build can integrate these files into canonical `cleanup-v29` assets:

| Deliverable | Path | Notes |
| --- | --- | --- |
| LVOT compact surface | `docs/cleanup-v29-left/patch/lvot-perivalvular-refinement.hfm.gz` | Replaces the matching v28 patch ID; 7,278,090 bytes |
| LVOT low-band mask | `docs/cleanup-v29-left/patch/lvot-perivalvular-refinement-low-band.bits.gz` | 244,591 bytes; used only with this replacement patch |
| LVOT metadata and validation | `docs/cleanup-v29-left/patch/lvot-perivalvular-refinement-policy.json` | Full surface bounds, field configuration, hashes and QEM report |
| Updated atrial mask | `public/assets/cleanup-v29-left/atrial.bits.gz` | The complete previous atrial mask plus exactly 16,979 additional samples |
| Atrial candidate manifest | `public/assets/cleanup-v29-left/lumen-manifest.json` | Reuses the other three v28 masks exactly; parent build replaces surface manifest URL |
| Exact atrial difference | `docs/cleanup-v29-left/atrial/pulmonary-vein-residual-contour-correction-selection.npz` | Boolean ZYX difference with lower/exclusive upper XYZ |
| Atrial policy | `docs/cleanup-v29-left/atrial/pulmonary-vein-residual-contour-correction-policy.json` | Selected object, dense-source guard and corrected contour anchors |

The full, unreduced LVOT extraction is a reproducible intermediate, retained at
`{source-cache}/cleanup-v29-left/patch/lvot-perivalvular-refinement.sfr.gz`.
Its SHA-256 is
`f44ccc81542701bf6b2ae9a6d4bc53bd0bf403630c2bb7363fbbb0cef6e18885`.
It is 76,627,464 bytes and is not a runtime/deployment asset. The policy retains
its identity as `surfaceReference` for reconstruction and compression checks.

## LVOT method and measured limits

The published patch ends at fine Y1120 and starts at Z1080. Production Float32
XYZ readback located the newly reported fringe near fine X1075–1113,
Y1159–1168, Z964–1002, outside that earlier region. This explains why the prior
cleanup did not address it.

The replacement takes the maximum of two independent, smoothly collared
threshold fields. The previous field remains exact in every sample of its
original box; the new field is limited to its separately reviewed polygons.
The combined box is `[1018,944,916]` to `[1212,1204,1372]`. Baseline display
isovalue 71.4 is retained outside the selected interiors, with an interior
ceiling of 120 and sigma 0.5 source filtering. These are windowed uint8 display
values, **not calibrated Hounsfield units**.

The extension removes an additional 49,551 source-foreground samples beyond
the prior LVOT low band. Every measured raw ≥190 and sigma-0.5 ≥135 core in the
combined crop remains foreground. The old low-band bits are identical in the
previous crop. All 109,928 previously restored atrial-wall samples remain
outside both the new low band and the delivered exclusion masks.

The compact surface has 333,560 vertices and 700,968 triangles. Measured
12,000-point surface-distance checks give:

| Comparison | p95 distance | Maximum sampled distance |
| --- | ---: | ---: |
| Source-adaptive surface → delivered compact surface | 0.04127 mm | 0.16301 mm |
| Delivered compact surface → source-adaptive surface | 0.03416 mm | 0.09023 mm |

The QEM original-vertex radius is bounded by 0.3176 mm; observed maximum was
0.317599 mm. Position quantization has a maximum computed error of 0.0003384 mm.
Sampled distances are not Hausdorff bounds or clinical accuracy estimates.

## LA/PV contour correction

The v28 free-sheet selection updated Y1208, Y1216 and Y1224 but retained older
Y1212 and Y1220 anchors between those new traces. Interpolation through those
inconsistent anchors caused the 3D dense-source guard to protect pieces of the
selected sheet itself. For example, residual sample `[1304,1216,759]` was only
three samples from a falsely external protected point at `[1303,1218,761]`.

The new build removes those two stale anchors and interpolates the consistent
neighboring contours. One additional source-traced contour at Y1256 covers a
small previously missed free-sheet edge. Delivery is bounded to
`[1203,1204,671]`–`[1410,1264,838]`, and only the new difference is unioned into
the frozen mask. It adds 16,979 samples (about 8.50 mm³ of display exclusion).
The four-sample 3D guard around dense source outside the selected object remains
active. There are zero newly selected protected-outside-object samples and zero
overlap with the restored-wall footprint.

Source review and production readback show that the prominent upright feature
near `[1319,1182,726]` belongs to the supported PV/atrial wall across
Y1120–1184. It is intentionally retained; its appearance alone is insufficient
evidence for deletion. This is a local visualization refinement, not a tissue
identity classification.

## Evidence and reproducibility

The two actual-production GLSL/EGL comparisons are:

- `render/lvot-y294-comparison.jpg`
- `render/la-y316-comparison.jpg`

Both use the original source geometry, all current local patches on the before
side, the same camera, and the same verified lossless 79.4 µm source cap. Exact
before → after → before restoration and cleanup-off pixel equality pass. The
LA comparison changes 1,226 of 604,800 pixels. The LVOT comparison changes
44,638 pixels with both delivered left-side changes active; its expanded crop is re-extracted at the original baseline
outside the additional contour, so some surface shading also changes there.

Per-camera validation JSON and lossless render files preserve hashes and the
render setup. Lossless images and original-ID camera caches are under
`{source-cache}/cleanup-v29-left/`. The camera caches contain `used.npy`, so
parent shading corrections can map original normal IDs without reculling.
`render/mask-manifest-rendered.json` preserves the precise mask manifest used
during the comparisons. A subsequent metadata-only rebuild corrects its build
provenance in the delivered candidate; the four mask payload identities are
unchanged.

Source panels are under `source-depth/`, `la-depth/`, and
`atrial/source-before/` / `atrial/source-after/`. `invariants.json` records an
independent re-decode check of the actual delivered mask/mesh hashes, exact
mask difference, unchanged other three masks, old LVOT low-band identity and
the complete frozen wall-restoration footprint.

Rebuild with `{temporary-cache}/bin/python` and single-thread BLAS:

```sh
python scripts/cleanup-v29-left/build_compound_patch.py
python scripts/cleanup-v28-right/compact_patch.py docs/cleanup-v29-left/patch/lvot-perivalvular-refinement-policy.json --radius-mm .3176 --samples 12000
python scripts/cleanup-v29-left/build_atrial_residual.py
python scripts/cleanup-v29-left/validate.py
python scripts/cleanup-v29-left/render_review.py --case lvot-y294 --patch-policy docs/cleanup-v29-left/patch/lvot-perivalvular-refinement-policy.json --stream-triangles 100000
python scripts/cleanup-v29-left/render_review.py --case la-y316 --patch-policy docs/cleanup-v29-left/patch/lvot-perivalvular-refinement-policy.json --stream-triangles 100000
```

The seam-normal correction is owned and reviewed separately by the parent.
No original source scalar bank, source section pixel, or original surface
asset was edited. No clinical anatomical validation is claimed.
