# Main starting-view quality control, v3

## Decision

**Replace the RV-outflow plane and move the LA-outflow plane 3 mm toward the atrial side. Retain the other six source planes. Reframe all eight starting cameras from their measured retained support, with clearance for the main-view heading and controls.**

The user's RV-outflow concern was supported by the source. The original straight source-Y 292 section included a large LV cut and a longitudinal aortic-root segment. Its default camera distance of 0.8 also cropped the heart within the canvas. This was not a swapped label, an automatic LV selection, or a misregistered prepared texture. The independent runtime review is in `../view-integrity-v3.md`.

The replacement shows the broad trabeculated RV body continuing through the muscular outlet to the pulmonary root and proximal pulmonary artery. The aortic root and shared septum remain visible as adjacent anatomy. Another source-review agent independently reviewed the selected grayscale/label plate and agreed with this regional identity.

This is a source-supported anatomical review of a fixed, partly collapsed specimen. It is not expert validation of a clinical imaging plane, chamber segmentation, valve identity, annulus, or measurement axis.

## Frozen runtime artifact

- `../../public/assets/main-view-qc-v3.json`
- Dataset ID: `1659197537`; specimen: `LADAF-2021-17`.
- Version: `main-view-qc-v3`.
- Size: 28,794 bytes.
- SHA-256: `24df43cd45b4d8d4105de4b3d6e166b26df04fbef31bbee52fa54a85ba960b79`.
- Changed planes have complete world frames. The six retained entries do not replace their original frames or prepared textures.
- Default retained sides are unchanged: `flip: true` only for RA outflow; the other seven are `false`.
- The original `flow-views-v5.json`, source voxels, source/prepared images, label volume and cleanup masks were not modified by this review.

The integration must gate this catalog to the specified donor, discard an old prepared cap when its sampling rectangle changes, and preserve the meaning of earlier saved views. Camera-only changes do not invalidate a source cap.

## Source and annotation provenance

| Item | Evidence |
|---|---|
| Scalar source | `public/assets/volume-v5/heart-high-clean.raw.gz`, decoded through the published manifest predictor |
| Source grid | 475 × 475 × 530 in XYZ; 0.3176 mm sampling |
| Decoded scalar SHA-256 | `10d8120c59b978528c8373fe2c0fd5cd404c843fd91e7df75e7c0c7566cdf82f` |
| Display values | Windowed uint8 measured source, not calibrated Hounsfield units |
| Label manifest | `public/assets/anatomy/manifest.json`, revision `la-exterior-v17` |
| Label grid | 317 × 317 × 354, endpoint-registered to the original source voxel centers |
| Decoded label SHA-256 | `e29a218fdf42947a550b2c73711f66cbc4aaa0daca852f55529859e4fdb6ac54` |
| Label IDs | 1 LV; 2 RV; 3 LA; 4 RA; 5 aortic root/wall; 6 pulmonary root/wall |

Labels were sampled nearest-neighbor at their documented endpoint registration. Source images were sampled linearly at each actual candidate plane. Hashes were checked before use.

The annotations describe approximate **tissue-region ownership**, not blood pools. In particular, the compact interventricular septal core is deliberately displayed as LV while a thin RV-facing surface and adjacent RV trabeculae are displayed as RV. The muscular RV outflow tract is RV label 2; the estimated pulmonary wall beyond the hinge region is label 6. Thus neither a raw RV/LV label ratio nor the presence of some LV-labeled septum establishes view accuracy.

Valves, individual veins, appendages and named leaflet segments are not separately segmented. Their identity cannot be proved by these labels. No annotation was changed to improve a view's apparent score.

## Search and selection

The review used existing source-supported cavity tracks and regional landmarks in `docs/anatomy/cavity-tracks.json`, `docs/anatomy/boundary-landmarks.json`, `docs/anatomy/independent-flow-landmarks-v5.json`, and the prior TEE source-review targets. They are approximate source observations, not a clinical reference standard.

