# Native intensity review and bounded successor pilot

**Review date:** 2026-11-06. **Status:** review and prospective experiment specification; the successor pilot has not been implemented or run.

The recovered whole-organ run must retain its existing scientific fingerprint. This note changes no source decoder, filter, threshold, guide, processing plan, runtime configuration, or completed artifact. Finish and verify that run independently. A later intensity experiment requires a separate directory and fingerprint; its results must never be mixed into the current collection. The project contracts are in [AGENTS.md](../../AGENTS.md) and [LOCAL-DEVELOPMENT.md](../../LOCAL-DEVELOPMENT.md).

Local source links below refer to the checkout at `{local-workspace}`. No credentials belong in this document or its checkpoint.

## 1. Stored intensities are useful; their HU calibration is unverified

The source is LADAF-2021-17, `heart/19.85um_complete-organ_bm18/s0`, with dimensions XYZ **7614 × 7614 × 8480**, unsigned 16-bit samples, and **19.85 µm** isotropic spacing. The native reader preserves the decoded integer values; it does not apply an HU rescale. The inspected N5 attributes describe dtype, dimensions, compression, axes and spacing, without an air/water calibration or conversion to physical attenuation. Thus **17,133.4 is a stored-intensity threshold, not an established HU value**. Absence of a conversion in this reader alone would not establish how the upstream values were calibrated; the available metadata also does not establish that calibration. Sources: [source.py](../../scripts/guided-native-v21/source.py), [s0 attributes](../source-s0-attributes.json), [N5 attributes](../source-n5-attributes.json).

