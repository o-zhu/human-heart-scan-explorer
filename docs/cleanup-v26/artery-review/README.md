# Focused arterial residual review

These diagnostics investigated the remaining pulmonary-artery flakes in the
first v26 comparison. They document a **candidate before the subsequent
geometry-membership refinement**. They are not the final release acceptance
images; use the parent cleanup render receipt for those.

The diagnostic projects the original complete HFM through the same production
camera, clipping, display masks and depth buffer. A flat vertex attribute writes
the uncut mesh component ID alongside the first visible surface's fine-source
XYZ coordinates. All three vertices of an original triangle belong to one
component, so this lookup does not rely on nearest-vertex inference.

## Findings

- Most sampled visible pulmonary-artery flakes belong to component 7, the main
  connected surface with 15,863,437 triangles. This establishes mesh attachment,
  not biological tissue identity.
- The sampled lower cluster is only 1–3.16 fine samples from the dense anchored
  source support in the same plane: approximately 0.08–0.25 mm. The existing
  ten-sample guard retains it. A sampled upper flake is 7.62 samples (0.60 mm)
  from that support. Automatically removing this entire connected material
  would also bypass the current wall-protection rule.
- At the two sampled positions where the spatial mask is set, v26 does move the
  first visible surface deeper. At comparison pixel (325,450), source Y changes
  from 1098.01 to 1080.95; at (390,400), it changes from 1030.55 to 1020.15.
  Similar-looking deeper wall-side surfaces remain after that foreground is
  removed. The bit-packed mask is therefore active at these locations.
- Component 287135 is a definite separate mesh component: 38 vertices, 70
  triangles and a 1.005 mm bounding-box diagonal. All 38 vertices are inside the
  reviewed arterial cavity, although the original bounding-box-corner gate did
  not select the component. Only 23 of its vertices initially lay inside the
  spatial exclusion, leaving a visible piece.

The actionable correction is to test the actual detached geometry against the
reviewed lumen instead of requiring its empty bounding-box corners to be inside.
The cleanup builder owns that correction and its subsequent validation. Retain
the main-surface, source-boundary and size safeguards. For small triangles,
testing every original vertex plus face centroids and edge midpoints gives a
more directly relevant sampled membership check; it is not a continuous
geometric-containment proof.

The mesh-connected, wall-adjacent bases remain uncertain display material. The diagnostic
does not establish that they are free floating, diagnose clot, or validate
trimming the vessel wall. A further local wall segmentation would need its own
source and surface review.

## Reproduction

```bash
python3 scripts/cleanup-v26/artery_review_v26.py
python3 scripts/cleanup-v26/artery_review_v26.py --v26
```

`--v26` reads the current assets, so a later rerun intentionally reflects later
cleanup decisions. Raw float location rasters remain outside Git under
`{source-cache}/cleanup-v26/artery-review*`; the compact JSON receipts are here.
The 44-pixel heading is subtracted from each comparison-image Y coordinate.
Source support metrics reproduce the builder's sigma 0.5/0.8 filters, raw 190 /
filtered 135 dense support, 400-sample wall anchor and in-plane distance. These
metrics do not modify source arrays or define anatomical ground truth.
