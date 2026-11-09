# Heart Explorer: reviewed cleanup and native detail

## Delivered behavior

For LADAF-2021-17, **Gentle detail** is the fresh default. The first usable volume
stays visible while its 227.9 MB surface download is verified. Progress identifies
the currently displayed source and offers cancellation. An explicit surface
choice is remembered. Camera reset and Whole/Cutaway presets retain the selected
surface's fixed threshold rather than silently falling back to the volume.

Two independent cleanup controls are enabled by default:

- **Hide reviewed lumen material** excludes the reviewed atrial sheet, its bright
  core through Y section 310/475, and reviewed upper outflow material. It uses
  serial source-plane selections with anchored dense-wall guards.
- **Remove detached debris** excludes small compact disconnected components from
  the Gentle mesh throughout the heart, including cavity and exterior speckle.

Both controls are reversible. Original source arrays, original mesh payloads,
and the measured 2D CT cards are unchanged. These are reviewed display exclusions;
they do not establish whether the material is clot, preparation debris, tissue,
or a reconstruction artifact.

**Native detail in this view** also makes the existing 19.85 µm reconstruction
available inside the main viewer. Select visible tissue, load one local region,
and use **Focus loaded region**. Its camera, shading, depth and cut plane are
shared with Gentle. The surrounding heart remains at 79.4 µm. The independent
native inspector remains available.

## Cleanup method and scope

The original v23 atrial mask intentionally retained the long sheet and bright
core. The new user request explicitly includes those structures. The v25 source
review follows the selection over fine Y indices 820–1256 and protects dense
wall components anchored outside each reviewed envelope. Foreground selection
uses the same sigma-0.5 field and fixed threshold as Gentle, with a bounded
two-sample margin. Upper outflow selection also protects walls anchored in both
the sigma-0.5 and sigma-0.8 fields. Neither mask removes an entire chamber.

The global component filter analyzes connectivity in the complete, uncut Gentle
mesh. A candidate must be detached, compact, have a bounding-box diagonal no
larger than 0.85 mm, contain no more than 1,024 triangles, and meet the regularized
PCA shape criterion. The largest component, source-boundary components, and
rod/sheet-like structures are protected. Visibility flags are uniform across
every triangle; retained vertices, normals and indices are byte-identical.

| Component audit | Count |
| --- | ---: |
| Original Gentle triangles | 23,618,685 |
| Whole-mesh connected components | 1,406,359 |
| Excluded compact components | 1,342,006 |
| Excluded triangles | 5,739,103 (24.299%) |
| Retained triangles before spatial lumen masking | 17,879,582 |
| Largest component, retained in full | 15,863,437 triangles |
| Small anisotropic components protected by the shape guard | 48,463 |

Most excluded components are much smaller than the selected limit: 1,314,303
already fit within a 0.35 mm diagonal. Raising the limit to 1.2 mm would remove
only another 35,197 triangles while leaving attached roughness unaffected. The
more conservative 0.85 mm rule is retained.

Residual attached burrs and ambiguous thin structures remain. Removing them
automatically would require changing connected anatomy. Dark mitral cut-face
markings are not all evidence of debris; no blanket whitening or hole filling
was applied. Surface gradients, source intensity and isolated geometric debris
remain distinct. The component rule reduces scattered particles near the valve
while preserving long chordal and leaflet-like structures.

## Which reconstruction is displayed

| View or layer | Source and contribution |
| --- | --- |
| Main Gentle whole-heart surface | 79.4 µm display bank; 23.62 million original triangles; gently filtered and reduced |
| Resident interactive volume | Normally 317.6 µm, with a coarser startup preview |
| Ultra CT cards and cut-face textures | 79.4 µm source, independently loaded |
| Loaded local native surface | 19.85 µm processed native samples with coarse guidance; one approximately 2.54 mm region replaces Gentle locally |
| Standalone native inspector | Existing guided native bank, accessed region by region |

Before this change, the completed native bank supplied no geometry to Gentle in
the main viewer. It was used in the separate native inspector and motion study.
The new local option uses its original per-tile edge representation directly;
it does not substitute the simplified native overview.

The native plan completed 37,612 blocks, with 33,046 nonempty surface tiles and
12,168,077,800 encoded triangles. Its approximately 5.81 GB compressed bank is
streamed one selected tile at a time. The archived native processing uses TV
denoising and a coarse guide. Completion of that plan does not establish complete
anatomy, and the native surface is not an unprocessed scan. Exact coordinate
registration and processing limits are documented in
[NATIVE-MAIN-INTEGRATION.md](NATIVE-MAIN-INTEGRATION.md).

The native patch stages eight pieces before committing and has a 128 MiB combined
active/staging GPU geometry limit. Loading preserves the current camera and prior
complete surface. Show/hide, Clear, cancellation, stale responses and allocation
failure cannot install a partial region. The patch is suspended for original
detached-debris comparison. Its boundary can show a step or gap because the two
reconstructions use different processing; it is not a welded whole-heart mesh.
Selection uses the existing resident-volume intersection and can be approximate
relative to the visible fine surface.

## Verification and evidence

- 28 focused surface-controller tests cover the actual startup threshold,
  saved choices, bookmarks, cancellation, partial failures, progress and labels.
- Six lumen tests verify both real masks, source identity, exact restoration,
  stale requests, graphics failure and matching spatial-mask picking.
- Seven debris-loader checks reject incorrect source identity, corrupt or
  oversized streams, nonbinary labels and triangle-crossing classifications.
- The full mesh audit checks all 23,618,685 triangles and unchanged geometry
  hashes; an independent synthetic check covers rods, sheets, branches and edges.
- Production GLSL renders inspect atrial sections 289 and 310, outflow, aortic
  lumen, RV, mitral region and exterior. An additional closer RV view follows
  source section 282. Every tested off/on/off cycle restores the original image
  exactly, and source CT-cap bytes are unchanged.
- Actual native tile `35_30_36` is decoded and registered into an actual Gentle
  region. Whole and cut views restore exactly after disabling the patch and
  report no GL error. Native lifecycle and existing worker-integrity tests pass.

The automated browser available during this update lacks WebGL 2. It verifies
the usable CPU fallback and control state, not interactive fine-mesh performance.
The actual 3D comparisons use production shaders and verified source assets in
offscreen EGL. Neither test establishes biological identity or guarantees
performance on every device.

### Visual comparisons

- [Atrial section 289](render/atrial-section-289-comparison.jpg)
- [Atrial section 310](render/atrial-section-310-comparison.jpg)
- [Aortic lumen](render/aortic-lumen-comparison.jpg)
- [Outflow](render/outflow-comparison.jpg)
- [RV cavity, closer review](render/rv-focus/right-ventricle-comparison.jpg)
- [Mitral region](render/mitral-region-comparison.jpg)
- [Exterior](render/outer-surface-comparison.jpg)
- [Local native replacement](native-render/whole-comparison.jpg)

The masks, manifests, source-selection script, component classifier and tests
are versioned with the Site source. No original reconstruction bank or upload
gate is altered. The full component ledger is an optional reproducible supplement;
its location, size and checksum are recorded in `debris-audit.json`.
