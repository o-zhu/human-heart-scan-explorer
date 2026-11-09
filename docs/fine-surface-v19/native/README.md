# Native fine-surface review

`tests/fine-surface-v19-native.py` renders the shipped HFM1 meshes with the production mesh vertex/fragment shaders and the existing full-output cut-face compositor in offscreen EGL. The measured comparison uses LADAF-2021-17's actual 79.4 µm LV-inflow texture. All three panels use the same camera and display transfer. The volume comparison uses the resident 317.6 µm surface field; it is a useful application baseline, not a dense reference for geometric error.

## Result

Both final meshes passed binary integrity, source-coordinate, projection and cap-compositing checks. The native run reported no OpenGL errors.

| Shipped option | Vertices | Triangles | Compressed bytes |
| --- | ---: | ---: | ---: |
| Compact (`balanced`) | 215,860 | 497,714 | 4,406,836 |
| Detail | 903,615 | 1,986,313 | 17,722,926 |

The measured cut face was pixel-identical to the production volume result in both mesh options: 135,405 checked cap pixels in the complete view and 277,476 in the close view, with a maximum per-channel difference of zero. The cap is correctly absent when viewing the retained side. The source texture checksum remains unchanged.

The existing low- and high-resolution volume metadata both yield exactly the mesh's physical endpoint extent. No axis-specific scaling or registration correction was required. Encoded coordinates invert into the retained 79.4 µm source crop using the existing world convention `(x, z, −y)`. Five quantized diagnostic markers projected within 0.501 pixel of the cap camera's expected raster position. The largest encoded unit-normal length error was below 0.000026.

`fine-surface-native.json` records the hashes, physical extents and per-mesh results. Its renderer and module hashes identify the final production files. Following the final help-copy change, the exported production shaders were checked again and their hashes were unchanged; the final clinical application hash was also confirmed against its native report.

## Visual assessment

- `surface-comparison.jpg` shows the full cutaway with the same measured cap. The cut-face fibers and source intensity detail are retained exactly while only the surrounding surface representation changes.
- `valve-closeup-comparison.jpg` makes the lossy tradeoff apparent. Compact removes visible folds and produces more angular edges in fine structures. Detail retains more of those structures, but it still smooths small variations and changes thin edges. Neither option should be described as lossless, an expert valve reconstruction or an increase in measured resolution.
- `whole-surface-comparison.jpg` shows the uncut exterior. Both meshes reduce the baseline's parallel ridging. They also flatten some local relief, introduce visible simplification facets and change some small exterior gaps. Several broad patch boundaries are present in the baseline too; this visual comparison alone cannot determine the anatomical validity or topology of individual openings.

Keep the surface experiment optional. Detail is the more appropriate mesh choice for close inspection; retain **Interactive volume** as the comparison for fine valves, chordae and thin structures. Neither smoothing nor decimation establishes that a missing structure was an artifact. Geometric distance measurements are documented separately in the fine-surface preparation report and do not establish anatomical correctness or topology preservation.

## Scope

`tests/fine-surface-v19.mjs` additionally runs the real worker against both final compressed files, checks their compressed/decoded hashes and inventories, and confirms rejection of corrupt checksum, layout, length, version and index data. Its three tests passed.

The native renders use llvmpipe at 720 × 840 pixels. This review does not involve browser automation or a production HTTP preview and does not measure browser loading, user-device frame rates, gesture latency or clinical validity. The original scan data and measured cut-face textures are not modified by this experiment.
