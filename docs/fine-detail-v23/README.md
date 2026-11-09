# Gentler main-view reconstruction — v23

This work addresses the **main Reconstruction page's 79.4 µm fine surface** shown
in the user's screenshots. It is separate from the 19.85 µm selected-region
surface in the whole-native inspector. The source bank and its calibrated
coordinates are unchanged.

## Selected method

The selected scalar filter is Gaussian **σ0.5 fine samples (39.7 µm)**, reduced
from v19's σ0.8 (63.52 µm). The threshold remains **0.28 normalized / 71.4 in the
stored uint8 encoding**. There is no mesh-vertex smoothing pass.

Each 64-cell source-Z slab is read from individually verified source bricks
with four real overlapping samples. Extraction uses the same VTK FlyingEdges
contour and endpoint mapping as v19. The pipeline never assembles a full-volume
array. The fine source grid remains **1897 × 1897 × 2117**, and acquisition XYZ
maps to the viewer's `(x, z, -y)` coordinates.

The mesh reduction retains open boundaries and every slab-plane contour point
at its exact position. Interior edge collapses must satisfy the two-face edge
link condition; a tetrahedron safeguard prevents the last four-face closed
component collapsing into coincident triangles. A conservative radius tracks
the accumulated movement of the original vertices represented by a collapsed
vertex. The limit is **0.6352 mm**. This is a conservative per-vertex reduction
limit, not a measured surface error, a bound on filtering error, or an anatomical
accuracy claim. A face-count target never overrides these constraints.

Frozen boundaries are welded with a **0.0001 mm** seam tolerance. The v23 welder
identifies actual open boundary edges. It preserves locally closed surface
patches that only touch a slab plane at a point; such a point is not a missing
seam to repair.
There is no final whole-organ triangle-budget simplification. Encoded zero-area
faces and unused points are removed; point normals affect shading only. The
HFM1 coordinate and normal encoding remains 16-bit. The final encoded geometry
and exact part sizes are recorded in `preparation.json` after generation.

## Why σ0.5

`source-filter-comparison.json` and its scientific rendering compare σ0, 0.35,
0.5 and 0.8 on the same measured local data. A deliberately geometric proxy
finds original foreground with local maximum distance-to-background no greater
than 1.01 fine voxels in a 5³ neighborhood. It includes real fine geometry and
noise; it is **not** a leaflet, chordal or vessel annotation.

| Measured probe | σ0.35 retained proxy | σ0.5 retained proxy | Prior σ0.8 retained proxy |
|---|---:|---:|---:|
| LV inflow region | 89.69% | 49.88% | 19.78% |
| RV inflow region | 92.02% | 51.87% | 13.93% |
| Selected outer-wall region | 84.86% | 30.56% | 4.01% |

σ0.35 stays close to the almost unfiltered source but retains considerably more
noise and produces a much larger topologically constrained mesh. σ0.5 retains
substantially more of the selected fine-support proxy than the previous filter
while reducing that burden. The previous polished meshes remain available as
explicit comparisons.

`mesh-pilot-sigma-0.5.json` measures several displacement constraints before
whole-organ processing. All tested local candidates retained their source
mesh's connected-component count, Euler characteristic and boundary-edge count.
The geometry constraint is verified again by exact slab-plane position checks
for every whole-organ slab. These checks do not establish anatomical validity.

## Delivered-geometry verification

`hosted-baseline-comparison.json` records the previous meshes against fixed
measured source queries. `hosted-comparison.json`, created after encoding, tests
the delivered gentle mesh on **the same queries**. It includes source-filtering,
mesh reduction and final coordinate-quantization differences.

Nearest-point tests use area-weighted source-surface samples and the original
thin-support voxel centers. A padded candidate region contains every mesh
triangle whose bounding box intersects the source ROI plus 8 mm. Every measured
distance must remain below that padding; therefore an excluded triangle cannot
be nearer. These are finite, targeted samples rather than a Hausdorff bound or
an anatomically balanced study.

The baseline already confirms substantial geometry loss in these selected
regions: the previous polished **detail** mesh's source-surface p95 distances
were 0.584 mm in the LV inflow probe, 0.457 mm in the RV inflow probe and 2.767 mm
in the outer-wall probe. The final comparison report is the authority for the
new mesh's measured improvement.

