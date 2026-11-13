# Prepared fine sections for every supported reference view

This release prepares the exact default Reference Views planes for all three
preserved HiP-CT hearts. Each acquired view has two independent scalar rasters:
the existing CT viewport crop and a full cut face that covers the intersection
of the same physical plane with the source volume. Preparation uses the existing
production fine-volume sampler and the original immutable fine-brick bytes.

The published release also passed a [live check of all 168 reference selections](LIVE-QC.md),
including all three donors and the Fit Ultrasound selection behavior.

## Public source contents

This public update includes the runtime, an empty prepared-bank configuration
template, generators, tests and readable QC summaries. Generated plane exports,
donor/data indexes, scalar payloads, contact figures and detailed machine-readable
QC are separate deliverables and are **not included in this source checkout**.
The coverage and measurements below describe the validated published bank.

The empty configuration prevents requests for missing prepared assets. Existing
fine-source restoration and the bounded fine-sampler fallback remain available;
missing source data keep their existing unavailable/Preview behavior. To build a
local prepared bank, use the reproduction workflow below, verify its results,
and install the complete generated `staged-public` tree with its matching
configuration. No omitted generated-data index is required to start that workflow.

## Coverage and source resolution

| Source | Source grid | TTE views with acquired data | TEE views with acquired data | CT and full-face roles |
| --- | ---: | ---: | ---: | ---: |
| LADAF-2021-17 | 79.4 µm | 25 | 24 | 98 |
| S-20-29 | 79.56 µm | 25 | 24 | 98 |
| S-20-28 | 79.4 µm | 25 | 24 | 98 |
| Total | Donor-specific | 75 | 72 | 294 |

The atlas contains 56 views per donor, or 168 entries. The 147 acquired entries
receive both rasters. The 21 existing out-of-scan entries retain their reasons
and null CT/face records. For each donor these are TTE `subcostal_ivc`,
`subcostal_hepatic`, `ssn_arch`, and TEE `daosax`, `daolax`, `uearchlax`,
`uearchsax`. No extracardiac data are invented for those views.

The separate cMAC and SlicerHeart clinical workspaces do not use this static
56-view atlas. They retain their own measured acquisitions and controls.

## Measured bank size and per-view payload

All 294 roles are prepared. Exact geometry gives 282 distinct sampling jobs;
byte-identical results share content-addressed files, leaving 269 payloads.
The complete runtime tree contains 184,062,004 bytes: 183,667,528 payload bytes
and 394,476 bytes for the three manifests and configuration. It contains only
the prepared scalar bank and its metadata; the source 3D datasets remain in
their existing collections.

| Source | Distinct payload files | Payload bytes | Median CT + face bytes per view | Maximum CT + face bytes per view |
| --- | ---: | ---: | ---: | ---: |
| LADAF-2021-17 | 96 | 68,498,121 | 1,496,997 | 2,090,285 |
| S-20-29 | 87 | 56,516,331 | 1,351,833 | 1,988,199 |
| S-20-28 | 86 | 58,653,076 | 1,388,722 | 2,084,231 |

These per-view figures count identical payload hashes once within a view. They
do not imply downloading the complete bank on entry: the selected view requests
its own CT crop and full face.

| Source | Median original fine-brick count per view | Median original fine-brick bytes | Median reduction in per-view scalar payload |
| --- | ---: | ---: | ---: |
| LADAF-2021-17 | 501 | 88,920,244 | 55.77× |
| S-20-29 | 571 | 85,296,531 | 64.05× |
| S-20-28 | 631 | 96,638,915 | 61.70× |

The comparison is calculated from the immutable manifests for a single default
view with cold data caches. It is a transfer-size comparison, not a measured
browser speedup. The median ratios are calculated per view, rather than by
dividing the two independent medians. Detailed timing, encoding and per-view
size records belong to the separate generated evidence deliverable; the tables
here retain the aggregate results.

## Interpretation of source resolution

These are the existing cleaned, windowed, unsigned 8-bit display samples at
79.4/79.56 µm, reformatted with trilinear interpolation. They are not the original
quantitative 16-bit acquisition or the separately inspected 19.85/19.89 µm native
surface. The manifest records actual raster spacing on both image axes; rounding
the number of pixels can make the output spacing slightly finer than the input
grid without adding source information.

## Why this bank is needed

The initialized production controller makes every current default plane
`atlasDerived`. Consequently none of the old prepared reference textures is
eligible for these exact accepted planes. The old fine-bank path can still
sample them, but a full face typically needs hundreds of independently verified
fine bricks. A quick resident-volume preview can remain visible while this work
finishes. The small persistent section cache also cannot retain many full-size
faces because they exceed its per-image limit.

The new bank makes the exact source pixels directly available for each default
view. CT and full-face requests can finish independently; the runtime validates
each result against the current donor, source identity and physical plane before
installation. A changed offset, tilt, rotation, source or crop continues through
the existing source sampler. Failed or stale prepared results do not supply
pixels to a different plane.

## Scientific identity and immutable inputs

