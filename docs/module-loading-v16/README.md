# v16 initial module loading audit

The application now evaluates a smaller static JavaScript graph before its
initial entry point can run. This is a source/dependency measurement, not a
browser startup-time or network benchmark.

| Initial `public/app.js` static closure | v15 | v16 working tree | Change |
|---|---:|---:|---:|
| Modules | 29 | 20 | 9 fewer |
| Source bytes | 455,036 | 239,478 | 215,558 fewer; 47.37% |
| Sum of per-file gzip bytes | 144,820 | 75,572 | 69,248 fewer; 47.82% |

The baseline is commit `6ee683ee505b36e212e1b0f12a987a863d71ddf4`.
`graph.json` records every module, its dependencies, byte sizes, and the
added/removed sets. Gzip uses level 9 independently for each file; the hosting
service may use different compression and caching.

Quick Views is automatically loaded after the first usable heart. Its static
closure has also been reduced, so it no longer pulls in the full Echo interface
or the retired Flow interface during that step:

| Quick Views static closure | v15 | v16 |
|---|---:|---:|
| Modules | 9 | 6 |
| Source bytes | 126,752 | 27,663 |
| Sum of per-file gzip bytes | 40,467 | 9,919 |

The v16 union of the app and automatic Quick Views closures is **24 modules,
260,792 source bytes, and 83,134 per-file gzip bytes**. Shared modules are counted
once in that union.

## Scope and timing

The parser follows actual static ESM imports and re-exports. It excludes dynamic
imports, worker entries, CSS, the framework bootstrap, data fetches, and any
runtime resource loaded by those modules. Therefore these figures must not be
described as the total page download or a measured percentage speedup.

`workbench-modules.js` defers Echo and Probe construction until requested and the
software renderer until WebGL initialization fails. Quick Views loads after the
first usable heart. It imports the shared cache/decoder directly from
`echo-texture-cache.js` and plane geometry from `flow-plane.js`. Neither shared
module imports interface code, clinical media, or the old Flow module. Existing
callers may continue to import `EchoTextureCache` from `echo.js` and `flowPlane`
from `flow-views.js`; those modules re-export the same shared implementations.
The revised initial static graph contains the small lazy loader and resident
section helper instead of the prior eager optional workspaces.

The first installed volume gets two animation-frame opportunities before optional
module and data preparation begins. This establishes a scheduling boundary; it
does not prove a native GPU paint completed within a particular number of
milliseconds.

## Read-only integration review

No blocking issue was identified in the inspected v16 integration:

- Slice input commits the requested plane before selecting a matching image.
  Old fine pixels are cleared when the current image is not ready, while the
  WebGL composite samples the current resident volume directly. The input path
  performs no CPU section extraction for that fallback.
- Matching native or Detailed images take precedence over the resident preview.
  Asynchronous arrivals retain axis/index/token checks, so an obsolete decode
  cannot move the current plane or replace it with another section's pixels.
- CT-card work is coalesced after a renderer frame opportunity, reads current
  positions when it runs, and is discarded when the reconstruction rail is
  hidden. The resident helper preserves published arrays and bounds its cache.
- Delayed module imports and metadata loads check the current tab revision
  before moving the viewport or entering a workspace. Saved-camera restoration
  is similarly guarded. Leaving a constructed but not-yet-entered module is
  supported by its existing lifecycle methods.
- Optional preparation begins after the first source volume is installed and the
  blocking loading layer is hidden. The existing startup supersession/retry
  path remains the owner of the installed volume.

The actual resident/section tests passed 20 combined cases during this audit.
After the shared-module extraction, the focused module-boundary, cache, browser
receiver, and Quick Views tests passed 21 cases. The Flow verifier passed all
eight presets and 32 transformed-frame checks, including measured pixel
registrations and encoded-image checksums. The extracted cache/decoder and
`flowPlane` bodies were compared directly with v15 and are unchanged apart from
exporting the existing Ultra-spacing predicate for shared use.
Root verification separately exercises the full app boot and transition fixture;
this report does not duplicate or claim browser interaction testing.

## Reproduce

With the checkout's installed development dependencies:

```sh
node scripts/measure-module-graph-v16.mjs
node --test tests/resident-sections-v16.mjs tests/sections-v14.mjs
node --test tests/module-loading-v16.mjs tests/echo-v6.test.mjs tests/browser-receivers-v8_1.mjs tests/quick-views-v12.mjs
node scripts/verify_flow_views.mjs
```

The graph script uses the already installed `es-module-lexer` dependency through
Vite. It writes only `docs/module-loading-v16/graph.json`; passing a full Git
commit SHA as its first argument selects another baseline.
