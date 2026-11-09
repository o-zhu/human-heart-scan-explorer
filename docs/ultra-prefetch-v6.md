# Ultra section scheduling and background cache (v6)

This change makes the existing hosted orthogonal 79.4 µm images available ahead of the user's scrolling. It does not alter the scan images, compression, crop coordinates, source window, anatomical labels, or storage API. The current cut face and 158.8 µm orthogonal cards use the same transfer and full-resolution decoded image.

## Behavior

`HostedSectionStore` owns one priority queue. The current cut face has priority 0. Immediate neighbors are ordered in the scrolling direction, while the other two displayed cards have lower background priority. Explicit card consumers may still request their current images, with priority 30 by default. A selected face can preempt another card's or a speculative network request when all slots are occupied; bitmap decoding already underway can finish.

On an ordinary connection, the initial window includes three sections ahead and two behind the selected section. After 180 ms without a new selection, it can expand to eight ahead and four behind. The current-axis neighborhood is limited to 10 MiB of encoded images. Other orthogonal cards get their current section and, during idle time, one neighboring section on each side. Whole-organ mode warms the three current cards and their nearest neighbors without setting an arbitrary cut face. Only this small window is queued; completing the window does not advance through the rest of the dataset.

Requests for the same axis/index are deduplicated even when a card, the active cap and prefetch all need them. Promoting a prefetched image to the current face does not restart its transfer. Up to two previously focused in-flight requests remain eligible for 320 ms, so a rapid scroll reversal can rejoin the existing request. When a consumer cancels, it stops receiving progress/results immediately, but other consumers of that image remain valid. A cancelled transfer is requeued if a new consumer has joined before the cancellation completes.

Hidden tabs and `pauseBackground(true)` cancel speculative requests. On a connection reporting `saveData`, automatic speculative transfers stop; explicit current images still work. Connections reporting 2G/3G or less than 1.5 Mbps use one simultaneous task, shorter look-ahead and a 2 MiB current-axis neighborhood budget. These connection hints are feature-detected; browsers without them use the normal policy.

## Storage and memory limits

| Layer | Budget | Content |
| --- | ---: | --- |
| Decoded section cache | 48 MiB | Exact cropped grayscale pixel buffers |
| Encoded memory cache | 12 MiB | Compressed WebP blobs |
| Persistent cache | 96 MiB | Compressed WebP responses in the dedicated `heart-ladaf-hosted-ultra-v6` Cache Storage cache |
| Pending persistent writes | 16 MiB, capped by disk budget | Optional writes awaiting the serial cache writer |
| Derived card cache | 12 MiB / 18 entries | Exact alternate source pixels at 158.8 µm |
| Normal task concurrency | 3 | At most 2 purely speculative active tasks |
| Restricted task concurrency | 1 | Current first; no speculation with save-data |

Decoded buffers are evicted by byte size, favoring the selected face and current neighborhood. The selected face is not evicted to make room for speculative images. An image exceeding the decoded cache budget can be returned to its requester but is not retained in this cache. Encoded images use a separate memory LRU. Persistent cache inventory and writes run in the background; an image lookup does not wait for a full cache inventory. Persistent eviction is based on the recorded byte sizes and use order within the session, with stored timestamps used when reopening the cache. Browser quota denial or unavailable Cache Storage falls back to the bounded memory cache.

These budgets cover retained buffers owned by these modules. Temporary image-decoder/canvas buffers, browser HTTP cache entries, renderer GPU textures and the existing 3D volume have their own lifetimes. The implementation does not request persistent-storage permission and never makes the entire roughly 508 MB hosted section pack an automatic download.

## Worker decoding

`ultra-cache-worker.js` fetches, reads persistent/encoded caches, decodes each WebP, draws into `OffscreenCanvas`, extracts the exact red-channel grayscale samples, and transfers the resulting `ArrayBuffer` to the main thread. This avoids a second copy of the decoded grayscale buffer. Source image dimensions are checked before use and encoded byte counts are checked before caching/decoding.

The decoder requests `colorSpaceConversion: 'none'` and `premultiplyAlpha: 'none'`, matching the previous decoder. No interpolation, smoothing, resampling, change of source window or additional lossy encoding is introduced. The cards still select alternate pixels directly, as before.

If Worker/OffscreenCanvas support is unavailable or a worker fails to initialize, the same backend runs in the page. The compatibility path yields between grayscale extraction chunks. It keeps the same priority queue and byte budgets. An unsupported persistent cache is optional and cannot prevent an image from displaying.

