# Whole-mesh detached-fragment cleanup, v25

The Gentle surface now has a source-pinned display filter for compact disconnected
fragments. It excludes **1,342,006 components containing 5,739,103 triangles**
(24.299% of the original triangle count). The retained **17,879,582 triangles**
use the exact original positions and normals. This filter does not smooth,
remesh, brighten, or replace any retained geometry.

The high removed triangle count is predominantly very small speckle: 95.123% of
the excluded triangles already belong to components with bounding-box diagonal
at most 0.35 mm. The largest excluded component contains only 102 triangles.
Triangle counts describe mesh complexity; they do not measure removed tissue
volume or establish the biological identity of a fragment.

## Exact source

| Property | Value |
| --- | --- |
| Donor | LADAF-2021-17 |
| Input | Gentle HFM1, `public/assets/fine-surface-v23/manifest.json` |
| Source spacing | 79.4 µm |
| Vertices | 12,837,189 |
| Triangles | 23,618,685 |
| Connected components before filtering | 1,406,359 |
| Unreferenced vertices | 0 |
| Decoded HFM SHA-256 | `175548ddaad01c409d59d561df6018c5cb0c90752b2ec771899c255065398dae` |
| Compressed HFM SHA-256 | `d93d62cdb331c5deb507cc47102da0c9f9dd3c84ad1aa5f0f0a3ebad04691ba2` |
| Physical world scale | 168.0104 mm per world unit, from the matching Ultra metadata |

The input is the existing 79.4 µm, cleaned display-source reconstruction. This
cleanup does not incorporate new 19.85 µm measurements. Native-resolution
reconstructions retain their separate source identity and processing.

## Conservative selection

Connectivity is computed over **every triangle in the complete, uncut mesh**,
using shared vertex indices. A clipping plane therefore cannot make an attached
structure eligible merely by hiding its attachment.

A component is excluded only if all of these conditions hold:

1. It is not the largest component.
2. Its physical axis-aligned bounding-box diagonal is at most **0.85 mm**.
3. It contains at most **1,024 triangles**.
4. Its regularized principal-component spread ratio is strictly below **3**.
5. It does not touch an extreme of the quantized reconstruction volume.

For covariance eigenvalues `lambda_min` and `lambda_max`, the shape test uses
`sqrt((lambda_max + r*r) / (lambda_min + r*r))`, with `r = 0.0397 mm`, half a
source sample. This finite sampling floor does not move or dilate the geometry.
Elongated and thin sheet-like components tend to have a high ratio and are
preserved. Shape is measured from the component's original vertices, not from
pixels or a rendered appearance.

The largest component, containing **15,863,437 triangles**, is retained in full.
The shape guard separately protects **48,463 small components containing
309,818 triangles** within the selected 0.85 mm size limit. In total **64,353
components** remain. Components connected to a large anatomical structure remain
even if they look rough or noisy.

## Threshold comparison

All rows use the same connectivity, triangle-count limit, shape test and boundary
guards. Only the physical size limit changes.

| Maximum bounding-box diagonal | Excluded components | Excluded vertices | Excluded triangles | Fraction of original triangles |
| --- | ---: | ---: | ---: | ---: |
| 0.35 mm | 1,314,303 | 5,407,738 | 5,459,231 | 23.114% |
| 0.60 mm | 1,339,864 | 5,569,516 | 5,682,751 | 24.060% |
| **0.85 mm, selected** | **1,342,006** | **5,599,693** | **5,739,103** | **24.299%** |
| 1.00 mm | 1,342,472 | 5,608,393 | 5,756,563 | 24.373% |
| 1.20 mm | 1,342,846 | 5,616,998 | 5,774,300 | 24.448% |

Increasing the limit from 0.85 to 1.20 mm adds only 35,197 excluded triangles.
The selected limit removes most compact speckle while retaining larger uncertain
material. No additional broad filtering was applied after reviewing the
production comparisons.

## Browser integration and reversibility

`public/assets/cleanup-v25/debris-manifest.json` contains one profile for Gentle.
The profile must match the exact decoded source SHA-256, vertex count and triangle
count before installing its flags.

