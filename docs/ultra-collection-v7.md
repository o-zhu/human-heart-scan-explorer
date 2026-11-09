# Complete Ultra section preparation (v7)

## Result

The shared Ultra store now prepares the complete hosted orthogonal image collection automatically after loading its manifest. This supersedes v6's neighborhood-only download policy. The selected cut face and nearby decoded images still receive priority, but idle time is used to save every remaining nonempty image in persistent Cache Storage.

The current manifest contains **1,096 nonempty image files, totaling 507,669,042 encoded bytes**. The other **384 section positions are empty** and are already represented by their local one-pixel empty result. They do not require downloading the shared 34-byte placeholder. There are 1,480 selectable section positions in total.

The implementation reuses the existing `heart-ladaf-hosted-ultra-v6` cache. An upgraded or reloaded page inventories its committed source-version URLs and resumes from the missing files. Progress counts durable writes, rather than requests started or bytes held only in memory. Images from an older manifest version do not count toward the current collection.

## Scheduling and responsiveness

The same priority queue serves current images, decoded neighbors, orthogonal cards and encoded-only collection requests. At idle, the collection can fill all three available transport slots with low-priority fetches. A current request can preempt lower-priority work. Nearby image requests can also preempt collection jobs, so a newly selected neighborhood does not wait behind three distant transfers. A constrained connection uses one task at a time.

If the selected image is already being downloaded for the collection, its consumer joins that transfer. Once the bytes are available, the store decodes those cached bytes; it does not fetch the same image again. Previously focused requests retain v6's short reversal grace period. Background-only collection requests never allocate image bitmaps, canvases or full decoded arrays.

A failed file is retried at bounded intervals while other files continue. Three failed attempts leave a partial result with a visible failure state. Explicit Resume retries the remaining failures. Successfully committed files are retained and skipped. Foreground consumers remain usable when collection persistence is unavailable.

`pauseBackground(true)` now pauses decoded-neighbor warming only. It does not pause the persistent collection, allowing preparation to continue while Echo or Probe is open. The existing cap and card consumer cancellation semantics remain unchanged.

## Storage and limits

| Resource | Policy |
| --- | --- |
| Decoded source images | 48 MiB LRU; selected face protected from speculative eviction |
| Encoded image memory | 12 MiB LRU |
| Queued persistent writes | 16 MiB maximum |
| Persistent source-image cache | 640 MiB, or the manifest total plus 32 MiB if larger |
| Derived 158.8 µm card cache | 12 MiB / 18 entries |
| Normal collection concurrency | Up to 3 available transport slots |
| Slow/data-constrained concurrency | 1 slot |

The manifest's entries are protected from LRU eviction while the collection is being prepared. The downloader cannot evict the start of the collection to make room for its end. Unrelated or superseded entries may be removed to fit the declared persistent budget.

Before preparation, the backend uses `navigator.storage.estimate()` when available to compare the missing collection bytes plus modest headroom with the origin's estimated free quota. Insufficient quota produces a visible `quota` state. A `Cache.put` quota failure also stops collection writes. It does not discard existing complete files or enter an eviction/download loop. Resume rechecks capacity and restarts missing work. Missing or denied Cache Storage produces `storage-unavailable` rather than downloading the whole collection into disposable RAM.

Browser storage remains subject to browser eviction. No persistent-storage permission is requested. The estimates and progress count source payload bytes; browser storage metadata, browser HTTP caching, the 3D volume, GPU textures and other modules' assets have separate costs.

Automatic collection work pauses for hidden pages, offline state, or a reported Data Saver preference. Visibility/connectivity changes resume eligible work automatically. An explicit Resume permits the collection on a Data Saver connection, still using one task at a time. An explicit user pause is retained in local storage when available.

## API for the global progress UI

Existing APIs remain compatible: `setFocus`, `cached`, `hasCached`, `load`, `subscribe`, `getStatus` and `pauseBackground`.

```js
await ultra.startCollectionDownload();       // Normally started automatically by init.
ultra.pauseCollectionDownload(true);         // Explicit persistent collection pause.
await ultra.resumeCollectionDownload();      // Recheck storage; retry missing/failed files.
// pauseCollectionDownload(false) is also a resume alias.

const unsubscribe = ultra.subscribe(({status}) => {
  const c = status.collection;
  showCollectionProgress(c.completedFiles, c.totalFiles, c.completedBytes, c.totalBytes);
  showCollectionState(c.state, c.reason);
});
```

`getStatus().collection` contains:

- `state`: `idle`, `checking`, `downloading`, `complete`, `paused`, `blocked`, `waiting` or `partial`.
- `reason`: for example `user`, `hidden`, `offline`, `save-data`, `quota`, `storage-unavailable`, `network-retry` or `failed-files`.
- `totalFiles`, `completedFiles`, `totalBytes`, `completedBytes`, `activeBytes`.
- `totalSections`, `emptySections`, `failedFiles` and `retryInMs`.
- `persistentLimit`, `availableBytes`, `requiredBytes`, `enabled`, `paused` and `complete`.

`activeBytes` is uncommitted transfer progress and can fall when a lower-priority request is interrupted. `completedBytes` is durable collection progress. The legacy `networkLoads` metric counts completed backend fetch operations; a browser HTTP cache may satisfy those operations, so it is not a wire-transfer counter.

The worker protocol supports an encoded-only load and a manifest configuration/inventory request. The same backend is used when worker decoding is unavailable. Disposal during inventory cannot launch fallback work after the transport is destroyed.

Hosted orthogonal results now also carry `cleaned: true`, reflecting the conservative exterior cleanup explicitly applied by `prepare_hosted_sections.py`. Their pixels and source registration are unchanged; the renderer uses this provenance to avoid applying a coarser cleanup mask to them again.

## Verification

```sh
node scripts/verify-ultra-collection-v7.mjs
node scripts/verify-ultra-prefetch-v6.mjs
```

The 16 v7 checks exercise complete traversal without collection decoding; cross-session resume without repeat downloads; use of all three idle slots; current/nearby preemption; joining an existing encoded transfer; pause/resume; preparation outside Reconstruction; quota estimate and write failures; storage denial; Data Saver and hidden-page behavior; finite retries; the complete real manifest budget; the actual worker's encoded-only protocol; and disposal during inventory. All 19 prior scheduling/cancellation/cache checks also pass.

The fixtures exercise the actual store, transport, worker and cache/backend modules with controlled network and storage behavior. They do not claim a real-device completion time or available browser quota. The full hosted pack was not downloaded again for these tests.

Platform references: [StorageManager.estimate](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/estimate), [StorageManager in workers](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager), [Cache](https://developer.mozilla.org/en-US/docs/Web/API/Cache).
