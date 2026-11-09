# Final S-20 TEE source and camera review

This review covers every one of the 28 TEE presets for S-20-28 and S-20-29, independently: 56 source decisions and 112 native camera views. Both the probe anchor and the upright anatomy anchor were inspected. The current contact sheets were regenerated from the final accepted exports, and their hashes are bound to the same export in each donor's `source-review.json`. Earlier draft sheets and `tee-initial-visual-findings.md` are not acceptance evidence for these revisions.

The clinical family criteria are in [reference-criteria.md](reference-criteria.md), based on the ASE/SCA 2013 comprehensive TEE guideline. These are measured, fixed-organ CT sections with illustrative acquisition geometry. This review does not establish clinical registration, diagnostic echocardiography, leaflet motion, Doppler, or the identity of unsegmented small structures.

## Evidence identities

| Donor | Accepted export SHA-256 | Native review SHA-256 | Final TEE source-sheet SHA-256 |
|---|---|---|---|
| S-20-28 | `50895912227e178d426f4dfee3921648d1568dbcbacf7b70483b5f7c4fe8fe53` | `1057973d2b6fc5be6799318c0f87c9ebf4a145638b65d8377bc716ac7bf70fd7` | `6b07a89a413cfdc11a5e62695387cdc6bf8feb92d8881bd63acdfccc0d7b068a` |
| S-20-29 | `f350892c66e9d13f4cfdee77164351e95417d7d7d2780ea2c720655070441944` | `e463d66e613650c37308af97de5881b660a394f1580204052d44db990438fe2a` | `40b9f4f74cae4e2469c284706279cfa914e50ecdf1998489ec158e1749ac9372` |

Image directories: `native/s-20-28/` and `native/s-20-29/`. For each ID, the individual views are `tee-ID-probe.jpg`, `tee-ID-anatomy.jpg` and `tee-ID-pair.jpg`; source PNGs are `tee-ID-ct-source.png` where measured coverage exists. The source contact sheets apply each donor's actual display window and preserve the complete rectangular source raster and its aspect ratio. The native captures use the exported production shaders, accepted plane, source volume, shared depth and production camera poses. They are scientific renders, not screenshots of browser UI.

All 56 scenarios are included. Each donor has 23 in-coverage TEE views with a contained estimate, one in-coverage source section with the estimate intentionally withheld, and four outside-coverage illustrative views. There are zero unexpected missing poses. Every acquired source section has both native camera anchors. The exported source fingerprints were stable and all native GL error counts were zero.

## Dispositions

- **R — demonstrable regional family:** the measured section demonstrates the broad intended long-axis, transverse, ventricular or retained-vessel region. This is not confirmation of every named guideline structure.
- **Q — qualified approximation:** useful retained anatomy is shown, but the exact named small target, full chamber combination or full vessel course is not established. The qualification is part of the result.
- **W — source retained, probe withheld:** a useful source section is retained; no contained estimate met the source-preservation limits. Fixed context remains visible without a probe or scan sector.
- **O — outside acquired coverage:** no CT section is synthesized for an absent arch or descending-aortic target. The whole measured heart and illustrative acquisition context are shown.

S-20-28: 13 R, 10 Q, 1 W, 4 O. S-20-29: 12 R, 11 Q, 1 W, 4 O. These counts describe image review outcomes; they are not a clinical pass rate.

## Individual findings

