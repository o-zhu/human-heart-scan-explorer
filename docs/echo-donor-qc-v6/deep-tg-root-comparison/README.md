# First-pass deep-transgastric guide comparison

**LADAF provenance correction:** the field named `aorticRoot` in this first diagnostic was subsequently traced to the longitudinal LVOT/cusp focus `[260,265,270]`, not a measured valve-center annotation. The LADAF figure labels now identify the LVOT focus explicitly. The LADAF candidate and numbers below are an LVOT-focus experiment. The independently reviewed cusp/root-region center is `[242.5,252,235]` and is compared separately in `../ladaf-reviewed-root-comparison/`. The two S-20 root points have separate donor-specific source calibration and are unaffected by this LADAF naming correction.

This is a controlled diagnostic of the default `deeptg5c` preset, separate from the frozen full atlas review. The existing production acquisition resolver used the `aorticLumen` location for its apex–aorta guide. This diagnostic aliases that guide input to the existing field named `aorticRoot`, with the important LADAF distinction above. It changes no source voxel, organ mesh, frame axis, clearance threshold or instrument dimension.

The candidate was exported through the production Echo controller, sampled with the actual production MPR worker, and rendered with the production shaders and both production camera anchors. Each donor directory contains `source-before-after.jpg`, `anchors-before-after.jpg`, the root candidate native images/receipt, and `root-comparison.json` with both full accepted planes and independent full instrument checks. Existing complete atlas evidence under `../native/` was not overwritten by this diagnostic.

## Measured target retention

Distances are absolute point-to-accepted-plane residuals in millimeters, measured against the original independent source landmarks. They are diagnostic measurements, not clinical tolerances.

| Donor | LV: lumen → candidate | MV region: lumen → candidate | Candidate-point residual: lumen → candidate | Apex residual after change | Original aortic-lumen residual after change |
|---|---:|---:|---:|---:|---:|
| LADAF | 7.03 → 5.70 | 3.98 → 1.74 | 2.42 → 0.00 | <0.000001 | 3.01 |
| S-20-28 | 11.11 → 7.83 | 16.50 → 10.58 | 5.31 → 0.00 | <0.000001 | 6.05 |
| S-20-29 | 4.78 → 2.67 | 25.03 → 17.53 | 6.38 → 0.00 | <0.000001 | 7.31 |

The S-20 tradeoff is a section through the donor-specific root rather than an exact hit on the more distal aortic-lumen point. The measured CT images retain the proximal outflow route. S-20-28's ventricular lumen is visibly wider and more continuous. S-20-29 exposes a larger central ventricular space and a more appropriate root-level section, but the thick fixed wall, narrow cavity and lost MV region still prevent a full five-chamber claim. LADAF retains the long ventricular/outflow route with closer MV/LVOT-focus alignment; that alone does not justify renaming the LVOT focus as a root. No additional chamber loss or context collision was identified in either native anchor.

## Fixed-tract containment

All 390 unique vertices of the exact rendered head/indicator were checked for each candidate, plus every sampled shaft-route point with the unchanged rendered tube radius. Every candidate is contained. These are mesh/point checks in an illustrative reference tract, not a clinical safety claim.

| Donor | Head vertices outside / tested | Minimum head wall clearance (mm) | Shaft points tested | Minimum shaft-center wall clearance (mm) | Tube radius (mm) |
|---|---:|---:|---:|---:|---:|
| LADAF | 0 / 390 | 0.444 | 136 | 4.454 | 1.800 |
| S-20-28 | 0 / 390 | 0.349 | 141 | 4.279 | 1.729 |
| S-20-29 | 0 / 390 | 0.059 | 134 | 4.102 | 1.657 |

All six native anchor captures completed with zero GL errors and no source-fingerprint mismatch during capture. The actual source CT, clipping, scan sector and probe remain coplanar in each candidate.

## Recommended focused change

Within `resolveTee()` in `public/echo-acquisition-geometry.js`, choose `anatomy.aorticRoot || anatomy.aorticLumen` for the default deep-TG apex guide and consistently use that point for guide eligibility, beam target, apex–aorta midpoint and LVOT-direction proxy. Preserve the existing fallback for sources without a reviewed root. This affects default `deeptg5c` estimates; the other view families and manual free-probe path remain unchanged. Update the v6 audit's deep target check to the same root/fallback distinction. The LADAF landmark meaning must first be corrected and checked against its independently reviewed cusp{local-home} region; these first-pass LADAF images are not the final selection. A new full export and affected-view inspection are required after applying the runtime changes.

The S-20 deep-TG source labels should remain qualified LV-outflow approximations. This correction improves source targeting; it does not establish full clinical five-chamber correspondence or a Doppler flow axis.
