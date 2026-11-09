# Heart Explorer: independent donor echo calibration and review

This change addresses the S-20 anatomy collisions, specimen-independent echo
planes, missing S-20 TEE context, and lab interaction requests. The source scans
and measured heart meshes are unchanged. Each S-20 heart now supplies its own
landmarks, long axis, reference-body placement, surrounding organ profile and
echo targets.

## What changed

### Fixed anatomy for each specimen

S-20-29 and S-20-28 no longer inherit LADAF's anatomical frame. Each has a fixed
frame derived from its source ventricular and atrioventricular landmarks, an
independent posterior esophageal course, and its own inferior gastric/diaphragm
profile. Reference ribs, sternum, skin and spine use one fixed uniform torso
factor for that specimen. Choosing a view cannot move an organ to accommodate
the probe, and the heart itself is never moved to avoid a collision.

Whole-envelope checks cover the full retained source, including the outer apex.
The endocardial point used to find a long-axis cavity is not used to shrink that
clearance envelope.

| Check | S-20-29 | S-20-28 |
|---|---:|---:|
| Conservative GI/diaphragm distance from retained source support | 5.07 mm | 5.89 mm |
| Continuous GI/diaphragm separation from the source convex envelope | 5.72 mm | 6.66 mm |
| Continuous rib/sternum separation after source-cell uncertainty | 3.55 mm | 3.38 mm |
| Uniform reference-torso factor | 1.35 | 1.22 |

The checks examine every authored surface triangle; they do not rely on a few
landmarks or a transparent screenshot. Details, source identities and
reproduction commands are in
[the context calibration report](../echo-donor-context-v6/README.md),
[clearance.json](../echo-donor-context-v6/clearance.json) and
[body-placement.json](../echo-donor-context-v6/body-placement.json).

These values establish separation in the displayed model. The surrounding
anatomy is illustrative, because the excised heart scans do not contain a
registered patient torso or gastrointestinal tract.

### Source-driven TTE and TEE targets

All 56 named targets in each S-20 specimen are reviewed in its donor-specific
frame. The 49 in-coverage source sections are resampled from that specimen's
actual voxel volume; the seven outside-coverage targets remain explicitly
illustrative. The changes include:

- Longitudinal four-, two- and three-chamber targets using the measured cavity
  axis, with the correct direction of the two-chamber rotation.
- A longitudinal ME five-chamber target through ventricular and aortic-root
  regions, replacing a plane through three basal valve points that produced a
  transverse slab.
- Mitral-region oblique/commissural sections selected against actual source
  images, with sufficient distal field and no unsupported scallop labels.
- Short-axis ventricular levels ordered along the specimen's own long axis.
- Pulmonary-outflow sections that follow the retained vessel longitudinally
  beside the aortic region.
- Expanded and recentered S-20 RV-focused, apical five-chamber and ME long-axis
  fields, which previously cropped distal source targets.
- Source-preserving LADAF pulmonary-outflow and aortic-valve short-axis
  corrections, plus a small posterior apical tilt that retains chamber context.

The acquisition solver is checked against both the anatomical source targets
and their projections on the original source plane. This prevents a short-axis
view from being rotated into a long-axis plane merely to approach an off-plane
chamber centroid. The same accepted plane drives the MPR raster, cutaway, scan
sector and both camera anchors.

S-20 TEE views now receive the fixed esophageal/gastric context as well as their
individual probe estimates. The full head and routed shaft must fit inside the
represented lumen. A centerline-only pass is insufficient.

### Three deliberately withheld estimates

The transgastric RV inflow/outflow view (`tgrvinout`) has a useful original
right-heart source section in all three donors. A constrained gastric probe fit
was rotating that section enough to lose the intended TV/PV/RVOT region.

The original source planes are now retained. For these three entries, the fixed
context stays visible and the interface explicitly reports that a probe fit is
unavailable; it omits the misleading probe and sector. The target-specific
limits are a maximum 20° added plane rotation, 5 mm scaled added landmark miss,
and 8 mm scaled displacement of the source-plane witnesses. These are modeling
guards, not clinical tolerances.

An independent test found every represented gastric triangle on the same side
of each exact source plane: minimum gaps were 21.19 mm for LADAF, 27.49 mm for
S-20-29 and 36.39 mm for S-20-28. Changing a nominal multiplane angle did not
resolve the source loss. The stomach is not moved to manufacture a successful
fit. See [the LADAF target investigation](ladaf-target-inspection.md) and the
individual TEE findings for the source/fit comparison.

### Lab controls and layout

TEE control keys work immediately while the lab is active. There is no keyboard
activation box or Esc mode. Holding a displayed keycap remains an alternative.
Text inputs, selection controls and editable content keep their normal typing
behavior; native arrow-key behavior on range controls remains available.
Blur, page hiding, leaving the lab, locking, reset and restore release active
holds so an interrupted keypress cannot leave a probe moving.

| Lab | Keys | Action |
|---|---|---|
| TEE | W / S | Advance / withdraw |
| TEE | A / D | Turn the shaft |
| TEE | Q / E | Decrease / increase multiplane angle |
| TEE | I / K | Anteflex / retroflex |
| TEE | J / L | Lateral tip flexion |
| TTE | W / A / S / D | Slide the probe/plane |
| TTE | Q / E | Roll |
| TTE | I / K | Tilt |
| TTE | J / L | Fan |
| TTE | R / F | Move out of plane in free-plane mode |
| Both | Shift | Fine movement |

