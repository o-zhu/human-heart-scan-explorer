# TEE slice review and anatomical context integration

## User-visible result

The source donor's 24 acquired TEE targets default to the reviewed section catalog. Each view offers **Reviewed fit / Previous plane**, a concise fit decision, search count, and specific remaining anatomical limits. The original planes remain available without changing the measured volume, labels, reconstruction, or prepared source images. The four thoracic-aortic targets remain explicitly outside the specimen.

The review evaluated 72,384 candidate parameter combinations and rendered 539 candidate source comparisons, with additional attention to ambiguous basal, papillary, and apical levels. These are search and inspection counts, not clinical accuracy scores. Twenty-one physical planes were replaced; the LAA, TG papillary, and TG apical planes were retained. Of 24 view statuses, 14 are refined, 2 retained, and 8 limited. The retained LAA belongs to the limited group.

The TEE atlas and steerable TEE lab now share a fixed translucent esophagus, diaphragm with a true hiatus, and continuous cardia/fundus/body/antrum outline. **Probe & anatomy** in the atlas and **Frame anatomy** in the lab frame the entire context. Separate visibility controls preserve the main anatomy/ultrasound comparison area.

## Physical and clinical limits

These additional organs are authored spatial guides, not tissue segmented from this excised-heart scan. They use one fixed coordinate frame per donor and do not move or deform to make a selected view appear attainable. Transparency is an independent x-ray overlay; it does not share the heart renderer's depth buffer.

Atlas probe placement searches the fixed tract or gastric interior, keeps the acoustic origin and beam in the actual CT plane, chooses an equivalent image orientation that avoids backward shaft routing, and centers the head bulk behind its acoustic face. The visible-placement check considers a lumen-clearance hint and a specific apical-approach requirement for deep TG. An unresolved position suppresses the probe/sector, retains the measured section, and displays an explanatory note. These are geometric plausibility checks, not contact or patient-registration validation.

The free lab separately calibrates insertion, shaft turn, anteflexion, and lateral flexion to its four reviewed source planes at 0°, 90°, 120°, and 0°. Its insertion numbers are model controls, not measured distances from incisors. ME2C requires a separate image-presentation reflection; electronic multiplane rotation and reflection leave the physical instrument independent. See `free-lab-calibration.json` and `free-lab-source-fans.jpg` for actual runtime results. Tiny residuals establish numerical consistency only.

The preserved clinical examples are independent ultrasound acquisitions. Collapsed specimen chambers, truncated vessels, and uncertain leaflet or scallop identities prevent an exact healthy-patient ultrasound match. The review is source-anatomy QC, not an expert-certified clinical registration or a claim of a globally optimal slice.

## State and data integrity

- Dataset-specific refinements cannot propagate to comparison donors.
- Switching fit versions cancels fine sampling, invalidates stale requests, clears old CT/cap content, and bypasses prepared textures for changed planes.
- A late catalog preserves a manually edited original plane even after module exit. Explicitly restored reviewed poses keep their requested basis; editing before the catalog arrives pins the visible original basis.
- Context geometry is fixed while the camera, section, and probe change.
- CT mode and module exit stop spatial overlays. Existing TTE, Probe Lab, reconstruction, and shared-state restoration contracts remain intact.

## Verification

Passed before publication:

- 54 geometry, atlas, review, source correspondence, texture/media cache, and camera-tracking checks.
- 9 TEE lab tests using actual controls and the accepted-pose sampling path.
- 4 application workspace, late-entry, reconstruction-return, and shared-state tests.
- Actual atlas DOM checks for all 28 targets, group/search navigation, fit reversal, stale-work cancellation, context visibility, media errors, and TTE restoration.
- Bounded free-lab calibration checks and measured source-fan inspection.
- Production geometry/shader/probe/sector renders through native EGL, including ME4C, ME2C, and TG papillary in the same global camera. These are explicitly labeled renderer QA, not browser screenshots.
- An independent integration review reproduced and verified the late-catalog and deep-TG approach fixes.

Managed preview was unavailable due to its existing Vinext recursion error. Live browser verification on the combined publication confirmed reviewed/previous switching, actual CT visibility, context framing, the valve and basal TG decisions, retained papillary placement, the deep-TG unresolved-placement note, and the four calibrated steering starters. The clinical cine reached readyState 4 without a media error, and fine CT sampling reached the 79.4 µm accepted-pose state.

That browser used the software renderer, revealing an outline-only context fallback. The follow-up replaces it with filled, gently shaded projections of the actual organ surfaces, preserving the hiatus and GE junction. It caches the transparent layer while the camera is fixed, so changing probe controls does not repeatedly project the anatomy. This does not change measured CT samples or the WebGL geometry.

The concurrent reconstruction update at `91e55ea` was merged without conflicts before publication. Its new local-surface and historical-mask routing tests passed with the TEE review. The palette regression fixtures omitted from that commit were recovered byte-for-byte from its parent Git revision; all eight palette/CT/ultrasound checks then passed. The combined build includes the v28 cleanup staging step. Interrupted local transfer fragments were preserved outside the public build tree; tracked data and source assets were not removed.

Because those ignored local fragments can recur through workspace synchronization, `scripts/prepare-local-hosting.py --stage` now excludes their four exact build copies after verifying hashes and Git-ignored status. Run it before the final display-budget staging check. Public source copies and all tracked assets stay unchanged.

## Sources and related evidence

- [ASE/SCA 2013 comprehensive TEE guidance, Table 10](https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf).
- `README.md`, `clinical-targets.json`, and `clinical-review.md`: per-view criteria, source review, and limits.
- `final-before-after-1.jpg` through `final-before-after-4.jpg`: source comparison plates.
- `../tee-context-v2/README.md`: context construction and geometry audit.
- `../tee-context-v2/production-probes-triptych.png`: actual production overlay geometry and guides.
