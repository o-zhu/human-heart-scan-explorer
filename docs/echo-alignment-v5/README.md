# Echo acquisition geometry audit

This audit separates three questions: whether the displayed probe and fan occupy
the **actual sampled CT plane**, whether the drawn instrument fits the fixed
illustrative body, and whether the section demonstrates the named clinical
anatomy. Numerical geometry can establish the first two within the stated mesh
and sampling limits. It does not establish clinical registration or identify a
valve, vein, chamber cavity, or Doppler alignment by itself.

## Final measured result

The final exhaustive capture contains **2,576 cases** and has matching runtime
source hashes before and after execution. All **2,190 available acquired-plane
cases** pass the numerical plane/fan, beam-target, region-of-interest coverage,
skin/contact, marker, and controller-handoff checks. The **322 outside-scan
context cases** are kept separate and make no CT-plane correspondence claim.
Default zoom and apical acquisition relations also pass. There are **64
explicitly rejected poses**, and every rejected overlay is hidden.

| Donor | Cases | Available acquired-plane cases | Outside-scan context cases | Rejected defaults | Rejected flip-only cases | Rejected manual adjustments |
|---|---:|---:|---:|---:|---:|---:|
| LADAF-2021-17 | 896 | 781 | 112 | 0 | 0 | 3 |
| S-20-28 | 840 | 701 | 105 | 3 | 3 | 28 |
| S-20-29 | 840 | 708 | 105 | 2 | 2 | 23 |
| Total | 2,576 | 2,190 | 322 | 5 | 5 | 54 |

All 56 current and 56 previous-reference primary-donor defaults are available.
The three primary manual rejections are ME five-chamber, ME four-chamber and ME
right pulmonary veins at **−35 mm offset**. The complete 64-case inventory is
in `current-rejections.json`. No rejected case is counted as a successful
alignment. The largest available-case numerical origin/fan residual is
`2.26e-13 mm`, and the largest plane-normal angle is `1.71e-6°`; these describe
floating-point agreement, not physical anatomical accuracy.

The independent final instrument review tests all 84 TEE default cases across
the three donors: **79 available heads/routes are contained**, and the same five
comparison defaults are explicitly unavailable. No available head vertex,
shaft center, or shaft-radius conflict was found; all three parity rays agreed.

The production controller/solver timings recorded in the exhaustive Node run
have TTE medians near **14 ms** and TEE medians near **21–24 ms**. The 95th
percentile for TEE is about **0.69–0.72 s**, with a maximum **1.44 s** for the
more demanding containment searches. These measurements use stub UI/renderer
objects and exclude GPU rendering, voxel sampling, and network work. They do
not establish interactive browser frame rates; some candidate searches remain
substantially more expensive than the median. Exact per-donor timings are in
`current.md` and `current.json`.

## What failed before the correction

The frozen baseline is commit `f332d9447ad3c83ea6dd9aab4a60e5c8d761d198`.
Its modules and source-frame catalogs were copied without modification to an
isolated audit snapshot. `baseline.json` records the exact source hashes;
`baseline.md` lists every default view and the TEE tract feasibility results.

| Donor | TTE acquired defaults with noncoplanar fan | TEE acquired defaults with noncoplanar fan |
|---|---:|---:|
| LADAF-2021-17 | 20 / 25 | 10 / 24 |
| S-20-28 | 25 / 25 | 12 / 24 |
| S-20-29 | 25 / 25 | 13 / 24 |

For the primary donor, the largest origin-to-plane separation was 56.108 mm in
TTE and 67.226 mm in TEE. The largest fan-to-CT-plane angles were 47.934° and
75.379°, respectively. The clipping-plane, overlay-parameter, and accepted-cap
handoffs themselves agreed. The mismatch arose when the pose solver replaced
a failed plane fit with an independent anatomical estimate.

