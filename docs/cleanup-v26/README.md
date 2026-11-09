# Second reviewed reconstruction cleanup

This release extends the reversible 3D display cleanup for **LADAF-2021-17**.
It targets the residual atrial object, arterial particles, the sheet proximal
to the aortic valve, and small detached perivalvular and right ventricular
fragments identified in the user's follow-up screenshots. The source volume,
original mesh files, and measured 2D CT cards remain unchanged.

The largest free portion of the residual rounded atrial core and the proximal
aortic sheet are removed in the matched review views. A wall-side atrial
remnant and some connected arterial surface roughness remain protected.
These are reviewed display exclusions, not validated tissue labels or a
diagnosis of thrombus, artifact, or normal anatomy.

## Exact source and scope

The main **Ultra-high Fidelity** surface retains the internal profile ID
`gentle` and its original 79.4 µm source geometry. This cleanup does not replace
that whole-heart mesh with 19.85 µm geometry. The independent native region
feature can add a selected stored 19.85 µm patch, using the existing registration
and processing qualifications; its immutable source bank is unchanged.

| Input | Pinned identity |
|---|---|
| Fine display bank manifest | `e50ab70a52373dc774cf6077ef906a753e56b78b9f9b646fba2ffe7220ff338c` |
| Original decoded Gentle HFM | `175548ddaad01c409d59d561df6018c5cb0c90752b2ec771899c255065398dae` |
| Original geometry | 12,837,189 vertices; 23,618,685 triangles |
| Full fine grid | 1,897 × 1,897 × 2,117 original sample positions |
| Coordinate convention | Acquisition XYZ maps to world `(x, z, −y)` |

The fine bank contains windowed uint8 display values. Thresholds below refer
to those values, not calibrated Hounsfield units or original quantitative
intensities. The display-card section conversion used here is
`fineY = 4 × (section − 1)`; the camera can expose many source planes behind
that cut, so object review uses 3D position readback and serial source planes.

## Four source-constrained visibility masks

| Mask | Logical XYZ samples | Excluded logical samples | Packed bytes |
|---|---:|---:|---:|
| Atrial | 310 × 437 × 700 | 15,567,968 | 11,930,100 |
| Arterial | 650 × 381 × 560 | 1,013,562 | 17,495,520 |
| Valve region | 430 × 270 × 470 | 533,645 | 6,852,600 |
| RV and apical region | 570 × 420 × 710 | 703,123 | 21,470,400 |

These counts include the display-support halo and can overlap between masks.
They are not estimates of biological material volume. The four masks require
**57,748,620 decoded bytes** and **1,237,051 gzip bytes**. X-axis bit packing
preserves every original fine-grid mask sample: byte `floor(x / 8)`, bit
`x & 7`, least-significant bit first. Row-tail padding is zero. There is no
mask downsampling, interpolated visibility, or loss of logical resolution.

### Atrial object and its residual bright core

The frozen v25 atrial mask is retained exactly, including all 8,052,055 of
its previously selected logical samples. The v26 review extends the serial
object envelope, supports it with measured foreground, and protects dense
tissue anchored outside the reviewed object. The source field uses Gaussian
sigma 0.5 and 0.8 fine samples; strong support is raw value ≥190 or either
filtered field ≥135. The foreground support threshold is sigma-0.5 value
≥71.4, corresponding to the fixed surface threshold 0.28 × 255.

The mesh-support margin is nine fine samples (0.7146 mm), with a wider
ten-sample dense-tissue guard (0.794 mm). The previous two-sample support
margin could miss visible geometry after the stored mesh's bounded vertex
clustering. The eight-sample cluster radius is a bound on accumulated cluster
movement; it is not a surface Hausdorff bound or an anatomical guarantee.
Both support and dense-tissue distances in this object mask are Euclidean
3D distances, calculated with thirteen real source samples of padding.

The first v26 candidate left a conspicuous rounded core because expansion was
seeded only from the previously excluded part of the object. Production
position readback located the remnant near fine XYZ
`[1310–1357, 1130–1213, 895–979]`, within the original Y bounds. The serial
source review shows porous material before Y1200, a bright core through
Y1200–1240, and a taper by Y1256. A separate explicit seed envelope now
includes that part of the user-selected object, with the same nine-sample
support and ten-sample retained-wall guard. Brightness does not automatically
protect an isolated selected core or establish its biological identity.

