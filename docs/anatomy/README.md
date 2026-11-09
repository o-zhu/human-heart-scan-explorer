# Source-guided anatomy, version 5

The current regional color layer uses the **actual LADAF-2021-17 scan**, reviewed anatomical geometry, and tissue-constrained label propagation. It improves continuity of the aortic arterial wall and the muscular right-ventricular outflow while retaining the previous LV contour and tricuspid-junction work. It remains an approximate regional annotation, not an expert segmentation or clinically validated model.

The asset revision is `continuity-gated-v5`. The exact v4 baseline and its documentation are preserved in `v4-reference/` and `README-v4.md` for reproducibility.

## Concrete errors addressed

Source X=237 shows bright anterior and posterior aortic-root walls continuing across regions that v4 assigned to RA and LV. Nearest-cavity division and LV-envelope priority interrupted the wall's identity. Source Y=290 and Y=305 show muscular RV outflow continuing toward the pulmonary hinge; extending the tricuspid division across this corridor incorrectly colored part of that ventricular wall as pulmonary territory.

The new approach identifies connected arterial-wall cores from measured intensity, limits their propagation to the observed root vicinity, and follows a local oblique pulmonary hinge. It retains RV identity on the ventricular side of that hinge. Source intensities, geometry and display textures are unaffected.

The v4 LV envelope was also checked for abrupt end caps. Its contour interval is source Z=225–507; both terminal contours shrink to very small areas (approximately X251–258/Y303–309 at the base and X194–195/Y267–268 at the apex). These endpoints do not explain a broad horizontal basal stripe. The competing regional labels and nearest categorical sampling on the approximately 476 µm grid remain the more relevant sources of those visible transitions. The new propagation reduces some boundary fragments but does not claim subvoxel anatomical labels or eliminate all grid stair steps.

## Three computed approaches

All candidates use the same measured working volume and v4 baseline. The comparison figures show identical source pixels beneath every annotation.

| Approach | Actual computation | Finding |
|---|---|---|
| Gradient watershed | Marker watershed on measured image gradient, with competing-label boundary bands unseeded | Introduced additional fragments and retained incorrect root identities; rejected. |
| Tissue-geodesic propagation | Multi-source propagation restricted to tissue support, penalizing intensity changes and low-density gaps | Reduced some islands but inherited incorrect root/RVOT seeds; insufficient alone. |
| Anatomical/material hybrid, selected | Connected arterial-wall cores, source-based vessel guides, a reviewed pulmonary hinge and RVOT corridor, followed by constrained tissue-geodesic propagation | Corrected the reviewed root/RVOT errors while preserving independent chamber controls and prior LV/RA boundary checks. |

The third approach adds anatomical and measured-material information. It is not a trained network. Manually guided assumptions remain assumptions after propagation. The separate geodesic-only result is retained for comparison.

### Selected method

1. Retain reviewed v4 LV contours and curved tricuspid geometry. Select tissue seeds outside a five-working-voxel competing-label boundary band. Label/background boundaries are retained so thin walls still have seeds.
2. Identify connected aortic wall at working intensity 20,100 and pulmonary wall at 19,050, restricted to source-supported vessel guides. Elliptical guides locate regions; they do **not** force measured walls or lumina into circles. Oblique sections and collapsed fixed specimens can be noncircular.
3. Use the locally reviewed pulmonary hinge `sourceZ = 220 + 0.50 × (sourceX − 175) + 0.13 × (sourceY − 290)` within the observed outflow corridor. This is a visual estimate with several source voxels of uncertainty, not a clinical annulus or global axial cutoff.
4. Reconsider contested arterial collars and keep muscular outflow ventricular below the hinge. Prohibit pulmonary identity from replacing the compact-LV prior.
5. Propagate through tissue support with six-neighbor steps, intensity-difference scale 600, low-density-gap penalty 4 and maximum accumulated cost 85. New aortic identity is limited to three working voxels, approximately 1.43 mm, from the connected bright core. Unreached tissue remains neutral.

An early hybrid spread purple into adjacent bright myocardium and a thin atrial/mitral strip. Source review identified this failure. The final version limits the new arterial collar, protects compact LV, and excludes aortic identity at source X≥295. The X=300 comparison no longer contains an aortic strip. The shared aortomitral{local-home} attachment remains approximate; intensity alone cannot identify its exact anatomical boundary.

## Targeted checks, not global accuracy

The three check groups are recorded separately and must not be pooled into an accuracy claim.

| Method | Independent pre-candidate controls | Source-reviewed aortic/RVOT probes | Existing v4 boundary regression |
|---|---:|---:|---:|
| v4 baseline | 12/12 | 1/5 | 20/20 |
| Watershed | 12/12 | 0/5 | 20/20 |
| Tissue-geodesic | 12/12 | 1/5 | 20/20 |
| Selected hybrid | 12/12 | 5/5 | 20/20 |

The 12 controls were selected by a separate source reviewer from uncolored X/Y/Z scans before viewing candidate labels, two per region. LA controls have medium confidence. These are preservation checks: v4 already passed them. The five error probes were recorded from the problematic source root/outflow before inspecting candidate outputs, then used to compare methods. They are diagnostic probes, not an untouched test set or expert reference. Twenty earlier LV/RA points provide separate regression coverage.

| Source XYZ | Reviewed identity | v4 | Selected hybrid |
|---|---|---|---|
| [237, 218, 240] | Anterior aortic root wall | RA | Aortic |
| [237, 290, 240] | Posterior aortic root wall | LV | Aortic |
| [225, 225, 236] | Lateral aortic sinus wall | Aortic | Aortic |
| [150, 290, 235] | Muscular RV outflow | Pulmonary | RV |
| [155, 305, 240] | Muscular RV outflow | Pulmonary | RV |

