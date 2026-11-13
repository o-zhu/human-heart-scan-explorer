# Reference illustration QC: walls, connections and valves — v60

## Scope and purpose

This standard applies independently to every one of the 28 TTE and 28 TEE reference illustrations. It replaces the assumption that a visually consistent collection is anatomically consistent. A previous acceptance record is historical evidence, not a new pass. The v60 review starts with the actual v59 active asset mapping, including older retained artwork, and records a fresh disposition for each image.

The illustrations are simplified, original teaching schematics. They must faithfully identify the acquisition plane and important relationships. They are not quantitative anatomy, patient images, measured CT registrations, or validation of valve motion. AI-assisted source comparison does not constitute independent clinician certification. These limits do not excuse a wrong connection, an absent wall, an unattached leaflet or a misdirected label.

## 1. Evidence hierarchy and source identity

Use the exact acquisition drawing and corresponding ultrasound frame, not a generic heart diagram or another view with a similar name.

| Primary reference | Required use |
| --- | --- |
| Mitchell et al., [ASE comprehensive TTE, 2019](https://www.asecho.org/wp-content/uploads/2025/04/2019_Comprehensive-TTE.pdf), Table 2 | Exact TTE window, section, image orientation and visible landmarks. Retain the source row number, including zoom and angulation variants. |
| Hahn et al., [ASE/SCA comprehensive TEE, 2013](https://www.asecho.org/wp-content/uploads/2025/04/2013_Performing-Comprehensive-TEE.pdf), Table 10 and accompanying acquisition text | Exact one of 28 TEE views, screen orientation, structures and section type. Read the corresponding text when a small thumbnail compresses a valve or outlet. |
| Robinson et al., [BSE mitral valve assessment, 2021](https://link.springer.com/content/pdf/10.1530/ERP-20-0034.pdf), anatomy and acquisition tables | Supplementary mitral attachment and leaflet interpretation. Do not transfer a different view's screen orientation. |
| Zaidi et al., [BSE tricuspid and pulmonary valve assessment, 2021](https://link.springer.com/content/pdf/10.1530/ERP-20-0033.pdf), anatomy and view tables | Supplementary right-heart valve anatomy, section interpretation and relationship of RVOT, PV and PA. |

The publication year comes from the paper, not a rehosting URL. Record the original citation even if an unchanged PDF was recovered from an institutional mirror. Record the local reference-file hash and exact figure/page used. Published source figures remain internal review inputs; do not put them into the public artwork directory or delta payload.

A source schematic may intentionally use one line for a wall or a compressed valve symbol. The project's higher-detail visual contract can require a clearer original rendition without claiming that the source is anatomically erroneous. A source used for anatomy does not automatically establish the intended cardiac phase of every stylized leaflet.

## 2. Boundary inventory: classify before drawing

For every visible chamber and vessel, trace its entire perimeter. List each part as muscular tissue, vessel wall, fibrous tissue, leaflet, chordal structure, or an intentional crop/continuation. “The outline looks continuous” is insufficient.

| Boundary class | Required depiction | Reject when |
| --- | --- | --- |
| LV myocardium and interventricular septum | Filled terracotta tissue between visible inner and outer interfaces, with appropriate local taper | A large myocardial wall is only an outline; an internal stripe divides the cavity; the septum has an unintended gap |
| RV free wall | A finite filled ribbon, usually visibly thinner than LV myocardium in comparable sections | The RV becomes a second thick-walled LV or its free wall disappears into one contour |
| LA and RA free walls | A continuous thin filled tissue ribbon along every in-plane free-wall segment, connected appropriately at annular regions | An ivory ribbon between brown outlines, an isolated line, a lost roof/floor, or use of the gray sector as atrial tissue |
| Interatrial boundary | A thin tissue interface consistent with the section; preserve legitimate thin septal regions | A broad ventricular-thickness muscle slab, absent septum, or false opening between atria |
| Arterial and venous walls | Finite thin wall bands around in-plane vessel segments; retain open luminal continuation at crop edges | Single-line vessel side walls in an otherwise filled-wall style, blind arterial caps, or veins attached to the wrong atrium |
| Fibrous curtain, annulus and valve leaflet | Appropriately thin tissue or paired contours; distinct fixed attachments and free edges where seen | Indiscriminate muscular thickening, a leaflet becoming a chamber wall, or a thick seal across an orifice |
| Chordae and papillary structures | Only when relevant to the plane, with plausible endpoints and origin | Decorative floating strands, tendons crossing unrelated lumens, or a chord ending in empty space |
| Intentional crop | Tissue and lumen reach the actual image/sector crop coherently, or the field limit is made explicit | Wall endpoints stop inside the sector and spill into the background without a defined continuation |

Thin does not mean absent. A colored band must remain perceptible in the actual exported thumbnail; a double outline filled with the same ivory as the lumen does not satisfy the muscular-wall requirement. Conversely, a true fibrous boundary should not be converted into myocardium merely to make it thicker.

Wall thickness is a schematic hierarchy, not a measurement. A roughly 1–3 pixel colored atrial band at a 200 pixel display can be a useful readability target, but it must not imply hypertrophy or distort the chamber. Judge the actual result, not only a numerical stroke width.

## 3. Connection and cavity tracing

Trace each lumen from its named chamber to the next appropriate orifice. Record both its anatomical connection and the instantaneous valve state. An anatomically connected chamber can have a closed valve; a closed valve is not a license to draw a thick myocardial partition.

- LA joins LV through MV; RA joins RV through TV. The two valves need identifiable annular regions. Restoring an atrial wall must not seal the atrioventricular opening.
- LVOT is continuous with LV and leads to AV and aortic root. It is not another chamber, an isolated tube, or a pouch. The basal septum and anterior mitral/fibrous region must form its correct boundaries.
- RVOT is continuous with RV and leads through PV to PA. A pulmonary valve at the end of a drawing must not look like the end of a blind ventricular sac. Show enough distal arterial context, or a clear source-appropriate continuation, to establish which side is PA.
- Pulmonary veins connect to LA. Systemic veins connect to RA. Do not treat a neighboring vessel in cross-section as another chamber, or merge it into the wrong lumen.
- Keep aorta and LA separated. Preserve the thin aortomitral relationship without a false Ao–LA passage or a leaflet fused directly into an aortic cusp.
- In vascular views, check branch topology as well as wall continuity. A vessel cut in cross-section is a finite ring; a longitudinal tube has two sides and an intentional continuation.

The review must explicitly distinguish an open path, a thin leaflet closure and an incorrect solid-tissue seal. Hash validation and successful loading cannot answer this question.

## 4. Valve phase and curvature

### Define the local direction first

Mark ventricular upstream and arterial downstream for every semilunar valve. These directions vary on the display between TTE, ME, TG and arch views. There is no global rule that cusps point up, down, left or right. Do not repair curvature by rotating an M-shaped or W-shaped symbol.

For a closed semilunar valve, interpret its pocket and coaptation relative to the arterial side. For an open semilunar valve in ejection, show thin attached cusp profiles displaced toward the arterial walls with a clear central outlet; the free edges extend downstream. Avoid a paired atrioventricular-looking tent across the outflow.

Choose a readily interpretable normal phase for a repair. Where multiple left- or right-heart valves are shown, an explicit ejection frame can show AV/PV open and MV/TV closed. A filling frame can show MV/TV open and AV/PV closed. Both valves being closed can occur during isovolumic periods, but an unspecified isovolumic explanation cannot rescue an otherwise ambiguous drawing. Do not assert that every source thumbnail depicts a synchronized physiologic frame.

### Attachments and section type

Every leaflet profile needs a plausible fixed attachment. Its free tip must be recognizable and must not become an arbitrary intracavitary stroke. A closed valve is thin, with interpretable coaptation; an open valve leaves a readable orifice. Avoid false prolapse, excessive tenting, duplicated leaflets or apparent stenosis introduced by drawing convenience.

Inspect the actual distal end of each opened cusp. A clear central channel does not rescue a cusp drawn as a lens that reattaches to the arterial wall at both ends. Its downstream free tip needs visible blood-space clearance from the continuing wall at full size. When creating that clearance, do not erase the wall behind it. A closed leaflet outline can represent the finite leaflet itself; a second wall attachment cannot represent a free edge. For closed cusps, identify both hinges, the leaflet bellies and the coaptation relationship in the local vessel axis; do not infer normal geometry merely from a two-loop silhouette.

A long-axis section may show two semilunar cusp profiles without implying a bicuspid valve. A short-axis valve must communicate its actual section and opening/coaptation. Do not use a generic circular three-spoke symbol as a substitute for a clearly different atrioventricular valve plane. Where TV is seen in short axis, retain its annular context and natural asymmetry; do not claim that equal sectors establish leaflet identity.

When an important leaflet identity cannot be resolved from the section and references, use a valve-level label rather than inventing a leaflet name. MV/TV chordae belong on the ventricular side and should not be added to semilunar valves.

Record limited-plane exceptions explicitly. The short near-field aortic-root profile in ME five-chamber may leave the section, as in the exact acquisition reference; it must not be described as a full ascending tube ending blindly. A thin central atrial-septal/fossa interface in a modified bicaval section is distinct from an atrial free wall and has muscular rims. Do not use that local thin interface to claim that the entire interatrial septum is fibrous, or to excuse absent atrial free-wall tissue elsewhere.

## 5. View-specific hard checks

| View family | Required distinctions |
| --- | --- |
| Standard/deep PLAX and PLAX valve zooms | LV extends left; aortic outflow is right/anterior to LA; appropriate RV near-field context. A normal standard PLAX should not invent the true apical tip. In an MV zoom, trace both mitral hinges, the LA wall and LVOT separately. |
| PLAX RVOT | Remove the unsupported floating LV strokes. Label visible LV and LA. Replace any false muscular LV–LA bridge with the source-appropriate mitral junction. Keep RVOT–PV–PA continuity and enough PA wall context. |
| PSAX great-vessel and valve levels | Check central aortic relationship, RVOT/PA course and atrial neighbors. An AV short-axis symbol does not justify a wrong PV direction. Label a substantial visible LA or other teaching landmark. |
| TTE A4C and RV focus | Right heart display left, LV display right; atria below. All visible atrial free walls need filled bands. Preserve LV contribution to the apex and the intended RV-focused proportions. No inadvertent LVOT. |
| A5C and A3C | Establish LV–LVOT–AV–Ao direction before cusp review. A5C is an anteriorly tilted four-chamber family view, not a demand to invent a fifth cavity. A substantial RV sliver needs identification or source-supported simplification. |
| TTE A2C and LV zooms | Preserve the two-chamber identity and MV attachment. A cropped atrium can be acceptable if the crop is genuine; do not leave a free-wall segment as a line. |
| Posterior A4C/CS and LA/PV focus | Distinguish coronary sinus and pulmonary veins from the MV opening and adjacent walls. Do not leave anatomy floating at a rectangular erasure inside a sector. |
| ME four/five/two-chamber and LAX | Atria near field, ventricles extending away; do not reuse the TTE vertical arrangement. Audit every LA/RA free wall and each outflow/annular junction. |
| ME commissural | Preserve appropriate papillary groups and attached chordae. The PLAX RVOT stray-cord repair does not authorize deleting real subvalvular anatomy here. |
| ME RV inflow/outflow and AV SAX | Preserve RA–TV–RV and RVOT–PV–PA geometry around the aortic root. Distinguish the aortic cross-section from an AV-level cusp depiction. |
| ME bicaval and pulmonary-vein/LAA views | Check the destination of every vein, the LA/RA boundary, LAA neck and pulmonary-vein ridge. Label substantial adjacent vessel sections so they do not masquerade as unnamed chambers. |
| TG basal/papillary/apical SAX | Basal MV, two papillary groups and apical level remain distinct. RV crescent position and relative wall thickness follow the exact plane. |
| TG RV basal | In the source view, TV is short axis while RVOT is long axis. Clarify the TV annular plane and asymmetric leaflet pattern; establish the PA side beyond PV rather than ending in an unexplained cap. |
| TG RV inflow/outflow, deep TG5C and TG LAX | Check each local valve direction and common phase, finite atrial/arterial walls, and uninterrupted ventricular outflow up to the stated valve position. |
| TG2C and TG RV inflow | LA or RA must have an actual thin muscular ribbon around its visible perimeter. The existing long single-line atrial contours are explicit rejection examples. |
| Descending aorta and upper-esophageal arch | Differentiate SAX ring from LAX tube, preserve actual arch geometry and vessel continuity, and do not accept an internal erased gap as a crop. |
| Subcostal venous/hepatic views | Differentiate liver from vessel wall, show finite RA/IVC boundaries and preserve venous entry topology. Do not thicken hepatic veins into myocardium. |

## 6. Labels, style and scale

Retain the established warm ivory field and lumens, muted terracotta tissue, dark brown contours, gray sector and bold dark sans-serif labels. Geometry has priority over perfect stylistic uniformity. Do not add perspective shading, ultrasound noise, decorative fibers, gradients, titles or scanner annotations.

Name the principal visible chambers and teaching landmarks. A large unlabeled cavity fails if it could reasonably be mistaken for another chamber or if the label is necessary to understand the plane. Incidental, intentionally cropped tissue does not require a label merely because it occupies pixels. Use a short leader for small structures rather than enlarging the anatomy to fit text.

Leaders must terminate on the intended leaflet, lumen or structure and not cross a critical junction. Verify spelling, case and meaning; PV can denote pulmonary valve or pulmonary vein in different contexts, so surrounding anatomy and labels must disambiguate it. Keep angle ranges and view names in existing UI text; do not fabricate an angle icon or new rasterized title.

Review at the generated master size, actual 960px exported image, actual 384px thumbnail and a 200px rendering of that encoded thumbnail. Inspect the actual responsive gallery and enlarged live image after integration. At small size, principal labels, finite walls and open/closed junctions must remain recognizable; fine cusp detail is assessed enlarged.

## 7. Eight-domain grading with non-negotiable gates

Score every domain independently: **0 = failed or absent; 1 = ambiguous, unsupported or incomplete; 2 = clear and supported for this schematic's purpose**.

1. Exact view and orientation.
2. Chamber and vessel topology.
3. Wall and boundary depiction.
4. Valve geometry and phase.
5. Attachments and subvalvular anatomy.
6. Label accuracy and completeness.
7. Style, proportions and cropping.
8. Thumbnail readability.

For a view without valves, domain 4 receives 2 only with an explicit “not applicable: no valve in this section” explanation. The same rule applies to absent subvalvular anatomy; do not fabricate it to fill a rubric box.

**Release requires 2 in every applicable domain and no unresolved hard failure.** The total out of 16 is a review aid, not a clinical accuracy percentage. A 15/16 image with a missing wall does not pass. A correct-looking label cannot compensate for incorrect topology. A reviewer who cannot establish valve direction records uncertainty and withholds acceptance rather than selecting a favorable score.

Hard failures include: wrong plane or mirroring; wrong chamber connection; absent required tissue band; false muscle seal; unexplained lumen leak; reversed or indeterminate valve relationship; detached leaflet or unsupported cord; wrong or materially missing label; and loss of a critical feature at card size. A retained image needs a new recorded justification under this standard.

## 8. Repair prompt contract

Write one exact prompt per view, with these fields made concrete:

1. The existing local image is the edit target and style reference. Name the exact view, source row and source crops.
2. List observed defects in the target pixels; do not merely ask for “better anatomy.”
3. Specify the local orientation, visible cavities and required connections.
4. Specify each affected muscular, arterial, venous or fibrous boundary separately.
5. Define the phase and local ventricular/arterial sides of every visible valve.
6. Specify the required leaflet attachments, free edges and open/closed orifices.
7. List labels and their exact targets, including which existing labels must stay.
8. Preserve all correct geometry, palette, sector, proportions and framing unless a stated defect requires changing them.
9. Prohibit the actual recurring failures: ivory wall ribbons, solid atrioventricular bridges, blind outflow caps, decorative chordae, duplicated lumens, invented chambers and ambiguous section symbols.
10. State the output size and review criteria. Request no titles, UI frames, watermarks or copied source typography.

The prompt is a construction specification. It is never evidence that the resulting pixels complied. Record all rejected attempts and the specific defect that triggered another edit. Packaging performs uniform resizing and encoding only; an anatomical edit receives a new master, provenance and review.

## 9. Review, provenance and release

For each image, preserve the exact original asset/hash, fresh initial findings, boundary inventory, phase assessment, source locations, eight scores, disposition and reviewer evidence. For each replacement, also preserve exact prompts, reference hashes, generated master hash, rejected-attempt notes and accepted output hashes.

The generating reviewer inspects the result first. A second reviewer examines the actual candidate, including its affected junctions, without treating the generating prompt or old acceptance record as proof. Any disagreement is resolved against visible evidence and sources before integration.

Bind the accepted review to the exact exported bytes. After encoding, recheck all affected walls and valve connections, not only dimensions. Verify that all 56 runtime entries select the intended image and thumbnail and that no fallback can restore superseded artwork. Keep historical manifests and assets immutable for comparison and rollback.

The release report separates source comparison, visual inspection, file/registry validation, browser observation and deployment evidence. Do not claim an unseen device, an uninspected image, or independent clinical sign-off. Report remaining limitations explicitly without weakening the hard anatomical gates.
