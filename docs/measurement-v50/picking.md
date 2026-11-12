# Visible-surface measurement picking — v50

## Coordinates and measurement meaning

Measurement points belong to the displayed reconstruction. The straight line
between two selected points is a Euclidean distance, not a path along a surface.
The existing acquisition mapping uses center-to-center source extents:

```js
sizeMm[i] = (dimensions[i] - 1) * spacingUm[i] / 1000;
longestMm = Math.max(...sizeMm);
distanceMm = Math.hypot(...worldB.map((n, i) => n - worldA[i])) * longestMm;
```

The normalized viewer swaps source Y/Z and flips source Y; it does not apply
different physical scales to the viewer axes. `volumeGeometry(meta)` and
`sourceToWorld`/`worldToSource` preserve the existing mapping, including
anisotropic preview sampling. LADAF's reference extent is 168.0104 mm per
viewer unit. The surface's 79.4 µm source label is not the viewer's unit scale.
Displayed numeric precision does not establish anatomical or clinical accuracy.

## Presentation contract

`renderer.presentedMeasurementFrame` records the actual presented camera basis,
aspect, output and scene grid sizes, CSS dimensions, source key, mode, resource
state and monotonically increasing `frameSerial`. `frameRevision` retains the
renderer/worker's existing revision. `onMeasurementFrame(snapshot)` is optional
and runs after presentation, before automatic rotation advances the next camera.
It may receive `null` after context loss or an unavailable software frame.

The controller sets `renderer.measurementSourceKey` to the donor ID. A stable
source key survives a same-donor detail upgrade; source and physical-scale
changes remain controller invalidation events. Resource identity and actual
presented state still reject a readback from an obsolete detail/cap/camera.

Software records are captured at worker submission, then paired with that
worker result's linear forward-depth raster. At most four small job records
are retained. Depth arrays are shared with the existing `contextDepth`; no
volume or mesh is copied. Software projection uses the stored raster aspect,
which can differ slightly from the CSS aspect after dimension rounding.

## Picking API and exact visible surfaces

```js
const picker = new MeasurementSurfacePicker(renderer);
const hit = await picker.pick(u, v, {toleranceCssPixels: 4, signal});
// hit: {world, sourceNormalized, cutFace, frameRevision, sourceKey} or null
picker.cancel();
picker.dispose();
```

`u,v` are canvas-relative fractions, with `v` increasing downward. The exact
presented pixel wins. A small bounded tolerance is considered only if that
pixel misses; a neighboring hit uses the neighboring pixel's ray. This avoids
moving a point to a closer-depth but unrelated neighboring surface. Background
misses return null and clear `unavailableReason`. Updating-frame and GPU
deadlines set a short `unavailableReason`, so the UI can distinguish temporary
unavailability from a genuine miss. Translucent/MIP and overlaid-plane modes do
not assert an unambiguous surface position.

For a prepared mesh, the picker samples the existing `FineSurfacePass` depth
texture. That texture contains the actual retained surface and its visible
local/native replacements, clipping and debris/lumen decisions. It does not
cast against a coarse proxy volume or retain a CPU Ultra mesh. The current CT
cap is combined using the production composite's unchanged intersection,
threshold, cropped-raster and cleanup GLSL. Empty cap pixels expose the surface
behind them; the tool does not place a point on an invisible free-space plane.

For a resident scalar view, a tiny draw runs the production scalar shader at
the presented scene pixels, followed by the same full-output cap rule. A
reduced scene grid is mapped with the shader's bottom-origin pixel convention;
its chosen surface ray and a full-resolution cap ray are kept distinct.
Software mode directly samples its exact presented linear-depth raster.

The WebGL readback encodes 24-bit window depth plus a surface/cap flag into
RGBA8. It uses a pixel-pack buffer and polls a GPU fence with zero timeout.
Only after the fence signals does `getBufferSubData` copy the tiny result.
The target is cleared before drawing; submission/readback errors cannot reuse
old hit flags. Relevant framebuffer, viewport, program, VAO, texture, pack,
color-mask and render-enable state is restored before any asynchronous wait.

## Resource and cancellation bounds

The retained pixel storage is one 33 × 33 RGBA8 target (4,356 bytes) and one
4,356-byte pixel-pack buffer, plus two lazily compiled shader programs and a
small VAO. No additional full-view target, source volume, mask, surface vertex
array or mesh draw is introduced. Hover work is coalesced by the controller.

Only one submitted readback can occupy the picker. Canceling JavaScript cannot
cancel queued GPU commands, so its fence is retained until signaled; a newer
request drains that slot before submitting. Frame/GPU waits are bounded to a
one-second request window. A timeout cannot create a queue of replacement
draws. Source, camera, cap, layout, disposal and context-loss changes reject
late results. Hard graphics failures close the picker path without replacing
the working heart renderer. Optional annotation callback errors cannot take
away a successful heart presentation.

## Verification

`node --test tests/measurement-picking-v50.mjs` passes 11 focused tests:

- Anisotropic acquisition normalization reproduces an independent 3–4–5 mm
  distance; depth roundtrips preserve camera/aspect and pixel-ratio geometry.
- Exact pixels precede neighbors; tolerated points follow their own ray.
- Reduced-grid Y boundary cases agree with the shader's bottom-origin floor.
- Source, camera, resource, mode, CSS and output-size changes invalidate stale
  frames; pending clicks can wait for a matching presentation.
- GPU fixtures verify restored state, two bounded pixel allocations, fenced
  readback, one outstanding submission even after cancellation, stale-frame
  retry, deadlines, real misses, draw/readback failure and context loss.

`python3 tests/measurement-picking-v50-native.py` compiles the actual production
mesh and picker shaders in OpenGL ES 3 and rasterizes six calibrated synthetic
vertices into an 81-pixel depth fixture. It passes eight checks: nearest
overlapping surface/background, debris rejection, clipped geometry, prepared
cap replacement, empty cap holes, crop-boundary resident fallback, fine-cap
cleanup priority, and resident scalar/full-output cap coherence. The report is
[`native-picking-check.json`](native-picking-check.json), with source hashes and
the actual native driver. The asserted forward-depth tolerance is 0.00008
viewer units for this fixture (about 0.0134 mm at LADAF scale), not a universal
precision or source-accuracy guarantee.

The shared camera regression suites also pass: `renderer-camera-v17.mjs`
(27 tests) and `camera-touch-v40.mjs` (14 tests). UI/controller behavior has
separate coverage in `measurement-controls-v50.mjs` and browser evidence.
Native EGL and controlled command fixtures do not establish physical iPad,
Safari, user-device latency, or clinical measurement validation.