Pointing the beam toward the CT rectangle's center does not make the two planes
coincident. It supplies only one common point. The old TTE path could also use
an anterior coordinate slab as a proxy for chest contact; a slab is not a skin
surface. Existing tests permitted unresolved independent estimates, so finite
and orthonormal vectors could pass while the visible fan missed the CT face.

The fixed reference body is not moved for individual views. A plane that cannot
intersect its prescribed skin or tract region must instead be reformatted from
the donor voxels through a valid acquisition pose. Old prepared pixels and old
regional findings cannot be attached to that new section.

## Quantities and hard constraints

All physical distances are in world millimetres. The CT center is converted
from normalized donor coordinates using that donor's `referenceMm`. For center
`C`, unit CT normal `n`, probe origin `O`, forward beam `b`, and lateral fan
direction `r`, the audit independently calculates:

- Origin residual: `abs(dot(O − C, n))`.
- Fan normal: `normalize(cross(b, r))`; its angle with the CT normal treats
  opposite normal signs as the same physical plane.
- The largest plane residual over the origin and 147 fan points, using the
  production TTE/TEE fan aperture and three depths.
- Perpendicular miss and signed forward distance to the actual `pose.targetMm`.
  A zoom rectangle or deep-transgastric region of interest need not have its
  center on the central beam.
- Display handedness and normal/right-axis signs, kept separate from physical
  plane agreement.
- The TTE instrument's actual negative-right indicator direction versus its
  marker reference, including default marker agreement.
- Distance from the external origin to the actual anterior skin triangles,
  membership of the fixed reference window, and inward beam direction.

The plane/fan tolerance is **0.00001 mm**, and the angular tolerance is
**0.0001°**. Skin contact uses **0.001 mm**, accounting for the drawable mesh's
Float32 coordinates. These are numerical tolerances, not anatomical accuracy.
The body remains explicitly unregistered to the preserved specimen.

The minimum plane-normal change through a fixed candidate origin while
preserving `C` is obtained by projecting `n` perpendicular to `O − C`.
Its angle is `asin(abs(dot(n, normalize(O − C))))`. This supplies a useful
geometric lower bound. Marker conventions, permitted anatomical level, head
containment, shaft routing, and view-specific target constraints can require a
larger correction. A small angular correction alone does not prove a correct
clinical view.

## Skin and tract feasibility

`skin-feasibility.json` evaluates the original frozen planes against the fixed
BodyParts3D skin, using the verified source mesh and one similarity transform
per donor. Nineteen of the 25 primary-donor acquired TTE planes intersect their
designated window. The four PLAX depth/focus entries, mitral-level short axis,
and subcostal four-chamber plane do not. The two comparison donors have eleven
intersections each. These results explain why exact surface contact sometimes
requires a new source reformat.

TEE feasibility includes interpolated centerline crossings, crossings inside
sampled convex gastric cross-sections, and a conservative transverse-lumen
projection with a protected head-center radius. The report lists both the
previous solver's broad level allowance and narrower model-tag groups. These
tags are authored model regions, not measured clinical insertion boundaries.
Eight primary-donor acquired planes have no intersection even within the old
broad allowance; transgastric RV basal is an additional failure if restricted
to samples tagged `tg`. An arbitrary projection outside the organ cannot
resolve that incompatibility.

## Full instrument clearance

A contained head center is not enough. The rendered TEE head has a long axis,
and flexion can put its surface through a narrow esophageal wall. The first
joint-plane revision fixed coplanarity but left 15 of 28 primary-donor drawn
heads protruding; the largest measured protrusion was 4.163 mm. A shaft center
could also remain inside while its 1.8-model-mm radius crossed the wall.

`public/echo-instrument-clearance.js` provides a cached BVH over the unchanged
GI geometry. It transforms the actual three rendered head parts at the same
0.60 scale used by the atlas and tests their vertices for containment. The two
open GI ends are capped only for inside/outside parity; wall distances exclude
those artificial caps. Its optional route query checks shaft-center clearance
against the drawn radius. It never moves the body or shrinks the instrument.

