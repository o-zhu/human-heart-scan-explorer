# Deployment and large-asset delivery

The existing demonstration is [Heart Explorer](https://human-heart-scan-explorer.zhuou557737.chatgpt.site). A public source release is separate from deployment of that site. Forks must use their own project identity, storage, and access configuration; do not overwrite the original deployment.

## Hosted code

The Python server is the lowest-dependency development route. The retained Vinext/Cloudflare wrapper builds with:

```sh
npx --yes pnpm@11.25.0 install --frozen-lockfile
npx --yes pnpm@11.25.0 build
```

The build emits client files and a Worker. The public source export removes the original Sites project identifier from `.openai/hosting.json`; retained binding definitions describe the application’s storage needs. A fork must configure an independently owned host and populate its own permitted assets. No credentials are included in public source.

A build does not seed R2, make missing assets available, or establish rights to publish a dataset. The Worker uses explicit allowlists and checksums for immutable collections. Historical upload gates must remain closed in a public final release.

The v57 public update is source-only: it includes the prepared-section runtime,
generators, tests, readable QC summaries and an empty prepared-bank configuration.
Generated plane/data indexes, scalar payloads, contact figures and detailed
machine-readable QC are separate deliverables. The empty configuration avoids
requests for omitted prepared assets while retaining the existing fine-sampler
fallback. To enable prepared sections on your own host, follow the included
[local generation workflow](../reference-sections-v57/README.md#reproduce-the-data),
verify the complete results, then install the generated `staged-public` tree
with its matching configuration. Existing fine-source restoration remains
unchanged. A source-only build does not reproduce the published site's bank.

## Asset serving requirements

The application uses same-origin browser modules and asset paths. A replacement host must preserve the requested paths or deliberately configure their manifests/adapters. Verify:

- Correct MIME types for modules/workers, JSON, images, video, and any standalone WASM used by the selected codec.
- Same-origin delivery or explicit CORS permission for the actual fetch and worker/media path.
- Byte-for-byte delivery of checksummed objects. Avoid automatic image optimization, text rewriting, or decompression of data whose stored bytes are hashed.
- Stored `.gz` payloads remain opaque bytes without automatic `Content-Encoding` decoding when the loader performs decompression.
- Byte-range support for enabled loaders that request ranges; complete-object loaders still need correct lengths and error statuses.
- Sufficient per-file and aggregate capacity, without putting large banks in ordinary Git or relying on a development server.

The local server supplies complete objects; it is not a general ranged-object service. Review the loaders for the selected feature. Vendor numcodecs currently embeds its codec WASM in JavaScript; retain its notices and verify the actual codec path instead of assuming a separate WASM file.

## Existing Sites staging sequence

These 14 stages preserve the existing public hosting arrangement and must run in this order after the framework build. They require matching local assets and verified, separately populated immutable storage. They remove verified redundant **build copies**; they do not acquire data:

```sh
python3 scripts/prepare-native-hosting-v20.py --stage
python3 scripts/prepare-fine-hosting-v23.py --stage
python3 scripts/prepare-motion-hosting-v24.py --stage
python3 scripts/prepare-cleanup-hosting-v28.py --stage
python3 scripts/prepare-display-compact-v29.py --stage
python3 scripts/prepare-cleanup-hosting-v30.py --stage
python3 scripts/prepare-local-hosting.py --stage
python3 scripts/prepare-tee-hosting-v4.py --stage
python3 scripts/prepare-bundled-json-v1.py --stage
python3 scripts/prepare-reviewed-mask-hosting-v32.py --stage
python3 scripts/prepare-coronary-hosting-v36.py --stage
python3 scripts/prepare-probe-heart-hosting-v44.py --stage
python3 scripts/prepare-reference-hosting-v54.py --stage
python3 scripts/prepare-hosted-display-v10.py --stage
```

Read each family’s hosting notes first. Restricted clinical/illustration assets omitted from a public package can prevent the historical full staging sequence from succeeding. Do not bypass these checks or republish omitted material to make a fork resemble the demo. Configure a reduced, rights-cleared deployment, or obtain permission and restore the exact assets.

The [v44 whole-heart hosting stage](../probe-heart-v44/hosting.md) moves only two verified duplicate build meshes to the existing immutable-storage arrangement. Its final mode requires the compiled read-only policy; `--seed` is reserved for the explicit temporary, token-protected seed phase. The helper does not upload or run the overall budget check.

The v54 reference-art stage validates the current 56 original illustrations and omits only their superseded build copies. Deployment-specific changes used by the original hosted site are outside this source-only update; they are not part of the public staging sequence above. Preserve the existing source files, URLs, hashes and attribution.

When a catalog in the fixed bundled-JSON allowlist changes, regenerate its index with `python3 scripts/prepare-bundled-json-v1.py --write-index` before building. Keep original source catalogs when staging build copies. For the original Sites project, use its supported source/build/package workflow and preserve its current public audience.

## GitHub delivery

Keep editable source, small metadata, notices, scripts, and proportionate tests in the repository. Large data belongs in separately versioned, checksummed payloads under its own license. GitHub’s [large-file documentation](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github) states that ordinary Git pushes block files above 100 MiB. Its [release documentation](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases) permits individual release assets under 2 GiB. Those limits should be rechecked before publication; keeping split pieces under a limit does not make a data bank suitable for ordinary source history.

Release archives can serve as transfer payloads that users download and restore locally. They are not assumed to be a cross-origin runtime CDN. A static object host is another option only after verifying its actual CORS, byte ranges, content encoding, and capacity against the requirements above. Do not introduce a paid service implicitly.

GitHub Pages is opt-in and is not enabled by the source handoff. The existing Worker/API paths and large-data organization mean that merely enabling Pages does not reproduce the hosted experience. A static-only fork first needs verified asset routing for its selected features.

Transfer storage is not the application’s public asset host. Keep source/setup documentation usable without private transfer links.
