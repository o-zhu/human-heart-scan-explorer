# UCL-ZCR-2629 brightness audit

## Finding

The fine data retains most visible tissue texture, but the default display transfers flatten it. The issue is principally display saturation, not acquisition saturation or insufficient Ultra resolution.

On a systematic sample every eighth voxel in X, Y and Z of the retained fine grid, there were 1,580,557 above-threshold tissue voxels. Only **1.04%** reach the encoded uint8 upper limit. The current cut-face palette saturates **57.23%**, and the current orthogonal section palette saturates **72.89%**.

## Source and sampling

- Source specimen: UCL-ZCR-2629, dataset 2298522198.
- Measured source: `{source-cache}/heart-donor-2298522198/s2-source-u16.npy`, shape ZYX 1825 × 1169 × 1154, uint16, source pyramid spacing 28.128 µm.
- Retained browser derivative: `s2-clean-display-u8.npy`, shape ZYX 1825 × 1165 × 1133.
- Encoding window: source 35893–38534, linear uint8, existing scientific source and texture assets unchanged.
- Tissue selection for this audit: retained encoded density > 0.32, identical to the current donor surface threshold.
- Original scalar data and thresholds are not calibrated CT Hounsfield units. Display values should be called normalized intensity or source intensity, not HU.

## Why it happens

The cut-face Tissue & space transfer is `q = clamp((value − 0.48) × 1.8 × 1.12 + 0.58, 0.015, 0.98)`. It clips once source values exceed approximately **37684.69**, below the tissue median of **37727**.

The orthogonal section transfer in `public/section-paint.js` is separate and stronger: `q = clamp((value − 0.38) × 1.8 + 0.55, 0.05, 1)`. It clips above source **37556.83**.

These two different transfers also make identical source slices appear inconsistent across modules. Reducing the cut-face contrast alone leaves the hard-coded orthogonal transfer unchanged.

## Recommended display default

For UCL-ZCR-2629, use an explicit **display-only window of source 36500–38534**, gamma **1.1**, with additional contrast at neutral **1.0**.

In the existing encoded normalized intensity space:

```js
const black = (36500 - 35893) / (38534 - 35893); // 0.229837...
const white = 1;
const display = Math.pow(clamp((density - black) / (white - black), 0, 1), 1.1);
```

Map `display` directly into the existing palette. Do not pass it through the current boosted Tissue & space formula again. Existing final display gamma 0.89 can be preserved; the supplied scientific comparison implements exactly that palette and gamma combination.

Use the same transfer for GPU cut-faces, CPU cut-faces, X/Y/Z images, Echo CT plane images and Probe CT plane images. Keep the Tissue & space palette's original dark/ivory endpoints and existing geometry threshold. A donor display profile should be independent of measured source encoding, geometry threshold, segmentation and acoustic simulation inputs.

A display window slider pair or level/width control plus reset is useful. Only explicitly enabling a display window should replace the old transfer for legacy profiles, if maintaining the adult donor's current appearance is preferred. Carry settings in shared URLs and initialize them per donor; entering Echo must not overwrite them with its hard-coded default contrast 1.8.

## Quantitative evidence

Fine retained tissue source intensity percentiles:

| Percentile | Raw source intensity |
|---|---:|
| 1 | 36772 |
| 5 | 37002 |
| 25 | 37534 |
| 50 | 37727 |
| 75 | 37894 |
| 95 | 38149 |
| 99 | 38545 |

The remaining approximately 1.04% of source-encoded highlight clipping cannot be recovered by a display remap. This is a small tail compared with the >57% lost to display clipping. Regenerating the multi-gigabyte bank is not necessary to fix the reported problem.

Direct source ROIs on Z=1100, with centers and radii in `roi-statistics.json`, show a useful separation between low-intensity cavities and muscular walls:

| Region | Median | 5th–95th range | Current cap flat white | Proposed cap upper clipped |
|---|---:|---:|---:|---:|
| Upper cavity interior | 36354 | 36229–36484 | 0% | 0% |
| Lower cavity interior | 36165 | 36040–36320 | 0% | 0% |
| Upper muscular wall | 37977 | 37693–38194 | 95.46% | 0.078% |
| Lower muscular wall | 37677 | 37448–37862 | 49.21% | 0% |

ROI names describe visible regions, not validated anatomical labels. The larger chamber candidate landmarks in the existing donor preset file partly overlap papillary or wall tissue and should not be used as definitive cavity center ground truth.

## Small compartments

The narrow cavities remain visible in the measured raw transverse and longitudinal planes after brightness is corrected. The display transfer does not explain their physical shape. The audit gives no basis to assert that they should be inflated or to infer a disease state, exact age, or preparation cause. A source comparison should preserve the original physical scale and clearly distinguish source morphology from geometry threshold choice.

**Do not change the 0.32 density threshold to implement windowing.** It corresponds to raw 36738.12 and determines surfaces independently of the display transfer. Do not apply display gamma to cleanup masks, region labels, ray intersection density, acceleration-grid maxima, threshold comparisons, ultrasound attenuation or acoustic gradient inputs. Windowing should change color alone.

## Integration inventory

- `public/render-styles.js`: `capColor`; common CPU display transfer can live here.
- `public/renderer.js`: GLSL `capShade`, final display gamma and cut-face composite shader. Add window parameters as uniforms, preserve original density for thresholding.
- `public/section-paint.js`: currently an independent hard-coded grayscale transfer; update its LUT to use the same display window.
- `public/echo.js`: `paintEchoPreview`, default state contrast 1.8, `apply` plane sets contrast, contrast slider, persisted state.
- `public/probe-lab.js`: CT LUT and anatomy tint base call `capColor`; ensure revised display parameters are passed to both.
- `public/cpu-worker.js`: capColor call, where settings are available. Leave `tri()` densities unchanged.
- `public/cpu-renderer.js`: defaults match GPU settings; settings travel to worker.
- `public/app.js`: source manifest display profile application, controls and hash restore validation.
- `public/appearance.js`: section repaint cache/revision must respond to window changes.
- `public/section-detail.js`: loading/sampling can remain unchanged.

## Files

- `window-comparison.png`: full-fine X, Y and Z comparison: current section, current cap, contrast-only 0.9, recommended window.
- `histogram-transfer.png`: quantitative tissue histogram and transfer curves.
- `z1100-new.png`: full-size transverse plane with the recommended transfer.
- `z1100-rois.png`: ROI audit overlay.
- `histograms.json`, `roi-statistics.json`: numerical measurements.
- `analyze_windowing.py`: reproduces comparison and histogram figures.

The source-data audit did not modify any source volume or texture bank. Its resulting display-only implementation is checked by `tests/windowing-v10.mjs` and `scripts/render-windowing-v10.py`; see `gpu-validation.json` and `production-window-comparison.png`.
