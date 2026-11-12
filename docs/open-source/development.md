# Local development and verification

## Supported starting point

The editable viewer lives in `page.html` and `public/`. Its simplest server requires Python 3.9 or newer and the standard library:

```sh
python3 scripts/serve-local.py
```

Use `py -3 scripts\serve-local.py` on Windows. By default it serves `http://127.0.0.1:8000/`; `--port 8001` selects another loopback port. Changes to browser files appear after reload. Restart after changing the server or route indexes.

Restore assets as described in [assets](assets.md). The server starts from source catalogs even when a bank is absent, but requests for missing files return 404. A successful server start is not proof that every dataset or fine rendering path is available.

### Exact local route contract

| URL prefix | Files |
| --- | --- |
| `/`, `/page.html`, `/index.html` | Root `page.html` |
| `/assets/…`, `/app.js`, and other static browser paths | Files beneath `public/` |
| `/api/ultra/v4/` | `data/ultra-sections/`, indexed by `server/ultra-upload-index.json` |
| `/api/ultra-volume/v7/` | `data/ultra-volume-v7/`, indexed by `server/ultra-volume-index-v7.json` |
| `/api/donors/s-20-29/ultra/` | `data/donors/s-20-29/ultra-sections/` |
| `/api/donors/s-20-29/volume/` | `data/donors/s-20-29/ultra-volume/` |
| `/api/donors/s-20-28/ultra/` | `data/donors/s-20-28/ultra-sections/` |
| `/api/donors/s-20-28/volume/` | `data/donors/s-20-28/ultra-volume/` |
| `/api/display-compact-v29/mesh/` and `/sections/` | Matching `data/display-compact-v29/` groups |
| `/api/display-compact-v29/cleanup/` | Indexed `public/assets/cleanup-v29/` |
| Exact `/api/display-compact-v29/` catalog names | `public/assets/display-compact-v29/` |

Other production `/api/` collections are not automatically implemented by this Python server. In particular, the optional guided-native collection has separate hosting/recovery requirements. Keep that limitation explicit rather than assuming every production API works offline.

The server allows GET/HEAD, rejects writes, restricts paths, and checks indexed file sizes; compact-display derivatives also receive cached hash verification. Gzip payloads intentionally have **no `Content-Encoding: gzip`** because the client decompresses stored bytes. Serve JavaScript as JavaScript, not a fallback HTML response.

## Framework workflow

Use Node.js 22.13 or newer and the declared package manager. Keep `package.json` and `pnpm-lock.yaml` together:

```sh
npx --yes pnpm@11.25.0 install --frozen-lockfile
npx --yes pnpm@11.25.0 dev
```

For a production code build:

```sh
npx --yes pnpm@11.25.0 build
```

The checkout-local execution profile is intentionally untracked. A clean clone uses the portable branch of `scripts/run-framework.mjs`; the managed Sites environment uses its own profile. Do not commit another developer’s private profile, credentials, dependencies, or cloud state.

The framework preview and production Worker do not have identical data backends. Read [deployment](deployment.md) before treating a local code build as a complete deployed dataset.

## Focused checks

These existing tests run without installed npm packages or large scan payloads; they read small retained manifests where needed:

```sh
node --test tests/device-resources.mjs tests/mesh-draw-batching-v37.mjs tests/echo-angle-placement-v41.mjs tests/volume-picking-cap.mjs
python3 tests/test_fetch_assets.py
```

The initial public-package preparation review recorded **20 Node tests and 11 Python downloader tests**. The downloader suite uses temporary files and a loopback fixture server to check path restrictions, byte identity, atomic replacement, redirects, retries, and the indexed bank mapping. This records unit/fixture coverage only, not browser/GPU performance or clinical validation. The GitHub workflow runs these suites and a Python syntax check; it does not deploy or download full scans. Later feature-specific checks are separate from that baseline count.

Choose additional tests according to the change:

- Geometry, frames, and donor alignment: `tests/echo-*`, `tests/tee-*`, and `tests/probe-*`.
- Integrity, codecs, cache scheduling, and surfaces: `tests/ultra-*`, `tests/fine-*`, `tests/lumen-*`, and `tests/reviewed-mask-*`.
- Two-point measurements: `tests/measurement-geometry-v50.mjs`, `tests/measurement-picking-v50.mjs`, and `tests/measurement-controls-v50.mjs`. Geometry/picker fixtures cover calibration and stale-frame behavior; they do not establish clinical measurement accuracy.
- Reference Views: `tests/reference-gallery-v54.mjs`, `tests/tte-atlas-ui.mjs`, and `tests/tee-atlas-ui.mjs`. Retain all 56 view identities, the Advanced default, exact Basic subsets, filter persistence, old shared links, and the shared renderer/media lifecycle.
- DOM/controller fixtures: some scripts accept an explicit LinkeDOM module path. Follow the invocation in their header and install this optional test dependency in an isolated environment; it is not a runtime requirement.
- Native render/processing checks: Python scripts can require NumPy, SciPy, Pillow, Blosc2, mesh libraries, and EGL/OpenGL. Their exact source inputs and commands are recorded beside the test/method.

