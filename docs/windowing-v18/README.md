# Display window exploration · v18

## Recommendation

Offer two **optional** donor-specific presets. **Strong contrast** most closely
matches the user's preference for bright tissue with crisp internal separations.
**Balanced detail** retains a broader range of tissue tones for inspection of
subtle intensity differences. Neither is a universally optimal or clinically
validated display. Keep the existing defaults as **Original** and preserve
existing custom values until the user selects a preset.

Use the existing **Tissue / space** palette, Ultra source, brightness **3.00**,
and cut-face contrast **1.00** for both presets. These are display changes only.

| Donor | Preset | Black point shown | White point shown | Gamma | Normalized endpoints |
| --- | --- | ---: | ---: | ---: | --- |
| LADAF-2021-17 | Balanced detail | 17,098 | 22,503 | 0.90 | 0.276–0.883 |
| LADAF-2021-17 | Strong contrast | 17,703 | 21,648 | 1.05 | 0.344–0.787 |
| S-20-29 | Balanced detail | 19,600 | 21,901 | 0.90 | 0.081–0.703 |
| S-20-29 | Strong contrast | 19,899 | 21,402 | 0.90 | 0.162–0.568 |
| S-20-28 | Balanced detail | 16,904 | 21,947 | 0.90 | 0.253–0.902 |
| S-20-28 | Strong contrast | 17,502 | 20,851 | 1.00 | 0.330–0.761 |

Endpoints are rounded to the current normalized slider's 0.001 increments.
`candidate-profiles.json` contains the exact settings. Gamma 0.80, 0.85, 0.90,
1.00 and 1.05 were compared visually at the wider Balanced windows. Gamma 0.90
was selected to brighten their midtones while avoiding the more washed
appearance of 0.80/0.85 in the reviewed wall crops. Strong remains visibly
crisper; Balanced's purpose is broader tonal retention, not maximum local
contrast.

## What the screenshot revealed

The screenshot establishes brightness **3.00**, black **17,454**, white
**21,176**, and gamma **1.10**. Cut-face contrast is not visible. The screenshot
reference therefore **assumes** the existing LADAF contrast of **1.80** and
includes a separate sensitivity reference at **1.00**. The analysis does not
claim to have recovered the user's hidden setting.

The custom-window transfer is:

```
t = clamp((encodedIntensity - low) / (high - low), 0, 1)
v = clamp((t^gamma - 0.5) * contrast + 0.5, 0, 1)
v = brightness * v / (1 + (brightness - 1) * v)
```

Brightness is already a smooth shoulder: raising it to 3 does **not** introduce
an additional hard clipping threshold. Increasing contrast after windowing does.
At contrast 1.8, the screenshot's effective unclipped interval is approximately
**18,402–20,416**, substantially narrower than its displayed 17,454–21,176
window. At contrast 1, the specified black/white points are the effective
endpoints. This explains why changing window, gamma, exposure and contrast
together matters.

The transfer then applies the existing palette and final output gamma 0.89.
The metrics below describe the **head-on 3D cut face**. Production 3D cut faces
also have a viewing-angle factor from 0.91 to 1 before output gamma; this
changes brightness slightly but does not change which source intensities have
already collapsed to a transfer plateau. Custom-window CT cards use the same
color transfer. Original unwindowed LADAF CT cards retain a historical distinct
mapping, so Original comparisons here explicitly use the **3D cap** transfer.

## Measured display behavior

The following figures pool fixed-visible source pixels across the sampled
planes. A plateau means multiple source codes receive the same transfer
endpoint, including legacy ivory-valued endpoints that are not pure white.
“Displayed tones” counts distinct RGB triplets from the occupied prepared source
codes. It does not measure anatomical accuracy, perceived resolution, or the
full continuous output that interpolation can produce.

| Donor / display | Dark plateau | Bright plateau | Distinct displayed tones |
| --- | ---: | ---: | ---: |
| LADAF Original | 0.00% | 15.92% | 92 |
| LADAF screenshot reference, **assuming contrast 1.8** | 16.79% | 21.86% | 60 |
| LADAF same screenshot settings, contrast 1.0 | 0.00% | 7.64% | 107 |
| LADAF Balanced detail | 0.00% | 1.04% | 137 |
| LADAF Strong contrast | 4.44% | 3.80% | 115 |
| S-20-29 Original | 0.00% | 1.54% | 117 |
| S-20-29 Balanced detail | 0.00% | 0.86% | 135 |
| S-20-29 Strong contrast | 0.00% | 2.42% | 104 |
| S-20-28 Original | 0.00% | 1.58% | 130 |
| S-20-28 Balanced detail | 0.00% | 0.92% | 137 |
| S-20-28 Strong contrast | 0.00% | 3.08% | 110 |