The frozen plane export comes from the initialized production `EchoModule`,
including donor volume setup, source review, reference anatomy, frame rebuilding
and `getPlane()`. The full face comes from `fullEchoCutFacePlane()` with two
source pixels of padding. `planFinePlane()` supplies the production grids and
required brick lists. The generator refuses an export if any captured source
file has changed.

The before/after integration comparison deep-compares all 168 row objects and
all three source objects. Accepted planes, full-face crops, raster dimensions,
spacing, source identities and brick sets remain identical; the captured
`echo.js` implementation hash is the only changed source fingerprint.

The original source windows, cleanup support fields, crop origins and brick
layout remain fixed. Existing source manifests and scientific assets are never
rewritten by these tools. `recover-bricks.py` can reproduce a required fine bank
from its established public original N5 `s2` acquisition. It uses each donor's
retained source-chunk index, exact historical quantization and existing support
mask. Both the decoded voxel SHA-256 and the original gzip bytes/length/SHA-256
must match before a restored brick is atomically installed. A mismatch stops
recovery; it is not accepted as a revised dataset.

All 17,121 required bricks were restored and verified: 4,918 for LADAF-2021-17,
5,787 for S-20-29, and 6,416 for S-20-28, totaling 2,604,389,615 encoded bytes.
The final required-brick unions exactly match the frozen production export.
The S donors additionally match retained encoded and decoded hashes for their
original N5 chunks. LADAF's retained original support index lacks those earlier
N5 hashes; its proof is the exact original decoded and encoded fine-brick
identities. The detailed recovery records are a separate deliverable; this
summary preserves the distinction between those evidence levels.

The recorded original source bases are:

- LADAF: `https://storage.googleapis.com/ucl-hip-ct-35a68e99feaae8932b1d44da0358940b/LADAF-2021-17/heart/19.85um_complete-organ_bm18/s2/`
- S-20-29: `https://storage.googleapis.com/ucl-hip-ct-35a68e99feaae8932b1d44da0358940b/S-20-29/heart/19.89um_complete-organ_bm18/s2/`
- S-20-28: `https://storage.googleapis.com/ucl-hip-ct-35a68e99feaae8932b1d44da0358940b/S-20-28/heart/19.85um_complete-organ_bm18/s2/`

See the original preparation methods in `scripts/prepare_hosted_sections.py`,
`scripts/prepare-donor-v10.py`, the donor source-chunk indexes in `docs/donors/`,
and the immutable fine manifests under `public/assets/`. The bank does not
require unrelated original native-resolution chunks.

## Reproduce the data

Node 22.13 or newer runs the controller export and production sampler. Python,
NumPy, Pillow and either system `libblosc` or Python `blosc2` support source
recovery and independent QC. Choose a private build directory outside the
repository; the original acquisition cache and restored bricks are build inputs.
These commands create a new local export, bank and QC output. They do not read
an omitted generated index from this source checkout.

```sh
node scripts/reference-sections-v57/export-planes.mjs --out=/path/to/build/planes-v57.json

python3 scripts/reference-sections-v57/recover-bricks.py \
  --planes /path/to/build/planes-v57.json \
  --build-root /path/to/build --proof 1 --workers 8

python3 scripts/reference-sections-v57/recover-bricks.py \
  --planes /path/to/build/planes-v57.json \
  --build-root /path/to/build --workers 8

node scripts/reference-sections-v57/generate-sections.mjs \
  --planes /path/to/build/planes-v57.json \
  --source-root /path/to/build/recovered \
  --output /path/to/build/bank

python3 scripts/reference-sections-v57/qc-sections.py \
  --planes /path/to/build/planes-v57.json \
  --source-root /path/to/build/recovered \
  --bank-root /path/to/build/bank \
  --output /path/to/build/qc
```

After the complete generation and independent QC pass, install the contents of
`/path/to/build/bank/staged-public/` into your own local `public/` directory.
Install the data and generated `reference-sections-v57.js` together: that
configuration replaces the empty source template and pins the matching donor
manifests. Keep the generated bank, indexes, figures and detailed reports
outside this source-only update. A partial bank or mismatched configuration
must not be enabled.

An already restored immutable bank can be used directly with `--source-root`;
no source download is performed by `generate-sections.mjs` or `qc-sections.py`.
The generator also accepts `--inspect-only`, `--donor` and `--max-rasters` for
an input audit or a bounded pilot. An incomplete run exits with status 2 and
reports missing inputs or ungenerated roles explicitly. Each successful raster
has an atomic checkpoint. A resumed run must match the frozen export, sampler,
source and URL identities, and it rechecks completed output hashes before reuse.

Source reconstruction checks every requested immutable brick. The generator
uses a 256 MiB decoded-brick cache and eight concurrent local reads; independent
QC uses a 96 MiB cache. Neither generation stage loads a complete fine volume.
The executed recovery used Python 3.12.14 and zlib 1.3.2, with gzip level 3,
timestamp zero and Linux OS byte 3 to reproduce the original brick encoding.
A future environment that produces different gzip bytes is rejected even if
the decoded values match; the original immutable identities remain authoritative.

