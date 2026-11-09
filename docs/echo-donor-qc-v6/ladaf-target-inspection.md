# LADAF source-target inspection: posterior apical tilt and TG RV inflow/outflow

## Scope and method

This is a runtime parameter investigation made during the v6 corrections, separate from the archived v5 all-view inspection. It is not clinical validation, a new segmentation, or a claim that individual valve leaflets or the coronary sinus have been confirmed.

The 13 compared rasters were sampled by the **actual `public/mpr-worker.js`** from the hash-verified LADAF resident source volume, at 317.6 µm source spacing. No source pixels, context mesh, or production geometry were edited by this investigation. Both compressed and decoded source-part hashes were checked. Source/module hashes, exact input planes, point provenance, and output hashes accompany this report in `ladaf-target-inspection/review.json`, `caps.json`, and `tg-rv-feasibility-summary.json`. The rasters use the windowed uint8 resident display intensities, not Hounsfield units. Postmortem cavity collapse and the acquired specimen's field of view limit correspondence with living ultrasound.

The reproducible runtime helper is `scripts/echo-donor-qc-v6/inspect-ladaf-targets.mjs`. It writes a `review.json` for `scripts/echo-donor-qc-v6/sample-caps.mjs`. The independent angle/containment helper is `scripts/echo-donor-qc-v6/sweep-tee-angle.mjs`.

## Posterior apical tilt

The compared 0°, 2°, 4°, and 8° planes use the same actual canonical apical skin contact and marker direction as the production A4C acquisition. Only the posterior rotation around that marker changes. Each plane uses the production rule that projects the original ROI center onto the resulting contact-defined plane and minimally rotates its image basis. The 0° case is the unchanged acquisition orientation; it is not a new coronary-sinus target. The production A4C was also sampled as a control.

![Measured posterior-tilt comparison](ladaf-target-inspection/cs-comparison.jpg)

| Case | Observed measured anatomy | Decision |
|---|---|---|
| Current A4C and CS 0° | Broad four-chamber pattern, both ventricular cavity tracks around the septum, AV continuity, and basal atrial spaces remain visible. The postmortem lumens are irregular and partly collapsed. | Appropriate unchanged comparison. No separate CS evidence. |
| CS 2° posterior | A small nonzero posterior change retains both ventricular tracks, AV continuity, and broad atrial spaces. The thin right-heart cavity is narrower than at 0°. | Prefer this modest illustrative tilt if a distinct posterior starting plane is wanted. The CS remains unconfirmed. |
| CS 4° posterior | The thin ventricular cavity/AV corridor is substantially reduced and the basal atrial section is clipped. The thicker ventricular body dominates the section. | Less useful than 2° for retaining a four-chamber teaching context. |
| CS 8° posterior | Nearly solid compact myocardium dominates; the useful four-chamber cavity topology is lost. | Reject as the default posterior four-chamber approximation. |

The five-way sheet and the individual 2°/4° native rasters were directly examined. The conclusion is a relative source-image comparison, not evidence that 2° reaches the coronary sinus. There is no independently localized CS lumen target in this investigation. The UI must continue to describe the section as a qualified posterior-tilt approximation.

## TG RV inflow/outflow: source versus acquired section

The [ASE/SCA 2013 TEE guideline](https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf), view 20 on PDF page 20 (printed page 940), describes a TV/PV/RVOT target obtained from basal RV imaging with right flexion, with a mirrored alternative at 90–120°. A full RV apex is not required. Therefore, the reviewed source must not be rejected merely for being basal or oblique.

The original reviewed LADAF source plane is the same regional section as the ME RV inflow/outflow plane, with a different in-plane display orientation. The direct source raster retains a broad right-heart cavity/inlet–outlet neighborhood around an aortic-root cross-section. Individual TV or PV leaflet identity remains unconfirmed at this resident sampling. The archived annotation images `docs/tee-sanity-v3/anchors-tgrvinout.jpg` and `anchors-mervinout.jpg` were also directly examined; their colors are explanatory regional annotations, not independent proof of valve identity.

The acquired default is different: accommodating the fixed stomach rotates the source plane by 32.003°. The actual acquired source raster becomes dominated by a long bright-bordered aortic/LVOT-like lumen and thick ventricular wall, with loss of the original TV–PV/right-heart corridor.

![Measured source/acquired RV target comparison](ladaf-target-inspection/rv-comparison.jpg)

### Independent regional point residuals

Distances are absolute perpendicular distances to the plane, not point-to-pixel labels. The TV center is the mean of independently reviewed tricuspid hinge points, used only as an approximate regional proxy. PV{local-home} and RV cavity centers come from the existing source cavity tracks. These regional annotations are not expert ground truth.

