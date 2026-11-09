# Review of the two screenshot lumen clumps

## Result and limits

The two screenshot objects were located in the **main explorer's 79.4 µm fine mesh**, at the displayed Y section 297/475 and X section 246/475. They were not screenshots of the separate native 19.85 µm inspector. The nearby-camera renderings in this directory reproduce the same distinctive clumps and surrounding anatomy at those exact cut planes.

Both candidates have support in the measured source images. Both also join the main connected component of the shipped mesh. Their material identity cannot be determined from these images: this investigation does **not** establish that they are acquisition artifacts, blood, foreign material, or tissue. Their darkness is not sufficient evidence for removing them. The stippled dark face is substantially the measured 3D cut-face texture; a surface-only deletion would leave that face visible.

The implemented result is therefore a **reversible, optional display exclusion**, with the original 3D view as the default. It hides the compact upper atrial nodule and most of the reviewed upper outflow clump. It deliberately retains the large attached atrial sheet, its bright internal structure, and the thin attachment visible at full fine Y=1224. Some protected fragments remain. No mask was expanded simply to remove every residual speck.

All original volumes, mesh files, quantitative source files, and measured 2D CT sections remain unchanged. The optional 3D cut face is intentionally subject to the same display exclusion as the mesh, so it should be presented as a review view. Turning the control off restores the original display.

## Evidence

The read-only s4 context is in [s4-source-section-context.png](s4-source-section-context.png). The underlying uint16 source was memory mapped from the existing recovery cache; no full fine volume was assembled. Fine planes were read from the existing 79.4 µm display-bank bricks, checking both compressed and decoded SHA-256 hashes for every consumed brick.

The [atrial fine sections](atrial-candidate-fine-sections.png) and [outflow fine sections](outflow-candidate-fine-sections.png) compare three neighboring measured planes with the original σ0.8 isocontour and intersections of the shipped compact and detail meshes. The contours follow actual source signal. The two central mesh candidates belong to the main organ component, rather than isolated floating components; see [mesh-component-audit.json](mesh-component-audit.json). A global component filter would therefore either leave them or damage connected geometry.

The [atrial geometry review](atrial-geometry-review.jpg) and [outflow geometry review](outflow-geometry-review.jpg) use production GLSL, the actual HFM1 meshes, and source-derived fine cut faces. The red diagnostic region only identifies the neighborhood. It is **not** a deletion box. Exact screenshot camera state was unavailable, so the camera is a documented nearby view rather than a claimed pixel registration to the screenshots.

Final paired views using the actual production cleanup shader paths are:

- [Atrial original / optional exclusion](candidates/atrial-display-exclusion-review.jpg)
- [Outflow original / optional exclusion](candidates/outflow-display-exclusion-review.jpg)
- [Atrial source and final mask](candidates/atrial-mask-source-review.png)
- [Outflow source and final mask](candidates/outflow-mask-source-review.png)

The initial broader atrial experiment was rejected. Removing its weak attached sheet exposed bright folded internal geometry and risked a thin attachment. The final atrial mask was narrowed to the compact round nodule, then trimmed to retain all source x<1207 and z≥800. The initial rule protecting every isolated bright noise voxel was also rejected because it left visually confusing fragments. The final protection follows strong structures anchored outside the reviewed object envelope, while isolated bright specks wholly within the selected object can be excluded with it.

## Source identity and intensity interpretation

The fine input is the existing cleaned, windowed uint8 display bank, pinned to manifest SHA-256:

```text
e50ab70a52373dc774cf6077ef906a753e56b78b9f9b646fba2ffe7220ff338c
```

The source spacing is 79.4 µm and full fine dimensions are `[1897, 1897, 2117]` in acquisition XYZ. The display bank derives from the established raw-unit window 14640–23545. Its display values are **not calibrated Hounsfield units**. These masks use local measured contrast, source connectivity, reviewed location, and explicit protection; they do not infer tissue identity from a generic clinical HU range. A calibrated intensity model would require calibration/provenance beyond this uint8 display bank.

The selected cores have low display contrast relative to surrounding strong tissue. The final core means are approximately 94.3/255 for the outflow candidate and 88.0/255 for the atrial candidate. These are descriptive display values, not physical density or a biological classification. The surface threshold is 0.28, or 71.4/255.

