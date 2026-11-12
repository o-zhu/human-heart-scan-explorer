# Compact reconstruction toolbar — v51

Delivered as update v0086 after v0085. The right-hand reconstruction controls
now form a bounded, intrinsic-width group. A three-column grid holds View,
Color and Detail; Coronaries and measurement actions span the group on their
own right-aligned rows. This replaces the indefinite percentage flex bases
that could enlarge the toolbar and separate the first three controls from the
mode switch. Hidden optional controls do not reserve an empty row. Coronary
status text wraps inside the group without contributing to its intrinsic width.

The noncompact preserved-heart toolbar uses 13px labels, smaller icons and
horizontal padding. Precise-pointer controls retain 36px minimum height;
any coarse pointer restores 44px, including touch tablets with a trackpad.
Legacy left/bottom offsets are explicitly reset, including the narrow desktop
single-column layout. View and Color popovers open downward with visible
overflow. Clinical-paired layouts and the existing compact control relocation
remain unchanged.

Measure is a warm peach filled action with a dark label, matching its orange
surface marker. During placement the full Cancel Measurement label uses a dark
orange state. Clear Measurements uses a quieter outlined state. A presentation
state attribute distinguishes ready and complete, which both use aria-pressed
false. Focus outlines remain visible and no attention animation is introduced.
Measurement calibration, picking, gestures, geometry, assets and loading are
unchanged.

## Verification

- The existing measurement-controls-v50 (17) and viewport-controls-v39 (5)
  checks pass, 22 total. No new implementation-mirroring tests were added.
- Actual Chromium review used the running application in a temporary resizing
  frame at 1800x1000, 980x900 and 320x568 CSS pixels.
- Desktop group width stayed 260.609375px in Measure, Cancel Measurement and
  Clear Measurements states. View/Color/Detail were approximately 82.86 px wide,
  36px high with 13 px text. Clear Measurements fitted at 165.65625 px.
- Two-point placement completed (100.2 mm demonstration) and clearing restored
  the prominent Measure action. View and Color popovers opened correctly.
- At 980 px the 941.5 px main pane kept its toolbar 17 px from its top/right border
  (16px content inset plus border). Document width and scroll width both 965 px.
- At 320 px, the menu retained the full-width prominent Measure action, the
  document had no horizontal overflow (305px client/scroll width), starting
  measurement closed the menu, and Escape canceled it.
- This remote browser uses software rendering. The optional coronary action
  remains hidden in that backend; its full-span layout and loading-status
  containment received code review. This is not a physical iPad/Safari test.
- The temporary review page is removed before the production build. Build,
  staging, archive verification and actual publication are recorded separately
  in the release receipt.
