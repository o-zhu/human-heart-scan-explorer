# Atlas cinematic: lighter rose and ivory

## Appearance decision

The previous optional Atlas style multiplied a dark red surface tint by a dim,
warm shadow light. That combination gave much of the visible heart a rusty
brown appearance and obscured recesses. This revision keeps palette ID **6** and
the **Atlas cinematic** name, while changing its appearance to muted rose,
warm tan and ivory with softer, nearly neutral shadows.

The changes are confined to the Atlas branches:

- Surface colors start from a lighter, less saturated rose and progress through
  warm tan to ivory. The old ochre transition is removed.
- The fill light is brighter and less yellow. Local occlusion contributes 65%
  of its former darkening, retaining relief without crushing recesses.
- Specular and rim light remain restrained. The neutral dark background,
  global exposure, camera, geometry, normals and thresholds are unchanged.
- Cut faces and measured CT views share the same continuous, monotone-luminance
  rose/ivory transfer. Probe and TEE ultrasound remains unchanged grayscale.
- The menu description and swatch describe the revised appearance. Existing
  palette IDs 0–5, default ID 4 and saved Atlas selections retain their meaning.

The fine mesh and native replacement pieces already use the production
`shade()` function from `renderer.js`, so they inherit the revised appearance
without a separate lighting implementation. The software fallback mirrors the
same palette-specific color and lighting equations.

This is an illustrative intensity palette. It does not establish the specimen's
true tissue color, classify myocardium or connective tissue, use calibrated
Hounsfield units, reproduce the authors' unpublished transfer function, or
implement cinematic path tracing. The paper review and original inspiration
remain documented in `../atlas-cinematic-v27/README.md`. Color variation still
uses the resident display volume and therefore can be coarser than the active
fine/native geometry. No texture, label bank or mesh download was added.

## Matched visual evidence

`cutaway-comparison.jpg`, `valve-closeup-comparison.jpg` and
`whole-heart-comparison.jpg` place the previous v27 style on the left and the
revised v28 style on the right. They render the same measured source, verified
v19 detailed mesh, camera, clip plane and threshold through the actual
production GLSL. The images were reviewed directly: surfaces now appear muted
rose, cut tissue remains warm ivory, and recesses are substantially more visible.

The smaller v19 mesh has **1,986,313 triangles** and shares the fragment shader
used by the active Ultra-high Fidelity and native replacement surfaces. It
keeps this appearance check bounded in memory. These images are **palette-only
comparisons**, and do not show or validate the new v28 artifact cleanup.

On the identical whole-heart silhouette, excluding the unchanged background:

| Rendered display statistic | Previous v27 | Revised v28 |
|---|---:|---:|
| Median luminance, 0–1 | 0.1115 | 0.3719 |
| Median RGB saturation | 0.7595 | 0.4071 |
| Pixels with luminance below 0.1 | 41.89% | 0.00% |
| Pixels with any RGB channel clipped | 0.00% | 0.00% |

These are display appearance statistics, not measurements of tissue color or
clinical accuracy. They confirm that the intended brightness and saturation
changes occur without highlight clipping in this view.

## Verification

`validation.json` contains the exact source and production shader hashes. The
frozen baseline shader/JavaScript fixtures come from commit
`b299904716841ea26e173f6ae19e66cd4d9c84f3`, before this revision, and are not runtime
assets. The review compiled the production volume, cap-composite, fine-surface
and background programs in native offscreen EGL.

- Palette IDs **0–5** remain byte-identical before/after in whole-heart,
  cutaway and valve-closeup fine-mesh renders.
- IDs **0–5** remain byte-identical in scalar surface, translucent and MIP modes
  at the tested camera.
- Switching Atlas back to the default Tissue / space restores identical pixels.
- All 256 input intensities, seven palettes and three window/exposure settings
  match JavaScript versus GLSL cap color within one 8-bit channel level.
- Measured resident and cap arrays retain their original hashes.

`ui-validation.json` records eight focused tests against actual source
functions, DOM controls and worker code. They verify menu selection without
anatomy-label requests, Probe/TEE exposure, bookmark restoration, identical
measured CT colors, untouched ultrasound pixels, a bounded ordered transfer,
exact preservation of the six existing JavaScript palettes, and the revised
Atlas color characteristics. Actual worker renders also preserve IDs 0–5
byte-exact in all three scalar modes and match the shared Atlas CT transfer.

Reproduce with the verified v19 source banks available:

```sh
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 LP_NUM_THREADS=1 MESA_GLTHREAD=false python3 scripts/atlas-cinematic-v28/render_review.py
node tests/atlas-cinematic-v28.mjs /path/to/linkedom/esm/index.js
```

This is production-shader and actual-control verification. It does not measure
browser frame rates, device latency or clinical validity.
