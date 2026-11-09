# Architecture

Heart Explorer’s browser implementation is primarily plain ES modules. The optional Vinext/Cloudflare layer serves the main HTML document and immutable, manifest-indexed data. The Python development server offers the browser files and explicitly supported local data routes without that cloud layer.

## Main responsibilities

| Layer | Principal files | Responsibility |
| --- | --- | --- |
| Page and workspace lifecycle | `page.html`, `public/app.js`, `public/workbench-modules.js` | Shared settings, selected source, lazy workspace entry, cancellation, and source state. |
| Source catalog | `public/donors.js`, `public/clinical-sources.js`, `public/dataset-citations.js` | Separate identities, asset paths, spacing, metadata, and citations. |
| Measured data | `public/volume-loader*.js`, `public/ultra-volume*.js`, `public/ultra-sections.js` | Source loading, verification, bounded caches, and section requests. |
| Geometry and sampling | `public/planes.js`, `public/mpr*.js`, `public/probe-geometry.js`, `public/tee-geometry.js` | Source/world transforms, accepted imaging frames, measured sampling, and illustrative instrument kinematics. |
| Rendering | `public/renderer.js`, `public/fine-surface.js`, `public/cpu-renderer.js`, `public/mesh-draw.js` | Volume/surface display, cut faces, shared depth, batched mesh submission, and software fallback. |
| Prepared display cleanup | `public/lumen-cleanup-v23.js`, `public/local-surface-refinement.js`, `public/reviewed-mask-atlas.js`, `public/mobile-lumen-atlas.js` | Source-matched reversible exclusions and local replacements with checked memory bounds. |
| Echo and labs | `public/echo.js`, `public/probe-lab.js`, `public/tee-lab.js` | Reference views, steering, asynchronous acceptance of pose/image results, and linked visualization. |
| Reference context | `public/echo-anatomy-context-v2.js`, `public/echo-donor-calibration.js`, `public/echo-skeleton-fit.js` | Fixed donor-specific illustrative anatomy, independent of measured tissue data. |
| Data serving | `server/`, `worker/index.ts`, `scripts/serve-local.py` | Exact indexed objects, integrity metadata, and supported local routes. |

## One accepted frame

A requested probe movement is not yet a displayed result. The lab resolves a physical pose, requests its measured plane, and accepts the result only if it still belongs to the current source and pose revision. The instrument, sector, CT face, and simulated ultrasound then consume that accepted frame. Late work from a previous source or movement must not replace it.

Camera anchors and the Chest Orientation camera are presentation state. They do not define source sampling. Context anatomy remains fixed in its donor frame across views; it must not be fitted anew to a moving probe.

## Detail is layered

A source can have a resident display volume, separately prepared fine sections, fine-volume bricks for arbitrary reformats, a prepared whole-heart surface, and optional native patches. Each has its own geometry and integrity requirements. Resolution labels must describe the active source/grid, not just canvas size or a selected preference.

Prepared mesh installation is transactional. Required geometry, masks, and source checks complete before activation; failure retains the previous usable representation. Mobile and constrained devices choose a smaller prepared surface and bounded caches. A second rendering pane must not blindly duplicate a full scientific volume or its entire decoded mesh.

## Extending the project

For a new dataset, keep source selection, physical extent, metadata, caches, and clinical applicability independent. Add a loader/adapter and citation rather than changing another donor’s coordinates. For a new display derivative, add a new manifest and record its relationship to unchanged measured source values. For a new teaching view, distinguish the clinical target from evidence that the acquired specimen contains that target.

See [methods](methods.md) for scientific conventions and [deployment](deployment.md) for the serving contract.
