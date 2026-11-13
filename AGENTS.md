# Heart Explorer

Read `LOCAL-DEVELOPMENT.md` before editing. Preserve the public repository's
asset exclusions, dataset availability guards, and licensing records.

## Update delivery and GitHub integration

Before changing Heart Explorer, read `docs/UPDATE_WORKFLOW.md`, inspect the current source/version, and check pending update manifests. The deployed Sites revision, archive queue sequence, and public GitHub integration state are separate records.

For each completed requested update:

1. Capture its exact baseline and dependencies; preserve unrelated work and the public repository's intentional asset exclusions.
2. Implement and validate the affected behavior.
3. Create an immutable, dated, versioned delta ZIP with `manifest.json`, `changes.patch`, `DIFF.md`, `CODEX_PROMPT.md`, `VALIDATION.md`, and exact `base/` and `payload/` bytes. Use `scripts/update_bundle.py` and create the external ZIP checksum.
4. Upload the archive and required sidecars to the verified private Box destination and record the actual delivery result. Publish the requested website update through the normal authorized workflow. Do not claim either step succeeded without evidence.
5. Report the update identity, checks, live deployment, archive delivery, and GitHub status separately.

Ordinary chat changes are archived for later batching. Update public GitHub only when the user requests a sync or invokes `docs/CODEX_SYNC_PROMPT.md`; that invocation authorizes its stated integration work without an extra routine permission gate. Follow normal branch/PR policy and never force-push or bypass protection.

Use update IDs, dependencies, and hashes to select unapplied archives. Apply each patch against predecessor results; recorded older updates remain applied when later changes alter their files. Do not overwrite divergent files by timestamp/version. Reconcile using base bytes. Preserve public documentation/configuration and restricted-asset exclusions. A `public-source-payload` archive may have private transport documents; deployment-only payloads must not enter public integration.

Keep the whole ZIP, top-level transport documents, Box endpoints, credentials, signed URLs, and private receipts out of public commits; apply only approved source payload. Obtain delivery configuration privately. For the first archive, follow the workflow's inert inspection/review procedure before executing its bundled helper. If access/delivery fails, retain the local package and state exactly what remains incomplete.

## v53 sequential acquisition and bounded preparation

Read `docs/sequential-loading-v53/README.md` and
`docs/surface-hash-v53/README.md` before changing Ultra loading. Where asynchronous
OPFS is available, acquire and verify all compact parts into a unique temporary
job directory before bounded decode/upload. Storage is optional: denied, full or
stalled storage retains the verified serial streaming fallback, never a complete
compressed-model heap allocation. Bound native operations, disable repeated disk
reads after a timeout, and keep cleanup scoped to the exact job, including after
worker termination. Restoring a later missing part must still show recovery.

The explicit completed-staging barrier separates Downloading from Preparing;
byte totals alone cannot advance that phase. Preserve one determinate bar, real
upload progress, pause/resume, v52 network retry/priority rules and the v48
complete-model/first-draw transaction. Compact decompression has a 20-second
active no-output deadline; it does not consume intentional workspace pauses or
authorize a larger download after resource failure. Optional scalar WebAssembly
hashing must preserve every digest and fall back safely to JavaScript. Node hash
timings do not establish physical iPad performance. Scientific assets, immutable
banks and the existing hosting stage order are unchanged.


## v54 Reference Views gallery and illustrations

Read `docs/reference-views-v54/README.md` and its `GUIDELINES.md` before changing
the reference catalogue or its artwork. Keep the labelled gallery as the fresh
Reference Views entry, with Advanced selected by default, all 28 views per
approach, the defined Basic sets, and an explicit return from detail. Preserve
legacy comparison links, gallery filter state, keyboard focus, and the existing
shared canvas/player lifecycle. Returning to the grid must stop comparison work.

The versioned original ChatGPT Image assets have exact per-view prompts,
reference hashes and QC in `docs/reference-views-v54/asset-manifest.json`. Do not replace view-specific
geometry with a generic heart silhouette or copy published source figures into
new artwork. Correct anatomical problems by regenerating against the specific
ASE anatomy and ultrasound references; packaging only resizes/encodes pixels.
Keep the source-checked teaching scope distinct from patient/CT correspondence.
Scientific data, immutable banks and their closed upload gates remain unchanged.
Keep the existing 13 hosting stages and add
`python3 scripts/prepare-reference-hosting-v54.py --stage` immediately before
the final display-budget stage. It verifies all replacements and omits only
the 56 superseded illustration build copies, retaining every source original.


## v57 exact prepared reference cutaways and fitted video defaults

Read `docs/reference-sections-v57/README.md` before changing reference sampling.
The prepared bank is bound to the initialized default plane, donor, fine-source
fingerprint, cleanup mask and exact physical CT/full-face crop. Preserve the
79.4/79.56 µm source distinction, 294 acquired roles and all 21 outside-scan
entries. Verify encoded and reconstructed pixel SHA-256 values; the versioned
row-difference codec is lossless. A changed plane, cleanup state or source must
use the existing bounded fine sampler, never move prepared pixels to a new cut.
Keep CT and full-face completion independent, stale cancellation and the bounded
24 MiB decoded cache. A pending or failed face remains clearly labelled Preview.

