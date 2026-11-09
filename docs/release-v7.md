# Heart Explorer v7

## Visible changes

- Reconstruction automatically prepares the complete compressed X/Y/Z Ultra
  collection in persistent browser storage. The current slice and decoded
  neighbors take priority over bulk downloads. The global progress bar remains
  visible in every module, with Pause/Resume and explicit storage/network states.
- Motion keeps the measured cut face at the idle output resolution. A separate
  lower-resolution volume pass keeps interaction lighter; it does not change the
  tissue/space palette, threshold, lighting, contrast, or fine texture pixels.
- Echo precedes Probe in navigation. The embedded full-resolution atlas is hidden.
- Echo has equally sized 3D-or-CT and real-ultrasound panes. CT can be fitted or
  inspected at native pixels. Probe similarly pairs the 3D view with simulated
  ultrasound or its measured CT sector.
- Probe starts locked to a visible synthetic contact surface: curved skin for
  TTE-like presets and an esophageal-wall proxy for the atrial/TEE-side preset.
  These surfaces are illustrative guides, not patient body geometry from the
  isolated-organ dataset. W/A/S/D slide along the surface; steering changes beam
  orientation. Clicking the 3D scene captures control when the browser permits;
  a prominent Escape banner appears. Orbit mode, drag pad and sliders remain.

## Data and caching

The orthogonal collection contains **1,096 nonempty lossless images totaling
507,669,042 bytes**. Another 384 empty section positions require no image
transfer. This is an initial approximately 508 MB background download, rather
than an assertion that every section is instantly available on the first visit.
Only a bounded neighborhood is decoded into RAM. Persisted images are reused
and unfinished downloads resume; unavailable storage, Data Saver and network
errors are reported instead of repeatedly downloading and evicting the bank.

Fine arbitrary planes use the actual **79.4 µm cleaned, windowed uint8 display
volume**, alongside the smaller interactive 3D volume. Its original cropped
array has 2,871,104,901 values. We package nonzero 64³ cores with a positive
one-voxel halo as lossless gzip blocks, omitting blocks whose interior and halo
are all zero. The result is 5,127 blocks and 805,012,353 encoded bytes. A plane
requests only intersecting blocks and samples their eight source neighbors by
trilinear interpolation. No anatomical detail is synthesized.

The fine worker has a 96 MiB decoded-brick limit, 32 MiB prepared-image limit
and separate 384 MiB encoded disk cache. Completed main-thread fine planes use
a 32 MiB LRU. Four exact Probe defaults are prepared losslessly for fast entry;
the thirteen existing Echo default planes retain their original full fine
dimensions. Adjusted Echo/Probe planes refine using the shared block service.
The first uncached arbitrary plane can still need a substantial download; status
labels show the current source detail and refinement progress. Moving to another
plane cancels obsolete work. Fine clean data is not presented as original raw
data when cleanup is disabled.

## Ultrasound recordings

Five normal TTE defaults now use 624×480, 51 fps CardioNetworks originals instead
of 10–12 fps GIF-derived loops. These preserve recorded motion; they are not
upscaled or motion-interpolated. Five licensed TEE teaching clips retain their
native acquisition pixels and 25 fps while verified unused black margins are
removed. No superior reusable normal TEE collection was established in this
round. The current 12-video bank totals 7,530,996 bytes, compared with 14,455,544
previously. Sources, attribution, licenses, crop geometry and limitations are
recorded in [Echo v7](echo-v7/README.md).

The real ultrasound loops are independent clinical recordings, not this fixed
specimen or synchronized cardiac phases. The Probe ultrasound is a CT-derived
educational approximation, not an acoustic simulation validated for diagnosis.

## Verification

- The actual JavaScript fine sampler was compared with an independent SciPy
  implementation across sparse phantom planes, boundaries and three adjusted
  real tissue views (2,596,572 real image pixels): all compared pixels matched.
- Five focused lifecycle checks cover destroyed initialization, cancellation,
  prepared-cache accounting and stale completions. Three storage-route checks
  cover closed-by-default writes, checksums, immutability and exact encoded reads.
- Sixteen collection checks cover complete traversal, persistent resume,
  prioritization, quota handling and bounded retries. Renderer orchestration
  checks cover moving/idle paths, snapshots, material stability and failure
  fallback.
- Actual production GLSL was rendered offscreen against the scan. Verified
  cut-face pixels in A4C and ME4C matched the full-resolution idle reference
  exactly during the new motion pass. Native software-driver timing is evidence
  for that harness only, not a browser FPS benchmark.
- Echo media files were decoded and checked against their source frame cadence,
  hashes and crop geometry. Probe tests cover surface constraints, exact default
  plane registration, shared fine CT/ultrasound data and input-state handling.

The current environment did not permit actual Site browser interaction. DOM,
worker, geometry, asset, HTTP and native shader checks do not establish browser
pointer-lock permission, browser video playback or device-specific frame rates.
Use the portable local server for device review and future work.

## Local continuation

The portable export includes the source, public assets, complete orthogonal
image bank, fine-volume blocks, licenses and a standard-library local server.
See `LOCAL-DEVELOPMENT.md` at the project root. The original 19.85 µm raw atlas
is not duplicated in this browser-focused export; the source record and data
preparation provenance remain available from About and the asset manifests.
