# TTE linked chest orientation — v43

## Reproduced mismatch

The earlier reference pane drew BodyParts3D's generic heart in its original
reference coordinates. `referenceTorsoPose` constructed a different rigid
mapping for each starting preset, with that preset's neutral beam aimed at the
generic heart. Although subsequent movements preserved this mapping, the
reference heart's actual position and shape had no corresponding mapping to
the measured specimen. The reference could therefore suggest heart coverage
when the measured scan sector missed the donor.

## Current behavior

The overview now uses the exact fixed donor-space context from
`echo-anatomy-context-v2.js`, including the intact fitted skeleton from Echo
Windows. Its generic BodyParts3D heart is absent. A small orientation surface
is sampled from the current donor's already resident scalar volume in the same
world millimetres as the main renderer. It is a coarse outline; it does not
claim to show fine interior reconstruction detail.

The overview receives the accepted `displayedFrame.pose` and state, just like
the main probe renderer. Origin, axes, physical sector depth/angle and the
compact instrument scale are shared without a per-preset remapping or new aim.
Neither organ position nor skeleton fit depends on probe motion. The existing
synthetic contact guide, source sections, scan sampling, accepted starting
planes and primary reconstruction geometry remain unchanged.

Front and Oblique reset only the overview camera. Pointer orbit, scroll/pinch
zoom, modified drag/two-finger pan and keyboard camera controls use the shared
camera bindings. A workspace exit explicitly cancels captured contacts; a
gesture cannot resume with a stale multi-contact baseline. Miniature camera
navigation never steers the scan. The main heart remains separately orbitable.
Preset camera fitting projects the actual fixed skeleton vertices and the
measured heart's bounds. It keeps a modest 6% margin around their limiting
dimension, rather than fitting empty corners of a rotated world bounding box.
This avoids excessive empty space without changing the anatomical target.

The reference chest remains illustrative and unregistered to a living patient.
Matching coordinates and source support are display calibration, not clinical
validation of a TTE acquisition or of excised-heart body positioning.

## Resource and lifecycle bounds

- Maximum sample dimension: 40 on desktop, 32 under the existing constrained
  device policy. Only the already resident volume is read; no new mesh/volume
  download or second 3D volume texture is allocated.
- Output is capped at 48,000 triangles (3,456,000 bytes XYZ/NXYZ). A denser case
  retries on a 24-sample grid. Original scalar samples are never edited.
- Extraction yields between Z slabs and at a roughly 6 ms time budget inside
  the row loop. Cancellation is checked at those yields. A successful smaller
  result replaces the previous outline atomically.
- The three actual low-volume mobile fixtures generated 19,564, 26,332 and
  28,664 triangles (LADAF, S-20-29, S-20-28), respectively. In the Node review
  environment their largest yield intervals were approximately 10–12 ms.
  These are implementation checks, not physical iPhone frame-rate measurements.
- Repeated poses/camera moves reuse the current outline. Source changes and
  threshold changes can regenerate it. Inactive source updates cancel pending
  work and release the previous scalar-array reference, deferring new
  extraction until entry. Completed GPU context remains reusable.
- Errors remain visible and retry on re-entry; an error cannot trigger a new
  extraction on every camera frame. Obsolete jobs cannot install geometry.

The measured outline draws first. Reference context draws only into clear
heart pixels with the existing `depthRange(1,1)` rule, then normal physical depth
is restored for the actual sector and instrument. No extra context framebuffer
is needed, and foreground ribs do not wash over the measured heart silhouette.

## Verification

```sh
node --test tests/probe-overview-v43.mjs tests/camera-touch-v40.mjs
node tests/probe-alignment-v13.mjs --dom=/path/to/linkedom/esm/index.js
node tests/probe-lab-v11.mjs --dom=/path/to/linkedom/esm/index.js
node --test tests/probe-entry-v14.mjs
node tests/probe-lab-v12.mjs --dom=/path/to/linkedom/esm/index.js
```

The new eight-check suite covers fixed context equality for all three donors,
all 12 starting states plus 48 total moved/tilted/missed states, exact physical
sector/plane correspondence, independent portrait camera fits, source-world
mapping, untouched input bytes, cancellation, production draw transforms,
scoped depth restoration, touch controls and inactive-source memory handling.
The revised nine-check pose/indicator suite retains hundreds of combined
movement cases and verifies the actual production draw-call snapshot.

The historical v11/v13/v14 assertions that expected the old generic-heart
mapping have been updated to require exact donor coordinates. This change
deliberately removes that visual remapping; it does not alter the accepted
scan pose or silently move an existing source section.

Native source geometry/render evidence for this release is retained with the
combined lab-context review in `docs/lab-context-v43/`.
