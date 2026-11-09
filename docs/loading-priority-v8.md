# Responsive loading, version 8

The version 7 full-bank download started when the Ultra section manifest arrived,
even if the preview volume was still loading. It could use all three section
transport slots. Its scheduler knew about selected orthogonal sections but not
initial volume preparation, oblique fine-plane sampling, movies or input gestures.
Opening the persistent cache also walked every stored response header, and a
selected cache hit/write could start or await that inventory.

## Current behavior

- The app opens `scanActivity` only after the first usable volume is installed.
  The automatic full-bank cache inventory and image downloads wait behind this
  gate. Fetching a small source manifest does not start the image bank.
- Volume loading and preparation, explicit current section requests, fine oblique
  sampling and the app's registered foreground work hold a shared activity budget.
  Every hold releases on success, cancellation and failure.
- Pointer gestures, keyboard input, scrolling and captured-cursor movement suspend
  optional bulk downloads. The listeners are passive and do not change the user's
  input behavior. A lost focus releases a held pointer so it cannot leave the
  downloader permanently paused.
- Nearby-image warming can resume after 180 ms of quiet. The full collection waits
  for 1.8 seconds of quiet, uses one low-priority transfer, and leaves a 400 ms gap
  after each bulk transfer. Explicit current images retain the foreground slots.
- A selected image can join a bulk image already downloading. Selection subscribes
  before pausing background work, avoiding an unnecessary abort and second fetch.
- Whole-bank inventory uses immutable, versioned manifest keys and their declared
  byte lengths. It does not open every expected response body. Selected reads still
  validate the actual blob size and repair a damaged entry. Foreground cache reads
  and writes do not initiate or wait for a complete inventory. Inventory yields
  between groups of 32 entries and can pause when foreground work starts.
- Existing encoded files remain available. The original donor keeps the v6 cache
  name, preserving downloads from earlier versions. Each additional donor supplies
  separate section and fine-volume cache names, manifest URLs and pause preference.
- Collection completion still means the encoded files have committed to persistent
  storage. No whole-bank image decoding or unbounded RAM cache was introduced.
  Cache, quota, save-data, hidden-page and offline handling remain in place.

The app reports `loading-viewer`, `foreground` or `interaction` when the automatic
download is yielding. These are automatic pauses; a user pause remains independent.

## APIs

```js
import {scanActivity} from './download-priority.js';
scanActivity.setViewerReady(false); // changing/opening a source
scanActivity.setViewerReady(true);  // first usable render is installed
const release = scanActivity.beginForeground('current-view');
try { /* selected view work */ } finally { release(); }
```

`VolumeLoader` and `UltraVolumeSource.samplePlane()` already hold this budget.
`HostedSectionStore` accepts `manifestUrl`, `cacheName`, `pauseKey` and `activity`.
`UltraVolumeSource` accepts `manifestUrl`, `cacheName` and `activity`. Native display
spacing for section results and arbitrary reformats comes from the selected
source manifest instead of assuming the first donor's 79.4 µm spacing.

## Verification

`node --test tests/loading-priority-v8.mjs` passes 11 tests against the actual
scheduler, cache, store and volume-source classes. They cover startup readiness,
foreground volume priority, gesture preemption, current-image reuse, single-slot
pacing, cancellation/error release, current-cache access during a paused inventory,
cheap resume inventory and damaged-entry repair, separate donor caches, fine-plane
source configuration, passive input listeners and native-spacing plane sizing.

The existing prefetch suite passes 19 checks, the collection suite passes 16 checks
(updated to require one idle transfer), and fine-volume lifecycle tests pass five.
The fixtures demonstrate zero optional inventory/network work before the readiness
gate and zero response opens during a 96-entry immutable-key inventory. These are
functional concurrency and I/O checks, not a browser frame-rate or download-time
benchmark. No browser automation was used.

`node tests/app-boot-v8.mjs /path/to/linkedom/esm/index.js` passes eight additional
checks executing the actual app and appearance-controller startup logic with
controlled I/O and a DOM fixture. Before the first usable volume, only the main
manifest and preview worker request start. The checks also cover an early
resolution change, first-load failure/retry, rapid tab reversal while module
metadata loads, module entry during high-detail refinement, and saved-view results
arriving after a newer user choice. Optional initialization now follows any first
successful volume, and stale tab transitions cannot re-enter a previous module or
restore its camera over the current view.

The eighth regression check keeps the Pause action stable while an automatic
interaction or foreground yield is active. Only an explicit user pause or a
recoverable blocked state offers Resume, including after pointerdown on the
download button itself.
