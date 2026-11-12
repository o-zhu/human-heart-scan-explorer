# Heart Explorer Reference Views: anatomy and illustration guidelines

## Scope and evidence

Create original flat, labelled illustrations for every existing TTE and TEE catalogue entry. Reference images are for anatomical grounding and internal QC; retain attribution in provenance and do not substitute copied guideline figures for new website artwork.

Primary acquisition authorities:

1. Mitchell C et al. *Guidelines for Performing a Comprehensive Transthoracic Echocardiographic Examination in Adults*. JASE 2019;32:1–64. Table 2 supplies anatomical and ultrasound views; the acquisition discussion on pp. 23–30 supplies orientation and landmark checks. https://www.asecho.org/wp-content/uploads/2019/01/2019_Comprehensive-TTE.pdf
2. Hahn RT et al. *Guidelines for Performing a Comprehensive Transesophageal Echocardiographic Examination*. JASE 2013;26:921–964. Table 10 supplies 28 canonical views; Figures 2–4 distinguish screen orientation and biplane reversal. https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf
3. Reeves ST et al. *Basic Perioperative Transesophageal Echocardiography Examination*. JASE 2013;26:443–456. Figure 1 defines 11 basic views; Figures 3 and 5–14 give labelled ultrasound examples. https://www.asecho.org/wp-content/uploads/2013/05/Basic-Perioperative-TEE-Exam.pdf

The site's TTE source URL under `/2025/07/` is a rehost location, not evidence of a 2025 acquisition guideline. Cite the document's publication year (2019). ASE also published a 2025 reporting guideline, which is a different document.

## Fixed visual system

These are project design decisions, not society recommendations:

