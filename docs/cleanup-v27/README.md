# v27: targeted display cleanup and atrial wall restoration

The final display removes the prominent proximal aortic nodule and the free portions of the two reviewed atrial sheets. It restores two atrial wall patches that earlier exclusions had hidden. Additional bounded selections remove low-contrast material below the pulmonic valve and around the tricuspid chordal region. The conspicuous central pulmonary-artery arc and much of the central tricuspid matrix remain: independent source review did not establish a separable object there that could be hidden without risking the neighboring wall or chordae.

These are reversible selections for visualization. The identity of the selected material is unverified. Brightness, darkness, mesh component membership, and local source continuity do not establish whether a structure is tissue, clot, or acquisition artifact.

## Final changes

| Region | Final operation | Retained boundary or limitation |
|---|---|---|
| Proximal aortic nodule, Y284 | Serial source contours select the protruding bright core and its low-contrast envelope. The visible nodule core is absent in the final matched view. | A source-supported collar at the neighboring myocardium/valve is retained. This explicit object selection permits bright source within its reviewed interior. |
| Lower atrial / appendage sheet, Y313 | Corrected serial contours follow the actual thin source sheet through fine Y1232–1304. The large free sheet portion is removed. | Wall attachment regions and nearby dense source stay protected. Some small attached remnants remain. |
| Upper atrial / pulmonary-vein sheet, Y320 | Serial seeds identify the isolated two-dimensional foreground of the sheet through fine Y1224–1304. Boundary-touching components are rejected; the selected foreground receives a two-sample edge allowance. | Connected attachment planes are retained. A few small edge fragments remain; no blanket removal of neighboring bright structures is performed. |
| Atrial wall, Y284 | Two source-supported restorations clear exactly **109,928** prior exclusion bits. The original mesh closes the oval and irregular scraped patches in the matched and oblique views. | No new geometry or synthetic CT samples. Two wall-support samples next to the protected lumen-object guard remain excluded. |
| Pulmonary artery, Y335 | Additional low-contrast material behind/below the pulmonic valve is removed within a bounded source envelope. | The central jagged arc remains. Its sampled surface lies only 2.24–7.55 fine samples from dense vessel wall and belongs to the same local source foreground component. |
| Tricuspid chordal region, Y222 | Bounded low-contrast fringe between dense source cores is reduced. | The central dark/jagged matrix remains prominent. Five sampled neighborhoods contained no retained, unguarded first-surface pixels under the current rule. Two tiny dense islands were independently reviewed and retained because continuing source foreground made their identity ambiguous. |

The final comparison images are in [`render/`](render/). Start with `nodule-284-comparison.jpg`, `wall-284-comparison.jpg`, `wall-284-oblique-comparison.jpg`, `appendage-313-comparison.jpg`, and `vein-320-comparison.jpg`. The PA and tricuspid comparisons intentionally show the remaining limits. The earlier candidate and second-render folders are an audit trail; they are not the final assets.

## Source and preservation method

The operations use the existing **79.4 µm fine display source** and the unchanged original `gentle` HFM mesh, labeled Ultra-high Fidelity in the viewer. The source manifest SHA-256 is `e50ab70a52373dc774cf6077ef906a753e56b78b9f9b646fba2ffe7220ff338c`. This is the existing mapped `clean-display-u8` source, not raw quantitative acquisition intensity. No new acquisition resolution is claimed.

Coordinates use the original fine-grid endpoints. Acquisition XYZ maps to world `(x,z,-y)`. The displayed Y-section number maps to fine Y as `(section - 1) × 4`; for example, Y284 corresponds to fine Y1132. The review cameras are nearby reproducible views, not exact registration of the user's camera.

Foreground support uses the existing sigma0.5 display threshold of 71.4/255. A nine-fine-sample allowance accommodates the original mesh. Dense source protection is defined from raw values ≥ 190 or sigma0.5/sigma0.8 values ≥ 135, with a ten-sample 3D guard. The guard is 0.794 mm in source-grid distance; it is an implementation allowance, not a clinical margin.

The nodule and sheets are explicit user-selected display objects. Their reviewed interior can include bright source. Dense source outside each object remains protected. The PA and tricuspid operations protect every dense source core, including cores inside their envelopes. Every new operation reports zero overlap with its declared protection guard and zero overlap with either wall-restoration footprint.

The two wall repairs are independently derived in [`../cleanup-v27-wall/`](../cleanup-v27-wall/). They start from the actual previously excluded source foreground connected to the reviewed wall seed, then clear only prior exclusions within the existing nine-sample mesh allowance. The irregular patch additionally protects the separately seeded lumen object's source and support halo. The exact combined restoration mask hash is `ac5d0d8771272e5bb14e0ae8ef13aea171c8abeda24d754e0345e1328aa5fbea`.

