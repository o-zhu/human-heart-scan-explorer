# Startup and rapid-scroll decode scheduling

## Findings

Two scheduling gaps remained after v15:

1. The local-neighbor gate checked whether the first view was usable but did not
   check whether volume refinement, cleanup, anatomy or another module was still
   doing expensive foreground work. Up to two native neighbor decodes could
   compete with those jobs immediately after the preview appeared.
2. Aborting a transport request rejects its UI promise immediately, whereas an
   already-started `createImageBitmap()` operation cannot be interrupted. The
   main-thread task count therefore did not bound physical codec work in the
   worker. Fast skipped-section requests could accumulate several native decodes
   even though the store reported at most three active tasks.

The old constant-stride benchmark did not expose the second problem: it modeled
abort as stopping the codec, used small synthetic crops, and advanced one section
at a time. The new fixture uses actual donor crop dimensions, variable 3–8-section
strides, fast reversals and production-style immediate transport cancellation.

## Changes

- `ScanActivity.allowLocalPrefetch` permits preparation during section gestures,
  but closes while volume, cleanup, anatomy, fine-plane or module foreground
  work is active. Explicit selected-section requests retain priority.
- During rapid skipped-section movement, the local plan follows the observed
  direction/stride and estimated codec interval. It has at most five predicted
  neighbors, one optional local task and no speculative network transfers. When
  movement settles, the usual byte-bounded adjacent runway returns.
- Obsolete queued and cache-read requests are cancelled. Once native decoding
  has begun, its bounded result may finish into the LRU for reversals; it is not
  presented at a different slice. Hidden views, disposal and heavy foreground
  transitions still stop optional work.
- `SectionDecodeQueue` separately bounds physical decoding at two jobs. A
  cancelled caller releases its promise but not the physical slot until the
  native operation actually completes. Cancelled queued images never enter the
  codec. Selected work outranks queued neighbors.
- Main-thread compatibility decoding and low-memory devices use one physical
  decode. The main context passes the memory-tier limit to the worker; unknown
  worker memory reporting cannot silently override that choice.

The existing immutable image URLs, encoded caches, source rasters and decoded
96/48 MiB limits are unchanged. These changes do not require new scan downloads.

## Evidence and limits

`benchmark.json` records six deterministic workloads using all three donors.
Each selects 64 sections with variable strides and reversals at 8 or 16 ms
intervals. Native codec service time is fixed at 40 ms and cannot be cancelled.
The manifest crop dimensions and byte counts are real; WebP execution, browser
rendering, GPU timing and input latency are not measured by this fixture.

| Metric | v15 | v16 |
| --- | ---: | ---: |
| Peak physical native decodes | 6–8 | 2 |
| Total native jobs, 8 ms gestures | 87 | 41 |
| Total native jobs, 16 ms gestures | 131–132 | 66–67 |
| Already-started jobs discarded during input | 60–65 | 0 |
| Speculative network requests | 0 | 0 |
| Final exact image/index check | Passed | Passed |

The physical bound trades unlimited parallel work for predictable work and
memory pressure. In this fixed-service fixture, final exact Ultra delivery
after the last input took **56–72 ms**, compared with **40 ms** in v15. The new
scheduler does not make every unpredictable fast position an instantaneous
Ultra cache hit. It must accompany the responsive registered motion-plane
presentation; holding an old face until every requested Ultra image decodes
would still feel frozen. This is deliberately documented rather than presenting
the queue change as an end-to-end latency improvement.

## Checks

`tests/ultra-motion-v16.mjs` covers the startup gate, overlapping foreground
leases, million-pixel stride/reversal plans, retained native work, cancellation
bursts, priority, actual backend integration, disposal and compatibility mode.
The v15 runway, loading-priority, browser-receiver and v6 prefetch regressions
also pass. No browser automation was used.

```sh
node --test tests/ultra-motion-v16.mjs tests/ultra-runway-v15.mjs tests/loading-priority-v8.mjs tests/browser-receivers-v8_1.mjs
node scripts/benchmark-ultra-motion-v16.mjs
node scripts/verify-ultra-prefetch-v6.mjs
```
