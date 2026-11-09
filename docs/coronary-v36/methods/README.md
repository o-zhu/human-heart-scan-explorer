# Coronary Reveal: Source Experiments And Prepared Fields

## Outcome

The selected display field combines a higher exterior tissue threshold with
soft protection of the existing source-guided atrial regions. It exposes more
of the ventricular surface branches while avoiding the marked loss of thin
upper-wall tissue produced by a global threshold increase. A small 3-D scalar
regularization reduces local roughness. The original scalar source, CT cards,
prepared original surface, and source registration remain available unchanged.

The method is an intensity-based visualization. It is not a coronary artery
segmentation, a fat label, a calibrated Hounsfield-unit map, or an increase in
acquired source resolution. The LA/RA annotations used for protection are
approximate regional source annotations, not expert ground truth.

## Actual Source And Chosen Thresholds

| Donor | Original Display Grid | Spacing | Original Scalar Threshold | Reveal Threshold Outside Protected Regions | Original uint16 Window |
| --- | --- | --- | --- | --- | --- |
| LADAF-2021-17 | 475 × 475 × 530 | 317.6 µm | 0.32 | 0.42 | 14640–23545 |
| S-20-29 | 478 × 478 × 487 | 318.24 µm | 0.1621621622 | 0.22 | 19300–23000 |
| S-20-28 | 477 × 477 × 509 | 317.6 µm | 0.3297297297 | 0.42 | 14938–22708 |

These thresholds operate on each donor's windowed uint8 display values. They
are not equivalent physical attenuation values across donors. The LADAF
original prepared 79.4 µm mesh uses its own 0.28 construction isovalue; the
baseline in these controlled scalar comparisons is the original resident
scalar threshold of 0.32, not that mesh.

## Experiments

`compare.py` rendered the current production GLSL in native EGL using
hash-verified measured source volumes, the original reviewed cleanup atlas,
the same camera and output dimensions. It examined:

- LADAF thresholds 0.28, 0.32, 0.36, 0.38, 0.40, 0.44, and 0.48.
- S-20-29 thresholds from 0.162 through 0.36, including 0.20, 0.22, and 0.24.
- S-20-28 thresholds from 0.330 through 0.52, including 0.40, 0.42, and 0.44.
- Gaussian scalar smoothing, sigma 0.5 source samples.
- A self-guided 3-D local linear scalar filter, radius 1 and epsilon 12² in
  uint8 display-level units.
- Fixed-iteration Chambolle TV, weight 6, 12 iterations.
- A soft regional threshold using the existing LA/RA labels, with raw,
  guided, and TV scalar variants.

Increasing the global threshold exposes more branching surface structures,
but also erodes thin source-supported upper-wall tissue. This becomes obvious
in the LADAF comparison above about 0.38, in S-20-29 around 0.24 and higher,
and in S-20-28 around 0.40 and higher. These are visual tradeoff observations,
not quantitatively validated anatomical optima.

Gaussian and TV smoothing reduce roughness but soften visible small surface
detail. None of these scalar filters alone restores tissue excluded by an
excessive global threshold. The regional policy retains that observed tissue
at its original threshold and uses the higher threshold elsewhere. The guided
filter was selected as the conservative scalar regularizer and its output was
further bounded to the original source ±6 display levels.

An unqualified union of high-to-low threshold masks is exactly the lowest
threshold mask: the masks are nested. A globally connected low-threshold
hysteresis flood also cannot separate contiguous covering tissue from
myocardium merely because both connect to a bright seed. Consequently this
implementation does not call brightness or threshold persistence anatomical
confidence and does not apply unbounded region growth or inferred gap filling.

## Exact Selected Rule

1. Load the original high-level scalar field and verify every compressed and
   decoded source part hash.
2. Apply the 3-D self-guided local linear filter, box radius 1, epsilon 144,
   nearest border extension. Compute local mean and variance, then locally
   average the linear coefficients. Bound the scalar change to ±6 levels.
3. Read and verify the original donor-specific LA/RA annotation bytes (labels
   3 and 4). Compute Euclidean physical distance from these label cells.
4. The protection weight is 1 within 0.5 mm, then falls by cubic smoothstep to
   0 at 3 mm. Endpoint-registered trilinear resampling places that weight on
   the unchanged source grid.
5. Blend regularization back to the exact original scalar value as protection
   approaches 1. Fully protected atrial samples therefore retain their
   original measured values.
6. Blend the local threshold from the original scalar threshold at protection
   1 to the donor-specific reveal threshold at protection 0.
7. Encode `round(clamp(regularizedSource - 255*localThreshold + 127.5, 0, 255))`.
   Render this derived field at threshold 0.5. Its values are a shifted display
   field, not measured intensities. The maximum encoding error is 0.5 display
   levels, except saturation far away from the surface zero level.

