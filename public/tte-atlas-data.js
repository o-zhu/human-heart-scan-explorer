/**
 * Factual ASE 2019 Table 2 view inventory with original acquisition summaries.
 * Clinical views are educational targets, not validated donor registrations.
 * PDF page numbers refer to the supplied 64-page guideline, not its upload date.
 */
import {referenceArtworkPaths} from './reference-artwork-v61.js';

const TTE_PDF = 'https://www.asecho.org/wp-content/uploads/2025/07/Guidelines-for-Performing-a-Comprehensive-Transthoracic-Echocardiographic-Examination-in-Adults.pdf';

export const TTE_SOURCE = TTE_PDF;

export const TTE_SOURCE_METADATA = Object.freeze({
  title: 'Guidelines for Performing a Comprehensive Transthoracic Echocardiographic Examination in Adults: Recommendations from the American Society of Echocardiography',
  shortTitle: 'ASE comprehensive adult TTE guideline',
  label: 'ASE 2019 · Table 2',
  organization: 'American Society of Echocardiography',
  authors: 'Mitchell et al.',
  year: 2019,
  journal: 'Journal of the American Society of Echocardiography 32(1):1–64',
  doi: '10.1016/j.echo.2018.06.004',
  url: TTE_PDF,
  pdfUrl: TTE_PDF,
  table: 'Table 2',
  tableTitle: 'Two-dimensional images and clips for imaging protocol',
  pages: [19, 20, 21, 22, 23, 24, 25],
  count: 28,
  scopeNote: 'Table 2 has 27 numbered items, with 2.10 split into a and b: 28 named view entries. The A5C entry includes an optional additional RVOT variant. Videos 39–68 illustrate the protocol. Doppler, M-mode and measurement protocols are separate tables.',
  publicationNote: 'The journal publication is January 2019. The 2025 directory in this PDF URL is an upload location; the supplied early-online PDF carries a 2018 footer.'
});

export const TTE_ATLAS_GROUPS = Object.freeze([
  { id: 'parasternal-long', name: 'Parasternal long axis', count: 6 },
  { id: 'parasternal-short', name: 'Parasternal short axis', count: 8 },
  { id: 'apical', name: 'Apical', count: 10 },
  { id: 'subcostal', name: 'Subcostal', count: 3 },
  { id: 'suprasternal', name: 'Suprasternal', count: 1 }
]);

const PARASTERNAL_POSITION = 'Left parasternal window, usually with the patient in the left lateral position';
const APICAL_POSITION = 'Apical impulse, usually with the patient in the left lateral position';
const SUBCOSTAL_POSITION = 'Below the xiphoid with the patient supine';
const APPROXIMATE_COVERAGE = 'The probe and plane are educational approximations. This excised-heart scan is not registered to a chest wall, and visible specimen anatomy may not reproduce the complete clinical view.';

