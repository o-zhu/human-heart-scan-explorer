# Whole-heart native refinement: LADAF-2021-17

**The entire recorded whole-heart boundary plan is complete:** 37,612 of 37,612 planned blocks. The final manifest is publishable, with verified native, display and evidence receipts. Completion refers to this coarse-guided plan; it does not establish that every anatomical structure in the organ was found.

The recorded result uses the original **19.85 µm** LADAF-2021-17 samples to refine the surface throughout the recorded organ-wide search plan. The earlier 128³-region experiment established feasibility and exposed raw threshold noise; its small extent was not the whole-organ deliverable. This report is generated from completed run records and finalized manifests, without projected counts. The [complete evidence ledger](https://human-heart-scan-explorer.zhuou557737.chatgpt.site/api/guided-native-v21/manifest-0a5dd46f5e1fa450994daca8f7163e2019e4aa30c72e76dd0d7fd6972fc218a1.json.gz) carries the full source-object and artifact provenance.

## Recorded coverage and storage

| Quantity | Completed result |
|---|---:|
| Planned / completed core blocks | 37,612 / 37,612 |
| Planned input blocks | 37,612 |
| Nonempty native surface blocks | 33,046 |
| Empty processed blocks | 4,566 |
| Native-grid triangles across stored tiles | 12,168,077,800 |
| Stored native-grid edge crossings | 6,192,976,842 |
| Compressed native surface bank | 5,810,515,698 bytes (5.411 GiB) |
| Distinct original N5 source objects read | 37,612 |
| Distinct original encoded source bytes | 125,300,097,139 bytes (116.695 GiB) |
| Native-only / blended / prior-only stored crossings | 6,122,635,215 / 70,341,627 / 0 |

Empty means the processed scalar tile contains no threshold crossing; it does not mean the raw scan contains no tissue. Crossing counts include shared-boundary duplicates. The three contribution categories classify endpoint blend weights at stored edges, not disjoint surface area or anatomical completeness. Distinct source bytes are deduplicated original-object sizes, not total network traffic: resumes, cache hits and retries make those quantities different. The source remains the original **7614 × 7614 × 8480**, big-endian uint16 N5 volume.

GCS generation metadata is absent for **213** distinct source objects. Every object still has its exact SHA-256, byte count and coordinate in the evidence ledger; the generation count is recomputed from that ledger's hashed observation log.

## Opening the result

Choose LADAF-2021-17 in Heart Explorer, open **Settings**, and follow **Explore the whole-heart native refinement →**, or open [whole-native.html](../../public/whole-native.html). The left pane provides a separately simplified whole-heart display; selecting tissue opens a 128-cell native-grid region in the right pane. Each region spans **2.5408 mm**. Cameras, sections and their controls remain independent; crop and section boundaries are open, without invented caps. Coordinate selection uses the original scan axes. If the exact block has no available surface, the UI identifies its available-region selection rather than implying that an unprocessed block was reconstructed.

The existing coarse volume and 79.4 µm fine display remain useful context. Their spacing must not be confused with the 19.85 µm samples underlying the native bank. The separate cMAC/SlicerHeart source-selector repair changed the HOA page's validation guard from the HOA-only `DONORS` collection to `ALL_SOURCES`. The actual-DOM regression covers both clinical transitions and return to HOA, cancellation and URL state; see [the earlier source-selector report](../native-surface-v20/README.md) and [its regression test](../../tests/clinical-ui-v19.mjs).

## Whole-heart display figure

![Completed whole-heart display detail: exterior and open oblique section, with 20 mm scale bars.](whole-detail-render/whole-overview.png)

This figure renders the completed **2,500,000-triangle display detail**, derived from the **79.4 µm step-4** surface and simplified for navigation. It is a lossy display, not the 19.85 µm native surface bank. Exterior and cutaway use matched camera and lighting, stored normals, acquisition axes and 20 mm scale bars; the open oblique section has no inferred anatomical orientation or added caps. No further smoothing or simplification was applied for the image. This is a scientific EGL rendering, not a browser screenshot. [The checked render record](whole-detail-render/render-record.json) binds the figure to the exact final manifest and compressed/decoded HFM hashes.

## Source alignment, guidance and filtering

The prior is the existing cleaned, windowed 79.4 µm s2 bank, whose full source dimensions are **1903 × 1903 × 2120**. Each axis uses center-resize registration:

`native_index = (prior_index + 0.5) × (native_dimension / prior_dimension) − 0.5`.

This matters because X and Y are not exactly four times their s2 dimensions. The recorded comparison tested 6 separated source locations; its largest fitted residual shift was 0.1030 native voxels under an approximate pyramid operator. It tests registration consistency, not biological accuracy. Details and source hashes are in [the alignment record](pyramid-alignment.json).

The guide includes mixed cells at the smoothed 0.28 threshold, plus raw 0.28 and smoothed 0.20 guards for thin structures. Prior Gaussian σ is 0.8 prior voxels. Native contribution is full within the configured 8-voxel distance band (158.8 µm), then falls smoothly to zero at 12 voxels (238.2 µm); the distant field comes from the prior. The distance is the implementation's interpolated coarse-grid guide distance. There is no hard band-edge mesh cut. This strategy can miss structures absent from the cleaned prior outside the search band.

Original intensities are cast to float32 and processed with **Chambolle total variation, weight 800, exactly 16 iterations, eps=0**, without a native Gaussian prefilter. Each 129³ core-sample grid has a **16-voxel halo**, giving a 161³ input. Missing original samples required by any contributing filter neighborhood are acquired before processing. The threshold is requested as 17133.4 and represented as **17133.400390625** in float32. Fixed iterations make the dependency radius finite; tested shared planes and monolithic comparisons are bit-identical. The compiled kernel preserves the installed scikit-image arithmetic order, omits unused convergence-energy work, and disables fast-math/FMA reassociation. See [kernel verification](tv-kernel-verification.json) and [halo checks](denoising/seam-validation.json).

## What the measured denoising changes

Across 32 spatially spread 48³ test cores, TV16 reduced extracted Lewiner triangles from **2,301,576 to 570,575**, and changed the above/below-threshold classification of 9.33% of sampled voxels. 6 sampled cores became empty after filtering. In the separate 108³ cleft-rich region, triangle counts changed from 723,491 to 191,251. These are measured filter effects in selected crops, not an organ-wide accuracy sample; comparison meshes use Lewiner extraction and may differ from the native bank's classic cases.

![Actual 3D surfaces of the same native crop, with matched camera, lighting and open section.](denoising/surface-comparison.png)

The figure shows actual raw, Gaussian and fixed-iteration TV surfaces from the same 108³ source crop. Camera, lighting, normal construction and crop are matched; the second row uses a common open section. These are scientific EGL renderings, not browser captures or a rendering of the entire completed bank. The meshes receive no extra smoothing, decimation or component deletion. [The render record](denoising/surface-render-record.json) records source, scalar, geometry, camera and image hashes; [the comparison report](denoising/README.md) explains the local outcomes. Filtering can erase real weak tissue, narrow clefts, small cavities or connections even when the image looks cleaner.

## Native archive, bounded processing and display LODs

Native NBE1 stores the processed grid's signs and five-bit edge-crossing positions; triangle connectivity follows standard marching-cubes cases. Its maximum numerical crossing displacement is **0.31015625 µm** (1/64 native voxel). This is a bound relative to the processed scalar isosurface; it excludes filtering, guide, alignment, topology and anatomical error. The native bank is not replaced by either overview LOD.

Processing streams original 128³ source blocks, retains compressed bodies on disk, and reuses neighboring-Z halo strips. Decoded current-source blocks use a bounded LRU cache. Completed native derivatives are evicted only after full public-GET byte-count/SHA verification and atomic record storage; local overview edges and provenance remain for assembly. The largest recorded individual worker high-water RSS was **2521.50 MiB**. This is not simultaneous whole-job peak memory. [The memory audit](operational-memory-audit.md) separates strip banks, workers, transport and cache; the final progress snapshot's elapsed time and network counters cover its latest invocation, not every resumed invocation.

Overview construction first samples the processed field every four native samples (**79.4 µm**). **748 nonempty native tiles have no crossing in that step-4 overview.** This is a display omission before simplification; all **33,046** nonempty native artifacts remain in the complete native index and available for regional inspection. The count comes from an exact coordinate join of completed native records, index entries and original overview inputs. Nearby groups are welded at exact 1/16-native-voxel positions. Intermediate reduction freezes group-plane vertices and their incident-face ring, then verifies exact boundary coordinates and one-face seam edges. Free-vertex clustering uses bounded global cells; the recorded maximum used is 32 native voxels. Constrained QEM accepts current free/free edges within one global cell and preserves the frozen ring. A bounded parent clustering fallback can merge additional components only when the immutable ring fits the target. This build records 3,678 clustering nodes and 20 parent fallbacks. All original leaf samples remain available for the final error comparisons. [The bounded fallback QA](overview-fallback-verification.json) records the dense-leaf seam checks and directional sampled errors. These display operations can remove components, alter topology or introduce intersections. Final whole-mesh simplification is also explicitly lossy. The HFM1 meshes use float32 positions, packed int16 normals and uint32 indices. Their full-source world transform is `((x−3806.5),(z−4239.5),−(y−3806.5))/8479`.

| Display LOD | Triangles | Parts | Gzip MiB | Step-4→display p95 / sampled max µm | Display→step-4 p95 / sampled max µm |
|---|---:|---:|---:|---:|---:|
| overview | 1,499,999 | 1 | 10.50 | 675.89 / 3372.99 | 151.87 / 409.13 |
| detail | 2,500,000 | 1 | 18.83 | 526.00 / 2669.84 | 153.56 / 396.16 |

Distances compare the stored display meshes with the encoded step-4 processed overview. Forward sampling covers original leaf groups and uses surface-area weighting; reverse sampling measures closest triangles across original groups. These finite samples are **not a Hausdorff bound** and do not compare against anatomy or the full native mesh. Each gzip part is at most 32 MiB. See [the builder method](overview-builder.md) and the finalized evidence ledger for exact LOD hashes, samples and simplification settings.

## Verification and interpretation

The final compiler checked the complete plan, unique coordinates, processing fingerprint, every local overview hash, original-object ledger consistency and verified remote receipts. It emits a compact browser index of **14,103,268 decoded bytes**, below 32 MiB, and a separate comprehensive evidence ledger. The browser does not load that ledger automatically. Real receipts establish historical complete public-GET verification; they are not a fresh availability check at every later visit. [Finalization details](manifest-finalization.md) describe these gates.

An independent [recovery test](production-recovery-verification.json) restored **10,396** already completed records from 10 hosted checkpoint objects (70.82 MiB). Records were byte-identical, the source ledger was an exact prefix, and the runner recognized every restored record with zero source requests. No original intensities or native surface payloads were downloaded for this recovery test.

Recorded decoder tests match Python geometry in 64 pilot subregions and confirm exact shared positions. Internal subdivision normals match; independent outer-tile normals can differ, so geometric continuity does not guarantee invisible shading seams. [Decoder evidence](browser-edge-decoder.json) and [actual shader compile, clipping and integer-pick checks](whole-viewer-gl-check.json) document the tested implementations. Those checks do not establish mobile-browser interaction quality or FPS. The 6.46× isolated TV-kernel timing improvement is likewise not an end-to-end reconstruction or browser speed claim.

The whole-plan result addresses the requested spatial scope within its recorded guide. The method remains a deliberately lossy, threshold-derived reconstruction of one preserved specimen. Coarse-guide blind spots, filtering and simplification can alter topology; source sampling and tiny encoding error do not prove anatomical accuracy. Exact counts, configuration and source identities are preserved in the linked evidence and [the companion release summary](release-report.json).
