# LADAF final individual-view visual review

Review date: 2026-11-08. All **56 current presets** were directly inspected using both native camera anchors and all **49 available measured source rasters**. This is an engineering/anatomical plausibility review, not clinical validation. A regional finding does not certify that a named small structure or a guideline-level diagnostic view is established.

## Exact reviewed export

- Native evidence: `docs/echo-donor-qc-v6/native/ladaf-2021-17/`.
- Production export SHA-256: `cc72b4e513a88deea7a38039126d5be0bb18b8b17eff05ea5d5164e0b633aff1`.
- Native `review.json` SHA-256: `b91f3728d60e458cd14807dd6a1ae420bd8e984c38283f606087438e99f5c7c5`.
- The source-contact-sheet receipt has the same production export SHA. The native receipt records **56 views, 112 native camera images, 49 measured caps, 7 outside-scan views, zero stale source files and zero GL errors**. Those are rendering/coverage checks, not anatomical pass criteria.
- Exact per-view filenames, original-file hashes, observations and classifications are in [the machine-readable visual-review receipt](ladaf-visual-review.json).

The archived pre-correction observations remain in [the v5 baseline report](ladaf-visual-review-baseline-v5.md). The separate [target investigation](ladaf-target-inspection.md) records the measured posterior-tilt comparison, independent pulmonary localization context, and TG RV attainability evidence.

## Inspection method and limits

The four priority pairs (`tte-psax_pv`, `tte-a5c`, `tte-a4c_cs`, `tee-tgrvinout`) and their raw measured rasters were opened separately at native size. Every other full pair and available complete source raster was displayed in 26 two-view inspection plates, preserving the whole image and aspect ratio. The PLAX AV pair was additionally opened at native size. Each preset was inspected individually within its row. After the final AV, AV-zoom and deep-TG changes, those three full pairs and complete source rasters were opened separately at native size. The other 53 pairs and 46 available source rasters are byte-identical to the directly inspected first-final evidence. The machine-readable receipt preserves both inspection stages and export hashes. No anatomy was inferred solely from a camera silhouette or preset name.

The evidence uses the actual production MPR worker and measured LADAF resident display source at **317.6 micrometres**, dimensions 475×475×530. These are static postmortem sections with narrow or collapsed cavities. They do not establish motion, Doppler, normal living proportions, clinical image quality, or individual leaflet/vein/scallop identity. The body, GI tract and probe are illustrative references, not registered patient anatomy. These are native scientific renders, not browser screenshots; UI interaction verification is separate.