All source scalar arrays, measured CT cards, original HFM positions/normals/triangles, and the v26 detached-component flag payload remain unchanged. Disabling the current lumen and detached-component display options returns the same pre-v27 display source in both versions. Earlier inherited display preprocessing is still part of that source; this comparison is not a reconstruction of raw detector data.

## Exact asset delta

| Packed mask | New exclusions relative to v26 | Prior exclusions restored | Final selected samples |
|---|---:|---:|---:|
| Atrial |405,104|109,928|15,863,144|
| Arterial |155,942|0|1,169,504|
| Valve region |199,700|0|733,345|
| RV |478,539|0|1,181,662|
| **Total** |**1,239,285**|**109,928**|**18,947,655**|

These are display-mask sample counts, including mesh support allowances; they must not be interpreted as removed tissue volume. Per-operation selected-dense-source counts likewise include overlap with earlier exclusions and are not unique newly removed tissue measurements.

The four assets retain the existing exact `gzip-bitset-x-zyx` format, little-endian bit order along X, with eight logical X samples per byte. They occupy **1,422,864 compressed bytes** and **78,812,600 decoded packed bytes**, below the existing 128 MiB collective ceiling. There are still four mask samplers. All X padding is zero and the builder verifies the complete logical round trip.

The final manifest SHA-256 is **`d97ac73a657df879fdfb8c88004cb63a429b568455b45b2dfceb2ae6258742f8`**. It pins the complete builder, reviewed selections, source reader, and wall-restoration inputs. Partial mask reuse is intentionally unsupported. The predecessor is the immutable v26 manifest, SHA-256 `5070beb11e264f8d2cf7677f366a7a2f309e5bb0606705d71a8fd91c4342f086`.

Fields named `comparableAnchoredGuardRuleOverlapSamples` are counterfactual diagnostics: they evaluate the older anchored-dense rule on the **current** operation envelope. They are not archived v26 guard overlaps. The independent bitset comparison supplies the exact historical v26-to-v27 delta.

## Review coverage and evidence

The matched production-GLSL review includes the seven requested target/overview views, an additional oblique wall view, and six broader survey views: separated Y161, Y249 and Y361 cuts; the opposite clipped half at Y284; an apical Y253 close-up; and a rotated exterior view. The survey is bounded visual/source review, not exhaustive annotation of every voxel, surface or anatomical structure. No new global threshold or indiscriminate detached-fragment rule was introduced.

The source serial sheets under `source-refined/` and `source-sheet-boundaries/` show how the selections follow the measured display source. The independent PA source distances and connected-component evidence are in `../cleanup-v27-wall/pa-arc-source-points.json`. The tricuspid follow-up, including three-axis serial sheets for the small retained islands, is in [`../cleanup-v27-review/README.md`](../cleanup-v27-review/README.md).

The broader survey observations and per-view changed-pixel counts are recorded in `survey-review.json` and `render/validation.json`. Pixel changes show the extent of the display difference, not anatomical correctness. The default palette 4 is used for cleanup comparisons. `render/overview-284-v27-palette6.jpg` additionally shows the optional Atlas cinematic palette on the final masks; it was independently reviewed without changing the cleanup selection.

## Verification and reproduction

The independent test `tests/lumen-mask-regions-v27.py` passed against the frozen baseline commit `310ac98b35a1e4e909208fbf67acade939f47c38`. It decodes the shipped products independently, verifies every added/restored logical sample is in a declared footprint, checks both exact restoration hashes, proves no other mask re-excludes the restored wall, and verifies the protected source/prior files remain unchanged. Its receipt is [`../release-v27/mask-region-validation.json`](../release-v27/mask-region-validation.json).

Production EGL rendering uses the unchanged full Gentle mesh and the actual browser shader sources. Each completed camera verifies v26→v27→v26 exact restoration, identical cleanup-disabled readbacks, unchanged measured cap hashes, and hashes of the lossless image arrays. These are source/geometry/shader checks, not clinical validation or browser frame-rate measurements. The long 14-view offline batch hit a native memory limit after 11 completed views (exit 137); those verified lossless readbacks were retained and only the remaining three views were rendered in a fresh context. The aggregated receipt records that recovery explicitly.

With the verified brick bank in `data/ultra-volume-v7/`:

```bash
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python scripts/cleanup-v27/build_masks.py --apply-wall-repair
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python tests/lumen-mask-regions-v27.py
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python scripts/cleanup-v27/render_review.py --case nodule-284 --case wall-284
```

For resource-bounded EGL work, run a few named cameras per process and retain each validation receipt. The asset builder always regenerates all four masks together. `lumen-build.json`, per-operation policy records, per-mask build records, and the independent receipts provide the exact counts and hashes.
