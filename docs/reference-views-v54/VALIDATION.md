# Reference Views validation

## Artwork and mapping

- All 56 entries (28 TTE, 28 TEE) have a distinct new full image and thumbnail.
- Every image was generated individually using the specific view's anatomical
  diagram and ultrasound reference, plus a shared palette/style reference.
- All 112 WebP files decode successfully; dimensions, catalogue paths and
  SHA-256 hashes match the asset manifest. Full images are 960 × 960; thumbnails
  are 384 × 384. The complete served artwork is 3,215,306 bytes, including
  731,366 bytes for all 56 thumbnails. See `asset-audit.json`.
- Each generator reviewed its outputs against the exact source images. A
  second agent independently reviewed the 14 apical/subcostal/suprasternal TTE
  images and TEE 22–28. The primary agent inspected every final image on
  216-pixel contact sheets and compared the more ambiguous shapes with sources.
- Rejected iterations were corrected before packaging: excessive atrial/RV
  walls, PLAX/A5C outflow continuity, an extra RV-outflow cavity, bulbous pulmonary
  branches, invented pulmonary-venous leaflets, the basal mitral opening, and
  a disconnected transgastric RV outflow tract.
- Generic PV labels in the two sparse venous diagrams avoid unsupported branch
  identity. The UI glossary explains the context-dependent PV abbreviation.

The four contact sheets contain the final encoded assets. Independent review
records are `tte-apical-independent-qc.json` and `tee-22-28-independent-qc.json`.
This is source-based review of educational schematics, not clinical validation.

## Automated behavior checks

The following Node suites passed using LinkeDOM as the controlled DOM adapter:

| Suite | Relevant evidence |
| --- | --- |
| `reference-gallery-v54.mjs` | All 56 entries, Advanced default, exact Basic sets, search/group/reset, detail/return, selected-card focus, saved filters, panel scroll restoration, fullscreen-exit action, stable media/canvas nodes and teardown |
| `tte-atlas-ui.mjs` | Ten controller/camera checks, including all 28 TTE selections, gallery entry/pause/return, legacy links, outside-scan guards, retained physical planes, stale media and recovery |
| `tee-atlas-ui.mjs` | All 28 TEE selections; reviewed/previous plane comparison, retained source targets, correspondence qualifications, overlay/CT state, stale-work cancellation and media continuity |
| `echo-mobile-v47.mjs` | Existing compact workspace, control relocation, focus, single player/control identity and teardown |
| `echo-media-loading-v46.mjs` | Named-view media scope, licensed defaults, recovery and stale-event behavior |
| `echo-reference-player-v39.mjs` | Source-player readiness, actual state transitions, buffering/retry bounds and stale-player rejection |

JavaScript syntax checks and `git diff --check` also passed. These controlled
tests do not establish browser rendering or physical-device performance.

## Browser review

The managed Chromium preview was reviewed at desktop width and in same-origin
390 × 844, 820 × 1180 and 1024 × 768 viewport fixtures. Phone and tablet content
widths matched their scroll widths; no horizontal page overflow was observed.
The phone uses two icon columns and a single horizontally scrolling filter row.
Basic TTE returned 10 views, its apical filter returned four, and Basic TEE
returned 11. All 11 Basic TEE images decoded in the browser.

Card selection opened the retained comparison, the return control was visible
at entry, and returning preserved the chosen filters. Gallery navigation uses
the original renderer and media elements. Fullscreen scroll and exit behavior
have targeted DOM coverage; additional observed browser checks are recorded in
the release receipt where performed.

Local preview has no populated production data binding for fine CT requests;
it returned 503 for those unchanged endpoints. Its development serving layer
also automatically expanded a pinned gzip context mesh, causing the existing
byte-count guard to reject it. Those conditions limit local assessment of the
unchanged scientific rendering pipeline. The standard staged production build
and public readback are separate release checks.

No physical iPad, Safari, Firefox or clinical-user validation is claimed. The
source scans, mesh/mask arrays, physical planes, media metadata and closed data
upload gates are unchanged by this update.

## Deployment staging

The first build passed the framework and existing data-verification stages but
exceeded the static budget by 404,177 bytes while including both illustration
generations. The new reference-art staging step verifies all 112 replacements
and the exact hashes of 56 superseded generated illustrations before removing
only their build copies (3,069,970 bytes). Source originals remain intact.
This step runs immediately before the existing final display-budget check.
The completed archive sizes and publication outcome are recorded in the release
receipt rather than inferred from the successful framework build.
