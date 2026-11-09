# v28: source-guided local surface refinement

This revision addresses the residual LV outflow tract fringe, tricuspid chordal spikes, pulmonary valve/lumen material, and left atrial/PV/appendage sheets identified in the latest screenshots. It combines three bounded source-derived replacement surfaces with three explicit atrial object selections. The original measured source and original whole-heart geometry remain available.

The final packaged identities and measurements are recorded in [surface-build.json](surface-build.json) and [lumen-build.json](lumen-build.json), with runtime assets declared by the [surface manifest](../../public/assets/cleanup-v28/surface-manifest.json) and [lumen manifest](../../public/assets/cleanup-v28/lumen-manifest.json). These notes describe an interpreted visualization cleanup, not a validated biological segmentation.

## Why the previous cleanup missed visible material

Production GPU position readbacks located the surfaces actually visible in the screenshots. The LVOT Y262 remnant lay mainly at fine Y965–1044, outside the extent of the earlier Y284 nodule review. Much of the tricuspid remnant was around fine X625–788 while the old narrow selection was mainly X829–935. The pulmonary X194 remnant was around X644–750 while the prior selection was mainly X780–926. The new source contours follow those corrected locations.

Two additional rules had left atrial material visible. The previous PV selection rejected an entire section when the free sheet connected to a wall elsewhere in that section. Its wide wall collar also retained a substantial free portion. The X313 inlet view exposed an earlier continuation of material before the old atrial texture began at Y820; its upper lobe also extended above Z460. Serial source review follows that continuation through Y748–856. The atrial texture now starts at `[1080,748,432]`, with the inherited bits preserved in their original coordinates.

The apparently dark triangular region behind the appendage sheet was not included: the production readback placed it near fine Y1136 and the serial source shows supported wall there. The source-based selection therefore stops at the actual free object. Localization evidence is in [locate/](locate/), [locate-right/](locate-right/), [locate-inlet/](locate-inlet/), and the detailed [left](../cleanup-v28-left/README.md) and [right](../cleanup-v28-right/README.md) reviews.

## Intensity means display contrast, not calibrated HU

The input is the verified **79.4 µm display-u8 bank**, `ultra-volume-v7`, with source encoding window **14640–23545** and `quantitativeIntensityData: false`. Its manifest SHA-256 is `e50ab70a52373dc774cf6077ef906a753e56b78b9f9b646fba2ffe7220ff338c`. Thresholds below are mapped display values, **not Hounsfield units** or tissue classes.

Each builder reads bounded, verified source bricks and records raw and padded region hashes. It leaves original source scalars, CT section pixels, original Gentle geometry, native 19.85 µm data, and prior v27 assets unchanged. The new surfaces refine the 79.4 µm interpretation; they do not add native 19.85 µm sampling or new acquisition resolution.

## Three selected local source surfaces

All three configurations use Gaussian sigma **0.5 fine samples**, baseline level **71.4** (normalized 0.28), and reviewed interior maximum **120**. Interpolated signed-distance contours and cubic smoothstep collars return the threshold to baseline at polygon edges, slice-range ends, and every crop face. Every sigma 0.5 sample ≥135 and every raw ≥190 sample that was foreground at baseline remains foreground during thresholding.

| Region and final configuration | Fine XYZ lower, inclusive | Fine XYZ upper, exclusive | Polygon axis | Polygon / box / end collars, samples | Low-band samples removed |
| --- | --- | --- | --- | --- | ---: |
| [LVOT](../../scripts/cleanup-v28-left/lvot-patch-config.json) | 1048,944,1080 | 1212,1120,1372 | Y | 12 / 8 / 12 | 581,627 |
| [Tricuspid](../../scripts/cleanup-v28-right/tricuspid-config.json) | 600,660,1020 | 870,1040,1350 | Y | 10 / 8 / 12 | 769,532 |
| [Pulmonary valve/lumen](../../scripts/cleanup-v28-right/pulmonary-config.json) | 604,1080,540 | 790,1360,972 | X | 12 / 8 / 12 | 970,563 |

The complete local isosurface is re-extracted around retained cores. This avoids cutting holes through the old low-threshold surface. The matching low-band mask is applied to scalar/cap/picking behavior and must not fragment-clip its own replacement mesh. The three non-overlapping boxes retain **9,064,625 sigma135 samples** and **1,694,988 raw190 baseline samples**, with zero protected-core losses and zero changed crop-boundary threshold samples. These guarantees concern scalar extraction.

A separate display stage applies the established v25/v26 compact detached-component criteria to complete local components. It protects components touching crop faces, the largest component, and long thin components that fail the compactness criteria. This avoids reintroducing fragments already hidden by Gentle cleanup; it does not assert their biological identity. The broader arterial 4 mm rule is not generalized. Exact criteria and counts are in the individual policies and the [right-side methods](../cleanup-v28-right/README.md).

All final patches use the pinned topology-constrained QEM reducer with a **0.3176 mm accumulated original-vertex radius limit**, open boundaries frozen, and interior link/tetrahedron constraints. No additional vertex smoothing is applied. Matched renders and source review favored these candidates over the tighter 0.1588 mm and/or lower-threshold alternatives. The final three surfaces contain **1,120,840 triangles**. Together with their masks they occupy **12,497,761 compressed bytes** and **28,138,400 decoded bytes**.

