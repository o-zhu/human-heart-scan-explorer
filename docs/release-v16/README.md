# v16 — continuous fast slicing and a lighter first view

The user reported slower startup and a frozen cutaway followed by an abrupt jump
during rapid scrolling. This release changes the display policy responsible for
that freeze and bounds background work that could delay the next gesture.
The public Site keeps its existing URL and audience.

## What changed

### The requested plane moves immediately

v14/v15 deliberately retained the last sharp Ultra image and its original plane
until the next exact image decoded. A rapid sequence could make every completed
image obsolete, leaving the view frozen until the final request.

v16 always publishes the selected plane immediately. It uses exact current Ultra
or Detailed pixels when available. Otherwise the WebGL composite samples the
already-loaded measured volume at that plane, using the same unlit cut-face
window, brightness and palette at the full output resolution. The status labels
this as a volume preview. Its source is coarser than Ultra; no new fine anatomy
is synthesized. Only a result for the current index can replace it, at the same
registered position.

The input path does not extract a CPU section or paint all three CT cards.
Card work remains coalesced after the render opportunity. Cards and the software
renderer have a bounded, immutable resident-section helper. Existing ready fine
images still take priority, and stale-index/axis/token checks remain in place.

### Background refinement cannot monopolize the next update

The previous renderer could submit a whole 1.5–2.6-million-pixel raymarch after a
short pause. New input then waited for that complete GPU job. The new first pass
uses a 160,000-pixel initial volume budget plus a full-output cut face. Full scene
detail is rebuilt after 260 ms of quiet in offscreen bands of at most 160,000
ray-marched pixels. Only a finished same-view image is presented. New input
discards unfinished refinement and waits behind at most one submitted band.

Moving-scene work adapts to GPU timing; repeated unsignaled fence polls can lower
it when timer queries are unavailable. Idle bands and snapshots have separate
timing statistics. The retained full-detail target uses about 6 MB at default
output or 10.4 MB at high output. Snapshots retain their full-resolution path.

### First-view work gets priority

The initial application no longer statically loads the Echo, Probe, Quick Views
and software-renderer modules. Quick Views initialize after a usable first view;
specialized workspaces initialize when opened, and the software path loads only
if WebGL fails. Tab revision checks keep delayed imports from stealing the view.
The first installed volume receives two animation-frame opportunities before
optional preparation begins.

The small Quick Views controls also use isolated texture-cache and plane helpers;
they no longer pull in the entire Echo interface or retired Flow module. Their
static dependency closure falls from 126,752 to 27,663 source bytes. Existing
Echo and Flow exports remain compatible with their earlier callers.

Optional stored-neighbor decoding now also yields while essential volume,
cleanup, anatomy, fine-plane or module work is active. The selected slice remains
foreground; other CT-card detail waits until the essential work releases.

### Cancellation bounds the actual decoder work

Canceling a UI request does not stop an already-running native image codec. The
old bookkeeping therefore allowed six to eight physical decodes to overlap in
the rapid-input fixture despite a smaller apparent task limit. A separate queue
now bounds actual native work to two jobs, or one on the compatibility/low-memory
path. Queued obsolete jobs are canceled before decoding. Already-started results
may finish into the bounded cache for a reversal without being displayed at an
obsolete index. Fast multi-section strides use a small predictive local runway.

## Evidence

| Check | Result | Scope |
| --- | --- | --- |
| Initial static application modules | 29 → 20 | Literal static ESM dependency closure; dynamic modules, framework bootstrap, CSS, workers and scan data excluded |
| Initial static application source | 455,036 → 239,478 bytes, 47.37% less | Code needed before initial application entry; not measured page-load time |
| Per-file gzip estimate for that code | 144,820 → 75,572 bytes | Compression estimate; not observed wire traffic |
| Quick Views static source | 126,752 → 27,663 bytes | Shared helpers replace imports of full optional interfaces |
| Peak physical native decodes | 6–8 → 2 | Six fixed-service workloads using real donor crop dimensions, fast strides and reversals |
| Native decode starts at 8 ms input | 87 → 41 | 64 selected positions per donor; no network traffic |
| Native decode starts at 16 ms input | 131–132 → 66–67 | Same workload family |
| Completed full-detail rendering | Byte-identical | 18 native EGL comparisons against the original full single-pass output |
| Temporary cut-face transfer | Byte-identical to its same-source full pass | Resident and prepared faces, including retained-side occlusion; resident and Ultra are different sources |

The codec fixture fixes native service time at 40 ms. With bounded work, final
exact Ultra delivery after the last input takes 56–72 ms instead of 40 ms in the
old unrestricted fixture. This is a documented work/memory tradeoff, not a claim
that decoder throttling alone lowers latency. Immediate resident-plane display
is what removes the old wait-for-Ultra freeze. Exact fine pixels still require
decoding and upload when they are not already prepared.

## Verification

- 93 focused Node tests pass across current-plane integration, immutable resident
  sections, native card painting, upload scheduling, interruptible rendering,
  decode cancellation, priorities, browser receivers, shared windowing and Probe
  motion.
- 16 actual-application DOM tests pass, including first-view ordering, retry,
  resolution races, saved-module restoration, slow optional imports, tab reversal,
  settings, donor comparison, section controls and fullscreen.
- 3 donor-brightness and settings DOM tests pass.
- 21 focused module-boundary, texture-cache, receiver and Quick Views tests pass
  after shared-helper extraction. This set overlaps the receiver tests above;
  counts are not intended to be added as unique tests.
- The flow verifier passes all 8 presets and 32 transformed frames, including
  source-pixel registration and encoded image hashes.
- 7 existing renderer orchestration checks and 19 existing prefetch checks pass.
- 18 native EGL production-shader comparisons pass across all three donors.
  Completed banded output and final composition match the full-pass reference;
  surface, translucent and MIP pixel coordinates are retained.
- All six low/high donor volumes used by the resident benchmark passed encoded
  and decoded source-hash checks. No source scan asset or cache key was changed.

Evidence and reproducible commands:

- `../renderer-responsiveness-v16/` — render command limits, native pixel checks,
  actual measured resident previews and shader hash.
- `../ultra-motion-v16/` — startup gates, non-cancelable native work, stride/reversal
  fixture, limits and workload results.
- `../resident-sections-v16/` — physical registration, immutable cache, source
  hashes and CPU-only extraction measurements.
- `../module-loading-v16/` — static source graph and compression estimates.

Browser automation is unavailable for this Site session. These are DOM fixtures,
production-method scheduling checks and native rendering comparisons, not measured
browser FPS or user-device input latency. A busy GPU still has to finish its
current small batch. The source images already downloaded by the user stay valid.
