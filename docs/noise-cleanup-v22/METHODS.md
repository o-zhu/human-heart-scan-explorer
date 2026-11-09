# Native cavity-clutter cleanup: method comparison

**Status:** bounded successor research; no whole-organ replacement is established by this note. Preserve the published v32 scientific fingerprint, native bank and source intensities. Any changed segmentation requires separate configuration, provenance and outputs. See the [project contracts](../../AGENTS.md) and [prior intensity review](../guided-native-v21/INTENSITY-RECOVERY-REVIEW.md).

## What the current diagnostics imply

The initial reconstruction-team overview diagnostic reports approximately **98% of triangles in one large connected component**, leaving approximately **2% in detached components**. Native sample diagnostics report roughly **100–300 foreground components per sampled region**. These are preliminary, representation-specific observations, not anatomical labels or interchangeable measures: a simplified overview triangle graph differs from a native voxel mask, and local components may continue outside their crop. Preserve the empirical pilot reports alongside any release decision.

Consequently, detached-component suppression may improve visible specks while leaving much of the cavity clutter. Its observed overview scope is limited; the figures do not establish what fraction of visible artifacts it will remove. They also do not establish that the giant component is correct tissue. If clutter is connected to a wall, ordinary component-size filtering cannot separate it. Increasing smoothing is not an automatic remedy: the existing intensity review records losses/changes in narrow clefts and weak strands when filtering is strengthened.

## Six scientifically defensible candidates

These are proposed applications of established methods, not heart-specific validation results.

| Candidate | Useful mechanism | Main risk and practical role |
| --- | --- | --- |
| **1. Foreground component filtering** | Label the native tissue mask in 3D; measure physical volume, extent, elongation, source support and border contact. Remove only fully observed, unsupported small islands. Retained surface coordinates can remain unchanged. Implementations such as [cc3d][cc3d] provide labeling and component statistics. | Small components can be real chordae, leaflets or crop-cut tissue. Attached clutter survives. **First bounded experiment**, with border retention, conservative extent/shape gates, and a separate rejected-component layer. |
| **2. Confidence hysteresis / reconstruction** | Retain permissive tissue components only when connected to strong tissue seeds. This uses intensity evidence without requiring every weak strand voxel to pass a strong threshold. [Morphological reconstruction][vincent] supplies the connected operation; [hysteresis documentation][hysteresis] defines the two-threshold rule. | An unseeded real strand can disappear; weak noise connected to a strong wall survives. Opening by reconstruction can restore original contours **and attached noise**. Compare with method 1; do not promise that hysteresis alone resolves attached clutter. |
| **3. Connected attribute / max-tree filtering** | Analyze connected intensity level sets by volume, contrast/persistence and shape, rather than using a fixed spherical footprint. [Connected operators][salembier] merge existing flat zones without creating new contours. | Plain grayscale area opening followed by the same threshold gives the corresponding component-size filter at that level; it does not independently solve wall-attached clutter. Contrast/shape attributes add assumptions and can reject low-contrast thin tissue. Useful as an auditable comparator, not a default anatomical rule. |
| **4. Seeded tissue-versus-cavity graph** | Apply a bounded 3D [random walker][grady] with reviewed tissue and cavity seeds, intensity-dependent edge weights, and protected strands/sheets. Competing cavity evidence can separate a weak attachment that component filtering retains. | Weak boundaries permit leakage; seeds and intensity scaling matter. Graph probabilities are model outputs, not calibrated anatomical probabilities. **Preferred next escalation if attached clutter dominates**, limited to reviewed ROIs and ambiguous bands. |
| **5. Multiscale line and sheet support** | Combine intensity with derivative features describing lines, sheets and boundaries, as in [Sato et al.][sato]. Use persistent line/sheet support to protect plausible chordae, vessels and leaflets during candidate rejection. | Vesselness alone disfavors sheets. Junctions and partial volume need not resemble ideal shapes; streak artifacts can also be coherent. Use as retention evidence with source review, not a hard tissue classifier. |
| **6. Topology-constrained selective edits** | Restrict local low-confidence boundary edits using simple-point checks and protected anatomical anchors; [topology-preserving deformable models][han] provide the method basis. Also impose displacement and thickness limits. | Preserving the initial topology preserves initial mistakes. Deleting an isolated island intentionally changes component count, so strict global topology preservation cannot perform that cleanup. Use as a guard on retained structures after explicit component decisions, not as the first cleaner. |

