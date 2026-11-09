# LADAF cusp{local-home} region versus LVOT focus

This diagnostic distinguishes two existing source annotations that must not share a name. The source-reviewed three-sinus/cusp-region center `[242.5,252,235]` comes from `public/assets/tee-atlas/plane-fit-v2.json`, `views.meavsax.source.centerXYZ`, reviewed 2026-11-07 against source commit `5761089d06cae66da76445565999307a0612d184`. That review selected candidate 1094 after a 2,709-candidate search and inspection of 19 measured reformats. Individual cusp labels and annular dimensions remain unvalidated. Independent proximal aortic track points `[244,253,238]` and `[239,254,225]` corroborate the neighborhood.

The point `[260,265,270]` is `public/assets/flow-views-v5.json`'s longitudinal LV-outflow target. It is a useful LVOT/cusp focus, not the reviewed short-axis cusp{local-home} center. The first-pass deep-TG diagnostic used this point because the runtime field had been named `aorticRoot`; its LADAF “actual root” labels have been explicitly corrected in the neighboring diagnostic README.

The exact source XYZ conversion is `[(x−237)/529, (z−264.5)/529, (237−y)/529] × referenceMm`. Thus the reviewed root-region point is `[1.7468, −9.3692, −4.7640]` mm in LADAF's existing world frame. The comparison changes this one landmark in a cloned runtime model, without changing the fixed organs, source frames, tissue data, instrument scale, or clearance criteria.

## Source and camera findings

Both actual production MPR sections and both production camera anchors were inspected for each candidate. Four native captures completed without GL errors or stale source fingerprints. `reviewed-root-comparison.json` preserves both accepted planes, independent target distances and full deep-TG head/shaft checks.

| View and target | LV miss (mm) | MV-region miss (mm) | Apex miss (mm) | Reviewed cusp{local-home} miss (mm) |
|---|---:|---:|---:|---:|
| A5C, LVOT focus | 5.57 | 9.48 | 4.41 | 8.51 |
| A5C, reviewed cusp{local-home} | 11.90 | 17.55 | 8.16 | <0.000001 |
| Deep-TG5C, LVOT focus | 5.70 | 1.74 | <0.000001 | 3.70 |
| Deep-TG5C, reviewed cusp{local-home} | 7.50 | 4.76 | <0.000001 | <0.000001 |

**A5C:** directing the existing fixed-marker apical maneuver at the cusp{local-home} point produces a visibly narrower, less continuous LV cavity and greater loss of the MV/apex neighborhood. The LVOT focus provides the more useful ventricular/outflow section in this source. Correct the landmark names, retain the LVOT focus separately, and use it explicitly for LADAF's qualified A5C outflow guide. This should not be described as an exact cusp-plane match or full clinical five-chamber validation.

**Deep-TG5C:** the reviewed cusp{local-home} point retains the longitudinal ventricular and outflow regions. Its LV cavity is modestly narrower than the LVOT-focus candidate, but the broad family remains represented and the actual reviewed root point is in the section. All 390 rendered head vertices and 135 sampled shaft points remain contained; minimum head-to-wall clearance is 0.511 mm, shaft-center clearance 4.454 mm, and the unchanged tube radius is 1.800 mm. Use the reviewed root-region point for this guide while retaining qualified clinical correspondence.

The proposed metadata correction does not change LADAF's fixed body axes: their posterior direction uses the original proximal aortic-lumen point, and the AV origin/apical axis use their existing landmarks. No organ shift is warranted by this target-level correction.
