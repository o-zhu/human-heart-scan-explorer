# UCL-ZCR-2627: measured comparison source

## Verified source

- Human Organ Atlas dataset: [2298522608](https://human-organ-atlas.esrf.fr/datasets/2298522608)
- Dataset DOI: [10.15151/ESRF-DC-2299323277](https://doi.org/10.15151/ESRF-DC-2299323277)
- Donor age, exactly as published: **`<18`**. Exact age and sex are not supplied in the catalog record.
- Catalog clinical information, exactly as published: **`Disease free`**.
- Scan: **7.032um_complete-organ**, 2024-04-29, ESRF BM18.
- Native voxel spacing: **7.032 µm**, isotropic.
- Actual source array dimensions, **XYZ**: **6,700 × 6,216 × 8,756**.
- Native array field of view, **XYZ**: **47.11 × 43.71 × 61.57 mm**, calculated as voxel count × native spacing. This is the array extent, not a measurement of heart or chamber volume.
- Source format: **ZARR**; [public source](https://storage.googleapis.com/ucl-hip-ct-35a68e99feaae8932b1d44da0358940b/UCL-ZCR-2627/heart/7.032um_complete-organ_bm18.ome.zarr/).
- Official Neuroglancer display window: **8,579–15,434** in raw uint16 intensity units. The browser encodes its 8-bit display voxels over the raw intensity interval **8,579–15,434**, recorded as `sourceWindow` in `manifest.json`. The adjustable display window and gamma then remap those stored values for rendering; the applied defaults are recorded under `displayWindow`. Encoding and the display transfer are separate stages.
- Source license and attribution: **CC BY 4.0**, Human Organ Atlas Collaboration / ESRF.

The original catalog record was read from the official Human Organ Atlas application bundle, `https://human-organ-atlas.esrf.fr/assets/index-DR901JiP.js`. `source-metadata.json` preserves that record. Its `/gallery/neuroglancer.json` resource was retrieved using the public reader endpoint documented in the portal application; `source-neuroglancer.json` preserves the scene and exact source URL. Small source array metadata files were fetched from the scene's public GCS path. These metadata requests do not depend on a private donor database.

**Coordinate caution:** the portal's reconstruction X/Y fields are reversed relative to the actual source array metadata. Processing follows the source's declared XYZ axes and dimensions, not the portal field ordering. The viewer maps physical-centered source XYZ to world `[X, Z, −Y]` and preserves physical extents.

## Comparison views and labels

The new comparison planes are calculated independently from this specimen's cleaned measured tissue distribution. The frame uses intensity-weighted geometric principal axes; these are **not anatomical long or short axes**. No adult donor or UCL-ZCR-2629 landmarks, chamber volumes, segmentations, textures, or camera coordinates are transferred.

The echo and probe modules use donor-specific measured starting planes with neutral geometric names. Clinical echo movies are independent teaching references, not same-donor acquisitions and not validated plane matches. The former chamber-view slots contain eight measured comparisons with neutral names. Their legacy routing keys are retained only for control compatibility; they do not assign chamber identity.

Anatomy labels remain unassigned. The tiny all-zero anatomy grid is a neutral sentinel used to prevent another donor's colors from appearing, not a segmentation result. The `geometricComparisonOnly`, `anatomicIdentityAssigned`, `clinicalPresetsReviewed`, and `segmentationAvailable` flags document this explicitly.

Prepared 2D WebP textures preserve all bytes of the windowed measured 8-bit plane. This lossless image encoding does not imply lossless preservation of the native 16-bit volume or native voxel resolution. Each image manifest records its actual source spacing, dimensions, decoded-pixel hash, and encoded file hash.

## Prepared comparison assets

The delivered set contains **13 echo reference planes, eight distinct geometric comparison planes, and four default probe planes**, all sampled from this donor at **28.128 µm**. The 25 lossless WebP images total **27.28 MB**. Each image is donor-separated and records both encoded-file and decoded-pixel hashes. Generation checks that the fine source and the coarse geometric-basis source remain unchanged from start to finish; independent verification checks the recorded planes against the measured source. See `view-preparation.json` and `view-validation.json` for the completed output record.

## Reproduce

Run the donor volume pipeline first, then:

```bash
python scripts/prepare-donor-views-v10.py --slug ucl-zcr-2627
```

The script uses `{source-cache}/heart-donor-2298522608/browser-geometry.json` and `display-high-clean-u8.npy` by default. `--source-root` changes that cache directory. To use a completed finer registered volume, add `--texture-volume PATH`. The crop origin is read from `s2-clean-display.json`; an optional `--texture-origin X Y Z` must match it. The generator requires the completed `fine-download.json` marker, checks the donor and geometry, and verifies that source hashes are unchanged throughout preparation. Keep the fine array immutable until independent plane-pixel validation completes. `--inspect-only` writes a contact sheet and the geometric frame without publishing view manifests.

Review `echo-measured-review.jpg`, `flow-measured-review.jpg`, `probe-measured-review.jpg`, `geometric-plane-review.json`, and `view-preparation.json` for the actual prepared planes, data spacing, and provenance.

## Scientific context

The primary study [The heterogeneous nature of atrioventricular conduction tissues in tetralogy of Fallot demonstrated by hierarchical phase-contrast tomography](https://pmc.ncbi.nlm.nih.gov/articles/PMC13244724/) lists this donor among normally connected control specimens. For processing, the current source array metadata takes precedence over conflicting table entries. A disease-free catalog label does not establish an exact age, physiological chamber size, or the specimen's original in-vivo cavity volume.
