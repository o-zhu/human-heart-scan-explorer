# Ventricular surface ownership and exterior completion — v12

This revision addresses two visible defects in the LADAF-2021-17 regional color
map: LV coloring on tissue facing the RV cavity, and a broad unclassified stripe
on the ventricular exterior. It changes only the categorical annotation asset.
The measured scan, cleanup mask, reconstruction geometry, textures, intensity
window and source coordinate system are unchanged by this pipeline.

## Findings and selected method

The earlier annotation assigned the entire compact interventricular septum to
the LV myocardial body. That was an explicit regional convention, but it also
made the cavity-facing surface of the RV look like LV tissue. The v12 annotation
keeps the compact septal core with the LV display territory and assigns a thin
source-cavity-facing surface layer, including adjacent trabecular protrusions,
to the RV display territory. **The septum remains shared anatomy.** The 1.9 mm
layer is an annotation parameter, not a measured histological boundary or a
separately identified anatomical layer.

The gray exterior had a separate cause. The viewer can reveal tissue at a lower
intensity than the old seed threshold, while the previous propagation mask was
derived from the old label support. That mask could not repair large unsupported
outer patches. The new support is derived independently from the measured
organ tissue; an intensity-weighted geodesic extends existing labels through a
bounded 3.5 mm collar. It fills nearby source-supported outer tissue without
inventing a new chamber boundary or changing any surface shape.

Outer colors describe regional association. They do not distinguish myocardium,
epicardial fat and small coronary vessels. Neutral regions remain at uncertain
or sufficiently distant structures. These are approximate educational regional
annotations, not an expert reference segmentation or a quantifiable chamber
volume mask.

## Approaches actually compared

All three candidates use the same original uint16 source volume and the same
317 × 317 × 354 label grid. Each candidate is reproducible with the supplied
script; `method-comparison.json` records exact counts.

| Candidate | LV → RV voxels | Previously unclassified voxels assigned | Finding |
|---|---:|---:|---|
| Nearest measured cavity | 433,261 | 126,018 | Rejected. It divides compact septal myocardium deeply and gives an implausible discontinuous division of the basal LV body. |
| Bounded exterior geodesic | 0 | 121,507 | Repairs exterior support but leaves the RV-facing surface defect. |
| Exterior geodesic plus RV surface ownership | 63,604 | 121,507 | Selected. Repairs the visible surface while retaining the compact core and the established basal identities. |

No old RV voxel becomes LV. No pre-existing LA, RA, aortic or pulmonary label
changes. Their immediate outer coverage is completed where measured tissue
supports the geodesic extension. The selected candidate changes 185,111 voxels
overall; 121,507 were previously unclassified. It does not fill chamber contents
in the renderer: the measured tissue density still determines what is visible.

## Source review and limitations

The original acquisition scale s4 was freshly read as uint16. Its 80 N5 blocks
are decoded with their declared X-fast, big-endian layout and edge padding is
cropped to [475, 475, 530]. The source attribute document and each compressed
block's SHA-256 are in `source-s4-attributes.json` and `source-chunks.json`.
The full source NPY SHA-256 is recorded in `packaging.json`.

The working grid uses the prior endpoint registration and 0.35-voxel Gaussian
filter for annotation calculations only. Review sections use the original s4
values, with the same display transfer for every candidate. RV cavity pixels
come from measured low-density components identified by the previously reviewed
cavity trajectories. Their distance is calculated in physical millimeters.

The exterior pass uses measured tissue at raw intensity ≥ 17,100, within a
conservative four-voxel dilation of the connected core at > 17,500. A one-voxel
registration guard avoids tiny categorical gaps. Existing regions provide
markers. The six-neighbor geodesic penalizes intensity differences and lower
density gaps and may not travel beyond the narrow physical collar. This is
distinct from the comparison candidate's unconstrained cavity-distance split.

The RV surface pass is limited to the existing ventricular territories. It
requires proximity to the measured RV cavity and separation from the LV cavity.
It tapers at basal and apical track ends to avoid extending the rule into valve
roots or the distal apex. Thin connected trabecular projections may extend the
RV ownership to 2.9 mm from the measured cavity. It does not use a broad fixed
halfspace or repaint an entire half of the myocardium.

All **43 prior targeted source controls** pass: 12 independent pre-v5 chamber and
arterial controls, 5 v5 aortic/RVOT correction controls, 20 earlier ventricular/
tricuspid boundary controls, and 6 earlier outer-contour refinement controls.
The last six were refinement points in the earlier work and are not represented
as independent validation. These checks verify retention and local consistency;
they do not establish global anatomical accuracy, a Dice score, or clinical
validation. The full point records are in `verification.json`.

