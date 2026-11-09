# Exact section painting with less CPU work

The downloaded Ultra sections still contain 1.6–2.5 million native display
pixels in the representative slices below. The previous section-card paint
path made a fresh 6.5–10.2 MB RGBA array, performed cleanup and anatomy lookups
for every pixel, and reset the canvas dimensions on every changed slice. This
CPU work could occur before the already-decoded section reached the 3D cap.

`public/section-paint.js` now caches a small display-color lookup table and
writes one packed RGBA word per pixel. The cleanup and anatomy volumes have a
coarser grid than the native CT images. Contiguous pixels with the same
projected mask/label coordinates share that lookup; repeated native rows reuse
the corresponding runs. Every native intensity still selects its own color.
The mask coordinates retain the previous rounding, including half-voxel
boundaries. No CT resampling, changed source spacing, image compression,
anatomy relabeling, or new color transfer is involved.

`AppearanceController.paintSection()` reuses its ImageData while the native
dimensions are unchanged, and avoids resetting a same-size canvas. When a
crop changes shape, it creates an exact-size ImageData view over a retained
backing buffer. Smaller crops reuse that storage; only growth beyond capacity
allocates replacement bytes. The high-water buffer is rounded up to 64 KiB,
so it retains less than 64 KiB beyond the largest encountered native crop.
Canvas dimensions remain exact, preserving crop geometry. Targets are held
by a WeakMap keyed by the canvas, and the color cache is limited to eight small
lookup tables. This does not create an unbounded collection of colored images.

## Native CPU benchmark

`benchmark.json` records the complete settings, source and output hashes,
timing samples, baseline commit, and execution environment. These are warmed
Node CPU measurements of painting, not browser frame rates or end-to-end input
latency. Image decoding, Canvas upload/scaling, WebGL, and network work are
excluded. Both versions use the same decoded real lossless WebP bytes and the
same donor-specific support masks and brightness settings. Anatomy is tested
only on LADAF-2021-17, which owns those labels.

| Native section | Pixels | v14 median | v15 median | CPU reduction factor |
|---|---:|---:|---:|---:|
| LADAF-2021-17, Y331, tissue/space | 1,626,885 | 8.88 ms | 1.79 ms | 4.96× |
| LADAF-2021-17, Y331, selected anatomy | 1,626,885 | 10.30 ms | 2.17 ms | 4.75× |
| S-20-29, Y255, tissue/space | 2,546,397 | 17.09 ms | 2.40 ms | 7.12× |
| S-20-28, Y282, tissue/space | 1,714,161 | 10.10 ms | 1.65 ms | 6.12× |

All four before/after outputs are byte-identical. Each version receives five
warm-up calls and eleven measured calls, with execution order alternated.
Source WebP hashes and decoded display-byte hashes must match their manifests
before the comparison runs. The benchmark can be reproduced in the source
checkout with Git history, Python/Pillow, Node, and the included scan banks:

```sh
node scripts/benchmark-section-paint-v15.mjs
```

## Regression checks

```sh
node --test tests/section-paint-v15.mjs tests/brightness-v12.mjs tests/windowing-v10.mjs
```

All 18 tests pass. The new tests compare 324 cases against an independent
scalar XYZ sampler: full and cropped images, X/Y/Z planes, differently sized
cleanup and anatomy grids, edge clamping, unknown labels, selected labels,
and enabled/disabled intensity windows. They also exercise lookup-table
invalidation after appearance changes, reused-buffer overwrite of masked
pixels, aligned output subarrays, read-only input bytes, alternating crop sizes
with appearance/mask changes, bounded backing-buffer growth, and the absence
of same-size canvas resets. The existing tests retain shared CT-window and
brightness agreement across Reconstruction, Echo, and Probe, including the
independence of the simulated ultrasound signal.
