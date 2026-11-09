# v30 LVOT and mitral refinement

## Selected result

The selected derivative is **`median145-guarded`**, packaged as one compound
`lvot-perivalvular-refinement` replacement. It expands the earlier source crop
to cover the mitral region and the full reviewed depth behind sagittal section
293. The original scientific source, whole-heart position/index arrays,
current hard object masks and the two repaired atrial-wall footprints remain
unchanged.

The contribution manifest is
`public/assets/cleanup-v30-left/manifest-entry.json`. It contains the verified
surface, low-band mask and policy references for canonical v30 assembly. The
review policy is
`patch/lvot-perivalvular-refinement-policy.json`; the independent source audit
is `guarded-review/source-validation.json`.

| Property | Selected derivative |
| --- | ---: |
| Fine-source lower XYZ | 1018, 944, 916 |
| Fine-source upper XYZ, exclusive | 1330, 1240, 1400 |
| Source dimensions XYZ | 312 × 296 × 484 |
| Source sample spacing | 79.4 µm |
| Delivered vertices / triangles | 477,150 / 963,173 |
| Surface gzip bytes | 10,313,927 |
| Surface GPU attribute/index bytes | 17,283,876 |
| Packed low-band mask, compressed / decoded bytes | 876,540 / 5,587,296 |
| Foreground samples excluded, including previous exclusions | 3,563,663 |
| Additional foreground samples excluded beyond v29 | 2,932,485 |

The surface can be transported in ordered gzip byte parts to respect hosted
object limits. The full verified gzip and decoded geometry do not change when
transport is split. This contribution does not modify the shared loader or
canonical manifests.

## What changed in the source treatment

The source consists of windowed 8-bit HiP-CT intensities. These are **not
calibrated Hounsfield units**. The baseline source field is a Gaussian filter
with sigma 0.5 fine samples and isovalue 71.4. Within serially reviewed aortic
and mitral envelopes, the selected candidate uses a 3 × 3 × 3 median followed
by the same Gaussian filter, together with a smoothly varying local threshold
up to 145.

The regularized scalar is clamped to the original Gaussian scalar before
application. Therefore it can remove low-support foreground but cannot create
new source density. No hole filling, artificial caps, fabricated leaflet
surfaces or dilation are used. Existing local exclusions are retained, and
the scalar returns to the original field at every crop face. The two
overlapping review envelopes form one compound replacement slot with the
original field retained between and outside their weighted regions.

An unprotected threshold increase was insufficiently selective. The selected
candidate therefore protects two forms of coherent source support:

1. Median-filtered/Gaussian-filtered source values at or above 155.
2. Raw values at or above 170 that also have five consecutive Gaussian-source
   samples at or above 150 along at least one of 13 three-dimensional
   orientations.

The new cleanup weight is zero within 1.5 source samples of these markers and
then increases with a smooth taper over another two samples. This is a narrow
local protection rule. It avoids retaining every isolated bright peak merely
because its raw value exceeds 190, while preserving coherent bright rims and
long thin structures encountered in the reviewed views.

These support markers are a technical preservation check, not a tissue
classifier. Inherited detached-component display rules still apply after
extraction, including crop-boundary and long-thin protections. Marker counts
precede that display filtering and the measured geometric reduction.

## Compared methods and rejection decision

The source review compared threshold-only fields, actual three-dimensional
median regularization and total-variation regularization. The latter used
weight 16 and exactly 24 iterations on the original windowed scalar. Source
panels and serial neighboring images are retained in `source/`.

| Candidate | Foreground exclusions | Main review finding |
| --- | ---: | --- |
| Median, maximum 130, unguarded | 4,368,228 | Large reduction in dark matrix; some ragged interfaces remain. |
| TV, maximum 130, unguarded | 4,251,973 | Retains more bright isolated cores; no clear advantage in the reviewed valve view. |
| Median, maximum 145, unguarded | 5,259,801 | **Rejected:** visible new chips/perforations in coherent low-contrast valve-like contours. |
| Median, maximum 145, coherent-support guard | 3,563,663 | Selected: broad dark matrix reduction with bright cut-face contours and thin strands retained in the inspected views. |

The rejected candidate retained all high-intensity median-supported cores,
yet still visibly damaged lower-contrast coherent structures. This is why
raw/core intensity retention alone was not accepted as preservation evidence.
Selected-candidate inspection includes the delivered compact geometry, both
nearby planes and multiple camera directions.

## Source and boundary verification

The independent validator rereads the hash-verified original source region,
recomputes coherent markers and compares the delivered packed mask with the
published v29 mask. It found **zero newly excluded coherent-marker samples**.
Of 7,196,535 markers, 1,119 were already excluded by the inherited v29 field;
they are separately counted and are not new losses.

The following are screenshot-anchored spatial review windows, not validated
anatomical segmentations:

