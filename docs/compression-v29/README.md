# Display compression v29

This change creates a separately versioned display derivative. The original source banks, source HFM, source scalar values, section grids and support masks remain available and unchanged. The Human Organ Atlas display values are windowed 8-bit intensities, not calibrated Hounsfield units.

## Selected methods

### Whole-heart surface

The frozen Gentle HFM contains 12,837,189 vertices and 23,618,685 triangles. Its original gzip transfer is 227,902,460 bytes and its decoded representation is 437,470,524 bytes. The new transport is **131,645,142 bytes, a 42.236% reduction**. It has 32 independently checked blocks; the largest download is 4,665,178 bytes. No mesh simplification or additional position quantization is used.

The codec applies three independent encodings:

1. The original unsigned 16-bit position bytes use per-component delta prediction and byte-plane shuffling, followed by gzip. Decoding restores the original bytes exactly.
2. The corrected shading normals use a two-coordinate, 12-bit octahedral representation. This is the only lossy part of the mesh transport. Against the supplied seam-corrected normals, the maximum measured angular error is **0.060037°**, and RMS error is **0.023035°** across the complete mesh. Zero vectors retain their original meaning.
3. Triangle indices use meshoptimizer's index codec. Because that codec can cyclically rotate triangle corners, a two-bit sidecar restores each triangle's exact original corner order. Vertex order, triangle order and every index byte are unchanged.

The seam correction and transport quantization have separate identities. The codec's angular error is measured against the corrected shading normals, not against the earlier normals that produced the stripes. The correction is described in `docs/surface-stripes-v29/`; compression does not move a vertex or alter a measured cut face.

The browser decoder hashes the final position and index ranges against **pinned original geometry hashes**, independently of what the downloaded manifest claims. Only then does the worker return `geometrySourceSha256` for the existing cleanup flags and local replacements. A separate decoded SHA identifies the normal-corrected, compact transport. This preserves the source-bound cleanup contracts without mislabelling modified normal bytes as the old HFM.

Final decoded HFM SHA-256:

`ef468a2ebf15f11cf57f8443e7d3555f8d53fc1a43b9582125bbbabe304d6ad8`

Original geometry source HFM SHA-256:

`175548ddaad01c409d59d561df6018c5cb0c90752b2ec771899c255065398dae`

### Cut faces and CT sections

Each image retains its exact source crop, dimensions, pixel centers, index and 79.4 µm sampling. A deterministic quantizer changes an odd display value to the preceding even value, except that 1 and 255 are retained. Consequently:

- Absolute intensity error is at most **1 out of 255**.
- Zero versus nonzero support is identical in both directions.
- Clipped-white pixels are identical in both directions.
- Classification at the surface extraction threshold of 72/255 is identical at the original pixel centers.
- No blur, resampling, sharpening, geometric repair or denoising is part of this codec.

Lossless WebP then stores that bounded derivative exactly. Therefore `codecLossless` is true while `compressionLossless` is false: the bitstream is lossless relative to the derivative, and the derivative has the stated one-level loss relative to the source. The original `sourceDisplaySha256` remains provenance; `decodedDisplaySha256` identifies the derived pixels. Custom thresholds at some odd display levels may classify a pixel differently, and the complete bank report records the exact counts for all 256 threshold levels. This is display compression, not a change to the underlying source scalar bank or to the mesh extraction threshold.

The seven screenshot-related source images total 4,956,612 bytes. The selected fast encoder produces 4,241,742 bytes, a **14.423% reduction**, with minimum Gaussian SSIM **0.999555** and maximum error exactly one level. Across the complete bank of **1,097 unique images**, transfer falls from **507,669,076 to 434,403,820 bytes**, a **14.432% reduction**. All **1,227,138,985 pixels** were checked: maximum error is one level, RMS error is 0.5142/255, PSNR is 53.908 dB, and zero-support, clipped-white and threshold-72 classification changes are all zero. Full counts and threshold comparisons are recorded in `section-build.json`.

## Alternatives measured

The comparison uses the actual seven source sections, not generic photographs. `section-pilot.json` contains every case and metric. The slower bounded WebP encoder saved 17.239%; the selected faster encoder saved 14.423% on the same images while producing the same quantized pixels. Encoding effort changes the bitstream size, not the selected derivative's pixel fidelity.

| Candidate on seven sections | Transfer reduction | Largest gray error | Worst SSIM | Threshold-72 pixel changes |
| --- | ---: | ---: | ---: | ---: |
| Stronger lossless WebP effort | 1.365% | 0 | 1.000000 | 0 |
| Bounded two-level spacing, slow WebP | 17.239% | 1 | 0.999555 | 0 |
| Bounded four-level spacing | 32.942% | 3 | 0.997713 | 0 |
| Ordinary lossy WebP, quality 100 | 17.989% | 4 | 0.998648 | 16,223 |
| Ordinary lossy WebP, quality 95 | 36.385% | 10 | 0.996550 | 35,366 |
| Ordinary lossy WebP, quality 90 | 48.781% | 15 | 0.991339 | 64,615 |
| AVIF, quality 95 | 25.004% | 6 | 0.998502 | 26,383 |
| AVIF, quality 90 | 38.812% | 9 | 0.996284 | 44,395 |
| AVIF, quality 85 | 49.884% | 15 | 0.991310 | 73,213 |

