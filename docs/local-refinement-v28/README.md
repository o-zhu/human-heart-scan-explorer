# Local surface replacement verification

The v28 local replacement controller stages source-derived meshes together with
their corresponding low-band masks. The earlier complete Gentle surface remains
installed until every requested patch is decoded, verified and uploaded.

Run the bounded verification from the repository root:

```sh
node --expose-gc --max-old-space-size=256 tests/local-refinement-v28.mjs
```

The script writes `validation.json`, including hashes of the runtime files it
tested, exact patch and mask identities, test outcomes and process memory at
completion. It chooses the final public
`public/assets/cleanup-v28/surface-manifest.json` when present. During preparation
it can instead verify the real LVOT candidate policy and files; the receipt
explicitly identifies that narrower scope. A candidate receipt does not verify
a later final manifest or its other assets.

## Verification scope

- Every available real mesh and mask is checked against its compressed and
  decoded SHA-256, declared byte counts, mesh format, indices and normals. Packed
  masks must have zero unused tail bits, and recorded logical voxel counts must
  agree with their bit population. Decoder reads leave mesh bytes unchanged.
- Manifest checks exercise the source and Gentle mesh identities, coordinate
  bounds, at most four regions, non-overlap, exact static-asset path pattern,
  128 MiB combined decoded budget and 16 MiB mask budget.
- Two small transaction fixtures copy actual triangle positions and normals
  from separated locations in the verified first mesh. Their mask crops copy
  actual logical bits. They exercise the real downloader, streaming length
  checks, gzip decompression, digest verification, decoder and upload controller;
  they do not reproduce those implementations in the test.
- An instrumented WebGL interface records allocations, texture dimensions,
  nearest-neighbor parameters, uniforms and draw calls. The tests verify that
  partially staged objects remain invisible, failed work is freed, a cancelled
  job cannot replace a newer result, and the previous complete main surface is
  retained. No full-size GPU allocation is needed for these lifecycle checks.
- The active gate is tested against the loaded Gentle mesh hash, extent,
  workspace state, lumen/debris switches and fine-surface mode requirements.
- CPU mask picking is compared with 4,000 deterministic samples from the real
  decoded mask, including subvoxel offsets and points outside its support box.
- The real `FineSurfacePass.draw` and native-region draw methods execute against
  the recorded WebGL interface. Native geometry keeps priority, local draws use
  their own patch index, and state resets before later draws. The production
  shader is checked for the corresponding gates: the low-band discard applies
  to native geometry and scalar/cap sampling, not the replacement mesh itself.

## Issues corrected during independent review

1. Activation originally recognized only the `gentle` profile name. It now also
   requires the loaded LOD's pinned decoded mesh hash and matching extent.
2. A superseded non-abort failure could overwrite the status of a newer success.
   Only the current, non-aborted request may publish an error.
3. A synchronous fetcher exception could leave a completed promise in the
   `loading` field. Deferred execution makes the existing cleanup path reliable
   and leaves retry available.
4. The mesh decoder read its header relative to a byte view but interpreted
   attribute/index offsets relative to the underlying buffer. Returned offsets
   now include the view offset. An unaligned view is normalized only after its
   layout has passed validation. Real-data-derived fixtures verify byte offsets
   1 and 16 without changing their positions, normals or triangle indices.
5. Cancelling a request originally left staged GPU objects allocated until its
   pending operation settled. A rapid resume could then overlap two nominally
   bounded jobs. Cancellation and disposal now free staged objects immediately
   and clear the old job's list. Late completion cannot reuse or double-free
   those objects. This is tested with an unresolved transport that does not
   acknowledge abort; cancellation before queued work begins also starts no
   download.

## Limits

This suite verifies encoded data, bounded loading and rendering integration. Its
recorded WebGL interface does not establish actual driver allocation capacity,
browser frame rate, visual seam quality or anatomical correctness. Production
GL render comparisons and source review are separate evidence. Any change to
the final surface manifest requires a fresh run against that exact manifest.
