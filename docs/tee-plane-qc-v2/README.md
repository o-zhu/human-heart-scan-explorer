# TEE source-plane quality review, v2

This review creates separate, donor-specific approximate TEE frames for the LADAF-2021-17 source volume. The original atlas planes, prepared source textures, voxel bank, anatomical labels, and their provenance remain unchanged. The four thoracic-aortic views remain outside the acquired field of view.

The production result is `public/assets/tee-atlas/plane-fit-v2.json`. It contains **24 reviewed in-scan frames: 14 refined, 2 retained after active comparison, and 8 with explicitly limited anatomical correspondence**. In physical-plane terms, 21 are replaced and 3 are retained: the retained LAA plane is included in the limited status group. “Refined” describes a source-anatomy improvement; it does not mean clinically validated TEE registration.

## Clinical target definition

The target definitions come from the [ASE/SCA 2013 comprehensive TEE guideline](https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf), principally Table 10 and its accompanying acquisition text. `clinical-targets.json` records required structures, continuity, exclusions, and display conventions for all 28 views. Nominal clinical multiplane angles and insertion depths are teaching references, not measurements from this excised donor.

The source anatomy is supported by the [LADAF-2021-17 dataset](https://human-organ-atlas.esrf.fr/datasets/1659197537), the [source-study figure descriptions](https://pmc.ncbi.nlm.nih.gov/articles/PMC10592740/), and the project's earlier independent source reviews. In particular, `docs/anatomy/cavity-tracks.json`, `boundary-landmarks.json`, the reviewed flow-view targets, and existing regional labels provide approximate source-coordinate anchors. They are not expert ground-truth valve, ostial, or chamber segmentations.

## What was wrong in the baseline

The v44 atlas mixed original coarse echo planes with shifted and rotated family approximations. Some defining anatomical targets were consequently missed. The four-chamber starting cut included a substantial aortic-root/outflow profile and missed the approximate AV junctions. The aortic-valve short-axis plane was too ventricular. Basal transgastric LV and RV views reused similar arterial/root-level geometry. The transgastric two-chamber plane contained a long aortic pathway. Several display orientations followed generic inherited axes rather than the corresponding TEE acquisition convention.

The original papillary and apical short-axis planes were better than proposed replacements. They were retained only after broad exploration and 21 nearby measured sections for each view.

## Search method

1. `export-baselines.mjs` recorded all 28 exact v44 frames and their display flags before integration changes. `baselines.json` is the immutable comparison reference for this review.
2. The resident 475 × 475 × 530 high-resolution volume was decoded using its reversible delta-Z predictor. Its decoded SHA-256 was checked against the manifest. This is a **317.6 µm, windowed uint8 display bank**, not calibrated CT Hounsfield units. No source intensities were changed.
3. Each in-scan view began with its original plane and one or more independent anatomical starts. These included fitted AV-junction/apical planes, source-reviewed chamber-flow planes, aortic-centerline planes, and a best-fit plane through the 14 previously reviewed tricuspid hinge observations.
4. Each start explored a 9 × 9 × 9 grid: two angular perturbations from −32° to +32° in 8° increments, and normal offsets from −16 to +16 mm in 4 mm increments. Ten spatially diverse promising candidates received 5 × 5 × 5 follow-up grids spanning ±4° and ±2 mm.
5. Required regional landmark proximity, defining anatomical exclusions, and appropriate long-axis or short-axis orientation prioritized candidates. The inclusion/exclusion checks are geometric gates. A zero failed-gate count does **not** prove anatomical topology or clinical correctness.
6. Source-pixel review exposed a failure of landmark-only scoring: several numerically strong two-chamber candidates included substantial right-heart tissue. ME2C, TG2C, and commissural searches were repeated with measured-tissue regional exclusion checks, rejecting these wrong-family candidates. Existing regional labels served only as broad exclusion aids; they were not used to infer named valves, ostia, or scallops.
7. Aortic long-axis fits were additionally constrained by the measured LA region. A near-collinear aortic centerline alone cannot determine the correct fan azimuth.
8. Every shortlisted comparison was actually resampled from the unchanged resident source bank. Fixed display windowing was used across candidates. Regional tint is an existing approximate annotation overlay; grayscale before/after panels are provided independently.
9. Anatomical appearance overruled ranking cost. The first proposed TG papillary/apical levels were rejected. An adaptive 78-section review examined 42 close neighbors of the original papillary/apical planes and 36 independently oriented basal-level candidates. Basal candidate 11201, derived from the LA–LV interface neighborhood, was selected for its broader mitral-region opening and absence of the previous dominant arterial-root star.

The final search records contain **72,384 evaluated candidate parameter combinations and 539 rendered candidate-source comparisons**. These counts include original candidates and some repeated configurations across stages; they are not counts of unique planes, full-resolution clinical examinations, or independently validated registrations. Earlier failed ranking passes are preserved in `search-results-landmark-only.json` and `landmark-only-candidates/`.

## Principal decisions

| View | Decision | Source-review reason |
|---|---|---|
| ME four-chamber | Candidate 1933 | Restores AV-junction neighborhoods and long LV while removing dominant aortic outflow. Approximate MV/TV/apical point residuals are 0.29/1.01/0.14 mm; these measure geometric landmark proximity, not clinical accuracy. |
| ME two-chamber | Candidate 1777 | Visually cleaner LA–mitral-region–LV cut than the lower-cost four-chamber-like candidates; little RV/RA tissue. |
| ME commissural | Candidate 2249; limited | Reduces root/right-heart contamination, but individual mitral scallops and both named papillary structures are unresolved. |
| ME long-axis | Candidate 2225 | Better continuous LV/outflow{local-home} section. Horizontal display reflection puts outflow to the right. |
| ME AV short-axis | Candidate 1094 | True source-observed root/cusp level replaces the ventricular cut. |
| TG basal SAX | Adaptive candidate 11201; limited | Broad mitral-region opening and more complete basal LV enclosure; exact leaflet/annular boundaries remain unvalidated. |
| TG papillary SAX | Original retained | Two principal muscular profiles are clearer in the original than in the proposed 29 mm level. |
| TG apical SAX | Original retained | Distal trabecular appearance is clearer without the dominant papillary profile of more proximal candidates. |
| TG two-chamber | Candidate 2804 | Removes the old elongated aortic pathway. Display roll places LV/apex left and MV/LA right. |
| PV, bicaval, LAA | Limited | Atrial/venous regions can be shown, but individual pulmonary/caval ostia and LAA ostial/lobe continuity are not established. LAA retains its original physical plane. |

`selection-decisions.json` provides the complete per-view rationale and both physical and presented source frames. The production file carries the same per-view status and remaining limitations.

## Coordinate and presentation integrity

Source XYZ voxel centers map to world coordinates as `[(x−237), (z−264.5), (237−y)] / 529`. Vector axes use `[vx, vz, −vy]`. Width and height are scaled by the same 529 factor. Source samples use the true intrinsic right/up axes, with no independent image-only transform that could detach measured texture from 3D geometry.

Display corrections are in-plane basis changes. ME LAX and ME RV inflow/outflow are reflected horizontally. AV/ascending-aortic long axes are rolled to a horizontal artery with the LA-side near field. TG2C, TG RV inflow, and TG LAX are quarter-turned so ventricular/apical tissue is to the left. Deep TG5C retains its apex-near-field presentation. All production frames already carry their intended presentation; flags are false and `normal = cross(right, up)`.

`geometry-verification.json` records orthonormality, handedness, cross-product normal, exact source/world center round trips, and preservation of the physical section under presentation changes. The source decoded hash is unchanged. These are computational integrity checks, not clinical validation.

## Review files and reproduction

- `baseline-source-sections.jpg`: all 24 original in-scan source sections.
- `candidates/`: broad/fine source contact sheets by view.
- `adaptive/`: targeted basal/papillary/apical source sweeps after failed proxy scoring.
- `final-before-after-1.jpg` through `final-before-after-4.jpg`: original grayscale, selected grayscale, and separately tinted selected sections.
- `final-selected-overview.jpg`: compact 24-view presentation review.
- `candidate-ledger.csv.gz`: candidate parameters, centers, normals, and geometric ranking records.
- `search-targets.json`: explicit approximate points, tolerances, exclusions, and independent starts.

Run from the project root, with Python NumPy/SciPy/Pillow and Node available:

```sh
node scripts/tee-plane-qc-v2/export-baselines.mjs
python scripts/tee-plane-qc-v2/common.py
python scripts/tee-plane-qc-v2/search.py
python scripts/tee-plane-qc-v2/level-review.py
python scripts/tee-plane-qc-v2/finalize.py
```

For a historical v44 baseline export, use the recorded v44 source commit. The supplied `baselines.json` must remain the comparison reference after runtime integration; do not silently replace it with newly integrated frames.

## Limits that remain

The fixed donor's LV and LA are collapsed. Healthy clinical cine geometry cannot be achieved by reslicing without changing anatomy, and no such deformation was performed. Individual mitral scallops, papillary identities, valve cusps, venous ostia, and LAA lobes remain incompletely identified. Thoracic aorta and arch views cannot be manufactured from this scan. The new esophagus/diaphragm/stomach context is a separate illustration, absent from the acquired donor data; its tract cannot establish clinical probe registration or be used to force an inferior source plane.

## Free-lab preset calibration

`public/tee-context-presets.js` separately solves the four free-lab presets on the fixed context tract. It returns `{presetStates, review}` and leaves both the target frames and context geometry immutable. Legacy references without a context model retain their previous behavior.

The search controls insertion, shaft turn, anteflexion, and lateral flexion within the existing sanitized limits. **Nominal clinical multiplane angles 0° / 90° / 120° / 0° are attempted first** for ME4C / ME2C / ME LAX / TG SAX. Only the declared view-family intervals 0–20° / 80–100° / 120–140° / 0–20° are allowed if a nominal fit is insufficient. An earlier unconstrained electronic-angle solution was deliberately rejected because its arbitrary model-frame angles would teach the wrong acquisition relationship.

A coarse search spans appropriate esophageal or gastric tract levels and bounded mechanical controls. Multiple independent insertion basins receive bounded continuous refinement. The objective prioritizes source-plane position/normal agreement, then a fan aimed toward the relevant anatomy with adequate depth and sector coverage. Numerical residuals are recomputed with the actual exported `teePose`, not trusted from the optimization approximation. A separate image-basis reflection may be required for source-frame handedness; this changes image right/normal and sampling together while leaving the physical probe and section unchanged. It is distinct from “Flip cut.”

The final model can represent all four target plane families at nominal angles. These are numerical fits within an authored model, not millimetric clinical registration or tissue-contact validation. `free-lab-calibration.json` records actual pose residuals, returned controls, fan coverage proxy, and limitations. `free-lab-source-fans.jpg` visually checks the resulting measured-source sectors. The coverage fraction uses a central geometric cross; it is never described as anatomical coverage or diagnostic accuracy.

```sh
node scripts/tee-plane-qc-v2/test-context-presets.mjs
python scripts/tee-plane-qc-v2/review-free-lab.py
```

The tests verify bounded controls, nominal angles for this donor, independently calibrated presets, runtime residual agreement, source-frame handedness, target-center fan inclusion, immutable target/context data, cache reuse, and legacy-path preservation.
