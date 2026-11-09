# Version 28: left-sided source review and bounded cleanup

This review addresses the residual LV outflow tract fringe, upper left atrial/pulmonary-vein sheet, appendage sheet, and the previously uncovered early extent of the selected atrial inlet material. The candidate changes are reproducible, reversible visualization choices. They do not establish whether an individual object is clot, preparation residue, or native tissue.

## Source and fixed invariants

The measured input is the verified `ultra-volume-v7` display-u8 source at **79.4 µm**. Its encoding window is 14640–23545 and `quantitativeIntensityData` is false. These values are **not calibrated Hounsfield units**. The original density bank, original surface positions/normals/indices, and CT card pixels are unchanged.

The source manifest SHA-256 is `e50ab70a52373dc774cf6077ef906a753e56b78b9f9b646fba2ffe7220ff338c`. The frozen v27 lumen manifest SHA-256 is `d97ac73a657df879fdfb8c88004cb63a429b568455b45b2dfceb2ae6258742f8`. All 109,928 samples of the two v27 wall-restoration footprints are retained. Their union SHA-256 remains `ac5d0d8771272e5bb14e0ae8ef13aea171c8abeda24d754e0345e1328aa5fbea`.

`verification.json` independently decodes the candidate assets, checks these identities and the restoration union, reloads source samples, and tests both selected objects and protected neighboring wall coordinates. All checks passed. Rendering and anatomical interpretation remain separate checks.

## Why the earlier cleanup missed these areas

The production fine-coordinate readbacks showed that the LVOT remnant in section Y262 lies mostly in fine Y965–1044. It was not the same extent as the nodule previously reviewed at Y284. A broad mask around the older nodule would therefore miss the new visible fringe.

The upper atrial/PV selection also previously rejected whole image planes when the sheet became connected to a wall. That retained the free portion as well as the attachment. The v28 contour follows the free object through those planes, protects the neighboring wall locally, and follows its late end through fine Y1340.

The X313 inlet review exposed another concrete omission: the old atrial mask texture started at fine Y820 and Z460. The visible object extends earlier than Y820 and its free upper lobe briefly extends above Z460. Serial sections Y748–856 and the X313 production readback show this object joining the already selected atrial material. The new selection extends the texture bounds to cover that continuation.

One apparently dark triangular area behind the appendage sheet was deliberately excluded from the selection. The production readback placed it near fine Y1136; serial source planes show it to be source-supported wall. Extending the sheet mask backward to that depth would remove wall.

## Complete free-sheet selections

`scripts/cleanup-v28-left/selections.py` contains the explicit per-Y source contours. `build.py` interpolates signed-distance fields and adds a nine-sample allowance for the delivered source surface. Outside each explicit selected object it protects all raw values ≥190, sigma0.5 values ≥135, or sigma0.8 values ≥135 with a **four-sample 3D collar** (0.3176 mm). This replaces the old ten-sample collar locally after source and production-coordinate review. It does not apply a whole-heart threshold increase.

The explicit user-selected free object can contain bright material. The bright-value exception applies only inside that traced object; it is not used to remove neighboring dense wall. Every selected sample is also within nine samples of the original sigma0.5 ≥71.4 source foreground. All candidates have zero intersection with protected dense source outside the object, the four-sample guard, and restored wall footprints.

| Selection | Lower XYZ, inclusive | Upper XYZ, exclusive | Unique additions to v27 | Previously visible traced-core foreground removed |
| --- | --- | --- | ---: | ---: |
| Upper LA/PV complete sheet | 1203,1180,671 | 1410,1341,838 | 284,073 | 69,271 / 80,239 (86.33%) |
| Appendage complete free sheet | 1134,1216,781 | 1355,1317,994 | 186,770 | 37,569 / 62,596 (60.02%) |
| Early inlet continuation | 1155,748,432 | 1325,857,749 | 590,239 | 188,458 / 202,025 (93.28%) |

These percentages measure reduction of source foreground inside the reviewed contours. They are not whole-chamber cleanup rates, image similarity scores, or clinical accuracy estimates. Retained portions include attachment collars and nearby wall boundaries.

The delivered candidate NPZs and policies are in `candidates/`. Source overlays in `candidate-review/` show the old exclusions in orange, new exclusions in cyan, and reviewed contours in yellow. `candidate-review/validation.json` contains every inspected plane and the full serial totals.

## LVOT: reconstructing the local source boundary

A binary exclusion over the old low-threshold mesh would punch holes through the surface surrounding the retained bright core. Instead, `lvot-patch-config.json` defines a bounded local source reconstruction over `[1048,944,1080]` to `[1212,1120,1372)`. The selected final configuration raises the sigma0.5 source isovalue from 71.4 to a maximum of **120** only inside the reviewed polygons. Smooth collars restore 71.4 at the polygon edges, Y endpoints, and every box face.

