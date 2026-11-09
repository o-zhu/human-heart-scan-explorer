# S-20-28 · donor comparison source

[Official Human Organ Atlas record](https://human-organ-atlas.esrf.fr/datasets/1966162746) · [Dataset DOI](https://doi.org/10.15151/ESRF-DC-1966163810)

## Donor and acquisition

The official catalog identifies a **84-year-old male donor**. This is a complete heart acquisition, not a high-magnification regional scan. Native isotropic sampling is **19.85 µm**. Medical history is recorded verbatim in `source-metadata.json` and in the runtime donor manifest; the viewer does not reclassify the donor as healthy.

The reviewed central long and cross sections show open cardiac cavities and internal trabecular surfaces. This is an image observation, not a normal-heart or healthy-donor classification.

The source is fixed tissue, progressively transferred to 70% ethanol and mounted in agar. Its morphology cannot be read as a living heart in a particular cardiac phase. No chamber volumes or disease mechanisms are inferred from these images.

## Independent prepared data

The web viewer uses this donor's own source, geometry, cleanup support and intensity encoding. Preview and detailed volume grids share physical sample endpoints; the detailed volume uses **317.6 µm** source sampling. Ultra orthogonal images and fine oblique volume bricks use **79.4 µm** source sampling. Fine imagery is not claimed to be native 19.85 µm.

Each X/Y/Z image has fine in-plane sampling; neighboring served orthogonal planes advance four fine samples, **317.6 µm**. Cropped lossless WebP sections preserve retained uint8 source-display bytes exactly. Sparse gzip volume bricks have 64³ core samples with a positive one-voxel halo for trilinear interpolation. Fine source images remain independently cached per donor.

The source encoding range is **14938–22708** raw uint16 units. The default display window is recorded separately in `window-review-v11.json`. Display windowing changes brightness and contrast only. It does not modify the tissue threshold, cleanup support, source geometry or acoustic simulation inputs. Original quantitative uint16 data remain available from the source atlas.

Cleanup selects the largest reviewed 18-connected tissue component at raw threshold **17500**, then adds a conservative coarse margin and sampling guard. Its purpose is to hide disconnected container/agar debris. It is not chamber segmentation. Original windowed display volumes remain available when cleanup is disabled. See the source, cleaned and window-comparison contact sheets before changing this policy.

## Coordinate and anatomy limits

Every dataset has independent shape, spacing, origin and immutable serving indexes. N5 data are decoded as big-endian uint16 with X-fast indexing and mapped to world coordinates `[X,Z,-Y]`. Fine source voxel centers anchor the grid; at most three empty terminal columns are padded instead of deleting acquired voxels. See `browser-geometry.json` and the source pyramid attributes for exact values.

The thirteen Echo compatibility routes, eight section comparison routes and four Probe starting views are generated independently from this donor's measured tissue distribution. Display names are geometric. Clinical TTE/TEE registration, chamber identities and valve attachments have not been validated. The all-unassigned anatomy grid prevents copying another donor's segmentation. Reference movies are separate clinical recordings; they are not from this donor or registered acquisitions.

## Reproduce and verify

From the project root, with NumPy, SciPy, Pillow and Blosc2 installed (HTTPX optionally reuses public-source HTTP/1.1 connections):

```sh
python scripts/prepare-donor-v10.py --config configs/donors/s-20-28.json --workers 16 --stage all
python scripts/prepare-donor-views-v10.py --slug s-20-28 --texture-volume {source-cache}/heart-donor-1966162746/s2-clean-display-u8.npy
python scripts/verify-donor-views-v10.py --slug s-20-28
python tests/donor-comparison-v11.py --slug s-20-28 --require-fine
```

Use `--cache` or `--source-root` when reproducing in another working directory. Keep the fine array unchanged until prepared views and both source audit gates finish. The independent audit checks source byte order and axes, physical coordinates, crop positions, window mapping, image hashes, sparse brick halos and neutral anatomical labels. It does not establish clinical anatomical correctness.

## Provenance

Data attribution: **Human Organ Atlas Collaboration / ESRF**, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Full author list and acquisition metadata are in the source record. `source-metadata-provenance.json` records the exact public catalog bundle digest and official resource identifier. `source-neuroglancer.json` contains only public source metadata; no temporary reader token is included.

## Exact display quantization

Integral source windows use a uint16 lookup table with exact rational linear scaling, nearest-integer rounding and ties to even. `uint8-quantization-v11.json` records an exhaustive test against a 45-digit Decimal reference for all 65,536 possible input values. LADAF-2020-31 and S-20-29 are byte-identical to the previous floating implementation. S-20-28 had seven exact half steps one byte low because of reciprocal rounding; its display parts, fine array, prepared images and serving banks were regenerated with the exact rule. Raw source values, window endpoints, cleanup support, thresholds and physical geometry did not change.
