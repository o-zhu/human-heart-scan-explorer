# Native 19.85 µm surface study

This study reconstructs a **128 × 128 × 128 sample region of LADAF-2021-17 at its actual 19.85 µm source spacing**. Its sample-center span is **2.52095 × 2.52095 × 2.52095 mm**. It is a targeted reconstruction, with retained internal and external threshold interfaces, not a complete-heart reconstruction. The original source values are preserved separately from the surface experiments.

The companion source-selector fix addresses the reported cMAC/SlicerHeart failure. The HOA page populated its dropdown from `ALL_SOURCES` but validated selections against the HOA-only `DONORS` list, silently rejecting clinical IDs. `public/app.js` now uses `ALL_SOURCES` for that guard. The actual-DOM regression in `tests/clinical-ui-v19.mjs` failed before the fix and passes for HOA → cMAC, HOA → SlicerHeart, and both clinical sources → HOA. It also checks cancellation of old loads, preservation of unrelated query parameters, and removal of stale view hashes.

## Source and physical coordinates

| Item | Recorded value |
| --- | --- |
| Dataset | [ESRF Human Organ Atlas, LADAF-2021-17](https://human-organ-atlas.esrf.fr/datasets/1659197537) |
| DOI and credit | [10.15151/ESRF-DC-1634390196](https://doi.org/10.15151/ESRF-DC-1634390196); Brunet et al. / ESRF Human Organ Atlas; CC BY 4.0 |
| Native source | `19.85um_complete-organ_bm18/s0`, `uint16`, 7,614 × 7,614 × 8,480 samples |
| Selected N5 block | `(35, 31, 36)` in X, Y, Z |
| Native ROI origin | `(4480, 3968, 4608)` in X, Y, Z |
| ROI half-open bounds | `[4480, 4608) × [3968, 4096) × [4608, 4736)` |
| Native scalar threshold | `17133.4 = 14640 + 0.28 × (23545 − 14640)` |
| Coarse comparison | Actual `s4` source samples at 317.6 µm, factor 16; clipped to the same nominal region |

The source N5 blocks have a big-endian header and big-endian `uint16` samples after **Blosc/Zstd** decompression. The recorded compressor metadata is Zstd level 9 with Blosc shuffle mode 2 (bit shuffle). Acquisition converts byte order without changing values, then saves every Z slice as independently gzip-compressed **little-endian uint16**, in ZYX array order. Encoded and decoded SHA-256 checks and a full byte round trip cover all 128 retained slices. No resampling, intensity quantization, support mask, or denoising is applied to this source cache. See [source-provenance.json](source-provenance.json) and [source-selection.json](source-selection.json).

The native crop has exact original `s0` integer indices. The separate `s4` comparison uses factor-16 index scaling and an assumed zero center translation; the existing whole-heart viewer uses endpoint-aligned scale indices. A subvoxel center offset between these coordinate conventions has **not** been independently established. The coarse comparison is therefore a sampling comparison, not a validated subvoxel registration. No valve, chordal, or chamber identity is asserted for the morphology-selected patch.

## Extraction and surface-only storage

Extraction uses eight blocks of at most 64 cells per axis. Each cell belongs to one block; neighboring blocks share endpoint samples. Standard marching-cubes cases interpolate the original values at the fixed threshold. Integer identities of the source-grid edges join shared vertices exactly, without a spatial merge tolerance or movement. Crop faces remain open; there is no zero padding outside the crop, capping, component removal, hole filling, or triangle decimation.

The 2,048,383 cells include 639,524 crossing cells. After joining 9,058 shared-edge aliases, the reference has **665,302 vertices and 1,288,570 triangles**. The recorded topology contains 8,658 connected components, zero nonmanifold edges, and zero zero-area triangles. Small noise-dependent components are retained. See [geometry-extraction.json](geometry-extraction.json), [geometry-weld.json](geometry-weld.json), and [geometry-normals.json](geometry-normals.json).

| Representation | Exact stored bytes | Meaning |
| --- | ---: | --- |
| Selected raw uint16 samples | 4,194,304 | Full 128³ crop, before compression |
| Original selected N5 block | 3,429,508 | Original source codec and header retained |
| 128 independently lossless gzip slices | 3,788,654 | **1.107×** raw-to-compressed ratio |
| Initial surface-cell checkpoint | 7,796,529 | Repeated eight corner values per crossing cell; inefficient |
| Deduplicated surface checkpoint | **2,417,135** | NSB1/Zstd; masks plus once-per-block contributing samples |

The improved checkpoint replaces 5,116,192 repeated corner-value instances with 1,178,340 contributing sample instances. Samples shared between neighboring blocks can still occur in both blocks. Its decoded representation is 2,881,321 bytes, versus 12,790,480 bytes for the initial checkpoint. It is 3.226× smaller than that initial compressed checkpoint, and 1.567× smaller than the compressed full-slice cache. Every crossing cell's original eight values is reconstructed exactly. See [geometry-surface-band.json](geometry-surface-band.json).

This reduction applies to the **specified threshold**. Full lossless slices remain necessary for changing the threshold, reading gradient neighborhoods, or independently rerunning extraction. Empty-looking scan regions contain nonzero, noisy measurements, so raw compression cannot be assumed to behave like compression of a mostly zero binary mask. Four candidate blocks were inspected during selection, totaling 13,551,614 encoded bytes; the selected crop uses one of them.

## Treatments and measured changes

The native page initially compares the 317.6 µm overview with **native smooth lighting**. Both selectors can choose any available treatment, with linked camera, lighting, and section controls.

| Treatment | Operation | Connectivity relative to native | Measured change |
| --- | --- | --- | --- |
| Native reference | Fixed-threshold extraction from original uint16 samples | Reference | No scalar blur or decimation |
| Smooth lighting, default | Gradient-derived normals; Gaussian σ = 0.5 voxel for the shading field only | Identical vertices and indices; positions identical | **0 µm geometry displacement** |
| Gentle geometry | Windowed-sinc, 10 iterations, passband 0.3 | Same vertex count and triangle indices | Maximum **4.962019 µm**, below the 4.9625 µm quarter-voxel limit |
| Moderate geometry | Windowed-sinc, 20 iterations, passband 0.2 | Same vertex count and triangle indices | Maximum **9.924515 µm**, below the 9.925 µm half-voxel limit |
| Bilateral experiment | Filter a derived scalar field before extraction; spatial σ = 0.65 voxel, intensity σ = 600 raw units, radius 2 voxels | **Changes topology**; 533,438 vertices, 1,026,542 triangles | Sampled raw-to-filtered p95 **12.016 µm**, maximum **116.119 µm** |

All four primary native candidates retain the same 1,288,570 triangle connections. Geometry smoothing pins crop/boundary vertices, disables boundary/feature-edge/nonmanifold smoothing, limits movement relative to the original reference, and restores vertices implicated in degenerate or flipped faces. An additional crop-bound check restores vertices that would overshoot the measured ROI: 459 for gentle and 584 for moderate. The corrected reports show all vertices inside the ROI, unchanged boundary coordinates, and zero degenerate or flipped/over-90-degree triangles. These checks do not certify absence of self-intersection or preservation of every thin anatomical structure. See [geometry-gentle.json](geometry-gentle.json) and [geometry-moderate.json](geometry-moderate.json).

The bilateral comparison preserves the original source cache but changes derived intensities and connectivity; it is **not the default**. A two-voxel raw boundary band preserves crop edges and may introduce a local filtering transition. Surface-distance statistics use 20,000 deterministic area-weighted triangle samples in each direction, not an exhaustive Hausdorff bound. Filtered-to-raw p95 is 3.936 µm and maximum sampled distance is 11.316 µm; the larger reverse distances show that filtering can erase weak structures or noise-scale components. It cannot support a claim of detail-preserving anatomical denoising. See [geometry-bilateral.json](geometry-bilateral.json).

Mesh files retain triangle connectivity and use float32 positions for the native treatments because the more compact uint16 encoding collapsed some tiny faces. Normals use signed 16-bit encoding. Gzip is lossless **after** mesh encoding; it does not make the preceding coordinate/normal encoding lossless. The final six compressed meshes total 68,525,067 bytes. Current per-asset sizes, encoding error, and hashes belong in [the generated manifest](../../public/assets/native-surface-v20/manifest.json) and [release-asset-verification.json](release-asset-verification.json), rather than duplicated hashes in this document. [geometry-validation.json](geometry-validation.json) and the independent [source-integrity-audit.json](source-integrity-audit.json) verify all six meshes, the eight deduplicated checkpoints, zero unexpected interior boundary edges, retained native connectivity, encoded bounds, and zero encoded face collapses or flips.

## Memory and validation scope

Acquisition assembled at most a 4 MiB raw slab for this crop. Reconstruction stages run in separate processes so temporary NumPy/VTK allocations are returned to the OS. The final reports record process peak RSS of 151.48 MiB for surface-band deduplication, 239.36 MiB for welding, 358.91 MiB for normals, about 245.95 MiB for geometry smoothing, and **400.762 MiB for the bilateral stage**. Scientific rendering recorded 389.59 MiB. These are individual-process observations for this crop and environment, not aggregate memory, browser/GPU memory measurements, or a general upper bound. In particular, the resumable extraction report can describe a cache-reuse run, and separate audits/probes can use more memory.

The complete source would require 983,222,012,160 raw bytes before any mesh or processing overhead. This experiment demonstrates a bounded targeted workflow; it has not established the feasibility or runtime of a complete-organ native reconstruction.

The browser loader permits one active fetch/decode across both panes, terminates obsolete work, checks compressed and decoded integrity, and keeps the displayed surface until its replacement is ready. A failed replacement restores the selector to the displayed method; returning to an already displayed method clears pending state. The storage helper limits each object to 32 MiB, validates a finite indexed file set, retries at most four times, and verifies all hosted object hashes. Publication and hosted QA are recorded separately.

Local tests cover real DOM selection transitions with a WebGL stub, source transitions, mesh parsing, cancellation, decoder startup failure, and immutable storage behavior. [geometry-render.json](geometry-render.json) records actual mesh renders using surfaceless EGL/llvmpipe. These renders and DOM tests **do not constitute interactive browser or device-performance verification**. The surfaces are fixed-intensity experimental boundaries, not anatomical segmentations, and have not received expert anatomical validation.

## Reproduce

Run from the repository root. The recorded environment uses Python 3.12.14, NumPy 2.3.5, SciPy 1.17.0, scikit-image 0.26.0, VTK 9.3.1, Blosc2 4.14.1, Zstandard 0.25.0, and Pillow 13.0.0. Rendering additionally requires Mesa/EGL (`libEGL.so.1`); it does not require an X server.

```bash
python scripts/native-surface-v20/acquire.py \
  --data-root {source-cache}/native-surface-v20 \
  --origin 4480 3968 4608 --shape 128 128 128 \
  --workers 1 --max-download-mib 32 \
  --docs-path docs/native-surface-v20/source-provenance.json

python scripts/native-surface-v20/reconstruct.py \
  --stage all --block-cells 64 \
  --work {source-cache}/native-surface-v20 \
  --source {source-cache}/native-surface-v20/source-ready.json \
  --overview-source {source-cache}/native-surface-v20/overview-source.json

python scripts/native-surface-v20/validate.py
python scripts/prepare-native-hosting-v20.py --write-index
node scripts/verify-native-release-v20.mjs
node --test tests/native-viewer-v20.mjs
node tests/native-ui-v20.mjs {source-cache}/heart-ui-test-v11/node_modules/linkedom/esm/index.js
node tests/clinical-ui-v19.mjs {source-cache}/heart-ui-test-v11/node_modules/linkedom/esm/index.js
node --test tests/clinical-v19.mjs
```

`--stage all` runs self-test, extraction, surface-band deduplication, welding, normals, both geometry treatments, bilateral, optional overview, packaging, and scientific rendering in separate processes. Stages can be repeated individually with the same `--work`, `--source`, and `--block-cells 64` arguments. The self-test checks blockwise versus monolithic extraction and compares counts with VTK Flying Edges. Release verification checks generated hashes, bounds, mesh encoding, normals-only position equality, and native-candidate connectivity.

The study reused `{source-cache}/anatomy-v12/source-s4.npy` for its actual coarser source. `overview-source.json` contains `npyPath`, `nativeDownsampleFactor: 16`, and `originXYZ: [0, 0, 0]`. If that cache is unavailable, `python scripts/download-n5.py --cache {source-cache}/native-surface-v20/overview-cache --workers 2` retrieves the independent s4 volume; point `npyPath` at the resulting `s4-volume-u16.npy` and retain the registration caveat above. Supply that descriptor before `--stage all` to include the required overview asset in the hosted collection. The paths for raw caches and the installed LinkeDOM entry point are environment-specific and should be adjusted when reproducing elsewhere.

For hosting, use `scripts/upload-native-v20.py` with Site access JSON supplied through its hidden stdin prompt. `--probe` performs only the existing manifest connectivity GET. Seeding requires both the explicit `nativeSurfaceUploadsEnabled` code gate and the temporary collection-specific runtime secret. Final releases set the code gate to **false**, remove the secret and redeploy. `--verify-read-only` requires complete inventory, every indexed GET checksum, `uploadsEnabled: false`, and PUT rejection with HTTP 405 even when the previous valid secret is supplied. Never put service credentials in command arguments, checked-in files, or this report.

The hosted release audit caught that removing the runtime secret alone still allowed an idempotent PUT of an already-existing immutable object (HTTP 204). No stored bytes changed. The final code gate is independent of whether the platform retains that secret; a regression supplies the valid secret with the gate closed and requires HTTP 405. The production verification must repeat that check after deployment.