| Review window | Coherent source markers | Newly excluded markers | Markers already excluded in v29 |
| --- | ---: | ---: | ---: |
| Aortic root / LVOT rim | 825,295 | 0 | 22 |
| Mitral leaflet window | 413,813 | 0 | 0 |
| Mitral chordal window | 1,558,655 | 0 | 741 |

All six **complete** crop faces were checked independently, including the
entire first and last Y planes. Their regularization weights are zero and
their source isovalue differences are exactly zero. No prior excluded mask
sample was reintroduced. The complete frozen atrial restoration contains
109,928 samples with SHA-256
`ac5d0d8771272e5bb14e0ae8ef13aea171c8abeda24d754e0345e1328aa5fbea`;
none overlaps the delivered low-band mask.

The mesh reduction freezes boundary vertices and constrains accumulated
vertex displacement radius to 0.3176 mm. Independent 12,000-point samples
against the selected unreduced geometry measured source-to-delivered distance
P95 0.03771 mm and sampled maximum 0.15455 mm. In the reverse direction, P95
was 0.03134 mm and sampled maximum 0.08484 mm. Quantized position error was at
most 0.000389 mm. These are finite geometric measurements, not a Hausdorff
bound or clinical/anatomical accuracy claim.

## Production rendering and the important activation diagnostic

All selected evidence uses the actual production GLSL, exact original CT
section pixels and the same full retained depth as the viewer. There is no
rear slab to hide material. The main source geometry retains its original
positions and indices; normals are remapped from the verified current v29
compact shading buffer, decoded SHA-256
`ef468a2ebf15f11cf57f8443e7d3555f8d53fc1a43b9582125bbbabe304d6ad8`.
The renderer initializes the current scene-depth sampler explicitly. Source
cap bytes are checked unchanged after rendering. The sagittal-293 full view
also passes exact cleanup-off equality and reversible before-state checks.

Selected comparisons are under `guarded-review/`:

- `mitral-y293-comparison.jpg`: broad reduction of the dark granular bridges
  around the valve-like structures and lower branches, with long strands and
  broad bright contours retained at the rendered resolution.
- `aortic-y293-comparison.jpg`: same-plane aortic closeup.
- `aortic-y293-oblique-comparison.jpg` and
  `aortic-y293-reverse-oblique-comparison.jpg`: opposite oblique directions.
- `valves-y293-oblique-comparison.jpg`: full-depth compound overview.
- `valves-y291-comparison.jpg` and `valves-y295-comparison.jpg`: nearby source
  cuts at fine Y1160 and Y1176, around the requested Y1168.

The fully active published v29 baseline already showed much less proximal
aortic debris than the user's screenshot. A separate, explicitly labeled
**activation diagnostic** disabled local replacements in its BEFORE image
while retaining the original whole-heart surface, current corrected normals,
current object masks and detached-debris flags. That state reproduces the
conspicuous dark proximal strip much more closely. Its AFTER enables the
selected v30 patch and retained companion patches:
`activation-diagnostic/aortic-y293-comparison.jpg`.

This diagnostic is **not the fully active v29 baseline**. It suggests that an
incompletely loaded or inactive local refinement state may explain some of
the screenshots; it does not establish what actually ran in the user's
browser. Runtime refinement readiness and failures should therefore be
visible to the user and independently verified in the assembled release.

Fine pepper remains on a deeper, continuously supported source boundary near
Y904–910, outside this crop. Serial source inspection did not justify treating
that entire continuing boundary as loose luminal debris, so it was not
erased. The evidence supports a substantial targeted improvement, not a claim
that every irregular dark feature throughout the heart is an artifact or that
every visible irregularity has been removed.

## Reproduction

The pipeline requires the verified scientific brick bank and scientific Python
environment. Run from the repository root:

```sh
python scripts/cleanup-v30-left/build_patch.py --method median --threshold 145 --core-collar --output /path/to/median145-guarded
python scripts/cleanup-v28-right/compact_patch.py /path/to/median145-guarded/lvot-perivalvular-refinement-policy.json --radius-mm .3176 --samples 12000
python scripts/cleanup-v30-left/validate_patch.py /path/to/median145-guarded/lvot-perivalvular-refinement-policy.json --output docs/cleanup-v30-left/guarded-review/source-validation.json
python scripts/cleanup-v30-left/package_patch.py /path/to/median145-guarded/lvot-perivalvular-refinement-policy.json
```

For each review camera, run `cache_geometry.py <case>` followed by
`current_normals.py <case>`, then `render_review.py --case <case>` with the
selected policy, EGL software-rendering environment and
`--stream-triangles 100000`. The streaming batches preserve triangle order and
the framebuffer/depth state; they do not change scientific geometry.
`--baseline-no-local` is reserved for the separately labeled activation
diagnostic. `patch/package-receipt.json` pins code, configuration, selected
policy, source audit, scientific library versions and artifact identities.
