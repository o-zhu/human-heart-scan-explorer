# Probe and TEE fine-plane responsiveness

The v26 update keeps the measured native-plane spacing and the existing acoustic
grid. It removes avoidable work and gives the current scan priority. Both Probe
Lab and TEE lab use this shared path.

## What caused the delay

Moving away from an exact prepared starting image could require hundreds of
separate fine-volume bricks. A LADAF apical section shifted by 0.1 mm uses **741
bricks**, totaling **128,434,621 compressed bytes** and **203,497,125 decoded
bytes**. Those requests previously ran four at a time. This is a distinct bank
from the X/Y/Z image collection; downloading those section cards does not make
arbitrary oblique planes resident.

There was also unnecessary work: turning the fan **within the same physical
plane** changed the requested image axes, which prevented reuse of an already
loaded native section. The old path could fetch about 128 MB to show a different
direction through the same measured plane. A release timer could then repeat
the same source/acoustic computation even though moving and settled image grids
are identical.

## Implemented changes

| Change | Effect and boundary |
| --- | --- |
| Reuse a coplanar native image | A same-plane sweep or slide uses the existing native raster in its **original image coordinates**. It does not rotate old pixels into new metadata or interpolate them into a second raster. |
| Prove coverage before reuse | Reuse requires matching physical planes and either containment of the entire requested image or containment of the complete scan-box projection. Parallel offsets, tilts, and insufficient crops fail the check. |
| Remove duplicate release work | The same accepted pose, source version, source-cleanup setting, image grid, and acoustic settings do not enqueue another fine computation merely because the movement timer ended. Gain/grid/pose changes still recompute. |
| Bound concurrent foreground reads by device policy | Defaults are 4 on devices reporting less than 4 GB, 8 below 8 GB, and 12 at 8 GB or when memory information is unavailable. Reduced-data/2G connections use 2; 3G uses 4. Every source and decoded hash remains checked. |
| Start missing bricks before resident work | Cold reads overlap subsequent resident sampling, avoiding a late round trip after the cached image center has already been traversed. |
| Protect the active plane in the decoded cache | Unrelated cached blocks are evicted before blocks needed by the active section. The existing 128/256/384 MiB memory ceilings still apply, even if a plane is too large to fit. |
| Prepare quiet neighbors with a separate bound | Background warming uses at most 1–3 requests, alternates both sides of the current plane, stays within the existing cache budget, and cancels for foreground work/input. Known persistent-cache misses avoid redundant CacheStorage lookups. |
| Transfer temporary native rasters directly | An arbitrary reformat has no remaining worker owner, so its buffer transfers directly. Prepared-image caches retain ownership and still transfer a copy. |
| Cancel sibling reads on failure | One invalid or failed source block aborts the bounded sibling reads, releases active-plane reservations, and never reports a partial image as complete. |
| Pause the separate whole-heart mesh preparation | The reconstruction worker yields during transfer and between decoded-stream chunks, retaining verified parts and decoded bytes. Final geometry transfer, cleanup preparation and GPU installation also wait for Reconstruction; cleanup transport aborts on workspace exit. |

Prepared sections retain their exact stored pixels and native spacing. Reuse can
return a different rectangular image extent from the currently requested probe
basis because that stored rectangle already covers all measured tissue on the
same plane. The sector, acoustic rays, cut face and camera all use the stored
image's coordinates; the accepted probe pose still controls the fan and its
orientation. No intensity window, source value, threshold or source bank changes.

## Measurements

`benchmark.json` is produced by
`scripts/benchmark-probe-performance-v26.mjs`, comparing source commit
`c6511a375acf30d74a664725e5857cc6b8019898` with the new implementation.

The first comparison loads the genuine prepared apical image, then turns the
requested basis by 12° within that plane. File access is local, and only source
acquisition/reformat time is measured; the acoustic worker and browser paint are
outside these timings.

| Donor | Previous brick requests for the sweep | Previous bytes fetched | New brick requests / bytes | Source phase before → after |
| --- | ---: | ---: | ---: | ---: |
| LADAF-2021-17 | 739 | 128,512,403 | 0 / 0 | 1,242 ms → 0.52 ms |
| S-20-29 | 658 | 101,320,212 | 0 / 0 | 1,084 ms → 0.49 ms |
| S-20-28 | 866 | 137,159,925 | 0 / 0 | 1,897 ms → 0.49 ms |

Each reused image retains its manifest pixel SHA-256 and original axes. The new
path does not need to prepare its 3D brick working set for that same-plane move.
The submillisecond values are cache/source-path timings, **not end-to-end input
latency or a claimed frame rate**.

