# Probe lab: physical plane control and CT-derived ultrasound appearance

## Implemented behavior

The Probe lab adds a movable, orientable probe to the existing measured heart viewer. One physical probe frame drives a full measured cut-face texture, a finite fan-shaped CT section, and a corresponding ultrasound-style sector. All three are presented from the same completed sampling result, so a delayed refinement cannot apply an old cap to a newer plane.

The probe is a schematic instrument guide, projected using the existing volume renderer’s camera basis and perspective. Its tip, handle, orientation marker, beam edges and depth arcs have physical 3D coordinates. The guide follows camera orbit and zoom without recomputing the slice. Initial framing includes the handle and fan, with an aspect-ratio adjustment for narrow viewports.

The module offers four source-guided starting planes: apical long axis, parasternal long axis, ventricular short axis and an atrial/TEE-side approach. They inherit the anatomical reference geometry in `public/assets/echo-planes.json`; they are not clinically registered transducer positions.

### Controls

| Input | Behavior |
| --- | --- |
| **Control probe** button | Requests cursor capture from the user’s click; entering the tab never captures automatically. |
| **W / S** | Advance or withdraw along the beam. |
| **A / D** | Translate along the in-plane lateral direction. |
| **R / F** | Translate perpendicular to the imaging plane. |
| Mouse horizontal / vertical | Pan and tilt the probe. |
| **Alt + horizontal mouse** | Rotate the imaging plane around the beam. |
| **Q / E** | Rotate the imaging plane around the beam. |
| **Shift** | Reduce translation and rotation speed for precise positioning. |
| **Escape** | Release cursor capture and clear held movement keys. |
| **Pan / tilt** and **Rotate** toggle | Select the mouse’s orientation mode without a modifier key. |
| Steering pad | Drag to change orientation without cursor capture; works with pointer/touch input. |
| Position buttons / angle sliders | Accessible alternatives to keyboard movement and captured mouse input. |
| Oblique / Face the plane / Frame the probe | Change the viewing camera while preserving the probe pose. |

When unlocked, the existing heart viewport retains its normal orbit and zoom controls. A dedicated pointer-lock target and capture-phase input guard keep probe movement from also orbiting the renderer. Window blur, hidden-page transitions, lock loss and module exit clear movement. Exit releases capture and never recaptures it. Unsupported or denied capture leaves the drag pad and form controls available. Browser input fields and browser modifier shortcuts are respected.

Depth, sector angle, gain, illustrative frequency, dynamic range, attenuation/shadow and travel speed can be adjusted. Pose, translation, acoustic-display settings, guide visibility, cutaway and clipping side serialize through the existing share-view workflow.

## Physical registration

Positions are stored in millimetres relative to the scan center, not voxel indices. Changing between the existing fast and detailed volume therefore preserves physical position. The acquisition-to-viewer mapping is the same as the rest of the application:

```
viewer X = acquisition X
viewer Y = acquisition Z
viewer Z = negative acquisition Y
```

The beam direction, in-plane lateral direction and normal are orthonormal. The probe origin plus beam/lateral coordinates defines every fan sample. The normal is `cross(right, up)` where `up = -beam`. The clipping plane is obtained by projecting the full acquisition bounding box into this same frame. This produces a complete cap even where the finite ultrasound fan covers only part of the cut face.

The CT fan is directly resampled from the measured volume with trilinear interpolation. It is not generated from the simulated image and is not twice interpolated through the polar acoustic grid. The current source spacing appears next to the image. Free oblique sections use the loaded 3D volume (normally 317.6 µm); this does not claim the 79.4 µm Ultra resolution available for separately hosted reference slices in Reconstruction/Echo windows.

## Ultrasound appearance: what is modeled

The image is visibly labeled **Simulated ultrasound — CT-derived**, with a fixed-specimen note. The module uses the measured spatial distribution of tissue, then applies illustrative display proxies:

1. Sample the volume along a fan of rays.
2. Use radial and transverse intensity gradients as interface proxies.
3. Modulate reflection by interface incidence relative to the ray.
4. Add a deterministic, spatially correlated scattering field at tissue coordinates. No timestamp or frame ID changes the speckle.
5. Accumulate moderate depth attenuation and interface-dependent shadowing along each ray.
6. Apply a small pulse/beam blur, scan-convert to the fan image, and apply logarithmic dynamic range and gain.

