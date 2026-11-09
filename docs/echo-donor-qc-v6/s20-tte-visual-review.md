# Individual S-20 TTE review

All 28 TTE entries were inspected independently for S-20-28 and S-20-29: 56
paired presentations, comprising 112 native camera images. The real CT contact
sheets were examined alongside the cutaways; individual source rasters were
opened where a cropped field or a narrow right-heart section needed closer
inspection. Both camera anchors were reviewed for every entry, including all
outside-coverage cases. The criteria are in
[reference-criteria.md](reference-criteria.md).

These are source-image observations, not a clinical echocardiography validation.
The heart specimens are fixed and excised. The reference body and probe windows
are illustrative. A source-supported regional section does not establish the
identity of an unsegmented leaflet, coronary sinus, venous ostium, or branch.

## Evidence

The final evidence is in `native/s-20-28/` and `native/s-20-29/`. Each entry has
`tte-ID-pair.jpg`, its two separate camera images, and a `tte-ID-ct-source.png`
when the target is within acquired coverage. `review.json` records the exported
production sources, source-volume checksums, camera geometry, render counts and
GL results. `source-review.json` binds the source gallery to the same export.

The inspected first final pass identified two remaining field-of-view defects:
the RV-focused and five-chamber rectangles were centered too far toward the
base. The source apex was outside the RV rectangle by 34.73 mm in S-20-28 and
10.58 mm in S-20-29, and outside the five-chamber rectangle by 19.10 mm and
1.91 mm respectively. Their normals and physical source planes were retained;
only the rectangle centers and heights were corrected. The RV field now spans
the apex-to-right-atrium extent, and the five-chamber field spans the distal
ventricular and atrial extent. A regression requires every authored target in
these two fields to lie at least 5 mm inside the rectangle in each donor.

The refreshed RV-focused and five-chamber source rasters and both camera anchors
were reopened individually for both donors. The four corrected fields retain
the distal ventricular extent and their original physical planes. The RV-focused
sections retain the longitudinal right-heart route; they do not establish the
entire right-atrial roof or a separately annotated RV apex. The five-chamber
sections retain the apical ventricular and basal outflow region, with the full
clinical atrial combination still qualified. No new context intersection or
loss of the whole-heart framing appeared in either camera anchor.

The other 26 TTE source-or-coverage records and their camera records per donor
are unchanged from the complete preceding inspection, as recorded in
[final-refresh-delta.json](final-refresh-delta.json). All source raster pixels
match the actual sampled MPR arrays. Final evidence identities:

| Donor | Export SHA-256 | Native review SHA-256 |
|---|---|---|
| S-20-28 | `50895912227e178d426f4dfee3921648d1568dbcbacf7b70483b5f7c4fe8fe53` | `1057973d2b6fc5be6799318c0f87c9ebf4a145638b65d8377bc716ac7bf70fd7` |
| S-20-29 | `f350892c66e9d13f4cfdee77164351e95417d7d7d2780ea2c720655070441944` | `e463d66e613650c37308af97de5881b660a394f1580204052d44db990438fe2a` |

The complete camera/source-image identities are in [native-summary.json](native-summary.json).

## Individual findings

“Regional” means the gross intended family is demonstrable in the source.
“Qualified” identifies a specific correspondence that the available source does
not establish. Neither is a claim of clinical diagnostic equivalence. All rows
refer to both probe and upright anatomy anchors unless explicitly stated.