| LADAF regional target | Reviewed source miss | Acquired original at 10° miss |
|---|---:|---:|
| Tricuspid hinge mean | 0.98 mm | 14.13 mm |
| Pulmonary root lumen center | 4.90 mm | 14.49 mm |
| Proximal pulmonary lumen | 6.49 mm | 18.30 mm |
| RV mid cavity | 0.24 mm | 13.52 mm |
| RV apical cavity, contextual only | 28.35 mm | 5.53 mm |

The acquisition becoming closer to the RV apex does **not** compensate for losing the TV/PV/RVOT target. The measured source appearance and the relevant regional residuals both favor retaining the original reviewed target rather than the acquired rotation.

### Exploratory target alternatives

Two source planes were constructed through the tricuspid hinge mean, pulmonary root center, and either the RV mid-cavity or RV apical-cavity point. They were sampled directly, then passed through the unchanged production acquisition solver at 10° and 100°.

| Exploratory plane | Source plane gap to fixed stomach | Accepted rotation | Pulmonary root miss after acquisition | Measured acquired appearance |
|---|---:|---:|---:|---|
| TV–PV–RV mid, 10° | 33.52 mm | 41.62° | 19.99 mm | Aortic-dominant longitudinal lumen; no improvement in the desired right-heart corridor. |
| TV–PV–RV mid, 100° | 33.52 mm | 43.13° | 21.03 mm | Similar aortic-dominant long-axis section. |
| TV–PV–RV apical, 10° | 20.28 mm | 31.00° | 19.02 mm | Thick LV-body section with peripheral right-heart space; PV lost. |
| TV–PV–RV apical, 100° | 20.28 mm | 28.79° | 17.73 mm | Similar thick myocardial body; smaller source rotation does not restore the pulmonary target. |

All eight source/acquired RV comparison rasters were directly examined on the comparison sheet, with the original source and acquired native images additionally opened individually. Neither exploratory candidate is recommended as a replacement source target.

## Fixed-context attainability

The original source plane was tested against every vertex of each donor's **complete represented stomach mesh**, not just path samples. The source plane misses the full stomach for all three donors:

| Donor | Signed plane-distance range across stomach | Minimum gap | Crossing wall triangles |
|---|---|---:|---:|
| LADAF | −127.078 to −21.191 mm | 21.191 mm | 0 |
| S-20-29 | −111.104 to −27.492 mm | 27.492 mm | 0 |
| S-20-28 | −135.826 to −36.390 mm | 36.390 mm | 0 |

Each stomach has 3,888 tested vertices and 7,680 wall triangles, covering rings 88–168. Signed distance is linear over a triangle. Because every vertex is strictly on one side, all wall triangles and the ring-closing disks remain on that side. This proves that the original plane and the represented stomach are disjoint. A denser gastric path search or rotation of the head around its axis cannot overcome this disjointness. A source-plane translation would need at least the stated gap merely to touch the boundary, before allowing room for a complete probe head.

The LADAF source plane intersects only the more superior esophageal regions of the complete GI model, at model insertion ranges approximately 25.08–28.21 cm and 32.14–33.25 cm. That does not make it a TG acquisition. S-20-28 intersects only the upper esophageal region. The S-20-29 source plane does not intersect the entire represented GI model.

An electronic-angle sweep over 0°, 10°, 20°, 90°, 100°, 110°, and 120° found fully contained, source-rotated solutions, but did not resolve the anatomy loss:

| Donor | Smallest source rotation among tested fully contained fits | Nominal angle | Minimum head clearance | Shaft clearance |
|---|---:|---:|---:|---:|
| LADAF | 32.003° | 10°; 0° tied in rotation | 0.063 mm | 3.710 mm |
| S-20-29 | 29.160° | 90° mirrored alternative | 0.142 mm | 3.830 mm |
| S-20-28 | 36.668° | 20° | 0.053 mm | 3.607 mm |

These fits are geometric candidates only. Their small clearances do not imply clinical maneuverability, and keeping the original ROI center inside the sector does not establish named-anatomy correspondence.

## Recommended behavior

Retain the reviewed LADAF RV source plane and its qualified regional interpretation. Do not replace it with the exploratory candidates or accept a 32° rotation merely to show a probe. When the fixed context cannot support the source target within the intended anatomy budget, keep the source section and context visible and mark the TG probe estimate unavailable. That preserves the distinction between measured anatomy, guideline target, and illustrative acquisition position.

For LADAF posterior apical guidance, a 2° illustrative posterior tilt is the best tested compromise for retaining the existing four-chamber context. A named CS claim still requires an independently identified source target and additional review.
