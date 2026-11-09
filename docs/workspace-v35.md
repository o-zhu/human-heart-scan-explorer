# Compact Echo, TTE and TEE Workspaces

## Layout changes

Echo's **Anchor by Probe View** and **Anchor by Anatomy** controls now sit in the same toolbar as **3D Cutaway** and **CT Slice**, immediately after the view switch. The active-view header contains only the selected view and previous/next/illustration navigation. CT correspondence evidence remains directly below the anatomy view. Both comparison panes retain their real canvas/media mounts.

The TTE and TEE introductory bands have been removed. Their four starting-view controls remain directly accessible in compact two-column grids inside the existing 3D viewports. TEE's atlas and reconstruction links remain in its probe console. Contact/registration qualifications remain visible below the 3D pane; the longer explanatory notes follow the workspace. No source geometry, accepted acquisition plane, camera-anchor semantics, dataset, or citation was changed by this layout work.

`public/workspace-compact-v35.css` and `public/workspace-layout-v35.js` are loaded after the existing layout files from `page.html`. Their selectors and measurements are confined to Echo, TTE and TEE. Reconstruction keeps its existing independent sizing controller.

The new sizing controller uses the actual header and workspace positions. It removes the previous 1,000–1,080 px minimum lab heights, allocates remaining desktop height to the paired views, and gives Echo's two toolbars matching heights when controls wrap. Both Echo images then use the same available height. Page scrolling does not change their dimensions; viewport resizing, changed header heights, module return and native fullscreen transitions do. The controller watches independent header/control geometry and module visibility, not every probe-frame text update.

Controls keep the shared minimum 44 px target size, with 15–16 px primary labels and 14 px supporting text. Display labels use Title Case while preserving scientific units, abbreviations, source names and explanatory prose. Probe method text distinguishes its lighter motion preview from refinement after the probe stops.

## Responsive behavior

- Above 1,050 px, the TTE chest reference or TEE console remains beside the equally sized 3D/image pair. The TEE console can scroll independently.
- At 1,050 px and below, the paired visualization comes first and the chest reference or console follows it.
- At 900 px and below, Echo's view browser becomes a compact horizontal browser above the comparison.
- At 720 px and below, comparison images stack with readable, equal-height image windows and freely wrapping controls.
- At 480 px and below, the starting-view cards use the viewport width and Echo's anchor controls have their own full-width row.

Minimum usable heights remain for unusually short windows. Such windows can scroll rather than collapse or clip a scientific image. Fullscreen continues to target the whole active module.

## Validation

Executed against the current integrated source:

| Check | Result |
| --- | --- |
| `tests/workspace-layout-v35.mjs` | 7/7 passed: real template placement, retained controls and evidence nodes, desktop/laptop sizing, toolbar wrap/release, hidden/return transitions, scroll invariance, fullscreen/tablet sizing, and bounded mutation observation. |
| `tests/tte-atlas-ui.mjs` | 8 controller/camera checks passed, including all 28 views, camera-only anchor behavior, accepted-plane preservation, navigation, media correspondence and stale-load rejection. |
| `tests/tee-atlas-ui.mjs` | Passed all 28 selections, source-review controls, fixed context, visibility and outside-scan guards, navigation, dialog, crosslinks, media retry and TTE restoration. |
| `tests/probe-lab-v11.mjs` | 6/6 passed: preset poses, motion mapping, control capture, geometric labels, model transforms, source bytes and contact coherence. |
| `tests/probe-lab-v12.mjs` | 11/11 passed: control and Escape handling, late request cancellation, all-donor starting geometry, actual overlay/fallback transforms and reference-camera coverage. |
| JavaScript syntax and patch whitespace | `node --check` on changed runtime modules and `git diff --check` passed. |
| CSS syntax | PostCSS parsed all 166 scoped rules and four responsive media blocks successfully. |

The v12 geometry fixture initially assumed every donor's tip lay at 47% of imaging depth from the section center. Current calibrated donor frames instead record `probeEntry.tipOffsetMm` and its reference scale. The fixture now uses that recorded offset where available and retains the legacy 47% fallback for older frames. It still checks every source-center coordinate, the actual rendered tip origin, model scale and unchanged pose. No geometry implementation was changed to satisfy the fixture.

These are production DOM/controller checks and controlled-rectangle layout tests, not browser pixel-layout measurements. **Browser runtime was unavailable, so no browser screenshot or Safari visual verification was performed for this layout update.** The tests do not establish real-device frame rates or clinical validation.
