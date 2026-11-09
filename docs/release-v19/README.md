# v19 — fine surface experiment and acquired clinical pilots

This release adds a requested experimental geometry path and two real clinical
sources while retaining the three-donor HOA interface and its established
camera/slice scheduling. It also makes Strong contrast the fresh-view default.

## Brighter Strong contrast

| HOA donor | Black point, normalized | White point, normalized | Gamma | Slice contrast | Brightness |
| --- | ---: | ---: | ---: | ---: | ---: |
| LADAF-2021-17 | 0.344 | 0.787 | 1.00 | 1.00 | 3.00 |
| S-20-29 | 0.162 | 0.568 | 0.85 | 1.00 | 3.00 |
| S-20-28 | 0.330 | 0.761 | 0.95 | 1.00 | 3.00 |

The previous Strong gamma values were 1.05, 0.90 and 1.00 respectively. The small
decrease lifts midtones without narrowing the v18 contrast windows further.
Original retains historical defaults, Balanced detail remains available, and
explicitly saved/custom values survive. No source voxels, thresholds, segmentation,
resolution, surface-normal algorithm or ultrasound gain change with this preset.
The measured v18 tradeoff between high contrast and retained tonal distinctions
still applies; the result is not a universal fidelity optimum.

## Clinical sources

| Source series | Stored voxel spacing, mm | Frames | Compressed display bytes |
| --- | --- | ---: | ---: |
| cMAC whole-heart MRI crop | 0.750 × 0.750 × 1.500 | 1 | 3,707,588 |
| cMAC cine SAX MRI | 1.250 × 1.250 × 8.000 | 30 | 13,547,360 |
| cMAC measured 4D ultrasound | 0.658 × 0.668 × 0.580 | 14 | 42,293,623 |
| SlicerHeart cardiac overview | 1.199 × 1.199 × 1.400 | 21 indices / 20 unique | 25,026,033 |
| SlicerHeart native valve/outflow detail | 0.600 × 0.600 × 0.700 | 21 indices / 20 unique | 32,988,798 |
| SlicerHeart native cardiac reference | 0.600 × 0.600 × 0.700 | 1 | 9,761,021 |

The combined clinical assets contain **127,324,423 compressed volume bytes**.
Visitors download the selected source/phase and a small bounded neighbor runway,
not this full total before using the viewer. Ordinary HOA startup loads none of
these clinical volumes. SlicerHeart's first overview frame is about 1.27 MB;
cMAC's first whole-heart MRI is about 3.71 MB.

cMAC is the actual volunteer-1 case from the 2011 Cardiac Motion Analysis
Challenge. It supplies same-volunteer MRI and apical 4D ultrasound. Their distinct
acquisitions remain unregistered with independent phase controls. The static
whole-heart MR acquisition cannot be animated; cine SAX phase slots contain
separately acquired slices with differing trigger times. A 1.5 mm stored interval
overlaps 3 mm MRI slice thickness. Neither the displayed grid nor smooth rendering
demonstrates that much acquired resolving power.

SlicerHeart's original 1,267,650,314-byte NRRD is an adolescent with repaired truncus
arteriosus. It is a congenital-heart-disease pilot, not a healthy comparison. The
original 21 indices include a bit-identical repeat of frame 0. Native detail and
the static reference preserve source spatial samples; overview is a declared
2×2×2 block mean. Physical phase times and paired ultrasound were not provided.

MRI/CT are fixed-window 8-bit display derivatives. cMAC ultrasound is exact
original unsigned-byte data. Gzip preserves the respective encoded bytes.
No synthetic intermediate frames, learned anatomical detail, clinical chamber
segmentation or source registration is introduced. See the complete provenance
and error accounting in [cMAC](../clinical-v19/cmac/README.md) and
[SlicerHeart](../clinical-v19/slicerheart/README.md).

## Fine-surface experiment

The new optional LADAF mesh uses the verified 79.4 µm volume with the existing
coordinate convention. A separate Gaussian-filtered scalar field defines a
derived isosurface; a topology-preserving slab pass freezes shared boundaries,
then a whole-object quadric simplification produces compact/detail display LODs.
The final LOD simplification is lossy and does not guarantee topology preservation.
The 19.85 µm acquisition has not been re-extracted at full scale.

The derived high-density reference contains **162,115,712 triangles**. Its
Gaussian filter has sigma **0.8 fine voxels, or 63.52 µm**. The first slab stage
retains about 18 million triangles; the final whole-object simplifier and
quantized encoding produce these downloadable options:

| Optional surface | Retained triangles | Download bytes | Decoded geometry bytes |
| --- | ---: | ---: | ---: |
| Compact | 497,714 | 4,406,836 | 8,562,920 |
| Detailed | 1,986,313 | 17,722,926 | 34,679,172 |

The comparison images show smoother chamber surfaces and fewer ridges, with
visible loss of small folds and thin structures. Compact sacrifices more valve
detail. This is an optional compression/smoothing experiment, not a
quality-lossless replacement. **Interactive volume remains the default.**
The UI describes this tradeoff next to the selector. Both simplification and
smoothing contribute to shape changes; the 16-bit position encoding itself has
a measured maximum rounding displacement of about 2.1 µm.

The bidirectional audit sampled 50,000 points in each direction per mesh. For
Detailed, the 95th-percentile distance from the served surface to the welded
intermediate was 0.0656 mm; in the reverse direction it was 0.1190 mm, with a
4.3234 mm sampled maximum where features had been removed. Compact's reverse
95th percentile was 0.5032 mm, with a 6.9558 mm sampled maximum. These compare
against an already smoothed and slab-simplified intermediate, so they must not
be presented as the complete error relative to acquired tissue.

Five separate slabs of the unsmoothed 79.4 µm field were also tested using 12,000
points per direction per slab. Original-contour-to-Detailed 95th-percentile
distances ranged from 0.6897 to 2.5875 mm, with a 4.9101 mm sampled maximum.
These larger omissions include filtering losses; the audit cannot distinguish
removed noise from genuine fine anatomy. These are sampled distances, not a
global error bound or clinical validation. The full method and per-slab results
are in [the surface report](../fine-surface-v19/README.md).

HFM1 stores quantized positions, normals and indices in a gzip payload. Metadata
and data hashes are verified before GPU upload in an on-demand worker. The
surface uses native output pixels during gestures and the existing measured
cut-face composite. Other thresholds and scalar display modes retain the
ordinary renderer. The existing scalar volume remains a fallback if an optional
mesh resource cannot be allocated. Exact size/error measurements are recorded
with the preparation and native-render evidence in `docs/fine-surface-v19/`.

## Verification scope

Verification uses actual source-file/hash/geometry checks, worker and DOM
integration tests, established camera/section regressions, and local offscreen
EGL renders of production shaders. It does not establish clinical segmentation
accuracy or device-specific browser frame rates. Browser and production HTTP
preview access was previously rejected by automatic approval review; no alternate
browser-control or production-probing path is used for this release. The native
Sites deployment result is the publication check.

All new static data must remain in the hosted build. The required v10 staging
step removes only verified redundant R2-indexed HOA binaries. The immutable R2
index, old hosted scan bytes and closed upload gates remain unchanged.
`scripts/verify-package-v19.py` checks every new encoded data file and all three
manifests against source hashes in staging and in the final archive. The actual
archive must remain at or below 268,435,456 bytes before it is saved or deployed.
