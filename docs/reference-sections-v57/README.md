# Prepared reference sections: setup, coverage and QC

The prepared-section implementation and Fit Ultrasound default were integrated
in commit `a0d23102324f77704c9122d4a63d7276c80f080f`. The owner subsequently
approved publication of the generated-data inventory and QC material. This
follow-up makes the approved bank reproducibly restorable without checking
184 MB of derived scalar binaries into the source repository.

## Restore the published bank

Complete the normal [asset setup](../open-source/assets.md) first. From the
repository root, using Python 3.9 or later:

```sh
python3 scripts/fetch-assets.py --manifest docs/reference-sections-v57/asset-manifest.json --group runtime
python3 scripts/reference-sections-v57/activate-bank.py
```

Run activation only after restoration succeeds. It independently verifies all
272 local files (three donor manifests and 269 unique scalar payloads), their
exact sizes and SHA-256 hashes, and the approved configuration before enabling
the bank. The bank inventory totals **184,060,285 bytes**; its separate active
configuration is 1,719 bytes. `--check` verifies the bank without changing the
configuration. `--root /path/to/checkout` selects another checkout.

The source checkout deliberately retains an empty
`public/reference-sections-v57.js` until activation. This prevents a fresh clone
from requesting absent prepared files. The helper atomically installs the
verified `prepared-bank-config.js` from this directory; it refuses to overwrite
a custom configuration, rejects symlink destinations, and is idempotent.
Missing or corrupt assets leave the previous configuration unchanged. The
existing fine-sampler path remains the fallback. The activator itself performs
no network requests and never changes source scan data.

The download inventory pins the existing hosted objects. Its publication does
not assert a new network availability check. Failed transfers must not be
accepted by relaxing hashes; use a complete verified local bank or regenerate
from the original source data instead.

## Coverage

| Donor | TTE selections | TEE selections | Acquired views with CT crop and full face | Outside the acquired scan |
| --- | ---: | ---: | ---: | ---: |
| LADAF-2021-17 | 28 | 28 | 49 | 7 |
| S-20-29 | 28 | 28 | 49 | 7 |
| S-20-28 | 28 | 28 | 49 | 7 |
| Total | 84 | 84 | 147 | 21 |

There are 294 raster roles, deduplicated into 269 payloads. Prepared sections
are donor-specific and bound to the exact accepted plane and source identity.
The full cut-face raster covers the plane through the source volume; it is not
merely the smaller CT/reference crop enlarged over the rest of the face.
Moving away from a prepared plane uses the existing measured fine-data path,
not a stretched or stale prepared image.

The seven outside-scan entries per donor are TTE subcostal IVC, subcostal hepatic,
and suprasternal arch, plus TEE descending aortic short axis, descending aortic
long axis, upper-esophageal arch long axis and upper-esophageal arch short axis.
They retain explicit absence-of-target messages and whole-heart context; no
measured cutaway is fabricated for anatomy absent from the acquisition.
SlicerHeart and cMAC have separate clinical workspaces and are not additional
HiP-CT donor banks in this 168-selection atlas.

## Resolution and delivery

The prepared rasters preserve the existing measured **79.4 micrometre** display
source for LADAF and S-20-28 and **79.56 micrometre** source for S-20-29.
They use cleaned, windowed 8-bit display voxels and lossless row-difference/gzip
transport. They are not the original native approximately 19.85 micrometre
quantitative acquisition, and display interpolation does not create new
anatomical information.

Median paired CT/full-face payloads are 1,496,997 bytes for LADAF, 1,351,833 bytes
for S-20-29 and 1,388,722 bytes for S-20-28. The previous median fine-brick payloads
were 88,920,244, 85,296,531 and 96,638,915 bytes respectively. See
[payload-size-comparison.json](payload-size-comparison.json) for exact per-donor
summaries. These are manifest-derived transfer sizes, not measured page-load
times or speedup factors on a particular device.

## Video sizing

Each new reference selection starts in Fit Ultrasound. Full Frame is a temporary
choice for the current selection; selecting the next reference restores fitted
sizing. Recordings without a reviewed focus crop retain the complete frame.
The previous source-aware angle policy remains: native scanner displays take
precedence, and labelled REF supplements are added only where reviewed metadata
permits them.

## Inspectable evidence

- [Source provenance](input-provenance.json), [source recovery](source-recovery-qc.json),
  [generation](generation-qc.json), and [plane parity](plane-integration-parity.json)
  retain the original preparation checks and their limitations.
- [Numerical QC aggregate](qc-summary-aggregate.json) records 935,946 exact
  independent source-point comparisons with zero mismatches, and identifies the
  SHA-256 of the complete per-raster evidence in the companion review archive.
- [Runtime QC](runtime-qc.json) records all 294 metadata roles and decoding of
  12 representative largest real rasters through the production cache.
- [Live QC](LIVE-QC.md) describes the recorded version-94 browser pass. Its
  complete original record is retained losslessly in
  [live-browser-qc.json.gz](live-browser-qc.json.gz), not a new browser run.
- [Publication recovery checks](publication-recovery-check.json) distinguish the
  later offline identity and metadata validation from the earlier live/data QC.
- The three [contact sheets](contact-sheets/) show all 147 generated full faces.
  They are data-review figures, not screenshots proving current website state.

To inspect the compressed live record with the Python standard library:

```sh
python3 -c "import gzip; print(gzip.open('docs/reference-sections-v57/live-browser-qc.json.gz', 'rt').read())"
```

Compressed SHA-256:
`be886785616b0b3bdd7825208a3e5e0241b166c0869ad8e713d0b937b1d2d215`.
Decompressed original SHA-256:
`ac1a38d99e367eeea531a3fee18b5f4bcde6d2e943fe06f86744d5eff5c8ce5e`.

The detailed 18-file review archive remains an additional delivered artifact.
The large per-raster QC JSON and restored donor runtime manifests are not all
stored as raw source files in this commit. Runtime manifests are included in
the checksummed bank download. Private hosting configuration, credentials,
transport receipts and excluded clinical media are not part of this publication.

## Reproduce the data

Use the retained [generation and scientific QC instructions](METHODS-AND-QC.md#reproduce-the-data)
and [test commands](TESTS.md). `METHODS-AND-QC.md` is the original, unchanged
release report. Its historical references to generated evidence being held or
excluded describe the earlier source-only release; this README describes the
current approved publication scope.

The ten additional offline activation tests run with:

```sh
python3 tests/test_activate_reference_bank_v57.py -v
```

The source, numerical, and browser checks do not establish clinical registration
accuracy, native-resolution equivalence, physical iPad/Safari performance, or
cold-network latency. Preserve these distinctions when describing the results.

## Attribution

Dataset derivatives and contact figures retain their CC BY 4.0 provenance,
individual dataset creators, Human Organ Atlas Collaboration/ESRF attribution,
source DOIs, and modification notices in the asset inventory. The source-code
license is separate. Existing restrictions on external recordings and clinical
datasets are unchanged; see [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).
