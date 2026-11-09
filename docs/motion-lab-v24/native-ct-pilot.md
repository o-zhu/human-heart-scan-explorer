# Native-resolution cardiac CT pilot

Four acquired phases (0, 5, 10, 15) were reconstructed directly from the original SlicerHeart `TruncalValve_4DCT.seq.nrrd` voxel data. Each native surface is paired with a surface extracted from the same crop after 2×2×2 arithmetic voxel averaging. Both use the identical stored-intensity threshold, 232, which corresponds to 0.36 in the existing display window [−200, 1000].

All extracted triangles are retained. There is **no decimation, geometry smoothing, learned enhancement or temporal interpolation**. Point normals are computed for rendering. Float32 normalized positions add at most 0.00000443 mm of position-encoding error relative to the extracted VTK positions. This number describes encoding precision, not scanner resolution or anatomical accuracy.

## Sampling and phase conventions

| Property | Native | Reduced overview |
|---|---:|---:|
| Spacing X/Y/Z, mm | 0.599609375 / 0.599609375 / 0.7 | 1.19921875 / 1.19921875 / 1.4 |
| Crop dimensions X/Y/Z | 290 / 250 / 218 | 145 / 125 / 109 |
| Samples per phase | 15,805,000 | 1,975,625 |

The overview is evaluated **before the uint8 display quantization** used in the current browser volume. This isolates the effect of spatial reduction at an exactly matched intensity threshold; it is not a byte-for-byte reconstruction of the quantized preview. Mean voxels are positioned at block centers, preserving physical alignment with the native volume.

Original crop indices are X [60,350), Y [115,365), Z [0,218). Both meshes use the same physical crop center and normalization; world coordinates map `(RAS x, RAS z, −RAS y)`. The full original sequence has 21 indexed frames; phase 20 duplicates phase 0. This pilot retains four of the 20 unique phases. The NRRD supplies numeric indices, not physical timestamps or confirmed RR percentages. Four equally displayed steps should not be interpreted as a validated temporal model.

## Exact mesh counts and delivery sizes

| Acquired phase | Native triangles | Overview triangles | Native gzip bytes | Overview gzip bytes |
|---|---:|---:|---:|---:|
| 0 | 3,087,748 | 483,076 | 30,840,492 | 4,880,553 |
| 5 | 2,424,532 | 445,044 | 23,994,024 | 4,461,248 |
| 10 | 2,392,558 | 434,728 | 23,696,841 | 4,361,551 |
| 15 | 3,131,784 | 485,348 | 31,263,963 | 4,904,230 |

Total compressed mesh bytes: **128,402,902**. All eight files are below 32 MiB each. The largest decoded mesh is 66,461,468 bytes. Files use HFM1 float32 positions, signed-int16 point normals, uint32 triangle indices and deterministic gzip compression. Each manifest record pins compressed and decoded SHA256 hashes and byte counts.

## What changed visually and quantitatively

The native extraction retains more small branching structures and more high-frequency intensity variation. The phase-0 matched-camera rendering is in `native-ct-phase0-comparison.png`. It also shows substantial noisy and disconnected surfaces, which averaging suppresses. More triangles therefore do not establish better anatomical segmentation.

For each phase and direction, 6,000 points were sampled on the original unsimplified surfaces with probability proportional to triangle area, using recorded deterministic seeds. Their distances to the opposite triangulated surface were measured with `vtkStaticCellLocator`. These are sampled geometric differences between two intensity surfaces, not clinical errors and not Hausdorff bounds.

| Phase | Overview→native median, mm | Overview→native p95, mm | Native→overview median, mm | Native→overview p95, mm |
|---|---:|---:|---:|---:|
| 0 | 0.1243 | 0.4158 | 0.2246 | 2.8158 |
| 5 | 0.1121 | 0.3901 | 0.1777 | 1.3609 |
| 10 | 0.1160 | 0.4016 | 0.1728 | 1.3415 |
| 15 | 0.1283 | 0.4121 | 0.2311 | 2.6764 |

The directional asymmetry matters: small disconnected structures in the native surface can have no nearby overview counterpart. The larger native→overview tails include such structures and intensity noise, so they should not be presented as errors in a heart boundary. No manual reference segmentation or independent anatomical ground truth was used.

## Provenance and checks

The sample is described by the SlicerHeart registry as an adolescent with repaired truncus arteriosus; it is not a healthy reference subject. Original source: https://github.com/SlicerHeart/SlicerHeart/releases/download/TestingData/TruncalValve_4DCT.seq.nrrd

The original NRRD and the read-only phase-fastest raw array were hashed during this pilot:

- Original NRRD SHA256: `7573f1bc7ca92d7d1012eecf98211cfd9939c1d22d87aee1db91c8ab72031cfb`.
- Raw int16 SHA256: `25cd532d9692c9e5852ce421f3d3e98a40d190086e3e91f8fa8347ebf803ca68`.
- Raw shape Z/Y/X/T: `(218, 391, 512, 21)`; little-endian int16.

All eight final mesh files passed compressed hash, decoded hash, byte-count and vertex/index-count checks using the application's actual `public/native-mesh-format.js` parser. Index ranges, finite positions and the 32 MiB compressed hosting limit passed. The phase-0 scientific image was rendered with the repository's surfaceless EGL renderer using identical camera, scale, material and illumination for both surfaces; it was visually inspected.

## Reproduction

Run `python scripts/reconstruct-native-motion-v24.py` with the source data at the path configured in that script. It verifies both original-file checksums, then writes the meshes, manifest and metrics. Runtime for reconstruction, compression and geometric measurements was about 72 seconds on this workspace, excluding the separately performed original-file checksum pass. Software versions are recorded in `native-ct-metrics.json`.

Run `python scripts/render-native-motion-v24.py` for the scientific comparison image. Its camera metadata are saved alongside the rendered output in the analysis directory. The interactive browser comparison is a separate integration maintained by the main task.