The selected rule cannot add foreground at a sample more than six original
display levels below its local threshold, nor remove a sample six levels above
it. These are sample-center support guarantees, not a statement that every
displayed branch is a coronary artery. Continuous interpolation includes the
documented 0.5-level encoding bound. Fully protected atrial foreground at its
original threshold is retained exactly at sample centers.

The smooth transition avoids a hard label-boundary seam. It also preserves
some atrial covering tissue, so this is deliberately not a complete removal
of every low-intensity surface tissue or a complete exposure of proximal
coronary anatomy.

## Measured Validation

| Check | LADAF-2021-17 | S-20-29 | S-20-28 |
| --- | ---: | ---: | ---: |
| Foreground samples in derived display field | 7,459,727 | 8,866,050 | 8,368,277 |
| Selected samples without weak original support | 0 | 0 | 0 |
| Strong source samples retained | 7,048,511 | 8,205,088 | 7,700,842 |
| Strong source samples lost | 0 | 0 | 0 |
| Protected baseline atrial samples retained | 1,819,327 / 1,819,327 | 1,447,261 / 1,447,261 | 1,184,680 / 1,184,680 |
| Maximum scalar modification | 6 levels | 6 levels | 6 levels |
| Original source hash unchanged | Yes | Yes | Yes |
| Compressed display-field bytes | 12,765,338 | 10,363,701 | 13,076,919 |

See `prepared-field-validation.json` for complete hashes, source support
counts, and exact part round trips. `public/assets/coronary-v36/manifest.json`
contains all source, annotation, transform, grid, predictor, and file hashes.
The 25 independent gzip Z-slab parts total 36,205,958 bytes. The largest part
is 2,591,288 bytes, below the 4 MiB object ceiling. Each part restarts its
delta-Z predictor; decoded parts concatenate in increasing `zRange` order.

## Final Visual Evidence

`render_final.py` reads those exact prepared artifacts and renders them through
the current production `coronaryTexture` path while retaining the original
source texture. Front and rear views of all three donors use matching cameras
and 1200 × 1200 output grids. The four columns compare original baseline,
global higher threshold, prepared regional reveal with cubic normals, and
the identical prepared geometry with the existing softer Gaussian normals.

The softer normals further reduce visible ribbing but also reduce some small
surface contrast. They do not move the derived isosurface or remove its
branches. The reveal mode's normal preference is separate from the original
view's preference so returning to the original view restores that appearance.

Useful files:

- `final/*-front-comparison.jpg` and `final/*-rear-comparison.jpg`.
- `final/*-upper-wall-detail.png`: fixed upper-wall source crops.
- `final/*-surface-branches-detail.png`: fixed ventricular exterior crops;
  screen position is not an anatomical label.
- `final/native-final-report.json`: production shader hash and source checks.
- `../reveal-comparison.jpg`: 1200-pixel response image, 369,990 bytes, showing
  original baseline, global higher threshold and selected reveal, with
  native-pixel upper-wall detail below.

Native EGL output checks are not a Safari runtime test, a browser performance
measurement, expert anatomical validation, or a claim of additional acquired
resolution. Cut-face invariance and user interface integration are checked
separately by the main implementation.

## Bounded Fine-Source Experiment

`fine_roi.py` examines an actual 79.4 µm LADAF source ROI around the previously
reviewed right-perivascular region, without assembling a fine whole-heart
volume. It compares matching physical bounds in the 317.6 µm original source
and existing immutable 79.4 µm display bank, then a bounded guided-filter fine
variant, at thresholds 0.32 and 0.42. Brick compressed and decoded hashes are
verified before use. The fine ROI is source data, not AI-generated anatomy or
an upsampled coarse field.

See `fine-roi/fine-source-comparison.jpg` and `fine-source-report.json` for the
precise ROI, camera, sampling and brick receipt. Finer sampling resolves much
more surface texture and smaller source structures, and shows that a future
fine reconstruction is a separate source-processing task. This bounded test
does not install or claim a new complete 79.4 µm coronary mesh.

The existing fine whole-heart pipeline works in slabs with constrained
reduction and frozen seam contours. A new regional-threshold whole-heart
surface needs its own provenance fingerprint, complete preprocessing, seam
and small-branch review, and substantially more working storage. It must not
reuse an old completed mesh checkpoint under a changed scalar policy.

## Reproduction

```bash
python3 scripts/coronary-v36/compare.py --donor ladaf-2021-17 --thresholds .28,.32,.36,.40,.44,.48 --methods raw --size 960
python3 scripts/coronary-v36/compare.py --donor ladaf-2021-17 --thresholds .40,.44 --methods raw,protect-raw,protect-guided12,protect-tv6 --size 1200
python3 scripts/coronary-v36/prepare.py
python3 scripts/coronary-v36/render_final.py
python3 scripts/coronary-v36/fine_roi.py
```

The final preparation uses stricter source-change bounds and exact protected
atrial preservation than the initial filter exploration. The prepared manifest
and final render hashes, not the exploratory candidates, identify the shipped
display field.
