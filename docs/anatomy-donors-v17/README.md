# Independent regional anatomy for S-20-29 and S-20-28

This update adds approximate chamber and great-vessel regional color maps for
the two comparison donors. These are **source-guided educational annotations,
not expert-validated anatomical segmentations**. They do not support chamber
volume, wall-thickness, clinical-window, procedural or diagnostic measurements.

The original scalar scan, display windows, cleanup support, physical geometry,
source caches and source images are unchanged. Each map is independent of the
LADAF map and of the other S donor. The old all-neutral eight-byte assets remain
unchanged; each new map has an immutable, content-addressed v17 filename.

## Sources and spatial registration

| Donor | Human Organ Atlas dataset | Original s4 grid, XYZ | Original spacing |
| --- | --- | --- | --- |
| S-20-29 | [1773963465](https://human-organ-atlas.esrf.fr/datasets/1773963465) | 477 × 477 × 486 | 318.24 µm |
| S-20-28 | [1966162746](https://human-organ-atlas.esrf.fr/datasets/1966162746) | 476 × 476 × 508 | 317.6 µm |

Attribution: Human Organ Atlas Collaboration / ESRF, CC BY 4.0. Dataset URLs,
DOIs, license and attribution are retained in each derivative manifest.
`source-provenance.json` records the actual original uint16 file hash, source
dimensions, annotation dimensions and registration rule.

The website high-resolution volume is registered to the first fine-grid voxel
center, rather than to the original s4 center. For normalized display coordinate
`t`, the original s4 coordinate is:

```
original_s4_xyz = t * (registered_high_dimensions_xyz - 1) - 0.375
```

The inverse maps every reviewed source point into the label volume. Label grids
use endpoint registration: S-20-29 is 317 × 317 × 323; S-20-28 is 317 × 317 × 338.
Categorical labels are sampled with nearest-neighbor interpolation. The source
is lightly filtered only as an input to annotation calculations; none of those
filtered values replace a website density or texture asset.

## Source review and anatomical identity

The larger, compact higher-X myocardial body was traced independently in both
donors. Its lumen, papillary structures and thick septal body identify the LV.
The thinner lower-X region contains the RV cavity and its coarse trabeculae.
The atria were followed toward their respective atrioventricular inlets in
orthogonal source sections; their different positions were not assumed to match
the LADAF donor or one another.

Great-vessel identity required a separate oblique continuity review. A large
bright lumen alone was not treated as sufficient to identify a vessel. The broad
bright root in both S donors follows the LV outflow and receives aortic color.
The second root follows RV outflow and receives pulmonary color. The oblique
review paths, seed trajectories, compact-LV contours and local transition gates
are recorded in `source-guides.json`.

The S-20-28 pulmonary root is cut open and flattened. Its source cavity spans a
broad posterior crescent instead of a circular section. A first narrow guide
left part of its wall neutral. Source Z160, Z190 and Z220 plus the RV-outflow
oblique plane were reviewed to expand the appropriate posterior cavity region
without entering the adjacent aorta. This is recorded as a targeted annotation
coverage correction. The donor's measured geometry was never altered to make
the root round.

## Three compared approaches

1. **Nearest source cavity.** Tissue is assigned from physical distance to
   extracted, donor-identified low-density cavity pixels. This is a useful
   baseline but can split a thick compact septum according to lumen distance.
2. **Tissue geodesic.** Wall seeds propagate on connected measured tissue,
   with penalties for abrupt intensity changes and low-density gaps. This
   follows local tissue continuity, but connected basal wall bridges still need
   anatomical constraints.
3. **Selected source-constrained hybrid.** The second method is constrained by
   the independently reviewed compact LV envelope, a source-cavity-facing RV
   surface layer, local atrioventricular transition estimates, and narrow
   great-vessel wall regions. Uncertain transition collars and unsupported
   exterior tissue remain neutral.

`method-comparison.json` in each donor folder contains actual label counts,
neutral-support counts and disagreements between methods. These are annotation
comparisons, not an accuracy score.

## What a color means

| ID | Region | Color |
| --- | --- | --- |
| 0 | Unassigned / uncertain tissue | Neutral grey |
| 1 | LV-associated tissue | Rose |
| 2 | RV-associated tissue | Blue |
| 3 | LA-associated tissue | Amber |
| 4 | RA-associated tissue | Teal |
| 5 | Aortic root/outflow wall | Violet |
| 6 | Pulmonary root/outflow wall | Cyan |

The compact interventricular septum is a shared structure. Its compact core is
displayed with LV myocardium, while the thin source surface facing the RV cavity
and adjacent RV trabeculae use RV color. The layer thickness is an annotation
parameter, not a measured histological boundary. Outer colors show regional
association and may include immediate covering tissue; fat, epicardium and
coronary vessels are not separately classified.

The maps do not provide individual valve-leaflet, pulmonary-vein, caval-vein,
appendage or coronary-artery segmentations. Local valve{local-home} transition gates
are visually estimated. Unresolved shared tissue is retained as neutral.

## Verification and review artifacts

Each donor folder contains:

- `source-overlay-1.jpg` and `source-overlay-2.jpg`: measured source and color
  overlay in eight orthogonal sections.
- `outflow-continuity.jpg`: measured and colored oblique ventricular-to-root
  planes, with the three defining source points marked.
- Four native CPU surface/cutaway projections. These use the same measured
  density and ray geometry for neutral and colored renderings. They are
  scientific annotation reviews, not website screenshots.
- `source-provenance.json`, `method-comparison.json`, `cavity-review.json`,
  `surface-review.json`, `asset-validation.json` and `checks.json`.

Thirteen source tissue points were initially held out from the build per donor.
S-20-29 matched all thirteen in its first selected candidate. S-20-28 initially
matched twelve; its missed pulmonary-wall point led to the targeted source
review described above. That point is explicitly reported as a refinement
control afterward, leaving twelve untouched holdout points. All thirteen
recorded controls match the final maps. They establish local identity
consistency; they are neither expert labels nor a global accuracy estimate.

The checker verifies exact gzip/hash round trip, categorical IDs, decoded size,
bounded download size, physical registration, source-file hash preservation,
no labels outside the recorded source-derived support, and preservation of the
old neutral asset. The new maps remain lazily loaded when the user selects the
anatomy color style.

### Final asset sizes and coverage

| Donor | Compressed categorical download | Decoded label bytes | Assigned source-support voxels | Neutral source-support voxels |
| --- | ---: | ---: | ---: | ---: |
| S-20-29 | 328,222 B | 32,457,947 B | 4,231,051 | 423,829 |
| S-20-28 | 402,888 B | 33,965,282 B | 4,026,587 | 493,997 |

The two new downloads total **731,110 bytes** (about 714 KiB). Only the selected
donor's categorical map is requested when anatomy coloring is enabled. The
assigned fraction of the source-derived annotation support is 90.9% and 89.1%,
respectively. Support includes a narrow registration collar around measured
tissue; these fractions are coverage statistics, **not segmentation accuracy
or a physical tissue volume**. The remaining neutral covering tissue and shared
basal/valve transitions are intentional limits of the approximate annotation.

## Reproduce

The source uint16 caches are the original N5 s4 arrays prepared by the existing
donor pipeline. The commands below use the default cache layout; `--data-root`
and `--work` can point to a different local location.

```bash
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=4 python scripts/anatomy-donors-v17.py --stage build
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=4 python scripts/anatomy-donors-v17.py --stage review
# Inspect the source and surface review figures before packaging.
python scripts/anatomy-donors-v17.py --stage package
python scripts/anatomy-donors-v17-check.py
```

Requirements: Python, NumPy, SciPy, Pillow, scikit-image, and a C++17 compiler.
The pipeline reuses the generic geodesic and native ray-casting helpers, but
never reads or transfers any LADAF label volume. Temporary distance fields and
candidate maps are kept outside the repository. Only the small compressed
categorical maps, provenance, reproducible guides/scripts and review evidence
are committed.

Anatomical region colors and clinical-window validity remain separate. The
comparison donors' existing geometric presets are still geometric references;
`clinicalPresetsReviewed` and `expertValidated` remain false. No independent
ultrasound movie is represented as a paired or registered scan of these donors.
