# Echo and Lab secondary UI — v42

## Scope and decisions

This pass reduces the default text below the Echo Windows, TTE Lab and TEE Lab visual panes. It changes presentation, disclosures and player-status visibility. It does not change accepted planes, source intensities, probe fitting, keyboard or touch steering, download scheduling, or source media.

- **Echo model information:** the correspondence badge stays visible in the closed **Model Details** summary. Its full explanation, illustrative-anatomy attribution, probe-fit qualification, reviewed/previous comparison, review findings and scan metadata are available inside. Probe, sector and anatomy visibility toggles remain directly available.
- **Echo source information:** the source link stays beneath the movie. Full recording provenance, license links, recording resolution, guideline correspondence and the separate-person/unregistered-reference explanation are in **Source Details**. Supplementary angle explanations remain visible where applicable.
- **Echo guidance:** acquisition marker/angle/level, maneuvers, free steering, appearance controls and manual plane controls are grouped under the closed **View Guidance & Plane Controls** disclosure.
- **Live state:** resolution, refinement state, retry, context loading/failure and player loading/error/blocked-autoplay state stay outside the closed disclosures. Successful playback and loaded stills remove the redundant ready message. Parent cut-face work owns the refinement state and Retry Detail action.
- **Labs:** **Model Notes** and the existing **Probe Settings** or **Image Settings** form a compact secondary row. Method and preset notes move inside Model Notes; the CT-derived-simulation qualifier stays visible in its summary. Keyboard controls, steering controls, image modes and image progress remain available as before.
- **Shared controls and storage:** Echo and Lab pages label the shared brightness/windowing disclosure **CT Display**. A completed cache becomes a compact “CT Slice Cache Ready” row with expandable **Storage Details**. Download progress and pause/resume remain visible while relevant. Expanded storage details retain file counts and transferred size; this change does not alter download behavior.
- **Readability:** disclosure summaries retain a 44 px minimum height and the existing readable text size. Narrow layouts wrap qualifiers and stack the lab secondary row. The older duplicate TEE orbit hint and repeated footer branding are suppressed in these workspaces.

The About dialog also removes a stale statement describing a spine opening; it now describes the existing intact skeleton fit.

## Files

- `public/echo.js` — template and presentation-only media/context status changes. Renderer and cut-face lifecycle changes in this same file belong to the separate v42 defect fix.
- `public/probe-lab.js`, `public/tee-lab.js` — templates only.
- `public/workspace-compact-v35.css` — scoped v42 styles at the end of the existing stylesheet.
- `page.html` — shared settings/download markup and About text.
- `public/app.js` — `syncUltraCacheStatus()` presentation only.
- `tests/workspace-layout-v35.mjs`, `tests/tee-atlas-ui.mjs` — relevant DOM assertions and two verified stale harness assumptions corrected as described below.

## Verification

Commands were run from the checkout with LinkeDOM at `{local-workspace}/test-deps/node_modules/linkedom/esm/index.js`.

| Command | Result |
| --- | --- |
| `node tests/tte-atlas-ui.mjs <linkedom-path>` | Passed all eight controller/camera checks, including all TTE selections and source switching. |
| `node tests/tee-atlas-ui.mjs <linkedom-path>` | Passed all 28 selections, accepted/unavailable probe states, source-plane review retention, review switching, stale-work rejection, CT visibility, source retry and TTE restoration. |
| `node tests/workspace-layout-v35.mjs <linkedom-path>` | Passed 7/7. Closed disclosures preserve all evidence hooks; live status, retry and source links remain outside. Controlled header/wrapping/fullscreen/tablet sizing checks passed. |
| `node tests/echo-reference-player-v39.mjs <linkedom-path>` | Passed player identity/readiness, stale-event rejection, buffering/retry, autoplay-blocked state, original-frame TEE media and representative-angle checks. |
| `node tests/tee-app-v26.mjs <linkedom-path>` | Passed 4/4 tab ownership, shared settings, reset/state and lazy-module lifecycle checks. |
| `HEART_DOM_MODULE=<linkedom-path> node --test tests/probe-keyboard-controls.mjs` | Passed 13/13 keyboard, held-key, multi-touch, focus, saved-pose and cancellation checks. |
| `node --check` for `public/echo.js`, `public/probe-lab.js`, `public/tee-lab.js`, `public/app.js` | Passed. |
| `git diff --check` for the UI files and focused tests | Passed. |

These are controller/DOM and controlled-rectangle checks, not a claim of browser pixel-layout verification. Browser review belongs to the integrated v42 QC pass.

### Baseline harness corrections

Both original failures were reproduced against v73 commit `831198eeede3a6e0afac12fc644e4862e60527b9`, using its original Echo/Probe/TEE modules and page markup in a scratch fixture before changing the assertions.

1. **Workspace sizing:** the removed `--echo-screen-height` property returns `undefined` in the installed LinkeDOM instead of the browser empty-string sentinel. The assertion now requires the desktop sizing declaration to be absent from the element's style. It still detects failure to release desktop sizing on small screens.
2. **TEE probe availability:** the original test demanded that every overlay pose equal `acquisitionPose`. v73 can preserve a source section when the fixed tract cannot accept its instrument pose. The overlay keeps a reference-context estimate internally while suppressing its probe and sector. The test now verifies both branches: accepted poses retain identity and visible instrument/sector; unavailable poses retain their source plane, hide the instrument/sector, preserve unregistered context, present the unavailable reason and keep the anatomical review inside Model Details. At least one view from each branch must be exercised. No production acquisition geometry was changed to satisfy this test.

Original failure logs are in `{local-workspace}/echo-ui-v42-baseline/` for the active session.
