# Changelog

## 2026-11-13 — Atrial septum and mitral-valve clarity (v61)

- Revised the subcostal four-chamber, deep transgastric five-chamber and
  transgastric long-axis teaching illustrations following targeted anatomical
  review. The accepted manifest records each view's tissue boundaries,
  connections, cardiac phase and exact exported image hashes.
- Preserve the previous whole-catalogue v60 work: the other 53 records and all
  historical artwork remain unchanged. The active registry explicitly selects
  all 56 illustrations and their thumbnails with no superseded-image fallback.
- Add reproducible preview exports and strict release verification for the
  three corrections, plus a public inventory for their six original WebP files.

See [review and verification](docs/reference-views-v61/README.md).

## 2026-11-13 — Anatomy context in 3D Reconstruction

- Added an Anatomy Context toggle between Reveal Coronaries and Measure. It
  reuses the TEE skeleton, diaphragm and esophageal/gastric context for the three
  preserved-heart donors, without changing source data or the selected cutaway.
- Enabling context frames the heart in the existing estimated anatomical view;
  disabling restores the previous camera and automatic-rotation preference.
  Workspace changes keep the main context separate from the echo and lab layers.
- Load the shared verified skeleton and optional modules on first use. Cancelled
  or stale work cannot reactivate context, and failed transfers remain retryable.
- Keep context behind accepted heart tissue with the shared WebGL depth pass and
  matching accepted-frame depth in the software renderer. Added focused checks
  for geometry reuse, camera restoration, lifecycle races and software occlusion.
- Preserve compact-menu behavior, visible keyboard focus, a stable button label,
  reduced-motion loading feedback, and existing measurement controls. Explain the
  illustrative fit and BodyParts3D / DBCLS attribution in the About dialog.
- Preserve opaque gzip asset bytes in the Vite preview so application checksums
  and decompression receive the stored payload without automatic HTTP decoding.
- Replace new Box handoffs with direct GitHub source updates while retaining
  separate public/hosted configurations and all existing asset exclusions.

See [implementation and verification](docs/reconstruction-anatomy-context/README.md).

## 2026-11-13 — Fresh review of all TTE/TEE illustrations (v60)

- Re-reviewed all 56 active illustrations against view-specific published
  anatomy and echocardiographic references. Earlier passes are not inherited.
- Repaired 28 views: 11 TTE and 17 TEE. Changes include finite atrial and vessel
  tissue bands, correct valve attachments and opening direction, coherent cardiac
  phases, clear cavity connections, missing chamber labels, and explicit crops.
- Removed the floating LV strokes in PLAX RVOT; clarified A3C/A5C outflow valves,
  A4C RV atrial walls, TG RV basal TV/PV anatomy, and TG two-chamber LA tissue.
- Required all eight grading domains to be resolved, with no averaging away of
  an uncertain or failed domain. Reviewed actual 960px/384px exports and200px
  renditions, with independent second inspection and exact export hash binding.
- Preserved rejected generation attempts and source qualifications. The review
  is AI-assisted schematic QC, without independent clinician certification.
- Added a complete v60 registry and reproducible before/after report. Historical
  v54/v58/v59 image bytes and manifests remain intact. Older verifiers now check
  their frozen packages; the v60 verifier checks the active catalogue.
- Preserved public asset exclusions, concurrent v57 inventory/restoration work,
  view IDs, plane/CT calibration, prepared data, and hosting access policy.

See the [per-view audit](docs/reference-views-v60/AUDIT.md),
[guidelines and grading](docs/reference-views-v60/GUIDELINES.md),
[exact provenance](docs/reference-views-v60/asset-manifest.json), and
[public artwork inventory](docs/open-source/reference-artwork-v60.json).

## 2026-11-12 — Targeted PLAX mitral wall and outflow repair (v59)

- Replaced only `tte:plax_mv` after the follow-up identified a residual single-line
  left atrial perimeter and ambiguous LVOT/root curves in the v58 image.
