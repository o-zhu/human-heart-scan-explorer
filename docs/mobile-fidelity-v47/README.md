# Mobile Ultra and complete reviewed cleanup — v47

This supersedes the v39/v41/v46 policy that permanently restricted mobile,
tablets and reported memory of 4 GiB or less to the smaller prepared surface.
The user's request explicitly includes those devices, including iPads that
advertise a desktop Macintosh user agent and provide no memory report.

## Diagnosis and visible behavior

`device-resources.js` previously set `allowUltraSurface` to false for every
mobile/tablet and every reported-memory value of 4 GiB or less. That condition
also changed both manual and saved Ultra choices into `detail` or `balanced`.
Consequently, the default upgrade never started on an iPad regardless of its
capability. The full four-region interior replacement pipeline is gated on the
real Ultra source and therefore could not run either. The compact model has
its exact four cavity masks; those masks alone cannot supply the Ultra model's
four interior replacements.

Normal sessions now attempt the complete Ultra model after their cleaned
intermediate. Device hints still limit simultaneous work, retained scan caches,
pixel budgets and verification memory; they do not permanently prohibit Ultra.

| Session | First prepared surface | Next automatic action |
| --- | --- | --- |
| iPad, iPhone, Android or other mobile, memory unknown or above 2 GiB | Cleaned Compact Detail | Attempt complete Ultra |
| Known memory at or below 2 GiB | Cleaned balanced surface | Attempt complete Ultra |
| Desktop with unknown memory, few cores or a small window | Cleaned Compact Detail, or balanced at at most 2 GiB | Attempt complete Ultra |
| Explicit newly saved Compact, balanced or Interactive Volume | Saved choice | Preserve that choice |
| Recovery session after a failure | Smaller prepared surface | Keep the recovery limit |

The first usable resident volume still appears before optional preparation.
Compact activation waits for requested reviewed cavity cleanup. The intermediate
gets two animation-frame opportunities before the Ultra request. Its source
badge continues to describe the geometry actually displayed throughout loading.

All original complete-model gates remain: verified base positions/topology and
source identity, detached-debris flags, all eight reviewed mask fields and all
four prepared interior replacements. No partial Ultra is published. One
already-working intermediate survives through the first successful full Ultra
draw; success disposes it, while allocation or draw failure restores it. Decode
or worker allocation failure does not automatically retry the larger original
transport. Retry remains an explicit user action. Source/transport failures can
still use the existing single verified original-transport fallback.

## Existing mobile preferences

The previous mobile key was
`heart-explorer:surface:mobile:v43:<donor>`. Because an Ultra click could be saved
as `detail` or `balanced`, that key cannot distinguish a deliberate smaller
choice from an automatically rewritten Ultra choice. Leaving it unchanged
would leave affected existing users permanently stuck on the smaller model.

The first v47 read migrates a recognized legacy mobile preference into
`heart-explorer:surface:mobile:v47:<donor>`. A legacy explicit `volume` opt-out
is retained. Other recognized legacy mobile values become `auto`, enabling
the progressive attempt once the new controller starts. The legacy value is
left intact as provenance. Every new explicit v47 choice is saved faithfully
and takes precedence on subsequent visits, including Compact and balanced.
The desktop preference namespace and saved bookmarks/custom display settings
are unchanged. Reset Detail Defaults continues to save the explicit `auto`
intent.

## Exact cleanup with a smaller working set

Cautious policies (mobile, low memory, low CPU, unknown memory and recovery)
use a sparse CPU representation for both the intermediate and the complete
reviewed model. The full reference program reconstructs the exact original
eight-field RMA1 atlas. This is a change in delivery and storage, not new cleanup
decisions or a lower-resolution mask.

The full builder reads one source field at a time, copies its reviewed bricks
directly into the final atlas, then releases that dense source. During the
progressive upgrade it reuses the four already-verified Compact cavity fields
directly from their sparse bricks. Their source identities must match, and the
complete reconstructed atlas still has to match its pinned SHA-256 before any
GPU replacement. The four local fields and all four replacement meshes still
load and validate normally.

Local CPU picking now samples the same sparse fields as GPU exclusion when
dense source arrays have been released. Lumen and local consumers do not fetch
the dense masks a second time. A full sparse atlas is explicitly distinguished
from a four-field intermediate: a compact atlas cannot satisfy the eight-field
request, while toggling a complete sparse cleanup does not unnecessarily reload
it. The index and payload share one verified backing buffer on aligned,
little-endian platforms; other layouts retain the existing conversion path.

