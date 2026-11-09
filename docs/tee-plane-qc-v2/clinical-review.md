# TEE plane quality control: anatomical review

Date: 7 November 2026. Baseline: site version 44. Dataset: LADAF-2021-17 excised, fixed human heart.

## Scope and interpretation

This review separates three questions: whether a CT section contains the structures that define a named TEE view; whether the display follows the corresponding ultrasound orientation; and whether the simulated probe has a plausible anatomical approach. These questions cannot be answered by the electronic angle label alone. The ASE acquisition guidance explicitly permits adjustments to position, flexion, turning and angle according to the structures actually displayed. [1]

The donor specimen has a collapsed LV cavity and incomplete vascular ends. The original HiP-CT donor study also identifies collapse of the LA in its Figure 4. [4] Its measured CT section cannot be expected to have the same cavity proportions as a normal beating heart in clinical ultrasound. The appropriate objective is anatomical inclusion, exclusion, and continuity. Pixel resemblance to a healthy ultrasound frame or to a generated illustration would reward the wrong properties.

The six-color anatomy layer is an approximate tissue-region annotation. It does not separately segment valves, individual pulmonary veins, the caval veins, or the atrial appendages. In this review, a color beside an opening is not evidence that the opening is a named vein. Source-image continuity and known landmarks carry more weight than the regional tint. See the source annotation limitations in `docs/anatomy/README.md` and `docs/anatomy/README-v4.md`.

The new JSON companion, `clinical-targets.json`, contains per-view anatomical gates for all 28 ASE Table 10 entries, the relevant source pages, acquisition-angle references, display conventions, source-coverage limits, and the baseline findings below. It deliberately preserves `expertValidated: false` and `clinicalRegistrationVerified: false`.

## Source review

The local ASE PDF was re-read at PDF pages 11–22, including the instrument manipulation and display conventions, Table 10, and all 28 numbered acquisition sections. Table 10 occupies PDF pages 14–17, corresponding to journal pages 934–937. The exact first-column schematic crops were inspected in the source contact sheet. They were used to establish orientation and view identity, not as pixels to be imitated by the CT.

The original prepared-plane correspondence review in `docs/echo-v11/README.md` already classified the important TEE planes as partial or unverified. In particular, it left ME4C atrial junctions and outflow exclusion unresolved, ME2C mitral anatomy unresolved, ME LAX outflow continuity unresolved, bicaval junctions unresolved, and TG papillary level unresolved. The present task revisits those previously retained planes rather than assuming that their familiar names validate them.

## Review method

1. Verify that the section is newly sampled from the exact physical candidate plane in the correct donor volume. An old prepared texture must never be displayed on a changed plane.
2. Check the connections that define the view. Examples are both atrioventricular junctions in ME4C, LV–LVOT–AV continuity in LAX, and both venous entries into one RA in bicaval.
3. Reject an incorrect defining structure or level. Examples are aortic outflow in ME4C or two-chamber, an aortic-root cut for basal mitral short axis, or a tubular aortic section for valve short axis.
4. Compare nearby offsets and angular alternatives within a plausible family. Improve retained target extent, reduce avoidable foreshortening, and preserve the relevant junctions.
5. Inspect the actual grayscale tissue and adjacent-source continuity. Approximate labels assist orientation but cannot independently establish identity.
6. Review field of view, near/far orientation and handedness after the physical slice has been selected. Display reflection or roll must stay distinct from a change in physical sampling.

Any numerical fit is a ranking heuristic over available landmarks. It is not an accuracy percentage or proof that the clinical view is achieved. A high score on unvalidated labels must not override an anatomical failure visible in the source section. Individual label groups, point-to-plane distances, and unresolved targets should be reported separately.

## Baseline observations

The reviewed sheet is `baseline-source-sections.jpg`: 24 actual 317.6 µm source sections with regional tint. The four thoracic aortic views have no corresponding donor anatomy and were not assigned a synthetic CT slice.

