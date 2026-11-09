# Renderer responsiveness in v16

Two renderer behaviors could turn a short pause into a delayed next update. The
first scene and the old idle refinement rendered as one full 1.5–2.6 million
pixel raymarch. Subsequent input waited for that complete GPU job. Also, a browser
without `EXT_disjoint_timer_query_webgl2` retained its initial interaction budget
regardless of how long that work took.

## Bounded startup and interruptible refinement

Every new view, including the first, now begins with a bounded volume pass and a
full-output cut-face pass. The initial volume budget is 160,000 pixels. Measured
GPU timing can adjust it, and repeated unsignaled fence polls can reduce it even
when the timer extension is unavailable. The latter is a completion-latency lower
bound, not a GPU timer or a measured browser frame rate.

After 260 ms without another requested view, the renderer computes full detail
in horizontal bands, each covering at most 160,000 ray-marched pixels. Bands use
the full viewport and original pixel coordinates, source spacing, threshold,
lighting and shader. They render into one retained offscreen target. Only the
complete image is presented; no partly refreshed bands or checkerboard refinement
are shown. New input discards the remaining bands and requests the current view.
It waits for at most the one previously submitted small batch rather than an
entire full-detail frame. There is no queue of old view renders.

The offscreen target holds one RGBA image, approximately 6 MB at the default
1.5-million-pixel output cap or 10.4 MB at the high 2.6-million-pixel cap. It is
reused and does not retain a separate full image for every slice. A device unable
to allocate that optional target keeps its usable preview; explicit snapshots
still render full detail in one pass. Snapshot capture cancels obsolete idle
callbacks so they cannot subsequently overwrite the captured view.

Empty idle bands and full-detail snapshots have different costs from a moving
scene. Their timings are kept separate so they cannot inflate the next gesture's
work budget. Native cut-face output resolution stays constant through budget
changes; only the surrounding volume preview uses the bounded scene grid.

## Responsive resident-data cut faces

The composite shader can now shade the selected plane directly from the already
resident measured volume when an Ultra image is not ready. It uses the same
`capShade()` intensity/window/exposure transfer at every output pixel. This
avoids waiting for image decoding or making a CPU-side section just to move the
3D plane. Existing box intersection, retained-side occlusion and cleanup rules
still apply. The application is responsible for advancing the requested plane,
clearing any old image, labeling this as a volume preview, and replacing it only
with fine data for that exact plane.

Resident data has its own coarser source resolution. It is not Ultra, and its
image content need not be identical to the finer image. This change specifically
avoids an unrelated change to surface lighting, brightness transfer or output
canvas resolution during the temporary preview.

## Verification

- Eight new orchestration tests cover the first frame, full-output resident
  shading, bounded offscreen bands, no intermediate presentation, input
  interruption, timer-free budget reduction, separation of timing workloads,
  whole-organ coordinates, snapshots and optional-target failure.
- Seven existing cap-upload tests pass, including the busy-fence/latest-image
  behavior and exact plane/pixel pairing.
- Seven existing motion rendering checks pass. Their settled reference is now
  an explicit full-detail draw, because an ordinary request intentionally starts
  with the bounded responsive pass.
- Eighteen native EGL comparisons use production GLSL and source-verified data
  from all three donors. The completed banded images and final composition are
  **byte-identical** to the full single-pass reference. Surface, translucent and
  MIP modes retain their full pixel coordinates, including jittered sampling.
- All resident and prepared cap pixels in the moving full-output pass are
  **byte-identical** to their corresponding full single-pass cut-face pixels.
  Retained-side views show no cap overlay through the retained volume.

`native-render-check.json` records the tested cases and exact shader-source hash.
The resident-preview images show the real coarser measured source, without
claiming Ultra detail. These are native correctness checks and command-budget
checks; browser input latency and device FPS have not been measured.

Reproduce with:

```sh
node --test tests/renderer-responsiveness-v16.mjs tests/renderer-latency-v15.mjs
node scripts/verify-renderer-motion-v7.mjs
python3 tests/renderer-responsiveness-v16-native.py
```
