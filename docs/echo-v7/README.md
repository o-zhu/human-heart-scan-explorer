# Echo v7: equal comparison panes, full measured CT detail, and better cine sources

## Interface and measured detail

The comparison now has two equally sized image panes. The left pane switches
between the shared **3D cutaway** and the **CT slice**; there is no separate small
CT thumbnail. The right pane holds the independent real ultrasound movie. Both
panes use the same CSS screen height and equal grid columns. Narrow phones stack
the two panes while preserving their full available width. **Enlarge pair**
removes the preset library and increases both screens together.

The CT canvas now retains the complete measured image. For example, A4C is
**1525 × 2011 pixels**, rather than a 640-pixel preview. The normal fit display
fits those pixels within the pane. **1:1 pixels** exposes the native pixel grid
with scrollbars. Scrolling over the CT image or using its arrow keys changes
the plane; contrast and visual style still apply to the measured density.
Hidden CT panes do not perform color conversion, and ordinary UI updates do
not repaint an obsolete full-size slice before the new one arrives.

All **13 prepared presets** still use the original 79.4 µm lossless WebP
reformats. Their decoded R8 arrays go to the renderer at full dimensions.
Prepared and streamed clean samples carry `cleaned: true`, allowing both the
2D canvas and the renderer to avoid applying the coarse cleanup mask a second
time. These are cleaned, windowed display data from the specimen; they are not
the original quantitative 16-bit scan.

The shared renderer's motion-resolution changes are maintained separately. Echo
does not substitute a lower-resolution prepared texture when a camera moves.

## Arbitrary adjusted planes

The host injects the shared fine-volume service through:

```js
echoModule.setFineSource(ultraVolume);
```

For a moved, tilted, or rotated plane, Echo displays an immediately available
reformat from the loaded volume with that volume's actual resolution label.
After a 160 ms settling interval it requests the exact current world plane:

```js
source.samplePlane(plane, {
  signal,
  priority: 'interactive',
  spacingUm: 79.4,
  onProgress
});
```

The result must be complete, have finite source/pixel spacing and valid density
dimensions, and match the requested center, right/up axes, width, and height.
Its full top-row-first R8 pixels are uploaded without transferring or detaching
the shared cache buffer. Source spacing and actual in-plane pixel spacing are
distinct metadata. A sample whose output grid is coarser is identified as a
fine-volume section rather than being indiscriminately called Ultra.

Progress is shown in the detail status. Changes and module exit abort obsolete
requests. Request IDs reject stale results; a late loaded-volume preview cannot
replace a finished fine sample. A failure keeps the correctly labeled loaded
volume visible. Reset restores the prepared preset path. A failed prepared-image
transfer may use the same exact-plane service as a fallback.

The shared fine source contains cleaned display values. **Clean scan off**
therefore uses only the original loaded volume, labels its true resolution, and
never requests or relabels cleaned fine data as original.

## What improved in the ultrasound movies

Five normal TTE defaults now use the licensed original CardioNetworks recordings
instead of lower-cadence GIF conversions. Their principal improvement is real
recorded **51 fps motion**, compared with the previous 10–12 fps GIF sources.
The native frame is 624 × 480, including the original clinical annotations and
credit footer. These are not described as HD, and no new spatial detail or
intermediate motion frames are generated.

| View | Previous prepared movie | New original cadence and frame | New MP4 bytes |
|---|---|---|---:|
| PLAX | 600 × 370, 10 fps | 624 × 480, 51 fps, 51 frames | 208,087 |
| PSAX, papillary | 440 × 506, approximately 12 fps | 624 × 480, 51 fps, 93 frames | 375,472 |
| A4C | 600 × 472, 10 fps | 624 × 480, 51 fps, 50 frames | 215,551 |
| A2C | 600 × 450, 10 fps | 624 × 480, 51 fps, 91 frames | 407,118 |
| Subcostal four-chamber | 600 × 354, 10 fps | 624 × 480, 51 fps, 44 frames | 170,931 |

The existing A3C recording was already a 624 × 480, 51 fps CardioNetworks
recording, so it is unchanged. The POCUS Atlas mitral-to-papillary sweep is
retained at its native GIF cadence and remains explicitly labeled as a changing
plane. A newly found clip was not silently substituted for an unmatched view.

No demonstrably superior, reusable normal TEE set was verified during this
search. The five licensed journal teaching loops are therefore retained, with
black margins removed at native pixels. This makes the useful sector occupy
more of the equal-sized pane; it does **not** increase acquisition resolution.

Every source frame was decoded to determine the union of visible content, with
an eight-pixel margin. The actual maximum discarded channel intensity was only
0–4 out of 255 across all frames. The source's sector, depth marks, Doppler
overlay, and other visible annotations remain intact. No tissue enhancement or
AI reconstruction is used.

| TEE view | Source frame | Native crop | Frames, cadence | Retained frame area |
|---|---|---|---|---:|
| ME 4C | 1280 × 720 | 792 × 568 | 39, 25 fps | 48.8% |
| ME LAX with color Doppler | 1280 × 720 | 870 × 610 | 19, 25 fps | 57.6% |
| ME 2C | 1920 × 1080 | 1074 × 810 | 31, 25 fps | 42.0% |
| Bicaval | 1280 × 720 | 804 × 596 | 42, 25 fps | 52.0% |
| TG SAX | 1920 × 1080 | 1224 × 880 | 38, 25 fps | 51.9% |

The article does not designate each individual TEE clip as normal. The UI keeps
the description **published clinical teaching loop**. It identifies color
Doppler in ME LAX and does not claim an exact ME AV SAX reference is available.
All movies show independently acquired people and are not spatially registered
or heartbeat-synchronized to the fixed CT specimen.