- Added a finite thin atrial tissue band, preserved open LA–mitral–LV inflow,
  separated mitral/aortic hinge levels and one LVOT/root, and clarified LVOT/Ao
  labels. The schematic phase pairs an open mitral valve with a closed aortic valve.
- Inspected the generated master and actual 960px/384px exports plus a 200px
  thumbnail rendition. Review findings, limits and the exact prompt are preserved;
  this is source-based AI visual QC without independent clinician sign-off.
- Carried the other 55 manifest entries and artwork bytes over exactly. The v59
  verifier checks the current catalogue; the v58 verifier checks its frozen package.
- Preserved public dataset/media exclusions, availability guards, hosting setup
  and the empty prepared-bank configuration. The supplemental
  [artwork inventory](docs/open-source/reference-artwork-v59.json) records the 16
  newly included v58/v59 WebPs and the exact historical/current manifest hashes.

See the [targeted review](docs/reference-views-v59/REVIEW.md),
[guidelines](docs/reference-views-v59/GUIDELINES.md) and
[exact prompt](docs/reference-views-v59/PROMPT.md). This source integration includes
queue updates v0093 and v0094; queue IDs and website publication numbers remain
separate. Exact archive/source hashes are in [the applied ledger](updates/applied.json).

## 2026-11-12 — Individual TTE/TEE illustration QC (v58)

- Reviewed all 28 TTE and 28 TEE schematics with per-view source comparisons,
  original findings, phase/plane qualifications, acceptance gates and hash records.
- Retained 49 illustrations and replaced seven: five anatomical corrections and
  two framing/outlet clarity improvements. The subsequent v59 PLAX correction
  supersedes that view's initial pass; the dated v58 record remains historical.
- Added a complete static artwork registry, immutable image history, comprehensive
  generation guidelines and reproducible packaging/report checks. There is no
  image-load-error fallback to superseded artwork.

See the [v58 audit](docs/reference-views-v58/AUDIT.md) and
[correction guidelines](docs/reference-views-v58/GUIDELINES.md).


## 2026-11-12 — Fitted reference videos and prepared fine cutaways

- Made Fit Ultrasound the fresh-view default. Explicit Full Frame remains
  available for the current selection, survives retries, and resets when a
  different view or recording is selected. Framing changes do not reload media.
- Prepared both the full 3D cut face and CT crop for all 147 acquired default
  TTE/TEE reference entries across LADAF-2021-17, S-20-29 and S-20-28. All 21
  existing outside-scan entries retain their whole-heart context and explanation.
- Bound every prepared image to its exact donor, source fingerprint, cleanup
  mask, physical plane, crop and pixel grid. Preserved the measured 79.4/79.56 µm
  fine-source data and the existing approximate clinical correspondence.
- Added independently loading, verified, losslessly compressed per-view images,
  a bounded 24 MiB decoded cache, stale-request cancellation, and the existing
  exact fine-sampler fallback for edited planes or unavailable prepared data.
- Preserved scanner-native TEE angle displays under fitted framing. Labelled
  REF supplements still apply only to recordings without their own angle.
- Added reproducible source recovery, production-sampler generation, independent
  source-point QC, tests and readable summaries. This public update is source-only:
  generated plane/data indexes, scalar payloads, contact figures and detailed
  machine-readable QC remain separate deliverables. Its empty configuration
  template retains the fine-sampler fallback until a complete locally generated
  bank and matching configuration are installed.
- Kept the public hosting configuration unchanged. Deployment-specific work for
  the original hosted site is outside this source-only update.

Coverage, data identities, numerical QC and limitations are documented in
[`docs/reference-sections-v57/README.md`](docs/reference-sections-v57/README.md)
and [`TESTS.md`](docs/reference-sections-v57/TESTS.md).

## 2026-11-12 — Source-specific TEE video angle QC