Strong intentionally trades some tonal retention for the user's preferred
separation. In the S donors it retains fewer distinct tones than Original while
increasing the measured local source-pair contrast; that is a display
preference, not an information gain. In LADAF it restores many tones relative
to both the screenshot reference and the legacy 3D cap while retaining a crisp
appearance. Selecting Balanced does not make the underlying source higher
resolution.

## Scope and reproducibility

Run `python scripts/window-sweep-v18.py` from the project root. It changes only
this experiment's documents and figures. It does not change source assets,
segmentation, tissue thresholds, geometry, spatial sampling, or runtime state.

- **47 measured Ultra planes:** 17 LADAF, 15 S-20-29 and 15 S-20-28. For each
  donor, the initial nine planes span X/Y/Z at fractional positions 0.36, 0.50
  and 0.64. Six additional checks use 0.43 and 0.57 in all three axes. LADAF also
  includes Y section 276 and Z section 202 matching the visible screenshot
  section numbers. The extra planes are **additional checks**, not an
  independent validation set: aggregate metrics were inspected while tuning.
- The source WebP checksum **and decoded display-pixel checksum** are verified
  against every selected manifest entry before analysis. Each donor's existing
  fixed tissue threshold defines the visible-pixel mask. The pooled masks
  contain 25,893,287 sampled pixels; planes intersect, so these are not
  independent biological observations or unbiased whole-volume statistics.
- Source images are the existing losslessly compressed **8-bit prepared Ultra
  sections**, at about **79.4–79.56 μm** sampling. Reported raw-domain values
  are mapped through their recorded encoding window; the experiment does not
  recover the original 16-bit scan intensities or detail discarded before the
  prepared images were made. The highest prepared source code accounts for
  approximately 0.31%, 0.20% and 0.37% of visible pixels in LADAF, S-20-29 and
  S-20-28 respectively; its within-code variation cannot be recovered here.
- Figures show three context planes and identical 224-pixel interior crops per
  donor. Crop selection finds dense source tissue with internal intensity
  variation. It only chooses a location; no sharpening, smoothing, denoising,
  synthetic fibers, or replacement pixels are applied. The large context
  images are scaled for presentation; the small crops keep native source
  pixel scale.
- Local contrast is assessed with a fixed histogram of source pairs three
  pixels apart, within an eroded visible mask, whose original differences are
  2–16 codes. This reduces domination by empty-space edges, but both texture
  and noise may contribute. It is **not a validated fidelity metric** and was
  not used to assert that anatomy became more accurate.

### Bounded parameter exploration

The script also evaluates **810 nearby combinations per donor (2,430 total)**
without repeatedly decoding or resizing images. It reuses source histograms
and source-pair histograms. Around both selected window ranges, it varies
normalized black and white endpoints by −0.02, 0 and +0.02; gamma over 0.85,
0.90, 1.00, 1.05 and 1.10; brightness over 2.50, 2.75 and 3.00; and contrast
over 1.00, 1.20 and 1.80. Source-pixel and additional-plane figures are saved
for every candidate.

The stored nondominated frontier compares fewer endpoint plateaus, more
displayed tones and stronger local source-pair differences. It is a tradeoff
description, **not a single optimum**. It deliberately does not reduce these
quantities to a score: lower brightness or stronger noise can otherwise win a
numeric objective while producing a less useful image. Final choices use
the measured tradeoffs plus side-by-side source-pixel review and the user's
stated preference for bright, distinct tissue.

For example, on the nine initial LADAF planes, raising contrast from 1.0 to
1.8 at the Balanced window increases total plateau pixels from 0.89% to
19.67% and reduces tones from 137 to 90. At the Strong window, it increases
plateau pixels from 8.17% to 35.05% and reduces tones from 115 to 64. Similar
tradeoffs occur in both S donors. This supports contrast 1.0 with an explicit
window rather than stacking a hidden second aggressive contrast transform.

## Files

- `candidate-profiles.json`: exact final profiles, including Original and
  both screenshot sensitivity references for LADAF.
- `candidate-analysis.json`: selected-plane provenance, fixed masks,
  per-plane and pooled statistics, and crop coordinates.
- `sensitivity-sweep.json`: the complete bounded parameter grid, contrast
  sensitivity series and nondominated tradeoff indices.
- `*-candidate-comparison.jpg`: Original, reference(s), Balanced and Strong
  source comparisons for X/Y/Z.
- `gamma-candidates.json`, `*-gamma-comparison.jpg`, `*-gamma-crops.jpg`:
  reproducible gamma comparisons, including native-size interior crops.

Native CPU/GLSL parity and actual 3D renderer checks are a separate companion
audit. These contact sheets alone do not validate every oblique face or every
GPU. All conclusions are limited to display behavior on the existing source.
