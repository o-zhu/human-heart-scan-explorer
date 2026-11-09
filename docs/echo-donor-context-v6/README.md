# Independent S-20 context calibration

The two comparison hearts now have their own source landmarks, fixed anatomical
frames, posterior esophageal routes and inferior diaphragm/gastric profiles.
The original acquired hearts and all source voxel coordinates remain unchanged.
The same fixed specimen frame feeds TTE, TEE, the two labs and the reference torso;
selecting a view cannot rotate or translate the surrounding anatomy.

## Source and coordinate chain

`public/echo-donor-calibration.js` contains the manually reviewed source points.
They come from each donor's independent v17 chamber cavity tracks, valve-region
seeds, outflow tracks and LV envelope contours in
`docs/anatomy-donors-v17/source-guides.json`, supplemented by the current grayscale
long-axis section sweep. They are approximate source guides, not expert-labeled
valve annuli or patient registration.

The source-guide points use **original s4 voxel centres, XYZ**. The prepared
fine-centre registration adds 0.375 source voxel in each axis. At the donor's
native prepared reference extent, the conversion to world millimetres is:

```
q = (originalXYZ + 0.375 - (displayDimensionsXYZ - 1) / 2) * spacingMm
worldMm = [q.x, q.z, -q.y]
```

| Specimen | Prepared dimensions XYZ | Spacing | Reference extent |
|---|---|---|---|
| S-20-29 | 478 × 478 × 487 | 0.31824 mm | 154.66464 mm |
| S-20-28 | 477 × 477 × 509 | 0.31760 mm | 161.34080 mm |

An alternate runtime reference extent uniformly scales the landmarks, support
vertices and frame origin. Frame directions remain unit vectors. No array-axis
rotation is applied to source intensities or meshes.

### Endocardial versus epicardial apex

S-20-29 has a narrow, oblique distal LV cavity. A section through the outermost
compact-wall tip at source `[264,224,449]` misses much of that cavity. Its echo
long axis uses the source-reviewed distal **endocardial** cavity point
`[338,260,370]`. The outer tip is retained separately as `epicardialApex` and the
whole retained-source envelope governs clearance. These are different anatomical
purposes; the shorter cavity landmark does not shrink the measured heart.

S-20-28 uses `[193,198,475]`, the distal LV envelope point that aligns with the
source long-axis cavity. Chamber and valve-region locations are independently
specified for each donor. Neither donor borrows LADAF segmentation or old generic
A4C/ME4C axes.

## Fixed body and organ model

The rigid anatomical frame uses the measured LV long axis and the AV left/right
separation. Those independent source directions map to one declared oblique body
axis, with the apex inferior, left and anterior. The origin remains the midpoint
of the mitral and tricuspid region guides. The final body-axis choice is checked
against the actual bounded BodyParts3D skin triangles for apical access, and the
same fixed context constrains TEE probe estimates.

| Specimen | Unit MV-to-apex direction in fixed left/superior/anterior body axes | Source-axis skin contact in BodyParts3D reference mm |
|---|---|---|
| S-20-29 | `[0.40, -0.32, 0.8588364]` | `[90.23, -31.47, 105.89]` |
| S-20-28 | `[0.32, -0.48, 0.8168231]` | `[77.16, -50.79, 102.93]` |

The contacts are intersections with actual bounded reference skin triangles.
The parameter exploration is reproduced by
`scripts/echo-donor-qc-v6/fit-body-axis.mjs`. This fixed orientation allows the
apical source axis to reach the reference chest window without rotating the
four-chamber section to a generic body direction.

The original reference rib/sternum mesh intersected the wider preserved hearts,
even after the GI correction. Dense source-support sampling confirmed that this
was real envelope overlap. One **uniform, fixed torso factor** about the same AV
origin now scales all BodyParts3D skin, ribs, sternum and spine together: 1.35 for
S-20-29 and 1.22 for S-20-28, in addition to the existing physical reference
scale. The source heart, frame axes, GI and diaphragm do not move with this fit.
LADAF keeps factor 1.00 and its original geometry.

