# Sequential Ultra acquisition and bounded preparation — v53

Ultra loading now separates acquisition from geometry preparation when the
browser provides asynchronous origin-private file storage (OPFS). The existing
verified streaming path remains available when temporary storage cannot be
used. Update queue sequence 88 is
`heart-explorer-v0088-20261111T042622Z-3b4a9a`; saved and deployed Site versions
are recorded separately in the release receipt.

## What this addresses

The compact Ultra transport contains 32 independent gzip blocks totaling
131,645,142 bytes. Previously the worker downloaded a block, verified and decoded
it, then waited for bounded GPU uploads before requesting the next block. A
stationary download counter could therefore represent preparation as well as a
stalled connection. The v52 request recovery remains in place; this change also
bounds a decompressor that stops producing output and reduces incremental hash
CPU work. These are identified loading paths, not proof of the cause of an
individual historical iPad stall.

## Acquisition and preparation

1. Retain the cleaned intermediate and verify the component attribute as before.
2. If asynchronous OPFS is available, fetch one compact block at a time, verify
   its compressed size and SHA-256, and close its temporary file before starting
   the next block. Each load has a unique directory; another tab's work and the
   volume cache are outside its cleanup scope.
3. Report **Downloading surface** during acquisition. Advance to **Preparing
   surface** only after all 32 verified files have closed successfully. Receiving
   the expected byte count alone does not complete this phase.
4. Read one staged part at a time, verify it again, decompress and decode bounded
   output, then follow the existing v48 hash and GPU acknowledgement protocol.
   The percentage reflects acknowledged upload bytes. The persistent overall
   bar stays determinate and cannot move backward.
5. Preserve the complete-model transaction: exact stream identities, validated
   triangle component decisions, all eight reviewed fields and all four interior
   replacements. Keep the cleaned intermediate through the first successful
   compatible Ultra draw and fence.

The store does not retain the complete compressed or decoded model in the
JavaScript heap. Its inputs are bounded to 8 MiB per part and 256 MiB overall;
the production parts are smaller than 4.7 MB. The normal decode path retains
only the current part and its bounded processing buffers. GPU chunks remain at
most 2,097,144 bytes, with one outstanding transfer whose buffer returns only
after its GPU fence. Total GPU geometry and browser-private allocations remain
separate costs.

## Optional storage and recovery

Unavailable, denied, full or stalled OPFS falls back to serial bounded streaming.
Completed staged parts and at most one verified, not-yet-stored part are reused
where possible. That fallback retains at most two manifest-bounded packed parts
alongside the existing bounded decode buffers. It does not concatenate the
complete transport in memory or require a synchronous storage API.

Native storage operations have a 10-second active deadline. A timed-out read
disables further disk reads for that load so the same deadline is not repeated
for every remaining part. A missing or corrupted file is fetched again through
the normal verified loader. Restoration has an explicit **Restoring surface
data** state; each new part recovery can show the existing reconnect message.
The fallback's combined download/preparation label remains truthful when full
acquisition could not be separated from decoding.

Temporary files are removed after success, failure or cancellation. The
controller also requests job-scoped cleanup after terminating a worker, because
terminated worker code cannot run its `finally` callbacks. Cleanup is bounded
and best-effort, including native operations that finish late; it must never
hold up cancellation or delete another job. This temporary store does not
establish resume across a reload or browser termination.

The v52 network contract is unchanged: 20 seconds without received bytes covers
headers and body reads; three shared retries use 1, 2 and 4 seconds of backoff.
Only the unfinished application block is retried. Integrity, size and resource
failures are not network retries, and exhausted recovery cannot trigger the
larger original transport. The active surface job retains priority over the
optional whole-collection download while current-view work stays available.

Compact decompression now has its own 20-second active no-output deadline.
Actual nonempty output resets it; empty chunks do not. Workspace and hidden-page
pauses suspend its active clock. Cancellation or timeout settles even if the
native read or stream cancellation does not. A decompression timeout is a
preparation/resource failure, preventing an automatic larger-transport attempt.
The existing controller watchdog remains a separate bound for other stages.

## Optional hash acceleration

[The bounded SHA-256 implementation](../surface-hash-v53/README.md) can use a
self-checked scalar WebAssembly compressor with one fixed 64 KiB memory page.
Unsupported engines, failed initialization, compilation timeout or a runtime
backend failure retain the original JavaScript verification path. No digest,
source identity or publication check is skipped.

The [recorded Node benchmark](../surface-hash-v53/validation.json) measured
4,620.0 ms in JavaScript and 2,442.6 ms with the accelerator for the complete
original HFM, positions and topology checks: approximately 1.89 times the hash
throughput. It isolates hash CPU work on Node x64. It is not a browser loading
measurement, an iPad performance result or a promised overall speedup.

## Verification and release boundaries

Focused coverage is in `tests/surface-part-staging-v53.mjs`,
`tests/surface-preparation-deadlines-v53.mjs`,
`tests/surface-sha256-v53.mjs`, and the existing progress, controller, transport,
streaming, GPU, network-recovery and priority suites. Review staging failures,
late native completion, per-job cleanup, repeated lost-part recovery, pauses,
stale messages and full-model/first-presentation gates together. Hash source
reproduction uses `python3 scripts/build-surface-sha256-v53.py --check`.
Actual release checks and browser observations belong in the release validation
and receipt; the listed suites alone are not a claim of a completed device run.

No physical iPad end-to-end test is established by these fixtures or the Node
benchmark. The changes preserve every scientific asset, mesh, mask, scalar
value, spacing, calibration and immutable asset identity. No new asset bank or
population step is required. Keep the existing 13 hosting stages and compressed
and expanded archive limits. Exclude temporary browser-review and test assets
from publication. Public GitHub integration remains a separate requested step.
