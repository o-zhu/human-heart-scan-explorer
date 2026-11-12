# Progressive Ultra delivery — v46

This supersedes the v45 fresh-visit policy that stopped at Compact Detail.
The resident volume remains the first usable image. A new eligible desktop
visit next installs the existing Compact Detail surface with its reviewed
cavity cleanup, gives that image two animation-frame opportunities, and then
automatically requests the complete Ultra-High Fidelity model. The source
badge always describes the geometry actually installed; the loading panel
separately identifies the requested upgrade. A saved Ultra preference and
Reset Detail Defaults use the same progressive path.

The first-view `ready` promise resolves after the intermediate stage. The
separate `upgradeReady` promise tracks the automatic Ultra stage. Explicit
surface choices, cancellation and restored user settings take precedence.
Choosing Compact Detail or Interactive Volume prevents an old automatic
continuation from starting later. An explicitly saved smaller choice is
preserved on the next visit; automatic choices do not overwrite that preference.

The full model still requires verified base geometry, detached-debris flags,
the eight-field reviewed mask atlas and all four prepared interior replacements.
The working compact surface stays visible during that preparation. Its GPU
resources remain until the first complete Ultra draw succeeds, including the
final framebuffer allocation and draw checks. A first-draw failure restores
that compact surface and exposes Retry. Successful presentation releases the
compact buffers immediately. Only this one smaller fallback is retained; a
chain of large unpresented meshes is not retained.

## Resource policy and foreground priority

Desktop CPU count now controls scheduling budgets rather than permanently
limiting spatial fidelity. A desktop with four logical cores can still reach
Ultra. A missing memory report, common in Safari, remains eligible while using
conservative cache, output and transport limits.

Known memory at or below 4 GiB, mobile/tablet detection and recovery mode keep
the existing smaller-model guard. The complete Ultra base alone decodes to
437,470,524 bytes before CPU/GPU duplication, masks, resident volume and render
targets; transfer compression does not remove that working set. Those guarded
devices retain Mobile/Compact Detail and explicit explanatory text rather than
claiming to display Ultra. Software rendering retains the existing volume path.

The surface job still pauses when a lab owns the workspace and resumes when
Reconstruction is active again. Lab data keeps foreground transfer priority.
Finite active-work timeouts, cancellation, verified-parts resume, stale-result
guards and indeterminate preparation feedback remain intact.

## Transfer optimization and fidelity

The existing v29 Ultra encoding already preserves exact positions, indices,
triangle corner order and source-identity checks. Its 12-bit octahedral normals
are a previously validated shading derivative. This release changes scheduling,
not that encoding, source geometry, cleanup decisions or stored source voxels.

| Existing surface | Transfer bytes | Decoded geometry bytes | Triangles |
| --- | ---: | ---: | ---: |
| Polished Compact | 4,406,836 | 8,562,920 | 497,714 |
| Compact Detail | 17,722,926 | 34,679,172 | 1,986,313 |
| Ultra compact transport | 131,645,142 | 437,470,524 | 23,618,685 |
| Preserved original Ultra transport | 227,902,460 | 437,470,524 | 23,618,685 |

The 42.2% compact-transport reduction predates this release. No additional
download-byte reduction is claimed here. More vertex reduction would need new
geometry-specific cleanup mappings and matched source/visual validation; it
was not silently substituted for the requested highest-fidelity model.

Previously all 32 Ultra blocks were downloaded, checked, inflated and decoded
strictly serially. The new bounded pipeline can download and verify the next
block while the current block is being inflated and decoded. Only one network
request is active and at most one future compressed block is retained. The
current manifest's largest block is 4,665,178 bytes; the format guard is 8 MiB.
Low-core, unknown-memory, mobile and recovery policies keep the serial path.
Every block and complete geometry hash still verifies before activation.

Pause/resume cannot regress byte progress or count a retransmission twice.
A corrupt lookahead result cannot reach the decoder or become an unhandled
promise rejection while current verified work is in progress. Completed blocks
remain in order, and a stalled decoder cannot build an unbounded download queue.
Closing the pipeline while the next block waits behind a workspace-priority
gate prevents that abandoned request from starting when the gate reopens.

`pipeline-experiment.json` records a controlled scheduling experiment with real
2 MiB gzip decoding and SHA-256, eight blocks, and an explicit 18 ms synthetic
transfer delay per block. It demonstrates overlap under the stated fixture;
it is not a browser, public-network, old-PC or complete-heart load-time claim.
Reproduce with `node scripts/benchmark-surface-pipeline-v46.mjs`.

## Verification

Focused checks cover fresh and saved-Ultra progressive loading, compact
cleanup before upgrade, explicit-choice cancellation, failed upgrades and
first-draw fallback, known memory guards, low-core/unknown-memory desktops,
source identity, conservative serial transport, one-block lookahead,
lab-priority pause, progress accounting and corrupt/truncated data rejection.
The browser's nested animation-frame startup branch is also exercised with a
controlled frame queue, including an explicit user choice between its frames.

```sh
node tests/fine-surface-controller-v19.mjs /path/to/linkedom/esm/index.js
node --test tests/device-resources.mjs tests/mobile-resource-integration.mjs
node --test tests/compact-surface-progress-v45.mjs tests/fine-surface-transport-v23.mjs
node --test tests/surface-transport-pipeline-v46.mjs tests/mesh-draw-batching-v37.mjs
```

The source checkout contains the canonical compact manifests, but not the 32
externally hosted compact mesh binaries. New end-to-end decoding of that entire
transport was therefore not performed in this check. The bounded codec tests
use real gzip bytes; existing geometry identities and all production validation
gates are retained. Browser observations and publication results are recorded
separately by the release owner.
