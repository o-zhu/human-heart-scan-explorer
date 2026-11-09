# Independent review of two retained tricuspid threshold islands

## Decision

Retain both islands and the existing dense-source guard. This bounded follow-up
did not establish an additional safely separable object for cleanup. No source
array, production mask, geometry, guard, or selection was changed.

The three-sample island is embedded in a continuing curved, ribbon-like
foreground path across adjacent source planes. The six-sample island is a short
foreground extension next to larger dense material. Its identity remains
ambiguous. These descriptions are observations of the display-source raster,
not a diagnosis or validated identification of chordae or other tissue.

## What was examined

The two targets were `[855,839,1157]` and `[873,881,1231]`, in original full-grid
XYZ sample coordinates. The source is the existing, immutable 79.4 µm
display-encoded bank. Arrays are ZYX. The bounded source read was
`[788,807,1053]` through exclusive `[960,978,1299]`; 60 stored and decoded bricks
passed their manifest hashes. The source manifest SHA-256 is recorded in the
JSON receipt.

The existing dense rule is the union of raw display value at least 190,
sigma0.5 Gaussian value at least 135, and sigma0.8 Gaussian value at least 135.
Both filters use truncate3. The foreground used for source-support review is
sigma0.5 at least 71.4. The production guard is ten fine samples from any dense
source sample. The tiny island counts refer to 26-connected components of the
**dense rule**, not independently separated objects in the foreground or mesh.

| Measurement | Island A | Island B |
|---|---:|---:|
| Dense component samples | 3 | 6 |
| Mean-coordinate rounded center, XYZ | `[858,840,1153]` | `[872,883,1230]` |
| Raw display range of island samples | 153–182 | 153–186 |
| Sigma0.5 range | 135.49–145.15 | 136.10–156.68 |
| Sigma0.8 range | 108.28–114.22 | 108.92–121.01 |
| Target distance to this or another dense sample | 4.90 samples | 1.73 samples |
| Target distance to other dense samples if this island is omitted | 7.55 samples | 4.00 samples |
| Target distance to dense components of at least 128 samples | 9.00 samples | 6.71 samples |

The 128-sample grouping is a review diagnostic to distinguish these small
threshold peaks from nearby larger dense structures. It is not a proposed new
cleanup rule.

## Connectivity and serial source evidence

Each island remains face-connected (six-neighbor connectivity) to larger dense
material at sigma0.5 thresholds 71.4, 80, 90 and 100 within its 49³ local crop.
At threshold 100, those components contain 8,353 and 11,517 local samples,
respectively, and reach multiple crop faces. Thus their connection is not solely
a diagonal contact at the existing surface threshold. Island A disconnects
under six-neighbor connectivity at threshold 110 but still connects using
26 neighbors; island B disconnects at 110 under either convention. These
threshold observations characterize the local source support; they do not
validate anatomical identity.

The two serial-source figures each show five adjacent planes in all three axes.
Grayscale is the source display value on a fixed 0–220 range; cyan contours show
sigma0.5>=71.4, orange the current dense rule, and magenta the selected small
threshold component. Only figures and review metadata are written.

- `island-a-serial-source.jpg`
- `island-b-serial-source.jpg`

## Limited counterfactual

For each island separately, the diagnostic temporarily omitted just that
island from a local **in-memory** dense rule and recalculated the existing
fringe selection. It did not save or install a production mask. Every other
dense source sample, the ten-sample guard distance, reviewed envelope,
source-support rule and connected-region rule were retained.

| Counterfactual result | Island A omitted | Island B omitted |
|---|---:|---:|
| Additional selected fine-grid samples | 1,095 | 109 |
| Additional v26 first-surface pixel positions excluded | 26 | 4 |
| Of those, original mesh component 7 | 26 | 4 |
| Current retained pixel positions within 15 fine samples of target | 176 | 787 |

Both named target coordinates remain protected by **other** dense source
samples even in this counterfactual. The islands' halos therefore are not the
sole reason those targets remain visible. The small possible change does not
establish a cleanly separated anatomical object or support weakening the guard.

Pixel counts use the existing production v26 first-visible-surface coordinate
readback sampled against the candidate v27 mask. They are not a new v27 render
and do not include deeper surfaces exposed by exclusion. The original visible
component ID is a geometry identifier, not a tissue label.

## Reproduction and checks

Run from the repository root with the verified fine bank and local review
coordinate/selection inputs present:

```sh
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python3 docs/cleanup-v27-review/review_tricuspid_islands.py
```

`tricuspid-island-review.json` includes input hashes, source receipt, every
island sample and its values, thresholds/connectivity results, and the
counterfactual counts. The diagnostic independently reconstructs the current
tricuspid operation in a single padded source volume and asserts exact equality
with the saved 24-Y-slice selection: zero differing samples. It checks that the
counterfactual cannot remove any previously selected sample.

The reproduction requires two preparation artifacts outside the portable
viewer: `{source-cache}/cleanup-v27/tricuspid-chordal-fringe-selection.npz` and
`{source-cache}/cleanup-v27-wall/tricuspid-222-v26-locations.npz`. The code and
compact evidence are retained here; these inputs remain reproducible from the
source-selection and production-coordinate review tools.

This review uses display-encoded samples, not original quantitative acquisition
intensities. Foreground continuity and serial appearance support conservative
retention; they do not establish tissue, clot or artifact identity.
