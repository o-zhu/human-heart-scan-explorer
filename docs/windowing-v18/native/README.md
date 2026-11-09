# Native verification of the v18 CT display presets

The selected presets pass the production shader and cross-module checks. The
native comparisons change the color transfer on the measured cut face; the
surface, background, geometry, threshold and source pixels stay unchanged.

These are offscreen renders of the application's actual GLSL, with measured
volumes and prepared Ultra cut faces. They are not screenshots of a browser or
measurements of browser responsiveness.

## Results

Run from the repository root:

```bash
python3 tests/window-native-v18.py
```

The runner reads the shipped settings through
[`getWindowPresets()`](../../../public/window-presets.js), checks their equality
with the [selection record](../candidate-profiles.json), and then uses the shipped
settings in all comparisons. The screenshot reference profiles come from the
selection record because they are experimental comparisons, not shipped presets.

| Check | Result |
| --- | --- |
| Production GLSL versus the CPU color transfer | 198 comparisons passed across all six palettes, six anatomy labels and selected-label states |
| Maximum shader/CPU channel difference | 1 out of 255; the largest mean channel difference was 0.00131 out of 255 |
| CT cards, Echo CT and Probe CT | 60 exact pixel comparisons passed: 10 enabled-window profiles × 6 palettes |
| Simulated ultrasound output during CT window changes | Identical pixels in the module checks |
| Native 3D comparisons | 11 fixed-camera views: 5 LADAF, 3 S-20-29 and 3 S-20-28 |
| Changes outside the measured cut face | Zero changed pixels in every native comparison |
| Source integrity | All 23 recorded source files unchanged; source images and volume parts also checked against manifest hashes |
| Driver | llvmpipe, LLVM 20.1.2, 256 bits |

The complete machine-readable evidence, exact tested settings, source hashes,
production profile hash and shader hash are in [validation.json](validation.json).
No source, shader, camera, interaction scheduler or segmentation file is modified
by this runner.

## Source-derived comparisons

Every column of a donor's comparison uses the same measured source, crop,
camera, cut plane, geometry, cleanup support, threshold and lighting. The
application's Tissue & space palette is used throughout. The prepared cut faces
have source spacing of 79.4 µm for LADAF and S-20-28, and 79.56 µm for S-20-29.
The 3D surface uses the existing high-level volume, exactly as before.

| Donor | Fixed-view comparison | Enlarged identical crop |
| --- | --- | --- |
| LADAF-2021-17 | [Native profiles](ladaf-2021-17-native-profiles.jpg) | [Native detail](ladaf-2021-17-native-detail.png) |
| S-20-29 | [Native profiles](s-20-29-native-profiles.jpg) | [Native detail](s-20-29-native-detail.png) |
| S-20-28 | [Native profiles](s-20-28-native-profiles.jpg) | [Native detail](s-20-28-native-detail.png) |

The detail crop is selected once from the cut-face coverage mask, independently
of a candidate's apparent contrast. It is enlarged with nearest-neighbor
resampling to expose the actual rendered pixel differences. Full comparisons
are JPEGs for review; exact pixel assertions occur before image compression.

Visual inspection supports the selected tradeoff: Balanced detail retains more
intermediate shades, while Strong contrast makes boundaries more prominent.
The distinction is particularly visible in the S-20-28 wall. Neither option
increases acquired spatial resolution or establishes a universal fidelity
optimum. Parameter-selection and additional-plane checks are in the parent
windowing study.

## Transfer audit

For an enabled intensity window, the shared CPU/GLSL pipeline is:

```text
q = clamp((intensity - black) / (white - black), 0, 1) ^ gamma
v = clamp((q - 0.5) * contrast + 0.5, 0, 1)
exposed = brightness * v / (1 + (brightness - 1) * v)
```

The palette is applied next, with the same output exponent of 0.89 in the
relevant CPU and GLSL paths. The 3D cut face also has the existing angle factor
`0.91 + 0.09 * abs(dot(normal, view))`. This explains the small intentional
appearance difference between an oblique 3D cap and its face-on CT card. The
ramp comparisons use a face-on direction so they can test numerical equality.

The brightness control already uses a soft shoulder. Increasing it to 3× does
not add a new hard clipping threshold. The additional contrast clamp after
windowing can discard differences near the endpoints, which is why the new
presets use contrast 1.0 and adjust the window itself.

The user's visible screenshot shows brightness 3×, black 17,454, white 21,176
and gamma 1.10. It does **not** show the cut-face contrast control. The column
called “Screenshot reference” assumes the previous default contrast of 1.8;
this is an assumption, not a recovered setting. The next column explicitly
compares the same visible controls with contrast 1.0.

Using those displayed raw endpoints, contrast 1.8 reduces the nonflat interval
from 17,454–21,176 to approximately 18,402–20,416. That leaves 58 varying encoded
8-bit input levels, versus 107 with contrast 1.0 and the same window. These are
tonal-retention counts for this transfer, not scores of anatomical accuracy.
The exact normalized screenshot values in the experiment are 0.316 and 0.734;
their raw endpoint values differ from the displayed integers only by rounding.

The original LADAF preset intentionally keeps its disabled-window behavior.
Its Tissue & space cap uses legacy endpoint clamps at 0.015 and 0.98 rather
than 0 and 1, and its orthogonal CT cards retain a separate legacy grayscale
transfer. The cross-module equality assertion therefore covers enabled windows;
it does not assert equality for that legacy card path. All newly shipped
Balanced and Strong presets enable the shared windowed transfer.

Primary implementation references:

- [CPU color and window transfer](../../../public/render-styles.js)
- [Production GLSL and cap shading](../../../public/renderer.js)
- [Orthogonal CT painting](../../../public/section-paint.js)
- [Echo CT painting](../../../public/echo.js)
- [Probe CT and ultrasound painting](../../../public/probe-lab.js)
- [Native runner](../../../tests/window-native-v18.py)

This verification confirms the display-only nature and numerical consistency of
the presets. It does not assess clinical validity, recover information clipped
when the existing 8-bit display data were created, or claim a change in loading
time or orbit frame rate.
