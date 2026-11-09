# Methods, coordinates, and scientific limits

This guide maps the retained implementation to its processing records. Historical version directories describe the named experiment or release; they are not proof that every old mode remains active. Runtime manifests and the source snapshot identify the selected implementation.

## Measured sources and units

The three preserved-heart datasets are independent HiP-CT acquisitions. Native source voxel spacing is 19.85 µm for LADAF-2021-17 and S-20-28, and 19.89 µm for S-20-29. Their source records and citations are linked in [references](references.md). The prepared s2 grids used by several fine derivatives are 79.4, 79.4, and 79.56 µm respectively. Sampling intervals do not guarantee the same anatomical resolving power or retained mesh detail.

Prepared grayscale arrays are windowed 8-bit display derivatives. Original acquisition intensities, the source-to-display encoding window, and the adjustable display transfer are different quantities. Prepared HiP-CT values are not calibrated Hounsfield units. Rendering contrast, gamma, and brightness must not rewrite source values, processing thresholds, or geometry.

Each source manifest records dimensions, spacing, extent, and data order. Geometry utilities transform between array coordinates, world millimetres, and normalized renderer coordinates using that source’s physical extent. Preserve voxel-center/end-point conventions in the specific pipeline rather than replacing them with a guessed generic transform. Native-region integration uses its documented inverse center-resize registration; it is not a direct coordinate copy.

For LADAF-2021-17, source X/Y/Z are displayed approximately as Coronal/Sagittal/Axial. That specimen-specific convention is not a measured patient coordinate registration and must not be transferred blindly to another donor. Clinical adapters retain their actual direction metadata. See `public/section-names.js`, `public/probe-geometry.js`, and [source provenance](../DATA_PROVENANCE.md).

## Processing families

| Work | Editable implementation | Method/evidence records |
| --- | --- | --- |
| Display volumes and donor preparation | `scripts/prepare-volume.py`, `scripts/prepare-donor-v8.py`, `scripts/prepare-donor-v10.py`, `configs/donors/` | `docs/DATA_PROVENANCE.md`, `docs/donors/` |
| Fine bricks and registered sections | `scripts/prepare-ultra-volume-v7.py`, `scripts/prepare-donor-views-v8.py`, `scripts/prepare-donor-views-v10.py` | `docs/ULTRA_DETAIL.md`, `docs/donors/`, asset manifests |
| Fine and native surfaces | `scripts/fine-surface-v19/`, `scripts/fine-detail-v23/`, `scripts/guided-native-v21/` | `docs/fine-surface-v19/`, `docs/fine-detail-v23/`, `docs/guided-native-v21/` |
| Reviewed exclusions and local surfaces | `scripts/cleanup-v25/` through `scripts/cleanup-v30-*`, `scripts/assemble-cleanup-v30.py` | Matching cleanup directories under `docs/`, retained policy JSON, and source hashes |
| Compact transport and masks | `scripts/compression-v29/`, `scripts/prepare-reviewed-mask-atlas-v32.py` | `docs/verified-model-v32/`, `docs/echo-mobile-v41/`, compact manifests |
| Donor-specific echo alignment | `public/echo-donor-calibration.js`, `public/echo-donor-planes.js`, `scripts/echo-donor-qc-v6/` | `docs/echo-donor-context-v6/`, `docs/echo-donor-qc-v6/` |
| Reference anatomy and skeleton fit | `scripts/prepare-probe-context-v11.py`, `public/echo-anatomy-context-v2.js`, `public/echo-skeleton-fit.js` | `public/assets/probe-context-v11/LICENSES.md`, `docs/echo-mobile-v41/`, `docs/lab-context-v43/` |
| Complete donor heart surfaces for Chest Orientation | `scripts/prepare-probe-heart-v44.py`, `public/probe-overview.js` | `docs/probe-heart-v44/README.md`, `public/assets/probe-heart-v44/manifest.json` |
| Clinical source adapters | `scripts/prepare-cmac-v19.py`, `scripts/prepare-slicerheart-v19.py` | `docs/clinical-v19/`; data redistribution remains unresolved |

Some scientific scripts require original research acquisitions or intermediate caches absent from the public package, in addition to scientific libraries. Preserved scripts and parameter receipts do not establish an end-to-end rerun. Use each pipeline’s input hashes and environment records; do not substitute another donor or a similar file. Reproducibility gaps are recorded in the asset inventory and release handoff.

## Cleanup and annotations

Clean-scan support, reviewed lumen exclusions, detached-component filtering, local surface replacements, and normal smoothing are distinct operations. Some remove displayed material; others replace a local isosurface or change shading only. Retain original sources and reversible comparisons. Do not equate a dark voxel with artifact, a bright component with tissue, or a smooth surface with greater anatomical accuracy.

The active v30 local replacement family preserves source identities, crop bounds, and the documented frozen atrial-wall restoration. Packed masks have their own coordinate convention and membership hashes. The sparse atlas is a storage representation of reviewed mask bytes, not a new segmentation algorithm. Runtime CPU picking and visible rendering must apply the same active exclusions.

Tissue-region labels are approximate source-guided annotations, not expert-validated chamber volumes or valve/vascular segmentations. Shared septal ownership is a display convention. A label cannot establish the identity of an uncertain ostium, appendage, valve leaflet, or vessel.

## Echo geometry and simulation

Echo Windows uses donor-specific measured CT reformats and an accepted acquisition frame. A camera anchor changes viewing orientation only. A section moved in physical space must be resampled from that donor; a previous raster must not be translated or relabeled as the new image. Findings from an exact reviewed plane must not follow an arbitrary new plane.

BodyParts3D skin and bones and the authored surrounding-organ context are illustrative. Their fixed fit is not registration to a patient’s thorax or esophagus. Probe dimensions and insertion distances describe the model. The displayed probe face, fan, CT plane, and simulated image must agree geometrically, including when the beam misses the scanned heart.

The TTE Chest Orientation panel uses complete prepared donor heart surfaces in the same millimetre coordinates as the scan. LADAF reuses its existing balanced surface; the two S-donor models are extracted from their complete high display grids, filtered, simplified, and encoded as indexed HFM meshes. These compact orientation models are not the complete finalized Ultra model, and simplification does not guarantee fine-structure or topology preservation. The [whole-heart preparation record](../probe-heart-v44/README.md) provides exact inputs, processing settings, coordinate checks, and measured limitations.

TTE placement and sliding operate on the retained reference skin triangles. A ray selects visible skin, and incremental motion projects onto that fixed surface. The surface is finite reference anatomy; contact does not imply clinical access, a valid acoustic window, or patient registration. Moving a probe changes the acquisition pose and resamples the displayed section; it must not translate the heart to make the beam intersect it.

The ultrasound appearance uses CT-derived intensity/interface proxies, angle-sensitive reflections, fixed speckle, and attenuation. It does not measure acoustic impedance, tissue mechanics, probe pressure, physiological motion, or a clinical ultrasound acquisition. Independent teaching movies do not validate or synchronize the fixed specimen. Supplemental angle readouts marked **REF** are representative values when the actual acquired angle is unavailable.

## Verification versus validation

Hash checks establish byte identity. Unit/controller tests establish tested numerical/state behavior. Native GLSL/EGL captures exercise geometry and shader output in that environment. Browser checks establish observed behavior in the named browser/device configuration. None alone establishes clinical or anatomical accuracy.

Record the actual source snapshot and assets with each review. If full preprocessing, a browser engine, or a physical device was not tested, say so. Preserve unresolved target/structure limitations in donor-specific echo reviews.