const records = [
  {
    id: 'plax_deep', tableRow: '2.1', tablePage: 19, group: 'parasternal-long',
    code: 'PLAX · Deep', name: 'Parasternal long axis — increased depth', shortName: 'PLAX · deep survey',
    position: PARASTERNAL_POSITION, marker: 'Toward the right shoulder', markerShort: 'Right shoulder',
    maneuvers: ['Obtain a long-axis plane through the left heart.', 'Increase imaging depth to survey the tissues beyond the posterior heart.'],
    description: 'A wider-depth long-axis survey includes the pericardial and adjacent pleural spaces.',
    teachingPoint: 'Survey beyond the heart before reducing depth for the focused cardiac acquisitions.',
    anatomy: ['LV', 'LA', 'Mitral valve', 'Aortic root', 'Pericardial space', 'Pleural space'],
    videoNumbers: [39], acquisitionPages: [24, 25],
    coverageNote: 'The clinical survey includes pericardial and pleural spaces absent from this excised-heart acquisition. The displayed probe and specimen plane are approximate.'
  },
  {
    id: 'plax', tableRow: '2.2', tablePage: 19, group: 'parasternal-long',
    code: 'PLAX', name: 'Parasternal long axis — left ventricle', shortName: 'PLAX · left ventricle',
    position: PARASTERNAL_POSITION, marker: 'Toward the right shoulder', markerShort: 'Right shoulder',
    maneuvers: ['Align the scan with the LV long axis.', 'Adjust tilt and rotation until the septum and posterior wall are shown without obliquity.'],
    description: 'The standard long-axis plane relates the LV, mitral valve and LV outflow tract to the aortic valve and left atrium.',
    teachingPoint: 'A true parasternal long-axis view generally does not include the LV apex.',
    anatomy: ['LA', 'Mitral valve', 'LV', 'LVOT', 'Aortic valve', 'Interventricular septum', 'RV'],
    videoNumbers: [40], acquisitionPages: [24, 25]
  },
  {
    id: 'plax_av', tableRow: '2.3', tablePage: 19, group: 'parasternal-long',
    code: 'PLAX · AV', name: 'Parasternal long axis — aortic valve zoom', shortName: 'PLAX · aortic valve',
    position: PARASTERNAL_POSITION, marker: 'Toward the right shoulder; refine alignment for the LVOT and aortic root', markerShort: 'Right shoulder',
    maneuvers: ['Optimize the LVOT and aortic-root long axis; a higher interspace may help.', 'Use a focused region that retains the valve, sinuses and proximal ascending aorta.'],
    description: 'A valve-centered long-axis acquisition shows the aortic leaflets and their relationship to the LVOT and root.',
    teachingPoint: 'The best aortic-root alignment can differ from the best LV long-axis alignment.',
    anatomy: ['Aortic valve', 'LVOT', 'Aortic root', 'Sinotubular junction', 'Proximal ascending aorta'],
    videoNumbers: [41], acquisitionPages: [25]
  },
  {
    id: 'plax_mv', tableRow: '2.4', tablePage: 19, group: 'parasternal-long',
    code: 'PLAX · MV', name: 'Parasternal long axis — mitral valve zoom', shortName: 'PLAX · mitral valve',
    position: PARASTERNAL_POSITION, marker: 'Toward the right shoulder', markerShort: 'Right shoulder',
    maneuvers: ['Center the long-axis image on the mitral valve.', 'Keep the annulus, complete leaflet excursion and proximal chordae within the zoom region.'],
    description: 'A focused long-axis acquisition displays the mitral apparatus and the adjacent left atrium.',
    teachingPoint: 'Maintain the full range of leaflet motion when selecting the zoom region.',
    anatomy: ['Mitral valve', 'Mitral annulus', 'Chordae', 'LA', 'LV'],
    videoNumbers: [42], acquisitionPages: [25]
  },
  {
    id: 'plax_rvot', tableRow: '2.5', tablePage: 19, group: 'parasternal-long',
    code: 'PLAX · RVOT', name: 'Parasternal long axis — RV outflow', shortName: 'PLAX · RV outflow',
    position: PARASTERNAL_POSITION, marker: 'Begin toward the right shoulder, then make a small clockwise adjustment as needed', markerShort: 'Right shoulder → adjust',
    maneuvers: ['Tilt anteriorly from the LV long-axis view.', 'Refine rotation to follow the RV outflow tract through the pulmonary valve.'],
    description: 'An anteriorly directed parasternal plane follows the RV outflow tract into the pulmonary artery.',
    teachingPoint: 'Follow the outflow tract across the pulmonary valve; include the main pulmonary artery when the window permits.',
    anatomy: ['RVOT', 'Pulmonary valve', 'Main pulmonary artery'],
    videoNumbers: [43], acquisitionPages: [25]
  },
  {
    id: 'plax_rvin', tableRow: '2.6', tablePage: 20, group: 'parasternal-long',
    code: 'PLAX · RV inflow', name: 'Parasternal long axis — RV inflow', shortName: 'PLAX · RV inflow',
    position: PARASTERNAL_POSITION, marker: 'Begin toward the right shoulder; refine with slight counterclockwise rotation', markerShort: 'Right shoulder → adjust',
    maneuvers: ['Direct the scan inferiorly toward the right hip.', 'Refine tilt and rotation to include the right atrium, tricuspid valve and RV inflow.'],
    description: 'The inflow plane connects the right atrium to the RV through the tricuspid valve.',
    teachingPoint: 'Use the tricuspid valve and right atrium to distinguish the inflow acquisition from the outflow acquisition.',
    anatomy: ['RA', 'Tricuspid valve', 'RV'],
    videoNumbers: [44], acquisitionPages: [25]
  },
  {
    id: 'psax_great', tableRow: '2.7', tablePage: 20, group: 'parasternal-short',
    code: 'PSAX · Great vessels', name: 'Parasternal short axis — great vessels, pulmonary focus', shortName: 'PSAX · great vessels',
    position: PARASTERNAL_POSITION, marker: 'Toward the left shoulder after rotating from parasternal long axis', markerShort: 'Left shoulder',
    maneuvers: ['Rotate approximately 90° clockwise from the long-axis orientation.', 'Tilt superiorly to show the pulmonary valve, pulmonary artery and branches; a higher interspace may help.'],
    description: 'The superior short-axis survey emphasizes the pulmonary outflow and great-vessel relationships.',
    teachingPoint: 'Keep the wider great-vessel survey distinct from the more tightly focused pulmonary-valve acquisition.',
    anatomy: ['Aorta', 'RA', 'RVOT', 'Pulmonary valve', 'Main pulmonary artery', 'Pulmonary artery branches'],
    videoNumbers: [45], acquisitionPages: [25]
  },
  {
    id: 'psax_av', tableRow: '2.8', tablePage: 20, group: 'parasternal-short',
    code: 'PSAX · AV level', name: 'Parasternal short axis — aortic valve level', shortName: 'PSAX · aortic level',
    position: PARASTERNAL_POSITION, marker: 'Toward the left shoulder', markerShort: 'Left shoulder',
    maneuvers: ['Use the short-axis orientation and tilt to the aortic-valve level.', 'Retain the surrounding atria and right-heart structures.'],
    description: 'The aortic valve forms the center of a basal short-axis view with the atria and right-heart inflow and outflow around it.',
    teachingPoint: 'A surrounding-anatomy view complements the separate aortic leaflet zoom.',
    anatomy: ['Aortic valve', 'LA', 'RA', 'Tricuspid valve', 'RVOT', 'Pulmonary valve', 'Interatrial septum'],
    videoNumbers: [46], acquisitionPages: [25]
  },
  {
    id: 'psax_av_zoom', tableRow: '2.9', tablePage: 20, group: 'parasternal-short',
    code: 'PSAX · AV zoom', name: 'Parasternal short axis — aortic valve zoom', shortName: 'PSAX · aortic zoom',
    position: PARASTERNAL_POSITION, marker: 'Toward the left shoulder', markerShort: 'Left shoulder',
    maneuvers: ['Center the aortic valve in the basal short-axis plane.', 'Reduce the region of interest while keeping all leaflet margins in view.'],
    description: 'An aortic-valve zoom demonstrates the leaflet arrangement and opening in short axis.',
    teachingPoint: 'Assess leaflet number and motion without cutting obliquely through the valve.',
    anatomy: ['Noncoronary aortic cusp', 'Right coronary aortic cusp', 'Left coronary aortic cusp'],
    videoNumbers: [47], acquisitionPages: [25]
  },
  {
    id: 'psax_tv', tableRow: '2.10a', tablePage: 20, group: 'parasternal-short',
    code: 'PSAX · TV', name: 'Parasternal short axis — tricuspid valve focus', shortName: 'PSAX · tricuspid',
    position: PARASTERNAL_POSITION, marker: 'Toward the left shoulder; refine tilt around the tricuspid valve', markerShort: 'Left shoulder',
    maneuvers: ['Begin at the great-vessel short-axis level.', 'Center the tricuspid valve and retain the right atrium and RV inflow.'],
    description: 'A right-heart focused basal short-axis acquisition shows the tricuspid valve between the RA and RV.',
    teachingPoint: 'Include the full valve motion and adjacent right-heart chambers in the focused acquisition.',
    anatomy: ['RA', 'Tricuspid valve', 'RV'],
    videoNumbers: [48], acquisitionPages: [26]
  },
  {
    id: 'psax_pv', tableRow: '2.10b', tablePage: 21, group: 'parasternal-short',
    code: 'PSAX · PV / PA', name: 'Parasternal short axis — pulmonary valve and artery focus', shortName: 'PSAX · pulmonary',
    position: PARASTERNAL_POSITION, marker: 'Toward the left shoulder; refine the pulmonary outflow plane', markerShort: 'Left shoulder',
    maneuvers: ['Tilt from the basal short-axis view toward the pulmonary outflow.', 'Focus the region on the RVOT, pulmonary valve and proximal pulmonary artery.'],
    description: 'The pulmonary-focused acquisition follows the RVOT through the pulmonary valve into the pulmonary artery.',
    teachingPoint: 'This focused entry is separately labeled 2.10b in Table 2.',
    anatomy: ['RVOT', 'Pulmonary valve', 'Pulmonary artery', 'Aorta'],
    videoNumbers: [49], acquisitionPages: [25]
  },
  {
    id: 'psax_mitral', tableRow: '2.11', tablePage: 21, group: 'parasternal-short',
    code: 'PSAX · MV', name: 'Parasternal short axis — mitral valve level', shortName: 'PSAX · mitral level',
    position: PARASTERNAL_POSITION, marker: 'Toward the left shoulder', markerShort: 'Left shoulder',
    maneuvers: ['Tilt inferiorly from the great-vessel plane.', 'Cross the mitral leaflet level while keeping the LV section close to circular.'],
    description: 'A basal ventricular short-axis section displays both mitral leaflets inside the LV and the adjacent RV.',
    teachingPoint: 'Separate the leaflet-level section from the more apical papillary-muscle section.',
    anatomy: ['RV', 'Interventricular septum', 'Anterior mitral leaflet', 'Posterior mitral leaflet', 'LV'],
    videoNumbers: [50], acquisitionPages: [26]
  },
  {
    id: 'psax_papillary', tableRow: '2.12', tablePage: 21, group: 'parasternal-short',
    code: 'PSAX · Papillary', name: 'Parasternal short axis — papillary muscle level', shortName: 'PSAX · papillary',
    position: PARASTERNAL_POSITION, marker: 'Toward the left shoulder', markerShort: 'Left shoulder',
    maneuvers: ['Tilt inferiorly from the mitral leaflet plane.', 'Select a midventricular section containing both LV papillary muscle groups.'],
    description: 'The midventricular short-axis target shows the LV wall, septum and papillary muscle groups with the RV alongside.',
    teachingPoint: 'A round LV section helps avoid an oblique assessment of regional contraction.',
    anatomy: ['LV', 'RV', 'Interventricular septum', 'Anterolateral papillary muscle', 'Posteromedial papillary muscle'],
    videoNumbers: [51], acquisitionPages: [26],
    coverageNote: 'In LADAF-2021-17, the LV is collapsed and paired LV papillary muscles are unconfirmed. Other donors require independent anatomical confirmation of this clinical papillary-level target.'
  },
  {
    id: 'psax_apical', tableRow: '2.13', tablePage: 21, group: 'parasternal-short',
    code: 'PSAX · Apex', name: 'Parasternal short axis — apical level', shortName: 'PSAX · apex',
    position: PARASTERNAL_POSITION, marker: 'Toward the left shoulder', markerShort: 'Left shoulder',
    maneuvers: ['Tilt inferiorly beyond the papillary muscle level.', 'Slide the probe inferiorly or laterally if needed to reach a true apical short-axis section.'],
    description: 'A distal ventricular short-axis section samples the LV near its apex.',
    teachingPoint: 'Avoid letting an oblique slice imitate an apical short-axis view.',
    anatomy: ['LV apex', 'Apical LV myocardium'],
    videoNumbers: [52], acquisitionPages: [26]
  },
  {
    id: 'a4c', tableRow: '2.14', tablePage: 21, group: 'apical',
    code: 'A4C', name: 'Apical four-chamber', shortName: 'Four-chamber',
    position: APICAL_POSITION, marker: 'Toward the bed in the guideline acquisition position', markerShort: 'Toward the bed',
    maneuvers: ['Locate the true apical impulse and direct the beam toward the cardiac base.', 'Maximize LV length while retaining both atrioventricular valves and both atria.'],
    description: 'The four-chamber acquisition shows both ventricles and atria, the atrioventricular valves and the septa.',
    teachingPoint: 'Use the true apex and avoid foreshortening or anterior tilt that introduces the LVOT.',
    anatomy: ['LA', 'Mitral valve', 'LV', 'Interventricular septum', 'RV', 'Tricuspid valve', 'RA', 'Interatrial septum'],
    videoNumbers: [53], acquisitionPages: [26]
  },
  {
    id: 'a4c_lv', tableRow: '2.15', tablePage: 22, group: 'apical',
    code: 'A4C · LV', name: 'Apical four-chamber — LV zoom', shortName: 'Four-chamber · LV',
    position: APICAL_POSITION, marker: 'Maintain the four-chamber orientation toward the bed', markerShort: 'A4C orientation',
    maneuvers: ['Preserve a nonforeshortened four-chamber plane.', 'Optimize depth, sector width and focus for the LV.'],
    description: 'The LV-focused four-chamber acquisition improves visualization of the ventricular cavity and walls.',
    teachingPoint: 'Keep the complete apex and mitral annulus within the focused image.',
    anatomy: ['LV', 'Mitral annulus', 'LV apex', 'Interventricular septum'],
    videoNumbers: [54], acquisitionPages: [26]
  },
  {
    id: 'a4c_rv', tableRow: '2.16', tablePage: 22, group: 'apical',
    code: 'A4C · RV', name: 'Apical four-chamber — RV focus', shortName: 'Four-chamber · RV',
    position: APICAL_POSITION, marker: 'Refine the four-chamber orientation with slight counterclockwise rotation', markerShort: 'A4C → RV focus',
    maneuvers: ['Adjust rotation to maximize the RV cavity and lateral dimension.', 'Keep the ventricular apex in view and avoid anterior angulation into a five-chamber plane.'],
    description: 'A dedicated apical acquisition enlarges the right ventricle and its inflow while preserving four-chamber context.',
    teachingPoint: 'The RV-focused plane requires its own optimization; a standard LV-centered four-chamber view can underestimate RV size.',
    anatomy: ['RA', 'Tricuspid valve', 'RV', 'LA', 'LV'],
    videoNumbers: [55], acquisitionPages: [26]
  },
  {
    id: 'a5c', tableRow: '2.17', tablePage: 22, group: 'apical',
    code: 'A5C', name: 'Apical five-chamber', shortName: 'Five-chamber',
    position: APICAL_POSITION, marker: 'Maintain the four-chamber rotational orientation', markerShort: 'A4C + anterior tilt',
    maneuvers: ['Tilt anteriorly from the four-chamber acquisition until the LVOT and aortic valve enter the plane.', 'Further anterior tilt can show RV outflow as an optional additional variant.'],
    description: 'Anterior angulation adds the LV outflow tract and aortic valve to the apical chamber view.',
    teachingPoint: 'Table 2 includes an additional RVOT panel; the text describes that further-anterior variant as outside the normal routine examination.',
    anatomy: ['LA', 'Mitral valve', 'LV', 'Interventricular septum', 'LVOT', 'Aortic valve', 'RA', 'RV'],
    videoNumbers: [56, 57], acquisitionPages: [26],
    variants: [
      { tablePanel: '2.17a', label: 'LVOT and aortic valve', videoNumbers: [56], routine: true },
      { tablePanel: '2.17b', label: 'Further anterior RVOT, pulmonary valve and pulmonary artery', videoNumbers: [57], routine: false }
    ],
    sourceNote: 'The acquisition prose on PDF page 26 specifies tilting from A4C; the first Table 2 panel appears to repeat A5C in its starting-view wording.'
  },
  {
    id: 'a4c_cs', tableRow: '2.18', tablePage: 22, group: 'apical',
    code: 'A4C · CS', name: 'Apical four-chamber — posterior angulation', shortName: 'Four-chamber · coronary sinus',
    position: APICAL_POSITION, marker: 'Maintain four-chamber rotation and tilt posteriorly', markerShort: 'A4C + posterior tilt',
    maneuvers: ['Tilt posteriorly from four-chamber.', 'Follow the coronary sinus behind the atrioventricular junction toward its right atrial opening.'],
    description: 'Posterior angulation brings the coronary sinus into the plane between the left atrium and ventricle.',
    teachingPoint: 'The tubular coronary sinus replaces the mitral-valve appearance as the plane moves posteriorly.',
    anatomy: ['Coronary sinus', 'RA', 'RV', 'LV', 'LA'],
    videoNumbers: [58], acquisitionPages: [26],
    coverageNote: 'The plane is an educational approximation; a named coronary-sinus lumen and ostium are not established in every donor reconstruction.'
  },
  {
    id: 'a2c', tableRow: '2.19', tablePage: 23, group: 'apical',
    code: 'A2C', name: 'Apical two-chamber', shortName: 'Two-chamber',
    position: APICAL_POSITION, marker: 'Rotate approximately 60° counterclockwise from the four-chamber orientation', markerShort: 'A4C → counterclockwise',
    maneuvers: ['Keep the probe over the true apex while rotating from four-chamber.', 'Optimize LV length and the LA–mitral–LV alignment.'],
    description: 'The two-chamber plane isolates the left atrium, mitral valve and left ventricle.',
    teachingPoint: 'Retain the true LV apex as the plane rotates away from four-chamber.',
    anatomy: ['LV', 'Mitral valve', 'LA'],
    videoNumbers: [59], acquisitionPages: [30]
  },
  {
    id: 'a2c_lv', tableRow: '2.20', tablePage: 23, group: 'apical',
    code: 'A2C · LV', name: 'Apical two-chamber — LV zoom', shortName: 'Two-chamber · LV',
    position: APICAL_POSITION, marker: 'Maintain the optimized two-chamber orientation', markerShort: 'A2C orientation',
    maneuvers: ['Preserve the long, nonforeshortened two-chamber LV plane.', 'Optimize depth, sector width and focus around the entire LV.'],
    description: 'A dedicated LV acquisition concentrates on the cavity and walls in the two-chamber plane.',
    teachingPoint: 'Include the mitral annulus and true apex together in the focused view.',
    anatomy: ['LV', 'Mitral annulus', 'LV apex'],
    videoNumbers: [60], acquisitionPages: [30]
  },
  {
    id: 'a3c', tableRow: '2.21', tablePage: 23, group: 'apical',
    code: 'A3C', name: 'Apical long axis — three-chamber', shortName: 'Three-chamber',
    position: APICAL_POSITION, marker: 'Rotate approximately a further 60° counterclockwise from two-chamber', markerShort: 'A2C → counterclockwise',
    maneuvers: ['Continue rotating from two-chamber while keeping the probe at the apex.', 'Include the mitral valve, LVOT and aortic valve along the LV long axis.'],
    description: 'The apical long-axis plane relates the left atrium and ventricle to both left-sided valves.',
    teachingPoint: 'This is the apical long-axis entry in Table 2, commonly called three-chamber.',
    anatomy: ['LA', 'Mitral valve', 'LV', 'LVOT', 'Aortic valve'],
    videoNumbers: [61], acquisitionPages: [30]
  },
  {
    id: 'a3c_lv', tableRow: '2.22', tablePage: 23, group: 'apical',
    code: 'A3C · LV', name: 'Apical long axis — LV zoom', shortName: 'Three-chamber · LV',
    position: APICAL_POSITION, marker: 'Maintain the optimized apical long-axis orientation', markerShort: 'A3C orientation',
    maneuvers: ['Retain the true apex in the apical long-axis plane.', 'Optimize the acquisition settings for the LV cavity and walls.'],
    description: 'The LV-focused apical long-axis acquisition complements the full three-chamber view.',
    teachingPoint: 'Zoom improves the LV presentation without changing the underlying long-axis target.',
    anatomy: ['LV', 'LV apex', 'Mitral annulus', 'LVOT'],
    videoNumbers: [62], acquisitionPages: [30]
  },
  {
    id: 'a4c_la_pv', tableRow: '2.23', tablePage: 24, group: 'apical',
    code: 'A4C · LA / PV', name: 'Apical four-chamber — left atrial and pulmonary vein focus', shortName: 'Four-chamber · LA / veins',
    position: APICAL_POSITION, marker: 'Start in four-chamber, then refine the atrial and pulmonary venous plane', markerShort: 'A4C → atrial focus',
    maneuvers: ['Optimize atrial length and width independently of the LV-focused plane.', 'Adjust depth and focus to include the LA and pulmonary venous entries.'],
    description: 'An atrial-centered apical acquisition demonstrates the left atrium and pulmonary venous inflow region.',
    teachingPoint: 'The best atrial plane may differ from the best LV plane; Table 2 supplies two example clips for this entry.',
    anatomy: ['Pulmonary veins', 'LA', 'Mitral valve', 'LV', 'RA', 'Tricuspid valve', 'RV'],
    videoNumbers: [63, 64], acquisitionPages: [30],
    coverageNote: 'Clinical pulmonary venous entries are acquisition targets. Named pulmonary vein ostia are not validated in the specimen correspondence.'
  },
  {
    id: 'subcostal', tableRow: '2.24', tablePage: 24, group: 'subcostal',
    code: 'SC · 4C', name: 'Subcostal four-chamber', shortName: 'Subcostal · four-chamber',
    position: SUBCOSTAL_POSITION, marker: 'Toward the patient’s left; direct the transducer face toward the left shoulder', markerShort: 'Patient’s left',
    maneuvers: ['Use the liver as the acoustic window and direct the scan toward the heart.', 'A held inspiration and bent knees can improve the window.'],
    description: 'The subcostal window demonstrates all four chambers with a useful near-perpendicular view of the atrial septum.',
    teachingPoint: 'Distinguish marker direction from the direction in which the transducer face is aimed.',
    anatomy: ['LV', 'Mitral valve', 'RV', 'Tricuspid valve', 'Interatrial septum', 'Interventricular septum', 'RA', 'LA'],
    videoNumbers: [65], acquisitionPages: [5, 31],
    sourceNote: 'The acquisition prose specifies marker toward the patient’s left and face toward the left shoulder; Table 2 uses shorter left-shoulder wording.'
  },
  {
    id: 'subcostal_ivc', tableRow: '2.25', tablePage: 24, group: 'subcostal',
    code: 'SC · IVC', name: 'Subcostal long axis — inferior vena cava', shortName: 'Subcostal · IVC',
    position: SUBCOSTAL_POSITION, marker: 'Rotate approximately 90° counterclockwise from subcostal four-chamber into a longitudinal caval plane', markerShort: 'Longitudinal IVC plane',
    maneuvers: ['Turn from the four-chamber plane and angle through the liver to the IVC.', 'Follow the IVC to the right atrium and acquire across respiration.'],
    description: 'A longitudinal subcostal acquisition follows the inferior vena cava into its right atrial junction.',
    teachingPoint: 'Keep the IVC continuous with the RA so an adjacent vessel is not mistaken for the caval lumen.',
    anatomy: ['Inferior vena cava', 'IVC–RA junction', 'RA'],
    videoNumbers: [66], acquisitionPages: [31], scanCoverage: 'outside',
    coverageNote: 'The abdominal IVC and liver are outside this excised-heart scan. The clinical target and external probe context are shown without fabricating a matching CT section.'
  },
  {
    id: 'subcostal_hepatic', tableRow: '2.26', tablePage: 24, group: 'subcostal',
    code: 'SC · Hepatic veins', name: 'Subcostal hepatic veins', shortName: 'Subcostal · hepatic veins',
    position: SUBCOSTAL_POSITION, marker: 'Refine the longitudinal IVC orientation toward the hepatic venous inflow', markerShort: 'IVC → hepatic veins',
    maneuvers: ['Begin with the subcostal IVC long-axis acquisition.', 'Angle slightly rightward and rock superiorly to show hepatic veins joining the IVC.'],
    description: 'The hepatic venous acquisition shows venous channels entering the IVC through the liver.',
    teachingPoint: 'Use visible continuity with the IVC to establish the hepatic venous target.',
    anatomy: ['Inferior vena cava', 'Hepatic veins'],
    videoNumbers: [67], acquisitionPages: [31], scanCoverage: 'outside',
    coverageNote: 'The liver and hepatic veins are outside the specimen acquisition. The model provides external anatomical context, with no donor CT section claimed for these structures.'
  },
  {
    id: 'ssn_arch', tableRow: '2.27', tablePage: 25, group: 'suprasternal',
    code: 'SSN · Arch', name: 'Suprasternal notch — aortic arch', shortName: 'Suprasternal · arch',
    position: 'Suprasternal notch with the patient supine and the neck gently extended',
    marker: 'Begin superiorly, then rotate toward the left shoulder to align the arch', markerShort: 'Toward left shoulder',
    maneuvers: ['Direct the transducer inferiorly from the suprasternal notch.', 'Refine rotation and tilt to connect the ascending, transverse and descending aorta and show the arch branches.'],
    description: 'The suprasternal long-axis acquisition follows the aortic arch and its major branches.',
    teachingPoint: 'Identify continuity around the arch before interpreting the individual branch origins.',
    anatomy: ['Ascending aorta', 'Transverse aortic arch', 'Descending aorta', 'Brachiocephalic artery', 'Left common carotid artery', 'Left subclavian artery'],
    videoNumbers: [68], acquisitionPages: [31], scanCoverage: 'outside',
    coverageNote: 'The complete aortic arch, neck and arch branches are outside this excised-heart scan. External anatomy is contextual, and no matching donor CT section is fabricated.'
  }
];

export const TTE_ATLAS_VIEWS = Object.freeze(records.map((view, index) => Object.freeze({
  mode: 'tte',
  tableOrder: index + 1,
  scanCoverage: 'partial',
  coverageNote: APPROXIMATE_COVERAGE,
  specificCoverage: Boolean(view.coverageNote),
  ...view,
  sourceUrl: `${TTE_PDF}#page=${view.tablePage}`,
  sourceTable: `ASE 2019, Table 2, row ${view.tableRow} (PDF p. ${view.tablePage})`,
  ...referenceArtworkPaths('tte', view.id)
})));
