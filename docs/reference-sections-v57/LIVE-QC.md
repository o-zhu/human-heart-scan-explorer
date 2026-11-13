# Published reference-view QC

This is the saved production-browser evidence for website version **94**,
observed on **12 November 2026 at 23:39:08.677 UTC**. It is not a new live-browser
run performed during the subsequent GitHub approval recovery.

The complete original per-selection JSON is available as
[live-browser-qc.json.gz](live-browser-qc.json.gz). Decompression restores its
original SHA-256:
`ac1a38d99e367eeea531a3fee18b5f4bcde6d2e943fe06f86744d5eff5c8ce5e`.

| Donor | TTE selections | TEE selections | Prepared slice and full face | Outside-scan context |
| --- | ---: | ---: | ---: | ---: |
| LADAF-2021-17 | 28 | 28 | 49 | 7 |
| S-20-29 | 28 | 28 | 49 | 7 |
| S-20-28 | 28 | 28 | 49 | 7 |
| Total | 84 | 84 | 147 | 21 |

All 168 donor/approach/index combinations were unique. Every acquired view
reached the measured-detail-ready state for both the exact reference slice and
the full cut face. Its diagnostic source was `prepared-reference`, with full
face coverage and no failure message. The 21 existing outside-scan views instead
showed whole-heart context and the explicit explanation that the extracardiac
target was absent. Retained diagnostic attributes on those outside-scan entries
were not used to claim a measured section.

## Video framing

For S-20-29 Deep Transgastric Five-Chamber, the initial state was fitted with
video ready state 4. Choosing Full Frame removed the fitted crop and exposed the
Fit Ultrasound action. Moving to the next reference restored fitted sizing and
the Full Frame action. The temporary choice therefore remained scoped to the
current selection. Recordings without a reviewed focus crop preserved their
complete frame.

## Slice and full-face delivery

S-20-28 Deep Transgastric Five-Chamber was switched between CT Slice and 3D
Cutaway. Both retained the prepared source, full-face coverage, measured-detail
readiness and an empty error message. The contemporaneous visual review also
recorded S-20-28 Four-Chamber playback at 792 by 568 decoded pixels with its
15-degree REF indicator visible. The prior source-aware native-angle policy
remains covered by the [regression tests](TESTS.md).

## Scope

This was a desktop cloud-browser functional pass, not a physical iPad/Safari
pass or a cold-network latency benchmark. Some browser-control transport
acknowledgements timed out; the actual current selection was inspected before
continuing. No prepared-section data failure was observed in the recorded pass.
Per-action observation times include automation overhead and are not load-time
measurements. The separate source-data checks and contact figures do not
constitute anatomical or clinical validation.

During approval recovery, the saved file identities and metadata were checked
offline, and ten activation safeguards passed. A fresh live-site inspection was
not available in that continuation. See [README.md](README.md) for the current
publication scope and verified local-restoration procedure.
