# Reconstruction Display Detail

## What the comparison found

Echo Windows and 3D Reconstruction reuse the same `VolumeRenderer`, resident
donor volume, tissue transfer, lights, cleanup map and scalar-normal function.
Echo does not download a separate, higher-resolution whole-heart model. Its fine
CT section textures describe the cut face and do not replace the surrounding
whole-heart scalar field.

The old Auto output ceiling was 1.5 million pixels for every pane, including the
prepared mesh. A 2400 × 1600 main pane consequently displayed a 1500 × 1000
canvas enlarged by 1.6 in each direction. The same ceiling is much less limiting
in a narrow Echo pane. Enlarging the main UI without increasing its actual
render grid therefore made existing surface detail softer.

There is also a genuine representation difference for LADAF. The source spacing
printed on a model does not by itself establish the visibility of a particular
feature: its isovalue, extraction, smoothing, retained geometry and shading all
contribute. The existing defaults are:

| Donor / View | Whole-Heart Representation | Source Spacing | Threshold | Surface Normals |
|---|---|---:|---:|---|
| LADAF-2021-17, finalized Reconstruction | Prepared 23,618,685-triangle base mesh plus four reviewed local pieces | 79.4 µm | 0.28 | Stored measured-surface mesh normals, with the existing seam-local shading correction |
| LADAF-2021-17, Echo or Interactive Volume | Resident scalar volume, 475 × 475 × 530 | 317.6 µm | 0.32 on entry to Echo | Cubic source gradient by default |
| S-20-29, Reconstruction and Echo | Same resident scalar volume, 478 × 478 × 487 | 318.24 µm | 0.16216216216216217 | Same cubic source gradient by default |
| S-20-28, Reconstruction and Echo | Same resident scalar volume, 477 × 477 × 509 | 317.6 µm | 0.32972972972972975 | Same cubic source gradient by default |

These are source defaults, not overrides of a saved or explicitly changed view.
LADAF's fixed mesh is active only at its prepared threshold and compatible
settings. Switching to Echo resets the scalar threshold to the donor manifest
default; returning restores the saved Reconstruction settings. The local mesh
job remains subordinate to the active Echo/lab workspace. Those rules are
unchanged. Raising the mesh threshold without rebuilding its source would be
incorrect, and calling the scalar's sharper gradient texture additional acquired
geometry would also be incorrect.

## Implemented Change

`app.js` marks the main HOA Reconstruction viewport separately from paired
workbenches. The production renderer chooses bounded output ceilings for surface
mode using `renderOutputPixelBudget`:

| View / Representation | Low | Auto | High |
|---|---:|---:|---:|
| Main scalar surface | 0.45M | 4M | 6M |
| Main prepared mesh | 0.45M | 6M | 8M |
| Echo, TTE, TEE, translucent volume and MIP | 0.45M | 1.5M | 2.6M |

Actual output is additionally limited by the pane size and device pixel ratio
(at most 2). These are new rendered samples, not a postprocessing sharpening
filter or enlargement of an old render. Small panes do not allocate the entire
ceiling. Fine models remain on the output grid; camera motion and orthogonal
section scrolling preserve that same grid. One in-flight GPU fence still
coalesces superseded input. Oblique work retains the existing bounded preview and
full-output current-plane cut face. Idle scalar refinement remains interruptible.

No source intensity, threshold, normal, geometry, cleanup decision, patch,
physical extent, acquisition plane, cap sampling or clinical-source dataset was
changed. High-fidelity preparation still commits only the finalized model.
The user-facing detail choices and runtime action labels now use Title Case.

## Actual Source Render Evidence

`tests/reconstruction-detail-v35-native.py` runs the production vertex/fragment
shaders in native EGL with the hash-verified measured source arrays. All views
use the same reproducible camera: yaw 0.32, pitch 0.12, roll π, distance 1.65,
target [0, 0, 0], FOV factor 0.32 and aspect 1.5. These are matched scientific
renders, not a registration to the user's screenshot or browser captures.

For each scalar donor, `*-detail.png` compares the former 1500 × 1000 render
with an actual 2400 × 1600 render (3.84M samples). Only the old image is enlarged
bilinearly to represent its display at the larger pane size. Every new full-grid
pixel also equals an independently completed, banded render exactly. The
photographic-looking striations are retained measured-field shading; the test
does not classify them as coronary vessels.

`ladaf-finalized-mesh-detail.png` compares 1500 × 1000 with an actual 3000 × 2000
render (6M samples), using the existing compact-decoded 79.4 µm model, all four
v30 local replacement meshes, the v26 detached-component flags and the v32
reviewed mask atlas. The 23.6M original triangles are streamed into small native
test buffers in exact order to bound software-rasterizer memory. This test-only
streaming changes no source attributes or production drawing policy.

The selected lossless detail crops are 600 × 500 pixels, chosen reproducibly
for strong surface-edge contrast within a region containing over 90% tissue.
Their exact coordinates, source identities, thresholds, pixel sizes and numeric
comparisons are in `native-render-check.json`. `*-whole.jpg` provides full-frame
context; those JPEGs are previews, not the arrays used for pixel comparisons.

The main finalized mesh's decoded SHA-256 is
`ef468a2ebf15f11cf57f8443e7d3555f8d53fc1a43b9582125bbbabe304d6ad8`.
Its original geometry identity remains
`175548ddaad01c409d59d561df6018c5cb0c90752b2ec771899c255065398dae`.
The reviewed atlas identity remains
`96cf62fdf734050d125bb851e63027ca11aec9c217f7cecdfb69de3202d380ca`.

## Regression Checks and Limits

- `tests/renderer-camera-v17.mjs`: 22 checks pass, including actual camera/section
  scheduling, retained sharpness, busy-fence coalescing, wide main output,
  mesh/scalar threshold fallback, unchanged Low and unchanged lab/oblique work.
- `tests/renderer-responsiveness-v16.mjs`: 8 checks pass for bounded previews,
  incomplete-band withholding, interruptions, snapshots and GPU backpressure.
- `tests/fine-surface-controller-v19.mjs`: 38 checks pass for prepared-model
  activation, cancellation, preserved preferences, original transport fallback,
  cleanup gates and source-label honesty. Text expectations were updated only
  for the requested Title Case labels.
- `tests/reviewed-mask-atlas-v32.mjs`: 11 checks pass, including actual four-piece
  activation with a 256-voxel 3D texture limit and Safari-style fetch receiver
  validation.
- `tests/reconstruction-detail-v35-native.py`: four actual-source comparisons
  pass across all three scalar donors and the finalized LADAF mesh.

This work exposes more existing detail at large display sizes. It does not add
new acquired resolution, reconstruct full-organ 19.85 µm geometry, certify
coronary anatomy, measure browser FPS or certify Safari on a particular Mac.
The larger main grid costs more GPU work on large/Retina displays; Low remains
available and the probe/lab budgets retain their previous limits.
