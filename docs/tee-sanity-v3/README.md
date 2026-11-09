# TEE regional-anatomy sanity audit v3

## Outcome

All **28** TEE entries were reviewed: **24** acquired CT sections and **4** targets outside the isolated-heart scan. The current v2 physical planes are retained. The consequential correction is to the **TG midpapillary** explanation: the conspicuous open cavity and separated muscular profiles are in the **RV**, not evidence of a pair of LV papillary muscles. The LV is present but collapsed. The new per-view catalog makes that uncertainty visible.

The resulting dispositions are **13 supported regional comparisons, 7 partial comparisons, 4 unconfirmed exact named targets, and 4 outside the acquired volume**. “Supported” describes broad regional anatomy and continuity. It is not expert, diagnostic, probe-placement, leaflet or patient-specific acoustic validation.

The four unconfirmed named targets are the right pulmonary-vein, bilateral pulmonary-vein, left atrial appendage and bicaval views. Their real clinical ultrasound examples remain useful. Their CT images must be presented as regional anatomy comparisons, not verified examples of those exact targets.

## Clinical target and evidence

The clinical target families were checked against [ASE/SCA 2013 comprehensive TEE guidance, Table 10 and view descriptions](https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf). In particular, right-heart inflow–outflow targets require the RV/atrioventricular region and pulmonary outflow relationship; TG RV basal adds a tricuspid short-axis target. The deep TG target concerns LV outflow/aortic alignment. A ventricular tissue fraction alone cannot establish any of these relationships.

The current ME RV inflow–outflow and TG RV inflow–outflow sections already show a coherent right-heart pathway: RA/RV tissue, muscular outflow and pulmonary-root tissue, with the aortic root as an adjacent landmark. Their source sections contain only about 0.4% LV-labelled tissue under the audit threshold. TG RV inflow and basal cuts legitimately cross the shared septal/LV region; more LV-labelled tissue there is not sufficient evidence of the wrong ventricle.

This audit concerns the exact measured source planes. Runtime camera, clipping, annotation gating and rendering consistency are integrated and tested separately. It does not replace the independently performed main-viewer preset review.

## Source and segmentation scope

- **Specimen:** LADAF-2021-17; dataset 1659197537.
- **Scalar bank:** `public/assets/volume-v5/heart-high-clean.raw.gz`; decoded 475 × 475 × 530 uint8 voxels at 317.6 µm. Values are the existing windowed display source, not calibrated HU.
- **Decoded scalar SHA-256:** `10d8120c59b978528c8373fe2c0fd5cd404c843fd91e7df75e7c0c7566cdf82f`.
- **Segmentation:** manifest revision `la-exterior-v17`, 317 × 317 × 354. Labels are endpoint-registered to the source grid using the same convention as the viewer.
- **Decoded label SHA-256:** `e29a218fdf42947a550b2c73711f66cbc4aaa0daca852f55529859e4fdb6ac54`.
- **Label meanings:** 1 LV, 2 RV, 3 LA, 4 RA, 5 aortic root/wall, 6 pulmonary root/wall; 0 neutral. They denote approximate **tissue ownership**, not filled blood pools or independent chamber-volume measurements.
- **Shared septum:** the compact core is assigned to LV; approximately 1.9 mm of the RV-facing layer is assigned to RV in the annotation convention. Consequently, a right-heart plane can contain substantial LV-labelled septal tissue.
- **Unresolved identities:** no separate expert-validated valve, cusp, papillary, chordal, pulmonary-vein, caval-ostial or appendage labels are available. Regional labels alone cannot establish those structures.

The source and label arrays were hash-checked and read only. No scalar, mask, segmentation, previous acquisition asset or production plane was changed by this audit. See `docs/anatomy-v12/README.md` and `docs/anatomy-v17-la/README.md` for the regional annotation provenance and its limits.

## Review method

1. Resample each of the 24 exact current world frames from `public/assets/tee-atlas/plane-fit-v2.json`. Use trilinear scalar interpolation and nearest-neighbor categorical labels, with a common fixed display transform.
2. Inspect the untinted measured section beside the same section with regional tint. Record source-tissue area, fractions and proximity to the approximate cavity tracks as screening evidence. The cavity tracks themselves are approximate and do not validate valves or vessels.
3. Revisit **135 TG candidate entries** across five high-risk families: midpapillary (22), apical (22), basal LV (37), basal RV (27) and RV inflow (27). This count includes the five current frames and repeated prior candidates; it is not a count of independent clinical validations. The mid/apical candidates span ±4 mm and ±4° from the prior level; RV neighborhoods use ±8° local rotations and ±2 mm normal displacement. The basal candidates reuse the prior source-grounded level/tilt exploration.
4. Judge the intended anatomic relation rather than maximize a label ratio. In RV inflow neighbors, a higher RV fraction can remove useful atrioventricular detail. In TG basal neighbors, moving the plane can enter the aortic root or pass below the intended basal level. No tested replacement was more defensible than the current regional comparisons.
5. Downgrade exact claims when the defining structure remains unconfirmed. In particular, none of the 21 nearby TG midpapillary alternatives establishes an identifiable pair of LV papillary muscles from the existing source/labels. Its midventricular plane remains useful, with explicit RV/LV identification.

