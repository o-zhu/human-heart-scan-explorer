# Hosted 79.4 µm cut-face detail

The Ultra view now loads a cropped, **losslessly compressed 2D image** for the
selected plane. It no longer downloads neighboring 3D source bricks in the
visitor's browser. All 1,480 orthogonal section positions are covered. Every
nonempty image is smaller than 1 MB.

## Measured result

| Plane | Previous raw-N5 transfer estimate | Hosted lossless image | Reduction |
| --- | ---: | ---: | ---: |
| X237 | 332.35 MB | 842,946 B (0.843 MB) | 99.75% |
| Y237 | 337.45 MB | 908,334 B (0.908 MB) | 99.73% |
| Z363 | 52.70 MB | 513,858 B (0.514 MB) | 99.02% |
| Z400 | 38.25 MB | 394,014 B (0.394 MB) | 98.97% |

The previous values are the v3 source planner's estimates, not new measurements
of a particular internet connection. The new values are exact encoded file
sizes. In particular, the approximately 50 MB axial request becomes a single
514 KB image. The source sampling and retained grayscale pixels are unchanged.

There are 1,096 nonempty images and 384 empty positions. Empty positions return
one zero-valued pixel locally and need no image request. Nonempty images have a
median size of **470,913 B**, a 95th percentile of **886,844.5 B**, and a maximum
of **956,458 B**. The complete set of unique compressed assets is
**507,669,076 B**; a visitor downloads selected slices, never the entire pack.

The complete pack is served from the Site's object storage through the existing
private Site origin. The immutable image prefix is `/api/ultra/v4/`. The public
application manifest contains crop coordinates, byte lengths, encoded SHA-256,
and decoded-pixel SHA-256 for each section. The Site's existing audience remains
in force; no separate public data host is introduced.

## Source and registration

- Dataset: [LADAF-2021-17 complete heart](https://human-organ-atlas.esrf.fr/datasets/1659197537),
  DOI [10.15151/ESRF-DC-1634390196](https://doi.org/10.15151/ESRF-DC-1634390196), CC BY 4.0.
- Official N5 level: `s2`, XYZ 1903 × 1903 × 2120, uint16 big endian,
  128 × 128 × 128 source bricks, Blosc/Zstd/bitshuffle compression.
- Source sampling: **79.4 µm**. The original acquisition has 19.85 µm native
  sampling; this viewer does not claim to display that native resolution.
- Existing section index `i` selects exactly source plane `4*i`. Through-plane
  section positions remain 317.6 µm apart.
- Full display extent: XYZ 1897 × 1897 × 2117 pixel centers. Its first and last
  centers exactly match the 475 × 475 × 530 reconstruction at 317.6 µm.
- X image columns are Y and rows are Z; Y columns are X and rows are Z;
  Z columns are X and rows are Y. No image is flipped.
- Original intensities `[14640,23545]` are linearly mapped, rounded, and clipped
  to uint8 display values. This is the same display window as v3 Ultra.

The offline preparation fetched and losslessly decoded the 832 N5 bricks
intersecting the existing conservative retained-heart support. The downloaded
source payload was 2,539,278,542 bytes. Those source bricks are not part of a
visitor's slice download.

## What compression changes

The existing cleanup support is sampled at the correct original coordinates.
Values outside that conservative support are zeroed, and empty margins around
each slice are cropped. Cropping removes 78.56% of the full-frame pixel
inventory across all positions. The retained crop contains the actual source
values; no tissue-density cutoff is applied during encoding. Lowering the
rendering threshold still reveals the retained lower-intensity data.

The cropped images are encoded as **lossless WebP**. All 1,096 nonempty images
were decoded again and compared byte-for-byte against their pre-encoding source
display pixels. Maximum compression error is **zero**. No additional intensity
quantization, sharpening, smoothing, texture synthesis, or in-plane resampling
is applied. The encoder's `quality=75` setting controls lossless compression
**effort**; it is not a lossy image-quality setting. `lossless=True` is explicit.

Crop origins are even source-image coordinates and crop dimensions are odd.
Each crop's first and last pixel centers are carried into both the 3D texture
frame and 2D section cards. A cropped image therefore retains its original
physical position and scale; it is never stretched over the full scan extent.

The lighter 158.8 µm Detail setting reads exact alternate rows and columns from
the same decoded 79.4 µm image. It needs no second image request. It is now an
s2-derived display, not the previous independently averaged s3 JPEG image.

## Loading behavior

`hosted-ultra.js` implements the former `UltraSections` interface and a shared
section store. `section-detail.js` uses that store for its alternate-pixel
images. Concurrent requests for a card and its cut face share one fetch and one
decode. Full-resolution grayscale caching is bounded to 48 MiB and Detail
caching to 12 MiB / 18 sections. Decoding bitmaps are closed promptly instead of
being retained alongside grayscale arrays.

Ultra loads automatically after section scrolling settles. A stale request
cannot overwrite a newly selected cut face. A small image request that is
already shared with a section card can finish and enter the cache after the
cap request is cancelled. No raw-N5 fallback request is started. Failures leave
the currently available volume/section texture visible and expose Retry.

## Verification and reproducibility

`verify-hosted-sections.py` verifies the full 1,480-position inventory, every
unique file's byte length and SHA-256, decoded-pixel SHA-256, crop bounds,
alternate-pixel physical registration, and the less-than-1-MB maximum. Thirteen
additional source comparisons span X, Y, and Z at peripheral, basal, ventricular,
and apical levels. `hosted-ultra-validation.json` records the results.

`hosted-ultra-compression.png` compares a measured myocardial patch before and
after hosted-image encoding; the two are exactly equal. The older
`ultra-detail-comparison.png` compares measured s3 and s2 detail before this
transport change. Neither figure uses generated anatomy or sharpening.

The v3 `verify-ultra.mjs` and `ultra-decoder-validation.json` retain the
independent N5/Blosc decoder checks: full bricks and all four HTTP-ranged Z
quarters matched Python `blosc2` reference bytes. The new preparation uses
Python `blosc2` directly and records each downloaded brick's checksum.

Rebuild using the source scripts (set output and support paths to the checkout's
current source-data/public directories):

```bash
python scripts/download_s2.py --data-root /path/to/heart-data --workers 16
python scripts/prepare_hosted_sections.py \
  --data-root /path/to/heart-data \
  --output /path/to/hosted-ultra \
  --support /path/to/heart-support.raw.gz \
  --codec webp --lossless --quant-step 1 --quality 75 --method 4 \
  --asset-base /api/ultra/v4/ --workers 4
python scripts/verify-hosted-sections.py \
  --assets /path/to/hosted-ultra \
  --manifest /path/to/manifest.json \
  --data-root /path/to/heart-data \
  --support /path/to/heart-support.raw.gz
```

The complete source pack belongs outside a static deployment archive; the
Site's storage-serving implementation handles delivery. The object-storage
upload and read-route verification are documented separately by the Site
integration.

## Limits

Lossless here refers to the **windowed, conservative-support 8-bit display
image**, not the full quantitative uint16 source scan. Exterior debris and
background removed by preprocessing cannot be restored in this image by
turning off the viewer's cleanup toggle; the independently loaded 3D volume
still supports that toggle. Source-aligned cropping does not establish clinical
orientation or validate anatomical labels. Ultrasound oblique presets retain
their separately documented source sampling.
