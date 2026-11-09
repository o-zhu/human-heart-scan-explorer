# Heart Explorer v27 · targeted cleanup, wall repair and Atlas cinematic

## Delivered source changes

This release continues the existing Heart Explorer site and retains its source
data, source meshes, native registration, defaults, Probe lab and TEE lab.
The active lumen display selection changes from the frozen v26 manifest to
`public/assets/cleanup-v27/lumen-manifest.json`. The detached-component flags
remain the original v26 files, pinned to the original Gentle mesh.

Five bounded source reviews cover the proximal aortic nodule, the free portions
of the lower atrial and upper pulmonary-vein sheets, the PA retrovalvular fringe,
and the tricuspid chordal fringe. The three specifically selected objects may
contain bright material. Their removal is a reversible visualization choice,
not a diagnosis. Surrounding dense source and attachment collars are retained.

Two source-supported atrial wall patches undo overreach in earlier exclusions.
The repair reveals existing original mesh surfaces; it does not create or move
geometry. The oval patch clears 21,809 prior mask samples and the larger
irregular patch clears 88,119, for a total of **109,928**. The previous lumen
object remains excluded.

| Mask | New display exclusion samples | Restored samples |
|---|---:|---:|
| Atrial | 405,104 | 109,928 |
| Arterial | 155,942 | 0 |
| Valve region | 199,700 | 0 |
| RV | 478,539 | 0 |

These counts describe logical mask samples, including empty-space allowances.
They are not measurements of removed tissue volume. The four compressed masks
total 1,422,864 bytes and decode to 78,812,600 packed bytes, inside the unchanged
128 MiB allocation limit. The final manifest SHA-256 is
`d97ac73a657df879fdfb8c88004cb63a429b568455b45b2dfceb2ae6258742f8`.

## Remaining material and review limits

The central PA jagged strip remains attached to nearby wall source. Six reviewed
points lie approximately 0.18–0.60 mm from anchored dense wall, within the current
mesh support allowance. Extending the exclusion through this strip risks
another wall defect. Separable fringe material is removed.

The retained tricuspid matrix and two small dense source islands connect to
continuing source foreground. An independent serial review found no narrowly
justified further exclusion. Fine attachment remnants and some roughness remain.
Material identity and anatomical completeness have not been established.

Source decisions, final production views and the broader survey are recorded in
`../cleanup-v27/README.md`. Both wall repairs and the PA review are documented in
`../cleanup-v27-wall/README.md`; the independent tricuspid review is in
`../cleanup-v27-review/README.md`.

## Optional appearance

**Color → Atlas cinematic** adds palette ID6 without changing IDs0–5 or the
default Tissue / space palette. Burgundy/brown surfaces, gold transitions and
ivory cut tissue are inspired by Figure6A of the supplied Human Organ Atlas
paper. The style uses measured resident display intensities and existing
lighting. It is not anatomical classification, cinematic path tracing, an exact
copy of an unpublished author preset, or a spatial-resolution upgrade.

Measured CT displays share the tint. Source pixels, source thresholds, mesh
geometry and simulated ultrasound intensities remain unchanged. Existing local
native 19.85 µm detail remains distinct from the 79.4 µm whole-heart surface.
The paper review, implementation and palette regression evidence are in
`../atlas-cinematic-v27/README.md`.

## Verification and publication

- Six actual-mask loader/controller tests pass, including source/hash rejection,
  late-fetch cancellation, atomic installation failure, picking correspondence
  and reversible cleanup without refetch.
- Twelve packed-mask and existing detached-component tests pass.
- Independent old/new logical bitset comparison passes. Every addition and
  restoration stays within declared reviewed footprints; both exact restoration
  hashes match and no other mask re-excludes a restored wall sample.
- The palette review compiles and renders the production GLSL. Twenty-one
  transfer profiles agree between JavaScript and GLSL within one channel value.
  Existing palette fixtures and returning from Atlas to the default remain
  byte-identical. Five focused palette/DOM and four existing TEE tests pass.
