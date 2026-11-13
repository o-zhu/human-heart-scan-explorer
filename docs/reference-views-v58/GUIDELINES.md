# Anatomical and visual acceptance criteria

> **Targeted follow-up:** the v58 PLAX mitral (`tte:plax_mv`) pass was superseded after residual atrial-wall and outflow ambiguity was identified. See [revision 59](../reference-views-v59/README.md). The v58 manifest and pixels remain historical evidence; the other 55 entries are unchanged by this follow-up.


## 1. Evidence and scope

The purpose is a reliable **view-recognition reference**. Every image must be
compared with the exact intended echocardiographic section, not merely with a
generic drawing of a heart. Use the named view's anatomical figure and real
ultrasound example together. An adjacent plane, an unregistered CT slice or a
search result with a similar title cannot establish the intended geometry.

Primary references:

- Mitchell et al., *Guidelines for Performing a Comprehensive Transthoracic
  Echocardiographic Examination in Adults*, JASE 2019, Table 2 and acquisition
  sections. [ASE PDF](https://www.asecho.org/wp-content/uploads/2025/07/Guidelines-for-Performing-a-Comprehensive-Transthoracic-Echocardiographic-Examination-in-Adults.pdf).
  The copy hosted in a `/2025/07/` directory is the same acquisition guideline;
  that URL does not change the publication year.
- Hahn et al., *Guidelines for Performing a Comprehensive Transesophageal
  Echocardiographic Examination*, ASE/SCA 2013, Table 10 and Figures 2–4.
  [ASE PDF](https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf).
- University of Toronto's [Virtual TTE](https://pie.med.utoronto.ca/tte/TTE_content/standardviews.html)
  provides an additional plane/echo comparison resource.
- [University of Utah Basic TEE Exam](https://echo.anesthesia.med.utah.edu/wp-content/uploads/2020/05/Utah-Basic-TEE-Exam-1.pdf)
  provides an independent check of major view landmarks and common acquisition
  pitfalls.

Use reference figures for inspection and generation guidance only. Do not copy
them into distributable artwork or infer redistribution rights from online
availability. Preserve specific source URLs and figure/table identities with
each review and generation record. Any CT reference must have an established
plane and orientation before it is used as anatomical evidence.

## 2. Hard rejection criteria

The following are project production criteria, not a validated clinical score.
Any one unresolved failure prevents acceptance, regardless of aesthetic quality.

1. **False connection:** a chamber or vessel joins the wrong structure, or a
   blood pool is disconnected where the depicted section should show continuity.
2. **False barrier:** thick myocardium crosses a normal valve orifice, outflow
   tract, venous ostium or appendage neck.
3. **False valve apparatus:** missing or misplaced hinges, an extra valve,
   unsupported duplicate leaflets, a floating flap, or chordae attached to an
   atrial wall.
4. **Wrong section:** the view's defining level or landmark is absent, or the
   drawing is effectively a different named plane.
5. **Wrong orientation:** near/far field or display laterality conflicts with
   the selected primary-plane reference.
6. **Wrong annotation:** a label is misspelled, names the wrong blood pool or
   points to an ambiguous/wrong boundary.
7. **Unintended pathology:** a septal hole, obstructing tissue, extreme wall
   thickening, dissection flap, mass or effusion appears in a normal reference.
8. **Obscured evidence:** a label, border, crop or fill conceals the anatomy
   needed to recognize or understand the view.

Record the actual defect rather than writing only “anatomically inaccurate.”
Describe its location, the incorrect relationship it teaches and the change
needed. A changed image must be reviewed anew; visual improvement over an earlier
failure is not sufficient for acceptance.

## 3. Topology before appearance

First trace the structures relevant to the plane without relying on labels:

| Structure being depicted | Continuity or separation to inspect |
| --- | --- |
| Mitral inflow | LA → mitral annulus/leaflets → LV |
| Aortic outflow | LV → LVOT → AV → aorta |
| Tricuspid inflow | RA → tricuspid annulus/leaflets → RV |
| Pulmonic outflow | RV → RVOT → PV → pulmonary artery |
| Pulmonary vein | Venous ostium opens into LA |
| Caval vein | Caval lumen opens into RA |
| Left atrial appendage | Appendage neck opens into LA |
| Septa | Separate the corresponding blood pools without invented gaps |

Only demand a connection when the selected section actually intersects it.
A circular vessel in short axis is legitimately enclosed by its wall; do not
open it into an adjacent chamber because its longitudinal connection exists
elsewhere. Conversely, do not draw a closed atrial bag behind an apparently
open mitral valve in a long-axis inflow section.

The reported PLAX mitral problem illustrates the distinction: a thick LA wall
continued across the atrioventricular junction while two leaflets sat entirely
on its LV side. Correct geometry places the annular opening in that boundary,
with two thin leaflets attached to its opposing edges. In diastole, their free
tips separate and leave a visible LA–LV inflow aperture. The anterior leaflet
maintains the appropriate fibrous relationship to the aortic root; the
posterior leaflet attaches at the basal posterior/inferolateral LV side.

## 4. Phase and tissue hierarchy

Record the chosen schematic phase. Closed atrioventricular valves are
appropriate in systole; an open valve is not intrinsically more accurate.
Closure must be drawn as thin leaflets meeting, not as a muscular partition.
An open mitral valve requires a clear gap between the free leaflet edges.
Depicted semilunar valves should be consistent with the chosen phase.

For vascular-only or wall-only sections, record that phase is not diagnostic
for the schematic. Never invent leaflet anatomy in a section that does not
include a valve. Distinguish real tissue boundaries from the sector outline.

The LV wall is thicker than the RV free wall, while atrial and vessel walls
remain comparatively thin. Do not give every lumen an identical thick rim.
Papillary muscles belong within the LV blood pool at the appropriate level;
their profiles are not additional chambers, an internal septum or masses.
Simplification is acceptable only when it preserves the anatomical relationship
being taught.

## 5. View-specific checks

### TTE

| Family | Mandatory distinction |
| --- | --- |
| Standard/deep PLAX | Elongated LV to display left, RV/RVOT near field, aortic root to the right, LA posterior to the root; deep view has additional far-field space. Do not imply the true LV apex is always intersected. |
| PLAX mitral focus | LA–MV–LV junction is the actual opening; thin leaflets hinge at the annulus; retain correct aorto-mitral relationship. |
| PLAX aortic focus | LVOT and aorta are one outflow path through AV; the aorta does not arise from LA. |
| RV inflow/outflow | TV connects RA/RV; PV connects RVOT/PA. Do not use the LV cavity as a substitute for RVOT. |
| Great-vessel/AV PSAX | Correct valve-root level and adjacent right-heart relationships; correct cusp count/orientation if labeled. |
| Mitral PSAX | Valve opening lies within the basal LV cross-section; do not add an LA-shaped separate chamber at that level. |
| Papillary PSAX | Two papillary profiles in a roughly round LV, crescentic RV when present; no copied mitral valve opening. |
| Apical PSAX | Distinct apical level without copied basal valve or prominent midpapillary anatomy. |
| Apical four-chamber | Apex near field, right heart display left, atria far field; separate AV junctions and appropriate septa; exclude AV/LVOT. |
| LV/RV focused apical | Framing and chamber emphasis must visibly correspond to the named focus, without foreshortening or changing the defining plane. |
| Apical five-chamber | LVOT is a continuation of LV; “fifth chamber” is not a new independent blood pool. |
| Apical two-chamber | LA, MV and LV; no principal RV or aortic-root compartment. |
| Apical three-chamber | Add contiguous LVOT–AV–Ao to the left-heart inflow/outflow plane. |
| Coronary-sinus/PV variants | Identify the specific venous structure by its real relationship, not by adding an arbitrary tube and label. |
| Subcostal four-chamber | Oblique/horizontal section through the liver acoustic window, with correct chamber relationships; not a rotated apical icon. |
| Subcostal IVC/hepatic | IVC joins RA; hepatic veins join IVC at the appropriate section. Do not create false walls across their openings. |
| Suprasternal arch | Continuous ascending/transverse/descending aortic pathway and correctly placed branches; avoid capped or disconnected branch stubs. |

### TEE

| Family | Mandatory distinction |
| --- | --- |
| ME four-chamber | Atria near field, ventricles far field, right heart display left in the conventional near-transverse primary plane; exclude aortic outflow. |
| ME five-chamber | Add a real LV outflow path rather than a fifth isolated chamber. |
| ME commissural | Correct commissural section; several leaflet-region intersections do not mean three independent mitral leaflets. If scallops are labeled, verify the conventional P3–A2–P1 display order in that exact plane. |
| ME two-chamber | Distinct LA/MV/LV plane; do not reuse ME long-axis with an aortic root. |
| ME LAX/AV LAX | Trace LA–MV–LV separately from LV–LVOT–AV–Ao; no thick false partitions or atrial aortic origin. |
| ME AV SAX | Correct aortic valve and neighboring structures; cusp labels require plane-specific verification. |
| ME RV inflow–outflow | RA–TV–RV and RV–RVOT–PV–PA communicate through the same RV; central aortic root remains separate. |
| Modified bicaval | Match the modified right atrial/tricuspid section rather than relabeling an ordinary bicaval illustration. |
| Bicaval | Veins join RA, IAS separates LA/RA. Verify any IVC label independently; a coronary sinus cross-section may be mistaken for IVC, and the IVC is not always in-plane. |
| Pulmonary veins/LAA | Correct LA communication and neck/ostium; no sealed venous bags, wrong atrial drainage or invented thrombus-like tissue. |
| TG basal/midpapillary/apical SAX | Three distinct levels; basal valve, two midpapillary profiles, and apical cavity cannot use the same geometry with changed labels. |
| TG RV variants | Correct RV inflow/outflow relationships and transgastric section; TV/PV labels must identify actual valves. |
| TG 2C/LAX | Correct transgastric near-field wall and chamber/outflow relationships; not simply a rotated ME icon. |
| Deep TG | Characteristic apical perspective and LVOT/AV alignment; remains distinguishable from ordinary TG LAX. |
| Descending aortic SAX/LAX | Cross-section versus long lumen; no invented internal flap or valve. |
| UE arch SAX/LAX | Match the arch plane and PA/PV context where present; do not infer the view solely from angle or substitute descending-aorta geometry. |

TEE multiplane angle belongs in the existing UI metadata. It does not prove
view identity, and it should not be added as a generated raster dial. Preserve
the primary-plane orientation rather than accidentally following a reversed
secondary biplane image.

## 6. Label, crop and thumbnail inspection

Inspect the actual exported 960px image and 384px thumbnail, then inspect the
image at its approximately 180–240 CSS-pixel gallery size. The review must not
end at a large contact sheet or the generated master alone.

- Place short bold chamber labels within their own blood pools with visible
  clearance from tissue and valves. Use a short leader when a small structure
  cannot accommodate text.
- A leader must end on the intended valve/structure, and remain unambiguous
  after downsampling. A pointer into LVOT cannot label MV.
- Keep valve hinges, orifices, septa and narrow vessel necks visible. A label
  cannot serve as a substitute for drawing the anatomy beneath it.
- Check exact abbreviations and spelling individually; generated text has no
  presumption of correctness.
- Retain a thin neutral sector boundary. Its vertex is the near field, and its
  edges are not anatomical walls. Preserve anatomy at intentional crops.
- Use the established warm ivory background, muted terracotta myocardium,
  thin dark contour and bold dark labels. Avoid 3D shading, texture, gradients,
  exaggerated chamber bulges and decorative details.
- Use fewer labels if necessary. Do not distort chamber size or add an
  out-of-plane structure to make room for text.

## 7. Replacement prompt and final review

Each replacement prompt identifies the exact view/table row; reference inputs
and their roles; screen orientation; mandatory and intentionally absent
structures; the required lumen/valve relationships; chosen phase; exact label
strings; the previous defect; and explicit prohibitions against that defect.
The style input controls appearance only. Anatomical reference inputs control
the section and its relationships.

Generate one asset per call. Inspect the resulting pixels without assuming the
prompt was followed. When a correction introduces a new fault, reject it and
record the next targeted change. Keep the exact final prompt and selected master
hash. Package only the selected reviewed candidate, without anatomical
postprocessing. Published figures remain internal reference material.

A separate review checks the final candidate's major anatomical gates and
thumbnail readability. Document what was inspected and any remaining
simplification. Every accepted view must have explicit `retain` or `replace`
status and passing checks; no missing record, generic historical approval or
overall average score can make an unreviewed view pass.

## 8. Specific correction briefs for this revision

These briefs describe the defects observed in this project's previous artwork.
They are not diagnoses of a patient or critiques of the published ASE figures.
The exact successful generation prompts and preceding attempts are preserved
with each replacement in `asset-manifest.json`.

### TTE PLAX mitral focus — ASE Table 2, row 2.4

Place the actual mitral annulus between LA on display right and LV on display
left. Remove the continuous terracotta wall that sealed the atrial side of the
junction. Attach two thin leaflets to the opposing annular edges; in the chosen
diastolic schematic, separate their free tips to leave a broad, unambiguous
inflow aperture. Preserve the aorto-mitral relationship and a smooth LVOT border.
Do not leave both leaflets floating wholly within LV, make the valve a hole in
unrelated tissue, or add a septal hook. The first revision reopened the atrium
but retained a pointed septal spur; that draft was rejected and the spur removed.

### TTE PSAX at aortic valve level — ASE Table 2, row 2.8

Preserve the central aortic root, posterior LA, right atrial cavity, anterior
RV/RVOT and pulmonary outlet in their source-plane relationships. At the
RA–RV junction, replace the muscular bridge with a real tricuspid opening and
two thin opposing hinged leaflet profiles. Keep the interatrial septum intact.
Draw the pulmonary valve distinctly at the RVOT–PA junction. The selected
diastolic schematic has an open TV and closed AV/PV; do not open every valve
merely to demonstrate connections. The first draft's crowded TV hinge geometry
was revised before acceptance.

### TTE RV-focused apical four-chamber — ASE Table 2, row 2.16

Frame the complete RV cavity, free wall and apex clearly, preserving a smaller
asymmetric RV beside a thicker-walled LV. The LV must continue to form the
cardiac apex in this normal illustrative example. Maintain appropriate apical
offset of the tricuspid insertion, separate atrial/ventricular blood pools and
intact septa; omit LVOT and the coronary sinus from this focused section.
Use the [ASE 2025 right-heart guideline, Figure 2](https://www.asecho.org/wp-content/uploads/2026/08/ASE-Right-Heart-Guidelines-May-2025.pdf)
as a supplementary framing reference. This is a clarity improvement, not a
diagnosis that the previous icon's dimensions were abnormal. The first new
draft made the RV excessively large and apex-forming and was rejected.
Any percentage in a generation prompt is a composition instruction only, not
a clinical normal range or measurement threshold.

### TTE LA/pulmonary-vein focus — ASE Table 2, row 2.23

Keep the atria prominent in the far field of the apical section and the
ventricular apices intentionally cropped by the atrial-focused framing. Show
paired venous ostia entering the posterior/far-field LA without a dark line,
membrane or valve across either mouth. The intervening venous/atrial wall must
not become a partition across LA. Label the venous structures `PVs` with an
unambiguous leader into the venous lumen, avoiding confusion with a pulmonary
valve. The accepted static schematic has coapting MV/TV leaflets; these thin
closures are intentional and do not need to be opened.

### TEE midesophageal long axis — ASE Table 10, view 5

Preserve the near-field LA, MV, LV and oblique LVOT–AV–Ao plane. Remove the
triangular myocardial tongue projecting into the LVOT. Maintain a continuous,
unobstructed outflow lumen with smooth septal and aorto-mitral boundaries,
while retaining the intended systolic MV closure and open AV. Do not confuse
the thin anterior mitral leaflet with the erroneous thick myocardial spur.

### TEE midesophageal aortic valve long axis — ASE Table 10, view 6

Extend the LVOT lumen through the lower-left sector crop, through the AV and
into one continuous aortic lumen. Replace the closed myocardial pocket, retain
two thin long-axis cusp profiles, and move `AV` outside the narrow valve region
with a short accurate leader. Do not create a second aortic tube or a thick
parallel wall that divides the aorta: that fault appeared in the first new
draft and it was rejected. LA remains a separate near-field chamber; the aorta
must not originate from it.

### TEE transgastric RV inflow–outflow — ASE Table 10, view 20

Preserve the source plane's shared RV/RVOT cavity, RA–TV junction and distinct
TV/PV labels. Beyond the thin pulmonary valve, show
a short recognizable PA lumen continuing beyond the sector edge. Replace the
ambiguous solid red cap without inventing a long vessel course, branch network
or out-of-plane connection. The selected diastolic schematic has a closed PV
and partly open TV. This is a clarity correction; a closed thin PV is not the
error and is not made open merely to suggest flow.

## 9. Avoiding false-positive corrections

- The posterior coronary-sinus apical section may show a muscular LV base
  because the mitral valve is outside the plane. Do not insert an MV opening.
- An anteriorly angled five-chamber source frame need not contain a separately
  recognizable RA. The named view is established by its plane and LVOT, not a
  literal count of five independent chambers.
- Bounded pulmonary-vein, aortic and arch profiles may be valid cross-sections
  or structures leaving the plane. Compare the exact primary figure and echo
  before alleging a blind end.
- A valid two-dimensional section cannot explain every three-dimensional
  connection. Add supplemental source views or a registered multiplanar
  reconstruction when a connection must be taught; do not distort the current
  illustration to force it into the plane.

These decisions and each retained view's simplifications are part of the
individual audit. Passing this production review means that no unresolved
failure was identified under these checks. It does not constitute an
independent clinical validation or a guarantee of diagnostic fidelity.