The final atrial X bound extends from 1370 to 1390 to cover the reviewed
right edge. The Y interval remains 820–1257, and the source planes and actual
visible positions support that range. A narrow remnant next to dense wall
support is retained. The larger smooth background atrial surface is also
retained; it is connected wall support rather than a free object selection.

See [the core source review](atrial-core-source.jpg),
[mask overlay](atrial-mask-review.jpg), and
[final Y305 comparison](render/atrial-section-305-comparison.jpg).

### Aortic and pulmonary lumens

Reviewed serial seeds select source-derived cavities bounded by large dense
arterial wall components. Leaky, missing, or implausibly large/small cavity
regions are rejected. The frozen 179,720-sample v25 outflow exclusion is
retained exactly. New masks suppress measured foreground and its nine-sample
support inside the reviewed cavities, outside the ten-sample wall guard.

These arterial support and guard distances are **2D in-plane Euclidean
distances around the 3D-filtered source**. They are not the 3D distances used
by the atrial, proximal-sheet, and detached-source-component masks. The
arterial ROI is bounded above the valve apparatus, and neither entire
arterial chamber nor wall is cleared.

Independent position/component review explains why some visually similar
flakes remain. Sampled attached PA bases lie approximately 0.08–0.60 mm from
dense wall, including some outside the fenced cavity, and belong to the main
connected mesh. Other masked points expose a deeper retained wall surface
after their nearer fragments disappear. Those observations do not justify
erasing the connected wall. Exact detached-component checks below remove
additional genuine floating geometry without relaxing this wall protection.
The exact sampled positions, component identities and source-support distances
are recorded in the [focused arterial review](artery-review/README.md).

See [source review](arterial-lumens-source.jpg),
[PA comparison](render/pulmonary-artery-305-comparison.jpg), and
[aortic comparison](render/aortic-lumen-305-comparison.jpg).

### Proximal aortic sheet and small valve/RV fragments

The valve-region mask is new in v26. Its `newParticleSeedMaskSamples` field
counts newly computed v26 particle-mask samples; it is not an inherited v25
valve exclusion. A separately reviewed serial envelope targets the sheet
proximal to the aortic valve, using the same measured-foreground support and
3D dense-wall guard as the atrial object.

The surrounding perivalvular mask starts with small, fully interior
26-connected source components: at most 1,200 foreground voxels, support-box
diagonal ≤1.8 mm, and regularized PCA spread <5. The RV/apical mask uses at
most 1,600 voxels, diagonal ≤2.2 mm, and the same shape limit. Long or strongly
elongated candidates, components touching any processing boundary, and all
retained source support receive protection. The selected component halo is
nine fine samples; all retained source foreground has a ten-sample guard.

Processing uses 96-sample Z cores with forty real source samples of overlap.
Forty samples exceed the maximum allowed fragment extent plus the guard.
Only accepted core pixels are committed. Per-tile component counts can repeat
an object in overlapping context; final mask sample counts are unique within
each mask. These selections preserve connected trabeculae, papillary muscles,
leaflets and long chord-like components rather than treating all dark
structures as artifacts. No valve intensity is whitened.

See [proximal-sheet comparison](render/aortic-sheet-mitral-265-comparison.jpg),
[tricuspid comparison](render/tricuspid-region-256-comparison.jpg), and
[RV apex comparison](render/rv-apex-249-comparison.jpg).

## Complete-mesh detached components

The original complete uncut mesh graph is relabeled by shared-vertex
connectivity. The exact v25 flags are verified and retained. New exclusions
are also whole connected components, with one 0/255 visibility flag per
original vertex and uniform flags at all three corners of every triangle.

| Change beyond v25 | Components | Vertices | Triangles |
|---|---:|---:|---:|
| Union of new local selections | 10,986 | 67,199 | 93,761 |
| Arterial selection | 104 | 847 | 1,428 |
| Perivalvular selection | 6,939 | 42,232 | 58,843 |
| RV selection | 5,919 | 36,108 | 50,023 |

Regional selections overlap, so the regional rows must not be summed. Across
v25 and v26, 1,352,992 components and 5,832,864 triangles are flagged, leaving
**17,785,821 triangles before the separate spatial lumen masks**. New v26
flags account for about 0.397% of the original triangles.

