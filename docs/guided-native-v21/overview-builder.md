# Whole-bank display overview builder

`scripts/guided-native-v21/build_overview.py` creates a lossy display mesh from
the completed reconstruction's `role: overview`, step-4 NBE1 artifacts. It reads
the native bank and never edits its files. The original 19.85 µm NBE1 surface
archive remains separate from this 79.4 µm sampled and simplified display LOD.

Run the full builder **after the native reconstruction has completed and released
its decoded source layer**:

```sh
python scripts/guided-native-v21/build_overview.py \
  --run {source-cache}/guided-native-v21/whole/run \
  --out {source-cache}/guided-native-v21/whole/overview \
  --triangles 1500000 \
  --detail-triangles 2500000 \
  --group-blocks 4 --leaf-face-cap 750000 \
  --merge-face-cap 6000000 --intermediate-factor 2 \
  --cluster-max-cell 16 --qem-cell 32 --qem-passes 2
```

Omit `--detail-triangles` to produce only the overview. An incomplete study must
use the explicit `--pilot` option. A normal run requires completed records for
the full core plan, verifies their configuration fingerprints and artifact
hashes, and checks the plan's exact coordinate set when its source file is
available.

## Bounded hierarchy and seams

The spatial octree starts with groups of at most 4×4×4 source blocks. Groups
whose raw overview meshes exceed 750,000 triangles split further. Every vertex
of a step-4 NBE1 mesh lies exactly on a 1/16 native-voxel lattice. Welding packs
three 18-bit integer lattice coordinates into a uint64 key; it performs no
tolerance search or approximate nearest-neighbor merge.

Every reduction verifies the exact coordinates of all group-plane vertices and
the exact one-face edges on those planes. Interior retriangulation chords are
not seam edges. A node that fails this exact check is refused; the check has not
been replaced by a vertex count or tolerance. Surviving intermediate coordinates
remain on the exact lattice.

The earlier VTK-only method proved unsuitable for the approximately one-percent
intermediate targets. In four measured real tiles, three exact seam failures
triggered a full-input fallback, and the remaining tile still missed its target.
Disabling topology preservation and cancelling opposite faces did not reliably
repair this. [Historical probe evidence](overview-vtk-before-fallback.json)
retains the measured coordinates, counts and source hashes. VTK is now attempted
only for moderate reductions whose target is above the frozen-face floor, and
its result is used only if it reaches the target and passes the exact seam check.

The production fallback freezes every group-plane vertex **and all vertices of
every incident face**. Those original faces, including their orientation and
multiplicity, remain unchanged. Free vertices cannot merge with fixed vertices.
Clustering uses a global grid anchored at native zero, tries cell widths 4, 8 and
16 native voxels, and selects an existing free input point nearest each cluster
centroid, with deterministic lattice-key tie breaking. A leaf whose immutable
ring exceeds its proportional budget reports that target miss; it is not
collapsed across the entire node in pursuit of an unreachable target.

At most two refreshed QEM proposal passes can reduce the remaining free interior.
The unconstrained fast-simplification output is never used as an intermediate
mesh. `overview_collapse.c` filters its proposed survivor/removed pairs using
bounded integer incidence lists and union-find. It accepts only a current edge
of a mapped triangle with three distinct roots, with both endpoints free and
inside the same global **32-native-voxel cell**. The installed raw replay then
recomputes QEM positions for exactly that accepted sequence. Original-to-output
mapping must agree with the C partition; all fixed coordinates and protected
face windings are checked before cleanup.

Free replayed positions are rounded to 1/16 native voxel and confined to their
same half-open global cell and the strict group interior. Degenerate free faces,
opposite-winding duplicate pairs and inverted free faces are removed explicitly;
same-winding duplicates retain one face. Coincident free vertices may additionally
weld after quantization; this operation is counted separately from accepted QEM
edges. No fixed/free coincidence is allowed. These operations can remove
components or alter topology and do not prove a manifold or intersection-free
surface.

If a **non-leaf parent** still misses its target and its frozen-face floor fits
that target, a final bounded clustering attempt can use the same 32-voxel global
cells (635.2 µm). It does not enlarge the spatial cell extent already declared
for constrained QEM. This extra component merging is recorded as a separate
parent fallback. The default leaf clustering limit remains 16 voxels (317.6 µm).
The frozen ring is recomputed after every parent weld, releasing obsolete child
seams while preserving the new parent's original boundary.

Parent nodes merge child checkpoints, weld their shared vertices and reduce the
newly joined region. At most 6,000,000 checkpoint triangles may enter one merge
by default. Before allocating an oversized merge, the builder writes
`budget-preflight.json` with child counts, target misses and frozen floors, and
keeps completed checkpoints intact. The additional bounded parent fallback
addresses the measured severe-reduction failure; it is not a proof that every
possible dataset will meet every requested target.
The bound concerns triangle count; peak RAM also includes library structures,
vertices, temporary arrays and the process runtime.

