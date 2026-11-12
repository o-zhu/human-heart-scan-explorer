# Mobile memory, compact controls and ultrasound playback

## Mobile loading diagnosis and resource policy

The reported crash occurs after whole-heart surface transport, at the prepared
interior gate. The v29 transport is compact on the network, but preserves the
large original geometry. Its manifest declares 131,645,142 compressed bytes,
437,470,524 decoded bytes, 12,837,189 vertices and 70,856,055 indices (23,618,685
triangles). The same geometry also needs GPU buffers. Detached-component flags,
reviewed masks, local interior surfaces, resident scan data, graphics targets
and section caches add to that working set. This is a concrete large-allocation
path consistent with the reported mobile termination, not an on-device crash
trace or a measured universal iOS memory limit.

`public/device-resources.js` resolves a conservative policy before surface
transport. iPhone/iPad/Android devices, desktop-identified touch iPads, and
devices reporting at most 4 GiB use a bounded surface profile. Missing
`deviceMemory` alone does not identify a desktop or guarantee available RAM;
the iPad check uses Window touch information, and the policy is passed to
workers which do not expose the same information.

| Surface | Download bytes | Decoded bytes | Triangles |
| --- | ---: | ---: | ---: |
| Full Ultra-High Fidelity | 131,645,142 | 437,470,524 | 23,618,685 |
| Mobile Detail (existing polished detailed surface) | 17,722,926 | 34,679,172 | 1,986,313 |
| Compact Detail on devices reporting at most 2 GiB | 4,406,836 | 8,562,920 | 497,714 |

The mobile surface has a smaller geometry working set; these figures exclude
the rest of the application and are not measured total tab memory. The older
polished surfaces can remove small folds and thin structures. Their actual
79.4 micrometre source spacing is retained, and their lighter presentation is
explicitly named. They are not labeled the finalized Ultra model. Source arrays,
donor coordinates, CT section data and original scientific collections are not
changed.

Saved or explicit Ultra selections are resolved before any large worker request.
The decoded budget is checked both on the selected manifest and every decoder
path, including preserved-source fallback. Automatic device adaptation does not
overwrite the user's saved desktop selection. The complete reviewed interior
pipeline is not started for the smaller surface. The large reviewed lumen-mask
collection is optional on these devices; the existing base-volume cleanup remains
independent. Failed installed meshes eagerly release their graphics allocations
before the interactive-volume fallback resumes.

The resource policy also declares bounded rendering and fine-data caches. All
budgets are display/runtime choices and do not alter source spacing or acquisition
geometry. A narrower desktop window is a layout decision, not by itself a reason
to reduce the selected scientific surface.

The mobile fine-data worker receives the Window-resolved policy rather than
reclassifying an iPad as a desktop Mac. Its decoded brick cache is 64 MiB (48 MiB
on low-memory devices), prepared plane and returned-raster caches are 16 MiB each
(12 MiB low-memory), and hosted sections retain 32 MiB (24 MiB low-memory).
Foreground fine-brick concurrency is four (two low-memory), with one speculative
job. Hosted sections use two concurrent jobs. Oversized rasters still satisfy
their current request without becoming an oversized retained cache entry.
The graphics output is capped at one million pixels and pixel ratio 1.5 on
constrained devices. Source sampling and geometry are unchanged.

The optional clinical workbench uses a 64 MiB frame cache (48 MiB low-memory),
warms only the next frame when a pair fits the budget, and retains selected source
bytes unchanged. A selected frame larger than the cache budget is returned to
the renderer without being retained as a replay cache entry. Desktop clinical
cache behavior remains 192 MiB with the existing four-neighbor runway.

## Compact viewport controls

`viewport-controls.js` measures the shared 3D pane, rather than assuming that a
wide browser always has a wide viewer. A pane at most 850 CSS pixels wide or 550
pixels high moves its existing overlays into a 44-pixel bottom-right menu button.
The menu is bounded and scrollable; touch targets remain at least 44 pixels.
The original elements are moved, never cloned, retaining their handlers, values,
and workspace-specific hidden states. Comment markers restore their original
locations when the pane grows. TEE starting-view overlays follow the same menu;
TTE starting views remain outside the canvas where they already reside.

Escape, outside pointer interaction, focus leaving the menu, and the Detail
action dismiss the menu. Nested popovers close with it. Resize/fullscreen and
Reconstruction/Echo/TTE/TEE reparenting preserve the shared canvas and controls.
The observer watches direct workspace children, avoiding per-frame status text.
Fine-model loading uses a maximum 300-pixel toast with a 13-pixel title, 12-pixel
status and 3-pixel progress bar. Compact panes place it in the top-left corner.

## Ultrasound reference player

Each embedded source selection receives a fresh iframe with its URL assigned
before insertion. The former clear-src/reuse sequence could race a queued empty
document navigation. An iframe load event alone no longer counts as a ready
video: the YouTube player API's ready/play/error events own the visible state.
Stale selection callbacks cannot activate a later view. Timeouts expose Retry
and the original source link, with a dark loading state instead of a white frame.
The API has an 18-second startup deadline. A separate 25-second deadline covers
video startup and buffering after readiness; repeated buffering events cannot
extend it. A failed player is stopped, detached and destroyed. Deliberate pause,
cue, end and blocked autoplay are respected, including a state whose event is
still queued. This second guard was added after live Chrome showed a ready
YouTube player waiting indefinitely for video data.

