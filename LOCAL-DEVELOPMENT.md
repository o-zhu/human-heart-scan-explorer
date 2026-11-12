# Local development

Start with [README.md](README.md). The public distribution uses the portable viewer and separately restored, verified assets.

- [Development and checks](docs/open-source/development.md)
- [Asset setup and licenses](docs/open-source/assets.md)
- [Scientific methods and limits](docs/open-source/methods.md)

Historic research reports in `docs/` describe prior runs; they do not certify that omitted native caches, hosted banks, external recordings, or clinical payloads are present in this distribution. Provision your own hosting project before using optional cloud deployment.

## Prepared reference cutaways

This source-only update includes the prepared-section runtime, generators,
tests and readable QC summaries. Its prepared-bank configuration is an empty
template, so a public clone does not request missing prepared manifests and
continues to use the existing fine-sampler fallback. The published bank's plane
exports, donor/data indexes, scalar payloads, contact figures and detailed
machine-readable QC are separate deliverables, not files included in this clone.

The existing [runtime and fine-source restoration](docs/open-source/assets.md)
remains unchanged. To create prepared data locally, follow the included
[generation and QC workflow](docs/reference-sections-v57/README.md#reproduce-the-data).
After generation and verification succeed, install the complete generated
`staged-public` tree into your local `public/` directory, including its matching
configuration. Keep those generated data outside the source-only commit.

The recorded published bank covers the measured 79.4/79.56 µm CT crop and full
cut face for 147 acquired reference entries, with 21 intentional outside-scan
entries. Arbitrary plane edits still use the existing fine-data banks. The
generation notes explain source identity, coverage and lossless encoding.