| ID | S-20-28 final source observation | S-20-29 final source observation | Disposition 28 / 29 |
|---|---|---|---|
| me5c | Long LV and RV regions are present with a basal outflow{local-home} section. The earlier basal transverse mismatch is resolved. Full five-chamber clinical equivalence remains unproven. | Long biventricular section and basal root/outflow are present. It is no longer a transverse ventricular cut. Fixed-organ atrial boundaries remain incomplete. | R / R |
| me4c | Long LV and RV cavities, ventricular septal region and atrioventricular/atrial continuations are represented. The previously rejected probe estimate is now contained. | Long LV and RV cavities are represented and the probe estimate is contained. A conspicuous basal root/outflow cross-section remains; the curved source LV and atrial geometry do not provide a pure clinical four-chamber cut. | R / Q |
| mecommissural | The corrected −30° source roll provides a full longitudinal LV section through the mitral vicinity. The extended field retains the distal ventricular wall. Commissural scallops are not assigned. | The corrected −40° source roll replaces the prior basal cup with a long narrow LV/mitral-region section. The distal LV remains in the field. Individual scallops/papillary identities remain unconfirmed. | R / R |
| me2c | Long LV cavity and mitral/atrial continuation, with less central right-heart inclusion than ME4C. | Long narrow LV cavity and basal mitral/atrial continuation; the thick fixed wall differs from a clinical beating-heart image. | R / R |
| melax | Long ventricular route with retained outflow{local-home} and basal atrial vicinity. The final enlarged and recentered source rectangle retains the complete distal LV wall and apex, resolving the prior crop. | Long ventricular route through the retained outflow{local-home} region. The final source rectangle retains the distal LV wall and apex. The source limits full atrial and individual leaflet attribution. | R / R |
| meavlax | Longitudinal retained aortic-root/outflow lumen; a short adjacent ventricular region is visible. | Longitudinal aortic-root/outflow lumen and retained adjacent ventricular tissue. | R / R |
| meaaolax | Elongated proximal ascending-vessel lumen is demonstrated. Its truncated retained segment is not a complete ascending-aorta examination. | Elongated proximal ascending lumen and adjacent tissue are demonstrated; distal coverage is limited by excision. | Q / Q |
| meaaosax | Rounded retained aortic cross-section with an adjacent vessel/atrial region. | Rounded retained aortic cross-section with a separate adjacent region. | R / R |
| merpv | Atrial/basal source tissue is intersected and the previously unavailable pose is now contained. A specific right pulmonary-vein ostium is not established. | Atrial/basal source tissue and an adjacent outflow section are shown. Right pulmonary-vein ostial identity is not established from this section. | Q / Q |
| meavsax | Aortic-root transverse section with internal leaflet-like partitions. No named cusp labels are inferred. | Aortic-root cross-section with clear internal partitions. Named cusp identity and valve function remain unconfirmed. | R / R |
| mervinout | Basal right-heart/outflow vicinity and adjacent semilunar section are present; one continuous named TV–RV–PV route is not completely established. | Right-heart basal cavity and adjacent outflow section are present. Full inflow-to-outflow continuity and individual valve identity remain approximate. | Q / Q |
| memodbicaval | Thin atrial/atrioventricular source section. A complete inferior caval connection and TV leaflets cannot be assigned from the raster. | Folded atrial/atrioventricular tissue and several retained openings; complete caval continuity remains unconfirmed. | Q / Q |
| bicaval | Atrial wall and adjacent retained structures are visible. A complete SVC/IVC pair is not demonstrated. | A small folded atrial-region section remains, with limited surrounding coverage. A complete caval pair is not demonstrated. | Q / Q |
| mepv | Posterior atrial/basal region with adjacent vessel sections; distinct right and left pulmonary-vein ostia are unconfirmed. | Posterior atrial-region wall and adjacent vessel sections. Named pulmonary-vein entries remain unconfirmed. | Q / Q |
| melaa | Left atrial/mitral vicinity is present beside the outflow and ventricular tissue. A separate appendage and pulmonary-vein ridge cannot be established. | Lateral atrial/mitral vicinity and adjacent ventricular tissue. A definite appendage cavity or ridge is not established. | Q / Q |
| tgbasalsax | A predominantly transverse basal LV section with a rounded cavity; the earlier elongated, strongly oblique section is corrected. | A basal LV section with a broad valve-adjacent opening, distinct from the smaller mid/apical sections. The previous oblique long-axis tendency is corrected. | R / R |
| tgpapillary | Midventricular LV ring, RV relationship and intracavitary tissue are visible. Paired named papillary identity is not asserted. | Midventricular ring with small lumen and prominent intracavitary tissue in the thick fixed wall. Paired named papillary identity is unconfirmed. | R / R |
| tgapicalsax | More distal ventricular ring and reduced cavity relative to the midventricular level. | Distal thick-walled ventricular ring with smaller central space than at the basal level. | R / R |
| tgrvbasal | Right ventricular basal vicinity and retained outflow structure are sampled; complete TV anatomy is unconfirmed. | Curved thin right-heart basal region and a retained outflow section; complete valve identity remains unconfirmed. | Q / Q |
| tgrvinout | Original right-heart inflow/outflow-region source section is retained. The rejected rotated substitute is not displayed. Context remains visible without a probe/fan. | Original right-heart source section and adjacent retained vessels are retained. No gastric estimate preserves the intended source within target limits; context remains visible without a probe/fan. | W / W |
| deeptg5c | The final reviewed-root guide provides a broader continuous LV cavity and root/outflow route than the upstream-lumen guide; the apex is retained. The MV-region landmark still misses the plane by 10.58 mm, so full five-chamber correspondence is not demonstrated. | The final reviewed-root guide enlarges the visible ventricular cavity and retains the root/outflow and apex. The fixed LV cavity is still narrow and the MV-region landmark misses the plane by 17.53 mm; full five-chamber correspondence remains unconfirmed. | Q / Q |
| tg2c | Long LV cavity with mitral/atrial continuation from the inferior illustrative approach. | Long narrow LV cavity and mitral/atrial continuation, distinct from transverse ventricular sections. | R / R |
| tgrvin | Thin right-heart/atrioventricular route is visible; exact TV components and complete inflow continuity remain approximate. | Thin-walled right-heart cavity and atrioventricular region are visible. Named leaflet identity remains unconfirmed. | Q / Q |
| tglax | Long LV section with retained basal aortic outflow. | Long ventricular/outflow route is represented, although the fixed LV cavity is narrow and atrial continuity is incomplete. | R / R |
| daosax | No acquired CT section for descending-aortic target. | No acquired CT section for descending-aortic target. | O / O |
| daolax | No acquired CT section for descending-aortic target. | No acquired CT section for descending-aortic target. | O / O |
| uearchlax | No acquired CT section for complete arch/branch target. | No acquired CT section for complete arch/branch target. | O / O |
| uearchsax | No acquired CT section for complete arch/adjacent target. | No acquired CT section for complete arch/adjacent target. | O / O |

