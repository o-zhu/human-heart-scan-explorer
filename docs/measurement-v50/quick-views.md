# Compact reconstruction starting-view buttons — v50

The reconstruction's eight starting-view buttons retain their two-column,
four-row layout. The previous container filled up to 320px, leaving substantial
empty space around the labels. Its width now uses `max-content`, capped by the
available heading width. The existing equal `1fr` grid columns share the same
container width, so both ventricular and atrial groups fit the longest label
in the complete set plus the existing horizontal padding and borders. This
also accommodates the longer geometric labels on comparison donors without
hard-coded text measurements.

The optional selection status and Close-up / Flip / Region Colors controls use
inline-size containment. Their text can wrap vertically, but revealing them or
changing the status message does not enlarge the preset buttons. This is only
size containment in the inline direction; it does not clip text, focus rings,
or button interaction. Labels, grouping, button padding, target heights,
keyboard behavior and scientific starting views are unchanged.

The later rules in `viewport-controls.css` still give the relocated compact
menu its full width and 44px button targets. No markup, controller, pointer
handling, viewport breakpoint, source data, or dependency changed for this
adjustment.

## Verification

- PostCSS 8.5.23 parsed the modified `explorer-layout-v33.css` (126 rules) and
  the later `viewport-controls.css` (55 rules) without errors.
- `git diff --check` passed for the CSS change.
- The existing `viewport-controls-v39.mjs` suite passed all five tests using
  external LinkeDOM. It checks resize-driven relocation, original listeners,
  focus restoration, workspace changes, and cleanup; it is not a browser
  layout test.
- The source cascade retains the compact menu's more-specific full-width
  override after the new intrinsic desktop sizing.

Browser review should measure the eight buttons before and after a preset is
selected, confirm equal column widths and four rows, and inspect compact-menu
relocation at phone and split-pane sizes. A CSS parse alone does not establish
computed layout or physical iPad behavior.

## Adjacent measurement-control integration

`tests/measurement-controls-v50.mjs` passed all 17 tests against the real
controller and production page DOM, with controlled asynchronous surface picks
and presented-frame snapshots. Coverage includes CSS/client coordinate offsets,
two-point placement and clearing, hover replacement, orbit/pan/multitouch
rejection, coalesced pointer motion, pending-readback protection, double-click
reset suppression, cancellation, donor changes, workspace return, and stable
millimeters during camera/resize/equivalent-detail updates. Error recovery,
missing calibration, unsupported display modes, page suspension, context loss,
and disposal are also checked. Resize annotations remain hidden until a frame
matching the new canvas dimensions is presented.

A deferred click is rejected if the camera or cutaway changes before selection
returns, including a camera update not yet drawn. A fresh retry succeeds, and a
new detail/frame revision at the same pose remains eligible. Temporary picking
unavailability is distinguished from clicking empty background.

These are interaction and lifecycle checks. Native GPU picking, rendered CSS
dimensions and physical touch devices require their separate verification.
