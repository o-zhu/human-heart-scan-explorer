# Conservative cleanup of the existing native surface

## Recommendation and scope

Use **whole-tile foreground component filtering** as the first cleanup mode: remove only a compact, small, completely interior component; preserve every outer-face component and every sufficiently elongated rod or sheet. Keep Original and Removed fragments views available. This removes selected islands without moving any retained native crossing, retriangulating retained cells, or smoothing the tissue the user already likes.

The bounded experiment evaluated **13 existing NBE1 tiles**, all checked against their completed production artifact SHA-256 records, and one saved **108³ native scalar ROI** with raw, TV16, TV40 and Gaussian fields. It performed no new acquisition, production-data rewrite or deployment. The chosen examples are not a random or anatomy-balanced survey. Full data and code are [native-components.json](native-components.json), [scalar-methods.json](scalar-methods.json), and [compare_methods.py](../../scripts/noise-cleanup-v22/compare_methods.py).

## Exact candidate rule

Classify the complete **129³ sign mask once**, before splitting a native tile into eight rendered pieces. A mask bit of one is foreground tissue; the marching-cubes case bits in the existing codec instead mark the lower-density side. Label foreground with **26-neighbor connectivity**.

Remove a component only when all these conditions hold:

1. It contains at most **512 foreground samples**.
2. Its inclusive sample-cell bounding-box diagonal is at most **0.4 mm**: `sqrt(sum((maxAxis - minAxis + 1)^2)) × 0.01985 mm`.
3. It touches none of the six outer tile sample planes, at coordinate 0 or 128.
4. Its regularized principal elongation is below **3**: `sqrt((max(0, lambdaMax) + 1/12) / (max(0, lambdaMin) + 1/12)) < 3`.

The covariance is the population covariance of the component's integer sample centers, divided by its sample count. The `1/12 voxel²` term is the variance within a unit voxel cell; it regularizes degenerate point sets. The minimum eigenvalue protects both rods and thin sheets. The earlier rod-only candidate used the middle eigenvalue and removed additional flat fragments. These are geometric safeguards, not anatomical labels.

The diameter measure describes the inclusive sample-cell box, **not exact Euclidean mesh diameter**. Sample count is not a validated tissue-volume measurement. No intensity threshold, TV setting, prior guide or native encoding changes under this rule.

### Why this preserves coordinates and tile seams

All foreground corners of one marching-cubes cell are within one 26-connected component. A cell therefore has one foreground owner whenever it contains a surface. Skip all original triangles in cells owned by removed components; use the original crossings and original case table everywhere else. Distinct foreground components share no crossing vertex, so deleting their complete triangle sets does not require changing the retained normals.

A globally connected foreground path that leaves a tile must touch an outer sample plane. Because every such component is protected, a removed component is completely contained within the observed tile. The six outer sign planes and all their original crossing codes remain unchanged. This is stronger than treating the eight 64-cell display pieces independently, which would falsely classify structures cut by an internal display boundary as isolated.

The experiment verified identical original/cleaned sign planes on all six faces of all 13 tiles, and **12 actual adjacent-face comparisons** in the existing 2×2×2 pilot neighborhood. The component-subset scientific renders use identical original coordinate arrays and retained normals. Original adjacent crossing fractions were not separately re-audited in this experiment; cleanup does not alter those streams. Source format and rendering contracts: [edge_codec.py](../../scripts/guided-native-v21/edge_codec.py), [native-edge-format.js](../../public/native-edge-format.js), [native-edge-worker.js](../../public/native-edge-worker.js).

## Native artifact results

![Actual native tiles, with original, rod-protected, rod-and-sheet-protected, and removed-only geometry.](native-component-comparison.png)

The figure contains actual stored NBE1 geometry with a common camera, lighting and open middle section within each row. The broad surfaces and retained fine structures stay in place. In the first row, many small particles in the gap disappear; substantial rough and connected structure remains. The removed-only column makes the selection reviewable without asserting that every selected fragment is noise.

| Actual native tile | Original triangles | Interior components | Removed components, recommended rule | Removed foreground samples | Removed triangles |
| --- | ---: | ---: | ---: | ---: | ---: |
| [32,31,22] | 715,478 | 242 | 221 | 6,542 | 28,076 (3.92%) |
| [35,30,36] | 367,839 | 109 | 96 | 2,254 | 10,196 (2.77%) |
| All 13 selected tiles | 4,242,633 | 714 | 662 | 15,570 | 68,604 (1.617%) |

Across those tiles, the rule preserves all **221 boundary components** and removes **0.130% of 11,942,037 foreground sample records**. Counts include shared-tile sample duplication and are not disjoint organ volumes. Component-count reduction alone is not the success criterion: the surfaces and source sections must still be inspected.

