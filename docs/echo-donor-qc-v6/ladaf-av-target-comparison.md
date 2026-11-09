# LADAF PSAX aortic-root target comparison

## Finding

The prior PSAX AV and AV-zoom sections were centered on the longitudinal LVOT{local-home} focus at source XYZ `[260,265,270]`. Their accepted plane misses the separately source-reviewed root/cusp neighborhood center `[242.5,252,235]` by **13.06 mm**. The measured raster consequently showed an oblique C-shaped lumen and substantial compact myocardium rather than a useful valve-level root cross-section.

The recommended tested replacement is the reviewed ME AV SAX orientation, displaced **3 mm toward the superior aortic root**. It shows a clearer three-sinus{local-home} arrangement with fine internal tissue profiles, remains close to an independently traced aortic lumen point, and admits an actual parasternal skin contact with **zero acquisition rotation or center shift**. Individual cusp names, clinical en-face validity and exact annular dimensions remain unvalidated.

## Source evidence and method

The comparison uses the **actual production MPR worker**, the hash-verified LADAF resident volume at 317.6 µm, and unchanged fixed body geometry. Nineteen exact plane/crop rasters were produced. No source pixels or production geometry were changed by the investigation.

- `public/assets/tee-atlas/plane-fit-v2.json`, `meavsax`: previously visually reviewed root/cusp plane, selected after a source-anatomy candidate search, centered at `[242.5,252,235]`. Its own review explicitly leaves individual cusp labels and exact annular dimensions unvalidated.
- `docs/anatomy/cavity-tracks.json`, aortic track 5: approximate lumen centers `[244,253,238]`, `[239,254,225]` and `[224,264,205]` corroborate the proximal-to-superior aortic course.
- `public/assets/flow-views-v5.json`, LV-outflow focus `[260,265,270]`: a useful point for the longitudinal outflow section, but not a segmented aortic valve center or an appropriate substitute for the separately reviewed valve-level SAX section.

Source coordinates are the resident 475 × 475 × 530 voxel-center XYZ convention. World coordinates are `(X−237,Z−264.5,237−Y)/529`, with reference length 168.0104 mm.

The reviewed ME AV SAX plane was compared at offsets −3,0,+3,+6 mm along its superior/outflow-facing normal. Its image basis was reoriented in-plane to the existing TTE presentation, without changing the physical section. A separate candidate used the current accepted PSAX great-vessel plane, recentered in-plane at the projection of the reviewed root center. Each candidate went through the actual TTE acquisition solver with source preservation requested, then was sampled before and after acquisition, plus a tighter AV crop.

![Actual measured AV target comparison](ladaf-av-target-comparison/av-comparison.jpg)

The whole comparison sheet and individual 0,+3,+6 mm and great-vessel zoom rasters were directly examined. This is a measured CT comparison; candidate native 3D anchors require the subsequent production export. The production camera cannot improve a plane that misses the target.

## Comparison

| Section | Measured appearance | Interpretation |
|---|---|---|
| Prior PSAX AV / zoom | Oblique C-shaped root-like lumen beside thick compact myocardium; no useful three-sinus arrangement. | Target level is too inferior to the separately reviewed root/cusp plane. Zoom preserves the same problem. |
| Current PSAX great vessels | Clear trilobed semilunar-root-like cross-section and surrounding basal/right-heart lumens. | Useful comparator. It is 6.75 mm from the reviewed root center and more superior than the selected AV target. |
| Current ME AV SAX / unshifted reviewed source | Multilobed root section with fine folded internal tissue. | A defensible conservative source replacement, with the established root/cusp review. |
| Reviewed source −3 mm | More inferior root section; one broad sinus/lumen profile and more compact tissue. | Less clear sinus separation than the superior candidates. |
| Reviewed source +3 mm | Three-sinus{local-home} arrangement with thin internal profiles; ventricular compact tissue is reduced without losing the surrounding basal context. | **Best tested compromise** between source-reviewed root level and clear regional topology. |
| Reviewed source +6 mm | More superior, open trilobed root lumen. | Also plausible root geometry, but farther from the existing reviewed cusp-level target. No demonstrated advantage sufficient to prefer it over +3 mm. |
| Accepted great-vessel plane with root ROI | Clear trilobed root crop; nominal reference marker convention is preserved. | A viable regional alternative, but more superior and farther from the reviewed cusp plane. Prefer the bounded +3 mm source refinement. |

## Recommended exact target

| Property | Value |
|---|---|
| Source center XYZ | `[237.80563655603356,253.08331464091532,226.875140193135]` |
| World normal | `[-0.49697660993458026,-0.8601518248867738,-0.11468690998490312]` |
| Full AV frame width/height | `0.70 / 0.70` world reference units |
| AV zoom width/height | `0.37 / 0.37`, same physical plane |
| Acquisition | `preferSourcePlane: true` |
| Additional acquisition rotation | `0°` |
| Center displacement during acquisition | `0 mm` |
| Reviewed-root-center residual | `3.00 mm` |
| Aortic track point `[239,254,225]` residual | `0.36 mm` |
| ROI inside scan sector | Yes |
| Contact | Actual inward-facing parasternal skin triangle 2245 |
| Marker deviation from generic reference-body convention | `28.92°`; illustrative registration mismatch, not a clinical probe-angle measurement |

The paired AV and AV-zoom presets must share the physical section. Their rectangle/crop may differ. The fixed body and skin contact should not rotate this source back toward the old LVOT-centered plane merely to enforce a generic marker convention in an excised, unregistered specimen.

## Evidence receipt

The tested baseline production export SHA is `4959b5ed39006d7309e4ccc5c5fc155254371110954959ef318c0d5e45eca3a8`. Exact candidate planes, contact/sector metrics, before/after module hashes and point provenance are in `ladaf-av-target-comparison/review.json`. Measured-source transport, decoded-source and output-raster hashes are in `caps.json`; every raster is retained beside them. The source files remained unchanged throughout candidate generation.

Reproduction: run `scripts/echo-donor-qc-v6/inspect-ladaf-av.mjs`, then `sample-caps.mjs` on its output directory. The saved `review.json` can itself be replayed through the sampler to reproduce these exact historical candidate rasters, independently of later production target changes.

This recommendation improves the regional source target. It is not an assertion that a static, partly collapsed postmortem heart reproduces a living clinical ultrasound image or that all three cusps have been individually identified.