## Frozen mask assets

The public package is `public/assets/lumen-cleanup-v23/manifest.json` and two gzip assets. The arrays are uint8 in ZYX storage order, with 0 meaning original display and 255 meaning optional exclusion. They use nearest-neighbor sampling in an R8 texture. Both checksums and exact byte counts are carried in the manifest.

| Candidate | Array dimensions XYZ | Lower full fine XYZ | Upper full fine XYZ, exclusive | Selected mask voxels | Gzip bytes |
|---|---|---|---|---:|---:|
| Upper outflow | 230 × 210 × 190 | 900, 940, 230 | 1130, 1150, 420 | 120,599 | 24,922 |
| Compact upper atrial | 180 × 150 × 160 | 1140, 1100, 690 | 1320, 1250, 850 | 121,374 | 14,189 |

The larger array bounds include background and protection context. The actual nonzero mask bounds are `[931,984,255]` to `[1078,1092,359]` for outflow, and `[1207,1142,719]` to `[1287,1213,800]` for atrial, with exclusive upper bounds. The actual object-shaped mask must be sampled; deleting the rectangular bounds or diagnostic highlight region would be incorrect.

The public gzip SHA-256 values are:

```text
outflow  81475e7fc91a8338c33d7bf46a3428c8aab4e213e0003447f56f9c9b23af080d
atrial   0d8da32de585baee4b23c47ab7336b17c83a9533f655ebd691e3a0263879565c
```

The final public manifest SHA-256 is `8f46d7ce4dc07c41f1c50717d4fe63a60e667fb89862fae97b213bd1e4aee077`.

### Selection and protection policy

1. Read the source only within the two bounded candidate regions. Filter the scalar field with the established σ0.8 setting and use the existing surface threshold, 71.4/255.
2. Restrict selection to the manually reviewed local ellipsoidal envelopes. The atrial envelope has the additional conservative x and z limits described above. The envelope alone never selects a voxel.
3. Identify strong support as filtered value ≥135/255 or raw display value ≥190/255. Protect every 26-connected strong component extending outside the reviewed envelope. Apply this protection to the union obtained from both σ0.8 and the new gentler σ0.5 field.
4. Add a four-fine-voxel spherical guard around that anchored support: 0.3176 mm. Select only foreground components connected to the reviewed candidate seeds outside the guard.
5. Expand the selected object by two fine voxels, 0.1588 mm, to cover the interpolated isosurface boundary. The expansion remains inside the reviewed envelope and cannot enter protected support or its guard.

The additional σ0.5 verification initially found five atrial voxels on newly connected strong support. The final masks were conservatively reduced by 1,074 voxels in total, covering that support and its guard. This revision was asserted to be a strict subset of the previously reviewed masks. No new excluded material was added.

These numeric rules provide an auditable display selection, not a validated anatomical segmentation. Thin structures outside the narrow reviewed candidates are untouched; classification inside a candidate remains an interpretive limitation, which is why original display is the default.

## Coordinates and shader integration

The main explorer uses acquisition XYZ mapped to world `(x,z,-y)`, centered on the full-source **voxel endpoints**. It has physical longest extent 168.0104 mm. For a world position `p`:

```glsl
vec3 fineXYZ = vec3(p.x, -p.z, p.y) * 2116.0
             + vec3(948.0, 948.0, 1058.0);
vec3 uv = (fineXYZ - lowerFullFineXYZ + 0.5) / dimensionsXYZ;
```

Return zero outside `[lowerFullFineXYZ - 0.5, upperFullFineXYZ - 0.5)`. Inside, sample the R8 texture with nearest-neighbor filtering; a normalized value greater than 0.5 means exclude. The renderer's equivalent `toTex(p) * (fullFineDimensions - 1)` expression uses the same endpoint convention and existing extents.

Screenshot section 297/475 is zero-based s4 Y=296, or fine Y=1184. Screenshot section 246/475 is zero-based s4 X=245, or fine X=980.

The production integration samples the same masks in the fine-mesh fragment path, shared density/AO path, and 3D cut-face path. It leaves the separate measured CT-section pipeline unchanged. The manifest pins the donor, source manifest, source spacing, source dimensions, and extent to prevent applying these masks to another donor or coordinate system.

## Validation