## Preserve the foreground/background distinction

**A disconnected triangle shell can represent either a tissue island or the boundary of a legitimate background cavity/vessel lumen.** Small mesh size alone does not distinguish them. Classify the tissue side using native corner signs or verified source samples. Closed-shell orientation is useful only when closure and consistent orientation have been established. Preserve open, clipped, nested/ambiguous and tile-boundary shells until their continuation and tissue side are resolved.

For the proposed **129³ native-sample, 26-connected mask** experiment:

- Keep every component touching the analysis boundary. Treat its extent as censored, not proven small. Do not delete the largest component merely because it dominates a cavity crop.
- Evaluate physical volume and all three spatial extents. Protect elongated strands and broad thin sheets; a diameter or elongation gate alone cannot protect both.
- Filter the existing surface pieces associated with confidently rejected foreground components. Keep retained vertices unchanged and save rejected geometry separately. Any remeshing is a separate operation requiring its own displacement measurements.
- Preserve components whose surface-to-foreground association is ambiguous. A visible shell or triangle count is not a foreground-volume measurement.
- A 16-sample TV halo is a local filtering dependency, **not a connectivity bound**. A global component decision needs merged tile equivalences or verified continuation. The border-retaining crop experiment is deliberately more conservative.

Foreground 26-connectivity protects diagonal connections but can also connect noise through a corner. Record the connectivity convention and, when measuring background topology, its compatible background convention. Differences under another convention are sensitivity evidence, not automatic errors.

## Pragmatic bounded intensity alternative

Keep the existing **TV800 × 16, eps 0** field and original units fixed for the first comparison. Select and freeze source-supported tissue/cavity seeds and protected chordae, trabeculae, leaflet sheets and clefts before fitting. Include detached-speck, attached-clutter, guide-transition and seam regions. The prior review's bounded ROI/checkpoint framework can be reused, with a separately recorded experiment definition.

First compare the fixed threshold with confidence hysteresis. The prior review proposes a simple two-class intensity score, weak mask `score >= 0.5` and strong seeds `score >= 0.9`; those are falsifiable engineering choices, not established tissue probabilities. Fit once on designated calibration ROIs, freeze the model across test regions, and retain uncertainty and border-censoring flags. Do not normalize each tile independently.

If attached clutter survives, test the seeded graph in the same bounded regions. Give convincing wall/strand/sheet samples tissue seeds and convincing cavity medium background seeds; leave disputed samples unlabeled. Weight neighboring-voxel links by frozen, scaled intensity differences, with optional validated boundary evidence. Solve over a common analysis domain, inspect the continuous score and its raw-section overlay, and compare only the interior core. Keep the source-supported retained surface outside the ambiguous region fixed. Do not subtract a coarse chamber envelope: it can erase genuine trabeculae, chordae and leaflets inside that envelope.

This experiment can justify another reviewed pilot. It does not justify replacing the whole bank or claiming recovery of features excluded by the original guide.

## Decision measurements

| Measure | Required interpretation |
| --- | --- |
| Foreground remaining in reviewed cavity anchors; removed foreground in tissue anchors | Measures the desired cleanup and its cost directly. Triangle reduction alone is insufficient. |
| Protected strand endpoint connectivity, leaflet coverage, cleft/lumen openness | Detects losses hidden by a whole-heart overlap score. Check both tissue and background. |
| Retained-surface displacement, median/95th percentile/maximum, in voxels and µm | Component-only visibility filtering should move retained vertices by zero. Missing surfaces must be reported explicitly. |
| Thickness and physical extent of protected features | Topology does not guarantee geometry. [Local 3D thickness][thickness] and, for reviewed tubular references, [centerline Dice][cldice] can supplement direct anchor checks; centerlines do not validate sheets. |
| Component inventory, boundary flags and rejection reasons | Separate fully observed islands from crop-censored structures. Report intentional component-count changes separately from unintended topology changes. |
| Threshold/model sensitivity and partition-versus-monolithic agreement | Exposes brittle decisions and seams. Preserve the existing threshold sensitivity controls and pinned execution where applicable. |

