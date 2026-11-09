# Canonical v29 cleanup handoff

The selected assets are assembled under `public/assets/cleanup-v29/`. This step
does not change production activation. The original source volume, original mesh
payloads, and every historical v28 asset remain untouched.

## Selected regions

| Region | Fine XYZ lower, inclusive | Fine XYZ upper, exclusive | Surface gzip bytes | Mask gzip bytes | Surface triangles |
| --- | --- | --- | ---: | ---: | ---: |
| LVOT / proximal aortic valve | 1018, 944, 916 | 1212, 1204, 1372 | 7,278,090 | 244,591 | 700,968 |
| Tricuspid, exact v28 reuse | 600, 660, 1020 | 870, 1040, 1350 | 3,210,789 | 342,653 | 302,706 |
| Pulmonary lumen | 604, 1080, 540 | 790, 1360, 972 | 5,109,781 | 408,027 | 514,232 |
| Right perivascular exterior | 530, 815, 690 | 1030, 1060, 890 | 7,002,408 | 363,072 | 682,317 |

All four boxes are disjoint. In particular, the exterior region ends at Z=890
and the enlarged LVOT region begins at Z=916; the exterior region ends at Y=1060
and the pulmonary region begins at Y=1080. The unchanged tricuspid entry retains
its exact v28 URLs, metadata, and bytes.

The atrial lumen mask adds the reviewed 16,979 exclusions to the exact prior
mask. The other three lumen entries retain their complete v28 metadata and URLs.
The atrial mask is 659,082 compressed bytes. Supported upright pulmonary-vein
wall was retained; this is a bounded removal of selected sheet/fringe material,
not a global removal of dark or thin structures.

## Reproducible assembly and source checks

Run from the repository root, with the verified fine source bank available:

```sh
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 {temporary-cache}/bin/python scripts/assemble-cleanup-v29.py
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 {temporary-cache}/bin/python scripts/assemble-cleanup-v29.py --verify-only
```

The script assembles only the selected runtime assets. It verifies encoded and
decoded hashes, the source manifest identity, geometry layout, packed-mask
dimensions and padding, pairwise region separation, and the memory budget. It
independently reconstructs the frozen atrial repair mask from the source and
checks every selected lumen and low-band mask against all **109,928 restored
wall samples**; overlap is zero. It checks that the previous atrial mask is an
exact subset and the previous LVOT low-band mask is unchanged in its old box.

The selected policy records are hashed and checked for zero loss of their
protected intensity cores, zero loss of raw-190 cores, and zero non-baseline
samples on box boundaries. The left region uses the preserved v28 scalar field
combined with an independently collared extension. The pulmonary and exterior
regions use the individually reviewed local fields. Detailed scalar extraction
and production GLSL comparisons are recorded in the linked left/right policy
and review folders; the assembler does not rerun every mesh extraction.

These values are windowed HiP-CT display intensities, **not calibrated Hounsfield
units**. Source-core checks apply before the inherited component filtering and
mesh reduction. They do not establish the identity of every surviving or removed
structure. The local surfaces retain the original extraction isovalue at their
borders but are not welded to the prior decimated surface.

`assembly.json` is the deterministic assembly receipt, containing all input and
output hashes, source receipts, region checks, source-core record checks, and
wall-mask checks.

## Budget and release inputs

- Four patch surfaces: **38,849,396 decoded bytes**.
- Four packed low-band masks: **13,217,640 decoded bytes**, below the 16 MiB cap.
- Total patch storage: **52,067,036 decoded bytes**, below the 128 MiB cap.
- Total patch download, including the exact reused tricuspid pair:
  **23,959,411 bytes**.
- New canonical gzip payloads, including the atrial mask:
  **21,065,051 bytes** across seven files.
- Every new gzip is below **8 MiB**.

Canonical manifests:

| Manifest | SHA-256 |
| --- | --- |
| `public/assets/cleanup-v29/surface-manifest.json` | `b78c331768381dd4cd519008fdeb5e80f8aef9b26ad0876d126c6fc212c55144` |
| `public/assets/cleanup-v29/lumen-manifest.json` | `c3b0bbd0ced2a7a176346cd25b0f3a34b1267f6a1e3677294308536e8c69149d` |

The source manifest remains
`e50ab70a52373dc774cf6077ef906a753e56b78b9f9b646fba2ffe7220ff338c`.
The source geometry identity remains
`175548ddaad01c409d59d561df6018c5cb0c90752b2ec771899c255065398dae`.
The same cleanup may operate on compact transport only when its decoder has
verified the position/index geometry and supplied that trusted
`geometrySourceSha256`. A matching string in the transport manifest alone is
insufficient.

## Bounded runtime validation

```sh
HEART_REFINEMENT_TEST_FIXTURE=v29 node --test tests/local-refinement-v29.mjs
```

The preactivation test uses the real controller with only two routing literals
changed in memory: the new manifest URL and the URL allowlist for v28/v29 assets.
It does not modify the production module. Its receipt records both the original
and tested module hashes and both substitutions. After release routing is
activated, run the same test without the environment variable to test the actual
active module.

All 12 cases passed. The cases cover all four real meshes and masks, manifest
and decoder corruption, all-four atomic activation, cleanup gating, fourth-mask
failure, cancellation and stale results, GPU failure/resource disposal, packed
mask picking, native-detail priority, and compact geometry identity. This is an
instrumented lifecycle check; it is not a browser performance measurement.

Production shader visual comparisons and reversible cleanup-off checks are in:

- `docs/cleanup-v29-left/render/` for LVOT and LA.
- `docs/cleanup-v29-right/pulmonary-final/` and
  `docs/cleanup-v29-right/pulmonary-final-oblique/` for the pulmonary region.
- `docs/cleanup-v29-right/exterior110/` and
  `docs/cleanup-v29-right/exterior-final-wide/` for the exterior region.

The global seam-normal correction and compact transport are managed separately.
Final combined runtime activation and release verification remain the release
owner's responsibility.
