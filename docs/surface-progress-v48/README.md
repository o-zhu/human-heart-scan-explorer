# Stable surface progress and page suspension — v48

The requested loading behavior supersedes the earlier instruction to turn a
completed download bar into an indeterminate preparation animation. A single
determinate progress element now remains in the same panel throughout the
operation. Download completion is distinct from complete-model readiness.

## Cause of the flashing display

The earlier worker callback switched the bar between a measured download
fraction and an indeterminate value every time a compact block moved through
download, inflation, verification and decoding. The complete transport has 32
blocks, so the loading text and bar repeatedly changed appearance. The different
text lengths also changed the panel height. Cleanup and graphics preparation
then removed the progress value again.

`surface-load-progress.js` gives each operation one revision-bound progress
state and one visible presentation owner. Individual block events stay in the
same “Loading surface” stage. Only explicit final verification and subsequent
complete-model phases advance the displayed stage. Generic `verify-surface`
messages are deliberately insufficient: the bounded hashing helper also uses
that label while checking individual block payloads.

The bar combines measured transfer/upload counters with completed preparation
boundaries. Its weights represent progress through the work, not elapsed time,
an ETA, the percentage of all bytes, or a guarantee that the device can retain
the completed model. Download and bounded GPU upload account for the first
78%; explicit final verification reaches 86%; cleanup, interior preparation,
graphics preparation and the first frame occupy the remainder. Only the
controller's successful completion signal reaches 100%. When the requested
surface is being displayed, completion waits for its first GPU presentation.
If the user selects incompatible volume settings before that first frame, the
verified surface is retained without blocking loading indefinitely; its first
actual presentation still has a separate GPU completion check.

Within one request, retransmission, transport fallback and late phase events
cannot move the bar backwards. A new explicit choice or retry starts a new
revision and resets progress. Neither the helper nor a progress event can
authorize installing partial geometry; the existing complete-model checks
remain the controller's responsibility.

## Presentation and accessibility

The loading status reserves two short lines. Its stage, byte count and progress
bar update in place without replacing the panel or changing its title. The
current source badge remains responsible for identifying the geometry actually
visible. Compact/volume choices remain usable during loading; their actions
share a row and retain 44-pixel touch heights on devices with a touch pointer.

One live region announces stage changes. Byte counter updates do not announce
every network chunk, and the detailed Settings status is not a second live
announcement while loading. The separate interior preparation notice is hidden
while the primary surface loading panel owns that work. Error text can expand
normally after the operation stops.

## Hidden tabs and page-cache restoration

The selected workspace is retained separately from effective work priority.
Surface work is active only when Reconstruction is selected, the document is
visible and the page is not suspended by `pagehide`. Visibility and page-cache
events pause the existing worker, cleanup preparation and active-work watchdog.
Returning to the page resumes that same request. A `pageshow` event cannot
override an active lab, restart an explicitly canceled request or create another
automatic Ultra attempt. Browsers that omit `visibilityState` preserve the
existing visible-page behavior.

## Verification

`tests/surface-load-progress-v48.mjs` exercises 32 interleaved blocks,
retransmission and larger fallback counters, stale revisions, malformed progress,
stage ordering, pause/resume and stable bar/live-region behavior. The existing
surface-controller suite adds actual DOM/controller coverage for visibility,
page-cache restore, decoded results received while hidden and explicit
cancellation during suspension. Its previous indeterminate-progress assertion
now checks the persistent determinate bar during blocked interior preparation.

The controller suite also exercises the acknowledged worker/GPU stream with a
padded HFM layout and tiny attribute chunks, without allocating a complete
large model. Controlled GPU fences verify that acknowledgement waits for both
graphics completion and workspace priority. Cases cover complete interior
gating, cancellation during cleanup and before the first frame, context loss,
corrupt/incomplete completion, a worker sending ahead of its acknowledgement,
stale chunks, first-frame errors, and a change to volume settings followed by
later surface presentation. A captured late first-frame callback after
cancellation is explicitly checked. Actual source decoding and complete-model
identity checks belong to the separate worker/asset tests.

These tests verify operation ownership and presentation, not physical iPad
memory limits, browser process survival or graphics-driver behavior.

```sh
node --test tests/surface-load-progress-v48.mjs
node tests/fine-surface-controller-v19.mjs /path/to/linkedom/esm/index.js
```
