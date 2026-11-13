/** Original acquisition summaries and factual ASE/SCA 2013 Table 10 reference data.
 * Named views are educational targets; donor correspondence is not validated. */
import {referenceArtworkPaths} from './reference-artwork-v61.js';

export const TEE_ATLAS_GROUPS=Object.freeze([{"id": "me", "name": "Midesophageal", "count": 15}, {"id": "tg", "name": "Transgastric", "count": 9}, {"id": "aortic", "name": "Aortic", "count": 4}]);
export const TEE_ATLAS_VIEWS=Object.freeze([
 {
  "id": "me5c",
  "aseNumber": 1,
  "group": "me",
  "mode": "tee",
  "code": "ME 5C",
  "name": "Midesophageal five-chamber",
  "shortName": "Five-chamber",
  "angleRange": [
   0,
   10
  ],
  "angleDefault": 10,
  "angles": "0–10°",
  "depthLabel": "ME · ≈30 cm",
  "depthEvidence": "The ASE acquisition text starts near 30 cm insertion depth. This adult clinical reference does not measure the probe position in the excised-heart scan.",
  "position": "Midesophageal, just above the four-chamber level",
  "maneuvers": [
   "Start near the aortic valve and LV outflow tract, with the electronic plane near 10°."
  ],
  "description": "Identify the LV outflow tract and aortic valve alongside the four chambers; the LV apex may be foreshortened.",
  "teachingPoint": "Identify the LV outflow tract and aortic valve alongside the four chambers; the LV apex may be foreshortened.",
  "anatomy": [
   "LA",
   "RA",
   "LV",
   "RV",
   "Mitral valve",
   "Tricuspid valve",
   "LVOT",
   "Aortic valve"
  ],
  "diagram": "./assets/tee-atlas/diagrams/me5c.svg",
  "scanCoverage": "partial",
  "sourceUrl": "https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf",
  "displayOrientation": "Near field at the top; at the near-transverse anterior-facing window, right-heart structures are toward screen left.",
  "insertionDepthCm": [
   30,
   30
  ],
  "angleEvidence": "Table 10 lists 0–10°; the acquisition text starts near 10°. The simulated preset uses 10°.",
  "sourceTable": "ASE/SCA 2013, Table 10 and the matching numbered acquisition section",
  "coverageNote": "Preset geometry is an educational approximation; this excised-heart scan has no measured esophageal or gastric probe trajectory."
 },
 {
  "id": "me4c",
  "aseNumber": 2,
  "group": "me",
  "mode": "tee",
  "code": "ME 4C",
  "name": "Midesophageal four-chamber",
  "shortName": "Four-chamber",
  "angleRange": [
   10,
   20
  ],
  "angleDefault": 15,
  "angles": "10–20°",
  "depthLabel": "ME · 30–35 cm",
  "depthEvidence": "The ASE acquisition text gives 30–35 cm insertion depth after advancing from five-chamber. This clinical range is not a measured depth in this scan.",
  "position": "Midesophageal, slightly deeper than five-chamber",
  "maneuvers": [
   "Advance slightly from five-chamber and set the electronic plane to 10–20°.",
   "Use slight retroflexion as needed to show the apex and mitral valve while removing aortic outflow."
  ],
  "description": "Identify both atrioventricular valves and both septa, with the true LV apex and no aortic outflow.",
  "teachingPoint": "Identify both atrioventricular valves and both septa, with the true LV apex and no aortic outflow.",
  "anatomy": [
   "LV",
   "RV",
   "LA",
   "RA",
   "Mitral valve",
   "Tricuspid valve",
   "Interatrial septum",
   "Interventricular septum"
  ],
  "diagram": "./assets/tee-atlas/diagrams/me4c.svg",
  "scanCoverage": "partial",
  "sourceUrl": "https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf",
  "displayOrientation": "RV is toward screen left and LV toward screen right. The septal tricuspid leaflet lies beside the interventricular septum.",
  "insertionDepthCm": [
   30,
   35
  ],
  "angleEvidence": "ASE Table 10 angle range; the selected starting angle is an illustrative preset and must be refined using anatomy.",
  "sourceTable": "ASE/SCA 2013, Table 10 and the matching numbered acquisition section",
  "coverageNote": "Preset geometry is an educational approximation; this excised-heart scan has no measured esophageal or gastric probe trajectory."
 },
 {
  "id": "mecommissural",
  "aseNumber": 3,
  "group": "me",
  "mode": "tee",
  "code": "ME COMM",
  "name": "Midesophageal mitral commissural",
  "shortName": "Mitral commissural",
  "angleRange": [
   50,
   70
  ],
  "angleDefault": 60,
  "angles": "50–70°",
  "depthLabel": "Midesophageal",
  "depthEvidence": "Midesophageal acquisition; use the displayed cardiac landmarks and relative probe movements. No patient-specific numeric insertion depth is assigned to this specimen.",
  "position": "Midesophageal window",
  "maneuvers": [
   "From four-chamber, keep the mitral valve centered and rotate the electronic plane to 50–70°."
  ],
  "description": "The central commissural section displays P3–A2–P1 from screen left to right; turning the shaft changes the leaflet section.",
  "teachingPoint": "The central commissural section displays P3–A2–P1 from screen left to right; turning the shaft changes the leaflet section.",
  "anatomy": [
   "LA",
   "LV",
   "Mitral commissures",
   "P3",
   "A2",
   "P1",
   "Chordae",
   "Papillary muscles"
  ],
  "diagram": "./assets/tee-atlas/diagrams/mecommissural.svg",
  "scanCoverage": "partial",
  "sourceUrl": "https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf",
  "displayOrientation": "In the standard single-plane view the mitral sequence is P3–A2–P1 from screen left to right; biplane secondary views can reverse orientation.",
  "angleEvidence": "ASE Table 10 angle range; the selected starting angle is an illustrative preset and must be refined using anatomy.",
  "sourceTable": "ASE/SCA 2013, Table 10 and the matching numbered acquisition section",
  "coverageNote": "Preset geometry is an educational approximation; this excised-heart scan has no measured esophageal or gastric probe trajectory."
 },
 {
  "id": "me2c",
  "aseNumber": 4,
  "group": "me",
  "mode": "tee",
  "code": "ME 2C",
  "name": "Midesophageal two-chamber",
  "shortName": "Two-chamber",
  "angleRange": [
   80,
   100
  ],
  "angleDefault": 90,
  "angles": "80–100°",
  "depthLabel": "Midesophageal",
  "depthEvidence": "Midesophageal acquisition; use the displayed cardiac landmarks and relative probe movements. No patient-specific numeric insertion depth is assigned to this specimen.",
  "position": "Midesophageal window",
  "maneuvers": [
   "From the commissural view, rotate the electronic plane to 80–100° while retaining the LV long axis."
  ],
  "description": "Inspect the anterior and inferior LV walls with mitral inflow; the RV should be excluded from this section.",
  "teachingPoint": "Inspect the anterior and inferior LV walls with mitral inflow; the RV should be excluded from this section.",
  "anatomy": [
   "LA",
   "LV",
   "Mitral valve",
   "Anterior LV wall",
   "Inferior LV wall",
   "LAA"
  ],
  "diagram": "./assets/tee-atlas/diagrams/me2c.svg",
  "scanCoverage": "partial",
  "sourceUrl": "https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf",
  "displayOrientation": "The two-chamber section is approximately orthogonal to ME four-chamber; secondary biplane orientation may be mirrored.",
  "angleEvidence": "ASE Table 10 angle range; the selected starting angle is an illustrative preset and must be refined using anatomy.",
  "sourceTable": "ASE/SCA 2013, Table 10 and the matching numbered acquisition section",
  "coverageNote": "Preset geometry is an educational approximation; this excised-heart scan has no measured esophageal or gastric probe trajectory."
 },
 {
  "id": "melax",
  "aseNumber": 5,
  "group": "me",
  "mode": "tee",
  "code": "ME LAX",
  "name": "Midesophageal long-axis",
  "shortName": "Long-axis",
  "angleRange": [
   120,
   140
  ],
  "angleDefault": 130,
  "angles": "120–140°",
  "depthLabel": "Midesophageal",
  "depthEvidence": "Midesophageal acquisition; use the displayed cardiac landmarks and relative probe movements. No patient-specific numeric insertion depth is assigned to this specimen.",
  "position": "Midesophageal window",
  "maneuvers": [
   "From ME two-chamber, increase the electronic angle to 120–140° and optimize LV length."
  ],
  "description": "Link mitral inflow, LVOT and aortic valve in one section, with the inferolateral and anteroseptal LV walls.",
  "teachingPoint": "Link mitral inflow, LVOT and aortic valve in one section, with the inferolateral and anteroseptal LV walls.",
  "anatomy": [
   "LA",
   "LV",
   "Mitral valve (P2/A2)",
   "LVOT",
   "Aortic valve",
   "Proximal aorta",
   "Inferolateral LV wall",
   "Anteroseptal LV wall"
  ],
  "diagram": "./assets/tee-atlas/diagrams/melax.svg",
  "scanCoverage": "partial",
  "sourceUrl": "https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf",
  "displayOrientation": "The standard mitral section includes P2 and A2; the aortic outflow distinguishes this from a two-chamber plane.",
  "angleEvidence": "ASE Table 10 angle range; the selected starting angle is an illustrative preset and must be refined using anatomy.",
  "sourceTable": "ASE/SCA 2013, Table 10 and the matching numbered acquisition section",
  "coverageNote": "Preset geometry is an educational approximation; this excised-heart scan has no measured esophageal or gastric probe trajectory."
 },
 {
  "id": "meavlax",
  "aseNumber": 6,
  "group": "me",
  "mode": "tee",
  "code": "ME AV LAX",
  "name": "Midesophageal aortic valve long-axis",
  "shortName": "Aortic valve LAX",
  "angleRange": [
   120,
   140
  ],
  "angleDefault": 130,
  "angles": "120–140°",
  "depthLabel": "Midesophageal",
  "depthEvidence": "Midesophageal acquisition; use the displayed cardiac landmarks and relative probe movements. No patient-specific numeric insertion depth is assigned to this specimen.",
  "position": "Midesophageal, slightly withdrawn from ME long-axis",
  "maneuvers": [
   "Withdraw slightly from ME long-axis while retaining 120–140°; a small right turn may help.",
   "Center the LVOT, valve and aortic root; reduce ultrasound image depth or zoom for detail."
  ],
  "description": "Follow the LVOT through the valve, sinuses and sinotubular junction into the proximal ascending aorta.",
  "teachingPoint": "Follow the LVOT through the valve, sinuses and sinotubular junction into the proximal ascending aorta.",
  "anatomy": [
   "LVOT",
   "Aortic valve",
   "Aortic sinuses",
   "Sinotubular junction",
   "Proximal ascending aorta"
  ],
  "diagram": "./assets/tee-atlas/diagrams/meavlax.svg",
  "scanCoverage": "partial",
  "sourceUrl": "https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf",
  "displayOrientation": "The anterior far-field cusp is the right coronary cusp. The posterior near-field cusp may be noncoronary or left coronary.",
  "angleEvidence": "ASE Table 10 angle range; the selected starting angle is an illustrative preset and must be refined using anatomy.",
  "sourceTable": "ASE/SCA 2013, Table 10 and the matching numbered acquisition section",
  "coverageNote": "Preset geometry is an educational approximation; this excised-heart scan has no measured esophageal or gastric probe trajectory."
 },
 {
  "id": "meaaolax",
  "aseNumber": 7,
  "group": "me",
  "mode": "tee",
  "code": "ME AO LAX",
  "name": "Midesophageal ascending aorta long-axis",
  "shortName": "Ascending aorta LAX",
  "angleRange": [
   90,
   110
  ],
  "angleDefault": 100,
  "angles": "90–110°",
  "depthLabel": "Midesophageal",
  "depthEvidence": "Midesophageal acquisition; use the displayed cardiac landmarks and relative probe movements. No patient-specific numeric insertion depth is assigned to this specimen.",
  "position": "Midesophageal, withdrawn above the aortic valve",
  "maneuvers": [
   "Withdraw from aortic valve long-axis and set the electronic plane to 90–110°."
  ],
  "description": "Use the right pulmonary artery behind the ascending aorta as a landmark; an airway blind spot limits the distal ascending aorta.",
  "teachingPoint": "Use the right pulmonary artery behind the ascending aorta as a landmark; an airway blind spot limits the distal ascending aorta.",
  "anatomy": [
   "Ascending aorta",
   "Right pulmonary artery"
  ],
  "diagram": "./assets/tee-atlas/diagrams/meaaolax.svg",
  "scanCoverage": "partial",
  "sourceUrl": "https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf",
  "displayOrientation": "The right pulmonary artery is posterior to the aorta and appears in the near field, usually in cross section.",
  "angleEvidence": "ASE Table 10 angle range; the selected starting angle is an illustrative preset and must be refined using anatomy.",
  "sourceTable": "ASE/SCA 2013, Table 10 and the matching numbered acquisition section",
  "coverageNote": "Preset geometry is an educational approximation; this excised-heart scan has no measured esophageal or gastric probe trajectory."
 },
 {
  "id": "meaaosax",
  "aseNumber": 8,
  "group": "me",
  "mode": "tee",
  "code": "ME AO SAX",
  "name": "Midesophageal ascending aorta short-axis",
  "shortName": "Ascending aorta SAX",
  "angleRange": [
   0,
   30
  ],
  "angleDefault": 15,
  "angles": "0–30°",
  "depthLabel": "Midesophageal",
  "depthEvidence": "Midesophageal acquisition; use the displayed cardiac landmarks and relative probe movements. No patient-specific numeric insertion depth is assigned to this specimen.",
  "position": "Midesophageal, at the ascending-aorta level",
  "maneuvers": [
   "From ascending-aorta long-axis, reduce the electronic angle to 0–30° at the same level."
  ],
  "description": "Identify the ascending-aortic cross section with the SVC and pulmonary arteries; the left main bronchus can obscure the left pulmonary artery.",
  "teachingPoint": "Identify the ascending-aortic cross section with the SVC and pulmonary arteries; the left main bronchus can obscure the left pulmonary artery.",
  "anatomy": [
   "Ascending aorta",
   "SVC",
   "Main pulmonary artery",
   "Right pulmonary artery"
  ],
  "diagram": "./assets/tee-atlas/diagrams/meaaosax.svg",
  "scanCoverage": "partial",
  "sourceUrl": "https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf",
  "displayOrientation": "The aorta is shown above valve level. Leftward shaft turning can show the pulmonary bifurcation; rightward turning follows the right pulmonary artery.",
  "angleEvidence": "ASE Table 10 angle range; the selected starting angle is an illustrative preset and must be refined using anatomy.",
  "sourceTable": "ASE/SCA 2013, Table 10 and the matching numbered acquisition section",
  "coverageNote": "Preset geometry is an educational approximation; this excised-heart scan has no measured esophageal or gastric probe trajectory."
 },
 {
  "id": "merpv",
  "aseNumber": 9,
  "group": "me",
  "mode": "tee",
  "code": "ME RPV",
  "name": "Midesophageal right pulmonary vein",
  "shortName": "Right pulmonary vein",
  "angleRange": [
   0,
   0
  ],
  "angleDefault": 0,
  "angles": "0°",
  "depthLabel": "Midesophageal",
  "depthEvidence": "Midesophageal acquisition; use the displayed cardiac landmarks and relative probe movements. No patient-specific numeric insertion depth is assigned to this specimen.",
  "position": "Midesophageal, advanced and turned right from ascending-aorta SAX",
  "maneuvers": [
   "Near 0°, advance from ascending-aorta short-axis and turn the shaft right toward the right pulmonary veins."
  ],
  "description": "The superior right pulmonary vein commonly runs along the beam; the inferior vein runs more across it.",
  "teachingPoint": "The superior right pulmonary vein commonly runs along the beam; the inferior vein runs more across it.",
  "anatomy": [
   "Right superior pulmonary vein",
   "Right inferior pulmonary vein",
   "LA",
   "SVC",
   "Ascending aorta"
  ],
  "diagram": "./assets/tee-atlas/diagrams/merpv.svg",
  "scanCoverage": "partial",
  "sourceUrl": "https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf",
  "displayOrientation": "The SVC and ascending aorta may be seen in cross section; trace pulmonary veins into the LA rather than the RA.",
  "angleEvidence": "ASE Table 10 angle range; the selected starting angle is an illustrative preset and must be refined using anatomy.",
  "sourceTable": "ASE/SCA 2013, Table 10 and the matching numbered acquisition section",
  "coverageNote": "Preset geometry is an educational approximation; this excised-heart scan has no measured esophageal or gastric probe trajectory."
 },
 {
  "id": "meavsax",
  "aseNumber": 10,
  "group": "me",
  "mode": "tee",
  "code": "ME AV SAX",
  "name": "Midesophageal aortic valve short-axis",
  "shortName": "Aortic valve SAX",
  "angleRange": [
   25,
   45
  ],
  "angleDefault": 35,
  "angles": "25–45°",
  "depthLabel": "Midesophageal",
  "depthEvidence": "Midesophageal acquisition; use the displayed cardiac landmarks and relative probe movements. No patient-specific numeric insertion depth is assigned to this specimen.",
  "position": "Midesophageal, at aortic valve level",
  "maneuvers": [
   "From the right pulmonary vein view, turn left to center the aorta, then advance to the valve.",
   "Use 25–45° and slight anteflexion as needed."
  ],
  "description": "Confirm all three cusps at valve level: left coronary near screen right, noncoronary by the atrial septum, right coronary by the RVOT.",
  "teachingPoint": "Confirm all three cusps at valve level: left coronary near screen right, noncoronary by the atrial septum, right coronary by the RVOT.",
  "anatomy": [
   "Left coronary cusp",
   "Noncoronary cusp",
   "Right coronary cusp",
   "Aortic root",
   "LA",
   "RA",
   "Interatrial septum",
   "RVOT"
  ],
  "diagram": "./assets/tee-atlas/diagrams/meavsax.svg",
  "scanCoverage": "partial",
  "sourceUrl": "https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf",
  "displayOrientation": "LCC is posterior and near-field toward screen right; RCC is anterior and far-field beside the RVOT; NCC adjoins the interatrial septum.",
  "angleEvidence": "ASE Table 10 angle range; the selected starting angle is an illustrative preset and must be refined using anatomy.",
  "sourceTable": "ASE/SCA 2013, Table 10 and the matching numbered acquisition section",
  "coverageNote": "Preset geometry is an educational approximation; this excised-heart scan has no measured esophageal or gastric probe trajectory."
 },
 {
  "id": "mervinout",
  "aseNumber": 11,
  "group": "me",
  "mode": "tee",
  "code": "ME RV I/O",
  "name": "Midesophageal RV inflow-outflow",
  "shortName": "RV inflow-outflow",
  "angleRange": [
   50,
   70
  ],
  "angleDefault": 60,
  "angles": "50–70°",
  "depthLabel": "Midesophageal",
  "depthEvidence": "Midesophageal acquisition; use the displayed cardiac landmarks and relative probe movements. No patient-specific numeric insertion depth is assigned to this specimen.",
  "position": "Midesophageal window",
  "maneuvers": [
   "From aortic valve short-axis, advance slightly and increase the electronic angle to 50–70° until the RVOT and pulmonic valve appear."
  ],
  "description": "Connect tricuspid inflow to the RVOT and pulmonic valve in one plane; RV inflow lies toward screen left.",
  "teachingPoint": "Connect tricuspid inflow to the RVOT and pulmonic valve in one plane; RV inflow lies toward screen left.",
  "anatomy": [
   "LA",
   "RA",
   "Interatrial septum",
   "Tricuspid valve",
   "RV",
   "RVOT",
   "Pulmonic valve",
   "Main pulmonary artery"
  ],
  "diagram": "./assets/tee-atlas/diagrams/mervinout.svg",
  "scanCoverage": "partial",
  "sourceUrl": "https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf",
  "displayOrientation": "In the standard view, RV inflow is on screen left and RV outflow on screen right.",
  "angleEvidence": "ASE Table 10 angle range; the selected starting angle is an illustrative preset and must be refined using anatomy.",
  "sourceTable": "ASE/SCA 2013, Table 10 and the matching numbered acquisition section",
  "coverageNote": "Preset geometry is an educational approximation; this excised-heart scan has no measured esophageal or gastric probe trajectory."
 },
 {
  "id": "memodbicaval",
  "aseNumber": 12,
  "group": "me",
  "mode": "tee",
  "code": "ME MOD BC",
  "name": "Midesophageal modified bicaval tricuspid valve",
  "shortName": "Modified bicaval TV",
  "angleRange": [
   50,
   70
  ],
  "angleDefault": 60,
  "angles": "50–70°",
  "depthLabel": "Midesophageal",
  "depthEvidence": "Midesophageal acquisition; use the displayed cardiac landmarks and relative probe movements. No patient-specific numeric insertion depth is assigned to this specimen.",
  "position": "Midesophageal window",
  "maneuvers": [
   "At 50–70°, turn the shaft right from RV inflow-outflow until the tricuspid valve is centered."
  ],
  "description": "Center the tricuspid valve and septal leaflet with the RA, LA, atrial septum and IVC; this differs from the 90–110° bicaval plane.",
  "teachingPoint": "Center the tricuspid valve and septal leaflet with the RA, LA, atrial septum and IVC; this differs from the 90–110° bicaval plane.",
  "anatomy": [
   "RA",
   "LA",
   "Interatrial septum",
   "IVC",
   "Tricuspid valve",
   "Septal tricuspid leaflet"
  ],
  "diagram": "./assets/tee-atlas/diagrams/memodbicaval.svg",
  "scanCoverage": "partial",
  "sourceUrl": "https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf",
  "displayOrientation": "The septal tricuspid leaflet is seen en face. The SVC and right atrial appendage may also enter the plane.",
  "angleEvidence": "ASE Table 10 angle range; the selected starting angle is an illustrative preset and must be refined using anatomy.",
  "sourceTable": "ASE/SCA 2013, Table 10 and the matching numbered acquisition section",
  "coverageNote": "Preset geometry is an educational approximation; this excised-heart scan has no measured esophageal or gastric probe trajectory."
 },
 {
  "id": "bicaval",
  "aseNumber": 13,
  "group": "me",
  "mode": "tee",
  "code": "ME BICAVAL",
  "name": "Midesophageal bicaval",
  "shortName": "Bicaval",
  "angleRange": [
   90,
   110
  ],
  "angleDefault": 100,
  "angles": "90–110°",
  "depthLabel": "Midesophageal",
  "depthEvidence": "Midesophageal acquisition; use the displayed cardiac landmarks and relative probe movements. No patient-specific numeric insertion depth is assigned to this specimen.",
  "position": "Midesophageal window",
  "maneuvers": [
   "From the modified bicaval tricuspid view, increase the electronic angle to 90–110° and turn the shaft right."
  ],
  "description": "Show the SVC and IVC entering the RA together with the interatrial septum and adjacent LA.",
  "teachingPoint": "Show the SVC and IVC entering the RA together with the interatrial septum and adjacent LA.",
  "anatomy": [
   "SVC",
   "IVC",
   "RA",
   "LA",
   "Interatrial septum",
   "Right atrial appendage"
  ],
  "diagram": "./assets/tee-atlas/diagrams/bicaval.svg",
  "scanCoverage": "partial",
  "sourceUrl": "https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf",
  "displayOrientation": "Use the caval junctions to orient the atrial septum; further rightward turning can enter the right pulmonary vein view.",
  "angleEvidence": "ASE Table 10 angle range; the selected starting angle is an illustrative preset and must be refined using anatomy.",
  "sourceTable": "ASE/SCA 2013, Table 10 and the matching numbered acquisition section",
  "coverageNote": "Preset geometry is an educational approximation; this excised-heart scan has no measured esophageal or gastric probe trajectory."
 },
 {
  "id": "mepv",
  "aseNumber": 14,
  "group": "me",
  "mode": "tee",
  "code": "ME PV",
  "name": "Midesophageal right and left pulmonary veins",
  "shortName": "Right & left pulmonary veins",
  "angleRange": [
   90,
   110
  ],
  "angleDefault": 100,
  "angles": "90–110°",
  "depthLabel": "Midesophageal",
  "depthEvidence": "Midesophageal acquisition; use the displayed cardiac landmarks and relative probe movements. No patient-specific numeric insertion depth is assigned to this specimen.",
  "position": "Midesophageal window",
  "maneuvers": [
   "At 90–110°, turn right from bicaval for the right veins.",
   "Turn left across the LA for a separate acquisition of the left veins."
  ],
  "description": "One numbered reference covers two acquisitions. Image each side separately; the superior vein appears toward screen right in each.",
  "teachingPoint": "One numbered reference covers two acquisitions. Image each side separately; the superior vein appears toward screen right in each.",
  "anatomy": [
   "Right superior pulmonary vein",
   "Right inferior pulmonary vein",
   "Left superior pulmonary vein",
   "Left inferior pulmonary vein",
   "LA"
  ],
  "diagram": "./assets/tee-atlas/diagrams/mepv.svg",
  "scanCoverage": "partial",
  "sourceUrl": "https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf",
  "displayOrientation": "In both standard acquisitions, the superior pulmonary vein is toward screen right. Do not depict all four veins in one simultaneous section.",
  "angleEvidence": "ASE Table 10 angle range; the selected starting angle is an illustrative preset and must be refined using anatomy.",
  "sourceTable": "ASE/SCA 2013, Table 10 and the matching numbered acquisition section",
  "coverageNote": "Preset geometry is an educational approximation; this excised-heart scan has no measured esophageal or gastric probe trajectory."
 },
 {
  "id": "melaa",
  "aseNumber": 15,
  "group": "me",
  "mode": "tee",
  "code": "ME LAA",
  "name": "Midesophageal left atrial appendage",
  "shortName": "Left atrial appendage",
  "angleRange": [
   90,
   110
  ],
  "angleDefault": 100,
  "angles": "90–110°",
  "depthLabel": "Midesophageal",
  "depthEvidence": "Midesophageal acquisition; use the displayed cardiac landmarks and relative probe movements. No patient-specific numeric insertion depth is assigned to this specimen.",
  "position": "Midesophageal, right turn from the left pulmonary veins",
  "maneuvers": [
   "From the left pulmonary vein view at 90–110°, turn the shaft right; slight advancement or anteflexion may help.",
   "Sweep the electronic angle back toward 0° or use multiple planes to inspect the appendage."
  ],
  "description": "Center the appendage beside the left superior pulmonary vein, then examine multiple planes because a single section misses lobes.",
  "teachingPoint": "Center the appendage beside the left superior pulmonary vein, then examine multiple planes because a single section misses lobes.",
  "anatomy": [
   "LAA",
   "LA",
   "Left superior pulmonary vein",
   "Ridge between LAA and left superior pulmonary vein"
  ],
  "diagram": "./assets/tee-atlas/diagrams/melaa.svg",
  "scanCoverage": "partial",
  "sourceUrl": "https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf",
  "displayOrientation": "The LAA lies next to the left superior pulmonary vein; the intervening ridge is a normal landmark.",
  "angleEvidence": "ASE Table 10 angle range; the selected starting angle is an illustrative preset and must be refined using anatomy.",
  "sourceTable": "ASE/SCA 2013, Table 10 and the matching numbered acquisition section",
  "coverageNote": "Preset geometry is an educational approximation; this excised-heart scan has no measured esophageal or gastric probe trajectory."
 },
 {
  "id": "tgbasalsax",
  "aseNumber": 16,
  "group": "tg",
  "mode": "tee",
  "code": "TG BASE",
  "name": "Transgastric basal short-axis",
  "shortName": "Basal short-axis",
  "angleRange": [
   0,
   20
  ],
  "angleDefault": 10,
  "angles": "0–20°",
  "depthLabel": "Transgastric",
  "depthEvidence": "Transgastric acquisition; gastric wall contact, flexion and advancement determine the target level. No patient-specific numeric insertion depth is assigned to this specimen.",
  "position": "Transgastric window",
  "maneuvers": [
   "At 0–20°, straighten the tip and advance into the stomach, then anteflex toward the LV base."
  ],
  "description": "Identify the mitral opening at the LV base: anterior leaflet toward screen left, posterior leaflet toward screen right.",
  "teachingPoint": "Identify the mitral opening at the LV base: anterior leaflet toward screen left, posterior leaflet toward screen right.",
  "anatomy": [
   "Mitral valve",
   "Anterior mitral leaflet",
   "Posterior mitral leaflet",
   "LV base",
   "Medial commissure",
   "Lateral commissure"
  ],
  "diagram": "./assets/tee-atlas/diagrams/tgbasalsax.svg",
  "scanCoverage": "partial",
  "sourceUrl": "https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf",
  "displayOrientation": "Anterior mitral leaflet is screen left; posterior is screen right. Medial commissure is near-field and lateral commissure far-field.",
  "angleEvidence": "ASE Table 10 angle range; the selected starting angle is an illustrative preset and must be refined using anatomy.",
  "sourceTable": "ASE/SCA 2013, Table 10 and the matching numbered acquisition section",
  "coverageNote": "Preset geometry is an educational approximation; this excised-heart scan has no measured esophageal or gastric probe trajectory."
 },
 {
  "id": "tgpapillary",
  "aseNumber": 17,
  "group": "tg",
  "mode": "tee",
  "code": "TG MID SAX",
  "name": "Transgastric midpapillary short-axis",
  "shortName": "Midpapillary short-axis",
  "angleRange": [
   0,
   20
  ],
  "angleDefault": 10,
  "angles": "0–20°",
  "depthLabel": "Transgastric",
  "depthEvidence": "Transgastric acquisition; gastric wall contact, flexion and advancement determine the target level. No patient-specific numeric insertion depth is assigned to this specimen.",
  "position": "Transgastric window",
  "maneuvers": [
   "From basal short-axis, maintain gastric wall contact and reduce anteflexion or advance slightly.",
   "Keep the electronic plane at 0–20° and center the papillary-muscle level."
  ],
  "description": "Two papillary muscles identify the mid-LV section; all three major coronary territories are represented around this level.",
  "teachingPoint": "Two papillary muscles identify the mid-LV section; all three major coronary territories are represented around this level.",
  "anatomy": [
   "LV",
   "Anterolateral papillary muscle",
   "Posteromedial papillary muscle",
   "RV",
   "Midventricular walls"
  ],
  "diagram": "./assets/tee-atlas/diagrams/tgpapillary.svg",
  "scanCoverage": "partial",
  "sourceUrl": "https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf",
  "displayOrientation": "A circular LV surrounds the two papillary-muscle profiles; rightward shaft turning centers the mid-RV.",
  "angleEvidence": "ASE Table 10 angle range; the selected starting angle is an illustrative preset and must be refined using anatomy.",
  "sourceTable": "ASE/SCA 2013, Table 10 and the matching numbered acquisition section",
  "coverageNote": "Preset geometry is an educational approximation; this excised-heart scan has no measured esophageal or gastric probe trajectory."
 },
 {
  "id": "tgapicalsax",
  "aseNumber": 18,
  "group": "tg",
  "mode": "tee",
  "code": "TG APEX",
  "name": "Transgastric apical short-axis",
  "shortName": "Apical short-axis",
  "angleRange": [
   0,
   20
  ],
  "angleDefault": 10,
  "angles": "0–20°",
  "depthLabel": "Transgastric",
  "depthEvidence": "Transgastric acquisition; gastric wall contact, flexion and advancement determine the target level. No patient-specific numeric insertion depth is assigned to this specimen.",
  "position": "Transgastric window",
  "maneuvers": [
   "From midpapillary short-axis at 0–20°, advance while maintaining gastric wall contact."
  ],
  "description": "Recognize the smaller apical LV section beyond the papillary muscles; turning right can show the RV apex.",
  "teachingPoint": "Recognize the smaller apical LV section beyond the papillary muscles; turning right can show the RV apex.",
  "anatomy": [
   "LV apex",
   "Apical myocardium",
   "RV apex"
  ],
  "diagram": "./assets/tee-atlas/diagrams/tgapicalsax.svg",
  "scanCoverage": "partial",
  "sourceUrl": "https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf",
  "displayOrientation": "The apical section lies distal to the papillary-muscle level; papillary muscles should not be the defining profiles.",
  "angleEvidence": "ASE Table 10 angle range; the selected starting angle is an illustrative preset and must be refined using anatomy.",
  "sourceTable": "ASE/SCA 2013, Table 10 and the matching numbered acquisition section",
  "coverageNote": "Preset geometry is an educational approximation; this excised-heart scan has no measured esophageal or gastric probe trajectory."
 },
 {
  "id": "tgrvbasal",
  "aseNumber": 19,
  "group": "tg",
  "mode": "tee",
  "code": "TG RV BASE",
  "name": "Transgastric RV basal",
  "shortName": "RV basal",
  "angleRange": [
   0,
   20
  ],
  "angleDefault": 10,
  "angles": "0–20°",
  "depthLabel": "Transgastric",
  "depthEvidence": "Transgastric acquisition; gastric wall contact, flexion and advancement determine the target level. No patient-specific numeric insertion depth is assigned to this specimen.",
  "position": "Transgastric window",
  "maneuvers": [
   "Return to the anteflexed TG basal short-axis view at 0–20°, then turn the shaft right."
  ],
  "description": "The tricuspid valve is in short axis while the RV outflow tract appears in long axis.",
  "teachingPoint": "The tricuspid valve is in short axis while the RV outflow tract appears in long axis.",
  "anatomy": [
   "RV base",
   "Tricuspid valve",
   "RVOT"
  ],
  "diagram": "./assets/tee-atlas/diagrams/tgrvbasal.svg",
  "scanCoverage": "partial",
  "sourceUrl": "https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf",
  "displayOrientation": "This combines a cross section of the tricuspid opening with a longitudinal RVOT section.",
  "angleEvidence": "ASE Table 10 angle range; the selected starting angle is an illustrative preset and must be refined using anatomy.",
  "sourceTable": "ASE/SCA 2013, Table 10 and the matching numbered acquisition section",
  "coverageNote": "Preset geometry is an educational approximation; this excised-heart scan has no measured esophageal or gastric probe trajectory."
 },
 {
  "id": "tgrvinout",
  "aseNumber": 20,
  "group": "tg",
  "mode": "tee",
  "code": "TG RV I/O",
  "name": "Transgastric RV inflow-outflow",
  "shortName": "RV inflow-outflow",
  "angleRange": [
   0,
   20
  ],
  "angleDefault": 10,
  "angles": "0–20°",
  "depthLabel": "Transgastric",
  "depthEvidence": "Transgastric acquisition; gastric wall contact, flexion and advancement determine the target level. No patient-specific numeric insertion depth is assigned to this specimen.",
  "position": "Transgastric window",
  "maneuvers": [
   "From TG RV basal at 0–20°, apply right flexion to connect RV inflow and outflow.",
   "A small advance may improve RVOT beam alignment."
  ],
  "description": "Right flexion produces the standard 0–20° view. A neutral-tip, right-turned 90–120° approach gives a mirrored alternative.",
  "teachingPoint": "Right flexion produces the standard 0–20° view. A neutral-tip, right-turned 90–120° approach gives a mirrored alternative.",
  "anatomy": [
   "RV",
   "Anterior tricuspid leaflet",
   "Posterior tricuspid leaflet",
   "RVOT",
   "Pulmonic valve"
  ],
  "diagram": "./assets/tee-atlas/diagrams/tgrvinout.svg",
  "scanCoverage": "partial",
  "sourceUrl": "https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf",
  "displayOrientation": "The usual tricuspid leaflets are anterior and posterior. Verify whether the standard or mirrored alternate acquisition is displayed.",
  "angleEvidence": "Standard right-flexed acquisition: 0–20°. A different neutral-tip, right-turned acquisition uses 90–120° and produces a mirrored image.",
  "sourceTable": "ASE/SCA 2013, Table 10 and the matching numbered acquisition section",
  "coverageNote": "Preset geometry is an educational approximation; this excised-heart scan has no measured esophageal or gastric probe trajectory."
 },
 {
  "id": "deeptg5c",
  "aseNumber": 21,
  "group": "tg",
  "mode": "tee",
  "code": "DEEP TG 5C",
  "name": "Deep transgastric five-chamber",
  "shortName": "Deep five-chamber",
  "angleRange": [
   0,
   20
  ],
  "angleDefault": 10,
  "angles": "0–20°",
  "depthLabel": "Deep transgastric",
  "depthEvidence": "ASE specifies advancement to the deep transgastric level. The guideline maneuver is anatomical and relative; no numeric insertion depth is assigned to this specimen.",
  "position": "Deep transgastric window",
  "maneuvers": [
   "From TG RV inflow-outflow at 0–20°, advance to deep TG, then anteflex; left flexion is often helpful."
  ],
  "description": "Aim along the LVOT, aortic valve and proximal root from the apical side for near-parallel outflow Doppler alignment.",
  "teachingPoint": "Aim along the LVOT, aortic valve and proximal root from the apical side for near-parallel outflow Doppler alignment.",
  "anatomy": [
   "LV",
   "LVOT",
   "Aortic valve",
   "Proximal aortic root",
   "Mitral valve",
   "LA",
   "RV"
  ],
  "diagram": "./assets/tee-atlas/diagrams/deeptg5c.svg",
  "scanCoverage": "partial",
  "sourceUrl": "https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf",
  "displayOrientation": "The probe is on the gastric/apical side; aortic outflow is directed away through the sector.",
  "angleEvidence": "ASE Table 10 angle range; the selected starting angle is an illustrative preset and must be refined using anatomy.",
  "sourceTable": "ASE/SCA 2013, Table 10 and the matching numbered acquisition section",
  "coverageNote": "Preset geometry is an educational approximation; this excised-heart scan has no measured esophageal or gastric probe trajectory."
 },
 {
  "id": "tg2c",
  "aseNumber": 22,
  "group": "tg",
  "mode": "tee",
  "code": "TG 2C",
  "name": "Transgastric two-chamber",
  "shortName": "Two-chamber",
  "angleRange": [
   90,
   110
  ],
  "angleDefault": 100,
  "angles": "90–110°",
  "depthLabel": "Transgastric",
  "depthEvidence": "Transgastric acquisition; gastric wall contact, flexion and advancement determine the target level. No patient-specific numeric insertion depth is assigned to this specimen.",
  "position": "Transgastric window",
  "maneuvers": [
   "Return to the TG midpapillary short-axis position and rotate the electronic plane to 90–110°."
  ],
  "description": "Show anterior and inferior LV walls with the mitral apparatus; a far-field LAA glimpse is insufficient for a complete appendage assessment.",
  "teachingPoint": "Show anterior and inferior LV walls with the mitral apparatus; a far-field LAA glimpse is insufficient for a complete appendage assessment.",
  "anatomy": [
   "LV",
   "Anterior LV wall",
   "Inferior LV wall",
   "Mitral valve",
   "Chordae",
   "Papillary muscles",
   "LA"
  ],
  "diagram": "./assets/tee-atlas/diagrams/tg2c.svg",
  "scanCoverage": "partial",
  "sourceUrl": "https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf",
  "displayOrientation": "The left atrium and appendage may lie in the far field behind the mitral apparatus.",
  "angleEvidence": "ASE Table 10 angle range; the selected starting angle is an illustrative preset and must be refined using anatomy.",
  "sourceTable": "ASE/SCA 2013, Table 10 and the matching numbered acquisition section",
  "coverageNote": "Preset geometry is an educational approximation; this excised-heart scan has no measured esophageal or gastric probe trajectory."
 },
 {
  "id": "tgrvin",
  "aseNumber": 23,
  "group": "tg",
  "mode": "tee",
  "code": "TG RV INFLOW",
  "name": "Transgastric RV inflow",
  "shortName": "RV inflow",
  "angleRange": [
   90,
   110
  ],
  "angleDefault": 100,
  "angles": "90–110°",
  "depthLabel": "Transgastric",
  "depthEvidence": "Transgastric acquisition; gastric wall contact, flexion and advancement determine the target level. No patient-specific numeric insertion depth is assigned to this specimen.",
  "position": "Transgastric window",
  "maneuvers": [
   "At 90–110°, turn the shaft right from TG two-chamber to center RV inflow."
  ],
  "description": "Identify the tricuspid apparatus and anterior/inferior RV walls; proximal RVOT may also enter the plane.",
  "teachingPoint": "Identify the tricuspid apparatus and anterior/inferior RV walls; proximal RVOT may also enter the plane.",
  "anatomy": [
   "RV",
   "Anterior RV wall",
   "Inferior RV wall",
   "RA",
   "Tricuspid valve",
   "Chordae",
   "Papillary muscles"
  ],
  "diagram": "./assets/tee-atlas/diagrams/tgrvin.svg",
  "scanCoverage": "partial",
  "sourceUrl": "https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf",
  "displayOrientation": "This is a right-ventricular long-axis/inflow section; slight advancement can bring the pulmonic valve into view.",
  "angleEvidence": "ASE Table 10 angle range; the selected starting angle is an illustrative preset and must be refined using anatomy.",
  "sourceTable": "ASE/SCA 2013, Table 10 and the matching numbered acquisition section",
  "coverageNote": "Preset geometry is an educational approximation; this excised-heart scan has no measured esophageal or gastric probe trajectory."
 },
 {
  "id": "tglax",
  "aseNumber": 24,
  "group": "tg",
  "mode": "tee",
  "code": "TG LAX",
  "name": "Transgastric long-axis",
  "shortName": "Long-axis",
  "angleRange": [
   120,
   140
  ],
  "angleDefault": 130,
  "angles": "120–140°",
  "depthLabel": "Transgastric",
  "depthEvidence": "Transgastric acquisition; gastric wall contact, flexion and advancement determine the target level. No patient-specific numeric insertion depth is assigned to this specimen.",
  "position": "Transgastric window",
  "maneuvers": [
   "Turn left from TG RV inflow to regain TG two-chamber, then increase the electronic angle to 120–140°.",
   "A slight right turn may be needed to bring the LVOT and aortic valve into view."
  ],
  "description": "Link LV inflow and aortic outflow with inferolateral and anteroseptal LV walls; optimize outflow alignment for Doppler.",
  "teachingPoint": "Link LV inflow and aortic outflow with inferolateral and anteroseptal LV walls; optimize outflow alignment for Doppler.",
  "anatomy": [
   "LV",
   "Inferolateral LV wall",
   "Anteroseptal LV wall",
   "LVOT",
   "Aortic valve",
   "Proximal aorta",
   "Mitral valve"
  ],
  "diagram": "./assets/tee-atlas/diagrams/tglax.svg",
  "scanCoverage": "partial",
  "sourceUrl": "https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf",
  "angleEvidence": "ASE Table 10 angle range; the selected starting angle is an illustrative preset and must be refined using anatomy.",
  "sourceTable": "ASE/SCA 2013, Table 10 and the matching numbered acquisition section",
  "coverageNote": "Preset geometry is an educational approximation; this excised-heart scan has no measured esophageal or gastric probe trajectory."
 },
 {
  "id": "daosax",
  "aseNumber": 25,
  "group": "aortic",
  "mode": "tee",
  "code": "DESC AO SAX",
  "name": "Descending aorta short-axis",
  "shortName": "Descending aorta SAX",
  "angleRange": [
   0,
   10
  ],
  "angleDefault": 5,
  "angles": "0–10°",
  "depthLabel": "Thoracic esophagus",
  "depthEvidence": "The ASE sequence surveys aortic length with advancement and withdrawal; there is no single target insertion depth. Numeric depth is not assigned to this reconstruction.",
  "position": "Descending-aortic survey along the thoracic esophagus",
  "maneuvers": [
   "From TG long-axis, return to 0–10° and turn the shaft left toward the descending aorta.",
   "Center the vessel and advance or withdraw to survey its length; use a shallower ultrasound display depth."
  ],
  "description": "Survey the vessel length in cross section; a single round aortic image does not identify its level.",
  "teachingPoint": "Survey the vessel length in cross section; a single round aortic image does not identify its level.",
  "anatomy": [
   "Descending thoracic aorta"
  ],
  "diagram": "./assets/tee-atlas/diagrams/daosax.svg",
  "scanCoverage": "outside",
  "sourceUrl": "https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf",
  "displayOrientation": "The descending thoracic aorta is posterior and left of the esophagus; the beam faces the left chest.",
  "angleEvidence": "ASE Table 10 angle range; the selected starting angle is an illustrative preset and must be refined using anatomy.",
  "sourceTable": "ASE/SCA 2013, Table 10 and the matching numbered acquisition section",
  "coverageNote": "The arch or descending-aortic target is outside the excised-heart reconstruction; the probe relationship is schematic."
 },
 {
  "id": "daolax",
  "aseNumber": 26,
  "group": "aortic",
  "mode": "tee",
  "code": "DESC AO LAX",
  "name": "Descending aorta long-axis",
  "shortName": "Descending aorta LAX",
  "angleRange": [
   90,
   100
  ],
  "angleDefault": 95,
  "angles": "90–100°",
  "depthLabel": "Thoracic esophagus",
  "depthEvidence": "The ASE sequence surveys aortic length with advancement and withdrawal; there is no single target insertion depth. Numeric depth is not assigned to this reconstruction.",
  "position": "Descending-aortic survey along the thoracic esophagus",
  "maneuvers": [
   "From descending-aorta short-axis, rotate the electronic plane to 90–100°.",
   "Keep the vessel centered while advancing or withdrawing to inspect its length."
  ],
  "description": "Use parallel aortic walls to confirm long axis, and combine with the short-axis sweep to localize findings.",
  "teachingPoint": "Use parallel aortic walls to confirm long axis, and combine with the short-axis sweep to localize findings.",
  "anatomy": [
   "Descending thoracic aorta"
  ],
  "diagram": "./assets/tee-atlas/diagrams/daolax.svg",
  "scanCoverage": "outside",
  "sourceUrl": "https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf",
  "displayOrientation": "Intercostal arteries commonly arise toward screen right; a venous structure can lie farther from the probe than the aorta.",
  "angleEvidence": "ASE Table 10 angle range; the selected starting angle is an illustrative preset and must be refined using anatomy.",
  "sourceTable": "ASE/SCA 2013, Table 10 and the matching numbered acquisition section",
  "coverageNote": "The arch or descending-aortic target is outside the excised-heart reconstruction; the probe relationship is schematic."
 },
 {
  "id": "uearchlax",
  "aseNumber": 27,
  "group": "aortic",
  "mode": "tee",
  "code": "UE ARCH LAX",
  "name": "Upper esophageal aortic arch long-axis",
  "shortName": "Aortic arch LAX",
  "angleRange": [
   0,
   10
  ],
  "angleDefault": 5,
  "angles": "0–10°",
  "depthLabel": "Upper esophageal",
  "depthEvidence": "ASE describes withdrawal from the descending-aorta survey until the arch appears, followed by rightward shaft turning. No fixed insertion depth is assigned here.",
  "position": "Upper esophageal, facing anteriorly toward the arch",
  "maneuvers": [
   "At 0–10°, withdraw from the descending-aorta survey until the vessel elongates into the arch.",
   "Turn the shaft right so the imaging face points anteriorly."
  ],
  "description": "Follow the mid arch; the left main bronchus creates a blind spot over portions of the proximal arch and distal ascending aorta.",
  "teachingPoint": "Follow the mid arch; the left main bronchus creates a blind spot over portions of the proximal arch and distal ascending aorta.",
  "anatomy": [
   "Aortic arch",
   "Left brachiocephalic vein",
   "Left subclavian origin"
  ],
  "diagram": "./assets/tee-atlas/diagrams/uearchlax.svg",
  "scanCoverage": "outside",
  "sourceUrl": "https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf",
  "displayOrientation": "The arch is anterior to the esophagus at this level; the left brachiocephalic vein may accompany the view.",
  "angleEvidence": "ASE Table 10 angle range; the selected starting angle is an illustrative preset and must be refined using anatomy.",
  "sourceTable": "ASE/SCA 2013, Table 10 and the matching numbered acquisition section",
  "coverageNote": "The arch or descending-aortic target is outside the excised-heart reconstruction; the probe relationship is schematic."
 },
 {
  "id": "uearchsax",
  "aseNumber": 28,
  "group": "aortic",
  "mode": "tee",
  "code": "UE ARCH SAX",
  "name": "Upper esophageal aortic arch short-axis",
  "shortName": "Aortic arch SAX",
  "angleRange": [
   70,
   90
  ],
  "angleDefault": 80,
  "angles": "70–90°",
  "depthLabel": "Upper esophageal",
  "depthEvidence": "Use the same upper-esophageal position as arch long-axis while changing the electronic angle. No fixed insertion depth is assigned here.",
  "position": "Upper esophageal, at the aortic arch",
  "maneuvers": [
   "Keep the arch position and increase the electronic angle to 70–90°.",
   "Adjust ultrasound display depth and focus to include the main pulmonary artery and pulmonic valve."
  ],
  "description": "The arch is in cross section while the main pulmonary artery and pulmonic valve may be seen longitudinally in the far field.",
  "teachingPoint": "The arch is in cross section while the main pulmonary artery and pulmonic valve may be seen longitudinally in the far field.",
  "anatomy": [
   "Aortic arch",
   "Main pulmonary artery",
   "Pulmonic valve"
  ],
  "diagram": "./assets/tee-atlas/diagrams/uearchsax.svg",
  "scanCoverage": "outside",
  "sourceUrl": "https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf",
  "displayOrientation": "Pulmonary artery and valve lie in the far field; branch origins may enter the near-field right side at intermediate angles.",
  "angleEvidence": "ASE Table 10 angle range; the selected starting angle is an illustrative preset and must be refined using anatomy.",
  "sourceTable": "ASE/SCA 2013, Table 10 and the matching numbered acquisition section",
  "coverageNote": "The arch or descending-aortic target is outside the excised-heart reconstruction; the probe relationship is schematic."
 }
].map(view => ({...view, ...referenceArtworkPaths('tee', view.id)})));
