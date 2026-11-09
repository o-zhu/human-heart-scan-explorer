# Final S-20 context presentation review

## Scope

The reviewer inspected all 28 TTE and all 28 TEE upright anatomy views for each comparison donor in the four final native galleries (112 upright views total). Enlarged checks included S-20-29 ME4C and S-20-28 A4C. After the final field/target corrections, the reviewer inspected all eight changed upright compositions again: A4C RV-focused, A5C, MELAX, and deep-TG five-chamber for each donor. The independent final QC reported the other 52 source/coverage/camera cases per donor unchanged. The revised compositions preserve heart visibility and the same collision-free context placement. The independent source-slice and probe-view assessment is recorded in the main echo donor QC review. This document records presentation and context placement, not clinical validation.

## Findings

- The source heart remains inside the donor-specific illustrative rib cage and above the diaphragm in both donors.
- The esophagus remains posterior to the source heart, and the stomach/hiatus remain below it. No heart/context collision is apparent in the inspected images.
- Fixed context geometry remains stable across TTE and TEE views. No heart is cropped by the upright anatomy camera.
- Cropping of the superior or lateral reference torso is part of thoracic framing; the heart, relevant probe, and acquisition sector remain visible.
- Some cuts are nearly edge-on from the upright camera. Their accepted source plane is unchanged; the probe anchor and CT panel provide the corresponding section view.
- The unsupported TG RV inlet/outlet pose retains its source CT and anatomy context while clearly withholding the probe. Outside-scan aortic targets remain explicitly labeled.

The visual findings agree with the complete-triangle source-envelope separation receipts in `clearance.json` and `body-placement.json`. Those numerical checks establish separation from retained support under the fixed model transform; neither the body reference nor the GI shape is patient-registered.

## Final native receipts

| Donor | Review SHA-256 | Native renders | Stale source files | GL errors |
|---|---|---:|---:|---:|
| s-20-29 | `e463d66e613650c37308af97de5881b660a394f1580204052d44db990438fe2a` | 112 | 0 | 0 |
| s-20-28 | `1057973d2b6fc5be6799318c0f87c9ebf4a145638b65d8377bc716ac7bf70fd7` | 112 | 0 | 0 |

## Inspected gallery fingerprints

- `docs/echo-donor-qc-v6/native/s-20-29/tte-anatomy-gallery.jpg` — SHA-256 `edaa053a26c7c6aaf8b9cd59a9ffb20970f4ef682176bec8636418978e320301`.
- `docs/echo-donor-qc-v6/native/s-20-29/tee-anatomy-gallery.jpg` — SHA-256 `58d9f563609cdaef96265086296c937fb9ef27277885f9ba3634df2cbba5dc04`.
- `docs/echo-donor-qc-v6/native/s-20-28/tte-anatomy-gallery.jpg` — SHA-256 `e016d180d948c6f15031b46fd714c256d3ab411689f347e44fbee744cd5b6caa`.
- `docs/echo-donor-qc-v6/native/s-20-28/tee-anatomy-gallery.jpg` — SHA-256 `a1100243086494ec97848eaa4f44b28809c5fecd7896b3c5db05882200bfd110`.

The completed free-lab preset containment work is separate from these atlas images. It does not alter any frozen anatomy, source frame, or atlas probe pose. Its physical guide calibration, source comparison and 24-case scaling/containment receipt are documented in `LAB-PRESETS.md`.