After artificial group seams have been joined, fast-simplification 0.1.13 runs
whole-mesh QEM with aggressiveness 7. This final stage can change topology and
remove thin features. It records actual counts even if a target is not reached.
The installed local package is loaded from the optional `--python-path`; the
builder performs no package installation or source downloads.

## Checkpoints and outputs

`input-manifest.json` lists every overview artifact's path, byte count, hash,
source block coordinate and completed-record hash. It also records the run
fingerprint, source configuration, source-object-ledger hash and core-plan
verification. Both the canonical manifest hash and its on-disk file hash are
retained. `build.json` binds this input evidence, numerical settings and
source-code hashes (including `overview_collapse.c`) to one build fingerprint.
The C filter is compiled locally into a checksum-named temporary shared library;
no package or source download is performed.

`nodes/` contains atomic compressed NumPy checkpoints and their metadata.
Repeating the same command verifies and reuses complete checkpoints and assets.
Different inputs, numerical settings or builder code require a separate output
directory, so stale results are not silently mixed. **Only the operational merge
allocation cap is excluded from numerical identity.** It never changes a target
or algorithm. Its actual value/history remains in `build.json`, node metadata
and the final manifest. A measured cap adjustment can therefore resume verified
nodes; it is not an automatic or unmeasured increase. Loading a saved root also
honors the current cap. `--nodes-only` builds the hierarchy without final export.

The final `manifest.json` identifies each LOD and its `parts`. Normally one HFM1
asset contains a LOD. If a gzip object would reach 32 MiB, spatially ordered
triangle ranges split into smaller assets. All parts retain the same world
positions and global smooth normals at shared vertices. Load every part of a
LOD together.

HFM1 uses format version 1 with **position flag 1**, float32 positions,
normalized signed-int16 normals and uint32 triangle indices. Its source-to-world
transform is:

```text
worldX = (nativeX - 3806.5) / 8479
worldY = (nativeZ - 4239.5) / 8479
worldZ = -(nativeY - 3806.5) / 8479
```

This is the complete source frame, not a crop-centered coordinate system.
Encoding checks include byte/hash round trips, float32 position errors and zero
collapsed/reversed triangles introduced by the final float32 encoding step.
They do not imply that earlier lossy geometry operations preserve topology.

## Sampled approximation errors

Every original leaf mesh contributes deterministic uniform-area samples before
its first simplification. Forward errors use the original encoded overview
surface and the final float32-stored display mesh; summary weights account for
each leaf's surface area. Reverse errors use uniform-area samples on the stored
display surface and a bounded sequence of closest-triangle locators over the
original leaf meshes. Exact spatial-box lower bounds skip groups that cannot
improve the closest distance.

The default is 256 original samples per leaf and 4,096 reverse samples per LOD.
These measurements include both intermediate and final simplification. They
are **sampled distances to the processed, step-4 overview**, not a Hausdorff
bound, an error bound against the raw acquisition, or anatomical validation.

## Dense-leaf fallback proof

The complete 2×2×2 group at block origin **[36,20,14]** contains 448,650 original
step-4 triangles. Its frozen ring alone has 25,988 faces, exceeding the test's
4,487-face proportional target. The same original leaf was also tested with its
artificial child planes released, as a parent-interior stress case. That second
case is **not a complete parent mesh or whole-heart result**.

| Case | Output triangles | Forward p95 / sampled max µm | Reverse p95 / sampled max µm |
|---|---:|---:|---:|
| Real dense leaf, exact six-plane ring | 44,227 | 146.11 / 312.92 | 68.88 / 113.86 |
| Same source, child planes released; bounded parent fallback | 2,666 | 271.04 / 528.42 | 75.21 / 113.35 |

Forward comparisons use 256 original area samples retained before any loss;
reverse comparisons use 128 output area samples and closest original triangles.
The directional difference reflects discarded geometry. These are sampled
distances, **not bounds**. Both cases retained exact boundary signatures, finite
lattice coordinates and nondegenerate surviving faces. The original eight
overview artifacts and completed records retained their hashes. Including the
reverse locator over all original faces, peak process RSS was **277.95 MiB**,
below the 300 MiB ceiling. Simplification took approximately 1.42 s and 1.25 s
respectively in this shared runtime.

The C filter matched a separate Python reference on 80 small random incidence
cases, including adjacency lost through previously collapsed triangles. Invalid
mask lengths, indices and coordinate/cell ranges were rejected before C access.
A complete hosted eight-tile checkpoint pilot resumed at a changed allocation
cap with its fingerprint, checkpoint bytes and modification times unchanged;
changing a numerical cell setting was rejected.

[Fallback verification](overview-fallback-verification.json) contains actual
counts, removal categories, source hashes, directional measurements and resume
checks. `verify-overview-fallback.py` reproduces this bounded offline proof.

