# TEE spatial depth composition

## Change

The atlas and TEE lab now draw their illustrative esophagus, stomach,
diaphragm, contour tubes and opaque probe in the heart's own WebGL context.
Every fragment uses the same camera and perspective depth interval as the
measured reconstruction. Tissue in front completely blocks rear geometry;
an actual opening remains open and context closer to the camera remains visible.
The independent scan fan and CT-plane boundary remain schematic teaching guides.

This replaces the earlier separate transparent canvas, which had no access to
the heart's depth buffer and therefore behaved as an x-ray overlay. No source
voxels, anatomical model vertices, reviewed CT planes, cleanup masks or probe
origin coordinates are changed by depth composition.

## Rendering contract

- Source raycasting writes its actual visible hit depth. Empty rays write the
  far depth. Its surface/cut-face color calculation remains unchanged.
- Fine mesh depth is retained in a depth texture instead of a renderbuffer.
  The same texture includes any active native-region and local source-surface
  replacements, with their existing clipping and cleanup behavior.
- The full-output composite carries scene depth and writes the exact measured
  cut-face depth wherever that cap contributes visible tissue.
- Moving-scene color is linearly enlarged. Its depth conservatively covers the
  same contributing source texels, preventing a rear outline from bleeding into
  the interpolated heart silhouette. Native-sized depth remains exact.
- The context layer draws only after a heart frame has been presented. Partial
  idle-refinement bands never reach it. The existing one-frame GPU fence still
  controls source and context work together.
- Shared geometry and callouts use private vertex-array objects. Depth, blend,
  culling and VAO state are restored after the pass. Turning context off and
  leaving a module removes its layer; attached depth storage still follows any
  later viewport resize, so an old attachment cannot clip the new framebuffer.
- Context labels and leader lines also depth-test in the shared pass. They use
  a small dynamically generated text atlas and add no static image dependency.
- A fully hidden posterior probe is not relocated in order to expose it. The
  persistent position caption and Probe & anatomy camera provide its spatial
  reference without changing its authored origin.

The normal reconstruction path does not allocate new scene depth textures until
the spatial layer is used. Existing textures remain bounded to the renderer's
motion/refinement targets. The fine mesh's depth texture replaces its previous
depth storage rather than adding a duplicate geometry pass or second mesh.

## Software fallback

The CPU raycaster returns a `Float32Array` of camera-space visible-hit depths
with its completed color image. The controller exposes that field only when its
frame ID and camera basis match the current request. Pending or stale depth
suppresses spatial geometry until the current heart frame is available.

The software context rasterizes actual authored triangles and contour segments
against that accepted per-pixel field. Probe shaft/head geometry uses the same
test. Empty rays use infinity, so true cavity openings are not replaced with an
opaque bounding-box mask. Context label anchors and leaders obey that depth;
readable label text remains a screen annotation. Software depth has the same
display sampling as the software heart, not the fine mesh's resolution.

If shared GPU context initialization fails, its 2D fallback is suppressed rather
than displaying an unoccluded anatomical outline. The heart remains usable.

## Verification

`tests/tee-depth-v4.mjs` passes six focused checks:

1. Shared perspective depth agrees with the production fine-mesh projection.
2. Lazy context activation and viewport resize allocate matching color/depth
   attachments, including disable-context → resize.
3. Scene lifecycle preserves the source VAO, clears on exit, and does not create
   a camera/overlay redraw loop.
4. Software triangles and thin contours are blocked by foreground heart pixels,
   while front geometry and actual cavity pixels remain visible.
5. Software depth is rejected for a stale frame or changed camera.
6. The actual production CPU worker supplies measured surface and exact cap
   depths, with open rays remaining unoccluded.

Existing renderer camera, latency and responsiveness suites pass 27 checks;
the actual fine-surface worker/asset suite passes three. Its VM fixture now
provides the standard `AbortController` already used by the existing worker.
The established context geometry/fallback suites pass 15 checks, and TEE app
lifecycle tests pass four.

The independent production-GLSL verification is
`tests/tee-depth-native-v4.py`, with its detailed report and images under
`native/`. It tests front/rear surfaces and thin contours, hollow rays, resident
and fine caps, enlarged previews, fine meshes and completed composites, without
excluding silhouette-edge pixels. The no-context heart color comparison is
byte-identical to the previous production shader. These are controlled rendering
fixtures, not anatomical or clinical validation or a browser frame-rate result.

Commands from the project root:

```sh
node --test tests/tee-depth-v4.mjs
node --test tests/renderer-camera-v17.mjs tests/renderer-latency-v15.mjs tests/renderer-responsiveness-v16.mjs tests/fine-surface-v19.mjs
python3 tests/tee-depth-native-v4.py
node tests/tee-app-v26.mjs /path/to/linkedom/esm/index.js
```
