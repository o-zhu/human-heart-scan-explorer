# Per-donor echo review criteria

This checklist applies independently to LADAF-2021-17, S-20-28 and S-20-29. It is a review specification, not a completed clinical validation. There are 28 TTE and 28 TEE presets per specimen: 168 review scenarios and 336 native renders when both camera anchors are included. A source section whose contained acquisition estimate is deliberately withheld remains in this denominator.

## Primary references

- Mitchell et al., ASE, *Guidelines for Performing a Comprehensive Transthoracic Echocardiographic Examination in Adults* (2019), DOI [10.1016/j.echo.2018.06.004](https://doi.org/10.1016/j.echo.2018.06.004). [Official PDF](https://www.asecho.org/wp-content/uploads/2019/01/2019_Comprehensive-TTE.pdf). The app's 28 presets correspond to Table 2: rows 2.1–2.27, with separate 2.10a and 2.10b.
- Hahn et al., ASE/SCA, *Guidelines for Performing a Comprehensive Transesophageal Echocardiographic Examination* (2013), DOI [10.1016/j.echo.2013.07.009](https://doi.org/10.1016/j.echo.2013.07.009). [Official PDF](https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf). The app uses the 28-view comprehensive examination.

The guidelines establish the named acquisition families and expected anatomy. The tests below are project-specific checks against the existing view registry and each donor's measured source. Clinical multiplane angles and external marker directions are acquisition guidance; their numeric agreement is not proof of anatomical correspondence in an excised, differently oriented heart.

## Evidence and acceptance rules

1. Inspect the actual measured CT reformat and the retained three-dimensional heart for every view. A mathematical plane/sector match alone cannot pass an anatomical check. Inspect both camera anchors; changing camera cannot correct an incorrect cut.
2. Locate the donor's ventricular apex, atrioventricular regions, cavities and outflow roots in its own source. Check intermediate cavity continuity as well as endpoint landmarks: an apex-to-valve plane can miss a curved ventricular cavity.
3. Treat A4C as a longitudinal cardiac section: apex-to-base extent, ventricular septum, both ventricular regions and both atrioventricular/atrial regions should be represented. A transverse ventricular ring is a clear mismatch. Conversely, ventricular SAX should be predominantly transverse, with sequential basal, midventricular and apical levels.
4. Verify that the accepted acquisition pose, displayed sector, cut face and sampled CT use the same plane; check forward-facing targets and coverage. Check probe/tract placement and context clearance separately from cardiac anatomy.
5. Record missing or unconfirmed structures explicitly. Named coronary sinus, pulmonary-vein ostia, atrial appendage, valve scallops, individual cusps and papillary pairs cannot be inferred solely from a broad chamber label. Missing liver, hepatic veins, distal arch or descending aorta cannot be supplied by synthetic CT.
6. Assign each specimen/view a visual outcome: **demonstrable regional target**, **closest available approximation**, **outside acquired coverage**, or **unresolved**. “Demonstrable regional target” does not imply a diagnostic clinical echocardiogram or individual leaflet identification.

The review uses fixed-organ, windowed uint8 CT display data. It cannot validate valve motion, Doppler, physiologic chamber shape, clinical insertion distance or patient registration. Illustrative ribs, skin, esophagus, stomach and diaphragm supply spatial context and must remain labelled as such. Nominal apical rotation differences for S-20 are recorded as deviations, not automatic anatomical failures.

## TTE: individual review targets

These are practical discrimination tests against the app's local registry, not instructions for scanning a patient. MV/TV/AV/PV denote mitral/tricuspid/aortic/pulmonary valves; LV/RV/LA/RA denote the four cardiac chambers. “Region” deliberately avoids claiming unsegmented small-structure identity.

| ID | Table | Independent source-image check | Main failure or limitation to record |
|---|---|---|---|
| plax_deep | 2.1 | Same longitudinal LV–MV–aortic route as PLAX with broader depth. | A larger field must not silently change the cardiac plane; extracardiac fluid cannot be inferred. |
| plax | 2.2 | LV length, MV/LA region and aortic outflow continuity. | Transverse LV ring or isolated wall patch; true apex need not be visible. |
| plax_av | 2.3 | Same PLAX acquisition, focused on LVOT and retained aortic root. | Zoom is not a new root orientation; distal vessel truncation. |
| plax_mv | 2.4 | Same PLAX acquisition, focused on MV–LA–LV continuity. | Unsupported leaflet/scallop identity. |
| plax_rvot | 2.5 | Continuous RV outflow toward pulmonary root and retained PA. | Mistaking aorta for pulmonary outflow; absent bifurcation. |
| plax_rvin | 2.6 | RA–TV region–RV route. | LV/MV route presented as right-heart inflow. |
| psax_great | 2.7 | Great-vessel level, separate aortic and pulmonary outflow regions. | Pulmonary branches absent or not independently identifiable. |
| psax_av | 2.8 | Cross-section at aortic root with adjacent atrial/RVOT regions. | Longitudinal root or mid-LV section. |
| psax_av_zoom | 2.9 | Same aortic-root cross-section, closer field. | Three-cusp labels require source confirmation. |
| psax_tv | 2.10a | Right atrioventricular region distinguished from AV/MV level. | A generic basal cut does not establish TV leaflets. |
| psax_pv | 2.10b | Pulmonary-root/RVOT region distinct from AV. | Root-axis and leaflet identity uncertainty. |
| psax_mitral | 2.11 | Basal LV section near MV, above midventricular papillary level. | Mid-LV ring relabelled as MV. |
| psax_papillary | 2.12 | Mid-LV cross-section with RV/septal relationship. | Named paired papillary muscles remain unconfirmed if indistinct. |
| psax_apical | 2.13 | Distal ventricular section, smaller LV cavity than midventricle. | Basal or midventricular section reused. |
| a4c | 2.14 | Longitudinal apex, LV/RV, MV/TV regions, LA/RA and septal continuity. | Transverse ring; foreshortened or missed LV; LVOT intrusion. |
| a4c_lv | 2.15 | Same four-chamber cut focused on full LV length. | Cropped true apex; zoom changes plane. |
| a4c_rv | 2.16 | RV-focused long section retaining TV and RA connection. | A mere crop cannot rescue an RV missed by the original plane. |
| a5c | 2.17 | Four-chamber family tilted toward LVOT/AV. | Same four-chamber raster with no outflow added. |
| a4c_cs | 2.18 | Posterior atrioventricular section distinguished from ordinary A4C. | Coronary sinus identity requires direct source evidence. |
| a2c | 2.19 | Longitudinal LV–MV–LA with reduced right-heart inclusion. | Long-axis labels on SAX; large RV cavity remains central. |
| a2c_lv | 2.20 | Same two-chamber cut, full LV length. | New plane from zoom or missing apex. |
| a3c | 2.21 | Longitudinal LV/MV/LA and aortic outflow in one section. | Nominal rotation without aortic root actually intersecting. |
| a3c_lv | 2.22 | Same three-chamber cut focused on LV and outflow. | Missing apex or loss of LVOT during crop. |
| a4c_la_pv | 2.23 | Atrial-focused four-chamber family with retained venous entry region. | Individual PV ostia unconfirmed; LA can require independent optimization. |
| subcostal | 2.24 | Four-region long section from inferior illustrative approach. | Transverse ventricular ring; missing liver is not acquired anatomy. |
| subcostal_ivc | 2.25 | Retained IVC–RA continuity if present. | Truncated caval segment or synthetic vessel substituted for source. |
| subcostal_hepatic | 2.26 | Hepatic/IVC target only if actually acquired. | Heart-only source generally cannot show hepatic veins. |
| ssn_arch | 2.27 | Ascending–arch–descending continuity and branch origins if acquired. | Excised-heart truncation; contextual arch must not become a CT claim. |

## TEE: individual review targets

The camera must preserve the probe-side near field and the intended cardiac section. Midesophageal and transgastric planes with similar cardiac targets have different acoustic approaches. A feasible esophageal or gastric pose is necessary for the illustration but does not establish named leaflet or ostial anatomy.

| ID | ASE view | Independent source-image check | Main failure or limitation to record |
|---|---:|---|---|
| me5c | 1 | Basal four-region cut plus LVOT/AV, approached behind atria. | A source-longitudinal target must not degrade to ventricular SAX after tract fitting. |
| me4c | 2 | Both atrioventricular regions and ventricular long axes, LV apex retained as far as source permits. | LVOT replaces MV target; basal cut loses ventricles; absent pose. |
| mecommissural | 3 | Oblique MV/chordal region crossing LV/LA. | P3/A2/P1 and paired papillary identities cannot follow from angle alone. |
| me2c | 4 | Long LV–MV–LA route with less RV involvement. | LV cavity missed by a mathematically longitudinal plane. |
| melax | 5 | LV/MV/LA–LVOT–AV continuum. | Root not reached, or a broad source target mistaken for individual scallops. |
| meavlax | 6 | LVOT, aortic root and retained ascending segment longitudinally. | Oblique or transverse lumen presented as long axis. |
| meaaolax | 7 | Retained ascending aorta longitudinally. | Limited proximal vessel does not prove complete ascending coverage. |
| meaaosax | 8 | Ascending aortic cross-section with adjacent retained pulmonary region. | Wrong vessel or root-level substitution; extracardiac truncation. |
| merpv | 9 | Right posterior atrial venous entry region from a contained tract pose. | Specific right PV ostia unconfirmed; hidden/rejected probe. |
| meavsax | 10 | Aortic-root transverse section. | Three-cusp attribution requires separate evidence. |
| mervinout | 11 | Right inflow through TV/RV toward outflow/pulmonary root. | LV cavity dominates; inflow and outflow cannot both be followed. |
| memodbicaval | 12 | RA/IAS/TV and retained inferior caval region. | Generic atrial section falsely labelled complete bicaval anatomy. |
| bicaval | 13 | RA with superior/inferior caval directions and IAS. | Truncated veins; neither complete caval pair nor ostia proven. |
| mepv | 14 | Posterior atrial venous-entry target, source coverage explicit. | “Pulmonary veins” asserted from LA alone. |
| melaa | 15 | Left atrial appendage-region section separated from main LA when recognizable. | Unsegmented fold/cavity mistaken for appendage or LSPV ridge. |
| tgbasalsax | 16 | Gastric approach to basal LV/MV region, transverse LV orientation. | Papillary-level slice reused as basal valve cut. |
| tgpapillary | 17 | Gastric approach to midventricular cross-section. | Valve level or apex instead of midventricle; papillary pair unconfirmed. |
| tgapicalsax | 18 | Distal ventricular cross-section beyond mid-LV. | Midventricular ring reused; source apex not followed. |
| tgrvbasal | 19 | Right ventricular base/TV region from gastric approach. | LV-only ring mistaken for RV basal anatomy. |
| tgrvinout | 20 | RV inflow and outflow/pulmonary route from gastric origin. | Contained pose chosen at expense of the intended RV section. |
| deeptg5c | 21 | Deep gastric LV-outflow route with apex/AV target coverage. | Near-field head outside stomach, outflow missed, or apex-only section. |
| tg2c | 22 | Long LV/MV route from inferior source direction. | Oblique ring or missed LV cavity. |
| tgrvin | 23 | Long RV–TV region from gastric direction. | LV route reused as RV. |
| tglax | 24 | LV and aortic outflow longitudinally from gastric direction. | Nominal multiplane angle without AV intersection. |
| daosax | 25 | Descending thoracic aorta cross-section only if acquired. | Usually outside isolated-heart coverage; no invented CT cap. |
| daolax | 26 | Descending thoracic aorta long axis only if acquired. | Same coverage restriction; synthetic context is not source vessel. |
| uearchlax | 27 | Upper-esophageal arch longitudinal target if source exists. | Excised arch/branches and clinical acoustic blind spots cannot be reconstructed as evidence. |
| uearchsax | 28 | Upper arch transverse target, with adjacent pulmonary structure only if acquired. | Absent arch/PV segment; no fabricated CT section. |

## Review records to retain

For each donor and preset retain its source hashes, physical scale, accepted plane, acquisition pose, donor calibration/target evidence, raw source reformat, both camera renders, numerical handoff results and a written visual disposition. Derive source-spacing labels from each donor manifest rather than hard-coding LADAF's 317.6 µm. The original five rejected default TEE poses were S-20-28 `me5c`, `me4c`, `merpv`, and S-20-29 `me5c`, `me4c`; these require explicit follow-up, not omission from the denominator.
