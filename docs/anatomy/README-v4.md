# Source-guided anatomy overlay

The color layer is a **manually guided regional tissue segmentation of the actual LADAF-2021-17 scan**. Version 4 replaces the two boundary rules that caused conspicuous errors in version 3: the nearest-cavity division through the thick interventricular myocardium, and the constant source-Z cutoff between the right atrium and right ventricle.

## What changed

### LV myocardial continuity

Twenty-two reviewed axial contours follow the compact LV myocardial body from its basal transition to the apex. Their RV-facing arcs follow the visible boundary of the compact myocardial mass, preserving the continuous septal tissue that the previous distance-based assignment split in half. Smooth signed-distance interpolation connects the contours between sections. The posterior/free-wall contours were checked separately on off-axis sections and extended where the first candidate left a narrow strip of genuine LV muscle outside the envelope.

**Display convention:** the compact interventricular septum is colored with the LV myocardial body. The septum is shared anatomy, so this convention must not be interpreted as a separate, expert delineation of LV and RV myocardial layers. RV free wall and nonseptal trabeculated tissue retain the RV label.

### Curved RA–RV transition

The transition now follows source-observed tricuspid attachment and groove landmarks: seven free-wall hinges, seven septal hinges and seven outer-groove observations across the heart. Shape-preserving interpolation follows each track in source X, and a bounded smooth surface passes through the three observations in source Y. This retains the inferior fold of the RA wall and follows the oblique transition across the actual tissue instead of ending the atrium at source Z=270.

For example, in the central source X=237 section, the approximate free-wall attachment is near Y=140, Z=324, while the septal attachment is near Y=237, Z=268. These are manually reviewed regional landmarks, with several source voxels of visual uncertainty, not clinical annular measurements. Off-axis end caps prevent extrapolation of this central atrial depth into lateral ventricular sections.

The remaining atrial and outflow territories still use observed low-density cavity components and manually reviewed tracking paths. No fixed axial chamber cutoffs are applied. The allowed propagation distance around the right-heart cavity is limited to 9.528 mm, avoiding the previous extension of RV color into distant apical vascular/pericardial tissue.

### Finer label grid

The endpoint-aligned label grid is now **317 × 317 × 354**, approximately **476 µm** per label voxel, instead of approximately 635 µm. This reduces visible stair steps without increasing the source scan resolution or interpolating categorical label IDs. The original source intensity textures are unchanged by segmentation.

## Regions and interpretation

| ID | Region | Color | Interpretation |
|---|---|---|---|
| 0 | Unclassified tissue | `#9ba9b0` | No anatomical identity is asserted. |
| 1 | Left ventricle | `#e36d73` | Continuous LV myocardial body, including compact septal myocardium under the stated display convention. |
| 2 | Right ventricle | `#54a6e6` | RV free wall, nonseptal trabeculated structures and outflow territory. |
| 3 | Left atrium | `#f2b36b` | Collapsed atrial region; mitral, appendage and pulmonary-vein transitions remain provisional. |
| 4 | Right atrium | `#63c7ba` | Superior cavity wall and pectinate tissue, extending to the reviewed curved tricuspid junction. |
| 5 | Aortic outflow | `#c499e8` | Vessel continuous with the three-sinus aortic root and LV outflow; precise root/branch boundaries remain approximate. |
| 6 | Pulmonary outflow | `#61cce0` | Pulmonary trunk/outflow region adjacent to the aortic root and toward the RV. |

These labels tint **independently measured tissue density**. They must never be drawn as synthetic filled blood pools. Coronary arteries, cardiac veins, individual pulmonary veins, caval veins, valve leaflets and atrial appendages are not individually segmented; a nearby regional tint is not a vessel-specific identity.

## Source evidence

The original study's labeled control-heart basal section supports the RA, LA, aortic sinus and pulmonary trunk identities. Exchanging the display X/Y axes of source Z≈220 produces closely matching morphology. Its longitudinal views also support ventricular/outflow continuity. This supports the regional identities, not an exact clinical registration or expert valve boundary.