| Source-derived allocation/transfer fact | Bytes |
| --- | ---: |
| Eight dense source masks no longer retained by a cautious full-model session | 104,449,180 |
| Complete sparse atlas backing buffer, including its header | 18,264,096 |
| Duplicate CPU index copy avoided on aligned little-endian platforms | 864,256 |
| Largest newly decoded local source field during a progressive upgrade | 7,241,640 |
| Cavity-mask transfer avoided by reusing the cleaned intermediate | 1,478,823 |

The smaller initial cleanup still decodes at most one 29,192,000-byte cavity
source at a time and retains its 10,948,608-byte sparse representation. The
figures above are individual mask allocations and repeated-transfer savings,
not a total browser/GPU memory prediction. Ultra's base geometry remains
437,470,524 decoded bytes before its graphics allocation. The decoded CPU
geometry reference is explicitly released immediately after a successful GPU
upload.

The full cleanup stage now has its own workspace abort signal. Opening Echo,
TTE or TEE aborts unfinished full-mask preparation and pauses its active-work
watchdog. Returning to Reconstruction resumes the preparation over the same
decoded base; it does not restart the entire geometry download. Completed
cleanup remains available to shared views, and explicit cleanup-off choices,
request cancellation and late-result guards retain their existing behavior.

## Bounded verification of the full surface

On cautious devices, hashes larger than 8 MiB use `surface-sha256.js` instead of
submitting the whole input to native Web Crypto in one operation. The input is
viewed directly, processed in 1 MiB chunks and never copied into another full
model buffer. Small transport blocks retain native Web Crypto. Capable desktop
policies retain the native full-input path.

The incremental implementation performs the same SHA-256 verification; no
checksum, topology or source-identity check is removed. Its per-job typed-array
working storage is at most 416 bytes, plus 256 shared bytes of round constants.
Each completed chunk reports measured progress and yields so workspace priority
and worker termination remain responsive. This trades some verification CPU
time for a bounded input working set.

`hash-validation.json` records the actual preserved original Ultra source:

- Input: **437,470,524 bytes**.
- SHA-256: `175548ddaad01c409d59d561df6018c5cb0c90752b2ec771899c255065398dae`.
- Verification: **419 progress checkpoints**, about **3.61 seconds** for the
  hash alone in the recorded Node environment.
- Largest observed increase in Node's tracked `arrayBuffers` during this hash:
  **384 bytes**. The code's per-job bound includes padding that can require an
  additional block for other input lengths.

These are controlled Node measurements, not browser process memory, device
memory, public-network timings or a claim that every iPad can retain Ultra.
The production worker is separately exercised with a real smaller surface,
large native digest inputs forbidden, pause/resume during verification and
termination before commit.

## Verification and limits

Focused checks cover desktop-mode touch iPads without `deviceMemory`, phones,
known 2/4 GiB values, low cores, unknown memory, recovery, old mobile preferences,
new explicit smaller choices, both cleanup stages, first-draw rollback,
workspace priority, corrupt assets, cancellation and allocation failures.
Actual source-mask/atlas bytes and all four prepared interior meshes are used
for the cleanup integration checks. Sparse CPU picking is compared against
the existing exact representation, including nonzero bits and source bounds.
The complete preserved original Ultra source is checked with the new hash.

```sh
node tests/fine-surface-controller-v19.mjs /path/to/linkedom/esm/index.js
node --test tests/device-resources.mjs tests/mobile-resource-integration.mjs \
  tests/fine-surface-transport-v23.mjs tests/fine-surface-v19.mjs
node --test tests/reviewed-mask-atlas-v32.mjs tests/mobile-lumen-v41.mjs
HEART_SURFACE_SHA_LARGE=1 \
  HEART_MOBILE_FIDELITY_EVIDENCE=docs/mobile-fidelity-v47/hash-validation.json \
  node --expose-gc tests/surface-sha256-v47.mjs
```

The 32 externally hosted compact Ultra blocks are absent from this checkout,
so full compact-transport decoding against those production bytes was not
repeated locally. The preserved original Ultra parts, all reviewed source
masks, reference program and local prepared surfaces are present and used by
the checks above. Browser layout review and physical-device capability should
be reported separately. A device that actually fails a graphics allocation or
loses its context still needs the cleaned smaller fallback; admission does not
guarantee hardware success.
