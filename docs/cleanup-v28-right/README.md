# v28 right-sided source-guided surface refinement

The selected candidates replace two bounded portions of the LADAF-2021-17 display surface with locally extracted source surfaces. The tricuspid view exposes substantially clearer continuous chordal cores. The pulmonary valve/lumen view loses much of its coarse, jagged peripheral material. Connected fine texture remains, particularly around the pulmonary valve; this work does not establish an artifact-free or clinically validated anatomical segmentation.

## Why the previous masks missed the visible material

Production GPU coordinate readback located the material actually shown in the user's latest screenshots. Much of it lay outside the earlier, conservatively guarded polygons. In the tricuspid Y263 view, sampled visible fragments were around fine X625–788, Y726–974, Z1077–1240; the prior small tricuspid selection was primarily X829–935. In the pulmonary X194 view, sampled jagged material was around X644–750, Y1161–1305, Z814–938, while the previous PA selection was primarily X780–926.

The production position maps and full-context images used for localization are under `docs/cleanup-v28/locate-right/`, with float readbacks retained in `{source-cache}/cleanup-v28/locate/`. The X313 object is a separate, earlier atrial/pulmonary-vein inlet continuation; that work belongs to the left-side selections, not the pulmonary patch documented here.

Serial source sections show bright, continuous cores within lower-intensity surrounding material. Merely shrinking the previous dense-source exclusion guard would cut holes through the old low-threshold mesh without reconstructing the exposed core. This version extracts a new surface from the locally adjusted scalar field instead.

## Source and interpretation

The source is the immutable **79.4 µm mapped uint8 display bank**, identified by `public/assets/ultra-volume-v7.json` and SHA-256 `e50ab70a52373dc774cf6077ef906a753e56b78b9f9b646fba2ffe7220ff338c`. The exact authoritative hash is also recorded in each policy file. These values are not calibrated Hounsfield units. The chosen contrast levels are therefore expressed in mapped source units, not HU or biological tissue classes.

The builder verifies each decoded source brick. It reads bounded regions with a three-sample collar, applies a Gaussian with sigma 0.5 fine samples and truncate 3, and retains hashes for both the original and padded source regions. It never rewrites the source bank, 2D CT pixels, original Gentle mesh, native 19.85 µm bank, or prior v27 masks.

This is additional local processing of the 79.4 µm source. It adds no native acquisition resolution and does not replace the independently available 19.85 µm regions.

## Selected method

The original surface level is 71.4 mapped units, corresponding to the original normalized threshold 0.28. Inside serially reviewed polygons, the local level rises smoothly to **120**. Polygon signed-distance fields are interpolated between source slices. Cubic smoothstep collars return the threshold to 71.4 at polygon borders, at the selected slice-axis endpoints, and at all faces of the crop box.

| Region | Fine XYZ lower bound | Exclusive upper bound | Polygon axis | Polygon collar | Box collar | End collar |
|---|---|---|---|---:|---:|---:|
| Tricuspid | `[600,660,1020]` | `[870,1040,1350]` | Y | 10 samples | 8 samples | 12 samples |
| Pulmonary valve/lumen | `[604,1080,540]` | `[790,1360,972]` | X | 12 samples | 8 samples | 12 samples |

These two boxes do not overlap one another, the LVOT patch, or either v27 atrial-wall restoration footprint. The unchanged collar is a source-level match, not a topological weld to the already decimated whole-heart mesh. Full-context review is still needed for processing transitions at those boundaries.

The threshold stage retains every sample with sigma-0.5 source intensity at least 135. Original raw display samples at least 190 that were foreground at the baseline level also remain foreground through an explicit threshold clamp. These statements apply to thresholding; a separate inherited display filter for small detached components follows.

| Threshold-stage measurement | Tricuspid | Pulmonary valve/lumen |
|---|---:|---:|
| Baseline foreground samples in box | 5,553,483 | 7,927,474 |
| Lower-band samples excluded | 769,532 | 970,563 |
| Sigma-0.5 samples ≥135 retained | 2,416,416 | 4,336,605 |
| Such bright samples lost | 0 | 0 |
| Raw ≥190 samples lost from baseline foreground | 0 | 0 |
| Box-boundary samples with a changed threshold | 0 | 0 |

The exact lower-band difference is stored as an X-packed, little-bit-order ZYX mask. It is intended for matching density/cap/picking behavior. It must not fragment-clip the replacement surface itself: that surface was already extracted at the new local threshold. Runtime activates the patch replacement and matching low-band mask together, with ordinary v27 and new explicit selections still applied consistently. Disabling the relevant cleanup restores the original display.

### Detached components and geometry reduction

Remeshing also reconstructs tiny detached components already omitted by the established Gentle display cleanup. The same inherited criteria are applied to complete local components: baseline compact components with bounding-box diagonal ≤0.85 mm, ≤1,024 faces and regularized PCA spread <3; the established perivalvular scope permits ≤1.5 mm, ≤2,048 faces and PCA spread <4.5. Every component reaching a patch face is protected because its external connectivity is unknown. The largest component is protected. Long thin components are protected by the shape criterion. The broader arterial 4 mm rule is not generalized to these patches.