Thus **four previously failing probe identities were corrected and one retained**. This does not establish that all chamber boundaries are correct.

`method-comparison-v5.json` includes connected-component statistics and full v4-to-candidate transition matrices. On measured tissue above 17,500, the selected map changes 127,341 working voxels. Aortic components of at least 27 voxels decrease from four to one; approximately 99.98% of its labeled tissue is in the largest component. RA components decrease from seven to two. RV components increase from six to eight and its largest-component fraction decreases from about 99.77% to 99.35%, so connectedness does not improve everywhere. These are descriptive metrics: a continuous label can still be anatomically wrong.

## Review evidence

- `anatomy-method-comparison-v5.jpg`: source, baseline and all three methods at X=237, Y=290, Z=250 and X=300.
- `anatomy-x237-v5.jpg`: longitudinal root/ventricle comparison.
- `anatomy-rvot-v5.jpg`: Y=290 muscular outflow and pulmonary hinge.
- `anatomy-basal-v5.jpg`: Z=250 chamber{local-home} transition.
- `anatomy-atrial-v5.jpg`: X=300 atrial/mitral continuity.
- `anatomy-off-axis-v5.jpg`: X=275 independent section view.
- `independent-flow-landmarks-v5.json`, `targeted-landmarks-v5.json`, `boundary-validation.json`: the distinct check groups.
- `method-comparison-v5.json`, `method-parameters-v5.json`, `packaging-v5.json`: results, parameters and provenance.

The original scan appears alongside each final comparison. These are measured-data annotation overlays, not generated anatomy.

## Regions and uncertainty

| ID | Region | Color | Interpretation |
|---|---|---|---|
| 0 | Unclassified tissue | `#9ba9b0` | No anatomical identity asserted. |
| 1 | Left ventricle | `#e36d73` | LV myocardial body, including septum under the display convention. |
| 2 | Right ventricle | `#54a6e6` | RV free wall, nonseptal trabeculation and muscular outflow. |
| 3 | Left atrium | `#f2b36b` | Collapsed atrial territory; mitral, appendage and individual vein boundaries provisional. |
| 4 | Right atrium | `#63c7ba` | RA wall/pectinate territory to the reviewed tricuspid junction. |
| 5 | Aortic outflow | `#c499e8` | Source-supported arterial wall/root; exact fibrous/annular boundary approximate. |
| 6 | Pulmonary outflow | `#61cce0` | Arterial wall beyond the reviewed hinge; muscular RVOT remains ventricular. |

Coloring compact interventricular septum with LV is a **regional display convention**, not separate LV/RV layer delineation. Labels tint independently measured tissue and must never form synthetic filled blood pools. Valves, coronary vessels, caval veins, individual pulmonary veins and appendages are not separately segmented. A tint near an opening is not a vessel-specific annotation.

Basal LA, mitral insertion, shared fibrous{local-home} tissue and small vascular transitions remain uncertain. No fiber tractography, trained segmentation model, expert ground truth, Dice score, slice realignment or synthetic reconstruction is used. Labels are unsuitable for quantitative chamber-volume, wall-thickness, procedural or diagnostic measurements.

## Reproduction and runtime

Requirements: NumPy, SciPy, scikit-image, Pillow and C++17 compiler. Use original s4 data (XYZ 475×475×530, 317.6 µm), with s3 (158.8 µm) for review. The endpoint-aligned working grid is 317×317×354, with 0.35-voxel Gaussian filtering **only for labeling**.

```sh
python scripts/anatomy-v5-prepare.py \
  --volume /absolute/path/to/s4-volume-u16.npy \
  --review-volume /absolute/path/to/s3-volume-u16.npy \
  --work-dir /absolute/path/to/anatomy-v5-work
```

This computes all candidates from the versioned baseline, produces source review figures and diagnostics, checks the recorded landmarks, then packages the hybrid. Inspect the figures when changing inputs or parameters; a small landmark set cannot prove anatomical correctness. `--package-only` packages an already reviewed candidate. Large intermediates remain outside deployed assets.

The existing `loadAnatomy()` API, IDs, palette and registration are compatible. The uint8 grid is X-fastest, then Y, then Z. Endpoints match source endpoints. Sample categorical IDs with `round(sourceNormalizedXYZ × (dimensions − 1))`; do not linearly interpolate numeric IDs. The grid decodes to **35,573,106 bytes** and its lossless gzip download is **316,865 bytes**. Decoded SHA-256: `e15ebb51b895aa325fe1f71993f1acfe2af24cc1f1e67b1bd4e26b65cffde055`. The public manifest contains dimensions, descriptions, bounds, anchors and checksums.

## Sources

- [Original ESRF dataset](https://human-organ-atlas.esrf.fr/datasets/1659197537), DOI [10.15151/ESRF-DC-1634390196](https://doi.org/10.15151/ESRF-DC-1634390196), CC BY 4.0. Source-derived review figures retain this attribution.
- Brunet et al., *Multidimensional Analysis of the Adult Human Heart in Health and Disease Using Hierarchical Phase-Contrast Tomography*: [primary preprint and anatomical reference figures](https://pmc.ncbi.nlm.nih.gov/articles/PMC10592740/); [Radiology 2024;312(1):e232731](https://doi.org/10.1148/radiol.232731). The retained published image in `anatomy-reference-comparison.jpg` is attributed to its authors, CC BY-NC 4.0. It supports regional identification, not exact registration or validated annular segmentation.
- [scikit-image marker-watershed documentation](https://scikit-image.org/docs/stable/api/skimage.segmentation.html#skimage.segmentation.watershed), used for the watershed candidate.