This is a bounded source review, not proof that a global mathematical optimum or an ideal living-heart TEE plane has been found. Fixed-specimen collapse and unavailable extracardiac acquisition limit the possible correspondence.

## Per-view disposition

| ASE # | Entry | CT support | Visible finding and remaining target limitation |
|---:|---|---|---|
| 1 | `me5c` — Midesophageal five-chamber | supported | The section includes both atrial and ventricular regions and opens the LV outflow into the aortic root. The fixed LV cavity is narrower than the live ultrasound example. |
| 2 | `me4c` — Midesophageal four-chamber | supported | Both atrial and ventricular regions cross the section, with the aortic outflow excluded. The large open cavity is RV; the thick, collapsed cavity beside it is LV. |
| 3 | `mecommissural` — Midesophageal mitral commissural | partial | The section follows the LA–mitral–LV region, with little right-ventricular tissue. The defining mitral commissures and leaflet scallops cannot be confirmed in this CT section. |
| 4 | `me2c` — Midesophageal two-chamber | supported | A longitudinal LV–LA section is present, with the right ventricle and aortic root largely excluded. The narrow LV lumen reflects the preserved specimen. |
| 5 | `melax` — Midesophageal long-axis | supported | The LV, LA and aortic-root pathway are present in a longitudinal section. The LV cavity is collapsed, so its outline differs from the ultrasound reference. |
| 6 | `meavlax` — Midesophageal aortic valve long-axis | supported | The aortic root is cut lengthwise where it joins the LV outflow. Adjacent LV, LA and RV tissue is retained as context. |
| 7 | `meaaolax` — Midesophageal ascending aorta long-axis | supported | The acquired ascending-aortic segment is cut lengthwise. The neighboring pulmonary root and left atrial region are also visible; the scan does not contain the full arch. |
| 8 | `meaaosax` — Midesophageal ascending aorta short-axis | partial | An ascending-aortic cross-section is present beside the larger pulmonary-root section. A separate superior vena cava is not confirmed. |
| 9 | `merpv` — Midesophageal right pulmonary vein | unsupported | This is a left-atrial neighborhood section. The named right pulmonary-vein ostia are not identified, so the CT is not a confirmed right pulmonary-vein view. |
| 10 | `meavsax` — Midesophageal aortic valve short-axis | supported | The section crosses the aortic root at a cusp-like short-axis profile, surrounded by atrial and right-ventricular regions. |
| 11 | `mervinout` — Midesophageal RV inflow-outflow | supported | The RA and RV inflow region connect to an RV outflow and pulmonary-root region in this section. The aortic root is a central landmark; very little LV-labelled tissue is included. |
| 12 | `memodbicaval` — Midesophageal modified bicaval tricuspid valve | partial | RA, tricuspid-region and RV tissue are present. The superior and inferior caval entries are not both confirmed, so this is a partial comparison to the modified bicaval view. |
| 13 | `bicaval` — Midesophageal bicaval | unsupported | Both atrial regions are present, but the SVC and IVC openings are not identified together. This CT section is not a confirmed bicaval view. |
| 14 | `mepv` — Midesophageal right and left pulmonary veins | unsupported | The section samples the left atrial neighborhood. Right and left pulmonary-vein ostia cannot be distinguished reliably, so the named pulmonary-vein view is unconfirmed in CT. |
| 15 | `melaa` — Midesophageal left atrial appendage | unsupported | Left atrial tissue is visible, but an appendage with confirmed ostial continuity is not established. This CT section is not a verified LAA view. |
| 16 | `tgbasalsax` — Transgastric basal short-axis | partial | The section crosses the basal LV and mitral region, with the RV beside it. A basal opening is visible, but a complete mitral fish-mouth profile is not confirmed. |
| 17 | `tgpapillary` — Transgastric midpapillary short-axis | partial | The LV cavity is narrow and collapsed. The larger open cavity and prominent separated muscular profiles belong to RV; paired LV papillary muscles are not confirmed in this fixed specimen. |
| 18 | `tgapicalsax` — Transgastric apical short-axis | supported | This more distal section crosses the LV apex region with an adjacent RV crescent. The LV cavity is almost closed in the preserved specimen. |
| 19 | `tgrvbasal` — Transgastric RV basal | partial | The basal RV and tricuspid region are present beside the shared septal/LV tissue. Aortic and pulmonary-root tissue is also visible, but the complete tricuspid short-axis and RVOT combination is not confirmed. |
| 20 | `tgrvinout` — Transgastric RV inflow-outflow | supported | The section contains the RA–RV inflow and the RV outflow/pulmonary-root pathway. It does not substitute an LV-dominant section for the right-heart target. |
| 21 | `deeptg5c` — Deep transgastric five-chamber | partial | The LV outflow and aortic-root pathway are present with four-chamber context. This CT section does not confirm that the modeled deep-transgastric probe can acquire the ideal Doppler-aligned view. |
| 22 | `tg2c` — Transgastric two-chamber | supported | A longitudinal LV–LA section is present with little right-ventricular tissue and no aortic-root section. The collapsed LV lumen is retained as acquired. |
| 23 | `tgrvin` — Transgastric RV inflow | supported | RA and RV tissue surround the inflow pathway. The thick adjacent tissue belongs to the shared septal/LV region, not a second RV cavity. |
| 24 | `tglax` — Transgastric long-axis | supported | The LV, mitral/LA region and aortic outflow are present in a longitudinal section. The gastric presentation is a modeled orientation of the measured anatomy. |
| 25 | `daosax` — Descending aorta short-axis | outside | The descending thoracic aorta is outside this isolated-heart CT acquisition. Learn the target from the clinical ultrasound example and schematic probe context. |
| 26 | `daolax` — Descending aorta long-axis | outside | The descending thoracic aorta is outside this isolated-heart CT acquisition. The heart reconstruction cannot supply a measured long-axis section of that vessel. |
| 27 | `uearchlax` — Upper esophageal aortic arch long-axis | outside | The complete aortic arch and its branches are outside this isolated-heart acquisition. The spatial guide is schematic; the ultrasound example supplies the real target view. |
| 28 | `uearchsax` — Upper esophageal aortic arch short-axis | outside | The aortic arch target is outside this isolated-heart acquisition. A nearby ascending-aortic section must not be presented as the arch short-axis view. |

