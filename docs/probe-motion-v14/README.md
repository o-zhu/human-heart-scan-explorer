# Probe detail and motion — v14

## What was causing the change in appearance

`ProbeLabModule.poseChanged()` previously aborted fine-plane work on every input
and requested only a coarse frame until 190 ms after movement stopped. That live
frame used a 360-pixel cap and a 420-pixel image, with 100 beams and 256 radial
samples. Settled fine frames used a native cap around 2,800–3,300 pixels wide,
a 1,100-pixel image and a different acoustic grid. Downloaded source bytes could
not prevent that intentional rendering downgrade.

The fine-volume worker also retained only 96 MiB of decoded bricks. An S-20-28
oblique plane needs about 227 MiB, so the old cache could not retain even one
complete plane. Repeated adjacent views decoded and validated the same source
bricks again. One timer yield per brick added more scheduling overhead.

All twelve initial donor/preset geometries match their prepared fine planes.
The source geometry correction for S donor entry points translates along the
existing plane and preserves that match. The separate entry audit is in
`../probe-entry-v14/`.

## Current behavior

- Fine data starts loading immediately when Probe Lab opens. Progress is visible
  beside the 3D heading, and source resolution describes the displayed frame.
- Input is coalesced into one active fine job plus the latest requested pose.
  Small continuous movements let the active job complete; major jumps cancel
  obsolete source requests. The cap, probe pose, measured CT and simulated image
  are committed as one matched snapshot.
- Moving and settled cut faces both request the donor's native fine spacing:
  79.4 µm for LADAF-2021-17/S-20-28 and 79.56 µm for S-20-29. Pointer movement no
  longer requests a smaller cap. Cached native planes are reused directly.
- A RAM- or disk-local reformat keeps the previous registered fine snapshot
  visible while it computes. A coarse volume preview remains available for
  genuinely uncached source data or an error. It cannot overwrite a finer frame
  for the same pose or move the display backward to an older pose.
- The ultrasound/CT image grid follows the visible pane size, between 640 and
  1,100 pixels wide. The same grid, beam count and radial spacing apply during
  movement and rest. The 800-pixel benchmark profile uses 242 beams and 0.18 mm
  target radial sampling. The native CT cut-face texture is independent of that
  screen-sized simulated ultrasound raster.
- Fine bricks are kept in a **lazy, bounded** cache: 128 MiB on reported devices
  below 4 GB, 256 MiB below 8 GB, and 384 MiB otherwise. No such buffer is
  allocated up front. A small slab around the completed plane is warmed from
  already stored data first. Optional one-at-a-time network warming starts only
  during quiet periods, yields to input/foreground loading, and stops on module
  exit. It does not download an entire volume at startup.
- Scanline/brick intersections avoid repeated bounds checks outside the brick;
  scan conversion reuses its polar map; fine image sampling transforms a ray
  only once; image buffers and canvas dimensions are reused. Source intensities
  and source cap bytes are unchanged.

The complete X/Y/Z image collection and arbitrary oblique fine-volume bricks
are separate cached datasets. Having all orthogonal images does not by itself
make every possible oblique plane resident in memory. The changes above remove
avoidable quality switches while retaining a usable first view for cold data.

## Measured verification

The reproducible script is `scripts/benchmark-probe-motion-v14.mjs`; complete
results are in `benchmark.json`. It compared source commit
`f34a66ee3cf969394f49f3004dc09a40a9366e78` with the v14 implementation using real
immutable source files. Runtime: Node v24.22.1, Linux x64, AMD EPYC 9V74.

These are **native CPU calculations and local-file reads**, not a browser/GPU
frame-rate measurement or a promise for the user's device.

### S-20-28 native oblique cap

The test uses a 2,835 × 2,751 native cap and an approximately 227 MiB decoded
working set. Encoded bricks are already available locally in both versions.

| Work | v13 time | v14 time | v13 source reads | v14 source reads |
|---|---:|---:|---:|---:|
| First local plane | 1,464 ms | 1,300 ms | 866 | 866 |
| Adjacent plane | 1,133 ms | 127 ms | 867 | 9 |
| Next adjacent plane | 1,108 ms | 139 ms | 867 | 9 |
| Repeat current plane | 1,167 ms | 104 ms | 867 | 0 |

The final 7,799,085 cap pixels are **byte-identical** to the baseline. No network
request occurred in this local-data benchmark. The first decode is still
substantial; subsequent local movement benefits from retaining its working set.

### Simulated image calculation

Median of three warmed calculations from each donor's exact prepared pixels:

| Donor | Previous settled 1,100-pixel image | Stable 800-pixel image |
|---|---:|---:|
| LADAF-2021-17 | 198 ms | 88 ms |
| S-20-29 | 195 ms | 67 ms |
| S-20-28 | 204 ms | 67 ms |

For a separate comparison at identical output/beam/radial grids, CT and
ultrasound pixels were byte-identical for all three donors. Movement and rest
also produce identical pixels from identical input under the new stable grid.
Each native cap is passed through unchanged and its prepared pixel checksum
matches its manifest.

### Focused regressions

- `tests/probe-motion-v14.mjs`: 12 production-module/source-cache fixtures cover
  immediate fine entry, cold-job completion during continuous input, newest-pose
  coalescing, preview timing, warm-local retention, stale coarse/fine rejection,
  same-pose quality ordering, preset/exit cancellation, native cap requests,
  idle-priority warming and deterministic acoustic output.
- `tests/fine-volume-v14.mjs`: 4 checks compare 192 aligned, reversed and random
  oblique planes with an independent scalar trilinear reference, verify local
  warming makes no network request, and enforce a constrained memory budget.
- Existing fine-worker/source-lifecycle and v13 shared-pose checks passed. A
  separate reviewer also reviewed the current cancellation and sampling paths.

No site browser interaction was performed. Ultrasound remains an educational
CT-derived appearance; the reference torso remains separate from donor anatomy.
