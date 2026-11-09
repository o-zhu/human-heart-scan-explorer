# TTE atlas: ASE comprehensive adult examination, Table 2

This release adds 28 named TTE acquisition cards to Heart Explorer and retains
the existing TEE atlas. It incorporates the concurrent readability and dataset
navigation changes from source commit `e76284cf4d70785bda2fa16b21abff4b15827482`.
The only merge conflict was the stylesheet list; both stylesheets are retained.
TTE-specific CSS adds organization and image cards while inheriting the shared
typography, input targets and responsive workspace sizing.

## Authoritative inventory

Mitchell et al., *Guidelines for Performing a Comprehensive Transthoracic
Echocardiographic Examination in Adults*, JASE 2019;32(1):1–64,
DOI [10.1016/j.echo.2018.06.004](https://doi.org/10.1016/j.echo.2018.06.004).
The [user-supplied ASE PDF](https://www.asecho.org/wp-content/uploads/2025/07/Guidelines-for-Performing-a-Comprehensive-Transthoracic-Echocardiographic-Examination-in-Adults.pdf)
contains Table 2 on PDF pages 19–25. The upload directory is not the publication
year. The table has 27 numbered entries, with 2.10 split into a and b, giving
28 named cards. Its referenced videos are 39–68; 2.17 and 2.23 have two each.
The optional additional anterior RVOT panel remains within the A5C entry.

| Window group | Cards |
| --- | ---: |
| Parasternal long axis | 6 |
| Parasternal short axis | 8 |
| Apical | 10 |
| Subcostal | 3 |
| Suprasternal | 1 |

`public/tte-atlas-data.js` contains factual names, exact table/page/video mapping,
original acquisition summaries, marker guidance and specimen qualifications.
Each card links to its source page. Search spans every group; sequential browse
preserves table order. Legacy `psax` bookmarks migrate to the recorded mitral or
papillary level. TTE and TEE preserve their own groups and current evidence.

## Artwork

Every card has a separate built-in ChatGPT Image generation. A model edit
corrected the first subcostal illustration's inverted chamber arrangement.
The selected 28 images are 640×640 WebP, totaling 1,848,176 bytes. All original
PNG masters, the corrected image's initial version, exact prompts, hashes and
packaging provenance are retained in this directory. No local artistic changes
or fabricated ultrasound frames were used. The art is explicitly conceptual
navigation imagery; source guidance and deterministic geometry supply the
acquisition information.

## External probe and anatomy context

The authored ribs, sternum, clavicles and diaphragm are fixed 3D meshes with
restrained opacity. They are not segmented from any donor. Both these meshes and
the external phased-array probe use the heart renderer's accepted depth. They
detach when leaving Echo, changing approach or entering CT-only mode. An absent
accepted depth buffer does not become an unoccluded anatomy overlay.

Probe anchors represent left parasternal, apical, subxiphoid and suprasternal
windows. Marker polarity follows clinical window guidance independently of the
CT raster presentation. Bedward in a left-lateral posture is modeled as patient
left; the apical two- and three-chamber marker targets use the described relative
60-degree counterclockwise rotations. These remain authored positioning aids.

A small plane projection is accepted only within the external window and when
the marker direction agrees within the model's 25-degree acceptance heuristic.
Otherwise the external window and clinical marker are retained, with a dashed
independent sector and explicit estimated-pose caption. That tolerance is a
software display rule, not clinical validation. Camera fitting contains the
instrument handle, and upright alignment stays fixed across view changes.

Original TTE sections and prepared pixels are unchanged. New crops and planes
are marked `atlasDerived` and reformat actual donor voxels. Source-reviewed
LADAF valve anchors are explicitly gated to that donor; other donors use their
own geometric frames. All 28 TEE outputs were independently compared before and
after the TTE builder and were identical. No scientific source arrays, tissue
labels, reconstruction meshes, masks, serving banks or thresholds changed.

The abdominal IVC, hepatic veins and complete aortic arch are outside the
heart-only scan. Their cards retain reference media and probe context but disable
CT comparison. Specific limits for the deep PLAX survey, papillary level,
coronary sinus and pulmonary venous entries remain visible beside the specimen.

## Clinical reference media

The catalog has 30 source-hosted TECHmED YouTube cines and 30 real sonographic
thumbnail fallbacks. Source iframe IDs and all 30 acquisition titles/authors
were verified. Every fallback was fetched, decoded and visually inspected at
480×360. Thumbnail dimensions do not establish recording resolution. Full
player playback and original video resolution were not verified here.

These are independently hosted teaching examples, not verified original ASE
supplement files. Correct publisher article/CDN requests returned HTTP 403.
The official table/page/video mapping remains attached. Institutional University
of Toronto alternatives are linked with exact, broader or related-view labels.
Anatomical page illustrations are excluded from clinical clips. No unlicensed
third-party media bytes are redistributed by the application.

Only media assigned to the selected view is offered. YouTube players do not
autoplay and are unloaded on view changes or exit. A failed player retains its
original source link and a selectable ultrasound still. Missing media links to
the current guideline page, never a prior video's URL. A failed catalog is
retried on the next opening while successful catalogs remain cached.

## Verification and limits

Focused Node contracts cover inventory, source-frame immutability, donor gating,
finite orthonormal probe poses, marker polarity, external-handle framing, scan
coverage, all 28 model assets and all 30 clinical acquisition mappings. Real DOM
fixtures cover eight TTE controller scenarios, existing TEE behavior, upright
camera persistence, stale media events, empty states and catalog recovery.
The merged clinical UI suite passes its 18 checks. All 14 public stylesheets
parse successfully.

`probe-positions-all28.jpg`, `probe-positions-details.jpg` and their JSON receipt
use the actual production meshes/poses and shader in native EGL. The heart is
a coarse source silhouette for spatial inspection. These are scientific review
renders, not browser screenshots or validation of clinical correspondence.
`icon-review.jpg` records the selected art set.

The connected browser and computer-use backend were unavailable. Browser layout,
real-device interaction/performance and end-to-end external video playback
therefore remain unverified. Production packaging follows every existing
native/fine/motion/cleanup/display staging step and the 256 MiB hosting budget.

## Lossless catalog delivery for the hosting budget

The complete icon set is retained at 640 × 640 pixels. To fit the deployment
budget, eight explicitly listed JSON catalogs are stored as deterministic gzip
payloads inside the Worker. The production handler returns their exact original
source bytes at the existing URLs, after checking decoded length and SHA-256.
This changes transport only: the local public files, scientific values, literal
numbers, scan binaries, illustrations and access policy remain unchanged. There
is no upload endpoint or new storage binding.

Regenerate `server/bundled-json-index-v1.json` before building whenever one of its
eight source catalogs changes:

```sh
python3 scripts/prepare-bundled-json-v1.py --write-index
```

After the normal framework build and existing staging steps, run the following
after `prepare-tee-hosting-v4.py --stage` and before the final
`prepare-hosted-display-v10.py --stage` budget check:

```sh
python3 scripts/prepare-bundled-json-v1.py --stage
node --test tests/bundled-json-v1.mjs
python3 tests/bundled-json-staging-v1.py
```

The stage verifies every bundled payload and source file before removing only
the corresponding redundant build copies. Focused transport checks cover exact
bytes for all eight catalogs, conditional requests, HEAD, the production gate,
unknown paths, read-only behavior and corrupted payloads. The final compressed
and expanded deployment archive must both remain below 256 MiB.

Reproduce the focused checks from the repository root:

```sh
node --test tests/tte-atlas.test.mjs tests/tte-media-assets.mjs
node tests/tte-atlas-ui.mjs /path/to/linkedom/esm/index.js
node tests/tee-atlas-ui.mjs /path/to/linkedom/esm/index.js
node tests/tee-spatial-review-v4.mjs /path/to/linkedom/esm/index.js
node scripts/tte-atlas-v1/export-probes.mjs {temporary-cache}
python scripts/tte-atlas-v1/render-probes.py --data {temporary-cache} --out docs/tte-atlas-v1
```

The native renderer requires the existing NumPy/Pillow/SciPy/scikit-image and
ModernGL environment. Importing a newly generated art set uses
`scripts/tte-atlas-v1/import-art.mjs` with its selected model-output manifests.