Arterial candidates have bounding-box diagonal ≤4 mm and ≤6,000 triangles,
and must lie within the reviewed source cavity at every original vertex,
every edge midpoint, and every triangle centroid. The build examines 3,137
candidate components and 29,480 original vertices; 3,033 candidates fail
vertex membership. All 5,712 edge/centroid samples of the 104 remaining
components pass. Bounding-box corners are not required: they are not actual
fragment geometry and wrongly rejected a confirmed floating PA flake near
an irregular cavity boundary. These finite geometric checks are stated
explicitly; they are not a mathematical claim about every continuous point
of a triangle.

Perivalvular/RV candidates must be compact (diagonal ≤1.5 mm, PCA spread <4.5,
≤2,048 triangles), or very small two-dimensional flakes (diagonal ≤0.65 mm,
PCA spread <10, larger-axis ratio <2.5, ≤256 triangles). Long one-dimensional
structures remain protected. The complete-component filter preserves the
largest component and components touching quantized source boundaries.
Separate reviewed spatial masks can exclude selected portions of that main
component; preserving its component flag does not mean every point of the
main mesh remains visible.

The original positions, normals and indices remain byte-identical.
[debris-audit.json](debris-audit.json) records their hashes and the checks.
[newly-excluded-mesh-components.csv.gz](newly-excluded-mesh-components.csv.gz)
contains every new component decision and its measured geometry, retained
in the source repository. The immutable complete v25 ledger remains the
baseline dependency. The arterial cavity volume is a regenerable analysis
intermediate under `{source-cache}/cleanup-v26/`.

## Verification and reproducibility

[asset-validation.json](asset-validation.json) independently verifies actual
compressed/decoded hashes, exact storage dimensions and bit counts, zero
padding, all 1,200 coordinate fixtures, full policy digests, and inclusion of
every previously selected v25 mask sample. It also checks both stored and
decoded hashes for **2,553 unique source bricks**, covering all four ROIs
plus forty fine samples of context. This is the complete independent source
verification receipt; a cached manifest assembly's source-read count should
not be interpreted as the count used by every earlier scientific build.

Each mask builder performs a full logical-grid packing/unpacking comparison.
New selections have zero overlap with their specified retained-support
guard. This claim concerns **new v26 selections**; the exact frozen v25
selection used an earlier guard and is preserved without reinterpretation.

[render/validation.json](render/validation.json) records nine production-GLSL
comparisons with matched cameras, source/mesh/shader identities, source-cap
hashes and per-render raw image hashes. Each case verifies that v25 → v26 →
v25 restores exactly and that disabling cleanup gives identical original
views under either asset version. The source cap byte array remains unchanged.
The compact JPEGs in this directory are review images; lossless renders are
regenerable supplemental output under `{source-cache}/cleanup-v26/render/`.
Exact pixel hashes describe this EGL/Mesa fixture, not a promise of identical
rounding on every GPU. These renders do not measure browser frame rate or
validate anatomical identity.

Run from the repository root:

```sh
python3 scripts/cleanup-v26/build_masks.py
python3 scripts/cleanup-v26/build_debris.py
python3 scripts/cleanup-v26/validate_assets.py
python3 scripts/cleanup-v26/render_review.py
```

`build_masks.py --case atrial` (or `arterial`, `valve-region`, `rv`) rebuilds
one mask and assembles the manifest from the other verified build records.
The full policies and per-slab/per-tile summaries are in the four
`*-mask-build.json` records and `lumen-build.json`; the binary masks encode
every final logical decision, while source-component examples in the policy
are explicitly capped samples. The runtime manifest contains compact
summaries and full-policy digests. The original source banks, v25 masks, mesh transport
pieces, and source metadata are immutable dependencies. No scan upload gate
is reopened by this work.

## Remaining limits

The rounded LA core is substantially cleared, with a protected wall-adjacent
remnant still visible. Some PA/aortic bases remain because they are connected
to, or within the stated protection distance of, dense wall. Cleanup around
chordae and the RV apex is deliberately bounded to detached candidates; it
does not remove connected trabecular texture. Section cards still show the
original specimen material. Further removal of those ambiguous attached
surfaces would require a separately reviewed segmentation rather than a
broader chamber-wide exclusion.
