# Local development

Start with [README.md](README.md). The public distribution uses the portable viewer and separately restored, verified assets.

- [Development and checks](docs/open-source/development.md)
- [Asset setup and licenses](docs/open-source/assets.md)
- [Scientific methods and limits](docs/open-source/methods.md)

Historic research reports in `docs/` describe prior runs; they do not certify that omitted native caches, hosted banks, external recordings, or clinical payloads are present in this distribution. Provision your own hosting project before using optional cloud deployment.

## Prepared reference cutaways

The public source includes the prepared-section runtime, generators, tests,
approved asset inventory, contact sheets, provenance and QC evidence. The
approximately 184 MB generated bank remains separately downloadable instead of
being committed as scalar binaries. After completing normal asset setup:

```sh
python3 scripts/fetch-assets.py --manifest docs/reference-sections-v57/asset-manifest.json --group runtime
python3 scripts/reference-sections-v57/activate-bank.py
```

Run activation after restoration succeeds. It independently checks all 272
asset sizes and SHA-256 hashes and then installs the matching configuration
atomically. Missing or corrupt assets do not enable a partial bank; custom
configuration is never silently replaced. Add `--check` to verify without
writing. The empty source template intentionally retains the fine-sampler
fallback until the complete prepared bank is available.

See [prepared-bank setup and QC](docs/reference-sections-v57/README.md) for
coverage, hashes, tests, provenance and offline regeneration. The bank supplies
measured 79.4/79.56 micrometre CT crops and full cut faces for 147 acquired
reference entries, with 21 explicitly outside-scan entries. Arbitrary plane
edits still use the existing fine-data banks. This is not the original native
19.85 micrometre acquisition or a clinically validated registration.

Private hosting material and externally restricted clinical/media payloads
remain excluded. The existing license and attribution boundaries are unchanged.
