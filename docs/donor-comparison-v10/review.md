# Independent comparison-donor validation

This audit covers UCL-ZCR-2337 (2298521860), UCL-ZCR-2627 (2298522608), and UCL-ZCR-2628 (2298522707). It checks source decoding, physical registration, byte preservation, prepared image correspondence, and the browser modules' donor-specific contracts. It does not assign chambers or valves, validate clinical echo orientation, measure functional chamber volumes, or claim a browser/device performance benchmark.

## Concrete defect caught during preprocessing

The first independent plane-pixel check detected a source-build race in the intermediate 2337 coarse views. The ROI-preserving cleaned high array was being rebuilt while its views were sampled. The final source-file hash reflected the completed array, but some images sampled the preceding support. One stored cross section differed at 727 pixels from a fresh sample of its recorded plane, with a maximum difference of 102 display levels. This was not a physical registration change.

The pipeline and view-generation owners established an explicit immutable-source readiness handshake. Prepared images must be regenerated after support changes; a single final provenance hash cannot prove that every image sampled the same source snapshot. The final validation therefore compares actual image pixels with independently interpolated source samples, as well as checking file hashes and source spacing.

## Geometry requirements

2337 has its longest physical source axis along Y. Its registered physical extent is 74.7648 × 81.39168 × 71.87616 mm in source XYZ. The world mapping is centered source `[X, Z, -Y]`, divided by the longest physical center extent. The code must not normalize by Z alone.

The acquired fine source dimensions contain even axes. The shared grid pads terminal columns with zeros instead of deleting measured tissue. Padding is 1 × 1 × 2 columns for 2337, 2 × 3 × 0 for 2627, and 2 × 2 × 3 for 2628. The lower-resolution preview uses per-axis spacing to preserve the same center-to-center physical endpoints. Padding is display registration, not added anatomy.

Orthogonal Ultra textures retain the fine source's in-plane sampling, while the bank's section locations advance by four fine source samples. These are separate resolutions. Arbitrary Echo and Probe planes are trilinear reformats of the measured fine display volume, not new native-resolution measurements.

## Reproducible tests

From the repository root:

```sh
python tests/donor-comparison-v10.py --require-fine
node tests/donor-comparison-v10.mjs --require-fine
```

During preprocessing, omit `--require-fine`. That mode explicitly reports pending fine banks and accepts truthfully labeled coarse prepared views. It is not a release gate for complete fine assets.

When disk space requires sequential preparation, run the Python command with `--slug ucl-zcr-2627` (or another donor) and `--require-fine` after that donor's source and banks are immutable. Each passing donor snapshot is saved separately and merged into the aggregate report. The aggregate `requireFine` becomes true only after all three donors have passed the complete fine gate. A source cache can then be released per donor; re-running its acquired-source comparisons requires regenerating that cache.

Use `--cache-root /your/source-cache-parent` on a local computer. The default is `{source-cache}`; each cache is named `heart-donor-<dataset ID>`. These regeneration intermediates are separate from the finished website banks.

The Python suite checks:

- An asymmetric coordinate-coded phantom through N5 big-endian X-fast and Zarr little-endian Z-fast decoding, including edge blocks and malformed layouts.
- Actual cached source metadata through the production registration setup, with even axes, Y longest, physical-origin offsets, terminal tissue retention, and empty registration padding.
- Every clean and original preview/high compressed part: encoded hash, independent predictor reversal, contiguous Z coverage, decoded hash, complete source-array byte equality, and the public per-file size bound.
- Independent source-chunk decoding and 4,098 sampled registered high voxels per donor, including physical interpolation and zero-padded boundaries.
- Every prepared Echo, comparison, and Probe image: donor namespace, decoded dimensions, lossless pixel hash, truthful source/in-plane spacing, orthonormal plane geometry, and 1,024 independently interpolated source samples including tissue and background.
- Independently decoded acquired fine uint16 samples, with separate windowing/support application, then representative orthogonal fine images and sparse bricks, including global crop offsets, exact sampled source bytes, positive halos, and source extent metadata.

The JavaScript suite checks actual application geometry and module code in controlled DOM fixtures:

- Identical preview/high physical extents; 2337's Y-longest field; donor-scaled millimeter probe motion; unchanged pose when refinement arrives.
- All four prepared Probe poses per donor agree with runtime geometry and the fine sampling plan.
- Fine source endpoints and crop origins, plus exact alternate-pixel Detail sampling without mutation of Ultra density values.
- Network-silent module construction; donor-isolated requests; neutral measured section names; no inherited chamber assignments; and disabled anatomy coloring for unassigned donors.

Reports are written to `data-validation.json` and `module-validation.json` beside this document. Their `requireFine` field records whether complete fine assets were required for that run.

## Interpretation limits

The three new donors remain anatomically unassigned. Measured section names describe geometry. The ultrasound recordings are independent references, not registered or same-donor acquisitions. A narrow cavity in a fixed specimen remains narrow in the data; display windowing does not inflate chambers or change the geometry threshold. The physical sizes and display values support image comparison, not a claim about in-vivo volumes or physiological function.