## Output contract

The final `gzip-r8-delta-v1` codec losslessly encodes row-major scalar pixels.
The first byte in each row is unchanged; every following byte is the current
original byte minus the preceding original byte, modulo 256. Gzip level 9 then
compresses these differences. Decoding first gunzips to the exact bounded raster
length, then computes a modulo-256 cumulative sum independently in each row.
The original pixel SHA-256 is checked only after this inverse. Decoding restores
every original byte; plane sampling, quantization and source intensities are
unchanged.

Every record carries compressed and original-pixel SHA-256 values, byte counts,
dimensions, both physical pixel spacings, source spacing, and the exact
center/axes/width/height of its own plane. Content-addressed payloads can be
shared only when their verified bytes are identical. The loader retains support
for ordinary `gzip-r8`, while the final bank consistently uses the explicitly
versioned delta codec. A generic gunzip of a final payload yields differences;
it must apply the declared inverse before interpreting values as pixels.

The memory-only three-raster benchmark reduced 3,390,212 ordinary gzip-9 bytes
to 2,934,858 delta-gzip bytes, a 13.43% reduction, with byte-exact inverse results
for every pixel. This encoding choice provides archive headroom without changing
scientific data. The benchmark's local timings are recorded separately and are
not browser or device-performance measurements. Gzip level, filter definition,
zero timestamp and zlib version are part of each generation checkpoint identity.

The already completed LADAF ordinary-gzip bank and its original checkpoints/QC
were preserved before conversion. `--reencode-from VERIFIED_BANK_DIRECTORY`
verifies that bank's source, frozen planes, sampler and every payload, then
changes only lossless encoding into a separate output directory. Its checkpoint
records the prior manifest/checkpoint hashes, original pixel hashes and prior
sampling measurements. Conversion does not claim to have sampled the source
again.

The per-donor source identity includes donor ID, dataset ID, the production
`FineSectionStore` source key, cleanup-mask SHA-256, source spacing and physical
extent. The small generated configuration additionally pins each donor manifest
by SHA-256.

A donor receives its final manifest only after all 98 roles are ready. The
copyable `staged-public` tree and `reference-sections-v57.js` configuration are
created only after all three donor manifests and every referenced payload have
been reverified. Partial checkpoints never enable a runtime source.

For a local generated bank, preserve the paths in its matching generated
configuration and staged tree. Serve its gzip objects as opaque bytes without
HTTP `Content-Encoding`, because the loader verifies encoded bytes before
explicit decompression. Original scientific asset URLs and bytes remain unchanged.

## Quality checks and their scope

Every output role is checked for encoded and decoded hashes, exact exported
geometry and raster dimensions. The independent Python audit forms each pixel's
physical world point directly, transforms it into acquisition coordinates, and
interpolates eight source-brick corners without importing the JavaScript
rasterizer. For the delta codec, an independent NumPy row cumulative sum restores
the original pixels before hashing and source comparisons. It checks at least
1,024 unique positions per raster, plus additional
deterministic nonzero tissue, frame-edge and source-brick-boundary neighbors.
Any arithmetic-order difference within an exact half-integer rounding boundary
is reported separately from byte-exact agreement.

The full-face audit independently intersects the accepted plane with the source
box and checks coverage and coplanarity. Contact sheets show all 49 acquired
full-face rasters per donor using their original source-windowed R8 grayscale
values. Thumbnail reduction is only for reviewing the sheet; full-size bank
pixels are preserved.

All 294 final-codec roles passed the independent source audit: **935,946 exact
pixel comparisons**, with zero mismatches, zero half-integer rounding exceptions,
and no all-zero acquired rasters. Every original pixel hash was checked after
the independent lossless inverse. All 147 full-face source-box coverage checks
passed, and the 21 out-of-scan entries retain null rasters. Two implementation
reviewers and the coordinating reviewer inspected the three final contact
sheets; no blank panels, raster-edge clipping, missing strips or visible brick
seams were observed at that scale.

These checks establish data provenance, raster orientation, numerical sampling
and source coverage. The existing approximate specimen-to-clinical teaching
correspondence is unchanged. Clinical anatomical validation, physical-device
frame rates and browser rendering are separate checks.

## Included summaries and separate generated evidence

- This README records source resolution, aggregate bank sizes, source-recovery
  results, the generation method and numerical/visual QC scope.
- [TESTS.md](TESTS.md) records focused tests, fixture requirements and aggregate
  results from actual rasters through the production cache.
- [LIVE-QC.md](LIVE-QC.md) records the published site's all-view functional pass
  and the framing checks, including their device and timing limitations.

The generated plane export, donor manifests/data indexes, scalar bank, per-role
hash and source-point records, recovery/checkpoint records, timing reports and
contact figures are maintained as separate deliverables. They are not part of
this public source update. The included generators and QC scripts produce local
versions from the established source inputs using the workflow above; the
existing fine-source restoration and licensing rules are unchanged.