TTE opens in orbit mode, keeps the starting-view presets above the left anatomy
model, and places its keyboard panel below the model. The redundant TTE Lab
heading is removed. Optional mouse probe steering remains available.

The S-20 TEE Lab uses a physical distinction between the probe-head center and
its acoustic face. The face offset is applied consistently to the model
kinematics, section sampling and visible instrument; it is not a preset-only
visual translation. S-20-29 additionally uses a bounded, continuous guide
adjustment during retroflexion, fitted to the unchanged illustrative lumen.
It follows the shaft-turned tract cross-section and applies to every state of
that donor, rather than branching on the selected preset. This is an estimated
instrument-path calibration, not a measured esophageal reaction or validated
probe-mechanics law. S-20-28 requires no such guide adjustment. Starting cards
display each solved model angle. LADAF's existing lab convention is preserved.

All eight S-20 starts passed the final source/physical-containment check at
0.75×, 1× and 1.25× reference extent. At the original extents, the worst plane
change from the intended source section is 0.094° and 0.030 mm, with at most
0.215 mm additional guide miss. Every vertex of the full head and rendered
intraluminal shaft is contained, and the central ROI and eligible near-plane
targets fit inside the sector. The [Lab calibration report](../echo-donor-context-v6/LAB-PRESETS.md)
records the accepted controls, rejected source-losing alternative, complete
24-case receipt and limits of the illustrative guide adjustment.

Old S-20 stored poses are migrated when their calibration revision is obsolete;
image display preferences are preserved. Reviewed LADAF source conventions are
not replaced with a generic S-20 frame.

## Complete review inventory

The requested coverage is 28 TTE plus 28 TEE views for each of the three hearts:
**168 individual donor/view decisions**, **336 native camera images**, and
**147 real source CT rasters**. The other **21 entries** concern extracardiac
targets outside the excised scans and explicitly contain no fabricated CT cap.
There are **144 displayed geometric estimates for the 147 acquired sections**,
plus **21 illustrative outside-coverage windows**, for 165 displayed estimates
in total. The remaining three are the intentional TG RV withholds described
above. A geometric estimate is not a claim of clinical correspondence.

| Donor / modality | Individual visual findings | Native source and camera evidence |
|---|---|---|
| LADAF, all 56 | [LADAF review](ladaf-visual-review.md) | [LADAF receipt](native/ladaf-2021-17/review.json) |
| S-20-28 and S-20-29, TTE | [S-20 TTE review](s20-tte-visual-review.md) | [S-20-28 receipt](native/s-20-28/review.json), [S-20-29 receipt](native/s-20-29/review.json) |
| S-20-28 and S-20-29, TEE | [S-20 TEE review](tee-final-visual-review.md) | The same per-donor receipts and `tee-ID-pair.jpg` files |

Every view was examined separately at the probe and upright anatomy anchors.
The inspection compared broad source anatomy with
[the guideline-derived criteria](reference-criteria.md), investigated concrete
target errors with measured reformats, and recorded where the exact clinical
target remains unconfirmed. The reports distinguish regional support,
qualified small-structure or full-chamber correspondence, absent coverage and a
withheld acquisition. They do not turn these categories into a clinical pass
rate.

## Verification and practical limits

The final automated checks passed **130 Node tests**, plus **8 separate atlas
DOM/camera checks**. The production build completed all five stages, and all
12 asset-staging checks passed. The staged release was copied only after all
1,276 recorded build-input hashes matched the actual source; every copied
output byte was then verified. See [build-verification.json](build-verification.json).

The final [native integrity receipt](native-summary.json) confirms all 168
scenarios, 336 anchors and 147 actual sections, zero unexpected unavailable
estimates, zero stale runtime fingerprints, and exact raw-source pixel matches.
The [refresh delta](final-refresh-delta.json) records the final 11 changed
source/coverage and camera entries; the other 157 entries remained unchanged
from their individual inspection. All changed entries were reopened after the
refresh before completing the visual reports.

The native renderer uses the production controller, actual source MPR worker,
production GLSL, accepted camera poses, and actual heart/probe/context geometry.
Source modules and volumes are fingerprinted, and the source galleries are
bound to the same accepted export as their native camera renders. Numerical
checks cover finite orthonormal planes, exact probe/plane/sector handoffs,
source-target preservation, real skin-triangle contact, full TEE head/shaft
containment, and fixed anatomy placement. Focused controller tests cover the
keyboard lifecycle, default orbit mode, layout, revision migration and source
field regressions.

Reproduction commands are in
[the review scripts](../../scripts/echo-donor-qc-v6/README.md). The source
readouts and render receipts are the evidence for this review; old draft
contact sheets and baseline findings are not substituted for final images.

This environment did not provide an operational browser. The visual review is
native scientific rendering, and the interaction checks exercise the actual
controllers with a DOM harness. It is not an end-to-end browser walkthrough.
Native callout-font replay, optional local fine replacement surfaces, and
browser-specific layout/driver behavior are outside the renderer's scope.

Individual leaflets, commissural scallops, pulmonary-vein ostia, the coronary
sinus, and full caval/arch anatomy remain qualified wherever the source and
regional annotations do not establish them. Fixed-organ CT cannot validate
valve motion, Doppler flow, or patient probe insertion depth. The site continues
to present these as educational model estimates.