The active collection now totals **7,530,996 bytes of video** and **346,428 bytes
of posters**, versus 14,455,544 bytes of video previously. The selected-only Blob
delivery remains unchanged: one selected movie fetch, an 8 MiB retained URL
cache, a 4 MiB per-movie ceiling, exact length/checksum checks, cancellation, and
native muted/paused initial controls. The largest current clip is 1,787,519
bytes, the retained mitral sweep. This does not depend on unsupported HTTP range
responses from the static host.

Changed media URLs are versioned under `assets/echo-media-v7/` to avoid stale
browser-cache collisions. The catalog remains at `assets/echo-media-v6.json`
for host compatibility and declares version `echo-media-v7`. Previous version
files remain available to older cached clients; they are not fetched by the
current catalog. The cache admits only the explicit v6/v7 local MP4 path pattern.

## Provenance and reuse

Verified on 2026-11-05. The catalog records source/download URLs, author, license,
changes, source/prepared SHA-256, frame count/cadence, crop bounds, dimensions,
and sizes. These media licenses do not change the application software license.

### CardioNetworks / ECHOpedia

Author: **CardioNetworks: Vdbilt (I. A. C. van der Bilt, MD)**. The primary file
records identify each view as normal and specify **CC BY-SA 3.0**, with
copyright-holder permission reviewed under Wikimedia VRT ticket
2011102310008874. The derived MP4s and posters are offered under the same
license. Credits and source annotations remain visible.

- [PLAX original and license](https://commons.wikimedia.org/wiki/File:PLAXnormal_(CardioNetworks_ECHOpedia).webm)
- [Papillary PSAX original and license](https://commons.wikimedia.org/wiki/File:SAXPAP_normal_(CardioNetworks_ECHOpedia).webm)
- [A4C original and license](https://commons.wikimedia.org/wiki/File:A4C_normal_(CardioNetworks_ECHOpedia).webm)
- [A2C original and license](https://commons.wikimedia.org/wiki/File:A2Cnormal_(CardioNetworks_ECGpedia).avi.webm)
- [Subcostal original and license](https://commons.wikimedia.org/wiki/File:Subcostal_normal_(CardioNetworks_ECHOpedia).webm)
- [Retained A3C original and license](https://commons.wikimedia.org/wiki/File:A3Cnormal_(CardioNetworks_ECGpedia).avi.webm)
- [CC BY-SA 3.0 terms](https://creativecommons.org/licenses/by-sa/3.0/)

### TEE journal recordings

**Nazerian et al. (2020), The Ultrasound Journal 12:41**. The primary article
[and its supplementary files](https://link.springer.com/article/10.1186/s13089-020-00189-0)
provide views 1a–1e. Article and included material are under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) unless otherwise
credited; no separate restriction was identified for these clips. The cropped
MP4/poster derivatives retain that license and explicitly document changes.

### Retained mitral sweep

**Hannah Kopinski, Lindsay Davis, and Matthew Riscinti — The POCUS Atlas**.
[Normal cardiac catalog](https://www.thepocusatlas.com/normal-cardiac-anatomy),
[primary license declaration](https://www.thepocusatlas.com/legal), and
[CC BY-NC 4.0 terms](https://creativecommons.org/licenses/by-nc/4.0/).
The noncommercial license remains applicable to this retained recording.

### Other sources considered

- [Core Ultrasound cardiac clip bank](https://coreultrasound.com/cb_cardiac/):
  relevant normal videos, but its displayed copyright statement reserves all
  rights; no explicit rehosting license was verified.
- [ICMWK normal-heart teaching page](https://icmwk.com/resources-2/echocardiography/basic-echo-normal-heart/):
  relevant direct videos, but a reuse grant was not verified.
- [ESANZ image library](https://www.esanz.org/library/image-library.html):
  permits credited education/teaching use with qualifications for publication,
  research, or commercial use; the reviewed subsets were specialized aortic
  morphology, pericardial sinus, and prolapse examples rather than a clear
  replacement normal standard-view set.
- Procedure, cardiac-arrest, and disease case reports were not silently
  substituted as normal matched-view examples merely because their files were
  larger or labeled 1080p.

## Validation and reproduction

```sh
python scripts/prepare_echo_media_v7.py
node --test tests/echo-v6.test.mjs tests/echo-v6-media-cache.test.mjs
node tests/echo-v6-ui.mjs /path/to/test-only/linkedom/esm/index.js
node tests/echo-v7-ui.mjs /path/to/test-only/linkedom/esm/index.js
python tests/echo-v6-assets.py
python tests/echo-v7-media.py
```

The existing asset test independently checks all 13 source registrations and
all 12 current media files. The v7 DOM test covers the full-resolution prepared
paths, two-pane structure, native CT display, cleaned provenance, exact-plane
fine results, progress, cancellation, stale races, error fallback, original data
comparison, and preference restore. Existing cine DOM/cache tests preserve
selected-only behavior and paused entry/reentry. Media preparation and the
focused v7 check verify native dimensions, every source frame, cadence, crop
metadata, bounded byte sizes, fast-start MP4 layout, and no audio streams.

Results are in `ui-validation.json` and `media-validation.json`;
`media-quality.json` records the measured changes. The visual review sheet is
`cine-contact-sheet.jpg`. Direct browser UI playback was not exercised because
the session's browser policy disallowed the Site browser workflow; tests use
actual file decoding and DOM/state with explicit media/canvas mocks. No live
frame-rate or browser-rendered layout measurement is claimed.