The independent `instrument-clearance.mjs` audit uses a separate triangle/BVH
implementation, three-ray majority parity, and exact closest-triangle distance.
It records the actual tested vertices and shaft points. This is discrete
geometric evidence for the illustrative meshes, not a continuous collision
proof or a model of tissue deformation.

## Reproducing the checks

Run the focused adversarial checks:

```sh
node --test tests/echo-alignment-v5-math.test.mjs tests/echo-instrument-clearance-v5.test.mjs
node --test tests/echo-acquisition-v5-production.test.mjs
```

Run the production controller and pose matrix:

```sh
node scripts/echo-alignment-v5/audit.mjs --strict --out docs/echo-alignment-v5/current
```

This evaluates 2,576 cases: all 56 views in all three donors under 15 baseline
or adjusted control states, plus the primary donor's 56 previous-reference
defaults. Cases cover retained-half flip, ±10 mm offset, ±15° rotation, ±10°
tilt, a combined adjustment, and the supported control extrema. It also checks
shared acquisition poses for the seven depth/zoom variants.

The harness invokes the production `EchoModule` plane, clipping, overlay, and
accepted-cap handoffs. The cap handoff uses a tiny non-rendered token fixture;
it does **not** claim that fixture is a CT image or verify GPU pixels. Source
hashes are recorded before module loading and compared again afterward, so
concurrent source changes cannot silently become final audit evidence.

Run the independent actual-instrument audit from that accepted-pose export:

```sh
node scripts/echo-alignment-v5/instrument-clearance.mjs --all-donors --strict
```

The native visual gallery uses the real production sampling worker, measured
voxel caps, production surface/volume GLSL, shared depth, and the actual camera
and overlay draw paths. That separate visual result is needed to assess
framing, body context, and what the reader can see. The controller audit alone
cannot establish those visual properties.

## Source and evidence boundaries

The seven extracardiac targets remain outside the acquired heart: TTE IVC,
hepatic veins and suprasternal arch, plus TEE descending-aortic and arch views.
They retain spatial probe context but have no corresponding CT section. The
audit records placeholder geometry separately and never counts it as acquired
CT agreement. An unavailable contained pose is explicitly counted and the
overlay must be hidden; a previous pose must not silently remain visible.

Five comparison-donor TEE defaults have no fully contained instrument fit in
the fixed, unregistered reference model:

| Donor | Unavailable default probe poses |
|---|---|
| S-20-28 | Midesophageal five-chamber, four-chamber, and right pulmonary veins |
| S-20-29 | Midesophageal five-chamber and four-chamber |

These donors have no assigned clinical landmark correspondence. The numerical
search does not move the body, widen the esophagus, shrink the head, or relax
containment to manufacture a fit. Their CT sections remain available as geometric
sections; the unavailable probe and sector are hidden and explicitly described.
The primary LADAF atlas requires all 56 current defaults and all 56
previous-reference defaults to have valid poses. The focused production test
enforces that requirement.

Manual adjustments can also request sections that cannot be acquired by a
contained probe in this fixed model. The complete rejected-case inventory is
written to `current-rejections.json`; it includes donor, view, reference,
offset/rotation/tilt and proof that the unavailable overlay was hidden. The
current audit separates available-case geometric failures from rejected poses.
Its `--strict` option deliberately remains the stronger **all poses required**
gate: it exits nonzero when even an explicitly disclosed rejected pose exists.
Do not describe that command as an unrestricted all-pose pass.

Source voxels, prepared source-frame catalogs, independent donor identities,
and regional label banks are unchanged by this work. Changed acquisition planes
use new reformats and lose the old exact-frame regional findings. The named
guideline acquisitions and real ultrasound examples remain clinical references;
the preserved-heart correspondence remains approximate and unregistered.