- Native offscreen rendering checks the full Gentle mesh with the final masks.
  These images verify production shader/geometry correspondence; they do not
  measure browser speed or establish anatomical validity.

The managed local preview route was unavailable. The live cloud browser can
exercise the controls and software fallback, but does not expose WebGL2, so it
cannot independently validate the fine mesh. The full fine model is checked
using the actual production shaders in native EGL instead. Hosted asset hash
readback and live control evidence are recorded separately after publication.

Use the existing hosted build and all four ordered asset staging steps. Do not
reopen any scan-bank upload gate. Exact saved version, commit, archive checksum,
public URL and deployment result belong in `publication.json` after success.

## Concurrent TEE atlas integration

The first source push was rejected because remote commit
`46964f9b019a12f1b5b78ca81f87026b449c8f1c` had added the TEE reference atlas from
the same baseline. The prepared v27 commit
`d0507e1ad616987f0c469ef1d031393aace460e0` was retained and the histories merged.
The sole content conflict was the Echo visual-style menu. The resolution retains
the incoming acquisition guidance and all atlas controls while adding palette6.
The integrated Echo retains the intended palette6 choice and its shared CT
threshold handling. A focused saved-view check also exposed an incoming atlas
navigation mismatch: restoring a transgastric target could leave the sidebar on
the midesophageal group. The bounded integration fix synchronizes the restored
group with the actual saved preset. App startup retains both crosslinks and
regional atlas frame loading, together with palette6 bookmark support.

The focused merged-state checks pass: six atlas data/geometry tests, the atlas
DOM lifecycle covering all28 views, five palette tests, and four existing TEE
application tests. Scientific masks, source assets, and production shaders are
unchanged by the integration, so the14-view fine-mesh evidence remains applicable.
The merged source was rebuilt and restaged before publication. Two subsequent
concurrent refinements were also retained: commit `ca46cd1` updates reference
image framing, diagram details and the outside-scan hint; commit `94dd5ef`
versions the media catalog URL so its changed framing reaches existing caches.
The final integrated commit is
`4bb0f5d70d2f407db55a4d9abe4ac5eec6b03042`. The actual atlas DOM and five palette
checks passed again after these merges, and a separate read-only review confirmed
all28 atlas views, the saved-group fix, palette6 and the catalog query.

## Published result

Site **version43** was deployed successfully at **2026-11-07 02:59:18 UTC**:

https://human-heart-scan-explorer.zhuou557737.chatgpt.site

`publication.json` records the exact saved version, pushed source commit and
deployment. The local compressed deployment archive is 244,267,167 bytes, with
252,957,972 file-content bytes before compression; both are within the platform
limit. The saved-version service records its own normalized tar hash separately.

All21 selected hosted files match their tested local SHA-256, including all four
v27 masks, the active manifest, production renderers, color modules and merged
Echo module. The immutable fine bank reports complete with uploads disabled;
an empty PUT is rejected with HTTP405. No upload gate was reopened.

The live browser selected **Atlas cinematic** and confirmed its pressed state,
warm rendered surface and shared CT tint. `live-atlas-browser.jpg` is the actual
hosted UI evidence. This cloud browser uses the software fallback and cannot
display the fine mesh; it is not the source of the fourteen fine-model images.

The integrated prepublication overlay checkpoint contains235 changed source and
evidence paths. Its archive and fresh restored files were verified, as recorded
in `integrated-prepublication-checkpoint.json`. It includes all three concurrent
TEE updates and preserves the external scientific-bank dependency declarations.

## Recovery status

The active source brick bank was restored read-only: all 5,127 objects and
805,012,353 bytes match their immutable index. No source acquisition was changed.
Source-overlay checkpoints verify archive readback and fresh file restoration,
with baseline commit `310ac98b35a1e4e909208fbf67acade939f47c38` and unchanged
scientific banks as explicit dependencies. They are not independent complete
raw-scan or native-bank backups.

The separate Box copy remains unconfirmed. Automatic approval review rejected
the earlier attempt to open the destination because it did not recognize the
older authorization. No alternate route or uploader was used to bypass that
decision. See `recovery-status.json` and the checkpoint receipts for exact scope.