| View | Baseline finding | Main correction or remaining question |
|---|---|---|
| 1. ME five-chamber | Both ventricular regions and an aortic-root profile are present. | Confirm both AV junctions and LVOT continuity. True apex is less important here than in ME4C. |
| 2. ME four-chamber | Aortic-root/outflow tissue is plainly included. | Select a plane with both AV junctions and septa while excluding the defining outflow section. |
| 3. ME commissural | Resembles the current long-axis family, with aortic-root territory. | Obtain a broad mitral commissural section and bilateral subvalvular context. |
| 4. ME two-chamber | Long LV is present and most RV is excluded. A circular near-field vessel profile complicates interpretation. | Confirm LA–MV continuity; do not rank by LV length alone. |
| 5. ME long-axis | Root/cusp territory is present, with limited elongated outflow. | Improve continuous LV–LVOT–AV–aorta display without losing MV. |
| 6. ME AV long-axis | An elongated root region is recognizable. | Tighten valve{local-home} framing; exact annulus and cusp identity remain unsegmented. |
| 7. ME ascending-aorta long-axis | Retained long aortic segment is visible. | Preserve continuous vessel walls and explicitly limit claims at cut ends. |
| 8. ME ascending-aorta short-axis | Aortic tubular cross-section is plausible. | Confirm above-valve level; adjacent SVC and PA branch identities remain uncertain. |
| 9. ME right pulmonary veins | Atrial region is present. | Named superior/inferior ostia are not established by current annotations. |
| 10. ME AV short-axis | Dominant LV muscle with only a small aortic boundary. | Move to the actual root/cusp level and inspect a range of offsets and tilts. |
| 11. ME RV inflow/outflow | Predominantly RA/RV inflow. | Require continuity into RVOT, PV and proximal PA. |
| 12. ME modified bicaval TV | Right inflow family is recognizable. | Center reviewed TV hinge region; inferior caval and IAS continuity need separate evidence. |
| 13. ME bicaval | Substantial ventricular and root tissue enters the section. | Center RA/IAS and demonstrate both caval-side entries if retained. |
| 14. ME pulmonary veins | Broad atrial section. | Right and left PV acquisitions are separate; one plane must not claim all four veins. |
| 15. ME LAA | Collapsed LA territory. | Identify the appendage ostium and body by continuity before using an appendage-specific label. |
| 16. TG basal short-axis | Aortic-root star and outflow-level tissue dominate. | Move to the LV base/MV level. |
| 17. TG midpapillary short-axis | Original-centered review confirms two principal internal LV muscular profiles and a complete myocardial envelope. | Compare neighboring baseward/apical levels and modest tilt; do not require an artificially round healthy lumen. |
| 18. TG apical short-axis | Plausible apical ventricular family. | Confirm level beyond dominant papillary bodies while retaining a meaningful cavity section. |
| 19. TG RV basal | Uses the same root-level section as TG LV basal. | Optimize TV short axis and longitudinal RVOT from the reviewed right-heart geometry. |
| 20. TG RV inflow/outflow | Root-level transverse section. | Obtain the connected longitudinal right inflow/outflow pathway. |
| 21. Deep TG five-chamber | Outflow territory is present. | Confirm apical/gastric near-field convention and longitudinal outflow direction. |
| 22. TG two-chamber | Prominent elongated aortic pathway. | Exclude outflow; preserve LV–MV–LA continuity. |
| 23. TG RV inflow | Right-heart inflow with substantial transverse LV muscle. | Improve RV longitudinal extent through TV and RA. |
| 24. TG long-axis | Long aortic region present. | Confirm LVOT continuity, MV context and gastric display convention. |
| 25–28. Descending aorta and arch | Required thoracic segments are outside the specimen. | Keep clinical cine and contextual anatomy; do not relabel retained ascending aorta as missing anatomy. |

These are visual findings in measured sections, not a diagnosis of the donor or expert adjudication of a clinical echocardiogram.

## Orientation and acquisition checks

For standard anterior-facing ME imaging near 0°, the right heart appears toward the left of the display. The near field begins beside the transducer at the top. The conventional ME4C therefore places the atrial side above the ventricles, with RV on screen left and LV on screen right. A 90° acquisition changes the relationship to patient inferior/superior, and simultaneous orthogonal imaging can reverse the appearance relative to a single-plane acquisition. [1]

