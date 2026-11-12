# Compact scientific workspaces (v47)

This follow-up addresses mobile Ultra eligibility and visual space in Echo
Windows, TTE Lab and TEE Lab. Surface loading is documented separately in
`../mobile-fidelity-v47/README.md`; module behavior is in
`../mobile-echo-v47/README.md` and `../mobile-labs-v47/README.md`.

## Shared navigation and fitting

Compact presentation applies at width <=1050px, height <=760px, or any coarse
pointer. A touch tablet connected to a trackpad therefore retains its compact
layout. Presentation thresholds do not determine model quality or memory.

The source selector reuses the five existing source links, current-donor
identity and citation controls. It opens from the header and closes on outside
interaction, Escape, source selection or resize. About and Share retain full
accessible labels when their visual text is hidden. The four workspace tabs
retain their IDs, full accessible names and panel relationships.

These workspaces use a 52px source/action row and 48px tab row. At width >=640px
and height <=550px, both rows share one 48px row. Donor selection and all four
workspace tabs remain accessible without horizontal scrolling. Reconstruction
keeps its existing navigation and controls.

`workspace-layout-v35.js` measures the actual document position below the
header. Ordinary page scrolling cannot enlarge the canvas. Compact labs fit
the complete workspace, including its bounded steering dock, with a 230px
minimum for unusually short windows. Compact Echo fits only visible panes,
keeps floating Settings/Browse out of the height calculation, and reserves
caption, critical anatomy alert, source attribution, optional reference-angle
explanation and the fixed outer media-status row.

Phone and portrait-tablet Both mode divides the available Echo space using the first screen's
position, both footers and the second heading. It never measures the second
screen's current position as the input to its own new height. This prevents
resize feedback and repeated shrinkage. Portrait tablets up to 900px wide use
two broad stacked visuals, allowing landscape ultrasound to use the full
width; wider or landscape tablets retain the pair side by side.
At normal page scale, keyboard/browser
chrome changes use the available visual viewport; pinch zoom does not resize
the underlying scene.

## Verification

`tests/workspace-layout-v35.mjs` exercises actual templates and the production
fitter using controlled rectangles. Fourteen checks cover desktop fitting,
toolbar wrapping, scrolling, hidden modules, fullscreen, fixed media rows,
single/stacked compact Echo, open lab docks and keyboard-versus-pinch sizing.
`tests/compact-navigation-v47.mjs` checks real source-link reuse, current donor,
query/hash semantics, dismissal, duplicate initialization and accessible tabs.
These DOM checks do not claim to reproduce browser pixel layout.

The managed browser was also reviewed using the actual application in an
iframe with explicit phone/tablet/short-window dimensions. Review identified
and fixed inherited 143px select limits, a full-width header action group,
touch-key specificity and narrow side-dock key overlap. Phone/tablet media,
actual rendered CT/probe scenes, disclosure behavior, changing visible panes,
and a TEE advance control were inspected. A TEE step changed the displayed
model depth from 33.8cm to 33.9cm while switching panes retained that pose.

This is responsive browser verification, not a physical Safari/iPad benchmark.
The local managed preview does not contain the complete production object
storage bank, so unavailable hosted assets and fine-plane failures there do
not establish production loading performance. Device policy and complete
cleanup are independently covered by production-controller/worker tests.
