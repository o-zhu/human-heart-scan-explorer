# Firefox model drawing and TEE controls

## Firefox failure

The prepared base mesh contains 70,856,055 unsigned 32-bit indices
(23,618,685 triangles). It was submitted in one `drawElements` call. Firefox's
default `webgl.max-vert-ids-per-draw` is 30,000,000. Rejecting that call while
accepting the four much smaller local replacement draws leaves exactly the
disconnected crop-shaped pieces seen in the user report.

- Mozilla rationale and recommendation to split large draws:
  <https://bugzilla.mozilla.org/show_bug.cgi?id=1849433>
- Current preference definition:
  <https://searchfox.org/firefox-release/source/modules/libpref/init/StaticPrefList.yaml>

`public/mesh-draw.js` submits at most 3,000,000 indices in each call, on triangle
boundaries, with offsets into the same existing index buffer. The base uses
24 calls. Local and native refinement meshes use the same helper. No geometry,
normals, thresholds, masks, scientific source files, or cleanup membership change.

The complete offscreen model is checked for WebGL errors before it is
composited. The existing error path keeps the interactive volume available and
offers a detailed-model retry instead of presenting an incomplete model as
ready. WebGL reports draw errors through its error state rather than JavaScript
exceptions, so checking this state is necessary.

## Real-model graphics evidence

`node --test tests/mesh-draw-batching-v37.mjs` passes nine checks. Its strict GL
fixture enforces Firefox's limit, verifies exact index coverage and byte
offsets, and executes the production surface and renderer methods. Both base
and local-patch errors prevent compositing; the renderer presents the volume
fallback and reports the error. This complements, rather than substitutes for,
the following actual-model graphics check.

Run `tests/firefox-model-v37-native.py` with the primary Python runtime. It uses
the production shader, actual compact base geometry, four reviewed local
meshes, debris attributes, and the exact reviewed mask atlas. The submitted
base ranges come from the production JavaScript batching helper.

The test renders the rejected-base case, the corrected batching, and a second
independent batching with 300,000 indices per draw. Both complete renderings
are pixel-for-pixel identical. The rejected-base image differs at 170,365
pixels and visibly reproduces the disconnected fragments.

Evidence:

- `native/rejected-base-draw.png`
- `native/complete-batched-model.png`
- `native/verification.json` (hashes, draw counts, renderer and comparisons)

This is a native EGL/GLES software-driver rendering and deterministic
Firefox-limit regression, not a direct Firefox browser run. The managed browser
backend could not start in this session. Firefox on the user's machine and its
particular GPU/driver remain an explicit verification limit.

## Existing regression coverage

Current real-asset loading, complete atomic activation, reviewed mask delivery,
controller fallback/retry, native detail and picking regressions pass. The
historical `tests/local-refinement-v30.mjs` fixture still lacks the newer v32
atlas fetch and also fails against the unchanged starting commit; its fixture
failure is not used as a rendering result. Current v32 tests exercise the real
asset pipeline instead.

## TEE keyboard console

The visible keycaps form two hand positions above the retained sliders. Every
keycap is also a holdable pointer/touch control, and its action is repeated
beside the corresponding slider. The redundant TEE title and numerical quick
buttons are removed. The workspace keeps an accessible region name.

| Keys | Action |
| --- | --- |
| W / S | Advance / withdraw |
| A / D | Turn left / right |
| Q / E | Decrease / increase electronic multiplane angle |
| I / K | Anteflex / retroflex |
| J / L | Flex left / right |
| Arrow keys | Alternative tip-flexion controls |
| Shift | Fine movement at 22% of normal speed |
| Escape | Stop held input |

A tap immediately nudges insertion by 0.1 model cm or an angle by 1 degree;
holding continues movement independently of the operating system's key-repeat
delay. Fine mode also scales the tap. Independent axes combine; opposing keys
cancel. Keyboard controls require focus inside TEE and never consume text or
range editing, Ctrl/Meta/Alt shortcuts, or IME composition. Focus changes, blur,
hidden documents, lock, reset, Escape and leaving TEE release held inputs.

Verification:

```sh
node tests/tee-keyboard-controls.mjs --dom={temporary-cache}/node_modules/linkedom/esm/index.js
node tests/tee-lab-v26.mjs --dom={temporary-cache}/node_modules/linkedom/esm/index.js
node tests/workspace-layout-v35.mjs {temporary-cache}/node_modules/linkedom/esm/index.js
```

These pass 10, 9 and 7 checks respectively. The new suite executes actual DOM
listeners, tap/hold behavior, modifiers, simultaneous keys, editable focus,
pointer capture/cancellation, touch combinations, accessible clicks, state
bounds and long-frame handling. LinkeDOM is a DOM/controller test environment;
these checks do not establish browser layout or device-level interaction.

## Probe shaft correction

The previous illustration followed the curved tract to `insertion - 2 cm`, then
added a separate point calculated by subtracting a straight 20 mm tangent from
the current base. Those positions did not coincide on a curved tract, creating
the visible jog. The shaft also ended at the acoustic face rather than the
rear attachment of the drawn head.

The final illustrative segment now joins the tract and rear neck with aligned
tangents, ending at the production head's original local `[0, 11, 6]` attachment
at 0.60 scale. Transported tube cross-sections avoid world-axis seam flips.
The mathematical acoustic origin, instrument basis, electronic image basis,
calibrated steering values and measured scan plane are unchanged. A curved
starting pose remains intentional; the sharp join was an illustration defect.

The screenshot's control values (`33.8 cm`, shaft `-9°`, tip `-21.5°`, lateral
`-12°`) previously produced a maximum adjacent centerline turn of 95.64°.
The new route measures 3.63° at the same exact acoustic pose. This is a measure
of discretized shaft smoothness, not a change to the selected flexion angle.

Current v5 acquisition, alignment and instrument-clearance suites pass all
28 checks, including all 112 current/previous primary acquisition defaults.
The targeted shaft regression checks the actual generated mesh over insertion
bounds and combined steering extremes, together with unchanged acoustic
coordinates and mechanical independence from electronic multiplane angle.
`node --test tests/tee-shaft-continuity.test.mjs` passes seven checks over
450 control/reference combinations. Both software head branches are checked
for a connected rear attachment and compatibility with legacy atlas endpoints.

`probe-native/probe-before-after.png` renders the actual old and new production
shaft buffers and unchanged head geometry with the production shared-geometry
shader. Each pair uses one fixed camera. The default and combined-flexion
comparisons retain byte-identical acoustic objects; the receipt records the
input-export and shader hashes. This is native EGL visual QA, not a browser
screenshot.

## Release preparation

The ordinary managed build and all twelve required asset-staging steps pass,
including the exact reviewed-mask byte proof and the final static budget check.
No source volume, scan geometry, mask, catalog, immutable data bank or release
access policy changed. Browser preview startup failed twice even after a fresh
kernel; no browser screenshot or direct Firefox certification is claimed.