ME bicaval at approximately 90–110° has IVC toward screen left/inferior and SVC toward screen right/superior; LA and IAS lie nearer the transducer than RA. In TG short axis, the gastric-facing wall is near field and the RV crescent belongs to the source reference's left side. TG long-axis views must not inherit a vertical ME atria-over-ventricles arrangement. Standard TG RV inflow/outflow and its alternative rotated acquisition can be mirror-related; the chosen acquisition must be stated consistently. [1]

Clinical multiplane angles are references relative to the probe, not scanner-frame rotations. The guideline's ME4C acquisition prose uses approximately 10–20° whereas its Table 10 reference lists 0–10°; the target anatomy resolves the apparent discrepancy. The study module must not treat either range as an exact registration constraint for this donor.

## Anatomical context model

The esophagus should remain posterior to the LA/pericardium, outside the cardiac cavities, and fixed in donor-world coordinates as scan planes change. Its exact lateral course varies: a primary cadaver study found variable relations to the posterior LA, supporting an authored curved tract rather than a claim of a measured donor centerline. [2]

The diaphragm should read as the thoracoabdominal partition, with the heart above its central region and stomach below the left dome. The distal esophagus passes through a posterior hiatus and a short abdominal segment to the cardia. The fundus extends leftward beside the gastroesophageal junction; a curved body and antral continuation should make the stomach recognizable without exaggerated distension. These are normal anatomical relationships used for an illustrative spatial scaffold; pathological hernia geometry is not being reproduced. [3]

The organ model cannot inherit each view's plane-up direction as its body vertical. The LV apex-to-base axis is a cardiac axis and is oblique to patient superior/inferior in vivo. Source-region relationships can help choose a plausible fixed transform, but the excised heart cannot validate torso registration. Esophageal thickness, gastric distension, diaphragm height and probe insertion distance remain authored parameters.

ME, TG and deep-TG probe locations should communicate approach behind the atrial side, through the gastric wall toward inferior heart, and from the deeper gastric/apical side respectively. Clinical centimetres from the incisors are reference acquisition values. They must not be described as measurements from this donor scan, which contains neither incisors nor the requested digestive organs. [1]

## Final candidate review

All 24 baseline and selected measured sections were compared in the four `final-before-after-*.jpg` sheets, with grayscale tissue and the approximate regional tint shown separately. Candidate contact sheets informed the selection, and an additional 78 targeted TG sections were reviewed: 36 basal alternatives across three independent orientation families, 21 original-centered midpapillary neighbors, and 21 original-centered apical neighbors. The latter two originals were actively tested and retained; they were not exempted from the review.

The search record in `geometry-verification.json` reports 72,384 candidate evaluations and 539 rendered candidate reformats. Those are computational search counts, not numbers of expert-adjudicated clinical images. `selection-decisions.json` preserves the chosen physical frame, its presentation frame, the numerical ranking components and limitations. The clinical target JSON now records independent per-view conclusions.