The ordinary lossy WebP and AVIF variants also changed zero-background pixels. They are not used. The aggressive bounded-four candidate preserves the chosen threshold but its three-level intensity loss was unnecessary for the requested high-fidelity result.

For mesh transport, `mesh-pilot.json` and `meshopt-pilot.json` compare ordinary gzip, shuffled bytes, delta predictors, direct normal quantization, octahedral quantization at several bit depths, exact normal residuals, meshoptimizer vertex encoding, triangle encoding and index-sequence encoding. Mesh simplification was deliberately not used because it would change the existing anatomical surfaces and invalidate masks tied to vertex order.

## Runtime behavior

`compact-surface-codec.js` reconstructs one final HFM buffer and releases each small transfer block after decoding. It does not retain a complete 131.6 MB packed copy beside the decoded mesh. It validates all advertised lengths, per-block gzip hashes, per-block payload hashes, final decoded hash, index bounds and pinned source geometry hashes. Block sizes are below 8 MiB, and each independent block is a cancellation and workspace-priority boundary.

The initial 144-block prototype was consolidated to 32 blocks to avoid excessive HTTP round trips while retaining bounded decode work. This also reduced transfer bytes slightly. The main thread remains on the existing usable reconstruction until a complete, verified replacement can be installed.

The worker pauses when another lab owns priority. It retries only an interrupted download; completed blocks remain decoded. A late result cannot activate after the user chooses a different surface. If the compact path fails, the controller can load the preserved original HFM using the existing v23 manifest without resetting newer view settings. The compact profile was activated after all 1,139 objects in the combined immutable collection passed live byte/hash readback. The original transport remains available as fallback.

Compression reduces transfer and temporary download memory. It does **not** reduce the 437.5 MB decoded HFM size, the triangle count, or final GPU buffer sizes. Slow devices still have the existing Interactive volume and earlier compact-surface choices. Timing reports in `mesh-decoder-check.json` measure this environment and are not a promise of a particular frame rate or load time on other hardware.

## Verification and reproducibility

The complete final mesh passes the actual JavaScript/WASM decoder, not only a Python round trip. Its final decoded hash and position/index byte identities agree with the encoder. The actual production worker also passes hidden-start cancellation, interrupted-block resume, lab-priority gating during completion, and source-identity impersonation rejection. Existing legacy transport checks remain compatible. Controller tests cover the original-HFM fallback, later setting preservation and cancellation while a fallback is paused.

Relevant commands, from the repository root:

```sh
python scripts/compression-v29/build_mesh.py \
  --normals {source-cache}/heart-v29-stripes/seam6-normals.npy \
  --shading-correction 'Seam-local area-weighted bilateral adjacency normal correction; raised-cosine half-width 0.6352 mm; no vertex motion'
python scripts/compression-v29/build_sections.py --wait-sources
node scripts/compression-v29/check_mesh.mjs
node --test tests/fine-surface-compact-v29.mjs tests/fine-surface-transport-v23.mjs
python scripts/compression-v29/prepare_collection.py
```

`scripts/compression-v29/requirements.txt` records encoder dependencies. This environment reused the already-cached meshoptimizer wheel (SHA-256 `082bc12fa9fe528927d4110d72e53322fcd1354f854c4b3591753706f7d6d53b`). An optional `HEART_MESHOPT_PYTHON_PATH` supplies an isolated encoder installation. The browser decoder is the official meshoptimizer 0.23 module (SHA-256 `73ad8244a874564c0685fab18c17b644cac3c5ac99c183bcb3f16302cdeee1e1`), with its MIT license included beside it. The complete generated bitstream was verified against that pinned decoder.

The preparation script writes only small public manifests and a flat upload index, with local payloads outside the static archive. The completed compression-only index contains **1,129 objects and 566,048,962 bytes** before the release owner's reviewed cleanup assets are added. The script performs no upload, opens no upload gate and activates no profile. The release owner combines its index with reviewed cleanup assets and seeds a new immutable collection. Existing immutable source collections are not rewritten.

## Primary technical references

- [Google's WebP encoder documentation](https://developers.google.com/speed/webp/docs/cwebp): distinguishes lossless bitstream storage, preprocessing, quality and compression effort. The chosen one-level preprocessing is explicitly specified here rather than relying on an opaque perceptual setting.
- [meshoptimizer documentation and implementation](https://github.com/zeux/meshoptimizer): geometry-specific index compression, quantization and WebAssembly decoding. This release uses index compression with an exact-corner sidecar and does not run the library's geometry simplification or vertex-reordering pipeline.
- [Pinned meshoptimizer 0.23 decoder](https://raw.githubusercontent.com/zeux/meshoptimizer/v0.23/js/meshopt_decoder.module.js) and [license](https://raw.githubusercontent.com/zeux/meshoptimizer/v0.23/LICENSE.md).

The numerical quality and size results in this document come from the checked-in local reports and generated assets, not from general codec benchmarks in those references.
