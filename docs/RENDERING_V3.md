# Display cleanup and rendering styles

## Reversible cleanup

The display-support mask is derived from the authentic N5 s4 uint16 volume. It keeps the largest **18-connected component above raw intensity 17490** (approximately 32% of the current display window), adds a three-voxel Manhattan safety margin, and applies a conservative one-voxel guard before resampling to the compact 238 × 238 × 265 grid. Its first and last voxel centers match the interactive volume's physical extent.

The mask retains **all 8,228,877 voxels in the main source component**. There are 4,757 other connected-component candidates at the core threshold; some close to the heart remain inside the safety margin. This number is not a claim that 4,757 whole objects were removed.

| Display threshold | Visible voxels excluded by the compact mask | Fraction of visible source voxels |
|---|---:|---:|
| 25% | 3,302,487 | 25.11% |
| 28% | 118,353 | 1.28% |
| 30% | 29,053 | 0.33% |
| 32% | 7,389 | 0.09% |

The mask is applied independently in both renderers, including the cut-face texture. It does not overwrite or smooth source intensities, close anatomical cavities, or reconstruct missing tissue. Disabling cleanup restores the original display-volume visibility. Attached debris and fragments close to tissue can remain. The original source dataset remains the reference for inspection or measurement.

`scripts/prepare_cleanup.py` reproduces the mask and its manifest. The 15,010,660-byte uint8 map compresses to 129,177 bytes. The manifest records its checksum, physical registration, and threshold-specific statistics.

## Color and lighting

The legacy palettes remain available. Three additional display styles are supported:

- **Porcelain (3):** warm ivory tissue with restrained cool shading and scan-intensity contrast on the cut face.
- **Tissue & space (4):** a darker background, stronger cut-face contrast, and dimmer recessed surfaces behind a cutting plane.
- **Anatomy (5):** a neutral base tinted by the separate approximate tissue-territory labels. Unclassified tissue stays neutral; selected-label highlighting dims other tissue without deleting it.

Stable Surface rendering uses an isotropic edge-averaged gradient for the new styles. This softens voxel-related normal banding in the lighting. The measured density, surface-intersection locations, silhouettes, and higher-resolution cut-face pixels do not change. Interactive frames retain the faster normal estimator. Both GPU and software renderers implement the same style equations and normal filter.

A previous GPU background-gamma inconsistency was also corrected: rays that miss the volume now receive the same background transfer as empty rays inside it, removing the faint rectangular scan-volume outline.

## Renderer interfaces

Both renderers accept:

```js
renderer.setCleanupData({data: Uint8Array, dimensions: [nx, ny, nz]});
renderer.setAnatomyData({data: Uint8Array, dimensions: [nx, ny, nz], palette});
renderer.set({cleanupEnabled: true, palette: 3, anatomyOpacity: 0.65, anatomySelected: 0});
```

Maps use X-fastest ZYX bytes and share normalized physical endpoints with the volume. Anatomy palettes accept normalized RGB entries or hex-color legend entries. Labels are sampled only at locations where the independently measured tissue is rendered; the label map is never displayed as filled chamber contents.

`renderer.inspectAt(x, y)` accepts a normalized canvas position and returns the first measured tissue hit in Surface mode, including detailed cut-face textures and the cleanup mask. The result includes normalized source coordinates, the label ID, and whether the hit is on the cut face. Non-Surface modes return `null` to avoid implying an exact depth for a composited image.

## Verification

- Vertex and fragment shaders compiled and linked in an EGL / OpenGL ES 3 context.
- The actual source volume, cleanup map, 158.8 µm cut texture, and six-region anatomy map rendered with **GL_NO_ERROR** for all three new styles in cutaway and whole-organ views.
- The software worker rendered all three styles and preserved the source-array checksum.
- A synthetic location test verified first-surface picking, exact cut-plane picking, label lookup, empty-pixel rejection, and cleanup exclusion.
- JavaScript syntax checks, Python compilation of the preparation script, and whitespace/diff checks passed.

The hardware-accelerated browser path still depends on the user's WebGL 2 implementation. Native EGL rendering verifies shader behavior, not every browser/device combination.
