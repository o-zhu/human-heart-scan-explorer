# Reconstruction anatomy context

The main 3D Reconstruction workspace has an **Anatomy Context** toggle between
Reveal Coronaries and Measure. It reuses the fixed TEE esophagus, stomach and
diaphragm together with the fitted BodyParts3D ribs, sternum and thoracic spine.
It does not add a reference heart or skin surface.

## Interaction

- Enabling context frames the heart with the same anatomical camera used by
  Reference Views. The existing cutaway plane and retained half stay unchanged.
- Orbit, pan, zoom, measurements and section controls remain available.
- Disabling restores the camera and automatic-rotation state saved when context
  was enabled.
- Switching to Reference Views, TTE or TEE detaches the main context layer.
  Returning to Reconstruction retains its enabled preference and restored view.
- The compact menu closes after selection. The label stays stable while loading;
  its pressed state, loading indicator and keyboard focus remain accessible.
- Modules and the shared verified skeleton asset load only on first use. A
  cancelled or stale load cannot re-enable context. Failed loads offer retry.

## Geometry and rendering

The context uses the same donor-specific frames and physical scale as TEE for
LADAF-2021-17, S-20-29 and S-20-28. It is illustrative reference anatomy, was not
acquired with these hearts, and is not registered to the donors' original chest
positions. The clinical pilot sources do not receive a generic estimated frame.
Source voxels, cleanup, tissue labels, measured planes and sampling are unchanged.

WebGL context shares the accepted heart and cut-face depth pass. The software
renderer submits context immediately after accepting a worker image, using that
image's matching camera basis and per-pixel depth. Missing or malformed depth
suppresses context. Both paths keep the reference anatomy and its labels behind
accepted heart tissue, including cut faces, while leaving open rays available.
There is no independent animation loop or second volume texture.

The controller is `public/reconstruction-anatomy-context.js`; application
lifecycle hooks live in `public/app.js`. The software frame hook is in
`public/cpu-renderer.js`. Shared TEE geometry, transforms and assets retain their
existing provenance and licenses. Skeleton attribution is also available in
the main About dialog: [BodyParts3D / DBCLS, CC BY 4.0](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html).

## Focused checks

With an external LinkeDOM installation:

```sh
HEART_DOM_MODULE=/absolute/path/to/linkedom/esm/index.js node --test tests/reconstruction-anatomy-context.mjs
node tests/viewport-controls-v39.mjs /absolute/path/to/linkedom/esm/index.js
HEART_DOM_MODULE=/absolute/path/to/linkedom/esm/index.js node --test tests/tee-skeleton-v43.mjs tests/echo-context-presentation-v40.mjs tests/tee-context-fallback-v2.mjs
node tests/tee-depth-v4.mjs
```

The new controller tests use the real pinned anatomy and donor fitting. They
exercise cancellation, failed-transfer retry, camera restoration, unchanged
clipping, cached geometry, resolution changes, workspace ownership and accepted
software-frame depth. GL resource calls are mocked at the boundary; these checks
do not establish physical-device performance or clinical registration.
