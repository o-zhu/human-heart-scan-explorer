# Three additional under-18 source intensity reviews

These defaults were selected from measured coarse source arrays and inspected X/Y/Z sections. They control display intensity and conservative exterior support; they are not anatomical segmentations or clinical volume measurements.

| Specimen | Immutable source encoding window | Raw support / initial surface threshold | Normalized initial surface threshold | Display-only raw window | Display gamma | Additional contrast |
|---|---|---:|---:|---|---:|---:|
| UCL-ZCR-2337 | 20264–29567 | 24100 | 0.4123401053423627 | 23700–27700 | 0.9 | 1 |
| UCL-ZCR-2627 | 8579–15434 | 10800 | 0.3239970824215901 | 10500–15434 | 1.1 | 1 |
| UCL-ZCR-2628 | 12319–16970 | 14100 | 0.38292840249408727 | 13700–16970 | 1.1 | 1 |

`new-donor-display-profiles.json` provides exact normalized renderer parameters. Normalized limits are calculated against each immutable source encoding window, so adjusting the display does not require new texture downloads or reprocessing source banks.

The review sampled every second coarse voxel in each direction for connected-component exploration, using 18-connectivity. At the chosen thresholds the largest component contained 99.63%, 93.58% and 87.99% of all above-threshold foreground respectively. This is a numerical threshold/support audit, not an anatomical accuracy score.

UCL-ZCR-2337 includes substantial adjacent lung-like tissue in the measured source. The heart is visibly present in the same connected core. An inspected heart-region box at high-grid X=280–404, Y=134–310 and Z=180–300 contained 152,875 above-threshold sampled voxels; 99.9195% belonged to the largest core before the pipeline's dilation/guard. The production pipeline should also record retained support coverage at its full coarse grid. The adjacent source tissue should be disclosed in comparison labels rather than silently treated as a clean isolated-heart segmentation.

UCL-ZCR-2627 and UCL-ZCR-2628 include bright peripheral container walls. The next-largest components are four peripheral quadrants spanning scan height and touching array boundaries. Retaining every component larger than 1% of the main component would restore this container. The selected main core preserves the central organ, with the existing conservative three-voxel margin and sampling guard used to preserve fine edges. Original source comparison remains available.

The UCL-ZCR-2628 background mode was approximately 13300. A generic normalized threshold of 0.32 lies near source 13807 and can retain unwanted surrounding material. The reviewed threshold 14100 separates the core more cleanly while retaining low-intensity tissue in its support margin.

Across retained sampled core voxels, the proposed display upper clipping was approximately 0.57% for UCL-ZCR-2337, 1.19% for UCL-ZCR-2627 and 1.36% for UCL-ZCR-2628. For the latter two this is already imposed by the immutable uint8 encoding upper limit. Their midtone wall detail remains available and is preserved by the new display transfer.

The scientific contact sheet `new-donor-window-review.png` compares the uncleaned source intensity, the old boosted Tissue & space transfer and the proposed transfer. Both masked columns use identical source samples, thresholds and reviewed component masks. Those review masks were sampled at every second coarse voxel; they should not be confused with the full production cleanup asset or a chamber segmentation.

The metadata's age field remains `<18`; exact ages, sexes and functional chamber volumes are not inferred from the images.
