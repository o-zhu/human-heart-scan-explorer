# v57 implementation and production-cache checks

The included regression set passed **76 Node test cases and 11 Python tests**.
Four additional DOM/controller scripts passed with the existing full-source
fixtures. The production-cache check separately validated **294 acquired role
records across 168 donor/view combinations**, retained all **21 outside-scan
views** without measured records, and decoded **12 actual large rasters** to
their original pixel checksums.

These recorded checks ran on Linux with Node.js 24.22.1. The framework build used
the declared pnpm 11.25.0 dependency lock. The full-bank results below used the
completed generated bank and the stated source fixtures. This source-only
checkout includes test code and readable summaries; generated plane/data indexes,
contact figures and detailed machine-readable receipts are separate deliverables.
Its empty prepared-bank configuration retains the existing fine-sampler fallback
without requesting omitted prepared assets.

A focused rerun with that empty configuration passed all **29 cache/controller
tests**. The full hosted release separately passed 14 Node and 7 Python checks
for private deployment behavior; those implementation/test files are not
included in this public update and are not counted in the 76/11 totals above.

## Regression results

| Suite | Result | Main coverage |
| --- | ---: | --- |
| `tests/reference-section-cache-v57.mjs` | 16 / 16 | Exact source and plane identity; raw and row-delta decoding; original pixel hashes; invalid manifests; size bounds; aborts, retries, priorities and decoded LRU |
| `tests/echo-reference-sections-v57.mjs` | 13 / 13 | Independent CT/full-face completion; stale and moved planes; exact fine fallback; correct pending/error labels; retention of an already completed face |
| `tests/echo-cut-face-v42.mjs` | 23 / 23 | Complete cut-face geometry, CT crop separation, cleanup behavior, sampling cancellation and CPU/picking behavior |
| `tests/echo-fit-native-dials-v57.mjs` | 1 / 1 | All 26 reviewed native TEE dial bounds remain within the current Fit Ultrasound crop |
| Existing core CI Node suites | 23 / 23 | Device resource bounds, mesh draw batching, source-reviewed angle placement and cut-face picking |
| `tests/test_fetch_assets.py` | 11 / 11 | Existing public asset-downloader integrity fixtures |

The four standalone controller checks were `echo-reference-player-v39.mjs`,
`echo-media-loading-v46.mjs`, `echo-angle-source-binding-v56.mjs` and
`tee-atlas-ui.mjs`. They covered Fit defaults and temporary Full Frame choices,
playback without unnecessary reloads, real verified MP4 Blob URLs, stale
metadata/download rejection, selected-source angle policy, and all 28 TEE view
selections. Their optional LinkeDOM dependency is a test fixture, not a runtime
requirement.

The recorded framework build, Python syntax checks and `git diff --check`
passed. Private deployment validation is separate from this public source
update; the public hosting configuration retains its previous implementation.

## Actual generated rasters through the production cache

`tests/reference-sections-runtime-v57.mjs` reads the frozen production-plane
export and the final donor manifests. It checks every CT and full-face record's
source identity, physical plane, dimensions, spacing and cleanup identity before
loading pixels. For each donor it then selects the largest decoded raster in
each of four categories: TTE CT, TTE full face, TEE CT and TEE full face.

Each selected payload passed the production compressed-byte checksum, bounded
gunzip, per-row modulo-256 inverse and original-pixel checksum. The returned
dimensions and physical plane also matched. The decoded cache remained within
its **25,165,824-byte (24 MiB)** limit and released its entries on destruction.

| Donor | Verified metadata roles | Loaded role categories | Largest loaded raster | Observed peak decoded cache |
| --- | ---: | ---: | ---: | ---: |
| LADAF 2021-17 | 98 | 4 | 9,678,500 bytes | 21,090,366 bytes |
| S20-29 | 98 | 4 | 7,994,592 bytes | 20,121,971 bytes |
| S20-28 | 98 | 4 | 9,762,600 bytes | 22,974,132 bytes |

The largest loaded raster remains below the per-result 12 MiB decoded bound.
The cache totals concern retained decoded entries; they do not measure the
entire application's CPU/GPU memory. Detailed selected-view identities and
checksums are retained in the separate generated test evidence.

The tested frozen export SHA-256 is
`56f93ccd1a45ff75609639d641076a970ad705a12aa3afb93a4bbe1f88257ab5`.
The unchanged Echo producer SHA-256 is
`2c76a8597072eb78bc9e22fd170f57c63e082ff1d3e3f8900e9083f5a25b601c`.

The runtime check is a Node execution of the actual cache with local, exact
Response bodies. It establishes decoder, identity and cache behavior. Browser
presentation, hosted transport and device performance require their separately
recorded reviews. Whole-bank independent source-sampling QC is documented in
[the generation record](README.md); the 12 loaded runtime cases are not a claim
that this fixture decoded all 294 roles.

## Reproduce the checks

The source-only focused suites can run from a public clone:

```sh
node --test --test-concurrency=1 tests/reference-section-cache-v57.mjs tests/echo-reference-sections-v57.mjs tests/echo-cut-face-v42.mjs tests/echo-fit-native-dials-v57.mjs
python3 tests/test_fetch_assets.py
```

The standalone media/controller runs used existing authorized source fixtures.
A clone without those media files must retain the scripts' explicit skips or
supply an authorized local fixture root; no excluded binaries are included to
force a fixture pass.

First generate a local frozen export and verified bank with the included
[generation workflow](README.md#reproduce-the-data). Then run the complete
real-bank cache check against those local outputs:

```sh
node tests/reference-sections-runtime-v57.mjs --require-fixtures \
  --planes=/path/to/build/planes-v57.json \
  --bank=/path/to/build/bank \
  --out=/path/to/build/runtime-qc.json
```

`--require-fixtures` makes missing input an error. Without it, an unrestored
public clone explicitly skips the real-bank check and reports that no production
metadata or pixel verification occurred. This command creates a local detailed
receipt; it does not depend on a generated report omitted from this repository.
Existing source-asset restoration remains governed by the original public
inventory; tests do not establish additional redistribution rights.
