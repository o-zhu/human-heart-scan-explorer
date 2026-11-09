# Startup, compatibility and reconstruction layout — v45

## Scope and observed cause

A reported new-computer stall showed “Loading the finalized interior model” beneath a completed download bar. The prior controller automatically requested the full Ultra surface on desktop, then awaited reviewed masks and four prepared interior replacements without a finite timeout. The downloaded base mesh alone occupies 437,470,524 bytes before its GPU buffers, masks and interior surfaces. Completion of that download did not mean the final model was ready. A missing WebGL capability or a stalled dependency could leave a usable resident volume behind a persistent preparation notice.

This release changes the delivery path and resource handling. It does not modify source voxels, donor registration, source spacing, meshes, reviewed mask decisions, CT planes or ultrasound media.

## Startup behavior

The resident interactive volume still receives the first two paint opportunities before optional modules start. A new visit then requests the existing polished **Compact Detail** surface, with the four exact reviewed lumen masks. The lowest-memory/recovery tier requests the smaller balanced surface. Both are labeled as polished surfaces; they can reduce fine folds and thin structures. They are not relabeled as the complete Ultra model.

The complete **Ultra-High Fidelity** option remains available on eligible desktops. An explicitly saved desktop selection is honored within the device budget; a new automatic choice is not written over that preference. The reset control now restores the compact startup choice. Mobile retains its separate preference namespace. Bookmarked thresholds and user changes made while loading remain authoritative.

The desktop interior pipeline starts only when Ultra is requested. A fresh Ultra selection still waits for verified geometry, detached-debris labels, all eight reviewed mask fields, and all four interior replacements before activation. A compact-to-Ultra transition retains the working model while its replacement is prepared. Compact startup uses the existing sparse four-mask representation (10,948,608 retained CPU bytes), not the dense desktop interior pipeline.

### Geometry costs

These are exact manifest sizes, not total process memory or measured page-load timings. GPU copies, resident scan data, cleanup and frame buffers add costs.

| Surface | Download bytes | Decoded geometry bytes | Triangles |
| --- | ---: | ---: | ---: |
| Balanced compact | 4,406,836 | 8,562,920 | 497,714 |
| Compact Detail (normal new-visit default) | 17,722,926 | 34,679,172 | 1,986,313 |
| Complete Ultra base surface | 131,645,142 | 437,470,524 | 23,618,685 |

Compact Detail reduces the base geometry transfer by 86.5% and decoded base geometry by 92.1% relative to Ultra. These are different, existing display meshes; no new simplification was performed in this release. The source manifests are `public/assets/fine-surface-v19/manifest.json` and `public/assets/display-compact-v29/surface-manifest.json`.

## Bounded loading and recovery

- Scan metadata has a 30-second timeout, including its response body.
- Volume loading has a 60-second idle timeout and five-minute total budget. Its worker terminates on failure or cancellation, and foreground download priority is released. A retry starts a fresh request; stale worker messages cannot install data.
- Optional surface preparation has a 90-second idle timeout and ten-minute active-time budget. Selecting a lab pauses that budget along with preparation. Actual streamed bytes and completed verification/decode work refresh the idle timer; there is no synthetic timer heartbeat.
- The UI distinguishes downloading, verification, inflation, geometry validation, reviewed cavity cleanup, interior-region preparation and graphics allocation. Later stages use indeterminate progress instead of leaving the completed download bar at 100%.
- The current reconstruction remains usable during optional loading. Retry, Compact Detail and Interactive Volume provide recovery paths. Cancellation races every awaited preparation stage and aborts associated transfers and staged local resources, including a promise that ignores its signal.
- A progress observer belongs to its original request. Late bytes from a canceled request cannot keep a newer request alive.
- Missing gzip or SHA-256 capabilities and worker transfer errors fail explicitly. Every original byte-count, checksum, layout, index and source-identity check remains.

The time budgets are active-time safeguards, not estimates of how long every computer should take. An exceptionally slow complete Ultra preparation may need a retry or the smaller surface.

## Older-computer resource and graphics handling

Resource policy remains independent of viewport dimensions. Phones, desktop-identified iPads, reported memory at or below 4 GiB, and CPUs reporting at most four logical processors receive conservative budgets. The lowest-memory tier retains the balanced default. Browsers without a memory estimate start compact and use a 128 MiB fine-brick cache, one background transfer and a two-million-pixel output cap. Known eligible desktops keep the complete Ultra choice. Display pixel limits do not resample or alter measured CT data.

If WebGL initialization fails after claiming the canvas, the software renderer receives a fresh canvas with the same attributes. This avoids trying to acquire a 2D context from an already claimed WebGL canvas. The software path remains lower resolution and does not offer the GPU-only fine meshes.

Whole-volume and acceleration texture replacements are transactional. Allocation, size or GL upload failures release the staged textures and preserve the prior texture, data, grid and physical extent. A successful upgrade swaps textures only after both uploads pass, then releases the old GPU resources.

## Layout and TTE controls

The donor/detail pill now appears immediately below “The Human Heart”, followed by the subtitle. The eight existing flow controls form four paired rows in a narrower stack: RV, LV, RA and LA inflow/outflow. The same nodes and event handlers are retained when controls move into the compact menu.

TTE external sliding now follows the fixed illustrative chest: W toward the head, S toward the feet, and A/D laterally around the chest as seen from Front. Camera orbit or probe rotation does not reverse those directions. See `docs/probe-controls-v45/README.md` for all-donor checks and the unchanged rotation, tilt and fan conventions.

## Verification and limits

The focused checks exercise real donor/skin assets, exact mask and mesh bytes, stream transport, timeout clocks, cancellation, staged graphics failures and the actual application/DOM controllers. They verify that compact startup waits for reviewed cleanup, saved Ultra remains selectable, prepared interiors remain atomic, and failed graphics upgrades retain the working preview. Browser/layout observations are recorded separately with the release handoff.

Representative commands (install LinkeDOM externally and supply its ESM entry path where requested):

```bash
node --test tests/device-resources.mjs tests/mobile-resource-integration.mjs
node --test tests/loading-resilience-v45.mjs tests/loading-priority-v8.mjs
node --test tests/fine-surface-transport-v23.mjs tests/compact-surface-progress-v45.mjs
node --test tests/reviewed-mask-atlas-v32.mjs tests/mobile-lumen-v41.mjs
node tests/fine-surface-controller-v19.mjs /path/to/linkedom/esm/index.js
node tests/interior-refinement-status.mjs /path/to/linkedom/esm/index.js
node tests/app-boot-v8.mjs /path/to/linkedom/esm/index.js
node --test tests/probe-control-directions-v45.mjs tests/probe-skin-v44.mjs tests/probe-entry-v14.mjs
```

These checks do not establish load times or GPU behavior on a physical older PC, Safari device, iPhone or iPad. The full historical 32-part compact transport fixture was not available for a new end-to-end decode; bounded codec tests, real polished-surface assets, and the retained pinned full-geometry validations cover the changed transport logic. No clinical accuracy claim follows from responsiveness or control-direction tests.
