# UCL-ZCR-2629: source-specific views and provisional regions

The new donor has independent view frames, fine textures, physical probe settings and tissue-region candidates. Nothing in these assets reuses the original donor's landmarks, anatomy labels or image textures.

The source is Human Organ Atlas dataset [2298522198](https://human-organ-atlas.esrf.fr/datasets/2298522198), DOI [10.15151/ESRF-DC-2299323295](https://doi.org/10.15151/ESRF-DC-2299323295). Source acquisition and intensity provenance are recorded separately by the donor preparation pipeline.

## Registration and physical size

The browser's detailed grid is **289 × 293 × 457** at **112.512 µm**. Its endpoints match the source level-2 lattice of **1153 × 1169 × 1825** at **28.128 µm**. The longest voxel-center extent is **51.305472 mm**.

Coordinates in the view preparation script refer to the registered browser grid. The original OME level-4 grid has a different voxel-center origin; the donor pipeline accounts for that before these frames are generated. This avoids a half-voxel registration assumption between pyramid levels.

The rendering convention is centered source coordinates mapped to `[X, Z, -Y]`, divided by the longest physical extent. It is a scanner-coordinate presentation, not a patient-coordinate registration.

The Probe Lab now uses each volume's actual physical extent. Relative defaults, movement, contact-guide dimensions and camera fitting scale from the legacy 168.0104 mm reference. The new default apical-reference imaging depth is approximately **44.28 mm**, instead of retaining the original donor's 145 mm depth. Displayed positions and depths remain physical millimeters. Angular controls do not change. The synthetic probe and contact surface are educational guides, not reconstructed body anatomy or a specific clinical transducer.

## Echo, chamber and probe views

The prepared assets contain:

- **13** independently placed Echo reference planes, including the two short-axis levels.
- **8** candidate chamber inflow/outflow planes with local detail thumbnails.
- **4** exact default Probe Lab planes computed by the same JavaScript geometry functions used in the running app.

The four-chamber candidate is fitted to four source-specific regional points. Other planes are placed through separately inspected ventricular, atrial-side or arterial-hinge regions. The source points, plane bases and actual image sizes are recorded in JSON. All plane bases are orthonormal.

The apical Echo and Probe reference planes deliberately place the apex toward the top of their image, consistent with an apical probe-facing display. Their TEE-side counterparts place it toward the bottom. These display bases do not rotate or resample the registered source coordinate system. The anatomy-focused inflow/outflow references generally put the ventricular apex below the valve region.

Fine images are trilinear reformats of this donor's cleaned, windowed **28.128 µm** measured display volume. Lossless WebP preserves every byte of each resulting 8-bit image; pixel and encoded-file SHA-256 hashes are stored. These are not native 7.032 µm quantitative intensities and are not synthesized textures. Arbitrary adjusted Echo and Probe planes use the same donor-specific fine volume.

The source-only review figures are:

- `echo-candidate-review.jpg` and `echo-fine-review.jpg`.
- `flow-candidate-review.jpg` and `flow-fine-review.jpg`.
- `probe-fine-review.jpg`.
- `probe-default-planes.json` and `probe-prepared-textures.json`.

All clinical-view correspondence remains **unverified**. The Echo interface calls these scan-derived starting planes and marks its ultrasound movies as independent references. The Probe Lab uses generic starting-plane names for this donor. Flow titles retain the word **candidate**. Neither the movie's anatomy nor its cardiac cycle is registered to this fixed specimen.

## Conservative tissue-region candidates

The candidate annotation grid is **193 × 195 × 305**, aligned by its voxel-center endpoints. Its six color regions are explicitly named:

| Region | Basis and limitation |
| --- | --- |
| LV candidate | Compact myocardial body around the lower-X / lower-Y ventricular cavity. Shared septal assignment is a provisional display convention. |
| RV candidate | Adjacent ventricular tissue around the crescent-like cavity. The muscular outlet boundary remains uncertain. |
| LA candidate | Thin folded atrial-side tissue near the candidate LV inlet. No individual vein or appendage identity is assigned. |
| RA candidate | Pectinate atrial-side tissue near the candidate RV inlet. Caval identities are not assigned. |
| Aortic-region candidate | Connected proximal wall around the inspected lower-X arterial route. Vessel identity and exact valve attachment are not confirmed. |
| Pulmonary-region candidate | Connected proximal wall around the inspected higher-X arterial route. Vessel identity and exact valve attachment are not confirmed. |

Two approaches are compared: source-specific spatial territory constraints and an independent intensity-gradient seeded watershed. The final display keeps only their agreeing tissue voxels, removes isolated colored specks and leaves ambiguous valve{local-home} junctions neutral. The initial comparison disagreed at **34,898** previously assigned voxels; these remain unassigned. This is an algorithmic consistency check, not an accuracy score.

The final annotation assigns **3,053,326** of **4,267,984** thresholded tissue voxels, approximately **71.5%**. The remaining **1,214,658**, approximately **28.5%**, retain their neutral measured-tissue appearance. No empty lumen is filled or replaced by a label.

`anatomy-candidate-review.jpg` shows actual source/overlay pairs in three scan axes; `anatomy-review.json` records source landmarks, label counts, method comparison and uncertainty. The metadata explicitly sets `sourceReviewed: true`, `clinicalPresetsReviewed: false` and `expertValidated: false`.

These are provisional morphology-based hypotheses. There is no expert reference segmentation, independently confirmed chamber identity, Dice score or clinical validation. They should not support chamber-volume, wall-thickness, valve, vessel or diagnostic measurements.

## Reproduction and checks

Run `python scripts/prepare-donor-views-v8.py` after the donor's cleaned detailed/fine arrays and sparse fine-volume manifest are prepared. The script needs NumPy, SciPy, Pillow, scikit-image and Node.js. `--preview-only` prepares source-resolution review figures and the provisional label volume; `--skip-anatomy` regenerates view images without repeating annotation processing.

The source root defaults to `{source-cache}/heart-donor-2298522198` and can be overridden with `--source-root`. It must contain `browser-geometry.json`, `display-high-clean-u8.npy`, `s2-clean-display-u8.npy` and `s2-clean-display.json`. The detailed and fine arrays are different registered resolutions of this donor's data.

Run `node --test tests/donor-modules-v8.mjs` for physical scaling, donor-specific asset isolation, exact default probe-plane registration and source-grid endpoint checks. The DOM checks use the test-only LinkeDOM dependency; its path can be provided with `--dom=/absolute/path/to/linkedom/esm/index.js`. They do not claim browser FPS, WebGL rendering quality or native pointer-lock verification.

Run `python tests/donor-views-v8.py` to verify all 25 fine images against their manifests and the actual prepared source. The completed verification records **15,125 independently interpolated source pixels**, **zero display-code difference**, all **25 encoded-file and decoded-pixel hashes**, the exact four prepared Probe Lab defaults and all six label counts. Its report is `view-validation.json`. The source-pixel check verifies data registration and encoding, not the provisional anatomical interpretation.