| ID | S-20-28 observation | S-20-29 observation |
|---|---|---|
| plax_deep | Regional: longitudinal ventricular, mitral-vicinity and aortic-root route; wider field retains surrounding basal tissue. Same source plane as PLAX. | Regional: narrow long LV route, adjacent right-heart region and basal root. Wider field preserves the same plane. |
| plax | Regional: long LV cavity and basal inflow/outflow relationship; no transverse-plane substitution. | Regional: narrow LV cavity in a prominent fixed wall, with basal root/outflow. The fixed specimen differs from an open beating-heart cavity. |
| plax_av | Qualified valve focus: the aortic-root portion of the same long-axis cut is centered; specific leaflets and their function are not assigned. | Qualified valve focus: retained root/outflow is centered on the same PLAX plane; exact leaflet identity remains unconfirmed. |
| plax_mv | Qualified valve focus: the mitral-region continuation is centered on the parent plane; no named leaflet claim. | Qualified valve focus: ventricular/mitral vicinity retained, with the same source plane as PLAX; leaflet anatomy remains unconfirmed. |
| plax_rvot | Regional right-heart/outflow route with an elongated retained lumen and adjacent semilunar region. Full distal PA branches are not established. | Regional right-heart and retained pulmonary-outflow vicinity; the source shows a long outflow section beside a rounded root region. |
| plax_rvin | Regional thin-walled right-heart/atrioventricular route. The raw raster confirms an elongated cavity; TV leaflet components are unconfirmed. | Regional right-heart/atrioventricular route with an atrial cavity and adjacent trabeculated ventricle. Specific TV components remain qualified. |
| psax_great | Qualified retained-vessel section: a broad root cross-section and adjacent proximal vessel are visible. Complete pulmonary bifurcation is absent or unconfirmed. | Qualified retained-vessel section: a rounded aortic region and separate adjacent lumen are visible; distal vessel continuity is limited by excision. |
| psax_av | Regional transverse aortic-root section with internal tissue partitions; named cusp identity remains unconfirmed. | Regional transverse root with conspicuous internal partitions, distinct from the ventricular short-axis levels. Named cusp identity is not inferred. |
| psax_av_zoom | Same physical AV plane, smaller root-centered source rectangle. The root remains in the field; the zoom does not create additional valve evidence. | Same root-centered transverse plane and internal partitions as the parent; individual cusp labels remain unconfirmed. |
| psax_tv | Qualified basal right-heart/TV vicinity with adjacent root; a complete named leaflet plane is not demonstrated. | Qualified right-heart/basal section beside a semilunar region. Full tricuspid leaflet correspondence is not established. |
| psax_pv | Regional pulmonary-outflow section now follows the retained vessel longitudinally beside the root. Distal branches and specific cusps remain qualified. | Regional pulmonary-outflow section exposes a longitudinal retained lumen adjacent to the root; the earlier transverse ventricular substitute is removed. |
| psax_mitral | Regional basal LV ring, distinct from mid/apical levels. Classic en-face mitral leaflet geometry is not established. | Regional basal LV opening with adjacent right-heart tissue. The exact mitral leaflet/fish-mouth appearance remains qualified. |
| psax_papillary | Regional transverse midventricular LV ring with intracavitary protrusions and a right-ventricular relationship; named papillary identity is not assigned. | Regional midventricular ring with a small irregular cavity in a thick fixed wall. Intracavitary tissue is visible; paired papillary identity is unconfirmed. |
| psax_apical | Regional distal ventricular ring, smaller than the midventricular level; longitudinal ordering is preserved. | Regional distal thick-walled ring with a small central cavity. It is correctly distal to the basal and papillary sections. |
| a4c | Regional long LV and RV cavities with septal and atrioventricular continuations. The original short-axis mismatch is corrected. Full clinical four-chamber equivalence remains qualified. | Qualified four-chamber approximation: the narrow LV and RV are longitudinal, but a basal root/outflow cross-section persists and the atrial correspondence is incomplete. |
| a4c_lv | Same four-chamber plane with a focused LV field. The distal LV and mitral-region source targets fit inside the rectangle. | Same long LV source plane and narrow cavity as A4C; the focused field retains its distal and basal targets. |
| a4c_rv | Qualified RV-focused longitudinal route. The first-pass rectangle cropped distal extent; its final field is recentered and expanded without changing the plane. Exact RV-apex identity remains approximate. | Qualified RV-focused route with a broad right-heart cavity and basal continuation. The final field corrects distal cropping while retaining the same source plane. |
| a5c | Qualified anterior apical/outflow section: the root is added to the longitudinal ventricular target. The distal field correction retains the apex; full five-chamber equivalence is not established. | Qualified anterior apical section with retained basal outflow and narrow long LV. The corrected field retains distal extent; full atrial combination remains approximate. |
| a4c_cs | Qualified posterior angulation: the longitudinal chamber context is retained with the small posterior tilt. The coronary sinus itself is not independently identified. | Qualified posterior angulation: chamber context is retained, with a narrower LV cavity. The coronary sinus is not independently identified. |
| a2c | Regional long LV–mitral/atrial route with reduced right-heart/outflow inclusion compared with A4C. The corrected rotation sign avoids the old outflow-oriented plane. | Regional long narrow LV with basal mitral/atrial continuation; reduced central outflow inclusion. The prominent fixed wall is retained faithfully. |
| a2c_lv | Same two-chamber source plane with focused LV field; apex and mitral-region targets remain inside the rectangle. | Same long narrow LV source plane and a focused field; distal and basal source targets are retained. |
| a3c | Regional long LV and basal aortic-root/outflow route. The acquired apical cavity is preserved rather than replaced with a basal short-axis cut. | Regional long LV with root/outflow and basal atrial vicinity; complete leaflet and chamber-boundary equivalence remains qualified. |
| a3c_lv | Same long-axis source plane with a focused LV field; the aortic/mitral route remains visible. | Same long ventricular/outflow plane and narrower LV field; the source wall and cavity are unchanged. |
| a4c_la_pv | Qualified atrial focus: the rectangle emphasizes basal atrial vicinity on the parent plane. Individual pulmonary-vein ostia are not established. | Qualified atrial focus: retained basal/atrial and adjacent outflow regions are visible. Separate pulmonary-vein ostia remain unconfirmed. |
| subcostal | Qualified inferior reference approach to the regional four-chamber source plane. No acquired liver/pericardial context is implied. | Qualified inferior reference approach to a long ventricular/atrioventricular section; the illustrative entry is not a measured patient window. |
| subcostal_ivc | Outside acquired coverage. Whole source heart and illustrative context remain; no IVC CT section is fabricated. | Outside acquired coverage. Whole source heart and illustrative context remain; no IVC CT section is fabricated. |
| subcostal_hepatic | Outside acquired coverage. No hepatic-vein CT cap is displayed. | Outside acquired coverage. No hepatic-vein CT cap is displayed. |
| ssn_arch | Outside acquired coverage. The upright anchor retains the whole source heart; the reference sector does not imply an acquired arch. | Outside acquired coverage. The whole source heart and illustrative suprasternal approach remain, without a fabricated arch slice. |

## Camera and context findings

For every acquired view, the two anchors show the same accepted source section.
Selecting an anchor changes the camera, not the specimen plane. The upright
anatomy anchor consistently retains the full heart in its fixed donor-specific
body frame. Neither S-20 donor inherits LADAF's frame or esophageal course. The
visible ribs, diaphragm and gastrointestinal surfaces remain separate from the
heart; full continuous-surface clearance is established separately in
[the context report](../echo-donor-context-v6/README.md), not inferred from
transparent pictures alone.

The skin-contact estimates are bounded to actual reference-skin triangles. Some
contacts differ from the generic named clinical window because the intact
patient body was not scanned and the source plane is preserved. Those differences
remain explicit in the acquisition metadata. This review does not treat a
geometric skin intersection or an instrument-marker match as proof of clinical
correspondence.

The primary fixes found by this pass were the donor-specific long-axis planes,
correct sign of two-chamber rotation, true pulmonary-outflow section, ordered
ventricular short-axis levels, and the two distal field corrections. Remaining
small-structure identities are qualified rather than silently promoted to
confirmed anatomy.
