# TEE video source review and source binding — v56

Reviewed **2026-11-12**. All **33** catalogued TEE recordings were inspected: the
28 ASE/SCA publisher clips and five existing local alternatives. **26 already
contain a native semicircle and numeric angle.** Those displays remain in the
video, with the added SVG and REF explanation hidden. **Seven sources** have no
visible native angle in the inspected frames and receive a labeled reference
supplement: publisher clips **01 and 12**, plus all five local alternatives.

[Source-by-source evidence](source-review.json) records every exact catalog URL,
public original-source URL, reviewed MP4 SHA-256, byte count, duration, encoded
and display dimensions, SAR, decoded frame count, actual sampled presentation
times, native presence and observed numbers. No downloaded publisher video,
extracted frame or screenshot is included in this documentation.

## What the numbers mean

Native numbers below were read from source pixels. They are retained as acquired
scanner readouts; this review does not independently calibrate acquisition
geometry. A native value can differ from the guideline range midpoint.

A **REF** supplement uses the midpoint of the existing view's `angleRange` in
[`tee-atlas-data.js`](../../public/tee-atlas-data.js). Its accessible explanation
states the guideline range and that the number is a representative view angle,
not a measured angle from the recording. For the seven sources without a visible
native number, the actual acquisition angle remains unknown. These teaching
ranges are grounded in the project's existing [ASE/SCA comprehensive TEE
reference](https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf);
this update does not change their clinical definitions.

## Publisher sources

All publisher sources are the exact supplemental MP4 URLs listed in
[`public/assets/tee-atlas/media.json`](../../public/assets/tee-atlas/media.json).
A single value means the number agreed in the three inspected samples; it does
not prove that every unsampled frame has that value.

| ASE video | Catalog view | Observed native angle | Display policy |
| --- | --- | --- | --- |
| 01 | Midesophageal five-chamber | None observed | Add 5° REF |
| 02 | Midesophageal four-chamber | 22° | Retain native; SVG hidden |
| 03 | Midesophageal mitral commissural | 86° | Retain native; SVG hidden |
| 04 | Midesophageal two-chamber | 109° | Retain native; SVG hidden |
| 05 | Midesophageal long-axis | 148° | Retain native; SVG hidden |
| 06 | Midesophageal aortic valve long-axis | 145° | Retain native; SVG hidden |
| 07 | Midesophageal ascending aorta long-axis | 120° | Retain native; SVG hidden |
| 08 | Midesophageal ascending aorta short-axis | 0° | Retain native; SVG hidden |
| 09 | Midesophageal right pulmonary vein | 0° | Retain native; SVG hidden |
| 10 | Midesophageal aortic valve short-axis | 61° | Retain native; SVG hidden |
| 11 | Midesophageal RV inflow-outflow | 70° | Retain native; SVG hidden |
| 12 | Midesophageal modified bicaval tricuspid valve | None observed | Add 60° REF |
| 13 | Midesophageal bicaval | 111° | Retain native; SVG hidden |
| 14 | Midesophageal right and left pulmonary veins | 89° | Retain native; SVG hidden |
| 15 | Midesophageal left atrial appendage | 93° | Retain native; SVG hidden |
| 16 | Transgastric basal short-axis | 0° | Retain native; SVG hidden |
| 17 | Transgastric midpapillary short-axis | 0° | Retain native; SVG hidden |
| 18 | Transgastric apical short-axis | 0° | Retain native; SVG hidden |
| 19 | Transgastric RV basal | 0° | Retain native; SVG hidden |
| 20 | Transgastric RV inflow-outflow | 17° | Retain native; SVG hidden |
| 21 | Deep transgastric five-chamber | 0° | Retain native; SVG hidden |
| 22 | Transgastric two-chamber | 93° | Retain native; SVG hidden |
| 23 | Transgastric RV inflow | 110° | Retain native; SVG hidden |
| 24 | Transgastric long-axis | 74° | Retain native; SVG hidden |
| 25 | Descending aorta short-axis | 0° | Retain native; SVG hidden |
| 26 | Descending aorta long-axis | 90° | Retain native; SVG hidden |
| 27 | Upper esophageal aortic arch long-axis | 29° | Retain native; SVG hidden |
| 28 | Upper esophageal aortic arch short-axis | 81–90° (all 51 frames) | Retain native; SVG hidden |

**Video 28 changes during the loop.** All 51 decoded native-dial frames were
inspected: frames 1–44 show 90°, then frames 45–51 show 88°, 87°, 86°, 84°, 83°,
82° and 81°. Its native display remains visible throughout; a fixed synthetic
number would misrepresent that sequence. Exact timestamps for all 51 observations
are included in `source-review.json`.

## Existing local alternatives

The five existing MP4s are catalogued in
[`public/assets/echo-media-v6.json`](../../public/assets/echo-media-v6.json), with
asset URLs under `assets/echo-media-v7/`. Original supplementary source URLs and
reviewed MP4 hashes are retained in the JSON. All five inspected clips show
cropped ultrasound sectors with no native semicircle, numeric multiplane readout
or angle-only text in their sampled frames.

