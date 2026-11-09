# Heart renderer v5: behavior and validation

## What changed

Tissue / Space is the default palette in both rendering backends. Rotation, zoom and section movement now retain the same normals, ambient shading, palette, surface intersection refinement and physical sampling interval as a stationary view. Interaction reduces the number of rendered pixels only; a settled view refines to the selected output resolution. This removes the previous explicit switch in material and lighting during motion.

GPU drawing keeps one ordinary frame in flight and takes the latest camera state when it can draw again. Where available, nonblocking WebGL timer queries adapt the interactive pixel budget. The CPU worker yields during expensive rendering, cancels superseded refinements and coalesces pending requests. A small moving frame is allowed to finish so continuous input does not starve the display.

Conservative 8-interval macrocell maxima allow the CPU worker to skip ranges that cannot contain tissue at the selected threshold. Source sampling points and the surface-intersection bracket remain unchanged. GPU skipping is retained as an opt-in diagnostic (`settings.accelerationEnabled = true` with an acceleration map supplied). It is **off by default** because the available software-GPU measurements did not establish a consistent speedup. This avoids turning an uncertain optimization into a default regression.

## Surface smoothing

| Control | Method | What it changes |
| --- | --- | --- |
| Source | Central finite-difference normals | Original-style surface shading |
| Gentle, default | Analytic cubic B-spline derivatives | More continuous surface normals; 24 trilinear reads for the three derivatives |
| Smooth | Separable Gaussian derivative, sigma 1.15 voxels | Stronger suppression of high-frequency shading bands |

These options alter display normals only. They do not move the isosurface, blur cut-face images, modify source intensities, fill gaps, realign slices or generate missing anatomy. Residual acquisition and downsampling bands remain. A broad central-difference blend was also tried and rejected because it retained or emphasized regular ridges and reached the source-support guard at one pixel. The final Smooth method uses a bounded Gaussian derivative instead.

The comparison images use the same source volume, camera and cut-face texture:

- [Surface overview](render-v5-surface-comparison.jpg)
- [Vessel close-up](render-v5-vessel-closeup.jpg)

## Data and GPU memory

The detailed source grid remains 475 × 475 × 530. Its exact scalar-byte SHA-256 is `1b5b47b9a873ac4f423ffbf398ec1d3bcff75adc9ea066802deda03ffe193f29`.

The compact cleaned volume retains exact source bytes on the cleanup support and its three-voxel halo. The halo covers the normal-filter footprint; all three smoothing settings rendered pixel-identically to the immutable original volume with cleanup enabled in both tested views.

Only GPU texture storage is cropped. The detailed R8 upload is 296 × 322 × 502 at original-grid offset [107, 85, 12], including a one-voxel zero border. This reduces the main volume texture from 119,581,250 to 47,846,624 bytes, a 60.0% reduction. Other GPU textures and render buffers are additional memory. Source dimensions, endpoint coordinates, physical extent, labels and camera geometry remain unchanged. The device texture-size limit is checked against the actual upload dimensions, after validating the crop.

Cropping preserves retained voxel bytes but changes normalized texture-coordinate arithmetic on the GPU. In the default Gentle setting, the largest channel difference was 3/255 in either 480 × 408 comparison, with one pixel above 2/255 per view. The mean absolute channel differences were below 0.00031/255. Source mode had one larger isolated threshold-branch difference in the close-up (maximum 50/255; seven pixels above 2/255). Smooth had a close-up maximum of 8/255 with two pixels above 2/255. These are isolated numerical rendering differences; the crop must not be described as producing bit-identical rendered pixels.

## Checks completed

- JavaScript syntax checks for the changed renderer files.
- Actual shader compile and link through EGL.
- 100,000 sampled interpolation-bound checks, including macrocell boundaries, against the original source volume.
- Exact CPU pixel equality with skipping enabled versus disabled at a fixed grid.
- Exact CPU pixel equality for moving versus stationary rendering at a fixed grid.
- Confirmation that source bytes were not changed.
- Confirmation that a superseded large CPU refinement yields to a later interaction frame.
- Exact GPU pixel equality with skipping enabled versus disabled, and moving versus stationary, in two 480 × 408 views.
- Exact original-versus-compact pixel equality with cleanup enabled in both views and all three smoothing settings.
- Quantified full-texture-versus-cropped-texture differences as described above.

The shader harness used llvmpipe (LLVM 20.1.2, 256 bits), a software OpenGL driver on a shared host. Its timings are not browser frame rates or evidence of a hardware-GPU speedup. GPU skipping was faster in one wider cutaway trial and slower in the whole-organ and close-up trials, so it is not enabled by default. Actual browser interaction testing was unavailable for this verification run. Full measurements and assertions are recorded in [render-v5-validation.json](render-v5-validation.json).

## Interfaces and reproduction

`VolumeRenderer.load(data, meta, acceleration = null, gpuCrop = null)` retains the full source array and metadata. `gpuCrop` contains `{data, dimensions, offset}`. `buildAcceleration(data, dimensions)` is exported by `public/render-v5-acceleration.js` and should run in the decoding worker. CPU loading accepts the optional acceleration object; when absent it builds one in its worker. Runtime settings expose `surfaceSmoothing` as 0, 1 or 2.

`node scripts/render-v5-checks.mjs` runs the source-bound and CPU checks. `python scripts/render-v5-benchmark.py` and the same command with `--closeup` run the EGL comparisons. These scripts expect the preserved original fixture and comparison inputs under `{source-cache}/heart-render-v5`; those large intermediate inputs are not site assets. `python scripts/verify-shader.py` performs the standalone shader compile check.

## Primary technical references

- NVIDIA, [GPU Gems 2, Chapter 20: Fast Third-Order Texture Filtering](https://developer.nvidia.com/gpugems/gpugems2/part-iii-high-quality-rendering/chapter-20-fast-third-order-texture-filtering), for continuous cubic derivatives and hardware linear-filter grouping.
- Khronos, [EXT_disjoint_timer_query_webgl2](https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/), for asynchronous timing with disjoint-result rejection.