### Final delivered result

The delivered gentle mesh has **23,618,685 triangles and 12,837,189 vertices**.
Its download is **227,902,460 bytes** (227.9 MB; 217.34 MiB), split into nine
24 MiB parts and one 1,410,044-byte part. The decoded HFM1 payload is
**437,470,524 bytes** (417.20 MiB). This is an explicit large-detail download;
the original polished choices remain useful for smaller transfers.

| Targeted measured probe | Previous detail p95 source distance | Gentle detail p95 source distance | Reduction |
|---|---:|---:|---:|
| LV inflow | 0.584 mm | 0.162 mm | 72% |
| RV inflow | 0.457 mm | 0.156 mm | 66% |
| Selected outer wall | 2.767 mm | 0.381 mm | 86% |

The fraction of original thin-support centers within one 79.4 µm sample of the
delivered surface rose from **19.6% to 57.4%**, **9.8% to 59.9%**, and **1.0% to
43.4%**, respectively. These are geometric proximity metrics that include
noise; they do not measure the percentage of anatomical tendons or vessels
recovered. All three p95 comparisons use the same 12,000 original-source
surface points for the previous and new delivered meshes.

All ten part checksums, the concatenated gzip checksum and decoded payload
checksum passed. Delivered normals are finite and normalized, indices are in
range, and no encoded zero-area faces remain. Maximum coordinate-quantization
error was **2.0633 µm** relative to the reduced float mesh. Encoding removed
**347,890 triangles collapsed to zero area** at 16-bit position precision and
used **21** nondegenerate-face normal fallbacks. These cleanup counts are
explicit; final encoded topology is not claimed identical to the scalar field.

The complete 30-seam audit found no unmatched open edge and no unstitched seam
edge. Welding changed **no point position**; 41 duplicate boundary-index aliases
were unified. One edge was over-incident before encoding because of two
microscopic sliver triangles, both of which collapse to zero area at the actual
delivered precision. No over-incident seam edge remains after that cull.

Encoding peaked at **1,798.5 MiB**; delivered-geometry verification peaked at
**1,293.3 MiB**. These preparation-process measurements are not browser-device
performance guarantees. The full processing fingerprint is
`950fbc2caf1b1f24086decf15edf53d1b54bea52f96b4f6ac18ba7b5b2fe2fb1`.

Scientific EGL comparison images show actual geometry, with the same camera,
crop, illumination and open source-Z cut within each row. They are separate
from browser screenshots and the production-shader lumen review. They do not
prove that every visible small feature is anatomy.

## Scope and limits

The bank is the existing cleaned/windowed uint8 display representation, not the
original quantitative acquisition. It does not contain calibrated Hounsfield
units. Applying ordinary clinical tissue-HU ranges to it would be unjustified.
Its earlier preparation and the 79.4 µm sampling can already have removed or
blurred structures that this update cannot recover.

Less scalar smoothing and constrained simplification preserve additional
measured geometry **and residual noise**. This update does not assert recovery
of every chord, leaflet edge, external vessel or native-resolution feature.
Anatomical truth would require independent source annotation and review.

The separately reviewed LA and outflow lumen masks are display-only and are
documented under `docs/lumen-artifacts-v23/`. They do not modify this extraction
or the source bank. Their effect is applied consistently to the displayed mesh
and measured cut face, with an explicit control to inspect the original view.

## Reproduction and checkpoints

Prerequisites are Python, NumPy, SciPy, VTK, Pillow and a C++17 compiler. The
bounded QEM implementation builds from an unchanged, SHA256-pinned upstream MIT
header plus an explicit generated constraint patch. It requires no additional
package download. Attribution is in `scripts/fine-detail-v23/vendor/`.

