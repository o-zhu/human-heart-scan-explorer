# Supplemental TEE angle readouts, v41

## Changes

The two recordings without readable acquired-angle readouts now show one
representative value: **5° for ME five-chamber** and **60° for ME modified
bicaval TV**. These are the respective guideline-range midpoints. The small
**REF** caption remains in the scanner-style dial. Its accessible description
and the text below the video explicitly identify a representative reference,
retain the **0–10°** or **50–70°** guideline range, and state that the acquired
angle is not displayed in the source clip. Clinical atlas ranges, preset angles,
source recordings and all other native scanner readouts are unchanged.

## Reproduced placement error

The publisher files have a 1280 × 720 **encoded** raster and non-square pixels:

| Recording | Pixel aspect ratio | Display aspect ratio | Observed browser dimensions |
| --- | --- | --- | --- |
| ME five-chamber, Video 1 | 40:33 | 640:297 | 1552 × 720 |
| ME modified bicaval TV, Video 12 | 512:351 | 8192:3159 | 1867 × 720 |

The previous placement calculation preferred catalog raster dimensions over
`video.videoWidth` and `video.videoHeight`. In Full Frame it therefore computed
the wrong letterbox height. In the modified-bicaval example this raised the dial
into the original blue header and FR/depth controls. The source catalog's raster
dimensions are accurate and do not need changing.

The corrected calculation uses the browser's intrinsic display dimensions only
after metadata belongs to the selected URL. It measures the actual video element
relative to the pane's inner border, then applies its computed `object-fit` and
centered `object-position`. It does not infer the video element's size from the
pane or a shared CSS height variable. A single ResizeObserver watches the pane
and video, covering responsive layouts, enlarged pairs and workspace fullscreen.
There is no per-frame video work or body-wide mutation observer.

Source changes hide the dial until the video has metadata, a matching `currentSrc`
and a matching assigned `src`. Empty media, errors and disposal remove or hide
the presentation. An unexpectedly clipped source slot is hidden rather than
relocated over unreviewed image content.

## Source-space placement evidence

The position remains 17% across and 12% down the centered 1.4-aspect ultrasound
area. Correct display-aspect mapping places it below the modified-bicaval header,
right of the scanner settings, and left of the ultrasound sector. The entire
128 × 104 dial is capped at 17% of that area's width and 160 CSS pixels. This
image-space cap prevents a CSS minimum from making the dial cover heart pixels
when a full source frame is small.

Both original publisher MP4s were downloaded temporarily for inspection and
decoded with FFmpeg; they were not modified or added to hosted assets. Every
decoded frame was checked in the conservative rectangle containing the complete
dial at its maximum image-space size:

| Recording | Encoded pixel rectangle, L/T/R/B | Frames checked | Maximum RGB channel value |
| --- | --- | --- | --- |
| ME five-chamber | 365 / 86 / 507 / 226 | 56 | 1 of 255 |
| ME modified bicaval TV | 411 / 86 / 530 / 226 | 28 | 2 of 255 |

The rectangles contain only black background, with negligible codec noise.
Source URLs, byte sizes, SHA-256 identities, aspect metadata and the exact audit
measurements are recorded in `angle-source-review.json`. The decode frame counts
are the actual frames inspected, not the catalog's nominal stream counts.

## Focused checks

```sh
node --test tests/echo-angle-placement-v40.mjs tests/echo-angle-placement-v41.mjs
node tests/echo-reference-player-v39.mjs /path/to/linkedom/esm/index.js
```

The eleven placement checks include the reproduced non-square-pixel failure,
both framing modes across seven pane sizes, source-reviewed clear rectangles,
independently sized/offset media elements, stale metadata, current-source identity,
video-only layout changes, disabled states and observer cleanup. The player
controller regression retains native muted autoplay, fresh source lifecycles,
source attribution and existing YouTube recovery behavior. These checks establish
layout and lifecycle behavior; they do not establish acquisition-angle measurement
or clinical validation.
