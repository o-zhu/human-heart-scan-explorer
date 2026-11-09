# Heart Explorer: motion and detail experiment

This experiment addresses two separate questions: how much acquired detail was
lost in the clinical CT display, and whether the existing detailed fixed-heart
reconstruction can be animated without repeatedly reconstructing its surface.

## Delivered experiment

`/motion-lab.html` contains a specimen deformation view and a matched native CT
comparison. The specimen view reuses the existing immutable guided-native-v21
collection. The clinical comparison has its own collection and processing record;
it does not replace any existing clinical volume or reconstruction.

The existing whole-heart reconstruction page links to this optional lab. Default
playback is paused. Source identity and whether motion is acquired or modeled are
visible above the canvases. Loading commits complete pairs transactionally.

## What was actually found in the CT source

The original `TruncalValve_4DCT.seq.nrrd` is a 512 × 391 × 218 spatial grid with
21 sequence indices and spacing 0.599609375 × 0.599609375 × 0.7 mm. Sequence index
20 repeats index 0 exactly, leaving 20 unique phases. Physical ECG timestamps
are not supplied. The public SlicerHeart source describes an adolescent with
repaired truncus arteriosus; this is not a normal adult reference heart.

The current whole-heart cine derivative uses a crop x=[60,350), y=[115,365),
z=[0,218), reduced by 2 × 2 × 2 block averaging. Its spacing is consequently
1.19921875 × 1.19921875 × 1.4 mm. Restoring the native grid doubles linear
sampling and restores eight times as many spatial samples. That ratio is not
an eightfold improvement in effective resolution. Reconstruction blur, motion,
noise, threshold choice, and the display extraction remain relevant.

Original compressed source SHA-256:
`7573f1bc7ca92d7d1012eecf98211cfd9939c1d22d87aee1db91c8ab72031cfb`.

The clinical pilot's authoritative per-frame settings, surface hashes, sampling,
and reduction measurements are in `native-ct-metrics.json` and the public
`assets/motion-lab-v24/native-ct/manifest.json`. Source intensity units are not
relabeled as calibrated HU. These are fixed-threshold intensity isosurfaces,
not expert chamber or myocardium segmentations.

## Geometry used for the deformation

- Specimen: LADAF-2021-17, ESRF Human Organ Atlas.
- Source sampling: 19.85 µm isotropic.
- Whole-heart display: the existing 79.4 µm sampled and subsequently simplified
  surface, with 2,500,000 triangles and 699,001 vertices in the detailed option.
- Whole-heart compressed SHA-256:
  `b690678f8a19fa24e5237e499275e8ac8aa94f1002365d441d6468e0f12cd2ef`.
- Three native 128-cell regions use the archived native reconstruction and the
  existing v22 removal of small detached interior fragments. No extra smoothing
  or reconstruction is performed during animation.
- World coordinates are native x,z,-y, centered on the scan and divided by
  8479. One world unit is 168.30815 mm.

The stored geometry is never overwritten. Each draw transforms coordinates and
normals in a vertex shader. The native-region camera follows its moving center.
The same donor-space field drives the whole-heart display and the native region.
The whole-heart display is explicitly not the full native-resolution bank.

## The motion model

The model is illustrative. It is not registered to dynamic CT, has no fitted
LV/RV segmentation, and does not identify the specimen's fixed pose as
end-diastole. A manually specified long axis and central cavity define smoothly
varying longitudinal shortening, radial redistribution, and optional twist.

With amplitude A in [0,1], quintic transition w(y), and axial map g(y), the
cavity-aware field uses:

```
g(y) = y - 0.10 A w(y) (y + 0.07)
q = ((x - 0.055)^2 + (z + 0.045)^2) / 0.145^2
F(q) = (1 - exp(-q)) / q, with its continuous limit at zero
k^2 = (1 - 0.44 A w(y) F(q)) / g'(y)
theta = 0.22 A w(y), when twist is enabled
```

The radial coordinates are multiplied by k and rotated by theta. This gives
`det(J) = 1 - 0.44 A w(y) exp(-q)`, whose analytical lower bound is 0.56.
The minimum axial derivative over the allowed amplitude range is approximately
0.8357615. Volume change is concentrated near an assumed central cavity and
approaches zero farther away. The assumption is not aligned to actual tissue
labels, so this does not establish myocardial volume conservation.

