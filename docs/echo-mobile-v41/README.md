# Echo reference angles, intact skeleton fitting and mobile cleanup

This update addresses the three follow-up reports after Site version 72. The
original scientific data, source movies and accepted acquisition planes remain
the reference inputs. Changes concern the supplemental reference readout,
illustrative skeleton alignment and delivery of already reviewed cleanup.

## Supplemental video angle

ME five-chamber uses **5°** and ME modified bicaval TV uses **60°**. These are
representative reference values within the existing view ranges. The small
**REF** qualifier and text below the movie explicitly distinguish them from a
recording's acquired angle, which these two clips do not display. Existing
clinical acquisition ranges elsewhere in the interface retain their meaning.

The overlap was reproducible in the published Full Frame player. For the
modified-bicaval movie, the catalog's encoded raster is correctly 1280 × 720,
but the actual file has sample aspect ratio **512:351** and display aspect ratio
**8192:3159**. The browser reported **1867 × 720**. Using the encoded width to
compute the contained video rectangle put the dial over the blue scanner header
and the FR/depth column. The former cropped Fit Ultrasound mode happened to hide
much of this mismatch.

The placement now follows the loaded media's displayed geometry, the actual
video element box and the selected framing mode. Both dials occupy the scanner's
clear readout area to the right of its settings column and below the header.
The movie remains unchanged, including all original scanner text and controls.

## Skeleton fit

The earlier reference-spine display cutaway is replaced by an intact skeleton
fit. The skeleton is a separate illustrative layer from the skin, GI tract and
measured heart. Its fit is fixed for the donor and shared across TTE and TEE,
rather than changing with the selected view or camera.

The fixed smooth depth adjustment moves the anterior vertebral surface away
from the esophagus and makes a smaller sternum adjustment. It changes only the
LADAF reference skeleton and its labels. The skin vertices/normals, actual skin
contact windows, GI meshes, source frames and source arrays are unchanged.
All existing cropped context triangles remain: 14,349 in the rib/sternum/clavicle
mesh, 3,469 in the spine, and 4,038 in the unchanged skin. The field's global
Jacobian determinant lower bound is positive (0.5261875683); its normal
correction uses the exact inverse transpose. Independent finite-difference and
normal/tangent checks agreed within 3.2 × 10⁻¹⁰.

Verification covers original skeleton topology, esophagus clearance, skin
relationships and preservation of acquisition geometry. The native geometry
review and numerical receipts accompany this document. These checks establish
coherent reference alignment, not patient-specific skeletal registration.

All 112 primary current/previous TTE/TEE physical planes and instrument
geometries matched the prior version by exact per-case digest; every handoff
remained consistent. Twenty-one focused geometry tests passed, including all
three donors' skin/GI/contact invariants, shared TTE/TEE skeleton placement,
triangle winding and correct normals. The actual reference-mesh native review
also passed both camera views without GL errors.

The independent skin and skeleton are not a watertight registered pair. Their
coarse-surface contact count improves from 263 intersecting triangle pairs on
161 bone faces to 61 pairs on 39 faces. Of those remaining faces, 37 were
already in contact; two adjacent faces touch neighboring coarse skin triangles
after fitting. Sampling these faces at no more than 0.5 mm spacing found no
excursion beyond the outer anterior/posterior skin envelope. The original
contacts had up to 1.215 mm sampled excursion. This qualification concerns the
separate illustrative meshes; the spine/esophagus intersection is removed.

## Why mobile cleanup was missing

The v39 resource policy successfully avoided the large desktop installation:
the Ultra surface alone is **437,470,524 decoded bytes**, before its GPU copy,
reviewed masks, local replacements and other application allocations. It selects
the earlier polished surface on iPhone/iPad and other constrained devices.

Two distinct cleanup paths were consequently absent:

- The reviewed chamber-removal masks did not load automatically.
- The Gentle-specific detached-component attribute and local replacement meshes
  cannot be applied to the smaller mesh's unrelated vertex order and geometry.

