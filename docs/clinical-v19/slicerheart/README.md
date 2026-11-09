# SlicerHeart measured 4D CT pilot

This pilot packages the public **TruncalValve_4DCT** sequence as a small, independently streamed display dataset. It contains real acquired cardiac phases, including a native-spacing valve/outflow region and one native-spacing cardiac reference. It does not contain synthetic intermediate frames, chamber segmentation, or matched ultrasound.

The source is a **clinical case: an adolescent with repaired truncus arteriosus**, according to the official SlicerHeart sample registration. It is not a healthy reference. Exact age and sex are not supplied in the inspected source metadata.

## Sources and attribution

- [Official SlicerHeart sample registration and checksum](https://github.com/SlicerHeart/SlicerHeart/blob/master/ValveAnnulusAnalysis/ValveAnnulusAnalysis.py).
- [Original NRRD download](https://github.com/SlicerHeart/SlicerHeart/releases/download/TestingData/TruncalValve_4DCT.seq.nrrd).
- [MONAI Physio public example-data documentation](https://project-monai.github.io/monai-physio/cli_scripts/download_data.html), which independently identifies the sample as public 4D cardiac CT and splits its indices into 21 files.
- Lasso et al. *SlicerHeart: An open-source computing platform for cardiac image analysis and modeling.* Frontiers in Cardiovascular Medicine 9 (2022). [doi:10.3389/fcvm.2022.886549](https://doi.org/10.3389/fcvm.2022.886549).
- [Upstream BSD-3-Clause project license](https://github.com/SlicerHeart/SlicerHeart/blob/master/LICENSE), preserved verbatim with the deployed assets as `SlicerHeart-LICENSE.txt`.

The public release is described as testing data. No separate data-specific license statement was found attached to this asset. The preserved repository license is not presented as a separate clinical-data license. No Creative Commons license, healthy status, consent statement, or acquisition pairing has been inferred.

## Original data verified

| Property | Observed value |
| --- | --- |
| Original file size | 1,267,650,314 bytes |
| Official and downloaded SHA-256 | `7573f1bc7ca92d7d1012eecf98211cfd9939c1d22d87aee1db91c8ab72031cfb` |
| Scalar type | Little-endian signed 16-bit |
| Spatial dimensions | 512 × 391 × 218 |
| Stored voxel spacing | 0.599609375 × 0.599609375 × 0.700000000 mm |
| Coordinate system | Right–anterior–superior (RAS), positive diagonal spatial directions |
| Source origin | (−145.19999694824219, 8.94163990020752, 903.0999755859374) mm |
| Listed phase indices | 0 through 20 |
| Unique spatial frames | 20; full-volume comparison confirms index 20 is exactly identical to index 0 |
| Original decoded size | 1,832,957,952 bytes |
| Phase times / ECG percentages | Not supplied by the NRRD |

The NRRD's list axis is the fastest axis. The decoded source is therefore interpreted as Z–Y–X–phase in C memory order, with the dimensions `(218, 391, 512, 21)`. The viewer frames are X-fastest 3D buffers after selecting one source phase.

The stored grid spacing is a spatial sampling interval, not a measurement of the scanner's resolving power. This clinical CT is substantially coarser than the preserved-heart HiP-CT scan. The file stores values spanning the familiar CT intensity range, but its NRRD header does not declare Hounsfield calibration; metadata therefore labels them **stored CT scalar values**.

## Three complementary series

| Series | Frames listed / files | Dimensions (X × Y × Z) | Stored spacing, mm | Unique gzip bytes |
| --- | --- | --- | --- | ---: |
| Cardiac overview | 21 / 20 | 145 × 125 × 109 | 1.19921875 × 1.19921875 × 1.4 | 25,026,033 |
| Native valve/outflow detail | 21 / 20 | 160 × 130 × 100 | 0.599609375 × 0.599609375 × 0.7 | 32,988,798 |
| Native cardiac reference, source phase 0 | 1 / 1 | 290 × 250 × 218 | 0.599609375 × 0.599609375 × 0.7 | 9,761,021 |
| **Total** | **43 entries / 41 files** | | | **67,775,852** |

These are **67.8 MB of display derivatives**, not lossless compression of the entire 1.27 GB source. The savings combine a fixed spatial field of view, a lower-resolution overview, an 8-bit display encoding, gzip, and reuse of the duplicated closing frame.

The overview is the first, inexpensive stream. Its first frame is 1,271,156 bytes. Native detail frames are approximately 1.62–1.67 MB each; the full native cardiac reference is 9.76 MB. The client can load the selected frame first and keep a small neighborhood ready without preloading the whole package.

### Fixed spatial fields

All bounds are original source indices, with the upper bound excluded. No frame-dependent crops, image registration, deformation, slice shifts, or motion interpolation are applied.

- **Cardiac field:** X `[60,350)`, Y `[115,365)`, Z `[0,218)`. The complete acquired Z extent is retained to avoid trimming the apex. The field includes adjacent tissue; it is not a whole-heart segmentation.
- **Native detail field:** X `[140,300)`, Y `[180,310)`, Z `[80,180)`. This is a heart-base region containing the truncal valve/outflow. Peripheral chambers and the apex lie outside it.
- **Overview:** each 2 × 2 × 2 native block within the cardiac field is averaged once, then encoded. Its physical origin is shifted by half a native voxel in each source axis so the displayed voxel centers remain at the source block centers. The overview and native-reference voxel-support fields are identical.
- **Native detail/reference:** source sample positions are preserved exactly; only the fixed crop and intensity encoding change.

The manifest records the crop, native dimensions, original coordinate system, physical origin, directions, and retained physical support bounds. Crops were reviewed on orthogonal planes and multiple phases. This is a visual field-of-view review, not expert anatomical validation.

## Intensity encoding and its measured limits

Each value is encoded with the same fixed transfer for every phase:

```
byte = round(clamp((source + 200) / 1200, 0, 1) * 255)
```

The source window is **−200 to 1000 stored units**, represented by 256 levels. The interval between levels is 4.705882 source units. Within that window, rounding changes a value by at most **2.353 source units**. The gzip wrapper then preserves those encoded bytes exactly. Display brightness/gamma is separate and does not alter the assets.

| Series | Below-window values | Above-window values | Maximum measured within-window error |
| --- | ---: | ---: | ---: |
| Overview, all listed phases | 34.7501% | 0.4634% | 2.353 units |
| Native detail, all listed phases | 18.7868% | 2.6614% | 2.353 units |
| Native cardiac reference | 34.9658% | 0.5044% | 2.353 units |

Clipped fractions include the entire rectangular field, including background and neighboring tissues. They are not percentages of myocardial detail lost. The native detail region includes very bright repaired-vessel/metal-related structure, so its high-end clipping fraction is larger. The original signed-short file should be used to investigate values outside the display window. Within-window error statistics exclude clipped values and do not demonstrate diagnostic equivalence. Overview error is measured relative to the source block mean, not relative to every native source voxel.

Original acquisition noise and metal-related artifacts are retained. The pilot adds no generated wall texture and makes no claim that thresholded intensity surfaces are chamber or vessel segmentation.

## Phase and playback semantics

Source indices 0–20 are all represented. Index 20 points to the same asset as index 0 and carries `duplicatesFrameIndex: 0`. A complete comparison of both original 512 × 391 × 218 volumes confirms that identity. Dynamic series set `playbackFrameCount: 20`, so ordinary looping avoids holding the duplicated closing frame twice.

No heart rate, cycle duration, phase milliseconds, or ECG percentage is invented. The playback rate is a display choice. There is no temporal interpolation, motion synthesis, or matching to the independent cMAC data.

## Reproduce and verify

Run from the repository with Python, NumPy, and Pillow available. Download the original from the linked upstream release and place the upstream `LICENSE` text in the working directory as `SlicerHeart-LICENSE.txt`.

```bash
python scripts/prepare-slicerheart-v19.py \
  --source /path/to/TruncalValve_4DCT.seq.nrrd \
  --work /path/to/slicerheart-work \
  --review \
  --output public/assets/clinical-v19/slicerheart
```

The script verifies the official original checksum, validates the header geometry, decodes to a memory-mapped signed-short source, compares the full closing frame, applies the fixed crops, quantifies encoding error, checks every gzip round trip, and writes frame hashes plus metadata. The original 1.27 GB file and 1.83 GB raw working array are deliberately excluded from the website assets.

`validation.json` contains per-frame encoding measurements. `source-header.txt`, `source-geometry.json`, and `source-download.json` preserve provenance. The contact sheets show source-derived slices across multiple phases; magnification uses nearest-neighbor display and is not new image detail. `compression-candidates.json` records the initial bounded crop/precision comparison that motivated keeping 256 levels while using a separate overview and native-detail region.

The production-renderer EGL verification is stored separately under `docs/clinical-v19/verification`. It is a local offscreen shader check, not a browser interaction test or a performance measurement on the user's device.