Do not run every historical reconstruction/download job as a routine test. Some are expensive, need unavailable source data, or describe retired configurations. Start with the current documented fixture and read its input/output paths first.

### Current Ultra loading contract

The v53 loader, introduced in website v88, preserves the source geometry while separating acquisition from preparation where asynchronous origin-private file storage (OPFS) is available. It downloads one compact part at a time, verifies its size and SHA-256, and closes each staged file before preparation begins. Missing, denied, full, or stalled storage uses bounded verified streaming instead. Temporary storage is scoped to one load; it does not establish resume after a browser restart.

Preserve these contracts when changing the loader:

- Network reads have a 20-second byte-idle deadline and three shared retries with 1/2/4-second backoff. Retry the unfinished application block and retain verified progress. Exhausted network recovery must not trigger the larger original transport.
- Native storage operations and compact decompression have finite active deadlines. Workspace/hidden-page pauses suspend active timing; cancellation must settle even when native cancellation does not. A decompression timeout is a preparation/resource failure.
- Geometry travels through one acknowledged worker/GPU transaction at a time, with transfers no larger than 2,097,144 bytes and buffer reuse after a GPU fence. Do not allocate a second whole decoded Ultra model to support progress, measurement, or picking.
- Exact stream identities, triangle decisions, all eight reviewed mask fields, and all four interior replacements gate installation. Keep the cleaned intermediate through the first compatible successful Ultra draw and fence. Stale jobs and failed candidates cannot replace it.
- The progress element remains determinate and monotonic, with a truthful Downloading/Preparing or combined fallback phase. Received byte totals alone do not establish completed staging or preparation.
- Optional WebAssembly hashing retains the JavaScript fallback and every identity check. The source generator, readable WebAssembly text, and embedded binary must agree.

Focused checks include:

```sh
node --test tests/surface-part-staging-v53.mjs tests/surface-preparation-deadlines-v53.mjs tests/surface-sha256-v53.mjs
python3 scripts/build-surface-sha256-v53.py --check
```

Use the related controller, progress, network-recovery, and GPU suites for changes across those boundaries; read their optional fixture/dependency requirements first. The historical `tests/fine-surface-compact-v29.mjs` requires an external production fixture and must be reported as unexecuted if that fixture is absent. The [sequential-loading guide](../sequential-loading-v53/README.md) and [hash implementation record](../surface-hash-v53/README.md) define the exact bounds. Recorded Node hash timings and controlled Chromium storage fixtures are not physical iPad results or an end-to-end loading-speed guarantee.

### Reference artwork and measurement changes

The v54 gallery uses the existing CT/3D and media comparison; it does not create a separate renderer or change the accepted physical plane. Returning to the gallery stops comparison playback, overlays, and pending sampling while retaining filters. Basic TTE is a project introductory subset of 10 views; Basic TEE is the 11-view ASE/SCA basic perioperative set. The complete catalogues retain 28 entries each.

Current full images and thumbnails live in `public/assets/reference-views-v54/`. Retain their per-view provenance and hashes in `docs/reference-views-v54/asset-manifest.json`. Image preparation resamples and encodes approved art; anatomical changes require review against the exact view references and a newly recorded image. Do not add published reference figures to the public payload. See [the illustration guidelines](../reference-views-v54/GUIDELINES.md).

Measurement placement must use the actually presented visible surface or cut face and the source's physical coordinate system. Keep click-versus-drag protection, asynchronous stale-frame rejection, bounded readback, and cancellation behavior. Existing endpoints remain in source coordinates through same-source camera/detail changes; changing source or physical extent clears them. The tool measures Euclidean distance, not an automatically selected wall thickness. See [the measurement implementation](../measurement-v50/README.md).

## Browser review

Exercise changed routes with actual restored assets. Inspect reconstruction loading, one section on each axis, Reference Views for TTE and TEE, lab steering, a plane missing the heart, and return to Reconstruction. For gallery changes, check Advanced/Basic counts, search, a card-to-comparison transition, and return with the same filters. For measurements, check an orange preview, two-point placement, orbiting with a completed line, cancel, clear, and source change. Verify keyboard access, touch-control release, and a narrow layout. Check failed optional asset loading when the change affects fallbacks.

Record the browser engine, viewport/device, source snapshot, asset identity, and observed result. Mocked canvases and native EGL captures are useful evidence but must not be called Chrome, Safari, Firefox, or physical-phone tests. The exact release handoff records completed checks and those remaining for publication.

## Scientific prerequisites and historical records

`scripts/requirements-volume.txt` records common volume-processing dependencies. Other subdirectories have their own requirements and environment receipts. Install them in a virtual environment only when running that pipeline. Raw acquisitions and many intermediate caches are excluded; the source ZIP alone cannot reproduce every reconstruction.

The public export’s `LOCAL-DEVELOPMENT.md` points to these current guides. Historical implementation notes can describe earlier packages with different asset availability; their old “complete portable export” counts do not apply to this release. This guide, the current asset manifest, and the release inventory govern package availability.