The measured CT intensities and cap never receive the acoustic blur or speckle. Cleanup uses the existing support mask consistently in both derived images. Empty input produces an empty simulated sector; no anatomical structures are drawn procedurally.

HiP-CT gray values are **not acoustic-impedance measurements**. There is no measured acoustic-material map, speed-of-sound estimation, wave-equation solution, refraction model, calibrated attenuation, patient registration or clinical validation. The frequency control changes illustrative scattering scale and resolution; it does not turn this scan into a calibrated transducer acquisition. The fixed specimen also provides no contraction or cardiac-cycle information. The independent real ultrasound clips in Echo windows are separate measured references.

The implementation takes broad inspiration from ray-based simulation, without claiming to implement or reproduce either of these research systems:

- Kutter O, Shams R, Navab N. *Visualization and GPU-accelerated simulation of medical ultrasound from CT images*. Computer Methods and Programs in Biomedicine (2009). [DOI: 10.1016/j.cmpb.2008.12.011](https://doi.org/10.1016/j.cmpb.2008.12.011); [PubMed 19249113](https://pubmed.ncbi.nlm.nih.gov/19249113/).
- Bertramo N, Duguey G, Gopalakrishnan V. *DiffUS: Differentiable Ultrasound Rendering from Volumetric Imaging* (2025). [arXiv:2508.06768](https://arxiv.org/abs/2508.06768). This work explicitly introduces a separate acoustic-impedance conversion stage; this viewer has no such learned or measured conversion.
- Input implementation reference: [MDN Pointer Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_Lock_API). Capture is gesture-triggered, Escape remains available, and implementations with and without a returned promise are supported.

## Responsiveness and lifecycle

`probe-acoustics-worker.js` performs cap sampling, polar sampling, acoustic approximation and scan conversion off the UI thread. It keeps one active job and one newest pending request. A small live frame may finish to prevent starvation during continuous input; superseded settled refinements are cancelled at bounded yields. Older sequence IDs, outdated volume generations and frames received after module exit are rejected.

Live settings use a 360-pixel cap dimension, 100 beams × 256 radial samples and a 380-pixel sector width. After 190 ms without probe changes, a settled frame uses an 850-pixel cap dimension, 192 × 512 acoustic samples and a 600-pixel sector width. These are display sampling sizes, not claims of additional source resolution. Source measurements, appearance palette and rendering policy do not switch during probe movement.

The worker is created only while the module is active and receives one volume copy. It is terminated on exit or volume replacement. If workers are unavailable, smaller samples yield on the main thread and retain the same latest-request and cancellation policy. The camera guide redraws only when its camera/pose/size key changes; the lightweight animation loop never requests a new volume render by itself. An entry-generation token prevents rapid tab changes from starting duplicate animation loops. Leaving also resets the pending live-sampling timer so reentry remains responsive.

## Validation

Run:

```
node scripts/verify-probe-v6.mjs --source --out={source-cache}/probe-v6
node scripts/verify-probe-integration-v6.mjs /path/to/linkedom/esm/index.js
```

The focused suite passes 13 checks covering orthonormal rotations, normalized diagonal translation, physical source axes, fan/cap coplanarity, renderer projection, exact phantom sampling, deterministic ultrasound/speckle, empty-input behavior, monotonic gain, cleanup support, cancellation and actual worker coalescing. All four starting views intersect real measured heart tissue. The separate actual-module integration suite exercises entry, controls, denied/unsupported pointer lock, form protection, coupled frame presentation, stale response rejection, state round trips, worker teardown and rapid asynchronous reentry.

Source render evidence is in `probe-v6-contact-sheet.png`. `probe-v6-validation.json` records the checks and source-run sampling timings. The saved run measured **29–90 ms for a live CPU sample** and **98–236 ms for a settled sample** across the four starting views on this runtime. These numbers exclude browser paint, GPU ray marching and event delivery; they are **not browser frame-rate measurements**.

The images were computed from the shipped 317.6 µm volume and inspected directly. Browser interaction/permission and responsive-layout inspection were unavailable in the current session; the Node DOM integration tests mock the browser permission boundary. No browser performance, ultrasound realism or anatomical validation beyond the stated checks is claimed.

Dataset: [ESRF Human Organ Atlas, LADAF-2021-17 heart](https://human-organ-atlas.esrf.fr/datasets/1659197537), DOI [10.15151/ESRF-DC-1634390196](https://doi.org/10.15151/ESRF-DC-1634390196), CC BY 4.0. Existing scan attribution remains in the application.
