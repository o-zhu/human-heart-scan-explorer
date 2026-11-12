# Compact presets and physical measurements — v50

Delivered as update v0085 after v0084. This adds a source-calibrated, two-point
measurement to the HOA 3D Reconstruction view and narrows its eight starting-view
buttons. Source scans, prepared surfaces, masks, loading defaults and scientific
processing are unchanged.

## Using Measure

The Measure button sits beneath Reveal Coronaries in the desktop toolbar. On a
compact pane it joins the existing 3D View Controls menu; starting placement
closes that menu and leaves a small instruction/cancel strip over the canvas.

1. Use Whole Organ or Cutaway, then choose Measure.
2. Move the pointer over visible anatomy. An orange dot previews the selected
   surface. Exact hits take priority; a small edge tolerance helps near a silhouette.
3. Click the first endpoint. The second-point preview includes a live dashed
   segment and millimeter readout.
4. Click the second endpoint to keep the line. The toolbar now offers
   **Clear Measurements**. Clear it to begin another measurement.

Drag to orbit and use the existing zoom/pan gestures between picks. Escape or
Cancel removes an unfinished placement. Automatic rotation stops on entry so
the target does not move under the pointer. Right/modified clicks, two-finger
gestures, canceled captures and double-click reset cannot accidentally commit
endpoints. A new camera or cutaway pose during an asynchronous click rejects
that click instead of selecting a new surface under its old screen coordinate.

The number is the straight-line Euclidean distance in the scan's physical
coordinate system, displayed to one decimal millimeter. It is not a curved
surface path. Physical calibration uses source dimensions minus one times
voxel spacing, including anisotropic previews. Display rounding is not a claim
of corresponding anatomical accuracy. The detailed picking and calibration
contract is in [picking.md](picking.md).

Committed endpoints stay at their source positions through orbiting, zooming,
cutaway changes and matching detail upgrades; they are not silently re-snapped.
The dashed annotation is drawn over the model so its length remains readable.
Changing source or physical extent clears it. Leaving Reconstruction cancels an
unfinished placement and hides a completed line until return. Translucent/MIP
and visible section-plane guide modes do not expose an unambiguous picking
surface, so new placement is disabled there. This controller is scoped to the
three HOA donor reconstructions; the independently booted clinical pilots do
not show an inert measurement control. Measurements are session annotations,
not serialized in Share View or the canvas-only snapshot export.

## Preset sizing and compact presentation

The existing two-column, four-row preset set uses intrinsic content width, with
equal columns sized to the longest label plus its ordinary padding. Optional
status text and secondary actions cannot expand the grid. Compact controls
continue to move into the existing menu without recreating their nodes.

In Chromium at a controlled 1800 × 1000 CSS-pixel desktop viewport, the grid
measured **197.1875 px** instead of the preceding 320 px cap: each button was
95.59375 px wide with a 6 px column gap. Labels remained 15 px and button height
44 px. The grid retained that width after selecting LV Inflow and showing its
status and actions. This clears about 123 px of horizontal overlay space.
See [quick-views.md](quick-views.md) for cascade and regression details.

Measure follows the existing precise-pointer density and retains a 44 px target
when any coarse pointer is present, including touch tablets with a trackpad.
The orange marker, endpoints, dashed segment and number are screen-space sized
but projected from the actual presented camera. A resize waits for its matching
frame before redisplaying the annotation, avoiding a temporary aspect mismatch.

## Implementation and resource bounds

Fine-surface picking samples the existing displayed depth texture, including
cleanup and local/native replacements, and applies the same current cut-face
shader logic. It never retains a second Ultra mesh or source volume. The
extra pixel storage is a 33 × 33 RGBA8 target and a 4,356-byte pixel-pack buffer.
One nonblocking readback is allowed in flight, including after cancellation.
Scalar and software views use their corresponding displayed source/depth path.
Frame/source/viewport checks, finite timeouts, state restoration and context-loss
cleanup protect the working renderer. Hover requests are coalesced.

The point-placement design follows the distinction between surface-constrained
placement and unconstrained camera-plane placement described by
[Slicer Markups](https://slicer.readthedocs.io/en/latest/user_guide/modules/markups.html).
Its [AccuratePicker](https://apidocs.slicer.org/main/classvtkMRMLAccuratePicker.html)
also motivates exact ray hits before a silhouette tolerance. The implementation
uses Heart Explorer's displayed GPU depth rather than duplicating its streamed
geometry into a CPU locator. These sources inform the interaction design; they
do not validate Heart Explorer's measurements.

## Verification

| Scope | Passing checks |
| --- | ---: |
| Measurement physical geometry/projection | 5 |
| Measurement picker, stale states, fences and deadlines | 11 |
| Measurement DOM/gesture/lifecycle behavior | 17 |
| Existing camera quality/scheduling | 27 |
| Existing touch camera controls | 14 |
| Existing compact viewport relocation | 5 |
| Existing streamed Ultra, component visibility and atomic volume replacement | 22 |
| Existing anatomy selection | 8 |

All 109 Node checks pass. The native EGL production-shader fixture passes eight
additional cases covering overlapping geometry, debris, clipping, caps, cap
holes/crops, fine-cap cleanup and reduced-grid scalar rendering. Its precise
scope, driver and source hashes are recorded in
[native-picking-check.json](native-picking-check.json). This is calibrated test
geometry, not an end-to-end Ultra or physical-device benchmark.

Actual Chromium review used the production application in a temporary resizing
frame at 1800 × 1000, 390 × 844 and 320 × 568 CSS pixels. The desktop grid stayed
intrinsic before/after preset selection. Compact navigation retained all four
short names, the document had no horizontal overflow in the checked narrow
states, Measure remained accessible, its menu closed for placement, and its
prompt fit beside the existing viewport control. Escape canceled placement.
Two-point measurements succeeded on the whole organ and a cutaway. A completed
77.7 mm example stayed 77.7 mm after orbiting; a separate cutaway example showed
39.4 mm. These are interaction checks, not named anatomical measurements.

This browser used the application's software fallback because WebGL2 was
unavailable. Some hosted fine-section requests are unavailable in the local
preview. The native shader tests cover the GPU picking logic separately; no
physical iPad/Safari, touchscreen performance or clinical validation is claimed.
The temporary resizing page is excluded from both publication and update payload.
