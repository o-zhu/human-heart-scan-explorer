# Probe lab v7: contact, comparison and fine measured planes

The Probe lab presents two equal visual areas: the measured 3D heart and a
CT-derived simulated ultrasound sector. The right panel can switch to the
measured CT sector without adding a third, narrow panel. Both views use the
same physical probe pose, imaging depth and sector angle.

![Native render of TTE and TEE contact guides with matching fine-derived sectors](native-comparison.jpg)

This figure uses the actual production GLSL, the production camera basis,
recorded production Canvas guide paths and actual simulated-sector output.
It is a native offscreen validation figure, not a browser screenshot.

## Contact model and controls

New sessions and reset presets lock the probe to a visible synthetic contact
surface. Apical, parasternal and short-axis starts use a curved skin patch.
The atrial/TEE start uses a distinct cylindrical esophageal-wall patch and a
small transducer with an axial cable. The TEE view is not labeled as external
skin.

These shapes are educational positioning guides. Neither the chest surface
nor the esophageal wall was reconstructed from this isolated-heart scan;
their position is not registered to a patient or a clinical acoustic window.
The interface, badge and method notes state this explicitly.

| Input | Locked contact | Free-position mode |
| --- | --- | --- |
| W / S | Slide along the surface | Move along the beam |
| A / D | Slide across the surface | Move laterally in the scan plane |
| R / F | Disabled, to preserve contact | Move out of the scan plane |
| Mouse | Pan and tilt the beam around its contact point | Pan and tilt the beam |
| Alt + horizontal mouse | Rotate the scan plane | Rotate the scan plane |
| Q / E | Rotate the scan plane | Rotate the scan plane |
| Shift | Precision movement and orientation | Precision movement and orientation |
| Escape | Release captured cursor | Release captured cursor |

Clicking the 3D visual requests pointer capture immediately from that user
gesture. A prominent **Press Esc to release control** badge stays visible
while captured. The explicit Control probe button, steering pad, step buttons
and sliders remain available. Unsupported or declined pointer capture leaves
the steering pad usable. The explicit Orbit heart mode restores normal
camera dragging and zooming. Blur, hidden document, module exit and Escape
clear held keys and release capture. No input is automatically captured on
entry.

Locked motion is projected into bounded surface coordinates. Steering pivots
around the same contact point; changing imaging depth does not move it.
Unlocking preserves the current world position and orientation. Relocking
projects the position onto the corresponding guide. Legacy free-pose
bookmarks without the new contact flag retain their old free position.

### Geometry

Coordinates use physical millimetres relative to the scan centre. The
renderer uses normalized world axes `[scan X, scan Z, -scan Y]`, with
168.0104 mm as the full reference extent. The default poses preserve the
existing calibrated section-plane orientation and origin.

The skin patch has elliptical limits of 55 × 45 mm and parabolic curvature
`u²/(2·260) + v²/(2·220)` mm. The esophageal guide has radius 18 mm, a ±50°
arc and ±42 mm axial travel. These parameters define controls, not measured
body dimensions. Surface tangents determine translation and the local
steering frame. Probe, contact footprint and fan use the same world pose
that drives the sampled plane.

## Fine measured planes

`ProbeLabModule` accepts an injected `fineSource` and exposes
`setFineSource(source)`. The shared service supplies cleaned, measured
79.4 µm source data from exact prepared planes or sparse volume bricks.

```js
const fine = await fineSource.samplePlane(plane, {
  signal,
  priority: 'interactive',
  spacingUm: 79.4,
  onProgress
});
```

The returned plane contains top-row-first `Uint8Array` samples, its exact
world centre/basis/extents, width/height, source and output spacing, and
`complete: true`. It is cached and read-only. The Probe module sends it to
the acoustics worker by structured cloning, without transferring or
detaching the service's cached buffer.

During movement the loaded volume supplies responsive previews. Once the
pose settles, the module requests the matching fine plane. Every pose or
volume change aborts the previous request. Request ID, volume version,
pose revision and refinement generation all guard result acceptance. Old
work cannot replace a newer displayed pose.

The acoustics worker samples all of its rays within that fine plane. The
full-resolution image becomes the 3D cap without downsampling, while the
measured CT sector and simulated ultrasound are computed from the same
fine samples. The three outputs are accepted together. The source label
changes to 79.4 µm only after this complete fine frame is ready; a coarse
preview is not labeled Ultra.

