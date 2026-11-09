# Donor-specific cut-face brightness

The cut-face brightness setting changes display color only. It does not re-encode
source volumes or fine images, change the acquisition window, move a clipping
plane, change the tissue threshold or alter chamber labels. The lit 3D surface
continues to use the existing lighting and surface-color transfer.

## Defaults and measured effect

| Donor | Cut-face brightness | Median tissue luminance before → after | Mean tissue luminance before → after |
| --- | ---: | ---: | ---: |
| LADAF-2021-17 | 1.15 | 188.49 → 194.41 | 177.20 → 182.02 |
| S-20-29 | 1.80 | 120.28 → 153.49 | 121.11 → 150.58 |
| S-20-28 | 1.80 | 124.21 → 157.42 | 122.35 → 151.33 |

Luminance is measured on a 0–255 display scale with the Tissue & space palette.
For each donor, the analysis uses every above-threshold pixel from two prepared
fine CT planes: `lv-inflow` and `rv-outflow` for LADAF-2021-17; `rv-inflow` and
`rv-outflow` for the comparison donors. The comparison donors' file identifiers
are compatibility keys; these are geometric views, without assigned chamber
identities. The sample comprises 1,561,542, 1,629,336 and 1,559,810 tissue pixels,
respectively. Exact input paths and SHA-256 values are in `validation.json`.

The original donor receives a small midtone lift. The two comparison donors
receive a larger lift. The three profiles introduce **no all-white tissue
pixels** in these samples. Black background and thresholded empty-space pixels
remain zero. The before/after images use identical measured image bytes,
geometry, source window, threshold and camera position.

## Transfer and integration

The setting `cutFaceExposure` defaults to 1 and accepts values from 0.5 through 3.
It maps windowed intensity `x` to `e*x/(1+(e-1)*x)`. This is strictly increasing
through the interior of the display range and fixes the black and white
endpoints. It brightens midtones with a gradual highlight shoulder rather than
adding a constant or creating a new clipped intensity band. The pre-existing
window or palette can already have clamped values; display brightness cannot
recover distinctions previously removed by those upstream transfers.

The same function applies before palette and anatomy mixing in the shared JS
cut-face transfer and in both production WebGL programs. Software rendering,
Echo CT and Probe CT use the shared function. Orthogonal sections apply it in
both the legacy original-donor transfer and the windowed comparison-donor
transfer. The original orthogonal base transfer is retained, so those legacy
grayscale sections are not claimed to be color-identical to an illuminated 3D
cap. Exposure 1 preserves the legacy scalar/palette mapping exactly.

Anatomy cap highlights additionally use a hue-preserving RGB shoulder. Above a
peak channel value of 0.94, all channels are scaled together to a smooth,
bounded peak, retaining the label's channel ratios. This avoids pre-existing
out-of-gamut tinted highlights becoming clipped after the intensity lift. The
shoulder is specific to CT cap coloring; it does not change surface lighting,
the segmentation array, the legend colors or simulated ultrasound frames.

The root integration sets defaults from the donor profile, with current donor
values taking precedence over older stored manifest display values. Changing
the setting invalidates appearance-dependent CT colors; source-image cache
keys and downloaded bytes remain the same. No image download or decoding is
required merely to change brightness.

## Reproduction and evidence

Run from the project root:

```sh
node --test tests/brightness-v12.mjs tests/windowing-v10.mjs
python tests/brightness-v12-render.py
```

The Node run passes 13 checks, including:

- Identity transfer, monotonic intensity ordering and preserved endpoints.
- Preserved source bytes, black backgrounds and tissue thresholds.
- Agreement among windowed orthogonal, Echo and Probe CT pixels.
- Unchanged simulated ultrasound frame bytes.
- Registered, unchanged anatomy labels and selection behavior.
- Hue preservation and bounded anatomy cap highlights.
- Actual software-raycaster cap agreement with the common transfer.

The native EGL run compiles the current production volume and composite shaders
plus a cap-transfer fixture. It compares **27,648 intensity cases** across all
six palettes, three donor profiles, two exposure settings, all six anatomy
colors, and global/selected-label display. Every tested output channel agrees
exactly with the shared JS output on the recorded llvmpipe driver. The test
accepts a maximum one-byte difference to account for other native float/UNORM
rounding implementations. The six anatomy highlight colors remain below hard
8-bit channel clipping.

The same native renderer loads the current high-detail donor volumes and fine
prepared cut faces, verifies their published hashes, and renders the paired
images in `production-caps-before-after.png`. The independent fine CT plane
comparison is `measured-sections-before-after.png`. Both comparison sheets were
visually inspected: the lift exposes darker wall texture without changing the
empty-space silhouettes or removing the bright fine structures.

This is native shader and source-data validation. It does not claim browser
layout testing, clinical validation or a measurement of end-user GPU speed.