Reference videos start in Fit Ultrasound on explicit view selection or an actual
source change. Full Frame is a temporary choice for the current selection and
survives retries; changing framing must not reload video bytes. Native scanner
angle displays retain their source pixels and receive no synthetic replacement.

This public update contains runtime code, generators, tests, readable QC
summaries and an empty prepared-bank configuration template. Generated plane
exports, donor/data indexes, scalar payloads, contact figures and detailed
machine-readable QC are separate deliverables and are not included here.
The empty configuration avoids requests for missing prepared assets and retains
the existing fine-sampler fallback. Reproduce a local bank with the documented
generators, then install its complete verified `staged-public` output, including
the matching generated configuration. Preserve existing fine-source restoration,
licenses and attribution; keep generated outputs outside the source-only update.
The public hosting configuration and existing staging sequence are unchanged.
Deployment-specific changes for the original hosted site are outside this public
source update. Preserve existing immutable assets and closed upload gates.

## v58 individual TTE/TEE anatomical QC

Read `docs/reference-views-v58/README.md`, `GUIDELINES.md`, and `AUDIT.md` before
changing reference illustrations. The frozen v58 registry is
`public/reference-artwork-v58.js`; every one of the 56 view IDs has an explicit
source-backed retain/replace decision. Historical v54 approval flags are not
the current review. The v59 follow-up below supersedes its PLAX assessment.
Preserve all historical bytes and exact current mappings.
Do not silently fall back to rejected images after an asset-load error.

Generate anatomical changes with image_gen against the exact named view's
anatomy and ultrasound examples. Inspect topology, view, orientation, labels,
phase, and readability at full size and thumbnail size. A thick false wall
across an expected orifice is a rejection; a closed thin valve or an out-of-plane
vessel profile is not automatically one. Re-review revised candidates for new
faults. Preserve exact prompts, master/input hashes and per-view limitations.

Run `python3 scripts/prepare-reference-icons-v58.py --verify` without
`--allow-pending` to check the frozen historical package. Use the v59 verifier
below for current artwork and runtime mapping. In the original hosted-data
checkout, preserve its 15 staging steps and run
`python3 scripts/verify-reference-hosting-v58.py` against the matching prepared
bank manifest. This public source distribution intentionally omits that generated
bank and retains its empty configuration; do not import the hosted bank, migration
routes or private receipts to satisfy a check that applies to a different setup.
Do not re-upload unchanged scientific assets or open immutable-bank population
gates for an illustration update.

## v59 targeted PLAX mitral follow-up

Read `docs/reference-views-v59/README.md`, `GUIDELINES.md`, and `REVIEW.md`
before modifying PLAX mitral artwork. Its v58 pass is superseded. The current
registry is `public/reference-artwork-v59.js`; only `tte:plax_mv` has a fresh
review and new image/thumbnail. The other 55 records are exact v58 carryovers,
not newly reviewed. Preserve frozen v54/v58 manifests and image bytes.

Inspect the finite atrial tissue band, open mitral annulus, both mitral hinges,
both LVOT borders, distinct aortomitral hinge levels, coherent valve phase and
label targets separately. A prompt or image hash cannot prove anatomy. Review
actual encoded 960px/384px files and a 200px rendition. Run
`python3 scripts/prepare-reference-icons-v59.py --verify` for current assets
and runtime mapping; the v58 verifier checks only its frozen registry. Keep
all hosting stages and public repository data/configuration exclusions.

The supplemental public artwork inventory is
`docs/open-source/reference-artwork-v59.json`. It records the new original files
and exact artwork-manifest hashes while preserving the existing data inventory
and all restricted-asset decisions.


## v60 fresh whole-catalogue illustration QC

Read `docs/reference-views-v60/GUIDELINES.md`, `AUDIT.md` and the manifest
before editing any TTE/TEE illustration. This is a fresh review of all 56 views;
no earlier pass is inherited. The current registry is
`public/reference-artwork-v60.js`. Preserve all historical v54/v58/v59 assets
and manifests. The v58/v59 verifiers validate their frozen registries only;
`python3 scripts/prepare-reference-icons-v60.py --verify` checks the active runtime.

Inventory every visible boundary before judging it: muscular, vascular, fibrous,
valvular, genuine subvalvular apparatus, or intentional sector crop. Atrial/RV
walls require a finite filled band where visible; genuine fibrous structures
must remain slender. Trace cavity connections and valve hinges/free tips in the
actual imaging plane. Semilunar opening direction is upstream/downstream, not
a fixed screen curvature. Require one coherent cardiac phase per schematic.

All eight rubric domains must be resolved for the declared teaching scope; a
total score cannot override a failed or uncertain domain. Inspect actual full
960px, encoded384px and decoded200px pixels, and bind acceptance to both export
hashes. Preserve failed attempts and their reasons. The manifest is AI-assisted
source comparison, not independent clinician certification.

Keep gallery behavior, view IDs, source order, plane/CT calibration, scientific
data, licensing exclusions, all15 hosting stages and closed upload gates intact.
The public supplement `docs/open-source/reference-artwork-v60.json` inventories
the original replacement artwork without redistributing publisher figures.
