# Responsive volume, stable shading, and chamber flow views

This iteration updates the existing Human Heart · HiP-CT Explorer for LADAF-2021-17. It continues to render the measured scan directly. The source acquisition is 19.85 µm; the detailed interactive whole-organ display uses 317.6 µm voxels, with separate 79.4 µm cut-face images.

## Loading and compression

The default whole-organ download now contains the existing clean-scan support plus a three-voxel interpolation/normal-filter halo. Values outside that support are zeroed. The retained windowed 8-bit display values, voxel grid and spacing are unchanged. Three reversible encodings were measured: ordinary gzip, X-delta plus gzip and Z-delta plus gzip. Z-delta was smallest at both resolutions.

| Resource | Previous | New | Reduction |
|---|---:|---:|---:|
| Detailed 317.6 µm volume download | 41,426,965 B | 13,152,058 B | 68.25% |
| Fast preview volume download | 5,849,116 B | 1,931,449 B | 66.98% |
| Detailed scalar texture in GPU memory | 119,581,250 B | 47,846,624 B | 59.99% |

These are decimal byte counts for these resources, not total application traffic or memory. The full coordinate-grid array remains in CPU memory for section sampling and picking. Labels, cleanup support and cut-face textures have separate storage. A first default visit downloads the preview and detailed volume, approximately 15.1 MB combined, plus those smaller resources.

All retained bytes round-trip exactly. The cleaned display is not the native quantitative 16-bit acquisition. Switching Clean scan off restores the original uncleaned display volume on demand. The request state follows the latest resolution and cleanup choice; a failed replacement leaves the previous volume usable.

Fetching, decompression, delta reconstruction, cropping and CPU acceleration preparation run in a worker. Transferable buffers avoid copying the completed result back to the main thread. An interactive preview appears first; the detailed scan refines it in the background. Active camera positions survive that replacement in reconstruction, Echo and Chambers & valves.

The GPU uploads a cropped 296 × 322 × 502 texture with an explicit source offset. Camera, cap, picking and label calculations retain the original 475 × 475 × 530 source frame. Hardware normalized-coordinate filtering can produce isolated roundoff differences: the default Gentle mode differed by at most 3/255 in two tested 480 × 408 views, with one pixel above 2/255 per view. The uncropped compact volume and original cleaned volume rendered pixel-identically in both views for all three surface modes. See [renderer evidence](render-v5-validation.md) for the less favorable Source-mode threshold edge and full numerical results.

## Interaction and appearance

Tissue / space is the default material. Moving and still rendering now use the same material, ambient shading, normal reconstruction, physical ray spacing and intersection refinement. Motion only changes the output pixel count; full image resolution returns after interaction stops. A fixed-grid comparison is pixel-identical between moving and stationary flags.

The GPU keeps at most one ordinary frame in flight and adapts interactive pixel count from asynchronous GPU timers where available. The software renderer cancels superseded detailed frames and coalesces requests to the latest camera. Its conservative empty-space acceleration skips intervals proven below the relevant threshold without changing the sampling lattice. GPU skipping remains opt-in because software-GPU benchmarks showed no consistent improvement across views.

Orthogonal section painting now precomputes coordinate mappings and color tables. Nine actual-image comparisons match the prior RGBA output exactly. The new chamber preview caches its intensity, support and anatomical label grids; 44 comparisons across eight planes, both orientations, six materials and selection modes are byte-identical. The latter local Node benchmark reduced median recoloring from 127.1 ms to 2.75 ms; sampling a new preview grid took 18.4 ms median. These measurements describe local CPU kernels, not browser FPS or guaranteed device performance.

## Surface ridges

Surface finish has three reversible choices:

- **Source normals:** central finite differences.
- **Gentle:** continuous cubic B-spline derivative normals; the default.
- **Smooth:** a Gaussian derivative normal field with a 1.15-voxel scale.

The filters change the normals used for lighting. They do not move the isosurface, alter source intensities or soften the measured cut-face texture. Smooth reduces regular lighting bands, while some source/downsampling ridges remain. No section registration or extrapolated anatomy has been introduced without evidence of a registration defect. See [surface comparison](render-v5-surface-comparison.jpg) and [vessel close-up](render-v5-vessel-closeup.jpg).

## Segmentation experiment

The previous source-contour map was compared with three computed alternatives: an edge watershed, tissue geodesic propagation, and an anatomical/material hybrid. The first two retained incorrect arterial or outflow identities despite following local edges or connected tissue. The selected hybrid preserves the source-guided LV/tricuspid geometry, constrains arterial cores by measured material and location, adds a source-reviewed pulmonary hinge and RV outflow corridor, and propagates labels through permitted tissue paths.

In a targeted five-point aortic/RVOT check, the previous map matched one point; the selected hybrid matches all five. It preserves 12 separately selected source-image controls and 20 previous boundary checks. This is a diagnostic regression review, not a global accuracy score or expert validation. The data, parameters and comparisons are recorded under [anatomy documentation](anatomy/README.md).

The compact septum is colored with the LV myocardial body as an explicit display convention. The septum is shared anatomy. Valve attachment zones, collapsed atrial boundaries, small vessels, individual venous branches and shared fibrous tissue remain approximate or unclassified. No muscle-fiber tractography is claimed. The label grid and IDs are unchanged; the new encoded map is 316,865 bytes.

## Chambers & valves

Eight source-guided views cover RV, RA, LV and LA inflow and outflow. Each offers Explore angle, Close-up and Face section; the adjacent section aligns the 3D view and scrolls the cut. Users can refine offset, tilt, rotation, threshold and cut side.

Each unmodified preset has a real 79.4 µm oblique cut-face image. Individual images are 471–968 KB and all eight total 5.48 MB; the selected image loads on demand. Adjusted planes and original-support comparisons use the currently loaded volume and show their resolution explicitly. Restore fine plane returns to the prepared high-detail section. Review the [eight rendered views](flow-views-gpu-review-v5.jpg) and [source/provenance notes](flow-views-v5.md).

## Verification scope

The verification records cover exact decoded bytes, texture registration and hashes, coordinate transforms, state races, source-image recoloring, shader compilation, actual EGL images, and CPU worker cancellation. EGL uses a software driver, so it does not establish hardware-GPU frame rates. The preview browser rejected the local reload under its URL policy; interactive browser QA for this iteration remains unverified. This limit was not bypassed with an alternate browser surface.

Key records:

- [Compression](volume-compression-v5.json)
- [Actual loading worker](volume-loader-validation-v5.json)
- [Application state transitions](app-state-validation-v5.json)
- [Surface rendering](render-v5-validation.json)
- [Orthogonal section painting](section-paint-benchmark-v5.json)
- [Chamber geometry and textures](flow-views-validation-v5.json)
- [Chamber preview painting](flow-views-preview-validation-v5.json)

Technical basis: [NVIDIA GPU Gems 2, third-order filtering and derivative reconstruction](https://developer.nvidia.com/gpugems/gpugems2/part-iii-high-quality-rendering/chapter-20-fast-third-order-texture-filtering), and [MDN transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects). Original data: [Human Organ Atlas](https://human-organ-atlas.esrf.fr/datasets/1659197537), DOI 10.15151/ESRF-DC-1634390196, CC BY 4.0.
