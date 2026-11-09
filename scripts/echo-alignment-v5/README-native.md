# Native atlas alignment gallery

This harness renders every TTE and TEE atlas view at the two current Echo camera anchors. It does not initialize a browser, run a headless browser, build the Site, or publish anything.

## Reproduce

From the repository root, after all geometry changes are complete:

```sh
node scripts/echo-alignment-v5/export-review.mjs --out=/tmp/echo-alignment-v5 --width=640 --height=560
node scripts/echo-alignment-v5/sample-caps.mjs /tmp/echo-alignment-v5
python3 scripts/echo-alignment-v5/render_gallery.py --input=/tmp/echo-alignment-v5 --output=docs/echo-alignment-v5/native
```

Python needs NumPy and Pillow. The EGL ES 3 context uses the same native fixture as the existing renderer tests. In the managed runtime, the Python executable is `/opt/codex/runtimes/codex-primary-runtime/dependencies/python/bin/python`.

For a short smoke test, add `--ids=plax,me4c` and use a separate output directory. A source change after export makes rendering fail until the export is regenerated. `--allow-stale` is available only for explicitly labeled development smoke tests; the evidence records every stale file.

## v63 integration verification

The final gallery was regenerated after remote v63 commit `73e0af8b72d27a335e2bec00689916968845a5ac` was integrated at merge commit `f367c4997ffd74ebac1d4887255b6cf3ffa89e14`. The changed production fingerprint is `public/renderer.js`, whose orthogonal-section scheduling was updated.

All 112 native frames passed with zero GL errors. All 221 JPG/PNG outputs are byte-for-byte identical to the previously inspected gallery, all 56 plane/pose/camera records are unchanged, and those records exactly match the final primary-donor numerical audit. The exported production shader sources are also byte-identical. Current source fingerprints, the merge lineage and the comparison are retained in `docs/echo-alignment-v5/native/review.json` and `docs/echo-alignment-v5/v63-integration-rerender.json`.

This verifies preservation of Echo geometry and rendered pixels after integration. Browser scheduling and orthogonal-section interaction require their separate runtime tests. The regeneration used about 20 MB of temporary geometry/cap files in `/dev/shm`, with no raw source-volume duplicate written there; those temporary files were removed after verification.

## What is actual production data and code

- `audit.mjs` runs the actual Echo controller to obtain each accepted plane, acquisition pose, retained half, and cap/overlay handoff. The native gallery never uses the audit's small synthetic handoff token as pixels.
- `export-review.mjs` calls the actual `EchoModule.applyCameraAlignment()` and `VolumeRenderer` orientation methods for the **Anchor by Probe View** and **Anchor by Anatomy** cameras. It captures the actual `TteScene.draw()` and `TeeSceneOverlay.drawGeometry()` calls, including immutable anatomy mesh bytes, probe transforms, shaft meshes, draw order, material values and culling.
- The same exporter invokes the production TTE/TEE Canvas2D guide draw methods against a vector-command recorder. Thus the exported sector coordinates and styles come from the real overlay functions. Python replays those paths with antialiased native rasterization; it does not claim Canvas2D pixel identity. Sector guides retain their production unoccluded-overlay behavior.
- `sample-caps.mjs` verifies the resident volume's compressed and decoded hashes, then runs **`public/mpr-worker.js` itself** for all 49 acquired planes. It preserves the accepted center/basis/physical dimensions, interpolates the measured source, and records actual raster spacing. Seven outside-acquisition targets receive no fabricated CT section.
- `render_gallery.py` compiles the unmodified exported production volume shader and shared geometry shader. The clipped source heart, exact section cap, opaque instrument and translucent body share one `DEPTH_COMPONENT24` attachment and the production 0.01–10 perspective-depth mapping. The translucent context never writes depth.
- The current reviewed lumen masks are hash verified and sampled through the production atlas texture code. Baseline source-support cleanup is also enabled. Fine local replacement meshes and their matching exclusion fields are both absent from this resident-source review.

The capture files are written to scratch because the 8 MB mesh buffers and complete serialized controller state are regenerable inputs. The concise native images and evidence belong under `docs/echo-alignment-v5/native/` when a final review is produced.

## Scope and limits

The measured source is the **317.6 µm resident LADAF-2021-17 display volume**, not the 79.4 µm Ultra surface and not a 19.85 µm native region. Intensities are windowed uint8 display contrast, not calibrated Hounsfield units. The raster follows the exact accepted plane, but interpolation does not add acquired spatial resolution.

The body is a fixed BodyParts3D illustrative reference and the instruments/upper gastrointestinal tract are teaching geometry. Neither establishes patient registration, clinical echo correspondence, or full instrument safety. Native images verify spatial relationships, clipping and composition; they do not establish browser layout, interaction, performance or screenshots.

Each final run writes 112 single-camera images, 56 paired images, 49 raw measured CT raster PNGs, four complete contact sheets and a machine-readable receipt with source, shader, mesh-export and cap hashes. The receipt explicitly records omitted fine geometry, masks, rendering controls, driver, source spacing and any stale-source override.

## Source attribution

Measured CT: Brunet et al. / ESRF Human Organ Atlas, LADAF-2021-17, [DOI 10.15151/ESRF-DC-1634390196](https://doi.org/10.15151/ESRF-DC-1634390196), CC BY 4.0. The documented source-to-display window and mounting-container/support exclusions are retained.

Reference thorax: [BodyParts3D, © The Database Center for Life Science](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html), [CC BY 4.0](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html). Selected meshes were cropped, decimated, normal-recalculated and transformed for educational context; the reference heart is not displayed. Original illustrative instrument and upper gastrointestinal meshes come from the Heart Explorer source tree. The native render changes presentation only and does not add acquired anatomy.
