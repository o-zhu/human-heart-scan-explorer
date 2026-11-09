# Final bank manifest and evidence ledger

`scripts/guided-native-v21/finalize_manifest.py` compiles a completed guided
native reconstruction into two deterministic artifacts:

| File | Purpose | Size limit |
|---|---|---|
| `manifest.json.gz` | Compact browser tile index, overview parts, coverage and processing summary | 32 MiB decoded and 32 MiB gzip |
| `evidence.json.gz` | Complete per-record provenance, native upload receipts, source-object hashes, configuration and plan evidence | 32 MiB gzip; never parsed automatically by the viewer |

Their plain JSON counterparts are retained locally. `artifact.json`,
`evidence-artifact.json` and `report.json` provide hashes, byte counts, upload
paths and a concise validation summary. The compiler performs **no uploads or
network requests**. Native remote verification uses the historical receipts
created by the uploader after a complete public GET checksum comparison.

## Required validation

The compiler refuses an incomplete run, a missing or duplicate completed core,
an unplanned coordinate, or any record with a foreign processing fingerprint.
`--allow-pilot` changes the declared scope to `pilot-only`; it does not relax
exact-plan completion.

Normal `whole-plan` mode is independently pinned to the selected full census
plan SHA-256 `3be68c22b4f7a000b6e17b4c159f4d9a630b52884ea434624fc70c25999c6e94`
for both input and core plans, and processing fingerprint
`44a31c3adeb20e5a9a3d31f6868f9c92479920f533d2ea3c486e22b4aefa584a`.
Completing an alternate small plan without `--allow-pilot` is refused; caller
flags alone cannot make that plan a whole-heart result. These identity checks
do not imply completion and do not bypass any record or receipt validation.

Both original `.npy` plans are checked for duplicate coordinates and valid source
geometry. The core set must be contained in the input set, and completed records
must equal the entire core set. The original plan hashes, configuration,
processing source hashes and prior-manifest hash must reproduce the runner's
recorded fingerprint. When reviewing a historical run with different source
files, provide its matching `--processing-source` directory and
`--prior-manifest` rather than changing the recorded fingerprint.

Every nonempty native tile requires one NBE1 artifact and a remote receipt with
the exact SHA-256, byte count, tile coordinate in its content-addressed path,
existing Site URL and verification timestamp. An empty field must have no native
artifact and zero native surface counts. Every tile must retain one local
step-4 NBE1 overview checkpoint, whose compressed and decoded hashes, sizes,
header geometry and threshold are checked.

The source-object JSONL ledger is deduplicated by native source coordinate.
Repeated identical hashes and sizes are counted as repeated observations;
conflicting source content is rejected. All planned input blocks must occur in
the ledger. Additional context objects are retained explicitly. Unique encoded
source bytes are reported separately from observation counts; the ledger is not
presented as a complete network-traffic log.

The completed overview builder's input manifest must refer to this exact run,
source ledger, plan and set of overview artifact hashes. Every HFM part is
checked locally, including its decoded hash, float32 format, counts and layout.
Part counts must match each LOD and remain within the existing 128 MiB total
decoded overview budget. Uploaded overview receipt files can contain one
receipt, an array of receipts, or an object containing a `receipts` array.

## Two-pass publication handoff

First upload the overview HFM parts through the established uploader and retain
its actual verified receipt files. Then run:

```sh
python scripts/guided-native-v21/finalize_manifest.py \
  --run {source-cache}/guided-native-v21/whole/run \
  --overview {source-cache}/guided-native-v21/whole/overview/manifest.json \
  --overview-receipts /path/to/overview-receipt.json /path/to/detail-receipt.json \
  --out {source-cache}/guided-native-v21/whole/final-manifest
```

The first pass writes both artifacts but marks the viewer index
`publishable: false`. Upload `evidence.json.gz` using the checksum and
`suggestedRemotePath` in `evidence-artifact.json`, retaining the verified receipt.
Rerun the same command with:

```sh
  --evidence-receipt /path/to/evidence-receipt.json
```

The evidence bytes remain identical. The second pass validates that receipt,
adds the verified evidence URL to the compact index and marks it publishable.
Upload `manifest.json.gz` using `artifact.json` and retain its own verified
receipt before publishing the small static pointer. The pointer contract is:

```json
{
  "manifestUrl": "verified manifest upload receipt URL",
  "sha256": "compressed manifest SHA-256",
  "bytes": 0,
  "decodedSha256": "decoded manifest SHA-256",
  "decodedBytes": 0
}
```

Use actual values from the descriptor and verified upload receipt. The compiler
does not write or publish that pointer automatically.

## Browser contract