The prior review's broad-boundary 95th-percentile movement limit of one native voxel is an engineering screening gate, not an anatomical accuracy guarantee. Retain original, retained and rejected views with identical cameras and lighting; save the numeric masks and raw-section overlays needed to audit every conclusion.

## Intensity calibration limits

The inspected source metadata and reader establish **uint16 reconstruction values**, not a verified water-referenced HU conversion. **17133.4 remains a stored-intensity threshold.** The [primary heart study][heart] describes formalin-fixed hearts prepared in crushed agar and 70% ethanol; clinical in-vivo tissue HU ranges cannot simply be imported. Use scan-specific original intensities and call fitted outputs model scores until calibration is verified. This does not claim that quantitative calibration is impossible.

Also distinguish fully native, blended and prior-only regions. A cleanup model cannot obtain original intensity evidence from a windowed coarse prior, and an attractive cleaned mesh is not independent anatomical ground truth.

## Primary and implementation references

- [Vincent (1993), *Morphological grayscale reconstruction in image analysis: applications and efficient algorithms*][vincent]. DOI: 10.1109/83.217222.
- [Salembier, Oliveras and Garrido (1998), *Antiextensive connected operators for image and sequence processing*][salembier]. DOI: 10.1109/83.663500.
- [Grady (2006), *Random walks for image segmentation*][grady]. DOI: 10.1109/TPAMI.2006.233.
- [Sato et al. (2000), *Tissue classification based on 3D local intensity structures for volume rendering*][sato]. DOI: 10.1109/2945.856997; author-hosted paper.
- [Han, Xu and Prince (2003), *A topology preserving level set method for geometric deformable models*][han]. DOI: 10.1109/TPAMI.2003.1201824; author project.
- [Hildebrand and Rüegsegger (1997), *A new method for the model-independent assessment of thickness in three-dimensional images*][thickness]. DOI: 10.1046/j.1365-2818.1997.1340694.x.
- [Shit et al. (2021), *clDice: A Novel Topology-Preserving Loss Function for Tubular Structure Segmentation*][cldice]. Official CVPR proceedings.
- [Brunet et al. (2024), *Multidimensional Analysis of the Adult Human Heart in Health and Disease Using Hierarchical Phase-Contrast Tomography*][heart]. DOI: 10.1148/radiol.232731.
- Official implementation references: [cc3d][cc3d], [scikit-image hysteresis][hysteresis], and [scikit-image connected morphology][morphology]. Pin the installed implementation/version before reproducing an experiment.

[cc3d]: https://github.com/seung-lab/connected-components-3d
[vincent]: https://pubmed.ncbi.nlm.nih.gov/18296207/
[hysteresis]: https://scikit-image.org/docs/0.26.x/api/skimage.filters.html#skimage.filters.apply_hysteresis_threshold
[salembier]: https://pubmed.ncbi.nlm.nih.gov/18276273/
[grady]: https://pubmed.ncbi.nlm.nih.gov/17063682/
[sato]: https://www.image.med.osaka-u.ac.jp/member/yoshi/paper/tvcg0004.pdf
[han]: https://iacl.ece.jhu.edu/static/tgdm/
[thickness]: https://doi.org/10.1046/j.1365-2818.1997.1340694.x
[cldice]: https://openaccess.thecvf.com/content/CVPR2021/html/Shit_clDice_-_A_Novel_Topology-Preserving_Loss_Function_for_Tubular_Structure_CVPR_2021_paper.html
[heart]: https://pmc.ncbi.nlm.nih.gov/articles/PMC11303834/
[morphology]: https://scikit-image.org/docs/0.26.x/api/skimage.morphology.html
