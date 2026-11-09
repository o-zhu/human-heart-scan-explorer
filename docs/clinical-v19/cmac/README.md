# cMAC volunteer 1 — measured MRI and 4D ultrasound pilot

This import uses the actual `v1.zip` case distributed by the Cardiac Atlas Project for the 2011 Cardiac Motion Analysis Challenge. The official collection describes 15 healthy volunteers and provides MRI and apical 4D ultrasound for each case. This is one same-volunteer comparison, with separate MRI and ultrasound acquisitions. No subject-specific age or sex has been inferred.

## Sources and attribution

- [Official challenge and download page](https://www.cardiacatlas.org/motion-tracking-2011-challenge/)
- [Official ground-truth README](https://www.cardiacatlas.org/wp-content/uploads/2024/03/readme.pdf)
- Tobon-Gomez et al., [*Benchmarking framework for myocardial tracking and deformation algorithms: An open access database*](https://doi.org/10.1016/j.media.2013.03.008), Medical Image Analysis 17(6), 632–648 (2013).

The challenge page states an open-access policy by attribution and requests citation of the paper. We retain that attribution. We do not infer a Creative Commons license. The live official page contains public download links; the obsolete `/files/MOTION-STACOM2011/v1.zip` path returns 404. Obtain the current link by opening the official page and selecting Case #1, rather than reconstructing an obsolete URL.

Downloaded archive integrity:

| Archive | Bytes | SHA-256 |
| --- | ---: | --- |
| `v1.zip` | 396,553,334 | `20043e37665c5d70fadddf4bbfd8a6368ddabf87ddffd9624d4dda100d833ade` |
| `cMac.zip` ground truth, inspected separately | 363,495,388 | `a97279bbf0025994a906c0f7fcd5f97d166484f2132539cbe008c0ec179e3dd1` |

Both ZIP archives passed CRC checks. The ground-truth archive was investigated for registration evidence; it is not included in the browser download.

## Browser data

| Series | Native stored grid | Native stored voxel spacing | Measured frames | Gzip bytes |
| --- | --- | --- | ---: | ---: |
| Whole-heart MRI, cardiac region | 205 × 245 × 95 after field-of-view crop | 0.75 × 0.75 × 1.5 mm | 1 | 3,707,588 |
| Apical 4D ultrasound | 208 × 224 × 208 | 0.658114 × 0.667832 × 0.580462 mm | 14 | 42,293,623 |
| Cine short-axis MRI | 256 × 256 × 14 | 1.25 × 1.25 × 8 mm | 30 | 13,547,360 |
| Total | | | 45 | 59,548,571 |

Spacing and frame counts above were read from the downloaded source headers, not assumed from a publication. Whole-heart MRI has a **3 mm source slice thickness** and a 1.5 mm slice interval; the latter is an overlapping stored grid and does not establish 1.5 mm acquired through-plane resolving power. Ultrasound grid spacing likewise does not equal the ultrasound system's resolving power. Cine SAX retains its original 8 mm slice separation.

### Cardiac field of view

The source whole-heart MRI is 400 × 400 × 95. The imported region uses native, zero-based index bounds `[75, 40, 0]` inclusive to `[280, 285, 95]` exclusive. This removes much of the upper chest and lower abdomen, retains all 95 left–right slices, and preserves the observed cardiac region and proximal great vessels with margins. It includes adjacent chest, lung, and some liver tissue. It is a rectangular crop, **not a heart segmentation**.

The crop was reviewed in native sagittal and axial planes; see `cardiac-crop-review.jpg`. The metadata stores the original spatial header, bounds, unchanged direction/spacing, and the updated physical origin computed from the source affine. `focusNormalizedXYZ` identifies an illustrative cardiac viewing center; it is not an anatomical landmark annotation.

### Intensity handling

Ultrasound VTK files already contain unsigned 8-bit data. Those samples are copied exactly and gzip-compressed. Every decoded ultrasound voxel equals the corresponding source VTK voxel.

MRI samples are first converted using each DICOM image's own rescale slope/intercept. They are then encoded as an **8-bit display derivative**, using one fixed linear window per series: 0–2250 arbitrary rescaled MR units for whole-heart MRI and 0–2600 for every cine SAX phase. The original native sampling positions remain intact; original MRI intensity precision is not retained in this compact display derivative.

There is no high-end clipping in the whole-heart MRI region. Cine high-end clipping varies by phase and is at most 0.0807% of stored voxels. Every encoded value and clipping fraction is reproducible from the script, and frame metadata records extrema and clipping fractions. Display window/gamma can be adjusted afterward, within the encoded signal range. Intensity threshold surfaces must not be described as segmented chambers or tissue classes.

No spatial resampling, denoising, temporal interpolation, or synthetic cardiac motion was performed. `native-planes.jpg` shows physical-aspect section views of the prepared arrays. The visible ultrasound differences and cine contraction are measured differences between source frames.

## Spatial coordinates and phase correspondence

MRI DICOM slices are sorted by the projection of ImagePositionPatient onto the normal formed from ImageOrientationPatient. The script verifies regular slice spacing and consistent orientation. Each manifest series retains native spacing, origin, direction, and a 4 × 4 index-to-physical affine. MRI coordinates are DICOM LPS. Ultrasound uses the organizer's VTK-local coordinate system. Native arrays are not silently rotated or mirrored; ultrasound's default display plane has an explicit vertical flip so its apical footprint appears at the top.

The viewer must treat MRI and ultrasound as **separate, unregistered acquisitions**. The official README describes a landmark-based similarity transform for the supplied LV meshes. We confirmed that corresponding reference-mesh vertices reproduce a similarity transform, but the whole-heart MRI has a different DICOM FrameOfReferenceUID from cine/tagged MRI. The supplied mesh mapping must not be applied to whole-heart MRI without further registration and validation. `registration-research.json` records that limited research result and its caveat; its small algebraic fit residual is not an anatomical registration accuracy measurement.

For volunteer 1, the official README identifies zero-based end-systolic indices **6 for ultrasound** and **10 for SSFP cine**. Final indices are 13 and 29. It also explicitly describes temporal misalignment across modalities. These are useful reference phases, not proof of frame-by-frame synchronization.

Ultrasound DICOM FrameTime is 47.2885 ms. Cine SAX combines 14 separately acquired slices per phase slot: their trigger times differ. The manifest preserves per-slice trigger times and their range; its `timeMs` is the median, not a simultaneous whole-volume timestamp. `phase` is only normalized sequence position. Whole-heart MRI is one gated static acquisition, with DICOM trigger time 740 ms; it does not animate.

## Format and loading

`public/assets/clinical-v19/cmac/manifest.json` is the integration contract. Each `.u8.gz` file expands to `X × Y × Z` unsigned bytes, with X varying fastest. Frame entries provide URL, compressed and decoded lengths, SHA-256 of both forms, and timing metadata. `sourceWindow` describes the source-to-byte mapping. `displayWindow` and `defaultThreshold` are display settings, not segmentation parameters validated against anatomy.

Load the current MRI frame and current ultrasound frame first, then prefetch neighboring measured phases with bounded concurrency. The initial whole-heart MRI plus ultrasound frame 0 is approximately 6.73 MB; downloading all sequences before enabling the interface is unnecessary. Cache bytes/decoded frames with an explicit memory bound. All three series combined occupy 167,972,399 bytes after decoding.

## Reproduction and validation

Dependencies: Python 3, NumPy, pydicom, VTK, and Pillow. Run from the repository root after extracting the official case archive:

```sh
python3 scripts/prepare-cmac-v19.py --source /path/to/extracted/v1
```

The script writes the manifest, 45 frame files, physical-aspect QA montage, source-file hashes, and a validation summary. `source-files.json` records SHA-256 and size for 530 used source files. Source headers are whitelisted; personal demographic fields are not copied into the public manifest. FrameOfReferenceUID values are stored as hashes to permit frame comparisons.

Validation performed: native array dimensions and spacing checks; DICOM orientation/slice ordering checks; exact gzip round-trip checks for every frame; exact source ultrasound sample retention; fixed-window MRI clipping statistics; independent inspection of representative native planes and the cardiac crop. Browser and production interaction testing are handled separately by the application integration work.