Seven orthogonal sections and five native source-derived 3D projections were
reviewed. The native figures are scientific ray casts made outside the website;
they are not claims of a fresh browser test. Each before/after pair uses exactly
the same geometry, camera, intensity threshold and light, and differs only in
categorical colors. Surface pixel counts show better coverage, not correctness:

| Projection | Previously unclassified pixels | v12 unclassified pixels | Reduction |
|---|---:|---:|---:|
| RV cutaway | 6,401 | 211 | 96.7% |
| Outer anterior | 70,967 | 4,351 | 93.9% |
| Outer lateral | 67,902 | 5,305 | 92.2% |
| Outer posterior | 36,274 | 5,086 | 86.0% |

Files `rv-cutaway.jpg`, `outer-anterior.jpg`, `outer-lateral.jpg`, and
`outer-posterior.jpg` contain the surface comparisons. `x-source-review.jpg`
and `z-source-review.jpg` compare source, old labels and all three candidates.

### Actual RV-inflow preset

`rv-inflow-preset.jpg` additionally uses the existing `rv-inflow` source plane
and target from `public/assets/flow-views-v5.json`, including the app's oblique
camera direction, 0.94 camera distance and 0.32 perspective factor. It is not an
orthogonal substitute for that view. Its coordinate and depth inspection is in
`rv-inflow-review.json`.

In this preset, 39,126 remaining pink pixels are at the cut face (within 3 source
s4 voxels / 0.95 mm of the plane), while only 265 are farther behind the plane.
Those 265 are 3.05–10.29 mm from the tracked RV cavity, with a median of 8.31 mm.
Their distance does not by itself prove their anatomical identity; they were
therefore retained rather than broadly repainted. The dominant pink area in this
view is cut compact tissue, not the cavity-facing surface.

For an explicitly operational review region—visible surfaces behind the cut,
within 3 mm of the tracked RV cavity, at least 1 mm closer to RV than LV, and
source Z 266–460—LV-colored pixels fall from 39 to 0. This particular preset
already showed mostly blue RV inner surface; the larger cavity-facing correction
is visible in the orthogonal X cutaway. The operational region includes some
unchanged basal labels and is not an expert mask or a global accuracy metric.

The scan is a fixed, preserved donor. Valve hinge attachment, shared fibrous
tissue, small vessels and exact myocardial layer boundaries remain uncertain.
There is no new muscle-fiber tractography, learned segmentation, deformation,
slice realignment or fabricated anatomy in this revision. Expert editing and
independent source review would still be required before quantitative use.

## Asset and performance

The new immutable file is `labels-v12-da41d280d86b.raw.gz`, referenced by the
anatomy manifest. It is **330,435 bytes** compressed, only 13,570 bytes larger than
v5. Decoded size stays **35,573,106 bytes**; dimensions, texture type and GPU
allocation are unchanged. The previous label bytes are retained as a documented
baseline and are not selected by the updated manifest. Consumers must refresh
the anatomy manifest; the new volume filename prevents reuse of stale labels.

## Reproduce

The analysis scripts require Python, NumPy, SciPy, Pillow, Blosc2 and a C++17
compiler. Native comparison rendering uses OpenMP; it requires no browser,
display server or GPU. Choose a work directory outside the website:

```sh
python3 scripts/anatomy-v12-refine.py --work /path/to/work --stage fetch
python3 scripts/anatomy-v12-refine.py --work /path/to/work --source /path/to/work/source-s4.npy --stage prepare
python3 scripts/anatomy-v12-refine.py --work /path/to/work --stage compare
python3 scripts/anatomy-v12-refine.py --work /path/to/work --source /path/to/work/source-s4.npy --stage review-methods
python3 scripts/anatomy-v12-render.py --work /path/to/work
python3 scripts/anatomy-v12-refine.py --work /path/to/work --source /path/to/work/source-s4.npy --stage package
python3 tests/anatomy-v12-asset.py
```

The working/source volume is a research intermediate and is not needed to run
the website. The portable archive includes the final label asset, source
metadata, pipeline, baseline, checks and scientific review figures.

## Provenance

- [LADAF-2021-17 original dataset](https://human-organ-atlas.esrf.fr/datasets/1659197537), DOI 10.15151/ESRF-DC-1634390196. Source attribution: Brunet et al. / ESRF Human Organ Atlas; CC BY 4.0.
- [Brunet et al., Radiology 2024](https://doi.org/10.1148/radiol.232731), whole-heart HiP-CT study.
- [Earlier openly available study and source figures](https://pmc.ncbi.nlm.nih.gov/articles/PMC10592740/).

The prior reviewed contours, cavity tracks and valve{local-home} controls are retained
under `docs/anatomy/`. This revision is an annotation refinement on that existing
source-derived work, not a new donor segmentation applied to another source.