A simpler uniform radial squeeze is included for comparison. The cycle envelope
closes exactly and has zero motion at the reference pose. Normals use the
inverse transpose of the full spatial Jacobian, including axial and twist
derivatives, so lighting follows the deformed surface.

## Verification completed

`deformation-audit.json` records the JavaScript audit:

- Rest recovery and cycle closure are exactly zero for all 699,001 source
  vertices; source arrays and mesh connectivity remain unchanged.
- A grid of 18,081 points has positive Jacobians. Analytical and finite-difference
  determinants agree to about 1.2e-9 in the checked samples.
- Peak modeled displacement reaches about 14.29 mm. This is a model output,
  not a measured cardiac displacement.

`render-report.json` records independent EGL verification of the exact GLSL
strings used by the browser:

- Shader compilation/linking passed.
- 2,264 transform-feedback samples across six settings agreed with the actual
  JavaScript implementation to a maximum position difference of 0.000020613 mm.
- Shader normals agreed with independently finite-differenced reference normals
  to a maximum angular difference of 0.002066 degrees.
- Matched exterior and open-cutaway renders show coherent detail under both
  motion models. See `render-comparison.png`.

These are numerical and rendering checks, not physiological validation. The
render evidence uses Mesa EGL and is not a browser FPS benchmark. No chamber
ejection fraction, myocardial strain, or valve mechanics claim is made.

## Toward motion derived from measurements

The next scientifically useful stage is anatomy-aware motion transfer. Segment
chambers, myocardium, annuli, apex, and outflow structures; estimate a periodic,
regularized deformation from a gated sequence; then map that motion to the
specimen while preserving its original reference geometry.

If A maps the specimen H to a dynamic reference D0, and phi_t maps D0 to phase
Dt, a reference-preserving transport is `T_t = A^-1 o phi_t o A`. Simply applying
`phi_t(A(x))` changes the donor's reference shape. The transported field needs
its own volume and strain checks: determinant constraints in the source space
do not automatically remain identical under a nonrigid intersubject mapping.

A coarse volumetric cage, B-spline grid, or embedded deformation graph can drive
millions of dense vertices. A 64^3, three-component FP16 displacement grid is
1.5 MiB per phase, or 30 MiB for 20 phases; that is a storage illustration, not
an accuracy guarantee. Fine leaflets and chordae need separate attachments and
contact/slack models. A smooth shared field alone cannot recover their true
relative motion or separate structures already fused in the reconstruction.

For the clinical CT itself, a higher-quality phase propagated by measured
registration can reduce frame-to-frame segmentation flicker. Motion-compensated
temporal denoising is another useful candidate. Averaging unregistered phases
would blur moving anatomy. Generative super-resolution would need explicit
labeling and validation because plausible fine detail may be invented.

## Primary sources

- SlicerHeart sample definition and clinical description:
  https://github.com/SlicerHeart/SlicerHeart/blob/master/ValveAnnulusAnalysis/ValveAnnulusAnalysis.py
- Human Organ Atlas source specimen:
  https://human-organ-atlas.esrf.fr/datasets/1659197537
- Brunet et al., *Multidimensional Analysis of the Adult Human Heart in Health
  and Disease Using Hierarchical Phase-Contrast Tomography*, Radiology (2024):
  https://pubmed.ncbi.nlm.nih.gov/39012246/
- Malin et al., *Library of realistic 4D digital beating heart models based on
  patient CT data*, Medical Physics (2025):
  https://pmc.ncbi.nlm.nih.gov/articles/PMC12409789/
- MONAI Physio's current data descriptions and downloadable Duke labelmaps:
  https://project-monai.github.io/monai-physio/cli_scripts/download_data.html
- Sumner and Popović, *Deformation Transfer for Triangle Meshes* (2004):
  https://people.csail.mit.edu/sumner/research/deftransfer/
- Sumner, Schmid, and Pauly, *Embedded Deformation for Shape Manipulation* (2007):
  https://people.inf.ethz.ch/sumnerb/research/embdef/Sumner2007EDF.pdf

Specimen source data is CC BY 4.0. SlicerHeart's project BSD-3-Clause notice is
preserved; no separate sample-specific data license is asserted. Source
provenance and motion provenance remain separate throughout the interface.
