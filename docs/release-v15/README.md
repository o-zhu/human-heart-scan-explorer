# v15 — more responsive section browsing

This release reduces the work between a scroll event and an accepted 3D frame.
It keeps the public Site at its existing address and preserves the v14 native
Ultra face, stable brightness, donor-specific windows and exact plane/image
pairing. The source scan banks and downloaded-image cache keys are unchanged.

## Changes

1. **Ready 3D data takes priority.** The input and decode callbacks publish a
   ready exact cap before painting the CT cards. Repeated card updates are
   consolidated after a render opportunity and use the latest selected state.
   There is no added scroll debounce on ready 3D data. If a source image is not
   decoded yet, the previous sharp face remains at its own plane until the new
   image and plane can be accepted together.
2. **Downloaded neighbors are prepared earlier.** A byte-bounded runway decodes
   up to 12 sections ahead and 2 behind, including during scrolling. Two local
   preparation tasks can overlap while leaving capacity for the selected face;
   low-memory devices use one. Network transfer restrictions are separate, and
   the selected face can preempt lower-priority transfers. Local misses never
   start speculative downloads.
3. **Section-card painting does less work.** Packed color lookup values and
   exact cleanup/anatomy spans preserve every native pixel. Color tables,
   ImageData and bounded per-canvas RGBA backing buffers are reused.
4. **GPU work follows the frame that will be shown.** Rapidly superseded caps
   are not uploaded. The latest accepted pixels upload after the existing GPU
   fence, just before drawing. One R8 allocation grows as necessary and accepts
   different crop sizes without repeated reallocations. Original texel centers
   and physical crop geometry remain independent of storage capacity.
5. **Image decoding reuses its readback surface.** The backend retains at most
   one 16 MiB surface, leases independent surfaces for overlapping work, and
   releases oversized or disposed storage.

## Measured results

The native CPU painter benchmark uses real decoded Ultra images and the same
display settings before and after the change. All output RGBA bytes match.

| Section and style | v14 median | v15 median |
| --- | ---: | ---: |
| LADAF-2021-17 Y331, tissue/space | 8.88 ms | 1.79 ms |
| LADAF-2021-17 Y331, selected anatomy | 10.30 ms | 2.17 ms |
| S-20-29 Y255, tissue/space | 17.09 ms | 2.40 ms |
| S-20-28 Y282, tissue/space | 10.10 ms | 1.65 ms |

These warmed Node measurements exclude browser Canvas, decoding, network and GPU
work. Full methods and hashes are in `../section-paint-v15/`.

Across 6,758 forward/reverse section presentations from the actual manifests,
the renderer makes **183 allocation calls instead of 2,998**, a **93.9% reduction**.
This counts actual upload-method commands; it does not measure GPU elapsed time.
The orthogonal traversals retain 1.56–3.00 MiB of R8 storage per renderer. Larger
oblique caps can retain more. See `../renderer-latency-v15/`.

A deterministic scheduler fixture with a fixed 30 ms decode and 64 selections
at 16, 20 and 24 ms intervals found all 64 selected images already decoded in
v15, compared with 4, 5 and 7 in v14. This is scheduling evidence under a defined
workload, not browser performance. See `../ultra-runway-v15-benchmark.json`.

## Verification and limits

- 37 combined renderer, probe-motion, section-painting, brightness and windowing
  tests pass.
- 34 section-integration, loading-priority and local-runway tests pass, including
  restricted-network foreground preemption, stale arrivals, failures, rapid
  scrolling and memory limits.
- All 15 DOM boot/module/settings/fullscreen checks pass.
- All 19 existing prefetch checks and 7 existing renderer-motion checks pass.
- Exact painter checks cover 324 scalar full/cropped XYZ cases and 48 real
  before/after cases containing 376,796,352 identical RGBA channels.
- Encoded and decoded source hashes match for the largest crop of each donor.
- Eighteen native EGL comparisons cover actual production shaders, crop edges,
  fine holes, stale padding and retained-side occlusion.

GPU interpolation has a small documented numerical difference when non-power-of-
two source images occupy a larger texture allocation. Direct sampled density
differed by at most one display byte. At most 14 of 289,100 rendered pixels
changed color in a test frame; one near-threshold S-20-29 pixel changed between
the cut face and cavity. All deliberate crop-edge comparisons preserved their
opacity masks; retained-side outputs were byte-identical. No spatial shift or
padding bleed was observed. See the renderer validation report for exact values.

Browser FPS and user-device input latency were not measured. A cold or evicted
slice still needs decoding, and busy GPU work cannot be made instantaneous.
The CT rail can update one render/task opportunity after the prioritized 3D face.
The release preserves first-view priority, bounded caches and reusable existing
downloads rather than eagerly decoding an entire donor into memory.