- `debris-gentle-vertices.raw.gz`: one unsigned byte per original HFM vertex,
  **0 = retain, 255 = exclude**. Decoded size is 12,837,189 bytes; gzip size is
  893,225 bytes. Every component, and therefore every triangle, has a uniform
  value. A normalized vertex attribute can discard excluded fragments without
  creating another full index buffer. Disabling the display filter restores the
  original mesh immediately.
- `debris-gentle-faces.keep.gz`: optional packed triangle mask for scientific
  processing. Bits follow original HFM triangle order, **least-significant bit
  first**, **1 = retain**. Decoded size is 2,952,336 bytes; gzip size is 1,151,815
  bytes. Unused trailing bits are zero.

Both files have compressed and decoded byte counts and SHA-256 values in the
manifest. The full component ledger is an offline audit artifact and is not
needed by the viewer. Other surface LODs and donors are not assigned these flags.

## Verification and evidence

The build verified all ten compressed source parts, the joined gzip checksum,
the decoded HFM checksum, HFM header/counts/index ranges, and normal encoding.
It then checked:

- All 23,618,685 triangles have three identical vertex flags.
- The vertex flags and triangle bitset exclude the same number of faces.
- The largest component is retained.
- Source positions, normals and triangle indices have identical SHA-256 values
  before and after the audit.
- Both generated compressed assets round-trip with the expected lengths and
  hashes.

`scripts/cleanup-v25/debris_verify.py` independently checks the compiled component
code against synthetic geometry. It compares accumulated covariance with NumPy's
independent covariance implementation, verifies a compact speck is excluded, and
verifies a connected branch, a narrow rod, a thin sheet, a large component and a
boundary-touching component are retained. It also verifies the final asset hashes,
flag values/counts, face-bit ordering and trailing padding. All checks passed.

The build completed in **55.3 seconds**, with a measured peak resident set of
**888 MiB**. The decoder owns one decoded HFM buffer; no full decoded mesh is
written to disk, no full floating-point position array is allocated, and no
large sparse adjacency matrix is constructed. Covariance eigensolves are batched.

Evidence files:

- `debris-audit.json`: source hashes, transport receipts, threshold comparison,
  largest components, geometry-array hashes and validation results.
- The optional component ledger, stored outside the checkout at
  `{source-cache}/cleanup-v25/debris-components.csv.gz`, has one row per component
  with vertex/triangle counts, physical bounds, shape ratio, surface area and the
  selected exclusion flag. Its exact path, size and hash are recorded in
  `debris-audit.json`; it is supplemental offline data, not a deployment asset.
- `debris-validation.json`: independent synthetic and asset-integrity checks.
- `debris-build.log`: execution timing, peak memory and selected counts.
- The adjacent `render/` directory contains production-shader comparisons using
  these flags together with the separate reviewed lumen masks.

Reproduce from the repository root:

```sh
python3 scripts/cleanup-v25/debris_build.py
python3 scripts/cleanup-v25/debris_verify.py
```

To reproduce the full component ledger as well, pass
`--audit-data-dir /path/outside/the/checkout` to the builder. The aggregate audit
and browser masks are always produced; the 1.4 million-row ledger is optional.

The offline builder requires Python, NumPy and a C++ compiler. Generated browser
assets have no dependency on the compiler or scientific Python environment.

## Visual review and remaining limits

The aortic, outflow, exterior and mitral production comparisons show substantial
reduction of detached specks. The inspected views retain branching surface
vessels, major ridges, thin chordal/leaflet strips and trabecular contours. The
outflow's large targeted clump and the atrial mass are addressed by separate
source-guided masks, not by the compact-component rule.

The remaining attached burrs and some larger or anisotropic fragments are
deliberately retained. Their removal needs local source review because they may
share topology with thin anatomy. This filter does not remove all rough surface
texture, fill valve holes, alter source CT sections, or classify dark shading as
artifact. Dark cut-face pixels can represent measured source variation; smooth
dark gradients can be ordinary surface lighting. Neither is a basis for deleting
geometry or painting source sections uniformly bright.

These are reversible display-cleanup candidates, not expert-validated anatomical
labels or a determination that the original material is clot rather than artifact.