[sigma05-source-compatibility.json](sigma05-source-compatibility.json) records the check against the gentler σ0.5 field. The final masks cover 99.099% of selected outflow candidate voxels and 99.705% of selected atrial candidate voxels at that filtering level. Local candidate boundary coverage is 98.288% and 99.062%, respectively. These percentages measure this narrow display selection, not whole-heart reconstruction accuracy. Residual source-supported or protected fragments are deliberately retained.

There is zero overlap with anchored strong support or its four-voxel guard for both tested filtering levels. The atrial mask has zero selected voxels on fine Y=1224 and at z≥800. The [source-contour comparison](sigma05-source-compatibility.png) shows the mask alongside both σ0.8 and σ0.5 contours without expanding it.

[production-mask-render-validation.json](production-mask-render-validation.json) records actual production GLSL, frozen public masks, both legacy mesh LODs, and both screenshot cut planes in native EGL. The original → excluded → original sequence restores every one of 604,800 output pixels exactly. Depending on view/LOD, 3,883–6,470 pixels change when cleanup is enabled. Zero pixels change outside projected nonzero mask support plus the finite AO influence neighborhood. The allowance is 0.025 world units, approximately 4.2 mm, covering the shader's maximum 0.024-unit AO sample distance. Source-cap texture bytes remain unchanged.

The [final gentle-mesh validation](gentle/production-mask-render-validation.json) repeats these checks with the actual completed 23,618,685-triangle asset from `public/assets/fine-surface-v23/manifest.json`. It verifies and decodes the ordered byte-range parts as one gzip stream, checks the decoded HFM layout and indices, and uploads the quantized geometry once for both views. The joined gzip SHA-256 is `d93d62cdb331c5deb507cc47102da0c9f9dd3c84ad1aa5f0f0a3ebad04691ba2`. No full compressed or decoded disk copy was created.

| Final gentle view | Changed pixels with optional exclusion | Changes outside mask and AO support | Original → excluded → original |
|---|---:|---:|---|
| Atrial screenshot plane | 6,404 / 604,800 | 0 | Every pixel restored exactly |
| Outflow screenshot plane | 4,265 / 604,800 | 0 | Every pixel restored exactly |

The final [atrial pair](gentle/candidates/atrial-display-exclusion-review.jpg) and [outflow pair](gentle/candidates/outflow-display-exclusion-review.jpg) show the same conservative selection applied to the new mesh. The guarded remnants and attached atrial sheet remain visible. No masks were expanded for the new geometry.

The [matched-camera earlier / gentle comparison](gentle/polished-vs-gentle-matched-camera.jpg) has optional exclusion **off in both columns**. Its [comparison receipt](gentle/polished-vs-gentle-matched-camera.json) verifies identical camera parameters, source-cap bytes, rendering settings, and exported GLSL fingerprints; it reuses the existing rendered originals without another render. The new surface retains finer texture and also exposes more small speckles, as expected from less aggressive filtering. The nearby reproducible screenshot-plane camera and visual difference do not establish anatomical ground truth.

These offscreen checks are not browser performance measurements or anatomical validation. The independent source-space compatibility check does not depend on a particular triangle simplification.

## Reproduction and recovery

Scripts are in `scripts/lumen-artifacts-v23/`:

- `source_sections.py`: memory-mapped s4 source context.
- `fine_sections.py`: hash-verified fine planes and existing mesh intersections.
- `component_audit.py`: mesh-component topology near reviewed seeds.
- `build_candidate_masks.py`: reproducible local candidate selection and both-filter protection.
- `publish_masks.py`: packages frozen reviewed masks as 0/255 public arrays, with pinned expected hashes.
- `verify_gentle_compatibility.py`: source-space compatibility and attachment protection checks.
- `render_candidates.py`: actual production shader off/on/off comparisons and spatial invariance checks.
- `mesh_transport.py`: bounded, checksum-verified loading of ordered gzip byte-range parts without full mesh disk copies.
- `compose_surface_comparison.py`: composes the matched-camera legacy/gentle figure only after camera, source-cap, settings, and shader comparability checks pass.

The shared bounded reader is `scripts/fine-detail-v23/source.py`. Input bricks are reused in place with a small cache. No full fine array, cloud reconstruction job, or source alteration is required to recover or reproduce this work.
