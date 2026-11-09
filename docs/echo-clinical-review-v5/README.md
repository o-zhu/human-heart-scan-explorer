# Clinical geometry review of Echo acquisitions

This review distinguishes exact mathematical alignment from plausible acquisition
geometry. It is not clinical registration of the preserved heart to BodyParts3D,
and it does not establish named structures in a reformatted source section.

## Final targeted result

The final frozen candidate export contains all 56 primary-donor refined defaults.
The targeted clinical geometry checks pass: shared apical footprints and rolls,
correct opposing apical tilt directions, apex/MV coverage of the apical roll
family, aortic-region coverage of A5C, ME positioning, and deep-TG apex inclusion
inside the rendered sector. Final native A4C, A5C and deep-TG pairs were also
inspected; they support geometry coherence without establishing full named
clinical correspondence.

`defaults-final.json` independently measures the input audit with SHA-256
`53eca7c4a6d34b416014da9b66a0b91cb126805ef3947101151aba16db51f92a`.

| Check | Final primary-donor result |
| --- | --- |
| Shared A4C/A2C/A3C footprint | Zero displacement |
| A4C to A2C; A2C to A3C marker rotation | -60 degrees; -60 degrees |
| Apex and MV plane/ray residual in the shared roll family | Floating-point zero |
| Nominal A3C aortic-region plane residual | 1.187 mm |
| A5C aortic-region plane residual | Floating-point zero |
| A4C/A5C/CS anterior beam component | -0.7807 / -0.6922 / -0.8485 |
| Deep-TG apex angle | 36.556 degrees; within the 37.5-degree acceptance gate |
| Deep-TG apex and aortic-region plane residual | Floating-point zero |
| Deep-TG LV-center-to-aortic direction proxy difference | 17.892 degrees |
| Named ME views assigned to ME level | All 15 |
| TEE heads and shaft routes reported contained | All 28 primary defaults |
| Physical marker disagreement with accepted TTE guide | Zero |

The remaining limits are clinical identity and registration, not a request for
further optional modeling. Nominal A4C is 8.243 mm from the broad tricuspid-region
anchor; A5C is 19.495 mm from the mitral-region anchor; deep TG is 23.193 mm from
the tricuspid-region anchor. The LV-to-aortic direction proxy is not a measured
Doppler flow axis. Full four-/five-chamber correspondence, valve-leaflet identity,
venous ostia and patient-specific probe insertion depths remain unconfirmed.
The explicit qualification flags must remain attached to the new sections.

The sections below preserve the findings and changes that led to this result.

## Primary guidance