1. Rendered all eight original planes and identical-size anatomical target crops in grayscale and regional tint.
2. For the seven non-RV-outflow families, inspected the original section plus twelve nearby alternatives: yaw ±8°/±16°, tilt ±8°/±16°, and normal offsets ±3/±6 mm. This produced **91 source sections**.
3. For RV outflow, started from the original plane, an independent weighted fit through RV{local-home}/PA observations, a lateral RV plane, and the prior TEE RV-route family. Broad and local searches evaluated **4,917 geometric configurations**. Geometric distance only selected candidates to inspect; it was not accepted as proof of anatomy.
4. Rendered **36 diverse RV-outflow candidates**, followed by paired grayscale/region plates for six finalists. Candidate **3972** was selected for the visible RV-body-to-pulmonary pathway and its proximity to the source observations, rather than maximum RV area.
5. For LA outflow, inspected paired source/region sections at 0, +1.5, +2.25, +3, +3.75, +4.5 and +6 mm. The +3 mm cut retains the atrioventricular transition with less ventricular wall than the original, while the larger shifts increasingly enter the atrium.
6. Rendered all eight selected views with the actual production volume/cap GLSL, current donor display settings, cleanup support and v17 labels. This was a 317.6 µm resident-source orientation/composition review, not a claim about Ultra surface detail or browser performance.

### RV-outflow source geometry

The selected physical plane before recentering its display rectangle is:

```text
center XYZ = [184.902763562451, 264.356973870336, 255.523537788551]
right      = [-0.921117306268, 0.343538549035, -0.183096077021]
up         = [0.370486515962, 0.629225587724, -0.683238539050]
normal     = [-0.119510039677, -0.697177470290, -0.706866978530]
```

Distances from the reviewed source observations to this plane are:

| Approximate regional observation | Plane distance |
|---|---:|
| Pulmonary valve/hinge region | 0.921 mm |
| Muscular RVOT | 0.245 mm |
| Proximal pulmonary artery | 0.594 mm |
| RV body | 0.690 mm |
| Distal RV observation | 7.721 mm |

The distal-RV distance is an explicit limitation of flattening the curved outlet/body route into one plane. This is not a complete long axis of every RV segment. The grayscale source nevertheless preserves a broad RV body and its outlet relationship. A single plane cannot contain every curved track point.

The final sampling rectangle is conservatively recentered and enlarged over the projected source-heart bounds without changing that physical plane. The close target is the pulmonary region projected into the selected plane. The final exact world frame is in the catalog and `selected-review.json`.

### Per-view conclusions

| Preset | Geometry | Source review and practical limit |
|---|---|---|
| RV inflow | Retained | Clear RA outlet–tricuspid region–RV relationship. Nearby shifts that reduce LV tissue do not establish superior valve identity. Individual tricuspid leaflets/chordae remain unassigned. |
| RV outflow | Replaced | Oblique RV body–muscular RVOT–pulmonary route. The previous section overemphasized LV and aortic anatomy. Adjacent aorta and shared septum remain legitimate context; individual pulmonary cusps are unvalidated. |
| LV inflow | Retained | LA–mitral-region–LV relationship and subvalvular tissue remain coherent through the neighborhood review. Partly collapsed geometry limits correspondence to a living-heart cavity. |
| LV outflow | Retained | LV outlet–aortic root continuity is already clear. Neighboring sections did not give a compelling improvement; no aortic leaflet or annular measurement claim is added. |
| RA inflow | Retained | Broad right atrial cavity and preserved venous-entry side. Preserved vessel ends are truncated; not a complete bicaval view. |
| RA outflow | Retained | Retains the hinge-supported atrial-side view of the tricuspid region and RV beyond. Downstream ventricular tissue is expected here. Not a segmented annulus. |
| LA inflow | Retained | Preserved pulmonary-venous-entry side and LA cavity. Individual named veins and all four vein ostia are not verified. Camera alone moves right to avoid the heading. |
| LA outflow | +3 mm along prior normal | Atrial-side shift reduces the broad LV-wall cut while retaining LA–LV junction context. It is a regional mitral view, not a measured valve orifice or validated en-face valve segmentation. |

Thresholded label proportions are retained in the JSON evidence as descriptive checks only. In the same-sized original anatomical target rectangle, the RV-outflow replacement changes approximately LV/RV/PA tissue support from 44.8%/19.6%/16.7% to 10.0%/39.9%/34.7%. The decrease agrees with the visual finding but is **not** an anatomical accuracy score: tissue type, shared septum, rectangle position, and section orientation all affect these proportions. The selection was made from measured grayscale anatomy and the regional pathway.

## Camera fitting and UI clearance