| View | Final candidate | Decision and evidence | Remaining limit |
|---|---:|---|---|
| 1. ME five-chamber | 2366 | Improved both ventricular/AV-junction regions with outflow retained. | Some foreshortening is acceptable for this view; exact junction identity is approximate. |
| 2. ME four-chamber | 1933 | Removes the dominant aortic-outflow profile while preserving atrial and ventricular regions. | Both AV junctions and septa are not expert registered. |
| 3. ME commissural | 2249 | Removes the long outflow path and favors the mitral/left-heart section. | P3/A2/P1 and paired papillary systems remain unresolved. |
| 4. ME two-chamber | 1777 | Cleaner isolated left-heart family than the lower-cost four-chamber-like candidates. | Anterior/inferior wall and exact mitral labels are unregistered. |
| 5. ME long-axis | 2225 | Better continuous LV–LVOT–root–aorta; outflow-right display corrected. | Fixed collapsed cavity and valvar boundaries limit clinical resemblance. |
| 6. ME AV long-axis | 2264 | Root and retained aortic continuity with LA-side azimuth constraint; horizontal outflow presentation. | Annulus, sinuses, STJ and cusps are not separately validated. |
| 7. ME ascending-aorta long-axis | 2644 | Longer paired aortic walls and consistent near-field presentation. | Vessel truncation remains; no arch is established. |
| 8. ME ascending-aorta short-axis | 1094 | Above-valve tubular aortic section, distinct from valve SAX. | Adjacent SVC and PA branch identities are unresolved. |
| 9. ME right pulmonary veins | 1516 | More focused LA/venous-entry region after neighboring-plane review. | Neither right-vein ostium is independently confirmed. |
| 10. ME AV short-axis | 1094 | Replaces muscular/outflow-edge section with actual root/cusp territory. | Cusp labels and annular measurements remain unvalidated. |
| 11. ME RV inflow/outflow | 1094 | Connected right-inflow/outflow pathway; inflow-left/outflow-right display corrected. | Regional continuity does not validate individual valve leaflets. |
| 12. Modified bicaval TV | 2270 | TV-side RA/RV region and longitudinal presentation improved. | IVC/IAS and full modified-bicaval topology remain unresolved. |
| 13. ME bicaval | 1094 | Better atrial/septal-side territory with less ventricular{local-home} dominance. | Both caval ostia and continuous IAS are not established. |
| 14. ME pulmonary veins | 1516 | Focused LA/venous-entry regional correspondence. | Does not establish all four veins in one plane. |
| 15. ME LAA | Original, 0 | Retained after the finalist family failed to demonstrate a better appendage-specific section. | LAA ostium/body/lobes remain unverified. |
| 16. TG basal short-axis | 11201 | Independently oriented LA–LV-interface section gives broader mitral-region opening and removes dominant root star. | Exact annular/leaflet and fishmouth correspondence remains partial. |
| 17. TG midpapillary | Original, 0 | Retained after 21 close neighbors; two principal muscular profiles and myocardial envelope are clearer. | Individual papillary identity is not segmented; lumen remains collapsed. |
| 18. TG apical | Original, 0 | Retained after 21 close neighbors; avoids dominant papillary profile of proposed proximal replacement. | Source morphology supports the level; no clinical registration. |
| 19. TG RV basal | 1094 | Reviewed TV-hinge neighborhood replaces duplicated LV{local-home} cut. | Complete en-face TV and long RVOT are not established simultaneously. |
| 20. TG RV inflow/outflow | 1094 | Follows the connected RV pathway around the root. | Valve leaflets/cusps are not individually verified. |
| 21. Deep TG five-chamber | 1565 | Both ventricular and outflow regions retained, with apical side near/top. | Gastric approach and Doppler beam alignment are illustrative. |
| 22. TG two-chamber | 2804 | Removes the long aortic channel; quarter-turn places LV/apex left and MV/LA right. | Wall identity and actual gastric approach remain unregistered. |
| 23. TG RV inflow | 1094 | Improved longitudinal RA–TV-region–RV; ventricular side left, atrial base right. | Leaflet/subvalvar identities remain unresolved. |
| 24. TG long-axis | 1546 | Better long LV–outflow/root; quarter-turn places LV left and outflow lower-right. | Gastric approach is illustrative; cavity remains collapsed. |
| 25–28. Descending aorta and arch | None | Kept outside the measured specimen. | Missing anatomy cannot be recovered by plane optimization. |

### Why the numerical winner was sometimes rejected

The first ME2C and TG2C numerical finalists contained substantial RV/RA and looked more like mirrored four-chamber sections. Their point-to-plane score was favorable because the sparse left-heart anchors were included. That did not satisfy the view's exclusions. Whole-regional-section exclusion checks and direct visual inspection recovered a more defensible left-heart family. ME2C 1777 was selected over slightly lower-cost alternatives because its unrelated vessel rim was less intrusive, without a material loss of target extent.

The first basal TG candidate still crossed the arterial root. A separate sweep using an estimated LA–LV interface found 11201, which shows a broad mitral-region opening. The 3 mm more ventricular neighbor, 11204, shows more chordal/subvalvar profiles and is less suitable for the basal leaflet target. The true clinical fishmouth pattern is still not established, so the result remains limited.

