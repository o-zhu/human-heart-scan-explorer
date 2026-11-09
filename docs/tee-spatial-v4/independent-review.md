# Independent review: TEE camera, depth and frame lifecycle

This review covers the TEE spatial changes. It separates controller checks,
native graphics fixtures, and source inspection from browser verification and
anatomical validation. The synthetic depth fixtures do not establish clinical
TEE correspondence, patient registration, acquired resolution, or performance.

## Orientation

`tests/tee-spatial-review-v4.mjs` exercises the actual Echo controller in a DOM
environment and the production camera basis/orbit/alignment calculations.
Graphics transport is stubbed; this is not a browser or GPU test.

All seven check groups passed:

1. A fresh preference defaults to ultrasound; unavailable storage is harmless.
2. Every one of the 28 ultrasound presets retains its measured plane and display
   orientation.
3. Upright alignment uses a fixed anatomical basis, target and fit across all
   28 presets. Physical CT planes, retained half-spaces and evidence do not change.
4. Preset and reviewed/previous-plane transitions preserve a manually explored
   upright camera. Explicit reset restores the fixed fit. Locked slice edits
   follow the selected alignment and retain the current zoom.
5. CT presentation and TTE/TEE round trips preserve the source plane and restore
   the selected TEE orientation.
6. Explicit “Face this plane” and “Probe & anatomy” actions select the orientation
   their behavior describes.
7. Shared state can specify upright orientation; legacy state without the new
   field restores ultrasound without silently overwriting the user's preference.

The fixed upright direction comes from the authored anatomical frame, not the
currently selected ultrasound plane. Some retained cut faces consequently point
away from this fixed camera. That is an expected consequence of preserving the
actual section and its retained side. Ultrasound alignment remains available for
face-on examination; no retained half-space is flipped to manufacture a view.

## Native production shader verification

`tests/tee-depth-native-v4.py` compiles the production volume, fine-surface,
cut-face composite, and shared-context shaders in native EGL/GLES3. The driver
was llvmpipe, LLVM 20.1.2. It renders controlled synthetic slabs, an open cavity,
a fine mesh ring and a fine-only cap island. The attached contact sheet shows
those fixtures, not a donor heart.

The final strengthened suite passed 10 checks with no GL error. Seven geometry
scenarios cover resident surface, resident cut face, exact fine cap, bounded
preview surface, bounded preview plus fine cap, fine mesh composition, and fine
mesh plus exact cap. Each checks all fixture tissue pixels whose maximum RGB
channel exceeds 22, including dark tissue and interpolated edges. No edge pixels
are excluded. Posterior translucent fill and a thin posterior contour leave the
source tissue pixels byte-identical, while anterior context remains visible.
Open-center fixtures reveal posterior context through the actual hole; cap
fixtures instead assert that the fine-only center island blocks it.

Two more checks compare source RGBA against baseline commit
`5ee02eb261e372b1e864a282434939d92ea6c391`, with and without clipping. The final
check verifies exact fine-mesh color preservation through the depth compositor.
The JSON report records shader hashes and the precise assertions; it uses named
center assertions instead of ambiguous false-valued “cavity passed” fields.

## Findings resolved during review

### Preview interpolation edges

The moving source color texture uses linear filtering. Sampling its depth with
only the nearest texel allowed a posterior context fragment to appear within
the interpolated tissue edge. A controlled 128-to-320-pixel surface fixture
showed 770 affected tissue pixels; the exact-cap composite showed 158. The
native fixture now uses the production color filter and tests the complete
footprint.

The corrected compositor takes the nearest depth among the same four source
texels that actually contribute to the enlarged color pixel. It preserves RGB,
keeps native-size depth exact, and lets the exact cut face write its own depth.
The strengthened fixtures pass without excluding a silhouette band.

### Framebuffer resize and context toggles

Depth storage must be resized before attachment completeness is checked. It
must also follow color resizing after the context layer has been switched off,
because the previously allocated depth attachment remains attached.