| Final surface | Triangles | Source→surface p95 | Surface→source p95 | Maximum sampled distance, either direction |
| --- | ---: | ---: | ---: | ---: |
| LVOT | 282,600 | 0.03765 mm | 0.03222 mm | 0.15565 mm |
| Tricuspid | 302,706 | 0.04134 mm | 0.03166 mm | 0.17139 mm |
| Pulmonary valve/lumen | 535,534 | 0.04475 mm | 0.03530 mm | 0.16763 mm |

Each direction uses 12,000 deterministic area-weighted samples and exact point-to-triangle distance to the processed, component-filtered local reference surface. These are finite-sample geometric checks, **not a Hausdorff bound or measurement of error against true anatomy**. The accumulated QEM radius is a separate constraint. Source-level crop collars match the original threshold but are not welded to the decimated whole-heart mesh; full-context views are needed to assess transitions.

## Atrial object masks and repaired wall

The three reviewed atrial selections use serial source contours, a nine-sample source-surface allowance, and a four-sample 3D collar around dense source outside the explicit selected object. Dense source means raw ≥190, sigma 0.5 ≥135, or sigma 0.8 ≥135. Bright material inside a user-selected free object may be included; that bounded exception does not classify all bright or dark material as artifact.

| Selection | Unique additions to v27 | Previously visible traced-core foreground removed |
| --- | ---: | ---: |
| Upper LA/PV complete sheet | 284,073 | 69,271 / 80,239 — 86.33% |
| Appendage complete free sheet | 186,770 | 37,569 / 62,596 — 60.02% |
| Early inlet continuation | 590,239 | 188,458 / 202,025 — 93.28% |

These are source-space reductions inside the selected contours, not whole-chamber cleanup rates. The common builder adds **1,061,082** atrial exclusion samples. The other three object masks retain their exact v27 payloads; their new local surface refinements use separate masks. All inherited atrial bits are retained after reindexing the enlarged texture.

Independent [mask-region validation](../release-v28/mask-region-validation.json) confirms that additions are confined to reviewed footprints and neither object masks nor local low-band masks re-exclude either repaired atrial wall. The **21,809-sample oval repair** and **88,119-sample irregular repair** remain exact. Their 109,928-sample union hash is `ac5d0d8771272e5bb14e0ae8ef13aea171c8abeda24d754e0345e1328aa5fbea`.

## Reversibility and verification

The runtime stages and verifies every patch and matching mask before activation. Replacement requires the pinned Gentle mesh identity/extent, the matching specimen/mode, and the required cleanup switches. Failure or cancellation retains the previous complete surface; partially staged patches remain invisible. Disabling the relevant cleanup restores the original display. Native geometry retains priority. The [local replacement verification](../local-refinement-v28/README.md) documents actual asset decoding, transaction/cancellation tests, picking checks and recorded WebGL draw-state tests; it does not measure real browser performance.

Final evidence is organized as follows:

- [Left independent verification](../cleanup-v28-left/verification.json), [source/object comparison](../cleanup-v28-left/candidate-review/validation.json), and [LVOT source contours](../cleanup-v28-left/patch-review/validation.json).
- [Right asset validation](../cleanup-v28-right/asset-validation.json), serial-source images, source contrast comparisons, and bounded production-shader comparisons under [cleanup-v28-right/](../cleanup-v28-right/).
- [Final combined multi-camera receipt](final-review/validation.json), reporting 11 completed views and no incomplete views; individual receipts and comparison images live in `final-review/<case>/`. The cameras cover LVOT, LA/PV, tricuspid, pulmonary lumen, early inlet, two repaired-wall views, two chamber surveys, RV apex, and exterior.
- [Review-geometry verification](review-geometry-validation.json) checks the conservative offline camera culling against an independent clipping oracle. Source attributes and triangle order are unchanged; recorded pixel-parity claims are limited to the cases explicitly completed in that receipt.
- [Bounded draw parity](stream-parity/validation.json) verifies that streaming consecutive exact triangle batches produces byte-identical LA images for both v27 and v28 compared with the standard draw. The production camera, shaders, source attributes, face order, source cap, framebuffer, and persistent depth buffer remain unchanged.

**Completed combined review:** all 11 views pass exact v27→v28→v27 restoration and identical cleanup-off output checks. The original full-allocation exterior attempt exceeded the shared native-GL memory budget. After the exact bounded-draw method passed LA pixel parity, the exterior review completed with the same production rendering and depth compositing; its [receipt](final-review/survey-exterior/validation.json) records 2,162 changed pixels, unchanged source attributes and triangle order, and both restoration checks passing. This is an offline verification strategy, not a browser-performance claim. Nearby reproducible cameras are used, rather than claiming exact registration to the user screenshots.

Connected fine texture remains, especially near the pulmonary valve. It may contain source noise, preserved material, partial-volume effects, or real structure; brightness and topology alone cannot reliably distinguish them. This revision provides substantial targeted cleanup and better exposure of retained cores, not an artifact-free or clinically validated model.

For the accompanying lighter Atlas palette and source-appropriate plane labels, see the short [release index](../release-v28/README.md). Reproduction commands and individual configuration provenance are in the linked left/right methods; common integration uses `scripts/cleanup-v28/build_masks.py`, `package_surfaces.py`, and `review_all.py`.