The first omission exposed the previously reviewed LA clumps and sheets. The
new mobile path restores the four existing chamber-removal fields: atrial,
arterial, valve-region and RV. It preserves their original source coordinates,
nearest-cell membership and integrity checks. It does not reinterpret tissue,
increase an exclusion region, or apply a Gentle-only replacement mask without
its corresponding replacement geometry.

The bounded representation is used for mesh rendering, displayed 3D cut faces
and CPU picking. The original measured CT card pixels remain intact. Turning
the cleanup toggle off provides the original smaller reconstruction for
comparison. The smaller surface retains its Mobile Detail / Compact Detail
qualification; restoring reviewed cleanup does not make its fine-fold fidelity
equal to the complete desktop model.

The retained sparse data occupies **10,948,608 bytes** on the CPU and the same
amount in GPU textures. The four original dense fields total **81,845,420
bytes**. Their existing verified files are decoded one at a time; the largest
temporary decoded source is **29,192,000 bytes**. These are representation and
asset sizes, not a measurement of the entire browser's peak memory usage.

No new binary asset or simplified cleanup selection is introduced. The mobile
loader reuses the existing reference program and four original source masks,
copies only their occupied sparse blocks, and releases each dense source before
starting the next one. Its compact index and payload have pinned checksums.
An independent byte comparison re-expanded the compact atlas and matched all
**81,845,420 original bytes with zero mismatches**. The exported production
loader arrays also matched this independent reconstruction byte for byte.

## Verification scope

The focused browser check covers both affected native videos, Full Frame and
Fit Ultrasound, and the enlarged comparison layout. Source-player readiness,
mute/loop state and source attribution remain part of the existing player.

The mobile native test uses the actual smaller HFM surfaces, original verified
prepared LA cap images, production GLSL and the production-loader atlas. It
compares off/on/off at the same camera and checks that geometry and measured
cap arrays remain unchanged. Its prepared LA cuts are diagnostic source views,
not an independent validation of current clinical preset correspondence.

All four native cases passed: both smaller surface profiles, each with the
original LA inflow and outflow section. Every case changed the reviewed display
region, restored the original result exactly when switched off again, retained
the geometry and measured cap bytes, and completed without GL errors. The LA
inflow comparison visibly removes the reviewed cavity clumps and sheets.

Reproduce the independent data and native checks from the checkout:

```sh
node scripts/mobile-lumen-v41/export-runtime.mjs /dev/shm/mobile-lumen-v41-runtime
python3 scripts/mobile-lumen-v41/verify-atlas.py --runtime /dev/shm/mobile-lumen-v41-runtime
python3 tests/mobile-lumen-v41-native.py --atlas /dev/shm/mobile-lumen-v41-runtime
```

Controlled lifecycle tests cover the constrained-device policy, bounded
allocations and cancellation. Native EGL rendering and browser fixtures are
not physical iPhone/iPad tests or measurements of a universal iOS tab limit.

The final focused mobile checks passed: 47 surface-controller cases, 9 new
compact-cleanup cases, 6 existing lumen-controller cases, 19 atlas/picking/Echo
transition cases, and 9 device-budget/resource-integration cases. The 47-case
controller suite includes cleanup preparation before surface commit, pause and
resume, cancellation, failure/retry, preservation of a cleanup-off choice,
superseding enables and a final workspace check before GPU installation.

As before, an initial or saved Echo/probe workspace can pause unfinished
reconstruction preparation so its foreground scan work has priority. Returning
to Reconstruction completes Mobile Detail and its cleanup. Once prepared, the
same cleanup remains active on moving into Echo.

Detailed receipts:

- [Angle placement and all-frame source audit](angle-placement.md)
- [Intact skeleton fit and residual reference contacts](skeleton-fit.md)
- [Exact acquisition-plane preservation](skeleton-plane-invariance.json)
- [Exact mobile atlas verification](mobile-atlas-proof.json)
- [Production loader export and fingerprints](runtime-export.json)
- [Compact cleanup runtime checks](runtime-tests.json)
- [Actual smaller-mesh native rendering](native-mobile/mobile-lumen-native.json)
- [LA display comparison](native-mobile/mobile-la-cleanup.jpg)
- [Build/source agreement](build-source-proof.json)
