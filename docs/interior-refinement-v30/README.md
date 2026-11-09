# Interior refinement: activation and cut-face diagnostic

## Findings

Two separate effects can look like dark reconstruction debris in the proximal aortic view:

1. **Incomplete local surface activation.** The whole-heart mesh with the current hard exclusion masks, but without the local replacement surfaces, reproduces a prominent thick dark strip similar to the user's screenshot. The complete local reconstruction is visibly cleaner. This establishes a plausible failure mode; it does not establish which resources loaded in the user's browser. See the [whole-heart-only diagnostic](../cleanup-v30-left/activation-diagnostic/aortic-y293-comparison.jpg).
2. **Small stipple contributed by the original cut-face texture.** A controlled render with the selected local surfaces already active shows that a small dark speckle cluster comes from the prepared source raster at the cutting plane. It is distinct from the thick surface strip above. The source raster and cleanup masks are deliberately unchanged by this investigation.

## Exact cap comparison

![Original cut-face texture versus cap hidden, with geometry held fixed](aortic-y293-cap-roi-comparison.png)

The panels show the same 90 × 110 pixel region, enlarged by integer nearest-neighbor replication for inspection. The unscaled [cap-on crop](aortic-y293-cap-on-roi.png) and [cap-off crop](aortic-y293-cap-off-roi.png) are lossless, pixel-identical crops of the corresponding render frames. The [crop receipt](roi-receipt.json) records their decoded checksums.

The experiment uses sagittal section 293, fine-grid Y = 1168, target fine-grid XYZ = [1080, 1168, 990], and camera distance 0.30. It renders the guarded left candidate with production shaders, the full retained half-space, and corrected Gentle normals. Only the prepared cap texture is replaced temporarily by an equally sized zero raster; `capReady` remains true so no scalar-volume fallback is introduced. Geometry, cleanup masks, camera, and rendering settings stay fixed. Restoring the cap reproduces the original frame exactly. See [render verification](aortic-y293-cap-diagnostic.json).

The ROI is [340, 375, 430, 485), in the original 720 × 840 frame. The pixel classification selects changed pixels whose mean RGB value is below 55 with the cap present, and brightens by more than 7 when the cap is hidden. These cutoffs identify the visible dark cluster for this diagnostic; they are not cleanup thresholds.

| Check within the fixed ROI | Result |
| --- | ---: |
| Selected dark pixels contributed by the cap | 284 |
| Inside the reviewed local replacement box | 284 |
| Nearest prepared-cap value differs from verified source value | 0 |
| Gaussian σ = 0.5 baseline below the original extraction level, 71.4 | 246 |
| Excluded by an active local or hard mask | 0 |

For example, fine-grid [1087, 1168, 968] has source/prepared-cap value 72 and Gaussian baseline 68.944. That sample was already below the baseline mesh extraction threshold, so the existing local low-band mask, which records removed baseline foreground, does not mark it. The cap can still display its original intensity. The full [source-pixel diagnostic](source-pixel-diagnostic.json) records the comparison, verified source identity, and additional examples. CPU bilinear estimates differ slightly at threshold boundaries from GPU interpolation; nearest source-raster equality is exact.

These are windowed phase-contrast display intensities, **not calibrated Hounsfield units**. No histological identity is inferred from their shading. Hiding the cap also exposes underlying geometry and removes genuine cut surfaces, so total changed pixels are not an artifact-removal metric.

## Runtime correction and verification

The UI now reports interior refinement independently of the high-resolution whole-heart badge. It shows “Refining interior surfaces…” while dependencies are pending, “Interior surfaces refined” only when the complete collection is actually active, and “Interior refinement incomplete” with Retry after a failure. The same state is visible outside the Detail panel. Retry requests only missing refinement dependencies and retains the complete existing reconstruction. Incompatible display modes do not retain a refined claim.

`tests/interior-refinement-status.mjs` passed all three integration cases: delayed fourth-region activation with failure/retry, local surfaces arriving before delayed or failed hard masks, and workspace cancellation/resume plus activation gates. The existing fine-surface controller suite passed 35/35. Root runs the final canonical asset suite separately after assembly.

The diagnostic supports preserving the original cap data. Broad suppression of its fine texture would require separate anatomical evidence and could remove real thin tissue. No cap, source-volume, or mask changes were made for this report.
