# Interrupted surface download recovery — v52

This release addresses Ultra-High Fidelity loading that appears to stop partway
through a download. It adds bounded recovery for individual transfers, gives the
requested surface priority over optional collection downloads, and shows surface
preparation alongside received bytes. Update queue sequence 87 is
`heart-explorer-v0087-20261110T214053Z-5aac31`; the actual Site version is recorded
separately in the release receipt.

## Diagnosis and evidence

The reported screenshot shows **35.5 of 131.6 MB**. The production compact
manifest divides the surface into 32 independently compressed, checksummed
blocks totaling **131,645,142 bytes**. The first eight total **35,451,886 bytes**,
which rounds to the displayed 35.5 MB; the next block is **4,425,248 bytes**.
The largest block is **4,665,178 bytes**.

That match places the observation at a plausible block/processing boundary. It
does not prove which request or processing step stalled on the user's devices.
The existing UI could hold the same byte count while a completed block was
verified, decoded and uploaded, making genuine preparation look like a stopped
download. Code review also found no per-request byte-idle deadline or automatic
network retry in the surface worker. The controller already had a 90-second
idle and 600-second active-work watchdog, so the previous implementation was
not entirely unbounded; those broader deadlines did not provide prompt
individual-transfer recovery.

The 437,470,524-byte decoded source model and its geometry remain unchanged.
The 131.6 MB transport size is not its total installed memory requirement.

## Transfer recovery

`public/fine-surface-worker.js` now applies a **20-second no-byte deadline**
before waiting for headers and throughout response-body reading. Each nonempty
body chunk refreshes the deadline. Empty chunks do not count as progress.
Completed-body verification is outside that network idle clock.

Recoverable failures include a stalled request, a network error, a short
response, and HTTP 408, 429 or 5xx. One surface worker job has a **global budget
of three automatic recovery attempts**, with **1, 2 and 4 seconds of backoff**.
Receiving a little data or moving to another block does not reset that budget.
Manifest errors, oversized responses, checksum failures and resource failures
do not enter this network retry loop.

Recovery retries only the unfinished manifest block. Earlier verified blocks
and staged output remain available within the same loading transaction. This
uses the existing application blocks, **not HTTP Range or partial-body
concatenation**. It does not establish cross-reload resume. Each recovered block
still passes the original size and checksum checks before decoding/acceptance.

Fetch, body reads and backoff use explicit cancellation races so an operation
that ignores abort cannot strand the application's wait. Stream cancellation
is best-effort and is never awaited as a prerequisite to retry. Late responses
are abandoned safely. A workspace pause interrupts the active request or
backoff without consuming an additional recovery attempt; verified completed
work is retained. Pausing completed-body verification does not duplicate that
hash operation or restart its completed download.

Exhausted recovery propagates `networkFailure` to `public/fine-surface.js`.
That classification prevents an automatic switch to the larger
**227,902,460-byte original transport** after the connection has already failed
repeatedly. The current usable reconstruction remains available with the
existing Retry Surface, Use Compact and Use Volume actions. Explicit
cancellation, superseded choices and resource/graphics failures retain their
separate handling.

## Priority and progress

An active, visible surface job now holds a `ScanActivity` foreground lease.
The optional complete CT-slice collection and speculative background work yield
to it. Current-view work remains allowed. The lease is released for labs,
hidden pages, completion, failure or an explicit smaller/current-view choice.
The existing v46 bounded current-plane fine warming during lab steering is
unchanged.

The loading card uses the stable label **Loading and preparing surface**. Its
byte count can also show **prepared N%**, based on acknowledged upload bytes.
This makes progress during the processing portion of a block visible without
pretending that more network bytes arrived. The percentage describes upload
preparation, not full-model readiness or remaining time.

During recovery it shows **Reconnecting download…** and **Retry N of 3 · progress
retained**. Reconnection notifications do not refresh the controller watchdog
as if useful work occurred. The persistent determinate bar retains measured
progress and does not regress while a block is retried. A deliberate pause
keeps its own pause message and suspends active-work deadlines.

## Preserved model transaction

The v48 streaming and publication contracts remain in force: unpublished GPU
buffers, bounded whole-triangle chunks, upload acknowledgement after the GPU
fence, and no full decoded CPU HFM or monolithic index upload. All eight reviewed
fields and all four prepared interior replacements still gate complete Ultra
activation. The cleaned intermediate stays available through the first
successful compatible Ultra draw and fence.

Source values, positions, topology, triangle order, masks, component decisions,
physical spacing, measurement calibration, hashes, immutable URLs and asset
banks are unchanged. No model simplification, additional lossy compression or
new scientific preparation is introduced. Intentional pauses, donor/source
changes and stale callbacks cannot install an abandoned candidate. Resource
failures still do not automatically request the larger original transport.

## Verification and limits

The final disjoint focused suites passed **190 checks**:

| Area | Result |
| --- | --- |
| Surface worker, transport and recovery | 27 checks passed, including 12 new fault-injection cases |
| Progress state and rendering | 9 checks passed |
| Surface controller lifecycle | 94 checks passed |
| Loading resilience, priority and GPU staging | 39 checks passed |
| Pipeline, compact progress and streaming | 21 checks passed |

The new `tests/surface-download-recovery-v52.mjs` exercises stalled headers,
partial/hanging bodies, hanging cancellation, slow nonempty bytes, empty chunks,
short responses, transient/permanent errors, the shared retry budget, exhaustion,
workspace pauses during requests/backoff, cancellation, paused verification and
checksum failure. Existing controller and progress suites cover fallback
classification, foreground lease lifetime, stale-job rejection, preparation
counts and recovery presentation. The independent implementation review found
no remaining blocker.

The production loading-card CSS was inspected in a 280-pixel viewport (a
254-pixel card) without horizontal overflow. The available cloud browser lacks WebGL 2, so its visible
review establishes software fallback and progress-card presentation, not a
complete Ultra GPU load. These deterministic fixtures and remote-browser checks
are not physical-device end-to-end tests and do not prove the original cause on
each affected device. The broader controller watchdog remains a separate bound
for processing and graphics stages.

No new asset population or hosting stage is required. Reuse the existing 13
staging steps and both deployment archive size limits. Temporary fault-injection
and progress-review pages are excluded from the release.