Each `tiles` entry contains only `xyz`, `url`, `sha256`, `decodedSha256`, `bytes`,
`decodedBytes`, `vertices` and `triangles`. The default `overview` selects the
builder's `overview` LOD; `--overview-lod` can select another existing LOD.
`overviewLods` lists the available alternatives. Each LOD has a `parts` array
with full URL/hash/byte/count/HFM metadata, plus aggregate counts and bounds.
All parts of a selected LOD are one display transaction.

`evidenceLedger` supplies the separate artifact's hashes and byte counts. Its
URL and verified status appear only after the evidence upload receipt is
validated. `browserLoadRequired` is always false; the browser never needs the
full source ledger to open the heart.

Coverage includes the exact planned/completed block counts and native-only,
blended and prior-only stored edge counts. Those totals include shared-boundary
duplicates. They are not unique vertices, disjoint surface area, or anatomical
coverage percentages. The manifest retains an explicit description of the
coarse-guide blind spots, denoising/blending losses, separate overview sampling,
and the limited reference of the 0.31015625 µm crossing-encoding bound.

## Pilot and refusal checks

The completed hosted eight-tile pilot validates with eight real native upload
receipts, eight local overview checkpoints and 64 unique original N5 objects.
It contains 3,519,377 native-grid triangles and 1,795,121 stored crossings:
1,786,641 native-only, 8,480 blended and zero prior-only.

The offline test used explicit local overview/evidence receipt fixtures with
`fixture: true`, `verified: false` and the reserved `example.invalid` origin.
These require **both** `--allow-pilot` and `--fixture-receipts`; production
invocations reject them, and fixture output is never marked publishable.
No production verification was fabricated and no network request was made.

The 17 checks cover deterministic JSON/gzip, evidence stability across the
second pass, the production browser validator, strict missing/foreign/duplicate
record rejection, mismatched/unverified/foreign-URL receipts, contribution
accounting, and conflicting source hashes. The compact pilot index is 13,312
decoded bytes and 4,280 gzip bytes; its complete evidence ledger is 33,293
decoded bytes and 10,296 gzip bytes. These are pilot measurements, not projected
whole-bank file sizes.

`verify-finalize-manifest.py` reproduces the offline checks.

The additional scope check rejects a completed alternate small plan when the
caller omits `--allow-pilot`; it cannot receive a `whole-plan` label.

## Release report after completion

After the whole run, overview build and publishable final manifest are complete
at their standard paths, run:

```sh
python scripts/guided-native-v21/write_release_report.py
```

This writes `docs/guided-native-v21/README.md` and `release-report.json` from the
actual completed counts, LOD measurements and verified artifact identities. It
uses the same independent whole-plan pins, refuses incomplete or non-publishable
inputs, and does not upload or publish. Explicit pilot validation requires a
separately named output under `/tmp`; its completion scope and receipt fixtures
stay visible. [verify-release-report.py](verify-release-report.py) records 20
offline checks, including refusal gates, deterministic output, the actual
selected plan identities and completed-bank metadata joins.
[release-report-verification.json](release-report-verification.json) records
their results. The production README is not written by these checks.

The report joins the verified native index to the original overview inputs by
source block coordinate and checks both against the hashed completed records.
It refuses an index that omits a nonempty native record. In the completed bank,
**748** nonempty native tiles, containing **78,946** native triangles, have zero
triangles in their step-4 overview checkpoints. This measures display omission
before simplification; all **33,046** nonempty native entries remain in the
native index. The generator derives the count from its inputs rather than
hardcoding the measured result. Its JSON summary preserves this distinction in
`overviewSampling`. Native-only, blended and prior-only counts remain stored
edge-crossing categories with shared-boundary duplicates, never area fractions.

The generator also streams the original-object observation log and reproduces
the finalized canonical deduplicated SHA-256 before reporting generation
availability. The measured bank has **213** objects without GCS generation
metadata, all observed only from existing caches; each retains its exact byte
count, SHA-256 and coordinate. `sourceGenerationMetadata` records those counts
and identity hashes. This does not infer unavailable generation identifiers or
mistake observations for total network traffic. The separate
[completed-bank audit](completed-bank-audit.json) and its
[reproducible checker](verify-completed-bank.py) verify exact plan coverage,
native historical receipts and every local overview hash without downloading
the native bank again.

Production reports also include the official whole-heart detail figure beside
the separate denoising comparison. The figure validator matches the render
record's whole-plan identity, exact completed overview-manifest hash, detail
LOD counts, compressed and decoded HFM part identities, coordinate transform,
render policy and all PNG byte hashes. The caption identifies the 2.5-million-
triangle, 79.4 µm step-4 lossy navigation display and its open cutaway; it does
not label that figure as the 19.85 µm native bank or a browser screenshot.
Pilot report fixtures neither load nor include this whole-heart figure.