## Completed whole build and allocation outcome

The completed build consumed all **37,612** overview inputs, containing
**542,112,884** original step-4 triangles. Its hierarchy has **3,284 leaves** and
**3,838 total nodes**. [The final audit](overview-completion-audit.json), reproduced
by [verify-overview-completion.py](verify-overview-completion.py), rehashed all
903,644,266 checkpoint bytes, validated array headers and reproduced the exact
tree partition and canonical node-record hash. All 3,838 accepted nodes retain
their recorded exact-boundary assertion. A fresh independent comparison of all
12 shared planes between the eight span-32 root children found identical exact
vertex keys and one-face boundary edges. All 816,640 original leaf samples and
their weights survive byte-for-byte to the root.

The original 6-million-face allocation cap correctly stopped before assembling
the root's **7,039,735** child faces. Following the
[independent allocation review](overview-root-cap-review.json), a fresh process
resumed at that exact required cap under a **4.5 GiB address-space limit**. The
geometry fingerprint, source and numerical settings stayed unchanged. The root
had no vertices on its outer planes and a zero protected-face floor; the
unchanged VTK branch reached **4,999,999 triangles**. The successful resumed
process peaked at **2,290,601,984 bytes RSS** and completed in **1,219.38 seconds**.
That time excludes prior parent work and parallel leaf precomputation. The
earlier allocation review's pending outcome is superseded by this measured
completion and the final audit's `capOutcome`.

| Final display | Triangles | Gzip bytes | Decoded bytes | Step-4→display p95 / sampled max µm | Display→step-4 p95 / sampled max µm |
|---|---:|---:|---:|---:|---:|
| Overview | 1,499,999 | 11,012,293 | 24,642,580 | 675.89 / 3,372.99 | 151.87 / 409.13 |
| Detail | 2,500,000 | 19,744,361 | 42,582,052 | 526.00 / 2,669.84 | 153.56 / 396.16 |

Each LOD uses one HFM1 object and fits the individual 32 MiB gzip and 128 MiB
decoded display budgets. Both compressed and decoded identities, HFM offsets,
indices, finite positions, source world bounds and nonzero normals passed fresh
validation. Neither stored mesh has a zero-area triangle. These storage checks
do not establish manifold topology or absence of intersections.

The geometric errors are directional sampled distances against the original
**79.4 µm step-4 surface**, not Hausdorff bounds or anatomical accuracy. Forward
statistics use all 816,640 area-weighted original samples; reverse statistics
use 4,096 samples per display. The meshes are lossy navigation views, separate
from the native archive. The full-bank finalizer retains all 33,046 nonempty
native entries, including the 748 whose step-4 checkpoints have no crossing.

## Historical whole-build planning

The in-progress [planning snapshot](overview-planning-snapshot.json) observed
31,352 completed records and 446,586,697 overview triangles. The fixed plan has
878 occupied span-4 groups and 1,088 nodes down through that level. Of 682 already
complete span-4 groups, 248 needed smaller leaves; none of their span-2 children
exceeded 750,000 faces. Extending that observed split rate suggests roughly
**3,600 total nodes**, but unprocessed regions can differ.

For the requested 2.5-million maximum final target and intermediate factor 2,
the proportional root budget is 5 million faces. If children meet their budgets,
eight child rounding/minimum effects add at most 248 faces, below the default
6-million merge cap. Actual frozen-floor overruns remain explicit and are checked
before every allocation. The released-boundary test demonstrates a bounded route
below its representative one-percent budget; it does not establish the unseen
whole hierarchy's final fit.

A simple extrapolation of the dense-leaf timing, the observed triangle volume,
parent merges and original-mesh distance checks suggests **roughly 40–75 minutes**
for the full builder in this environment after native reconstruction exits.
This is a planning range, not a benchmark or completion promise. Node logs give
measured progress; all finished checkpoints remain resumable.

## Earlier encoding/export pilot proof

The eight completed pilot tiles contained 167,173 overview triangles. The two
leaf reductions preserved all checked seam vertices and boundary edges; the
hierarchy welded 2,964 duplicate shared vertices. Full builder peak process RSS
was **153,210,880 bytes**, below the requested 300 MB pilot ceiling.

| Output | Triangles | Gzip bytes | Original-overview→display sampled p95 |
|---|---:|---:|---:|
| Pilot overview | 30,000 | 371,738 | 39.06 µm |
| Pilot detail | 59,999 | 707,037 | 14.94 µm |

Both assets passed the production `public/native-mesh-format.js` parser.
Resuming reused all eight mesh/checkpoint files unchanged. A forced 100,000-byte
asset limit produced six parts while preserving every ordered triangle position
and normal bit-for-bit. All 16 original pilot NBE1 files retained their hashes.
No whole-organ merge was run during the native acquisition job.

The full measurements and checks are in `overview-pilot-verification.json`.
The reproducible verification entry point is `verify-overview.py`.
