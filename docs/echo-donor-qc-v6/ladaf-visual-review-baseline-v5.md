# LADAF individual-view visual review

Review date: 2026-11-08. This document records direct visual inspection of the archived native renders in `docs/echo-alignment-v5/native/`, before the v6 corrections. It is an engineering/anatomical plausibility review, not clinical validation. It must not be described as proof that every preset satisfies its guideline target.

## Evidence and interpretation

The reviewed evidence is the measured LADAF resident CT at 317.6 µm, the accepted section raster, and paired native 3D renders from the probe and anatomy camera anchors. The archived `native/review.json` records the source hashes, 475 × 475 × 530 source dimensions, 56 presets, and 112 native renders. These are archived outputs, not browser screenshots. A new render/hash comparison is required to establish whether an unchanged row still represents the current implementation.

Every row below refers to an individually opened `native/<mode>-<id>-pair.jpg`, containing both camera anchors. For each view inside the acquired scan, its separate `native/<mode>-<id>-ct-source.png` was also opened. This matters: a tall retained 3D heart silhouette can surround a genuinely short-axis cap, and the model camera does not itself establish the anatomy of the section. Conversely, a familiar model silhouette cannot rescue a source section that misses its target.

Targets were compared with the local `public/tte-atlas-data.js` and `public/tee-atlas-data.js` inventories and these primary acquisition guides:

