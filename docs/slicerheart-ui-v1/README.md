# SlicerHeart compact workspace and upright sections

This update is based on `590cbf9ec7545f83159a57f811b8c92642b49028`, including
the concurrent v33 HOA layout. Production changes are confined to
`public/clinical-app.js` and SlicerHeart-scoped rules in `public/clinical.css`.
The shared page, HOA layout, source banks, shaders and physical geometry stay
unchanged.

## Layout

SlicerHeart hides its redundant single reconstruction tab and places the acquired
series, phase playback and Scan details controls at the top of its CT rail.
The rail shares the viewport's measured height. Its remaining space uses v33's
coronal/sagittal first row and full-width axial second row. The CT introduction
remains screen-reader-only, with accessible per-plane instructions and controls.
Fullscreen includes the relocated controls. Narrow screens retain the intentional
stacked workspace, and individual planes can still be enlarged and restored.

Scan details opens over the rail without changing its height. Its absolute
containing block is the complete toolbar, with inherited margins removed.
Escape and an outside pointer press close it. A second resize observation keeps
CT backing canvases current when their grid changes independently of the workspace.
Shared readability rules retain effective 44px control targets and 15px control
fonts; the compact toolbar occupies approximately 116px at desktop rail widths.

## Orientation

SlicerHeart source +Z maps to viewer +Y. Its longitudinal source rasters and
orthogonal display frames previously put that direction down the screen.
The CT canvas now applies a 180-degree display transform for axes 0 and 1.
The corresponding 3D camera negates display up while retaining the physical
normal, center, selected index and clip side. Axial orientation is unchanged.
The scale bar is drawn after restoring the canvas transform and remains upright.

Fresh whole-volume, reset and explicit Whole volume selections use yaw 1.15,
pitch 0.12 and roll 0. This lateral view puts the spine to the left and exposes
the heart, matching the user's reference. Explicit saved cameras remain intact.
All three acquired SlicerHeart series use these display changes; cMAC does not.

## Verification

The contact sheet uses the actual production volume shader and hash-verified
overview phase 0. Its eight 480px panels compare four whole-volume cameras and
native before/after sagittal 55/145 and coronal 63/125 renders. Upright cutaways
are rendered with the new camera basis, not produced by rotating screenshots.
The old EGL helper required empty integer and RGBA textures for the renderer's
new reviewed-mask samplers; those bindings are isolated to the review script.

Focused checks passed: 20 clinical DOM/event tests, 3 workspace height/resize
tests, 10 source-aware plane-name tests, and CSS parsing. They cover playback,
stale phase requests, all three acquired series, section input and expansion,
fullscreen containment, preserved source arrays/clip halves, saved camera
restoration and cMAC separation. The production build and all eleven existing
asset staging steps are required before packaging.

The preview server started, but the CUA browser backend failed to connect.
Native orientation renders and source/DOM/CSS checks do not constitute browser
layout, Safari interaction, or device-performance verification.

```sh
node tests/clinical-ui-v19.mjs /path/to/linkedom/esm/index.js
node tests/explorer-layout-v33.mjs /path/to/linkedom/esm/index.js
node tests/section-names-v28.mjs /path/to/linkedom/esm/index.js
python scripts/verify-slicerheart-views-v1.py
```

The native review requires NumPy, Pillow and EGL, as does the existing clinical
render harness. See `verification.json` for source and image identities.
