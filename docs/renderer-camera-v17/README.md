# Stable camera detail in v17

Orbit, pan and zoom now retain the chosen full scene ray grid. The surrounding
3D anatomy no longer becomes a magnified low-resolution image when a camera
gesture starts. Fast slice scrolling keeps the bounded v16 path.

## Cause and historical comparison

The full-size cut-face composite was already sharp. Its surrounding volume was
still rendered into a smaller color target and enlarged. The output canvas size
alone therefore did not establish preserved 3D detail.

Direct inspection of the preceding renderer commits shows:

| Version | Camera motion scene | Finished scene |
| --- | --- | --- |
| v14, `b77382f` | Initially 360,000 rays; GPU-timed range 70,000–800,000 | Full chosen output grid |
| v15, `6ee683e` | Same 360,000 initial budget and timed range | Full chosen output grid |
| v16, `ea59ea6` | Initially 160,000 rays for every changed view; timing/fence adaptation can reduce it to 35,000 | Full grid, refined in bounded offscreen bands |
| v17 | Full chosen output grid for camera gestures, including release and later texture arrivals | Same grid and shader |

At the default ceiling, that full grid is 1.5 million pixels. High quality uses
up to 2.6 million and Low uses up to 450,000; actual dimensions also respect the
canvas size and device pixel ratio. v17 intentionally removes the automatic
camera-resolution change rather than restoring v14's less aggressive one.

## Scheduling behavior

The renderer distinguishes a camera change from a changing clipping plane.
Pointer orbit, pan, touch pinch, wheel zoom, keyboard camera input and explicit
view commands request the native camera grid. One GPU frame remains in flight
at a time. New input replaces the pending pose, and accepted cap pixels upload
only when that frame can run. Intermediate poses and images do not form a queue.

Releasing the pointer does not invalidate a completed camera frame. Neither the
idle callback nor a later exact Ultra image reintroduces the small scene target.
Identical settings callbacks are ignored. A background whole-volume resolution
upgrade also preserves an established camera-quality view; the first loaded
volume still begins with bounded startup work.

An actual cut-plane change immediately returns to the v16 bounded scene pass and
full-output current cap. The resident measured source remains available before
an exact Ultra image is ready. After 260 ms of quiet, full scene detail is built
in interruptible offscreen bands. A new request discards unfinished bands. No
stale cap is moved to a different plane, and no incomplete band is presented.

The optional `alignPlane(..., {followScene: true})` mode preserves this distinction
when an Echo window locks its camera to a scrolling section. The explicit Face
plane command retains camera quality. Active auto-rotation yields to section
input during the viewer's 170 ms interaction interval, then resumes its native
camera grid. Camera timing is recorded separately and cannot shrink or inflate
the independent slice-work budget.

## Native pixel evidence

`native-render-check.json` records nine comparisons: orbit, pan and zoom for
LDAF-2021-17, S-20-29 and S-20-28. They use the production GLSL, hash-verified
measured source volumes and prepared Ultra caps in a native offscreen EGL
context, at a 1500 × 1000 output.

For all nine cases, the v17 camera image is **byte-identical** to the completed
full-detail image at the identical pose, including the surface, cut face,
background, threshold, lighting and exposure. The maximum channel difference
is zero. The previous 490 × 327 scene plus full-size cap was also rendered at
each pose. Its cap pixels were exact, but its surrounding surface was visibly
blurred.

| Donor, orbit pose | Previous surrounding-surface mean channel error, 0–255 | v17 camera versus settled error |
| --- | ---: | ---: |
| LDAF-2021-17 | 12.695 | 0 |
| S-20-29 | 13.218 | 0 |
| S-20-28 | 15.314 | 0 |

The masks exclude the cut face and very dark background. The full images and
paired enlarged crops are saved alongside the report. Crop locations are chosen
by the greatest average surrounding-surface error to make the difference easy
to inspect. Chordae and internal surface detail remain crisp in the new camera
frame. These comparisons assess the rendering pipeline, not segmentation or
anatomical correctness.

The production shader source remains unchanged:

```text
5cdc6ea331b6cb33da81a1a4ccd08cb0e929ee31c81571bba7a61a006798fad4
```

## Verification and limits

- Twelve camera orchestration tests use actual renderer methods with recorded
  WebGL commands and pointer/wheel/key events. They cover native scene grids,
  release, late cap arrival, source upgrade, no-op settings, latest-only busy
  frames, quality controls, return to fast slicing, locked-plane tracking and
  section input during auto-rotation.
- All eight v16 startup/refinement/interruptibility checks and all seven upload
  scheduling checks pass. The upload fixture now models view invalidation, which
  is required for the completed-frame no-op behavior.
- Two integration checks exercise the actual Echo and historical flow modules
  with renderer methods: locked section edits keep bounded work, later cap pixels
  preserve that classification, and explicit Face/view commands remain native.
  The combined renderer/upload/module suite has 29 passing tests.
- Seven legacy motion checks pass with the camera assertion strengthened to
  inspect the actual scene grid, not only the output canvas or cap pass.
- All nine native comparisons pass. The rendering driver is recorded in the
  JSON report. No browser automation or user-device FPS measurement was used.

The explicit tradeoff is additional camera-rendering work. At the default output
ceiling a native frame has about 9.4 times the rays of the initial v16 preview;
the actual cost ratio depends on visible anatomy and cap early exits. A slower
GPU may produce fewer camera frames. The existing Render quality control offers
an explicit lower, stable resolution without an automatic blur on each gesture.
The single-frame fence prevents a backlog, but a new slice arriving during a
native camera frame must still wait for that already-submitted frame. Normal
slice-only navigation and startup retain their prior bounded work.

This change adds no scan download, decoded-volume copy or persistent graphics
target. It uses the existing source textures and drawing buffer. Existing motion
and idle targets stay bounded and reusable. The software-rendering fallback is
unchanged; these sharp-camera guarantees apply to WebGL 2.

Reproduce with:

```sh
node --test tests/renderer-camera-v17.mjs tests/renderer-responsiveness-v16.mjs tests/renderer-latency-v15.mjs tests/echo-camera-tracking-v17.mjs
node scripts/verify-renderer-motion-v7.mjs
python3 tests/renderer-camera-v17-native.py
```