- [ASE adult TTE examination guideline, Table 2](https://www.asecho.org/wp-content/uploads/2025/07/Guidelines-for-Performing-a-Comprehensive-Transthoracic-Echocardiographic-Examination-in-Adults.pdf), published 2019, DOI 10.1016/j.echo.2018.06.004.
- [ASE/SCA comprehensive TEE guideline, Table 10](https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf), published 2013, DOI 10.1016/j.echo.2013.07.009.

The native CT shows fixed postmortem anatomy with narrow or collapsed ventricular cavities; it cannot demonstrate motion, Doppler, hemodynamics, or normal clinical chamber proportions. The surrounding body and probe are illustrative. Small valve leaflets, vein ostia, coronary sinus, and mitral scallops are not accepted as identified merely because a preset label names them.

Verdicts distinguish **gross topology supported** (a visible broad chamber/axis relationship), **target unconfirmed** (some plausible anatomy but the specific required structure is not established), **correction needed** (a visibly missing or substantially off-target section), and **outside scan** (no measured section available). None is a clinical pass.

## TTE — 28 individual pairs and 25 measured source rasters

| View ID | Directly observed section contents | Verdict / action |
| --- | --- | --- |
| `plax_deep` | Longitudinal thick LV wall and narrow trabecular cavity; basal chamber/outflow lumens to the right. Same cardiac section family as PLAX. | Gross long-axis topology supported. A deep pleural/pericardial survey is not supplied by this isolated-heart scan. |
| `plax` | Long LV region, slit-like cavity, basal inflow/outflow channels and several lumens. | Gross long-axis topology supported; leaflet identity and normal opening are not established. |
| `plax_av` | A smaller crop of the same basal/outflow region; a bright bordered lumen and adjacent narrow channel are visible. | Target unconfirmed: source ROI is magnified, but AV cusps{local-home} identity needs independent landmarks. The 3D camera still includes the retained heart. |
| `plax_mv` | LV cavity approaches the basal atrioventricular region; thin bright internal structures are visible in the crop. | Target unconfirmed: an inflow-region crop is present, but individual MV leaflets/chordae cannot be certified. |
| `plax_rvot` | A long tube-like basal lumen with internal thin tissue, neighboring chamber spaces, and a ventricular wall/cavity below. | Target unconfirmed: an outflow-like longitudinal structure is present, but the RVOT–PV–PA chain is not independently identified. |
| `plax_rvin` | Large thin-walled/trabeculated chamber spaces beside a thick LV wall wedge; an angled inlet region crosses the middle. | Gross right-heart inflow-like topology supported; TV leaflet identity remains unconfirmed. |
| `psax_great` | Basal short-axis section with a central trilobed root-like structure and multiple surrounding right-heart/basal lumens. | Gross basal{local-home} topology supported. Most recognizable semilunar-root-like section among the archived PSAX basal group; not cusp-level validation. |
| `psax_av` | An oblique basal root region with a C-shaped lumen and substantial neighboring myocardium. | Target unconfirmed: a clean en-face three-cusp configuration is not demonstrated. |
| `psax_av_zoom` | Small crop of that oblique basal region, including wall and lumen. | Target unconfirmed: zoom does not make a three-cusp AV view identifiable. |
| `psax_tv` | Basal/right-heart chambers adjacent to a central root-like lumen; some thin internal structures. | Target unconfirmed: broad neighborhood plausible, but a specific TV short-axis plane is not established. |
| `psax_pv` | Thick ventricular myocardium and an internal cavity/trabecular region, with an adjacent crescent-like cavity. No identifiable pulmonary valve{local-home} or continuous pulmonary arterial lumen. | **Correction needed:** the source raster is ventricular in appearance rather than the required pulmonary target. Locate independent pulmonary root points and refit. |
| `psax_mitral` | Thick circular LV myocardium, narrow central cavity with discrete internal tissue, and an adjacent RV-like cavity. | Target unconfirmed / refit candidate: section appears ventricular; distinct paired MV leaflets or an en-face mitral opening are not demonstrated. |
| `psax_papillary` | Round ventricular section with thick LV wall, collapsed central LV space/internal tissue, and a larger neighboring trabeculated RV-like cavity. | Gross midventricular short-axis topology supported. Individual papillary muscle identities are not confidently assigned. |
| `psax_apical` | A much smaller distal myocardial section with tiny branching/narrow residual cavity spaces. | Gross apical short-axis progression supported; it is not an open normal LV lumen. |
| `a4c` | Two elongated ventricular cavity regions separated by thick septum, with basal atrial spaces farther from the apex. | Gross four-chamber-like topology supported. Fixed/collapsed source anatomy limits resemblance to living ultrasound. |
| `a4c_lv` | The same biventricular longitudinal pattern with an LV-focused raster crop. | Gross topology supported. The source crop changes; the 3D model camera still shows much of the retained heart. |
| `a4c_rv` | A larger thin-walled/trabeculated right-sided cavity and thick-walled narrow LV cavity, with basal chambers. | Gross RV-focused four-chamber-like topology supported; no functional RV assessment is possible. |
| `a5c` | Basal root-like lumen added to the longitudinal section, but the LV cavity is almost lost in solid myocardium. The root is not shown as a convincing continuous LVOT long axis. | **Correction needed:** recover the LV cavity and fit toward the independently identified aortic valve{local-home} rather than an upstream lumen point. |
| `a4c_cs` | Almost entirely thick, solid ventricular myocardium with tiny basal spaces; four chambers and coronary sinus are not visible. | **Correction needed:** posterior angulation overshoots the chamber plane. The current qualified name does not make this a useful four-chamber section. Keep coronary sinus unconfirmed after refitting. |
| `a2c` | A single dominant elongated LV cavity with internal trabecular/papillary-like tissue and basal atrial-region spaces. | Gross two-chamber-like topology supported. Small basal lumen identities remain unconfirmed. |
| `a2c_lv` | Similar longitudinal LV cavity/internal tissue in a tighter raster crop. | Gross LV-focused topology supported; leaflet/strain/functional claims are unsupported by the static scan. |
| `a3c` | Narrow longitudinal LV cavity, basal atrial space, and an elongated root/outflow-like lumen; adjacent right-heart tissue remains visible. | Gross long-axis/outflow topology supported. Valve identities require separate landmark confirmation. |
| `a3c_lv` | Same long-axis/outflow arrangement with a closer LV raster crop. | Gross topology supported with the same limits as `a3c`. |
| `a4c_la_pv` | Cropped basal atrial region of the four-chamber family; ventricular apices intentionally excluded from the raster. | Target unconfirmed: atrial tissue/spaces are present, but no pulmonary vein ostium is independently identifiable. |
| `subcostal` | Oblique transverse screen orientation of a longitudinal biventricular section; central septal/inflow region and basal atrial spaces visible. | Gross four-chamber-like topology supported. The body/probe route is illustrative, and small septal defects cannot be assessed. |
| `subcostal_ivc` | Whole uncut heart and illustrative subcostal probe/sector; no measured CT cap. | Outside scan. No IVC continuity or diameter can be confirmed. |
| `subcostal_hepatic` | Whole uncut heart and sector directed below it; no measured CT cap or liver. | Outside scan. No hepatic veins are represented by measured tissue. |
| `ssn_arch` | Whole uncut heart with superior illustrative probe/sector; no measured arch cap. | Outside scan. The complete aortic arch is not acquired. |

## TEE — 28 individual pairs and 24 measured source rasters

| View ID | Directly observed section contents | Verdict / action |
| --- | --- | --- |
| `me5c` | Two ventricular regions, basal atrial spaces, and a bright bordered elongated root-like lumen extending toward the LV cavity. | Gross chamber/outflow topology supported. Narrow fixed LV cavity and incomplete small-valve detail prevent clinical five-chamber confirmation. |
| `me4c` | Longitudinal RV-like trabeculated cavity and narrow thick-walled LV cavity separated by septum, with atrial-region spaces in the near field. | Gross four-chamber-like topology supported; leaflet identity and living chamber proportions are not established. |
| `mecommissural` | Dominant longitudinal LV cavity and basal atrioventricular region; thin internal structures near the annular neighborhood. | Target unconfirmed: an LV/inflow plane is present, but individual commissures or P3–A2–P1 scallops are not identifiable. |
| `me2c` | Single dominant elongated LV cavity with thick opposing walls and basal atrial-region tissue. | Gross two-chamber-like topology supported. |
| `melax` | Longitudinal LV cavity, basal atrial space, and a continuous elongated bright bordered outflow/root-like lumen; adjacent RV-like cavity also visible. | Gross long-axis/outflow topology supported. Individual cusp names remain unconfirmed. |
| `meavlax` | Tighter, horizontally presented crop of the long root/outflow lumen and its connection toward the LV; thin tissue at its base. | Gross aortic-root long-axis neighborhood supported. Fine leaflet and annular details require independent confirmation. |
| `meaaolax` | An elongated, open, bright bordered vessel lumen with part of its basal connection; neighboring vessel/chamber spaces. | Gross ascending-root/vessel long-axis topology supported. Full ascending-aortic coverage is limited by the specimen. |
| `meaaosax` | Rounded bright bordered vessel ring adjacent to a larger differently shaped lumen and right-heart tissue. | Gross ascending-vessel cross-section topology supported. No assessment of vessel pathology or clinical dimensions is possible. |
| `merpv` | Basal atrial-region space with narrow adjoining tissue channels; part of the ventricular/inflow region remains in the lower crop. | Target unconfirmed: no independently identifiable right pulmonary vein ostium or continuous venous segment. |
| `meavsax` | Clear central trilobed root-like cross-section with fine internal tissue, surrounded by right-heart/basal chambers. | Gross semilunar-root short-axis topology supported; individual cusp assignments remain unconfirmed. This is clearer than the archived TTE AV-specific crop. |
| `mervinout` | Large right-heart-like trabeculated cavity, central semilunar-root cross-section, and an adjacent open lumen. | Target unconfirmed: broad right-heart/outflow neighborhood is visible; continuity from TV through RVOT to PV is not established. |
| `memodbicaval` | Broad thin-walled/trabeculated cavity, basal atrial-region spaces, thick LV wall wedge, and internal tissue near the inlet. | Target unconfirmed: no separately identifiable TV leaflets or caval continuity. Substantial ventricular tissue remains in the field. |
| `bicaval` | Large trabeculated cavity and oblique basal tissue spaces, with one superior ring-like lumen. | Target unconfirmed / refit candidate: paired SVC–RA–IVC continuity and interatrial septum are not demonstrated. A preset name alone must not certify bicaval anatomy. |
| `mepv` | Atrial-region tissue and open/cut basal spaces above ventricular wall; crop differs from the four-chamber section. | Target unconfirmed: both pulmonary vein sets cannot be individually identified. |
| `melaa` | Similar atrial-region section with a small lateral cavity-like extension and nearby narrow spaces. | Target unconfirmed: the putative appendage is not independently localized; no claim of complete LAA lobes or thrombus exclusion. |
| `tgbasalsax` | Oblique basal ventricular section with thick wall, central folded/valve-like tissue, adjacent right-heart cavity, and basal vessel portions. | Gross basal short-axis neighborhood supported. An en-face MV opening and named leaflets are not definitively established. |
| `tgpapillary` | Round ventricular section with narrow LV central space/internal tissue and larger trabeculated adjacent RV-like cavity. | Gross midventricular short-axis topology supported. Individual papillary muscle assignments remain unconfirmed. |
| `tgapicalsax` | Smaller distal myocardial section with very small branching residual cavity spaces. | Gross apical short-axis progression supported. |
| `tgrvbasal` | Basal section emphasizing a relatively large right-heart-like cavity, central inlet-region tissue, thick neighboring LV wall, and vessel portions. | Gross right-heart basal neighborhood supported; TV leaflets are unconfirmed. |
| `tgrvinout` | Long bright bordered root/vessel lumen, a triangular trabeculated chamber, and substantial thick ventricular wall. The tubular lumen resembles the one seen in the aortic long-axis family. | Target unconfirmed / priority identity check: do not equate this lumen with pulmonary outflow without independent pulmonary-root landmarks. |
| `deeptg5c` | Longitudinal LV cavity and root/outflow-like lumen with an adjacent RV-like cavity and basal atrial-region tissue. | Gross apex-to-outflow topology supported, but complete five-chamber correspondence and a Doppler-aligned flow axis are not demonstrated. |
| `tg2c` | Dominant elongated LV cavity with thick walls and basal atrial/inflow-region space. | Gross two-chamber-like topology supported. |
| `tgrvin` | Broad thin-walled/trabeculated right-heart-like cavity, internal inlet tissue, and a thick LV wall wedge. | Gross right-heart inflow neighborhood supported. Individual TV leaflets/chordae remain unconfirmed. |
| `tglax` | Longitudinal LV cavity and continuous elongated root/outflow-like lumen with adjacent basal chamber spaces. | Gross long-axis/outflow topology supported, with fixed-source and leaflet limits. |
| `daosax` | Whole uncut heart seen partly off-frame in the probe anchor; illustrative posterior sector and body context in the anatomy anchor. No measured cap. | Outside scan. No descending-aortic cross-section is supplied. |
| `daolax` | Whole uncut heart and illustrative posterior probe/sector. No measured cap or descending-vessel walls. | Outside scan. No descending-aortic long-axis target is supplied. |
| `uearchlax` | Whole uncut heart and vessel stumps with superior illustrative probe/sector. No measured arch cap. | Outside scan. Vessel stumps must not be mistaken for a complete arch long axis. |
| `uearchsax` | Whole uncut heart, vessel stumps, and superior illustrative sector; no measured arch cap. | Outside scan. No arch cross-section or pulmonary artery relation is established. |

## Completeness and camera/context observations

All 56 pairs were individually opened; each pair contains the full probe-anchor and anatomy-anchor native render. All 49 available measured source PNGs were also individually opened. The four overview sheets (`tte-probe-gallery.jpg`, `tte-anatomy-gallery.jpg`, `tee-probe-gallery.jpg`, `tee-anatomy-gallery.jpg`) were examined in addition. Thus 109 image files were directly examined, covering 112 native camera frames and every preset in both inventories.

The pairs show a fixed illustrated thorax in the anatomy anchor while the accepted cut and probe relation change. Several anatomy-anchor views show the exterior of the retained heart because the cap faces away; that is not evidence of a different section. Conversely, some probe-anchor views of outside-scan TEE targets clip the whole-heart silhouette at the image boundary; the anatomy anchor still supplies spatial context, but neither creates missing measured vessel anatomy. Simulated ribs, esophagus, stomach, and diaphragm may overlap the heart in a 2D projection; this visual review alone does not measure 3D collision clearance.

### Exact inspected pair/source inventory

All paths in the following inventory are relative to `docs/echo-alignment-v5/native/`. For every listed ID, the exact pair filename is `<mode>-<id>-pair.jpg`. The measured filename is `<mode>-<id>-ct-source.png`; only the seven explicitly outside-scan IDs have no measured PNG. This list is an inspection record, not an inference from the registry count.

| Mode | IDs with individually inspected pair and source files |
| --- | --- |
| TTE | `plax_deep`, `plax`, `plax_av`, `plax_mv`, `plax_rvot`, `plax_rvin`, `psax_great`, `psax_av`, `psax_av_zoom`, `psax_tv`, `psax_pv`, `psax_mitral`, `psax_papillary`, `psax_apical`, `a4c`, `a4c_lv`, `a4c_rv`, `a5c`, `a4c_cs`, `a2c`, `a2c_lv`, `a3c`, `a3c_lv`, `a4c_la_pv`, `subcostal` |
| TEE | `me5c`, `me4c`, `mecommissural`, `me2c`, `melax`, `meavlax`, `meaaolax`, `meaaosax`, `merpv`, `meavsax`, `mervinout`, `memodbicaval`, `bicaval`, `mepv`, `melaa`, `tgbasalsax`, `tgpapillary`, `tgapicalsax`, `tgrvbasal`, `tgrvinout`, `deeptg5c`, `tg2c`, `tgrvin`, `tglax` |
| TTE pairs only — outside scan | `subcostal_ivc`, `subcostal_hepatic`, `ssn_arch` |
| TEE pairs only — outside scan | `daosax`, `daolax`, `uearchlax`, `uearchsax` |

## Priority findings from the archived baseline

1. `tte-psax_pv` misses a recognizable pulmonary valve{local-home} target.
2. `tte-a5c` loses the LV cavity while bringing a basal root-like lumen into the plane.
3. `tte-a4c_cs` overshoots into nearly solid myocardial tissue, even under its current posterior-angulation label.
4. `tte-psax_av`, `tte-psax_av_zoom`, and `tte-psax_mitral` do not visibly establish the specific en-face valve anatomy implied by the reference views. These remain targeted review/refit candidates, not confirmed successes.
5. `tee-tgrvinout` needs independent pulmonary-root identity checking; its large tubular lumen resembles the aortic long-axis family. `tee-bicaval` does not demonstrate paired caval continuity. These must remain qualified while source landmarks and acquisition coverage are reviewed.

New fitting and rerender evidence must be recorded separately from these baseline observations. No historical `passed: true` flag is used as a substitute for these anatomical findings.

## Why a reviewed source plane can still produce an incorrect displayed view

The archived `native/review.json` records an acquisition-driven rotation between the named/source plane and the accepted displayed plane. This rotation is material, and explains why an older regional review of the source plane does not validate the raster actually displayed in the archived native gallery. For example, the region-reviewed `tgrvinout` normal is `[-0.463445674, -0.592511352, 0.658899390]`, but its accepted displayed normal is `[-0.162833017, -0.239463840, 0.957153320]`: a 32.003° change to accommodate the illustrative acquisition guide.

| Archived accepted view | Recorded acquisition rotation from its source plane |
| --- | ---: |
| TTE `plax` family | 35.34° |
| TTE `a4c` | 35.09° |
| TTE `a5c` | 30.62° |
| TTE `a4c_cs` | 50.00° |
| TTE `psax_av` | 13.18° |
| TTE `psax_mitral` | 17.09° |
| TEE `merpv` | 44.40° |
| TEE `mepv` | 33.90° |
| TEE `melaa` | 34.34° |
| TEE `tgbasalsax` | 32.95° |
| TEE `tgrvinout` | 32.00° |
| TEE `deeptg5c` | 35.06° |
| TEE `tg2c` | 27.58° |

These angles are read from the archived numerical record, not estimated from the pictures. They support preserving the independently reviewed tissue section when estimating an illustrative probe origin. Replacing the guide must not silently change the target anatomy. They do not by themselves prove any view clinically correct after the rotation is removed; the resulting measured raster still needs inspection.

## Independent LADAF pulmonary source localization

Additional source files directly opened for this localization were `public/assets/flow-textures/rv-outflow-preview.webp`, the full `rv-outflow.webp`, and `docs/cleanup-v29-right/source/pulmonary-serial.png`. The full 79.4 µm flow raster shows thin cusp profiles where the muscular right-ventricular outlet meets the smaller pulmonary-root region, below and separate from the large bright aortic lumen in this section. The orthogonal serial source sheets show the same neighborhood over fine-grid X=600–800; their original fine-grid axes and coordinate convention are recorded in `pulmonary-serial.json`. These are measured windowed grayscale samples, not calibrated HU.

The following points are source XYZ in the 475 × 475 × 530 resident coordinate system. World coordinates use `(X−237, Z−264.5, 237−Y)/529`; the physical reference is 168.0104 mm.

| Role | Source XYZ | World XYZ | Evidence and limitation |
| --- | --- | --- | --- |
| Reviewed cusp/outlet focus | `[174,292,226]` | `[-0.119092628,-0.072778828,-0.103969754]` | `public/assets/flow-views-v5.json`, RV-outflow target. Source Y292 was selected after comparing Y260–305 and X145–190. It is a focal target, not an annular centroid. |
| Approximate proximal pulmonary-root center | `[190,302,230]` | `[-0.088846881,-0.065217391,-0.122873346]` | `docs/anatomy/cavity-tracks.json`, track 6 at source Z230, consistent with the previously estimated hinge surface. A candidate center for refitting, not a segmented valve center. |
| More superior pulmonary lumen | `[205,317,210]` | `[-0.060491493,-0.103024575,-0.151228733]` | Track 6 at source Z210; with the root point, defines a local continuation direction. |
| Independently identified pulmonary-root wall | `[170,322,200]` | `[-0.126654064,-0.121928166,-0.160680529]` | `docs/anatomy/independent-flow-landmarks-v5.json`: manually selected on uncolored orthogonal source before viewing candidate labels. **Wall identity point, not lumen center.** |
| Independent outer pulmonary wall | `[187,351,181]` | `[-0.094517958,-0.157844991,-0.215500945]` | Same independent landmark file; corroborates vessel identity farther along the source-supported wall. **Not a valve center.** |

`scripts/anatomy-v5-methods.py` and `docs/anatomy/method-parameters-v5.json` document a visually estimated pulmonary hinge boundary:

`source Z = 220 + 0.50 × (source X − 175) + 0.13 × (source Y − 290)`.

It was reviewed in Y290/Y305 and X175 source cuts. Its normalized world normal is `[-0.444220745, 0.888441490, 0.115497394]`. The root-to-superior-lumen direction above is `[0.514495755, -0.685994341, -0.514495755]` in world coordinates. These give bounded, source-based candidate orientations for comparison; neither is an expert-validated annular axis.

Using the archived accepted PSAX pulmonary plane, the perpendicular distances to the existing cusp focus and candidate root center are **27.23 mm** and **23.61 mm**, respectively. This numerical discrepancy agrees with the ventricular-looking source raster and makes the old aortic-offset pulmonary target untenable.

For Table 2.10b, the required structures include RVOT, pulmonary valve and proximal pulmonary artery. The local acquisition inventory explicitly follows their continuity. A plane perpendicular to the pulmonary vessel axis would instead produce a valve{local-home} cross-section. The first refit candidate should therefore contain the measured pulmonary outlet{local-home} continuation (the reviewed Y292 longitudinal flow plane is a source-supported starting point), with its field centered on the pulmonary root. En-face hinge-plane candidates can be supplementary comparisons, but are not a substitute for the required outflow continuity.
