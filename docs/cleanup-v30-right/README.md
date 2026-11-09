# v30 pulmonary and right-ventricular display cleanup

This pass reconstructs two bounded regions from the verified 79.4 µm source. The source is a windowed phase-contrast display volume, **not calibrated Hounsfield units**. Original source bricks, native scientific reconstructions, the original whole-heart mesh and the original CT section pixels remain unchanged.

## Why the previous pass missed visible material

The coronal section shown as 190 is fine-grid X = 756. Visible surfaces behind that cut need not lie at X = 756. Likewise, the sagittal section 293 is a cut at Y = 1168, while the visible RV surface can be hundreds of samples deeper. We used a production-shader coordinate attachment to read the source XYZ of the actually visible surfaces, then checked neighboring original sections.

The conspicuous RV chain includes approximately X = 783–805, Y = 1078–1143, Z = 949–1088. Much of this was outside both the previous PA crop (X maximum 790, Z maximum 972) and the previous tricuspid crop (Y maximum 1040). After removing the foreground chain, a second reticular layer became visible near X = 810–849, Y = 1094–1122, Z = 858–926. Lower chordal fringe was visible near X = 705–740, Y = 679–688, Z = 1192–1248, just beyond the old first reviewed tricuspid section and its end collar.

The new disjoint crops are:

| Replacement | Lower fine XYZ | Upper fine XYZ, exclusive |
|---|---|---|
| Pulmonary root and upper RV |580,1064,540|870,1380,1112|
| Tricuspid network and deeper RV |590,640,894|880,1060,1360|

Both crops remain separate from the unchanged v29 exterior crop and the left-side v30 reconstruction. Original intensity samples at all six crop faces have exactly the baseline signed field; the complete face audits are stored in each selected policy.

| Selected result | Pulmonary/upper RV | Tricuspid/deeper RV |
|---|---:|---:|
| Excluded source foreground samples |2,116,579|1,564,894|
| Previous exclusions retained |1,139,693 of 1,139,693|769,532 of 769,532|
| Newly added foreground samples |0|0|
| Delivered triangles |846,757|714,790|
| Mesh gzip bytes |8,450,177|7,396,030|
| Mesh GPU bytes |14,752,116|12,736,992|
| Packed mask GPU bytes |6,687,824|7,241,640|

The two replacements together require 41,418,572 decoded GPU bytes. These sample counts describe display exclusions, not measured pathology or anatomical tissue volume.

## Methods compared and selection

The retained candidate combines local 3D grayscale opening with a 3D median field. Sustained bright-neighborhood support keeps coherent thin structures on the median field; isolated bright peaks do not receive an unconditional exemption. Traced additional RV zones use a 3D structure tensor to raise the source-contrast gate further in multidirectional fringe while retaining a lower gate for coherent sheets and tubes. Polygon influence uses convex C1 interpolation and smooth collars; overlapping zones blend smoothly. Source filtering uses real padded source samples and does not restart at slab boundaries.

We compared median 3, median 5, total-variation weight 22, unprotected grayscale opening, stronger localized intensity gates and the final coherence-guided method. Increasing the PA gate to 170 produced holes in a retained thin surface and was rejected. Unprotected opening removed more fine fringe but attenuated coherent thin arcs and was also rejected. The final method keeps the broad valve contours and source-supported continuous strands while substantially reducing the irregular web around them. It does not aim to make the physiological lumen completely empty.

Every previously excluded voxel remains excluded. The builder reconstructs the prior scalar field and verifies its negative mask against the exact prior mask before inheritance. It inherits **negative exclusions only**: the old raw 190 positive guard made some retained values only 0.001 above the isosurface, and importing those positive values undermined regularization. The selected policies record zero prior-mask losses and zero disagreement with the reconstructed prior mask.

The new field is removal-only relative to the baseline source field. It adds no foreground samples. An unchanged dense source core is preferred to an unsupported smooth fill. These are reversible educational display corrections, not clinical segmentation labels or a claim that every remaining strand is an artifact.

## Geometry and transport

Each complete local zero isosurface is extracted before reduction. The reducer keeps crop boundaries fixed, enforces interior edge-link constraints and has a conservative 0.3176 mm radius limit. Bidirectional sampled surface deviations against the regularized unreduced surface are recorded in the selected policies; these measure reduction error, not anatomical accuracy. The HFM representation packs positions and normals and retains exact triangle indices. Root canonical assembly may split gzip transport into multipart objects without changing the decoded mesh.

## Review evidence

The final review uses the current deployed seam-corrected Gentle normals, decoded SHA256 `ef468a2ebf15f11cf57f8443e7d3555f8d53fc1a43b9582125bbbabe304d6ad8`, mapped through original vertex IDs. Original positions, indices and debris flags are unchanged. Both new right patches are loaded together with the other current patches. The entire retained half-space is rendered; there is no artificial depth slab hiding residual geometry. Frustum culling removes only offscreen or clipped triangles.

Eight completed and visually reviewed final cameras include exact coronal 190, neighboring 188 and 192, a closer 190 view and an oblique 190 view, plus sagittal 293 and neighboring 285 and 301. Production GLSL is used. The original measured cut-face arrays are hash-checked, and the critical views check that returning to the previous set and disabling cleanup reproduce exact pixels. Initial method-comparison images used original Gentle normals; they are geometry comparisons and should not be used to assess the currently deployed stripe correction.

The final coronal 190 and sagittal 293 critical comparisons passed both exact restoration checks. The formerly missed long RV chain is substantially reduced, and the PA cavity has less detached and irregular material. Broad wall contours and the continuous bright chordal/valve structures remain. A branching reticular band remains conspicuous in the PA close view and neighboring cuts. Upper-right perforated/reticular material and fine lower chordal fringe remain visible in all three reviewed RV cuts. The adjacent and oblique views show no obvious hard crop-plane seam or broad wall truncation; this is a visual review, not an anatomical accuracy guarantee. An AFTER-render coordinate readback confirmed that the inspected PA residual is within the reviewed crop, rather than another unprocessed deeper layer. Several retained strands have strong neighboring source contrast; source values alone do not establish their anatomical identity. We do not label all remaining strands as artifacts or claim an artifact-free model.

The eight-case review summary, including per-view limitations and exact validation references, is `selected/final-review-summary.json`. Selected policies and surface statistics live in `selected/`; final paired renders and their source-cap hashes are in `final-review/`. Source serial images are in `source/`. Intermediate method comparisons are retained separately so the less satisfactory candidates are reviewable.

## Reproduction

Use the existing verified source bank and `{temporary-cache}/bin/python` (or an equivalent environment with NumPy, SciPy, scikit-image, VTK and EGL). The numerical builder is `scripts/cleanup-v30-right/build_regularized.py`; the selected configs are `pa-selected.json` and `rv-selected.json`. Run the inherited `scripts/cleanup-v28-right/compact_patch.py` with `--radius-mm .3176 --samples 16000`, then the v30 render and packaging helpers. The original source bank is required; these reports are not a replacement for the scientific source data.