| Clip ID | Catalog source | Added indicator | Existing guideline range |
| --- | --- | --- | --- |
| `tee-me4c` | Midesophageal four-chamber | 15° REF | 10–20° |
| `tee-melax` | Midesophageal long-axis · color Doppler | 130° REF | 120–140° |
| `tee-me2c` | Midesophageal two-chamber | 90° REF | 80–100° |
| `tee-bicaval` | Midesophageal bicaval | 100° REF | 90–110° |
| `tee-tgpapillary` | Transgastric short-axis | 10° REF | 0–20° |

## Correct binding to cached playback

The local cache verifies media bytes and supplies a Blob object URL to the video
element. Previously the angle placement was compared with the catalog URL. The
playing Blob URL could never match that path, so a local clip could play while
its reference indicator stayed hidden.

The controller now retains the selected source identity, request token and
actual installed playback URL. Placement uses that bound URL, including a
verified cache Blob URL, and still requires matching `src`/`currentSrc`, usable
metadata, a visible video and no media error. Completion of a download alone
cannot show the indicator. Selection changes, failed playback, cancellation and
teardown clear the binding; late downloads and stale metadata cannot restore it.
Fit/full-frame changes reuse the same source rather than starting another load.

The separate [source policy](../../public/tee-reference-angle-policy.js) binds
observations to exact catalog identities: TEE mode, video kind, MP4 MIME type,
ID, preset, URL, byte count, external status, and declared SHA-256 for local
sources. A replacement URL, mismatched view, changed local hash/size or unreviewed
source cannot inherit an old REF supplement. Local bytes are hash-checked by
the cache; the publisher hashes here identify reviewed bytes and do not imply
runtime hashing of external publisher responses.

Existing source captions are retained. Native sources
hide both the added SVG and the REF explanation, including when switching from
a local source to a publisher source for the same view. Only a reviewed
`reference` source with the matching TEE view can enable the supplement.

## Geometry and clear-area checks

The native dial uses a lower semicircle with 0 at the left, 90 downward and 180
at the right. Source dimensions are interpreted with their sample aspect ratio.
For example, an encoded 1280×720 clip can have display dimensions near 1552×720
or 1867×720; treating all encoded pixels as square would misplace the overlay.
The source-native dial boxes for **all 26 native sources** lie inside the
catalog's centered **1.4 aspect Fit crop**. This is an analytical check against
reviewed source pixels; responsive browser layout is a separate verification.

The seven supplements have source-specific clear-area evidence:

- Publisher 01 and 12 reuse the [v41 review](../echo-mobile-v41/angle-source-review.json)
  of the exact same SHA-256 bytes. Their encoded-raster rectangles are
  `[365,86,507,226]` and `[411,86,530,226]`. Across all 56 and 28 decoded frames,
  the highest RGB channel values were 1 and 2 respectively, with no pixels above
  30. These are the prior all-frame clear-area checks, not new all-frame native
  angle inspections.
- For each local source, the maximum corner rectangle starts at 2.5% of source
  width/height and spans 16% of width with the 128:104 SVG aspect ratio. Bounds
  are rounded outward. All **15 rectangles** (five sources × three sampled
  frames) were **exact black: every RGB channel was zero**. Exact bounds and
  actual sample times appear in `clearAreaChecks` in the JSON. This is sampled
  evidence, not an all-frame clearance claim.

The layout uses actual video/display geometry and hides a clipped supplement
instead of moving it into an unreviewed part of the ultrasound sector.

## Validation completed

- **18 Node subtests passed:**
  `node --test tests/echo-angle-placement-v40.mjs tests/echo-angle-placement-v41.mjs tests/multiplane-indicator-v55.mjs`.
  These cover placement, shared gauge geometry and the 33-source policy,
  including exactly seven permitted supplements and native suppression.
- **v39 controller regression passed:**
  `tests/echo-reference-player-v39.mjs`, including source replacement guards and
  hiding both the added indicator and its explanation for native sources.
- **v56 real-cache regression passed:**
  `tests/echo-angle-source-binding-v56.mjs`, using verified retained local MP4
  bytes and actual Blob object URLs with controlled video metadata events.
  It covers the Four-Chamber case, fit reuse, stale selection/download/metadata,
  error and cached retry, same-view local/native switching, and native
  Commissural deduplication. A public checkout without intentionally excluded
  licensed MP4 fixtures explicitly skips this check; supply a verified fixture
  root to run it. The test's header documents the invocation.

Post-deployment browser review was **pending at this documentation freeze**;
its result belongs in the separate release receipt. Controlled DOM tests do not
establish browser decoding or physical-device playback.

## Scope and limits

`ffprobe` supplied stream metadata and decoded presentation timestamps;
`ffmpeg` supplied source frames with SAR-corrected display geometry. Publisher
01–14 were inspected at the first, middle and last decoded frames. Publisher
15–28 and the five local clips were inspected at first, middle and late samples
(requested near 90% duration); the JSON records the actual decoded PTS rather
than assuming requested seek times were exact. Video 28 additionally received
the complete 51-frame native-dial review described above.

This review checks source identity, visible scanner graphics, displayed digits
and placement clearance. It does not validate the named anatomy, ultrasound
acquisition, donor/CT correspondence, spatial registration or clinical use.
No source media, scientific data or clinical acquisition metadata is modified.