This removes 23,081 complete compact tricuspid components / 445,524 faces and 27,542 pulmonary components / 448,762 faces before simplification. Counts refer to the adaptive source mesh, not to the whole-heart mesh. It does not assert a biological identity for those components.

The selected QEM reduction uses the existing pinned constrained reducer with a **0.3176 mm accumulated original-vertex radius limit**, half the existing Gentle limit. Open boundaries remain frozen; interior link and tetrahedron constraints preserve local connectivity. The tighter 0.1588 mm candidate was also built and reviewed. The selected limit improves the visual consistency with the surrounding Gentle mesh and halves the payload while preserving the observed continuous chordal cores and passing the measured error gates. Positions receive no additional geometric smoothing.

| Delivered mesh | Tricuspid | Pulmonary valve/lumen |
|---|---:|---:|
| Vertices | 154,271 | 242,338 |
| Triangles | 302,706 | 535,534 |
| Gzip bytes | 3,210,789 | 5,324,033 |
| GPU attribute/index bytes | 5,483,724 | 9,334,464 |
| Source → delivered distance, 95th percentile | 0.04134 mm | 0.04475 mm |
| Delivered → source distance, 95th percentile | 0.03166 mm | 0.03530 mm |
| Maximum sampled source → delivered distance | 0.17139 mm | 0.16763 mm |
| Maximum sampled delivered → source distance | 0.08371 mm | 0.08969 mm |

The distance measurements use 12,000 area-weighted samples in each direction and exact point-to-triangle distance. They are relative to the processed, component-filtered local reference surface, not the unknown true anatomy. Finite samples do not establish a Hausdorff bound. The original-vertex radius is a separate conservative reducer constraint. Quantization, zero-area-face removal, orphan compaction and normal fallback counts are recorded in the policy files.

## Evidence and limitations

- `source/actual-tricuspid-serial.jpg` and `source/actual-pa-serial.jpg` show serial measured-source sections at the production-localized coordinates.
- `source/tricuspid-contrast-review.jpg` and `source/pulmonary-contrast-review.jpg` compare unchanged source, baseline contours and selected contours. The excluded intensity band is marked red.
- `render/tricuspid-comparison.jpg` and `render/pulmonary-comparison.jpg` compare the original v27 Gentle display with the selected patch using the actual production GLSL and identical camera/cap data.
- `render/*-validation.json` records exact off/on/off pixel reversibility, triangle counts, production shader hash and unchanged cap hash for the bounded review fixture.
- `asset-validation.json` independently verifies transport/decoded hashes, packed-mask tail bits, logical mask counts, unchanged crop faces, valid indices, unit normals and separation from the atrial repairs.
- `ablation/t120-r4/` records the selected four-sample-radius ablation. The earlier two-sample-radius candidates are reproducible; their temporary comparison copies remain outside the checkout.

The bounded renders keep the original source cap fixed to isolate the surface change. They do not test the runtime's newly integrated cap and density exclusions, browser performance, native replacement priority, or seams in the entire heart; the parent integration supplies those checks. Rectangular bounded-review cutoffs are fixture crop edges, not newly inserted walls. Connected texture remains visible and may represent a mixture of source noise, preserved material, partial-volume effects and real structure. Brightness or topology alone cannot reliably classify it.

## Reproduction and runtime files

Run from the repository root with the verified source bank available:

```sh
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python scripts/cleanup-v28-right/adaptive_patch.py scripts/cleanup-v28-right/tricuspid-config.json --output docs/cleanup-v28-right/patch
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python scripts/cleanup-v28-right/compact_patch.py docs/cleanup-v28-right/patch/tricuspid-core-surface-policy.json --radius-mm .3176
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python scripts/cleanup-v28-right/adaptive_patch.py scripts/cleanup-v28-right/pulmonary-config.json --output docs/cleanup-v28-right/patch
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python scripts/cleanup-v28-right/compact_patch.py docs/cleanup-v28-right/patch/pulmonary-valve-lumen-surface-policy.json --radius-mm .3176
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python scripts/cleanup-v28-right/verify_assets.py
```

`extract_roi.py` creates bounded review inputs from the verified original Gentle mesh. With those temporary inputs present, `render_patch.py tricuspid` and `render_patch.py pulmonary` reproduce the selected before/after comparisons. `source_contrast_review.py` reproduces the source comparison sheets. Heavy QEM runs share a process lock to avoid overlapping reducer memory peaks.

Runtime needs only the two HFM1 gzip meshes, two packed low-band masks and their manifest/policy metadata. Dense SFR1 meshes are reproducible analysis references, not runtime payloads. Source arrays and original banks remain the authority and remain available for comparison.
