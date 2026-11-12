# Mobile steering gestures — v49

The TTE and TEE keycaps and drag pads are control surfaces. Pressing and holding
them must steer the probe without selecting their labels or opening a native
text callout. Ordinary descriptions, source links and editable controls retain
their native selection and menu behavior.

## Scope and behavior

`ProbeLabModule.bindSteeringSurface` is shared by both labs. It prevents
`selectstart`, `contextmenu` and `dragstart` only on a steering keycap or pad;
events from their nested arrow, action and keyboard labels are covered too.
The matching CSS applies `user-select: none`, its WebKit-prefixed equivalent,
and `-webkit-touch-callout: none` to those controls and descendants. Pointer
gesture policy remains scoped to the keycaps/pads rather than the page.

Suppressing a cancelable long-press menu does not end an intended continuous
hold. If a browser reports a menu that cannot be prevented, the module releases
its active inputs so the probe cannot continue moving behind that menu.

Keycaps focus without scrolling the page. Each pointer owns its original held
key; a duplicate down event cannot add another initial step or replace that
owner. Separate fingers still combine independent steering axes. Synthetic
accessible clicks, keyboard shortcuts, Shift precision and tap steps retain the
existing behavior.

Each drag pad accepts one owning pointer until its own release. A second finger
cannot replace that drag, leak the first capture, or end it by lifting. Ending a
TEE pad drag no longer clears unrelated held keys. If native pointer capture
fails, window-level pointer release/cancel still ends the drag. Blur, pagehide,
visibility changes, reset, restore and workspace exit release active controls;
hidden documents cannot start a new pointer gesture.

These changes do not alter probe kinematics, movement rates, camera behavior,
accepted acquisition poses, fine-plane scheduling or rendering quality.

## Verification

```sh
HEART_DOM_MODULE=/absolute/path/to/linkedom/esm/index.js node --test tests/probe-keyboard-controls.mjs tests/tee-keyboard-controls.mjs
```

All **31 checks passed**. Four new regression cases exercise nested-label
selection/callout suppression, continued motion during a suppressed long press,
actual stop after release or an uncancelable menu, unaffected page prose and
ordinary menus, duplicate/second-touch ownership, another hand continuing after
a drag ends, failed capture recovery, and rejection of hidden-page pointer
starts. Existing lifecycle cases now include pagehide.

The tests use the production templates and event handlers with a controlled DOM
and animation clock. They establish application event/state behavior, not a
physical Safari/iOS callout test. The native text-selection protection also
depends on the scoped WebKit CSS declarations; browser layout review belongs to
the integrated responsive release.