- Square master image. Flat pale warm background (#F6F3EE), muted terracotta myocardium (#B77570), warm ivory blood cavities, dark brown/charcoal boundaries and labels. A thin neutral-gray sector envelope. Flat opaque fills with no texture, gradient, photorealism or lighting.
- Make the diagnostic anatomy fill most of the sector while maintaining its correct near-field/far-field position. Leave breathing room around the outline. Do not enlarge an atrium or chamber merely to fit a label; choose fewer labels or put a short leader outside.
- Use labelled lumen shapes as the main recognition cue. Keep 2–6 most diagnostic labels, usually LV, RV, LA, RA, Ao, LVOT, RVOT, IVC/SVC, LAA or a valve abbreviation. Label only anatomy actually present in that imaging plane.
- At a 180–240-pixel card, primary labels should remain roughly 13–18 CSS pixels in perceived size. Use a consistent bold sans serif. Place letters inside the intended cavity with visible clearance from walls; short leaders are acceptable for tiny valves.
- Keep atrial walls and great-vessel walls thin. LV myocardium is moderately thick, the RV free wall thinner. Avoid giving all cavities identical muscular rims or showing atrial/ventricular septa as equally thick.
- Preserve natural asymmetry and chamber proportions. The RV is crescentic or triangular where appropriate, not a second LV. Do not draw cartoon bulging atria, symmetric paired ventricles, extra chambers, accidental septal holes or concentric rings without anatomical meaning.
- Draw valve leaflets as a few restrained thin strokes. Show papillary muscles only when they identify the plane (e.g. PSAX/TG midpapillary). Avoid decorative trabeculae, chordal tangles, coronary markings and tiny valve scallop labels on navigation icons.
- Put the view title, TTE/TEE category, basic/advanced status, ASE number and angle range in ordinary UI text outside the image. Do not duplicate them as tiny rasterized image text. No ribs, probe, external heart perspective, ultrasound speckle, Doppler overlay, ECG trace, watermark, legend or title in the generated image.
- The pilot sets only the palette/line language. It must never supply the geometry for a different plane. Its atrial walls are too thick and should be corrected throughout the production set.

## Screen orientation and anatomy gates

- Every output must retain the orientation of the exact official per-view reference. Do not mirror, invert, rotate or substitute a nearby plane to make the set look uniform.
- At a standard TEE multiplane angle of 0 degrees, patient right appears on display left. Near field is at the sector vertex. At 90 degrees, the left display is inferior; at 180 degrees the transverse view reverses. Secondary biplane images can be reversed relative to a primary standard image, so use the primary Table 10 view.
- TTE apical four-chamber: LV/RV apex toward the top, atria at the bottom, right heart on display left. TEE ME four-chamber: atria near the top, ventricles extending downward, right heart on display left. They are not interchangeable vertical silhouettes.
- Standard TTE PLAX: LV elongated toward display left, aortic root/LVOT to the right, LA posterior to the aorta and RV/RVOT in the near field. The supplied black/white inspiration panel C labels the near-field structure RA; do not copy this. Use RV/RVOT. The true LV apex generally should not be shown in a standard PLAX image.
- Four-chamber views exclude the LVOT/AV; five-chamber views include them. The fifth chamber is an outflow tract, not an extra atrium or ventricle.
- Apical two-chamber: LV + LA + MV, not RV or aortic outflow. Apical three-chamber adds LVOT/AV/Ao rather than a right atrium.
- PSAX and TG SAX: LV is round with RV crescent when visible; basal/MV level shows the valve opening, midpapillary shows two papillary muscles, apical level lacks the MV and large papillary muscles. Never reuse one circular LV drawing unchanged for all levels.
- ME bicaval: LA near field, RA farther field, IVC on display left and SVC on display right in the conventional 90–110-degree view. Both veins join RA; neither joins LA.
- ME RV inflow/outflow: RA/TV/RV on display left and RVOT/PV/PA toward display right; the central aortic root is cross-sectional. Do not mistakenly label the RVOT as LV.
- Great-vessel SAX/LAX icons need to distinguish a lumen in cross-section from a longitudinal tube. The UE arch's LAX and SAX orientation differs from the descending aorta's approximate 0-degree SAX/90-degree LAX; never infer the view merely from the angle.
- Pulmonary-vein views must show veins joining LA; caval views show systemic veins joining RA. LAA is an appendage communicating with LA, separated from the left upper pulmonary vein by the ridge, not a new chamber or tube through the ventricle.

## Generation input contract

For each individual asset, supply: (1) the official anatomy/diagram crop of that exact view, (2) the corresponding real ultrasound crop, preferably the higher-resolution labelled basic-TEE example when available, and (3) the approved style pilot. Inspect all input images before use. The first two determine geometry; the third determines only palette, line weight, typography and simplification.

One built-in image generation call per distinct requested asset. Prompt with exact view name and ASE/table identifier, mandatory structures, screen orientation, forbidden absent structures, and exact label strings. Generate a new original composition, not a verbatim replica of a published figure. Save the final prompt, source URLs, reference paths, generated result path and QC status per asset. Do not use unrelated CT slices as references simply because their texture is realistic; a CT reference is useful only if the slice plane and orientation are demonstrably registered to this exact echo plane.

## QC acceptance criteria

1. **Identity:** correct view ID, plane, depth and imaging window; recognizable versus neighboring catalogue entries.
2. **Topology:** every displayed chamber connects only through anatomically appropriate valves/vessels; intact septa; no duplicate or invented structures.
3. **Orientation:** near/far field and screen-left/right match the specific reference. Check four-chamber TTE versus TEE, bicaval, short axis and biplane traps explicitly.
4. **Labels:** exact spelling, correct target, no unsupported chamber, no overlap or tiny illegible text. Omit uncertain secondary detail instead of inventing it.
5. **Proportions:** thin atria/vessels, moderate LV wall, thin RV wall; no hypertrophy implied by over-heavy outlines.
6. **Style:** flat fills, coherent colors/lines/sector, no 3D, ornament or anatomy hidden by typography.
7. **Thumbnail:** inspect at actual grid size (about 180–240px) and at full size. Anatomy and major labels must remain clear without zooming. Small image QC should use the deployed responsive card size.
8. **Integration:** all view IDs resolve to their own new icon; no missing asset, wrong mapping, blank panel or stale pre-revamp icon.

Reject and regenerate any output with wrong structure, orientation, spelling or connectivity. Cosmetic differences alone should not trigger endless regeneration once the set meets the criteria. Generated schematics are educational reference illustrations, not a claimed independent clinical validation.

## Basic/advanced navigation

Preserve every existing advanced catalogue entry. Advanced is the default on a fresh Reference Views entry. Each grid card opens that exact existing detailed interface. Provide a clear All views/back control, and preserve selected modality and filter when returning.

The ASE/SCA basic perioperative TEE list is: ME four-chamber; ME two-chamber; ME LAX; ME ascending-aortic LAX; ME ascending-aortic SAX; ME AV SAX; ME RV inflow/outflow; ME bicaval; TG midpapillary SAX; descending-aortic SAX; descending-aortic LAX. These map to comprehensive Table 10 view numbers 2, 4, 5, 7, 8, 10, 11, 13, 17, 25, 26.

Any TTE Basic subset is a project navigation choice, not a separately asserted ASE basic-exam standard. Existing site subsets can be retained if sensible. Clearly label views with their readable names; do not require users to recognize the icon alone.

## Available local source material

`reference-manifest.json` enumerates 29 TTE rows (including separate 2.17b RVOT) and all 28 TEE views. Each entry has anatomy and ultrasound paths. Most TTE anatomy images already have labels. For the 11 basic TEE views, `basic_diagram` provides a clearer black/white schematic and `labelled_echo` a higher-resolution labelled ultrasound reference. These higher-resolution items are preferable to the small Table 10 thumbnail for label placement, while Table 10 remains the exact comprehensive-view identity.