```sh
python scripts/fine-detail-v23/compare.py
python scripts/fine-detail-v23/mesh_pilot.py --sigma .5
python scripts/fine-detail-v23/resume.py --work /path/to/fine-v23 --capture
python scripts/fine-detail-v23/prepare.py --work /path/to/fine-v23 \
  --sigma .5 --radius-mm .6352 --slab-cells 64 --workers 1
python scripts/fine-detail-v23/validate_seams.py --work /path/to/fine-v23
python scripts/fine-detail-v23/weld.py --work /path/to/fine-v23
python scripts/fine-detail-v23/finish.py --work /path/to/fine-v23
python scripts/fine-detail-v23/validate.py --work /path/to/fine-v23
python scripts/fine-detail-v23/format_comparison.py
```

`configuration.json` fingerprints the source manifest, scientific script
hashes and all extraction/reduction settings. Every slab has an atomic array
checkpoint, a SHA256 receipt and that exact fingerprint. The progress ledger
is atomically copied to `docs/fine-detail-v23/progress.json` after each slab.
Restarting the extraction command verifies completed slabs and skips them.
Different scientific code or settings require a new work directory.

The separate `environment.json` receipt also records the numerical library and
compiler versions, imported v19 contour/welder code and pinned upstream QEM
header. Restore this receipt with the checkpoints and use
`python scripts/fine-detail-v23/resume.py --work /path/to/fine-v23` to verify it
before resuming. Final encoding checks every source slab and receipt again and
records a full processing fingerprint including the encoder and these imported
dependencies in `final-preflight.json`.

Guarded resume holds a nonblocking per-work-directory file lock and passes that
lock to its preparation child. It also detects an already running direct
`prepare.py` job, including the original run that predates the lock helper.
The lock and numerical-environment checks are exercised by
`tests/fine-detail-v23-resume.py`; no verification step starts a duplicate job.

### Recorded recovery of slab 1536–1600

The original run retained 30 complete slab checkpoints but stopped updating its
master ledger after a plane-vertex-count assertion failed on one slab. The
queued workers completed the later slabs, so the progress file underreported
the geometry already saved. Re-inventorying the actual checksum-verified
receipts recovered that progress.

Only the missing slab was replayed with the unchanged numerical pipeline. All
45,941 lower and 39,431 upper original frozen coordinate multiplicities were
preserved, and both open-contour edge multisets were bit-exact. The output had
one additional vertex on the upper plane. An independent review found a closed
six-triangle fan, six incident edges of incidence two, and a connected
degree-two vertex link. The count assertion had treated this added interior-fan
vertex as evidence of a changed boundary.

Float32 rounding onto the plane is consistent with the implementation and the
observed extra vertex, but is an **inference**: pre-cast double coordinates were
not logged. The captured unchanged-pipeline replay NPZ was retained byte for
byte; the unretained first attempt cannot be claimed byte-identical. No vertex
was moved and no face was deleted for this recovery. The original strict
assertion remains in the original preparation script.

The explicit validation addendum, original failed assertion, boundary proof,
payload hashes and independent review are stored in
`slab-1536-recovery.json`, `slab-1536-diagnostic.json`,
`slab-1536-input-boundaries.npz` and `slab-1536-independent-review.json`.
The successful slab NPZ itself is included with the ordinary checkpoint pairs.
These files are sufficient for the guarded restore; the transient diagnostic
directory is not required. Final encoding verifies this evidence and binds it
into the full processing fingerprint.

Archive the configuration, environment receipt, source-ready metadata, complete slab array/receipt
pairs, current extraction ledger and exact code revision together. The Box
checkpoints managed for the project provide durable copies. A progress ledger
alone describes completed work but cannot restore missing geometry. The
immutable fine brick bank is still required to regenerate unfinished slabs.

The final gzip stays in the work directory. Public assets contain only its
ordered **≤24 MiB byte parts** and manifest. Despite their `.gz` suffix, these
parts are not individually decompressible: the client verifies every part,
reassembles and checks the single gzip object, then checks the decoded HFM1
payload. This transport split does not split or resimplify the welded geometry.

Generation uses one fresh worker per slab under the 8 GiB memory limit. The
dense 896–960 pilot retained 1,626,799 faces from 18,148,532 extracted faces,
with exact slab-plane preservation, 123.5 seconds total processing and a
4,934.5 MiB native-process peak. Whole-run receipts record the actual maximum;
this one pilot is not a universal resource guarantee.