The browser fetch `priority` hint is used in addition to the application's explicit queue. Already active requests are promoted by sharing them rather than being cancelled and restarted only to change their fetch hint.

## Integration API

All indices passed to this API are integer section indices in `manifest.sliceCounts`, not normalized positions. `sourceIndex` in returned metadata remains the corresponding s2 index (`4 * index`).

```js
import { UltraSections } from './hosted-ultra.js';

const ultra = new UltraSections();
await ultra.init();

// Call immediately on scrolling, before requesting the selected cap.
ultra.setFocus(axis, sectionIndex, { positions: [ix, iy, iz] });
// Optional explicit direction: -1 or +1. Otherwise inferred from the last focus.

const availableNow = ultra.cached(axis, sectionIndex);
if (availableNow) showCap(availableNow);
else await ultra.load(axis, sectionIndex, { signal, onProgress });

// No active cap: warm current cards only.
ultra.setFocus(-1, null, { positions: [ix, iy, iz] });

// Leaving reconstruction: stop background work and cancel explicit old consumers.
ultra.pauseBackground(true);
ultra.cancel();
for (const controller of cardControllers) controller?.abort();

// The next setFocus call resumes warming, or explicitly resume the prior focus:
ultra.pauseBackground(false);
```

`cached(axis,index)` is synchronous and touches the decoded cache LRU. `hasCached` and `canLoadFromCache` remain compatible with existing callers. `load` retains `signal`, `onProgress` and `cacheOnly`; `cancel` cancels this `UltraSections` instance's explicit consumers while allowing shared card consumers to finish.

`SectionDetail.load(axis,index,{signal,priority = 30,onProgress})` forwards cancellation and priority to the same shared store. Each caller has a separate cancellation subscription, so cancelling an old card does not cancel the cap's request. Derived cards still use exact alternate source pixels.

```js
const unsubscribe = ultra.subscribe(event => {
  updateCacheStatus(event.status);
  if (event.type === 'ready' && isCurrentSection(event.axis, event.index)) {
    showCap(event.result);
  }
});
```

Events have `type: 'status' | 'ready' | 'error'`, a `status` snapshot, and section/result/error fields where appropriate. The listener runs once immediately on subscription. A ready event can describe a prefetched image, so the UI must check the current axis/index before displaying it. The app integration also checks current mode/intent and deduplicates GPU cap updates.

`getStatus()` includes `focus`, `currentReady`, `readyNeighbors`, `plannedNeighbors`, `decodedBytes`, `decodedLimit`, `encodedBytes`, `persistentBytes`, `persistentAvailable`, `decodeWorker`, `active`, `queued`, `cacheHits`, `encodedHits`, `networkLoads`, `preempted`, `saveData`, `slowConnection` and `paused`. `networkLoads` counts completed backend fetch loads; browser HTTP caching may satisfy a fetch, so it is not a count of wire transfers. Download progress reports observed encoded bytes separately from decode/ready stages.

## Verification and practical limits

Run:

```sh
node scripts/verify-ultra-prefetch-v6.mjs
```

The test suite executes the actual store, card loader, encoded cache, transport, grayscale decoder and worker module with deterministic network/storage/pixel mocks. It verifies current-first ordering, directional look-ahead, bounded neighborhoods, whole-organ warming, duplicate requests, fast scroll reversal after all previous consumers cancel, lower-priority preemption, stale callback suppression, per-consumer cancellation, pause/resume, initial metadata cancellation, hidden/save-data/slow-network policies, exact source registration and pixel extraction, hard memory/disk limits, storage-denied fallback, failed-image backoff/retry, truncated streams and worker/fallback output. The machine-readable result is `docs/ultra-prefetch-v6-verification.json`.

These tests establish scheduling and data-preservation behavior. They are not measurements of FPS, first-load latency or cache quota availability on a particular browser. The first uncached image and jumps beyond the warmed neighborhood still require a download and decode. An already decoded neighboring image can be shown synchronously; encoded or persistent cache hits still require decode. Browsers can evict persistent caches, and network conditions can outrun bounded look-ahead.

Relevant platform references:

- [Worker `createImageBitmap`](https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/createImageBitmap)
- [OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas)
- [Cache interface](https://developer.mozilla.org/en-US/docs/Web/API/Cache)
- [NetworkInformation.saveData](https://developer.mozilla.org/en-US/docs/Web/API/NetworkInformation/saveData)
