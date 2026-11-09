# Whole-heart geometry for Chest Orientation

The TTE Chest Orientation viewport uses a complete, prepared heart model for
its selected donor. `public/assets/probe-heart-v44/manifest.json` is the runtime
contract. It does not contain a generic reference heart and does not fit or
move the source heart as the probe moves.

## Models and coordinate mapping

LADAF reuses the existing `public/assets/fine-surface-v19/balanced.hfm.gz`
byte-for-byte: 497,714 triangles, 4,406,836 compressed bytes and 8,562,920 decoded
bytes. Its source is the recorded 79.4 µm display acquisition. Its smoothing,
simplification and sampled-distance qualifications remain those in the original
fine-surface manifest and `docs/fine-surface-v19/`.

Each S-20 model is independently prepared from that donor's complete existing
cleaned high display volume. No LADAF geometry is deformed into either donor.
S-20-29 uses 478 × 478 × 487 samples at 318.24 µm; S-20-28 uses
477 × 477 × 509 samples at 317.6 µm. The source arrays are windowed uint8 display
derivatives, not calibrated Hounsfield-unit volumes or native-resolution
quantitative source acquisitions.

| Donor | Vertices | Triangles | Gzip bytes | Decoded HFM bytes |
| --- | ---: | ---: | ---: | ---: |
| LADAF-2021-17, reused payload | 215,860 | 497,714 | 4,406,836 | 8,562,920 |
| S-20-29 | 148,080 | 299,956 | 2,880,964 | 5,376,464 |
| S-20-28 | 146,639 | 299,940 | 2,865,878 | 5,358,984 |

Only the two S-donor payloads are new: 5,746,842 bytes combined. LADAF refers
to its existing asset URL, so this preparation does not duplicate that payload.

All models use the same physical mapping as `volumeGeometry()` in
`public/probe-geometry.js`: each source sample axis has physical length
`(dimension − 1) × spacing`, then acquisition `[X,Y,Z]` maps to centered world
`[X,Z,−Y]`. HFM positions are normalized by the longest physical sample-center
extent. Multiply decoded normalized coordinates by the manifest's `referenceMm`
to obtain donor world millimetres. The half-extent bounds, center and reference
length are not re-fitted to a moving probe or surrounding reference skeleton.

The three reference lengths are 168.0104 mm (LADAF), 154.66464 mm (S-20-29), and
161.3408 mm (S-20-28). The manifest contains the exact floating-point values
computed from the source records. The caller must verify source identity and
extent before installation; it must not attach one donor's mesh to another donor.

## S-donor processing

`python3 scripts/prepare-probe-heart-v44.py` performs the following operations:

1. Verify every compressed source-part length/SHA-256, decompress the bytes,
   reverse its declared predictor, verify decoded SHA-256, and assemble exactly
   the declared non-overlapping Z ranges.
2. Mark the source array read-only. Create a separate float32 Gaussian display
   field, sigma 0.55 samples, three-sigma truncation, nearest edge handling.
   The unchanged scalar data remain the source for the main reconstruction,
   sections and ultrasound model.
3. Extract the full high-grid isosurface with VTK FlyingEdges3D at 0.28 × 255.
   No 40-axis resampling grid is used for these prepared meshes.
4. Apply VTK QuadricDecimation to a target of 300,000 triangles, with volume
   preservation enabled and boundary weight 100. This is a lossy geometric
   simplification; topology, fine folds and thin structures are not guaranteed.
5. Reuse the existing HFM encoder to compute normals, remove zero-area and
   position-quantization-collapsed triangles, spatially order vertices/faces,
   quantize positions to UNORM16 across the declared bounds and normals to
   SNORM16, and write deterministic gzip bytes. All per-step counts and
   quantization measurements are retained in the manifest.
6. Check every HFM layout, index, encoded/decoded length and checksum. Recheck
   source hashes and verify that the input source array did not change.

The HFM v1 header is eight little-endian uint32 values: magic `0x314d4648`,
version 1, vertex count, index count, position offset, normal offset, index
buffer offset, reserved zero. Positions and normals occupy six bytes per
vertex in separate arrays; uint32 triangle indices occupy four bytes each.
Array starts are aligned to four bytes. Positions map through manifest bounds;
no translation or scale is hidden in the binary payload.

