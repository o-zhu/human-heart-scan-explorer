# v11 donor source and display audit

## Requested sources

| Dataset | Donor | Official age / sex | Native sampling | Prepared Ultra sampling |
|---|---|---|---|---|
| [1966161627](https://human-organ-atlas.esrf.fr/datasets/1966161627) | LADAF-2020-31 | 69 / female | 19.89 µm | 79.56 µm |
| [1773963465](https://human-organ-atlas.esrf.fr/datasets/1773963465) | S-20-29 | 80 / male | 19.89 µm | 79.56 µm |
| [1966162746](https://human-organ-atlas.esrf.fr/datasets/1966162746) | S-20-28 | 84 / male | 19.85 µm | 79.4 µm |

All three are whole-heart acquisitions. They are not under-18 comparison donors. The official metadata do not establish disease-free status: S-20-29 records acute right-heart failure, pulmonary thromboembolism and COVID-19; S-20-28 records death from COVID-19; LADAF-2020-31 records diabetes, prior cancer treatment and other medical conditions. Exact source records and acquisition provenance are retained in each donor directory.

Source-only inspection found open cavities in the sampled S-20-29 and S-20-28 sections. LADAF-2020-31 has narrow ventricular spaces in the reviewed central sections. These observations do not establish a cause, diagnosis, live cardiac phase or a chamber volume. The provided physical extents describe source fields, not measured chambers.

## Reproducible preparation

Each donor is independently decoded from its actual public N5 pyramid, with original big-endian uint16 and X-fast indexing verified. The native source and each pyramid shape are checked against published attributes. Fine source voxel centers anchor physical registration, with zero padding for incomplete terminal strides instead of omitting acquired source voxels. LADAF-2020-31's catalog/native-Z discrepancy is recorded explicitly: the catalog says 8,231; the actual served N5 s0 dimension is 8,228.

A source-specific display encoding maps uint16 to uint8. Brightness windowing is a separate adjustable display transfer shared by the viewer modules. Conservative tissue support hides container/agar debris; it is not chamber segmentation. The cleaned/source contact sheets and window candidate comparisons are preserved. The original windowed display volume remains available when cleanup is disabled.

All integral encoding windows now use exact rational nearest-integer quantization, with ties to even. The exhaustive independent Decimal test covers all 65,536 uint16 values for every donor. It identified seven S-20-28 half-step values that the prior floating reciprocal rounded one byte low. S-20-28's display parts, fine array, prepared images and banks were rebuilt. Raw source values, window endpoints and physical grid coordinates stayed unchanged. The other two donor windows were exhaustively proven byte-identical to their previous encoding.

Orthogonal images are cropped lossless WebP. Sparse fine volume bricks are lossless gzip over retained uint8 display bytes, with a 64³ core and one positive interpolation halo. These compression guarantees apply to the prepared display data, not to the original quantitative uint16 acquisition. Ultra section positions advance four fine samples; their in-plane sampling remains 79.56 or 79.4 µm.

Each donor has 13 independently generated Echo section routes, eight geometric comparison views and four exact prepared Probe planes. The runtime also has its own sparse fine volume for moved/rotated planes. All 75 prepared images come from their respective donor arrays. Anatomical identities and clinical TTE/TEE registration are left unassigned; another donor's labels and coordinates are never reused.

## Verification evidence

- `data-validation.json`: combined independent acquired-source, geometry, crop, prepared-plane and sparse-brick audit.
- `<slug>-data-validation.json`: per-donor complete snapshot, retained before source intermediates are released.
- `new-donor-inventory.json`: exact final file/byte counts and data identities.
- `../donors/<slug>/encoded-bank-verification.json`: complete serving-file hashes, 20,000 source voxel checks and 4,096 physical registration checks.
- `../donors/<slug>/uint8-quantization-v11.json`: complete uint16-domain quantization comparison and corrected half-step cases.
- `../donors/<slug>/view-validation.json`: independent-donor image identity, plane basis and neutral-label checks.
- `../donors/<slug>/*review*.jpg`: source-derived scientific contact sheets, not browser screenshots.

Reproduce the strict source audit with `python tests/donor-comparison-v11.py --require-fine`. It needs the acquired-source caches, which are intentionally not part of the portable website. The ordinary local viewer and checksummed export do not require these research intermediates. This is a numerical/data-integrity audit; it does not substitute for expert anatomical registration or clinical validation.
