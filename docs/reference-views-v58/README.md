# Reference illustration review, revision 58

> **Targeted follow-up:** the v58 PLAX mitral (`tte:plax_mv`) pass was superseded after residual atrial-wall and outflow ambiguity was identified. See [revision 59](../reference-views-v59/README.md). The v58 manifest and pixels remain historical evidence; the other 55 entries are unchanged by this follow-up.


This revision reviews the **28 TTE and 28 TEE illustrations individually**. It
preserves the original palette and drawing language while treating anatomical
connections, imaging-plane identity, orientation and readable labels as release
requirements. The previous v54 `approved` fields are historical records of an
earlier review; they do not establish the outcome of this review.

**Outcome:** 49 illustrations retained and seven replaced: four TTE and three
TEE. Five replacements correct anatomical depiction problems; the RV-focused
TTE and transgastric RV inflow–outflow TEE replacements improve framing or
outlet clarity. The [complete per-view audit](AUDIT.md) records the individual
decisions, revised candidates, retained-view qualifications and exact prompts.
The selected replacements preserve the original ivory/terracotta style.

The [guidelines](GUIDELINES.md) explain the source comparison and rejection
criteria. The [asset manifest](asset-manifest.json) records each current
decision, its anatomical reasoning, its reference sources, and exact image and
thumbnail hashes. A `pending` entry is unfinished work, never a passing review.

## Runtime mapping

`public/reference-artwork-v58.js` is generated from the complete manifest.
Both `tte-atlas-data.js` and `tee-atlas-data.js` use that exact registry. Gallery
cards, detail illustrations and the existing lab links consume the same
catalogue. There is no network lookup, image-error handler or silent fallback to
rejected artwork. An unknown view ID is an error.

An explicitly retained view keeps its exact v54 image and thumbnail. An accepted
replacement uses `public/assets/reference-views-v58/<mode>-<id>.webp` and the
corresponding `thumbs/` file. The historical v54 bytes and manifest remain intact
for comparison and rollback. Keeping a historical file is not an endorsement of
its anatomy in the current catalogue.

## Review record format

The input is a JSON array (or an object with an `entries` array) containing
exactly one record for each of the 56 existing `(mode, id)` pairs. This example
shows the schema; its passing fields are illustrative, not an assertion that
this view has passed:

```json
{
  "mode": "tte",
  "id": "plax_mv",
  "disposition": "replace",
  "review": {
    "status": "pass",
    "original_findings": ["Describe the observed defect in the previous image."],
    "summary": "Describe what was actually inspected in the selected final image.",
    "phase": "Diastole: mitral leaflets open; specify other depicted valves.",
    "independent_review": "Identify the separate visual review and its conclusion.",
    "checks": {
      "topology": true,
      "view_identity": true,
      "orientation": true,
      "labels": true,
      "phase": true,
      "readability": true
    },
    "full_size_reviewed": true,
    "thumbnail_reviewed": true,
    "hard_failures": [],
    "sources": [
      {
        "url": "https://www.asecho.org/wp-content/uploads/2019/01/2019_Comprehensive-TTE.pdf",
        "figure": "Table 2, row 2.4",
        "purpose": "View identity, LA–MV–LV continuity and aorto-mitral relationship"
      }
    ]
  },
  "generation": {
    "tool": "image_gen",
    "output_path": "/absolute/path/to/selected-square-master.png",
    "prompt": "The exact final generation or edit prompt.",
    "references": [
      {
        "path": "/absolute/path/to/internal-reference.png",
        "url": "https://www.asecho.org/wp-content/uploads/2019/01/2019_Comprehensive-TTE.pdf",
        "role": "Anatomical reference, not redistributed artwork"
      }
    ]
  }
}
```

Use `disposition: "retain"` for a deliberately accepted current image and omit
`generation`; it must pass the same review fields. Do not copy passing values
into uninspected entries. A working `pending` record needs `review.status` set to
`pending` and an explanation of what is unresolved. It is permitted only with
the explicit development-only `--allow-pending` option.

Packaging reads square masters of at least 960 pixels, resamples them uniformly
to 960 and 384 pixels, and encodes WebP at quality 91. It does not crop, paint,
repair anatomy, rewrite labels or composite published reference figures. It
stores the exact generation prompt, master hash and reference-input hashes.

```sh
python3 scripts/prepare-reference-icons-v58.py --reviews /absolute/final-reviews.json
python3 scripts/prepare-reference-icons-v58.py --reviews /absolute/final-reviews.json --write
python3 scripts/prepare-reference-icons-v58.py --verify
node --test tests/tte-atlas.test.mjs tests/tee-atlas.test.mjs
```

The first command checks and reports the proposed package without writing it.
The final verification must run **without `--allow-pending` before publication**.
It checks all 56 decisions, 112 active asset hashes and dimensions, historical
asset preservation, exact runtime mapping and registry/manifest agreement.
These checks establish the integrity of the reviewed files, not their anatomy;
the anatomical evidence is the per-image visual review.

The complete readable audit and a standalone HTML report can be regenerated
from the accepted manifest and the exact project image files:

```sh
python3 scripts/build-reference-audit-report-v58.py --html /absolute/Heart-Explorer-TTE-TEE-QC.html
```

The HTML embeds the seven before/after pairs and 49 retained thumbnails, with
searchable per-view records and the complete guidelines. It includes this
revision's exact generation prompts and preceding prompts. Original authoring
prompts remain in the immutable historical manifest. Published source figures
are linked for comparison and are not embedded in either report.

## Hosting and scope

The v58 WebP files are ordinary static assets. They are not part of the frozen
v57 reference-static collection, and no storage population or upload gate is
needed. Preserve the existing hosted-build stages, including the v54 stage that
still verifies its historical files and the final v57 read-only staging step.
Run the v58 verification before packaging. Measure both compressed and expanded
deployment archive sizes against the existing 256 MiB limit.

Prepared v57 rasters are intentionally absent from Git and must be restored
from their permitted, checksummed asset manifest before a complete hosted build.
The older immutable-bank stages do not detect their absence. After the final
build and staging sequence, run this separate hosted preservation check:

```sh
python3 scripts/verify-reference-hosting-v58.py --report .sites-runtime/reference-hosting-v58-verification.json
```

It checks every permitted v57 runtime manifest asset in both the source tree and
`dist/client`, including byte counts and SHA-256. It performs no downloads or
source/build modifications and fails on missing or corrupt files. A public
source checkout can still run the general artwork tests without acquiring the
full prepared section bank; this check is specifically for the complete hosted
deployment.

This change does not redefine donor CT planes, scan coverage, ultrasound media,
probe calibration or scientific acquisition data. Source comparison of an
educational schematic is distinct from independent clinician sign-off and from
registration to any specific donor or clinical recording.
