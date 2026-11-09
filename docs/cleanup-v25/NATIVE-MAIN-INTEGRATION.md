# Native reconstruction in the main view

## What was used before this change

The main explorer's Gentle detail surface was reconstructed from the measured
79.4 µm display-density bank. Its 23,618,685 triangles were not drawn from the
19.85 µm native-region surface bank. The native bank was used by the separate
`whole-native.html` inspector (and the separate motion experiment). Opening a
main-view CT cut face also did not change the whole-heart mesh's source spacing.

The new main-view option uses that existing native work directly. It loads one
selected 128-cell native tile, about 2.54 mm across, and replaces the Gentle
surface **only inside that tile's source bounds**. The rest of the heart stays
on the Gentle 79.4 µm surface. CT card and cut-face source resolution is unchanged.
There is no claim that the whole active heart now has 19.85 µm geometry.

## Source and processing audit

| Property | Gentle whole-heart surface | Native selected region |
| --- | --- | --- |
| Source sampling | 79.4 µm s2 display bank | 19.85 µm original source samples, with coarse guidance |
| Full source coordinates | Actual s2 grid is 1903 × 1903 × 2120 | Original grid is 7614 × 7614 × 8480 |
| Main display endpoints | 1897 × 1897 × 2117 | Mapped into the main display's coordinate frame |
| Source encoding | Windowed uint8, source window 14640–23545 | Original big-endian uint16 intensity field |
| Processing | Gaussian σ0.5, threshold 0.28, constrained local QEM | Fixed 16-iteration TV, weight 800, raw-intensity threshold 17133.4; blend with the coarse prior |
| Representation | One welded, quantized HFM with packed normals | NBE1 sign mask and 5-bit edge crossings, decoded in eight 64-cell pieces |
| Display cleanup | Source-pinned detached-component flags and reviewed spatial masks | Existing compact native-island filter plus the same reviewed spatial masks |

The completed native plan has 37,612 processed blocks, including 33,046 nonempty
surface tiles. Those tiles encode 12,168,077,800 triangles in 5,810,515,698 compressed
bytes. Completion refers to the coarse-guided plan, not to validated complete
anatomy. Native contributions are full within the configured 8-native-voxel band
(158.8 µm) of the guide and fall to zero at 12 voxels (238.2 µm). Distant regions
use the coarse prior. Features absent from the guide outside the search band
can therefore remain absent. These are properties of the archived reconstruction;
this integration does not change or rerun its processing.

The native 5-bit crossing representation has a 0.31015625 µm quantization bound
relative to its processed field. That is not an acquisition-resolution or
anatomical-error bound. The integration does not use the native bank's simplified
whole-heart overview as the native region: it decodes the original per-tile NBE1
surface. Retained native positions are then registered to the main view, without
additional smoothing or triangle reduction.

Source evidence:

- `docs/fine-detail-v23/README.md`, `public/assets/fine-surface-v23/manifest.json`,
  and `scripts/fine-detail-v23/source.py` describe Gentle and its verified bank.
- `docs/guided-native-v21/README.md`, `pyramid-alignment.json`, and `denoising/`
  record native processing, source registration, counts and limits.
- `scripts/guided-native-v21/prior.py` implements the native-to-prior coordinates.
- `public/native-edge-format.js` implements the browser's stored-edge decoder.
- `public/native-noise-filter.js` implements compact-island filtering before the
  eight pieces are generated. Boundary components and rod/sheet guards remain.

## Registration: original source coordinates and display endpoints differ

`scripts/prepare_hosted_sections.py:prepare_display` reads
`source[z, y0:y1+1, x0:x1+1]` directly. The 1897 × 1897 × 2117 display is a truncation
of the far ends of the larger s2 source grid, not a spatial resize of that grid.
Its stored crop origin `[444,356,60]` locates the compact bank within those same
source indices. The origin is not an additional transform on global indices.

The native bank uses the documented center-resize pyramid registration. For
each acquisition axis `a`, define:

```text
ratio[a] = nativeDimensions[a] / originalS2Dimensions[a]
nativeIndex[a] = (s2Index[a] + 0.5) * ratio[a] - 0.5
s2Index[a] = (nativeIndex[a] + 0.5) / ratio[a] - 0.5
```

The main world position is then:

```text
world = [(s2X - 948), (s2Z - 1058), -(s2Y - 948)] / 2116
```

The original native decoder instead emits:

```text
nativeWorld = [(nativeX - 3806.5), (nativeZ - 4239.5),
               -(nativeY - 3806.5)] / 8479
```

