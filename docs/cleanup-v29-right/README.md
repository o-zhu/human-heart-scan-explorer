# v29 pulmonary and right perivascular refinement

## Selected result

This review supplies two reversible display patches for LADAF-2021-17. The
pulmonary patch replaces the v28 pulmonary slot. The new right perivascular
patch occupies the fourth slot. The matched HFM surfaces and exact packed
low-band masks are in `public/assets/cleanup-v29-right/`; the verbatim processing
policies are in `patch/`. `manifest-entries.json` supplies the two canonical
integration entries without changing the frozen v28 manifest.

The source is the existing windowed **79.4 µm HiP-CT uint8 display bank**, not
calibrated Hounsfield units. Original scan arrays, original mesh payloads,
measured 2D CT cards, v26 detached-component flags and historical object masks
were not rewritten. Surface cleanup is separate from the v29 normals-only
stripe correction and transport compression work.

| Selected patch | Source XYZ bounds, upper exclusive | Runtime surface | Runtime low-band mask | Triangles |
|---|---|---:|---:|---:|
| `pulmonary-lumen-v29` | `[604,1080,540]` to `[790,1360,972]` | 5,109,781 bytes | 408,027 bytes | 514,232 |
| `right-perivascular-v29` | `[530,815,690]` to `[1030,1060,890]` | 7,002,408 bytes | 363,072 bytes | 682,317 |

All four compressed runtime objects are below the existing 8 MiB individual
object ceiling. The pulmonary surface is 214,252 bytes smaller and has 21,302
fewer triangles than the v28 pulmonary patch. The exterior patch adds a bounded
local replacement, rather than changing the global source threshold.

## Pulmonary lumen review

The latest Coronal 191/475 screenshots correspond to fine X=760. A diagnostic
production render exported the source XYZ coordinates of visible mesh pixels.
The remaining perivalvular veil localized principally to X≈645–700,
Y≈1133–1291, Z≈847–881. Sampled smoothed display intensities were around
118–129 at those low-threshold surfaces. These values are display-bank levels,
not calibrated tissue densities.

Two deliberately broader candidates were compared before selecting the final
field. Raising all of the old pulmonary selection to 140 gave only modest
improvement. Raising it to 155 roughened an otherwise smooth proximal vessel
wall and was rejected. Their compact comparison images and configurations are
retained under `pa140/`, `pa155/` and the script directory, but their binary
surfaces are not packaged or selected.

The selected configuration preserves the v28 field, including its 120 maximum,
and adds a stronger field only inside seven reviewed perivalvular profiles from
X=626 to X=750. The extra field reaches 155 at its interior and returns smoothly
to the previous field in a ten-sample polygon collar. The actual additional
excluded samples are bounded by `[632,1108,802]` to `[745,1303,931]`.

The final mask adds **169,130** excluded low-band samples to the v28 mask and
restores none of the old excluded samples. The total low-band count is
1,139,693. The delta and its exact bounds are recorded in
`pulmonary-mask-delta.json`.

The threshold stage retains all **2,945,931** samples with smoothed display
level ≥155 and all **1,183,484** original samples ≥190 inside the patch box.
The additional field does not reach the smooth upper wall seen in the
screenshots. The final front and oblique comparisons show reduced irregular
veil coverage while that wall remains continuous.

This is a selective refinement. The connected central arc, dense leaflet-like
profiles, and some residual source-connected matrix remain visible. A lower
wisp localized near fine Z≈1022 lies outside the pulmonary patch; its continuing
source support was not sufficiently resolved to justify extending the selected
footprint. Biological identity of the retained or suppressed material is not
established by this review.

## Exterior aorta/RV/RA region

The latest Axial 210/530 screenshots correspond to fine Z=836. Serial review
examined the weak matrix between the right-sided wall and the great-vessel
region. Multiple bright tubular profiles remain continuous in successive
sections. The selected field follows the weaker intervening material without
raising the whole exterior threshold.

Seven profiles at Z=702, 720, 760, 800, 836, 860 and 878 define the bounded
region. The local maximum is **110**, with fourteen-sample polygon,
ten-sample box and twelve-sample end collars. The broader uncertain
appendage/trabecular area at earlier Z planes was excluded from the refinement.

The low-band mask suppresses **831,493** samples. Its threshold stage retains
all **1,974,459** smoothed samples ≥155 and **1,108,268** original samples ≥190
inside the patch box. The before/after close view shows less sharp matrix and
more clearly separated tubular surface profiles. This supports a claim of
improved visibility in the reviewed area; it does **not** establish a named
coronary-artery segmentation, coronary continuity throughout the specimen, or
complete removal of exterior noise. Some dense and ambiguous connected material
was deliberately retained.

The exterior box is disjoint from the expanded v29 LVOT box
`[1018,944,916]` to `[1212,1204,1372]` because its upper Z is 890. It is also
disjoint from the pulmonary patch because its upper Y is 1060 and the pulmonary
lower Y is 1080. This avoids competing replacement ownership.

## Source and geometry method

`scripts/cleanup-v29-right/build_patch.py` explicitly wraps the frozen v28
adaptive builder, whose SHA is pinned in each policy. Each source brick is
verified against the existing fine-volume index. The source is filtered at
sigma 0.5 fine samples with three-sigma support and real neighboring samples.
A signed-distance interpolation of the reviewed serial polygons forms the
local threshold field. Cubic smoothstep collars return it to the original
71.4 display isovalue at every crop boundary. A complete source-derived zero
isosurface is extracted; the change does not punch fragments out of the old
mesh and leave unsurfaced edges.

