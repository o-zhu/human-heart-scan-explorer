# TEE probe coverage and position review, v4

## Result

All 28 atlas targets now receive a finite simulated probe position. The 14
existing tight geometric fits retain their plane-coincident probe estimates.
The remaining 14 receive independent, tract-constrained estimates: ten
acquired regional comparisons and the four outside-scan aortic targets.
These counts describe probe/plane geometry, not the separate v3 anatomical
support classifications.

Previously, an unresolved geometric fit caused the atlas to hide both the
instrument and its sector. Some discarded trial fits projected the probe tens
of millimetres out of the authored organ to reach the CT plane. Those trial
poses remain diagnostic inputs only. The visible fallback now keeps the head
at an actual interior sample of the esophagus or stomach and points toward an
approximate target. It does not move the CT plane, change the view evidence, or
claim the sector is the measured CT section.

- **ME estimates:** right pulmonary vein, RV inflow–outflow, modified bicaval
  tricuspid, right/left pulmonary veins, and LAA remain in the modeled ME tract.
- **TG estimates:** basal short-axis, RV basal, RV inflow–outflow and two-chamber
  remain within the modeled stomach. Deep five-chamber uses a deeper gastric
  position with superior aiming.
- **Aortic estimates:** descending-aorta SAX/LAX share one lower-esophageal
  mechanical pose. Arch LAX/SAX share one upper-esophageal mechanical pose.
  Changing between each pair rotates only the electronic imaging basis.

The visible model centimeters are relative distances along this authored tract.
They are not measured insertion depths from incisors. No esophagus, diaphragm,
stomach or thoracic aorta has been segmented from this isolated-heart scan.

## Clinical reference and modeling choices

Primary source: [ASE/SCA 2013 comprehensive TEE guidance](https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf),
Table 10 and numbered acquisition descriptions.

| Reference | Constraint used in the illustration |
|---|---|
| Sections 9, 11–15, journal pp938–939 | ME target families stay in an esophageal window; changes involve relative advancement, shaft turning and multiplane rotation. |
| Sections 16–24, journal pp939–940 | TG views are approached from the stomach. Deep TG advances farther with anteflexion; ordinary two-chamber follows midpapillary positioning with electronic rotation. |
| Sections 25–26, journal p940 (PDF page20) | Descending thoracic aorta lies posterior-left of the esophagus; the transducer turns toward that side. SAX and LAX use different electronic angles at the same survey location. |
| Sections 27–28, journal p941 (PDF page21) | The arch is approached from upper esophagus with the probe facing anteriorly; electronic rotation changes LAX to SAX. |

The numeric body-coordinate heights, stomach-route fractions, illustrative
vessel-target offsets and selection weights are authored modeling choices.
They are not numbers reported by the guideline. The independent estimate
retains its actual offset and normal-angle disagreement with the reviewed CT
plane in `contextFit`; these residuals are never zeroed to imply registration.

## Runtime contract

`atlasContextProbePose()` returns every pose with `registered:false` and
`clinicalDepthMeasured:false`.

| `contextFit.mode` | Meaning |
|---|---|
| `ct-plane-estimate` | Existing strict geometric fit; `resolved:true`, `estimated:false`. This is still an illustrative tract, not patient registration. |
| `tract-estimate` | Probe is inside the appropriate model organ; `resolved:false`, `estimated:true`. Its amber dashed sector is independent of the CT plane. |
| `outside-scan-estimate` | Illustrative aortic target; `outsideScan:true`. No acquired CT slice is introduced. |
| `plane-only-estimate` | Defensive fallback if no anatomical context model exists. It is explicitly a geometric illustration. |

The pose is computed in `TeeAtlasOverlay.set()` so its caption remains available
before a hidden or zero-sized viewport draws. Probe/sector controls govern
visibility without an unresolved-fit hiding rule. Existing clinical target
angles are retained; the mechanical head and electronic image basis remain
consistent.

`atlasProbeFocusPoints(pose)` supplies compact world-mm support for the actual
head, nearby shaft and target. It contains every production head-mesh vertex
without requiring a heart close-up to include the entire proximal tract.

Anatomy and probe geometry use the separate shared-depth integration. Behind-
heart geometry is allowed to disappear with correct occlusion. The probe is
not relocated or made transparent through the heart to keep it on screen.
The atlas requests depth-tested context/probe labels; the software label path
also rejects a hidden head anchor and waits for current source depth.

## Verification and visual review

`tests/tee-probe-coverage-v4.mjs` exercises all 28 real production frames and
checks finite orthonormal geometry, the mechanical/electronic basis, exact
strict fits, actual interior samples for fallbacks, unchanged source/model
inputs, aortic pair mechanics and directions, deep-TG ordering, full head
framing support, actual overlay draw invocation, hidden-viewport metadata,
explicit visibility controls and both comparison donors. All eight checks pass.
The existing atlas and updated refinement suites also pass (12 checks).

The native render uses the actual exported production head, shaft and organ
triangles/transforms and the production geometry fragment shader. Its camera
is orthographic and fixed posterior-oblique, so all 28 positions can be compared
without camera motion. A coarse 635.2 µm source-heart silhouette provides
context; it is not the detailed browser reconstruction. Head-center dots are
explicit review markers. These images are scientific rendering checks, not
browser screenshots, patient registration or performance measurements.

- `probe-positions-all28.jpg`: all 28 targets in one consistent camera.
- `probe-positions-details.jpg`: close views of twelve previously missing
  positions, including the two aortic survey levels.
- `probe-verification.json`: full returned poses and numerical checks.
- `probe-render-review.json`: source hashes, rendering settings and GL results.

Reproduce from the checkout root with Node, NumPy, SciPy, scikit-image, Pillow
and ModernGL/EGL:

```sh
node tests/tee-probe-coverage-v4.mjs --report=docs/tee-spatial-v4/probe-verification.json
node --test tests/tee-plane-refinement-v2.mjs tests/tee-atlas.test.mjs
node scripts/tee-spatial-v4/export-probes.mjs {temporary-cache}
python3 scripts/tee-spatial-v4/render-probes.py --data {temporary-cache}
```
