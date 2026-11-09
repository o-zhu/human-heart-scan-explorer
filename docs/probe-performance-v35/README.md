# Probe responsiveness, v35

The live probe path now samples a bounded preview immediately and refines the quiet pose after 190 ms. It does not request a new fine source plane for every movement. The default live output is 256–384 pixels wide, with a cap no larger than 448 pixels on either edge. Quiet output is 448–896 pixels wide, with a cap no larger than 1280 pixels. Both budgets follow the available pane width.

The resident live cap is sampled once from the current physical plane. CT and acoustic computation then reuse that same cap through the existing planar sampler, avoiding repeated random 3D reads. An already measured coplanar section can be reused immediately after checking plane identity and source-box coverage. A tilted or shifted plane uses the resident 3D volume. No old image is attached to new geometry.

Fine source voxels and prepared source images remain unchanged. A quiet reformat samples actual fine voxels at the display cap budget; an existing native prepared image remains usable without another download. A smaller display texture is produced in the image's original plane and axes. Source spacing and displayed cap spacing are reported separately, and a reduced live frame is labeled **Live Preview**. No lossy codec is added to the hot path.

## Measured computation

`benchmark.json` compares production computation with the v64 baseline commit `c3c55fe3b1320ab02a5e8edec5b87fcfd5cf5de0`. It verifies the compressed and decoded hashes of all three resident donor volumes and the pixel hashes of their prepared fine images. Each frame series has one warm-up and four timed samples; the reported sample median selects the upper middle observation. The fixture pane is 800 pixels wide, so the live grid is 352 × 286 pixels and the quiet grid is 800 × 650 pixels.

| Donor | Old resident preview | New live resident frame | Live cached fine section | Old/new resident ratio |
| --- | ---: | ---: | ---: | ---: |
| LADAF-2021-17 | 207.3 ms | 50.4 ms | 14.0 ms | 4.1× |
| S-20-29 | 143.2 ms | 36.7 ms | 11.5 ms | 3.9× |
| S-20-28 | 196.8 ms | 27.1 ms | 11.7 ms | 7.3× |

The live cap buffers contain 46–62 times fewer bytes than the former native fine cap buffers. This is a deliberate preview resolution reduction, followed by quiet refinement; it is not a claim of lossless equivalence between the live and native images. The new quiet fine frames took 66.8–71.5 ms of computation in this run. The report separates cap preparation and acoustic/CT computation for the new path.

For three nearby LADAF cuts with all source bricks already resident, fine extraction fell from **89.0 ms** at the native raster to **22.5 ms** at the screen cap raster. Both paths read the same 79.4 µm source voxels on the same physical planes. The screen raster is 1216 × 1093 at approximately 214.3 µm displayed sampling, versus the native 3281 × 2948 raster. No extra file reads occurred in these warm timing samples. Cold preparation, including local file reads and decompression, is recorded separately in the JSON.

These are **Node CPU and local-source measurements**, excluding browser paint, GPU upload/draw, actual network latency and macOS/Safari behavior. They are not browser frame-rate measurements.

## Scheduling and geometry verification

- `tests/probe-motion-v14.mjs`: 19 checks, including cold entry, sustained movement without fine downloads, quiet refinement, same-plane reuse and return, source cancellation, late result rejection, cleanup invalidation, cap source immutability, actual display spacing and shared cap/CT/acoustic sampling.
- `tests/probe-performance-v26.mjs`: 8 checks of prepared/source identity, coplanarity, source coverage, bounded caching and transport cancellation.
- `tests/probe-worker-v35.mjs`: runs the actual production acoustic worker in a Node worker. A 40-request burst publishes only the first and latest live frames; cancelled fine work cannot publish over the later live pose.
- `tests/tee-lab-v26.mjs`: 9 checks of retained TEE source planes, instrument mechanics, actual controls, accepted-pose consistency and production instrument rendering calls. Its overlay fixture now supplies the actual `drawGeometry` interface introduced before this change; the geometry assertions remain intact.

All 37 checks pass. These tests do not establish clinical registration or browser performance. The unchanged TTE/TEE anatomy and acquisition transforms remain governed by their existing validation suites.

## Reproduction

Run from the repository root with the local scan assets available:

```sh
node --expose-gc scripts/benchmark-probe-performance-v35.mjs
node tests/probe-motion-v14.mjs --dom={temporary-cache}/node_modules/linkedom/esm/index.js
node --test tests/probe-performance-v26.mjs tests/probe-worker-v35.mjs
node tests/tee-lab-v26.mjs --dom={temporary-cache}/node_modules/linkedom/esm/index.js
```

The benchmark requires Python/Pillow to decode the existing prepared images. The controller tests use LinkeDOM for deterministic events and canvas call fixtures, not browser automation.