An initial fit to world-axis bounding-box corners overestimated empty space. For RV outflow it produced a distance of 2.134 and a heart only about 53% of canvas height. The final fit uses measured retained-support extrema instead.

For each preset and each retained half, every source voxel at or above uint8 display value 72 within the established source-heart bounds `[109,88,14]`–`[402,405,512]` is considered. This threshold is deliberately below the displayed surface threshold. The convex hull is recovered from exact first/last occupied X positions in each Y/Z row, which preserves the convex support. Labels are not used to crop support or hide neighboring chambers.

The catalog supplies four small arrays: `overview`, `section`, `flippedOverview` and `flippedSection`. Each array contains 5–31 actual source-support extrema. The horizontal upper hull in camera-right/camera-normal coordinates plus the two vertical extrema preserves the required perspective fit for any viewport aspect under the runtime's `fov=.32`, horizontal safety `.84`, and vertical safety `.76`. This was also compared numerically with every vertex of the complete source-support hull at 100 aspect ratios from 0.2 to 8 for each of the 32 poses. The opposite retained half is calculated independently for flipped views.

The camera's overview target is independent of the physical cut and of the closer anatomical target. Small target pans clear the observed 944 × 856 main canvas overlays: a 365 × 220 upper-left heading/controls region and a 270 × 90 upper-right toolbar. The optimization includes an extra 8-pixel guard. Source-hull projection and final native rendered tissue both clear those rectangles for all eight defaults.

Final RV-outflow Explore camera at aspect 1.104:

```text
overview target = [0.116749976390, 0.094784179605, -0.020607647083]
distance        = 1.572805901141
closer distance = 0.72
camera offsets  = right 0.24, up 0.10
```

The heart fills approximately 75% of the native view's height, clears both overlays, and does not crop at the canvas edge. Six other overview targets also receive small composition changes; LA outflow retains its measured-support center. Neither these pans nor responsive distances change the source sampling plane.

No finding justified changing the unrelated initial whole-heart viewing direction. Optional whole-heart support bounds are supplied, but this audit does not claim a new clinical orientation for an uncut whole-heart view.

## Review plates and machine-readable evidence

- `baseline-source-regions.jpg`, `baseline-target-regions.jpg`: all original presets.
- `*-neighbors.jpg`, `neighbor-review.json`: original and twelve local alternatives for seven view families.
- `rv-outflow-candidates.jpg`, `rv-outflow-search.json`: diverse source candidates and the full bounded geometric search.
- `rv-outflow-finalist-3972.jpg`: selected RV grayscale/label pair.
- `rv-outflow-finalists.json`: all six finalist frames and descriptive tissue support.
- `la-outflow-fine-neighbors.jpg` and `.json`: fine atrial-side offset comparison.
- `selected-review.json`: final source frames, support bounds, per-view findings and source hashes.
- `support-hulls.json`: complete-hull versus compact-frustum-support audit for both retained halves and all camera poses.
- `overlay-target-fit.json`: camera-only pan choices, conservative projected bounds and overlay clearance.
- `native/all-reviewed-starts.jpg`: all eight selected 3D starts with regional labels.
- `native/rv-outflow-previous.jpg`, `native/rv-outflow-reviewed.jpg`: actual production-shader before/after composition.
- `native/rv-outflow-overlay-clearance.jpg`: final source render with the guarded overlay rectangles.
- `native/review.json`, `native/overlay-clearance.json`: renderer settings, zero GL errors, and rendered-pixel clearance counts.

All native source renders are explicitly the resident 317.6 µm source. Final browser, Ultra-cap, donor-switch and saved-view integration checks belong to the main integration review.

## Reproduction

From the repository root, using existing NumPy, SciPy, Pillow, Node and system EGL:

```bash
python3 scripts/main-view-qc-v3/audit.py baseline
python3 scripts/main-view-qc-v3/search.py
python3 scripts/main-view-qc-v3/search.py neighbors
python3 scripts/main-view-qc-v3/finalists.py
python3 scripts/main-view-qc-v3/build_catalog.py
python3 scripts/main-view-qc-v3/fit_support.py
python3 scripts/main-view-qc-v3/frame_ui.py
python3 scripts/main-view-qc-v3/render_review.py
```

Run the final three catalog stages in order: the base builder deliberately recreates pre-fit camera metadata; the support and UI stages then add the compact measured fit and camera-only composition. Original source and annotation files are opened read-only throughout.
