# Compact TTE and TEE Labs — v47

## Behavior

The previous small-window layout stacked two independently tall image panes, then the chest or full steering console. The new presentation gives the available height to the active visual and keeps steering one tap away.

- Compact mode applies at width ≤ 1050 px, height ≤ 760 px, or any coarse pointer. The `any-pointer` condition also covers a large iPad whose primary pointer is a trackpad. Desktop keyboard hints remain available when its primary pointer is precise.
- Phones at width ≤ 600 px start with **3D Heart**. Wider compact layouts start with **Both**. A native **Visible panels** selector also exposes **Image**, and TTE exposes **Chest**. A chosen panel survives subsequent resizes. Both uses two bounded rows on phones and portrait tablets up to 900 px wide, giving the ultrasound a broad readable pane; larger or landscape layouts use two columns. The native toolbar remains one row.
- A native **Starting view** selector follows the actual preset buttons, including the donor-specific geometric labels and fitted TEE model angles. Selecting it invokes the existing `selectPreset` path.
- **Steer** opens the original touch/keyboard controls in a bounded, scrolling dock. Opening it reallocates the workspace height instead of pushing the visuals far above the controls. In a short landscape window at least 640 px wide, the dock sits beside the visual.
- Steering buttons use semantic arrows and action labels, 52 px minimum targets, accessible names and the same continuous-hold handlers. The toolbar, camera actions, image-mode buttons and fold summaries retain targets of at least 44 px. Redundant keyboard legends disappear in compact mode; physical shortcuts continue working throughout the active lab.
- At width ≤ 360 px, and in the narrow side dock of a short landscape window, the steering hands stack with labels beside their keys, keeping each touch target wide enough. Very short landscape layouts omit the optional frequency/depth line over the image while retaining its simulated/measured qualification.
- TEE depth and angle sliders and camera options are folded until needed. TTE mouse-capture options are retained in View Options. Model Notes and detailed image/probe settings remain available below the workspace in compact disclosures.
- The image type, CT-derived qualification and fine-plane status remain visible. The scientific distinction between measured anatomy and illustrative context remains in Model Notes.

## Controls and rendering invariants

`public/lab-compact-v47.js` moves the original nodes and leaves comment markers at their desktop positions. It does not clone controls, IDs, listeners or probe state. Returning to a large window restores those exact nodes. Closing the dock, changing panels or crossing a layout breakpoint releases held pointer capture and keyboard steering. Focus moves out of hidden controls.

Only the TTE Chest presentation needs a rendering change: `ProbeLabModule.drawGuide` can render its independent torso camera directly from the accepted frame when the main 3D canvas is hidden. It uses the accepted frame's pose and state, keeping the chest probe, cut face and corresponding image aligned. The hidden compact chest does not receive the otherwise redundant main-view render call. Camera movement, data sampling, fine streaming and anatomical calibration are unchanged.

## Fitter contract

The helper adds `.lab-compact-toolbar` immediately before the workspace and `.lab-compact-dock` as its last child. The panel has `.lab-compact`, optional `.lab-touch` / `.lab-controls-open`, and `data-lab-view="scene|image|both|chest"`.

`--lab-workspace-height` bounds the visual plus dock. The dock is limited to the lesser of 40 dynamic viewport height units, 300 px and the workspace height minus a 160 px visual reserve (with a 120 px dock floor for very short layouts). The landscape side dock instead uses the full available height. `labcompactlayoutchange` bubbles on relevant changes so the shared fitter can measure the actual workspace top. Per-frame status text does not initiate layout measurement.

Load `lab-compact-v47.css` after the existing workspace styles. Root changes in `page.html` and `workspace-layout-v35.js` provide stylesheet loading, toolbar/dock observation and compact height fitting.

## Verification

```sh
HEART_DOM_MODULE=/tmp/heart-v47-test-deps/node_modules/linkedom/esm/index.js node --test tests/lab-compact-v47.mjs tests/probe-keyboard-controls.mjs tests/tee-keyboard-controls.mjs
```

Result: **38 tests passed** (11 compact layout/state regressions and 27 existing lab keyboard, touch-hold, precision, cancellation, lock, preset and bookmark regressions).

JavaScript syntax and diff whitespace checks passed. CSSOM parsed all 90 stylesheet rules and at-rules without a syntax error.

The compact tests exercise the production module templates and event handlers. They cover phone-first visuals, mixed touch/trackpad eligibility, original-node restoration, unchanged acquisition state when switching panes, native preset synchronization, pointer release when controls hide, keyboard access while the dock is closed, retained TEE sliders, and accepted-pose Chest rendering without main-canvas dimensions. LinkeDOM supplies no rendered geometry or WebGL; visual browser verification is performed separately in the shared preview.
