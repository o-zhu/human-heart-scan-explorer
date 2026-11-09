# View integrity audit — 7 November 2026

Read-only review of the main QuickViews and TEE presentation, starting at baseline commit `5d0a486`. The source-plane searches and revised anatomical choices are documented separately in `docs/main-view-qc-v3/` and `docs/tee-sanity-v3/`.

## Final integration disposition

No unresolved code-integrity findings remain in this audit's scope. The implementation now distinguishes previous, adjusted, reviewed, and unavailable-review states; clears regional emphasis on explicit selection while preserving a restored selection; and prevents a changed plane from using the old prepared texture. The initial findings below are retained as baseline evidence, not open defects.

The added focused checks pass **16/16** across `tests/main-view-review-v3.test.mjs` and `tests/tee-regional-review-v3.test.mjs`:

- All eight production main views use the correct support set for overview, section, flipped overview, and flipped section. The points agree with the recorded source-support camera bases, lie in the selected retained half, and fit within the configured horizontal/vertical margins at aspect ratios 0.2, 0.45, 1, 2, and 8.
- The 28-entry TEE review contains 13 supported regional fits, 7 partial targets, 4 unconfirmed named targets, and 4 outside-scan targets. All 24 acquired reviewed rasters match the production displayed frames. Previous, adjusted, other-donor, and mismatched rasters inherit no acquired-view evidence or callouts.
- All 20 shipped tissue anchors independently match the measured source value and v17 categorical region at their world positions. The check decodes the actual delta-z source bank, verifies its decoded hash and the label hash, and confirms that anchors identify measured tissue rather than dark cavities. Callouts mirror with the CT raster.

These checks establish source/presentation consistency. They do not establish clinical TEE registration, expert anatomical validation, individual leaflet identity, or patient-specific esophageal/gastric geometry. The visible partial, unconfirmed, and outside-scan states remain necessary.

## Main finding

The existing RV outflow view is not an LV/RV label swap or a prepared-image registration failure. Its current source cut and composition give substantial prominence to the LV body and aortic profile. Inspection of the source/label crop in `docs/main-view-qc-v3/baseline-target-regions.jpg` supports changing the anatomical plane, not merely its tint. A candidate should be reviewed for visible RV cavity → muscular RVOT → proximal pulmonary root continuity, with camera and retained side checked on the actual cutaway.

The current preset is source Y = 292, target XYZ `[174, 292, 226]`, default flip false. Its target voxel samples the RV regional label (2). The prepared image is `assets/flow-textures/rv-outflow.webp`. The target coordinate being in region 2 does not establish that the whole cut is a useful RV outflow view.

## Provenance and permitted use of the labels

The active LADAF regional label manifest is `public/assets/anatomy/manifest.json`, revision `la-exterior-v17`, with a 317 × 317 × 354 XYZ grid. Bytes are X-fast, interpreted as NumPy ZYX. Its endpoint registration is source XYZ `[0,0,0]` to `[474,474,529]`; normalized source coordinates use nearest label sampling at `round(t * (labelDimensions - 1))`.

| ID | Display territory | Interpretation that matters for this review |
|---|---|---|
| 0 | Unclassified tissue | Does not imply absence of anatomy |
| 1 | LV myocardial body | Includes the compact shared septal core |
| 2 | RV region | RV free wall, muscular RVOT, and thin RV-facing septal surface |
| 3 | LA region | Provisional regional territory |
| 4 | RA region | Regional territory |
| 5 | Aortic region | Aortic root and wall |
| 6 | Pulmonary arterial region | Pulmonary root/wall beyond the approximate pulmonic hinge |

The approximately 1.9 mm RV-facing septal annotation is a display convention, not a measured histological boundary. LV label share alone cannot determine whether an RV cut is wrong. Conversely, the baseline RV outflow crop contains a large LV/aortic profile, beyond a narrow compact septal contribution.

The label manifest explicitly sets `supportsQuantification: false`. There are no separate labels validating valve leaflets, mitral scallops, individual pulmonary or caval ostia, or the left atrial appendage. Label counts can help reject a clearly wrong regional cut, but cannot establish an ideal TEE view or validate a valve-specific view. Source sections and the clinical target must be considered together.

The v17 update adds 3,096 formerly neutral, source-connected LA cells while preserving all nonzero v12 identities. Evidence: `docs/anatomy-v12/README.md`, `docs/anatomy-v17-la/README.md`, and the active manifest.

## Integrity checks that passed

- All eight current main presets preserve their source/world plane registration. Evaluating the current frame transformations gave center and off-plane target residuals no greater than 7.39 × 10⁻¹¹ mm, consistent with serialized rounding.
- `node scripts/verify_flow_views.mjs` passed all eight presets, 32 transformed-frame checks, all pixel-registration checks, all encoded texture checksums, and the first/background volume camera-preservation checks.
- Main `QuickViews.select()` explicitly resets `anatomySelected` to 0 (`public/quick-views.js`, select method). An old LV emphasis does not explain the default main RV outflow view.
- Current TEE refinement application is donor-gated, validates its orthonormal right-handed frame, leaves outside-scan targets unmodified, and marks changed frames `atlasDerived: true`. That flag bypasses historical prepared textures. The streamed TEE result also checks returned center/right/up/width/height against the requested plane before display.
- Independent ultrasound examples are not registered to this excised CT donor. A reviewed CT fit remains an anatomical approximation, not clinical validation of the ultrasound plane.

## Baseline presentation findings — resolved in integration

### 1. TEE detail text can describe a different plane from the one shown

`public/echo.js:updatePlaneReview()` changes the status for a manually adjusted or previous plane, but always displays the reviewed catalog's `item.summary`, candidate-search statement, and limits. For example, a summary saying that the plane now follows both AV-junction regions remains visible when the user selects the previous slice or moves the plane.

The top status is helpful but does not make the detail text unambiguous. Label that evidence as findings for the reviewed starting plane, or replace the summary with a current-state qualification. Preserve the historical search evidence without implying that it evaluated the current manual cut.

### 2. TEE preset changes can retain a hidden region emphasis

`public/echo.js:selectPreset()` does not reset `anatomySelected`, unlike main QuickViews. In the regional palette, `public/renderer.js:anatomyTint()` desaturates regions other than the selected one. If LV is emphasized and the user switches to an RV TEE view, LV remains emphasized; the relevant controls can be collapsed.

An explicit TEE preset choice should either clear the emphasis or keep a visible indication such as “Emphasizing LV” with a clear action. Restoring a saved user state can preserve the intended selection. This issue only applies when the regional palette and a nonzero regional selection are active; it does not explain the neutral-palette baseline screenshot.

### 3. Changed main frames must not reuse old prepared textures

`public/quick-views.js:applyPlane()` uses `p.texture` whenever offset/rotation/tilt are zero and cleanup is enabled. That is correct for the current verified v5 planes, but would display old-plane pixels on a newly substituted frame unless the runtime removes/bypasses the historical texture or provides a newly generated, registered texture. Existing TEE refinement handling is a useful model.

## Review limits

This audit verifies code paths, regional label provenance, existing prepared-image registration, and source/label evidence. It does not establish expert clinical validation, in-vivo TEE registration, or histological accuracy. The separate source searches should determine final frames; actual cutaway checks should determine camera target, retained side, and framing.

No runtime, source intensity, cleanup, segmentation, or immutable texture asset was changed by this auditor. The auditor added this report and the two focused test files; the parent integration owns the runtime changes.
