# Native-volume denoising comparison

**Decision:** use three-dimensional Chambolle total-variation filtering at weight **800 original intensity units**, **16 fixed iterations**, and **`eps=0`**, with a **16-sample halo of actual native data**. This is a practical lossy refinement setting for the existing coarse-guided pipeline. It substantially suppresses threshold noise while retaining more narrow clefts than the tested Gaussian baseline. It does not establish anatomical accuracy or preserve every small feature.

The measured evidence is a native 108³ fold-rich patch with real neighboring data, plus the central 48³ samples of 32 source blocks spread across the organ. The figures below use the source intensities and measured filtered fields. No generative imagery, upsampling, surface beautification, or fabricated detail is involved.

## What was compared

The source is `LADAF-2021-17/heart/19.85um_complete-organ_bm18/s0`, with 19.85 µm isotropic sample spacing. N5 blocks are decoded as their original unsigned 16-bit intensities and cast directly to float32. There is no intensity normalization before filtering.

| Variant | Definition | Context required for these comparisons |
| --- | --- | --- |
| Raw | Unfiltered original intensity field | None |
| Gaussian 1.5 | Three-dimensional Gaussian, σ = 1.5 native voxels (29.775 µm), finite radius 6 | 6 samples per side |
| TV 800 × 16 | Chambolle TV, weight 800, `max_num_iter=16`, `eps=0`, `channel_axis=None` | 16 samples per side |
| TV 800 × 40 | Same TV weight, 40 fixed iterations | 40 samples per side |

All measurements use the same threshold, requested as **17,133.4**, represented internally as float32 **17,133.400390625**. All displayed intensities use the same window, **14,640–23,545**, with the corresponding threshold contour overlaid. The reported TV weight therefore applies to these original intensity units; it must not be reused unchanged after scaling the input to [0,1].