- [ASE comprehensive TTE guideline](https://www.asecho.org/wp-content/uploads/2025/07/Guidelines-for-Performing-a-Comprehensive-Transthoracic-Echocardiographic-Examination-in-Adults.pdf), Table 2 and acquisition-window narrative.
- [ASE/SCA comprehensive TEE guideline](https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf), Table 10 and descriptions of views 12, 21 and 22.

TTE shoulder/clock-face marker directions are anatomical guidance, with patient
position and image optimization affecting the exact orientation. A model's
diagonal left/superior vector is not a guideline-prescribed 45-degree value.
Apical two- and three-chamber acquisitions use successive approximate 60-degree
counterclockwise rotations. Magnification alone does not require a new acoustic
plane or skin contact.

The ME modified bicaval maneuver turns from the ME RV inflow/outflow view at the
same electronic angle. Deep TG acquisition uses advancement, anteflexion and
often left flexion; useful LVOT/aortic Doppler alignment is a defining purpose.
The broad specimen apex-to-aortic-region axis is not a measured LVOT flow axis.

## Findings in the pre-correction export

The findings below were reported during the first acquisition review.
`defaults-interim.json` captures the subsequent marker correction while the
earlier TEE poses remained active. `defaults-after-instrument-fix.json` pins the
later stable-source audit after the instrument and initial deep-TG corrections.
Each file contains 56 primary-donor refined default poses measured independently
by `scripts/echo-clinical-review-v5/measure-defaults.py`, plus the input audit hash
and the production hashes reported by that audit.

1. The initial TTE solve only selected the physical marker's sign. It did not
   constrain its angle to the model's own clinical marker reference. IVC,
   hepatic-vein and suprasternal-arch defaults differed by 67.5, 62.6 and 60.3
   degrees respectively. Apical marker increments were approximately 90 and 30
   degrees rather than the nominal successive 60-degree rotations. The parent
   is replacing this with a default acquisition defined jointly by skin
   contact, target and physical marker; manual adjustments remain explicit.
2. ME modified bicaval selected a lower-esophageal model point (42.1 model cm)
   rather than the ME neighborhood of RV inflow/outflow (33.2 model cm). These
   are illustrative path distances, not measured clinical depths. The parent
   is restricting default ME acquisitions to the ME pool before optimization.
3. The initial deep TG five-chamber plane missed the approximate specimen apex
   by 17.1 mm. Its central ray missed that point by 37.8 mm, and the head bend
   was 80.4 degrees. Independent native rendering did not establish a convincing
   apex-to-LVOT teaching section. These support a geometry correction and a
   qualification; approximate landmarks alone cannot diagnose clinical error.
4. The separate actual-head containment audit found 15 of 28 primary TEE heads
   protruded through the fixed GI surface. A head-center clearance radius did
   not protect the entire elongated, flexed instrument. The clearance-query
   owner and parent are addressing this with actual production-head geometry.

These are findings against earlier revisions, not claims that later production
revisions retain the defects. Final independent quantitative and native-render
reports live under `docs/echo-alignment-v5/`.

## Recheck after instrument correction

The stable input audit with SHA-256
`42bc4bd085810db9a159b9c20e7d5431ac841e0f2c934aed4e1cc6a14ee5919c`
has all 56 primary defaults available. Every ME view is at an ME model level;
all 28 TEE defaults report contained head and shaft. The default TTE physical
markers agree with their defined directions, and successive apical marker
increments measure approximately 60.50 and 59.82 degrees.

The first corrected deep-TG plane contains both apex and aortic-region anchors
to floating-point precision, with a 17.38-degree LV-center-to-aortic direction
proxy difference. Its apex is nevertheless 39.915 degrees off the central ray,
just outside the rendered 38-degree half-sector. This is a geometric coverage
failure distinct from an anatomical identity claim. A feasible contained
alternative at gastric path index 120 places the apex 35.086 degrees from the
beam. It has 0.625 mm minimum rendered-head vertex clearance and a shaft route
passing the 1.8 mm radius check with 4.454 mm wall clearance. The parent was
asked to enforce apex inclusion in the actual rendered sector.

A second remaining maneuver issue concerns apical five-chamber and coronary
sinus variants. Independent contact selection moves their footprints from A4C
while preserving the same generic target. A5C becomes more posterior-facing
and CS more anterior-facing, reversing their intended tilt directions. The
recommended correction is a shared A4C footprint and physical marker, with an
AV-directed anterior tilt for A5C and a small qualified posterior tilt for CS.

From the measured A4C contact, the AV-directed beam anterior component changes
from -0.7505 to -0.6436. Preserving the physical marker exactly gives a
6.97-degree anterior tilt with AV included in the plane. Independently extending
the approximate apex-to-mitral axis backward meets actual anterior skin inside
the apical window at body coordinates `[80.4901, -58.7107, 99.2284]` mm, only
4.45 mm from the optimized A4C contact. This offers a more explicit construction
for a common apical axis; the small difference is not evidence of greater
patient-specific accuracy.

## Deep TG correction recommendation and limits

For each feasible deep-gastric head position, define a plane through the head,
approximate apex and aortic-region anchor. Direct the central ray toward the
aortic region, require positive near-field apex depth before the aortic region,
and use soft costs for approximate long-axis direction, mitral-region proximity,
shaft bending and full instrument containment. Keep the raster center in that
accepted plane, separately from the beam target. Do not move or rescale any organ.

The fixed model has candidate positions for this construction. An illustrative
head at local L/S/A `[60.16, -94.65, 8.81]` mm yields zero apex/aortic plane
residual, a 4.6 mm mitral-region residual and approximately 55 degrees of head
bending. The AV-directed ray remains about 30 degrees from the apex-to-aortic
proxy and 18 degrees from the LV-center-to-aortic proxy. The same plane is about
23 mm from the tricuspid-region anchor. Thus, improved contact and target
coverage still cannot certify complete five-chamber CT correspondence or
clinical Doppler alignment. The existing named-target review qualification must
remain visible after the new plane is resampled.

## Fixed body frame and visual context

No view-dependent body rotation was found. The fixed source frame places the
LV/apex leftward, inferior and anterior to the atrioventricular origin, with the
LA posterior and RA rightward. The reference-heart geometric apical patch and
specimen apex differ by about 7.5 mm under the one fixed transform; that is a
placement check, not patient registration. Comparison donors do not inherit
these LADAF-specific landmark identities.

Native PLAX and ME4C rendering showed the real ribs and spine clearly but too
prominently. The parent authorized material-only opacity changes to skin 0.025,
bones 0.09 and spine 0.075. The body mesh hashes, fixed transform, GI anatomy and
diaphragm remain unchanged. All nine existing anatomy-context tests pass.

## Shared apical guide implementation

`public/echo-tte-guidance.js` exports:

```js
tteApicalGuide({ view, model, sourcePlane, referenceMm, fourChamberPlane })
```

It returns `null` for other windows and RV-focused A4C, which remains available
to the separate optimized acquisition solver. Other apical entries return the
actual skin contact, beam, physical marker, central-ray target, guide kind and
qualification metadata. The parent acquisition solver owns section creation,
ROI projection, control application and CT resampling.

For the primary donor, the common contact is the outermost forward intersection
of the approximate apex-to-mitral axis with the actual bounded anterior skin.
The returned world point is `[-41.9213938, 122.4311876, 1.8987642]` mm on skin
triangle 2860. A4C/A2C/A3C keep that contact and beam; A2C/A3C use -60/-120-degree
physical marker rotations. A5C and CS keep the contact and physical marker while
tilting in opposite anatomical directions. The CS tilt is an explicitly
illustrative 8-degree setting, not a measured coronary-sinus trajectory.

The A5C central beam is the aortic-region vector projected perpendicular to the
fixed marker. Consequently, `targetMm` is on the central ray, while the separate
`anatomicalTargetMm` may be lateral to it but lies in the beam/marker plane.
Keeping those meanings separate prevents a false exact-beam-target assertion.

The zero marker's nominal A4C plane misses the broad tricuspid-region anchor by
8.243 mm; nominal A3C misses the aortic-region anchor by 1.187 mm. The exact
apex/MV/TV meridian would require +15.368 degrees from zero, and the exact
apex/MV/AV meridian -117.096 degrees. Those source measurements are retained as
evidence of the limits of nominal clinical directions; the helper does not
silently redefine markers to force named anatomy. All guides return
`namedAnatomyConfirmed: false`.

Comparison donors use their own fixed actual apical window anchor and the
provided A4C raster center, or their fixed context-frame origin if no canonical
plane is supplied. They receive no LADAF anatomical targets. The chosen source
view's changing raster center never moves the common footprint.

Seven focused tests in `tests/echo-tte-guidance.mjs` pass. They independently
check the drawable triangle contact, shared contact/beam, apex/MV coverage,
60-degree rolls, opposite tilt directions, AV inclusion, the distinction between
central and lateral targets, qualification flags, and both comparison donors.