The complete local isosurface then encloses the retained cores. Every sigma0.5 value ≥135 and every raw value ≥190 that belonged to the baseline foreground remains foreground during this extraction. The final extraction removes **581,627** weak foreground samples while retaining all **2,311,604** sigma135 cores and all **344,798** raw190 baseline samples. The changed box-boundary sample count and restored-wall overlap are both zero. In fine Y1044 alone, 4,641 weak foreground samples are removed and all 7,331 sigma135 samples remain.

The shared `cleanup-v28-right/adaptive_patch.py` builds this surface and its low-band mask. The low-band mask is for density and cut-cap consistency; it must not be used to punch holes in its own replacement surface. Runtime integration belongs to the common v28 build.

The shared `compact_patch.py` applies the already established v25/v26 compact detached-fragment display rules to complete closed components before simplifying. All components touching a crop face, long thin components outside the compactness criteria, and the largest component are retained. For the final 120-threshold LVOT patch this removes 12,492 complete compact components / 229,012 triangles. This inherited display filtering is distinct from the source-core retention guarantee of the scalar extraction stage.

The final deliverable uses topology-constrained QEM with open boundary vertices frozen and an accumulated original-vertex radius of **0.3176 mm**. It contains **282,600 triangles**, occupies **2,998,934 bytes compressed**, and requires **5,074,236 bytes** of GPU attribute/index buffers. Positions use uint16 coordinates within the local patch bounds; quantization contributes less than 0.00023 mm of measured error. Its HFM SHA-256 is `58b2b3407b22dee22f4131f17408415a85ad02b77815f0e5059abe147b98045c`.

The source-guided reconstruction visibly reduces the old dark fringe, but the first full production comparison still showed connected fine texture. This prompted the separate contrast/tessellation ablation below; the first candidate is not described as a fully polished anatomical result.

## Contrast and tessellation ablation

The `ablation/` directory preserves the alternative policies, source evidence, archive receipt, and measurements used to choose the final patch. The higher local threshold 120 remains below 135 and retains the same protected source cores, while removing 581,627 foreground samples. The larger QEM radius 0.3176 mm is half the existing main Gentle radius; all open boundaries remain locked. The purpose is to separate intensity-driven cleanup from the finer tessellation texture introduced by local remeshing.

| Local maximum / QEM radius | Triangles | Compressed bytes | Source→surface p95 | Surface→source p95 | Largest sampled distance |
| --- | ---: | ---: | ---: | ---: | ---: |
| 110 / 0.1588 mm, initial | 590,420 | 6,220,516 | 0.02011 mm | 0.01839 mm | 0.06568 mm |
| 110 / 0.3176 mm | 285,514 | 3,034,877 | 0.04022 mm | 0.03149 mm | 0.14607 mm |
| **120 / 0.3176 mm, selected** | **282,600** | **2,998,934** | **0.03765 mm** | **0.03222 mm** | **0.15565 mm** |

Distances use 12,000 deterministic area-weighted points in each direction and exact nearest point-to-triangle distance to the unsimplified local reference after the inherited detached-fragment rule. They do not bound Hausdorff distance or establish anatomical/clinical accuracy. The conservative QEM radius is a separate constraint.

The full production comparisons in `docs/cleanup-v28/lvot-t110-r4/` and `docs/cleanup-v28/lvot-t120-r4/` were reviewed alongside the measured source planes. The 120/0.3176 mm candidate removes more connected dim material between the long bright core and adjoining strands, with cleaner surface texture than the 110 alternatives. The bright core and cut outlines remain. It was approved and promoted as a matching surface, low-band mask, policy, and active configuration. Connected source texture remains; the result is not described as completely artifact-free. The inlet addition was separately approved after `docs/cleanup-v28/inlet-candidate/inlet-x313-comparison.jpg` showed large-body removal with adjacent wall outlines retained.

Unused ablation binaries were moved outside the repository to a reproducible working cache; `ablation/archive-receipt.json` records their exact paths, hashes, sizes, and promotion destinations. Alternative configurations and policies remain in the repository. The selected final SFR reference, HFM surface, low-band mask, and policy remain in `patch/`.

## Reproduction

Run from the repository root with single-threaded BLAS/OpenMP. Source bank access is handled by the verified `FineSource` reader.

```bash
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python3 scripts/cleanup-v28-left/build.py
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python3 scripts/cleanup-v28-left/review_candidates.py
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python3 scripts/cleanup-v28-right/adaptive_patch.py scripts/cleanup-v28-left/lvot-patch-config.json --output docs/cleanup-v28-left/patch
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python3 scripts/cleanup-v28-right/compact_patch.py docs/cleanup-v28-left/patch/lvot-perivalvular-refinement-policy.json --radius-mm .3176
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python3 scripts/cleanup-v28-left/review_patch.py
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python3 scripts/cleanup-v28-left/verify_candidates.py
```

Source-review configurations are stored beside these scripts. Production view coordinate maps and full-geometry comparisons are generated by the common `scripts/cleanup-v28/` tools, with their own camera metadata and renderer/source hashes. The final publication package must use the selected matching policy/surface/low-band set and pass the common runtime gates.