The requested size/diameter sweep included all combinations of 64/512/4096 samples and 0.2/0.4/0.8 mm, both with and without shape protection. For the rod-and-sheet guard:

| Size / inclusive-box diagonal | Removed triangles in [32,31,22] | Removed triangles in [35,30,36] |
| --- | ---: | ---: |
| 64 samples / 0.2 mm | 16,192 | 5,400 |
| **512 samples / 0.4 mm** | **28,076** | **10,196** |
| 4096 samples / 0.8 mm | 30,452 | 10,196 |

The more aggressive setting provides little additional benefit in these examples. With the 512/0.4 rule, switching from rod-only to rod-and-sheet protection saves **11 additional components / 3,076 triangles** in [32,31,22] and **8 / 2,284** in [35,30,36]. Their identity as real tissue is unverified, but preserving planar fragments is a useful conservative choice for thin anatomy.

## Comparison with methods that change intensity or topology

The scalar test uses the same saved 108³ core, native origin XYZ **[4490,3978,4618]**, with 19.85 µm spacing and threshold **17133.400390625 in stored units**. Its original scalar filtering had 40 samples of actual source context per side. Every saved field was checked against [the existing source/render provenance](../guided-native-v21/denoising/surface-render-record.json). These fields predate the production guide blend, so this part of the experiment is an algorithm comparison, not the final blended native tile.

![Matched native scalar surfaces for component filtering, opening, hysteresis and stronger smoothing.](scalar-surface-comparison.png)

![Original source sections with candidate contours and classification differences.](scalar-section-comparison.png)

Gold contours show the candidate mask; red marks removal from TV16 and cyan marks additions. These are measured source sections, not anatomical annotations. The native intensity scale has no verified HU calibration; see [the intensity review](../guided-native-v21/INTENSITY-RECOVERY-REVIEW.md).

| Method on this exact core | Components | Removed foreground samples from TV16 | Added foreground samples | Geometric effect |
| --- | ---: | ---: | ---: | --- |
| TV16 control | 74 | 0 | 0 | Existing surface |
| Compact components, rods protected | 17 | 1,247 | 0 | Original retained triangles unchanged |
| Compact components, rods and sheets protected | 17 | 1,247 | 0 | Same selection as rod-only in this particular crop |
| Binary opening, radius 1 | 45 | 1,775 | 0 | Can trim connected tissue and create new edges |
| Hysteresis, weak `T−200`, strong `T+200` | 52 | 56 | 11,562 | Expands the thresholded field as well as rejecting some weak islands |
| Same-T component anchor at `T+200` | 45 | 227 | 0 | Retained original crossings unchanged; needs intensities absent from NBE1 |
| TV40, same threshold | 39 | 1,030 | 1,978 | Changes connected boundaries and small features |
| Gaussian sigma 1.5, same threshold | 68 | 1,914 | 25,877 | Changes many interfaces and narrow low-intensity spaces |

Opening is one erosion/dilation with a 6-neighbor radius-one cross. Its outer two-sample collar is held fixed because this saved scalar core has no additional opening context. The figure preserves original subvoxel fractions on unchanged crossing edges and uses midpoint bins only on newly created opening edges. It does **not** reset every surface crossing to a binary midpoint, which would confound the comparison with avoidable stair-step artifacts.

The hysteresis control labels the entire weak set with 26-connectivity, retains components containing a strong seed, and also retains crop-face components. It is not a local independent-per-tile rule. The same-T anchor variant instead retains original TV16 components if they contain a `T+200` sample, touch a crop face, or pass the rod/sheet safeguard. It demonstrates a possible intensity-supported component decision without changing retained geometry, but a single cutoff is not calibrated confidence or a proven tissue/noise separator.

The matched visuals favor component filtering for the immediate goal: removing isolated particles while preserving the excellent existing surfaces. Stronger filtering and lower weak thresholds alter much more of the connected field. The source sections show that many candidate changes lie at interfaces, not only in detached speckles. None of these tests establish biological truth.

The new scientific surface panels use the native classic marching-cubes connectivity and five-bit crossing encoding for a consistent comparison. Their triangle counts can differ slightly from the older Lewiner-based denoising report; the underlying scalar fields and masks match their saved provenance.

## Browser implementation and resource contract

The browser already decodes one verified NBE1 tile, prepares crossing grids once, and emits eight bounded meshes transactionally. A worker can classify the complete sign mask once and apply the same component selection to every piece. The main thread need only choose Original, Cleaned or Removed fragments and display counts; it should not perform volume labeling.

A useful implementation contract is:

