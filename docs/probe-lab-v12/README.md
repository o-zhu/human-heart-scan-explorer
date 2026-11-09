# Probe Lab v12 — compact instrument and visible chest context

## What changed

The reference chest is now a dedicated, always-visible left column. The measured
heart and matched simulated-ultrasound/CT pane occupy two equal columns beside
it. Four starting-plane buttons remain visible above the workspace; the two
interaction buttons remain prominent above the paired views. Secondary movement,
imaging and display adjustments live in a collapsed **Probe settings** panel
below. On narrow screens the chest sits above the comparison and the two visual
panes stack only at phone widths.

The main instrument illustration is **0.40 times its former linear dimensions**.
The WebGL and software paths share this display scale. Scaling occurs about the
acoustic tip, so the source-plane origin, orientation, contact coordinates,
imaging depth and sampled sector are unchanged. The reference chest instrument
uses 0.45 instead of its previous 0.75 scale. The instrument remains explicitly an
illustration, not a true-scale device or vendor CAD model.

The heart camera accounts for the compact handle instead of reserving space for
the old full-size handle. The separate chest camera fits the rib cage to its
panel aspect ratio, retaining the ribs, spine and reference heart in view. Outer
shoulder skin can continue offscreen as a backdrop. BodyParts3D / DBCLS attribution
and the brief **not donor-registered** qualification remain visible.

Fullscreen belongs to the host application's `#probePanel`, containing the chest
and both paired panes. The Probe stylesheet preserves the new labeled Fullscreen
button and provides standard/WebKit fullscreen layouts.

## Escape release

The prior release handler did not cancel a pending native pointer-lock request.
It also left the workspace armed and focused after native release, and did not
explicitly release the steering pad's pointer capture. These states could make a
late grant or another click appear to require a second Escape.

The new capture lifecycle records explicit capture intent and a request epoch.
One Escape invalidates that intent, clears held keys, releases any steering-pad
pointer capture, clears focus on the control target and switches to Orbit mode.
A late grant immediately exits; late Promise results do not restore control or
replace the released-state message. A browser-native unlock that supplies only
`pointerlockchange`, without a DOM keydown, follows the same release path. Blur
and module departure also cancel outstanding intent. A new explicit Control
button gesture can acquire control on its first click.

The module never requests fullscreen exit. An Escape outside an owned control
interaction remains available to the host/browser. If native capture is missing
or denied, Probe settings opens and focuses the steering pad as the fallback.

Browser API contract used:

- [MDN: Pointer Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_Lock_API)
- [MDN: Element.requestPointerLock](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestPointerLock)

## Verification

Run from the repository root:

```sh
node --test tests/probe-lab-v12.mjs
python3 tests/probe-lab-v12-native.py
```

The DOM test accepts `--dom=/absolute/path/to/linkedom/esm/index.js` when Linkedom
is installed outside the default test location.

All **11 tests pass**, covering actual production event handlers for active,
pending, native-only and fallback release paths; explicit reacquisition; no
fullscreen exit calls; preserved source geometry for all 12 starting planes
across the three retained donors; matching WebGL/software instrument transforms;
and reference-rib framing across portrait and landscape aspects.

`verification.json` records these checks. `shader-verification.json` records
compilation and native EGL rendering of the exact production geometry shaders.
`geometry-review.png` shows the original and compact instrument in the same
camera, plus the new front/oblique reference views. The compact instrument covers
15.37% of the original's foreground pixels in that fixed camera. That is a
controlled illustration comparison, not a measured browser performance result.

The geometry image was visually inspected. No Site browser, browser automation
substitute, or browser-based page screenshot was used. These checks do not verify
browser permission prompts, actual fullscreen/pointer-lock behavior on each
browser, rendered CSS pixel layout or GPU performance.

## Preserved data paths

No measured source data, density threshold, contact geometry, source-plane
registration, fine-source loader or ultrasound acoustic calculation changed.
The existing CT color call now imports `capAnatomyColor` under its prior local
name to consume the shared v12 display-only highlight compression; the Probe
image sampling and simulated-ultrasound calculations are unchanged.