Native and embedded players request muted inline autoplay. Browser policy can
still require a user Play gesture; the controls and status explain that state.
Every selected source has a visible publisher link immediately below the player.
The original full-frame default was superseded by the requested Fit Ultrasound
default on November 12, 2026. Sources with reviewed `focusAspect` metadata now
open in that fit; **Full Frame** remains available for the current selection.
A new source or newly opened view resets to Fit, while ordinary updates,
catalog refreshes and retries preserve an explicit Full Frame choice. Local
movies and other sources without reviewed crop metadata remain uncropped with
`object-fit: contain`; no crop is invented from their dimensions. The 26 native
TEE scanner-dial bounds reviewed in v56 remain inside the existing 1.4 Fit crop.
The ME five-chamber and ME modified bicaval TV recordings receive a
clearly labeled guideline-reference range indicator. Its pointer is the range
midpoint, not a measured or reconstructed acquisition angle. The text states that
the acquired angle is not displayed in that source clip.

The reference ranges are 0–10 degrees for ME five-chamber and 50–70 degrees for
ME modified bicaval TV, from the existing ASE-backed view definitions. No new
movie is represented as an original ASE supplemental recording, and no source
media or source-angle pixels are edited. Existing bundled movies and publisher
streams remain in use; this change does not newly download or rehost TECHmED
YouTube recordings or other publisher videos.

## Focused verification

```sh
node --test tests/device-resources.mjs
node tests/fine-surface-controller-v19.mjs /path/to/linkedom/esm/index.js
node tests/lumen-cleanup-v23.mjs /path/to/linkedom/esm/index.js
node --test tests/mobile-resource-integration.mjs tests/renderer-camera-v17.mjs
node tests/viewport-controls-v39.mjs /path/to/linkedom/esm/index.js
node tests/echo-reference-player-v39.mjs /path/to/linkedom/esm/index.js
node --test --test-name-pattern='current phase|late worker|rapid foreground|decoded frame|mobile clinical|oversized selected' tests/clinical-v19.mjs
```

The controller regression exercises actual selection logic, a saved Ultra
preference on a desktop-identified iPad, absence of large surface/interior
requests, oversized manifest rejection before decoder allocation, successful
smaller-surface activation, and graphics resource release on failure. Existing
desktop atomic model activation, cancellation, source identity and fallback
checks remain covered. These controlled fixtures are not physical iOS tests.

Root verification passed 32 policy/worker/renderer checks, 41 surface-controller
checks, five compact-control checks, six clinical scheduling/cache checks and
six existing exact lumen-mask/cleanup checks. The additional delegated cache,
scheduling and rendering regression group passed 82 checks. These groups overlap
and should not be added together as a unique-test count.
The focused source-player regression also passed, including fresh-frame
identity, real API readiness, autoplay blocking, stale callbacks, timeout/error
recovery, same-ID URL changes, full-frame TEE display and both range dials.

Broader pre-existing fixtures were not used to claim a fully green repository:
the workspace-v35 LinkeDOM check expects an empty string for a removed style
property where this emulator returns undefined; the TEE-atlas UI test stops at
an unrelated transgastric geometry expectation; an Ultra motion test requires
an absent local source manifest; and the exact-raster comparison includes extra
metadata absent from its normalized plane. The historical v6 playback fixture
expects paused initial playback, which this request explicitly changes.

## Live verification

The published update was checked in the available cloud Chrome browser. Its
814-by-691-pixel main viewer and smaller Echo/TEE panes used one closed menu
button, and the menu exposed the original controls. Escape closed it; switching
Reconstruction/Echo/TEE restored the correct workspace controls, including TEE
starting views. Both supplemented publisher TEE movies reached readyState 4,
advanced their playback time, looped and reported muted=true / paused=false.
Their full frames, reference dials and visible source links were inspected.
Rapid TTE LV/RV changes and still-to-cine re-entry produced fresh frames and
API readiness without displaying a white empty document.

This browser did not expose WebGL 2 or fullscreen, so its anatomy inspection used
the existing software volume fallback. GPU installation, mobile resource gates,
large-pane restoration and failure cleanup are verified with controlled tests,
not a claim of physical iPhone/iPad, Safari GPU or live fullscreen testing.

## Browser engineering references

- [WebGL best practices: conservative memory budgets and eager resource deletion](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)
- [Navigator.deviceMemory: limited availability and approximate reporting](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/deviceMemory)
- [WebKit device-memory discussion](https://github.com/WebKit/standards-positions/issues/645)
- [YouTube IFrame API ready, playback, error and autoplay-blocked events](https://developers.google.com/youtube/iframe_api_reference)
- [ASE/SCA comprehensive TEE examination reference](https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf)

Browser memory reporting does not provide a portable per-tab or GPU memory
allowance. The implementation deliberately avoids interpreting a missing API,
the network file size, or nominal installed RAM as proof that the full model fits.