The [primary dataset DOI](https://doi.org/10.15151/ESRF-DC-1634390196), identified in the saved [source metadata](../source-metadata.json), describes a HiP-CT acquisition at BM18. The metadata records formalin fixation, transfer into 70% ethanol, mounting in an ethanol/agar medium, and an ethanol reference jar. These are reasons to establish this acquisition's intensity meaning before importing clinical CT tissue ranges. The saved metadata is the evidence inspected here; the DOI landing page could not be retrieved during this review. No claim is made that HU calibration is impossible or that a specific conversion is known.

The useful next interpretation of the user's suggestion is therefore **scan-specific tissue/background intensity evidence**, with uncertainty retained. Seek an upstream calibration/reconstruction description first. Until a verified conversion is available, retain original units and label any fitted score as a model score, not calibrated HU or an anatomical tissue probability. Do not borrow calibration from another donor or the separate clinical CT examples.

## 2. What the current method already does

| Stage | Verified current behavior | Consequence |
| --- | --- | --- |
| Native input | Original uint16 values become float32 without normalization. | Raw intensity information already drives the native refinement. |
| Denoising | 3D Chambolle TV, weight **800 original units**, exactly **16 iterations**, `eps=0`; **16 actual source samples** of halo. | Lossy scalar denoising precedes surface extraction. Weight 800 cannot be transferred unchanged to normalized inputs. |
| Decision | Requested threshold **17133.4**, represented as float32 **17133.400390625**. | One fixed decision boundary is used across regions. |
| Guide | Existing cleaned/windowed **79.4 µm uint8** prior, smoothed with sigma **0.8 coarse voxels**. | This is a display-derived prior, explicitly marked `quantitativeIntensityData: false`. |
| Thin-feature guard | Union of mixed cells from smoothed prior at 0.28, unsmoothed prior at 0.28, and smoothed prior at 0.20. | Enlarges eligible neighborhoods; it is not a guarantee of thin-feature preservation. |
| Blend | Native weight one within the inner **8-voxel / 158.8 µm** band, fading to zero by **12 voxels / 238.2 µm**. | The final scalar field includes prior influence outside the fully native band. |
| Surface | Threshold crossings are encoded with native corner signs and five-bit crossing fractions. | There is no final blanket deletion of small surface components in `refine.py`. |

Sources: [default-config.json](../../scripts/guided-native-v21/default-config.json), [refine.py](../../scripts/guided-native-v21/refine.py), [prior.py](../../scripts/guided-native-v21/prior.py), [prior preparation record](../ultra-volume-v7-preparation.json), and [prior preparation code](../../scripts/prepare-ultra-volume-v7.py). The prior's conversion back to `14640 + prior × (23545−14640)/255` produces raw-like values; it cannot restore information lost through prior windowing, quantization or cleanup.

The **37,612-block plan follows existing guide boundaries**. A feature omitted by every guide mask and outside the band cannot be recovered by a better threshold inside the current plan. Plan completion, intensity segmentation quality and anatomical completeness are separate claims. The production guide is explicitly audited for threshold 17133.4; `refine.py` rejects other thresholds. A threshold sweep belongs in a separate native-field pilot, not in the running guided pipeline.

## 3. What the saved comparisons establish

The existing [denoising report](denoising/README.md) and [measurements](denoising/measurements.json) compare a 108³ native core at XYZ **[4490, 3978, 4618]**, using 40 actual samples of context on every side and the same threshold throughout:

| Method | Triangles | Foreground components | Tissue fraction | Classification changed from raw |
| --- | ---: | ---: | ---: | ---: |
| Raw | 723,491 | 2,100 | 59.221% | — |
| Gaussian sigma 1.5 native voxels | 160,231 | 68 | 59.668% | 9.314% |
| TV800, 16 iterations | 191,251 | 74 | 57.766% | 7.345% |
| TV800, 40 iterations | 181,763 | 39 | 57.841% | 7.512% |

TV16 reduces triangles about **3.78-fold** in this crop. Components here are 26-connected foreground voxel components, including crop-cut components; neither their removal nor a smoother surface proves that the removed material was artifact. The matched [surface figure](denoising/surface-comparison.png) uses common cameras, lighting and normals without mesh smoothing, decimation or component deletion.

The [regional figure](denoising/regional-comparison.png) and measurements show materially different local behavior:

- **Broad boundary, block [27,38,25]:** one selected raw crossing is at 10.329 native voxels, TV16 at 10.278, and Gaussian at 9.855. This is a comparison to one noisy source crossing, not anatomical error.
- **Narrow clefts, [34,30,39]:** thresholded tissue rises from 85.10% raw to 97.00% Gaussian and 90.12% TV16. TV retains more narrow low-intensity clefts than this Gaussian baseline, while still changing their representation.
- **Weak strands, [33,30,24]:** TV16 and TV40 disagree on 2.995% of core voxel classifications. Across 32 regional cores their mean disagreement is 1.171%, reaching 8.201% at [37,42,31]. Stronger smoothing is not uniformly harmless.

These were standalone denoising comparisons **before guide blending**, without independent anatomical labels or repeat-scan ground truth. TV's geometry-dependent behavior is also discussed by [Chambolle, Duval, Peyré and Poon](https://arxiv.org/abs/1602.00087); that paper does not validate this heart segmentation. The method reference is [Chambolle's TV algorithm paper](https://doi.org/10.1023/B:JMIV.0000011325.36760.1e), also cited by the saved report.

The recorded [seam test](denoising/seam-validation.json) found bit-exact shared planes and cores for the tested TV16/halo16 execution. This establishes numerical consistency for that implementation, not anatomical accuracy. Likewise **0.31015625 µm** is the native encoding half-bin bound relative to the processed field's crossing; it excludes acquisition, filtering, threshold, guide and anatomical uncertainties.

## 4. Proposed pilot: isolate the intensity decision

### Scope and frozen inputs

Run only after the recovered production work no longer needs the same constrained resources. Use `{source-cache}/intensity-pilot-v1/<pilot-fingerprint>/`, outside the production run. Process sequentially. Limit the experiment to **eight ROIs**, with no whole-organ census expansion, publication or automatic replacement of existing tiles.

| ROI role | Native core origin XYZ | Core shape ZYX | Context per side |
| --- | --- | --- | --- |
| Calibration/diagnostic: broad boundary | [3496,4904,3240] | [48,48,48] | 40 actual samples |
| Calibration/diagnostic: narrow clefts | [4392,3880,5032] | [48,48,48] | 40 actual samples |
| Calibration/diagnostic: weak strands | [4264,3880,3112] | [48,48,48] | 40 actual samples |
| Regression: existing selected patch | [4490,3978,4618] | [108,108,108] | 40 actual samples |
| Held out: two guide-transition regions | Select and freeze before fitting | [48,48,48] each | 40 actual samples |
| Held out: two suspected guide omissions | Select and freeze before fitting | [48,48,48] each | 40 actual samples |

The first four coordinates come directly from `denoising/measurements.json`. The four held-out coordinates are **not yet selected** and must not be invented. Inspect source sections to choose transition regions and plausible thin structures outside all guide bands; record the native-weight map and why each qualifies. Selection must precede candidate results. If no defensible omission example is found within this bounded search, record that limitation and do not claim improved omission recovery.

Freeze the ROI list, original raw crops, source receipts and review anchors before fitting. Use half-open native sample bounds and state that coordinates are XYZ while arrays are ZYX. Seven 128³ inputs plus one 188³ input contain **42,649,472 bytes of uint16 payload** before container/compression overhead. Preserve these bounded native cutouts rather than the full source cache.

Review tissue/background seed masks in the three calibration ROIs using original orthogonal sections; record reviewer, method, ambiguous exclusions and exact global coordinates. Seeds are provisional intensity references unless independently validated. Keep held-out review masks and protected strand/cleft anchors separate from fitting. No seed or threshold may be tuned after examining held-out candidate performance.

### Fixed candidate definitions

Keep the current **TV800 × 16, eps0** operation and original units fixed. Use real context only. All candidates below operate on the same **unblended native TV field**; show the current guided result and weight map as a separate reference at guide ROIs.

1. **Threshold controls:** `T−200`, `T`, and `T+200`, where `T=float32(17133.4)`. The ±200 span is a predeclared sensitivity test, not a confidence interval or calibration claim.
2. **Likelihood-score candidate:** fit one pair of tissue/background distributions from calibration seeds, using each class's median and `sigma=max(1, 1.4826 × MAD)` in TV-filtered original units. With equal class priors, compute `p = density_tissue / (density_tissue + density_background)` using stable log densities; classify at `p >= 0.5`. Save the fitted parameters and class histograms. This simple Gaussian model is a falsifiable baseline, not an established biological model or calibrated posterior. If class estimates collapse, reverse the expected intensity ordering, or visibly fail to describe seeds, report model failure instead of silently changing the model.
3. **Hysteresis candidate:** 26-connected weak-score components (`p >= 0.5`) are retained when they contain a strong seed (`p >= 0.9`). Save removed weak components separately. Unseeded weak components touching the analysis-domain boundary are **crop-censored/uncertain**, not established background. Retain an uncertainty flag for `0.1 < p < 0.9` regardless of the binary candidate label.

There are five primary variants; no additional filter or component-size sweep is included. The small model and thresholds are proposed engineering choices, not results from the existing study.

### Overlap and connectivity contract

Fit statistics once and freeze them for every ROI and tile; do not estimate a different histogram or threshold in each tile. Do not introduce local adaptive normalization in this first pilot. If later needed, it requires a separately specified global-coordinate estimator and another fingerprint.

The 40-sample raw margin permits a valid analysis domain with 24 samples of context beyond each core after excluding TV's 16-sample dependency margin. Evaluate metrics only on the stated core. Hysteresis connectivity is not bounded by the TV halo: compute it over the whole frozen analysis domain, or merge component equivalences across partitions before deciding seed connectivity. Do not claim that a 16-sample halo alone makes hysteresis tile-invariant.

Split one frozen analysis domain into overlapping partitions and compare with its monolithic result. Require identical shared TV values, model scores and core classifications under the pinned execution; compare connectivity membership rather than arbitrary component IDs. Preserve boundary-censoring flags. Any mismatch blocks consideration for production.

### Acceptance measurements and decision

For every ROI and variant, save tissue fraction, classification disagreement with the TV16/T control, 26-connected component sizes with boundary-touch flags, uncertainty fraction, protected-strand connectivity and protected-cleft openness. Report symmetric surface-distance median, 95th percentile and maximum in native voxels and µm relative to the control where both surfaces exist; report missing surfaces explicitly. These are change measures, not anatomical accuracy.

Predeclare reviewed background and tissue anchors on the held-out source sections. A candidate advances only if it reduces foreground in background anchors without increasing it in another held-out ROI, does not lose tissue anchors or break any protected strand/cleft, and passes the overlap test. If the control has no foreground in background anchors, that endpoint is uninformative. Any broad-boundary 95th-percentile movement above one native voxel triggers rejection from this initial screen; this is a conservative engineering gate, not a validated anatomical tolerance. Record results for all candidates, including failures.

A source-supported feature found outside the guide is evidence to revisit future guide/census coverage, not evidence that this pilot repairs the current plan. Passing this screen justifies a further reviewed experiment. It does not justify a claim of true anatomy, automatic whole-organ rollout, or a change to the running fingerprint.

## 5. Minimum execution and checkpoint contract

The next session must implement a separate pilot driver; this note does not provide a runnable pilot command. Before execution, its input inventory must include:

- `config.json`: the five candidate definitions, fixed TV parameters, precision, connectivity, sensitivity span and acceptance gates above.
- `inputs/roi-plan.json`: eight ROI identities, exact origins/shapes, roles, source bounds, guide status and selection rationale; no unresolved coordinates.
- `inputs/seeds.json` and `inputs/review-anchors.json`: global coordinates/masks, classes, fitting-versus-held-out roles, review status and provenance.
- `inputs/source-ledger.json` plus `inputs/raw/<roi>.npy`: dataset URL/DOI, block coordinates, object generations where available, compressed-source hashes/byte counts, assembled crop hashes, dtype and axis order. All contributing source data must be verified; missing data is a pause, never synthetic padding.
- `provenance.json`: exact code hashes, dependency versions, current production fingerprint used only for reference, prior-manifest hash, source metadata copies and processing identity. Preserve the source/TV implementation; any unavoidable implementation difference must be explicitly validated.

Compute a new SHA-256 pilot fingerprint over canonical JSON containing the configuration, ROI/seed/review-anchor hashes, verified source-ledger hash, code/environment identity and reference-prior identity. Complete acquisition and freeze those inputs before issuing this final identity. No production record can satisfy a pilot completion record.

For each completed ROI, atomically write `results/<roi>/` containing the valid TV field, likelihood score, all five masks, uncertainty/boundary-censoring masks, guide-weight reference, `metrics.json`, and matched raw/TV/score/contour PNGs. Use lossless numeric arrays with explicit dtype, origin and axis metadata. Append a completion record only after verifying every output's byte count and SHA-256. Final outputs are the complete metrics table, overlap comparison, source-overlay contact sheet and `DECISION.md` with pass/fail/inconclusive reasons and unresolved anatomy questions. Avoid large mesh exports unless needed to measure a specific discrepancy.

Create an immutable checkpoint after input freezing, after model fitting, then after **every two completed ROIs or 15 minutes, whichever occurs first**, and at completion or a recoverable failure. Each contains the note, exact driver/source hashes, frozen inputs, fitted model, completed outputs/records, manifest/checksums, last error and the exact resume command actually used. Upload to the project's already authorized Box recovery destination; record the returned file/version identifiers, archive bytes and checksum. Verify the uploaded bytes before calling the checkpoint durable, and retain the previous verified checkpoint until that succeeds. Include no tokens, environment secrets or bulk source cache.

Restore into a **new** pilot directory, verify every checksum and the fingerprint, and skip only complete, matching records. Recompute incomplete ROI work. The existing [checkpoint_bank.py](../../scripts/guided-native-v21/checkpoint_bank.py) restores production surface-run controls and receipts, excluding original intensity payloads; it is not already a pilot checkpoint implementation. The bounded raw cutouts and fitted model above must therefore be included explicitly in the pilot's own recovery bundle.