```text
componentPlan = classify(originalParsedNBE, versionedSettings)
componentPlan.labels: uint32[129,129,129]
componentPlan.removed: component-ID bit/byte array
componentPlan.parameters: connectivity, count/box limits, PCA rule, boundary rule
componentPlan.stats: original/removed component, sample and triangle counts

meshNativeEdges(originalParsedNBE, pieceBounds, componentPlan, selection)
selection = original | cleaned | removed
```

Keep the original NBE hash and original expected triangle count authoritative. Report `sourceTriangles`, `renderedTriangles` and `removedTriangles` separately; filtered rendering must not bypass source-integrity verification by replacing the expected source count. The original verified byte buffer remains immutable. Cache component plans by source hash plus cleanup-settings version. Commit all eight pieces together with their matching mode label, and preserve the previous geometry on stale, canceled or failed requests.

A full uint32 label array occupies **8,586,756 bytes**; a worst-case uint32 flood queue of the same length requires the same amount. These are roughly **16.38 MiB combined**, in addition to the existing crossing grids and bounded mesh allocations. Component moments and flags add overhead; avoid a large JavaScript object per voxel. The measured Python pass over 13 tiles, including checksums, component statistics, the 27-setting sweep and adjacent-sign checks, took **1.36 seconds** with **118.98 MiB process peak RSS**. This is not a browser/mobile timing claim. The largest separate scientific render peaked at **294.95 MiB**; render stages run sequentially.

## When an offline global graph is warranted

The conservative browser rule intentionally leaves every boundary-crossing component. A global refinement could remove small islands that straddle native tiles, but is a larger, separately versioned task:

1. Stream verified NBE1 artifacts one tile at a time, label foreground, and record local component count, moments, sample boxes and boundary labels. Use unique ownership for shared samples when aggregating global sizes and moments.
2. Union component identities across matching shared samples and 26-neighbor contacts on all relevant faces/edges/corners. Resolve completely uniform native-empty blocks from their verified overview sign masks where available. Keep any component that contacts unobserved guide/plan boundaries uncertain and retained.
3. Classify only after global closure/extent is known. Apply a read-only sidecar keyed by original NBE SHA-256, graph fingerprint and stable local component seeds. Store per-tile removal lists rather than re-encoding good native crossings.
4. Checkpoint component summaries, union state/frontier, input receipts and immutable sidecars periodically. Reopening the original surface collection is unnecessary for a display overlay.

The completed bank contains **33,046 nonempty native artifacts, about 5.81 GB compressed, and 12.168 billion recorded triangles**; see [the completed-bank audit](../guided-native-v21/completed-bank-audit.json). A global analysis should process the sign masks, not allocate a whole-organ triangle graph. Most native bytes are hosted rather than resident locally. Extrapolating the selected-tile Python pass suggests an order of **an hour of serial processing plus transfer**, but it is not a measured whole-bank runtime. A one-layer boundary frontier and external component summaries can bound memory; the number of global components must be measured before committing to a fixed total-memory claim.

Do not infer foreground connectivity solely from disconnected surfaces of the simplified whole-organ HFM: a cavity wall can be a separate surface surrounding the same connected tissue, and overview simplification can itself alter topology. A largest-mesh-component rule can therefore discard legitimate internal surfaces. The overview remains a separate display reference unless its own cleanup has a defensible, separately verified rule.

NBE1 contains one threshold's signs and crossing positions, not the original intensity amplitudes. Threshold persistence cannot be recovered from it alone. A later confidence experiment can reread bounded original/TV source ROIs for selected uncertain fragments and measure persistence over predeclared thresholds, while retaining original crossing coordinates for accepted components. Strong acquisition artifacts can persist and real weak tissue can disappear, so persistence is additional evidence rather than ground truth.

## Reproduction and remaining limits

Run from `{local-workspace}`:

```bash
python3 -B scripts/noise-cleanup-v22/compare_methods.py
```

The driver reads the existing native samples in `{source-cache}/guided-native-v21/whole/verification-samples/` and `{source-cache}/guided-native-v21/pilot/run/tiles/`, verifies their records under `whole/run/records/`, and reads the saved scalar fields in `{source-cache}/guided-native-v21/denoise/surface-render/`. It writes only this experiment directory. The `--stage` option reruns just native metrics, scalar metrics/sections, a selected rendering or figure composition. Render records retain input/output hashes, camera/crop information, triangle counts and process RSS.

Small real tissue can satisfy the removal rule. The PCA test protects ideal rods and sheets, but curved, branching, weakly sampled or detached anatomy may still be selected. A crop-face guard is conservative and orientation/location dependent; it deliberately leaves some identical-size noise at tile borders. Connected artifact cannot be removed by complete-component filtering. The experiment provides a reviewable cleanup option and measured bounds on what it changes, not a guarantee that all chamber clutter is artifact or that all artifacts have been removed.