A native diagnostic confirmed why completeness alone is insufficient: a
320-square color target with a stale 128-square depth attachment reported
`FRAMEBUFFER_COMPLETE` but rendered only 16,384 of 102,400 pixels, even with depth
testing disabled. Existing depth attachments now follow color size regardless
of whether context is currently enabled. The focused lifecycle test covers
late activation, resizing, deactivation and another resize for both moving and
refinement targets.

## Rendering and lifecycle inspection

The volume first-hit depth, fine mesh depth and shared context use the same
0.01-to-10 perspective interval. Cut faces write the depth of their exact
measured plane. Native and local fine patches share the fine surface framebuffer.
Empty rays retain far depth, so actual openings remain openings.

The renderer submits context only after a newly presented source frame and its
cap. Partial refinement bands do not reach the visible canvas. Context and label
geometry have private VAOs; the source fullscreen triangle's VAO is restored
after the pass. Context does not clear or independently resize the heart canvas.
Translucent context tests depth without writing it; the opaque probe writes its
own depth. Shader-based labels and their leaders test depth as well.

The software path receives per-pixel hit depth alongside the accepted source
frame and checks both frame identity and camera basis before using it. Pending
or mismatched frames suppress the contextual drawing. Software surfaces,
contours and probe geometry use the accepted pixel depth; annotation anchors and
leaders are gated by it. If the optional shared GPU pass is unavailable, the
renderer suppresses the unsafe independent 2D anatomy fallback.

## Commands and limits

```sh
node tests/tee-spatial-review-v4.mjs {temporary-cache}/node_modules/linkedom/esm/index.js
python3 tests/tee-depth-native-v4.py
node --test tests/tee-depth-v4.mjs
node tests/tee-cpu-color-invariance-v4.mjs
```

The six-fixture CPU color comparison covers surface, accumulating volume and
maximum-intensity modes, each with the measured plane overlays off and on. It
compares the actual worker against the pinned baseline while requiring a real
depth channel in the new result. Its purpose is to catch accidental reuse of a
new depth-only hit distance in existing source-color logic.

## Final merge check

Verification was repeated after merging the TEE work with the v51 source update
at `f046704`. All of the following passed on that merged working tree:

| Check | Passed | Evidence scope |
| --- | ---: | --- |
| Independent Echo controller and camera review | 7 groups | All 28 presets, orientation persistence, physical plane invariance |
| Native production shader suite | 10 checks | Synthetic depth, preview interpolation edges, fine caps, color invariance |
| Actual CPU worker color comparison | 6 fixtures | Byte-identical source RGBA versus the pinned baseline in all three modes, with planes off/on |
| Focused depth and lifecycle suite | 6 tests | Target resize, VAO ownership, frame gating, software depth and actual worker hits |
| Fine-surface decoding suite | 3 tests | Real HFM1 inventories and invalid-transfer rejection |
| Compact fine-surface transport suite | 3 tests | Source identity, hidden-load cancellation, interrupted-block retry and installation gating |

The staged `fine-surface.js` changes relative to v51 are confined to the
render-target depth texture, attachment resizing, compositing argument and
disposal. The v29 compact controller, donor/threshold checks, fallback transport,
revision and workspace gates remain intact. `compactSurfaceEnabled` remains
`false`, as in the merged v51 source. Both transport routes still instantiate
the same fine-surface pass after decoding; no depth setup depends on the
download encoding. No unresolved source conflict was identified in this review.

The final v29 activation source, `dbf5eb23c879466be71397163f207ed9786cd379`,
was subsequently merged before packaging. It activates the verified compact
profiles, closes their upload code gate, and permits the v29 local asset paths.
The only shared-file overlap remains the depth target changes described above.
All 22 compact transport, local refinement, and immutable-store integration
tests passed on this final merged tree. The earlier seed-only configuration
described above is a review checkpoint, not the published configuration.

Browser interaction, final deployed rendering, and actual patient or donor
correspondence require their separate checks. The fixed esophagus, diaphragm,
stomach and probe estimates remain illustrative and unregistered. An estimated
probe outside the scan does not establish that the named structure was acquired.
