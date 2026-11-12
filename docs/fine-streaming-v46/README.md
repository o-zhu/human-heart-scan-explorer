# Fine-plane streaming during TTE and TEE interaction

## Cause and changed behavior

The v35 scheduler canceled fine-plane work on every new probe pose and started
another full request only after 190 ms of quiet. Each cancellation also aborted
already-started fine-brick transfers. Rapid steering could repeatedly download
the first portion of the same source blocks without completing enough of them
to refine a section. A stalled fetch or prepared-plane response had no finite
deadline and could leave the loading label visible indefinitely.

The two labs share `ProbeLabModule`, so this update applies to TTE and TEE:

- The resident measured-volume preview still follows the probe immediately.
- Fine-brick transfers now share one bounded queue across samples and warming.
  A new plane subscribes to already-started overlapping blocks. An interactive
  cancellation discards obsolete queued work but lets the few already-started
  blocks finish into the existing bounded cache. An integrity failure cancels
  sibling work. At most the device's existing foreground limit (2–12) is active.
- During motion, one coalesced cache-only reformat runs at most once every
  80 ms. It never waits for a download or returns an incomplete fine image.
  Current-plane warming continues separately, including while input is active.
  A newer pose replaces queued warming; verified transfers already in flight
  remain useful. Warming does not download a second volume or alter the source.
- A fine image is displayed during movement only if it still matches the
  current accepted pose and has complete measured coverage. New resident fine
  reformats use a bounded 640–960-pixel cap. Already-cached coplanar images retain
  their existing cap dimensions, bounded at 1280, instead of immediately being
  reduced to the ordinary 320–448-pixel live cap. Acoustic previews retain their
  lightweight grid. The settled section keeps the existing screen-dependent
  grid bounded to 1280 pixels.
- Source metadata and worker startup have a 30-second deadline. Each physical
  brick transfer/verification/decode operation has a 20-second deadline and one
  timeout retry. Prepared-plane loading has a 20-second deadline. The promises
  settle even when an underlying operation fails to honor cancellation. A
  failure replaces the loading label with an unavailable/retry state while
  preserving the working measured preview.

This supersedes the rule that active steering cannot start current-plane fine
network work. Speculative neighboring-plane warming remains subordinate to
foreground work. Existing source checksums, gzip format, original pixels,
trilinear interpolation, physical planes, donor identity and cache memory
ceilings remain unchanged. These are transfer/scheduling improvements, without
additional lossy compression or invented detail.

## Measured controlled comparison

`transport-benchmark.json` compares the exact v80 backend with this version.
The fixture uses eight nearby but distinct source planes, 40 ms between moves,
four concurrent streams, a first body chunk at 25 ms and completion at 110 ms.
The final plane is checked byte for byte between implementations.

| Measurement | v80 | Updated |
|---|---:|---:|
| HTTP requests | 48 | 16 |
| Canceled transfers | 32 | 0 |
| Bytes received | 538,499 | 269,971 |
| Wait after final movement | 493.8 ms | 130.9 ms |
| Maximum simultaneous transfers | 4 | 4 |
| Retained decoded brick bytes | 574,992 | 574,992 |
| Final scalar output pixels | 16,384 | 16,384 |

In that fixture, the update used **66.7% fewer requests**, received **49.9% fewer
bytes**, and reduced the final wait by **73.5%**. The final pixel SHA-256 is
identical. These are deterministic source-path/transport-fixture observations,
not measured browser FPS, public-server response times, or predictions for a
particular device. A first visit to a new plane still needs its real source
blocks; limited-memory devices may not retain a whole arbitrary fine plane.

Run the comparison against an available previous source revision:

```sh
node scripts/benchmark-fine-streaming-v46.mjs --baseline-ref PREVIOUS_COMMIT
```

Alternatively pass `--baseline-file /absolute/previous-ultra-volume-backend.js`.
The recorded baseline is `0bbbec01150ebb25d2fba932be8643338c8b688d`. That is a
Sites source revision, not a claim that the same commit is present in public
GitHub.

## Verification

The focused 37 backend/worker/store checks and 22 controller checks passed:

```sh
node --test tests/fine-streaming-v46.mjs tests/probe-performance-v26.mjs \
  tests/ultra-volume-v7-lifecycle.mjs tests/fine-exact-raster-v3.mjs \
  tests/probe-worker-v35.mjs tests/fine-section-store-v40.mjs
node tests/probe-motion-v14.mjs --dom=/path/to/linkedom/esm/index.js
```

New cases exercise continuous input, current-pose rejection, late results after
exit, shared subscribers, obsolete queued transfers, bounded concurrency,
stalled headers and body reads, prepared-plane timeout, cache-only misses and
mid-sample eviction, exact output pixels and the visible error/loading state.
Existing cases retain prepared-plane coverage, source spacing, exact-raster
semantics, metadata/worker destruction, saved-section integrity and acoustic
frame consistency. Browser interaction and physical-device checks belong to
the combined release validation; the checks above do not establish them.