The `cleaned` provenance flag follows the fine plane through the acoustic
worker and into the renderer cap. Already-cleaned fine samples bypass the
coarser support mask in both paths, preserving their edge detail. Original
volume cleanup remains active. The Ultra label also requires plane sampling
of 79.44 µm or finer; a plane sampled more coarsely from the fine source is
labeled Fine and reports that output spacing separately.

The fine service is cleaned-only. Turning Clean scan off uses the currently
loaded original volume and displays its actual resolution. It does not
silently substitute cleaned fine data into the original comparison.

Four exact default planes are exported in
[`../probe-v7-default-planes.json`](../probe-v7-default-planes.json). Their
keys match the shared fine-service cache. The prepared lossless images
total 3,169,520 bytes (3.17 MB decimal):

| Preset | Full cap pixels | Encoded bytes | Simulated/CT sector pixels |
| --- | --- | ---: | --- |
| Apical | 3281 × 2948 | 973,320 | 1100 × 893 |
| Parasternal | 2948 × 2964 | 783,588 | 1100 × 856 |
| Short axis | 3281 × 3094 | 439,220 | 1100 × 822 |
| Atrial / TEE | 3281 × 2948 | 973,392 | 1100 × 856 |

The 79.4 µm label describes the CT source. It is not a claim of ultrasound
resolution. The simulated image retains its own finite beam grid,
illustrative pulse blur and 1100-pixel presentation resolution.

## Acoustic appearance and its limits

The simulation uses measured CT anatomy for location, intensity-gradient
interface proxies, angle-dependent reflection, tissue-fixed spatial
speckle, depth attenuation, shadow, gain and log compression. Its
frequency control changes an illustrative appearance model. HiP-CT
grayscale is not a measurement of acoustic impedance, and these controls
are not calibrated tissue coefficients or a full wave solver. The fixed
specimen contains no heartbeat or contractility, and no animated beat is
invented.

The approach is informed by ray-based CT-to-ultrasound simulation, including
[Kutter, Shams and Navab (2009)](https://pubmed.ncbi.nlm.nih.gov/19249113/).
This implementation is a simpler educational proxy, not a reproduction or
clinical validation of that paper's method.

Interface shadow now integrates over physical radial travel in millimetres,
rather than accumulating once per sample. Without this correction, the
denser fine grid darkened the same deep anatomy merely because it had more
samples. In the layered phantom regression, increasing radial samples from
400 to 1400 changed mean deep displayed intensity from 163.18 to 164.16 on
the 0–255 scale, instead of artificially extinguishing it.

## Verification

Reproduce the focused checks with:

```sh
node scripts/verify-probe-v7.mjs --source --out={source-cache}/probe-v7
node scripts/verify-probe-v6.mjs
node scripts/verify-probe-integration-v6.mjs {source-cache}/heart-ui-test-v5/node_modules/linkedom/esm/index.js
python scripts/render_probe_v7.py {source-cache}/probe-v7
```

The v7 verifier accepts `--dom=/path/to/linkedom/esm/index.js` when the
local DOM dependency is installed elsewhere. The native render helper
requires the existing local volume fixture used by `render_flow_views_v5.py`,
EGL, Pillow, NumPy and Inkscape.

The [19-check report](verification.json) covers bounded contact motion,
TTE/TEE distinction, basis/plane mapping, complete-fine validation,
fine-derived outputs even with an empty coarse volume, deterministic
acoustics, radial-resolution invariance, a real worker's buffer ownership,
all four actual texture pixel hashes, input capture/orbit/escape behavior,
state restoration, coherent cap/image updates, fine cleanup provenance,
coarser-output labeling, stale-result rejection,
cleanup gating and exit teardown. The original 12 geometry/acoustics/worker
checks also pass, as do the existing module integration checks.

The [native render report](native-validation.json) verifies the current
production GLSL using llvmpipe EGL, the actual camera basis and fine caps,
with zero GL errors for TTE and TEE examples. The contact guides and sectors
are visible, use the matching pose and fit their equal 680 × 650 evidence
panels.

Actual fine-frame CPU calculations in the recorded run took 168–340 ms for
the four defaults. These are Node computation timings for settled fine
frames, not browser frame rates or download latency. Movement still uses
the smaller preview job, and old settled work yields to newer input.

Browser permission behavior and CSS layout were not verified through a
real browser because that automation path was unavailable. DOM tests mock
the permission boundary explicitly. Native render evidence does not imply
browser FPS, clinical acoustic fidelity or patient-specific registration.