Both final apical contacts above remain on actual reference skin triangles in
the bounded apical window. The production A4C plane retains its source axis and
has no additional angular correction; apex and AV-region plane residuals remain
below numerical precision. Production upright cameras at 640 × 560 and 400 × 560
contain the complete source hull without changing that accepted plane.

An excised heart does not determine measured patient vertical or the surrounding
organs. The orientation and all gastrointestinal/diaphragm shapes remain
**illustrative**. No per-view correction moves the body, and no collision fix
moves the source heart. A failed constrained acquisition is reported by the
acquisition layer rather than moving an organ to that view.

Each S-20 esophagus follows its own posterior course. The diaphragm and stomach
are positioned from the donor's complete retained-source envelope, including the
outer apex. Their values live in the donor's `contextProfile`; they are fixed
before any individual probe or view is evaluated. LADAF retains its existing
frame, route and meshes. The additional LADAF `aorticRoot` point is the
source-reviewed root/cusp-region ROI `[242.5,252,235]` from the ME AV SAX source
catalog, corroborated by the proximal aortic cavity track. It is not an
expert-segmented annular centroid. The longitudinal flow focus `[260,265,270]`
is retained separately as `leftVentricularOutflow`; it gives a better-preserved
qualified apical five-chamber section than aiming at the cusp ROI. These
additional source guides do not change LADAF's fixed origin or axes.

## Reproducible exterior-envelope check

Run from the source checkout with NumPy and SciPy:

```
{temporary-cache}/bin/python scripts/echo-donor-context-v6.py
```

The script verifies each immutable compressed/decoded support-mask checksum,
extracts all boundary cells and recreates the compact convex hull used by the
entry estimator. `--write-support` intentionally regenerates
`public/echo-donor-support.js`; the default verifies it without writing.

Every triangle of every authored GI and diaphragm surface/contour is sampled on
an adaptive barycentric grid whose longest subtriangle edge is at most 0.8 mm.
The check measures nearest retained-source boundary-cell distance and verifies
that no sampled point occupies a retained support cell. A conservative continuous
surface bound subtracts both 0.8 mm for the triangle sampling radius and half a
source support-cell diagonal. A positive bound therefore tolerates the source
cell's full spatial extent and unsampled points between triangle samples.

A second continuous test checks **every entire triangle** against all planes of
the retained-source convex hull. Each triangle must lie wholly outside at least
one supporting plane, with a positive margin after subtracting half the source
cell diagonal. This rules out routing an organ through a chamber cavity as well
as through tissue; it does not depend on triangle-interior sampling.

| Specimen | Sampled triangle points | Minimum conservative distance from retained source | Minimum continuous separation from source convex envelope |
|---|---:|---:|---:|
| S-20-29 | 606,436 | 5.07 mm | 5.72 mm |
| S-20-28 | 638,325 | 5.89 mm | 6.66 mm |

These minimum values include every esophageal/gastric/diaphragm surface and
contour. No sampled point lies inside the retained source support.

The same script also writes `body-placement.json`. It checks every complete
reference-skin, rib/sternum and spine triangle against the source convex envelope
and requires a continuous 2 mm guard after source-cell uncertainty. All 14,349
rib/sternum triangles pass in each donor; their minimum guarded separations are
**3.55 mm for S-20-29 and 3.38 mm for S-20-28**. Skin and spine pass as well. Every
source-hull vertex has an actual anterior skin intersection and lies behind it.
Reference-torso fitting remains an illustrative placement, not measured patient
body size or registration.

`clearance.json` records all mesh counts, sample counts, distances, conservative
bounds, source checksums and current module fingerprints. The support itself
already includes its original conservative threshold/margin policy. This test
establishes separation from the displayed heart envelope. It does not establish
organ dimensions, patient registration, esophageal pressure or safe clinical
probe handling.

The focused JavaScript regression is:

```
node --test tests/tee-context-v2.mjs tests/echo-anatomy-context-v2.mjs
```

It verifies anatomical ordering and topology, fixed-frame invariance, per-donor
source identity, physical scaling and independence from selected atlas planes.
The full acquisition/source-image review is recorded separately by the current
all-view Echo audit and native gallery.
