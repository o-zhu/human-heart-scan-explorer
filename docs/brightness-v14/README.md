# v14 donor brightness and shared CT window controls

The cut-face display gain is now **1.35 for LADAF-2021-17** and **2.70 for
S-20-29 / S-20-28**, up from 1.15 and 1.80 respectively. The existing soft
shoulder raises midtones while retaining the transfer's black and white
endpoints. The acquired data, encoded display bytes, source windows, calibrated
window endpoints/gamma, thresholds, geometry and segmentation are unchanged.

The bottom **Settings** panel remains collapsed on entry. Its first section is
**Slice brightness & windowing**, with brightness, black point, white point and
midtone gamma available directly. Editing a window slider enables that window;
the sliders are usable even when the window is switched off. The panel shows
the selected donor, scan-intensity values and a **Reset donor window** button.
Reset restores both that donor's calibrated window and its new brightness gain.

This same CT display section is available below reconstruction, Echo windows and
Probe Lab. Reconstruction-only controls are hidden in the other modules so a
window adjustment does not accidentally alter the probe's clipping plane.
CT appearance is shared; modeled ultrasound gain remains separate.

## Verification

`tests/brightness-v14.mjs` exercises the actual AppearanceController with a DOM
fixture. It verifies control placement, unique IDs, direct slider access,
automatic window enabling, positive window width, physical intensity labels,
donor-specific resets and unchanged geometry/thresholds. All **3 tests pass**.
The existing `brightness-v12.mjs` and `windowing-v10.mjs` suites also pass
**13 tests**, including CT transfer agreement between sections, Echo, Probe and
the software raycaster, and unchanged simulated ultrasound pixels.

The native EGL harness compiles the production volume and cap-composite GLSL
programs, compares every input byte for six palettes, and checks colored
anatomy highlights with and without selected-label emphasis. **27,648
intensity/color comparisons match the shared JavaScript transfer exactly**
(maximum channel difference 0 in this run).

Statistics below include every above-threshold pixel from all eight
source-hash-verified fine preset textures for each donor. Luminance is measured
from the output RGB transfer on a 0–255 scale. These are display comparisons,
not changes to the source CT values.

| Donor | Fine pixels assessed | Gain before → after | Mean luminance before → after | Median before → after |
|---|---:|---:|---:|---:|
| LADAF-2021-17 | 4,651,169 | 1.15 → 1.35 | 169.86 → 175.79 | 179.56 → 186.70 |
| S-20-29 | 5,349,537 | 1.80 → 2.70 | 149.11 → 168.45 | 153.49 → 174.56 |
| S-20-28 | 5,062,711 | 1.80 → 2.70 | 150.80 → 170.05 | 157.42 → 177.56 |

No assessed tissue pixel becomes pure white. Empty regions and source threshold
tests are unchanged. `validation.json` records per-source SHA-256 hashes, exact
statistics, all shader comparisons and the rendered source revision hash.

The before/after figures were inspected:

- `production-caps-before-after.png`: production GLSL cut faces and measured
  surface volumes, with identical camera/plane/source bytes in each pair.
- `measured-sections-before-after.png`: measured fine CT textures with the two
  display gains.

These checks use native offscreen rendering and DOM fixtures. They do not claim
browser interaction testing, device frame rates or clinical registration.

## Reproduce

```sh
node tests/brightness-v14.mjs /path/to/linkedom/esm/index.js
node --test tests/brightness-v12.mjs tests/windowing-v10.mjs
python3 tests/brightness-v12-render.py --current-donor-defaults --output docs/brightness-v14
```

The current-defaults flag reuses the existing native harness and compares the
previous published donor gains against `public/donors.js`. Running the harness
without that flag preserves the historical v12 comparison and output location.
