# Sequential surface transfer and verification

The Ultra worker now has a streaming transaction. It never constructs the
437,470,524-byte decoded HFM destination in JavaScript. The existing compact
transport decodes one independently verified block at a time; the preserved
original gzip fallback also streams. The smaller surface retains its existing
whole-buffer path.

## Ownership and publication

1. The controller verifies the exact debris attribute's metadata, transport,
   decoded checksum and binary values. This is not yet a triangle-validation
   result. Its buffer transfers to the worker without a duplicate retained by
   the controller.
2. A validated HFM header starts an unpublished graphics transaction. The
   worker waits for acknowledgement before producing attributes.
3. The worker hashes every decoded byte, including header and alignment gaps.
   Each attribute passes through at most 2,097,144 bytes of transferable output,
   aligned to whole vertices or triangles. Before emitting indices, it verifies
   their bounds and equality of all three per-triangle debris flags.
4. Exactly one chunk is outstanding. The controller acknowledges only after the
   graphics upload fence completes, transferring that same buffer back to the
   worker. This immediately detaches the main-thread buffer instead of waiting
   for garbage collection; the worker reuses its storage for the next chunk.
   Duplicate or stale acknowledgement numbers cannot give credit to a newer
   chunk, and a returned buffer must match its original length. Workspace priority stops further decode
   or transfer while the lab is active; cancellation terminates the transaction.
5. Final compressed and decoded identities, and the compact transport's pinned
   original position/index hashes, must pass before `surface-complete`. Only
   then does the worker transfer the verified debris flags back for their
   sequential graphics upload. All reviewed masks and prepared interiors remain
   prerequisites to installing the finished Ultra surface.

`surface-start` includes a candidate geometry identity so the controller can
check which transaction is being built. It is not evidence of completion.
The controller keeps staged geometry invisible until the final proof, cleanup
and first-draw checks. Any checksum, length, topology, cleanup, upload or
cancellation failure requires discarding all of that transaction's buffers.

## Bounds

| Storage or operation | Bound |
| --- | ---: |
| Outstanding transferred geometry | One chunk, at most 2,097,144 bytes |
| Decoded compact block | At most 25,165,824 bytes for the existing index blocks |
| Compact compressed/payload block | Format limit 8 MiB each |
| Original gzip input fed to the decompressor | 64 KiB per awaited write |
| Original verified transport part | Format limit 32 MiB; current parts at most 24 MiB |
| SHA-256 state per incremental identity | 416 bytes, plus shared round constants |
| Debris flags | 12,837,189 bytes, transferred between owners |

The WebAssembly codec, decompressor, network stack, graphics driver, retained
intermediate, scan textures, masks and render targets consume additional memory.
These bounds are not a total browser-memory estimate. In particular, splitting
uploads does not make the final geometry's graphics storage disappear.

The compact stream rejects a reordered transport rather than retaining entire
attributes to reorder them. The published manifest is already in canonical
position, normal, index order. Its zero alignment gaps reproduce the existing
whole-buffer codec exactly. The original gzip path hashes its actual padding.

No coordinates, indices, corner order, masks or production normal bytes changed.
The existing oct12 normal encoding is unchanged. The whole-buffer codec remains
available to its other consumers. No asset index, hosted bank or public asset
was rewritten.

## Evidence

`tests/surface-stream-v48.mjs` exercises actual transferable buffers and the
unmodified production worker, rather than only simulating worker messages. Its
regular cases cover arbitrary SHA block boundaries and detached source arrays,
split HFM headers/padding, bounded chunks, stale acknowledgements, workspace
pauses, cancellation with an outstanding chunk, graphics rejection, corrupted
hashes, truncation/overflow, invalid indices and nonuniform cleanup. Independent
compact blocks match the original whole-buffer destination, including an index
fixture requiring corner-order restoration. Reordered compact manifests and
impersonated pinned geometry are rejected before allocation or download.

The actual preserved original Ultra test:

- Processes all **437,470,524 decoded bytes** and **23,618,685 triangles**.
- Requires the exact original decoded SHA-256 and independent original position,
  normal and index identities.
- Requires the exact original cleanup flags on return.
- Rejects direct JavaScript `ArrayBuffer` and numeric typed-array allocations
  above **64 MiB** while the worker runs, so a hidden whole-model destination
  fails the test. WebAssembly and native browser allocations are separate.
- Transfers **210 chunks**, at most **2,097,144 bytes** each.
- Recorded a **115,410,506-byte** peak in Node's tracked worker ArrayBuffer
  storage and about **8.15 seconds** in the recorded environment.

The 32 production compact binaries, including their seam-corrected shading
normals, are not included locally. A complete test-only compact fixture was
therefore generated from the same actual Ultra coordinates and topology using
the existing meshoptimizer0.23 encoder and original source normals encoded with
the unchanged oct12 scheme. It is explicitly marked `fixtureOnly`; it is never
staged or deployed. The complete production compact worker processed this fixture
with whole-model allocations forbidden and an independent full-HFM rehash in
the receiver. Every original triangle and cleanup decision passed; the largest
decoded block was **25,165,824 bytes**, with **210** bounded transfers. Node's
recorded tracked ArrayBuffer peak was **106,994,105 bytes**, about **9.90 seconds**.
This verifies the complete compact streaming mechanism and actual topology,
while keeping the missing production-shading-byte limitation explicit.

Receipts are `stream-validation.json` and `compact-stream-validation.json`.
These are controlled Node results, not iPad/Safari process memory, GPU memory,
public network timings or a promise that every mobile device can retain Ultra.

## Reproduction

```sh
node --test tests/surface-stream-v48.mjs
HEART_SURFACE_STREAM_LARGE=1 \
  HEART_SURFACE_STREAM_EVIDENCE=docs/mobile-loading-v48/stream-validation.json \
  node --test tests/surface-stream-v48.mjs

# Use a temporary output outside the checkout and an externally installed
# meshoptimizer0.23 encoder. It is a test tool, not an application dependency.
node scripts/mobile-loading-v48/build-stream-fixture.mjs \
  /tmp/heart-stream-v48-full-compact /path/to/meshopt_encoder.js
HEART_SURFACE_STREAM_COMPACT=/tmp/heart-stream-v48-full-compact \
  HEART_SURFACE_STREAM_COMPACT_EVIDENCE=docs/mobile-loading-v48/compact-stream-validation.json \
  node --test tests/surface-stream-v48.mjs

node --test tests/fine-surface-transport-v23.mjs \
  tests/surface-sha256-v47.mjs tests/compact-surface-progress-v45.mjs \
  tests/surface-transport-pipeline-v46.mjs
```