The intended targets were compared with the local TTE/TEE inventories and the primary [ASE adult TTE examination guideline,Table 2](https://www.asecho.org/wp-content/uploads/2025/07/Guidelines-for-Performing-a-Comprehensive-Transthoracic-Echocardiographic-Examination-in-Adults.pdf) (2019, DOI 10.1016/j.echo.2018.06.004) and [ASE/SCA comprehensive TEE guideline](https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf) (2013, DOI 10.1016/j.echo.2013.07.009). A full RV apex is not required for TG RV inflow/outflow; TV/PV/RVOT continuity is the relevant target.

## Outcomes

| Primary classification | Views | Meaning |
|---|---:|---|
| Regional anatomy supported | 34 | The visible broad chamber/axis{local-home} relationship is plausible. Small named structures and clinical correspondence may remain unconfirmed. |
| Specific target unconfirmed | 14 | A source section exists, but the exact named valve/vein/appendage/CS target is not demonstrated sufficiently. |
| Outside acquired scan | 7 | The target has no measured CT cap; illustrative context does not invent missing anatomy. |
| Source retained; probe withheld | 1 | The reviewed TG RV section is preserved because the fixed context cannot support a correspondence-preserving probe pose. |

These classifications are deliberately not “56 clinically passed views.”

### Material corrections compared with v5

- **A5C:** Aiming toward the source-observed LV outflow-region guide restores a useful narrow LV cavity together with the basal outflow neighborhood. This guide is distinct from the more superior cusp-region ROI used for AV short axis. Fine valve/LVOT and living five-chamber correspondence remain qualified. Its final raster and camera pair are byte-identical to the first-final review.
- **Posterior A4C/CS approximation:** A 2-degree posterior tilt retains the four-chamber context that the old 8-degree tilt largely lost. The CS itself is still unconfirmed.
- **PSAX AV and AV zoom:** A source-preserving plane 3 mm superior to the reviewed cusp-region ROI shows a clearer three-lobed root with internal fine tissue. Its distance to an independent proximal aortic-lumen point is 0.36 mm. AV and zoom use identical physical planes, with different crops. Individual cusp identity remains unvalidated. The [bounded target comparison](ladaf-av-target-comparison.md) records the source evidence and alternatives.
- **Deep TG five-chamber:** The separate reviewed aortic cusp/root-region guide replaces the upstream lumen guide. The final measured section retains both ventricular regions and the outflow{local-home} neighborhood, with the matching gastric pose in both anchors. Clinical five-chamber and Doppler correspondence remain unconfirmed.
- **PSAX pulmonary target:** The measured section now includes the longitudinal outlet/pulmonary neighborhood, replacing the old ventricular-only appearance. Individual pulmonary cusps are unconfirmed.
- **TG RV inflow/outflow:** The independently reviewed right-heart source is retained, with the fixed context visible and the probe/fan suppressed. The old 32-degree acquisition rotation had materially lost the TV/PV/RV neighborhood. The source plane is disjoint from the complete represented stomach by 21.19 mm, so an unchanged source target cannot have a contained TG origin in that model.

Of 49 final raw source PNGs, 28 are byte-identical to the v5 baseline, 14 differ only because one or both sampling dimensions increased by one pixel while the plane remains identical to floating-point precision (maximum vector component difference 7.8×10⁻¹⁶), and 7 have material target-plane changes listed above. All final views are covered by direct inspection of those exact image bytes. The final refresh changed only AV, AV zoom and deep TG; every other first-final pair and available source raster remains byte-identical.

## TTE: 28 views, 25 measured rasters

| View ID | Observed measured section / camera context | Interpretation and remaining limits |
|---|---|---|
| `plax_deep` | Longitudinal thick LV wall and narrow trabecular cavity; basal chamber/outflow lumens to the right. Same cardiac section family as PLAX. | Gross long-axis topology supported. A deep pleural/pericardial survey is not supplied by this isolated-heart scan. |
| `plax` | Long LV region, slit-like cavity, basal inflow/outflow channels and several lumens. | Gross long-axis topology supported; leaflet identity and normal opening are not established. |
| `plax_av` | A smaller crop of the same basal/outflow region; a bright bordered lumen and adjacent narrow channel are visible. | Target unconfirmed: source ROI is magnified, but AV cusps{local-home} identity needs independent landmarks. The 3D camera still includes the retained heart. |
| `plax_mv` | LV cavity approaches the basal atrioventricular region; thin bright internal structures are visible in the crop. | Target unconfirmed: an inflow-region crop is present, but individual MV leaflets/chordae cannot be certified. |
| `plax_rvot` | A long tube-like basal lumen with internal thin tissue, neighboring chamber spaces, and a ventricular wall/cavity below. | Target unconfirmed: an outflow-like longitudinal structure is present, but the RVOT–PV–PA chain is not independently identified. |
| `plax_rvin` | Large thin-walled/trabeculated chamber spaces beside a thick LV wall wedge; an angled inlet region crosses the middle. | Gross right-heart inflow-like topology supported; TV leaflet identity remains unconfirmed. |
| `psax_great` | Basal short-axis section with a central trilobed semilunar-root-like structure and surrounding right-heart/basal lumens. | Broad basal{local-home} topology supported. This clear root cross-section provided an independent source comparator for the corrected AV-specific presets; individual cusp identity remains unconfirmed. |
| `psax_av` | Basal short-axis section with a distinct three-lobed semilunar-root region, thin internal tissue profiles and surrounding right-heart/basal lumens. Both anchors retain the same source-preserved section and illustrative skin contact. | Regional aortic-root/valve-level topology supported by independent reviewed source landmarks. The selected plane is 3 mm from the reviewed cusp-region ROI center and 0.36 mm from the independent proximal aortic-lumen point. Individual cusp names, exact annular dimensions and clinical probe registration remain unvalidated. |
| `psax_av_zoom` | Tighter crop of the identical AV source plane, clearly retaining the three-lobed root region and fine internal profiles. The anatomy camera still shows the retained heart. | Regional root topology supported. Zoom changes only the crop; center and plane basis are identical to psax_av. Individual cusp identity and clinical diagnostic quality remain unvalidated. |
| `psax_tv` | Basal/right-heart chambers adjacent to a central root-like lumen; some thin internal structures. | Target unconfirmed: broad neighborhood plausible, but a specific TV short-axis plane is not established. |
| `psax_pv` | Longitudinal outlet/pulmonary-region lumen with a narrowing and thin tissue near its ventricular junction, plus adjacent ventricular{local-home} tissue. The old isolated ventricular-looking section is gone. | Regional outlet{local-home} topology improved and supported by the independent pulmonary source neighborhood. The source-preserving plane contains the longitudinal continuation. Individual PV cusp identity remains unconfirmed. |
| `psax_mitral` | Thick circular LV myocardium, narrow central cavity with discrete internal tissue, and an adjacent RV-like cavity. | Target unconfirmed / refit candidate: section appears ventricular; distinct paired MV leaflets or an en-face mitral opening are not demonstrated. |
| `psax_papillary` | Round ventricular section with thick LV wall, collapsed central LV space/internal tissue, and a larger neighboring trabeculated RV-like cavity. | Gross midventricular short-axis topology supported. Individual papillary muscle identities are not confidently assigned. |
| `psax_apical` | A much smaller distal myocardial section with tiny branching/narrow residual cavity spaces. | Gross apical short-axis progression supported; it is not an open normal LV lumen. |
| `a4c` | Two elongated ventricular cavity regions separated by thick septum, with basal atrial spaces farther from the apex. | Gross four-chamber-like topology supported. Fixed/collapsed source anatomy limits resemblance to living ultrasound. |
| `a4c_lv` | The same biventricular longitudinal pattern with an LV-focused raster crop. | Gross topology supported. The source crop changes; the 3D model camera still shows much of the retained heart. |
| `a4c_rv` | A larger thin-walled/trabeculated right-sided cavity and thick-walled narrow LV cavity, with basal chambers. | Gross RV-focused four-chamber-like topology supported; no functional RV assessment is possible. |
| `a5c` | Both ventricular regions remain visible, including a narrow longitudinal LV cavity, with a basal root region brought into the section. The LV cavity is retained rather than replaced by nearly solid myocardium. | Broad chamber/outflow topology improved by aiming toward the independently annotated LV outflow-region guide. This preserves the useful LV cavity; the guide is distinct from the more superior aortic cusp-region ROI. Complete living five-chamber proportions, individual cusps and fine LVOT continuity remain unvalidated. |
| `a4c_cs` | At 2 degrees posterior tilt, ventricular cavity tracks and AV continuity remain, with broad atrial spaces. The thin right-heart cavity is narrower than the unchanged A4C. | Posterior four-chamber approximation improved. The coronary-sinus lumen is still unconfirmed; the preset must retain its posterior-angulation qualification. |
| `a2c` | A single dominant elongated LV cavity with internal trabecular/papillary-like tissue and basal atrial-region spaces. | Gross two-chamber-like topology supported. Small basal lumen identities remain unconfirmed. |
| `a2c_lv` | Similar longitudinal LV cavity/internal tissue in a tighter raster crop. | Gross LV-focused topology supported; leaflet/strain/functional claims are unsupported by the static scan. |
| `a3c` | Narrow longitudinal LV cavity, basal atrial space, and an elongated root/outflow-like lumen; adjacent right-heart tissue remains visible. | Gross long-axis/outflow topology supported. Valve identities require separate landmark confirmation. |
| `a3c_lv` | Same long-axis/outflow arrangement with a closer LV raster crop. | Gross topology supported with the same limits as `a3c`. |
| `a4c_la_pv` | Cropped basal atrial region of the four-chamber family; ventricular apices intentionally excluded from the raster. | Target unconfirmed: atrial tissue/spaces are present, but no pulmonary vein ostium is independently identifiable. |
| `subcostal` | Oblique transverse screen orientation of a longitudinal biventricular section; central septal/inflow region and basal atrial spaces visible. | Gross four-chamber-like topology supported. The body/probe route is illustrative, and small septal defects cannot be assessed. |
| `subcostal_ivc` | Whole uncut heart and illustrative subcostal probe/sector; no measured CT cap. | Outside scan. No IVC continuity or diameter can be confirmed. |
| `subcostal_hepatic` | Whole uncut heart and sector directed below it; no measured CT cap or liver. | Outside scan. No hepatic veins are represented by measured tissue. |
| `ssn_arch` | Whole uncut heart with superior illustrative probe/sector; no measured arch cap. | Outside scan. The complete aortic arch is not acquired. |

## TEE: 28 views, 24 measured rasters

| View ID | Observed measured section / camera context | Interpretation and remaining limits |
|---|---|---|
| `me5c` | Two ventricular regions, basal atrial spaces, and a bright bordered elongated root-like lumen extending toward the LV cavity. | Gross chamber/outflow topology supported. Narrow fixed LV cavity and incomplete small-valve detail prevent clinical five-chamber confirmation. |
| `me4c` | Longitudinal RV-like trabeculated cavity and narrow thick-walled LV cavity separated by septum, with atrial-region spaces in the near field. | Gross four-chamber-like topology supported; leaflet identity and living chamber proportions are not established. |
| `mecommissural` | Dominant longitudinal LV cavity and basal atrioventricular region; thin internal structures near the annular neighborhood. | Target unconfirmed: an LV/inflow plane is present, but individual commissures or P3–A2–P1 scallops are not identifiable. |
| `me2c` | Single dominant elongated LV cavity with thick opposing walls and basal atrial-region tissue. | Gross two-chamber-like topology supported. |
| `melax` | Longitudinal LV cavity, basal atrial space, and a continuous elongated bright bordered outflow/root-like lumen; adjacent RV-like cavity also visible. | Gross long-axis/outflow topology supported. Individual cusp names remain unconfirmed. |
| `meavlax` | Tighter, horizontally presented crop of the long root/outflow lumen and its connection toward the LV; thin tissue at its base. | Gross aortic-root long-axis neighborhood supported. Fine leaflet and annular details require independent confirmation. |
| `meaaolax` | An elongated, open, bright bordered vessel lumen with part of its basal connection; neighboring vessel/chamber spaces. | Gross ascending-root/vessel long-axis topology supported. Full ascending-aortic coverage is limited by the specimen. |
| `meaaosax` | Rounded bright bordered vessel ring adjacent to a larger differently shaped lumen and right-heart tissue. | Gross ascending-vessel cross-section topology supported. No assessment of vessel pathology or clinical dimensions is possible. |
| `merpv` | Basal atrial-region space with narrow adjoining tissue channels; part of the ventricular/inflow region remains in the lower crop. | Target unconfirmed: no independently identifiable right pulmonary vein ostium or continuous venous segment. |
| `meavsax` | Multilobed semilunar-root-like cross-section with folded fine internal tissue, surrounded by right-heart/basal chambers. | Broad root short-axis neighborhood supported. A named three-cusp assignment is not established by this resident raster. |
| `mervinout` | Broad right-heart cavity around a central semilunar-root cross-section, with inlet-region tissue and adjacent basal/outlet lumen. | Regional right-heart neighborhood plausible; individual TV/PV identity and uninterrupted TV-RVOT-PV continuity remain unconfirmed. |
| `memodbicaval` | Broad thin-walled/trabeculated cavity, basal atrial-region spaces, thick LV wall wedge, and internal tissue near the inlet. | Target unconfirmed: no separately identifiable TV leaflets or caval continuity. Substantial ventricular tissue remains in the field. |
| `bicaval` | Large trabeculated cavity and oblique basal tissue spaces, with one superior ring-like lumen. | Target unconfirmed / refit candidate: paired SVC–RA–IVC continuity and interatrial septum are not demonstrated. A preset name alone must not certify bicaval anatomy. |
| `mepv` | Atrial-region tissue and open/cut basal spaces above ventricular wall; crop differs from the four-chamber section. | Target unconfirmed: both pulmonary vein sets cannot be individually identified. |
| `melaa` | Similar atrial-region section with a small lateral cavity-like extension and nearby narrow spaces. | Target unconfirmed: the putative appendage is not independently localized; no claim of complete LAA lobes or thrombus exclusion. |
| `tgbasalsax` | Oblique basal ventricular section with thick wall, central folded/valve-like tissue, adjacent right-heart cavity, and basal vessel portions. | Gross basal short-axis neighborhood supported. An en-face MV opening and named leaflets are not definitively established. |
| `tgpapillary` | Round ventricular section with narrow LV central space/internal tissue and larger trabeculated adjacent RV-like cavity. | Gross midventricular short-axis topology supported. Individual papillary muscle assignments remain unconfirmed. |
| `tgapicalsax` | Smaller distal myocardial section with very small branching residual cavity spaces. | Gross apical short-axis progression supported. |
| `tgrvbasal` | Basal section emphasizing a relatively large right-heart-like cavity, central inlet-region tissue, thick neighboring LV wall, and vessel portions. | Gross right-heart basal neighborhood supported; TV leaflets are unconfirmed. |
| `tgrvinout` | The original reviewed oblique right-heart{local-home} section is retained: broad right-heart cavity/inlet-outlet neighborhood around a central aortic-root cross-section. Both camera anchors show the fixed GI/body context with no probe or scan fan. | Source retained; probe intentionally withheld. The old 32-degree acquired rotation and its aortic-dominant long lumen are removed. Independent regional points support this source neighborhood, while individual TV/PV leaflets remain unconfirmed. The fixed stomach cannot contain a probe origin on the unchanged source plane. |
| `deeptg5c` | Narrow longitudinal LV cavity track with internal trabecular tissue, an adjacent RV-like cavity, basal atrial-region tissue and a long outflow/root-region lumen. Both anchors show the corresponding gastric probe and fixed GI/body context. | Gross apex-to-outflow topology supported after using the distinct reviewed aortic cusp/root-region guide. The source preserves ventricular cavity tracks; complete living five-chamber correspondence, individual valve leaflets and Doppler alignment remain unconfirmed. |
| `tg2c` | Dominant elongated LV cavity with thick walls and basal atrial/inflow-region space. | Gross two-chamber-like topology supported. |
| `tgrvin` | Broad thin-walled/trabeculated right-heart-like cavity, internal inlet tissue, and a thick LV wall wedge. | Gross right-heart inflow neighborhood supported. Individual TV leaflets/chordae remain unconfirmed. |
| `tglax` | Longitudinal LV cavity and continuous elongated root/outflow-like lumen with adjacent basal chamber spaces. | Gross long-axis/outflow topology supported, with fixed-source and leaflet limits. |
| `daosax` | Whole uncut heart seen partly off-frame in the probe anchor; illustrative posterior sector and body context in the anatomy anchor. No measured cap. | Outside scan. No descending-aortic cross-section is supplied. |
| `daolax` | Whole uncut heart and illustrative posterior probe/sector. No measured cap or descending-vessel walls. | Outside scan. No descending-aortic long-axis target is supplied. |
| `uearchlax` | Whole uncut heart and vessel stumps with superior illustrative probe/sector. No measured arch cap. | Outside scan. Vessel stumps must not be mistaken for a complete arch long axis. |
| `uearchsax` | Whole uncut heart, vessel stumps, and superior illustrative sector; no measured arch cap. | Outside scan. No arch cross-section or pulmonary artery relation is established. |

## Camera and context observations

Both anchors use the same accepted plane and measured cap. Several upright anatomy anchors show the exterior of the retained heart because the cut face points away; that is not a different CT slice. Zoom presets change the measured ROI while the 3D camera can still include much of the retained heart. The atrial focus views can crop the distal retained heart in the probe anchor while preserving the intended basal ROI. Some outside-scan TEE probe anchors also clip the whole-heart silhouette; the anatomy anchor still supplies context, but neither supplies the absent vessel anatomy.

The TG RV inflow/outflow pair specifically shows the corrected source, esophageal/gastric context and fixed body, with no probe or fan. This was visually checked in both anchors, not inferred only from metadata. The seven outside-scan views visibly have no CT cap. Simulated anatomy overlapping the heart in a 2D projection is not itself proof of 3D collision; continuous clearance audits are separate.

## Remaining target-quality risk

The specific **PSAX AV and AV-zoom** refit risk recorded in the first-final inspection is resolved at the regional source-anatomy level: both final rasters now show the independently localized three-lobed root region, and the matching paired anchors were re-inspected. This is not certification of individual cusp identity, annular dimensions or a clinical guideline acquisition.

The mitral-level en-face target, TV leaflet identity, pulmonary vein ostia, LAA detail, bicaval continuity and CS lumen also remain unconfirmed. Their current gross neighborhoods may be useful for teaching, but a familiar label, a contained probe or a mathematically coplanar sector is insufficient evidence of the required small anatomy.