## Measured tissue anchors

`review-catalog.json` includes **20** anchors across **8** views. Each anchor supplies a region ID, normalized image position, world point, source point and scalar value. Points were selected inside connected labelled **measured tissue**, never inside a filled or inferred cavity. Their names are deliberately regional: “LV tissue”, “RV tissue”, “RA tissue”, and “Pulmonary wall”.

An independent reprojection and scalar/label lookup checked all 20 against the exact retained v2 display frames:

- All anchors are inside the finite frame and match the intended categorical label.
- Minimum sampled scalar: **107 / 255**.
- Minimum interior labelled-tissue margin: **3.21 mm**.
- Maximum distance from the selected plane: **1.3e-07 mm**.
- Maximum normalized display-coordinate discrepancy: **4.9e-07**.

The source sections with anchor dots were visually checked. Rendering must gate them to the corresponding measured section/camera state; these are not floating labels for any arbitrary free-orbit position. The labels explain broad tissue identity and do not imply validated segmentation boundaries.

## Artifacts and reproduction

- `review-catalog.json`: integration-ready per-view status, visible summary, intended versus visible anatomy, limitations and optional tissue anchors. No physical frame override is included.
- `all-view-audit.json`: source/label provenance, 24 exact-frame screening metrics and four outside-volume entries.
- `current-source-labels-1.jpg` through `current-source-labels-4.jpg`: paired untinted/tinted measured source evidence for every acquired view.
- `neighbor-review.json` and five `neighbors-*.jpg` sheets: bounded TG neighborhood evidence with exact candidate world frames.
- `anchors-*.jpg` and `anchor-overview.jpg`: measured-source annotation proofs.
- `anchor-registration-check.json`: independent world-to-frame and source/label validation results.

From the repository root:

```bash
python scripts/tee-sanity-v3/audit.py
python scripts/tee-sanity-v3/review-neighbors.py
python scripts/tee-sanity-v3/make-catalog.py
python scripts/tee-sanity-v3/check-anchors.py
```

These scripts write only to `docs/tee-sanity-v3/`. The existing measured-source utilities in `scripts/tee-plane-qc-v2/common.py` are imported without modifying them. All reviewed 3D and CT planes retain their existing source geometry; this audit supplies stricter, source-backed interpretation.