Chambolle's method balances intensity fidelity against image total variation. Larger weight produces more smoothing, and the result can favor piecewise-constant regions. The fixed iteration count here deliberately limits computation and local dependency; it is not a claim that the optimization has converged. See [the implementation documentation](https://scikit-image.org/docs/0.26.x/api/skimage.restoration.html#skimage.restoration.denoise_tv_chambolle) and [Chambolle's original paper](https://doi.org/10.1023/B:JMIV.0000011325.36760.1e). The Gaussian baseline uses SciPy's explicit finite-radius kernel, described in its [official documentation](https://docs.scipy.org/doc/scipy/reference/generated/scipy.ndimage.gaussian_filter.html).

## Selected fold-rich patch

The measured native core starts at **XYZ [4490, 3978, 4618]** and contains **108³ samples**. Filtering is performed on an **188³ source region**, giving 40 actual samples on every side. The source reader assembles that region from 27 cached native blocks. A 108-sample image spans 2.124 mm between its first and last sample centers.

| Method | Extracted triangles | Above-threshold components | Tissue fraction | Classification changed from raw |
| --- | ---: | ---: | ---: | ---: |
| Raw | 723,491 | 2,100 | 59.221% | — |
| Gaussian 1.5 | 160,231 | 68 | 59.668% | 9.314% |
| **TV 800 × 16** | **191,251** | **74** | **57.766%** | **7.345%** |
| TV 800 × 40 | 181,763 | 39 | 57.841% | 7.512% |

These are [directly computed measurements](measurements.json), not estimates from screenshots. Components are 26-connected foreground voxel components inside the crop, including components cut by the crop boundary. They are not disconnected triangle components and should not be compared directly with earlier mesh-component counts.

TV16 reduces triangles **3.78-fold** and foreground components **96.48%** relative to raw in this patch. Its thresholded tissue fraction is **1.455 percentage points lower**. Gaussian1.5 gives fewer triangles, but the comparison shows that fewer triangles alone does not identify the better anatomical representation.

![Three orthogonal native sections, comparing raw, Gaussian 1.5, TV 800 × 16, and TV 800 × 40.](selected-region.png)

**Visual reading.** The broad curved tissue sheet and adjacent cavity-like low-density spaces remain recognizable in all variants. The raw threshold traces many small fluctuations within the low-density spaces. Both denoisers remove most of those contours. TV retains sharper transitions and several narrow low-density clefts within the tissue sheet that are reduced or closed by the Gaussian filter. These observations describe image morphology; the structures have not been independently labeled by an anatomist.

Moving from 16 to 40 TV iterations reduces triangles by a further **4.96%** in this selected patch. Only **0.239%** of core voxels change threshold classification between those two runs. Their intensity difference has RMS **63.97** original units, with maximum **298.79**. Those small aggregate differences should not be treated as a bound on local surface displacement.

### Matched three-dimensional surfaces

![Actual extracted surfaces with a common camera, lighting, crop, and normal calculation, shown as a complete crop and with an identical open section.](surface-comparison.png)

These are **scientific EGL renderings, not browser screenshots**. They use the same 108³ core and the same 188³ original-data context as the numerical comparison. The meshes match all four reported triangle counts exactly. There is no mesh smoothing, decimation, or component deletion. Every surface uses the same area-weighted incident-face normal calculation, camera, lights, material, and physical crop; the second row applies the common section plane at **native Z = 4672**, with no artificial cap. Labels report complete-crop triangle counts before the display section is applied.

The three-dimensional views make the raw field's many small disconnected surfaces apparent. Gaussian1.5 gives the smoothest appearance here; the TV variants retain more fine surface irregularities and small openings. The figure does not distinguish every real detail from residual noise, so the original intensity sections remain essential for interpreting those differences.

[surface-render-record.json](surface-render-record.json) records the 27 original source-block checksums, processed-core hashes, exact geometry and normal hashes, rendering-code hash, camera and light parameters, clipping plane, driver, and final image checksum. Filtering and rendering run in separate sequential processes; the measured peak was **475.58 MiB** during filtering and **302.00 MiB** for the largest render. The full PNG is 1,437,606 bytes. The separately identified website derivative is 1800 × 1038 WebP, 187,778 bytes; it changes only image presentation, not the geometry or source measurements.

To reproduce the scientific figure from cached inputs:

```bash
python docs/guided-native-v21/denoising/render_surfaces.py
```

## Variation across 32 native regions

Each of the 32 pre-existing regional pilot blocks contributes its central **48³** samples. Its remaining 40 samples per side provide genuine context for the longest filter. This removes artificial block-edge effects from the measured core without downloading new source data. The combined measured volume is 3,538,944 voxels. These locations are spatially spread pilot samples, not a random or anatomy-balanced organ survey.

| Method | Total triangles | Sum of per-core components | Mean tissue fraction | Cores with no extracted surface |
| --- | ---: | ---: | ---: | ---: |
| Raw | 2,301,576 | 14,076 | 40.385% | 0 / 32 |
| Gaussian 1.5 | 466,711 | 196 | 39.127% | 7 / 32 |
| **TV 800 × 16** | **570,575** | **251** | **37.322%** | **6 / 32** |
| TV 800 × 40 | 470,164 | 204 | 37.040% | 7 / 32 |

TV16 reduces total triangle count **4.03-fold** and the sum of components **98.22%**. It changes the raw threshold classification of **9.332%** of sampled voxels. Some originally noisy cores have no threshold crossing after filtering. That outcome is consistent with suppressing low-density speckle, but it is not proof that every removed component was noise.

The following three regions were selected from the pilot contact sheet to show a broad boundary, narrow branching clefts, and weak strand-like features. They illustrate distinct behavior; they do not replace the complete per-block results in [measurements.json](measurements.json).

![Comparison of three distinct native regions using a common intensity window and threshold.](regional-comparison.png)

### Broad tissue / low-density boundary: block [27, 38, 25]

All three filters suppress disconnected contours away from the broad interface. Raw has **271** foreground components in the measured core; each filtered version has **one**. TV16 and TV40 both produce **8,596 triangles**, with only **0.0072%** of core voxel classifications differing between them. This is a case in which the shorter run already captures the principal thresholded boundary.

![A common line through a broad native boundary, with raw and filtered intensity profiles.](boundary-profile.png)

The profile is taken at local **z=24, y=24** of the same 48³ core. Each trace has one threshold crossing along the displayed line. Crossing positions, measured in native voxels from the first profile sample, are **10.329 raw, 9.855 Gaussian, 10.278 TV16, and 10.286 TV40**. The TV16 crossing is 0.051 voxel from the raw crossing; Gaussian is 0.474 voxel away. The one-edge intensity rise at that crossing is approximately **1,573 units for TV16** and **670 for Gaussian**, showing a sharper TV transition on this line. These are comparisons to a noisy source crossing at one location, **not anatomical error estimates** or general displacement guarantees.

### Branching narrow clefts: block [34, 30, 39]

The Gaussian filter fills much of the narrow below-threshold structure: thresholded tissue rises from **85.10% raw** to **97.00%**, leaving **9,702 triangles**. TV16 leaves **90.12% tissue** and **29,700 triangles**. The figure shows multiple long narrow clefts that remain visible in TV16 and TV40 but are shortened, disconnected, or absent in the Gaussian threshold contour.

This example is the clearest empirical reason to favor TV16 over Gaussian1.5 for the default. It demonstrates retention of more source-supported narrow features, while also showing that TV changes them: its tissue fraction still rises about five percentage points relative to raw. Neither result proves the true width or connectivity of any individual cleft.

### Weak strand-like features: block [33, 30, 24]

Raw has **152,460 triangles**; Gaussian, TV16, and TV40 have **42,423**, **46,687**, and **39,467**, respectively. The additional TV iterations remove more small threshold islands and alter some weak connections. TV16 and TV40 disagree in **2.995%** of this core's voxel classifications, far more than at the broad interface. Across all 32 cores, their mean disagreement is **1.171%**, reaching **8.201%** in block [37, 42, 31]. Their total triangle counts differ by **17.60%** across these regional cores, compared with 4.96% in the original selected patch. Accordingly, the 40-iteration result is a stronger regularization comparison, not a reference segmentation.

## Why the production default uses 16 fixed iterations

The selected setting gives a useful balance: large reductions in noisy components, sharper interfaces than the Gaussian baseline, more retained narrow clefts, and a manageable source halo. It also avoids spending additional iterations on regions where the main boundary is already stable.

For the 32 full 128³ input blocks, serial filtering took a total **11.02 seconds for TV16**, **26.74 seconds for TV40**, and **1.55 seconds for Gaussian** in this run. Other pipeline work was active concurrently, so these figures are descriptive and should not be extrapolated as a controlled throughput benchmark. The true-halo 188³ selected input took **2.28 seconds for TV16** and **4.25 seconds for TV40**.

With `eps=0`, the installed implementation never takes its positive-tolerance energy stopping branch on finite data. Every tile runs the same number of local updates. Root's separate real-data comparison reports **bit-exact shared planes**, **bit-exact left and right tile cores against the monolithic result**, and **maximum shared-plane difference 0.0**, using TV16 and halo16. The recorded result is preserved in [seam-validation.json](seam-validation.json). This validates the tested numerical execution; it does not make the lossy filtered field anatomically exact.

The production path requires actual original samples throughout the filter dependency of every location receiving nonzero native weight. A missing source block must be fetched or reported; substituting reflected, zero-filled, or coarse-prior values in the contributing halo would invalidate the native-data comparison. Numerical results also depend on the implementation's float32 operation order. An alternative accelerator must repeat the seam and reference comparisons before claiming bit identity.

## Relationship to the coarse guide and stored surface

These figures and tables compare **denoising alone**, before the production guide is blended in. The chosen production code in [refine.py](../../../scripts/guided-native-v21/refine.py) combines the TV field with the existing coarse field using a smooth spatial weight. Native weight is one within the inner guide band (8 native voxels, 158.8 µm), then declines to zero by the outer band (12 voxels, 238.2 µm). Band distance is computed from coarse mixed-cell corners and interpolated onto the native grid; it is not an exact distance to a triangulated anatomical surface. The guide includes mixed cells from the smoothed coarse field, the unsmoothed coarse field, and a lower-threshold guard intended to retain more thin-feature neighborhoods.

This confines detailed refinement to a neighborhood supported by the prior and reduces the effect of distant threshold speckle. It cannot recover a feature omitted by every guide mask and lying outside the band. The guide's resolution, intensity window, registration, and blend can all alter the final surface. Therefore these standalone TV results are evidence for the filter choice, **not a validation of the complete blended whole-organ result**. Final whole-organ coverage, guide-transition continuity, and uploaded artifact verification remain separate pipeline checks.

The stored native edge encoding uses five-bit crossing fractions. Its half-bin bound is **1/64 native voxel = 0.31015625 µm**, relative to the processed scalar field's interpolated edge crossing. This is a numerical encoding bound. It does not include uncertainty from the source acquisition, threshold, filtering, prior registration, or anatomical interpretation. The original 19.85 µm sample spacing likewise does not establish 19.85 µm anatomical accuracy.

## Limits and reproducibility

This evaluation supports the chosen practical setting, with the following limits:

- **No anatomical ground truth.** There are no manual reference surfaces, repeated scans, or independent labels in this comparison. No claim of 0.5–1 voxel anatomical accuracy is justified.
- **Loss is explicit.** Every filtered variant changes the scalar field, thresholded volume, and some small features. TV's edge preference does not provide a topology guarantee. Its known tendency toward piecewise-constant regions and geometry-dependent artifacts is discussed in [Chambolle, Duval, Peyré, and Poon](https://arxiv.org/abs/1602.00087).
- **Component count is only a proxy.** Suppressing thousands of small components is useful here, but a real isolated strand or small cavity could also disappear. Components intersecting a crop are not global components.
- **One fixed threshold.** This comparison evaluates the configured threshold, not the optimal tissue segmentation threshold for every location. Tissue fraction is the fraction above that threshold, not a verified anatomical tissue volume.
- **Denoising does not deliver 100-fold triangle reduction.** The measured default produces roughly fourfold reduction. Compact encoding, regional streaming, and separately identified display levels are still needed for interactive whole-organ use.
- **Connectivity methods differ.** This report uses scikit-image's Lewiner marching cubes with `allow_degenerate=False`. The compact native bank uses classic marching-cubes case connectivity, so exact triangle counts can differ between the report and stored tiles.

Run from the repository root:

```bash
python docs/guided-native-v21/denoising/compare.py \
  --data-root {source-cache}/guided-native-v21 \
  --legacy-cache {source-cache}/native-surface-v20/chunks-s0
```

The script reads cached N5 blocks and writes only these report figures and measurements. It processes regions sequentially and retains no new full-volume intermediate. `measurements.json` records every source block's byte length and SHA-256, measured coordinates, software versions, filter definitions, per-region metrics, and exact line-profile values. The initial parameter sweep is preserved as [exploratory-pilot.json](exploratory-pilot.json); that earlier experiment used only a 10-sample crop margin, so the 40-sample-context measurements in this report supersede it for boundary-independent comparisons.

The full scientific figure assets total approximately **2.7 MiB**. This document records the filter decision and observed results; the primary code remains in the production pipeline, with no duplicate filtering implementation installed by this report.