The existing encoder clamps positions to the source sample-center box before
quantization. Quadric simplification can move a boundary vertex just outside
that box. Therefore its inherited `quantizationMaximumMm` and
`quantizationRmsMm` fields include clamping displacement; they are not solely
16-bit rounding error. For S-20-28, the recorded maximum is 0.15553 mm and RMS
is 0.001271 mm. For S-20-29, maximum is 0.001996 mm and RMS is 0.001167 mm.

## Reproduction and verification

The builder uses Python, NumPy, SciPy, and VTK. The recorded build versions are
in each new model's provenance. It imports the existing encoder from
`scripts/fine-surface-v19/prepare.py`, so retain that file with this script.
The builder reads only existing, permitted project display assets and needs
no cloud credentials or new raw acquisition download.

```sh
python3 scripts/prepare-probe-heart-v44.py
python3 scripts/prepare-probe-heart-v44.py --verify
```

`--verify` uses the Python standard library only. It checks all three immutable
source identities, HFM hashes/layouts/index bounds, declared byte/index budgets,
and physical coordinate mappings. Rebuilding records deterministic sampling
seeds and nearest-triangle distance summaries for 5,000 area-weighted samples
in each direction between the full filtered isosurface and compact mesh. These
are sampled geometric comparisons, not a Hausdorff guarantee or anatomical
validation. Measurements are stored in the manifest; no performance result is
inferred from their successful execution.

The full-grid reference has 4,381,224 triangles for S-20-29 and 5,706,072 for
S-20-28. The sampled source-to-compact 95th-percentile distances are 0.08486 mm
and 0.08793 mm, respectively. Maximum sampled distances are 4.27257 mm and
1.85834 mm, so these compact models must not be presented as uniformly
submillimetre-accurate or topology-preserving. Compact-to-source
95th-percentile distances are 0.07539 mm and 0.08168 mm; their sampled maxima
are 0.17333 mm and 0.22499 mm. These comparisons precede HFM quantization and
exclude the effect of the stated scalar smoothing.

`runtime-coordinate-check.json` records a direct check against the current
JavaScript `volumeGeometry()` function for all three donors. No model is
scaled or translated independently of the loaded donor's source geometry.

For an optional offline visual check, with NumPy, Pillow and Mesa/EGL installed:

```sh
python3 docs/probe-heart-v44/render-models.py
```

This renders the actual indexed HFM geometry from three fixed source-space
directions per donor. The reviewed nine-view output is
`whole-heart-model-review.jpg`, with checksums and the llvmpipe renderer name
in `native-render-review.json`. It confirms complete models render with valid
finite positions and normalized normals; it is an offline model review and
does not measure browser performance or validate anatomy.

The original source volumes, original masks, CT textures, fine surface assets,
labels and their metadata are unchanged. Neither the complete quantitative
source acquisition nor the larger native-region processing pipeline was rerun.
Browser integration, rendering and physical-device performance are separate
checks from this offline asset preparation.

## Licensing and interpretation

The meshes remain derived Human Organ Atlas data under CC BY 4.0, with each
donor's original dataset DOI, creator credit and modification history recorded
in its manifest entry. Source references:

- [LADAF-2021-17](https://human-organ-atlas.esrf.fr/datasets/1659197537),
  [10.15151/ESRF-DC-1634390196](https://doi.org/10.15151/ESRF-DC-1634390196).
- [S-20-29](https://human-organ-atlas.esrf.fr/datasets/1773963465),
  [10.15151/ESRF-DC-1773964017](https://doi.org/10.15151/ESRF-DC-1773964017).
- [S-20-28](https://human-organ-atlas.esrf.fr/datasets/1966162746),
  [10.15151/ESRF-DC-1966163810](https://doi.org/10.15151/ESRF-DC-1966163810).
- [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

This viewport is an orientation aid. It uses compact whole-heart geometry, not
the complete finalized Ultra model. The body, probe and skin remain illustrative
anatomy and are not patient-specific registration. A plane missing the heart is
shown as missing it; the heart must not be moved to create an artificial match.
