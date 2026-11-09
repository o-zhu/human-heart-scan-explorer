# Source-preserving S-20 TEE Lab starting poses

## Geometry and calibration

The free-lab S-20 tract now follows the physical head center. The acoustic face lies 3 model mm ahead along the mechanical beam, matching the atlas convention for the unchanged 0.60-scale instrument mesh. The same acoustic origin drives the drawn head, routed shaft attachment, scan sector, accepted CT slice, and simulated ultrasound. This physical face offset is separate from the following instrument-path estimate.

S-20-29 additionally uses a bounded radial guide correction to avoid the posterior head displacement that the unconstrained constant-curvature approximation produced during retroflexion. In the local tract cross-section, its direction is the shaft-turned beam. Its magnitude is `3 * modelScale * t² * (3 - 2t)` mm, where `t = clamp((-anteflexDeg - 10) / 8, 0, 1)`. It is zero through −10°, smoothly reaches 3 model mm at −18°, and remains bounded at that value. This is an illustrative instrument-path calibration fitted to the fixed lumen, **not a measured esophageal reaction or a validated probe-mechanics law**. It is applied identically to every control state of that donor; it has no preset-dependent branch. The geometry and velocity are continuous at the joins. S-20-28 does not need this guide correction. LADAF retains its original acoustic-origin convention and complete poses/shaft routes.

The source heart, source voxels, fixed organs, and physical instrument size are unchanged by these control fits. Starting controls are separately fitted to each donor, and the UI displays their actual model multiplane angles. Nominal clinical angles are not forced onto an illustrative excised-heart model.

## Final original-scale results

| Donor | Start | Model angle | Plane offset (mm) | Normal error (°) | Head clearance (mm) | Actual shaft clearance (mm) |
|---|---|---:|---:|---:|---:|---:|
| s-20-29 | me4c | 16.732° | 0.030104 | 0.093947 | 0.138 | 0.407 |
| s-20-29 | me2c | 53.606° | 0.000447 | 0.012559 | 0.138 | 1.772 |
| s-20-29 | melax | 150.115° | 0.001854 | 0.044816 | 0.138 | 1.720 |
| s-20-29 | tg | 0.000° | 0.000095 | 0.000206 | 10.761 | 2.447 |
| s-20-28 | me4c | 11.827° | 0.000000 | 0.000000 | 0.158 | 2.518 |
| s-20-28 | me2c | 74.082° | 0.013386 | 0.005370 | 0.144 | 2.371 |
| s-20-28 | melax | 128.366° | 0.000000 | 0.000000 | 0.800 | 2.680 |
| s-20-28 | tg | 0.000° | 0.000102 | 0.000320 | 12.344 | 2.558 |

All eight starts include the complete central ROI cross and every source guide within 4 model mm of the intended source section in their scan sectors. The maximum additional plane miss at any recorded source guide is 0.215 mm. Off-plane atrial guide centroids do not prove a chamber lies inside the slice; complete chamber and leaflet identity remain unvalidated. The source comparison explicitly rejects a 6.10° candidate that looked numerically contained but shortened the LV apex by 13.68 mm. The accepted ME4C candidate instead preserves the source plane within 0.094° / 0.030 mm.

## Regression and runtime gate

`node --test tests/tee-lab-source-containment-v6.mjs` passed all nine checks. All four starts for each donor were assessed at 0.75×, 1× and 1.25× physical reference extent (24 cases). The checks include all 390 unique head vertices, the actual production-rendered shaft vertices, exact head/shaft attachment and tangent continuity, source-plane residuals, positive wall clearances, geometric and near-plane source-target fan coverage, continuous guide joins, and independence from the preset identifier. A captured original-module LADAF fixture verifies unchanged acoustic positions, complete instrument frames and all routed shaft points.

The fitted S-20 presets are rechecked at runtime against the actual fixed GI geometry. A stale fit fails its explicit source, head, shaft or fan gate instead of silently being presented as a successful starting pose. Depth and fan angle are recomputed for the current source rectangle and physical scale. The existing bounded solver remains the LADAF/legacy path.

The independent UI/controller test `tests/tee-donor-controls.mjs` also passed for both donors: all eight actual model-angle labels, page-wide keyboard input, the physical acoustic-origin identity, accepted plane/overlay agreement, and retention of the old accepted pose until the next frame is accepted. Together with existing keyboard lifecycle checks, that run passed 16/16 checks.

## Evidence

- `lab-presets.json` contains the 24 exact production cases and current runtime fingerprints.
- `lab-me4c-source-comparison.jpg` and its JSON receipt compare the accepted S-20-29 source slice with rejected alternatives using all eight hash-verified measured source parts.
- `ladaf-kinematics-baseline.json` records the original LADAF model results and original module hash.
- `fit-search/` retains the exploratory numerical receipts, including failed restricted-angle and constant-guide alternatives. These are evidence of the search, not active runtime defaults.
