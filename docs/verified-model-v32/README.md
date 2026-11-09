# Completed model delivery and a simpler explorer

This update changes interface layout and delivery of the existing reviewed
LADAF model. It does not alter measured CT pixels, mesh positions or indices,
source coordinates, reviewed mask bits, or anatomical evidence.

## Interface

The Explore hearts banner now contains one row of five direct dataset choices.
The duplicate dropdown, separate SlicerHeart promotion, repeated selection
label and repeated dataset count are removed. The SlicerHeart choice itself
has a play icon and a stronger background. The primary workspace buttons use
18–20 px text and a clear selected state. The shared control baseline uses
`:where` so its minimum typography does not override larger component styles.

The three section cards remain in normal document flow instead of a clipped,
independently scrolling rail. On desktop the heart remains sticky alongside
them; at narrower widths the cards move below it. Direct plane buttons reveal,
activate and focus the selected section, first closing another enlarged card
when necessary. Names follow each source's existing coordinate convention.
The axial section retains wheel, range, touch, step-button and keyboard input.
Plane-orientation qualifications remain available in a disclosure.

## Complete activation

The source reconstruction, local surface patches and masks were already
computed offline. The recurring incomplete state was a delivery/activation
problem, not evidence that the client needed to reconstruct anatomy.
Authenticated production GETs verified all 16 referenced v30 binary objects,
both manifests and their exact local lengths/hashes. The immutable collection
reported all 10 indexed objects complete and uploads closed.

The detailed surface now waits for its prepared debris cleanup, lumen cleanup
and four local surface patches before becoming the active model. During the
download the interactive volume remains usable. Cancellation, leaving the
workspace and failures cannot install a partially ready detailed model. A
successful model has no persistent refinement badge over the anatomy; actual
load failures retain their specific reason. Existing cleanup comparison
controls remain available.

## Lossless sparse mask preparation

`scripts/prepare-reviewed-mask-atlas-v32.py` verifies the pinned v30 manifests
and eight original mask hashes, then builds a sparse representation of their
stored bytes. Each brick is 8 × 8 × 8 packed bytes. Zero bricks share a sentinel;
identical nonzero bricks share one payload. The shader uses a small R32UI index
texture and an RGBA8 payload texture instead of eight dense 3D textures.

| Measure | Before | Prepared atlas |
| --- | ---: | ---: |
| Mask GPU storage | 104,449,180 bytes | 18,264,064 bytes |
| Texture count for these masks | 8 | 2 |
| Largest required mask texture extent | 800 in 3D | 2,124 in 2D |

The mask-storage reduction is 82.51%. The full compressed atlas is 3,080,744 bytes
and remains in the source repository for reproducibility.
The builder reconstructs **every one of the 104,449,180 original stored bytes**
from its final serialized output and compares them with the verified inputs.
The result has zero mismatches; no resampling or geometry simplification is
involved. Original dense CPU masks remain for unchanged picking behavior.

For production delivery, the builder compiles a 139,441-byte reference stream:
the exact atlas index plus one source-field/brick reference per unique payload
brick. The runtime decodes the already-required original masks once and copies
these preselected bytes into their prepared layout. It verifies the full final
RMA1 hash against a constant pinned in the loader before any GPU upload. This
is lossless transport decoding; it performs no segmentation, surface extraction,
cleanup decisions or geometric refinement. The verified mask arrays are reused
for CPU picking and local surfaces rather than fetched a second time.

The builder independently reconstructs the entire RMA1 binary from this reference
stream and its pinned source masks and compares it with the complete offline
atlas. A build-only staging step removes the redundant full atlas payload after
validating the reference stream, manifests, runtime support and source bytes.
This reduces static packaging by 2,941,303 bytes without changing any model data.

Runtime validation checks the source identities, compressed and decoded hashes,
bounded lengths, header, indices, padding and GPU limits. Shared downloads are
deduplicated and cancellation is per consumer. GPU replacement is atomic and
restores caller state. Upload errors are isolated from unrelated earlier GL
errors, which previously could be misreported as refinement upload failures.

The new representation removes the reproduced 3D mask-size failure on devices
limited to 256 or 512 voxels per 3D texture, and substantially reduces mask
memory. It does not eliminate the separate memory requirements of the detailed
base mesh or establish the precise cause on the reporting user's device.

Reproduce the offline preparation check with:

```sh
python3 scripts/prepare-reviewed-mask-atlas-v32.py --check
```

This requires NumPy and the repository's exact original mask files. The static
reference stream is included by the ordinary build; no additional hosting bank,
upload gate, token or infrastructure change is required. Preserve all existing
hosted staging steps, including the TTE catalog bundling, then run
`python3 scripts/prepare-reviewed-mask-hosting-v32.py --stage` before the final
display staging/size check. Source copies of the full atlas remain untouched.

## Verification

- `mask-atlas.json`: exact reconstruction of all source mask bytes, pinned
  source identities, deterministic serialization and storage accounting.
- `gpu-validation.json`: 13,535,136 actual native EGL shader comparisons with
  zero mismatches, including every logical brick reference, all bit positions,
  empty/deduplicated bricks, nearest-cell boundaries, texture rows, outside
  bounds and disabled/invalid-field guards. The actual production volume,
  composite and fine-surface shaders compile and link in this check.
- `tests/reviewed-mask-atlas-v32.mjs`: real CPU sample comparisons, corruption
  rejection, strict GPU allocation and state restoration, atomic failure,
  shared cancellation/retry, and all real local meshes/lumen masks with a
  256-voxel 3D limit and no dense mask uploads.
- The focused DOM/controller suites exercise direct dataset navigation,
  SlicerHeart autoplay/upright defaults, all three section controls, enlarged
  section recovery, final-model readiness, cancellation and error recovery.

Native EGL runs on Mesa llvmpipe and is a scientific shader check, not a browser
layout screenshot or a measurement of Safari/phone performance. Neither the
connected-browser session nor the cloud browser could start in this session,
so browser layout/device verification is not claimed.
