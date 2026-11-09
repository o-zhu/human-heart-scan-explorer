# Main viewer and TEE review integration

Date: 2026-11-07. Source donor: LADAF-2021-17 / dataset 1659197537.

## Changes

- Added a versioned, donor-gated main-view catalog. The RV-outflow and LA-outflow
  sampling rectangles are revised; all eight starting cameras fit measured
  retained support. Separate source extrema cover both retained halves.
- Original main presets and their prepared pixels remain immutable. A revised
  sampling rectangle uses an actual resident reformat followed by the matching
  streamed fine-volume section. A fine result with another raster is rejected.
- Live publication QA found that TG midpapillary could receive the fine
  service's wider, oppositely oriented coplanar prepared image. Its strict
  identity check safely retained the resident preview. Main and Echo now
  request an exact raster through both cache layers and the worker/backend;
  free probe steering retains its explicitly coplanar reuse behavior.
- Existing shared views restore their recorded physical frame, camera and
  deliberate region emphasis. If the review catalog is unavailable, new shared
  state records the original frame actually displayed.
- New explicit presets clear lingering chamber emphasis. Region colors can be
  toggled beside the view; TEE's color key is visible beside the image.
- All 28 TEE entries now have explicit regional evidence. The 24 acquired
  physical frames are retained. Thirteen support the intended broad regional
  relation, seven are partial, four lack confirmed defining named structures,
  and four target vessels outside the heart acquisition.
- The active TEE summary is visible beneath the comparison image. Previous or
  manually adjusted sections have current-state qualifications rather than
  inheriting the reviewed default's anatomical claims.
- Twenty optional CT callouts across eight views identify measured source
  tissue. They require the matching donor, current reviewed raster, sample
  request token and Region colors. Horizontal mirroring follows the CT pixels.

## Verification

Focused controller and pure-module suites pass. They cover actual production
catalogs, both retained camera halves across aspect ratios, original versus
revised texture identity, late work cancellation, all 28 atlas selections,
prior and adjusted planes, wrong-donor rejection, fallback version tags and
restored emphasis. The anchor suite independently decodes and hashes the
resident CT and v17 labels, then checks every shipped anchor against its source
tissue and categorical region. Original eight prepared texture registrations
and encoded checksums pass `scripts/verify_flow_views.mjs`.

Production-shader visual checks are recorded in `main-view-qc-v3/native/`.
The all-eight starting-camera renders were checked against the actual desktop
viewport aspect and existing heading/toolbar rectangles. These are source and
rendering checks, not a clinical validation or a browser performance benchmark.

## Interpretation limits

The labels identify approximate tissue ownership. The compact shared septum
belongs to LV in this annotation; the RV-facing layer is separately assigned.
Label area ratios cannot independently identify a view. The preserved LV is
collapsed, whereas the RV has a conspicuous open cavity. In particular, the TG
midpapillary CT does not confirm paired LV papillary muscles. Named pulmonary
veins, caval entries, the LAA, individual leaflets and cusps require stronger
evidence than this segmentation supplies.

No source scalar bank, existing source mesh, tissue label, cleanup mask or
comparison-donor geometry was modified. The independent ultrasound movies and
illustrative probe/context anatomy remain separate from the fixed donor CT.

See `main-view-qc-v3/README.md`, `tee-sanity-v3/README.md` and
`view-integrity-v3.md` for the source search, clinical target criteria and
independent implementation review.
