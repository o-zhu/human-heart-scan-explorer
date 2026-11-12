# Compact reference navigation and TEE multiplane displays

Implemented November 12, 2026, on the source synchronized through website v89.
The feature/test suffix v55 is independent of the Sites version and archive
queue sequence; see [the update workflow](../UPDATE_WORKFLOW.md).

The video behavior described below was corrected by the subsequent
[recording-by-recording QC pass](../tee-video-qc-v56/README.md). That review
supersedes the original blanket-overlay policy and its catalog-URL test fixture.

## Navigation

All Reference Views is an inline back action in the existing selected-view
heading. The existing compact toolbar exposes the same action as an accessible
back icon on intermediate widths and as All views beside the pane switch on
phones. Returning preserves the gallery's modality, level, window, query,
selection, scroll position, and keyboard focus. It adds no separate banner.

## Shared multiplane graphic

`public/multiplane-indicator.js` and its stylesheet provide a small SVG display:
0° is left, 90° is down, and 180° is right. The display represents electronic
multiplane rotation; it does not change the simulated plane or probe pose.

- **Reference videos:** the current source-specific policy preserves the native
  scanner displays in 26 recordings and adds a numeric REF angle only to the
  seven reviewed recordings without one. REF is the midpoint of the catalog's
  existing typical range, explicitly identified as a representative teaching
  angle. It is not a measured angle from the recording. Placement waits for
  matching decoded metadata from the actual playback URL, including local
  cache Blob URLs. Two reviewed publisher placements are retained; the five
  local examples use an inset upper-left position within the rendered video.
- **Reference illustrations:** gallery cards, sidebar thumbnails, and enlarged
  illustrations show a small semicircle with the corresponding range shaded.
  Tiny graphics omit numerals; accessible names retain the exact range.
  A zero-width range remains an exact radial mark rather than an invented span.
  The original raster artwork is unchanged.
- **TEE Lab:** the control dial reflects the requested angle. The SIM badge on
  the image reflects `displayedFrame.state.multiplaneDeg` only. It remains tied
  to the displayed pixels while a new frame is pending, ignores rejected
  frames, and hides when a source reset clears the accepted image. Both CT and
  simulated-ultrasound modes use the same accepted angle.

No TTE indicator is added. The lab's four small model-preset decorations keep
their adjacent donor-fitted numeric control labels; they are separate from the
28 clinical Reference Views illustrations.

## Range provenance

Existing catalog ranges are retained. The source is the
[2013 ASE/SCA comprehensive TEE guideline](https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf).
For example, the ME four-chamber narrative describes approximately 10–20° to
exclude the aortic valve/LVOT and maximize the tricuspid valve, and the right
pulmonary vein narrative describes typically 0°. These are teaching ranges,
not per-recording measurements or donor-specific fitted simulation angles.

## Focused verification

The following checks passed before publication:

- Shared-gauge and video-placement suites: 17 Node subtests, including endpoint
  orientation, finite bounds, all 28 ranges, zero-width ranges, safe accessible
  markup, non-square source pixels, metadata readiness, and resize placement.
- TEE control, donor-control, compact-lab, and new live-angle suites: 35 Node
  subtests covering slider/keyboard/preset/reset behavior, lock state, accepted
  versus requested angles, stale or canceled frames, and source reset.
- Existing TEE plane geometry suite: 9 Node subtests.
- The original reference-player fixture exercised all 28 catalog entries, but
  did not model the local cache's Blob URL or distinguish native source dials.
  The subsequent v56 source review and real-cache regression correct both
  omissions; see the linked QC report for the current checks.
- Reference gallery: all 56 views, 28 TEE range badges, no TTE badges, Basic and
  Advanced subsets, filtering, both return controls, focus and scroll restore,
  and media/canvas lifecycle.
- Existing TTE and TEE atlas controller suites, including all 28 views per mode.
  Those suites ran in the private deployment checkout because a fixture asset
  is intentionally excluded from the public repository.
- JavaScript syntax and whitespace checks for the modified source.

The DOM fixtures use LinkeDOM, supplied through the test argument or
`HEART_DOM_MODULE`; it is not a runtime dependency. The public development
[guide](../open-source/development.md) describes restricted fixture exclusions.
These checks do not establish physical-device, anatomical, or clinical
validation. Publication and browser observations are recorded separately in
the immutable release handoff.
