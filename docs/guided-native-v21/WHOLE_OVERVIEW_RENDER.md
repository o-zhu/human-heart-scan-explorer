# Scientific exterior and cutaway of the completed overview

`render-whole-overview.py` produces an actual surface rendering from the
overview builder's verified HFM files. It does not reconstruct the heart, read
original intensities, download data, run a browser, or modify the viewer. The
figure is explicitly a **display LOD**: the processed field was sampled every
four native samples, at 79.4 µm, and its display mesh was simplified. The source
sampling remains 19.85 µm. No chamber names or other inferred anatomical labels
are added.

## Final command — run after overview construction finishes

From the matching source checkout:

```sh
python3 docs/guided-native-v21/render-whole-overview.py \
  --manifest {source-cache}/guided-native-v21/whole/overview/manifest.json \
  --output docs/guided-native-v21/whole-overview-render
```

The command exits if the completed overview manifest is absent; it does not wait
for or launch the builder. Do not run the full render concurrently with the
final overview build. Whole mode also requires the complete 37,612-block input
plan, the independently recorded whole processing fingerprint
`44a31c3adeb20e5a9a3d31f6868f9c92479920f533d2ea3c486e22b4aefa584a`,
and core-plan NPY SHA-256
`3be68c22b4f7a000b6e17b4c159f4d9a630b52884ea434624fc70c25999c6e94`.
A completed small alternate plan cannot receive the whole-heart figure title.

Outputs are:

- `whole-overview.png`: the annotated exterior and open cutaway, at 2004 × 1250
  pixels with default settings.
- `exterior.png` and `cutaway.png`: the two unannotated 960 × 960 scientific
  raster panels.
- `render-record.json`: source identity, input-manifest SHA, every compressed and
  decoded HFM hash, exact submitted triangle counts, camera and section-plane
  parameters, image hashes, physical scale, renderer/shader hashes, driver and
  measured memory evidence.

The default LOD is `overview`, targeting approximately 1.5 million triangles.
`--lod detail` selects the separate approximately 2.5-million-triangle display
when desired; the same 128 MiB combined decoded-asset limit applies. The
renderer accepts at most three million triangles. It draws every triangle from
the selected archived LOD, without additional simplification, smoothing,
component deletion or normal recomputation.

## Camera, section and physical scale

Both panels use one orthographic camera. Its default yaw/pitch, 0.48/0.28
radians, match the initial whole-overview viewer orientation. The renderer scans
the actual vertices in bounded chunks to measure their projected extents. It
then centers and fits the common camera with a 16% total framing margin.

The cutaway removes the front half of the measured view-depth range. It is an
oblique plane normal to the viewing direction; it is not a claimed anatomical
plane. `--cut-fraction 0.5` retains the rear 50% of that depth range. Other
fractions from 0.1 through 0.9 are allowed. The same shader discards fragments
beyond this plane, with no synthesized cap. Exterior and cutaway retain the
same camera, material, lighting and stored HFM normal data.

The HFM transform is:

```text
world = ((nativeX − 3806.5), (nativeZ − 4239.5), −(nativeY − 3806.5)) / 8479
```

One world unit therefore spans `8479 × 0.01985` millimetres. Scale bars use this
conversion and the exact common orthographic span. The X/Y/Z glyphs indicate
acquisition axes, without assigning patient left/right or chamber identities.
The record stores the cut-plane equation in both world and original native XYZ
coordinates, the chosen physical scale-bar length, and its pixel length.

## Data verification and bounded rendering

The renderer reads the overview builder's completed manifest and its
hash-matched input manifest. Each HFM gzip object must match its compressed
SHA-256 and byte count, then its decoded SHA-256 and byte count. Gzip expansion
is bounded; concatenated/trailing gzip data are rejected. HFM headers, array
offsets, vertex/index counts and index ranges are checked before rasterization.
Actual positions must be finite and lie within the declared full-source world
bounds. Relative paths cannot escape the manifest directory.

Decoded HFM data are written to temporary files and memory-mapped. Small
triangle batches are expanded into fixed reusable GPU position/normal buffers;
the renderer preserves triangle order and keeps one depth buffer for the entire
view. Mapped pages are released between batches. This avoids a resident
whole-mesh copy and works with multiple HFM parts. The original packed int16
normals are normalized by GLES exactly as in the viewer.

The renderer imports the existing surfaceless EGL helper and the actual vertex
and color-fragment shaders from `public/whole-native.js`. It records their
hashes. Using those shaders does not make this a browser screenshot or establish
browser interaction, mobile performance or FPS.

Rasterization and annotation composition run in sequential subprocesses. Each
subprocess polls its own actual peak RSS every 50 ms and exits if it reaches the
default 225 MiB limit. This uses `RUSAGE_SELF`, so launcher PID translation
cannot make the monitor observe the wrong process. The small orchestrator also
checks that its recorded peak plus the largest child peak stays below 250 MiB.
Threads are restricted to one for Mesa/OpenBLAS/OpenMP. A failed memory guard
does not claim a completed figure; a killed raster may leave only its bounded
temporary mmap files in that output directory.

## Actual pilot smoke evidence

Only the existing hosted eight-block pilot was rendered during preparation.
Its 30,000-triangle overview was displayed at the full output image dimensions.
The resulting figure was visually inspected. Its title explicitly says
**PILOT**, and its scale bar is 1 mm. This image is not a whole-heart result.

The raster process initially peaked at approximately 111 MiB; annotation
composition used approximately 35 MiB, separately from rasterization. The small
orchestrator used approximately 14 MiB. Exact final measurements and hashes are
in `whole-overview-render-smoke.json`.

One batch of 30,000 triangles and ten batches of 3,000 triangles produced
identical exterior and cutaway RGBA hashes and identical final PNG bytes. Both
views submitted every triangle. The tests also confirmed rejection of a pilot
without its explicit flag, rejection of the production output directory for a
pilot, rejection of a corrupted actual HFM object, and a real 64 MiB RSS-guard
termination. A separate read-only review checked the camera inversion, physical
scale, native/world plane equations, depth ordering and reusable GLES buffers.

The pilot can be reproduced without any network access:

```sh
python3 docs/guided-native-v21/render-whole-overview.py \
  --manifest {source-cache}/guided-native-v21/overview-hosted-pilot/manifest.json \
  --output {source-cache}/guided-native-v21/whole-render-pilot \
  --allow-pilot
```

The full overview has not been rendered by this preparation step. The final
whole-heart image will document gross display geometry once the builder has
completed; it will not establish anatomical accuracy or absence of structures
lost through denoising, prior guidance or display simplification.
