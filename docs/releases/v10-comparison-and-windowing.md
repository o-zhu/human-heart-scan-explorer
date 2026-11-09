# Heart Explorer: donor comparison and brightness windowing

This release corrects the overly bright UCL-ZCR-2629 section display and adds
three independently processed under-18 comparison sources. The public atlas
reports the age category `<18`, without exact age, and labels these sources
`Disease free`. Catalog metadata is preserved verbatim under `docs/donors/`.

## Sources

| Specimen | Dataset | Native voxel | Ultra display voxel | Source encoding |
|---|---|---:|---:|---|
| UCL-ZCR-2629 | 2298522198 | 7.032 µm | 28.128 µm | OME-Zarr |
| UCL-ZCR-2337 | 2298521860 | 10.62 µm | 42.48 µm | N5 |
| UCL-ZCR-2627 | 2298522608 | 7.032 µm | 28.128 µm | OME-Zarr |
| UCL-ZCR-2628 | 2298522707 | 7.032 µm | 28.128 µm | N5 |

LADAF-2021-17 remains available at its existing resolutions. These are distinct
specimens, not regional zooms or duplicate scans of the same donor.

UCL-ZCR-2627 shows more open cavities in the reviewed measured sections than
UCL-ZCR-2629. This is a visual source observation, not a computed chamber-volume
comparison. UCL-ZCR-2337 contains adjacent lung tissue as well as the heart.
The comparison panel's dimensions describe the acquisition field, including
surrounding space; they must not be interpreted as heart or chamber volumes.

## Display correction

The UCL-ZCR-2629 source encoding clipped approximately 1.04% of the sampled
retained tissue values at its upper limit. Its former display curves flattened
57.23% of tissue values near white on the cut face and 72.89% in the orthogonal
panels. The texture data therefore retained much more detail than the display
showed. See `docs/windowing-v10/findings.md` and its underlying statistics.

A shared black-point, white-point, gamma and contrast transfer now serves the
GPU cut face, CPU fallback, X/Y/Z images, measured Echo sections, Flow sections
and Probe CT pane. The new default window on UCL-ZCR-2629 is 36500–38534 with
gamma 1.1 and additional contrast 1.0. The dataset's existing 0.32 tissue threshold,
cleanup mask, voxel values and chamber geometry remain unchanged. Cached Ultra
textures remain valid. The predicted ultrasound calculation does not use this
display transfer.

Each new donor has independently reviewed intensity settings. Brightness &
windowing controls can be adjusted and reset to the selected donor's defaults.
Bookmarks retain those settings; changing sources clears the previous camera
bookmark. Legacy disabled windowing remains byte-compatible with the original
palette functions.

## Processing and loading

The generalized preprocessing pipeline validates N5/Zarr axis order and byte
order, derives physical sample-center registration from source metadata, and
preserves acquired terminal fine voxels through explicit zero padding. Preview
resampling preserves physical endpoints even when an axis has an even number
of samples or the longest dimension is not Z. The source-to-display intensity
mapping is recorded separately from display-only brightness settings.

Source chunks stream into a support-masked uint8 volume without creating a
complete fine uint16 intermediate. Orthogonal images are cropped and encoded
as lossless WebP. Fine density blocks retain their 65³ stored samples with 64³
cores and interpolation halos, and use lossless gzip. Source sampling, object
round trips and manifest hashes are verified before publication.

Each new preview downloads about 2–3 MB. Higher-detail volume parts, current
sections and background Ultra preparation remain separate. The comparison
panel performs no data prefetch; only the selected donor starts loading. The
existing foreground-priority scheduling and browser timer binding fix remain
in place.

## Complete prepared collections

The new sources add 29,565 immutable objects (7,332,477,119 bytes) across six
collections. These banks are delivered progressively for the selected source;
opening the comparison table does not fetch them.

| Donor | Orthogonal image objects | Fine-volume bricks | Combined encoded bytes |
|---|---:|---:|---:|
| UCL-ZCR-2627 | 1,312 | 9,577 | 2,646,725,491 |
| UCL-ZCR-2628 | 1,424 | 9,028 | 2,478,560,535 |
| UCL-ZCR-2337 | 1,317 | 6,907 | 2,207,191,093 |

All 75 prepared Echo, geometric-comparison and Probe views use completed fine
sources: 28.128 µm for 2627/2628 and 42.48 µm for 2337. Orthogonal textures retain
this in-plane pitch; consecutive bank locations advance by four fine source
samples. Oblique planes reformat the fine volume directly.

All three donors passed the full pipeline checks and a separate independent
fine-data audit. The new source/geometry modules passed eight additional
runtime-contract tests. The reports preserve the measured sample counts,
source hashes, physical registration error and exact decoded-pixel checks.

## Hosting and portable source

An additional manifest-bound display collection serves 165 large public files
(280,970,165 bytes) at their existing URLs. The Worker returns the original
encoded bytes with SHA-based ETags; gzip remains opaque for client decoding.
Verified copies are excluded only from the deployment build, reducing its
static payload to approximately 167 MB. All source copies remain in the
repository and complete portable archive, so local use requires no cloud
storage. This separation addresses the hosting package limit without changing
voxel data, texture quality, public URLs, or the selected-donor loading policy.

## Anatomical scope

The three additional donors have their own measured comparison planes and
prepared probe starts. Chamber/valve identities are unassigned; no segmentation
or clinical orientation is copied from a different specimen. Their Echo movies
are independent clinical references. The UI labels these CT planes as geometric
comparisons and disables unavailable anatomy colors.

## Verification records

- `docs/windowing-v10/gpu-validation.json`: production shaders and 4,608 GPU/JS
  tone comparisons, maximum channel error 0.
- `tests/windowing-v10.mjs`: common CT transfers, anatomy colors, CPU worker,
  Echo state and unchanged predicted ultrasound inputs.
- `scripts/verify-flow-windowing-v10.mjs`: Flow display/state consistency.
- `tests/app-boot-v8.mjs`: actual startup, lifecycle and comparison/window UI
  behavior using DOM fixtures.
- `tests/browser-receivers-v8_1.mjs` and `tests/loading-priority-v8.mjs`: browser
  receiver compatibility and nonintrusive download scheduling.
- Donor-specific processing records and source metadata: `docs/donors/`.

Verification uses source data, native EGL, actual module code with DOM/worker
fixtures, lossless decode checks and authenticated production HTTP checks.
No new browser interaction or frame-rate measurement is claimed.