- Reviewed the actual pixels of all 33 Real Ultrasound TEE recordings: 28
  publisher guideline videos and five locally hosted clinical examples.
- Preserved the 26 native scanner angle displays, including the Mitral
  Commissural recording's 86° readout and the changing angle in the upper
  esophageal aortic arch short-axis recording. These sources receive no
  synthetic angle or proposed-angle caption.
- Limited the labelled REF supplement to seven reviewed recordings without a
  native angle display: two publisher videos and the five local examples.
- Fixed local playback binding so Four-Chamber and the other cached videos
  show their supplements after the actual Blob URL has decoded. Source changes,
  failed playback, retries, and stale loads cannot retain an unrelated angle.
- Added a recording-by-recording QC manifest and regressions using real local
  video bytes through the production media cache. Original video files,
  illustrations, clinical ranges, and live TEE Lab behavior are unchanged.

Evidence, sample limits, and checks are documented in
[`docs/tee-video-qc-v56/README.md`](docs/tee-video-qc-v56/README.md).

## 2026-11-12 — Compact reference navigation and TEE multiplane displays

- Integrated All Reference Views into the existing view heading and compact
  navigation controls, removing its separate full-width banner.
- Added one shared 0–180° multiplane display for every TEE reference video,
  with a numeric REF angle derived from the existing view range. REF denotes a
  representative teaching angle, not a measured acquisition angle in the clip.
- Added small shaded range semicircles to all 28 TEE Reference Views gallery
  illustrations, sidebar thumbnails, and enlarged illustrations.
- Added a dynamic SIM angle to the TEE Lab image and aligned the control dial
  with the same 0° left / 90° down / 180° right convention. The image display
  follows the accepted scan frame during asynchronous steering.
- Preserved reference filtering, return focus, playback teardown, original
  illustration bytes, existing clinical ranges, and public asset exclusions.

Implementation and focused verification are documented in
[`docs/multiplane-v55/README.md`](docs/multiplane-v55/README.md).

## Unreleased — source synchronization through website v89

Prepared November 12, 2026, from the initial public import and verified updates
v80–v89. Website publication, source integration, and external archive delivery
are separate records. The applied-update identities are in
[`updates/applied.json`](updates/applied.json).

### Added

- Reference Views gallery for all 28 TTE and 28 TEE views, with Advanced selected
  on a fresh visit, Basic subsets, search, window filters, and return navigation.
- 56 original labelled reference illustrations and their thumbnails, with
  per-view prompts, citations, review notes, and exact asset hashes.
- Two-point surface measurements in calibrated millimeters, orange placement
  preview, dashed annotations, cancellation, and clearing controls.
- GitHub and personal-project links in the footer.
- Public update-archive instructions, integrity tools, and applied-update ledger.

### Improved

- Progressive complete Ultra loading with a cleaned intermediate, bounded
  transport and GPU preparation, verified staging when browser storage permits,
  truthful progress, finite deadlines, and retry/cancellation handling.
- Mobile and compact workspace navigation, lab steering, touch-control release,
  fixed comparison-media space, and a compact measurement toolbar.
- Lab streaming, rendering continuity, and media-loading behavior.
- Public documentation for current controls, loading, assets, and verification.
- Updated the fallback-rendering test fixture to provide the real camera basis
  required by measurement-frame snapshots.

### Public distribution

- Retained the initial public import's dataset availability safeguards,
  restricted-asset exclusions, source-specific licenses, and portable setup.
- Preserved all existing scientific asset identities and added the 112 new
  reference artwork files to the public asset inventory.
- Kept the public local-development guide in place; the hosted project's private
  instructions and transport records are outside the public source payload.

This source update does not include every large scan bank or every media item
available on the hosted demonstration. Follow
[`docs/open-source/assets.md`](docs/open-source/assets.md) for permitted assets
and [`docs/open-source/development.md`](docs/open-source/development.md) for test
prerequisites. Source synchronization does not establish physical-device,
anatomical, or clinical validation.
