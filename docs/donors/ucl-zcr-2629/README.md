# UCL-ZCR-2629: a second measured heart source

The new source is the ESRF Human Organ Atlas record [2298522198](https://human-organ-atlas.esrf.fr/datasets/2298522198), DOI [10.15151/ESRF-DC-2299323295](https://doi.org/10.15151/ESRF-DC-2299323295). The official record gives the donor age as **under 18** and the medical information as **“Disease free.”** It does not supply an exact age or sex. The record describes an overview of the complete heart, acquired on BM18 on 26 April 2024 at **7.032 µm** native voxel spacing. Its reuse license is **CC BY 4.0**, with attribution to the Human Organ Atlas Collaboration / ESRF.

This is an independently processed specimen. No LADAF-2021-17 density, cleanup mask, chamber label or preset landmark is substituted into this volume.

## Public source and provenance

The official linked Neuroglancer scene names this OME-Zarr source:

```
https://storage.googleapis.com/ucl-hip-ct-35a68e99feaae8932b1d44da0358940b/UCL-ZCR-2629/heart/7.032um_complete-organ_bm18.ome.zarr/
```

The scene also supplies the display intensity interval **35893–38534**. The pipeline uses that interval instead of borrowing the adult specimen's intensity mapping. `source-metadata.json` is the verbatim record extracted from the official HOA application bundle `https://human-organ-atlas.esrf.fr/assets/index-DR901JiP.js`. `source-neuroglancer.json` is the scene linked by that record. The Zarr attribute snapshots document shape, axes, transforms, byte order, and compression.

The source declares axes **X, Y, Z**, C order, little-endian uint16, and Blosc/Zstandard chunks of 128³ voxels. The importer transposes these arrays into the renderer's **Z, Y, X** memory order, where X is fastest. The native Zarr shape is **4615 × 4675 × 7300** in declared X/Y/Z order; the portal's two reconstruction X/Y size fields are in the opposite order. Registration uses the actual Zarr axes and metadata.

## Display derivatives

| Derivative | Dimensions or lattice | Voxel/pixel pitch | Purpose |
| --- | --- | --- | --- |
| Fast volume | 145 × 147 × 229 | 225.024 µm | Small first render |
| Detailed volume | 289 × 293 × 457 | 112.512 µm | Interactive 3D surface reconstruction |
| Ultra source lattice | 1153 × 1169 × 1825 | 28.128 µm | Orthogonal and arbitrary measured cut faces |
| Cleaned fine bounding box | 1133 × 1165 × 1825 | 28.128 µm | Source of the hosted texture and brick banks |
| Orthogonal section positions | 289 X, 293 Y, 457 Z | 112.512 µm between sections | One exact fine section at every detailed-volume slice position |

The full displayed voxel-center extent is **32.403456 × 32.853504 × 51.305472 mm**. The scan's longest dimension is substantially smaller than the adult specimen. Physical measurements and the probe scale must use this specimen's metadata.

The display window maps uint16 source values to uint8. All subsequent WebP and gzip compression is lossless with respect to those explicitly windowed, cleaned uint8 values. These derivatives are not a substitute for quantitative raw uint16 measurements or native 7.032 µm imaging.

### Exact pyramid registration

OME-Zarr stores a translation as well as a scale for each pyramid level. Fine level 2 centers are at `28.128*j + 14.064` µm. Level 4 centers are at `112.512*i + 56.256` µm. Treating index `i` at level 4 as fine index `4*i` without accounting for the translations would shift the cut face by **42.192 µm on every axis**.

The browser extent is anchored to the fine lattice. The detailed volume therefore samples level 4 at `i − 0.375`. It uses trilinear interpolation of the existing coarse source, with nearest uint16 output (at most half a raw intensity unit of rounding) before applying the display window. It does not invent high-frequency detail. Ultra orthogonal section `i` uses the exact measured fine index `4*i`. The preview uses a small Gaussian prefilter followed by exact alternate coarse samples, retaining the same endpoints.

One terminal fine X column, index 1153 of the source's 1154-column array, is outside this shared extent. It maps to an entirely empty terminal cell of the conservative support mask. The check is asserted by the pipeline and independently verified; no retained support is lost. All crop origins are even and crop dimensions are odd, so the intermediate detail mode can take exact alternate pixels without distorting the physical image extent.

The normalized renderer transform is:

```
worldX = (fineX − 576) / 1824
worldY = (fineZ − 912) / 1824
worldZ = (584 − fineY) / 1824
```

These are acquisition coordinates, not a claim of clinical patient orientation.

### Conservative exterior cleanup

The cleanup starts from the largest 18-connected component above raw intensity 36738.12, corresponding to the default display threshold of 0.32. That component contains 12,904,540 of the 13,006,891 above-threshold coarse voxels. It is expanded by three Manhattan-neighborhood coarse voxels and an additional resampling guard. A checked compact support mask preserves every voxel of that connected core.

The cleaned browser volumes additionally retain a three-voxel interpolation halo around this support. Their original, uncleaned display volumes remain separately available when Clean Scan is disabled. The fine texture banks omit exterior background and disconnected debris outside the documented support. They preserve source-windowed values inside it, including values below the rendering threshold. This is a display cleanup, not clinical segmentation or a reconstruction of absent tissue. Source discontinuities, narrow closed cavities, and bright scanning artifacts that intersect retained tissue are not silently repaired.

### Sparse and lossless packaging

Each orthogonal Ultra image contains only its nonzero bounding rectangle plus a small zero border. Its position in the full source image is recorded in the manifest. Empty slices share one tiny image. Every encoded image is decoded and compared byte-for-byte during preparation.

The fine density is stored in 64³ interior blocks with a positive one-voxel halo, producing 65³ stored samples. All-zero blocks are implicit; nonempty blocks are compressed with deterministic gzip. The halo supplies the eight original neighboring samples for trilinear interpolation at block seams. Images and blocks include encoded SHA-256 hashes; blocks also include hashes of decoded values. The worker serves only entries in immutable manifest-bound allowlists.

Prepared oblique Echo, Flow, and Probe cuts are generated separately from the same fine density. Their donor-specific plane definitions, texture registration, and annotation limitations are documented in the accompanying view-preparation records. The two specimens' clinical ultrasound reference movies are educational comparison recordings, not ultrasound acquired from either scanned donor.

## Reproduction

Install the preprocessing dependencies from `scripts/requirements-volume.txt`, then run:

```bash
python scripts/prepare-donor-v8.py --cache /absolute/path/to/donor-2629-cache --stage all --workers 12
```

The downloader verifies the published OME dimensions, axes and coordinate transforms before processing. Source chunks are resumable and cached unchanged. The first run retrieves all 36 coarse chunks and only the fine chunks intersecting the conservative support. Individual stages are also available: `preview`, `fine`, `sections`, and `bricks`; run them in that order. The latter two are independent once `fine` has completed and may run concurrently.

Generated runtime files are under `public/assets/donors/ucl-zcr-2629/`. The larger image and density banks are under `data/donors/ucl-zcr-2629/ultra-sections/` and `data/donors/ucl-zcr-2629/ultra-volume/`. Their serving indices are under `server/donors/ucl-zcr-2629/`. The existing adult donor's source files and banks are preserved.

Then run the independent data verification:

```bash
python scripts/verify-donor-data-v8.py --cache /absolute/path/to/donor-2629-cache
```

`data-verification.json` records the executed checks: source byte ordering, physical alignment, volume round trips, fine intensity preservation, every served object's size and SHA-256, representative orthogonal crop/plane matches, and block interiors plus boundary halos. These checks validate the imaging data path; they do not establish clinical segmentation accuracy.