## Camera and context review

All 56 paired camera entries were examined. The upright anchor preserves a fixed specimen-specific heart/body relationship for each donor; it does not move the esophagus or stomach to chase the selected plane. The probe anchor shows the same section and accepted scan sector from the acquisition side. No acquired long-axis view became transverse merely through camera selection, and no visible rib/diaphragm/GI surface crossing of the measured heart was identified in these final images. Numeric whole-envelope clearance checks are documented independently by the context review and should be used for a clearance guarantee; transparency and occlusion alone are not a collision test.

The four outside-coverage probe-anchor views per donor center on illustrative targets outside the measured heart and can place part of the whole heart beyond the image edge. The corresponding upright anchor retains the whole heart and torso. These entries explicitly state outside coverage and contain no fabricated CT cap. The two TG RV entries visibly omit both probe and sector while keeping the fixed context and original measured source.

## Final refresh and field verification

After the complete initial inspection, only `melax` and `deeptg5c` changed within each donor's TEE set. All four final source rasters were directly reopened at the production display window, and all four paired camera images were independently reopened. Both corrected ME LAX sources now visibly retain the distal ventricular wall and apex; both deep-TG sources retain the apex and reviewed root region. The two camera anchors remain consistent with the same accepted physical section and fixed context. No new gross chamber loss or visible context collision was identified in the changed images.

The other 26 TEE source-or-coverage records and their production camera records per donor are unchanged from the complete earlier inspection. `final-refresh-delta.json` records exact raw MPR pixel hashes and camera/rectangle changes across all donors. All contact sheets were regenerated from the final exports; the old sheets are not being reused as acceptance evidence.

| Final source rectangle | Projected apex margin to nearest rectangle edge | Apex distance from accepted plane |
|---|---:|---:|
| S-20-28 ME LAX | 18.067 mm | <0.001 mm |
| S-20-29 ME LAX | 26.464 mm | <0.001 mm |
| S-20-28 deep TG5C | 22.115 mm | <0.001 mm |
| S-20-29 deep TG5C | 30.101 mm | <0.001 mm |

`native-summary.json` also verifies nonnegative projected apex margins for all 24 selected longitudinal TEE rectangles across the three donors. A projection within the rectangle is a field check, not proof that a plane intersects every intended chamber or leaflet. The separate residuals and actual source images remain necessary for anatomical assessment. All 147 available raw source PNG pixel arrays match their sampled MPR arrays exactly; all six source contact sheets are bound to the final exports, and all runtime dependency hashes are current.

## Focused source-preserving solver check

The separate `solver-checks.json` verifies the final commissural and TG basal fits against the original authored source plane, independent coplanarity checks, all 390 instrument-head vertices and the full sampled shaft. S-20-28/29 commissural corrections are 0.708°/0°, with maximum source-witness displacements 0.669 mm/~0 mm. TG basal corrections are 5.074°/2.569°; only S-20-28 uses a 1.921 mm source-normal offset, inside its 5.762 mm bounded allowance. The four full head/shaft checks remain contained. Source-preservation limits reject TG RV fits that would change the intended anatomy, leaving the exact original plane.

No universal angle or landmark-distance threshold was used to manufacture a clinical pass. Named small structures remain qualified wherever the source image and independent regional landmarks do not establish them. Deep-TG5C remains the most limited in-coverage long-axis family; the final view should be described as a constrained LV-outflow approximation.
