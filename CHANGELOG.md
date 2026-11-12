# Changelog

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
