# Exact transport for the dense v28 references

The two dense SFR1 reference meshes exceed the source host's 32 MiB Git-object
limit. Their **existing encoded gzip bytes** are stored as ordered contiguous
parts, each at most 24 MiB. This is a transport change only: no decompression,
recompression, geometry processing, or policy changes are used to make parts.

`patch/*.sfr.gz.parts.json` pins the original logical filename, compressed
length and SHA-256, decoded length and SHA-256, and every ordered part's length
and SHA-256. Concatenating those parts reproduces the exact original gzip stream.
The canonical policy keeps its original `surfaceReference` unchanged. Browser
HFM meshes, masks, public manifests and all source banks are unaffected.

`scripts/cleanup-v28-right/exact_transport.py` first loads the whole logical file
when present; otherwise it resolves its `.parts.json` sidecar. It checks bounded
sizes, safe ordered part names, each part digest, the combined digest, and bounded
gzip decoding against the existing policy. A corrupt whole file fails rather
than silently falling back. The compactor, ROI renderer, full review renderer and
asset verifier use this loader, so a fresh source checkout needs no manual join.

The full original streams are also retained outside Git at
`{source-cache}/cleanup-v28-right/full-references/`, and in the pre-split validated
checkpoint `{source-cache}/release-v28/heart-explorer-v28-validated.zip`.

```sh
python3 tests/local-reference-transport-v28.py
```

The release transport receipt additionally compares every compressed byte with
the preserved whole files:

```sh
python3 tests/local-reference-transport-v28.py --archive-dir {source-cache}/cleanup-v28-right/full-references --output docs/cleanup-v28-right/transport-validation.json
```

`split_reference.py --archive-dir <outside-repository-directory>` reproduces this
split from whole pinned references. It verifies the missing-whole-file loading
path before moving either original into the archive. Scientific geometry checks
and source provenance remain in the unchanged canonical policies and validation
records; the transport test adds no new anatomical claim.
