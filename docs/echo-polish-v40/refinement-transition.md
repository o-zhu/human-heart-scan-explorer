# Retain completed interior refinements in Echo

## Reproduced defect

The shared application calls `FineSurfaceController.setWorkspaceActive(false)`
when it leaves Reconstruction. That correctly pauses preparation, but
`LocalSurfaceRefinementController.active()` also used the preparation priority
as a visibility condition. The base fine surface remained active while all
four completed local replacement regions stopped drawing. Their shader
exclusion masks and CPU picking exclusions also became inactive. Returning to
Reconstruction restored them without downloading anything.

The reproduction uses the actual compact-surface, local-surface and reviewed
mask manifests, and decodes and verifies all four original packed masks. It
calls the production workspace transition, fine-surface draw hooks, scene
uniform bindings and CPU exclusion method. WebGL submissions are recorded;
the 437 MB main mesh is not allocated and this is not a full rendered image.

| State | Base surface active | Regions retained | Replacement regions active | Shader ready / count | All four known excluded source samples |
|---|---|---|---|---|---|
| Before fix: Reconstruction | Yes | 4 | Yes | 1 / 4 | Excluded |
| Before fix: Echo | Yes | 4 | No | 0 / 0 | Not excluded |
| After fix: Reconstruction | Yes | 4 | Yes | 1 / 4 | Excluded |
| After fix: Echo | Yes | 4 | Yes | 1 / 4 | Excluded |
| After fix: return to Reconstruction | Yes | 4 | Yes | 1 / 4 | Excluded |

`refinement-transition-before.json` is the deliberately failing, pre-fix run
of the new regression. `refinement-transition.json` is the passing run of the
same test after the patch. Both capture runtime hashes, manifest hashes,
the four mask hashes and source sample coordinates, draw submission counts,
uniform state and status visibility. Both TTE and TEE workspace transitions
are represented by the application's same `setWorkspaceActive(false)` entry
point; the test does not run the separate Echo UI controller.

## Change

`active()` no longer requires the Reconstruction preparation workspace to be
active. It still requires completed geometry, a ready reviewed atlas, matching
source identity and extent, the Gentle surface, enabled cleanup and a compatible
base rendering mode. Source bytes, thresholds, mesh connectivity, shading
normals and masks are unchanged.

Preparation remains gated by `workspaceActive` in `ensure()`. Leaving
Reconstruction still aborts in-flight preparation, releases staged GPU objects,
and prevents queued transfers from starting. Completed geometry remains the
same retained object and requires no new transfer or upload.

`FineSurfaceController.syncRefinement()` now reports an already-active completed
model as ready in Echo. The unready overlay remains hidden. Incomplete work
still reports paused and resumes under the existing priority policy.

## Verification

- `tests/echo-refinement-transition-v40.mjs`: **5 / 5 pass** after first
  reproducing the geometry and status failures before the patch. Tests cover
  all four replacement draw submissions, actual-mask CPU exclusions, scene
  uniforms, source and display compatibility guards, incomplete-work abortion,
  staged-object disposal and pre-fetch cancellation.
- `tests/fine-surface-controller-v19.mjs`: **41 / 41 pass**, including atomic
  model installation, mobile resource policy, workspace pausing, transfer
  cancellation and stale worker results.
- `tests/local-refinement-v30.mjs`, real-asset and decoder cases: **2 / 2 pass**
  against the actual active routing module. All four production surface and
  mask assets retain their exact encoded/decoded hashes. See
  `refinement-v30-asset-gate.json`.
- `tests/local-refinement-v28.mjs`, real-asset and decoder cases: **2 / 2 pass**
  for the preserved historical assets. See `refinement-v28-asset-gate.json`.
- Historical `docs/local-refinement-v28/validation.json` and
  `docs/local-refinement-v30/validation.json` were restored byte-for-byte after
  running their report-writing suites.

The v28 and v30 historical lifecycle tests were changed only to expect
completed compatible geometry to remain active outside Reconstruction.
Their transport/staging cancellation assertions were preserved. Running their
completed-state case against today's controller stops before installation:
the v28 network fixture only handles its old v28 manifest URL, while today's
controller requests v30; the v30 fixture does not handle the v32 reviewed
atlas manifest. These are documented fixture limitations, not passing
integration claims. Their failing run receipts and exact routing diagnostics
are retained in `refinement-v28-legacy-lifecycle.json` and
`refinement-v30-legacy-lifecycle.json`. The new v40 regression covers the
current completed-state transition and reviewed-atlas field bindings.

To reproduce the current regression check:

```sh
HEART_REFINEMENT_EVIDENCE=docs/echo-polish-v40/refinement-transition.json node --test tests/echo-refinement-transition-v40.mjs
```

## Interpretation limits

This fixes a demonstrated display regression that exposed the earlier base
surface and disabled the accepted local cleanup in Echo. It does not establish
that every fine ridge, cavity or stippled appearance in a screenshot is a
rendering error. Source-derived texture remains intact. No new smoothing,
segmentation change, image-quality measurement, physical iPhone/iPad test or
full native GPU render is claimed by this check.