For an actual LADAF plane offset of 0.1 mm, a controlled fixture adds **25 ms to
each local-file response**, without simulating bandwidth limits. Acquisition and
sampling fell from **5.77 s to 2.50 s** (about 57% shorter), with the same 741
requests, the same compressed-byte count, and a byte-identical final raster.
This measures the effect of bounded concurrency under injected request latency;
it is not a measurement of the public server or a user's connection.

Actual 0.1 mm and 0.2 mm offsets were sampled for all three donors. Every output
byte matches the previous implementation. Nearby local-source timings remain
roughly 100–125 ms in this run; this update does not claim a general speedup of
the already-resident interpolation kernel. The largest gains are avoiding work
for unchanged physical planes, reducing cold round-trip serialization, and
removing competing/repeated work.

## Options considered and limits

Using fewer samples during movement would reduce CPU time, but would also reduce
the requested native cut-face detail. Restricting the native image to the
ultrasound fan would omit the measured cut face outside that sector. Neither is
used. Reprojecting an old image onto a genuinely different plane is also rejected;
the source-section identity remains exact within the existing geometric tolerance.

Preloading all 805 MB of LADAF's compressed fine bank would spend bandwidth and
memory before it was needed. Larger unbounded caches and unrestricted download
concurrency were therefore not used. Worker-side GPU resampling would primarily
target the already-resident CPU phase, while server-side reformats would require
a new compute endpoint and a separate source-integrity/resource-budget design;
neither removes the need to validate this release's actual data path.

A first genuinely new oblique plane can still require around 100–130 MB of source
data. Link bandwidth and source availability remain real limits. Quiet warming,
resident bricks, prepared-plane reuse, and bounded current-plane priority reduce
those costs where possible. The UI keeps the measured Preview/Ultra distinction;
it does not label a coarse or wrong-plane image as native detail.

Fine integrity verification requires Web Crypto in an HTTPS or localhost
context. An unsupported insecure preview reports that requirement explicitly and
retains the measured volume preview; checksum verification is never bypassed.

## Whole-heart surface priority

The integration review found a completion race in the initial pause change:
pausing after mesh decoding started could still transfer the completed geometry,
start debris cleanup and upload the mesh while a lab was active. The worker now
checks workspace priority before and after each decoded-stream read and before
the final geometry transfer. Its retained decoded prefix resumes without
downloading the mesh again. In-flight stream internals and an already-running
hash may finish; their results cannot advance to installation while paused.

The controller separately waits before cleanup and immediately before GPU
creation, covering a workspace switch after the worker's final check or after
cleanup completes. A workspace exit aborts unfinished cleanup transport; returning
retries that small stage against the retained geometry. Already completed flags
remain resident. Choosing another surface or Interactive volume cancels the
paused selection and removes its resume listeners, so returning cannot install
an obsolete result. Source hashes, bounds, geometry and mask validation remain
unchanged. These are lifecycle guarantees, not browser frame-rate measurements.

## Verification

Focused coverage includes coplanarity/coverage rejection, unchanged image
coordinates, shared-cache reuse, actual CT/acoustic geometry, adaptive request
limits, native-pixel equality, cache protection, cancellation, duplicate-work
suppression, donor entry geometry, and the TEE subclass's accepted-pose contract.

```sh
node --test tests/probe-performance-v26.mjs tests/probe-motion-v14.mjs tests/ultra-volume-v7-lifecycle.mjs
node --test tests/probe-alignment-v13.mjs tests/probe-entry-v14.mjs
node --test tests/tee-lab-v26.mjs
node tests/tee-app-v26.mjs {source-cache}/heart-ui-test-v11/node_modules/linkedom/esm/index.js
node --test tests/fine-surface-transport-v23.mjs tests/mesh-debris-cleanup-v25.mjs
node tests/fine-surface-controller-v19.mjs {source-cache}/heart-ui-test-v11/node_modules/linkedom/esm/index.js
node scripts/benchmark-probe-performance-v26.mjs
```

The focused surface-priority follow-up passed all 49 checks across its three
affected suites. Cases include pausing during decompression, blocking further
decoded reads, worker/cleanup completion immediately before a workspace switch,
cleanup abort/resume, and cancellation while waiting to return. See
`surface-priority-verification.json` for the scope and commands.

These source/data tests establish the stated algorithmic and integrity results.
They do not establish a browser frame rate, clinical registration, ultrasound
accuracy or measured esophageal anatomy.
