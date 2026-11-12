# Compact lab controls and paired steering views — v49

This updates the v47 small-window presentation in response to the requested
denser controls and simultaneous visual feedback during steering. Model data,
accepted probe poses, sampling, rendering quality and Ultra loading are unchanged.

## Paired visuals while steering

The existing `lab-controls-open` state changes **Both** from two stacked rows to
two columns on phones and portrait tablets. Closing Steer restores the prior
stacked layout. Selecting **3D Heart**, **Image** or TTE's **Chest** remains an
explicit single-pane choice; opening Steer does not override it. This is a CSS
layout change, not a second probe state or a new presentation preference.

The existing workspace height fitter still owns the complete visual/dock height.
No resize or mode transition resets a probe or reinstalls a canvas. The narrow
paired image keeps its simulated/CT-derived qualification, with shorter spacing
and the optional acoustic frequency/depth overlay hidden while the pair is shown.

## Density and touch targets

The compact controls use the shared `--ui-control-height` and `--ui-font-size`
tokens with independent safe fallbacks. A coarse pointer imposes a 44px control
height, including a touch tablet with a primary trackpad. Precise small-window
layouts can use the shared 36px control height. Native selects retain 16px text
on touch devices. This avoids making the whole page a scaled surface or disabling
user zoom.

Steering keys no longer impose the old 52px minimum. They keep their semantic
arrow and action label with tighter spacing. At the narrowest widths or in the
landscape side dock, the two hands still stack to preserve usable key widths.
The dock is capped at the lesser of 36dvh, 268px, and the workspace height minus
its existing 160px visual reserve, with a 120px floor for unusually short layouts.
The optional settings remain scrollable when space is insufficient.

TEE Lock and Reset share a row above its keys. Their actual controls are moved in
that focus order and restored to their original desktop positions on exit. The
duplicate Probe Controls heading is hidden in compact presentation; the dock
retains its accessible TEE/TTE probe-control name. The two optional TEE folds share
a row when closed and expand to the available width when opened.

## Press-and-hold surface

Only `.probe-control-key`, `.tee-control-key`, `.probe-steer-pad` and their
descendants disable text selection and the WebKit touch callout. The controls
also use `touch-action: none`. Explanations, source citations and other page text
remain selectable. The lab event-handler changes separately reject selection,
drag and context-menu gestures on these dedicated input surfaces.

## Verification

The compact lab suite uses the actual TTE/TEE templates and responsive helper.
All 13 cases passed, including the new checks that opening and closing Steer,
then resizing between phone and tablet, preserves each selected pane and the
entire probe state. Existing cases cover original-node restoration, key holds,
pointer release, donor presets and accepted-pose Chest rendering. LinkeDOM does
not establish pixel layout or physical iOS behavior; responsive browser review
is performed at integration.

```sh
HEART_DOM_MODULE=/path/to/linkedom/esm/index.js node --test tests/lab-compact-v47.mjs
```
