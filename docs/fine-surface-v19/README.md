# Fine surface experiment, v19

This is an optional, derived surface of **LADAF-2021-17**, extracted from the
existing **79.4 µm isotropic** fine display volume. It uses a four-times-finer
linear grid than the ordinary 317.6 µm display volume. It is **not** a new
19.85 µm reconstruction of the original acquisition, an independently acquired
view, or a clinically validated segmentation.

**Result:** a compact whole-heart mesh is feasible, but this compression and
smoothing level has visible costs. The detailed variant retains more small
folds than the compact variant. Native comparisons show loss of surface texture
and some small geometry, particularly in the compact mesh. Keep Interactive
volume and the measured Ultra cut faces available for fine structural review;
neither mesh is described as visually lossless.

## What was prepared

The pipeline verified the compressed and decoded SHA-256 of all
**5,127 source bricks** (805.01 MB
compressed), then assembled their nonoverlapping cores in a separate padded
uint8 array. The source crop is 1,153 ×
1,257 × 1,981 voxels.
The array and surface-processing checkpoints are research intermediates, not
startup downloads. The original bank, CT images, and Ultra cut-face textures are
unchanged.

1. Apply an isotropic Gaussian to a separate floating-point field with
   σ = **0.80 fine voxels
   (63.52 µm)** and a three-sigma
   truncation. Extract the 0.28 intensity isosurface with VTK Flying Edges.
2. Process overlapping slabs. Retain exact shared boundary vertices and preserve
   topology in this first simplification, with a 0.0794 mm accumulated-error
   parameter. This parameter is an algorithm setting, not an independently
   verified maximum geometric-error bound.
3. Weld identical slab-border vertices and resolve rare floating-point boundary
   duplicates within a **0.0001 mm (0.1 µm)** tolerance. The largest actual weld
   displacement is **0.0839 µm**.
   Then apply whole-object Fast Quadric Mesh Simplification to create the
   detailed level. VTK quadric decimation with its volume-preservation option
   enabled creates the compact level from that detailed geometry.
   **This final simplification is lossy and does not guarantee topology.**
4. Compute smooth vertex normals, spatially reorder triangles, quantize positions
   to 16-bit coordinates and normals to signed 16-bit components, then gzip the
   HFM1 binary. Gzip is lossless; smoothing, simplification, and quantization are
   the separate lossy steps.

Very thin or doubled sheets can produce cancelling averaged vertex normals.
Those vertices use their largest incident nondegenerate triangle's normal,
affecting shading rather than position. Only zero-area triangles are removed
before encoding; triangles that collapse to zero area after quantization are
also omitted. Each LOD's manifest records the normal-fallback count/fraction and
both removal counts, rather than hiding these effects on tiny geometry.

Whole-object VTK quadric decimation exceeded the available 8 GiB preparation
memory. The final detail stage therefore uses `fast-simplification 0.1.13` with
aggressiveness 7 in a separate process; its buffers are freed before the compact
VTK stage starts. This is a change of implementation, not a claim that memory
reduction is lossless. The output is subjected to the same distance audit below.

The fine filtered contour contained **162,115,712
triangles** before slab simplification and **18,044,992**
after the slab stage and seam welding. The hosted alternatives are:

| Level | Vertices | Triangles | Download | Decoded mesh | Maximum position quantization error |
|---|---:|---:|---:|---:|---:|
| Fine surface | 215,860 | 497,714 | 4.41 MB | 8.56 MB | 2.05 µm |
| Fine surface · detail | 903,615 | 1,986,313 | 17.72 MB | 34.68 MB | 2.07 µm |

File sizes use decimal MB. Only the selected mesh is fetched on demand, after
the normal viewer is usable. The fine surface is offered as an experiment;
Interactive volume remains available. Its fixed isosurface corresponds to the
0.28 threshold and cleaned source. Other thresholds and volume/translucent
rendering return to the ordinary renderer rather than pretending to regenerate
the mesh. Ultra cut faces continue to sample their recorded pixels.

## Measured approximation error

The audit decodes the actual hosted HFM1 files, samples points uniformly by
triangle area with a fixed random seed, and computes exact point-to-triangle
distance. The full-object reference is the welded result of the
topology-preserving slab stage. It already contains the density filtering and first
simplification, so this comparison isolates the later LOD and encoding stages.

| Level | Direction | RMS, mm | 95th percentile, mm | 99th percentile, mm | Largest sampled distance, mm |
|---|---|---:|---:|---:|---:|
| balanced | Hosted → intermediate | 0.0487 | 0.0983 | 0.1366 | 0.3683 |
| balanced | Intermediate → hosted | 0.3827 | 0.5032 | 1.4971 | 6.9558 |
| detail | Hosted → intermediate | 0.0323 | 0.0656 | 0.0911 | 0.1676 |
| detail | Intermediate → hosted | 0.1189 | 0.1190 | 0.4920 | 4.3234 |

The dense-source audit also rebuilt unsmoothed and smoothed 79.4 µm contours in
five separate 16-cell source slabs. Each direction uses area-weighted points in
the common interior, with a contour halo outside that interval. These rows show
the final hosted surface's distance from the unsmoothed fine-grid isosurface,
including smoothing and both simplification stages:

| Padded source Z interval | Level | Raw → hosted p95, mm | Hosted → raw p95, mm | Raw → smoothed p95, mm |
|---|---|---:|---:|---:|
| 312–328 | balanced | 0.8968 | 0.0822 | 0.4828 |
| 312–328 | detail | 0.6897 | 0.0668 | 0.4828 |
| 696–712 | balanced | 1.2450 | 0.0902 | 0.6930 |
| 696–712 | detail | 0.9705 | 0.0713 | 0.6930 |
| 1080–1096 | balanced | 4.2536 | 0.0934 | 1.2914 |
| 1080–1096 | detail | 1.9937 | 0.0727 | 1.2914 |
| 1464–1480 | balanced | 4.2761 | 0.0988 | 1.9669 |
| 1464–1480 | detail | 2.5875 | 0.0760 | 1.9669 |
| 1848–1864 | balanced | 1.2281 | 0.0744 | 0.5301 |
| 1848–1864 | detail | 0.9543 | 0.0656 | 0.5301 |

Each full-object direction uses **50,000 points**.
Each local direction uses **12,000 points per slab**.
Local contour-to-contour and hosted-to-local-source measurements can overestimate
error when the closest counterpart lies outside the finite slab halo. The
raw-local-source → full-hosted-object distances do not have that target-cropping
limitation. Their larger errors show that some original fine features are
omitted; the small hosted → source errors alone would conceal that loss.

For the detailed mesh, local **unsmoothed source → hosted** 95th-percentile
distance ranges from **0.69 to
2.59 mm**, and the largest sampled distance
is **4.91 mm**. For the compact
mesh, the corresponding p95 range is **0.90–4.28 mm**
and the largest sampled distance is **8.51 mm**.
These include the filtering and both simplification stages. They are the reason
to retain this as an optional display experiment rather than replace the source
volume or claim subvoxel preservation of every fine feature.

**These are sampled errors, not a Hausdorff bound.** The local audit covers five
slabs rather than every source voxel. The JSON includes tails, maxima, counts,
and both directions. Small structures can disappear or merge despite a low
typical distance. In particular, these measurements do not establish preserved
valve/chordal topology, wall thickness, or diagnostic accuracy. Review the
original measured cut faces when examining a thin structure.

The native whole-organ and valve close-up comparisons are in
[whole-surface-comparison.jpg](native/whole-surface-comparison.jpg) and
[valve-closeup-comparison.jpg](native/valve-closeup-comparison.jpg). They use the
production shaders and matched camera/transfer settings. The mesh's smoother
appearance does not itself establish greater anatomical fidelity.

## Coordinate and data contract

The mesh uses the same full-source endpoint convention as the existing Ultra
bank, with acquisition coordinates mapped to world **(x, z, −y)** and centered
on the source grid. The longest physical dimension is
**168.0104 mm**. No speculative slice registration, deformation,
or averaging of resliced axes was applied. X/Y/Z views are reformats of the same
acquisition, not independent observations.

The input is the existing cleaned and windowed **uint8 display** bank, with
source encoding interval 14,640–23,545.
It does not restore quantitative raw intensities clipped by that earlier display
preparation. The source manifest SHA-256 is
`e50ab70a52373dc774cf6077ef906a753e56b78b9f9b646fba2ffe7220ff338c`.

Source attribution: **Brunet et al. / ESRF Human Organ Atlas**, [Human Organ Atlas dataset
1659197537](https://human-organ-atlas.esrf.fr/datasets/1659197537), [DOI](https://doi.org/10.15151/ESRF-DC-1634390196).
The derived mesh follows the source's [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
terms; keep this attribution and the processing disclosure when redistributing it.

HFM1 uses a 32-byte little-endian header: magic `0x314d4648`, version 1, vertex
count, index count, position offset, normal offset, index offset, and reserved
zero. Positions are three normalized uint16 values; normals are three normalized
int16 values; triangles contain uint32 indices. All offsets are aligned to four
bytes. Each asset has compressed and decoded SHA-256 records in the manifest.

## Reproduce and inspect

With the complete local fine-volume bank and the preparation dependencies:

```sh
python3 -m pip install -r scripts/fine-surface-v19/requirements.txt
python3 scripts/fine-surface-v19/prepare.py --stage all --workers 2
python3 scripts/fine-surface-v19/validate.py
python3 scripts/fine-surface-v19/write_report.py
```

Use `--work` to put several gigabytes of reproducible intermediates on an
appropriate disk. Source data are read only. The preparation script validates
completed checkpoints and writes small metadata/array checkpoints atomically;
changing preparation inputs invalidates dependent stages. This release used
VTK 9.3.1, NumPy 2.3.5, SciPy 1.17.0, and fast-simplification 0.1.13.
The latter wraps the [Fast Quadric Mesh Simplification implementation](https://github.com/pyvista/fast-simplification).

`preparation.json` records the source, every slab, measured seam accounting and
encoded assets. `validation.json` records the distance audit. Native graphics
checks are recorded separately; they do not measure browser frame rates or
user-device interaction latency.
