# Sequential Ultra preparation and mobile recovery — v48

This responds to successful Ultra downloads followed by a mobile browser crash
during surface/graphics preparation, and to the loading popup alternating
between a byte-progress bar and preparation messages. It supersedes the v45
indeterminate-preparation UI and v47 whole-buffer Ultra installation. It does
not change the v47 policy of attempting real Ultra on every normal device after
the cleaned intermediate.

## Diagnosis

The prior compact decoder allocated a complete 437,470,524-byte HFM before its
first block. The main thread then synchronously created position, normal,
component and index GPU buffers while retaining that CPU model. Base geometry
and flags alone could therefore account for 900,615,390 bytes across explicit
CPU and GPU allocations, before the working Compact model, source volume,
reviewed masks, interior surfaces, framebuffers and driver-private copies.
The index upload was a single 283,424,220-byte operation. Transfer compression
did not reduce this decoded installation peak.

Separately, the surface shader used a `flat` varying for component flags.
[WebKit bug 289601](https://bugs.webkit.org/show_bug.cgi?id=289601) documents
indexed-geometry crashes involving that feature on iPads. All three corners
of every accepted triangle already have the same binary flag. Removing `flat`
therefore preserves the exact discard decision while avoiding that unnecessary
driver path. This is a relevant known failure path, not proof of which failure
killed a particular user's browser. It predates the immediately prior release.

## Loading transaction

1. Keep the verified cleaned intermediate visible.
2. Verify the small component attribute against its pinned source identity.
3. Read and verify one transport block at a time. Decode bounded output and
   incrementally hash the canonical HFM, exact positions and topology.
4. Transfer at most 2,097,144 bytes to the main thread. Upload that piece, yield
   a real task, then poll a GPU fence without a blocking wait. Return the same
   buffer in the acknowledgement so it detaches from the main thread and can
   be reused by the worker. A second piece cannot overtake the first.
5. Accept the complete stream only after all byte counts, hashes, index ranges
   and per-triangle component decisions pass. Upload the verified flags in
   bounded steps. Staged buffers remain invisible until complete.
6. Prepare the exact eight reviewed mask fields and all four existing interior
   replacements. Preserve the full-model gate and source identity checks.
7. Install the complete candidate. If the requested settings display it,
   retain the loading bar and Compact fallback through a successful first draw
   and GPU fence. Then release Compact. Deliberately incompatible settings can
   retain the verified model for later use without waiting for an unwanted draw.

The compact HFC transport and preserved original gzip fallback both stream.
Neither allocates the full decoded CPU HFM. Positions and normals each retain
their existing 77,023,134-byte GPU buffer. The same original indices occupy 136
whole-triangle buffers of at most 2,097,144 bytes instead of one 283 MB buffer.
Every original vertex, triangle, index and corner order is preserved. The
production compact transport retains its existing oct12 shading normals; this
release introduces no further geometry or shading loss and no new asset bank.

## Interruptions and failure

- Switching to Echo or a lab, hiding the page, and page-cache suspension pause
  the same request and active-work deadlines. Returning respects the current
  workspace and explicit surface choice.
- Every upload rebinds its own VAO and buffer; working-view renders between
  awaits cannot redirect a chunk into the wrong model.
- Abort, stale messages, malformed streams, failed allocations, failed fences
  and graphics-context loss settle the request and dispose candidate buffers.
  Failed candidates cannot be reused or appended to on retry.
- Canceling a candidate also releases its completed interior GPU pieces when
  their Ultra base is discarded. Working Compact masks remain available.
- Allocation/worker/graphics failures do not automatically retry the larger
  original transport. Source/transport failures retain one verified fallback
  attempt. Retry after a resource failure is user-controlled.
- A late first-frame callback cannot touch a disposed candidate or override a
  newer Volume choice. A threshold/mode change before the first draw cannot
  strand the progress display waiting for a frame the user no longer requested.
- An actually lost WebGL context is explicitly reported as needing a reload;
  buffers from that lost context are not described as a working fallback.

## Progress presentation

One persistent progress element owns the loading panel. Transfer, per-block
hashing, decompression and GPU uploads share one stable phase label. Later
verification, cleanup and presentation stages advance in order. The bar never
switches to an indeterminate animation or moves backward. Its weighted work
fraction is not an elapsed-time estimate. Settings retain detailed diagnostics;
only meaningful phase changes are announced by the popup's live region.

The panel reserves a fixed two-line status slot. Short visible actions fit in
one row, with full accessible labels and 44px touch targets. Browser review of
320, 390 and 820px iframe sizes found a constant 132.9px panel height across the
tested transfer/preparation stages; the development harness is excluded from
the release. See [progress details](../surface-progress-v48/README.md).

## Verification and limits

- [Streaming design and full-size proofs](STREAMING.md)
- [Actual original Ultra stream receipt](stream-validation.json)
- [Complete compact fixture receipt](compact-stream-validation.json)
- [GPU allocation/lifetime checks](gpu-staging.md)
- [Shader compatibility and all-triangle proof](shader-compatibility.md)

The actual original 437,470,524-byte Ultra source passes streaming verification
with allocations over 64 MiB forbidden by the controlled worker harness.
The complete compact fixture is generated from the same original geometry and
validates the production decoder, hashes, ordering and cleanup checks. Its
test-only normals are oct12-encoded original normals, not the unavailable
seam-corrected production transport. Production asset bytes are unchanged.

Controller tests cover the real state machine, bounded upload acknowledgements,
complete cleanup, first presentation, cancellation, context loss and settings
changes with controlled GPU/worker fixtures. Source-derived allocation bounds
and Node memory/timing measurements are not Safari or iPad memory benchmarks.
The available cloud browser has no WebGL 2, so it verifies software fallback
and progress layout, not physical-device Ultra rendering. Total retained GPU
geometry is still large. No browser API can promise that every device has
sufficient free graphics memory; native process termination cannot be caught
by a JavaScript error handler. The change removes identified peak allocations
and a known shader hazard rather than claiming a universal crash guarantee.
