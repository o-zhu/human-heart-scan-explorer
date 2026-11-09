# v27 source-supported atrial wall restoration

## Finding and scope

The reported oval scrape and the larger irregular patch leftward of it are
display-exclusion defects. Their missing surfaces already exist in the original
Ultra-high Fidelity mesh. The correction clears only a bounded set of existing
atrial exclusion bits. It does not fill a hole with synthetic geometry, move a
vertex, change a normal, alter a triangle, or modify acquired/display-bank pixels.

The screenshot cut is Y284/475, corresponding to full fine Y1132. The exposed
rear surfaces lie well behind that plane: the oval wall is around Y939–945;
the irregular patch is around Y985–1053. Position readback from the actual
production shaders, original geometry, camera, depth buffer and cleanup masks
located the surfaces. The review cameras reproduce the relevant regions but
are not exact registration to the user's camera.

## Accepted corrections

All coordinates below are integer samples in the original 79.4 µm full fine
grid, XYZ order. Upper bounds are exclusive.

| Patch | Restoration lower XYZ | Restoration upper XYZ | Previously excluded source support | Cleared mask samples |
| --- | --- | --- | ---: | ---: |
| Oval | 1224, 930, 943 | 1304, 955, 1040 | 3,826 | 21,809 |
| Irregular | 1098, 976, 921 | 1177, 1063, 1085 | 18,208 | 88,119 |
| Combined | 1098, 930, 921 | 1304, 1063, 1085 | 22,034 | 109,928 |

The original foreground threshold (71.4 after sigma0.5 filtering) identifies
source support; it is not used to assign an anatomical or pathological identity.

For the oval, the source component is continuous with the adjacent wall. The
portion previously masked tapers to 534 foreground samples at Y944 and six at
Y945, then has no foreground at Y946–948 in the reviewed selection. Only the
masked component support and its nine-sample mesh allowance are restored.

For the irregular patch, separate explicit seeds select the wall and the lumen
object within a bounded review window. The restoration is the masked wall
support plus its nine-sample allowance, except that the lumen object's source
component and its own nine-sample allowance remain protected. The final clear
mask overlaps neither the selected lumen-object foreground nor that allowance.
Two wall foreground samples next to this guard deliberately remain excluded.
This is a local source separation, not a claim that either object is globally
detached. Nearby residual sparse material remains where an unambiguous boundary
was not established.

## Origin of the defect

The oval restoration clears 13,052 bits inherited from v25 and 8,757 added in
v26. The irregular restoration clears 36 inherited bits and 88,083 added in
v26. The larger irregular scrape therefore arose predominantly from the v26
object-envelope expansion. The frozen prior mask files remain unchanged.

## Validation and evidence

- `wall-284-repair-all-comparison.jpg`: same-camera before/after of both patches.
- `wall-284-oblique-repair-all-comparison.jpg`: second viewing angle.
- `both-wall-repairs-closeup.jpg`: enlarged side-by-side detail.
- `overview-284-repair-all-comparison.jpg`: overview showing the restricted change.
- `restoration-all-selections.json`: exact source seeds, per-patch footprints,
  algorithm, clear-bit counts and hashes, guard metrics and source receipts.
- `repair-all-render-metrics.json`: pixel changes and production position readback.
- `exclusion-origin.json`: v25/v26 contribution to the corrected exclusions.

In the reviewed overview, close-up and oblique renders, respectively 1,113,
7,078 and 7,359 pixels change. Every restored first-visible surface belongs to
the original largest connected mesh component (ID7), and every changed surface
coordinate lies within a declared restoration footprint to the nearest-sample
tolerance. The source cut-face array is hash-identical before and after each
render. The old lumen clump remains suppressed.

The combined boolean clear mask has SHA-256:

`ac5d0d8771272e5bb14e0ae8ef13aea171c8abeda24d754e0345e1328aa5fbea`

The immutable source manifest has SHA-256:

`e50ab70a52373dc774cf6077ef906a753e56b78b9f9b646fba2ffe7220ff338c`

The original gentle HFM has decoded SHA-256:

`175548ddaad01c409d59d561df6018c5cb0c90752b2ec771899c255065398dae`

## Reproduction and integration

From the repository root, with the verified fine-volume brick bank restored:

```bash
python scripts/cleanup-v27-wall/restore_wall.py --all
python scripts/cleanup-v27-wall/locate_wall.py --repair-all overview-284 wall-284 wall-284-oblique
```

For the v27 builder, import `restore_all_selections(reader)` from
`scripts/cleanup-v27-wall/restore_wall.py`. It returns `(lowerXYZ, upperXYZ,
clearMaskZYX, report)`. Apply `new_atrial[local_slice] &= ~clearMaskZYX` and keep
all new exclusions outside the two declared restoration footprints. Require
the final asset comparison to match the declared 109,928 cleared samples.

Native EGL verification tests rendering, source correspondence and reversible
visibility. It does not establish clinical validity, anatomical segmentation
ground truth, or browser/device performance. Source surface irregularity and
the original mesh's decimation remain visible.

## Independent review of the retained PA strip

The central jagged arc still visible in section335 was reviewed separately,
using the original production position maps and a bounded source subvolume.
`pa-arc-source-support.jpg` and `pa-arc-source-points.json` show six sampled
locations. Their nearest foreground belongs to the same local 2,067,090-sample
component as anchored dense vessel-wall source. The mesh locations are only
2.24–7.55 fine samples (0.18–0.60 mm) from that dense source, inside the existing
nine-sample mesh allowance. All six belong to original mesh component7.

These measurements do not establish what the attached material is. They show
that a broad exclusion or reduced wall guard cannot cleanly separate the strip
from the supported surface with this decimated mesh. The recommended v27 scope
retains that central attached strip and limits further cleanup to separable
fringe material. A completely smooth appearance here would need separately
validated local surface reconstruction rather than another broad mask. No PA
mask modification is made by this review script.

Reproduce this read-only check with:

```bash
python scripts/cleanup-v27-wall/review_pa_arc.py
```
