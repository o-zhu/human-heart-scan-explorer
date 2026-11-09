# Bounded mobile cavity cleanup

## Runtime change

Mobile Detail and Compact Detail continue to use the original smaller polished
meshes. They now prepare the four existing reviewed lumen masks before the
first surface commit: atrial, arterial, valve-adjacent and right ventricular.
The new `public/mobile-lumen-atlas.js` loader selects their exact sparse bricks
from the existing v32 reference program and copies one SHA-verified source mask
at a time. It downloads no local replacement mesh, no low-band mask and no full
desktop atlas payload. There are no new public binary assets or hosting routes.

The sparse output has pinned hashes independently derived by
`scripts/mobile-lumen-v41/verify-atlas.py`. Its 168,208 index entries and 20,054
nonzero 512-byte bricks reconstruct all 81,845,420 bytes of the four original
packed masks exactly. See `mobile-atlas-proof.json` for the independent complete
byte comparison and `runtime-tests.json` for the tested production fingerprints.

| Retained or temporary allocation | Bytes |
|---|---:|
| Sparse CPU index | 675,840 |
| Sparse CPU payload | 10,272,768 |
| Total retained CPU atlas | 10,948,608 |
| Matching two GPU textures | 10,948,608 |
| Largest single temporary decoded source mask | 29,192,000 |
| Decoded reference program during construction | 1,136,096 |
| Dense source masks retained after completion | 0 |

These are declared buffer sizes, excluding browser overhead, transient hashing
or decompression storage, and garbage-collection timing. They are not a
measurement of a browser tab's peak memory. Existing surface, render-target and
fine-data cache limits remain unchanged. The 437,470,524-byte desktop surface
and its local replacement meshes remain disallowed on constrained devices.

## Display and lifecycle consistency

`ReviewedMaskAtlas` uses its existing two-texture upload with an explicit v41
manifest validator. The normal v32 validator remains the default. A ready
four-field atlas cannot satisfy a request for eight-field local-surface cleanup;
a running full desktop load still serves both kinds of consumers together.

The mobile lumen collection carries metadata and a reference to the sparse CPU
atlas instead of retaining dense mask arrays. `lumenExcludedAt()` samples that
same atlas with the established nearest-cell source mapping. Existing shaders
already apply the lumen fields to the mesh, volume and 3D cut face. Neither
source intensities nor measured CT-card pixels change. Turning cleanup off and
back on reuses the retained data and restores the original comparison.

The smaller surface is installed only after requested cleanup is ready. A
failed request retains the prior usable view; retries can reuse a verified
atlas. Workspace pauses abort incomplete cleanup, while completed masks stay
active in Echo. User choices made during loading take precedence: an explicit
off remains off after a pause, and a newer enable is awaited rather than being
mistaken for failure of the superseded request. A final workspace/revision
check prevents a queued transition from reaching GPU installation.

To preserve foreground lab priority, an initial or saved Echo visit can still
use the resident baseline until Reconstruction preparation resumes. It does
not initiate the desktop pipeline or automatically start this mobile mask
preparation inside a foreground lab. After the smaller surface and masks have
completed, Echo reuses them.

The Gentle-only detached-component attribute depends on a different vertex
ordering, and the desktop local replacement surfaces require their matching
geometry. Neither is misapplied to the smaller mesh. The native v41 comparisons
demonstrate the requested large left-atrial cavity cleanup with the exact four
reviewed masks, without a new component classifier or synthetic geometry.

## Focused verification

| Suite | Result |
|---|---:|
| `tests/mobile-lumen-v41.mjs` | 9 / 9 |
| `tests/fine-surface-controller-v19.mjs` | 47 / 47 |
| `tests/lumen-cleanup-v23.mjs` | 6 / 6 |
| `tests/reviewed-mask-atlas-v32.mjs` | 11 / 11 |
| `tests/volume-picking-cap.mjs` | 3 / 3 |
| `tests/echo-refinement-transition-v40.mjs` | 5 / 5 |

The mobile cases verify source and layout hashes, bounded metadata, sequential
requests, no retained dense arrays, all-four-field source sampling and CPU
picking, two-texture allocation and rollback, late-source corruption,
cancellation, cleanup failure/retry, and rejection of incomplete field coverage.
Six added surface-controller cases cover cleanup before surface commit, retry,
late cancellation, pause/off/resume, a superseding enable, and a queued workspace
change after the final asynchronous preparation step. The desktop atlas test
also exercises a lumen consumer and local-surface consumer sharing one full
load. `git diff --check` passes.

Run the mobile receipt with:

```sh
HEART_MOBILE_LUMEN_EVIDENCE=docs/echo-mobile-v41/runtime-tests.json node --test tests/mobile-lumen-v41.mjs
```

The controller and lumen UI suites take the installed LinkeDOM ESM entry point
as their positional argument. Native rendering and exact storage comparisons
have their own v41 receipts. No physical iPhone or iPad performance measurement
is claimed here.
