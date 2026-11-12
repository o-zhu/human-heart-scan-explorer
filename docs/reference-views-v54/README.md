# Reference Views: gallery and labelled anatomy

The former **Echo Windows** tab is now **Reference Views**. Opening the tab
shows a labelled catalogue, with **Advanced** selected on a fresh instance.
TTE and TEE each retain all 28 existing views. A card opens its exact existing
CT/3D and ultrasound comparison. **All Reference Views** returns to the
catalogue, preserves the approach and filters, and stops comparison playback,
overlays and pending sampling. The shared canvas and players are retained.

Basic TTE is a project introductory selection of 10 views: PLAX, PSAX aortic,
PSAX mitral, PSAX papillary, A4C, A5C, A2C, A3C, subcostal four-chamber and IVC.
It is not presented as an ASE complete examination. Basic TEE uses the 11
ASE/SCA 2013 basic perioperative views (comprehensive Table 10 numbers 2, 4, 5, 7, 8,
10, 11, 13, 17, 25, 26). Search covers the view name, code and anatomical terms;
acoustic-window filters provide another route into the complete catalogue.

Existing shared comparison links continue to open their selected detail view
and pose. New shared states also preserve gallery presentation and filters.
The TEE Lab's reference-view link explicitly opens ME four-chamber detail.

## Illustration system and evidence

All 56 illustrations are newly generated original 2D teaching schematics.
The [guidelines](GUIDELINES.md) document the primary sources, view-specific
orientation rules, wall/valve/label treatment and rejection criteria.
The [asset manifest](asset-manifest.json) records every exact generation prompt,
reference input hash, generated-source hash, final image/thumbnail hash and QC
record. Published guideline figures are reference inputs only and are not
redistributed by this update.

Use muted terracotta myocardium, warm ivory lumens/background, thin outlines,
large dark labels and a restrained sector boundary. Geometry follows the
specific acquisition plane, including TTE/TEE near-field differences. Wall
thickness, cavity connections, valve landmarks and label targets take priority
over stylistic uniformity. Two-chamber, four-chamber, outflow, vascular and
short-axis levels must remain visually distinct.

Images are served at 960 px in the detail interface and as 384 px thumbnails with
responsive source selection in the gallery. Gallery images load lazily. The
preparation script performs only square resampling and WebP encoding; any
anatomical correction requires regeneration with the accurate references.

```sh
python3 scripts/prepare-reference-icons-v54.py --source-dir /absolute/reviewed-icon-directory
```

The script requires a final approved provenance record for every PNG. Original
generation inputs are external working materials, not clinical source assets.
The deployed WebP assets and complete provenance are included in the update.

## Validation boundaries

`tests/reference-gallery-v54.mjs` covers the complete catalogue, exact Basic
sets, filters/search/reset, detail/return, saved filters, focus, lazy images,
stable player/canvas nodes and teardown. Updated TTE/TEE controller tests
exercise all 56 selections and the gallery lifecycle while retaining their
existing scientific correspondence and stale-work checks. Existing compact
workspace, media-loading and source-player tests cover the retained interface.
Actual browser observations and asset review results are recorded separately
in `VALIDATION.md` with the release.

The illustrations are source-checked educational schematics, not patient
images or independent clinical validation. This UI update changes no measured
scan, physical plane, donor calibration, masks, mesh or media source. Existing
CT coverage and registration limitations remain in the comparison screen.
No new immutable data bank or upload gate is required. Keep the 13 existing
hosting stages; add `python3 scripts/prepare-reference-hosting-v54.py --stage`
immediately before the final display-budget check. It verifies all replacements
and omits only 56 superseded illustration build copies, retaining every source
original. Both compressed and expanded archives must remain below 256 MiB.
GitHub integration remains a separate requested operation.
