# v29: targeted refinement, slab shading repair and bounded display compression

The release builds on source version 50, including its exact-raster fixes for
main starting views and Echo. Scientific source arrays and all historical
immutable banks are retained. Changes are limited to reversible display
derivatives and their delivery.

## Selected changes

- LVOT / proximal aortic valve: a source-guided extension of the local patch,
  preserving the preceding field and protecting bright source cores.
- Pulmonary lumen: a narrow additional perivalvular field; a broad threshold
  increase was rejected because it roughened the smooth vessel wall.
- Exterior aorta/right-heart region: one bounded fourth patch reduces weak,
  sharp matrix while retaining measured tubular profiles. This is not a named
  or complete coronary segmentation.
- LA/PV: two inconsistent inherited contour anchors and one small contour
  edge were corrected. The three other object masks are byte-identical to v28.
- Surface stripes: seam-local normal correction at the original 64-cell slab
  boundaries. Positions and triangle indices are unchanged. The reviewed wall
  ROI has 73.39% lower local high-frequency stripe contrast; this is a shading
  metric, not an anatomical accuracy measurement.

All four patch boxes are disjoint. The canonical collection checks all
109,928 previously restored atrial-wall samples for zero exclusion overlap.
HiP-CT values used here are windowed uint8 display values, not calibrated HU.

## Compression

| Collection | Original bytes | New bytes | Reduction |
| --- | ---: | ---: | ---: |
| Whole-heart mesh | 227,902,460 | 131,645,142 | 42.24% |
| Orthogonal section images | 507,669,076 | 434,403,820 | 14.43% |
| Combined | 735,571,536 | 566,048,962 | 23.05% |

The mesh retains every original position and index byte, including triangle
corner order. Only corrected shading normals use lossy octahedral encoding;
maximum angular error is 0.06004 degrees. Thirty-two independently verified
blocks avoid keeping the full compressed download beside the decoded mesh.
Decoded size and final GPU allocation do not shrink.

All 1,097 section images were decoded and compared, covering 1,227,138,985
pixels. Maximum error is one 8-bit grayscale level, with no spatial resampling.
Zero support, clipped white and threshold-72 classification are exact at source
pixel centers. Other thresholds can differ by one level. Original lossless
images remain in the original immutable bank. Native 19.85 micrometer regions
and their priority over the whole-heart display are unchanged.

The production shader comparison of unquantized corrected normals and the
compact normals had mean absolute channel error 0.00927/255; 99.9886% of pixels
were within one level. A few nearly tangent/facing-boundary pixels differed
more, with a maximum of 122/255. Therefore no universal one-level rendered-color
bound is claimed for mesh normal quantization. Measured cut-face pixels in
that normals-only comparison were identical.

## Evidence

- `docs/cleanup-v29-left/`: LVOT and LA source review, preserved-wall checks.
- `docs/cleanup-v29-right/`: pulmonary and exterior source review and decisions.
- `docs/local-refinement-v29/`: canonical asset hashes and lifecycle checks.
- `docs/surface-stripes-v29/`: unchanged-geometry shading comparisons.
- `docs/compression-v29/`: full bank measurements, alternatives and decoder tests.

Native EGL renders use the production shader source with verified source
geometry. They are not browser frame-rate measurements or expert anatomical
validation. Some source-supported thin walls, leaflets and connected matrix
remain intentionally.

## Hosting

The new `display-compact-v29` immutable collection contains mesh blocks,
section images, three compact-profile manifests, and the new canonical cleanup binaries.
The original profiles remained active during seeding. All 1,139 objects and
587,787,154 bytes passed live GET checksum verification. The final source
activates the new profiles, closes the new upload code gate, and removes its
separate temporary runtime secret before publication. Existing banks
and their closed gates remain unchanged.

After the standard build, run the existing native, fine, motion and v28 cleanup
staging scripts; then `scripts/prepare-display-compact-v29.py --stage` (add
`--seed` only for the inactive seed build), followed by local-hosting and final
comparison-display staging. This moves only verified new build copies out of
the static package. Both compressed and expanded deployment sizes remain
bounded by the existing 256 MiB limit. Publication receipts are added here
after the corresponding operations succeed.