The initial midpapillary and apical axis/level estimates were also anatomically worse. The midpapillary replacement had one elongated dominant muscular profile; the proposed apical level still contained a prominent papillary body. Original-centered sweeps over offsets of up to 4 mm and tilts of up to 4 degrees supported retaining the originals. This is why zero geometric cost is not a sufficient selection rule.

### Presentation corrections

Physical slice selection and display orientation were reviewed separately. ME LAX and ME RV inflow/outflow needed horizontal reflections. ME AV LAX and ascending-aorta LAX needed in-plane roll and framing to align their aortic axes with the reference presentation. TG2C, TG RV inflow and TG LAX needed quarter-turn rolls so that the ventricular/apical side lies left and the basal atrial/outflow side lies right. Deep TG5C remains apex-near/top. The final corrected TG sheet was reviewed again after these changes.

These transforms must be applied consistently to sampled pixels, display basis and 3D plane geometry. They change presentation, not which tissue belongs to the physical slice. The implementation's geometry verification reports plane preservation and orthonormality, but these checks do not establish anatomical identity.

### Spatial context review

The authored organ model was inspected in `docs/tee-context-v2/oblique-transparent.png`, `anterior-surface.png`, `left-surface.png` and `posterior-surface.png`. The gross relationships are coherent: esophagus behind the heart, heart above the diaphragm, continuous esophageal passage through the hiatus into the cardia, and a recognizable left-sided gastric fundus/body with antral continuation. A smoother lateral esophageal bend was suggested as visual polish.

The fixed body-like frame blends source anatomy and cardiac orientation to make the context plausible. It is not patient registration. A computed clearance between the authored diaphragm and a coarse measured-heart envelope is a model-collision metric, not a measured donor diaphragm distance. No claim is made that the illustrated stomach size, hiatus level, esophageal course or probe insertion distance was recovered from the donor scan.

### Practical conclusion

The revised selection is a defensible improvement among the candidates examined. It does not establish the absolute best possible clinical plane, and no entry has been promoted to expert-validated status. The best-supported changes correct clear level/family errors and display orientation. The most limited targets—commissural scallops, named veins, LAA, caval junctions and en-face valve anatomy—remain explicitly partial because their defining structures are not independently verified in this specimen.

## Sources

1. Hahn RT et al. *Guidelines for Performing a Comprehensive Transesophageal Echocardiographic Examination*. J Am Soc Echocardiogr. 2013;26:921–964. DOI: [10.1016/j.echo.2013.07.009](https://doi.org/10.1016/j.echo.2013.07.009). [ASE PDF](https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf). Table 10 and acquisition sections 1–28; display conventions at journal page 931. Local PDF SHA-256: `bfa36d7fb9990ef0db218e69e5b7253cb35806fabe648f9896ec64a59f8ab385`.
2. Sánchez-Quintana D et al. *Anatomic relations between the esophagus and left atrium and relevance for ablation of atrial fibrillation*. Circulation. 2005;112:1400–1405. DOI: [10.1161/CIRCULATIONAHA.105.551291](https://doi.org/10.1161/CIRCULATIONAHA.105.551291). [PubMed PMID 16129790](https://pubmed.ncbi.nlm.nih.gov/16129790/). Primary anatomical study.
3. *Surgical Anatomy of Paraesophageal Hernias*. Thorac Surg Clin. 2019. DOI: [10.1016/j.thorsurg.2019.07.008](https://doi.org/10.1016/j.thorsurg.2019.07.008). [PMC7263794](https://pmc.ncbi.nlm.nih.gov/articles/PMC7263794/). Normal hiatus, gastroesophageal junction and gastric anatomical relationships.

4. Brunet et al. *Multidimensional Analysis of the Adult Human Heart in Health and Disease using Hierarchical Phase-Contrast Tomography (HiP-CT)*. 2023 primary donor-imaging preprint. DOI: [10.1101/2023.10.09.561474](https://doi.org/10.1101/2023.10.09.561474). [PMC10592740](https://pmc.ncbi.nlm.nih.gov/articles/PMC10592740/). Figure 4 identifies collapsed LA in both hearts; Figure 3 demonstrates appendage anatomy in the source study, but does not by itself register that anatomy to the selected TEE plane.
