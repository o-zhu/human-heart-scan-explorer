# Reproducing the additional donor volumes

The v10 pipeline reads reviewed source configurations in `configs/donors/`.
It supports the atlas's N5/Blosc big-endian X-fast layout and OME-Zarr/Blosc
little-endian C-order XYZ layout. Both become internal uint16 ZYX arrays.
The v8 scripts remain unchanged so that the previous donor is reproducible.

## Sources and encoding

| Configuration | Dataset | Fine source level | Display texture spacing |
|---|---|---|---|
| `ucl-zcr-2337.json` | 2298521860 | N5 s2 | 42.480 µm |
| `ucl-zcr-2627.json` | 2298522608 | OME-Zarr 2 | 28.128 µm |
| `ucl-zcr-2628.json` | 2298522707 | N5 s2 | 28.128 µm |

The configurations preserve the official source Neuroglancer intensity window.
Its uint16-to-uint8 conversion is a display encoding, not a quantitative raw
measurement format. The separate `displayWindow` affects appearance without
changing the encoded scan or its surface threshold.

Source metadata and reviewed configuration snapshots are included under
`docs/donors/<slug>/`. The configuration's original `metadataDirectory` is an
acquisition-time location. When that location is unavailable, the processor
uses these included metadata snapshots. Public source chunks are fetched from
their recorded atlas URL and cached with SHA-256 provenance.

## Commands

Install `scripts/requirements-volume.txt` in a Python environment. Run from the
project root, substituting the selected configuration and a cache location with
enough space:

```bash
python scripts/prepare-donor-v10.py --config configs/donors/ucl-zcr-2627.json --cache /path/to/cache --stage download
python scripts/prepare-donor-v10.py --config configs/donors/ucl-zcr-2627.json --cache /path/to/cache --stage preview
python scripts/prepare-donor-v10.py --config configs/donors/ucl-zcr-2627.json --cache /path/to/cache --stage fine --workers 16
python scripts/prepare-donor-v10.py --config configs/donors/ucl-zcr-2627.json --cache /path/to/cache --stage sections --workers 4
python scripts/prepare-donor-v10.py --config configs/donors/ucl-zcr-2627.json --cache /path/to/cache --stage bricks --workers 4
python scripts/prepare-donor-v10.py --config configs/donors/ucl-zcr-2627.json --cache /path/to/cache --stage verify
```

`--stage all` runs these stages sequentially. `--stage pack` repacks existing
registered preview/detailed arrays into bounded static files without repeating
source reconstruction. The initial preview is a single small file. Detailed
arrays are split into independent z slabs with reversible prediction reset at
each slab; no public volume part is allowed to reach 16 MiB.

Each configuration's cleanup threshold was chosen after inspecting that
donor's histogram and orthogonal source sections. A new source must be reviewed
before setting `cleanup.thresholdRaw`; the script refuses to guess it.

## Registration and preservation

The first fine source sample center anchors the display lattice. The high
volume uses an integer fine-index stride. Its source sampling coordinates are
calculated from actual physical scale and origin rather than a fixed offset.
The OME source provides explicit translations. N5 uses the linked Neuroglancer
reader's zero-origin cell grid, so sample centers are at half a cell spacing.
See the source pyramid alignment reports for an independent comparison of
averaged fine blocks to the original high-level source.

Up to three terminal fine columns are zero-padded to reach the next shared
coarse/fine endpoint. No acquired column is deleted to make dimensions odd.
The smaller preview uses endpoint-preserving resampling and records its true
per-axis spacing. World coordinates are centered physical `[X, Z, -Y]`, divided
by the longest physical center extent; the longest axis is not assumed to be Z.

Cleanup is conservative display support, not anatomical segmentation. The
original windowed coarse volume remains available. UCL-ZCR-2337 includes
substantial adjacent lung tissue in the atlas source. Its inspected cardiac ROI
retains every above-threshold voxel before dilation, while nearby acquired
anatomy is not silently deleted. The ROI support report records that check.

## Fine data and storage

Fine processing decodes each support-selected source chunk directly into a
cropped, windowed uint8 memory-mapped array. It never creates a full fine uint16
intermediate. Orthogonal images retain exact fine source sample indices and
use lossless cropped WebP. Oblique reformats use sparse lossless gzip density
bricks with 64³ cores and a positive one-voxel halo for continuous trilinear
sampling. The halo is retained in every encoded brick.

