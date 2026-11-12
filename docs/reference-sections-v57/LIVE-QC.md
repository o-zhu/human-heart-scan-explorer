# Published reference-view QC

The published version 94 was checked through the normal Reference Views UI on
12 November 2026. The pass selected every TTE and TEE reference for each of the
three HiP-CT hearts. This readable summary is included in the source-only update;
the detailed per-selection record is a separate generated evidence deliverable.
The public source checkout has an empty prepared-bank configuration and does not
include the published bank or its generated indexes/contact figures. Its existing
fine-sampler fallback remains available until a locally generated, verified bank
and matching configuration are installed.

| Donor | TTE selections | TEE selections | Prepared slice and full face | Outside-scan context |
| --- | ---: | ---: | ---: | ---: |
| LADAF-2021-17 | 28 | 28 | 49 | 7 |
| S-20-29 | 28 | 28 | 49 | 7 |
| S-20-28 | 28 | 28 | 49 | 7 |
| Total | 84 | 84 | 147 | 21 |

All 168 donor/approach/index combinations were unique. Every acquired view
reached the measured-detail-ready state for both the exact reference slice and
the full cut face. The diagnostic source was `prepared-reference`, with full
face coverage. The 21 existing outside-scan views instead showed the whole-heart
context and the explicit explanation that the extracardiac target is absent.
Retained diagnostic data attributes on those outside-scan entries were not used
to claim a measured section.

The S-20-28 Deep Transgastric Five-Chamber view was also switched between CT Slice
and 3D Cutaway; both retained the prepared source and full-face detail. Final
visual inspection of S-20-28 Four-Chamber showed the reference movie playing at
its decoded 792 × 568 dimensions, with the 15° REF indicator visible. Source
angle policy and the 26 native dial bounds are covered by the separate
[regression tests](TESTS.md).

## Fit Ultrasound behavior

On S-20-29 Deep Transgastric Five-Chamber, the initial video was fitted and fully
ready. Choosing Full Frame removed the fitted crop and exposed the Fit Ultrasound
action. Moving to the next reference restored the fitted video and the Full Frame
action. The temporary choice therefore remains scoped to the current selection.
Videos without a reviewed focus crop continue to preserve their complete frame.

## Scope of this evidence

This is a desktop cloud-browser functional pass, not a physical iPad test or a
cold-network latency benchmark. Some browser-control transport timeouts required
reading the actual current selection before continuing. No prepared-section data
failure was observed. Per-action observation times in the raw record include
automation overhead and must not be presented as load-time measurements.

The visual review of all 147 generated full faces and the independent comparison
of 935,946 source samples are summarized in [README.md](README.md). Detailed
machine-readable source checks and contact figures remain separate deliverables.
Those source-data checks are distinct from this live delivery and presentation
pass. Anatomical registration and clinical validation retain their existing
qualifications.