Original bright source samples ≥190 are protected separately, and the local
ceiling preserves smoothed samples ≥155. Both policies record zero lost core
samples and zero non-baseline crop-face samples. These are threshold-stage
counts. They precede the separately documented inherited display filter for
complete detached compact components and must not be interpreted as a promise
that every bright detached fragment remains displayed.

That component filter preserves the largest component, all components reaching
a crop face, and the existing long-thin shape protections. It inherits the
established 0.85 mm/PCA/triangle-count rules plus the existing bounded
perivalvular 1.5 mm rules; there is no new 4 mm arterial-component expansion.
Counts and code hashes are present in each policy. These component counts are
from the newly extracted local geometry, not additional whole-heart v26 counts.

The topology-constrained QEM reducer freezes crop boundaries, applies the
interior link constraint and limits accumulated vertex-cluster radius to
0.3176 mm. Positions are encoded as uint16 in local physical bounds; normals
use int16. The delivered geometry was compared to its filtered source-derived
reference with 12,000 samples in each direction:

| Patch | Source → delivered p95 | Delivered → source p95 | Maximum sampled source → delivered | Maximum sampled delivered → source |
|---|---:|---:|---:|---:|
| Pulmonary | 0.04355 mm | 0.03551 mm | 0.15086 mm | 0.09219 mm |
| Exterior | 0.04621 mm | 0.03647 mm | 0.14378 mm | 0.09530 mm |

These are finite-sample geometric distances to the processed local source
surface. They are not Hausdorff bounds or anatomical accuracy estimates. The
QEM cluster-radius limit is a separate conservative constraint. No new native
19.85 µm information is claimed.

Both patch boxes are disjoint from the full bounds of the exact v27 atrial
wall-restoration union. The serial source audits verify that the 109,928
restored samples cannot be re-excluded by either new low-band mask. The masks
and source overlays are independent of source image brightness adjustments.

## Verification and evidence

The review renderer uses the production GLSL, the original Gentle vertex and
index attributes, existing v28 object masks and the same verified measured cap
for each pair. Geometry is submitted in consecutive exact triangle batches to
bound memory. Camera-frustum culling discards only off-screen source geometry;
no review decimation is performed. `used.npy` preserves original vertex IDs for
the independent normals-only review.

| Evidence | Purpose |
|---|---|
| `pulmonary-final/pulmonary-x191-comparison.jpg` | Selected local pulmonary field, same front camera |
| `pulmonary-final/validation.json` | Exact restoration, cleanup-off equality, cap identity, source/renderer hashes |
| `pulmonary-final-oblique/pulmonary-x191-oblique-comparison.jpg` | Second pulmonary viewing direction |
| `exterior-final-wide/exterior-z210-comparison.jpg` | Full reviewed exterior field |
| `exterior-final-wide/validation.json` | Exact restoration, cleanup-off equality, cap identity, source/renderer hashes |
| `exterior110/exterior-z210-close-comparison.jpg` | Tubular-profile preservation and visible matrix reduction |
| `source/pulmonary-boundaries.png` and `.json` | Original sections at X=640,680,720 with exact excluded-band overlays |
| `source/exterior-boundaries.png` and `.json` | Original sections at Z=720,780,836 with exact excluded-band overlays |
| `source/*-serial.png` and `.json` | Wider unmodified serial source context |

Both full review cases passed byte-identical restoration after swapping back
to v28 and byte-identical original rendering with cleanup disabled. Source cap
arrays had the same hash before and after each pair. The second pulmonary angle
and exterior close view were additional visual checks; their quick receipts do
not repeat the full reversal proof.

These checks establish bounded processing, runtime asset integrity and matched
render behavior. They do not measure browser frame rate, validate tissue
identity, or certify the image for clinical use. The combined v29 runtime also
needs the separate canonical integration tests, because these comparisons
isolate the right-sided patches from the independent LVOT/LA, normal and codec
changes.

## Reproduction

Use the restored immutable fine-volume bank under `data/ultra-volume-v7`, the
original decoded HFM with SHA
`175548ddaad01c409d59d561df6018c5cb0c90752b2ec771899c255065398dae`, and the pinned
scientific environment. This run used Python with NumPy 2.3.5, SciPy 1.17,
scikit-image 0.25.2, trimesh 4.7.4 and VTK 9.5.2.

```sh
python scripts/cleanup-v29-right/build_patch.py scripts/cleanup-v29-right/pulmonary-local-candidate.json --output /path/to/pa-local
python scripts/cleanup-v28-right/compact_patch.py /path/to/pa-local/pulmonary-lumen-v29-policy.json --radius-mm .3176 --samples 12000
python scripts/cleanup-v29-right/build_patch.py scripts/cleanup-v29-right/exterior-candidate.json --output /path/to/exterior110
python scripts/cleanup-v28-right/compact_patch.py /path/to/exterior110/right-perivascular-v29-policy.json --radius-mm .3176 --samples 12000
python scripts/cleanup-v29-right/package_selected.py --pulmonary /path/to/pa-local/pulmonary-lumen-v29-policy.json --exterior /path/to/exterior110/right-perivascular-v29-policy.json
```

The exact pre-reduction SFR files are analysis references, not runtime assets.
Their sizes, layouts and compressed/decoded hashes remain in the copied
policies. The completed references and lossless review PNGs are retained in
`{source-cache}/cleanup-v29-right/pa-local` and
`{source-cache}/cleanup-v29-right/exterior110` during this run; they can also be
recreated from the pinned source and scripts. Large references were not added
to the website deployment or Git source push. All selected HFM/mask pairs are
present in the checkout and verified again by `package_selected.py`.