- [Original dataset](https://human-organ-atlas.esrf.fr/datasets/1659197537), DOI [10.15151/ESRF-DC-1634390196](https://doi.org/10.15151/ESRF-DC-1634390196), CC BY 4.0.
- Brunet et al., **Multidimensional Analysis of the Adult Human Heart in Health and Disease using Hierarchical Phase-Contrast Tomography (HiP-CT)**, 2023 preprint, [Figures 3 and 5](https://pmc.ncbi.nlm.nih.gov/articles/PMC10592740/).
- [Final peer-reviewed article, Radiology 2024;312(1):e232731](https://doi.org/10.1148/radiol.232731).

`anatomy-reference-comparison.jpg` retains the source/published basal comparison. The reference figure is attributed to Brunet et al., 2023, CC BY-NC 4.0. The source-derived review images are derivatives of the original scan under CC BY 4.0.

## Processing and reproducibility

1. Read the original s4 uint16 volume, XYZ 475 × 475 × 530 at 317.6 µm sampling. Review contours against the original s3 sections at 158.8 µm.
2. Build an endpoint-aligned working grid and apply a 0.35-voxel Gaussian filter **for labeling only**. The display textures are not filtered by this process.
3. Identify connected measured tissue with intensity >17,500, excluding the mounting container. Keep a two-label-voxel support margin so finer visible tissue is not artificially truncated by the label grid.
4. Extract actual enclosed low-density cavity components. Use the reviewed paths in `cavity-tracks.json` to identify the basal regions and combine the right-heart cavity into one initial territory.
5. Apply the tricuspid surface from `boundary-landmarks.json` to divide RA and RV. The outer groove controls the boundary through wall thickness; the two hinge tracks control its oblique course across the inlet.
6. Give the compact LV envelope priority, preserving the complete continuous LV/septal myocardial body. Cubic section curves and shape-preserving signed-distance interpolation connect the source-reviewed contours without an axial clipping plane.
7. Leave tiny disconnected assignments neutral, compress the categorical uint8 grid losslessly with gzip, and record exact dimensions, coordinate registration, method parameters and SHA-256 checksums in the manifest.

The anatomical landmarks are inputs, not model predictions. The code does **not** compute fiber tractography, train a segmentation network, or claim that muscle fibers have been individually segmented.

```sh
python scripts/prepare_anatomy.py \
  --volume /absolute/path/to/s4-volume-u16.npy \
  --review-volume /absolute/path/to/s3-volume-u16.npy \
  --work-dir /absolute/path/to/anatomy-work
```

Optional `--previous-labels` and `--previous-manifest` inputs generate the same-source before/after review. The default asset output is `public/assets/anatomy/`; review images are written to `docs/anatomy/`. NumPy, SciPy and Pillow are required.

## Runtime contract

`loadAnatomy()` in `public/anatomy-data.js` retains its original API:

```js
{
  data,       // Uint8Array, X fastest, then Y, then Z
  dimensions: [317, 317, 354],
  labels,     // legend entries, hex colors, descriptions and confidence
  palette,    // {id, color:[r,g,b]}, RGB normalized to 0..1
  manifest,
  sample      // sample([sourceNormalizedX, sourceNormalizedY, sourceNormalizedZ])
}
```

Every grid endpoint matches the corresponding original s4 voxel center. Sample with `round(sourceNormalizedXYZ * (dimensions - 1))`; do not linearly interpolate numeric categorical IDs. The map decodes to **35,573,106 bytes**. Its exact compressed byte count and checksums are recorded in the manifest.

## Review evidence and limits

The review includes the exact central X=237 section, additional longitudinal X/Y cuts and multiple axial levels. The independent review selected tissue landmarks before inspecting the revised labels, and checked small neighborhoods against the original uint16 scan. Subsequent outer free-wall checks address a separate contour-coverage problem. These are targeted regression checks, **not** a segmentation accuracy estimate.

- `anatomy-x237-before-after.jpg`: identical source intensity and framing, original scan versus v3 and revised annotations.
- `anatomy-long-axis-review.jpg`: X=200, X=275, Y=200 and Y=275 sections.
- `anatomy-axial-review.jpg`: 12 levels through the atria, ventricular body and apex.
- `boundary-landmarks.json`: reviewed LV contours, tricuspid hinge/groove tracks and explicit display convention.
- `boundary-validation.json`: independent tissue-point checks and validation qualifications.

No expert ground-truth segmentation, Dice score, chamber-volume accuracy or validated annular geometry is available. Mitral, outflow, appendage, septal-layer and distal vascular boundaries remain approximate. The labels should not be used for chamber-volume, wall-thickness, procedural or diagnostic measurements.