Those two normalized frames must not be directly overlaid. For example, the
native source center `[3806.5,3806.5,4239.5]` corresponds to s2
`[951,951,1059.5]`, not to the main display center `[948,948,1058]`.
The corrected main-world offset is `[3,1.5,-3]/2116`, equivalent to 0.2382 mm
in X, 0.1191 mm in display-up, and −0.2382 mm in display-depth. The module inverts
the native decoder's original frame, applies the source-pyramid mapping, and
then applies the main endpoint frame. Normals receive the matching inverse
transpose scale and are renormalized to packed Int16.

This preserves the native bank's already established source registration. The
existing pyramid-alignment experiment fits an approximate Gaussian source
pyramid operator; it is evidence of registration consistency, not an independent
anatomical registration or a perfect model of acquisition processing.

## Runtime integration

`public/native-main-detail.js` owns the optional controller. No native payload
loads until the user selects a region. The existing hash-verifying
`NativeEdgeLoader` first loads the small immutable index, then only the selected
tile. The worker performs compact-island cleanup before decoding its eight
pieces. Each piece is uploaded and acknowledged before the next is transferred.
The combined active and staged native GPU geometry budget is 128 MiB, separate
from the existing Gentle whole-heart mesh and its render targets.

All eight pieces must finish and their retained triangle count must match before
the display switches. Until then the previous complete region, or Gentle alone,
remains visible. Failure, cancellation, stale requests, partial uploads and GPU
allocation failure dispose staged resources without installing partial geometry.
Show/hide retains the loaded region, while Clear releases it. A pending load
preserves the user's latest show/hide choice. Original detached-debris comparison
suspends the native replacement because its archived native compact-island
filter is already applied; re-enabling cleanup restores the retained region.

`FineSurfacePass` draws the patch with the **same program, framebuffer, depth
buffer, camera, material, lighting, clip plane and `lumenExcluded` function** as
Gentle. Base fragments inside the committed source box are discarded; native
fragments outside the same box are discarded. There is no coplanar full-surface
overlay. The native-pass uniform resets before and after rendering, and no
replacement box activates until a complete region is committed. The measured
cut-face composite remains the existing pass.

Loading does not move the camera. **Focus loaded region** explicitly pans to the
tile and moves the existing camera closer while preserving orientation and cut.
Selection uses the existing reference-volume/cut-face first hit. It is therefore
approximate relative to the Gentle triangle surface, especially around debris
removed only from that mesh. A nearest available tile is never substituted for a
missing exact tile. Focus lets the user verify the selected location.

## Remaining visual and scientific limits

Gentle and native have different filtering, thresholds and surface definitions.
Their transition is spatially disjoint but is **not welded**. Small boundary gaps,
steps or shading changes can remain; the UI says so. The eight pieces share the
native decoder's tile normals, but a neighboring native tile would still have
independently computed outer normals. This implementation retains only one tile.
It makes no watertightness or biological-accuracy claim.

Native detail still uses the main volume for environmental shading and the
79.4 µm reviewed masks for display exclusions. It is higher-resolution local
geometry, not a new segmentation, a replacement CT texture, or a method for
establishing whether a dark structure is clot, artifact or tissue. Source banks,
Motion Lab, original meshes, and all upload gates remain unchanged.

## Verification

`node tests/native-main-detail-v25.mjs` checks source-center and endpoint mapping,
inverse transforms, native position and normal conversion, tile bounds, atomic
eight-piece replacement, a combined active/staging budget, stale and incomplete
requests, failure retention, original comparison, late show/hide intent, camera
preservation on load, explicit focus and shader-state restoration.

Existing fine HFM decode/integrity tests and all nine native loader/worker tests
also pass. They include actual eight-piece acknowledged worker decoding,
compressed checksums, cache reuse, cleanup partitioning and corruption rejection.

`scripts/cleanup-v25/render_native_patch.py` uses one checksum-pinned production
tile (`35_30_36`) and the local triangle subset of the actual Gentle mesh with
production GLSL in EGL. `export_native_fixture.mjs` performs the actual browser
decoding, native filtering and registration. Its evidence and report are in
`native-render/`; it checks whole and cut views and exact off/on/off restoration.
This is an offscreen graphics check, not browser/device performance measurement.

The verified production tile has 367,839 original triangles and 357,643 retained
triangles in 7,723,588 bytes of eight decoded geometry pieces. The comparison
uses 149,808 nearby Gentle triangles. Native replacement changes 91,239 pixels
in the whole view and 8,327 in the cut view; both restore the original image
exactly after switching it off, with zero GL errors. The evidence makes the
bounded, unwelded transition visible rather than hiding it in a whole-organ view.
