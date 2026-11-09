# Renderer latency changes in v15

The accepted cut-face data and plane remain an atomic view state. The renderer
now waits until a frame can actually be drawn before sending the accepted native
pixels to WebGL. Several input events before that frame replace the pending cap;
they do not upload intermediate textures or synchronize with a busy prior frame.
`renderer.cap` is still updated synchronously for application state, while
`uploadCapData()` runs after the existing graphics fence. Forced snapshots upload
and draw the latest accepted cap before capture.

## Reusable image storage

Neighboring Ultra sections often have slightly different cropped dimensions.
Exact-size texture allocation therefore occurred repeatedly even when every
section was already downloaded. The renderer now retains one R8 cap texture,
growing its capacity in 256-pixel increments. Each frame uploads only the valid
native rectangle. A separate raster-size uniform maps that rectangle's original
texel centers into the allocation. It does not stretch the source image to the
storage capacity, change the physical crop frame, or sample unused padding.

The allocation-count fixture traverses every nonempty orthogonal crop listed in
all three published donor manifests, forward and backward, with a fresh renderer
for each donor/axis/direction:

| Measurement | Previous exact-size allocation | Reusable allocation |
| --- | ---: | ---: |
| Sections presented across all traversals | 6,758 | 6,758 |
| Allocation calls | 2,998 | 183 |
| Reduction in allocation calls | — | 93.9% |
| Retained R8 storage per traversal | Current section only | 1.56–3.00 MiB |

These are command counts from the actual renderer upload method. They are not
browser timings or an FPS claim. The allocation remains one texture per renderer;
it is not a GPU cache containing every section. Larger oblique caps can increase
that renderer's retained capacity beyond the orthogonal traversal range above.

## Verification

- Seven new renderer orchestration tests exercise rapid accepted slices, a busy
  graphics fence, cancellation of superseded uploads, crop-size changes, exact
  plane/data pairing, cleared and hidden views, and full-resolution snapshots.
- The seven existing renderer-motion checks pass. The full output drawing buffer,
  native cut-face pass, physical sampling interval, threshold, contrast, lighting,
  and cleanup provenance remain stable during interaction.
- Eighteen native EGL comparisons use the production shaders and source-verified
  cap/volume data from all three donors. They include complete single-pass and
  two-pass images, fine holes, deliberately cropped nonzero edges, bright stale
  pixels outside the valid crop, and views from the retained side of the plane.

Texture-coordinate rounding changes slightly when a non-power-of-two image uses
a larger allocation. The direct sampled density differed by at most **one display
byte**. Color differences affected at most **14 of 289,100 pixels** per frame
(0.0049%). In the S-20-29 uncropped view, **one** pixel very close to the threshold
changed between the cut face and the underlying cavity. Its color difference was
63/255 in the single pass and 93/255 in the composite pass; both comparisons show
the same isolated classification change. Other color differences were at most
4/255. All deliberate crop-edge comparisons preserved the opacity mask, and all
retained-side images were byte-identical. There was no observed spatial shift or
padding bleed. The full measured counts are in `cap-storage-validation.json`.

The existing hidden-surface raymarch was deliberately left unchanged. A naive
early return behind opaque cap samples can contaminate fine holes when the
low-resolution scene is interpolated; this optimization does not rely on that
shortcut. Browser and user-device performance have not been measured here.

Reproduce with:

```sh
node --test tests/renderer-latency-v15.mjs
node tests/cap-storage-counts-v15.mjs
python tests/cap-storage-v15-render.py
node scripts/verify-renderer-motion-v7.mjs
```