New section images use WebP's **lossless** mode with method 2 and effort 0.
The effort parameter changes encoder search time, not pixel fidelity. A measured
UCL2627 section required 0.683 CPU seconds and 1,587,242 bytes with this setting,
versus 5.010 seconds and 1,577,870 bytes with method 4 / effort 100; both decoded
to identical source bytes. The benchmark is retained in that donor's records.
Previously encoded images may be reused only after decoding and comparing them
against the current source pixels. Each encoding record identifies that reuse.
X and Y sections are assembled in bounded batches of 32 to avoid repeatedly
scanning the complete strided memory map on a host with limited RAM. Existing
UCL-ZCR-2627 output includes 311 verified earlier images encoded with method 4;
the remaining sections use method 2. This changes compression effort only.

The acquisition cache can be large. Process donors with a bounded concurrency
and monitor free storage. After all source-to-display checks, image checks,
object SHA/length checks, and prepared-view generation finish, the fine uint8
memory map is regenerable from its configuration, support mask and compressed
source chunks. Do not remove or modify it while prepared views are being
sampled. The final encoded banks, manifests and provenance must be retained.

## Prepared views and validation

`scripts/prepare-donor-views-v10.py` generates source-specific geometric
comparison planes separately. It does not reuse the previous donor's chamber
labels or assert that unreviewed planes are clinical TTE/TEE windows. Pass its
fine source options only after the fine stream is fully flushed and its
metadata file is written. Its prepared images and the density bank must share
the same source spacing, physical extent and crop origin.

The processing records include lossless decode checks during encoding. The
final `verify` stage checks every indexed file's length and SHA-256, compares
20,000 fine display samples with separately decoded source chunks, checks
4,096 physical registration points and preview endpoints, and hashes the full
decoded fine display data. Additional comparison tests independently check
multipart volume bytes, source interpolation, prepared planes and brick halos.

## Completed v10 data banks

These are actual generated sizes; bytes are decimal, not MiB. The initial
preview and the fine banks are separate resources. Loading a comparison does
not require downloading its entire fine bank.

| Donor | Initial clean preview | Detailed clean volume | Section positions / unique objects | Lossless section bytes | Sparse brick objects | Lossless brick bytes |
|---|---:|---:|---:|---:|---:|---:|
| UCL-ZCR-2337 | 2,324,676 | 15,734,948 | 1,345 / 1,317 | 909,647,990 | 6,907 | 1,297,543,103 |
| UCL-ZCR-2627 | 3,182,321 | 19,870,207 | 1,358 / 1,312 | 1,009,194,456 | 9,577 | 1,637,531,035 |
| UCL-ZCR-2628 | 3,204,558 | 19,859,160 | 1,509 / 1,424 | 948,808,684 | 9,028 | 1,529,751,851 |

The largest individual section is 1,635,048 bytes. The fine cropped display
arrays contain 5,361,326,425, 5,083,461,441, and 6,106,432,725 bytes respectively;
they are processing intermediates, not initial website downloads. Sparse bricks
and cropped sections represent the same registered display values in two
formats suited to different access patterns. They do not restore clipped raw
uint16 intensities or add detail beyond the stated source resolution.

The reviewed source and display settings are:

| Donor | Official encoding window (raw units) | Display-only window (raw-equivalent units) | Display gamma | Support threshold (raw units) |
|---|---|---|---:|---:|
| UCL-ZCR-2337 | 20,264–29,567 | 23,700–27,700 | 0.9 | 24,100 |
| UCL-ZCR-2627 | 8,579–15,434 | 10,500–15,434 | 1.1 | 10,800 |
| UCL-ZCR-2628 | 12,319–16,970 | 13,700–16,970 | 1.1 | 14,100 |

Each donor's `encoded-bank-verification.json` records the complete encoded
inventory hashes, independent source comparisons, registration error, full
decoded display hash, and release gate for its fine intermediate. The separate
independent comparison audit also checks all 25 source-specific prepared views.
The reviewed UCL-ZCR-2337 cardiac ROI contains 1,249,350 above-threshold voxels;
all are retained by its conservative support. Its adjacent lung tissue remains
visible in the source and is explicitly identified in the comparison metadata.

All three public source records specify only **age <18** and **Disease free**.
Exact ages and sex are not supplied in the retrieved metadata. Their physical
scan fields and chamber appearances should not be used to infer ages or to
claim matched specimen preparation, physiological filling, or comparable
chamber volumes. The new plane sets are measured geometric comparisons pending
donor-specific anatomical review; chamber identity masks are not copied from
the previous donor.
