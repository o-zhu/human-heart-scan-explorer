# Echo cut-face coverage and secondary UI refinement

## Defect and correction

The CT image uses a focused, preset-specific rectangular crop. The 3D mesh is
clipped across the complete organ. Before this change, the GPU cap, software
cap and picker returned zero outside the CT crop, leaving an open interior
surface wherever that crop did not cover the entire physical cut.

The renderer and picker now sample the current resident source volume outside
the current cap raster. This produces a continuous, correctly registered
preview immediately, without stretching edge pixels or moving pixels from a
previous view. Existing support and reviewed exclusions remain active.

Echo also requests a separate fine raster covering the intersection of the
accepted plane with the donor's source box, with a two-source-pixel border.
`fullEchoCutFacePlane()` changes only the in-plane crop of that second raster.
The acquisition plane, retained half, CT image crop, camera anchors and source
data are unchanged. The CT canvas keeps its own original sample while the 3D
cap can install the larger raster. Exact-raster validation, view tokens and a
shared abort signal reject incomplete, unrelated and stale results.

The visible resolution label remains Preview while any part of the visible
cut still uses the resident source. Failed current detail is visible beside
Retry Detail; technical progress and provenance are available in Model Details.
The software renderer now forwards the cleaned-raster flag, matching the GPU
and picker: cleaned fine pixels do not receive the coarse support mask again.

## Scope and memory bounds

The audit covers the 28 TTE and 28 TEE presets on LADAF-2021-17, S-20-29 and
S-20-28: 168 donor/view combinations. Of these, 147 have an acquired cut plane
and 21 intentionally retain whole-heart context because the requested target
is outside the isolated scan. cMAC and SlicerHeart have independent clinical
workspaces and do not expose these Echo presets.

The complete fine-face raster is bounded to 12 MiB and 8192 pixels per axis.
The largest planned production raster in this matrix is 9,762,600 bytes
(3070 × 3180, S-20-28 ME PV); the largest individual dimension is 3250. These
figures describe raster storage, not total device memory. Only one current
full-face cap is installed. The existing fine-service, brick and saved-section
cache limits remain in force. On constrained devices, a raster exceeding the
existing 4 MiB saved-image entry limit is not persisted as an image; resident
and source-brick caching still work.

## Evidence

- [Targeted reproduction](targeted/README.md): actual 1,986,313-triangle v19
  detail mesh, frozen v73 shaders, unchanged accepted planes and cameras, and
  measured resident-source sampling for the three reported views. Original
  ROI and unrelated surface pixels remain byte-identical.
- `coverage.json`: independent plane/source-box coverage and fine raster
  budget checks for all donor/view combinations.
- The all-view scripts under `scripts/echo-face-v42/` export the real
  controller's planes and cameras, sample the production MPR worker, and render
  the production shaders. The collected report and galleries document the
  tested source spacing, cleanup, anchors, assertions and intentional exclusions.
- `tests/echo-cut-face-v42.mjs` exercises the controller's preview-to-fine
  lifecycle, cancellation, stale results, malformed fine frames, error recovery
  and software/picking parity. `tests/fine-exact-raster-v3.mjs` retains strict
  comparison of physical raster fields while excluding unrelated acquisition
  metadata from that comparison.

Native all-view rendering uses the actual resident source volumes (approximately
317.6–318.24 µm). It verifies cap coverage and source registration, not a fresh
79.4 µm download for every preset, anatomical validation, physical iOS stability
or a total-memory benchmark. The targeted detailed-mesh render tests the same
immediate fallback on the actual high-detail surface.

### Completed all-view matrix

[Quality report](quality-report.json) and [coverage receipt](coverage.json)
record 168 passing donor/view cases, 336 native frames, 147 complete-face
rasters and 147 unchanged CT-crop rasters. Independent weighted-corner
interpolation matched all 94,962 checked source samples exactly. All original
accepted planes, retained halves, CT crops and both camera anchors equal the
frozen pre-fix export. All twelve contact sheets were visually inspected; no
missing cut faces or rectangular crop seams were found. Edge-on and back-facing
anatomy anchors retain their existing camera orientation.

| Donor | TTE / TEE | Acquired / outside scan | Native frames | Actual sampled source | Prior crop omitted supported tissue |
|---|---:|---:|---:|---:|---:|
| LADAF-2021-17 | 28 / 28 | 49 / 7 | 112 | 317.6 µm | 32 views |
| S-20-29 | 28 / 28 | 49 / 7 | 112 | 318.24 µm | 44 views |
| S-20-28 | 28 / 28 | 49 / 7 | 112 | 317.6 µm | 49 views |

The tissue counts are thresholded display samples with the donor source-support
mask. They establish a crop-coverage defect; they are not anatomy segmentation
accuracy measurements. A source-box expansion is needed for all 147 acquired
planes, while supported tissue actually extends beyond the old crop in 125.

| Donor | TTE probe anchor | TTE anatomy anchor | TEE probe anchor | TEE anatomy anchor | Receipt |
|---|---|---|---|---|---|
| LADAF | [Gallery](ladaf-2021-17/tte-probe-gallery.jpg) | [Gallery](ladaf-2021-17/tte-anatomy-gallery.jpg) | [Gallery](ladaf-2021-17/tee-probe-gallery.jpg) | [Gallery](ladaf-2021-17/tee-anatomy-gallery.jpg) | [JSON](ladaf-2021-17/native-receipt.json) |
| S-20-29 | [Gallery](s-20-29/tte-probe-gallery.jpg) | [Gallery](s-20-29/tte-anatomy-gallery.jpg) | [Gallery](s-20-29/tee-probe-gallery.jpg) | [Gallery](s-20-29/tee-anatomy-gallery.jpg) | [JSON](s-20-29/native-receipt.json) |
| S-20-28 | [Gallery](s-20-28/tte-probe-gallery.jpg) | [Gallery](s-20-28/tte-anatomy-gallery.jpg) | [Gallery](s-20-28/tee-probe-gallery.jpg) | [Gallery](s-20-28/tee-anatomy-gallery.jpg) | [JSON](s-20-28/native-receipt.json) |

Each donor folder also retains enlarged PLAX AV, PLAX MV and PSAX PV pairs.
The receipts preserve the original render hashes. A final caption-only Echo
status edit was revalidated with fresh actual controller exports: all 168
scientific scene inputs, 336 camera/draw-list combinations and production
shaders were identical. That narrow post-render check is recorded separately
instead of presenting the original render as a later execution.

The harness sequence is `export-review.mjs` per donor, `sample-caps.mjs` per
export, `render_gallery.py` per donor, `audit-coverage.mjs` against the frozen
baseline, and `collect-report.mjs`. Exports and full-size frame sets use a
scratch output path. The repository retains complete contact sheets and
numerical receipts; every frame can be reproduced from the unchanged sources.

## Secondary interface

Echo's model/provenance explanations are grouped into Model Details and Source
Details, with acquisition instructions and manual controls in View Guidance &
Plane Controls. These start closed. Resolution, retries, reference source,
playback controls and context failures stay available outside the disclosures.
TTE and TEE Lab retain their direct manipulation and keyboard controls while
secondary explanations and image controls use compact Model Notes / Settings
disclosures. The shared CT Display controls stay available.

The completed background collection becomes CT Slice Cache Ready with optional
Storage Details. Its description clarifies that Echo and lab detail are sampled
for their current plane; a completed orthogonal cache does not mean every
oblique fine face is already downloaded.
